import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

test('staged Step login persists the access credential in readable auth.json', async () => {
  const { writeStepLoginCredential, logoutStepCredentials } = await import(
    pathToFileURL(resolve('runtime/step/dist/bundle/index.js')).href
  );
  const root = await mkdtemp(join(tmpdir(), 'desktop-step-auth-fixture-'));
  const authPath = join(root, 'auth.json');
  const legacyPath = join(root, 'legacy-auth.json');
  const marker = 'fixture-only-never-a-live-key';

  await writeStepLoginCredential({ authPath, profile: 'platform_cn', apiKey: marker });
  const persisted = JSON.parse(await readFile(authPath, 'utf8'));
  assert.equal(persisted.step.access, marker);
  assert.equal(persisted.step.type, 'oauth');

  await logoutStepCredentials({ nativePath: authPath, legacyPath, env: {} });
  const afterLogout = JSON.parse(await readFile(authPath, 'utf8'));
  assert.equal(afterLogout.step, undefined);
});

test('desktop-managed credentials stay in child memory and never create auth.json', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-step-memory-fixture-'));
  const authPath = join(root, 'auth.json');
  const marker = 'fixture-only-memory-key';
  const env = {
    ...isolatedEnvironment(root),
    STEPCODE_DESKTOP_AUTH_PATH: authPath,
    STEPCODE_DESKTOP_AUTH_DATA: '{}',
  };
  const admin = new RpcProcess(() => {});
  try {
    admin.start(resolve('runtime/node/node.exe'), resolve('runtime/admin.mjs'), root, env);
    const saved = await admin.request('login', { profile: 'platform_cn', key: marker });
    assert.equal(saved.step?.access, marker, `Saved provider IDs: ${Object.keys(saved).join(', ')}`);
    await assert.rejects(readFile(authPath), { code: 'ENOENT' });
    const cleared = await admin.request('logout');
    assert.equal(cleared.step, undefined);
    await assert.rejects(readFile(authPath), { code: 'ENOENT' });
  } finally { await admin.stop(); }
});
