import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { mkdtemp } from '../../../../Desktop/scripts/test-profile.mjs';
import { closeDesktopFixtureAndWait } from '../../../../Desktop/scripts/close-desktop-fixture.mjs';
import { installRuntimeFixturePreload } from '../../../../Desktop/scripts/runtime-transport-fixture.mjs';
import { installationReceipt, packageFingerprint, writeReceipts } from '../../../../Desktop/electron/plugin-files.mjs';

const desktop = fileURLToPath(new URL('../../../../Desktop/', import.meta.url));
const { _electron: electron } = createRequire(join(desktop, 'package.json'))('playwright');
assert.ok(process.env.DESKTOP_VERIFY_EXE, 'Set DESKTOP_VERIFY_EXE to the new package executable');
assert.ok(process.env.DESKTOP_VERIFY_OUTPUT, 'Set DESKTOP_VERIFY_OUTPUT to a unique evidence directory');
const executablePath = resolve(process.env.DESKTOP_VERIFY_EXE), output = resolve(process.env.DESKTOP_VERIFY_OUTPUT);
const runtime = join(dirname(executablePath), 'resources/runtime');
const profile = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-tts-electron-')));
const root = join(profile, 'step-runtime'), directory = join(root, 'plugins/speech-example');
await mkdir(join(directory, 'dist'), { recursive: true });
await mkdir(output, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('../test/fixtures/speech-server.mjs', import.meta.url))],
  outfile: join(directory, 'dist/server.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
const manifest = { id: 'dfsc-host-example', mcpServers: { example: {
  command: join(runtime, 'node/node.exe'), args: [join(desktop, 'tests/fixtures/host-sdk-proxy.mjs'), 'dist/server.mjs'],
  env: { STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' },
} } };
await writeFile(join(directory, 'step.plugin.json'), JSON.stringify(manifest));
await writeFile(join(directory, 'dfsc.host.json'), JSON.stringify({ schemaVersion: 1, hostApiVersion: 1,
  consumer: { kind: 'mcp-stdio', server: 'example' }, capabilities: ['model.tts'] }));
const receipt = installationReceipt({ name: 'speech-example' }, { name: 'isolated-speech', kind: 'local', path: profile },
  manifest, await packageFingerprint(directory));
receipt.state = 'installed';
await writeReceipts(root, { version: 1, installations: [receipt] });
await writeFile(join(root, 'plugins/.stepcode-preinstalled'), '["steppage"]');
await writeFile(join(root, 'config.toml'), 'defaultProvider = "step"\ndefaultModel = "step-5-preview"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));

const key = 'isolated-tts-account', bytes = Buffer.from('isolated binary audio fixture');
const calls = [], transportErrors = [], pageErrors = [];
let held, app, page, sequence = 0;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(new URL(request.url, 'http://fixture').searchParams.get('url'));
    assert.equal(url.hostname, 'api.stepfun.com');
    assert.equal(request.headers.authorization, `Bearer ${key}`);
    response.setHeader('content-type', 'application/json');
    if (url.pathname.endsWith('/models')) response.end(JSON.stringify({ data: [{ id: 'step-5-preview', name: 'Fixture' }] }));
    else if (url.pathname.includes('/models/'))
      response.end(JSON.stringify({ id: 'step-5-preview', enable_reason: false, reasoning_effort_support_list: ['off'] }));
    else if (url.pathname.endsWith('/accounts')) response.end(JSON.stringify({ object: 'account', type: 'prepaid', balance: 12 }));
    else {
      assert.equal(url.pathname, '/v1/audio/speech');
      let raw = '';
      for await (const chunk of request) { raw += chunk; assert.ok(raw.length < 16384); }
      const body = JSON.parse(raw);
      assert.equal(body.model, 'stepaudio-2.5-tts');
      assert.equal(body.voice, 'cixingnansheng');
      assert.equal(body.stream, false);
      assert.equal(body.return_url, false);
      assert.ok(['mp3', 'wav', 'pcm'].includes(body.response_format));
      assert.ok(['approved', 'approved-again', 'cancel-inflight'].includes(body.input));
      calls.push({ model: body.model, format: body.response_format, text: body.input });
      if (body.input === 'cancel-inflight') held = response;
      else {
        response.setHeader('content-type', { mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/pcm' }[body.response_format]);
        response.end(bytes);
      }
    }
  } catch {
    transportErrors.push('Unexpected TTS fixture route, account or payload');
    if (!response.headersSent) response.writeHead(500);
    response.end('{}');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`, preload = join(profile, 'loopback.cjs');
await writeFile(preload, `
let transport = globalThis.fetch;
const routed = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === '127.0.0.1') return transport(input, init);
  if (url.hostname !== 'api.stepfun.com') throw new Error('External TTS fixture request blocked');
  return transport(${JSON.stringify(base)} + '/?url=' + encodeURIComponent(url.href), init);
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => routed,
  set: value => { if (value !== routed) transport = value; } });
`);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  DESKTOP_STEPPAGE_BUNDLE: join(profile, 'no-personal-steppage.mjs') };
for (const name of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|DESKTOP_DEV_URL|NODE_OPTIONS|STEP|PI_|AI_AGENT)/i.test(name)
  || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|COOKIE)$/i.test(name)) delete env[name];
const until = async (condition, label) => {
  const deadline = Date.now() + 20000;
  while (!await condition()) { assert.deepEqual(transportErrors, []); assert.ok(Date.now() < deadline, label); await delay(20); }
};
const data = join(root, 'desktop-plugins/data', receipt.instance);
const send = async command => {
  const current = ++sequence;
  await writeFile(join(data, 'command.json'), JSON.stringify({ ...command, sequence: current }));
  return current;
};
const result = async current => {
  let value;
  await until(async () => {
    try { value = JSON.parse(await readFile(join(data, `result-${current}.json`), 'utf8')); return true; }
    catch { return false; }
  }, 'Speech tool result did not arrive');
  return value;
};
const tool = (text, format = 'wav') => send({ name: 'synthesize_speech', arguments: { text, voice: 'cixingnansheng', format } });
const confirmation = () => page.getByRole('dialog', { name: '允许插件使用已选额度账户？', exact: true });
try {
  app = await electron.launch({ executablePath, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await app.evaluate(installRuntimeFixturePreload, { preload });
  await app.evaluate(({ BrowserWindow, net, dialog }, base) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1280, 900);
    dialog.showMessageBox = async () => ({ response: 1 });
    net.fetch = (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== 'api.stepfun.com') throw new Error('External main TTS fixture request blocked');
      return fetch(base + '/?url=' + encodeURIComponent(url.href), init);
    };
  }, base);
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  await page.evaluate(base => window.desktop.saveProvider({ id: '', name: 'Disabled fixture',
    baseUrl: `${base}/v1`, api: 'openai-completions', enabled: false, keyless: true,
    models: [{ id: 'unused', name: 'Unused', reasoning: false, vision: false, contextWindow: 32768, maxTokens: 1024 }],
  }), base);
  await page.evaluate(key => window.desktop.login('platform_cn', key), key);
  const ref = await page.evaluate(async () => (await window.desktop.capabilityCatalog()).plugins
    .find(plugin => plugin.id === 'dfsc-host-example').package.ref);
  const settings = () => page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), ref);
  const initial = await settings();
  await page.evaluate(input => window.desktop.pluginSaveHostSettings(input), {
    ref, revision: initial.revision, mode: 'account', accountTicket: initial.account.ticket,
    models: { 'model.tts': 'stepaudio-2.5-tts' },
  });
  await page.evaluate(() => window.desktop.newIndependentSession());
  await page.reload();
  await until(async () => (await settings()).runtime.status === 'connected', 'Native speech consumer did not connect');
  const selected = (await settings()).runtime.capabilities[0];
  assert.equal(selected.id, 'model.tts');
  assert.equal(selected.model, 'stepaudio-2.5-tts');
  assert.equal(selected.authorization, 'required');
  assert.equal(calls.length, 0);

  let pending = await tool('denied');
  await confirmation().waitFor();
  assert.match(await confirmation().innerText(), /model.tts.*stepaudio-2.5-tts/s);
  assert.equal(calls.length, 0);
  await confirmation().getByRole('button', { name: '取消', exact: true }).click();
  assert.match(JSON.stringify(await result(pending)), /dfsc-host:DENIED/);
  assert.equal(calls.length, 0);
  await unlink(join(data, 'command.json'));
  await page.evaluate(() => window.desktop.restart());
  await page.reload();
  await until(async () => (await settings()).runtime.status === 'connected', 'Speech restart did not reconnect');

  pending = await tool('approved');
  await confirmation().waitFor();
  assert.equal(calls.length, 0);
  await page.screenshot({ path: join(output, 'tts-confirmation.png') });
  await confirmation().getByRole('button', { name: '确认', exact: true }).click();
  const first = await result(pending);
  assert.notEqual(first.isError, true);
  assert.deepEqual(first.content, [{ type: 'audio', mimeType: 'audio/wav', data: bytes.toString('base64') }]);
  for (const format of ['mp3', 'pcm']) {
    const next = await result(await tool('approved-again', format));
    assert.notEqual(next.isError, true);
    assert.equal(next.content[0].mimeType, format === 'mp3' ? 'audio/mpeg' : 'audio/pcm');
    assert.equal(next.content[0].data, bytes.toString('base64'));
  }
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).requests.length, 0);
  assert.equal((await settings()).runtime.capabilities[0].authorization, 'approved');
  pending = await tool('cancel-inflight');
  await until(() => Boolean(held), 'No in-flight synthesis');
  assert.equal((await result(await send({ cancelSequence: pending }))).cancelled, true);
  await until(() => held.destroyed, 'Cancelled TTS provider remained connected');
  assert.equal(calls.length, 4);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(transportErrors, []);
  const observed = await settings();
  assert.doesNotMatch(JSON.stringify([initial, observed, await page.locator('body').innerText()]),
    /isolated-tts-account|dfsc-launch-v1|DFSC_LAUNCH_CONTEXT|"broker"|"token"/);
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ executablePath, passed: true,
    capabilities: observed.runtime.capabilities, providerCalls: calls, realAccount: false, paidRequests: false,
    audio: 'Synthetic binary fixture only; no codec, voice or sound-quality acceptance.', pageErrors, transportErrors }, null, 2) + '\n');
  console.log('Packaged TTS passed: real native SDK consumer, production TTS consent/denial, MP3/WAV/PCM byte return, grant reuse and in-flight cancellation. Only isolated loopback provider requests.');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}
