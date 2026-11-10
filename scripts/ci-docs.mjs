import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

// These contracts also run in runtime-staging.test.ts; docs-only changes must
// not bypass the instructions that keep the runtime pin and patch chain aligned.
export function validateDocumentation(load = read) {
  const manifest = JSON.parse(load('patches/v017/manifest.json'));
  const pin = manifest.commit;
  assert.match(pin ?? '', /^[0-9a-f]{40}$/, 'Invalid documented runtime pin');
  assert.match(load('Desktop/scripts/stage-runtime.mjs'), /const PINNED_COMMIT = integrationManifest.commit/);
  for (const doc of ['README.md', 'README.zh-CN.md', 'patches/README.md', 'docs/RELEASE.md', 'docs/MACOS.md'])
    assert.ok(load(doc).includes(pin), `${doc} documents a different runtime pin`);
  for (const doc of ['README.md', 'README.zh-CN.md'])
    assert.match(load(doc), /apply-step-code-desktop-patch\.mjs Step-Code patches\\v017\\step-code-desktop\.patch/,
      `${doc} must apply the documented patch chain`);
  assert.match(load('docs/MACOS.md'), /apply-step-code-desktop-patch\.mjs Step-Code patches\/v017\/step-code-desktop\.patch/);
  for (const path of ['.github/workflows/windows-integration.yml', '.github/actions/setup-macos/action.yml']) {
    assert.ok(load(path).includes(pin), `${path} uses a different runtime pin`);
    assert.match(load(path), /patches\/v017\/step-code-desktop\.patch/);
  }
  for (const path of ['.github/workflows/macos-integration.yml', '.github/workflows/macos-acceptance.yml'])
    assert.match(load(path), /uses: \.\/\.github\/actions\/setup-macos/, `${path} must use the native build action`);
}

export function validateAddedLines(diff) {
  assert.doesNotMatch(diff, /^\+(?:<{7}|={7}|>{7}|\|{7})(?: |$)/m, 'Added conflict marker');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateDocumentation();
  const { BASE_SHA, HEAD_SHA } = process.env;
  if (BASE_SHA !== undefined || HEAD_SHA !== undefined) {
    assert.ok([BASE_SHA, HEAD_SHA].every(sha => /^[a-f0-9]{40}$/.test(sha ?? '')), 'Invalid documentation diff inputs');
    const range = `${BASE_SHA}...${HEAD_SHA}`;
    execFileSync('git', ['diff', '--check', range], { cwd: root, stdio: 'inherit' });
    validateAddedLines(execFileSync('git', ['diff', '--no-ext-diff', '--unified=0', range], { cwd: root, encoding: 'utf8' }));
  }
  console.log('Documentation pin, patch instructions and added-line checks passed.');
}
