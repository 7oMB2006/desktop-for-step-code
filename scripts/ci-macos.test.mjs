import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acceptanceGroups, macosAcceptanceGroups, macosExclusions, macosGroupScripts, validateMacosInventory } from './ci-acceptance.mjs';
import { runGroup } from './ci-windows.mjs';
import { executeWithLog } from './ci-macos.mjs';

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


function logFixture(t, source) {
  const directory = mkdtempSync(join(tmpdir(), 'macos-ci-log-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = join(directory, 'probe.mjs');
  writeFileSync(script, source);
  const stdout = [], stderr = [];
  const options = { cwd: directory, logDirectory: join(directory, 'logs'), timeout: 5000,
    stdout: { write(chunk) { stdout.push(Buffer.from(chunk)); } },
    stderr: { write(chunk) { stderr.push(Buffer.from(chunk)); } } };
  return { directory, script, options, stdout, stderr,
    log: () => readFileSync(join(options.logDirectory, 'probe.mjs.log'), 'utf8') };
}

test('Mac script logs keep console stdout/stderr and zero-exit success', async t => {
  const probe = logFixture(t, "console.log('SUCCESS stdout'); console.error('DIAGNOSTIC stderr');");
  await executeWithLog(probe.script, probe.options);
  assert.equal(Buffer.concat(probe.stdout).toString(), 'SUCCESS stdout\n');
  assert.equal(Buffer.concat(probe.stderr).toString(), 'DIAGNOSTIC stderr\n');
  assert.match(probe.log(), /\[stdout\] SUCCESS stdout/);
  assert.match(probe.log(), /\[stderr\] DIAGNOSTIC stderr/);
  assert.ok(probe.log().includes(`cwd: ${probe.directory}`));
  assert.match(probe.log(), /timeout: 5000/);
  assert.match(probe.log(), /exit: code=0 stopped=no\n$/);
});

test('Mac script failure rejects only after its stderr and exit status are on disk', async t => {
  const probe = logFixture(t, "console.error('DETAILED FAILURE REASON'); process.exitCode = 3;");
  await assert.rejects(executeWithLog(probe.script, probe.options), /exited with 3/);
  assert.equal(Buffer.concat(probe.stderr).toString(), 'DETAILED FAILURE REASON\n');
  assert.match(probe.log(), /\[stderr\] DETAILED FAILURE REASON/);
  assert.match(probe.log(), /exit: code=3 stopped=no\n$/);
});

test('Mac script timeout and live cancellation retain their failure reason', async t => {
  const probe = logFixture(t, "console.log('READY'); setInterval(() => {}, 1000);");
  await assert.rejects(executeWithLog(probe.script, { ...probe.options, timeout: 150 }), /timed out after 150ms/);
  assert.match(probe.log(), /exit: code=.* stopped=Acceptance timed out after 150ms\n$/);
  const controller = new AbortController();
  await assert.rejects(executeWithLog(probe.script, { ...probe.options, signal: controller.signal,
    stdout: { write(chunk) { probe.stdout.push(Buffer.from(chunk)); controller.abort(); } },
  }), /cancelled/);
  assert.match(probe.log(), /\[stdout\] READY/);
  assert.match(probe.log(), /exit: code=.* stopped=Acceptance cancelled\n$/);
});

test('Mac runner does not start an already cancelled script', async t => {
  const probe = logFixture(t, "console.log('MUST NOT START');");
  const controller = new AbortController();
  controller.abort(new Error('pre-cancelled'));
  await assert.rejects(executeWithLog(probe.script, { ...probe.options, signal: controller.signal }), /pre-cancelled/);
  assert.equal(probe.stdout.length, 0);
  assert.equal(existsSync(probe.options.logDirectory), false);
});

test('Mac logs drain output larger than pipe buffers and retain separate source/package evidence', async t => {
  const probe = logFixture(t, `
    await new Promise(resolve => process.stdout.write('龍'.repeat(100000) + '\\nSTDOUT TAIL\\n', resolve));
    await new Promise(resolve => process.stderr.write('E'.repeat(100000) + '\\nSTDERR TAIL\\n', resolve));
  `);
  probe.options.logDirectory = join(probe.directory, 'logs/source/all');
  await executeWithLog(probe.script, probe.options);
  const sourceLog = probe.log();
  assert.equal(Buffer.concat(probe.stdout).toString(), '龍'.repeat(100000) + '\nSTDOUT TAIL\n');
  assert.equal(Buffer.concat(probe.stderr).toString(), 'E'.repeat(100000) + '\nSTDERR TAIL\n');
  assert.equal(sourceLog.match(/龍/g).length, 100000, 'chunk boundaries must not corrupt UTF-8');
  assert.doesNotMatch(sourceLog, /\uFFFD/);
  assert.match(sourceLog, /STDOUT TAIL/);
  assert.match(sourceLog, /STDERR TAIL/);
  assert.match(sourceLog, /exit: code=0 stopped=no\n$/);
  writeFileSync(probe.script, "console.error('PACKAGE FAILURE'); process.exitCode = 7;");
  await assert.rejects(executeWithLog(probe.script, { ...probe.options, logDirectory: join(probe.directory, 'logs/package/all') }), /exited with 7/);
  assert.equal(probe.log(), sourceLog, 'packaged execution must not overwrite source output');
  assert.match(readFileSync(join(probe.directory, 'logs/package/all/probe.mjs.log'), 'utf8'), /PACKAGE FAILURE/);
});
