import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

// Replace only Electron's app metadata; run the actual writer and filesystem.
const compiledRoot = await mkdtemp(join(tmpdir(), 'crash-log-module-'));
after(() => rm(compiledRoot, { recursive: true, force: true }));
const modulePath = join(compiledRoot, 'crash-log.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../electron/crash-log.ts', import.meta.url))],
  outfile: modulePath, bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name: 'crash-metadata-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^electron$/ }, () => ({ path: fileURLToPath(new URL('./fixtures/crash-log-app.ts', import.meta.url)) }));
  } }],
});
const { CrashLog } = await import(pathToFileURL(modulePath).href);
async function fixture(run: (log: any, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-crash-redaction-'));
  try { await run(new CrashLog(root), root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function content(root: string) {
  const files = await readdir(root);
  const logs = files.filter(name => name.endsWith('.log'));
  assert.equal(logs.length, 1, 'The actual writer must publish exactly one crash record');
  assert.equal(files.some(name => name.endsWith('.tmp')), false);
  return readFile(join(root, logs[0]), 'utf8');
}

test('crash records redact credentials from error, stack and nested details before writing', () => fixture(async (log, root) => {
  const markers = ['fixture-error-key', 'fixture-stack-token', 'fixture-detail-password', 'fixture-nested-cookie', 'fixture-oauth-access'];
  const error = new Error(`Provider failed: api_key=${markers[0]}`);
  Object.defineProperty(error, 'stack', { value: `Error: request failed\nAuthorization: Bearer ${markers[1]}\n    at safeFrame (fixture.js:12:4)`, configurable: true });
  await log.record('runtime-exit', error, { exitCode: 1, password: markers[2],
    metadata: { safe: 'keep-diagnostic', Cookie: markers[3], auth: { access: markers[4], expires: 1000 } } });
  const text = await content(root);
  for (const marker of markers) assert.equal(text.includes(marker), false, marker);
  assert.match(text, /\[redacted\]/);
  assert.match(text, /safeFrame/);
  assert.match(text, /keep-diagnostic/);
  assert.match(text, /exitCode: 1/);
}));

test('crash records retain ordinary credential-conflict diagnostics and safe metadata', () => fixture(async (log, root) => {
  log.setPhase('runtime staged');
  await log.record('startup-failure', new Error('Conflicting desktop credential files; migration requires manual review'),
    { exitCode: 2, signal: null, reason: 'configuration conflict' });
  const text = await content(root);
  assert.match(text, /error: Error: Conflicting desktop credential files; migration requires manual review/);
  assert.match(text, /phase: runtime staged/);
  assert.match(text, /version: 0\.6\.0/);
  assert.match(text, /packaged: false/);
  assert.match(text, /exitCode: 2/);
  assert.match(text, /configuration conflict/);
  assert.match(text, /userData: isolated-user-data/);
}));

test('URL credentials and authentication query values never reach a crash file', () => fixture(async (log, root) => {
  await log.record('request-failure', 'Fetch failed https://fixture-user:fixture-url-pass@example.invalid/path?access_token=fixture-query-token&mode=preview', {
    target: 'https://example.invalid/path?api%5Fkey=fixture-encoded-query&safe=1',
    response: 'Set-Cookie: sid=fixture-session-cookie; HttpOnly',
  });
  const text = await content(root);
  for (const marker of ['fixture-user', 'fixture-url-pass', 'fixture-query-token', 'fixture-encoded-query', 'fixture-session-cookie'])
    assert.equal(text.includes(marker), false, marker);
  assert.match(text, /example\.invalid/);
  assert.match(text, /mode=preview/);
}));

test('encoded credential labels are redacted without changing ordinary error lines', () => fixture(async (log, root) => {
  await log.record('failure', 'api&#95;key=fixture-entity-key\nSafe explanatory line', {
    detail: 'access\\u005ftoken=fixture-unicode-token',
    stderrTail: 'STEP_API_KEY=fixture-env-value\nworker finished',
  });
  const text = await content(root);
  for (const marker of ['fixture-entity-key', 'fixture-unicode-token', 'fixture-env-value']) assert.equal(text.includes(marker), false, marker);
  assert.match(text, /Safe explanatory line/);
  assert.match(text, /worker finished/);
}));

test('structured sensitive keys are replaced without invoking custom serializers', () => fixture(async (log, root) => {
  let calls = 0;
  const value = { nested: { token: 'fixture-structural-token' }, toJSON() { calls++; return 'fixture-serializer-key'; } };
  await log.record('failure', { reason: 'safe-object', credentials: value }, { payload: value });
  const text = await content(root);
  assert.equal(calls, 0, 'Custom toJSON is not a trusted serialization boundary');
  assert.equal(text.includes('fixture-structural-token'), false);
  assert.equal(text.includes('fixture-serializer-key'), false);
  assert.match(text, /safe-object/);
}));

test('cyclic details and throwing getters cannot prevent a safe crash record', () => fixture(async (log, root) => {
  const circular: any = { safe: 'cycle-diagnostic' }; circular.self = circular;
  const details: any = { circular };
  Object.defineProperty(details, 'hostile', { enumerable: true, get() { throw new Error('fixture-getter-key'); } });
  await assert.doesNotReject(log.record('failure', new Error('safe failure'), details));
  const text = await content(root);
  assert.match(text, /safe failure/);
  assert.match(text, /cycle-diagnostic/);
  assert.equal(text.includes('fixture-getter-key'), false);
}));

test('large records are bounded and credential values beyond the cutoff are not emitted', () => fixture(async (log, root) => {
  await log.record('failure', new Error('x'.repeat(200000) + ' api_key=fixture-long-key'), { rows: Array(10000).fill('diagnostic') });
  const text = await content(root);
  assert.ok(Buffer.byteLength(text) < 128 * 1024, 'Crash diagnostics must have a bounded output size');
  assert.equal(text.includes('fixture-long-key'), false);
}));

test('non-ASCII detail records keep the final file within the byte budget', () => fixture(async (log, root) => {
  await log.record('failure', new Error('安全故障'), Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [`field${index}`, '界'.repeat(16000)])));
  assert.ok(Buffer.byteLength(await content(root)) <= 64 * 1024, 'Final log size is bounded in UTF-8 bytes');
}));

test('native lazy stack formatting never executes a custom prepareStackTrace hook', () => fixture(async (log, root) => {
  const previous = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
  let calls = 0;
  try {
    Object.defineProperty(Error, 'prepareStackTrace', { configurable: true, writable: true,
      value: () => { calls++; return 'fixture-stack-hook-value'; } });
    const installed = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
    await log.record('failure', new Error('safe lazy stack'));
    assert.deepEqual(Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace'), installed);
    const text = await content(root);
    assert.equal(calls, 0);
    assert.equal(text.includes('fixture-stack-hook-value'), false);
    assert.match(text, /safe lazy stack/);
  } finally {
    if (previous) Object.defineProperty(Error, 'prepareStackTrace', previous);
    else Reflect.deleteProperty(Error, 'prepareStackTrace');
  }
}));

test('ordinary lazy errors retain real stack frames without invoking error accessors', () => fixture(async (log, root) => {
  const error = new Error('ordinary lazy failure');
  let calls = 0;
  Object.defineProperty(error, 'name', { get() { calls++; return 'fixture-name-getter'; } });
  await log.record('failure', error);
  const text = await content(root);
  assert.equal(calls, 0);
  assert.match(text, /ordinary lazy failure/);
  assert.match(text, /\n\s+at /);
  assert.equal(text.includes('fixture-name-getter'), false);
}));

test('userinfo cut off before its at-sign is not published', () => fixture(async (log, root) => {
  await log.record('failure', 'x'.repeat(15960) + ' https://fixture-cutoff-user:fixture-cutoff-password' + 'p'.repeat(1000) + '@example.invalid/');
  const text = await content(root);
  assert.equal(text.includes('fixture-cutoff-user'), false);
  assert.equal(text.includes('fixture-cutoff-password'), false);
  assert.match(text, /\[truncated\]/);
}));

test('proxy diagnostics are rejected without invoking traps', () => fixture(async (log, root) => {
  let calls = 0;
  const proxy = new Proxy({}, { ownKeys() { calls++; return []; },
    getOwnPropertyDescriptor() { calls++; return undefined; }, getPrototypeOf() { calls++; return Error.prototype; } });
  await log.record('failure', proxy, { nested: proxy });
  assert.equal(calls, 0);
  assert.match(await content(root), /\[unavailable\]/);
}));

test('quoted authentication values crossing the text cutoff are fully redacted', () => fixture(async (log, root) => {
  await log.record('failure', 'password="fixture-cutoff-one fixture-cutoff-two ' + 's'.repeat(20000) + '"');
  const text = await content(root);
  assert.equal(text.includes('fixture-cutoff-one'), false);
  assert.equal(text.includes('fixture-cutoff-two'), false);
}));

test('custom stack getters remain non-throwing and are never invoked', () => fixture(async (log, root) => {
  let calls = 0;
  const error = new Error('safe custom stack');
  Object.defineProperty(error, 'stack', { configurable: true, get() { calls++; return 'fixture-custom-stack'; } });
  await log.record('failure', error);
  assert.equal(calls, 0);
  assert.match(await content(root), /safe custom stack/);
}));

test('immutable global stack formatters fail closed and retain the error message', () => fixture(async (_log, root) => {
  const result = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('./fixtures/crash-log-immutable.mjs', import.meta.url)), modulePath, root],
    { timeout: 10000 });
  assert.equal(result.stdout.trim(), 'hook calls: 0');
  const text = await content(root);
  assert.match(text, /safe immutable formatter/);
  assert.match(text, /stack: \(none\)/);
}));

test('encoded structured credential keys and several inline fields are all redacted', () => fixture(async (log, root) => {
  await log.record('failure', 'Request failed: api_key=fixture-inline-one password="fixture inline two" token=fixture-inline-three', {
    nested: { 'api&#95;key': 'fixture-encoded-field', 'access\\u005ftoken': 'fixture-escaped-field' },
  });
  const text = await content(root);
  for (const marker of ['fixture-inline-one', 'fixture inline two', 'fixture-inline-three', 'fixture-encoded-field', 'fixture-escaped-field'])
    assert.equal(text.includes(marker), false, marker);
}));

test('encoded authentication containers redact every nested value structurally', () => fixture(async (log, root) => {
  await log.record('failure', 'safe authentication container', {
    'auth&#101;ntication': { access: 'fixture-encoded-access with spaces', refresh: 'fixture-encoded-refresh' },
    nested: { 'auth\\u0065ntication': { access: 'fixture-escaped-access with spaces', refresh: 'fixture-escaped-refresh' } },
  });
  const text = await content(root);
  for (const marker of ['fixture-encoded-access', 'fixture-encoded-refresh', 'fixture-escaped-access', 'fixture-escaped-refresh'])
    assert.equal(text.includes(marker), false, marker);
}));

test('filesystem failures remain non-throwing and do not change caller data', () => fixture(async (_log, root) => {
  const blocker = join(root, 'not-a-directory'); await writeFile(blocker, 'preserve');
  const error = new Error('api_key=fixture-preserved-source');
  const details = { token: 'fixture-preserved-detail' };
  await assert.doesNotReject(new CrashLog(blocker).record('failure', error, details));
  assert.equal(await readFile(blocker, 'utf8'), 'preserve');
  assert.equal(error.message, 'api_key=fixture-preserved-source');
  assert.deepEqual(details, { token: 'fixture-preserved-detail' });
}));
