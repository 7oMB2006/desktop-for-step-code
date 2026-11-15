import { build } from 'esbuild';
import { readFile, realpath } from 'node:fs/promises';
import { Module } from 'node:module';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [profileArgument, runtimeArgument, mode = 'catalog', pluginId, consumer, folder = pluginId] = process.argv.slice(2);
if (!profileArgument || !runtimeArgument || !['catalog', 'desktop', 'host'].includes(mode)
  || mode === 'host' && (!/^[a-z][a-z0-9_-]{0,127}$/u.test(pluginId ?? '')
    || !/^[a-z][a-z0-9_-]{0,47}$/u.test(consumer ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/u.test(folder ?? '')))
  throw new Error('Usage: node scripts/diagnose-plugin-startup.mjs <profile> <runtime> [catalog|desktop|host <plugin-id> <consumer> [folder]]');
const profile = await realpath(resolve(profileArgument));
const runtime = await realpath(resolve(runtimeArgument));
const desktop = fileURLToPath(new URL('../', import.meta.url));
const timings = new Map();
globalThis.__dfscFingerprintDiagnostic = async (root, action) => {
  const key = relative(profile, root).replaceAll('\\', '/');
  const summary = timings.get(key) ?? { calls: 0, elapsedMs: 0 };
  timings.set(key, summary);
  const before = performance.now();
  summary.calls++;
  try { return await action(); }
  finally { summary.elapsedMs += performance.now() - before; }
};
const bundle = await build({
  stdin: { contents: "export { CapabilityService } from './electron/capability-service'; export { isolatedEnvironment } from './electron/runtime';",
    resolveDir: desktop, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  plugins: [{
    name: 'fingerprint-diagnostic',
    setup(builder) {
      builder.onLoad({ filter: /[\\/]plugin-files\.mjs$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const signature = 'export async function packageFingerprint(root) {';
        if (!source.includes(signature)) throw new Error('Unexpected fingerprint implementation');
        return { contents: source.replace(signature, 'async function calculatePackageFingerprint(root) {') +
          '\nexport async function packageFingerprint(root) { return globalThis.__dfscFingerprintDiagnostic(root, () => calculatePackageFingerprint(root)); }\n',
        loader: 'js' };
      });
    },
  }],
});
const compiled = new Module(join(desktop, 'diagnose-plugin-startup.cjs'));
compiled.filename = join(desktop, 'diagnose-plugin-startup.cjs');
compiled.paths = Module._nodeModulePaths(desktop);
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const { CapabilityService, isolatedEnvironment } = compiled.exports;
const service = new CapabilityService({
  root: profile, runtime, node: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
  environment: () => isolatedEnvironment(profile),
});
const started = performance.now();
try {
  if (mode === 'catalog' || mode === 'desktop') {
    const catalog = await (mode === 'desktop' ? service.desktopCatalog() : service.catalog());
    console.log(JSON.stringify({ mode, elapsedMs: Math.round(performance.now() - started),
      installed: catalog.plugins.length, available: catalog.available.length }));
  } else {
    await service.withHostDescriptor(pluginId,
      join(profile, 'plugins', folder), consumer,
      async descriptor => {
        console.log(JSON.stringify({ mode, elapsedMs: Math.round(performance.now() - started),
          plugin: descriptor.id, provenance: descriptor.provenance }));
      });
  }
} finally {
  await service.stop();
  console.log(JSON.stringify({ fingerprintScans: [...timings].map(([path, value]) => ({
    package: `${path.startsWith('plugins/') ? 'installed' : 'marketplace'}/${basename(path)}`,
    calls: value.calls, elapsedMs: Math.round(value.elapsedMs),
  })).sort((a, b) => b.elapsedMs - a.elapsedMs) }));
  delete globalThis.__dfscFingerprintDiagnostic;
}
