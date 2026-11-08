import { lstat, realpath, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dataOnlyThemeFingerprint, digest, object, optionalFile, packageFingerprint, readReceipts, writePrivateData, writePrivateJson,
  writeReceipts, PluginFileError } from './plugin-files.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = () => { throw new PluginFileError('update-recovery-required'); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/u.test(value);
const receiptValid = value => object(value) && uuid(value.instance) && hash(value.fingerprint)
  && typeof value.folder === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/u.test(value.folder)
  && typeof value.id === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(value.id)
  && typeof value.source === 'string' && value.source.length <= 128
  && typeof value.marketplace === 'string' && value.marketplace.length <= 80 && value.state === 'installed';
const journalPath = 'desktop-plugins/update-transaction.json';
const bindingPath = receipt => `desktop-plugins/bindings/${receipt.folder}.json`;
const parse = bytes => { try { return JSON.parse(bytes.toString('utf8')); } catch { fail(); } };

// Journal entries contain binding metadata only. Settings snapshots (including secrets)
// never move, and installation instance/revision identities survive the replacement.
export async function updateBinding(root, receipt) {
  const bytes = await optionalFile(root, bindingPath(receipt), 65536);
  if (!bytes) return null;
  const binding = parse(bytes);
  const keys = ['version', 'instance', 'id', 'revoked', 'fingerprint', 'schemaHash', 'revision', 'contentHash'];
  if (!object(binding) || Object.keys(binding).some(key => !keys.includes(key))
    || binding.version !== 1 || binding.instance !== receipt.instance || binding.id !== receipt.id
    || !binding.revoked && (binding.fingerprint !== receipt.fingerprint
      || !['schemaHash', 'revision', 'contentHash'].every(key => hash(binding[key]))))
    throw new PluginFileError('stale-configuration');
  return binding;
}
const nextBinding = journal => journal.binding && !journal.binding.revoked
  ? { ...journal.binding, fingerprint: journal.next.fingerprint } : journal.binding;

async function directory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || resolve(await realpath(path)) !== resolve(path)) fail();
}
async function paths(root, journal) {
  await directory(root);
  await directory(join(root, 'desktop-plugins'));
  await directory(join(root, 'plugins'));
  const staging = join(root, 'desktop-plugins', `update-${journal.transaction}`);
  try { await directory(staging); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { staging, target: join(root, 'plugins', journal.previous.folder),
    candidate: join(staging, 'candidate'), backup: join(staging, 'previous'), discard: join(staging, 'discard') };
}
async function fingerprint(path) {
  try { await directory(path); return await packageFingerprint(path); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function observed(root, journal) {
  const receipts = await readReceipts(root);
  const index = receipts.installations.findIndex(item => item.folder === journal.previous.folder);
  if (index < 0 || ![journal.previous, journal.next].some(item => equal(item, receipts.installations[index]))) fail();
  const bytes = await optionalFile(root, bindingPath(journal.previous), 65536);
  const binding = bytes ? parse(bytes) : null;
  if (![journal.binding, nextBinding(journal)].some(item => equal(item, binding))) fail();
  return { receipts, index, binding };
}
async function assertJournal(root, fingerprint) {
  const bytes = await optionalFile(root, journalPath, 65536);
  if (!bytes || digest(bytes) !== fingerprint) fail();
}
async function cleanup(root, journal, staging, expectedJournal) {
  // Every recursive removal is confined to one validated, private transaction directory.
  await paths(root, journal);
  if (expectedJournal !== undefined) await assertJournal(root, expectedJournal);
  await rm(join(root, journalPath), { force: true });
  await rm(staging, { recursive: true, force: true, maxRetries: 3 });
}
function readJournal(bytes) {
  const journal = parse(bytes);
  if (!object(journal) || journal.version !== 1 || !uuid(journal.transaction)
    || !['prepared', 'committed'].includes(journal.phase)
    || !receiptValid(journal.previous) || !receiptValid(journal.next)
    || journal.next.fingerprint === journal.previous.fingerprint
    || !equal({ ...journal.previous, fingerprint: journal.next.fingerprint }, journal.next)
    || journal.binding !== null && (!object(journal.binding) || journal.binding.version !== 1
      || journal.binding.instance !== journal.previous.instance || journal.binding.id !== journal.previous.id
      || !journal.binding.revoked && (journal.binding.fingerprint !== journal.previous.fingerprint
        || !['schemaHash', 'revision', 'contentHash'].every(key => hash(journal.binding[key]))))) fail();
  return journal;
}
export async function inspectPluginUpdate(root) {
  const bytes = await optionalFile(root, journalPath, 65536);
  if (!bytes) return;
  return { id: readJournal(bytes).previous.id, fingerprint: digest(bytes) };
}
export async function recoverPluginUpdate(root, options = {}) {
  const bytes = await optionalFile(root, journalPath, 65536);
  if (options.expectedJournal !== undefined
    && (!hash(options.expectedJournal) || !bytes || digest(bytes) !== options.expectedJournal)) fail();
  if (!bytes) return;
  if (options.allowRecovery === false) fail();
  const journalFingerprint = digest(bytes);
  const journal = readJournal(bytes);
  const location = await paths(root, journal);
  const state = await observed(root, journal);
  const current = await fingerprint(location.target);
  if (journal.phase === 'committed') {
    if (current !== journal.next.fingerprint || !equal(state.receipts.installations[state.index], journal.next)
      || !equal(state.binding, nextBinding(journal))) fail();
    await cleanup(root, journal, location.staging, journalFingerprint);
    return;
  }
  const backup = await fingerprint(location.backup);
  if (backup !== undefined && backup !== journal.previous.fingerprint) fail();
  if (backup) {
    if (current !== undefined) {
      if (current !== journal.next.fingerprint || await fingerprint(location.discard) !== undefined) fail();
      await assertJournal(root, journalFingerprint);
      await rename(location.target, location.discard);
    }
    await assertJournal(root, journalFingerprint);
    await rename(location.backup, location.target);
  } else if (current !== journal.previous.fingerprint) fail();
  if (await fingerprint(location.target) !== journal.previous.fingerprint) fail();
  await assertJournal(root, journalFingerprint);
  if (!equal(state.binding, journal.binding)) await writePrivateData(root, bindingPath(journal.previous), journal.binding);
  state.receipts.installations[state.index] = journal.previous;
  await writeReceipts(root, state.receipts);
  await cleanup(root, journal, location.staging, journalFingerprint);
}

export async function applyPluginUpdate(root, transaction, options = {}) {
  if (await optionalFile(root, journalPath, 65536)) fail();
  const journal = { version: 1, ...transaction, phase: 'prepared' };
  const location = await paths(root, journal);
  const state = await observed(root, journal);
  if (!equal(state.receipts.installations[state.index], journal.previous)
    || !equal(state.binding, journal.binding)
    || await fingerprint(location.target) !== journal.previous.fingerprint
    || await fingerprint(location.candidate) !== journal.next.fingerprint) throw new PluginFileError('stale');
  if (options.preserveRuntime === true
    && (await dataOnlyThemeFingerprint(location.target, journal.previous.id) !== journal.previous.fingerprint
      || await dataOnlyThemeFingerprint(location.candidate, journal.next.id) !== journal.next.fingerprint))
    throw new PluginFileError('stale');
  if (await optionalFile(root, journalPath, 65536)) fail();
  await writePrivateJson(root, 'update-transaction.json', journal);
  try {
    await rename(location.target, location.backup);
    await rename(location.candidate, location.target);
    if (await fingerprint(location.target) !== journal.next.fingerprint) throw new PluginFileError('stale');
    const rechecked = await observed(root, journal);
    if (!equal(rechecked.receipts.installations[rechecked.index], journal.previous)
      || !equal(rechecked.binding, journal.binding)) throw new PluginFileError('stale');
    if (journal.binding && !journal.binding.revoked)
      await writePrivateData(root, bindingPath(journal.previous), nextBinding(journal));
    rechecked.receipts.installations[rechecked.index] = journal.next;
    await writeReceipts(root, rechecked.receipts);
    await writePrivateJson(root, 'update-transaction.json', { ...journal, phase: 'committed' });
  } catch (error) {
    try { await recoverPluginUpdate(root); } catch { throw new PluginFileError('update-recovery-required'); }
    throw error;
  }
  try { await cleanup(root, journal, location.staging); return []; }
  catch { return ['Plugin updated; temporary update files could not be removed.']; }
}
