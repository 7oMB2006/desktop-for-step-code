import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { sharedWindowsStages } from './ci-policy.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const policy = fileURLToPath(new URL('./ci-policy.mjs', import.meta.url));
const temporary = t => {
  const path = mkdtempSync(join(tmpdir(), 'ci-plan-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};

test('Windows common checks have one owner without serializing the native groups or sharing builds', () => {
  const workflow = read('.github/workflows/windows-integration.yml');
  const blocks = workflow.split(/(?=^      - name: )/m);
  for (const id of sharedWindowsStages) {
    const matches = blocks.filter(block => new RegExp(`^        id: ${id}$`, 'm').test(block));
    assert.equal(matches.length, 1, id);
    assert.match(matches[0], /^        if: inputs.group == 'runtime'$/m, id);
  }
  for (const id of ['upstream_fetch', 'upstream_patch', 'native_prebuild', 'upstream_build',
    'desktop_install', 'runtime_stage', 'desktop_build', 'acceptance']) {
    const block = blocks.find(block => new RegExp(`^        id: ${id}$`, 'm').test(block));
    assert.ok(block, id);
    assert.doesNotMatch(block, /^        if:/m, `${id} must still execute in every group`);
  }
  const seal = blocks.find(block => /^        id: shared$/m.test(block));
  for (const stage of sharedWindowsStages) assert.ok(seal.includes(`steps.${stage}.outcome`), stage);
  assert.match(workflow, /shared-complete: \$\{\{ steps.shared.outputs.complete \}\}/);
  assert.match(workflow, /node \.\.\/scripts\/ci-protocol.mjs/);
  assert.ok(workflow.indexOf('Browser motion regressions') < workflow.indexOf('Serial Electron acceptance'));
  const caller = read('.github/workflows/pr-ci.yml');
  for (const group of ['interface', 'sessions', 'runtime'])
    assert.match(caller, new RegExp(`windows-${group}:\\n    name: Windows ${group}\\n    needs: changes`));
  assert.doesNotMatch(workflow, /continue-on-error|download-artifact|test-force-exit/);
  assert.match(read('.github/workflows/macos-integration.yml'), /node \.\.\/scripts\/ci-protocol.mjs/);
});

test('shared CLI grants only complete runtime success or explicit non-owner skips', t => {
  const directory = temporary(t);
  const output = join(directory, 'output');
  const run = (group, steps) => spawnSync(process.execPath, [policy, 'shared-receipt'], {
    encoding: 'utf8', env: { ...process.env, CI_WINDOWS_GROUP: group, CI_SHARED_STEPS: JSON.stringify(steps), GITHUB_OUTPUT: output },
  });
  const success = Object.fromEntries(sharedWindowsStages.map(stage => [stage, 'success']));
  const skipped = Object.fromEntries(sharedWindowsStages.map(stage => [stage, 'skipped']));
  assert.equal(run('runtime', success).status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'complete=true\n');
  for (const group of ['interface', 'sessions']) assert.equal(run(group, skipped).status, 0);
  for (const group of ['interface', 'sessions', 'wrong']) assert.notEqual(run(group, success).status, 0);
  assert.notEqual(run('runtime', skipped).status, 0);
  const partial = { ...success }; delete partial.protocol;
  assert.notEqual(run('runtime', partial).status, 0);
});

test('classification uses the entire PR diff, not only the latest explanatory commit', t => {
  const directory = temporary(t);
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']);
  git(['config', 'user.name', 'CI policy fixture']);
  git(['config', 'user.email', 'ci@example.invalid']);
  const commit = () => { git(['add', '--', 'README.md', 'Desktop']); git(['commit', '-m', 'fixture']); return git(['rev-parse', 'HEAD']); };
  mkdirSync(join(directory, 'Desktop'));
  writeFileSync(join(directory, 'README.md'), 'Base\n');
  writeFileSync(join(directory, 'Desktop', 'fixture.txt'), 'Base\n');
  const base = commit();
  const output = join(directory, 'output');
  const route = (head, event = 'pull_request') => {
    writeFileSync(output, '');
    const result = spawnSync(process.execPath, [policy, 'classify'], { cwd: directory, encoding: 'utf8',
      env: { ...process.env, BASE_SHA: base, HEAD_SHA: head, CI_EVENT_NAME: event, GITHUB_OUTPUT: output } });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(output, 'utf8');
  };
  writeFileSync(join(directory, 'README.md'), 'Explanation only\n');
  assert.equal(route(commit()), 'docs-only=true\n');
  writeFileSync(join(directory, 'Desktop', 'fixture.txt'), 'Changed code\n');
  commit();
  writeFileSync(join(directory, 'README.md'), 'Later explanation\n');
  assert.equal(route(commit()), 'docs-only=false\n');
  assert.equal(route('not-a-sha', 'workflow_dispatch'), 'docs-only=false\n');
});
