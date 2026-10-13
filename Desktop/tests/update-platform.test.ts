import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePlatform } from '../src/update-platform';

test('Linux updates identify the platform and explain unsupported installers for manifest and release feed', () => {
  for (const source of ['manifest', 'release-feed', undefined] as const) {
    for (const language of ['en', 'zh']) {
      const view = updatePlatform('linux', source, language);
      assert.equal(view.label, 'Linux x64');
      assert.equal(view.supportsInstaller, false);
      assert.match(view.missingPackage, /Linux/);
      assert.match(view.missingPackage, language === 'zh' ? /发布说明/ : /release notes/);
      assert.doesNotMatch(view.missingPackage, /no Windows x64 installer|核对 Windows x64|暂未提供 Windows x64/);
    }
  }
});

test('Windows update presentation retains installer support and existing missing-package messages', () => {
  assert.deepEqual(updatePlatform('win32', 'manifest', 'en'), { label: 'Windows x64', supportsInstaller: true,
    missingPackage: 'This release has no Windows x64 installer yet.' });
  assert.equal(updatePlatform('win32', 'release-feed', 'zh').missingPackage, '请在发布页核对 Windows x64 安装包。');
  assert.equal(updatePlatform('win32', undefined, 'zh').missingPackage, '此版本暂未提供 Windows x64 安装包。');
});

test('unknown or unsupported platforms never advertise a Windows installer', () => {
  for (const platform of ['darwin', 'unknown', '']) {
    const view = updatePlatform(platform, 'manifest', 'en');
    assert.equal(view.supportsInstaller, false);
    assert.doesNotMatch(view.label, /Windows/);
    assert.match(view.missingPackage, /does not support/);
  }
});
