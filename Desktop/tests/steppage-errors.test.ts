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
test('preparation and capability edits retain idle checks without stopping Cron hosts; polling keeps feedback', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const prepare = main.slice(main.indexOf("case 'prepareStepPage':"), main.indexOf("case 'settings':"));
  assert.match(prepare, /guardIdle\(\{ stopHost: false \}\)/);
  for (const method of ['capabilityMutate', 'capabilityImportSkill']) {
    const start = main.indexOf(`case '${method}':`);
    assert.match(main.slice(start, main.indexOf("\n    case ", start + 1)), /guardIdle\(\{ stopHost: false \}\)/);
  }
  assert.equal(main.match(/guardIdle\(\{ stopHost: false \}\)/g)?.length, 4);
  const app = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const entry = app.slice(app.indexOf('<CapabilitySettings'), app.indexOf('/> : null}', app.indexOf('<CapabilitySettings')));
  assert.doesNotMatch(entry, /applySnapshot/);
  assert.match(entry, /const next = await bridge!\.restart\(\)/);
  const view = await readFile(new URL('../src/StepPageSettings.tsx', import.meta.url), 'utf8');
  assert.match(view, /setState\(value\); setReadError\(''\)/);
  assert.doesNotMatch(view, /setState\(value\); setError\(''\)/);
});
test('StepPage setup supports both platforms and startup carries failed Desktop verification to the config lock', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  assert.match(main, /const stepPage = new StepPagePreparer/);
  assert.match(main, /desktopBundle \|\| rejectedBundlePath \|\| process\.platform !== 'win32' \? stepPage\.bundlePath/);
  assert.match(main, /steppageBundle === stepPage\.bundlePath \? \{ homePath: stepPage\.homePath \}/);
  assert.doesNotMatch(main, /StepPage preparation is Windows-only/);
  assert.match(main, /const rejectedBundlePath = !desktopBundle && existsSync\(stepPage\.bundlePath\) \? stepPage\.bundlePath : undefined/);
  assert.match(main, /admin\.request\('reconcile_steppage', \{ bundlePath: steppageBundle, rejectedBundlePath/);
  const admin = await readFile(new URL('../electron/admin.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(admin, /StepPage preparation is Windows-only/);
  assert.match(admin, /bundleExists: existsSync\(message\.bundlePath\) && message\.bundlePath !== message\.rejectedBundlePath/);
  const view = await readFile(new URL('../src/CapabilitySettings.tsx', import.meta.url), 'utf8');
  assert.match(view, /<CapabilityDisclosure className="cap-preparation"/);
  assert.doesNotMatch(view, /bridge\.platform === 'win32'/);
  assert.match(view, /const stepPage = <StepPageSettings/);
});
