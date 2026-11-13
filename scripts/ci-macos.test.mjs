import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { acceptanceGroups, macosAcceptanceGroups, macosExclusions, macosGroupScripts, validateMacosInventory } from './ci-acceptance.mjs';
import { runGroup } from './ci-windows.mjs';
import { executeWithLog } from './ci-macos.mjs';

const files = readdirSync(new URL('../Desktop/scripts/', import.meta.url)).filter(file => /^verify-.*\.mjs$/.test(file));
test('macOS inherits shared feature coverage with only explicit native exclusions', () => {
  validateMacosInventory(files);
  assert.deepEqual(Object.keys(macosExclusions), ['verify-windows-commands.mjs', 'verify-plugin-update-electron.mjs']);
  assert.match(macosExclusions['verify-plugin-update-electron.mjs'], /Windows Job Object/);
  const scripts = macosGroupScripts('all');
  assert.ok(!scripts.includes('verify-plugin-update-electron.mjs'));
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
  const workflow = readFileSync(new URL('../.github/workflows/macos-integration.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const acceptance = readFileSync(new URL('../.github/workflows/macos-acceptance.yml', import.meta.url), 'utf8');
  assert.equal(acceptance.split('node ../scripts/ci-macos.mjs').length - 1, 2);
  assert.match(workflow, /DESKTOP_MACOS_RELEASE_VERSION: 0\.6\.0/);
  assert.match(acceptance, /DESKTOP_VERIFY_EXE:/);
  assert.match(acceptance, /tests\/macos-terminal.test.ts/);
  assert.match(acceptance, /if: inputs\.group == 'runtime'/);
  assert.match(workflow, /node --test scripts\/motion-helpers.test.mjs scripts\/cron-manager.test.mjs/);
  assert.match(workflow, /^  group: macos-preview-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}$/m);
  assert.match(workflow, /^  cancel-in-progress: true$/m);
  for (const group of Object.keys(macosAcceptanceGroups)) {
    assert.match(workflow, new RegExp(`  ${group}:\\n    needs: prepare\\n    uses: ./\\.github/workflows/macos-acceptance.yml\\n    with:\\n      group: ${group}`));
  }
  assert.doesNotMatch(workflow, /continue-on-error|strategy:|fail-fast:/);
  assert.doesNotMatch(acceptance, /continue-on-error|strategy:|fail-fast:/);
  assert.match(workflow, /needs: \[changes, documentation, prepare, interface, sessions, runtime\]/);
  assert.match(workflow, /name: ARM64 build, tests and packaged acceptance\n    if: always\(\)/);
  assert.ok(workflow.indexOf('conclude receipts') < workflow.indexOf('Upload fully tested preview'));
  assert.match(acceptance, /macos-fixture-diagnostics-\$\{\{ inputs.group \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(acceptance, /artifact-ids: \$\{\{ inputs.artifact-id \}\}/);
  assert.ok(acceptance.indexOf('candidate candidate') < acceptance.indexOf('ditto -x -k'));
  assert.ok(acceptance.indexOf('Packaged native terminal acceptance') < acceptance.indexOf('Validate and seal both reports'));
  assert.match(workflow, /cp release\/v\*\/Desktop\.for\.Step\.Code\.\*\.arm64\.zip release\/Desktop\.for\.Step\.Code\.macos-arm64\.preview\.zip/);
  const setup = readFileSync(new URL('../.github/actions/setup-macos/action.yml', import.meta.url), 'utf8');
  assert.match(setup, /node-version: 24\.16\.0/);
  assert.match(setup, /29eb460780489801ce8afc8bffc1a2efae7cbded/);
  assert.match(setup, /corepack pnpm stage:runtime/);
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^    paths:/m, 'Required macOS gate must exist for documentation PRs');
  const promotion = workflow.slice(workflow.indexOf('      - name: Require all job outcomes'));
  assert.equal((promotion.match(/if: steps.outcomes.outputs.docs-only == 'false'/g) ?? []).length, 5,
    'Documentation route must not download receipts, conclude, download candidates, recheck or promote');
  assert.equal(Object.values(macosAcceptanceGroups).flat().length, macosGroupScripts('all').length);
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

test('logged runner supports isolated argument and log names without allowing path traversal', async t => {
  const probe = logFixture(t, "console.log(process.argv.slice(2).join('|'));");
  await executeWithLog(probe.script, { ...probe.options, args: ['a', 'b'], logName: 'another.test.ts' });
  assert.match(readFileSync(join(probe.options.logDirectory, 'another.test.ts.log'), 'utf8'), /a\|b/);
  await assert.rejects(executeWithLog(probe.script, { ...probe.options, logName: '../outside' }), /Invalid CI log/);
});

test('failed or ineffective termination is bounded and never becomes successful cleanup', { timeout: 10000 }, async t => {
  for (const fails of [true, false]) {
    const probe = logFixture(t, "setInterval(() => {}, 1000);");
    let owned;
    const started = Date.now();
    try {
      await assert.rejects(executeWithLog(probe.script, { ...probe.options, timeout: 150, cleanupTimeout: 100,
        terminate(child) { owned = child; if (fails) throw new Error('helper failed'); },
      }), /cleanup-unconfirmed/);
      assert.ok(Date.now() - started < 3000);
      assert.match(probe.log(), /cleanup-unconfirmed/);
    } finally {
      if (owned && owned.exitCode === null && owned.signalCode === null) {
        const exited = new Promise(resolve => owned.once('exit', resolve));
        owned.kill();
        await exited;
      }
    }
  }
});

test('an assertion failure with a live handle still reaches the external deadline', async t => {
  const probe = logFixture(t, `
    import { test } from 'node:test';
    test('deliberate failure', () => { throw new Error('ASSERTION FAILURE'); });
    setInterval(() => {}, 1000);
  `);
  await assert.rejects(executeWithLog(probe.script, { ...probe.options, timeout: 1000 }), /timed out after 1000ms/);
  assert.match(probe.log(), /ASSERTION FAILURE/);
  assert.match(probe.log(), /stopped=Acceptance timed out after 1000ms/);
});

test('Windows cancellation never targets an exited leader with inherited pipes', { skip: process.platform !== 'win32', timeout: 10000 }, async t => {
  const probe = logFixture(t, `
    import { spawn } from 'node:child_process';
    import { tmpdir } from 'node:os';
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: tmpdir(), stdio: 'inherit', windowsHide: true, detached: true });
    console.log(JSON.stringify({ leader: process.pid, descendant: child.pid }));
    child.unref();
  `);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const waitFor = async predicate => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'owned subprocess state must settle');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const controller = new AbortController();
  let terminationCalls = 0, pids, leader;
  const childProcessEvents = channel('child_process');
  const observeChild = ({ process: child }) => child.once('spawn', () => {
    if (child.spawnargs[1] === probe.script) leader = child;
  });
  childProcessEvents.subscribe(observeChild);
  const pending = executeWithLog(probe.script, { ...probe.options, signal: controller.signal,
    terminate() { terminationCalls++; },
  });
  pending.catch(() => {});
  try {
    await waitFor(() => {
      try { pids = JSON.parse(Buffer.concat(probe.stdout).toString()); return true; } catch { return false; }
    });
    await waitFor(() => leader?.pid === pids.leader);
    // OS PID disappearance can precede Node's exit event on Windows.
    if (leader.exitCode === null && leader.signalCode === null) {
      await once(leader, 'exit', { signal: AbortSignal.timeout(3000) });
    }
    await waitFor(() => !alive(pids.leader));
    assert.equal(alive(pids.descendant), true, 'the exited leader leaves a live child holding its output pipes');
    const started = Date.now();
    controller.abort();
    await assert.rejects(pending, /cleanup-unconfirmed: leader exited before inherited pipes closed/);
    assert.ok(Date.now() - started < 1500, 'closing owned pipes must not wait for the descendant');
    assert.equal(terminationCalls, 0, 'an exited leader PID must never be passed to taskkill');
    assert.match(probe.log(), /cleanup-unconfirmed/);
  } finally {
    childProcessEvents.unsubscribe(observeChild);
    controller.abort();
    if (pids && alive(pids.descendant)) {
      process.kill(pids.descendant);
      await waitFor(() => !alive(pids.descendant));
    }
    await pending.catch(() => {});
  }
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

test('Mac cancellation after leader exit still closes its owned descendant pipes', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const probe = logFixture(t, `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    console.log(JSON.stringify({ leader: process.pid, descendant: child.pid }));
    child.unref();
  `);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const waitFor = async predicate => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'owned subprocess state must settle');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const controller = new AbortController();
  const pending = executeWithLog(probe.script, { ...probe.options, signal: controller.signal });
  pending.catch(() => {});
  let pids, cleanup;
  const terminateOwnedGroup = () => {
    if (!pids) return;
    try { process.kill(-pids.leader, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  try {
    await waitFor(() => {
      try { pids = JSON.parse(Buffer.concat(probe.stdout).toString()); return true; } catch { return false; }
    });
    await waitFor(() => !alive(pids.leader));
    assert.equal(alive(pids.descendant), true, 'the exited leader leaves a live child holding its output pipes');
    // Bound the old broken behavior: forced cleanup lets its false success surface
    // as a failed assertion rather than leaving the test runner hanging forever.
    cleanup = setTimeout(terminateOwnedGroup, 250);
    controller.abort();
    await assert.rejects(pending, /cancelled/);
    await waitFor(() => !alive(pids.descendant));
    assert.match(probe.log(), /exit: code=0 stopped=Acceptance cancelled\n$/);
  } finally {
    clearTimeout(cleanup);
    controller.abort();
    terminateOwnedGroup();
    await pending.catch(() => {});
  }
});
