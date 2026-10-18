import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [runtime, workspace, shellPath] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
const { createStepToolProfile } = await import(pathToFileURL(join(runtime, 'step/dist/bundle/index.js')));
const tools = createStepToolProfile(workspace, { agentDir: join(workspace, 'agent'), bash: { shellPath } });
const write = tools.find(tool => tool.name === 'write_file');
const run = tools.find(tool => tool.name === 'run_command');
const execute = (tool, args, signal, context = {}) => tool.execute('native-check', args, signal, undefined, { cwd: workspace, ...context });
await mkdir(join(workspace, 'nested'), { recursive: true });
const checked = await execute(write, { path: 'nested/output.txt', content: 'applied\n',
  then_run: "printf '%s\\n' \"$BASH\"; cygpath -m /usr/bin/bash.exe; pwd; printf STDERR_CHECK >&2; exit 7" });
assert.equal(checked.details.thenRun.exitCode, 7);
assert.equal(checked.details.thenRun.timedOut, false);
assert.equal(await readFile(join(workspace, 'nested/output.txt'), 'utf8'), 'applied\n');
const output = checked.content.map(part => part.text ?? '').join('\n');
assert.match(output, /STDERR_CHECK/);
assert.match(output, /Command exited with code 7/);
assert.ok(output.replaceAll('\\', '/').toLowerCase().includes(dirname(dirname(shellPath)).replaceAll('\\', '/').toLowerCase()));
const cwdOutput = await execute(write, { path: 'nested/cwd.txt', content: 'cwd\n',
  then_run: 'if [ -f nested/output.txt ]; then printf ROOT_CWD; else exit 9; fi' });
assert.match(cwdOutput.content[0].text, /ROOT_CWD/);
assert.equal(cwdOutput.details.thenRun.exitCode, 0, 'nested file checks use the initial cwd, not the file parent');

await assert.rejects(execute(run, { command: 'sleep 5' }, undefined, { commandTimeoutMs: 250 }), /Command timed out after 0.25 seconds/);
const timed = await execute(write, { path: 'timeout.txt', content: 'timeout applied\n', then_run: 'sleep 5' },
  undefined, { commandTimeoutMs: 250 });
assert.equal(timed.details.thenRun.timedOut, true);
assert.equal(timed.details.thenRun.exitCode, null);
assert.equal(await readFile(join(workspace, 'timeout.txt'), 'utf8'), 'timeout applied\n');
const large = await execute(write, { path: 'large.txt', content: 'large applied\n',
  then_run: "printf once >> command-count; printf '%035000d' 0; exit 7" }, undefined, { commandOutputLimit: 100 });
const log = large.details.thenRun.fullOutputPath;
assert.equal(large.details.thenRun.stepTruncated, true);
assert.equal(large.details.thenRun.exitCode, 7);
assert.ok(log && resolve(log).startsWith(resolve(process.env.TEMP)), 'full output stays in the isolated profile');
assert.equal(await readFile(log, 'utf8'), '0'.repeat(35000));
assert.equal(await readFile(join(workspace, 'command-count'), 'utf8'), 'once', 'truncation never reruns the command');
assert.ok(large.content[0].text.includes(log));

const companionController = new AbortController();
const companion = execute(run, {
  command: "printf started > companion-started; for ((attempt=0; attempt<300; attempt++)); do if [ -f companion-release ]; then printf survived > companion-finished; exit 0; fi; sleep 0.1; done; exit 9",
}, companionController.signal).then(result => ({ result }), error => ({ error }));
const controller = new AbortController();
try {
  const pending = execute(write, { path: 'abort.txt', content: 'abort applied\n',
    then_run: `bash -c 'printf started > abort-started; for ((attempt=0; attempt<300; attempt++)); do if [ -f abort-release ]; then printf late > abort-late; exit 0; fi; sleep 0.1; done; exit 9'; printf outer > abort-outer` }, controller.signal);
  const rejected = assert.rejects(pending, /Wrote 14 chars[\s\S]*then_run:[\s\S]*Command aborted/);
  try {
    const deadline = Date.now() + 10000;
    while (true) {
      try {
        await access(join(workspace, 'abort-started'));
        await access(join(workspace, 'companion-started'));
        break;
      } catch {}
      assert.ok(Date.now() < deadline, 'native check starts before cancellation');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally { controller.abort(); }
  await rejected;
  assert.equal(await readFile(join(workspace, 'abort.txt'), 'utf8'), 'abort applied\n');
  await writeFile(join(workspace, 'abort-release'), 'release\n');
  await new Promise(resolve => setTimeout(resolve, 1000));
  await assert.rejects(access(join(workspace, 'abort-late')), { code: 'ENOENT' }, 'cancellation kills descendants, not just the parent shell');
  await assert.rejects(access(join(workspace, 'abort-outer')), { code: 'ENOENT' });
  await writeFile(join(workspace, 'companion-release'), 'release\n');
  const survived = await companion;
  assert.equal(survived.error, undefined, 'stopping one command must not cancel another shell');
  assert.equal(await readFile(join(workspace, 'companion-finished'), 'utf8'), 'survived');
} finally {
  controller.abort();
  companionController.abort();
  await companion;
}

const broken = createStepToolProfile(workspace, { agentDir: join(workspace, 'agent'),
  bash: { shellPath: join(workspace, 'missing bash.exe') } }).find(tool => tool.name === 'write_file');
const missing = await execute(broken, { path: 'missing-shell.txt', content: 'applied\n', then_run: 'printf should-not-run' });
assert.equal(missing.details.thenRun.exitCode, null);
assert.equal(missing.details.thenRun.timedOut, false);
assert.match(missing.content[0].text, /Custom shell path not found/);
assert.equal(await readFile(join(workspace, 'missing-shell.txt'), 'utf8'), 'applied\n');
console.log('Native then_run passed: explicit Bash, nested cwd, stderr/nonzero exit, timeout parity, output cap/log, no rerun, descendant cancellation, concurrent-shell isolation and missing-shell receipt.');
