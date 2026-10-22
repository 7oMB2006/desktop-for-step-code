// Explicit local acceptance: supply an already-downloaded official bundle.
// Never downloads, logs in, calls an MCP tool or touches a personal profile.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tsImport } from 'tsx/esm/api';

if (process.platform !== 'win32') throw new Error('This check qualifies Windows StepPage only');
if (!process.argv[2]) throw new Error('Usage: node scripts/verify-steppage-bundle.mjs <official-bundle.mjs>');
const bundle = resolve(process.argv[2]);
const bytes = await readFile(bundle);
const { RpcProcess, isolatedEnvironment } = await tsImport('../electron/runtime.ts', import.meta.url);
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, 'steppage-real-profile-'));
const workspace = join(root, 'project');
const home = join(root, 'isolated-home');
await mkdir(workspace);
await mkdir(home);
const runtime = process.env.DESKTOP_VERIFY_EXE
  ? join(dirname(resolve(process.env.DESKTOP_VERIFY_EXE)), 'resources', 'runtime') : resolve('runtime');
const node = join(runtime, 'node', 'node.exe');
const env = isolatedEnvironment(root, { ...process.env, HOME: home, USERPROFILE: home });
const name = 'steppage__steppage';
const admin = new RpcProcess(() => {});
const worker = new RpcProcess(() => {});
const exec = promisify(execFile);
const summary = async () => {
  worker.start(node, join(runtime, 'step/dist/bundle/step.js'), workspace, env);
  try {
    const state = await worker.request('get_state', {}, 60000);
    assert.equal(state.messageCount, 0);
    const snapshot = await worker.request('get_desktop_summary');
    const servers = snapshot.mcp.filter(server => server.name.includes('steppage'));
    assert.equal(servers.length, 1, 'Exactly one effective StepPage service is expected');
    return servers[0];
  } finally { await worker.stop(); }
};
try {
  await exec(node, ['--check', bundle], { env, windowsHide: true, timeout: 10000 });
  const { stdout } = await exec(node, [bundle, '--version'], { env, windowsHide: true, timeout: 10000 });
  const version = stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
  await writeFile(join(root, 'config.toml'), [
    'defaultProvider = "fixture"', 'defaultModel = "fixture"', '[telemetry]', 'enabled = false',
    '[mcp_servers.steppage]', 'enabled = true',
    `command = ${JSON.stringify('C:\\Previous Desktop\\runtime\\node\\node.exe')}`,
    `args = [${JSON.stringify(bundle)}]`, '[mcp_servers.steppage.env]',
    `HOME = ${JSON.stringify(home)}`, `USERPROFILE = ${JSON.stringify(home)}`,
  ].join('\n') + '\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only',
    models: [{ id: 'fixture', name: 'MCP acceptance', contextWindow: 32768, maxTokens: 1024 }],
  } } }));
  admin.start(node, join(runtime, 'admin.mjs'), workspace, env);
  await admin.request('reconcile_steppage', { bundlePath: bundle });
  const settings = await admin.request('settings', { cwd: workspace });
  assert.ok(!settings.mcp.steppage);
  assert.equal(settings.mcp[name].command, node);
  const connected = await summary();
  assert.equal(connected.status, 'connected');
  assert.ok(connected.toolCount > 0, 'The actual bundle must publish a tool catalog');
  await admin.request('mcp', { name, config: { command: 'C:\\Moved Desktop\\runtime\\node\\node.exe', enabled: false } });
  await admin.request('reconcile_steppage', { bundlePath: bundle });
  const disabled = await summary();
  assert.deepEqual(disabled, { name, status: 'disabled', toolCount: 0 });
  await admin.request('mcp', { name, config: { enabled: true } });
  const restored = await summary();
  assert.deepEqual(restored, connected);
  const report = {
    checkedAt: new Date().toISOString(), bundleVersion: version,
    bundleSha256: createHash('sha256').update(bytes).digest('hex'), bundleBytes: bytes.length,
    connected, disabled, restored,
    scope: 'Real official-bundle handshake only; no login, tool call, publishing, paid-model or installer acceptance',
  };
  await writeFile(join(output, 'steppage-bundle-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await worker.stop();
  await admin.stop();
  await rm(root, { recursive: true, force: true });
}
