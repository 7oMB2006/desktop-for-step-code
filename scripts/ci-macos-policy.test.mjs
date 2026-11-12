import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { macosAcceptanceGroups, macosGroupScripts } from './ci-acceptance.mjs';
import { validateIdentity, validateOutcomes, validateWorkflowOutcomes, validateReceipt, validateReceipts, validateReport, verifyCandidate } from './ci-macos-policy.mjs';

const groups = Object.keys(macosAcceptanceGroups);
const identity = { commit: 'a'.repeat(40), sha256: 'b'.repeat(64) };
const report = (group, mode) => ({
  group, mode, commit: identity.commit, candidateSha256: identity.sha256,
  expected: macosGroupScripts(group).length, active: null, complete: true,
  results: macosGroupScripts(group).map(script => ({ script, status: 'success', seconds: 0.123 })),
});
const receipt = group => ({
  group, ...identity, nativeTerminal: group === 'runtime' ? 'success' : 'skipped',
  source: report(group, 'source'), package: report(group, 'package'),
});
const outcomes = () => ({
  prepare: { result: 'success', outputs: { ...identity, 'artifact-id': '100' } },
  ...Object.fromEntries(groups.map((group, index) => [group, {
    result: 'success', outputs: { group, complete: 'true', ...identity, 'receipt-id': String(101 + index) },
  }])),
});
const workflowOutcomes = () => ({
  changes: { result: 'success', outputs: { 'docs-only': 'false' } },
  documentation: { result: 'skipped' },
  ...outcomes(),
});
const temporary = t => {
  const directory = mkdtempSync(join(tmpdir(), 'macos-ci-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test('Mac gate requires exact successful dependencies with distinct artifact identities', () => {
  assert.deepEqual(validateOutcomes(outcomes(), identity.commit), identity);
  for (const key of ['prepare', ...groups]) {
    for (const result of ['failure', 'cancelled', 'skipped', 'timed_out', undefined]) {
      const needs = outcomes();
      needs[key].result = result;
      assert.throws(() => validateOutcomes(needs, identity.commit), `${key}: ${result}`);
    }
    const missing = outcomes();
    delete missing[key];
    assert.throws(() => validateOutcomes(missing, identity.commit));
  }
  const extra = outcomes();
  extra.unexpected = { result: 'success' };
  assert.throws(() => validateOutcomes(extra, identity.commit));
  for (const group of groups) {
    for (const [key, value] of [
      ['group', 'all'], ['group', groups.find(name => name !== group)], ['complete', true],
      ['complete', 'false'], ['complete', undefined], ['commit', 'c'.repeat(40)],
      ['sha256', 'c'.repeat(64)], ['receipt-id', '100'], ['receipt-id', ''], ['receipt-id', undefined],
    ]) {
      const needs = outcomes();
      needs[group].outputs[key] = value;
      assert.throws(() => validateOutcomes(needs, identity.commit), `${group}: ${key}`);
    }
  }
  const duplicate = outcomes();
  duplicate.sessions.outputs['receipt-id'] = duplicate.interface.outputs['receipt-id'];
  assert.throws(() => validateOutcomes(duplicate, identity.commit), /Duplicate/);
  assert.throws(() => validateOutcomes(outcomes(), 'c'.repeat(40)), /checkout/);
  for (const key of ['commit', 'sha256']) {
    const needs = outcomes();
    delete needs.prepare.outputs[key];
    assert.throws(() => validateOutcomes(needs, identity.commit));
  }
  assert.throws(() => validateIdentity({ commit: 'x', sha256: 'x' }));
});

test('Mac documentation route requires successful checks, explicit native skips and no candidate promotion', () => {
  const docs = () => ({
    changes: { result: 'success', outputs: { 'docs-only': 'true' } },
    documentation: { result: 'success' },
    ...Object.fromEntries(['prepare', ...groups].map(key => [key, { result: 'skipped' }])),
  });
  assert.equal(validateWorkflowOutcomes(docs(), identity.commit), undefined);
  assert.deepEqual(validateWorkflowOutcomes(workflowOutcomes(), identity.commit), identity);
  for (const baseline of [docs, workflowOutcomes]) {
    for (const key of Object.keys(baseline())) {
      for (const state of ['failure', 'cancelled', undefined, 'unexpected']) {
        const needs = baseline();
        needs[key].result = state;
        assert.throws(() => validateWorkflowOutcomes(needs, identity.commit));
      }
      const missing = baseline();
      delete missing[key];
      assert.throws(() => validateWorkflowOutcomes(missing, identity.commit));
    }
    for (const route of ['', undefined, true, 'unknown']) {
      const needs = baseline();
      needs.changes.outputs['docs-only'] = route;
      assert.throws(() => validateWorkflowOutcomes(needs, identity.commit));
    }
    assert.throws(() => validateWorkflowOutcomes({ ...baseline(), extra: { result: 'success' } }, identity.commit));
  }
  for (const key of ['prepare', ...groups]) {
    for (const state of ['success', 'failure', 'cancelled']) {
      const needs = docs();
      needs[key].result = state;
      assert.throws(() => validateWorkflowOutcomes(needs, identity.commit));
    }
    const unexpected = docs();
    unexpected[key].outputs = { commit: identity.commit };
    assert.throws(() => validateWorkflowOutcomes(unexpected, identity.commit));
  }
});

test('Mac source and package reports must complete the exact ordered inventory', () => {
  for (const group of groups) {
    for (const mode of ['source', 'package']) {
      validateReport(report(group, mode), group, mode, identity);
      const mutations = [
        value => { value.group = 'all'; }, value => { value.mode = mode === 'source' ? 'package' : 'source'; },
        value => { value.commit = 'c'.repeat(40); }, value => { value.candidateSha256 = 'c'.repeat(64); },
        value => { value.complete = 'true'; }, value => { value.complete = false; },
        value => { value.active = { script: value.results[0].script }; },
        value => { value.expected--; }, value => { value.results.pop(); },
        value => { value.results.push(value.results[0]); }, value => { value.results[1] = value.results[0]; },
        value => { value.results.reverse(); }, value => { value.results[0].status = 'failure'; },
        value => { value.results[0].seconds = -1; }, value => { value.results = null; },
      ];
      for (const mutate of mutations) {
        const value = report(group, mode);
        mutate(value);
        assert.throws(() => validateReport(value, group, mode, identity));
      }
      assert.throws(() => validateReport(null, group, mode, identity));
    }
    validateReceipt(receipt(group), group, identity);
    for (const key of ['source', 'package', 'commit', 'sha256', 'nativeTerminal']) {
      const value = receipt(group);
      delete value[key];
      assert.throws(() => validateReceipt(value, group, identity), key);
    }
  }
});

test('Mac receipt directory rejects absent, extra, malformed or swapped reports', t => {
  const directory = temporary(t);
  const writeReceipts = () => {
    for (const group of groups) writeFileSync(join(directory, `ci-macos-receipt-${group}.json`), JSON.stringify(receipt(group)));
  };
  assert.throws(() => validateReceipts(directory, identity));
  writeReceipts();
  validateReceipts(directory, identity);
  const target = join(directory, 'ci-macos-receipt-interface.json');
  writeFileSync(target, JSON.stringify(receipt('sessions')));
  assert.throws(() => validateReceipts(directory, identity));
  writeFileSync(target, '{');
  assert.throws(() => validateReceipts(directory, identity));
  writeReceipts();
  writeFileSync(join(directory, 'extra.json'), '{}');
  assert.throws(() => validateReceipts(directory, identity));
});

function candidateFixture(t) {
  const directory = temporary(t);
  const version = join(directory, 'v0.6.0');
  mkdirSync(version);
  const bytes = Buffer.from('one immutable archive fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const preview = 'Desktop.for.Step.Code.macos-arm64.preview.zip';
  const name = 'Desktop.for.Step.Code.0.6.0.arm64.zip';
  writeFileSync(join(directory, preview), bytes);
  writeFileSync(join(version, name), bytes);
  writeFileSync(join(directory, 'COMMIT.txt'), identity.commit + '\n');
  writeFileSync(join(version, 'COMMIT-macos-arm64.txt'), identity.commit + '\n');
  writeFileSync(join(directory, 'SHA256SUMS.txt'), `${sha256}  release/${preview}\n`);
  writeFileSync(join(version, 'SHA256SUMS-macos-arm64.txt'), `${sha256}  ${name}\n`);
  writeFileSync(join(directory, 'runtime-manifest.json'), '{"commit":"upstream"}');
  writeFileSync(join(version, 'runtime-manifest-macos-arm64.json'), '{"commit":"upstream"}');
  writeFileSync(join(version, 'mac-update.json'), JSON.stringify({
    version: '0.6.0', arch: 'arm64', bundleIdentifier: 'community.stepcode.desktop',
    files: [{ url: name, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }],
  }));
  return { directory, version, name, preview, sha256 };
}

test('Mac candidate binds preview, updater, manifests, checksums and commit to the same bytes', async t => {
  const fixture = candidateFixture(t);
  assert.deepEqual(await verifyCandidate(fixture.directory, identity.commit, fixture.sha256), { commit: identity.commit, sha256: fixture.sha256 });
  await assert.rejects(verifyCandidate(fixture.directory, 'c'.repeat(40), fixture.sha256));
  await assert.rejects(verifyCandidate(fixture.directory, identity.commit, 'c'.repeat(64)));
  for (const [folder, file, replacement] of [
    [fixture.directory, fixture.preview, 'different preview'],
    [fixture.version, fixture.name, 'different updater'],
    [fixture.version, 'mac-update.json', '{}'],
    [fixture.version, 'runtime-manifest-macos-arm64.json', '{}'],
    [fixture.directory, 'SHA256SUMS.txt', 'wrong'],
  ]) {
    const target = join(folder, file);
    const original = readFileSync(target);
    writeFileSync(target, replacement);
    await assert.rejects(verifyCandidate(fixture.directory, identity.commit, fixture.sha256), file);
    writeFileSync(target, original);
  }
});

test('Mac CLI cannot grant outcomes or promote receipts without valid evidence', t => {
  const directory = temporary(t);
  for (const command of ['inputs', 'outcomes', 'conclude', 'receipt', 'candidate']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-macos-policy.mjs', import.meta.url)), command, directory],
      { encoding: 'utf8', env: { ...process.env, CI_MACOS_NEEDS: '{}', CI_MACOS_COMMIT: '', CI_MACOS_CANDIDATE_SHA256: '' } });
    assert.notEqual(result.status, 0, command);
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|Cannot find module/, 'Must exercise the actual policy CLI');
  }
});

test('Mac CLI grants receipts and concludes only with real parseable complete reports', t => {
  const directory = temporary(t);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const env = { ...process.env, CI_MACOS_COMMIT: commit, CI_MACOS_CANDIDATE_SHA256: identity.sha256,
    GITHUB_OUTPUT: join(directory, 'outputs') };
  const run = (command, target, extra = {}) => spawnSync(process.execPath,
    [fileURLToPath(new URL('./ci-macos-policy.mjs', import.meta.url)), command, target], { encoding: 'utf8', env: { ...env, ...extra } });
  const reports = join(directory, 'reports');
  const receipts = join(directory, 'receipts');
  mkdirSync(reports);
  mkdirSync(receipts);
  for (const group of groups) {
    for (const mode of ['source', 'package']) {
      writeFileSync(join(reports, `ci-macos-${mode}-${group}.json`), JSON.stringify({ ...report(group, mode), commit }));
    }
    const result = run('receipt', reports, { CI_MACOS_GROUP: group, CI_MACOS_TERMINAL_RESULT: group === 'runtime' ? 'success' : 'skipped' });
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(join(receipts, `ci-macos-receipt-${group}.json`), readFileSync(join(reports, `ci-macos-receipt-${group}.json`)));
  }
  assert.equal((readFileSync(env.GITHUB_OUTPUT, 'utf8').match(/complete=true/g) ?? []).length, 3);
  const needs = outcomes();
  for (const job of Object.values(needs)) job.outputs.commit = commit;
  const result = run('conclude', receipts, { CI_MACOS_NEEDS: JSON.stringify({
    changes: { result: 'success', outputs: { 'docs-only': 'false' } },
    documentation: { result: 'skipped' }, ...needs,
  }) });
  assert.equal(result.status, 0, result.stderr);
});
