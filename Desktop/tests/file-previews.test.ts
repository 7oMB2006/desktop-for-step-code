import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilePreviews, readPreview, fileMode, canOpenExternally, inlineFileExtensions } from '../electron/file-previews';
import { LocalPagePreview } from '../electron/local-page-preview';
import { parsePreviewTable, tableColumnLimit, tableRowLimit } from '../src/file-preview-table';

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
  const markdown = await readPreview(join(root, 'README.md'));
  assert.equal(markdown.mode, 'markdown');
  assert.match(markdown.text, /你好/);
  await writeFile(join(root, 'unicode.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好', 'utf16le')]));
  assert.equal((await readPreview(join(root, 'unicode.txt'))).text, '你好');
  await writeFile(join(root, 'binary.txt'), Buffer.from([0, 1, 2]));
  await assert.rejects(readPreview(join(root, 'binary.txt')), /Binary/);
  await writeFile(join(root, '.env'), 'PRIVATE_VALUE=example');
  await assert.rejects(readPreview(join(root, '.env')), /Sensitive/);
  await writeFile(join(root, 'large.txt'), Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(readPreview(join(root, 'large.txt')), /1 MiB/);
});

test('image formats are previewable without adding new external open permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'file-preview-images-'));
  assert.equal(fileMode('logo.SVG'), 'image');
  assert.equal(fileMode('movie.mp4'), 'external');
  assert.equal(fileMode('module.mjs'), 'text');
  assert.equal(canOpenExternally('module.mjs'), false);
  for (const extension of ['html', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'md', 'tsv']) assert.ok(inlineFileExtensions.includes(extension));
  for (const extension of ['mp4', 'exe', '*']) assert.ok(!inlineFileExtensions.includes(extension));
  const svg = '<?xml version="1.0" encoding="UTF-16"?><svg xmlns="http://www.w3.org/2000/svg"/>';
  const svgBytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(svg, 'utf16le')]);
  const svgPath = join(root, 'logo.SVG');
  await writeFile(svgPath, svgBytes);
  const vector = await readPreview(svgPath);
  assert.equal(vector.mode, 'image');
  assert.equal(vector.image, `data:image/svg+xml;base64,${svgBytes.toString('base64')}`);
  assert.equal(vector.text, svg);
  assert.equal(vector.language, 'xml');
  for (const [ext, mime, bytes] of [
    ['png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['jpg', 'image/jpeg', Buffer.from('ffd8ff', 'hex')],
    ['jpeg', 'image/jpeg', Buffer.from('ffd8ff', 'hex')],
    ['webp', 'image/webp', Buffer.from('RIFF0000WEBP')],
    ['gif', 'image/gif', Buffer.from('GIF89a')],
  ] as const) {
    const path = join(root, `image.${ext}`);
    await writeFile(path, bytes);
    const raster = await readPreview(path);
    assert.equal(raster.mode, 'image');
    assert.equal(raster.image, `data:${mime};base64,${bytes.toString('base64')}`);
    assert.equal(raster.text, undefined);
  }
  const wrong = join(root, 'wrong.png');
  await writeFile(wrong, svg);
  await assert.rejects(readPreview(wrong), /do not match the image format/);
  const large = join(root, 'large.png');
  await writeFile(large, Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(readPreview(large), /10 MiB/);
});

test('PDF and table previews preserve granted content and enforce file limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'file-preview-docs-'));
  const pdf = join(root, 'report.PDF');
  const content = Buffer.from('%PDF-1.7\n%%EOF');
  assert.equal(fileMode(pdf), 'pdf');
  assert.ok(inlineFileExtensions.includes('pdf'));
  assert.ok(canOpenExternally(pdf));
  await writeFile(pdf, content);
  const preview = await readPreview(pdf);
  assert.equal(preview.mode, 'pdf');
  assert.deepEqual(Buffer.from(preview.bytes), content);
  await writeFile(pdf, '<html>Not a PDF</html>');
  await assert.rejects(readPreview(pdf), /match the PDF format/);
  await writeFile(pdf, Buffer.alloc(25 * 1024 * 1024 + 1));
  await assert.rejects(readPreview(pdf), /25 MiB/);
  const tsv = join(root, 'table.tsv');
  await writeFile(tsv, '值\t备注\n0001\t=1+1');
  const table = await readPreview(tsv);
  assert.equal(table.mode, 'table');
  assert.equal(table.format, 'TSV');
  assert.equal(table.text, '值\t备注\n0001\t=1+1');
});

test('delimited preview handles quotes, blank fields and multiline values without executing or coercing text', () => {
  assert.deepEqual(parsePreviewTable('\uFEFFid,name,notes\r\n001,"A, B","one\r\ntwo"\r\n002,"x""y",=1+2', 'CSV'), {
    records: [['id', 'name', 'notes'], ['001', 'A, B', 'one\r\ntwo'], ['002', 'x"y', '=1+2']],
    columns: 3, truncated: false,
  });
  assert.deepEqual(parsePreviewTable('code\tlabel\t\n0001\t"tab\tinside"\n', 'TSV'), {
    records: [['code', 'label', ''], ['0001', 'tab\tinside']], columns: 3, truncated: false,
  });
  assert.deepEqual(parsePreviewTable('', 'CSV'), { records: [], columns: 0, truncated: false });
  assert.throws(() => parsePreviewTable('a,"unclosed', 'CSV'));
  assert.equal(parsePreviewTable('a,b\n'.repeat(tableRowLimit), 'CSV').truncated, false);
  const tall = parsePreviewTable('a,b\n'.repeat(tableRowLimit + 4), 'CSV');
  assert.equal(tall.records.length, tableRowLimit);
  assert.equal(tall.truncated, true);
  const wide = parsePreviewTable('a,'.repeat(tableColumnLimit) + 'b', 'CSV');
  assert.equal(wide.records[0].length, tableColumnLimit);
  assert.equal(wide.truncated, true);
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

test('POSIX HTML preview keeps literal backslashes distinct from nested resource paths', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-page-posix-'));
  await mkdir(join(root, 'a'));
  const entry = join(root, 'preview\\entry.html');
  await writeFile(entry, '<script src="a%5Cb.js"></script><script src="a/b.js"></script>');
  await writeFile(join(root, 'a\\b.js'), 'window.asset = "literal-backslash";');
  await writeFile(join(root, 'a/b.js'), 'window.asset = "nested-directory";');
  await writeFile(join(root, 'unlisted.js'), 'window.asset = "not-granted";');
  const pages = new LocalPagePreview();
  try {
    const page = await pages.open(entry);
    assert.match(new URL(page.url).pathname, /preview%5Centry\.html$/);
    assert.equal((await fetch(page.url)).status, 200);
    const literal = await fetch(new URL('a%5Cb.js', page.url));
    const nested = await fetch(new URL('a/b.js', page.url));
    assert.equal(literal.status, 200); assert.equal(nested.status, 200);
    assert.match(await literal.text(), /literal-backslash/);
    assert.match(await nested.text(), /nested-directory/);
    assert.equal((await fetch(new URL('unlisted.js', page.url))).status, 404);
    // Refreshing the grant removes the literal asset without disturbing the nested one.
    await writeFile(entry, '<script src="a/b.js"></script>');
    await pages.open(entry);
    assert.equal((await fetch(new URL('a%5Cb.js', page.url))).status, 404);
    assert.match(await (await fetch(new URL('a/b.js', page.url))).text(), /nested-directory/);
  } finally { pages.dispose(); }
});
