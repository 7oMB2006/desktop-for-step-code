import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile, mkdir, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StepPagePreparer } from '../electron/steppage-prepare';

const bytes = Buffer.from("if(process.argv.includes('--version')) console.log('1.0.0');");
const artifact = { url: 'https://fixture.invalid/steppage.mjs', sha256: createHash('sha256').update(bytes).digest('hex'), version: '1.0.0' };
const removeLink = (path: string) => process.platform === 'win32' ? rmdir(path) : rm(path, { force: true });
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
  const stepLink = join(linked, 'steppage');
  await symlink(external, stepLink, process.platform === 'win32' ? 'junction' : 'dir');
  let stepLinkRemoved = false;
  t.after(async () => { if (!stepLinkRemoved) await removeLink(stepLink).catch((error: any) => { if (error.code !== 'ENOENT') throw error; }); });
  const unsafe = new StepPagePreparer(linked, process.execPath, async () => { throw Error('must not fetch'); }, artifact);
  assert.equal((await unsafe.prepare(async () => {})).error, 'storage');
  assert.deepEqual(await readdir(external), []);
  await removeLink(stepLink); stepLinkRemoved = true;
});
test('StepPage rejects redirected storage before download, execution or configuration', async t => {
  for (const location of ['steppage', 'bin', 'home', 'ancestor'] as const) {
    const root = await mkdtemp(join(tmpdir(), `desktop-steppage-${location}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const outside = join(root, 'outside'); await mkdir(outside);
    const owned = join(root, 'owned'); await mkdir(owned);
    let serviceRoot = owned;
    let link = join(owned, 'steppage');
    if (location === 'bin' || location === 'home') { await mkdir(join(owned, 'steppage')); link = join(owned, 'steppage', location); }
    if (location === 'ancestor') { link = join(owned, 'redirect'); serviceRoot = join(link, 'missing-profile'); }
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    let linkRemoved = false;
    t.after(async () => { if (!linkRemoved) await removeLink(link).catch((error: any) => { if (error.code !== 'ENOENT') throw error; }); });
    assert.equal(await realpath(link), await realpath(outside));
    assert.equal((await readdir(join(link, '..'), { withFileTypes: true })).find(entry => entry.name === link.split(/[\\/]/).at(-1))?.isSymbolicLink(), true);
    const marker = join(outside, 'probe-ran.txt');
    const safeBytes = Buffer.from(`import{writeFileSync}from'node:fs';if(process.argv.includes('--version')){writeFileSync(${JSON.stringify(marker)},'executed');console.log('1.0.0')}`);
    const safeArtifact = { ...artifact, sha256: createHash('sha256').update(safeBytes).digest('hex') };
    let downloads = 0, applied = 0;
    const service = new StepPagePreparer(serviceRoot, process.execPath, async () => { downloads++; return new Response(safeBytes); }, safeArtifact);
    assert.deepEqual(await service.snapshot(), { status: 'missing', installed: false });
    assert.equal((await service.prepare(async () => { applied++; })).error, 'storage', location);
    assert.equal(downloads, 0, `${location}: rejected before download`);
    assert.equal(applied, 0, `${location}: rejected before apply`);
    await assert.rejects(access(marker));
    assert.deepEqual(await readdir(outside), [], `${location}: rejected before outside creation/write`);
    await removeLink(link); linkRemoved = true;
  }
});

test('StepPage rejects dangling storage without recreating its target', async t => {
  const { root } = await fixture(t);
  const target = join(root, 'target'); await mkdir(target);
  const link = join(root, 'steppage'); await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  let removed = false;
  t.after(async () => { if (!removed) await removeLink(link).catch((error: any) => { if (error.code !== 'ENOENT') throw error; }); });
  await rename(target, join(root, 'moved-target'));
  assert.equal((await readdir(root, { withFileTypes: true })).find(entry => entry.name === 'steppage')?.isSymbolicLink(), true);
  const service = new StepPagePreparer(root, process.execPath, async () => { throw new Error('must not download'); }, artifact);
  assert.equal((await service.prepare(async () => { throw new Error('must not apply'); })).error, 'storage');
  await assert.rejects(access(target));
  assert.deepEqual(await readdir(join(root, 'moved-target')), []);
  await removeLink(link); removed = true;
});

test('StepPage probes never inherit credentials and use the Desktop-only home', async t => {
  const script = Buffer.from("if(process.env.STEPPAGE_FIXTURE_SECRET || !process.env.HOME?.endsWith('home') || process.env.HOME!==process.env.USERPROFILE) process.exit(1); console.log('1.0.0');");
  process.env.STEPPAGE_FIXTURE_SECRET = 'fixture';
  t.after(() => { delete process.env.STEPPAGE_FIXTURE_SECRET; });
  const { service } = await fixture(t, async () => new Response(script),
    { ...artifact, sha256: createHash('sha256').update(script).digest('hex') });
  assert.equal((await service.prepare(async () => {})).status, 'ready');
});
