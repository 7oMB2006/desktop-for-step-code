import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilePreviews, readPreview, fileMode, canOpenExternally } from '../electron/file-previews';
import { LocalPagePreview } from '../electron/local-page-preview';

test('file chooser permissions do not grant arbitrary reference paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'file-preview-boundary-'));
  const outside = await mkdtemp(join(tmpdir(), 'file-preview-selected-'));
  await writeFile(join(root, 'README.md'), '# Workspace');
  await writeFile(join(outside, 'selected.txt'), 'User-selected file');
  const files = new FilePreviews(id => { if (id !== 'runtime') throw new Error('Unknown worker'); return root; });
  const selected = await files.grant(join(outside, 'selected.txt'));
  assert.equal((await files.resolve({ grantId: selected.id })).path, selected.path);
  await assert.rejects(files.resolve({ runtimeId: 'runtime', path: join(outside, 'selected.txt') }), /outside/);
  await assert.rejects(files.resolve({ grantId: 'fake-permission' }), /Unknown file permission/);
  const referenced = await files.resolve({ runtimeId: 'runtime', path: './README.md' });
  assert.equal((await files.resolve({ grantId: referenced.id })).path, referenced.path);
  assert.equal(fileMode('README.md'), 'markdown');
  assert.equal(fileMode('index.html'), 'browser');
  assert.equal(fileMode('source.ts'), 'text');
  assert.equal(canOpenExternally('malware.exe'), false);
  assert.equal(canOpenExternally('command.ps1'), false);
  assert.equal(canOpenExternally('script.js'), false);
});

test('text preview supports Unicode but refuses binary, sensitive and oversized files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'file-preview-text-'));
  await writeFile(join(root, 'README.md'), '# Hello\n\n你好');
  assert.match((await readPreview(join(root, 'README.md'))).text, /你好/);
  await writeFile(join(root, 'unicode.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好', 'utf16le')]));
  assert.equal((await readPreview(join(root, 'unicode.txt'))).text, '你好');
  await writeFile(join(root, 'binary.txt'), Buffer.from([0, 1, 2]));
  await assert.rejects(readPreview(join(root, 'binary.txt')), /Binary/);
  await writeFile(join(root, '.env'), 'PRIVATE_VALUE=example');
  await assert.rejects(readPreview(join(root, '.env')), /Sensitive/);
  await writeFile(join(root, 'large.txt'), Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(readPreview(join(root, 'large.txt')), /1 MiB/);
});

test('local HTML grants only declared assets, enforces request boundaries and refreshes its manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-page-preview-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<link rel="stylesheet" href="assets/style.css"><script type="module" src="assets/main.js"></script><script src="credentials.js"></script><h1>Preview</h1>');
  await writeFile(join(root, 'assets/style.css'), 'body { background: url("./pixel.svg"); }');
  await writeFile(join(root, 'assets/pixel.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(root, 'assets/main.js'), 'import "./module.js";');
  await writeFile(join(root, 'assets/module.js'), 'document.title = "Local preview";');
  await writeFile(join(root, 'private.json'), '{"private":"not-granted"}');
  await writeFile(join(root, 'credentials.js'), 'const privateValue = "not-granted";');
  await writeFile(join(root, 'other.html'), '<h1>Not granted</h1>');
  const pages = new LocalPagePreview();
  try {
    const first = await pages.open(join(root, 'index.html'));
    const response = await fetch(first.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy')!, /connect-src 'self'/);
    assert.equal((await fetch(new URL('assets/style.css', first.url))).status, 200);
    assert.equal((await fetch(new URL('assets/pixel.svg', first.url))).status, 200);
    assert.equal((await fetch(new URL('assets/module.js', first.url))).status, 200);
    assert.equal((await fetch(new URL('private.json', first.url))).status, 404);
    assert.equal((await fetch(new URL('credentials.js', first.url))).status, 404, 'even explicitly declared sensitive assets stay unavailable');
    assert.equal((await fetch(new URL('other.html', first.url))).status, 404);
    assert.equal((await fetch(first.url, { method: 'POST' })).status, 403);
    assert.equal((await fetch(first.url, { headers: { Origin: 'https://example.com' } })).status, 403);
    await writeFile(join(root, 'index.html'), '<link href="/assets/style.css" rel="stylesheet"><style>body{background:url("/assets/pixel.svg")}</style><script type="module">import "/assets/main.js";</script><img srcset="/assets/pixel.svg 1x">');
    await writeFile(join(root, 'assets/main.js'), 'import "/assets/module.js";');
    await pages.open(join(root, 'index.html'));
    const token = new URL(first.url).pathname.split('/')[1];
    const transported = await (await fetch(first.url)).text();
    assert.match(transported, new RegExp(`/${token}/assets/style\\.css`));
    assert.match(transported, new RegExp(`/${token}/assets/main\\.js`));
    assert.match(transported, new RegExp(`/${token}/assets/pixel\\.svg`));
    assert.match(await (await fetch(new URL('assets/main.js', first.url))).text(), new RegExp(`/${token}/assets/module\\.js`));
    assert.equal((await fetch(new URL('assets/module.js', first.url))).status, 200);
    await writeFile(join(root, 'index.html'), '<h1>Updated</h1>');
    assert.equal((await pages.open(join(root, 'index.html'))).url, first.url);
    assert.equal((await fetch(new URL('assets/style.css', first.url))).status, 404);
  } finally { pages.dispose(); }
});
