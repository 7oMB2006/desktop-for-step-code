import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedPaths, checkConclusion, docsOnly, isDocumentation } from './ci-policy.mjs';

test('only explicitly scoped documentation skips integration', () => {
  for (const path of ['README.md', 'TODO.md', 'docs/LINUX.md', 'docs/releases/v0.3.0.zh-CN.md', 'docs/acceptance/issue-5/README.md', 'assets/readme/screenshot.svg']) {
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
  const states = ['success', 'failure', 'cancelled', 'skipped', undefined];
  for (const classification of states) for (const documentation of states)
    for (const ui of states) for (const sessions of states) for (const runtime of states) for (const linux of states) {
    for (const route of ['true', 'false', '', undefined]) {
      const expected = classification === 'success' && (
        route === 'true' && documentation === 'success' && [ui, sessions, runtime, linux].every(status => status === 'skipped')
        || route === 'false' && documentation === 'skipped' && [ui, sessions, runtime, linux].every(status => status === 'success')
      );
      assert.equal(checkConclusion({
        changes: { result: classification, outputs: { 'docs-only': route } },
        documentation: { result: documentation },
        linux: { result: linux },
        'windows-interface': { result: ui, outputs: { group: 'interface', complete: 'true' } },
        'windows-sessions': { result: sessions, outputs: { group: 'sessions', complete: 'true' } },
        'windows-runtime': { result: runtime, outputs: { group: 'runtime', complete: 'true' } },
      }), expected);
    }
  }
});

test('missing, renamed, malformed and unexpected jobs cannot pass the gate', () => {
  const valid = {
    changes: { result: 'success', outputs: { 'docs-only': 'false' } },
    documentation: { result: 'skipped' },
    linux: { result: 'success' },
    'windows-interface': { result: 'success', outputs: { group: 'interface', complete: 'true' } },
    'windows-sessions': { result: 'success', outputs: { group: 'sessions', complete: 'true' } },
    'windows-runtime': { result: 'success', outputs: { group: 'runtime', complete: 'true' } },
  };
  assert.equal(checkConclusion(valid), true);
  for (const key of Object.keys(valid)) {
    const missing = { ...valid };
    delete missing[key];
    assert.equal(checkConclusion(missing), false, key);
    assert.equal(checkConclusion({ ...valid, [key]: null }), false, key);
  }
  assert.equal(checkConclusion({ ...valid, windows: { result: 'success' } }), false);
  assert.equal(checkConclusion(undefined), false);
  assert.equal(checkConclusion({}), false);
  for (const key of ['windows-interface', 'windows-sessions', 'windows-runtime']) {
    for (const outputs of [undefined, {}, { complete: 'true' }, { group: 'wrong', complete: 'true' },
      { group: key.slice(8), complete: 'false' }, { group: key.slice(8), complete: true }]) {
      assert.equal(checkConclusion({ ...valid, [key]: { result: 'success', outputs } }), false);
    }
  }
  assert.equal(checkConclusion({ ...valid, 'windows-sessions': valid['windows-interface'] }), false);
});
