import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { _electron as electron } from 'playwright';
import { queueFixture } from './queue-demo-fixture.mjs';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const evidence = resolve('test-results');
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(evidence, 'import-large-'));
const fixture = await queueFixture(profile, { duration: 100 });
const source = join(profile, 'codex');
await mkdir(join(source, 'sessions'), { recursive: true });
const now = '2026-10-23T00:00:00.000Z';
const message = (role, text) => ({ type: 'response_item', timestamp: now,
  payload: { type: 'message', role, content: [{ type: 'text', text }] } });
const records = [
  { type: 'session_meta', payload: { id: 'large-synthetic', cwd: fixture.workspace, cli_version: 'test' } },
  message('user', 'Large synthetic history'),
  { type: 'response_item', payload: { type: 'function_call', call_id: 'large-read', name: 'read_file',
    arguments: JSON.stringify({ path: 'historical.txt' }) } },
  { type: 'response_item', payload: { type: 'function_call_output', call_id: 'large-read',
    output: 'x'.repeat(56 * 1024 * 1024) } },
  message('assistant', '[Historical image_generation_call]\n' + JSON.stringify({ result: 'a'.repeat(3_040_000) })),
  { type: 'compacted', payload: { message: 'Historical file inspection is complete. Continue from this summary.' } },
  message('assistant', 'Large history is ready.'),
];
const sourcePath = join(source, 'sessions', 'rollout-large.jsonl');
const original = records.map(record => JSON.stringify(record)).join('\n') + '\n';
await writeFile(sourcePath, original);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  CODEX_HOME: source, CLAUDE_CONFIG_DIR: join(profile, 'absent-claude') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE }
    : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
  });
  await page.waitForFunction(() => window.desktop && document.querySelector('.new-chat')?.disabled === false);
  await page.evaluate(async source => {
    const scan = await window.desktop.importScan({ codexRoot: source });
    const preview = await window.desktop.importPreview(scan.candidates[0].id);
    await window.desktop.importStart([{ candidateId: preview.id, fingerprint: preview.fingerprint, cwd: preview.cwd }]);
  }, source);
  let job;
  for (let attempt = 0; attempt < 120; attempt++) {
    const jobs = await page.evaluate(() => window.desktop.importJobs());
    job = jobs[0];
    if (job?.status === 'completed' && job.results.length) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(job?.status, 'completed');
  const imported = job.results[0];
  assert.equal(imported.status, 'imported');
  const row = page.locator(`.session-row[data-reorder-id="${imported.sessionId}"] > button`).first();
  await row.waitFor({ timeout: 10000 });
  const opened = performance.now();
  await row.click();
  await page.getByText('Large history is ready.', { exact: true }).waitFor({ timeout: 10000 });
  const openMs = performance.now() - opened;
  assert.ok(openMs < 10000, `large history open took ${openMs.toFixed(0)}ms`);
  await page.locator('.process-tool > summary').click();
  const output = page.locator('.tool-output .large-message-text');
  await output.waitFor();
  assert.ok((await output.textContent()).length < 40000);
  await output.getByRole('button', { name: '下一段' }).click();
  assert.equal(await output.getAttribute('data-page'), '2');
  const sent = performance.now();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Continue the large imported sample.');
  await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
  await page.getByText('这一轮已处理完成。', { exact: true }).waitFor({ timeout: 10000 });
  const continueMs = performance.now() - sent;
  assert.ok(continueMs < 10000, `local continuation took ${continueMs.toFixed(0)}ms`);
  assert.ok(fixture.requests.some(text => text.includes('Continue the large imported sample.')));
  assert.equal(await readFile(sourcePath, 'utf8'), original, 'source history remains unchanged');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(evidence, 'import-large-electron.png') });
  const result = { sourceBytes: Buffer.byteLength(original), openMs, continueMs, paidModels: false };
  await writeFile(join(evidence, 'import-large-electron.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (app) await closeDesktopFixture(app);
  await fixture.close();
}
