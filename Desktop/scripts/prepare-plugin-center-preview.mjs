import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.equal(process.argv[2], '--output');
assert.ok(isAbsolute(process.argv[3] ?? ''));
assert.equal(process.argv.length, 4);
const output = resolve(process.argv[3]), resources = join(output, 'win-unpacked/resources');
const profile = join(output, 'manual-preview-profile'), root = join(profile, 'step-runtime');
const plugin = 'bilibili-video-research';
await mkdir(profile, { recursive: false });
await mkdir(join(root, 'agent'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspaces: [], autoCheckUpdates: false,
}, null, 2) + '\n');
const { isolatedEnvironment } = await import(pathToFileURL(
  join(output, 'bvr-local-preview/plugins', plugin, 'server/config.mjs')).href);
const env = isolatedEnvironment(process.env, {});
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env, { HOME: root, USERPROFILE: root, STEPCODE_STORAGE_ROOT_DIR: root,
  STEP_CODING_AGENT_DIR: join(root, 'agent'), STEP_CODING_AGENT_SESSION_DIR: join(root, 'sessions'),
  STEPCODE_AUTH_PATH: join(root, 'auth.json') });
const upstream = await import(pathToFileURL(join(resources, 'runtime/step/dist/bundle/index.js')).href);
const { createCapabilitySettings } = await import(pathToFileURL(join(resources, 'runtime/capability-settings.mjs')).href);
const manager = createCapabilitySettings(upstream, { root });
await manager.mutate({ action: 'marketplace-add', source: join(output, 'bvr-local-preview') }, AbortSignal.timeout(30000));
await manager.mutate({ action: 'plugin-install', name: plugin, marketplace: 'bvr-local-preview' }, AbortSignal.timeout(30000));
const node = join(resources, 'runtime/node/node.exe');
const execute = promisify(execFile);
await execute(node, [join(root, 'plugins', plugin, 'server/configure.mjs'), '--profile', root,
  '--runtime', join(output, 'bvr-runtime')], { env: process.env, timeout: 15000 });
const config = JSON.parse(await readFile(join(root, 'bvr/config.json'), 'utf8'));
assert.equal(config.mode, 'dfsc');
assert.equal(config.hostAccess, 'confirm');
const check = await execute(node, [join(root, 'plugins', plugin, 'server/start.mjs'), '--check'],
  { env: process.env, timeout: 15000 });
assert.match(check.stdout, /stepfun \/ follow-dfsc/u);
const scripts = dirname(fileURLToPath(import.meta.url));
await cp(join(scripts, 'start-bvr-preview.ps1'), join(output, 'Start-BVR-Preview.ps1'));
await writeFile(join(output, 'acceptance/manual-preview-setup.json'), JSON.stringify({
  profile, pluginInstalled: true, mode: config.mode, realCredentialsCopied: false,
  realProviderRequests: false, dailyProfileModified: false,
  runtimeDirectory: config.runtimeDirectory, localRuntimeDependenciesAreNotPortable: true,
}, null, 2) + '\n');
console.log('Prepared isolated BVR preview: plugin installed, matching local runtime, no copied credentials or model request.');
