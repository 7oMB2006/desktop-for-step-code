import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const main = resolve(process.env.DESKTOP_VERIFY_MAIN || 'dist/main.cjs');
const expectBusy = process.env.DESKTOP_EXPECT_STARTUP_BUSY === '1';
const externalAgent = process.env.DESKTOP_VERIFY_EXTERNAL_AGENT === '1';
const remoteDisabled = process.env.DESKTOP_VERIFY_REMOTE_DISABLED === '1' || externalAgent;
const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT || 'test-results/remote-startup-navigation');
const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-remote-startup-')));
const project = join(profile, 'project'), root = join(profile, 'step-runtime');
const sessions = join(root, 'sessions');
await mkdir(sessions, { recursive: true });
await mkdir(project);
await mkdir(join(profile, 'remote'));
await mkdir(output, { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'dark', workspaces: [project], workspace: project,
}));
await writeFile(join(root, 'config.toml'),
  'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'isolated-only',
  models: [{ id: 'fixture', name: 'Startup fixture' }],
} } }));
const identity = { botId: 'fixture-bot', credentials: {
  appId: 'fixture-app', appSecret: 'synthetic-only', brand: 'feishu',
} };
// This file is synthetic: only the isolated launcher below replaces safeStorage.
if (!remoteDisabled) await writeFile(join(profile, 'remote', 'connection.dpapi'), JSON.stringify({
  version: 1, identity, access: {
    actor: 'fixture-human', chat: 'fixture-chat', workspaces: [project], sessionId: 'startup-remote',
  },
}));
for (const id of ['startup-remote', 'startup-local-a', 'startup-local-b']) {
  const timestamp = new Date().toISOString();
  const entries = [
    { type: 'session', version: 3, id, cwd: project, timestamp },
    { type: 'message', id: 'question', parentId: null, timestamp,
      message: { role: 'user', content: [{ type: 'text', text: id }], timestamp: Date.now() } },
    { type: 'session_info', id: 'name', parentId: 'question', timestamp, name: id },
  ];
  await writeFile(join(sessions, `${id}.jsonl`), entries.map(value => JSON.stringify(value)).join('\n') + '\n');
}
const helper = join(profile, 'remote-fixture.mjs');
await writeFile(helper, `
  import { createInterface } from 'node:readline';
  const write = value => process.stdout.write(JSON.stringify(value) + '\\n');
  createInterface({ input: process.stdin }).on('line', line => {
    const value = JSON.parse(line);
    write({ type: 'response', id: value.id, success: true,
      data: value.type === 'snapshot' ? { identity: ${JSON.stringify(identity)} } : undefined });
    if (value.type === 'connect') write({ type: 'remote_channel', kind: 'connected', botName: 'Startup fixture' });
  });
`);
const entry = join(profile, 'entry.cjs');
await writeFile(entry, `
  const cp = require('node:child_process'), { join, resolve } = require('node:path');
  const { safeStorage } = require('electron');
  safeStorage.isEncryptionAvailable = () => true;
  safeStorage.encryptString = value => Buffer.from(value);
  safeStorage.decryptString = value => value.toString('utf8');
  const fixture = globalThis.remoteStartupFixture = { held: false, released: false, spawns: 0 };
  const spawn = cp.spawn;
  cp.spawn = function(command, args, options) {
    if (args?.[0]?.endsWith('remote-channel.mjs')) return spawn.call(this, command, [${JSON.stringify(helper)}], options);
    const child = spawn.call(this, command, args, options);
    let workerArgs = args;
    const job = args?.indexOf('-File'), spec = args?.indexOf('-Spec');
    if (job >= 0 && spec >= 0 && args[job + 1] === join(resolve('runtime'), 'windows-runtime-job.ps1')) {
      try { workerArgs = JSON.parse(Buffer.from(args[spec + 1], 'base64').toString('utf8')).args; }
      catch { return child; }
    }
    if (workerArgs?.[0] !== join(resolve('runtime'), 'step/dist/bundle/step.js') ||
      !workerArgs.includes('--mode') || !workerArgs.includes('rpc')) return child;
    fixture.spawns++;
    if ((${remoteDisabled} && !${externalAgent}) || fixture.spawns !== 1) return child;
    const write = child.stdin.write;
    child.stdin.write = function(...values) {
      let value;
      try { value = JSON.parse(String(values[0])); } catch {}
      if (value?.type !== 'get_state' || fixture.held) return write.apply(this, values);
      fixture.held = true;
      fixture.release = () => {
        if (fixture.released) return;
        fixture.released = true;
        child.stdin.write = write;
        write.apply(child.stdin, values);
      };
      return true;
    };
    return child;
  };
  require(${JSON.stringify(main)});
`);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
let phase = 'launch';
const errors = [];
let externalRequest;
let externalSocket;
try {
  app = await electron.launch({ args: [entry], env, timeout: 60000 });
  page = await app.firstWindow();
  await page.waitForURL('**/renderer/index.html', { timeout: 60000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 3
    && document.querySelector('.new-chat')?.disabled === false, undefined, { timeout: 60000 });
  if (externalAgent) {
    phase = 'create an isolated external task through the real connector gateway';
    await page.evaluate(() => window.desktop.externalConnectorAction({ type: 'enable' }));
    const state = await page.evaluate(roots => window.desktop.externalConnectorAction({
      type: 'pair', displayName: 'Hermes fixture', roots,
    }), [project]);
    const agent = state.connections.at(-1);
    const descriptor = JSON.parse(await readFile(join(profile, 'external-connectors', 'agents', agent.agentId, 'model.json'), 'utf8'));
    externalRequest = new Promise((resolve, reject) => {
      const socket = externalSocket = createConnection({ host: '127.0.0.1', port: descriptor.port });
      let bytes = '';
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('External creation timed out')); }, 25000);
      socket.once('connect', () => socket.write(JSON.stringify({
        version: 1, protocol: descriptor.protocol, token: descriptor.token, method: 'task.create',
        params: { key: 'remote-navigation-fixture', cwd: project, title: 'External navigation fixture' },
      }) + '\n'));
      socket.on('data', chunk => {
        bytes += chunk.toString();
        if (!bytes.includes('\n')) return;
        clearTimeout(timer);
        try { resolve(JSON.parse(bytes.slice(0, bytes.indexOf('\n')))); }
        catch (error) { reject(error); }
        socket.destroy();
      });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
      socket.once('close', () => { clearTimeout(timer); reject(new Error('External request closed before its reply')); });
    }).then(reply => ({ reply }), error => ({ error }));
  }
  phase = 'Remote automatic recovery holding cold worker';
  const deadline = Date.now() + 30000;
  while ((!remoteDisabled || externalAgent) && !(await app.evaluate(() => globalThis.remoteStartupFixture.held))) {
    assert.ok(Date.now() < deadline, 'Saved Remote recovery must reach the held get_state');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).state?.sessionId, undefined,
    'Remote recovery must leave the local homepage active');
  phase = remoteDisabled ? 'click local history without Remote recovery' : 'click local history during Remote recovery';
  const row = id => page.locator(`[data-reorder-id="${id}"] > button`).first();
  await row('startup-local-a').click();
  if (expectBusy) {
    await page.locator('.app-error-banner').waitFor({ timeout: 10000 });
    const banner = await page.locator('.app-error-banner').innerText();
    assert.match(banner, /Workspace operation in progress/);
    await page.screenshot({ path: join(output, 'before.png') });
    await writeFile(join(output, 'results.json'), JSON.stringify({ reproduced: true, banner, errors }, null, 2));
    console.log('Reproduced startup click failure:', banner.trim());
  } else {
    await row('startup-local-b').click();
    // An IPC marker orders the assertion after both navigation requests.
    await page.evaluate(() => window.desktop.sessions());
    assert.equal(await page.locator('.app-error-banner').count(), 0);
    if (!remoteDisabled || externalAgent) assert.equal(await app.evaluate(() => globalThis.remoteStartupFixture.spawns), 1,
      'Local history must wait rather than duplicate the in-flight Remote worker');
    if (!remoteDisabled || externalAgent) {
      const hint = page.locator('.remote-navigation-hint');
      await hint.waitFor({ state: 'visible' });
      assert.match(await hint.innerText(), externalAgent ? /正在准备外部 Agent 任务/ : /正在恢复飞书会话/);
      assert.match(await hint.innerText(), /startup-local-b/);
      assert.equal(await page.locator('.notice-toast').count(), 0, 'Remote waits must not use global toasts');
    }
    await page.screenshot({ path: join(output, 'waiting.png') });
    phase = 'release Remote recovery and confirm latest local identity';
    await app.evaluate(() => globalThis.remoteStartupFixture.release?.());
    await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === 'startup-local-b'
      && !document.querySelector('.session-navigation-spinner'), undefined, { timeout: 60000 });
    assert.equal(await page.locator('.remote-navigation-hint').count(), 0);
    if (externalRequest) {
      const result = await externalRequest;
      assert.equal(result.error, undefined);
      assert.equal(result.reply?.ok, true, 'The independent external task must also finish creating');
    }
    const snapshot = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(snapshot.state?.sessionId, 'startup-local-b');
    assert.equal(await page.locator('.app-error-banner').count(), 0);
    const remoteDeadline = Date.now() + 30000;
    let remote;
    do {
      remote = await page.evaluate(() => window.desktop.remoteState());
      if (remoteDisabled) {
        assert.equal(remote.binding, undefined);
        break;
      }
      if (remote.binding?.sessionId === 'startup-remote') break;
      assert.ok(Date.now() < remoteDeadline, 'Remote recovery must retain its separate session');
      await new Promise(resolve => setTimeout(resolve, 30));
    } while (true);
    if (!remoteDisabled) assert.notEqual(remote.binding.runtimeId, snapshot.runtimeId);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(output, 'after.png') });
    await writeFile(join(output, 'results.json'), JSON.stringify({
      passed: true, remoteDisabled, externalAgent, sessionId: snapshot.state.sessionId, remoteSessionId: remote.binding?.sessionId, errors,
    }, null, 2));
    console.log(externalAgent ? 'External task navigation passed: correctly attributed hint; latest local target opened.'
      : remoteDisabled ? 'Disconnected control passed: latest local target opened without Remote recovery.'
      : 'Remote startup navigation passed: latest local target opened; Remote retained its own session.');
  }
} catch (error) {
  console.error('Phase:', phase);
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  if (app) {
    await app.evaluate(() => globalThis.remoteStartupFixture.release?.()).catch(() => {});
    externalSocket?.destroy();
    await externalRequest;
    await closeDesktopFixture(app);
  }
}
