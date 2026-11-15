import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { finalizeCapabilityDiagnostics } from './capability-diagnostics-finalize.mjs';
import { pollCapabilityDiagnostic as poll, readJsonDuringRefresh } from './capability-diagnostics-fixture.mjs';

const desktop = resolve('.');
const require = createRequire(join(desktop, 'package.json'));
const { _electron: electron } = require('playwright');
const output = resolve(process.env.DESKTOP_DIAGNOSTICS_OUTPUT ?? 'test-results/capability-diagnostics');
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const profile = await mkdtemp(join(tmpdir(), 'dfsc-capability-diagnostics-'));
const root = join(profile, 'step-runtime');
await mkdir(root);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'results.json'), `${JSON.stringify({ passed: false, cleanupConfirmed: false, phase: 'running' })}\n`);
const marketSource = join(profile, 'theme-marketplace');
await cp(resolve('../theme-marketplace'), marketSource, { recursive: true, dereference: true });
// The shipped theme has no README; document-read acceptance needs an explicit fixture.
const guideHeading = 'Offline diagnostics theme guide';
await writeFile(join(marketSource, 'plugins/stellar-cruise/README.md'),
  `# ${guideHeading}\n\nFixture documentation for Remote-bound theme management.\n`);
// Preserve fixture bytes independently of the machine's Git line-ending policy.
await writeFile(join(marketSource, '.gitattributes'), '* -text\n');
const git = (...args) => execFileSync('git', args, { cwd: marketSource, encoding: 'utf8', stdio: 'pipe' });
git('init', '--quiet');
git('add', '--', '.');
const commitMarket = () => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
  '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-am', 'Offline market revision');
commitMarket();
const executableId = 'diagnostic-executable';
const executableSource = join(marketSource, 'plugins', executableId);
const executableRoot = join(root, 'plugins', executableId);
const executableCommand = 'commands/diagnostic-never-invoke.md';
await mkdir(join(executableSource, 'commands'), { recursive: true });
await writeFile(join(executableSource, 'step.plugin.json'), JSON.stringify({
  id: executableId, name: 'Offline executable fixture', version: '1.0.0',
  skills: [], agents: [], commands: ['commands'], mcpServers: {},
}));
await writeFile(join(executableSource, executableCommand),
  '---\ndescription: Offline diagnostics only; never invoke.\n---\nNo executable action is authorized.\n');
const executableMarketPath = join(marketSource, '.step-plugin/marketplace.json');
const executableMarket = JSON.parse(await readFile(executableMarketPath, 'utf8'));
executableMarket.plugins.push({ name: executableId, source: `./plugins/${executableId}`,
  description: 'Offline command-only executable fixture' });
await writeFile(executableMarketPath, JSON.stringify(executableMarket));
git('add', '--', '.step-plugin/marketplace.json', `plugins/${executableId}`);
commitMarket();
const mcpHelper = join(profile, 'mcp-fixture.mjs');
await writeFile(mcpHelper, `
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const result = request.method === 'initialize' ? {
    protocolVersion: request.params.protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: 'offline-diagnostics', version: '1.0.0' },
  } : request.method === 'tools/list' ? { tools: [] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`);
const remoteHelper = join(profile, 'remote-fixture.mjs');
await writeFile(remoteHelper, `
import { createInterface } from 'node:readline';
let bindingId;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const event = (kind, fields = {}) => send({ type: 'remote_channel', kind, bindingId, ...fields });
createInterface({ input: process.stdin }).on('line', line => {
  const value = JSON.parse(line);
  if (value.type === 'connect') event('connected', { botName: 'Offline diagnostics' });
  if (value.type === 'arm') event('candidate', { armId: value.armId, candidateId: 'fixture-candidate' });
  if (value.type === 'bind') {
    bindingId = value.bindingId;
    send({ type: 'fixture_binding', bindingId });
  }
  if (value.type === 'fixture-input') {
    event('input', { id: value.messageId ?? 'offline-remote-input', text: value.text ?? 'Offline guard check.' }); return;
  }
  if (value.type === 'card') send({ type: 'fixture_card',
    bindingId: value.bindingId, key: value.key, title: value.title, text: value.text });
  const data = value.type === 'snapshot' ? {
    identity: { botId: 'fixture-bot', credentials: { appId: 'fixture-app', appSecret: 'fixture-only', brand: 'feishu' } },
    peer: bindingId ? { actor: 'fixture-human', chat: 'fixture-chat' } : undefined,
  } : undefined;
  send({ type: 'response', id: value.id, success: true, data });
});
`);
const streams = new Set();
let modelRequests = 0;
const chunk = delta => `data: ${JSON.stringify({
  id: 'offline-guard-check', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason: null }],
})}\n\n`;
const server = createServer(async (req, res) => {
  for await (const _part of req) {}
  modelRequests++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(chunk({ role: 'assistant', content: 'Offline guard check is running.' }));
  streams.add(res);
  res.on('close', () => streams.delete(res));
});
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
for (const name of ['DESKTOP_DEV_URL', 'ELECTRON_RUN_AS_NODE', 'STEP_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR'])
  delete env[name];
let app, page, mainWindow, holder, operationError, result, remoteIdentity;
const errors = [], checks = [], diagnostics = [];
const ownedPids = new Set();
const blockedRemoteText = 'Remote input during capability management must not run.';
const catalog = () => page.evaluate(() => window.desktop.capabilityCatalog());
const mutate = input => page.evaluate(input => window.desktop.capabilityMutate(input), input);
const executableReceipt = async () => JSON.parse(await readFile(
  join(root, 'desktop-plugins/installations.json'), 'utf8')).installations.find(item => item.id === executableId);
const confirm = () => page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
// Backend completion can precede perform's catalog refresh, selection change, and pending reset.
const waitForUiReady = (control, description) => poll(async () =>
  await control.isVisible() && await control.isEnabled()
    && (await page.locator('.plugin-center .cap-pending').count()) === 0,
  ready => ready, description);
const readDiagnostic = async (expectedCode, expectedPhase, refusal, gitExitCode) => {
  let text = refusal;
  if (!text) {
    const alert = page.getByRole('alert').filter({ hasText: '诊断编号' });
    await alert.waitFor({ timeout: 30000 });
    text = await alert.innerText();
  }
  const diagnosticId = /(?:诊断编号：|diagnostic:)([a-f0-9]{12})/u.exec(text)?.[1];
  assert.ok(diagnosticId, text);
  const logs = await Promise.all((await readdir(join(profile, 'logs'))).filter(name => name.endsWith('.log'))
    .map(name => readFile(join(profile, 'logs', name), 'utf8')));
  const record = logs.find(content => content.includes(`diagnosticId: ${diagnosticId}`));
  assert.ok(record, `Missing local diagnostic ${diagnosticId}`);
  assert.match(record, new RegExp(`code: ${expectedCode}`));
  assert.match(record, new RegExp(`operationPhase: ${expectedPhase}`));
  assert.doesNotMatch(record, /fixture-only|Offline guard check|apiKey|Bearer |private-missing-git-source/);
  if (gitExitCode !== undefined) {
    assert.match(record, /^operation: marketplace-refresh$/mu);
    assert.match(record, new RegExp(`^gitExitCode: ${gitExitCode}$`, 'mu'));
    assert.match(record, /^elapsedMs: \d+$/mu);
    assert.doesNotMatch(record, /stderr:|stdout:|fatal:|remoteUrl:|env:/);
  }
  diagnostics.push({ diagnosticId, text, phase: expectedPhase, ...(gitExitCode !== undefined ? {
    gitExitCode, elapsedMs: Number(/^elapsedMs: (\d+)$/mu.exec(record)[1]),
  } : {}) });
};
const expectBackendRefusal = async input => {
  let refusal;
  try { await mutate(input); }
  catch (error) { refusal = error.message; }
  assert.ok(refusal, 'The streaming Remote-bound runtime must refuse executable plugin removal');
  await readDiagnostic('session-busy', 'idle-check', refusal);
};
const releaseMutationHold = async () => {
  if (!app) return;
  await app.evaluate(() => {
    const hold = globalThis.diagnosticMutationHold;
    globalThis.diagnosticMutationHold = undefined;
    hold?.release?.();
  });
};
const remoteState = () => page.evaluate(() => window.desktop.remoteState());
const assertRemoteRetained = async runtimeId => {
  const state = await remoteState();
  const { summary, runtime } = await page.evaluate(async id => {
    const summary = await window.desktop.summary(id);
    const snapshot = await window.desktop.snapshot();
    return { summary, runtime: snapshot.runtimes?.find(runtime => runtime.runtimeId === id) };
  }, runtimeId);
  assert.ok(runtime, 'The Remote peer must remain resident');
  assert.equal(runtime.sessionId, summary.sessionId);
  assert.equal(state.status, 'connected');
  assert.equal(state.binding?.runtimeId, runtimeId);
  assert.equal(state.binding?.sessionId, summary.sessionId);
  assert.equal(state.sharing.some(session => session.runtimeId === runtimeId), true);
  const transport = await app.evaluate((_, { sessionId, capture }) => {
    const records = globalThis.diagnosticNatives.filter(record => record.sessionId === sessionId);
    const native = records.at(-1), remote = globalThis.diagnosticRemote;
    if (capture) globalThis.diagnosticExpectedChildren = { native: native?.child, remote };
    return {
      nativeGeneration: native?.generation, nativePid: native?.pid, supervisorPid: native?.supervisorPid,
      remotePid: remote?.pid, bindingIds: globalThis.diagnosticBindingIds,
      nativeAlive: Boolean(native && native.child.exitCode === null && native.child.signalCode === null),
      remoteAlive: Boolean(remote && remote.exitCode === null && remote.signalCode === null),
      sameNativeObject: native?.child === globalThis.diagnosticExpectedChildren?.native,
      sameRemoteObject: remote === globalThis.diagnosticExpectedChildren?.remote,
      permission: native?.permission,
    };
  }, { sessionId: summary.sessionId, capture: !remoteIdentity });
  assert.ok(summary.sessionId && transport.nativePid && transport.remotePid);
  ownedPids.add(transport.nativePid);
  if (transport.supervisorPid) ownedPids.add(transport.supervisorPid);
  ownedPids.add(transport.remotePid);
  assert.equal(transport.nativeAlive, true);
  assert.equal(transport.remoteAlive, true);
  assert.equal(transport.sameNativeObject, true);
  assert.equal(transport.sameRemoteObject, true);
  assert.equal(transport.bindingIds.length, 1, 'No silent Remote rebind');
  assert.ok(transport.bindingIds[0]);
  assert.match(transport.permission, /^Mode: (?:Ask|Approve for Me|Full Access)$/u);
  assert.equal(summary.status?.provider, 'fixture');
  assert.equal(summary.status?.model, 'fixture');
  const identity = {
    runtimeId, sessionId: summary.sessionId, model: { id: summary.status?.model, provider: summary.status?.provider },
    binding: { sessionId: state.binding.sessionId, runtimeId: state.binding.runtimeId, workspace: state.binding.workspace },
    sharing: state.sharing.map(session => ({
      runtimeId: session.runtimeId, sessionId: session.sessionId, workspace: session.workspace,
    })).sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    approvalReady: state.approvalReady, transport,
  };
  if (!remoteIdentity) remoteIdentity = identity;
  else assert.deepEqual(identity, remoteIdentity);
  await page.evaluate(id => window.desktop.command('get_commands', undefined, id), runtimeId);
  return runtime;
};
const assertBusyRemoteRetained = async runtimeId => {
  const runtime = await assertRemoteRetained(runtimeId);
  assert.equal(runtime.status, 'running', 'Allowed management operations must not abort the streaming peer');
  assert.ok(streams.size > 0, 'The loopback response must still be open');
};
const holdDirectory = async path => {
  holder = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n");process.stdin.resume()'],
    { cwd: path, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  await Promise.race([once(holder.stdout, 'data'), once(holder, 'error').then(([error]) => Promise.reject(error))]);
};
const releaseDirectory = async () => {
  if (!holder) return;
  const processToClose = holder;
  let timer, exited;
  try {
    await new Promise((resolve, reject) => {
      exited = (code, signal) => code === 0 && !signal ? resolve() : reject(new Error('Directory holder did not exit cleanly'));
      if (processToClose.exitCode !== null || processToClose.signalCode !== null) {
        exited(processToClose.exitCode, processToClose.signalCode);
        return;
      }
      processToClose.once('exit', exited);
      timer = setTimeout(() => reject(new Error('Directory holder shutdown timed out')), 5000);
      processToClose.stdin.end();
    });
    holder = undefined;
  } finally {
    clearTimeout(timer);
    if (exited) processToClose.off('exit', exited);
  }
};
const confirmOwnedProcessesExited = async () => {
  const deadline = Date.now() + 5000;
  while (ownedPids.size) {
    for (const pid of ownedPids) {
      try { process.kill(pid, 0); }
      catch (error) {
        if (error.code !== 'ESRCH') throw new Error('Unable to confirm owned fixture process exit');
        ownedPids.delete(pid);
      }
    }
    if (!ownedPids.size) return;
    if (Date.now() >= deadline) throw new Error('Owned fixture processes remain alive after cleanup');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({
    theme: 'original-dark', language: 'zh', workspaces: [],
  }));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-only',
    models: [{ id: 'fixture', name: 'Offline diagnostics', contextWindow: 32768, maxTokens: 1024 }],
  } } }));
  app = await electron.launch({ executablePath: executablePath ?? require('electron'),
    args: executablePath ? [] : [desktop], cwd: desktop, env, timeout: 60000 });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(executablePath));
  page = await app.firstWindow();
  mainWindow = await app.browserWindow(page);
  page.on('pageerror', error => errors.push(error.message));
  await mainWindow.evaluate(window => {
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 960);
  });
  await page.waitForURL('**/renderer/index.html');
  await page.waitForFunction(() => Boolean(window.desktop));
  // Install observers before creating the peer so replacements cannot hide behind a cached runtime ID.
  await app.evaluate(({ app }, path) => {
    const cp = process.getBuiltinModule('node:child_process'), original = cp.spawn;
    const { StringDecoder } = process.getBuiltinModule('node:string_decoder');
    const { join, resolve } = process.getBuiltinModule('node:path');
    const runtime = app.isPackaged ? join(process.resourcesPath, 'runtime') : resolve('runtime');
    const sessionEntry = join(runtime, 'step/dist/bundle/step.js');
    globalThis.diagnosticNatives = [];
    globalThis.diagnosticBindingIds = [];
    globalThis.diagnosticChildren = [];
    globalThis.diagnosticRemoteCards = [];
    globalThis.diagnosticPromptMessages = [];
    const remember = child => { globalThis.diagnosticChildren.push(child); return child; };
    const observe = (child, receive) => {
      const decoder = new StringDecoder('utf8');
      let pending = '';
      child.stdout.on('data', chunk => {
        const lines = (pending + decoder.write(chunk)).split('\n');
        pending = lines.pop();
        for (const line of lines) {
          let value;
          try { value = JSON.parse(line); } catch { continue; }
          receive(value);
        }
      });
    };
    cp.spawn = (command, args, options) => {
      const entry = args?.[0]?.replaceAll('\\', '/');
      let workerArgs = args, job;
      const jobIndex = args?.indexOf('-File'), specIndex = args?.indexOf('-Spec');
      if (jobIndex >= 0 && specIndex >= 0 && args[jobIndex + 1] === join(runtime, 'windows-runtime-job.ps1')) {
        try {
          const spec = JSON.parse(Buffer.from(args[specIndex + 1], 'base64').toString('utf8'));
          if (typeof spec.job === 'string' && spec.job) {
            workerArgs = spec.args;
            job = spec.job;
          }
        } catch {}
      }
      if (entry?.endsWith('/remote-channel.mjs')) {
        const child = globalThis.diagnosticRemote = remember(original(command, [path], options));
        observe(child, value => {
          if (value.type === 'fixture_binding') globalThis.diagnosticBindingIds.push(value.bindingId);
          if (value.type === 'fixture_card') globalThis.diagnosticRemoteCards.push(value);
        });
        return child;
      }
      const child = remember(original(command, args, options));
      if (entry?.endsWith('/capability-admin.mjs')) {
        // Hold the admitted write so main keeps its real runtime barrier until release.
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (chunk, ...args) => {
          let request;
          try { request = JSON.parse(chunk.toString()); } catch {}
          const hold = globalThis.diagnosticMutationHold;
          if (request?.type === 'mutate' && hold && !hold.request
            && request.input?.action === hold.action && request.input?.id === hold.pluginId) {
            hold.request = { id: request.id, action: request.input.action, pluginId: request.input.id };
            hold.release = () => {
              if (hold.released) return;
              hold.released = true;
              write(chunk, ...args);
            };
            return true;
          }
          return write(chunk, ...args);
        };
      }
      if (Array.isArray(workerArgs) && workerArgs[0] === sessionEntry
        && workerArgs.includes('--mode') && workerArgs.includes('rpc')) {
        const record = { child, pid: job ? undefined : child.pid,
          supervisorPid: job ? child.pid : undefined, generation: globalThis.diagnosticNatives.length + 1 };
        globalThis.diagnosticNatives.push(record);
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (chunk, ...args) => {
          let request;
          try { request = JSON.parse(chunk.toString()); } catch {}
          if (request?.type === 'prompt' && typeof request.message === 'string')
            globalThis.diagnosticPromptMessages.push(request.message);
          return write(chunk, ...args);
        };
        observe(child, value => {
          if (job && !record.pid && value.type === 'dfsc_runtime_job' && value.job === job
            && Number.isInteger(value.pid) && value.pid > 0) record.pid = value.pid;
          if (value.type === 'response' && value.success && value.data?.sessionId)
            record.sessionId = value.data.sessionId;
          if (value.type === 'extension_ui_request' && value.method === 'setStatus' && value.statusKey === 'step-permission')
            record.permission = /^(Mode: (?:Ask|Approve for Me|Full Access))(?: \(auto-resume\))?$/.exec(value.statusText)?.[1];
        });
      }
      return child;
    };
  }, remoteHelper);
  await page.evaluate(() => window.desktop.snapshot());
  await mutate({ action: 'marketplace-add', source: pathToFileURL(marketSource).href });
  let current = await catalog();
  const market = current.marketplaces.find(item => item.kind === 'git');
  const theme = current.available.find(item => item.name === 'stellar-cruise');
  assert.ok(market && theme);
  assert.equal(theme.package?.documentation.readme, 'README.md', 'The theme fixture must expose its guide before UI acceptance');
  const availableExecutable = current.available.find(item => item.name === executableId && item.marketplace === theme.marketplace);
  assert.ok(availableExecutable?.package?.ref);
  assert.deepEqual((await mutate({ action: 'plugin-install', name: executableId,
    marketplace: availableExecutable.marketplace, ref: availableExecutable.package.ref })).warnings, []);
  const initialExecutable = (await catalog()).plugins.find(item => item.id === executableId);
  assert.ok(initialExecutable?.package?.ref);
  assert.equal(initialExecutable.version, '1.0.0');
  assert.equal(initialExecutable.package.provenance, 'recorded');
  assert.notEqual(initialExecutable.package.dataOnlyTheme, true);
  assert.deepEqual(initialExecutable.mcpServers, []);
  assert.deepEqual(initialExecutable.installationSource, { status: 'recorded', marketplaces: [availableExecutable.marketplace] });
  const installedExecutableReceipt = await executableReceipt();
  assert.ok(installedExecutableReceipt);
  assert.equal(installedExecutableReceipt.state, 'installed');
  assert.equal(installedExecutableReceipt.folder, executableId);
  assert.equal(installedExecutableReceipt.marketplace, availableExecutable.marketplace);
  assert.match(installedExecutableReceipt.instance, /^[a-f0-9-]{36}$/u);
  assert.match(installedExecutableReceipt.fingerprint, /^[a-f0-9]{64}$/u);
  checks.push('command-only-executable-installed-through-native-marketplace-with-recorded-receipt-before-peer-start');
  const peer = await page.evaluate(() => window.desktop.newIndependentSession());
  await page.evaluate(id => window.desktop.command('get_commands', undefined, id), peer.runtimeId);
  await page.evaluate(() => window.desktop.remoteAction({ type: 'connect' }));
  await poll(remoteState, value => value.status === 'connected' && value.saved, 'offline Remote connected');
  await page.evaluate(() => window.desktop.remoteAction({ type: 'armBinding' }));
  await poll(remoteState, value => value.candidate?.id === 'fixture-candidate', 'offline Remote candidate');
  await page.evaluate(({ runtimeId, sessionId }) => window.desktop.remoteAction({
    type: 'bind', candidateId: 'fixture-candidate', runtimeId, sessionId,
  }), { runtimeId: peer.runtimeId, sessionId: peer.state.sessionId });
  await assertRemoteRetained(peer.runtimeId);
  await page.getByRole('button', { name: /^(插件|插件市场)$/u }).click();
  await page.getByRole('tab', { name: '发现', exact: true }).click();
  await page.getByRole('button', { name: '查看 星辰巡航 使用说明', exact: true }).click();
  await page.locator('.pc-document-markdown').getByRole('heading', { name: guideHeading, exact: true }).waitFor();
  await page.getByRole('button', { name: '安装', exact: true }).click();
  await poll(catalog, value => value.plugins.some(item => item.id === 'stellar-cruise'), 'Remote-bound theme installed');
  await waitForUiReady(page.getByRole('button', { name: '卸载插件', exact: true }), 'installed theme UI settled');
  await page.getByRole('tab', { name: '使用说明', exact: true }).click();
  await page.locator('.pc-document-markdown').getByRole('heading', { name: guideHeading, exact: true }).waitFor();
  await assertRemoteRetained(peer.runtimeId);
  await page.screenshot({ path: join(output, 'remote-installed-theme-document.png') });
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  checks.push('remote-preserved-through-ui-theme-installation-and-document-read');
  const installedManifest = await readFile(join(root, 'plugins/stellar-cruise/step.plugin.json'), 'utf8');
  for (const [revision, action] of ['marketplace-update', 'plugin-check-updates'].entries()) {
    const manifestPath = join(marketSource, '.step-plugin/marketplace.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.description = `Offline revision ${revision}`;
    await writeFile(manifestPath, JSON.stringify(manifest));
    commitMarket();
    if (action === 'marketplace-update') await mutate({ action, name: market.name });
    else await mutate({ action });
    assert.equal(JSON.parse(await readFile(join(root, 'marketplaces', market.name, '.step-plugin/marketplace.json'), 'utf8')).description,
      `Offline revision ${revision}`);
    assert.equal(await readFile(join(root, 'plugins/stellar-cruise/step.plugin.json'), 'utf8'), installedManifest);
    await assertRemoteRetained(peer.runtimeId);
  }
  checks.push('remote-preserved-through-single-market-refresh-and-check-all-without-updating-installed-theme');
  const healthySource = join(profile, 'healthy-marketplace');
  await cp(marketSource, healthySource, { recursive: true });
  const healthyManifestPath = join(healthySource, '.step-plugin/marketplace.json');
  const healthyManifest = JSON.parse(await readFile(healthyManifestPath, 'utf8'));
  healthyManifest.name = 'diagnostic-healthy';
  await writeFile(healthyManifestPath, JSON.stringify(healthyManifest));
  const commitHealthy = () => git('-C', healthySource, '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '-am', 'Offline healthy market revision');
  commitHealthy();
  await mutate({ action: 'marketplace-add', source: pathToFileURL(healthySource).href });
  const healthyMarket = (await catalog()).marketplaces.find(item => item.kind === 'git' && item.name !== market.name);
  assert.ok(healthyMarket);
  const marketCache = join(root, 'marketplaces', market.name);
  const originalOrigin = git('-C', marketCache, 'remote', 'get-url', 'origin').trim();
  git('-C', marketCache, 'remote', 'set-url', 'origin',
    pathToFileURL(join(profile, 'private-missing-git-source')).href);
  try {
    let expectedGitExitCode;
    try { git('-C', marketCache, 'pull', '--ff-only', '--quiet'); }
    catch (error) { expectedGitExitCode = error.status; }
    assert.ok(Number.isInteger(expectedGitExitCode) && expectedGitExitCode > 0 && expectedGitExitCode <= 255,
      'The fixture must observe an actual Git failure exit code');
    await page.getByRole('button', { name: /^(插件|插件市场)$/u }).click();
    await page.getByRole('button', { name: '全部插件', exact: true }).click();
    await page.getByRole('tab', { name: '市场来源', exact: true }).click();
    const refresh = page.getByRole('button', { name: `更新市场 ${market.name}`, exact: true });
    await waitForUiReady(refresh, 'failing market refresh enabled');
    await refresh.click();
    await readDiagnostic('marketplace-source-unavailable', 'mutation', undefined, expectedGitExitCode);
    await waitForUiReady(refresh, 'failed refresh released its worker');
    await assertRemoteRetained(peer.runtimeId);
    checks.push('single-market-git-failure-reaches-localized-ui-with-exit-code-and-elapsed-time');
    healthyManifest.description = 'Healthy market advances despite another source failing';
    await writeFile(healthyManifestPath, JSON.stringify(healthyManifest));
    commitHealthy();
    const checkUpdates = page.getByRole('button', { name: '检查插件更新', exact: true });
    await waitForUiReady(checkUpdates, 'bulk update check enabled');
    await checkUpdates.click();
    await poll(() => readJsonDuringRefresh(
      join(root, 'marketplaces', healthyMarket.name, '.step-plugin/marketplace.json')),
    value => value?.description === healthyManifest.description, 'healthy source refreshed after another source failed');
    const warning = page.locator('.plugin-center .cap-notes li').filter({ hasText: '诊断编号' });
    await warning.waitFor();
    await readDiagnostic('marketplace-source-unavailable', 'mutation', await warning.innerText(), expectedGitExitCode);
    await waitForUiReady(checkUpdates, 'partial update check completed');
    // Git checkout can temporarily remove the manifest; read only after the UI operation settles.
    assert.equal(JSON.parse(await readFile(
      join(root, 'marketplaces', healthyMarket.name, '.step-plugin/marketplace.json'), 'utf8')).description,
    healthyManifest.description, 'The healthy source must refresh despite another source failing');
    assert.equal(await readFile(join(root, 'plugins/stellar-cruise/step.plugin.json'), 'utf8'), installedManifest);
    await assertRemoteRetained(peer.runtimeId);
    await page.screenshot({ path: join(output, 'partial-market-refresh-diagnostic.png') });
    checks.push('partial-update-check-advances-healthy-market-and-keeps-a-localized-correlated-failure');
  } finally {
    git('-C', marketCache, 'remote', 'set-url', 'origin', originalOrigin);
  }
  await mutate({ action: 'marketplace-update', name: market.name });
  await mutate({ action: 'marketplace-remove', name: healthyMarket.name });
  await assertRemoteRetained(peer.runtimeId);
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  checks.push('explicit-refresh-recovers-after-source-restoration-without-restarting-remote');
  const mcpName = 'diagnostic-managed-mcp';
  const mcpConfig = { command: process.execPath, args: [mcpHelper], enabled: false };
  await page.evaluate(({ name, config }) => window.desktop.saveMcp(name, config), { name: mcpName, config: mcpConfig });
  const assertMcpSaved = async enabled => {
    const saved = await page.evaluate(async name => (await window.desktop.settings()).mcp[name], mcpName);
    assert.ok(saved);
    assert.equal(saved.command, mcpConfig.command);
    assert.deepEqual(saved.args, mcpConfig.args);
    assert.equal(saved.enabled, enabled);
    assert.deepEqual(saved.configuredSecrets, []);
    assert.deepEqual((await catalog()).mcp.find(server => server.name === mcpName), {
      name: mcpName, source: 'user', transport: 'stdio', enabled, configurable: true,
    });
    await assertRemoteRetained(peer.runtimeId);
  };
  await assertMcpSaved(false);
  for (const enabled of [true, false]) {
    assert.deepEqual((await mutate({ action: 'mcp-toggle', name: mcpName, enabled })).warnings, []);
    await assertMcpSaved(enabled);
  }
  await page.evaluate(name => window.desktop.saveMcp(name, null), mcpName);
  assert.equal(await page.evaluate(async name => (await window.desktop.settings()).mcp[name], mcpName), undefined);
  assert.equal((await catalog()).mcp.some(server => server.name === mcpName), false);
  await assertRemoteRetained(peer.runtimeId);
  checks.push('idle-remote-preserved-through-native-mcp-save-toggle-on-off-and-removal');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimeId, peer.runtimeId);
  await assert.rejects(page.evaluate(() => window.desktop.restart()), /Unbind Remote before changing this session runtime/u);
  await assertRemoteRetained(peer.runtimeId);
  checks.push('native-remote-bound-restart-still-refused-without-changing-identity');

  const executableManifestPath = join(executableSource, 'step.plugin.json');
  const nextExecutableManifest = JSON.parse(await readFile(executableManifestPath, 'utf8'));
  nextExecutableManifest.version = '1.1.0';
  const nextExecutableCommand = '---\ndescription: Updated offline diagnostics only; never invoke.\n---\nNo executable action is authorized.\n';
  await writeFile(executableManifestPath, JSON.stringify(nextExecutableManifest));
  await writeFile(join(executableSource, executableCommand), nextExecutableCommand);
  commitMarket();
  assert.deepEqual((await mutate({ action: 'marketplace-update', name: market.name })).warnings, []);
  await assertRemoteRetained(peer.runtimeId);
  const executableCandidate = (await catalog()).plugins.find(item => item.id === executableId);
  assert.ok(executableCandidate?.package?.ref);
  assert.equal(executableCandidate.version, '1.0.0');
  assert.equal(executableCandidate.update?.status, 'available');
  assert.equal(executableCandidate.update.version, '1.1.0');
  assert.ok(executableCandidate.update.ref);
  assert.deepEqual(await executableReceipt(), installedExecutableReceipt);
  const executableBeforeUpdate = await readFile(join(executableRoot, 'step.plugin.json'), 'utf8');
  const configBeforeUpdate = await readFile(join(root, 'config.toml'), 'utf8');
  await app.evaluate((_, pluginId) => {
    globalThis.diagnosticMutationHold = { action: 'plugin-update', pluginId, released: false };
  }, executableId);
  const pendingUpdate = mutate({ action: 'plugin-update', id: executableId,
    ref: executableCandidate.package.ref, candidate: executableCandidate.update.ref })
    .then(value => ({ value }), error => ({ error: error.message }));
  try {
    await poll(() => app.evaluate(() => {
      const hold = globalThis.diagnosticMutationHold;
      return hold?.request && { ...hold.request, released: hold.released };
    }), value => value?.action === 'plugin-update' && value.pluginId === executableId && !value.released,
    'native executable update reached the management write barrier');
    assert.equal(await readFile(join(executableRoot, 'step.plugin.json'), 'utf8'), executableBeforeUpdate);
    assert.deepEqual(await executableReceipt(), installedExecutableReceipt);
    const requestsBeforeBlockedInput = modelRequests;
    const cardOffset = await app.evaluate(() => globalThis.diagnosticRemoteCards.length);
    await app.evaluate((_, text) => globalThis.diagnosticRemote.stdin.write(
      `${JSON.stringify({ type: 'fixture-input', messageId: 'offline-management-blocked', text })}\n`), blockedRemoteText);
    const cards = await poll(() => app.evaluate((_, start) => globalThis.diagnosticRemoteCards.slice(start), cardOffset),
      values => values.some(card => card.key === 'receipt' && card.title === 'Not accepted / 未接收'),
      'Remote reports that input was not accepted while management holds the write barrier');
    const rejection = cards.find(card => card.key === 'receipt' && card.title === 'Not accepted / 未接收');
    assert.equal(rejection.bindingId, await app.evaluate(() => globalThis.diagnosticBindingIds[0]));
    assert.match(rejection.text, /Input was not retried/u);
    assert.equal(modelRequests, requestsBeforeBlockedInput);
    const blockedSnapshot = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(blockedSnapshot.runtimeId, peer.runtimeId);
    assert.deepEqual(blockedSnapshot.pendingMessages, []);
    assert.equal(JSON.stringify(blockedSnapshot.messages).includes(blockedRemoteText), false);
    assert.equal(await app.evaluate(() => globalThis.diagnosticMutationHold?.released), false);
    checks.push('runtime-management-write-barrier-refuses-real-remote-input-without-model-or-queue-admission');
  } finally {
    await releaseMutationHold();
  }
  const updateOutcome = await pendingUpdate;
  assert.equal(updateOutcome.error, undefined, updateOutcome.error);
  assert.deepEqual(updateOutcome.value.warnings, []);
  const updatedExecutable = (await catalog()).plugins.find(item => item.id === executableId);
  assert.equal(updatedExecutable?.version, '1.1.0');
  assert.equal(updatedExecutable.package?.provenance, 'recorded');
  assert.notEqual(updatedExecutable.package.dataOnlyTheme, true);
  assert.notEqual(updatedExecutable.package.ref, executableCandidate.package.ref);
  assert.equal(updatedExecutable.update?.status, 'current');
  assert.deepEqual(updatedExecutable.mcpServers, []);
  assert.deepEqual(updatedExecutable.installationSource, initialExecutable.installationSource);
  assert.deepEqual(JSON.parse(await readFile(join(executableRoot, 'step.plugin.json'), 'utf8')), nextExecutableManifest);
  assert.equal(await readFile(join(executableRoot, executableCommand), 'utf8'), nextExecutableCommand);
  const updatedExecutableReceipt = await executableReceipt();
  assert.ok(updatedExecutableReceipt);
  assert.match(updatedExecutableReceipt.fingerprint, /^[a-f0-9]{64}$/u);
  assert.notEqual(updatedExecutableReceipt.fingerprint, installedExecutableReceipt.fingerprint);
  assert.deepEqual(updatedExecutableReceipt, {
    ...installedExecutableReceipt, fingerprint: updatedExecutableReceipt.fingerprint,
  });
  assert.equal(await readFile(join(root, 'config.toml'), 'utf8'), configBeforeUpdate);
  await assertRemoteRetained(peer.runtimeId);
  checks.push('idle-remote-preserved-through-native-command-only-update-with-same-installation-instance-and-new-fingerprint');
  const requestsBeforeStreaming = modelRequests;
  await page.evaluate(id => { void window.desktop.command('prompt', { message: 'Offline guard check.' }, id).catch(() => {}); }, peer.runtimeId);
  await poll(async () => modelRequests, value => value > requestsBeforeStreaming, 'loopback task started');
  await assertBusyRemoteRetained(peer.runtimeId);
  await page.evaluate(() => window.desktop.newIndependentSession());
  await page.getByRole('button', { name: /^(插件|插件市场)$/u }).click();
  const allPlugins = page.getByRole('button', { name: '全部插件', exact: true });
  if (await allPlugins.isVisible()) await allPlugins.click();
  await page.getByRole('tab', { name: '市场来源', exact: true }).click();
  const busyManifestPath = join(marketSource, '.step-plugin/marketplace.json');
  const busyManifest = JSON.parse(await readFile(busyManifestPath, 'utf8'));
  busyManifest.description = 'Offline streaming revision';
  await writeFile(busyManifestPath, JSON.stringify(busyManifest));
  commitMarket();
  await waitForUiReady(page.getByRole('button', { name: `更新市场 ${market.name}`, exact: true }),
    'market maintenance enabled after the plugin catalog loads');
  assert.equal(await page.getByRole('button', { name: `更新市场 ${market.name}`, exact: true }).isDisabled(), false);
  await page.getByRole('button', { name: `更新市场 ${market.name}`, exact: true }).click();
  await poll(() => readJsonDuringRefresh(join(root, 'marketplaces', market.name, '.step-plugin/marketplace.json')),
    value => value?.description === busyManifest.description, 'market refreshed while peer streams');
  await waitForUiReady(page.getByRole('button', { name: `更新市场 ${market.name}`, exact: true }),
    'market refresh UI settled while peer streams');
  assert.equal(JSON.parse(await readFile(
    join(root, 'marketplaces', market.name, '.step-plugin/marketplace.json'), 'utf8')).description,
  busyManifest.description, 'The market must refresh while its Remote peer keeps streaming');
  await assertBusyRemoteRetained(peer.runtimeId);
  await page.getByRole('tab', { name: /^已安装/u }).click();
  await page.getByRole('button', { name: '查看 星辰巡航 使用说明', exact: true }).click();
  await waitForUiReady(page.getByRole('button', { name: '卸载插件', exact: true }),
    'pure theme removal enabled while peer streams');
  await page.getByRole('button', { name: '卸载插件', exact: true }).click();
  await confirm();
  await poll(catalog, value => !value.plugins.some(item => item.id === 'stellar-cruise'), 'theme removed while peer streams');
  await waitForUiReady(page.getByRole('tab', { name: /^已安装/u }), 'theme removal UI settled while peer streams');
  await page.getByRole('button', { name: '查看 星辰巡航 使用说明', exact: true }).waitFor({ state: 'hidden' });
  await assertBusyRemoteRetained(peer.runtimeId);
  await page.getByRole('tab', { name: '发现', exact: true }).click();
  await page.getByRole('button', { name: '查看 星辰巡航 使用说明', exact: true }).click();
  await waitForUiReady(page.getByRole('button', { name: '安装', exact: true }),
    'pure theme installation enabled while peer streams');
  await page.getByRole('button', { name: '安装', exact: true }).click();
  await poll(catalog, value => value.plugins.some(item => item.id === 'stellar-cruise'), 'theme installed while peer streams');
  await waitForUiReady(page.getByRole('button', { name: '卸载插件', exact: true }),
    'theme installation UI settled while peer streams');
  await page.getByRole('tab', { name: '使用说明', exact: true }).click();
  await page.locator('.pc-document-markdown').getByRole('heading', { name: guideHeading, exact: true }).waitFor();
  await assertBusyRemoteRetained(peer.runtimeId);
  await page.screenshot({ path: join(output, 'busy-peer-plugin.png') });
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.getByRole('tab', { name: '市场来源', exact: true }).click();
  await waitForUiReady(page.getByRole('button', { name: `移除市场 ${market.name}`, exact: true }),
    'market removal enabled while peer streams');
  await page.getByRole('button', { name: `移除市场 ${market.name}`, exact: true }).click();
  await confirm();
  await poll(catalog, value => !value.marketplaces.some(item => item.name === market.name), 'market removed while peer streams');
  await waitForUiReady(page.getByRole('button', { name: '添加市场', exact: true }),
    'market removal UI settled while peer streams');
  await page.getByRole('button', { name: `移除市场 ${market.name}`, exact: true }).waitFor({ state: 'hidden' });
  await page.screenshot({ path: join(output, 'busy-peer-marketplace.png') });
  assert.ok((await catalog()).plugins.some(item => item.id === 'stellar-cruise'));
  await assertBusyRemoteRetained(peer.runtimeId);
  checks.push('streaming-peer-preserved-through-ui-market-refresh-theme-remove-install-and-market-removal');
  await page.getByRole('tab', { name: /^已安装/u }).click();
  await page.getByRole('button', { name: '查看 Offline executable fixture 使用说明', exact: true }).click();
  const executable = (await catalog()).plugins.find(item => item.id === 'diagnostic-executable');
  assert.ok(executable);
  assert.notEqual(executable.package?.dataOnlyTheme, true);
  assert.equal(executable.version, '1.1.0');
  assert.equal(executable.package?.provenance, 'recorded');
  assert.equal(await page.getByRole('button', { name: '卸载插件', exact: true }).isDisabled(), true);
  await expectBackendRefusal({ action: 'plugin-remove', id: executableId });
  assert.deepEqual(await executableReceipt(), updatedExecutableReceipt);
  assert.deepEqual(JSON.parse(await readFile(join(executableRoot, 'step.plugin.json'), 'utf8')), nextExecutableManifest);
  await assertBusyRemoteRetained(peer.runtimeId);
  checks.push('streaming-peer-disables-executable-removal-and-backend-refuses-session-busy-with-receipt-intact');
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.getByRole('tab', { name: '市场来源', exact: true }).click();
  await page.getByRole('button', { name: '添加市场', exact: true }).click();
  await page.getByRole('textbox', { name: '市场来源', exact: true }).fill(pathToFileURL(marketSource).href);
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await poll(catalog, value => value.marketplaces.some(item => item.name === market.name), 'market restored while peer streams');
  await waitForUiReady(page.getByRole('button', { name: `移除市场 ${market.name}`, exact: true }),
    'market restoration UI settled while peer streams');
  await assertBusyRemoteRetained(peer.runtimeId);
  for (const stream of streams) {
    stream.write(`data: ${JSON.stringify({ id: 'offline-guard-check', object: 'chat.completion.chunk',
      created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    stream.end('data: [DONE]\n\n');
  }
  await poll(() => page.evaluate(() => window.desktop.snapshot()),
    value => Array.isArray(value.runtimes) && value.runtimes.some(runtime => runtime.runtimeId === peer.runtimeId)
      && !value.runtimes.some(runtime => runtime.status === 'running' || runtime.status === 'waiting'), 'peer task ended');
  assert.deepEqual((await mutate({ action: 'plugin-remove', id: executableId })).warnings, []);
  assert.equal((await catalog()).plugins.some(item => item.id === executableId), false);
  assert.equal((await readdir(join(root, 'plugins'))).includes(executableId), false);
  assert.equal(await executableReceipt(), undefined);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'desktop-plugins/bindings', `${executableId}.json`), 'utf8')),
    { version: 1, instance: updatedExecutableReceipt.instance, id: executableId, revoked: true });
  await assertRemoteRetained(peer.runtimeId);
  checks.push('idle-remote-preserved-through-receipt-backed-executable-removal-and-revocation');
  if (process.platform === 'win32') {
    await holdDirectory(join(root, 'marketplaces', market.name));
    await page.getByRole('button', { name: `移除市场 ${market.name}`, exact: true }).click();
    await confirm();
    await readDiagnostic('(?:operation-denied|file-in-use|directory-not-empty)', 'mutation');
    await waitForUiReady(page.getByRole('button', { name: `移除市场 ${market.name}`, exact: true }),
      'failed market removal UI settled before retry');
    await mainWindow.evaluate(window => window.setSize(560, 780));
    await page.waitForFunction(() => innerWidth <= 740);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const alertLayout = await page.getByRole('alert').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const parent = element.closest('main').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return { bounds: bounds.toJSON(), parent: parent.toJSON(), text: [...range.getClientRects()].map(rect => rect.toJSON()) };
    });
    assert.ok(alertLayout.bounds.left >= alertLayout.parent.left && alertLayout.bounds.right <= alertLayout.parent.right,
      JSON.stringify(alertLayout));
    assert.ok(alertLayout.text.every(rect => rect.left >= alertLayout.bounds.left - 1 && rect.right <= alertLayout.bounds.right + 1),
      JSON.stringify(alertLayout));
    await page.screenshot({ path: join(output, 'locked-directory-narrow.png') });
    await releaseDirectory();
    await mainWindow.evaluate(window => window.setSize(1440, 960));
    checks.push('windows-directory-lock-reports-filesystem-reason-without-raw-paths');
  }
  await page.getByRole('button', { name: `移除市场 ${market.name}`, exact: true }).click();
  await confirm();
  await poll(catalog, value => !value.marketplaces.some(item => item.name === market.name), 'marketplace removed');
  await waitForUiReady(page.getByRole('button', { name: '添加市场', exact: true }), 'market removal UI settled');
  await page.getByRole('button', { name: `移除市场 ${market.name}`, exact: true }).waitFor({ state: 'hidden' });
  assert.ok((await catalog()).plugins.some(item => item.id === 'stellar-cruise'));
  checks.push('marketplace-removal-retries-and-retains-installed-theme');
  await page.getByRole('tab', { name: /^已安装/u }).click();
  await page.getByRole('button', { name: '查看 星辰巡航 使用说明', exact: true }).click();
  if (process.platform === 'win32') {
    await holdDirectory(join(root, 'plugins/stellar-cruise'));
    await page.getByRole('button', { name: '卸载插件', exact: true }).click();
    await confirm();
    await readDiagnostic('(?:operation-denied|file-in-use|directory-not-empty)', 'mutation');
    await waitForUiReady(page.getByRole('button', { name: '卸载插件', exact: true }),
      'failed theme removal UI settled before retry');
    await page.screenshot({ path: join(output, 'locked-plugin.png') });
    await releaseDirectory();
  }
  await page.getByRole('button', { name: '卸载插件', exact: true }).click();
  await confirm();
  await poll(catalog, value => !value.plugins.some(item => item.id === 'stellar-cruise'), 'theme uninstalled');
  await waitForUiReady(page.getByRole('tab', { name: /^已安装/u }), 'theme uninstall UI settled');
  await page.getByRole('button', { name: '查看 星辰巡航 使用说明', exact: true }).waitFor({ state: 'hidden' });
  await assertRemoteRetained(peer.runtimeId);
  checks.push('theme-uninstall-retries-after-release');
  const previousRequests = modelRequests;
  await app.evaluate(() => globalThis.diagnosticRemote.stdin.write('{"type":"fixture-input"}\n'));
  await poll(async () => modelRequests, value => value > previousRequests, 'Remote still accepts input after removals');
  await page.evaluate(id => window.desktop.command('abort', {}, id), peer.runtimeId);
  for (const stream of streams) stream.end();
  checks.push('remote-preserved-through-both-removals-and-submits-a-new-loopback-task-afterward');
  const promptEvidence = await app.evaluate((_, text) => ({
    blocked: globalThis.diagnosticPromptMessages.some(message => message.includes(text)),
    accepted: globalThis.diagnosticPromptMessages.some(message => message.includes('Offline guard check.')),
  }), blockedRemoteText);
  assert.equal(promptEvidence.accepted, true, 'The native prompt observer must have seen the allowed loopback input');
  assert.equal(promptEvidence.blocked, false,
    'Rejected Remote input must never reach a native prompt, including after the management barrier releases');
  checks.push('rejected-management-remote-input-never-replayed-after-release-and-remote-accepts-fresh-input');
  assert.deepEqual(errors, []);
  result = { packaged: Boolean(executablePath), checks, diagnostics, modelRequests, rendererErrors: errors,
    realProfileModified: false, realAccountTested: false, profile };
} catch (error) {
  operationError = error instanceof Error ? error : new Error('Capability diagnostics failed');
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error(await page?.locator('body').innerText().catch(() => ''));
} finally {
  await finalizeCapabilityDiagnostics(operationError, [
    ['directory-holder', releaseDirectory],
    ['management-mutation-hold', releaseMutationHold],
    ['model-streams', async () => { for (const stream of streams) stream.end(); }],
    ['desktop-fixture', async () => {
      if (!app) return;
      try {
        const pids = await app.evaluate(() => (globalThis.diagnosticChildren ?? [])
          .filter(child => child.exitCode === null && child.signalCode === null).map(child => child.pid).filter(Boolean));
        for (const pid of pids) ownedPids.add(pid);
      } finally { await closeDesktopFixtureAndWait(app); }
    }],
    ['owned-process-exits', confirmOwnedProcessesExited],
    ['loopback-server', async () => {
      if (!server.listening) return;
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }],
  ], async completion => {
    const report = { ...result, packaged: Boolean(executablePath), profile, checks, diagnostics, modelRequests, rendererErrors: errors,
      realProfileModified: false, realAccountTested: false, ...completion };
    await writeFile(join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  });
}
