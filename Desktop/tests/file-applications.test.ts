import assert from 'node:assert/strict';
import test from 'node:test';
import { associationRequest, assertFileAssociationSupport, externalFileDestinations } from '../electron/file-applications';

test('Linux file opening offers only the system application and never enumerates Windows associations', async () => {
  let calls = 0;
  const list = async () => { calls++; return [{ id: 'app:editor', label: 'Editor' }]; };
  for (const platform of ['linux', 'darwin', 'unknown']) {
    assert.deepEqual(await externalFileDestinations('unused.ps1', '.txt', 'en', platform, list),
      [{ id: 'system', label: 'System default app' }]);
    assert.throws(() => assertFileAssociationSupport(platform), /only available on Windows/);
  }
  assert.equal(calls, 0);
});

test('Windows file choices retain system, associated apps and one-time application picker', async () => {
  let calls = 0;
  const choices = await externalFileDestinations('associations.ps1', '.md', 'zh', 'win32', async (script, extension) => {
    calls++;
    assert.equal(script, 'associations.ps1');
    assert.equal(extension, '.md');
    return [{ id: 'app:editor', label: 'Editor' }];
  });
  assert.equal(calls, 1);
  assert.deepEqual(choices.map(choice => choice.id), ['system', 'app:editor', 'other']);
  assert.equal(choices[0].label, '系统默认应用');
  assert.equal(choices[2].label, '选择其他应用…');
  assert.doesNotThrow(() => assertFileAssociationSupport('win32'));
});

test('direct association requests reject before spawning PowerShell on Linux', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(associationRequest('unused.ps1', { action: 'other', path: '/tmp/fixture.txt' }), /only available on Windows/);
  await assert.rejects(associationRequest('unused.ps1', { action: 'open', id: 'editor' }), /only available on Windows/);
});
