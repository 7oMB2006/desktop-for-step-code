// Run from Desktop after build + stage:runtime, as a non-root Linux user:
//   xvfb-run -a node scripts/verify-linux.mjs
// DESKTOP_VERIFY_EXE may select the unpacked Linux executable instead.
// DESKTOP_VERIFY_HEADLESS=1 selects Chromium's Ozone headless display backend.
// DESKTOP_VERIFY_RUNTIME_ONLY=1 explicitly tests RPC only, never reports UI PASS.
// This is deterministic local-provider acceptance, not real-model qualification.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { runtimeProcessKind } from './linux-runtime-processes.mjs';

const runtimeOnly = process.env.DESKTOP_VERIFY_RUNTIME_ONLY === '1';
const headless = process.env.DESKTOP_VERIFY_HEADLESS === '1';
assert.equal(process.platform, 'linux', 'Linux acceptance must run natively on Linux');
assert.equal(process.arch, 'x64', 'This acceptance targets the Linux x64 preview');
if (!runtimeOnly) {
  assert.notEqual(process.geteuid?.(), 0,
    'Run as a non-root user: Playwright disables Chromium sandboxing when launched as root');
  assert.ok(headless || process.env.DISPLAY || process.env.WAYLAND_DISPLAY,
    'A Linux display is required. Use xvfb-run -a or explicitly select DESKTOP_VERIFY_HEADLESS=1');
}

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.DESKTOP_VERIFY_EXE ? resolve(process.env.DESKTOP_VERIFY_EXE) : undefined;
const resources = executablePath ? join(dirname(executablePath), 'resources') : desktop;
const runtimeRoot = join(resources, 'runtime');
const runtimeNode = join(runtimeRoot, 'node', 'node');
const runtimeEntry = join(runtimeRoot, 'step', 'dist', 'bundle', 'step.js');
const terminalHost = join(resources, 'terminal-runtime', 'host.cjs');
const manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'));
assert.equal(manifest.platform, 'linux', 'Stage the runtime on Linux before acceptance');
assert.equal(manifest.arch, 'x64');
assert.equal(manifest.nodeExecutable, 'node');
await Promise.all([access(runtimeNode, constants.X_OK), access(runtimeEntry), ...(runtimeOnly ? [] : [access(terminalHost)])]);
assert.equal(createHash('sha256').update(await readFile(runtimeNode)).digest('hex'), manifest.nodeSha256,
  'The staged Node executable must match its manifest');

const fixture = await realpath(await mkdtemp(join(tmpdir(), 'step-linux-acceptance-')));
const profile = join(fixture, 'profile');
const home = join(fixture, 'home');
const project = join(fixture, 'Linux 项目 with spaces');
const storage = join(profile, 'step-runtime');
const results = join(desktop, 'test-results');
const provider = 'linux-local-fixture';
const model = 'linux-fixture-model';
const fakeKey = 'local-fixture-not-a-real-credential';
const fileMarker = 'LINUX_REAL_RUNTIME_READ_OK';
const prompt = 'Linux acceptance: read fixture.txt and confirm the local runtime works.';
const reply = 'Linux runtime acceptance passed. The fixture file was read successfully.';
const followup = 'Linux acceptance: confirm this conversation survived the application restart.';
const followupReply = 'Linux conversation history survived restart.';
const requests = [];
const serverErrors = [];
const rendererErrors = [];
const runtimeEvents = [];
let app;
let page;
let rpc;
let passed = false;
let cleanQuits = 0;

const textOf = message => typeof message?.content === 'string' ? message.content
  : message?.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? '';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const phase = message => console.log(`[linux-acceptance] ${message}`);
async function waitFor(predicate, description, timeout = 60000) {
  const deadline = Date.now() + timeout;
  do {
    assert.deepEqual(serverErrors, [], 'Local model fixture rejected a request');
    const result = await predicate();
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}
const inside = (root, path) => {
  const pathFromRoot = relative(root, path);
  return pathFromRoot !== '' && !isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`);
};
async function processInfo(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // comm can contain spaces and parentheses. Fields after the final ')' start at state.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, state: fields[0], start: fields[19] };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return undefined; throw error; }
}
async function stillRunning(process) {
  const current = await processInfo(process.pid);
  return current?.start === process.start && current.state !== 'Z';
}
async function descendants(pid) {
  // Some kernels omit task/<tid>/children. Parent IDs in proc stat also cover
  // processes created by non-main threads, without depending on that file.
  const snapshot = (await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(async name => {
    try {
      const stat = await readFile(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      return { pid: Number(name), parent: Number(fields[1]) };
    } catch (error) {
      if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) return undefined;
      throw error;
    }
  }))).filter(Boolean);
  const found = new Set();
  const visit = parent => {
    for (const child of snapshot) if (child.parent === parent && !found.has(child.pid)) {
      found.add(child.pid); visit(child.pid);
    }
  };
  visit(pid);
  return [...found];
}

async function runtimeProcesses() {
  const found = [];
  const expected = { node: await realpath(runtimeNode), entry: runtimeEntry,
    admin: join(runtimeRoot, 'admin.mjs'), terminal: terminalHost };
  for (const pid of await descendants(app.process().pid)) {
    try {
      const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
      const kind = runtimeProcessKind(args, await realpath(`/proc/${pid}/exe`), expected);
      if (kind) {
        const info = await processInfo(pid);
        if (info) found.push({ ...info, kind });
      }
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
  }
  return found;
}

const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${fakeKey}`);
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      assert.ok(raw.length <= 4 * 1024 * 1024, 'Fixture request exceeds its bound');
    }
    const body = JSON.parse(raw);
    assert.equal(body.model, model);
    assert.equal(body.stream, true);
    assert.ok(Array.isArray(body.messages));
    const userIndex = body.messages.findLastIndex(message => message.role === 'user');
    const latestPrompt = textOf(body.messages[userIndex]);
    assert.ok([prompt, followup].includes(latestPrompt), 'Only the two explicit fixture turns may contact the provider');
    requests.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
      id: `linux-fixture-${requests.length}`, object: 'chat.completion.chunk', created: 1, model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (latestPrompt === followup) {
      assert.ok(body.messages.some(message => message.role === 'user' && textOf(message) === prompt));
      assert.ok(body.messages.some(message => message.role === 'assistant' && textOf(message) === reply),
        'The restarted real runtime must send the persisted assistant history');
      send({ content: followupReply });
    } else {
      const toolResults = body.messages.slice(userIndex + 1).filter(message => message.role === 'tool');
      if (!toolResults.length) {
        const readTool = body.tools?.find(tool => ['read_file', 'read'].includes(tool.function?.name));
        assert.ok(readTool, 'Real runtime read tool schema is present');
        send({ tool_calls: [{ index: 0, id: 'linux-read-fixture', type: 'function', function: {
          name: readTool.function.name, arguments: JSON.stringify({ path: 'fixture.txt' }),
        } }] });
        send({}, 'tool_calls');
        response.end('data: [DONE]\n\n');
        return;
      }
      assert.equal(toolResults.length, 1);
      assert.equal(toolResults[0].tool_call_id, 'linux-read-fixture');
      assert.ok(textOf(toolResults[0]).includes(fileMarker), 'Actual runtime tool must read the isolated Linux project');
      send({ content: reply });
    }
    send({}, 'stop');
    response.end('data: [DONE]\n\n');
  } catch (error) {
    serverErrors.push(error.message);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});

// Allow only desktop-session prerequisites. Never copy model credentials, proxy
// configuration, NODE_OPTIONS, runtime overrides, or the user's personal HOME.
const env = Object.fromEntries(['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'].flatMap(key =>
  process.env[key] === undefined ? [] : [[key, process.env[key]]]));
Object.assign(env, {
  HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
  XDG_DATA_HOME: join(home, '.local', 'share'), SHELL: '/bin/sh',
  DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  DESKTOP_ACCEPTANCE_SECRET: 'fixture-secret-must-not-reach-shell',
  GITHUB_TOKEN: 'fixture-token-must-not-reach-shell',
});

const snapshot = () => page.evaluate(() => window.desktop.snapshot());
async function launch() {
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [desktop]), ...(headless ? ['--ozone-platform=headless'] : [])],
    cwd: desktop, env, timeout: 60000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => rendererErrors.push(error.message));
  await page.waitForFunction(() => typeof window.desktop?.snapshot === 'function');
  await page.exposeFunction('recordLinuxRuntimeEvent', event => {
    if (['desktop_error', 'desktop_exit'].includes(event.type)) runtimeEvents.push(event.type);
  });
  await page.evaluate(() => window.desktop.onEvent(event => window.recordLinuxRuntimeEvent({ type: event.type })));
  const security = await app.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    // Opacity is unsupported on Linux; leave the window hidden and non-focusing.
    window.setSize(1320, 880);
    const preferences = window.webContents.getLastWebPreferences();
    return {
      platform: process.platform, userData: app.getPath('userData'), rendererPid: window.webContents.getOSProcessId(),
      sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration,
      contextIsolation: preferences.contextIsolation, webSecurity: preferences.webSecurity,
      unsafeSwitches: ['no-sandbox', 'disable-setuid-sandbox', 'disable-seccomp-filter-sandbox', 'disable-web-security']
        .filter(flag => app.commandLine.hasSwitch(flag)),
    };
  });
  assert.equal(security.platform, 'linux');
  assert.equal(security.userData, profile);
  assert.equal(security.sandbox, true);
  assert.equal(security.nodeIntegration, false);
  assert.equal(security.contextIsolation, true);
  assert.notEqual(security.webSecurity, false);
  assert.deepEqual(security.unsafeSwitches, []);
  const rendererStatus = await readFile(`/proc/${security.rendererPid}/status`, 'utf8');
  assert.match(rendererStatus, /^NoNewPrivs:\s+1$/m, 'Renderer must use Linux no-new-privileges');
  assert.match(rendererStatus, /^Seccomp:\s+2$/m, 'Renderer must have a seccomp filter');
  assert.deepEqual(await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process,
    Buffer: typeof window.Buffer, ipcRenderer: typeof window.ipcRenderer })),
  { require: 'undefined', process: 'undefined', Buffer: 'undefined', ipcRenderer: 'undefined' });
  await waitFor(async () => {
    const state = await snapshot();
    return ['ready', 'connected'].includes(state.status) && state.models.some(item => item.id === model) && state;
  }, 'local model and composer startup');
  await page.waitForFunction(() => {
    const input = document.querySelector('.composer > textarea');
    return input && !input.disabled;
  });
}

async function submit(message, expected) {
  await page.locator('.composer > textarea').fill(message);
  await page.locator('.composer > textarea').press('Enter');
  const state = await waitFor(async () => {
    const current = await snapshot();
    return current.status === 'connected' && !current.state?.isStreaming
      && current.messages.some(item => item.role === 'assistant' && textOf(item) === expected && item.stopReason === 'stop') && current;
  }, 'real runtime response');
  await page.getByText(expected, { exact: true }).waitFor();
  return state;
}

async function quit(action = 'quit', extraProcesses = []) {
  const owned = [...await runtimeProcesses(), ...extraProcesses];
  const child = app.process();
  const closed = app.waitForEvent('close', { timeout: 30000 });
  const send = page.evaluate(action => window.desktop.windowControl(action), action).catch(error => {
    if (!/closed|destroyed/i.test(error.message)) throw error;
  });
  await Promise.all([send, closed]);
  app = undefined;
  assert.equal(child.exitCode, 0, 'Electron must quit normally');
  assert.equal(child.signalCode, null, 'Clean quit must not require a kill signal');
  await waitFor(async () => (await Promise.all(owned.map(stillRunning))).every(alive => !alive),
    'runtime and terminal processes shut down with Electron', 10000);
  cleanQuits++;
}

function launchRpc() {
  const child = spawn(runtimeNode, [runtimeEntry, '--mode', 'rpc'], { cwd: project, stdio: 'pipe', env: {
    ...env, STEPCODE_ENTRYPOINT: '1', STEPCODE_STORAGE_ROOT_DIR: storage,
    STEP_CODING_AGENT_DIR: join(storage, 'agent'), STEP_CODING_AGENT_SESSION_DIR: join(storage, 'sessions'),
    STEPCODE_AUTH_PATH: join(storage, 'auth.json'), STEPCODE_LEGACY_AUTH_PATH: join(storage, 'legacy-auth.json'),
    STEPCODE_DESKTOP_AUTH_PATH: join(storage, 'auth.json'), STEPCODE_DESKTOP_AUTH_DATA: '{}',
    STEPCODE_DISABLE_PI_SERVICES: '1', STEP_CLIENT: 'desktop-for-step-code',
  } });
  let sequence = 0;
  let failure;
  const pending = new Map();
  const fail = error => {
    failure = error;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.stderr.resume(); // No raw runtime environment or diagnostics enter test output.
  const exited = new Promise(resolve => child.once('exit', (code, signal) => {
    fail(new Error(`RPC process exited (${code ?? signal})`)); resolve({ code, signal });
  }));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      assert.ok(line.length < 32 * 1024 * 1024, 'RPC record exceeds bound');
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (message.type !== 'response' || !request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.success) request.resolve(message.data);
      else request.reject(new Error(message.error ?? 'RPC command failed'));
    } catch (error) { fail(error); }
  });
  return {
    pid: child.pid,
    request(type, args = {}) {
      if (failure) return Promise.reject(failure);
      const id = `linux-${++sequence}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timed out: ${type}`)); }, 60000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ type, id, ...args })}\n`);
      });
    },
    async stop() {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
      child.stdin.end();
      try {
        const { code, signal } = await exited;
        assert.equal(code, 0, 'RPC must shut down normally when its input closes');
        assert.equal(signal, null);
      } finally { clearTimeout(timeout); lines.close(); }
    },
  };
}

async function runRuntimeOnly() {
  phase('Explicit RPC-only mode: Electron UI, Chromium sandbox and PTY are NOT tested');
  rpc = launchRpc();
  await rpc.request('get_state');
  await rpc.request('new_session');
  const initial = await rpc.request('get_state');
  assert.equal(initial.model.provider, provider);
  assert.equal(initial.model.id, model);
  assert.equal(await realpath(`/proc/${rpc.pid}/exe`), await realpath(runtimeNode));
  const submitRpc = async (message, expected) => {
    await rpc.request('prompt', { message });
    return waitFor(async () => {
      const state = await rpc.request('get_state');
      const { messages } = await rpc.request('get_messages');
      return !state.isStreaming && messages.some(item => item.role === 'assistant' && textOf(item) === expected && item.stopReason === 'stop')
        && { state, messages };
    }, 'real RPC model response');
  };
  const complete = await submitRpc(prompt, reply);
  assert.equal(requests.length, 2);
  assert.ok(complete.messages.some(item => item.role === 'toolResult' && item.toolCallId === 'linux-read-fixture'
    && !item.isError && textOf(item).includes(fileMarker)));
  const { sessionId, sessionFile } = complete.state;
  assert.ok(sessionId && sessionFile && inside(join(storage, 'sessions'), sessionFile));
  await rpc.stop(); rpc = undefined;
  const saved = (await readFile(sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(saved.some(entry => entry.message?.role === 'assistant' && textOf(entry.message) === reply));
  rpc = launchRpc();
  await rpc.request('get_state');
  await rpc.request('switch_session', { sessionPath: sessionFile });
  const restored = await rpc.request('get_state');
  assert.equal(restored.sessionId, sessionId);
  assert.equal(restored.sessionFile, sessionFile);
  assert.equal(requests.length, 2, 'Restart does not submit a new model turn');
  const resumed = await submitRpc(followup, followupReply);
  assert.equal(resumed.state.sessionId, sessionId);
  assert.equal(requests.length, 3);
  await rpc.stop(); rpc = undefined;
  assert.deepEqual(serverErrors, []);
  console.log(JSON.stringify({ result: 'PASS_RUNTIME_ONLY', platform: 'linux-x64', localProviderOnly: true,
    realRuntime: true, restartPersistence: true, cleanRuntimeExits: 2, providerRequests: requests.length,
    electronUi: 'not-tested', sandbox: 'not-tested', terminal: 'not-tested' }));
}

try {
  await Promise.all([mkdir(storage, { recursive: true }), mkdir(home), mkdir(project), mkdir(results, { recursive: true })]);
  await writeFile(join(project, 'fixture.txt'), `${fileMarker}\n`);
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'en', theme: 'dark',
    workspace: project, workspaces: [project], autoCheckUpdates: false }));
  await writeFile(join(storage, 'config.toml'), `defaultProvider = "${provider}"\ndefaultModel = "${model}"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n`);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await writeFile(join(storage, 'models.json'), JSON.stringify({ providers: { [provider]: {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: fakeKey,
    models: [{ id: model, name: 'Linux local fixture', contextWindow: 32768, maxTokens: 2048 }],
  } } }));

  if (runtimeOnly) {
    await runRuntimeOnly();
    passed = true;
  } else {
    await launch();
    phase('Sandboxed Electron and isolated local provider ready');
    const initial = await snapshot();
    assert.equal(initial.sessions.length, 0, 'Disposable profile starts without personal history');
    assert.equal(initial.preferences.workspace, project);
    const complete = await submit(prompt, reply);
    assert.equal(requests.length, 2, 'One real read tool call and one completed response');
    assert.equal(complete.state.model.provider, provider);
    assert.equal(complete.state.model.id, model);
    const tool = complete.messages.find(message => message.role === 'toolResult' && message.toolCallId === 'linux-read-fixture');
    assert.ok(tool && !tool.isError && textOf(tool).includes(fileMarker));
    const sessionId = complete.state.sessionId;
    const sessionFile = complete.state.sessionFile;
    assert.ok(sessionId && sessionFile && inside(join(storage, 'sessions'), sessionFile), 'Session is owned by isolated userData');
    const owned = await runtimeProcesses();
    assert.ok(owned.some(process => process.kind === 'runtime'), 'The actual staged Step Code runtime is running');
    assert.ok(owned.some(process => process.kind === 'admin'), 'The actual admin helper is running');
    for (const process of owned) assert.equal(await realpath(`/proc/${process.pid}/exe`), await realpath(runtimeNode));
    await page.screenshot({ path: join(results, 'linux-session.png') });
    phase('Real staged runtime completed local read tool and persisted the reply');

    const runtimeId = complete.runtimeId;
    const terminals = () => page.evaluate(id => window.desktop.terminalList(id), runtimeId);
    const terminalOutput = async id => (await terminals()).find(terminal => terminal.id === id)?.chunks.map(chunk => chunk.data).join('') ?? '';
    const write = (id, data) => page.evaluate(({ id, data }) => window.desktop.terminalWrite(id, data), { id, data });
    await page.locator('.right-tool-rail').getByRole('button', { name: 'Terminal', exact: true }).click();
    const first = await waitFor(async () => (await terminals()).find(terminal => terminal.status === 'running'), 'real POSIX terminal startup', 30000);
    assert.equal(first.cwd, project);
    await write(first.id, `printf '\\n%s%s:%s\\n' 'LINUX_' 'SHELL_PID' "$$"; printf '%s%s\\n' 'LINUX_' 'PTY_OK'; pwd -P\r`);
    const output = await waitFor(async () => {
      const value = await terminalOutput(first.id);
      return /LINUX_SHELL_PID:\d+/.test(value) && value.includes('LINUX_PTY_OK') && value.includes(project) && value;
    }, 'POSIX shell output', 15000);
    const shellPid = Number(output.match(/LINUX_SHELL_PID:(\d+)/)[1]);
    const shell = await processInfo(shellPid);
    assert.ok(shell && await stillRunning(shell));
    assert.equal(await realpath(`/proc/${shellPid}/cwd`), project);
    const posixShells = (await Promise.all(['/bin/bash', '/bin/sh'].map(path => realpath(path).catch(() => undefined)))).filter(Boolean);
    assert.ok(posixShells.includes(await realpath(`/proc/${shellPid}/exe`)), 'Terminal runs a real supported POSIX shell');
    await write(first.id, `if [ -z "\${DESKTOP_ACCEPTANCE_SECRET+x}\${GITHUB_TOKEN+x}" ]; then printf '%s%s\\n' 'LINUX_' 'ENV_CLEAN'; else printf '%s%s\\n' 'LINUX_' 'ENV_LEAK'; fi\r`);
    await waitFor(async () => (await terminalOutput(first.id)).includes('LINUX_ENV_CLEAN'), 'terminal environment isolation', 15000);
    assert.ok(!(await terminalOutput(first.id)).includes('LINUX_ENV_LEAK'));
    await page.evaluate(id => window.desktop.terminalResize(id, 101, 33), first.id);
    assert.deepEqual((await terminals()).filter(terminal => terminal.id === first.id).map(({ cols, rows }) => ({ cols, rows })), [{ cols: 101, rows: 33 }]);
    await assert.rejects(page.evaluate(() => window.desktop.terminalWrite('missing-linux-terminal', 'x')), /Unknown terminal/);
    await assert.rejects(page.evaluate(id => window.desktop.terminalResize(id, 10000, 0), first.id), /dimensions/);
    await write(first.id, 'exit 7\r');
    await waitFor(async () => (await terminals()).find(terminal => terminal.id === first.id)?.status === 'exited', 'shell normal exit', 15000);
    assert.equal((await terminals()).find(terminal => terminal.id === first.id).exitCode, 7);
    await page.evaluate(id => window.desktop.terminalClose(id), first.id);
    assert.equal((await terminals()).length, 0);
    await waitFor(async () => !await stillRunning(shell), 'exited shell is gone', 5000);

    // Explicit close must end a running shell, and application quit must also end
    // a second shell that the user never explicitly closed.
    const makeRunningShell = async () => {
      const terminal = await page.evaluate(id => window.desktop.terminalCreate(id), runtimeId);
      await write(terminal.id, `printf '\\n%s%s:%s\\n' 'LINUX_' 'SHELL_PID' "$$"\r`);
      const output = await waitFor(async () => {
        const value = await terminalOutput(terminal.id);
        return /LINUX_SHELL_PID:\d+/.test(value) && value;
      }, 'second POSIX shell PID', 15000);
      const process = await processInfo(Number(output.match(/LINUX_SHELL_PID:(\d+)/)[1]));
      assert.ok(process);
      return { terminal, process };
    };
    const explicit = await makeRunningShell();
    await page.evaluate(id => window.desktop.terminalClose(id), explicit.terminal.id);
    await waitFor(async () => !await stillRunning(explicit.process), 'explicit close terminates POSIX shell', 10000);
    assert.equal((await terminals()).length, 0);
    const onQuit = await makeRunningShell();
    await page.screenshot({ path: join(results, 'linux-terminal.png') });
    await quit('quit', [onQuit.process]);
    phase('POSIX terminal output, isolation, resize, exit, close and application quit passed');

    const persisted = (await readFile(sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(persisted.some(entry => entry.message?.role === 'user' && textOf(entry.message) === prompt));
    assert.ok(persisted.some(entry => entry.message?.role === 'assistant' && textOf(entry.message) === reply));
    await launch();
    const restored = await snapshot();
    assert.equal(restored.sessions.length, 1);
    assert.equal(restored.sessions[0].id, sessionId);
    assert.equal(restored.sessions[0].cwd, project);
    assert.equal(requests.length, 2, 'Restart alone must not run a model turn');
    await page.locator('.session-row > button:first-child').filter({ hasText: prompt }).click();
    const history = await waitFor(async () => {
      const state = await snapshot();
      return state.state?.sessionId === sessionId && state.messages.some(message => message.role === 'assistant' && textOf(message) === reply) && state;
    }, 'restored conversation history');
    assert.equal(history.state.sessionFile, sessionFile);
    assert.equal((await page.evaluate(id => window.desktop.terminalList(id), history.runtimeId)).length, 0,
      'Exited terminal processes are not resurrected during restart');
    const resumed = await submit(followup, followupReply);
    assert.equal(resumed.state.sessionId, sessionId);
    assert.equal(requests.length, 3);
    assert.equal(resumed.sessions.length, 1, 'Resume must not create a second conversation');
    await page.screenshot({ path: join(results, 'linux-session-restored.png') });
    // Linux window Close must quit, including environments without a system tray.
    await quit('close');
    assert.deepEqual(serverErrors, []);
    assert.deepEqual(rendererErrors, []);
    assert.deepEqual(runtimeEvents, [], 'No unexpected runtime failure events');
    assert.equal(cleanQuits, 2);
    passed = true;
    console.log(JSON.stringify({ result: 'PASS', platform: 'linux-x64', localProviderOnly: true,
      realRuntime: true, sandbox: true, realPosixTerminal: true, restartPersistence: true,
      cleanQuits, providerRequests: requests.length, screenshots: 'test-results/linux-*.png' }));
  }
} catch (error) {
  console.error(`[linux-acceptance] Failed. Isolated diagnostic profile retained at ${fixture}`);
  if (page && !page.isClosed()) await page.screenshot({ path: join(results, 'linux-failure.png'), timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  if (rpc) await rpc.stop().catch(() => {});
  if (app) {
    const child = app.process();
    const timeout = setTimeout(() => {
      console.error('[linux-acceptance] Cleanup exceeded 15 seconds; terminating only the fixture Electron process');
      child.kill('SIGKILL');
    }, 15000);
    try { await app.close(); } catch {} finally { clearTimeout(timeout); }
  }
  if (passed && process.env.DESKTOP_VERIFY_KEEP_PROFILE !== '1') await rm(fixture, { recursive: true, force: true });
  else if (passed) phase(`Isolated profile retained at ${fixture}`);
}
