import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openThemePreviewFile, themePreviewFile } from './fixtures/theme-pack-files';

test('offline preview returns a fresh, correctly sized in-memory document', () => {
  const result = openThemePreviewFile();
  assert.equal(result.destination, 'preview');
  if (result.destination !== 'preview') return;
  assert.equal(result.file.size, new TextEncoder().encode(result.file.text).length);
  result.file.text = 'modified';
  assert.equal(openThemePreviewFile().destination, 'preview');
  assert.notEqual(themePreviewFile.text, 'modified');
  assert.deepEqual(openThemePreviewFile({ grantId: themePreviewFile.id }, 'preview'),
    { destination: 'preview', file: themePreviewFile });
  assert.deepEqual(openThemePreviewFile({ runtimeId: 'preview-theme-preview', path: 'stellar-notes.md' }),
    { destination: 'preview', file: themePreviewFile });
});

test('offline preview rejects unknown grants, host paths and external destinations', () => {
  assert.throws(() => openThemePreviewFile({ grantId: 'unknown' }), /离线样例/);
  assert.throws(() => openThemePreviewFile({ runtimeId: 'x', path: 'C:\\secrets.txt' }), /离线样例/);
  assert.throws(() => openThemePreviewFile({ runtimeId: 'x', path: '../stellar-notes.md' }), /离线样例/);
  assert.throws(() => openThemePreviewFile(undefined, 'external'), /内置预览/);
});
