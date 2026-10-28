import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { groupScripts } from './ci-windows.mjs';
import { stages, summarizeWindows, writeWindowsSummary } from './windows-ci-summary.mjs';

const steps = overrides => ({ ...Object.fromEntries(Object.keys(stages).map(id => [id, 'success'])), ...overrides });
const report = (group = 'sessions') => ({
  group, expected: groupScripts(group).length, complete: true, active: null,
  results: groupScripts(group).map((script, index) => ({ script, status: 'success', seconds: index + 1 })),
});

test('successful Windows summaries cover every group without changing completion receipts', () => {
  for (const group of ['interface', 'sessions', 'runtime']) {
    const receipt = report(group);
    const before = structuredClone(receipt);
    const result = summarizeWindows({ group, steps: steps(), report: receipt });
    assert.match(result.markdown, /complete: true/);
    assert.match(result.markdown, /Not started: 0/);
    assert.match(result.markdown, /Slowest Recorded Checks/);
    assert.equal(result.markdown.split('\n').filter(line => /^\| verify-/.test(line)).length, 5);
    assert.deepEqual(result.annotations, []);
    assert.deepEqual(receipt, before);
  }
});

test('failure names both the Windows stage and script and counts scripts not started', () => {
  const receipt = report();
  receipt.complete = false;
  receipt.results = receipt.results.slice(0, 2);
  receipt.results[1].status = 'failure';
  const result = summarizeWindows({ group: 'sessions', steps: steps({ acceptance: 'failure' }), report: receipt });
  assert.match(result.markdown, /Failed stages: Serial Electron acceptance/);
  assert.match(result.markdown, /Failed script: `verify-launch-modes.mjs`/);
  assert.ok(result.markdown.includes(`Not started: ${receipt.expected - 2}`));
  assert.equal(result.annotations.length, 2);
});

test('preparation failures and missing reports do not claim acceptance ran or passed', () => {
  const result = summarizeWindows({
    group: 'runtime', steps: steps({ upstream_build: 'failure', acceptance: 'skipped' }),
  });
  assert.match(result.markdown, /Install and build Step Code/);
  assert.match(result.markdown, /No acceptance report was produced/);
  assert.doesNotMatch(result.markdown, /complete: true/);
});

test('a script interrupted before recording its result is not misdiagnosed as a timeout', () => {
  const receipt = report();
  receipt.complete = false;
  receipt.results = receipt.results.slice(0, 1);
  receipt.active = { script: groupScripts('sessions')[1], timeoutMs: 300000, startedAt: new Date().toISOString() };
  const result = summarizeWindows({ group: 'sessions', steps: steps({ acceptance: 'cancelled' }), report: receipt });
  assert.match(result.markdown, /Cancelled stages: Serial Electron acceptance/);
  assert.match(result.markdown, /Last recorded active script: `verify-launch-modes.mjs`/);
  assert.match(result.markdown, /does not prove a timeout/);
  assert.ok(result.markdown.includes(`Not started: ${receipt.expected - 2}`));
});

test('an early acceptance failure without a report remains an explicit diagnostic gap', () => {
  const result = summarizeWindows({ group: 'sessions', steps: steps({ acceptance: 'failure' }) });
  assert.match(result.markdown, /No acceptance report/);
  assert.equal(result.annotations.length, 1);
});

test('incomplete reports between checks do not invent a failing script', () => {
  const receipt = report();
  receipt.complete = false;
  receipt.results = [];
  const result = summarizeWindows({ group: 'sessions', steps: steps({ acceptance: 'failure' }), report: receipt });
  assert.match(result.markdown, /Incomplete report/);
  assert.doesNotMatch(result.markdown, /Failed script:/);
});

test('contradictory outcomes, incomplete success receipts and invalid groups are rejected', () => {
  assert.throws(() => summarizeWindows({ group: 'typo', steps: steps() }), /Unknown/);
  assert.throws(() => summarizeWindows({ group: 'sessions', steps: {} }), /outcomes/);
  assert.throws(() => summarizeWindows({ group: 'sessions', steps: steps({ protocol: 'unknown' }) }), /outcomes/);
  assert.throws(() => summarizeWindows({ group: 'sessions', steps: steps() }), /complete report/);
  assert.throws(() => summarizeWindows({
    group: 'sessions', steps: steps({ acceptance: 'skipped' }), report: report(),
  }), /unexpected report/);
  const incomplete = report();
  incomplete.complete = false;
  assert.throws(() => summarizeWindows({ group: 'sessions', steps: steps(), report: incomplete }), /complete report/);
});

test('untrusted script names, malformed durations and inconsistent receipts never reach Markdown or annotations', () => {
  const changes = [
    receipt => { receipt.group = 'runtime'; },
    receipt => { receipt.expected++; },
    receipt => { receipt.complete = 'true'; },
    receipt => { receipt.results[0].script = '::error::injected'; },
    receipt => { receipt.results[0].seconds = NaN; },
    receipt => { receipt.results[0].seconds = Infinity; },
    receipt => { receipt.results[0].seconds = -1; },
    receipt => { receipt.results[0].status = 'failure'; },
    receipt => { receipt.results.reverse(); },
    receipt => { receipt.results.pop(); },
    receipt => { delete receipt.active; },
    receipt => { receipt.active = { script: 'unexpected', startedAt: 'bad', timeoutMs: 0 }; },
  ];
  for (const change of changes) {
    const receipt = report();
    change(receipt);
    assert.throws(() => summarizeWindows({ group: 'sessions', steps: steps(), report: receipt }), /Invalid/);
  }
  const result = summarizeWindows({
    group: 'sessions', steps: { ...steps(), untrusted: { outputs: { token: 'DO_NOT_EMIT' } } },
    report: { ...report(), extra: 'DO_NOT_EMIT' },
  });
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_EMIT/);
});

test('summary files are written without modifying source receipts or emitting arbitrary diagnostic content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ci-windows-summary-'));
  const path = join(directory, 'ci-sessions.json');
  const summary = join(directory, 'job-summary.md');
  try {
    const source = JSON.stringify(report());
    writeFileSync(path, source);
    writeFileSync(summary, '# Existing summary\n');
    writeWindowsSummary({ group: 'sessions', steps: steps(), directory, summary, annotate() {} });
    assert.equal(readFileSync(path, 'utf8'), source);
    assert.match(readFileSync(summary, 'utf8'), /^# Existing summary\n## Windows diagnostics/);
    assert.match(readFileSync(join(directory, 'ci-windows-sessions-summary.md'), 'utf8'), /complete: true/);
    writeFileSync(path, 'SECRET_INVALID_JSON');
    const annotations = [];
    assert.throws(() => writeWindowsSummary({
      group: 'sessions', steps: steps(), directory, summary, annotate: message => annotations.push(message),
    }), /could not validate/);
    assert.match(annotations[0], /^::error::Windows diagnostics/);
    assert.doesNotMatch(readFileSync(summary, 'utf8') + annotations.join(), /SECRET_INVALID_JSON/);
  } finally {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
