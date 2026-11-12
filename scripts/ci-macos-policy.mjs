import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { macosAcceptanceGroups, macosGroupScripts } from './ci-acceptance.mjs';

const groups = Object.keys(macosAcceptanceGroups);
const preview = 'Desktop.for.Step.Code.macos-arm64.preview.zip';
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const output = values => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
};

export function validateIdentity({ commit, sha256 }) {
  assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'Missing source commit');
  assert.match(sha256 ?? '', /^[a-f0-9]{64}$/, 'Missing candidate hash');
}

export function validateReport(report, group, mode, identity) {
  validateIdentity(identity);
  assert.ok(groups.includes(group), 'Unknown macOS group');
  const scripts = macosGroupScripts(group);
  assert.equal(report?.group, group, 'Wrong report group');
  assert.equal(report.mode, mode, 'Wrong report mode');
  assert.equal(report.commit, identity.commit, 'Wrong report commit');
  assert.equal(report.candidateSha256, identity.sha256, 'Wrong report candidate');
  assert.equal(report.complete, true, 'Incomplete report');
  assert.equal(report.active, null, 'Report still active');
  assert.equal(report.expected, scripts.length, 'Wrong report inventory size');
  assert.ok(Array.isArray(report.results), 'Missing results');
  assert.deepEqual(report.results.map(row => row?.script), scripts, 'Missing, duplicated or reordered checks');
  for (const row of report.results) {
    assert.equal(row.status, 'success', 'Acceptance did not pass');
    assert.ok(Number.isFinite(row.seconds) && row.seconds >= 0, 'Invalid duration');
  }
}

export function validateReceipt(receipt, group, identity) {
  assert.equal(receipt?.group, group, 'Wrong receipt group');
  assert.equal(receipt.commit, identity.commit, 'Wrong receipt commit');
  assert.equal(receipt.sha256, identity.sha256, 'Wrong receipt candidate');
  assert.equal(receipt.nativeTerminal, group === 'runtime' ? 'success' : 'skipped', 'Native terminal checks did not complete');
  for (const mode of ['source', 'package']) validateReport(receipt[mode], group, mode, identity);
}

export function validateOutcomes(needs, commit) {
  assert.deepEqual(Object.keys(needs ?? {}).sort(), ['prepare', ...groups].sort(), 'Unexpected dependency set');
  const prepared = needs.prepare;
  assert.equal(prepared.result, 'success', 'Preparation did not succeed');
  const identity = { commit: prepared.outputs?.commit, sha256: prepared.outputs?.sha256 };
  validateIdentity(identity);
  assert.equal(identity.commit, commit, 'Candidate does not match current checkout');
  const ids = [prepared.outputs['artifact-id']];
  for (const group of groups) {
    const job = needs[group];
    assert.equal(job.result, 'success', 'Acceptance job did not succeed');
    assert.equal(job.outputs?.group, group, 'Missing or wrong group receipt');
    assert.equal(job.outputs.complete, 'true', 'Missing completion receipt');
    assert.equal(job.outputs.commit, identity.commit, 'Wrong group commit');
    assert.equal(job.outputs.sha256, identity.sha256, 'Wrong group candidate');
    ids.push(job.outputs['receipt-id']);
  }
  assert.ok(ids.every(id => typeof id === 'string' && /^[1-9]\d*$/.test(id)), 'Missing artifact ID');
  assert.equal(new Set(ids).size, ids.length, 'Duplicate artifact IDs');
  return identity;
}

export function validateWorkflowOutcomes(needs, commit) {
  assert.deepEqual(Object.keys(needs ?? {}).sort(), ['changes', 'documentation', 'prepare', ...groups].sort(),
    'Unexpected workflow dependency set');
  assert.equal(needs.changes?.result, 'success', 'Classification did not succeed');
  const route = needs.changes.outputs?.['docs-only'];
  assert.ok(['true', 'false'].includes(route), 'Missing documentation route');
  assert.equal(needs.documentation?.result, route === 'true' ? 'success' : 'skipped', 'Wrong documentation outcome');
  if (route === 'true') {
    for (const key of ['prepare', ...groups]) {
      assert.equal(needs[key]?.result, 'skipped', 'Documentation route ran native integration');
      assert.equal(Object.keys(needs[key].outputs ?? {}).length, 0, 'Documentation route has unexpected candidate evidence');
    }
    return undefined;
  }
  return validateOutcomes(Object.fromEntries(['prepare', ...groups].map(key => [key, needs[key]])), commit);
}

export function validateReceipts(directory, identity) {
  assert.deepEqual(readdirSync(directory).sort(), groups.map(group => `ci-macos-receipt-${group}.json`).sort(),
    'Expected exactly three group receipts');
  for (const group of groups) validateReceipt(json(join(directory, `ci-macos-receipt-${group}.json`)), group, identity);
}

async function digest(file, algorithm, encoding = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

// The preview and updater archives are identical bytes, not independent rebuilds
// or recompressions. Only this archive can be promoted after all groups pass.
export async function verifyCandidate(directory, commit, sha256) {
  const actual = { commit: readFileSync(join(directory, 'COMMIT.txt'), 'utf8').trim(),
    sha256: await digest(join(directory, preview), 'sha256') };
  validateIdentity(actual);
  assert.equal(actual.commit, commit, 'Wrong candidate commit');
  if (sha256 !== undefined) assert.equal(actual.sha256, sha256, 'Candidate archive hash mismatch');
  assert.equal(readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8').trim(),
    `${actual.sha256}  release/${preview}`, 'Wrong preview checksum');
  const versions = readdirSync(directory).filter(name => /^v\d/.test(name));
  assert.equal(versions.length, 1, 'Expected one versioned archive');
  const versionDir = join(directory, versions[0]);
  const metadata = json(join(versionDir, 'mac-update.json'));
  const name = `Desktop.for.Step.Code.${versions[0].slice(1)}.arm64.zip`;
  assert.equal(metadata.version, versions[0].slice(1));
  assert.equal(metadata.arch, 'arm64');
  assert.equal(metadata.bundleIdentifier, 'community.stepcode.desktop');
  assert.equal(metadata.files?.length, 1);
  assert.equal(metadata.files[0].url, name);
  assert.equal(metadata.files[0].size, statSync(join(versionDir, name)).size, 'Invalid updater size');
  assert.equal(await digest(join(versionDir, name), 'sha256'), actual.sha256, 'Updater archive differs from tested preview');
  assert.equal(await digest(join(versionDir, name), 'sha512', 'base64'), metadata.files[0].sha512, 'Invalid updater digest');
  assert.equal(readFileSync(join(versionDir, 'COMMIT-macos-arm64.txt'), 'utf8').trim(), commit);
  assert.equal(readFileSync(join(versionDir, 'SHA256SUMS-macos-arm64.txt'), 'utf8').trim(), `${actual.sha256}  ${name}`);
  assert.deepEqual(json(join(versionDir, 'runtime-manifest-macos-arm64.json')), json(join(directory, 'runtime-manifest.json')));
  return actual;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, directory] = process.argv.slice(2);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const identity = { commit: process.env.CI_MACOS_COMMIT, sha256: process.env.CI_MACOS_CANDIDATE_SHA256 };
  if (command === 'candidate') {
    if (identity.commit !== undefined) assert.equal(identity.commit, commit, 'Wrong source checkout');
    output(await verifyCandidate(directory, commit, identity.sha256));
  } else if (command === 'inputs' || command === 'receipt') {
    validateIdentity(identity);
    assert.equal(commit, identity.commit, 'Wrong source checkout');
    const group = process.env.CI_MACOS_GROUP;
    assert.ok(groups.includes(group), 'Unknown macOS group');
    if (command === 'receipt') {
      const receipt = { group, ...identity, nativeTerminal: process.env.CI_MACOS_TERMINAL_RESULT,
        source: json(join(directory, `ci-macos-source-${group}.json`)),
        package: json(join(directory, `ci-macos-package-${group}.json`)) };
      validateReceipt(receipt, group, identity);
      writeFileSync(join(directory, `ci-macos-receipt-${group}.json`), JSON.stringify(receipt, null, 2) + '\n');
      output({ group, complete: 'true', ...identity });
    }
  } else if (command === 'outcomes' || command === 'conclude') {
    const prepared = validateWorkflowOutcomes(JSON.parse(process.env.CI_MACOS_NEEDS), commit);
    if (command === 'conclude') {
      assert.ok(prepared, 'Documentation route cannot conclude or promote candidate receipts');
      validateReceipts(directory, prepared);
    }
    output({ 'docs-only': prepared ? 'false' : 'true' });
    console.log(`macOS ${command}: validated`);
  } else {
    throw new Error('Expected inputs, candidate, receipt, outcomes or conclude');
  }
}
