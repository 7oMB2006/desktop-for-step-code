import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const upstream = resolve('../Step-Code');
const runtime = resolve('runtime');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this Windows x64 preview on Windows x64');
const source = join(upstream, 'packages/coding-agent');
await mkdir(join(runtime, 'node'), { recursive: true });
await cp(process.execPath, join(runtime, 'node/node.exe'));
const licenseResponse = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
if (!licenseResponse.ok) throw new Error('Unable to obtain the matching Node distribution license');
await writeFile(join(runtime, 'node/LICENSE'), await licenseResponse.text());
await cp(join(source, 'dist'), join(runtime, 'step/dist'), { recursive: true });
for (const name of ['package.json', 'README.md']) await cp(join(source, name), join(runtime, 'step', name));
for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await cp(join(upstream, name), join(runtime, name));
await cp('electron/admin.mjs', join(runtime, 'admin.mjs'));
await cp('../LICENSE', join(runtime, 'DESKTOP-LICENSE'));
const require = createRequire(join(source, 'package.json'));
for (const name of ['jiti', '@silvia-odwyer/photon-node']) {
  const pkg = require.resolve(`${name}/package.json`);
  await cp(dirname(pkg), join(runtime, 'step/node_modules', name), { recursive: true, dereference: true });
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
const node = await readFile(join(runtime, 'node/node.exe'));
await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ commit, node: process.version, nodeSha256: createHash('sha256').update(node).digest('hex'), entry: 'step/dist/bundle/step.js', patches: ['windows-build', 'desktop-auth-exports'] }, null, 2));
console.log(`Staged Step Code ${commit} with ${process.version}`);
