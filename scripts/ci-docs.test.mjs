import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateAddedLines, validateDocumentation } from './ci-docs.mjs';

const load = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('current documentation contracts run without Desktop dependencies or runtime', () => {
  validateDocumentation();
});

test('lightweight checks reject stale pins, patch instructions and native build wiring', () => {
  for (const path of ['README.md', 'README.zh-CN.md', 'patches/README.md', 'docs/RELEASE.md', 'docs/MACOS.md',
    '.github/workflows/windows-integration.yml', '.github/actions/setup-macos/action.yml',
    '.github/workflows/macos-integration.yml', '.github/workflows/macos-acceptance.yml',
    'Desktop/scripts/stage-runtime.mjs', 'patches/v017/manifest.json']) {
    assert.throws(() => validateDocumentation(name => name === path ? '' : load(name)), path);
  }
  for (const path of ['README.md', 'README.zh-CN.md', 'docs/MACOS.md']) {
    assert.throws(() => validateDocumentation(name => name === path
      ? load(name).replaceAll('apply-step-code-desktop-patch.mjs', 'obsolete-applier.mjs') : load(name)), path);
  }
});

test('added conflict markers fail but removed markers and ordinary headings do not', () => {
  for (const marker of ['<<<<<<< main', '=======', '>>>>>>> branch', '||||||| base'])
    assert.throws(() => validateAddedLines(`diff --git a/a b/a\n+${marker}\n`), /conflict marker/);
  validateAddedLines('--- a/a\n+++ b/a\n-<<<<<<< old\n+# Heading\n+Ordinary explanation\n');
});
