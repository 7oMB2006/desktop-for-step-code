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
  const selector = load('Desktop/scripts/runtime-baseline.mjs');
  const baseline = selector.match(/export const defaultRuntimeBaseline = '(v\d{3})';/)?.[1];
  assert.ok(baseline, 'Missing reviewed default runtime baseline');
  const manifest = JSON.parse(load(`patches/${baseline}/manifest.json`));
  const pin = manifest.commit;
  assert.match(pin ?? '', /^[0-9a-f]{40}$/, 'Invalid documented runtime pin');
  assert.match(load('Desktop/scripts/stage-runtime.mjs'), /const PINNED_COMMIT = integrationManifest.commit/);
  for (const doc of ['README.md', 'README.zh-CN.md', 'patches/README.md', 'docs/RELEASE.md', 'docs/MACOS.md'])
    assert.ok(load(doc).includes(pin), `${doc} documents a different runtime pin`);
  for (const doc of ['README.md', 'README.zh-CN.md'])
    assert.ok(load(doc).includes(`apply-step-code-desktop-patch.mjs Step-Code patches\\${baseline}\\step-code-desktop.patch`),
      `${doc} must apply the documented patch chain`);
  assert.ok(load('docs/MACOS.md').includes(`apply-step-code-desktop-patch.mjs Step-Code patches/${baseline}/step-code-desktop.patch`));
  const fetcher = load('scripts/ci-step-code.mjs');
  assert.match(fetcher, /readRuntimeBaseline\(defaultRuntimeBaseline\)/);
  assert.match(fetcher, /patches\/\$\{name\}\/step-code-desktop\.patch/);
  const windows = load('.github/workflows/windows-integration.yml');
  for (const operation of ['fetch', 'patch']) assert.ok(windows.includes(`node scripts/ci-step-code.mjs ${operation}`));
  const macos = load('.github/actions/setup-macos/action.yml');
  assert.match(macos, /run: node scripts\/ci-step-code\.mjs/);
  for (const build of [windows, macos]) assert.match(build, /corepack pnpm build:offline\b/);
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
