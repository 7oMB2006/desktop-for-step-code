import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acceptanceGroups, macosAcceptanceGroups, macosExclusions, macosGroupScripts, validateMacosInventory } from './ci-acceptance.mjs';
import { runGroup } from './ci-windows.mjs';

const files = readdirSync(new URL('../Desktop/scripts/', import.meta.url)).filter(file => /^verify-.*\.mjs$/.test(file));
test('macOS inherits shared feature coverage with only explicit native exclusions', () => {
  validateMacosInventory(files);
  assert.deepEqual(Object.keys(macosExclusions), ['verify-windows-commands.mjs']);
  const scripts = macosGroupScripts('all');
  for (const script of Object.values(acceptanceGroups).flat()) {
    assert.ok(scripts.includes(script) || script in macosExclusions, script);
  }
  for (const script of ['verify-macos-updater.mjs', 'verify-turn-undo.mjs', 'verify-auto-resume-electron.mjs',
    'verify-session-import.mjs', 'verify-then-run.mjs', 'verify-usage-worker.mjs']) assert.ok(scripts.includes(script));
  assert.equal(new Set(scripts).size, scripts.length);
  assert.throws(() => macosGroupScripts('typo'), /Unknown macOS/);
});
test('macOS runner executes every group serially using shared deadlines and stops on failure', async () => {
  let active = 0;
  const executed = [];
  await runGroup('all', { scripts: macosGroupScripts('all'), log() {}, async execute(script, options) {
    assert.equal(++active, 1);
    assert.equal(options.timeout, 300000);
    executed.push(script.split(/[\\/]/).at(-1));
    await new Promise(resolve => setImmediate(resolve));
    active--;
  } });
  assert.deepEqual(executed, macosGroupScripts('all'));
  await assert.rejects(runGroup('all', { scripts: macosGroupScripts('all'), log() {}, execute() { throw Error('failure'); } }), /verify-electron.mjs failed/);
});
test('Mac CI runs the same serial inventory against source and package and stages the shared release version', () => {
  const workflow = readFileSync(new URL('../.github/workflows/macos-integration.yml', import.meta.url), 'utf8');
  assert.equal(workflow.split('node ../scripts/ci-macos.mjs').length - 1, 2);
  assert.match(workflow, /DESKTOP_MACOS_RELEASE_VERSION: 0\.6\.0/);
  assert.match(workflow, /DESKTOP_VERIFY_EXE:/);
  assert.match(workflow, /tests\/macos-terminal.test.ts/);
});
test('Mac listing validates the complete projected inventory without launching Electron', () => {
  const cli = fileURLToPath(new URL('./ci-macos.mjs', import.meta.url));
  for (const group of ['all', ...Object.keys(macosAcceptanceGroups)]) {
    const result = spawnSync(process.execPath, [cli, '--list'], { encoding: 'utf8', env: { ...process.env, CI_MACOS_GROUP: group } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n').slice(1), macosGroupScripts(group));
  }
});
