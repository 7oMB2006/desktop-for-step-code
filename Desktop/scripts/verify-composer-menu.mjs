import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-composer-menu-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1300, 900);
  });
  const snapshot = await prepareSessionFixture(page);
  await app.evaluate(({ ipcMain }, snapshot) => {
    const model = { provider: 'stepfun', id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 256000, thinkingLevels: ['low', 'medium', 'high'] };
    globalThis.menuFixture = { ...snapshot, stats: { ...snapshot.stats, contextUsage: { percent: 33, tokens: 84480, contextWindow: 256000 } }, state: { ...snapshot.state, model, thinkingLevel: 'medium' }, models: [model], messages: [
      { role: 'user', content: '请整理 /clm **这个项目** 的结构，再看 /usage。\n`/clm` 和 [/clm](https://example.com) 保留原样。\n\n[label](https://example.com)/clm \\/clm &#47;clm **label**/clm' },
      { role: 'assistant', content: '项目包含桌面界面、运行时桥接和验收脚本。可以先从聊天栏交互开始。' },
    ] };
    globalThis.menuPrompts = 0;
    globalThis.menuSentPrompts = [];
    globalThis.menuAttachments = [];
    globalThis.menuPermissionsSupported = false;
    globalThis.menuLinkPreviews = [];
    globalThis.menuBrowser = { revision: 0, tabs: [] };
    globalThis.menuOpenedLinks = [];
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return globalThis.menuFixture;
      if (method === 'systemTheme') return { systemDark: true };
      if (method === 'sessions') return snapshot.sessions;
      if (method === 'chooseAttachments') return globalThis.menuAttachments;
      if (method === 'settings') return { account: {}, profiles: [], mcp: {}, skills: [] };
      if (method === 'summary') return { tasks: [], mcp: [], skillCount: 0 };
      if (method === 'linkPreview') {
        globalThis.menuLinkPreviews.push(args[0]);
        return { url: args[0], title: '链接引用预览', description: '隔离验收中的网页详情' };
      }
      if (method === 'browserList' || method === 'browserLayout') return globalThis.menuBrowser;
      if (method === 'browserOpenLink') {
        globalThis.menuOpenedLinks.push(args[0]);
        globalThis.menuBrowser = { revision: globalThis.menuBrowser.revision + 1, activeId: 'link-tab',
          tabs: [{ id: 'link-tab', url: args[0], title: '链接预览', canGoBack: false, canGoForward: false, loading: false }] };
        return globalThis.menuBrowser;
      }
      if (method === 'command') {
        if (args[0] === 'prompt') { globalThis.menuPrompts++; globalThis.menuSentPrompts.push(args[1]?.message); }
        if (args[0] === 'get_available_thinking_levels') return { levels: ['low', 'medium', 'high'] };
        if (args[0] === 'get_commands') return { commands: [
          ...(globalThis.menuPermissionsSupported ? [{ name: 'permissions', source: 'extension' }] : []),
          ...['goal', 'plan', 'todos', 'workflows', 'usage', 'feedback', 'ultracode', 'cron', 'init', 'mcp', 'exit', 'theme', 'llama'].map(name => ({ name, source: 'extension', description: `${name} command` })),
          { name: 'review-code', source: 'skill', description: '审查代码变更' },
          { name: 'daily-note', source: 'prompt', description: '整理每日记录' },
        ] };
      }
      return {};
    });
  }, snapshot);
  await page.reload();
  const input = page.locator('.composer > .composer-input');
  await input.waitFor();
  assert.equal(await input.evaluate(element => element.spellcheck), false, 'Composer disables browser spellchecking');
  await input.fill('/');
  const menu = page.locator('.composer-discovery');
  await menu.waitFor();
  assert.equal(await page.locator('.permission-trigger').isDisabled(), true);
  assert.equal(await menu.getByRole('option', { name: /访问权限/ }).count(), 0, 'unsupported permission action is hidden');
  await input.fill('/permissions');
  await input.press('Enter');
  assert.equal(await input.evaluate(element => element.value), '/permissions', 'unavailable action preserves token');
  await input.fill('/');
  await menu.locator('svg.lucide-goal').waitFor();
  assert.equal(await menu.getByText('/exit', { exact: true }).count(), 0);
  assert.equal(await menu.locator('svg.lucide-goal').count(), 1);
  assert.equal(await menu.locator('svg.lucide-lightbulb').count(), 1);
  assert.equal(await menu.locator('svg.lucide-network').count(), 1);
  assert.equal(await menu.getByRole('option', { name: /用量统计/ }).locator('svg.lucide-chart-bar').count(), 1);
  assert.equal(await menu.getByRole('option', { name: /定时任务/ }).locator('svg.lucide-clock-3').count(), 1);
  assert.equal(await menu.getByRole('option', { name: /推进清单/ }).locator('svg.lucide-list-todo').count(), 1);
  assert.equal(await menu.getByRole('option', { name: /工作流/ }).locator('svg.lucide-workflow').count(), 1);
  assert.equal(await menu.getByRole('option', { name: /项目信任/ }).locator('svg.lucide-folder-check').count(), 1);
  for (const [command, badge] of [
    ['/compact', 'o'], ['/clm', 'l'], ['/clm-compact', 'l'],
  ]) {
    const row = menu.getByRole('option').filter({ has: page.getByText(command, { exact: true }) });
    assert.equal(await row.locator('.context-command-badge').innerText(), badge);
    assert.match(await row.locator('.context-command-icon .context-ring').getAttribute('style'), /33%/);
    assert.match(await row.getAttribute('title'), /当前上下文已用 33%/);
    assert.equal(await row.locator('[role="meter"], [tabindex="0"]').count(), 0, 'Decorative rings add no focus stop');
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
    type: 'desktop_stats', runtimeId: 'other-runtime',
    stats: { ...globalThis.menuFixture.stats, contextUsage: { percent: 85, tokens: 217600, contextWindow: 256000 } },
  }));
  assert.match(await menu.locator('.context-command-icon .context-ring').first().getAttribute('style'), /33%/,
    'Another runtime must not change the current context icons');
  for (const percent of [72, null, 33]) {
    await app.evaluate(({ BrowserWindow }, percent) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
      type: 'desktop_stats', stats: { ...globalThis.menuFixture.stats,
        contextUsage: { percent, tokens: percent === null ? null : 2560 * percent, contextWindow: 256000 } },
    }), percent);
    await page.waitForFunction(percent => {
      const ring = document.querySelector('.composer-discovery .context-command-icon .context-ring');
      return percent === null ? ring?.classList.contains('is-unknown') : ring?.style.getPropertyValue('--context-percent') === `${percent}%`;
    }, percent);
    const compact = menu.getByRole('option').filter({ has: page.getByText('/compact', { exact: true }) });
    assert.match(await compact.getAttribute('title'), percent === null ? /用量未知/ : new RegExp(`已用 ${percent}%`));
    assert.equal(await input.evaluate(element => element.value), '/', 'Live usage updates leave the draft unchanged');
  }
  assert.equal(await menu.getByRole('option', { name: /压缩上下文/ }).count(), 1);
  const sent = page.locator('.message.user').first();
  assert.equal(await sent.locator('.command-reference').count(), 2, 'Sent prose recognizes inline commands without marking code or links');
  assert.equal(await sent.locator('.command-reference svg.lucide-chart-bar').count(), 1);
  assert.equal(await sent.locator('strong').first().innerText(), '这个项目', 'Command decoration retains Markdown');
  assert.equal(await sent.locator('p').last().locator('.command-reference').count(), 0,
    'Escapes, entities and adjacent Markdown nodes do not invent transcript commands');
  assert.equal(await sent.locator('.command-reference').first().evaluate(element => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString();
    selection.removeAllRanges();
    return text;
  }), '/clm', 'Selecting a sent command preserves its slash');
  assert.equal(await sent.locator('p').first().evaluate(element => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString();
    selection.removeAllRanges();
    return text;
  }), '请整理 /clm 这个项目 的结构，再看 /usage。 /clm 和 /clm 保留原样。',
  'Selecting the paragraph preserves slashes without adding icon whitespace');
  assert.equal(await menu.getByRole('option', { name: /MCP/ }).locator('svg.lucide-mcp').count(), 1);
  await settleLayout(menu);
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector('.composer-discovery').getBoundingClientRect();
    const composer = document.querySelector('.composer').getBoundingClientRect();
    return { gap: composer.top - menu.bottom, left: composer.left - menu.left, right: composer.right - menu.right };
  });
  assert.ok(Math.abs(geometry.gap - 6) <= 1 && Math.abs(geometry.left) <= 1 && Math.abs(geometry.right) <= 1, JSON.stringify(geometry));
  assert.equal(await page.locator('.composer').evaluate(element => getComputedStyle(element).borderTopLeftRadius), '8px');
  assert.equal(await menu.evaluate(element => getComputedStyle(element).borderBottomLeftRadius), '8px');
  await page.screenshot({ path: 'test-results/composer-slash-dark.png' });
  await input.fill('/mcp inspect');
  await page.locator('.composer-inline-command-icon svg.lucide-mcp').waitFor();
  await input.fill('/plugin inspect');
  await page.locator('.composer-inline-command-icon svg.lucide-plug').waitFor();
  await input.fill('/cl');
  assert.equal(await menu.getByRole('option').count(), 2, 'Core CLM commands are discoverable even when get_commands omits them');
  assert.equal(await menu.getByText('/clm', { exact: true }).count(), 1);
  assert.equal(await menu.getByText('/clm-compact', { exact: true }).count(), 1);
  await page.screenshot({ path: 'test-results/composer-clm-dark.png' });
  await input.press('Enter');
  assert.equal(await input.evaluate(element => element.value), '/clm ');
  assert.equal(await menu.count(), 0);
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'Selecting CLM does not execute it');
  await input.fill('/clm-compact');
  await menu.getByRole('option', { selected: true }).filter({ hasText: '/clm-compact' }).waitFor();
  await input.press('Enter');
  assert.equal(await input.evaluate(element => element.value), '/clm-compact ');
  await input.fill('/clm-compact 保留项目名和关键要求');
  await input.press('End');
  await page.locator('.composer-inline-command-icon .command-reference').waitFor({ state: 'visible' });
  assert.equal(await input.evaluate(element => element.spellcheck), false, 'Command decorations keep spellchecking disabled');
  assert.equal(await page.locator('.composer-inline-command-icon .context-ring').count(), 1);
  assert.equal(await page.locator('.composer-inline-command-icon .context-command-badge').innerText(), 'l');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
    type: 'desktop_stats', stats: { ...globalThis.menuFixture.stats,
      contextUsage: { percent: 61, tokens: 156160, contextWindow: 256000 } },
  }));
  await page.waitForFunction(() => document.querySelector('.composer-inline-command-icon .context-ring')
    ?.style.getPropertyValue('--context-percent') === '61%');
  assert.match(await sent.locator('.context-command-icon .context-ring').getAttribute('style'), /61%/,
    'Existing transcript decorations follow the current context rather than inventing historical usage');
  assert.equal(await input.evaluate(element => element.value), '/clm-compact 保留项目名和关键要求',
    'Updating a decorated draft never alters its source');
  const prefixGeometry = await input.evaluate(element => {
    const style = getComputedStyle(element);
    const marker = element.querySelector('.composer-inline-command-icon');
    return { expected: element.getBoundingClientRect().left + parseFloat(style.paddingLeft),
      actual: marker.getBoundingClientRect().left, value: element.value };
  });
  assert.ok(Math.abs(prefixGeometry.actual - prefixGeometry.expected) < 1, 'recognized icon keeps the original text anchor');
  assert.equal(prefixGeometry.value, '/clm-compact 保留项目名和关键要求', 'Command decorations leave transport unchanged');
  await page.screenshot({ path: 'test-results/composer-command-reference.png' });
  await input.fill('ordinary text');
  assert.equal(await page.locator('.composer-inline-command-icon').count(), 0, 'plain text removes command decoration');
  await input.fill('/clm-compact 保留项目名和关键要求');
  await input.press('End');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
      type: 'extension_ui_request', method: 'notify', notifyType: 'info',
      message: 'CLM revision 0; ~21089 context tokens.\nIndex: C:/internal/index\nMirror: C:/internal/mirror\nArchive: C:/internal/archive',
    });
  });
  await page.getByText('工作上下文 · 修订 0 · 约 21,089 tokens', { exact: true }).waitFor();
  assert.equal(await page.locator('.notice-toast').innerText().then(text => text.includes('C:/internal')), false);
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'Selecting maintenance does not execute it');
  await input.fill('/goal');
  await input.press('Enter');
  assert.equal(await input.evaluate(element => element.value), '/goal ');
  assert.equal(await menu.count(), 0);
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'selection must not send');
  await input.fill('https://example.com/');
  assert.equal(await menu.count(), 0, 'URL slash is not a command');
  await input.fill('先检查项目 /cl');
  await menu.waitFor();
  assert.equal(await menu.getByRole('option').count(), 2, 'Commands complete after whitespace within prose');
  await settleLayout(menu);
  await page.screenshot({ path: 'test-results/composer-inline-slash-dark.png' });
  await input.press('Enter');
  assert.equal(await input.evaluate(element => element.value), '先检查项目 /clm ', 'Completion preserves preceding prose');
  assert.equal(await input.locator('.composer-inline-command-icon .context-ring').count(), 1, 'Inline completion becomes a command marker');
  assert.equal(await input.locator('.composer-inline-command-icon .context-command-badge').innerText(), 'l');
  assert.equal(await menu.count(), 0);
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'Inline completion never submits the draft');
  const middleDraft = '先检查 /cl 然后总结';
  await input.fill(middleDraft);
  await input.evaluate(element => element.setSelectionRange(7, 7));
  await menu.waitFor();
  await input.press('Tab');
  assert.equal(await input.evaluate(element => element.value), '先检查 /clm  然后总结', 'Middle completion preserves trailing prose');
  await page.waitForFunction(() => document.querySelector('.composer-input').selectionStart === 9);
  await input.fill('第一行\n/clm-co');
  await menu.waitFor();
  await input.press('Enter');
  assert.equal(await input.evaluate(element => element.value), '第一行\n/clm-compact ', 'Commands complete after a newline');
  assert.equal(await input.locator('.composer-inline-command-icon').count(), 1);
  await input.fill('a /clm 再看 /usage 和 /cron\n/todos /workflows');
  await page.waitForFunction(() => document.querySelectorAll('.composer-inline-command-icon').length === 5);
  assert.equal(await input.locator('svg.lucide-chart-bar').count(), 1);
  assert.equal(await input.locator('svg.lucide-clock-3').count(), 1);
  assert.equal(await input.evaluate(element => element.value), 'a /clm 再看 /usage 和 /cron\n/todos /workflows');
  await page.locator('.composer').screenshot({ path: 'test-results/composer-command-inline-dark.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.locator('.composer').screenshot({ path: 'test-results/composer-command-inline-light.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await input.fill('`/clm` [/usage](https://example.com) /cron/file /unknown');
  assert.equal(await input.locator('.composer-inline-command-icon').count(), 0);
  await input.fill('先检查\t/pl');
  await menu.waitFor();
  await input.press('Escape');
  assert.equal(await menu.count(), 0, 'Escape dismisses an inline command');
  assert.equal(await input.evaluate(element => element.value), '先检查\t/pl', 'Dismissal preserves the draft');
  for (const value of ['正文/cl', 'https://example.com/cl', 'C:/cl', '路径 /src/file', '先检查 /cl 后续']) {
    await input.fill(value);
    assert.equal(await menu.count(), 0, `Not an active command token: ${value}`);
  }
  await input.fill('前面 /cl 后面 /pl');
  await menu.waitFor();
  assert.equal(await menu.getByText('/plan', { exact: true }).count(), 1, 'Completion follows the token at the caret');
  await input.press('Enter');
  assert.equal(await input.evaluate(element => element.value), '前面 /cl 后面 /plan ', 'Only the current token is replaced');
  await input.fill('对照 [阶跃平台](https://platform.stepfun.com/)');
  assert.equal(await input.locator('.composer-inline-link-text').innerText(), '[阶跃平台](https://platform.stepfun.com/)');
  const linkDraft = '对照 https://platform.stepfun.com/ 和 https://example.com/guide\n'
    + '保留原始地址与参数。`https://example.com/code`';
  await input.fill(linkDraft);
  const links = input.locator('.composer-inline-link-icon');
  await links.first().waitFor();
  assert.equal(await links.count(), 2);
  assert.equal(await page.locator('.composer-links').count(), 0, 'There is no separate reference row');
  assert.equal(await input.locator('.composer-inline-link-text').first().innerText(), 'https://platform.stepfun.com/');
  assert.equal(await input.evaluate(element => element.value), linkDraft, 'Recognition does not rewrite the editable draft');
  assert.deepEqual(await app.evaluate(() => globalThis.menuLinkPreviews), [], 'Typing links never fetches website metadata');
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'Typing links never submits the draft');
  await page.screenshot({ path: 'test-results/composer-links-dark.png' });
  const platform = links.getByRole('link', { name: 'https://platform.stepfun.com/', exact: true });
  await platform.hover();
  await page.locator('.link-preview-body strong').waitFor();
  assert.equal(await page.locator('.link-preview-body strong').innerText(), '链接引用预览');
  await page.screenshot({ path: 'test-results/composer-links-preview-dark.png' });
  await page.keyboard.press('Escape');
  await page.locator('.link-preview').waitFor({ state: 'detached' });
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'Activating an inline icon never sends the pending message');
  await platform.focus();
  await page.locator('.link-preview[aria-hidden="false"]').waitFor();
  await platform.press('Enter');
  await page.locator('.browser-panel.is-closing').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.desktop && document.querySelector('#browser-panel'));
  assert.deepEqual(await app.evaluate(() => globalThis.menuOpenedLinks), ['https://platform.stepfun.com/']);
  assert.equal(await input.evaluate(element => element.value), linkDraft, 'Opening the built-in browser preserves the pending draft');
  await platform.click();
  await page.locator('#browser-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#browser-panel').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('#browser-panel').evaluate(element => element.inert), true);
  assert.equal(await page.locator('.browser-track.is-open').count(), 0);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 760));
  await page.screenshot({ path: 'test-results/composer-links-light-narrow.png' });
  await settleLayout(page.locator('.composer'));
  assert.equal(await input.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Long links wrap with the surrounding input text');
  await input.evaluate(element => { element.setSelectionRange(3, 8); });
  assert.equal(await input.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd)), linkDraft.slice(3, 8));
  await input.fill(Array.from({ length: 40 }, (_, index) => `https://example.com/long-reference-${index}`).join(' '));
  assert.equal(await links.count(), 32);
  assert.equal(await input.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    element.scrollTop = element.scrollHeight;
    return element.scrollHeight > element.clientHeight && element.scrollTop > 0
      && element.scrollWidth <= element.clientWidth && bounds.height <= 181 && bounds.right <= window.innerWidth;
  }), true, 'Many references wrap and scroll vertically within the narrow composer');
  const row = await input.boundingBox();
  const tools = await page.locator('.composer-tools').boundingBox();
  assert.ok(row && tools && row.y + row.height <= tools.y + 1, 'Inline references never overlap the model and permission controls');
  await input.fill('文本 https://example.com/guide 尾部');
  await input.evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
  await input.press('Shift+Enter');
  await input.pressSequentially('下一行');
  assert.equal(await input.evaluate(element => element.value), '文本 https://example.com/guide 尾部\n下一行');
  await input.press('ControlOrMeta+z');
  await input.press('ControlOrMeta+Shift+z');
  assert.equal(await input.evaluate(element => element.value), '文本 https://example.com/guide 尾部\n下一行', 'Undo/redo does not serialize icons');
  await input.evaluate(element => element.setSelectionRange(3, 31));
  await input.pressSequentially('替换');
  assert.equal(await input.evaluate(element => element.value), '文本 替换\n下一行', 'Replacing a selection across a decorated URL uses raw text offsets');
  const pasteDraft = '粘贴 https://example.com/?a=1&b=2\n<script>alert(1)</script>\n结尾';
  await input.fill('');
  await input.evaluate((element, text) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', text);
    transfer.setData('text/html', '<b>不应作为富文本导入</b>');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, pasteDraft);
  assert.equal(await input.evaluate(element => element.value), pasteDraft, 'Clipboard keeps plain text, query parameters and newlines');
  assert.equal(await input.locator('script, b').count(), 0, 'HTML never enters the editor DOM');
  await input.evaluate(element => element.setSelectionRange(0, element.value.length));
  await input.evaluate(element => {
    const transfer = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: transfer, bubbles: true, cancelable: true }));
    window.composerCopiedText = transfer.getData('text/plain');
  });
  assert.equal(await page.evaluate(() => window.composerCopiedText), pasteDraft, 'Copy serializes neither icons nor preview metadata');
  await input.fill('输入法 https://example.com/ ');
  await input.evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '阶跃', selectionStart: 2, selectionEnd: 2 });
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'IME confirmation never submits a decorated draft');
  await cdp.send('Input.insertText', { text: '阶跃' });
  await page.waitForFunction(() => document.querySelector('.composer-input').value === '输入法 https://example.com/ 阶跃');
  await input.fill('输入法 https://example.com/ ');
  await input.evaluate(element => element.setSelectionRange(element.value.length - 1, element.value.length - 1));
  await cdp.send('Input.imeSetComposition', { text: '阶', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: '阶跃', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.insertText', { text: '阶跃' });
  await page.waitForFunction(() => document.querySelector('.composer-input').value === '输入法 https://example.com/阶跃 ');
  assert.equal(await input.locator('.composer-inline-link-icon').count(), 1, 'Composition inside a URL never duplicates its icon');
  await cdp.detach();
  await input.fill('链接不应该改掉这个输入法内容');
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  assert.equal(await input.evaluate(element => element.value), '链接不应该改掉这个输入法内容');
  assert.equal(await links.count(), 0, 'Deleting URLs removes the references');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1300, 900));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await input.fill('mail@example.com');
  assert.equal(await menu.count(), 0, 'email is not a mention');
  await input.fill('/no-such-command');
  await input.press('Enter');
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'empty results must not send');
  await input.fill('/plan');
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })));
  assert.equal(await input.evaluate(element => element.value), '/plan');
  await input.press('Escape');
  assert.equal(await menu.count(), 0);
  await input.fill('看看 @');
  await menu.waitFor();
  await page.screenshot({ path: 'test-results/composer-references-dark.png' });
  await menu.getByRole('option', { name: /文件和图片/ }).click();
  assert.equal(await input.evaluate(element => element.value), '看看 @', 'cancelled picker retains token');
  await input.click();
  await menu.getByRole('option', { name: /项目包含桌面界面/ }).click();
  assert.equal(await input.evaluate(element => element.value), '看看 ');
  assert.equal(await page.locator('.composer-quotes').count(), 1);
  await input.fill('普通消息');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await menu.waitFor();
  await input.press('Escape');
  assert.equal(await input.evaluate(element => element.value), '普通消息');
  await app.evaluate(() => { globalThis.menuAttachments = Array.from({ length: 10 }, (_, index) => ({
    kind: 'file', id: `fixture-file-${index}`, name: `file-${index}.txt`, size: 1,
  })); });
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await menu.getByRole('option', { name: /文件和图片/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.attachment-card').length === 10);
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  assert.equal(await menu.getByRole('option', { name: /文件和图片/ }).isDisabled(), true);
  await input.press('ArrowDown');
  await input.press('Enter');
  assert.equal(await page.locator('.composer-quotes').count(), 1, 'references remain accessible at attachment limit');
  assert.equal(await input.evaluate(element => element.value), '普通消息');
  assert.equal(await page.locator('.attachment-card').count(), 10);
  await app.evaluate(() => { globalThis.menuPermissionsSupported = true; });
  await page.reload();
  await input.fill('/permissions');
  await menu.getByRole('option', { name: /访问权限/ }).click();
  await page.locator('.permission-trigger[aria-expanded="true"]').waitFor();
  assert.equal(await input.evaluate(element => element.value), '', 'supported permission action opens the real picker');
  await page.waitForFunction(() => document.activeElement?.closest('.permission-menu'));
  await page.keyboard.press('Escape');
  await page.locator('.permission-trigger[aria-expanded="false"]').waitFor();
  await input.fill('/模型');
  await menu.getByRole('option', { name: '模型 选择模型与思考档位', exact: true }).waitFor();
  assert.equal(await menu.getByRole('option', { selected: true }).innerText().then(text => text.startsWith('模型')), true,
    'A stationary pointer cannot override the first keyboard match after the list changes');
  await input.press('Enter');
  await page.locator('.model-effort-trigger[aria-expanded="true"]').waitFor();
  await page.keyboard.press('Escape');
  const openFreshSlashMenu = async () => {
    // Escape dismisses the existing token; each layout case starts a new draft.
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    await page.waitForFunction(() => document.querySelector('.composer-input')?.dataset.empty === 'true');
    await input.pressSequentially('/');
    await page.waitForFunction(() => document.querySelector('.composer-input')?.dataset.empty === 'false');
    await input.focus();
    await input.evaluate(element => element.setSelectionRange(1, 1));
    await page.waitForFunction(() => {
      const element = document.querySelector('.composer-input');
      return element?.value === '/' && element.selectionStart === 1 && element.selectionEnd === 1;
    });
    await menu.waitFor();
  };
  const verifyModelLayer = async (theme, size) => {
    console.log(`Composer model layer: ${theme} ${size[0]}x${size[1]}`);
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), size);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await openFreshSlashMenu();
    await page.locator('.model-effort-trigger').click();
    const popover = page.locator('.model-effort-popover');
    await popover.waitFor();
    await settleLayout(page.locator('.composer-wrap'));
    const hits = await popover.evaluate(element => {
      const panel = element.getBoundingClientRect();
      const menu = document.querySelector('.composer-discovery').getBoundingClientRect();
      const top = Math.max(panel.top, menu.top), bottom = Math.min(panel.bottom, menu.bottom);
      const left = Math.max(panel.left, menu.left), right = Math.min(panel.right, menu.right);
      if (bottom <= top || right <= left) return [];
      return [.2, .5, .8].map(fraction => element.contains(document.elementFromPoint(
        left + (right - left) * fraction, top + (bottom - top) * .3)));
    });
    assert.equal(hits.length, 3, 'Fixture must overlap discovery and model surfaces');
    assert.ok(hits.every(Boolean), `Model panel must receive pointer hits above discovery: ${hits}`);
    await page.screenshot({ path: `test-results/composer-model-layer-${theme}-${size[0]}.png` });
    const slider = popover.getByRole('slider');
    await slider.focus();
    await slider.press('End');
    assert.equal(await slider.getAttribute('aria-valuenow'), '2', 'Discovery cannot intercept thinking slider keys');
    await popover.getByRole('button', { name: '选择模型', exact: true }).click();
    await popover.locator('.model-effort-list').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await popover.count(), 0);
    assert.equal(await menu.count(), 1, 'Picker Escape closes only the foreground picker');
    await input.focus();
    await input.press('Escape');
  };
  await verifyModelLayer('dark', [1300, 900]);
  await verifyModelLayer('light', [1300, 900]);
  await verifyModelLayer('dark', [840, 760]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(840, 760));
  await openFreshSlashMenu();
  await settleLayout(menu);
  await page.screenshot({ path: 'test-results/composer-slash-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1300, 900));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await settleLayout(menu);
  await page.screenshot({ path: 'test-results/composer-slash-light.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false);
  const showcase = '参考这个页面 https://member.bilibili.com/platform/upload/video/frame?page_from=creative_home_top_upload\n保留正文，链接就在原位。';
  await input.fill(showcase);
  await input.evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
  await input.focus();
  await page.mouse.move(10, 10);
  await page.locator('.composer').screenshot({ path: 'test-results/composer-inline-links-light.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.locator('.composer').screenshot({ path: 'test-results/composer-inline-links-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 760));
  await page.locator('.composer').screenshot({ path: 'test-results/composer-inline-links-narrow.png' });
  await input.fill('原文 https://example.com/?a=1&b=2\n第二行保持不变');
  await input.press('Enter');
  assert.deepEqual(await app.evaluate(() => globalThis.menuSentPrompts), ['原文 https://example.com/?a=1&b=2\n第二行保持不变']);
  assert.deepEqual(errors, []);
  console.log('Composer discovery acceptance passed: anchor, filtering, selection, IME, cancellation, quotes, model picker and narrow layout.');
} finally { await app.close(); }
