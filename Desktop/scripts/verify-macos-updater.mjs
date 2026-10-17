import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, chmod, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Native macOS ARM64 acceptance only');
const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-update-acceptance-')));
const target = join(root, 'installed/Desktop for Step Code.app');
const candidate = join(root, 'candidate/Desktop for Step Code.app');
const resources = join(target, 'Contents/Resources');
const version = '0.6.0-macos.1';
try {
  if (process.env.DESKTOP_MACOS_RESOURCES) execFileSync('/usr/bin/ditto', [resolve(process.env.DESKTOP_MACOS_RESOURCES, '../..'), candidate]);
  for (const app of [target, candidate]) await mkdir(join(app, 'Contents/Resources'), { recursive: true });
  await writeFile(join(target, 'old-version'), 'retained-until-ack');
  await mkdir(join(candidate, 'Contents/MacOS'), { recursive: true });
  const binary = process.env.DESKTOP_VERIFY_EXE ?? resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  await copyFile(binary, join(candidate, 'Contents/MacOS/Desktop for Step Code'));
  await chmod(join(candidate, 'Contents/MacOS/Desktop for Step Code'), 0o755);
  await writeFile(join(candidate, 'Contents/Info.plist'), JSON.stringify({ CFBundleIdentifier: 'community.stepcode.desktop', CFBundleExecutable: 'Desktop for Step Code', CFBundleShortVersionString: '0.6.0' }));
  execFileSync('/usr/bin/plutil', ['-convert', 'xml1', join(candidate, 'Contents/Info.plist')]);
  await writeFile(join(candidate, 'Contents/Resources/macos-update.json'), JSON.stringify({ version }));
  await writeFile(join(candidate, 'new-version'), 'verified-candidate');
  const zip = join(root, 'candidate.zip');
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', candidate, zip]);
  const bytes = await readFile(zip);
  const name = `Desktop.for.Step.Code.${version}.arm64.zip`;
  const release = { version, tag: `v${version}`, name: 'Fixture', notes: '', url: `https://github.com/7oMB2006/desktop-for-step-code/releases/tag/v${version}`,
    installer: { name, size: bytes.length, inApp: true, url: `https://github.com/7oMB2006/desktop-for-step-code/releases/download/v${version}/${name}` } };
  const metadata = { version, arch: 'arm64', bundleIdentifier: 'community.stepcode.desktop', files: [{ url: name, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }] };
  await mkdir(join(resources, 'file-opening'), { recursive: true });
  await mkdir(join(resources, 'runtime/node'), { recursive: true });
  const packagedResources = process.env.DESKTOP_MACOS_RESOURCES;
  await copyFile(packagedResources ? join(packagedResources, 'runtime/node/node') : resolve('runtime/node/node'), join(resources, 'runtime/node/node'));
  await copyFile(packagedResources ? join(packagedResources, 'file-opening/macos-update-helper.cjs') : resolve('dist/file-opening/macos-update-helper.cjs'), join(resources, 'file-opening/macos-update-helper.cjs'));
  // Replace only the OS-launch boundary in this disposable fixture. Production
  // LaunchServices/Gatekeeper remains untouched; native discovery is checked separately.
  // This fixture checks actual extraction, quarantine, detached helper, parent exit,
  // atomic replacement and acknowledgement without opening a security dialog.
  const launcher = `#!/bin/sh\nexec "$(dirname "$0")/node" -e '${`const fs=require("node:fs"),p=require("node:path"),cp=require("node:child_process");const folder=p.dirname(process.execPath);const plan=JSON.parse(fs.readFileSync(p.join(folder,"plan.json")));let input="";process.stdin.on("data",x=>input+=x);process.stdin.on("end",()=>{const request=JSON.parse(input);if(request.path!==plan.target||fs.readFileSync(p.join(plan.target,"new-version"),"utf8")!=="verified-candidate"||!fs.existsSync(p.join(plan.backup,"old-version")))process.exit(2);const quarantine=cp.execFileSync("/usr/bin/xattr",["-p","com.apple.quarantine",plan.target],{encoding:"utf8"});if(!quarantine.includes("Desktop for Step Code"))process.exit(3);fs.writeFileSync(p.join(folder,"ack"),plan.token);process.stdout.write(JSON.stringify({pid:process.pid}));});`}'`;
  await writeFile(join(resources, 'file-opening/file-applications-macos'), launcher, { mode: 0o755 });
  const main = `import {MacUpdateDriver} from ${JSON.stringify(resolve('electron/macos-update-driver.ts'))};import {readFile,writeFile} from 'node:fs/promises';const release=${JSON.stringify(release)};const root=${JSON.stringify(root)};const driver=new MacUpdateDriver(root+'/cache',{resources:${JSON.stringify(resources)},target:${JSON.stringify(target)},quit:()=>process.exit(0),request:async url=>url.endsWith('mac-update.json')?new Response(JSON.stringify(${JSON.stringify(metadata)})):new Response(await readFile(root+'/candidate.zip'),{headers:{'content-length':String(release.installer.size)}})});await driver.download(release,new AbortController().signal,()=>{});await driver.verify();await driver.install();`;
  await build({ stdin: { contents: main.replace('const release=', '(async()=>{const release=') + '})().catch(e=>{console.error(e);process.exit(1)});', resolveDir: process.cwd(), sourcefile: 'mac-update-fixture.ts' }, outfile: join(root, 'fixture.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
  const child = spawn(process.execPath, [join(root, 'fixture.cjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
  assert.equal(await new Promise((done, fail) => { child.on('error', fail); child.on('exit', done); }), 0, output);
  const pending = JSON.parse(await readFile(join(root, 'cache/mac-pending.json'), 'utf8'));
  const deadline = Date.now() + 30000;
  let result; let finished = false;
  while (Date.now() < deadline) {
    result = JSON.parse(await readFile(join(pending.folder, 'result.json'), 'utf8').catch(() => 'null'));
    finished = await readFile(join(pending.folder, 'finished'), 'utf8').catch(() => '') === pending.token;
    if (result && finished) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.equal(result?.status, 'installed', JSON.stringify(result));
  assert.equal(finished, true, 'detached helper completes before fixture cleanup');
  assert.equal(await readFile(join(target, 'new-version'), 'utf8'), 'verified-candidate');
  await assert.rejects(stat(join(target, 'old-version')));
  assert.match(pending.download, /^mac-[a-f0-9-]{36}\.zip$/);
  await stat(join(root, 'cache/download-cache', pending.download));
  const cleanupMain = `import {acknowledgeMacUpdate} from ${JSON.stringify(resolve('electron/macos-update-driver.ts'))};import {stat} from 'node:fs/promises';(async()=>{if(await acknowledgeMacUpdate(${JSON.stringify(join(root, 'cache'))},${JSON.stringify(target)},${JSON.stringify(version)})!=='installed')throw Error('Acknowledgement rejected');const end=Date.now()+5000;while(Date.now()<end){try{await stat(${JSON.stringify(join(root, 'cache/mac-pending.json'))});}catch(e){if(e.code==='ENOENT')return;throw e;}await new Promise(r=>setTimeout(r,100));}throw Error('Cleanup timed out');})().catch(e=>{console.error(e);process.exitCode=1});`;
  await build({ stdin: { contents: cleanupMain, resolveDir: process.cwd(), sourcefile: 'mac-cleanup-fixture.ts' }, outfile: join(root, 'cleanup.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
  execFileSync(process.execPath, [join(root, 'cleanup.cjs')], { timeout: 10000 });
  await assert.rejects(stat(join(root, 'cache/download-cache', pending.download)), { code: 'ENOENT' });
  await assert.rejects(stat(pending.folder), { code: 'ENOENT' });
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/macos-updater.json', JSON.stringify({ status: 'passed', version, bytes: bytes.length, osLaunch: 'fixture', quarantine: 'preserved', originalProfile: 'unused' }, null, 2));
  console.log('macOS updater passed: actual download/hash/extraction, detached helper handshake, parent exit, same-volume replacement, quarantine and startup acknowledgement. OS launch uses a fixture.');
} finally { await rm(root, { recursive: true, force: true }); }
