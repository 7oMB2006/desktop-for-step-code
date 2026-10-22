import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stepPageOperationError } from '../src/steppage-errors';

test('StepPage messages distinguish a protected Cron restart from installation or an active turn', () => {
  const cron = new Error('Error invoking remote method: Delete scheduled Cron jobs before restarting or changing this runtime; Cron state must be available');
  assert.match(stepPageOperationError(cron, 'restart', 'zh'), /未执行重启.*新会话/);
  assert.doesNotMatch(stepPageOperationError(cron, 'prepare', 'zh'), /等待当前任务|删除/);
  assert.match(stepPageOperationError(new Error('Stop this session task first'), 'prepare', 'en'), /awaiting confirmation/);
  assert.match(stepPageOperationError(new Error('Shared settings operation in progress'), 'prepare', 'zh'), /其他设置/);
  assert.match(stepPageOperationError(new Error('Pause the active goal first'), 'prepare', 'zh'), /Goal/);
  assert.match(stepPageOperationError(new Error('Send or withdraw the pending messages first'), 'prepare', 'en'), /queued messages/);
  assert.doesNotMatch(stepPageOperationError(new Error('private-token raw subprocess'), 'prepare', 'en'), /private|subprocess/);
});
test('only preparation opts out of host-stop guards; polling cannot erase operation feedback', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const prepare = main.slice(main.indexOf("case 'prepareStepPage':"), main.indexOf("case 'settings':"));
  assert.match(prepare, /guardIdle\(\{ stopHost: false \}\)/);
  assert.equal(main.match(/guardIdle\(\{ stopHost: false \}\)/g)?.length, 1);
  const app = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const entry = app.slice(app.indexOf('<StepPageSettings'), app.indexOf("<h3>{t('Skills 与命令'"));
  assert.doesNotMatch(entry, /applySnapshot/);
  assert.match(entry, /const next = await bridge!\.restart\(\)/);
  const view = await readFile(new URL('../src/StepPageSettings.tsx', import.meta.url), 'utf8');
  assert.match(view, /setState\(value\); setReadError\(''\)/);
  assert.doesNotMatch(view, /setState\(value\); setError\(''\)/);
});
test('StepPage setup is Windows-only and startup carries failed Desktop verification to the config lock', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  assert.match(main, /const stepPage = process\.platform === 'win32'\s*\? new StepPagePreparer/);
  for (const method of ['stepPageState', 'prepareStepPage']) {
    const start = main.indexOf(`case '${method}':`);
    assert.match(main.slice(start, start + 180), /if \(!stepPage\) throw new Error\('StepPage preparation is Windows-only'\)/);
  }
  assert.match(main, /const rejectedBundlePath = !desktopBundle && existsSync\(stepPage\.bundlePath\) \? stepPage\.bundlePath : undefined/);
  assert.match(main, /admin\.request\('reconcile_steppage', \{ bundlePath: steppageBundle, rejectedBundlePath/);
  const admin = await readFile(new URL('../electron/admin.mjs', import.meta.url), 'utf8');
  assert.match(admin, /case 'reconcile_steppage': \{\s*if \(process\.platform !== 'win32'\)/);
  assert.match(admin, /bundleExists: existsSync\(message\.bundlePath\) && message\.bundlePath !== message\.rejectedBundlePath/);
  const app = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(app, /bridge\?\.platform === 'win32' && <button onClick=\{\(\) => setTab\('skills'\)\}/);
  assert.match(app, /bridge\?\.platform === 'win32' && <><h3>\{t\('内置插件', 'Built-in plugins'\)\}<\/h3><StepPageSettings/);
});
