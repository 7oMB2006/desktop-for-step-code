import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executeWithLog } from './ci-macos.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'Desktop');
export const protocolTimeout = 300000;

export function protocolFiles(entries) {
  const files = entries.filter(file => file.endsWith('.test.ts')).sort();
  if (!files.length || new Set(files).size !== files.length
    || files.some(file => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.ts$/.test(file)))
    throw new Error('Invalid or empty protocol test inventory');
  return files;
}

export async function runProtocol({
  files = protocolFiles(readdirSync(join(desktop, 'tests'))),
  execute = executeWithLog, record = () => {}, signal, log = console.log,
  directory = join(desktop, 'test-results/protocol'),
} = {}) {
  const inventory = protocolFiles(files);
  if (inventory.length !== files.length || inventory.some((file, index) => file !== files[index]))
    throw new Error('Protocol inventory must be complete, unique and sorted');
  mkdirSync(directory, { recursive: true });
  const report = { files: inventory, expected: inventory.length, complete: false, active: null, results: [] };
  await record(report);
  for (const file of inventory) {
    signal?.throwIfAborted();
    report.active = { file, startedAt: new Date().toISOString(), timeoutMs: protocolTimeout };
    await record(report);
    log(`::group::Protocol ${file}`);
    const started = performance.now();
    let failure;
    try {
      await execute(join(desktop, 'node_modules/tsx/dist/cli.mjs'), {
        cwd: desktop, signal, timeout: protocolTimeout, logDirectory: directory, logName: file,
        args: ['--test', '--test-concurrency=1', '--test-reporter=spec', '--test-reporter=tap',
          '--test-reporter-destination=stdout', `--test-reporter-destination=${join(directory, `${file}.tap`)}`,
          join('tests', file)],
      });
    } catch (error) { failure = error; }
    report.results.push({ file, status: failure ? 'failure' : 'success',
      seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
      ...(failure ? { reason: failure.message } : {}) });
    report.active = null;
    await record(report);
    log('::endgroup::');
    if (failure) throw new Error(`Protocol ${file} failed`, { cause: failure });
  }
  signal?.throwIfAborted();
  report.complete = true;
  await record(report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = protocolFiles(readdirSync(join(desktop, 'tests')));
  if (process.argv.length === 3 && process.argv[2] === '--list') {
    console.log(files.join('\n'));
  } else if (process.argv.length !== 2) throw new Error('Expected no argument or --list');
  else {
    const controller = new AbortController();
    const interrupt = () => controller.abort(new Error('Protocol suite interrupted'));
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const directory = join(desktop, 'test-results/protocol');
    mkdirSync(directory, { recursive: true });
    let last;
    try {
      await runProtocol({ files, directory, signal: controller.signal, record(report) {
        last = report;
        writeFileSync(join(directory, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
      } });
    } finally {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      if (last && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `## Protocol Tests\n\n${last.results.length}/${last.expected} files; complete: ${last.complete}.\n\n`
        + '| File | Result | Seconds |\n| --- | --- | ---: |\n'
        + last.results.map(row => `| ${row.file} | ${row.status} | ${row.seconds} |`).join('\n') + '\n'
        + '\nEach file retains independent TAP and console logs in the protocol diagnostics artifact.\n');
    }
  }
}
