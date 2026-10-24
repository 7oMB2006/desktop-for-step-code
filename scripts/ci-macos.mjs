import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macosGroupScripts, validateMacosInventory } from './ci-acceptance.mjs';
import { runGroup } from './ci-windows.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const group = process.env.CI_MACOS_GROUP ?? 'all';
  validateMacosInventory(readdirSync(join(root, 'Desktop/scripts')).filter(file => /^verify-.*\.mjs$/.test(file)));
  const scripts = macosGroupScripts(group);
  if (process.argv.length === 3 && process.argv[2] === '--list') {
    console.log(`${group}: ${scripts.length} serial checks\n${scripts.join('\n')}`);
  } else if (process.argv.length !== 2) {
    throw new Error('Expected no argument or --list');
  } else {
    const controller = new AbortController();
    const interrupt = () => controller.abort(new Error('Acceptance interrupted'));
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const destination = join(root, 'Desktop/test-results');
    mkdirSync(destination, { recursive: true });
    const report = { group, expected: scripts.length, complete: false, active: null, results: [] };
    const save = () => writeFileSync(join(destination, `ci-macos-${process.env.DESKTOP_VERIFY_EXE ? 'package' : 'source'}-${group}.json`), JSON.stringify(report, null, 2) + '\n');
    save();
    try {
      report.results = await runGroup(group, {
        scripts,
        signal: controller.signal,
        record: (rows, active) => { report.results = [...rows]; report.active = active; save(); },
      });
      report.complete = true;
    } finally {
      save();
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY,
          `## macOS ${process.env.DESKTOP_VERIFY_EXE ? 'package' : 'source'} ${group}\n\n${report.results.length}/${scripts.length} checks executed; complete: ${report.complete}\n\n`
          + '| Acceptance | Result | Seconds |\n| --- | --- | ---: |\n'
          + report.results.map(row => `| ${row.script} | ${row.status} | ${row.seconds} |`).join('\n') + '\n');
      }
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `group=${group}\ncomplete=true\n`);
    }
  }
}
