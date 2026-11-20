import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import {
  closeDesktopFixtureAndWait, fixtureBrowserPort, releaseExitedFixtureInspector, releaseExitedFixturePipes,
} from './close-desktop-fixture.mjs';
import { waitForSessionFixtureSnapshot, waitForSessionFixtureTools } from './session-fixture.mjs';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';

const requested = process.env.DESKTOP_VERIFY_EXE;
assert.ok(requested && isAbsolute(requested) && /\.exe$/i.test(requested),
  'Set DESKTOP_VERIFY_EXE to the absolute path of the unpacked Windows candidate .exe');
assert.equal(process.platform, 'win32', 'This acceptance requires real Windows');
const executablePath = await realpath(requested);
const resources = join(dirname(executablePath), 'resources');
const archive = join(resources, 'app.asar');
const node = join(resources, 'runtime', 'node', 'node.exe');
for (const file of [executablePath, archive, node]) {
  assert.ok((await stat(file)).isFile(), `Candidate file required: ${file}`);
}

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-v018-process-')));
const root = join(profile, 'step-runtime');
const workspace = join(profile, 'Shared process workspace');
const home = join(profile, 'home');
const appData = join(home, 'AppData', 'Roaming');
const localAppData = join(home, 'AppData', 'Local');
const temporary = join(profile, 'temp');
for (const path of [join(root, 'sessions'), workspace, appData, localAppData, temporary]) {
  await mkdir(path, { recursive: true });
}

const fixtureName = 'v018-command-tree.cjs';
const lifetimeMs = 10 * 60 * 1000;
// Both nodes must answer a new challenge at every transition. A stale PID
// marker or a PID recycled by Windows cannot make the two nodes appear alive.
await writeFile(join(workspace, fixtureName), `
const { spawn } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const [token, role = 'parent'] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/.test(token) || !['parent', 'child'].includes(role)) process.exit(2);
const expiresAt = Date.now() + ${lifetimeMs};
const child = role === 'parent'
  ? spawn(process.execPath, [__filename, token, 'child'], { stdio: 'ignore', windowsHide: true })
  : undefined;
child?.on('error', () => process.exit(3));
writeFileSync(token + '.' + role + '.json',
  JSON.stringify({ token, pid: process.pid, ppid: process.ppid, child: child?.pid, expiresAt }), { flag: 'wx' });
let lastChallenge;
setInterval(() => {
  if (existsSync(token + '.stop')) process.exit(0);
  if (Date.now() >= expiresAt) process.exit(4);
  let challenge;
  try { challenge = readFileSync(token + '.challenge', 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (challenge !== lastChallenge && /^[0-9a-f-]{36}$/.test(challenge)) {
    writeFileSync(token + '.' + role + '.' + challenge, String(process.pid), { flag: 'wx' });
    lastChallenge = challenge;
  }
}, 100);
`);

const bashQuote = value => `'${value.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
const trees = ['a', 'b'].map((tag, index) => {
  const token = randomUUID();
  return {
    id: `v018-process-${tag}`, token, prompt: `Start isolated process fixture ${token}`,
    callId: `v018-process-call-${tag}`, done: `Process fixture ${tag} started`, requests: 0,
    // Keep a Bash PID distinct from the Node parent and its own child.
    command: `${bashQuote(node)} ./${fixtureName} ${token} & wait`,
    timestamp: new Date(Date.now() - (2 - index) * 1000).toISOString(),
  };
});
const [a, b] = trees;
const savedPath = tree => join(root, 'sessions', `${tree.id}.jsonl`);
for (const tree of trees) {
  const { id, timestamp } = tree;
  await writeFile(savedPath(tree), [
    { type: 'session', version: 3, id, cwd: workspace, timestamp },
    { type: 'message', id: 'user-1', parentId: null, timestamp,
      message: { role: 'user', content: `Saved process fixture ${id}`, timestamp: Date.parse(timestamp) } },
    { type: 'session_info', id: 'name-1', parentId: 'user-1', timestamp, name: id },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  theme: 'dark', language: 'en', workspace, workspaces: [workspace], autoCheckUpdates: false,
  network: { mode: 'direct', proxyUrl: '' },
}));
await writeFile(join(root, 'config.toml'), [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', 'permissionPreset = "approve-for-me"',
  '[telemetry]', 'enabled = false', '[mcp_servers.steppage__steppage]', 'enabled = false', '',
].join('\n'));

const key = 'v018-loopback-fixture-only';
const text = content => typeof content === 'string' ? content
  : content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const providerErrors = [];
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'fixture' }] }));
      return;
    }
    assert.ok(req.method === 'POST' && req.url === '/v1/chat/completions', 'Unexpected fixture endpoint');
    assert.ok(req.headers.authorization === `Bearer ${key}`, 'Only the synthetic credential may reach the provider');
    let raw = '';
    for await (const part of req) { raw += part; assert.ok(raw.length < 8 * 1024 * 1024); }
    const { messages, model, tools } = JSON.parse(raw);
    assert.equal(model, 'fixture');
    const user = messages.findLastIndex(message => message.role === 'user');
    const tree = trees.find(candidate => candidate.prompt === text(messages[user]?.content));
    assert.ok(tree, 'Only the two explicit process fixture prompts may call the model');
    const results = messages.slice(user + 1).filter(message => message.role === 'tool');
    assert.equal(++tree.requests, results.length + 1);
    assert.ok(tree.requests <= 2, 'Only one command and one completion per fixture prompt');
    if (results.length) assert.equal(results[0].tool_call_id, tree.callId);
    else assert.ok(tools.some(tool => tool.function?.name === 'run_command'));
    const delta = results.length ? { content: tree.done } : { tool_calls: [{
      index: 0, id: tree.callId, type: 'function', function: { name: 'run_command',
        arguments: JSON.stringify({ command: tree.command, cwd: workspace, run_in_background: true }) },
    }] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ id: tree.callId, object: 'chat.completion.chunk', model,
      choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: results.length ? 'stop' : 'tool_calls' }],
    })}\n\ndata: [DONE]\n\n`);
  } catch (error) {
    providerErrors.push(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

// Do not inherit provider credentials, runtime or dev overrides, user config,
// proxy settings, Electron flags, or Node startup hooks from the caller.
// Leave Windows to resolve its native profile: redirecting USERPROFILE lets
// system input methods create and lock LocalLow directories in the fixture.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(path|pathext|windir|systemroot|systemdrive|comspec|programfiles(?:\(x86\))?|programw6432|processor_architecture|processor_architew6432)$/i.test(name)));
Object.assign(env, {
  DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  HOME: home, APPDATA: appData, LOCALAPPDATA: localAppData,
  TEMP: temporary, TMP: temporary, TMPDIR: temporary,
});

const pidValid = pid => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid;
const alive = pid => {
  assert.ok(pidValid(pid), 'Invalid fixture PID');
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
const absentOK = (error, otherwise) => {
  if (error.code === 'ENOENT') return otherwise;
  throw error;
};
const readOptional = path => readFile(path, 'utf8').catch(error => absentOK(error, ''));
const waitFor = async (label, condition, timeout = 15000) => {
  const end = Date.now() + timeout;
  do {
    const result = await condition();
    if (result) return result;
    await delay(50);
  } while (Date.now() < end);
  assert.fail(`Timed out waiting for ${label}`);
};
const bounded = async (label, promise, timeout = 30000) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
};
const assertAlive = async tree => {
  assert.ok(tree.pids.every(alive), `${tree.id} lost an original process: ${tree.pids.join(', ')}`);
  const challenge = randomUUID();
  await writeFile(join(workspace, `${tree.token}.challenge`), challenge);
  await waitFor(`${tree.id}'s original parent and child to answer`, async () => {
    const parent = await readOptional(join(workspace, `${tree.token}.parent.${challenge}`));
    const child = await readOptional(join(workspace, `${tree.token}.child.${challenge}`));
    return parent === String(tree.pids[1]) && child === String(tree.pids[2]);
  });
  assert.ok(tree.pids.every(alive), `${tree.id} lost a process after answering`);
};
const assertDead = async tree => {
  await waitFor(`${tree.id} processes (${tree.pids.join(', ')}) to exit`, () => tree.pids.every(pid => !alive(pid)));
  assert.ok(Date.now() < tree.expiresAt, `${tree.id} must be stopped before any fixture can self-expire`);
};

let app;
let verifiedProfile = false;
let passed = false;
let phase;
const progress = label => { phase = label; console.log(`[v018-process] ${label}`); };
let releasePipes = () => {};
let releaseInspector = () => {};
try {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: key,
    models: [{ id: 'fixture', name: 'Process fixture', contextWindow: 32768, maxTokens: 2048 }],
  } } }));
  progress('launching isolated packaged Electron');
  app = await electron.launch({ executablePath, cwd: workspace, env, timeout: 60000 });
  const electronProcess = app.process();
  const exit = new Promise(resolve => electronProcess.once('exit', (code, signal) => resolve({ code, signal })));
  const contextClosed = new Promise(resolve => app.context().once('close', resolve));
  const identity = await app.evaluate(({ app }) => ({
    pid: process.pid, debugPort: process.debugPort, executable: process.execPath,
    userData: app.getPath('userData'), appPath: app.getAppPath(), packaged: app.isPackaged,
  }));
  assert.equal(await realpath(identity.userData), profile, 'Electron must use the newly created profile');
  verifiedProfile = true;
  assert.equal(identity.packaged, true);
  assert.equal(await realpath(identity.executable), executablePath);
  assert.equal(await realpath(identity.appPath), await realpath(archive));
  const page = await app.firstWindow({ timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.desktop), undefined, { timeout: 60000 });
  const initial = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(initial.preferences.autoCheckUpdates, false);
  for (const tree of trees) assert.equal(initial.sessions.find(session => session.id === tree.id)?.cwd, workspace);

  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox.bind(dialog);
    globalThis.v018FixtureDeleteCount = 0;
    dialog.showMessageBox = async (...args) => {
      if (args[1]?.message !== 'Move this session to the Recycle Bin?') return original(...args);
      globalThis.v018FixtureDeleteCount++;
      return { response: 1 };
    };
  });

  const select = async tree => {
    await page.evaluate(id => window.desktop.navigateSession(id), tree.id);
    const selected = await waitForSessionFixtureSnapshot(page, state =>
      state.status === 'connected' && state.state?.sessionId === tree.id, `${tree.id} selected`);
    assert.ok(selected.runtimeId);
    assert.equal(selected.runtimes.find(runtime => runtime.runtimeId === selected.runtimeId)?.cwd, workspace);
    return selected.runtimeId;
  };
  const start = async (tree, runtimeId) => {
    progress(`starting nested background command in ${tree.id}`);
    const ready = await waitForSessionFixtureTools(page, runtimeId);
    assert.ok(ready.state.desktopStartup?.tools.every(tool => tool.status === 'disabled') ?? true,
      'No optional MCP tools should start');
    await page.evaluate(({ prompt, runtimeId }) => window.desktop.command('prompt', { message: prompt }, runtimeId),
      { prompt: tree.prompt, runtimeId });
    const seen = new Set();
    const final = await waitForSessionFixtureSnapshot(page, async state => {
      if (providerErrors.length) throw providerErrors[0];
      assert.equal(state.runtimeId, runtimeId);
      for (const request of state.requests ?? []) {
        if (seen.has(request.id)) continue;
        assert.equal(request.runtimeId, runtimeId);
        assert.equal(request.method, 'confirm');
        assert.match(request.title ?? '', /^Approve run_command\b/i);
        assert.ok(request.message?.includes(tree.token), 'Do not approve any command other than this fixture');
        await page.evaluate(({ id, runtimeId }) =>
          window.desktop.command('extension_ui_response', { id, confirmed: true }, runtimeId),
        { id: request.id, runtimeId });
        seen.add(request.id);
      }
      return !state.state?.isStreaming && state.messages.some(message =>
        message.role === 'assistant' && text(message.content) === tree.done);
    }, `${tree.id} tool result and settled turn`, 45000);
    const result = final.messages.find(message => message.role === 'toolResult' && message.toolCallId === tree.callId);
    assert.ok(result && result.toolName === 'run_command' && result.isError === false,
      `Expected a successful background tool result for ${tree.id}: ${text(result?.content)}`);
    const { pid: shell, logPath, background } = result.details;
    assert.equal(background, true);
    assert.ok(pidValid(shell) && isAbsolute(logPath));
    const log = relative(profile, await realpath(logPath));
    assert.ok(log && log !== '..' && !isAbsolute(log) && !log.startsWith(`..${sep}`), 'Log must belong to the fixture');
    const marker = role => waitFor(`${tree.id} ${role} PID marker`, async () => {
      const raw = await readOptional(join(workspace, `${tree.token}.${role}.json`));
      if (!raw.endsWith('}')) return undefined;
      return JSON.parse(raw);
    });
    const [parent, child] = await Promise.all([marker('parent'), marker('child')]);
    assert.equal(parent.token, tree.token);
    assert.equal(child.token, tree.token);
    assert.equal(child.ppid, parent.pid);
    assert.equal(parent.child, child.pid);
    tree.pids = [shell, parent.pid, child.pid];
    assert.equal(new Set(tree.pids).size, 3);
    assert.ok(tree.pids.every(pidValid));
    tree.expiresAt = Math.min(parent.expiresAt, child.expiresAt);
    await assertAlive(tree);
    console.log(`[v018-process] ${tree.id} OS PIDs (shell, parent, child): ${tree.pids.join(', ')}`);
  };

  const runtimeA = await select(a);
  await start(a, runtimeA);
  const runtimeB = await select(b);
  assert.notEqual(runtimeA, runtimeB, 'The same workspace must not share the two workers');
  await assertAlive(a);
  await start(b, runtimeB);
  assert.equal(new Set([...a.pids, ...b.pids]).size, 6);
  for (const [tree, runtimeId] of [[a, runtimeA], [b, runtimeB]]) {
    progress(`switching back to ${tree.id}; both original trees must still run`);
    assert.equal(await select(tree), runtimeId);
    await Promise.all(trees.map(assertAlive));
  }

  progress('deleting inactive A while B stays active');
  assert.equal(await page.evaluate(id => window.desktop.deleteSession(id), a.id), true);
  assert.equal(await app.evaluate(() => globalThis.v018FixtureDeleteCount), 1);
  await assert.rejects(stat(savedPath(a)), { code: 'ENOENT' });
  await stat(savedPath(b));
  const afterDelete = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(afterDelete.state.sessionId, b.id);
  assert.equal(afterDelete.runtimeId, runtimeB);
  assert.ok(!afterDelete.sessions.some(session => session.id === a.id));
  await assertDead(a);
  await assertAlive(b);

  progress('requesting normal app quit with B still running');
  const activePort = await readOptional(join(profile, 'DevToolsActivePort'));
  releasePipes = releaseExitedFixturePipes(app);
  releaseInspector = releaseExitedFixtureInspector(app, { ...identity, browserPort: fixtureBrowserPort(activePort) });
  await page.evaluate(() => {
    window.desktop.onEvent(event => {
      const request = event.type === 'desktop_quit_review' && event.state?.request;
      if (request?.phase === 'review') void window.desktop.quitRespond(request.id, true).catch(() => {});
    });
    return window.desktop.windowControl('quit');
  });
  assert.deepEqual(await bounded('normal Electron quit', exit, 45000), { code: 0, signal: null });
  assert.equal(alive(identity.pid), false, 'Electron main process must be gone');
  await assertDead(b);
  await bounded('Playwright shutdown', contextClosed);
  assert.deepEqual(providerErrors, []);
  assert.deepEqual(trees.map(tree => tree.requests), [2, 2]);
  passed = true;
} catch (error) {
  console.error(`[v018-process] failed during ${phase ?? 'fixture setup'}`);
  throw error;
} finally {
  if (!passed) {
    // Only our own fixture code reads these unique markers. Never taskkill a
    // numeric PID from a failed run, which Windows may already have reused.
    await Promise.all(trees.map(tree => writeFile(join(workspace, `${tree.token}.stop`), '', { flag: 'wx' })
      .catch(error => console.error(`[v018-process] could not signal ${tree.id}: ${error.message}`))));
    if (app && app.process().exitCode === null && app.process().signalCode === null) {
      if (verifiedProfile) {
        await closeDesktopFixtureAndWait(app).catch(error => {
          console.error(`[v018-process] failure cleanup: ${error.message}`);
          app.process().kill();
        });
      } else {
        app.process().kill();
      }
    }
    for (const tree of trees.filter(tree => tree.pids?.every(pidValid))) {
      await waitFor(`failure cleanup of ${tree.id}`, () => tree.pids.every(pid => !alive(pid)))
        .catch(error => console.error(`[v018-process] ${error.message}`));
    }
  }
  releasePipes();
  releaseInspector();
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
await removeTestProfile(profile);
progress('passed: navigation preserved both process trees; deletion stopped A; normal quit stopped B');
