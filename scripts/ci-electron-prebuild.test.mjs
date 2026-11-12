import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { electronPrebuild } from './ci-electron-prebuild.mjs';

test('Electron preparation preserves the installed version, platform and published checksums', () => {
  for (const [platform, arch, id, sha256] of [
    ['win32', 'x64', '583070895', '11c395820a5aaa8ebcc0686b476d0ac98a730274ebfbdc8cf5538a7c2815cb5d'],
    ['darwin', 'arm64', '583161027', 'a212eee63ba2f45fd83bd28f77a3e3313a336ad17a4c25adf617942eef5e0e2c'],
  ]) {
    const filename = `electron-v44.4.5-${platform}-${arch}.zip`;
    const asset = electronPrebuild('44.4.5', { [filename]: sha256 }, platform, arch);
    assert.deepEqual(asset, {
      filename, sha256,
      url: `https://github.com/electron/electron/releases/download/v44.4.5/${filename}`,
      apiUrl: `https://api.github.com/repos/electron/electron/releases/assets/${id}`,
    });
  }
  assert.throws(() => electronPrebuild('44.4.6', {}), /Review official Electron assets/);
  assert.throws(() => electronPrebuild('44.4.5', {}, 'linux', 'x64'), /Unsupported Electron CI platform/);
  for (const checksum of [undefined, '', 'not-a-checksum', 'a'.repeat(63), 1]) {
    assert.throws(() => electronPrebuild('44.4.5', {
      'electron-v44.4.5-win32-x64.zip': checksum,
    }, 'win32', 'x64'), /Missing published Electron checksum/);
  }
});

test('Electron CI uses the real downloader cache implementation and keeps checksum validation enabled', () => {
  const helper = readFileSync(new URL('./ci-electron-prebuild.mjs', import.meta.url), 'utf8');
  assert.match(helper, /electronRequire\.resolve\('@electron\/get'\)/);
  assert.match(helper, /new Cache\(cacheRoot\)\.getCachePath\(asset\.url, asset\.filename\)/);
  assert.match(helper, /checksums\.json/);
  assert.doesNotMatch(helper, /unsafelyDisableChecksums|ELECTRON_MIRROR|ELECTRON_OVERRIDE_DIST_PATH/);
  for (const file of ['../.github/workflows/windows-integration.yml', '../.github/actions/setup-macos/action.yml']) {
    const workflow = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(workflow, /electron_config_cache: \$\{\{ runner\.temp \}\}\/dfsc-electron-cache/);
    const prepare = workflow.indexOf('node ../scripts/ci-electron-prebuild.mjs');
    const install = workflow.indexOf('node node_modules/electron/install.js');
    assert.ok(prepare > workflow.indexOf('corepack pnpm install --frozen-lockfile'));
    assert.ok(install > prepare);
    assert.doesNotMatch(workflow, /--ignore-scripts|continue-on-error|ELECTRON_SKIP_BINARY_DOWNLOAD/);
  }
  const workflow = readFileSync(new URL('../.github/workflows/macos-integration.yml', import.meta.url), 'utf8');
  const policy = readFileSync(new URL('../.github/workflows/pr-ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^  pull_request:\s*$/m, 'Every PR must classify Electron preparation changes');
  assert.match(workflow, /node --test .*ci-electron-prebuild\.test\.mjs/);
  assert.match(policy, /node --test scripts\/ci-\*\.test\.mjs/);
});
