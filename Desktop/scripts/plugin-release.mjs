import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditPluginRelease, readReleaseManifest, releaseSourcePath, validateReleaseManifest } from '../electron/plugin-release.mjs';

export async function stagePluginRelease(source, output, options = {}) {
  const root = resolve(source), target = resolve(output);
  const overlap = (parent, child) => {
    const path = relative(parent, child);
    return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
  };
  if (overlap(root, target) || overlap(target, root)) throw new Error('release-overlapping-path');
  const manifest = options.manifest === undefined ? await readReleaseManifest(root)
    : validateReleaseManifest(options.manifest);
  if (!manifest?.files) throw new Error('release-files-required');
  const files = [...manifest.files].sort();
  if (files.some((path, index) => files.slice(0, index).some(parent => path.startsWith(`${parent}/`))))
    throw new Error('release-overlapping-files');
  // Validate all explicitly selected paths before creating an output directory.
  const sources = await Promise.all(files.map(path => path === 'dfsc.release.json' && options.manifest !== undefined
    ? undefined : releaseSourcePath(root, path)));
  const canonicalDirectory = async path => {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path)
      throw new Error('release-invalid-path');
    return stat;
  };
  const parent = dirname(target), parentIdentity = await canonicalDirectory(parent);
  const assertParent = async () => {
    const stat = await canonicalDirectory(parent);
    if (stat.dev !== parentIdentity.dev || stat.ino !== parentIdentity.ino) throw new Error('release-output-changed');
  };
  let outputIdentity;
  const assertOwnedOutput = async () => {
    await assertParent();
    const stat = await canonicalDirectory(target);
    if (!outputIdentity || stat.dev !== outputIdentity.dev || stat.ino !== outputIdentity.ino)
      throw new Error('release-output-changed');
  };
  await assertParent();
  await mkdir(target, { recursive: false });
  try {
    outputIdentity = await canonicalDirectory(target);
    await assertOwnedOutput();
    for (let index = 0; index < files.length; index++) {
      if (sources[index] === undefined) continue;
      const destination = join(target, files[index]);
      await mkdir(dirname(destination), { recursive: true });
      await cp(sources[index], destination, { recursive: true, force: false,
        errorOnExist: true, dereference: false, verbatimSymlinks: true });
    }
    if (options.manifest !== undefined || !files.includes('dfsc.release.json')) await writeFile(join(target, 'dfsc.release.json'),
      `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    const report = await auditPluginRelease(target);
    if (!report.ok) {
      const error = new Error('release-check-failed');
      error.report = report;
      throw error;
    }
    await assertOwnedOutput();
    return report;
  } catch (error) {
    // A replaced or aliased path must never authorize recursive cleanup.
    if (outputIdentity) {
      await assertOwnedOutput();
      await rm(target, { recursive: true, force: true, maxRetries: 3 });
    }
    throw error;
  }
}

async function main() {
  const [command, source, output, flag, manifestPath] = process.argv.slice(2);
  if (!source || !isAbsolute(source) || !['check', 'stage'].includes(command)
    || command === 'check' && process.argv.length !== 4
    || command === 'stage' && (!output || !isAbsolute(output) || ![5, 7].includes(process.argv.length)
      || process.argv.length === 7 && (flag !== '--manifest' || !isAbsolute(manifestPath ?? ''))))
    throw new Error('Usage: node scripts/plugin-release.mjs check <absolute-directory> | stage <absolute-source> <new-absolute-output> [--manifest <absolute-json>]');
  const options = {};
  if (manifestPath) {
    try {
      const stat = await lstat(manifestPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('invalid');
      options.manifest = validateReleaseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
    } catch { throw new Error('release-invalid-manifest'); }
  }
  const report = command === 'check' ? await auditPluginRelease(source) : await stagePluginRelease(source, output, options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify(error.report ?? { error: error.message }));
    process.exitCode = 1;
  });
}
