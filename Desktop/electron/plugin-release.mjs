import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const maxEntries = 10000;
const maxBytes = 128 * 1024 * 1024;
const vcs = new Set(['.git', '.hg', '.svn']);
const development = new Set(['.cache', '.pytest_cache', '__pycache__', '.mypy_cache', '.ruff_cache',
  'coverage', 'test-results', 'playwright-report', '.ds_store']);
const sourceDirectories = new Set(['src', 'test', 'tests', 'scripts']);
const templates = /^\.env\.(?:example|sample|template|defaults)$/iu;
const secretFile = /^(?:\.env(?:\..+)?|\.npmrc|\.pypirc|auth\.json|credentials\.json|cookies?(?:\.(?:txt|json|sqlite|db))?|id_(?:rsa|dsa|ecdsa|ed25519)|.+\.(?:pem|p12|pfx|key))$/iu;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const packagePath = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  && !isAbsolute(value) && !/[:\\\0?#*]/u.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');

export function validateReleaseManifest(value) {
  if (!record(value) || value.schemaVersion !== 1
    || Object.keys(value).some(key => !['schemaVersion', 'files', 'runtimeDependencies'].includes(key)))
    throw new Error('release-invalid-manifest');
  if (value.files !== undefined && (!Array.isArray(value.files) || value.files.length === 0
    || value.files.length > 128 || value.files.some(path => !packagePath(path))
    || new Set(value.files).size !== value.files.length))
    throw new Error('release-invalid-manifest');
  const dependencies = value.runtimeDependencies === undefined ? [] : value.runtimeDependencies;
  if (!Array.isArray(dependencies) || dependencies.length > 8 || dependencies.some(item =>
    !record(item) || Object.keys(item).some(key => !['path', 'reason'].includes(key))
    || !packagePath(item.path) || item.path.split('/').at(-1) !== 'node_modules'
    || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 400)
    || new Set(dependencies.map(item => item.path)).size !== dependencies.length)
    throw new Error('release-invalid-manifest');
  return { schemaVersion: 1, ...(value.files ? { files: [...value.files] } : {}),
    runtimeDependencies: dependencies.map(item => ({ path: item.path, reason: item.reason.trim() })) };
}

export async function readReleaseManifest(root) {
  const path = join(root, 'dfsc.release.json');
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 65536) throw new Error('release-invalid-manifest');
    return validateReleaseManifest(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error('release-invalid-manifest');
  }
}

// This is a publication hygiene check, not a code audit or a malicious-code sandbox.
export async function auditPluginRelease(root, options = {}) {
  const issues = [], warnings = [];
  let entries = 0, files = 0, bytes = 0;
  const report = () => ({ version: 1, ok: issues.length === 0, entries, files, bytes, issues, warnings });
  const issue = (code, path) => {
    if (issues.length < 100) issues.push({ code, path });
  };
  const base = resolve(root);
  let manifest;
  try {
    const stat = await lstat(base);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(base) !== base)
      throw new Error('release-invalid-path');
    manifest = await readReleaseManifest(base);
    if (options.allowRuntimeDependencies !== undefined) {
      const override = validateReleaseManifest({ schemaVersion: 1,
        runtimeDependencies: options.allowRuntimeDependencies });
      manifest = { ...manifest, runtimeDependencies: override.runtimeDependencies };
    }
  } catch (error) {
    issue(error.message === 'release-invalid-manifest' ? error.message : 'release-invalid-path', '.');
    return report();
  }
  const allowed = new Set(manifest?.runtimeDependencies.map(item => item.path) ?? []);
  const seenDependencies = new Set();
  async function visit(path = '') {
    if (entries >= maxEntries) { issue('release-too-large', path || '.'); return; }
    if (bytes > maxBytes) return;
    let children;
    try { children = await readdir(path ? join(base, path) : base, { withFileTypes: true }); }
    catch { issue('release-invalid-path', path || '.'); return; }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const current = path ? `${path}/${child.name}` : child.name;
      const lowerName = child.name.toLowerCase();
      if (++entries > maxEntries) { issue('release-too-large', current); return; }
      if (!packagePath(current)) { issue('release-invalid-path', current); continue; }
      let stat;
      try { stat = await lstat(join(base, current)); }
      catch { issue('release-invalid-path', current); continue; }
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        issue('release-invalid-path', current);
        continue;
      }
      if (vcs.has(lowerName)) {
        issue('release-vcs', current);
        continue;
      }
      if (development.has(lowerName)) {
        issue('release-development-artifact', current);
        continue;
      }
      if (stat.isFile() && secretFile.test(child.name) && !templates.test(child.name)) {
        issue('release-secret-file', current);
        continue;
      }
      if (stat.isDirectory()) {
        if (lowerName === 'node_modules') {
          seenDependencies.add(current);
          if (![...allowed].some(path => current === path || current.startsWith(`${path}/`))) {
            issue('release-runtime-dependency', current);
            continue;
          }
          if (allowed.has(current)) warnings.push({ code: 'release-runtime-dependency-approved', path: current });
        }
        if (!path && sourceDirectories.has(lowerName))
          warnings.push({ code: 'release-source-layout', path: current });
        await visit(current);
      } else {
        files++;
        bytes += stat.size;
        if (bytes > maxBytes) { issue('release-too-large', current); return; }
      }
    }
  }
  await visit();
  for (const path of allowed) if (!seenDependencies.has(path)) issue('release-invalid-manifest', path);
  return report();
}

export async function releaseSourcePath(root, path) {
  if (!packagePath(path)) throw new Error('release-invalid-path');
  const base = resolve(root), target = resolve(base, path);
  const rel = relative(base, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('release-invalid-path');
  let current = base;
  for (const part of [undefined, ...rel.split(sep)]) {
    if (part !== undefined) current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('release-invalid-path');
  }
  if (await realpath(base) !== base || await realpath(target) !== target) throw new Error('release-invalid-path');
  return target;
}
