import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, type ExecFileException } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capabilityFailureCode, capabilityFailureDetails, marketplaceFailureCode } from '../electron/capability-failure.mjs';
import { refreshGitMarketplace, type MarketplaceExecutor } from '../electron/marketplace-refresh.mjs';

const privateText = 'https://user:private-password@example.invalid/?token=private-token C:\\private\\cache';
const gitError = (code: number | string = 128) => Object.assign(new Error(privateText), { code }) as ExecFileException;

const failureCases: [string, string, number | string][] = [
  ['network', 'fatal: unable to access URL: Failed to connect to server', 128],
  ['dns', 'fatal: Could not resolve host: example.invalid', 128],
  ['proxy', 'fatal: Could not resolve proxy: private-proxy', 128],
  ['tls', 'fatal: SSL certificate problem: unable to get local issuer certificate', 128],
  ['auth', 'fatal: Authentication failed for URL', 128],
  ['auth', "fatal: could not read Username for URL: terminal prompts disabled", 128],
  ['source-unavailable', "fatal: repository 'URL' not found", 128],
  ['git-missing', '', 'ENOENT'],
  ['permission', '', 'EACCES'],
  ['permission', "error: cannot open '.git/FETCH_HEAD': Permission denied", 1],
  ['locked', "fatal: Unable to create '/private/cache/.git/index.lock': File exists.", 128],
  ['locked', "error: cannot lock ref 'refs/remotes/origin/main'", 1],
  ['conflict', 'fatal: Not possible to fast-forward, aborting.', 128],
  ['conflict', 'error: Your local changes would be overwritten by merge', 1],
  ['timeout', 'fatal: Operation timed out', 128],
  ['output-limit', '', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'],
];

for (const [index, [reason, stderr, exitCode]] of failureCases.entries()) {
  test(`Git failure ${index + 1} retains only ${reason} and structured metadata`, async () => {
    let calls = 0;
    const execute: MarketplaceExecutor = (command, args, options, callback) => {
      calls++;
      assert.equal(command, 'git');
      assert.deepEqual(args, ['-C', 'fixture path', 'pull', '--ff-only', '--quiet']);
      assert.equal(options.timeout, 120000);
      assert.equal(options.windowsHide, true);
      callback(gitError(exitCode), privateText, `${stderr}\n${privateText}`);
    };
    await assert.rejects(refreshGitMarketplace('fixture path', undefined, execute), error => {
      assert.equal(capabilityFailureCode(error), `marketplace-${reason}`);
      const details = capabilityFailureDetails(error)!;
      assert.equal(details.operation, 'marketplace-refresh');
      assert.equal(details.gitExitCode, typeof exitCode === 'number' ? exitCode : null);
      assert.equal(details.gitSystemCode, typeof exitCode === 'string' ? exitCode : null);
      assert.ok(typeof details.elapsedMs === 'number' && details.elapsedMs >= 0);
      assert.doesNotMatch(JSON.stringify(error) + String(error), /private|example\.invalid|token=/);
      return true;
    });
    assert.equal(calls, 1, 'failure must not trigger an automatic retry');
  });
}

test('unknown Git output remains generic and does not infer an exit code from text', async () => {
  const execute: MarketplaceExecutor = (_command, _args, _options, callback) =>
    callback(gitError('PRIVATE_VALUE'), privateText, `unrecognized error 128 ${privateText}`);
  await assert.rejects(refreshGitMarketplace('fixture', undefined, execute), error => {
    assert.equal(capabilityFailureCode(error), 'marketplace-failed');
    assert.equal(capabilityFailureDetails(error)?.gitExitCode, null);
    assert.equal(capabilityFailureDetails(error)?.gitSystemCode, null);
    assert.doesNotMatch(JSON.stringify(error) + String(error), /PRIVATE_VALUE|private/);
    return true;
  });
});

test('successful Git output is not returned or logged', async () => {
  const execute: MarketplaceExecutor = (_command, _args, _options, callback) =>
    callback(null, privateText, privateText);
  assert.equal(await refreshGitMarketplace('fixture', undefined, execute), undefined);
});

test('diagnostic metadata rejects paths, arbitrary strings and out-of-range numbers', () => {
  assert.deepEqual(capabilityFailureDetails({ details: {
    operation: 'marketplace-refresh', elapsedMs: Infinity, gitExitCode: -1,
    gitSignal: privateText, gitSystemCode: privateText, stderr: privateText, source: privateText,
  } }), {
    operation: 'marketplace-refresh', elapsedMs: null, gitExitCode: null, gitSignal: null, gitSystemCode: null,
  });
  assert.equal(capabilityFailureDetails({ details: { operation: privateText } }), undefined);
});

test('actual missing Git is distinct from a missing marketplace path', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-missing-git-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.PATH = root;
  const execute: MarketplaceExecutor = (command, args, options, callback) =>
    execFile(command, args, { ...options, env }, callback);
  await assert.rejects(refreshGitMarketplace(root, undefined, execute), error => {
    assert.equal(capabilityFailureCode(error), 'marketplace-git-missing');
    assert.equal(capabilityFailureDetails(error)?.gitSystemCode, 'ENOENT');
    assert.equal(capabilityFailureDetails(error)?.gitExitCode, null);
    return true;
  });
});

test('actual subprocess failures retain exit code without exposing stdout or stderr', async () => {
  const execute: MarketplaceExecutor = (_command, _args, options, callback) =>
    execFile(process.execPath, ['-e',
      `process.stdout.write(${JSON.stringify(privateText)});process.stderr.write("Failed to connect\\n"+${JSON.stringify(privateText)});process.exitCode=23;`,
    ], options, callback);
  await assert.rejects(refreshGitMarketplace('fixture', undefined, execute), error => {
    assert.equal(capabilityFailureCode(error), 'marketplace-network');
    assert.equal(capabilityFailureDetails(error)?.gitExitCode, 23);
    assert.doesNotMatch(JSON.stringify(error) + String(error), /private|example\.invalid/);
    return true;
  });
});

test('actual subprocess timeout and cancellation are distinguished and joined before return', async () => {
  const execute: MarketplaceExecutor = (_command, _args, options, callback) =>
    execFile(process.execPath, ['-e', 'setInterval(()=>{},1000);'], options, callback);
  await assert.rejects(refreshGitMarketplace('fixture', undefined, execute, 80), error => {
    assert.equal(capabilityFailureCode(error), 'marketplace-timeout');
    return true;
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 80);
  try {
    await assert.rejects(refreshGitMarketplace('fixture', controller.signal, execute), error => {
      assert.equal(capabilityFailureCode(error), 'marketplace-cancelled');
      assert.equal(capabilityFailureDetails(error)?.gitSystemCode, 'ABORT_ERR');
      return true;
    });
  } finally { clearTimeout(timer); }
  assert.equal(marketplaceFailureCode({}, AbortSignal.timeout(0)), 'marketplace-failed');
  const deadline = new AbortController();
  deadline.abort(new DOMException('deadline', 'TimeoutError'));
  assert.equal(marketplaceFailureCode({}, deadline.signal), 'marketplace-timeout');
});

test('an early abort callback cannot release the refresh before child close', async () => {
  const child = new EventEmitter();
  const controller = new AbortController();
  let completed = false;
  let callback!: Parameters<MarketplaceExecutor>[3];
  const execute: MarketplaceExecutor = (_command, _args, _options, receive) => {
    callback = receive;
    return child;
  };
  const result = assert.rejects(refreshGitMarketplace('fixture', controller.signal, execute), error => {
    assert.equal(capabilityFailureCode(error), 'marketplace-cancelled');
    assert.equal(capabilityFailureDetails(error)?.gitExitCode, 1);
    assert.equal(capabilityFailureDetails(error)?.gitSystemCode, 'ABORT_ERR');
    return true;
  }).then(() => { completed = true; });
  controller.abort();
  callback(gitError('ABORT_ERR'), privateText, privateText);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false, 'The callback alone is not process-exit confirmation');
  child.emit('close', 1, null);
  await result;
});

test('real local Git refresh succeeds, preserves dirty changes and reports a held index lock', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-refresh-git-')), source = join(root, 'source'), cache = join(root, 'cache');
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  await mkdir(source);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  const commit = () => {
    git(source, 'add', '--', '.');
    git(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture');
  };
  git(source, 'init', '--quiet', '--initial-branch=main');
  git(source, 'config', 'core.autocrlf', 'false');
  await writeFile(join(source, 'fixture.txt'), 'first\n'); commit();
  execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', '--', pathToFileURL(source).href, cache], { windowsHide: true });
  git(cache, 'config', 'core.autocrlf', 'false');
  await writeFile(join(source, 'fixture.txt'), 'second\n'); commit();
  await refreshGitMarketplace(cache);
  assert.equal(await readFile(join(cache, 'fixture.txt'), 'utf8'), 'second\n');
  await writeFile(join(cache, 'fixture.txt'), 'local edits\n');
  await writeFile(join(source, 'fixture.txt'), 'third\n'); commit();
  await assert.rejects(refreshGitMarketplace(cache), error => {
    assert.equal(capabilityFailureCode(error), 'marketplace-conflict');
    assert.equal(capabilityFailureDetails(error)?.gitExitCode, 1);
    return true;
  });
  assert.equal(await readFile(join(cache, 'fixture.txt'), 'utf8'), 'local edits\n');
  await writeFile(join(cache, 'fixture.txt'), 'second\n');
  await writeFile(join(cache, '.git/index.lock'), 'owned fixture lock');
  await assert.rejects(refreshGitMarketplace(cache), error => {
    assert.equal(capabilityFailureCode(error), 'marketplace-locked');
    assert.ok(capabilityFailureDetails(error)?.gitExitCode);
    return true;
  });
  assert.equal(await readFile(join(cache, '.git/index.lock'), 'utf8'), 'owned fixture lock');
  assert.equal(await readFile(join(cache, 'fixture.txt'), 'utf8'), 'second\n');
});
