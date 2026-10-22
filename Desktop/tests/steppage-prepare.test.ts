import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StepPagePreparer } from '../electron/steppage-prepare';

const bytes = Buffer.from("if(process.argv.includes('--version')) console.log('1.0.0');");
const artifact = { url: 'https://fixture.invalid/steppage.mjs', sha256: createHash('sha256').update(bytes).digest('hex'), version: '1.0.0' };
async function fixture(t: any, request: (...args: any[]) => Promise<Response> = async () => new Response(bytes), data = artifact) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-steppage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, service: new StepPagePreparer(root, process.execPath, request, data) };
}
test('StepPage explicit preparation downloads verified bytes, isolates probes, applies and reuses without downloading', async t => {
  let downloads = 0, applied = 0;
  const { service } = await fixture(t, async (_url, options) => {
    downloads++; assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return new Response(bytes);
  });
  assert.equal((await service.snapshot()).status, 'missing');
  const apply = async (bundle: string, home: string) => {
    applied++; assert.equal(bundle, service.bundlePath); assert.equal(home, service.homePath);
    assert.deepEqual(await readFile(bundle), bytes);
  };
  assert.equal((await service.prepare(apply)).status, 'ready');
  assert.equal((await service.snapshot()).installed, true);
  assert.equal((await service.prepare(apply)).status, 'ready');
  assert.equal(downloads, 1); assert.equal(applied, 2);
});
test('StepPage integrity rejection never executes or applies downloaded code; retry can recover', async t => {
  let good = false, applied = 0;
  const { service, root } = await fixture(t, async () => new Response(good ? bytes : 'throw Error("untrusted")'));
  assert.equal((await service.prepare(async () => { applied++; })).error, 'integrity');
  assert.equal((await service.snapshot()).installed, false);
  assert.equal(applied, 0);
  assert.deepEqual(await readdir(join(root, 'steppage/bin')), []);
  good = true;
  assert.equal((await service.prepare(async () => { applied++; })).status, 'ready');
  assert.equal(applied, 1);
});
test('StepPage network, excessive size, validation and configuration failures stay retryable and sanitized', async t => {
  const { service: offline } = await fixture(t, async () => { throw Error('private credential'); });
  assert.deepEqual((await offline.prepare(async () => {})).error, 'download');
  const { service: large } = await fixture(t, async () => new Response(Buffer.alloc(4 * 1024 * 1024 + 1)));
  assert.equal((await large.prepare(async () => {})).error, 'integrity');
  const invalid = Buffer.from("throw Error('private credential')");
  const { service: failed, root } = await fixture(t, async () => new Response(invalid),
    { ...artifact, sha256: createHash('sha256').update(invalid).digest('hex') });
  assert.equal((await failed.prepare(async () => {})).error, 'validation');
  assert.deepEqual(await readdir(join(root, 'steppage/bin')), []);
  const { service: conflict } = await fixture(t);
  assert.equal((await conflict.prepare(async () => { throw Error('private config'); })).error, 'configuration');
  assert.equal((await conflict.snapshot()).installed, true);
  assert.equal((await conflict.prepare(async () => {})).status, 'ready');
});
test('StepPage preparation is single-flight and rejects linked storage', async t => {
  let release!: (value: Response) => void;
  const { service, root } = await fixture(t, () => new Promise(resolve => { release = resolve; }));
  const first = service.prepare(async () => {});
  assert.equal(service.prepare(async () => { throw Error('not used'); }), first);
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await service.snapshot()).status, 'preparing');
  release(new Response(bytes)); await first;
  const external = join(root, 'external');
  await mkdir(external);
  const linked = join(root, 'linked');
  await mkdir(linked);
  await symlink(external, join(linked, 'steppage'), process.platform === 'win32' ? 'junction' : 'dir');
  const unsafe = new StepPagePreparer(linked, process.execPath, async () => { throw Error('must not fetch'); }, artifact);
  assert.equal((await unsafe.prepare(async () => {})).error, 'storage');
  assert.deepEqual(await readdir(external), []);
});
test('StepPage probes never inherit credentials and use the Desktop-only home', async t => {
  const script = Buffer.from("if(process.env.STEPPAGE_FIXTURE_SECRET || !process.env.HOME?.endsWith('home') || process.env.HOME!==process.env.USERPROFILE) process.exit(1); console.log('1.0.0');");
  process.env.STEPPAGE_FIXTURE_SECRET = 'fixture';
  t.after(() => { delete process.env.STEPPAGE_FIXTURE_SECRET; });
  const { service } = await fixture(t, async () => new Response(script),
    { ...artifact, sha256: createHash('sha256').update(script).digest('hex') });
  assert.equal((await service.prepare(async () => {})).status, 'ready');
});
