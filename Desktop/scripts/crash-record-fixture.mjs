import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run the actual writer with real Electron metadata and filesystem APIs. The
// temporary bundle is test-owned; production startup is tested by the caller.
export async function verifyCrashRecords(app, profile) {
  const root = await mkdtemp(join(profile, 'crash-record-fixture-'));
  const modulePath = join(root, 'crash-log.cjs');
  try {
    await build({ entryPoints: [fileURLToPath(new URL('../electron/crash-log.ts', import.meta.url))],
      outfile: modulePath, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    const receipt = await app.evaluate(async (_electron, { root, modulePath }) => {
      const { CrashLog } = process.getBuiltinModule('module').createRequire(modulePath)(modulePath);
      const log = new CrashLog(root);
      log.setPhase('fixture phase api_key=fixture-electron-phase');
      const error = new Error('Fixture request password=fixture-electron-message');
      const previous = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
      let hookCalls = 0;
      try {
        Object.defineProperty(Error, 'prepareStackTrace', { configurable: true, writable: true,
          value: () => { hookCalls++; return 'fixture-electron-hook'; } });
        await log.record('fixture-failure', error, { exitCode: 7,
          request: 'https://fixture-electron-user:fixture-electron-url@example.invalid/?access_token=fixture-electron-query',
          nested: { password: 'fixture-electron-detail', safe: 'keep-electron-diagnostic' },
          stderrTail: 'Authorization: Bearer fixture-electron-header\nworker exited' });
      } finally {
        if (previous) Object.defineProperty(Error, 'prepareStackTrace', previous);
        else Reflect.deleteProperty(Error, 'prepareStackTrace');
      }
      await log.record('fixture-large', new Error('安全故障'), Object.fromEntries(
        Array.from({ length: 64 }, (_, index) => [`field${index}`, '界'.repeat(16000)])));
      return { hookCalls, messageUnchanged: error.message === 'Fixture request password=fixture-electron-message',
        version: _electron.app.getVersion(), packaged: _electron.app.isPackaged, userData: _electron.app.getPath('userData') };
    }, { root, modulePath });
    assert.equal(receipt.hookCalls, 0, 'Crash formatting must not run the process-wide stack hook');
    assert.equal(receipt.messageUnchanged, true);
    const names = await readdir(root);
    const logs = names.filter(name => name.endsWith('.log'));
    assert.equal(logs.length, 2);
    assert.equal(names.some(name => name.endsWith('.tmp')), false);
    const records = await Promise.all(logs.map(name => readFile(join(root, name), 'utf8')));
    for (const text of records) {
      assert.ok(Buffer.byteLength(text) <= 64 * 1024);
      for (const marker of ['phase', 'message', 'user', 'url', 'query', 'detail', 'header', 'hook'])
        assert.equal(text.includes(`fixture-electron-${marker}`), false, `Electron ${marker} value must not reach disk`);
    }
    const diagnostic = records.find(text => text.includes('kind: fixture-failure'));
    assert.ok(diagnostic);
    assert.match(diagnostic, /exitCode: 7/);
    assert.match(diagnostic, /keep-electron-diagnostic/);
    assert.match(diagnostic, /worker exited/);
    assert.match(diagnostic, /\n\s+at /);
    assert.ok(diagnostic.split('\n').includes(`version: ${receipt.version}`));
    assert.ok(diagnostic.split('\n').includes(`packaged: ${receipt.packaged}`));
    assert.ok(diagnostic.split('\n').includes(`userData: ${receipt.userData}`));
    console.log('Electron crash record boundaries passed: redaction, safe frames, hook isolation and UTF-8 budget.');
  } finally { await removeTestProfile(root); }
}
