import { execFile } from 'node:child_process';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { createPatch } from 'diff';
import { parseToolPatch } from '../src/turn-changes';
import { redactDiffText, sensitiveDiffPath } from '../src/review-source';
import type { RepositoryDiff, RepositoryFile, RepositoryFileDiff } from '../src/contracts';

const exec = promisify(execFile);
const MAX_FILES = 200;
const MAX_TEXT = 180_000;
const empty = (state: RepositoryDiff['state']): RepositoryDiff =>
  ({ state, bases: [], files: [], added: 0, removed: 0, truncated: false });

async function git(cwd: string, args: string[], maxBuffer = 2 * 1024 * 1024) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  env.GIT_OPTIONAL_LOCKS = '0';
  const { stdout } = await exec('git', ['--literal-pathspecs', '-c', 'core.fsmonitor=false',
    '-c', 'core.pager=cat', ...args], { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer });
  return stdout;
}
const optional = async (cwd: string, args: string[]) => {
  try { return (await git(cwd, args)).trim(); } catch { return undefined; }
};
const diffFlags = ['--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=all'];

export function parseNumstat(output: string): Map<string, { added: number; removed: number; binary: boolean }> {
  const files = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (const row of output.split('\0')) {
    if (!row) continue;
    const first = row.indexOf('\t'); const second = row.indexOf('\t', first + 1);
    if (first < 0 || second < 0) throw new Error('Invalid Git statistics');
    const add = row.slice(0, first); const remove = row.slice(first + 1, second);
    const path = row.slice(second + 1);
    if (!path || !/^(?:\d+|-)$/.test(add) || !/^(?:\d+|-)$/.test(remove)) throw new Error('Invalid Git statistics');
    const binary = add === '-' || remove === '-';
    const added = binary ? 0 : Number(add); const removed = binary ? 0 : Number(remove);
    if (!Number.isSafeInteger(added) || !Number.isSafeInteger(removed)) throw new Error('Invalid Git statistics');
    files.set(path, { added, removed, binary });
  }
  return files;
}

// Check every path component before reading untracked content; Git's metadata
// may name links, junctions or files which have disappeared since enumeration.
async function regularPath(root: string, path: string) {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) ||
    rel.split(sep).some(part => part.toLowerCase() === '.git')) throw new Error('Unsupported file');
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Unsupported file');
  }
  if (!(await lstat(target)).isFile() || resolve(await realpath(target)).toLowerCase() !== target.toLowerCase())
    throw new Error('Unsupported file');
  return target;
}

async function untrackedText(root: string, path: string) {
  const target = await regularPath(root, path);
  const handle = await open(target, 'r');
  try {
    const info = await handle.stat();
    const pathInfo = await lstat(target);
    if (!info.isFile() || info.ino !== pathInfo.ino || info.dev !== pathInfo.dev) throw new Error('Unsupported file');
    if (info.size > MAX_TEXT) return { reason: 'too-large' as const };
    const bytes = Buffer.alloc(MAX_TEXT + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_TEXT) return { reason: 'too-large' as const };
    const data = bytes.subarray(0, bytesRead);
    const text = data.toString('utf8');
    if (text.includes('\0') || !Buffer.from(text).equals(data)) return { reason: 'binary' as const };
    return { text };
  } finally { await handle.close(); }
}

export async function repositoryDiff(cwd: string, selected?: string): Promise<RepositoryDiff> {
  let root: string;
  try {
    if ((await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return empty('not-git');
    root = await realpath((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
  } catch (error) {
    return empty((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unavailable' : 'not-git');
  }
  const head = await optional(root, ['rev-parse', '--verify', 'HEAD']);
  if (!head) return { ...empty('unborn'), root };
  const branch = await optional(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']) ?? head.slice(0, 8);
  const refs = (await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/'])).trim().split('\n')
    .filter(ref => ref && !ref.endsWith('/HEAD')).map(ref => ref.replace(/^refs\/(?:heads|remotes)\//, ''));
  const bases = [...new Set([...refs, 'HEAD'])];
  const defaultBase = await optional(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const base = selected ?? [defaultBase, 'origin/main', 'main', 'origin/master', 'master', 'HEAD']
    .find(ref => ref && bases.includes(ref))!;
  if (!bases.includes(base) || base.length > 512 || base.startsWith('-')) throw new Error('Invalid comparison base');
  const revision = await optional(root, ['merge-base', 'HEAD', base]);
  if (!revision || !/^[0-9a-f]{40,64}$/.test(revision)) throw new Error('Comparison branches have no common ancestor');
  const stats = parseNumstat(await git(root, ['diff', ...diffFlags, '--numstat', '-z', revision, '--']));
  const names = (await git(root, ['diff', ...diffFlags, '--name-status', '-z', revision, '--'])).split('\0');
  const files: RepositoryFile[] = [];
  for (let index = 0; index < names.length - 1; index += 2) {
    const status = names[index]; const path = names[index + 1];
    if (!['M', 'A', 'D', 'T'].includes(status) || !stats.has(path)) continue;
    files.push({ path, status: status === 'T' ? 'M' : status as 'M' | 'A' | 'D', ...stats.get(path)! });
  }
  const known = new Set(files.map(file => file.path));
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const truncated = files.length + untracked.filter(path => !known.has(path)).length > MAX_FILES;
  const displayed = files.slice(0, MAX_FILES);
  for (const path of untracked) {
    if (displayed.length >= MAX_FILES) break;
    if (known.has(path)) continue;
    if (sensitiveDiffPath(path)) {
      displayed.push({ path, status: '?', added: 0, removed: 0, binary: false, unavailable: true });
      continue;
    }
    try {
      const content = await untrackedText(root, path);
      const added = content.text ? content.text.split('\n').length - Number(content.text.endsWith('\n')) : 0;
      displayed.push({ path, status: '?', added, removed: 0, binary: content.reason === 'binary',
        unavailable: content.reason === 'too-large' });
    } catch {
      // Links and unreadable files are named, but their content is never read.
      displayed.push({ path, status: '?', added: 0, removed: 0, binary: false, unavailable: true });
    }
  }
  return { state: 'ready', root, branch, bases, base, revision, files: displayed,
    added: displayed.reduce((sum, file) => sum + file.added, 0),
    removed: displayed.reduce((sum, file) => sum + file.removed, 0), truncated };
}

export async function repositoryFileDiff(cwd: string, base: string, path: string): Promise<RepositoryFileDiff> {
  const state = await repositoryDiff(cwd, base);
  const file = state.files.find(file => file.path === path);
  if (state.state !== 'ready' || !state.root || !state.revision || !file) throw new Error('Changed file not found; refresh the comparison');
  const result: RepositoryFileDiff = { path, added: file.added, removed: file.removed, rows: [] };
  if (sensitiveDiffPath(path)) return { ...result, reason: 'sensitive' };
  if (file.binary) return { ...result, reason: 'binary' };
  let patch: string;
  try {
    if (file.status === '?') {
      const content = await untrackedText(state.root, path);
      if (content.reason) return { ...result, reason: content.reason };
      patch = createPatch(path, '', content.text ?? '');
    } else {
      // Refuse worktree links before asking Git for content. Missing paths are
      // expected for deletions, whose removed text comes from the Git object.
      if (file.status !== 'D') await regularPath(state.root, path);
      patch = await git(state.root, ['diff', ...diffFlags, '--unified=3', state.revision, '--', path], MAX_TEXT);
    }
  } catch (error) {
    return { ...result, reason: (error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'too-large' : 'unsupported' };
  }
  const edit = parseToolPatch(patch, path);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(patch)) return { ...result, reason: 'sensitive' };
  return edit ? { path, added: edit.added, removed: edit.removed, rows: edit.rows.map(row => ({ ...row, text: redactDiffText(row.text) })) }
    : { ...result, reason: patch.includes('Binary files') ? 'binary' : 'no-text-change' };
}
