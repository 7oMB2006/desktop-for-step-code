import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise the production renderer with isolated synthetic requests. No
// command, approval or model request reaches a real user session.
const profile = await realpath(await mkdtemp(join(tmpdir(), 'step-permission-ui-')));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
let phase = 'Electron launch';
let closing = false;
const mark = value => { phase = value; console.log(`Permission acceptance: ${phase}`); };
process.on('exit', code => {
  if (code !== 0) console.error(`Permission acceptance exited (${code}) during ${phase}`);
});
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
app.process().on('exit', (code, signal) => {
  if (!closing) console.error(`Unexpected Electron exit during ${phase}: code=${code}, signal=${signal}`);
});
const errors = [];
let page;
try {
  mark('first window');
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    window.setMinimumSize(320, 400); window.setSize(1280, 900);
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  mark('runtime ready');
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const saved = await page.evaluate(() => window.desktop.snapshot());
  mark('install approval fixture');
  await app.evaluate(({ ipcMain }, saved) => {
    globalThis.approvalFixture = { saved, responses: [], revision: saved.runtimeRevision ?? 0 };
    const original = ipcMain._invokeHandlers.get('desktop');
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      const fixture = globalThis.approvalFixture;
      if (method === 'snapshot') return fixture.saved;
      if (method === 'command' && args[0] === 'extension_ui_response') {
        fixture.responses.push({ value: args[1], runtimeId: args[2] });
        fixture.saved.requests = fixture.saved.requests.filter(request => request.id !== args[1].id);
        return null;
      }
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: [] };
      return original(event, method, ...args);
    });
  }, saved);
  const callId = 'permission-call-3d6009f9';
  const command = `powershell -NoProfile -Command '\nGet-ChildItem *.md | Sort-Object Name | ForEach-Object {\n  $t = Get-Content -Raw -Encoding utf8 $_.FullName\n  [pscustomobject]@{ Name=$_.Name; Lines=(Get-Content -Encoding utf8 $_.FullName).Count; Chars=$t.Length }\n}\n'`;
  const request = {
    type: 'extension_ui_request', method: 'confirm', id: 'approval-ui-1', runtimeId: saved.runtimeId,
    title: 'Approve run_command [3d6009f9]',
    message: `Call: ${callId}\nShell command could not be fully analyzed (unsupported-shell); explicit approval is required.\n\nrun_command command=powershell -NoProfile -Command Get-ChildItem...\n\nBatch calls may ask separately\nbefore approved tools begin running.`,
  };
  const history = [{ role: 'assistant', content: [
    { type: 'text', text: '我将统计当前目录的 Markdown 文件。执行前请确认下面的命令。' },
    { type: 'toolCall', id: callId, name: 'run_command', arguments: { command, cwd: 'D:\\approval-fixture', run_in_background: false } },
  ] }];
  const load = async (r, messages = history, language = 'zh', theme = 'dark') => app.evaluate(({ BrowserWindow }, input) => {
    const fixture = globalThis.approvalFixture;
    fixture.saved = {
      ...fixture.saved, runtimeRevision: ++fixture.revision,
      status: 'connected', messages: input.messages, requests: input.request ? [input.request] : [],
      state: { sessionId: 'approval-session', isStreaming: Boolean(input.request) },
      preferences: { ...fixture.saved.preferences, language: input.language, theme: input.theme },
    };
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
  }, { request: r, messages, language, theme });
  const checkBounds = async () => {
    await page.locator('.permission-approval').evaluate(async element => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all([element, element.closest('.composer-wrap')].flatMap(node =>
        node.getAnimations().map(animation => animation.finished.catch(() => {}))));
    });
    const result = await page.locator('.permission-approval').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {
        fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
        overflow: element.scrollWidth > element.clientWidth,
        buttons: [...element.querySelectorAll('.button-row button')].every(button => {
          const bounds = button.getBoundingClientRect();
          return button.scrollWidth <= button.clientWidth && bounds.top >= rect.top && bounds.bottom <= rect.bottom;
        }),
      };
    });
    if (!result.fits) {
      console.error('Drawer bounds:', await page.locator('.permission-approval').evaluate(element => ({
        drawer: element.getBoundingClientRect().toJSON(),
        main: element.closest('main').getBoundingClientRect().toJSON(),
        wrap: element.closest('.composer-wrap').getBoundingClientRect().toJSON(),
        viewport: [innerWidth, innerHeight],
      })));
      await page.screenshot({ path: 'test-results/permission-approval-bounds-failure.png' });
    }
    assert.deepEqual(result, { fits: true, overflow: false, buttons: true });
  };
  const checkNoticeColor = async color => {
    const actual = await page.locator('.approval-notice > svg').evaluate((element, expected) => {
      const sample = document.createElement('span');
      sample.style.color = expected;
      element.parentElement.append(sample);
      const result = { icon: getComputedStyle(element).color, expected: getComputedStyle(sample).color,
        text: getComputedStyle(element.parentElement.querySelector('span')).color };
      sample.remove();
      return result;
    }, color);
    assert.equal(actual.icon, actual.expected);
    assert.notEqual(actual.icon, actual.text);
  };
  await mkdir('test-results', { recursive: true });
  await load(undefined);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('审批前保留的草稿');
  await load(request);
  mark('Chinese approval and command details');
  const dialog = page.getByRole('dialog', { name: '批准执行命令' });
  await dialog.waitFor();
  assert.equal(await dialog.locator('.permission-approval-input').first().textContent(), command);
  await dialog.getByText('无法自动判断', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('Shell command could not', { exact: false }).count(), 0);
  assert.deepEqual(await app.evaluate(() => globalThis.approvalFixture.responses), []);
  await checkBounds();
  assert.equal(await dialog.getAttribute('aria-modal'), 'false');
  assert.equal(await page.locator('.performance-bar').evaluate(element => getComputedStyle(element).visibility), 'hidden');
  const drawerEdges = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { bottom: rect.bottom, viewport: innerHeight, border: getComputedStyle(element).borderBottomWidth };
  });
  assert.ok(Math.abs(drawerEdges.bottom - drawerEdges.viewport) <= 1);
  assert.equal(drawerEdges.border, '0px');
  await dialog.getByText('执行以下命令', { exact: true }).waitFor();
  await dialog.getByText('D:\\approval-fixture', { exact: true }).waitFor();
  assert.equal(await dialog.getAttribute('data-size'), 'compact');
  assert.equal(await dialog.getByRole('button', { name: '完整调用参数' }).count(), 0);
  await page.locator('.process-tool[data-tool-state="waiting"]').waitFor();
  assert.equal(await page.locator('.composer-underlay').evaluate(element => element.inert), true);
  await page.screenshot({ path: 'test-results/permission-approval-zh-dark.png' });
  mark('grip resizing and fixed actions');
  const initial = await dialog.boundingBox();
  const grip = dialog.getByRole('button', { name: '调整审批抽屉高度' });
  const handle = await grip.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 80, { steps: 8 });
  const intermediate = await dialog.boundingBox();
  assert.ok(intermediate.height > initial.height + 60);
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 400, { steps: 12 });
  await page.mouse.up();
  const maximum = await page.locator('main').evaluate(element => Math.floor(element.clientHeight / 2));
  await checkBounds();
  assert.equal(await dialog.getAttribute('data-size'), 'expanded');
  assert.ok(Math.abs((await dialog.boundingBox()).height - maximum) <= 1);
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-expanded.png' });
  await grip.press('Home');
  await checkBounds();
  assert.ok((await dialog.boundingBox()).height <= 240);
  await grip.press('End');
  await checkBounds();
  assert.ok(Math.abs((await dialog.boundingBox()).height - maximum) <= 1);
  await dialog.getByRole('button', { name: '原始审批信息' }).click();
  assert.equal(await dialog.locator('.permission-approval-raw').textContent(), request.message);
  await dialog.getByRole('button', { name: '原始审批信息' }).click();
  await dialog.getByRole('button', { name: '稍后处理' }).click();
  await page.locator('.permission-approval').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).evaluate(element => element.value), '审批前保留的草稿');
  const reviewApproval = page.getByRole('button', { name: '处理审批', exact: true });
  await reviewApproval.waitFor();
  await checkNoticeColor('oklch(.80 .15 85)');
  assert.equal(await reviewApproval.isEnabled(), true);
  assert.equal(await reviewApproval.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(await page.getByRole('menu', { name: '访问权限', exact: true }).count(), 0);
  const motion = await reviewApproval.evaluate(async element => {
    const read = () => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { position: style.backgroundPosition, shadow: style.boxShadow,
        textColor: getComputedStyle(element.querySelector('span')).color, width: rect.width, height: rect.height };
    };
    await new Promise(resolve => setTimeout(resolve, 500));
    const first = read();
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { first, second: read(), repeating: element.getAnimations().filter(animation => animation.effect.getTiming().iterations === Infinity).map(animation => animation.animationName) };
  });
  assert.notEqual(motion.first.position, motion.second.position);
  assert.notEqual(motion.first.shadow, motion.second.shadow);
  assert.notEqual(motion.first.textColor, motion.second.textColor);
  assert.equal(motion.first.width, motion.second.width);
  assert.equal(motion.first.height, motion.second.height);
  assert.deepEqual(motion.repeating.sort(), ['permission-review-breathe', 'permission-review-flow']);
  await reviewApproval.hover();
  assert.match(await reviewApproval.evaluate(element => getComputedStyle(element).backgroundImage), /linear-gradient/);
  await page.mouse.move(10, 100);
  await page.screenshot({ path: 'test-results/permission-approval-deferred-entry.png' });
  await page.locator('.composer').screenshot({ path: 'test-results/permission-approval-deferred-entry-detail.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(360, 640));
  await reviewApproval.evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(element.closest('.composer-wrap').getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const reviewBounds = await reviewApproval.boundingBox();
  assert.ok(reviewBounds.x >= 0 && reviewBounds.x + reviewBounds.width <= 360);
  await page.screenshot({ path: 'test-results/permission-approval-deferred-entry-small.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await reviewApproval.click();
  await dialog.waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.approvalFixture.responses), []);
  await dialog.getByRole('button', { name: '拒绝本次操作' }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.approvalFixture.responses), [
    { value: { id: request.id, cancelled: true }, runtimeId: request.runtimeId },
  ]);
  await page.locator('.permission-approval').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).evaluate(element => element.value), '审批前保留的草稿');
  assert.equal(await reviewApproval.count(), 0);
  await page.getByRole('button', { name: '访问权限', exact: true }).waitFor();
  await load({ ...request, id: 'approval-ui-2' }, history, 'zh', 'light');
  mark('light and narrow layouts');
  await dialog.waitFor();
  await page.screenshot({ path: 'test-results/permission-approval-zh-light.png' });
  await dialog.getByRole('button', { name: '稍后处理', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await checkNoticeColor('oklch(.48 .10 80)');
  await page.screenshot({ path: 'test-results/permission-approval-deferred-entry-light.png' });
  await reviewApproval.click();
  await dialog.waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 680));
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-zh-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(360, 640));
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-zh-small.png' });
  await dialog.getByRole('button', { name: '批准本次操作' }).click();
  assert.equal(await app.evaluate(() => globalThis.approvalFixture.responses.at(-1).value.confirmed), true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await load({ ...request, id: 'approval-ui-3' }, [], 'en', 'dark');
  mark('English summary');
  const english = page.getByRole('dialog', { name: 'Approve command execution' });
  await english.waitFor();
  await english.getByText('Full input is unavailable; the upstream summary may be truncated.').waitFor();
  await page.screenshot({ path: 'test-results/permission-approval-en-summary.png' });
  await load({
    ...request, id: 'approval-ui-4', title: 'Dangerous run_command [3d6009f9]',
    message: request.message.replace('Shell command could not be fully analyzed (unsupported-shell); explicit approval is required.',
      'Dangerous command requires confirmation (destructive-git): run_command command=git reset --hard'),
  }, [{ ...history[0], content: [{ ...history[0].content[0], arguments: { command: 'git reset --hard' } }] }]);
  const dangerous = page.getByRole('dialog', { name: '高风险操作需要批准' });
  mark('dangerous and extension requests');
  await dangerous.waitFor();
  await dangerous.getByText('命中高风险规则', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/permission-approval-zh-dangerous.png' });
  await load({ ...request, id: 'approval-ui-5', title: 'Custom extension confirmation', message: 'Keep arbitrary extension text unchanged.' });
  await page.getByRole('dialog', { name: 'Custom extension confirmation' }).getByText('Keep arbitrary extension text unchanged.').waitFor();
  mark('question preview and long file content');
  const questionCall = {
    ...history[0], content: [{ type: 'text', text: '好，你改过前端了，那我重新发起一次审批请求：' }, { type: 'toolCall', id: callId, name: 'clarify_user', arguments: {
      question: '是否允许我执行演示命令 `echo "approval demo"`？\n此命令只输出一行文本，无任何副作用。',
      options: [{ label: '批准', description: '批准后执行演示命令，执行前还会请求命令权限。' }, { label: '拒绝', description: '结束本次演示，不执行任何操作。' }],
      allow_freeform: true,
    } }],
  };
  const toolRequest = (id, name) => ({
    ...request, id, title: `Approve ${name} [3d6009f9]`,
    message: `Call: ${callId}\nPolicy override for ${name}: confirm\n\n${name} parameters...\n\nBatch calls may ask separately\nbefore approved tools begin running.`,
  });
  await load(toolRequest('approval-question', 'clarify_user'), [questionCall]);
  const question = page.getByRole('dialog', { name: '批准工具操作' });
  await question.getByText('允许 Agent 向你提问？', { exact: true }).waitFor();
  await question.locator('.permission-approval-question code').getByText('echo "approval demo"', { exact: true }).waitFor();
  await question.getByText('随后可选的回答', { exact: true }).waitFor();
  assert.equal(await question.getByRole('button', { name: '批准', exact: true }).count(), 0);
  assert.equal(await question.getByRole('button', { name: '拒绝', exact: true }).count(), 0);
  await question.getByRole('button', { name: '批准本次操作', exact: true }).getByText('允许提问', { exact: true }).waitFor();
  assert.equal(await question.getAttribute('data-size'), 'compact');
  assert.equal(await question.getByText('Agent 说明', { exact: true }).count(), 0);
  assert.equal(await question.locator('.permission-approval-answer-label .positive').count(), 1);
  assert.equal(await question.locator('.permission-approval-answer-label .negative').count(), 1);
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-question-compact.png' });
  assert.equal(await question.locator('.permission-approval-content').evaluate(element => element.scrollHeight <= element.clientHeight), true);
  await question.screenshot({ path: 'test-results/permission-approval-question-compact-detail.png' });
  await question.getByRole('button', { name: '调整审批抽屉高度' }).press('End');
  await question.getByText('Agent 说明', { exact: true }).waitFor();
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-question.png' });
  await question.screenshot({ path: 'test-results/permission-approval-question-expanded-detail.png' });
  await question.getByRole('button', { name: '调整审批抽屉高度' }).press('Home');
  await checkBounds();
  assert.equal(await question.getByText('Agent 说明', { exact: true }).count(), 0);
  const questionGrip = question.getByRole('button', { name: '调整审批抽屉高度' });
  await questionGrip.press('Enter');
  await checkBounds();
  assert.equal(await question.getAttribute('data-size'), 'expanded');
  await questionGrip.press('ArrowDown');
  await checkBounds();
  assert.equal(await question.getAttribute('data-size'), 'compact');
  const compactGrip = await questionGrip.boundingBox();
  await page.mouse.move(compactGrip.x + compactGrip.width / 2, compactGrip.y + compactGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(compactGrip.x + compactGrip.width / 2, compactGrip.y - 35, { steps: 4 });
  await page.mouse.up();
  await checkBounds();
  assert.equal(await question.getAttribute('data-size'), 'compact');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(360, 640));
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-question-small-compact.png' });
  await questionGrip.press('End');
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-question-small-expanded.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await checkBounds();
  await questionGrip.press('Home');
  await checkBounds();
  const swipeGrip = await questionGrip.boundingBox();
  await page.mouse.move(swipeGrip.x + swipeGrip.width / 2, swipeGrip.y + swipeGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(swipeGrip.x + swipeGrip.width / 2, swipeGrip.y + 120, { steps: 8 });
  await page.mouse.up();
  await question.waitFor({ state: 'detached' });
  await reviewApproval.waitFor();
  assert.equal(await app.evaluate(() => globalThis.approvalFixture.responses.length), 2);
  await reviewApproval.focus();
  await reviewApproval.press('Enter');
  await question.waitFor();
  assert.equal(await question.getByRole('button', { name: '调整审批抽屉高度' }).evaluate(element => element === document.activeElement), true);
  await load(toolRequest('approval-file', 'write_file'), [{ role: 'assistant', content: [{
    type: 'toolCall', id: callId, name: 'write_file', arguments: {
      path: 'D:\\approval-fixture\\README.md', content: '# 交付说明\n\n' + '这是一段较长的文件内容，用来检查审批抽屉的阅读和滚动。\n'.repeat(60),
    },
  }] }]);
  const file = page.getByRole('dialog', { name: '批准文件修改' });
  await file.getByText('写入文件', { exact: true }).waitFor();
  await file.getByRole('button', { name: '调整审批抽屉高度' }).press('End');
  await file.locator('.permission-approval-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-long-file.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await file.getByRole('button', { name: '调整审批抽屉高度' }).press('Escape');
  await page.locator('.permission-approval').waitFor({ state: 'detached' });
  assert.equal(await reviewApproval.evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.equal(await reviewApproval.locator('span').evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.equal(await reviewApproval.evaluate(element => getComputedStyle(element).backgroundImage), 'none');
  await reviewApproval.hover();
  assert.equal(await reviewApproval.evaluate(element => getComputedStyle(element).backgroundImage), 'none');
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).evaluate(element => element.value), '审批前保留的草稿');
  assert.equal(await app.evaluate(() => globalThis.approvalFixture.responses.length), 2);
  assert.deepEqual(errors, []);
  console.log('Permission approval UI passed: Chinese/English, full input, summary fallback, raw details, defer, deny, approve, high-risk and unknown extension. Screenshots: test-results/permission-approval-*.png');
} catch (error) {
  console.error(`Permission acceptance failed during ${phase}:`, error);
  throw error;
} finally {
  closing = true;
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
  await app.close();
}
