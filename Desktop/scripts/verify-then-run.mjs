import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

assert.equal(process.platform, 'win32', 'This acceptance exercises Windows Bash and the pinned runtime');
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(resolve('test-results/then-run-'));
const workspace = join(profile, 'Workspace with spaces');
const root = join(profile, 'step-runtime');
await mkdir(workspace, { recursive: true });
await mkdir(root);
let shellPath;
for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], join(process.env.LOCALAPPDATA ?? '', 'Programs')].filter(Boolean)) {
  const candidate = join(base, 'Git/bin/bash.exe');
  try { await access(candidate); shellPath = candidate; break; } catch {}
}
assert.ok(shellPath, 'Git for Windows is required');
const scenarios = new Map();
const received = new Map();
const errors = [];
const text = value => typeof value === 'string' ? value : value?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? '';
const chunk = (model, delta, finish_reason) => `data: ${JSON.stringify({ id: 'then-run-fixture',
  object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason }] })}\n\ndata: [DONE]\n\n`;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, 'Bearer isolated-then-run');
    let raw = '';
    for await (const part of req) { raw += part; assert.ok(raw.length < 8 * 1024 * 1024); }
    const body = JSON.parse(raw);
    const index = body.messages.findLastIndex(message => message.role === 'user' && scenarios.has(text(message.content)));
    assert.ok(index >= 0, 'request belongs to an explicit fixture scenario');
    const label = text(body.messages[index].content);
    const result = body.messages.slice(index + 1).find(message => message.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (result) {
      received.set(label, text(result.content));
      res.end(chunk(body.model, { content: `${label} COMPLETE` }, 'stop'));
    } else {
      const call = scenarios.get(label);
      res.end(chunk(body.model, { tool_calls: [{ index: 0, id: label, type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, 'tool_calls'));
    }
  } catch (error) { errors.push(error.message); if (!res.headersSent) res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [workspace], workspace }));
await writeFile(join(root, 'config.toml'), `shellPath = ${JSON.stringify(shellPath)}\ndefaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n`);
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-then-run',
  models: [{ id: 'fixture', name: 'Then run fixture', contextWindow: 32768, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1', TEMP: profile, TMP: profile };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const wait = async predicate => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    assert.deepEqual(errors, [], 'local fixture stays healthy');
    const state = await page.evaluate(() => window.desktop.snapshot());
    if (await predicate(state)) return state;
    await page.waitForTimeout(50);
  }
  throw new Error('then_run acceptance timed out');
};
const exists = file => access(join(workspace, file)).then(() => true, () => false);
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE }
    : { args: [resolve('.')] }), env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1360, 900);
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.waitForFunction(() => typeof window.desktop?.snapshot === 'function'
    && document.querySelector('.composer > .composer-input') && !document.querySelector('.composer > .composer-input').disabled);
  await page.evaluate(async workspace => {
    const draft = await window.desktop.beginSession(workspace);
    await window.desktop.createDraftSession(draft.draftId);
  }, workspace);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.workspace, workspace);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.composer > .composer-input')
    && !document.querySelector('.composer > .composer-input').disabled);
  const submit = async (label, name, args) => {
    scenarios.set(label, { name, args });
    await page.evaluate(message => window.desktop.command('prompt', { message }), label);
  };
  const finish = label => wait(state => !state.state.isStreaming && state.messages.some(message =>
    message.role === 'assistant' && text(message.content) === `${label} COMPLETE`));
  const approval = page.locator('.permission-approval:not(.is-closing)');
  const result = (state, label) => state.messages.find(message => message.role === 'toolResult' && message.toolCallId === label);
  await submit('THEN-ASK-ALLOW', 'write_file', { path: 'nested/approved.txt', content: 'approved\n',
    then_run: 'printf checked > approved-check.txt; printf CHECK_STDERR >&2; printf CHECK_OK' });
  await approval.waitFor();
  await approval.locator('.permission-approval-verification').getByText(/approved-check.txt/).waitFor();
  assert.match(await approval.locator('h2').innerText(), /写入文件并执行验证命令/);
  assert.ok(await approval.locator('.permission-approval-verification pre').evaluate(element => {
    const visible = element.closest('.permission-approval-content').getBoundingClientRect();
    const command = element.getBoundingClientRect();
    return command.top >= visible.top && command.bottom <= visible.bottom + 1;
  }), 'the embedded command is visible before approving the compact drawer');
  assert.equal(await exists('nested/approved.txt'), false, 'the entire fused call waits for approval');
  assert.equal(await exists('approved-check.txt'), false);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/then-run-approval.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 760));
  await page.evaluate(() => window.desktop.preferences({ language: 'en', theme: 'light' }));
  await page.reload();
  await approval.waitFor();
  await approval.locator('.approval-drawer-grip').press('End');
  await page.waitForTimeout(250);
  assert.match(await approval.locator('h2').innerText(), /Write a file and run a verification command/);
  assert.ok(await approval.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
      && element.scrollWidth <= element.clientWidth
      && [...element.querySelectorAll('footer button')].every(button => button.scrollWidth <= button.clientWidth);
  }), 'fused approval fits English/light/narrow layouts');
  await page.screenshot({ path: 'test-results/then-run-approval-light-en-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await page.evaluate(() => window.desktop.preferences({ language: 'zh', theme: 'dark' }));
  await page.reload();
  await approval.waitFor();
  await approval.getByRole('button', { name: '批准本次操作', exact: true }).click();
  const allowed = result(await finish('THEN-ASK-ALLOW'), 'THEN-ASK-ALLOW');
  assert.equal(allowed.isError, false);
  assert.equal(allowed.details.thenRun.exitCode, 0);
  assert.equal(await readFile(join(workspace, 'approved-check.txt'), 'utf8'), 'checked');
  assert.match(received.get('THEN-ASK-ALLOW'), /CHECK_STDERR[\s\S]*CHECK_OK|CHECK_OK[\s\S]*CHECK_STDERR/);
  await page.getByText('写入了文件 · 验证通过', { exact: true }).first().waitFor();

  await writeFile(join(workspace, 'denied.txt'), 'before\n');
  await submit('THEN-ASK-DENY', 'edit_file', { path: 'denied.txt', search: 'before', replace: 'after',
    then_run: 'printf forbidden > denied-check.txt' });
  await approval.waitFor();
  assert.match(await approval.locator('.permission-approval-content > .permission-approval-input').first().innerText(), /替换前\nbefore[\s\S]*替换后\nafter/);
  await approval.getByRole('button', { name: '拒绝本次操作', exact: true }).click();
  assert.equal(result(await finish('THEN-ASK-DENY'), 'THEN-ASK-DENY').isError, true);
  assert.equal(await readFile(join(workspace, 'denied.txt'), 'utf8'), 'before\n');
  assert.equal(await exists('denied-check.txt'), false, 'denial prevents both mutation and command');

  await page.evaluate(() => window.desktop.command('set_permission_preset', { preset: 'approve-for-me' }));
  await submit('THEN-NONZERO', 'edit_file', { path: 'denied.txt', search: 'before', replace: 'after',
    then_run: 'printf CHECK_FAILED >&2; exit 7' });
  const nonzero = result(await finish('THEN-NONZERO'), 'THEN-NONZERO');
  assert.equal(nonzero.isError, false, 'failed verification does not roll back a successful edit');
  assert.equal(nonzero.details.thenRun.exitCode, 7);
  assert.equal(await readFile(join(workspace, 'denied.txt'), 'utf8'), 'after\n');
  assert.match(received.get('THEN-NONZERO'), /CHECK_FAILED[\s\S]*Command exited with code 7/);
  await page.getByText('修改了文件 · 验证失败', { exact: true }).first().waitFor();
  assert.equal(await approval.count(), 0);

  // The destructive rule is exercised only on a named empty fixture directory.
  await mkdir(join(workspace, 'empty-for-rule'));
  await submit('THEN-RISK-DENY', 'write_file', { path: 'risk.txt', content: 'not yet\n', then_run: 'rm -rf ./empty-for-rule' });
  await approval.waitFor();
  assert.match(await approval.innerText(), /高风险/);
  await approval.locator('.permission-approval-verification').getByText('rm -rf ./empty-for-rule', { exact: true }).waitFor();
  await approval.getByRole('button', { name: '拒绝本次操作', exact: true }).click();
  await finish('THEN-RISK-DENY');
  assert.equal(await exists('risk.txt'), false);
  assert.equal(await exists('empty-for-rule'), true);
  const enabling = page.evaluate(() => window.desktop.command('set_permission_preset', { preset: 'full-access' }));
  enabling.catch(() => {});
  const fullAccess = page.getByRole('dialog', { name: '启用完全访问？', exact: true });
  await fullAccess.waitFor();
  await fullAccess.getByRole('button', { name: '仅本会话启用', exact: true }).click();
  await enabling;
  await submit('THEN-FULL-RISK', 'write_file', { path: 'risk.txt', content: 'full access\n', then_run: 'rm -rf ./empty-for-rule' });
  assert.equal(result(await finish('THEN-FULL-RISK'), 'THEN-FULL-RISK').details.thenRun.exitCode, 0);
  assert.equal(await exists('empty-for-rule'), false, 'acknowledged Full Access permits the fused command');
  assert.equal(await approval.count(), 0);
  await page.evaluate(() => window.desktop.command('set_permission_preset', { preset: 'approve-for-me' }));
  await submit('THEN-NOOP', 'write_file', { path: 'nested/approved.txt', content: 'approved\n',
    then_run: 'printf checked > noop-check.txt' });
  const noop = result(await finish('THEN-NOOP'), 'THEN-NOOP');
  assert.equal(noop.details.changed, false);
  assert.equal(noop.details.thenRun.exitCode, 0);
  assert.equal(await readFile(join(workspace, 'noop-check.txt'), 'utf8'), 'checked', 'unchanged content does not suppress an explicit check');

  await submit('THEN-EDIT-FAIL', 'edit_file', { path: 'denied.txt', search: 'missing text', replace: 'unused',
    then_run: 'printf forbidden > edit-failed-check.txt' });
  assert.equal(result(await finish('THEN-EDIT-FAIL'), 'THEN-EDIT-FAIL').isError, true);
  assert.equal(await exists('edit-failed-check.txt'), false, 'failed edit must not execute verification');

  await submit('THEN-STOP', 'write_file', { path: 'stop.txt', content: 'stop applied\n',
    then_run: `bash -c 'printf started > stop-started; for ((attempt=0; attempt<300; attempt++)); do if [ -f stop-release ]; then printf forbidden > stop-late; exit 0; fi; sleep 0.1; done; exit 9'; printf forbidden > stop-outer` });
  const stopApprovals = new Set();
  await wait(async state => {
    for (const request of state.requests ?? []) {
      if (stopApprovals.has(request.id)) continue;
      assert.equal(request.method, 'confirm');
      assert.match(request.title, /^Approve write_file \[/);
      await approval.getByRole('button', { name: '批准本次操作', exact: true }).click();
      stopApprovals.add(request.id);
    }
    return exists('stop-started');
  });
  await page.evaluate(() => window.desktop.command('abort'));
  const stopped = await wait(state => !state.state.isStreaming);
  assert.equal(await readFile(join(workspace, 'stop.txt'), 'utf8'), 'stop applied\n');
  const stoppedResult = result(stopped, 'THEN-STOP');
  assert.equal(stoppedResult?.isError, true);
  assert.match(text(stoppedResult.content), /Wrote 13 chars[\s\S]*then_run:[\s\S]*Command aborted/);
  await writeFile(join(workspace, 'stop-release'), 'release\n');
  await page.waitForTimeout(1000);
  assert.equal(await exists('stop-late'), false, 'stop kills the verification process tree');
  assert.equal(await exists('stop-outer'), false);
  await page.reload();
  await page.getByText('修改了文件 · 验证失败', { exact: true }).first().waitFor();
  await page.getByText('文件修改或验证未完成', { exact: true }).first().waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/then-run-results.png' });

  const runtime = await app.evaluate(({ app }) => app.isPackaged ? `${process.resourcesPath}/runtime` : undefined) ?? resolve('runtime');
  const native = join(profile, 'Native checks with spaces');
  await mkdir(native);
  const nativeOutput = execFileSync(join(runtime, 'node/node.exe'),
    [resolve('scripts/then-run-native-probe.mjs'), runtime, native, shellPath], {
      cwd: native, env: { ...env, STEP_AGENT_DIR: join(native, 'agent') }, encoding: 'utf8', windowsHide: true, timeout: 60000,
    });
  console.log(nativeOutput.trim());
  assert.deepEqual(errors, []);
  console.log('then_run RPC/UI passed: fused approval, denial prevents both operations, safe automatic execution, risky-command gate/acknowledged Full Access, no-op verification, edit failure skips check, nonzero receipt, cancellation and history reload. Local HTTP fixture only.');
} catch (error) {
  if (page) await page.screenshot({ path: 'test-results/then-run-failure.png' }).catch(() => {});
  if (page) console.error('then_run fixture state:', await page.evaluate(async () => {
    const state = await window.desktop.snapshot();
    return { status: state.status, streaming: state.state?.isStreaming, draft: Boolean(state.draftId),
      messages: state.messages.map(message => ({ role: message.role, tool: message.toolName, error: message.isError })),
      requests: state.requests?.map(request => ({ method: request.method, title: request.title })) };
  }).catch(() => undefined));
  throw error;
} finally {
  if (page) await page.evaluate(async () => {
    const state = await window.desktop.snapshot();
    for (const request of state.requests ?? []) await window.desktop.command('extension_ui_response', { id: request.id, cancelled: true }, request.runtimeId);
    if (state.state?.isStreaming) await window.desktop.command('abort', {}, state.runtimeId);
  }).catch(() => {});
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close();
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
