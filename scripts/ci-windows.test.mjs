import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acceptanceGroups, acceptanceTimeouts, localOnly, validateInventory, windowsGroups } from './ci-acceptance.mjs';
import { executeScript, groupScripts, runGroup } from './ci-windows.mjs';

const files = readdirSync(new URL('../Desktop/scripts/', import.meta.url)).filter(file => /^verify-.*\.mjs$/.test(file));

test('every acceptance script is assigned exactly once or explicitly remains outside CI', () => {
  validateInventory(files);
  assert.equal(Object.values(acceptanceGroups).flat().length, 47);
  assert.deepEqual(windowsGroups, ['interface', 'sessions', 'runtime']);
  for (const [script, timeout] of Object.entries(acceptanceTimeouts)) {
    assert.ok(Object.values(acceptanceGroups).flat().includes(script));
    assert.equal(timeout, 300000);
  }
});

test('inventory rejects duplicate, missing, new unassigned and unknown-group entries', () => {
  const duplicate = structuredClone(acceptanceGroups);
  duplicate.sessions.push(duplicate.interface[0]);
  assert.throws(() => validateInventory(files, duplicate), /Duplicate/);
  const missing = structuredClone(acceptanceGroups);
  missing.interface.pop();
  assert.throws(() => validateInventory(files, missing), /Unassigned/);
  assert.throws(() => validateInventory([...files, 'verify-new-feature.mjs']), /Unassigned/);
  assert.throws(() => validateInventory(files.filter(file => file !== acceptanceGroups.interface[0])), /Missing/);
  assert.throws(() => validateInventory(files, { ...acceptanceGroups, typo: [] }), /three Windows/);
  assert.throws(() => validateInventory(files, { ...acceptanceGroups, runtime: [] }), /Empty/);
  assert.throws(() => validateInventory(files, acceptanceGroups, [...localOnly, acceptanceGroups.runtime[0]]), /Duplicate/);
  assert.throws(() => groupScripts('toString'), /Unknown/);
  assert.throws(() => groupScripts(undefined), /Unknown/);
});

test('each group executes in order with at most one active script and preserves cwd/timeouts', async () => {
  for (const group of windowsGroups) {
    let active = 0;
    const executed = [];
    const rows = await runGroup(group, {
      log() {},
      async execute(script, options) {
        assert.equal(++active, 1);
        assert.ok(options.cwd.endsWith('Desktop'));
        const name = script.replaceAll('\\', '/').split('/').at(-1);
        assert.equal(options.timeout, acceptanceTimeouts[name]);
        executed.push(name);
        await new Promise(resolve => setImmediate(resolve));
        active--;
      },
    });
    assert.deepEqual(executed, acceptanceGroups[group]);
    assert.ok(rows.every(row => row.status === 'success' && row.seconds >= 0));
  }
});

test('failure stops the group without hiding the failing script or running later scripts', async () => {
  const executed = [];
  let recorded;
  await assert.rejects(runGroup('sessions', {
    log() {},
    execute(script) {
      executed.push(script);
      if (executed.length === 2) throw new Error('Fixture failure');
    },
    record(rows) { recorded = [...rows]; },
  }), /verify-launch-modes.mjs failed/);
  assert.equal(executed.length, 2);
  assert.deepEqual(recorded.map(row => row.status), ['success', 'failure']);
});

test('cancellation between scripts cannot start another acceptance', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(runGroup('runtime', {
    log() {}, signal: controller.signal,
    execute() { calls++; controller.abort(); },
  }), /abort/i);
  assert.equal(calls, 1);
});

test('command-line listing validates groups without starting Electron', () => {
  const cli = fileURLToPath(new URL('./ci-windows.mjs', import.meta.url));
  const run = (group, args = ['--list']) => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', env: { ...process.env, CI_WINDOWS_GROUP: group },
  });
  for (const group of windowsGroups) {
    const result = run(group);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`${group}: ${acceptanceGroups[group].length} serial checks`));
    assert.deepEqual(result.stdout.trim().split('\n').slice(1), acceptanceGroups[group]);
  }
  assert.notEqual(run('typo').status, 0);
  assert.notEqual(run('').status, 0);
  assert.notEqual(run('runtime', ['--list', 'extra']).status, 0);
});

test('script runner propagates real success, nonzero exit, timeout and abort', async () => {
  await executeScript(fileURLToPath(new URL('./fixtures/ci-exit-ok.mjs', import.meta.url)));
  await assert.rejects(executeScript(fileURLToPath(new URL('./fixtures/ci-exit-fail.mjs', import.meta.url))), /exited with 7/);
  const hanging = fileURLToPath(new URL('./fixtures/ci-wait.mjs', import.meta.url));
  await assert.rejects(executeScript(hanging, { timeout: 150 }), /timed out/);
  const controller = new AbortController();
  const pending = executeScript(hanging, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 150);
  try { await assert.rejects(pending, /cancelled/); } finally { clearTimeout(timer); }
});

test('Windows cancellation terminates both the owned script and its descendant', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ci-process-tree-'));
  const receipt = join(directory, 'pids.json');
  const previous = process.env.CI_FIXTURE_PID_FILE;
  process.env.CI_FIXTURE_PID_FILE = receipt;
  const controller = new AbortController();
  const pending = executeScript(fileURLToPath(new URL('./fixtures/ci-wait.mjs', import.meta.url)), { signal: controller.signal });
  // Attach rejection handling before the readiness poll to avoid an unhandled rejection.
  pending.catch(() => {});
  let pids;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const deadline = Date.now() + 5000;
    while (!pids && Date.now() < deadline) {
      try { pids = JSON.parse(readFileSync(receipt, 'utf8')); } catch {}
      if (!pids) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(pids, 'Fixture must publish its owned PIDs');
    assert.ok(alive(pids.parent) && alive(pids.child));
    controller.abort();
    await assert.rejects(pending, /cancelled/);
    assert.equal(alive(pids.parent), false);
    assert.equal(alive(pids.child), false);
  } finally {
    controller.abort();
    await pending.catch(() => {});
    // Cleanup remains restricted to PIDs created by this fixture if an assertion fails.
    for (const pid of Object.values(pids ?? {})) {
      if (alive(pid)) execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'pipe' });
    }
    if (previous === undefined) delete process.env.CI_FIXTURE_PID_FILE;
    else process.env.CI_FIXTURE_PID_FILE = previous;
    if (existsSync(receipt)) unlinkSync(receipt);
    rmdirSync(directory);
  }
});
