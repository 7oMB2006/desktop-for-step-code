import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { groupScripts } from './ci-windows.mjs';

export const stages = Object.freeze({
  validate: 'Validate acceptance group',
  upstream_fetch: 'Fetch pinned Step Code',
  upstream_patch: 'Apply integration patch',
  upstream_build: 'Install and build Step Code',
  desktop_install: 'Install Desktop dependencies',
  upstream_plan: 'Upstream Plan tests',
  preview_browser: 'Install startup preview browser',
  upstream_shell: 'Upstream Windows shell tests',
  upstream_compatibility: 'Upstream command and usage tests',
  upstream_clm: 'Upstream automatic CLM tests',
  upstream_workflow: 'Upstream Workflow tests',
  runtime_stage: 'Runtime staging',
  typecheck: 'Typecheck',
  protocol: 'Protocol tests',
  desktop_build: 'Desktop build',
  acceptance: 'Serial Electron acceptance',
});

const outcomes = new Set(['success', 'failure', 'cancelled', 'skipped']);

function validateReport(report, group, scripts) {
  const invalid = () => { throw new Error('Invalid Windows acceptance report'); };
  if (report?.group !== group || report.expected !== scripts.length
    || typeof report.complete !== 'boolean' || !Array.isArray(report.results)
    || report.results.length > scripts.length) invalid();
  for (const [index, row] of report.results.entries()) {
    if (row?.script !== scripts[index] || !['success', 'failure'].includes(row.status)
      || !Number.isFinite(row.seconds) || row.seconds < 0
      || (row.status === 'failure' && index !== report.results.length - 1)) invalid();
  }
  if (report.active !== null) {
    if (report.results.length >= scripts.length || report.active?.script !== scripts[report.results.length]
      || !Number.isFinite(report.active.timeoutMs) || report.active.timeoutMs <= 0
      || !Number.isFinite(Date.parse(report.active.startedAt))
      || report.results.some(row => row.status === 'failure')) invalid();
  }
  if (report.complete && (report.active !== null || report.results.length !== scripts.length
    || report.results.some(row => row.status !== 'success'))) invalid();
}

export function summarizeWindows({ group, steps, report }) {
  const scripts = groupScripts(group);
  if (!steps || Object.keys(stages).some(id => !outcomes.has(steps[id]))) {
    throw new Error('Missing or invalid Windows stage outcomes');
  }
  if (report !== undefined) validateReport(report, group, scripts);
  const acceptance = steps.acceptance;
  if (acceptance === 'success' && !report?.complete) {
    throw new Error('Successful acceptance is missing its complete report');
  }
  if (acceptance === 'skipped' && report !== undefined) {
    throw new Error('Skipped acceptance has an unexpected report');
  }
  const failedStages = Object.keys(stages).filter(id => steps[id] === 'failure');
  const cancelledStages = Object.keys(stages).filter(id => steps[id] === 'cancelled');
  const failed = report?.results.find(row => row.status === 'failure');
  const active = report?.active;
  const annotations = failedStages.map(id => `Windows ${group}: ${stages[id]} failed.`);
  if (failed) annotations.push(`Windows ${group}: ${failed.script} failed after ${failed.seconds}s.`);
  if (active) annotations.push(`Windows ${group}: ${active.script} did not finish recording a result.`);

  const lines = [
    `## Windows diagnostics: ${group}`,
    '',
    `Failed stages: ${failedStages.map(id => stages[id]).join(', ') || 'none'}.`,
    `Cancelled stages: ${cancelledStages.map(id => stages[id]).join(', ') || 'none'}.`,
    `Electron acceptance step: ${acceptance}.`,
    '',
  ];
  if (report === undefined) {
    lines.push('No acceptance report was produced. Acceptance completion is not established.');
  } else {
    const remaining = scripts.length - report.results.length - (active ? 1 : 0);
    lines.push(
      `Recorded: ${report.results.length}/${scripts.length}; complete: ${report.complete}.`,
      `Not started: ${remaining}.`,
    );
    if (failed) lines.push(`Failed script: \`${failed.script}\` (${failed.seconds}s).`);
    if (active) {
      lines.push(`Last recorded active script: \`${active.script}\` (deadline ${active.timeoutMs}ms).`,
        'No result was recorded for this script; this alone does not prove a timeout.');
    }
    if (!report.complete && !failed && !active) {
      lines.push('Incomplete report: no active script or recorded failure; inspect the job log.');
    }
    const slowest = [...report.results].sort((a, b) => b.seconds - a.seconds).slice(0, 5);
    if (slowest.length) {
      lines.push('', '### Slowest Recorded Checks', '', '| Acceptance | Result | Seconds |',
        '| --- | --- | ---: |',
        ...slowest.map(row => `| ${row.script} | ${row.status} | ${row.seconds} |`));
    }
  }
  lines.push('', 'This summary does not retry tests or grant a completion receipt.',
    'Use the job log, protocol TAP and failure screenshots for root-cause evidence.', '');
  return { markdown: lines.join('\n'), annotations };
}

export function writeWindowsSummary({ group, steps, directory, summary, annotate = console.log }) {
  groupScripts(group);
  const path = join(directory, `ci-${group}.json`);
  let result;
  let error;
  try {
    const report = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
    result = summarizeWindows({ group, steps, report });
  } catch {
    // Never copy unvalidated report contents or arbitrary exception text into Actions output.
    error = new Error('Windows diagnostics could not validate stage outcomes or the acceptance report');
    result = {
      markdown: `## Windows diagnostics: ${group}\n\nDiagnostics unavailable: invalid stage outcomes or acceptance report.\n`,
      annotations: [error.message],
    };
  }
  writeFileSync(join(directory, `ci-windows-${group}-summary.md`), result.markdown);
  if (summary) appendFileSync(summary, result.markdown);
  for (const message of result.annotations) annotate(`::error::${message}`);
  if (error) throw error;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const group = process.env.CI_WINDOWS_GROUP;
  groupScripts(group);
  const directory = join(root, 'Desktop/test-results');
  mkdirSync(directory, { recursive: true });
  let steps;
  try { steps = JSON.parse(process.env.CI_WINDOWS_STEPS ?? '{}'); } catch {}
  writeWindowsSummary({ group, steps, directory, summary: process.env.GITHUB_STEP_SUMMARY });
}
