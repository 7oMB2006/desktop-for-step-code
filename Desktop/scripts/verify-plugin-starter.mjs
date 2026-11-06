import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.equal(process.argv[2], '--output');
assert.ok(isAbsolute(process.argv[3] ?? ''), 'Pass a new absolute --output directory');
assert.equal(process.argv.length, 4);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[3]);
await mkdir(output, { recursive: false });
const root = join(output, 'step-runtime'), agent = join(root, 'agent');
await mkdir(agent, { recursive: true });
for (const key of Object.keys(process.env)) {
  if (/api.?key|token|secret|password|authorization/iu.test(key)) delete process.env[key];
}
Object.assign(process.env, { HOME: root, USERPROFILE: root, STEPCODE_STORAGE_ROOT_DIR: root,
  STEP_CODING_AGENT_DIR: agent, STEP_CODING_AGENT_SESSION_DIR: join(root, 'sessions'),
  STEPCODE_AUTH_PATH: join(root, 'auth.json') });
const runtime = process.env.DESKTOP_STARTER_RUNTIME ?? join(desktop, 'runtime');
assert.ok(isAbsolute(runtime));
const upstream = await import(pathToFileURL(join(runtime, 'step/dist/bundle/index.js')).href);
const { createCapabilitySettings } = await import(pathToFileURL(join(desktop, 'electron/capability-settings.mjs')).href);
const manager = createCapabilitySettings(upstream, { root });
const source = resolve(desktop, '../examples/plugins/resource-starter');
const signal = () => AbortSignal.timeout(30000);
await manager.mutate({ action: 'marketplace-add', source }, signal());
assert.ok((await manager.catalog()).available.some(plugin => plugin.name === 'dfsc-example'));
await manager.mutate({ action: 'plugin-install', name: 'dfsc-example', marketplace: 'dfsc-example-local' }, signal());
const catalog = await manager.catalog();
assert.ok(catalog.plugins.some(plugin => plugin.id === 'dfsc-example'));
const { PluginLibrary } = await import(pathToFileURL(join(desktop, 'electron/plugin-library.mjs')).href);
const library = new PluginLibrary(root), projected = await library.project(catalog);
const pkg = projected.plugins.find(plugin => plugin.id === 'dfsc-example').package;
const guide = await library.document({ ref: pkg.ref, path: pkg.documentation.readme });
assert.match(guide.images['docs/assets/capabilities.png'], /^data:image\/png;base64,/);
assert.ok(catalog.skills.some(skill => skill.name === 'dfsc-example' && skill.enabled));
assert.ok(!catalog.mcp.some(server => server.pluginId === 'dfsc-example'));
const resources = await upstream.discoverStepPluginResourcePaths({ userDir: join(root, 'plugins') });
assert.deepEqual(resources.warnings, []);
assert.ok(resources.skillPaths.some(path => path.includes('dfsc-example')));
assert.ok(resources.promptPaths.some(path => path.includes('dfsc-example')));
const loader = new upstream.DefaultResourceLoader({
  cwd: root, agentDir: agent, settingsManager: upstream.createStepSettingsManager(root, agent),
  noExtensions: true, noThemes: true, noContextFiles: true,
  additionalSkillPaths: resources.skillPaths, additionalPromptTemplatePaths: resources.promptPaths,
});
await loader.reload();
assert.ok(loader.getSkills().skills.some(skill => skill.name === 'dfsc-example'));
assert.ok(loader.getPrompts().prompts.some(prompt => prompt.name === 'dfsc-example'));
const command = join(root, 'plugins/dfsc-example/commands/dfsc-example.md');
const parsed = upstream.parseFrontmatter(await readFile(command, 'utf8'));
assert.ok(parsed.frontmatter.description);
assert.match(await readFile(command, 'utf8'), /\$ARGUMENTS/u);
await manager.mutate({ action: 'plugin-remove', id: 'dfsc-example' }, signal());
assert.ok(!(await manager.catalog()).plugins.some(plugin => plugin.id === 'dfsc-example'));
const after = await upstream.discoverStepPluginResourcePaths({ userDir: join(root, 'plugins') });
assert.ok(!after.promptPaths.some(path => path.includes('dfsc-example')));
await writeFile(join(output, 'verification.json'), JSON.stringify({
  realRuntime: true, source, isolatedProfile: true, noModelRequest: true,
  checks: ['market discovery', 'native installation', 'skill loading', 'prompt command loading',
    'installed README and offline local screenshot', 'no unintended MCP server', 'uninstall removes resources'],
}, null, 2) + '\n');
console.log('Plugin starter passed: native discovery, installation, skills, command resources and removal; no model request.');
