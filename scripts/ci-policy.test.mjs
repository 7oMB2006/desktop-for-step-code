import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedPaths, checkConclusion, docsOnly, isDocumentation } from './ci-policy.mjs';

test('only explicitly scoped documentation skips integration', () => {
  for (const path of ['README.md', 'TODO.md', 'docs/releases/v0.3.0.zh-CN.md', 'docs/acceptance/issue-5/README.md', 'assets/readme/screenshot.svg']) {
    assert.equal(isDocumentation(path), true, path);
  }
  for (const path of ['Desktop/README.md', 'Desktop/build/icon.png', 'scripts/test.md', 'assets/icon.svg', 'docs/unknown.md', '.github/workflows/pr-ci.yml', 'Desktop/package.json', 'patches/step-code-desktop.patch', 'AGENTS.md']) {
    assert.equal(isDocumentation(path), false, path);
  }
  assert.equal(docsOnly([]), false);
  assert.equal(docsOnly(['README.md', 'Desktop/src/main.tsx']), false);
});

test('renames and copies inspect both paths; unusual filenames remain intact', () => {
  assert.deepEqual(changedPaths('R100\0Desktop/src/example.md\0docs/releases/example.md\0'), ['Desktop/src/example.md', 'docs/releases/example.md']);
  assert.equal(docsOnly(changedPaths('R100\0Desktop/src/example.md\0docs/releases/example.md\0')), false);
  assert.equal(docsOnly(changedPaths('R100\0README.md\0Desktop/README.md\0')), false);
  assert.deepEqual(changedPaths('C100\0README.md\0docs/releases/copy.md\0D\0TODO.md\0M\0docs/releases/with\nnewline.md\0'), ['README.md', 'docs/releases/copy.md', 'TODO.md', 'docs/releases/with\nnewline.md']);
  assert.throws(() => changedPaths('R100\0README.md\0'));
  assert.throws(() => changedPaths('M\0README.md'));
  assert.throws(() => changedPaths('unexpected\0README.md\0'));
});

test('only the two valid dependency outcomes pass the final gate', () => {
  const states = ['success', 'failure', 'cancelled', 'skipped'];
  for (const classification of states) for (const documentation of states) for (const windows of states) {
    for (const route of ['true', 'false', '', undefined]) {
      const expected = classification === 'success' && (
        route === 'true' && documentation === 'success' && windows === 'skipped'
        || route === 'false' && windows === 'success' && documentation === 'skipped'
      );
      assert.equal(checkConclusion({ classification, documentation, windows, route }), expected);
    }
  }
});
