import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { prepareSessionFixture } from './session-fixture.mjs';
const profile = await mkdtemp(join(tmpdir(), 'step-desktop-electron-'));
const workspace = join(profile, '中文项目 with spaces'); await mkdir(workspace);
const secondWorkspace = join(profile, 'Second project'); await mkdir(secondWorkspace);
const independentCwd = join(profile, 'Independent cwd'); await mkdir(independentCwd);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspace, workspaces: [secondWorkspace, workspace] }));
// Isolated on-disk history fixtures; no live model or personal session data.
for (const [index, cwd] of [workspace, secondWorkspace, independentCwd, workspace, workspace].entries()) {
  const dir = join(profile, 'step-runtime', 'sessions');
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const entries = [
    { type: 'session', version: 3, id: `fixture-${index}`, cwd, timestamp },
    { type: 'message', id: 'user-1', parentId: null, timestamp, message: { role: 'user', content: [{ type: 'text', text: index === 4 ? '你好！' : 'Fixture history' }, ...(index === 0 ? [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==' }] : [])], timestamp: Date.now() } },
    ...(index === 4 ? [] : [{ type: 'session_info', id: 'name-1', parentId: 'user-1', timestamp, name: index === 0 ? '历史验证会话' : index === 1 ? 'Second session' : index === 2 ? '独立验证会话' : '同项目另一会话' }]),
    ...(index === 0 ? [
      { type: 'message', id: 'assistant-1', parentId: 'user-1', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: '先检查现有项目结构，再决定这一轮的实现范围。\n\n' + '这段较长的回复用于验证不同高度的会话轮次和原生滚动条。'.repeat(35) }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, timestamp: Date.now() } },
      { type: 'message', id: 'user-2', parentId: 'assistant-1', timestamp, message: { role: 'user', content: [{ type: 'text', text: '接下来查看界面布局与交互。' }], timestamp: Date.now() } },
      { type: 'message', id: 'assistant-2', parentId: 'user-2', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: '将会话刻度与滚动条分开，同时预留右侧摘要面板。' }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, timestamp: Date.now() } },
      { type: 'message', id: 'user-3', parentId: 'assistant-2', timestamp, message: { role: 'user', content: [{ type: 'text', text: '最后确认窄窗口下不会遮住输入框。' }], timestamp: Date.now() } },
    ] : []),
  ];
  await writeFile(join(dir, `fixture-${index}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  const windowState = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0);
    if (window.getOpacity() !== 0) throw new Error('Transparent acceptance window is unavailable');
    window.setIgnoreMouseEvents(true);
    window.showInactive();
    return { opacity: window.getOpacity(), visible: window.isVisible(), focused: window.isFocused() };
  });
  assert.deepEqual(windowState, { opacity: 0, visible: true, focused: false });
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: '让梦想阶跃星辰' }).waitFor();
  await prepareSessionFixture(page);
  const documentPath = join(profile, 'attachment sample.md');
  await writeFile(documentPath, '# Attachment acceptance\n');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'attachment-acceptance-input';
    document.body.append(input);
  });
  await page.locator('#attachment-acceptance-input').setInputFiles(documentPath);
  const importedDocument = await page.evaluate(async () => {
    const file = document.querySelector('#attachment-acceptance-input').files[0];
    return window.desktop.importFile(file);
  });
  assert.equal(importedDocument.kind, 'file');
  assert.equal(importedDocument.name, 'attachment sample.md');
  const screenshotBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  const clipboardImage = await page.evaluate(async data => window.desktop.importClipboardImage(data, 'image/png', 'clipboard.png'), screenshotBytes.toString('base64'));
  assert.equal(clipboardImage.kind, 'image');
  assert.equal(clipboardImage.content.mimeType, 'image/png');
  const imageSavePath = join(profile, 'saved-image.png');
  // Exercise the real image handlers without changing the user's clipboard or opening Explorer/dialogs.
  await app.evaluate(({ clipboard, dialog, shell }, savePath) => {
    globalThis.imageMenuTest = { write: clipboard.write, save: dialog.showSaveDialog, reveal: shell.showItemInFolder, canceled: false, copies: [], revealed: [] };
    clipboard.write = async items => {
      const blob = await items[0].getType('image/png');
      globalThis.imageMenuTest.copies.push(Buffer.from(await blob.arrayBuffer()));
    };
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.imageMenuTest.saveOptions = options;
      return { canceled: globalThis.imageMenuTest.canceled, filePath: globalThis.imageMenuTest.canceled ? undefined : savePath };
    };
    shell.showItemInFolder = path => globalThis.imageMenuTest.revealed.push(path);
  }, imageSavePath);
  await assert.rejects(page.evaluate(() => window.desktop.imageAction('copy', 'file:///C:/secret.png', 'image')), /Unsupported/);
  await assert.rejects(page.evaluate(() => window.desktop.imageAction('invalid', '', 'image')), /Invalid image action/);
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await assert.rejects(
    page.evaluate(() => window.desktop.command('prompt', { message: '', files: ['invalid-attachment-id'] })),
    /expired/,
  );
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(document.querySelector('#attachment-acceptance-input').files[0]);
    document.querySelector('.composer').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.getByText('attachment sample.md', { exact: true }).waitFor();
  await page.locator('#attachment-acceptance-input').evaluate(element => element.remove());
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d');
    context.fillStyle = '#efb5a1'; context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#5a315f'; context.fillRect(80, 70, 480, 220);
    context.fillStyle = '#ffffff'; context.font = '40px sans-serif'; context.fillText('Image preview', 160, 200);
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    document.querySelector('.composer > textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await page.getByRole('button', { name: '预览 clipboard.png' }).waitFor();
  const fixtureImageData = await page.locator('.attachment-open img').getAttribute('src');
  const historyPath = join(profile, 'step-runtime', 'sessions', 'fixture-0.jsonl');
  const historyEntries = (await readFile(historyPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  historyEntries.find(entry => entry.id === 'user-1').message.content.find(block => block.type === 'image').data = fixtureImageData.split(',')[1];
  await writeFile(historyPath, historyEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  await page.screenshot({ path: 'test-results/attachment-composer.png' });
  await page.getByRole('button', { name: '预览 clipboard.png' }).click();
  const previewDialog = page.getByRole('dialog', { name: '预览 clipboard.png' });
  await previewDialog.waitFor();
  if (!await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    const sourceRect = await page.locator('.attachment-open img').boundingBox();
    const anchoredRect = await previewDialog.evaluate(element => {
      const animation = element.getAnimations()[0];
      animation.pause(); animation.currentTime = 0;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(anchoredRect[key] - sourceRect[key]) < 2, `preview origin ${key} must match thumbnail`);
    await previewDialog.evaluate(element => { const animation = element.getAnimations()[0]; animation.currentTime = 100; });
    await page.screenshot({ path: 'test-results/image-preview-anchor-transition.png' });
    await previewDialog.evaluate(element => element.getAnimations()[0].play());
  }
  await previewDialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  await page.locator('.attachment-preview-image').click({ button: 'right' });
  const imageMenu = page.getByRole('menu', { name: '图片操作', exact: true });
  await imageMenu.waitFor();
  assert.deepEqual(await imageMenu.getByRole('menuitem').allTextContents(), ['复制', '另存为']);
  await page.screenshot({ path: 'test-results/preview-image-menu.png' });
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '另存为');
  await page.keyboard.press('Home');
  await imageMenu.getByRole('menuitem', { name: '复制', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.image-context'));
  const copiedSize = await app.evaluate(({ nativeImage }) => nativeImage.createFromBuffer(globalThis.imageMenuTest.copies[0]).getSize());
  assert.deepEqual(copiedSize, { width: 640, height: 360 });
  await page.locator('.attachment-preview-image').click({ button: 'right' });
  await imageMenu.getByRole('menuitem', { name: '另存为', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.image-context'));
  // Wait for the asynchronous file write through a benign IPC barrier.
  await page.evaluate(() => window.desktop.snapshot());
  assert.deepEqual(await readFile(imageSavePath), Buffer.from(fixtureImageData.split(',')[1], 'base64'));
  await app.evaluate(() => { globalThis.imageMenuTest.canceled = true; });
  assert.equal(await page.evaluate(src => window.desktop.imageAction('save', src, 'clipboard.png'), fixtureImageData), false);
  await app.evaluate(() => { globalThis.imageMenuTest.canceled = false; });
  await page.locator('.attachment-preview-image').click({ button: 'right' });
  await page.keyboard.press('Escape');
  await imageMenu.waitFor({ state: 'hidden' });
  assert.equal(await previewDialog.count(), 1, 'menu Escape must not close image preview');
  assert.equal(await previewDialog.locator('[data-tooltip]').count(), 0);
  const previewViewport = page.locator('.attachment-preview-image');
  assert.equal(await previewViewport.evaluate(element => getComputedStyle(element).overflow), 'hidden');
  const previewBounds = await previewViewport.boundingBox();
  const startX = previewBounds.x + previewBounds.width / 2;
  const startY = previewBounds.y + previewBounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 52, startY + 28);
  await page.mouse.up();
  const panX = await previewViewport.locator('img').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41);
  assert.ok(panX > 40, `expected dragged image to pan, got ${panX}`);
  await page.keyboard.down('Control');
  await page.mouse.move(startX + 60, startY + 30);
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await page.getByText('116%', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/attachment-preview.png' });
  await page.keyboard.press('Escape');
  await previewDialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('dialog', { name: '预览 clipboard.png' }).count(), 0);
  assert.equal(await page.locator('.attachment-open').evaluate(element => document.activeElement === element), true);
  await page.getByRole('button', { name: '预览 clipboard.png' }).click();
  await previewDialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20, startY + 10);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await previewDialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '预览 clipboard.png' }).click();
  assert.equal(await previewViewport.evaluate(element => getComputedStyle(element).cursor), 'grab');
  assert.equal(await previewViewport.locator('img').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41), 0);
  await previewDialog.getByText('100%', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await previewDialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.composer > textarea').evaluate(input => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'plain text');
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  }), false);
  const attachmentCards = page.locator('.attachment-card');
  const removeButtons = page.getByRole('button', { name: '移除附件' });
  assert.equal(await removeButtons.first().getAttribute('data-tooltip'), null);
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(10, 10);
  const removeState = await removeButtons.first().evaluate(element => ({
    opacity: getComputedStyle(element).opacity,
    cardHovered: element.closest('.attachment-card').matches(':hover'),
    cardFocused: element.closest('.attachment-card').matches(':focus-within'),
    activeElement: document.activeElement?.className,
  }));
  assert.equal(removeState.opacity, '0', JSON.stringify(removeState));
  await attachmentCards.first().hover();
  await removeButtons.first().click();
  await attachmentCards.first().hover();
  await removeButtons.first().click();
  assert.equal(await page.locator('.window-bar img').count(), 0);
  assert.equal(await page.locator('.topbar').count(), 0);
  assert.equal(await page.locator('.window-sidebar-toggle').count(), 1);
  assert.equal(await page.locator('.sidebar-wordmark img:visible').getAttribute('alt'), 'Desktop for Step Code');
  assert.equal(await page.locator('.sidebar-wordmark img:visible').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await page.locator('.sidebar-identity > img').getAttribute('src'), './StepCode.svg');
  const motionReduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sidebarMotion = await page.locator('.sidebar').evaluate(element => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, timing: style.transitionTimingFunction };
  });
  if (!motionReduced) {
    assert.match(sidebarMotion.timing, /cubic-bezier\(0\.65, 0, 0\.35, 1\)/);
    assert.ok(parseFloat(sidebarMotion.duration) >= 0.28);
  }
  if (!motionReduced) {
    await page.evaluate(() => {
      window.__sidebarTransitionStarted = false;
      const sidebar = document.querySelector('.sidebar');
      const onTransition = event => {
        if (event.propertyName !== 'transform') return;
        window.__sidebarTransitionStarted = true;
        sidebar.removeEventListener('transitionrun', onTransition);
      };
      sidebar.addEventListener('transitionrun', onTransition);
    });
  }
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  if (!motionReduced) await page.waitForFunction(() => window.__sidebarTransitionStarted, null, { timeout: 2000 });
  await page.locator('.sidebar').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.sidebar-identity').isVisible(), false);
  assert.equal(await page.locator('.window-sidebar-toggle').isVisible(), true);
  await page.screenshot({ path: 'test-results/brand-sidebar-hidden.png' });
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  await page.locator('.sidebar').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '视图', exact: true }).click();
  assert.equal(await page.getByRole('menu', { name: '视图' }).isVisible(), true);
  await page.getByRole('menuitem', { name: '隐藏侧栏' }).click();
  await page.locator('.sidebar').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '视图', exact: true }).click();
  await page.getByRole('menuitem', { name: '显示侧栏' }).click();
  await page.getByRole('button', { name: '文件', exact: true }).click();
  assert.equal(await page.getByRole('menuitem', { name: '新建独立会话' }).isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu', { name: '文件' }).count(), 0);
  await page.getByRole('button', { name: '最大化', exact: true }).click();
  await page.getByRole('button', { name: '还原窗口', exact: true }).waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true);
  await page.getByRole('button', { name: '还原窗口', exact: true }).click();
  await page.getByRole('button', { name: '最大化', exact: true }).waitFor();
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()), false);
  await page.getByRole('button', { name: '中文项目 with spaces', exact: true }).waitFor();
  await page.getByRole('button', { name: '独立会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '独立验证会话', exact: true }).waitFor();
  const disclosureCases = [
    {
      region: page.getByRole('region', { name: '独立会话', exact: true }),
      toggleName: '独立会话',
    },
    {
      region: page.getByRole('region', { name: workspace, exact: true }),
      toggleName: '中文项目 with spaces',
    },
  ];
  for (const { region, toggleName } of disclosureCases) {
    const toggle = region.getByRole('button', { name: toggleName, exact: true });
    const disclosure = region.locator('.workspace-disclosure');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await toggle.locator('svg.lucide-chevron-down, svg.lucide-chevron-right').count(), 0);
    assert.equal(await disclosure.getAttribute('aria-hidden'), 'false');
    assert.equal(await disclosure.evaluate(element => element.inert), false);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await disclosure.getAttribute('aria-hidden'), 'true');
    assert.equal(await disclosure.evaluate(element => element.inert), true);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await disclosure.getAttribute('aria-hidden'), 'false');
  }
  const projectToggle = disclosureCases[1].region.getByRole('button', { name: '中文项目 with spaces', exact: true });
  const projectDisclosure = disclosureCases[1].region.locator('.workspace-disclosure');
  assert.equal(await projectToggle.locator('svg.lucide-folder-open').count(), 1);
  await projectToggle.click();
  assert.equal(await projectToggle.locator('svg.lucide-folder').count(), 1);
  assert.equal(await projectToggle.locator('svg.lucide-folder-open').count(), 0);
  await projectToggle.click();
  assert.equal(await projectToggle.locator('svg.lucide-folder-open').count(), 1);
  await projectToggle.click({ button: 'right' });
  const context = page.locator('.sidebar-context');
  await context.getByRole('menuitem', { name: '在资源管理器中打开' }).waitFor();
  await assert.rejects(page.evaluate(() => window.desktop.openWorkspaceFolder('C:\\not-a-remembered-project')), /Unknown workspace/);
  await context.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('临时项目名');
  await page.getByRole('dialog').getByRole('button', { name: '确认' }).click();
  await page.getByRole('button', { name: '临时项目名', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.workspaceNames[workspace.toLowerCase().replaceAll('\\', '/')], '临时项目名');
  await page.getByRole('button', { name: '临时项目名', exact: true }).click({ button: 'right' });
  await context.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('中文项目 with spaces');
  await page.getByRole('dialog').getByRole('button', { name: '确认' }).click();
  await projectToggle.waitFor();
  assert.equal(await disclosureCases[0].region.getByRole('button', { name: '独立会话', exact: true }).locator('svg.lucide-message-square').count(), 1);
  const reduceMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const transitionStyle = await projectDisclosure.evaluate(element => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, timing: style.transitionTimingFunction };
  });
  if (!reduceMotion) {
    assert.match(transitionStyle.timing, /cubic-bezier\(0\.65, 0, 0\.35, 1\)/);
    assert.ok(transitionStyle.duration.split(',').some(value => parseFloat(value) >= 0.24));
    const openHeight = await projectDisclosure.evaluate(element => element.getBoundingClientRect().height);
    await projectToggle.click();
    await page.waitForTimeout(60);
    const closingHeight = await projectDisclosure.evaluate(element => element.getBoundingClientRect().height);
    assert.ok(closingHeight > 0 && closingHeight < openHeight);
    await projectToggle.click();
    await page.waitForTimeout(280);
  }
  assert.equal(await page.getByRole('button', { name: 'Independent cwd', exact: true }).count(), 0);
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const startupState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(startupState.independent, true);
  const independentRoot = await realpath(join(profile, 'workspaces', 'independent'));
  const activeWorkspace = await realpath(startupState.preferences.workspace);
  assert.ok(activeWorkspace.toLowerCase().startsWith(`${independentRoot.toLowerCase()}\\`), `${activeWorkspace} is outside ${independentRoot}`);
  assert.equal(startupState.preferences.workspaces.length, 2);
  assert.equal(startupState.preferences.workspaces.includes(startupState.preferences.workspace), false);
  assert.equal(startupState.messages.length, 0);
  assert.equal(startupState.stats.tokens.total, 0);
  assert.equal(startupState.permissionPreset, 'ask');
  assert.notEqual(startupState.state.sessionId, 'fixture-0');
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).isEnabled(), true);
  assert.equal(await page.locator('.session-location').count(), 0);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.clock.install();
  const sendNotice = (id, notifyType, message) => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value), {
    type: 'extension_ui_request', id, method: 'notify', notifyType, message,
  });
  const transcriptTop = await page.locator('.conversation').evaluate(element => element.getBoundingClientRect().top);
  const mcpMessage = "MCP server 'example_mcp' could not start: Connection closed";
  await sendNotice('warning-test', 'warning', mcpMessage);
  const toast = page.locator('.notice-toast');
  await toast.getByText(mcpMessage).waitFor();
  assert.equal(await page.locator('.conversation').evaluate(element => element.getBoundingClientRect().top), transcriptTop);
  assert.ok(await toast.evaluate(element => element.getBoundingClientRect().top >= document.querySelector('.window-bar').getBoundingClientRect().bottom));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/notice-toast-wide.png' });
  await toast.getByRole('button', { name: '查看 MCP' }).click();
  await page.getByRole('region', { name: '本次窗口的 MCP 警告' }).getByText(mcpMessage).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await sendNotice('warning-again', 'warning', mcpMessage);
  assert.equal(await toast.count(), 0);
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  await page.getByRole('region', { name: '本次窗口的 MCP 警告' }).locator('.resource-row').filter({ hasText: 'example_mcp' }).getByText('出现 2 次').waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await sendNotice('warning-generic', 'warning', 'Another optional service is unavailable');
  await toast.getByText('Another optional service is unavailable').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 620));
  await page.waitForFunction(() => innerWidth <= 640);
  await page.getByRole('button', { name: '摘要', exact: true }).click();
  const narrowPanel = page.getByRole('complementary', { name: '摘要' });
  assert.equal(await narrowPanel.evaluate(element => {
    const panel = element.getBoundingClientRect();
    const rail = document.querySelector('.right-tool-rail').getBoundingClientRect();
    return panel.left >= 0 && panel.right <= rail.left && rail.right <= innerWidth;
  }), true);
  await page.getByRole('button', { name: '摘要', exact: true }).click();
  const titleBounds = await page.locator('.window-session-title').evaluate(element => {
    const originalTitle = element.textContent;
    element.textContent = '很长的测试会话标题'.repeat(20);
    const title = element.getBoundingClientRect();
    const controls = document.querySelector('.window-controls').getBoundingClientRect();
    const drag = document.querySelector('.window-drag-space').getBoundingClientRect();
    const result = { width: title.width, right: title.right, dragRight: drag.right, controlsLeft: controls.left, overflow: element.scrollWidth > element.clientWidth };
    element.textContent = originalTitle;
    return result;
  });
  assert.ok(titleBounds.right <= titleBounds.controlsLeft);
  assert.ok(titleBounds.width <= 300 && titleBounds.dragRight - titleBounds.right >= 48);
  assert.equal(titleBounds.overflow, true);
  const toastBounds = await toast.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const bar = document.querySelector('.window-bar').getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, barBottom: bar.bottom, viewport: innerWidth };
  });
  assert.ok(toastBounds.left >= 0 && toastBounds.right <= toastBounds.viewport && toastBounds.top >= toastBounds.barBottom);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/notice-toast-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 880));
  await page.waitForFunction(() => innerWidth >= 840);
  const wideTitleWidth = await page.locator('.window-session-title').evaluate(element => {
    const originalTitle = element.textContent;
    element.textContent = '很长的测试会话标题'.repeat(20);
    const width = element.getBoundingClientRect().width;
    element.textContent = originalTitle;
    return width;
  });
  assert.ok(wideTitleWidth <= 300 && wideTitleWidth >= 290);
  await page.getByRole('button', { name: '独立验证会话', exact: true }).waitFor();
  await toast.hover();
  await page.clock.fastForward(8100);
  assert.equal(await toast.isVisible(), true);
  await page.mouse.move(0, 0);
  await toast.getByRole('button', { name: '关闭通知' }).focus();
  await page.clock.fastForward(8100);
  assert.equal(await toast.isVisible(), true);
  await page.getByRole('textbox', { name: '消息', exact: true }).focus();
  await page.clock.fastForward(8100);
  await toast.waitFor({ state: 'hidden' });
  await sendNotice('info-test', 'info', 'Information only');
  await toast.getByText('Information only').waitFor();
  const compactNotice = await toast.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    return { width: rect.width, center: rect.left + rect.width / 2, mainCenter: main.left + main.width / 2,
      top: rect.top, barBottom: document.querySelector('.window-bar').getBoundingClientRect().bottom,
      easing: getComputedStyle(element).animationTimingFunction };
  });
  assert.ok(compactNotice.width < 300);
  assert.ok(Math.abs(compactNotice.center - compactNotice.mainCenter) < 1);
  assert.ok(compactNotice.top - compactNotice.barBottom <= 10);
  assert.equal(compactNotice.easing, 'cubic-bezier(0.215, 0.61, 0.355, 1)');
  const assertNoticeCentered = async () => assert.ok(await toast.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    return Math.abs(rect.left + rect.width / 2 - main.left - main.width / 2) < 1;
  }));
  await page.getByRole('button', { name: '摘要', exact: true }).click();
  await assertNoticeCentered();
  await page.getByRole('button', { name: '摘要', exact: true }).click();
  await page.locator('.window-sidebar-toggle').click();
  await page.clock.runFor(300);
  await assertNoticeCentered();
  await page.locator('.window-sidebar-toggle').click();
  await page.clock.runFor(300);
  await assertNoticeCentered();
  await page.screenshot({ path: 'test-results/notice-compact-info.png' });
  await page.clock.fastForward(4100);
  await toast.waitFor({ state: 'hidden' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
    type: 'extension_ui_request', id: 'error-test', method: 'notify', notifyType: 'error', message: 'A real error',
  }));
  await page.locator('.error-banner').getByText('A real error').waitFor();
  await page.clock.fastForward(8100);
  assert.equal(await page.locator('.error-banner').getByText('A real error').isVisible(), true);
  await page.locator('.error-banner').getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '独立验证会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '独立验证会话');
  assert.equal(await page.locator('.window-session-title').getAttribute('data-tooltip'), '独立验证会话');
  let independentState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(independentState.independent, true);
  assert.equal(independentState.preferences.workspaces.length, 2);
  assert.equal(independentState.preferences.workspaces.includes(independentCwd), false);
  await page.getByRole('region', { name: '独立会话', exact: true }).getByRole('button', { name: '独立验证会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '视图', exact: true }).click();
  await page.getByRole('menuitem', { name: '重启运行时', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.composer > textarea').disabled);
  independentState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(independentState.independent, true);
  assert.equal(independentState.state.sessionId, 'fixture-2');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.composer > textarea').disabled);
  independentState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(independentState.independent, true);
  assert.equal(independentState.messages.length, 0);
  assert.equal(independentState.runtimeId, undefined);
  assert.equal(independentState.state.sessionId, undefined);
  assert.equal(independentState.preferences.workspace, undefined);
  assert.equal(independentState.preferences.workspaces.length, 2);
  await prepareSessionFixture(page);
  await page.screenshot({ path: 'test-results/desktop-light.png' });
  await page.getByRole('button', { name: '账户设置', exact: true }).click();
  await page.getByRole('button', { name: '账户', exact: true }).click();
  await page.getByText('尚未登录', { exact: true }).waitFor();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  assert.equal(await page.evaluate(() => CSS.supports('appearance', 'base-select')), true);
  const themePicker = page.getByRole('dialog').getByLabel(/主题|Theme/);
  await themePicker.click();
  await page.screenshot({ path: 'test-results/select-light.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption('dark');
  await page.getByRole('dialog').getByLabel(/语言|Language/).selectOption('en');
  await page.getByRole('button', { name: 'Model and thinking level' }).waitFor();
  await page.getByRole('button', { name: 'Access permissions' }).waitFor();
  assert.equal(await page.locator('.permission-trigger span').textContent(), 'Ask');
  assert.equal(await page.getByRole('meter', { name: 'Context usage' }).getAttribute('title'), null);
  assert.equal(await page.locator('.model-effort-level').textContent(), 'off');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(data => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(data), char => char.charCodeAt(0))], 'locale.png', { type: 'image/png' }));
    document.querySelector('.composer > textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, screenshotBytes.toString('base64'));
  const localeAttachment = page.getByRole('button', { name: 'Preview locale.png', exact: true });
  await localeAttachment.click({ button: 'right' });
  const englishImageMenu = page.getByRole('menu', { name: 'Image actions', exact: true });
  assert.deepEqual(await englishImageMenu.getByRole('menuitem').allTextContents(), ['Copy', 'Save As']);
  await page.keyboard.press('Escape');
  await localeAttachment.click();
  await page.locator('.attachment-preview-image').click({ button: 'right' });
  assert.deepEqual(await englishImageMenu.getByRole('menuitem').allTextContents(), ['Copy', 'Save As']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Preview locale.png', exact: true }).waitFor({ state: 'hidden' });
  await page.locator('.attachment-card').hover();
  await page.getByRole('button', { name: 'Remove attachment', exact: true }).click();
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/语言|Language/).selectOption('zh');
  await page.getByRole('button', { name: '模型与思考强度' }).waitFor();
  assert.equal(await page.locator('.permission-trigger span').textContent(), '请求批准');
  assert.equal(await page.locator('.model-effort-level').textContent(), '关闭');
  await themePicker.click();
  await page.screenshot({ path: 'test-results/select-dark.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const composerTools = page.locator('.composer-tools');
  assert.equal(await composerTools.getByRole('button', { name: '添加附件' }).locator('svg.lucide-plus').count(), 1);
  const attachButton = composerTools.getByRole('button', { name: '添加附件' });
  assert.equal(await attachButton.getAttribute('title'), null);
  await attachButton.hover();
  const tooltip = page.getByRole('tooltip');
  await tooltip.getByText('添加附件').waitFor();
  const tooltipStyle = await tooltip.evaluate(element => ({ className: element.className, radius: getComputedStyle(element).borderTopLeftRadius }));
  assert.ok(parseFloat(tooltipStyle.radius) >= 8, `Tooltip radius: ${JSON.stringify(tooltipStyle)}`);
  await page.mouse.move(0, 0);
  await tooltip.waitFor({ state: 'hidden' });
  const controlOrder = await composerTools.evaluate(element => [...element.children].map(child => child.getAttribute('aria-label') ?? child.className));
  assert.deepEqual(controlOrder, ['添加附件', 'permission-picker', 'spacer', '上下文用量', 'model-effort', '发送']);
  const permissionTrigger = composerTools.getByRole('button', { name: '访问权限' });
  assert.equal(await permissionTrigger.locator('svg.lucide-hand').count(), 1);
  await permissionTrigger.click();
  const permissionMenu = page.getByRole('menu', { name: '访问权限' });
  for (const [preset, icon] of [['ask', 'hand'], ['read-only', 'eye'], ['bypass', 'shield-alert'], ['autopilot', 'refresh-cw']]) {
    assert.equal(await permissionMenu.locator(`.permission-option-${preset} svg.lucide-${icon}`).count(), 1);
  }
  assert.deepEqual(await permissionMenu.getByRole('menuitemradio').allTextContents(), [
    '请求批准写入与命令执行先确认',
    '只读只允许读取与查找',
    '常规免确认常规操作免确认，危险命令仍需批准',
    '自动驾驶常规免确认，失败后可自动续跑',
  ]);
  await permissionMenu.getByRole('menuitemradio', { name: /只读/ }).click();
  await page.waitForFunction(() => document.querySelector('.permission-trigger span')?.textContent === '只读');
  assert.equal(await permissionTrigger.locator('svg.lucide-eye').count(), 1);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).permissionPreset, 'read-only');
  await page.waitForTimeout(100);
  assert.equal(await page.getByText('Permission mode: Read Only', { exact: true }).count(), 0);
  await permissionTrigger.click();
  await page.keyboard.press('Escape');
  assert.equal(await permissionMenu.count(), 0);
  await permissionTrigger.click();
  await permissionMenu.getByRole('menuitemradio', { name: /请求批准/ }).click();
  await page.waitForFunction(() => document.querySelector('.permission-trigger span')?.textContent === '请求批准');
  assert.equal(await permissionTrigger.locator('svg.lucide-hand').count(), 1);
  await assert.rejects(page.evaluate(() => window.desktop.command('set_permission_preset', { preset: 'unrestricted' })), /Unknown permission preset/);
  const modelPicker = composerTools.getByRole('button', { name: '模型与思考强度' });
  await modelPicker.click();
  const effortPanel = page.getByRole('dialog', { name: '模型与思考强度' });
  await effortPanel.getByRole('button', { name: '选择模型' }).click();
  const modelList = effortPanel.getByRole('listbox', { name: '模型' });
  assert.equal(await modelList.isVisible(), true);
  await effortPanel.getByRole('button', { name: '选择模型' }).click();
  if (await effortPanel.getByRole('slider').count()) {
    assert.equal(await effortPanel.getByRole('slider').getAttribute('aria-valuetext'), await composerTools.locator('.model-effort-level').textContent());
  }
  await page.screenshot({ path: 'test-results/select-composer.png' });
  const pickerFits = await effortPanel.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 36 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
  });
  assert.equal(pickerFits, true);
  await page.keyboard.press('Escape');
  assert.equal(await effortPanel.count(), 0);
  const ring = composerTools.getByRole('meter', { name: '上下文用量' });
  await ring.evaluate(element => { element.dataset.tooltip = '已用 49%'; });
  await ring.hover();
  await tooltip.getByText('已用 49%', { exact: true }).waitFor();
  assert.equal(await tooltip.evaluate(element => {
    const box = element.getBoundingClientRect();
    const anchor = document.querySelector('.context-ring').getBoundingClientRect();
    return box.bottom < anchor.top && Math.abs((box.left + box.right) / 2 - (anchor.left + anchor.right) / 2) < 2;
  }), true);
  await page.waitForTimeout(170);
  await page.screenshot({ path: 'test-results/context-tooltip.png' });
  await page.mouse.move(0, 0);
  await ring.evaluate(element => { delete element.dataset.tooltip; });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 640));
  await page.waitForFunction(() => innerWidth <= 640);
  assert.equal(await page.locator('.composer-tools').evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await permissionTrigger.click();
  assert.equal(await permissionMenu.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0;
  }), true);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/permissions-narrow.png' });
  await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 880));
  await page.waitForFunction(() => innerWidth >= 840);
  assert.equal(await page.getByRole('textbox', { name: '搜索会话' }).count(), 0);
  await page.getByRole('button', { name: '在 中文项目 with spaces 新建会话', exact: true }).click();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.composer > textarea').disabled);
  const projectState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(projectState.independent, false);
  assert.equal(await realpath(projectState.preferences.workspace), await realpath(workspace));
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).isEnabled(), true);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Retained empty project draft');
  const projectRows = await page.getByRole('region', { name: projectState.preferences.workspace, exact: true }).locator('.session-row').count();
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '在 中文项目 with spaces 新建会话', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.composer > textarea').disabled);
    const reused = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(reused.runtimeId, projectState.runtimeId);
    assert.equal(reused.state.sessionId, projectState.state.sessionId);
    assert.equal(reused.runtimes.length, projectState.runtimes.length);
    assert.equal(await page.getByRole('region', { name: projectState.preferences.workspace, exact: true }).locator('.session-row').count(), projectRows);
    assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), 'Retained empty project draft');
  }
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('');
  assert.ok(projectState.draftId);
  assert.equal(projectState.runtimeId, undefined);
  console.log('Project new-session clicks retain one proposed session and its composer draft without creating a worker or sidebar row.');
  await page.screenshot({ path: 'test-results/desktop-dark-connected.png' });
  assert.equal(await page.locator('.topbar').count(), 0);
  const firstGroup = page.getByRole('region', { name: projectState.preferences.workspace, exact: true });
  await firstGroup.getByRole('button', { name: '你好！', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '你好！');
  await page.locator('.conversation-scroll-track.hidden').waitFor();
  await firstGroup.getByRole('button', { name: '历史验证会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '历史验证会话');
  await page.locator('.conversation-scroll-track:not(.hidden)').waitFor();
  await page.locator('.turn-marker').nth(2).waitFor();
  assert.equal(await page.locator('.turn-marker').count(), 3);
  const markerTops = await page.locator('.turn-marker').evaluateAll(markers => markers.map(marker => marker.getBoundingClientRect().top));
  assert.ok(Math.abs(markerTops[1] - markerTops[0] - 18) < 1);
  assert.ok(Math.abs(markerTops[2] - markerTops[1] - 18) < 1);
  const scrollTrack = page.getByRole('scrollbar', { name: '会话滚动' });
  const trackBox = await scrollTrack.boundingBox();
  const mainBox = await page.locator('main').boundingBox();
  assert.ok(Math.abs(trackBox.y + trackBox.height - mainBox.y - mainBox.height + 8) < 2);
  assert.equal(await page.locator('.conversation').evaluate(element => getComputedStyle(element).scrollbarWidth), 'none');
  await page.locator('.conversation').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction(() => {
    const track = document.querySelector('.conversation-scroll-track');
    const thumb = document.querySelector('.conversation-scroll-thumb');
    return track && thumb && Math.abs(thumb.getBoundingClientRect().bottom - track.getBoundingClientRect().bottom) < 2;
  });
  await page.screenshot({ path: 'test-results/conversation-scroll-bottom.png' });
  const thumbBox = await page.locator('.conversation-scroll-thumb').boundingBox();
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, trackBox.y + 4, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.conversation').scrollTop < 20);
  const sentImage = page.locator('.message.user .previewable-image').first();
  await sentImage.click({ button: 'right' });
  await imageMenu.waitFor();
  assert.deepEqual(await imageMenu.getByRole('menuitem').allTextContents(), ['添加到聊天', '复制图像', '在资源管理器中打开', '下载副本']);
  await page.screenshot({ path: 'test-results/transcript-image-menu.png' });
  await imageMenu.getByRole('menuitem', { name: '在资源管理器中打开', exact: true }).click();
  await page.evaluate(() => window.desktop.snapshot());
  const revealedPath = await app.evaluate(() => globalThis.imageMenuTest.revealed[0]);
  const imageCache = join(profile, 'cache', 'image-previews');
  assert.equal(revealedPath, join(imageCache, 'image-preview.png'));
  assert.deepEqual(await readFile(revealedPath), Buffer.from(fixtureImageData.split(',')[1], 'base64'));
  assert.equal(await page.evaluate(src => window.desktop.imageAction('reveal', src, 'second-image.png'), fixtureImageData), true);
  assert.deepEqual(await readdir(imageCache), ['image-preview.png'], 'repeated reveal must reuse the image cache');
  assert.equal((await readdir(profile)).includes('image-preview.png'), false, 'image reveal must not write to the data root');
  await sentImage.click({ button: 'right' });
  await imageMenu.getByRole('menuitem', { name: '添加到聊天', exact: true }).click();
  await page.locator('.attachment-open').waitFor();
  assert.equal(await page.locator('.composer > textarea').evaluate(element => document.activeElement === element), true);
  await page.locator('.attachment-card').hover();
  await page.getByRole('button', { name: '移除附件', exact: true }).click();
  await sentImage.click();
  const sentPreview = page.getByRole('dialog', { name: '预览 图片', exact: true });
  await sentPreview.waitFor();
  await sentPreview.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  await page.screenshot({ path: 'test-results/sent-image-preview.png' });
  await page.keyboard.press('Escape');
  await sentPreview.waitFor({ state: 'hidden' });
  assert.equal(await sentImage.evaluate(element => document.activeElement === element), true);
  await sentImage.press('Enter');
  await sentPreview.waitFor();
  // An immediate close must cancel the opening animation without leaving a layer.
  await page.keyboard.press('Escape');
  await sentPreview.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sentImage.press('Space');
  await sentPreview.waitFor();
  assert.equal(await sentPreview.evaluate(element => element.getAnimations().some(animation => Number(animation.effect.getTiming().duration) > 0)), false);
  await page.keyboard.press('Escape');
  await sentPreview.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ clipboard, dialog, shell }) => {
    clipboard.write = globalThis.imageMenuTest.write;
    dialog.showSaveDialog = globalThis.imageMenuTest.save;
    shell.showItemInFolder = globalThis.imageMenuTest.reveal;
    delete globalThis.imageMenuTest;
  });
  await page.locator('.turn-marker').first().hover();
  await page.locator('.turn-marker-preview').getByText('Fixture history').waitFor();
  await page.locator('.turn-marker').last().click();
  await page.waitForFunction(() => document.querySelector('.conversation').scrollTop > 0);
  await page.getByRole('button', { name: '会话导航', exact: true }).click();
  const navigation = page.getByRole('complementary', { name: '会话导航' });
  assert.equal(await navigation.getByRole('button').count(), 4);
  await navigation.getByRole('button', { name: /Fixture history/ }).click();
  await page.waitForFunction(() => document.querySelector('.conversation').scrollTop < 60);
  await page.locator('.turn-marker-preview').waitFor({ state: 'hidden' });
  if (await page.locator('.notice-toast').count()) await page.locator('.notice-toast').getByRole('button', { name: '关闭通知' }).click();
  await page.mouse.move(800, 400);
  await page.screenshot({ path: 'test-results/conversation-navigation.png' });
  await page.waitForTimeout(350);
  const railButtons = page.locator('.right-tool-rail .icon-button');
  assert.deepEqual(await railButtons.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['摘要', '上下文', '变更', '终端', '浏览器', '子代理', '会话导航']);
  for (const label of ['摘要', '上下文', '变更', '终端', '浏览器', '子代理', '会话导航']) {
    const button = page.locator('.right-tool-rail').getByRole('button', { name: label, exact: true });
    await button.hover();
    await tooltip.getByText(label, { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const anchor = document.querySelector('.right-tool-rail .icon-button:hover');
      const bubble = document.querySelector('.app-tooltip');
      const close = document.querySelector('.conversation-nav-panel header .icon-button');
      if (!anchor || !bubble || !close) return false;
      const tooltipBox = bubble.getBoundingClientRect();
      const closeBox = close.getBoundingClientRect();
      return tooltipBox.right < anchor.getBoundingClientRect().left - 4 &&
        (tooltipBox.bottom <= closeBox.top || tooltipBox.top >= closeBox.bottom || tooltipBox.right <= closeBox.left);
    });
    await page.waitForTimeout(180);
    if (label === '摘要') await page.screenshot({ path: 'test-results/right-rail-tooltip.png' });
  }
  await page.mouse.move(800, 400);
  await page.getByRole('button', { name: '摘要', exact: true }).click();
  await page.getByRole('complementary', { name: '摘要' }).getByText('暂无任务清单').waitFor();
  await page.screenshot({ path: 'test-results/summary-placeholder.png' });
  await page.getByRole('button', { name: '摘要', exact: true }).click();
  const currentRow = page.locator('.session-row.selected');
  await currentRow.click({ button: 'right' });
  assert.equal(await context.getByRole('menuitem', { name: '复制会话引用', exact: true }).isEnabled(), true);
  assert.equal(await context.getByRole('menuitem', { name: '分支', exact: true }).isEnabled(), true);
  await context.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('窗口验证会话');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await firstGroup.getByRole('button', { name: '窗口验证会话', exact: true }).click({ button: 'right' });
  await context.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('历史验证会话');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await firstGroup.getByRole('button', { name: '历史验证会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '在 Second project 新建会话', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.window-session-title')?.textContent === '新会话' &&
    !document.querySelector('.composer > textarea')?.disabled
  );
  const secondProjectState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(secondProjectState.independent, false);
  const secondGroup = page.getByRole('region', { name: secondProjectState.preferences.workspace, exact: true });
  await secondGroup.getByRole('button', { name: 'Second session', exact: true }).waitFor();
  await secondGroup.getByRole('button', { name: 'Second session', exact: true }).click({ button: 'right' });
  await context.getByRole('menuitem', { name: '归档会话' }).click();
  await page.getByRole('region', { name: secondProjectState.preferences.workspace, exact: true }).getByRole('button', { name: 'Second session', exact: true }).waitFor({ state: 'hidden' });
  await toast.getByText('已归档会话', { exact: true }).waitFor();
  await page.mouse.move(10, 10);
  await page.clock.runFor(300);
  const noticeTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: `test-results/notice-archive-${theme}.png`, animations: 'disabled' });
  }
  const archiveWindowSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 620));
  await page.waitForFunction(() => innerWidth <= 640);
  const actionBounds = await toast.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: innerWidth,
      fits: element.scrollWidth <= element.clientWidth };
  });
  assert.ok(actionBounds.left >= 0 && actionBounds.right <= actionBounds.viewport && actionBounds.fits);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await toast.evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.screenshot({ path: 'test-results/notice-archive-narrow.png', animations: 'disabled' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), archiveWindowSize);
  await page.waitForFunction(() => innerWidth > 1000);
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, noticeTheme);
  const archiveWidth = await toast.evaluate(element => {
    element.dataset.identity = 'archive-feedback';
    return element.getBoundingClientRect().width;
  });
  await toast.getByRole('button', { name: '撤销', exact: true }).click();
  await toast.getByText('会话已恢复', { exact: true }).waitFor();
  assert.equal(await toast.getAttribute('data-identity'), 'archive-feedback', 'undo replaces the same bubble in place');
  assert.equal(await toast.locator('.notice-actions').count(), 0);
  assert.equal(await toast.evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.mouse.move(10, 10);
  await page.clock.runFor(300);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: `test-results/notice-restored-${theme}.png`, animations: 'disabled' });
    const rect = await toast.boundingBox();
    await page.screenshot({ path: `test-results/notice-restored-${theme}-detail.png`, animations: 'disabled',
      clip: { x: rect.x - 16, y: rect.y - 8, width: rect.width + 32, height: rect.height + 24 } });
  }
  assert.ok(await toast.evaluate((element, oldWidth) => element.getBoundingClientRect().width < oldWidth, archiveWidth));
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, noticeTheme);
  await page.clock.fastForward(3100);
  await toast.waitFor({ state: 'hidden' });
  await secondGroup.getByRole('button', { name: 'Second session', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.archivedSessionIds.includes('fixture-1'), false);
  await secondGroup.getByRole('button', { name: 'Second session', exact: true }).click({ button: 'right' });
  await context.getByRole('menuitem', { name: '归档会话' }).click();
  await toast.getByText('已归档会话', { exact: true }).waitFor();
  assert.equal(await page.locator('.archived-group').count(), 0);
  await toast.getByRole('button', { name: '查看', exact: true }).click();
  await page.locator('[data-archived-session-id="fixture-1"]').getByRole('button', { name: '取消归档', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await secondGroup.getByRole('button', { name: 'Second session', exact: true }).waitFor();
  assert.equal(await firstGroup.getByRole('button', { name: 'Second session', exact: true }).count(), 0);
  await firstGroup.getByRole('button', { name: '中文项目 with spaces', exact: true }).click();
  assert.equal(await firstGroup.getByRole('button', { name: '历史验证会话', exact: true }).count(), 0);
  await firstGroup.getByRole('button', { name: '中文项目 with spaces', exact: true }).click();
  await secondGroup.getByRole('button', { name: 'Second session', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === 'Second session');
  await firstGroup.getByRole('button', { name: '历史验证会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '历史验证会话');
  await page.evaluate(() => {
    window.__sessionSwitchEvents = [];
    window.__stopSessionSwitchEvents = window.desktop.onEvent(event => {
      if (event.type === 'desktop_status' || event.type === 'desktop_exit') window.__sessionSwitchEvents.push(event.type === 'desktop_status' ? event.status : event.type);
    });
  });
  const sameWorkspaceSwitchStarted = Date.now();
  await firstGroup.getByRole('button', { name: '同项目另一会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '同项目另一会话');
  await firstGroup.getByRole('button', { name: '历史验证会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '历史验证会话');
  assert.deepEqual(await page.evaluate(() => { window.__stopSessionSwitchEvents(); return window.__sessionSwitchEvents; }), []);
  console.log(`Same-workspace round trip: ${Date.now() - sameWorkspaceSwitchStarted} ms without a runtime restart.`);
  await page.screenshot({ path: 'test-results/workspace-tree.png' });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: 'Add MCP', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'MCP', exact: true });
  await modal.getByLabel('名称', { exact: true }).fill('disabled-test');
  await modal.getByLabel('可执行文件', { exact: true }).fill('node');
  await modal.getByLabel('启用', { exact: true }).uncheck();
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  await page.getByText('disabled-test', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/settings-mcp.png' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMaximized()) window.unmaximize();
    window.setSize(700, 620);
  });
  await page.waitForFunction(() => document.querySelector('.app')?.classList.contains('sidebar-compact'));
  if (!motionReduced) {
    await page.waitForTimeout(65);
    const track = await page.locator('.app').evaluate(element => parseFloat(getComputedStyle(element, '::before').width));
    assert.ok(track > 0 && track < 244, `Sidebar track should animate at compact threshold: ${track}`);
  }
  await page.locator('.sidebar').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.sidebar-identity').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: '侧栏', exact: true }).getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  await page.locator('.sidebar').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.sidebar-identity').isVisible(), true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(790, 620));
  assert.equal(await page.locator('.sidebar-identity').isVisible(), true);
  assert.equal(await page.locator('.app.sidebar-compact').count(), 1);
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click({ position: { x: 700, y: 200 } });
  await page.locator('.sidebar').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.sidebar-identity').isVisible(), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620));
  await page.waitForFunction(() => !document.querySelector('.app')?.classList.contains('sidebar-compact'));
  await page.locator('.sidebar').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.sidebar-identity').isVisible(), true);
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 620));
  await page.waitForFunction(() => document.querySelector('.app')?.classList.contains('sidebar-compact'));
  await page.locator('.sidebar').waitFor({ state: 'hidden' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620));
  await page.waitForFunction(() => !document.querySelector('.app')?.classList.contains('sidebar-compact'));
  assert.equal(await page.locator('.sidebar-identity').isVisible(), false);
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 620));
  await page.waitForFunction(() => document.querySelector('.app')?.classList.contains('sidebar-compact'));
  await page.locator('.sidebar').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.sidebar-identity').isVisible(), false);
  if (await page.locator('.notice-toast').count()) await page.locator('.notice-toast').getByRole('button', { name: '关闭通知' }).click();
  await page.getByRole('button', { name: '摘要', exact: true }).click();
  await page.mouse.move(380, 320);
  await page.screenshot({ path: 'test-results/summary-narrow.png' });
  assert.equal(await page.locator('.right-panel-backdrop').count(), 0);
  await page.getByRole('complementary', { name: '摘要', exact: true }).getByRole('button', { name: '关闭侧栏', exact: true }).click();
  await page.getByRole('complementary', { name: '摘要' }).waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'test-results/desktop-narrow.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  const composerFits = await page.locator('.composer-tools').evaluate(element => {
    const attach = element.querySelector('button');
    const model = element.querySelector('.model-effort');
    const send = element.querySelector('.composer-action-button');
    const bounds = element.getBoundingClientRect();
    return attach && model && send
      && attach.getBoundingClientRect().right < model.getBoundingClientRect().left
      && model.getBoundingClientRect().right <= send.getBoundingClientRect().left
      && send.getBoundingClientRect().right <= bounds.right;
  });
  assert.equal(composerFits, true);
  await composerTools.getByRole('button', { name: '模型与思考强度' }).click();
  assert.equal(await page.getByRole('dialog', { name: '模型与思考强度' }).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 36;
  }), true);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  // Exercise the real renderer subscriber with the upstream JSON wire shape.
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'message_start', message: { role: 'user', content: '检查流式过程' } });
    send({ type: 'message_start', message: { role: 'assistant', content: [] } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '流式白屏回归验证' } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: 'fixture', toolName: 'read_file' } });
  });
  await page.getByText('流式白屏回归验证', { exact: true }).waitFor();
  await page.locator('.message.assistant').last().locator('.process-tool > summary').waitFor();
  await page.screenshot({ path: 'test-results/layout-conversation-narrow.png' });
  // Formula rendering uses isolated wire messages, not a live account or model.
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'message_start', message: { role: 'user', content: '测试流式数学' } });
    send({ type: 'message_start', message: { role: 'assistant', content: [] } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '流式公式：\n\n$$\n\\frac{1}{2}' } });
  });
  await page.getByText('流式公式：', { exact: false }).waitFor();
  const mathMessage = page.locator('.message.assistant').last();
  assert.equal(await mathMessage.locator('.katex').count(), 0, 'an unclosed block must stay source');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
    type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '\n$$' },
  }));
  await mathMessage.locator('.katex-display').waitFor();
  const mathFixture = [
    '### 数学排版',
    String.raw`能量 $E=mc^2$，下标与希腊字母 $a_i+\alpha+\beta=\gamma$。`,
    '',
    '**分数与根号**',
    '$$', String.raw`\frac{a}{b}+\sqrt{x^2+y^2}`, '$$',
    '',
    String.raw`**求和、积分与极限** $$\sum_{i=1}^{n}i=\frac{n(n+1)}{2},\quad\int_a^b f(x)\,dx,\quad\lim_{x\to0}\frac{\sin x}{x}=1$$`,
    '',
    String.raw`**矩阵** $$A=\begin{pmatrix}1&2\\3&4\end{pmatrix}$$`,
    '',
    String.raw`**分段函数** $$f(x)=\begin{cases}x^2&x\ge0\\-x&x<0\end{cases}$$`,
    '',
    '**长公式**',
    '$$', Array.from({ length: 50 }, (_, i) => `x_{${i + 1}}^2`).join('+'), '$$',
    '',
    '价格 $20 和 $30；代码 `$x^2$` 保持原样。',
    '',
    '```latex', String.raw`\frac{a}{b}`, '```',
    '',
    '$$', String.raw`\frac{1}{`, '$$',
    '',
    '**错误公式之后的正文仍可阅读。**',
  ].join('\n');
  await app.evaluate(({ BrowserWindow }, text) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'message_start', message: { role: 'user', content: '展示数学排版' } });
    send({ type: 'message_start', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: '先确认公式 $x^2$ 的表达。' },
      { type: 'text', text },
    ] } });
  }, mathFixture);
  await mathMessage.getByText('数学排版', { exact: true }).waitFor();
  assert.equal(await mathMessage.locator('.katex-display').count(), 5);
  assert.equal(await mathMessage.locator('.katex-error').count(), 1);
  assert.equal(await mathMessage.locator('pre code').count(), 1);
  await mathMessage.getByText('错误公式之后的正文仍可阅读。', { exact: true }).waitFor();
  await mathMessage.locator('.thinking summary').click();
  assert.equal(await mathMessage.locator('.thinking .katex').count(), 1);
  await mathMessage.locator('.thinking summary').click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1100));
  const assertCenteredFormula = async () => {
    const offsets = await mathMessage.locator('.katex-display').evaluateAll(elements => {
      return elements.slice(0, 4).filter(element => element.scrollWidth <= element.clientWidth).map(element => {
        const container = element.closest('.message-body').getBoundingClientRect();
        const parts = [...element.querySelectorAll('.katex-html > .base')].map(part => part.getBoundingClientRect());
        const left = Math.min(...parts.map(part => part.left));
        const right = Math.max(...parts.map(part => part.right));
        return Math.abs((left + right) / 2 - (container.left + container.right) / 2);
      });
    });
    assert.ok(offsets.length > 0, 'at least one short display formula must fit');
    for (const offset of offsets) assert.ok(offset < 2, `display formula must center in the reading column (offset ${offset}px)`);
  };
  for (const theme of ['light', 'dark']) {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '通用', exact: true }).click();
    await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption(theme);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await mathMessage.getByText('数学排版', { exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check('16px KaTeX_Main')), true);
    await assertCenteredFormula();
    await page.screenshot({ path: `test-results/math-${theme}.png` });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 880));
  const longFormula = mathMessage.locator('.katex-display').last();
  await longFormula.scrollIntoViewIfNeeded();
  await assertCenteredFormula();
  const formulaLayout = await longFormula.evaluate(element => ({
    scrolls: element.scrollWidth > element.clientWidth,
    left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    pageFits: document.documentElement.scrollWidth <= innerWidth,
    startOffset: element.querySelector('.katex-html .base').getBoundingClientRect().left - element.getBoundingClientRect().left,
  }));
  assert.equal(formulaLayout.scrolls, true);
  assert.equal(formulaLayout.pageFits, true);
  assert.ok(formulaLayout.left >= 0 && formulaLayout.right <= 640);
  assert.ok(Math.abs(formulaLayout.startOffset) < 2, 'overflow formula must have an accessible left edge');
  await longFormula.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  assert.ok(await longFormula.evaluate(element => element.scrollLeft) > 0);
  assert.ok(await longFormula.evaluate(element => {
    const content = element.querySelector('.katex-html').getBoundingClientRect();
    return Math.abs(content.right - element.getBoundingClientRect().right) < 2;
  }), 'overflow formula must have an accessible right edge');
  await page.screenshot({ path: 'test-results/math-narrow.png' });
  assert.deepEqual(errors, []);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForFunction(() => !document.querySelector('.app')?.classList.contains('sidebar-compact'));
  // Wait for finite layout transitions, not looping tool shimmer animations.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => animation.finished.catch(() => {}))));
  assert.equal(await page.locator('.sidebar-identity').isVisible(), true);
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'message_start', message: { role: 'user', content: '帮我检查项目的目录结构。' } });
    send({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: '我会先检查入口与配置，再查看主要模块。\n\n- 确认项目运行方式\n- 查看目录与依赖\n- 汇总需要关注的问题' }] } });
  });
  await page.getByText('帮我检查项目的目录结构。', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/layout-conversation-wide.png' });
  // Keep the real preload/IPC path; substitute only the OS write in this isolated process.
  await app.evaluate(({ clipboard }) => {
    globalThis.messageCopyTest = { original: clipboard.writeText, values: [] };
    clipboard.writeText = async text => { globalThis.messageCopyTest.values.push(text); };
  });
  await app.evaluate(({ BrowserWindow }) => {
    const send = message => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'message_start', message });
    send({ role: 'user', timestamp: Date.now(), content: '检查项目入口，说明这次做了哪些改动。' });
    send({ role: 'assistant', timestamp: Date.now(), content: [
      { type: 'thinking', thinking: '先检查入口文件，再确认测试覆盖。公式 $E=mc^2$ 仍可以阅读。' },
      { type: 'text', text: '先查看入口与验证脚本。' },
      { type: 'toolCall', id: 'presentation-read', name: 'read_file', arguments: { path: 'Desktop/src/main.tsx' } },
      { type: 'toolCall', id: 'presentation-test', name: 'bash', arguments: { command: 'corepack pnpm test' } },
    ] });
    send({ role: 'toolResult', toolCallId: 'presentation-test', toolName: 'bash', content: '36 tests passed', timestamp: Date.now() });
    send({ role: 'toolResult', toolCallId: 'presentation-read', toolName: 'read_file', content: 'export function App() { /* application entry */ }', timestamp: Date.now() });
    send({ role: 'assistant', timestamp: Date.now(), content: [{ type: 'text', text: '已整理会话展示。\n\n正文不再显示角色抬头，中间说明与工具状态按顺序保留，不会在完成后隐藏。\n\n- 用户消息支持复制与编辑回填。\n- 回复尾栏保留复制和分支占位。\n- 思考与工具详情可以逐级展开。' }] });
  });
  const presentationUser = page.locator('.message.user').last();
  const presentationResponse = page.locator('.message.assistant').last();
  const content = presentationResponse.locator('.response-content');
  await presentationResponse.getByText('已整理会话展示。', { exact: true }).waitFor();
  assert.equal(await page.locator('.message-label').count(), 0);
  assert.equal(await presentationResponse.locator('.response-process').count(), 0);
  assert.equal(await content.getByText('先查看入口与验证脚本。', { exact: true }).isVisible(), true);
  assert.equal(await content.locator('.process-tool').count(), 2);
  assert.equal(await content.locator('.process-tool.done').count(), 2);
  assert.equal(await content.locator('.process-tool > summary').getByText('读取了文件', { exact: true }).count(), 1);
  assert.equal(await content.locator('.process-tool > summary').getByText('运行了命令', { exact: true }).count(), 1);
  assert.equal(await content.locator('.process-tool > summary').getByText('corepack pnpm test', { exact: true }).count(), 0);
  assert.equal(await content.locator('.process-tool > summary .process-tool-status').count(), 0);
  assert.equal(await presentationResponse.locator('.assistant-actions button').count(), 2);
  assert.equal(await presentationResponse.locator('.branch-action').isDisabled(), true);
  await presentationUser.scrollIntoViewIfNeeded();
  await page.mouse.move(10, 10);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.message.user:last-of-type .user-actions') ?? [...document.querySelectorAll('.user-actions')].at(-1)).opacity === '0');
  const userBefore = await presentationUser.boundingBox();
  await presentationUser.hover();
  await page.waitForFunction(() => getComputedStyle([...document.querySelectorAll('.user-actions')].at(-1)).opacity === '1');
  const userAfter = await presentationUser.boundingBox();
  assert.equal(userBefore.height, userAfter.height, 'hover actions must not shift transcript layout');
  await presentationUser.getByRole('button', { name: '复制', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.messageCopyTest.values.at(-1)), '检查项目入口，说明这次做了哪些改动。');
  await page.locator('.composer > textarea').fill('');
  assert.equal(await presentationUser.getByRole('button', { name: '编辑并重做', exact: true }).isDisabled(), true,
    'Synthetic messages have no saved entry ID and cannot edit real history');
  await page.locator('.composer > textarea').fill('');
  await presentationResponse.locator('.assistant-actions').getByRole('button', { name: '复制', exact: true }).click();
  const copiedAnswer = await app.evaluate(() => globalThis.messageCopyTest.values.at(-1));
  assert.ok(copiedAnswer.startsWith('先查看入口与验证脚本。'));
  assert.ok(copiedAnswer.includes('已整理会话展示。'));
  assert.equal(copiedAnswer.includes('先检查入口'), false, 'answer copy must exclude private reasoning and tool data');
  assert.equal(copiedAnswer.includes('export function App'), false);
  assert.equal(copiedAnswer.includes('36 tests passed'), false);
  await page.mouse.move(10, 10);
  await presentationUser.getByRole('button', { name: '复制', exact: true }).focus();
  await page.waitForFunction(() => getComputedStyle([...document.querySelectorAll('.user-actions')].at(-1)).opacity === '1');
  await presentationUser.getByRole('button', { name: '复制', exact: true }).press('Enter');
  assert.equal(await app.evaluate(() => globalThis.messageCopyTest.values.at(-1)), '检查项目入口，说明这次做了哪些改动。');
  await presentationResponse.scrollIntoViewIfNeeded();
  for (const theme of ['light', 'dark']) {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '通用', exact: true }).click();
    await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption(theme);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await presentationUser.scrollIntoViewIfNeeded();
    await page.mouse.move(10, 10);
    await page.screenshot({ path: `test-results/transcript-${theme}-overview.png` });
    await content.locator('.thinking > summary').click();
    await content.locator('.process-tool > summary').first().click();
    await content.getByText('export function App() { /* application entry */ }', { exact: true }).waitFor();
    assert.equal(await content.locator('.thinking .katex').count(), 1);
    await page.screenshot({ path: `test-results/transcript-${theme}-expanded.png` });
    await content.locator('.thinking > summary').click();
    await content.locator('.process-tool > summary').first().click();
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 880));
  await content.locator('.process-tool > summary').first().click();
  await presentationUser.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/transcript-narrow.png' });
  await content.locator('.process-tool > summary').first().click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const sentQuotePrompt = '以下是用户选取的对话原文，作为本轮回复的参考资料：\n\n引用 1，来自此前的助手消息：\n> 并发不会自动隔离文件，提交前仍需检查自己的改动。\n> \n> ```ts\n> const session = "A";\n> ```\n\n引用 2，来自此前的用户消息：\n> 我希望保留当前的工作目录。\n\n用户本轮消息：\n这段我理解了，我们先完善引用的显示。';
  await app.evaluate(({ BrowserWindow }, prompt) =>
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event',
      { type: 'message_start', message: { role: 'user', content: prompt, timestamp: Date.now() } }), sentQuotePrompt);
  const quoteUser = page.locator('.message.user').last();
  await quoteUser.locator('.sent-quote').first().waitFor();
  assert.equal(await quoteUser.locator('.sent-quote').count(), 2);
  assert.equal(await quoteUser.locator('.sent-quote pre code').textContent(), 'const session = "A";\n');
  assert.equal(await quoteUser.locator('.sent-quote-reply').textContent(), '这段我理解了，我们先完善引用的显示。');
  assert.equal((await quoteUser.textContent()).includes('以下是用户选取'), false);
  await quoteUser.hover();
  await quoteUser.locator('.user-actions').getByRole('button', { name: '复制', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.messageCopyTest.values.at(-1)), sentQuotePrompt);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    await quoteUser.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/sent-quotes-${theme}.png` });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 880));
  await quoteUser.scrollIntoViewIfNeeded();
  assert.equal(await quoteUser.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await page.screenshot({ path: 'test-results/sent-quotes-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await app.evaluate(({ clipboard }) => { clipboard.writeText = globalThis.messageCopyTest.original; });
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'agent_start' });
    send({ type: 'message_start', message: { role: 'user', content: '检查运行中的工具', timestamp: Date.now() } });
    send({ type: 'message_start', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: '检查命令的返回值。' },
      { type: 'toolCall', id: 'presentation-pending', name: 'bash', arguments: { command: 'fixture-command' } },
      { type: 'toolCall', id: 'presentation-write', name: 'write_file', arguments: { path: 'fixture.md', content: 'Fixture document' } },
    ] } });
  });
  const liveResponse = page.locator('.message.assistant').last();
  const liveCommand = liveResponse.locator('.process-tool').first();
  const liveWrite = liveResponse.locator('.process-tool').nth(1);
  await liveCommand.locator('summary').getByText('正在运行命令', { exact: true }).waitFor();
  assert.equal(await liveResponse.locator('.assistant-actions').count(), 0);
  assert.notEqual(await liveResponse.locator('.thinking').getAttribute('open'), null);
  assert.equal(await liveResponse.locator('.response-process').count(), 0);
  assert.equal(await liveCommand.getAttribute('data-tool-state'), 'running');
  assert.equal(await liveCommand.locator('summary').getByText('fixture-command', { exact: true }).count(), 0);
  const shimmer = liveCommand.locator('.tool-summary-shimmer');
  assert.equal(await shimmer.evaluate(element => getComputedStyle(element, '::before').animationPlayState), 'running');
  await liveResponse.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const label = document.querySelector('.message.assistant:last-of-type .process-tool-label');
    return label && getComputedStyle(label).transform !== 'matrix(1, 0, 0, 1, 0, 0)';
  });
  const initialPosition = await shimmer.evaluate(element => getComputedStyle(element, '::before').backgroundPosition);
  await page.waitForFunction(position => {
    const element = document.querySelector('.message.assistant:last-of-type .tool-summary-shimmer');
    return getComputedStyle(element, '::before').backgroundPosition !== position;
  }, initialPosition);
  await page.screenshot({ path: 'test-results/transcript-tool-running.png' });
  await liveResponse.locator('.response-content').screenshot({ path: 'test-results/tool-summary-running.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await shimmer.evaluate(element => getComputedStyle(element, '::before').animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
      type: 'message_start', message: { role: 'toolResult', toolCallId: 'presentation-write', toolName: 'write_file', content: '' },
    });
  });
  await liveWrite.locator('summary').getByText('写入了文件', { exact: true }).waitFor();
  assert.equal(await liveWrite.getAttribute('data-tool-state'), 'done');
  assert.equal(await liveWrite.locator('.tool-summary-shimmer').evaluate(element => getComputedStyle(element, '::before').animationPlayState), 'paused');
  assert.equal(await liveCommand.getAttribute('data-tool-state'), 'running', 'a completed sibling must not stop a pending call');
  await page.waitForFunction(() => {
    const label = document.querySelectorAll('.message.assistant:last-of-type .process-tool-label')[1];
    return getComputedStyle(label).transform === 'matrix(1, 0, 0, 1, 0, 0)';
  });
  await liveWrite.locator(':scope > summary').click();
  await liveWrite.getByText('无输出', { exact: true }).waitFor();
  await liveWrite.locator('.process-tool-status').getByText('完成', { exact: true }).waitFor();
  await liveWrite.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/transcript-tool-completed.png' });
  await liveWrite.screenshot({ path: 'test-results/tool-summary-completed.png' });
  await liveWrite.locator(':scope > summary').click();
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'message_start', message: { role: 'assistant', content: [] } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } });
  });
  assert.notEqual(await liveResponse.locator('.thinking').getAttribute('open'), null, 'an empty text_start must not hide thinking');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
      type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '先记录检查进度。' },
    });
  });
  await liveResponse.getByText('先记录检查进度。', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.message.assistant:last-of-type .thinking')?.open);
  assert.equal(await liveResponse.locator('.assistant-actions').count(), 0, 'thinking must fold while the response is still running');
  assert.equal(await liveCommand.getAttribute('data-tool-state'), 'running', 'prose must not hide a running tool');
  await liveResponse.locator('.response-content').screenshot({ path: 'test-results/thinking-folded-on-prose.png' });
  await liveResponse.locator('.thinking > summary').click();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
      type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '命令仍在执行。' },
    });
  });
  await liveResponse.getByText('先记录检查进度。命令仍在执行。', { exact: true }).waitFor();
  assert.notEqual(await liveResponse.locator('.thinking').getAttribute('open'), null, 'later deltas must respect a manual reopen');
  await liveResponse.locator('.thinking > summary').click();
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'message_start', message: { role: 'toolResult', toolCallId: 'presentation-pending', toolName: 'bash', isError: true, content: 'fixture command failed' } });
    send({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: '命令未成功，已经保留失败详情。' }], timestamp: Date.now() } });
  });
  await liveResponse.getByText('命令未成功，已经保留失败详情。', { exact: true }).waitFor();
  await liveCommand.locator(':scope > summary').getByText('运行命令失败', { exact: true }).waitFor();
  assert.equal(await liveCommand.getAttribute('data-tool-state'), 'failed');
  assert.equal(await shimmer.evaluate(element => getComputedStyle(element, '::before').animationPlayState), 'paused');
  await page.waitForFunction(() => {
    const label = document.querySelector('.message.assistant:last-of-type .process-tool-label');
    return getComputedStyle(label).transform === 'matrix(1, 0, 0, 1, 0, 0)';
  });
  assert.equal(await liveCommand.locator(':scope > summary').evaluate(element => getComputedStyle(element).color),
    await liveCommand.locator('.process-tool-status').evaluate(element => getComputedStyle(element).color));
  assert.equal(await liveResponse.locator('.thinking').getAttribute('open'), null);
  await liveResponse.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/transcript-live.png' });
  await liveCommand.screenshot({ path: 'test-results/tool-summary-failed.png' });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
      type: 'message_start', message: { role: 'assistant', content: [
        { type: 'toolCall', id: 'presentation-missing', name: 'read_file', arguments: { path: 'missing.md' } },
      ] },
    });
  });
  // Runtime disconnect is another real path out of streaming; history must remain inspectable.
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'desktop_exit' });
    send({ type: 'desktop_status', status: 'connected' });
  });
  await page.waitForFunction(() => !document.querySelector('.message.assistant:last-of-type .thinking')?.open);
  assert.equal(await liveResponse.locator('.assistant-actions').count(), 1);
  assert.equal(await liveResponse.getByText('命令未成功，已经保留失败详情。', { exact: true }).isVisible(), true);
  assert.equal(await liveCommand.locator(':scope > summary').getByText('运行命令失败', { exact: true }).isVisible(), true);
  await liveResponse.getByText('读取文件（未返回）', { exact: true }).waitFor();
  assert.equal(await liveResponse.locator('.process-tool.running').count(), 0);
  await liveCommand.locator(':scope > summary').click();
  await liveCommand.getByText('fixture-command', { exact: true }).waitFor();
  await liveResponse.getByText('fixture command failed', { exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'agent_start' });
    send({ type: 'turn_start' });
    send({ type: 'message_update', usage: { input: 1000, output: 20, cacheRead: 1000, cacheWrite: 0 }, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '开始' } });
    send({ type: 'tool_execution_start', toolCallId: 'perf-tool', toolName: 'read_file' });
    send({ type: 'tool_execution_end', toolCallId: 'perf-tool', toolName: 'read_file', result: {}, isError: false });
    send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '完成' }], usage: { input: 1000, output: 150, cacheRead: 1000, cacheWrite: 0 } } });
    send({ type: 'agent_end' });
  });
  const performance = page.getByRole('region', { name: '性能信息' });
  await performance.getByText('输入 2K').waitFor();
  assert.equal(await performance.getByText('输出 150').count(), 1);
  assert.equal(await performance.getByText('1 次工具').count(), 1);
  assert.equal(await performance.getByText(/^首段文字 \d+\.\ds$/).count(), 1);
  assert.equal(await performance.getByText(/^工具累计 \d+\.\ds$/).count(), 1);
  assert.equal(await performance.getByText('缓存读取 1K').count(), 1);
  assert.equal(await performance.getByText('缓存命中 50%').count(), 1);
  // stats arrives asynchronously (agent_end triggers a snapshot refresh through the
  // IPC bridge), so wait for the session total to land before counting it.
  await performance.getByText('会话累计 0 tok · 0 次工具').waitFor();
  assert.equal(await performance.getByText('会话累计 0 tok · 0 次工具').count(), 1);
  await page.screenshot({ path: 'test-results/performance-wide.png' });
  const geometry = await page.evaluate(() => {
    const transcript = document.querySelector('.messages').getBoundingClientRect();
    const composer = document.querySelector('.composer-wrap').getBoundingClientRect();
    return { aligned: Math.abs(transcript.left - composer.left) < 2 && Math.abs(transcript.width - composer.width) < 2, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.equal(geometry.aligned, true);
  assert.equal(geometry.overflow, false);
  const fade = await page.locator('.composer-wrap').evaluate(element => {
    const style = getComputedStyle(element, '::before');
    return { image: style.backgroundImage, height: parseFloat(style.height), pointerEvents: style.pointerEvents };
  });
  assert.match(fade.image, /linear-gradient/);
  assert.ok(fade.height >= 60);
  assert.equal(fade.pointerEvents, 'none');
  await page.evaluate(() => {
    const filler = document.createElement('div');
    filler.className = 'scroll-fixture';
    filler.style.lineHeight = '28px';
    filler.style.whiteSpace = 'pre-line';
    filler.textContent = Array.from({ length: 70 }, (_, index) => `第 ${index + 1} 行对话内容，滚动至底部时逐渐淡出。`).join('\n');
    document.querySelector('.messages').append(filler);
    const transcript = document.querySelector('.conversation');
    transcript.scrollTop = transcript.scrollHeight - transcript.clientHeight - 250;
    transcript.dispatchEvent(new Event('scroll'));
  });
  const jump = page.getByRole('button', { name: '回到底部' });
  await jump.waitFor();
  assert.equal(await jump.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const composer = document.querySelector('.composer').getBoundingClientRect();
    return bounds.width === bounds.height && bounds.bottom < composer.top && bounds.right <= composer.right;
  }), true);
  await page.screenshot({ path: 'test-results/composer-scroll-fade.png' });
  await jump.click();
  await jump.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => {
    const element = document.querySelector('.conversation');
    return element.scrollHeight - element.scrollTop - element.clientHeight < 100;
  });
  assert.equal(await page.locator('.conversation').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight < 100), true);
  await page.evaluate(() => document.querySelector('.scroll-fixture').remove());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 620));
  await page.waitForFunction(() => document.querySelector('.app')?.classList.contains('sidebar-compact'));
  await page.locator('.sidebar').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.sidebar-identity').isVisible(), false);
  await page.screenshot({ path: 'test-results/performance-narrow.png' });
  const narrowPerformance = await performance.locator('.performance-summary').evaluate(element => {
    const style = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.ok(narrowPerformance.height <= narrowPerformance.lineHeight * 2 + 15);
  assert.equal(narrowPerformance.overflow, false);
  assert.equal(await performance.locator('.performance-ellipsis').isVisible(), false);
  await performance.locator('.performance-summary').evaluate(element => {
    for (let i = 0; i < 4; i++) {
      const extra = document.createElement('span');
      extra.className = 'overflow-fixture';
      extra.textContent = `附加指标 ${i + 1}：12345`;
      element.insertBefore(extra, element.querySelector('.performance-ellipsis'));
    }
  });
  await page.evaluate(() => dispatchEvent(new Event('resize')));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.performance-ellipsis')).display !== 'none');
  await page.screenshot({ path: 'test-results/performance-truncated.png' });
  const truncatedPerformance = await performance.locator('.performance-summary').evaluate(element => ({
    height: element.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
    centers: Array.from(element.children).filter(child => getComputedStyle(child).display !== 'none').map(child => child.offsetTop + child.offsetHeight / 2).sort((a, b) => a - b),
    ellipsis: element.querySelector('.performance-ellipsis').getBoundingClientRect(),
    previous: [...element.children].filter(child => getComputedStyle(child).display !== 'none').at(-2).getBoundingClientRect(),
  }));
  assert.ok(truncatedPerformance.height <= truncatedPerformance.lineHeight * 2 + 15);
  assert.ok(truncatedPerformance.centers.reduce((count, center, index) => count + (index === 0 || center - truncatedPerformance.centers[index - 1] > 8 ? 1 : 0), 0) <= 2);
  assert.ok(truncatedPerformance.ellipsis.left >= truncatedPerformance.previous.right);
  assert.ok(truncatedPerformance.ellipsis.left - truncatedPerformance.previous.right < 20);
  await performance.locator('.performance-summary').evaluate(element => element.querySelectorAll('.overflow-fixture').forEach(extra => extra.remove()));
  await page.evaluate(() => dispatchEvent(new Event('resize')));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.performance-ellipsis')).display === 'none');
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.composer > textarea').disabled);
  assert.equal(await page.getByRole('region', { name: '性能信息' }).getByText('最近一轮').count(), 0);
  assert.deepEqual(errors, []);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()), false);
  console.log('Electron acceptance passed: isolated profile, real RPC, settings, rename, MCP, themes, narrow window, no renderer Node access.');
} catch (error) {
  const pages = app.windows();
  if (pages[0]) { console.log(await pages[0].locator('body').innerText()); await pages[0].screenshot({ path: 'test-results/failure.png' }); }
  throw error;
} finally { await app.close(); }

// Both repeat launch and a brand-new profile open a proposal, not a worker.
const cleanProfile = await mkdtemp(join(tmpdir(), 'step-desktop-first-run-'));
for (const userData of [profile, cleanProfile]) {
  const relaunched = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env: { ...env, DESKTOP_TEST_USER_DATA: userData }, timeout: 60000 });
  try {
    const page = await relaunched.firstWindow();
    await relaunched.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    });
    await page.waitForFunction(() => { const input = document.querySelector('.composer > textarea'); return input && !input.disabled; }, { timeout: 60000 });
    const home = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(home.independent, !home.preferences.workspace);
    assert.equal(home.status, 'ready');
    assert.ok(home.draftId);
    assert.equal(home.runtimeId, undefined);
    assert.equal(home.state.sessionId, undefined);
    assert.equal(home.messages.length, 0);
    assert.equal(home.preferences.workspaces.length, userData === profile ? 2 : 0);
    assert.equal(home.sessions.some(s => !s.independent && s.cwd.startsWith(join(userData, 'workspaces', 'independent'))), false);
    if (userData === profile) {
      await page.getByRole('button', { name: '独立验证会话', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '独立验证会话');
      assert.equal((await page.evaluate(() => window.desktop.snapshot())).independent, true);
    }
    await page.screenshot({ path: `test-results/home-${userData === profile ? 'reopened' : 'first-run'}.png` });
  } finally { await relaunched.close(); }
}
console.log('Proposed home passed: new/reopened profiles, no eager worker and persistent independent history.');
