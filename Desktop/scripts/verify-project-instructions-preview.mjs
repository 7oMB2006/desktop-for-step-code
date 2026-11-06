import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { settleLayout } from './settle-layout.mjs';

const output = resolve('test-results/project-instructions');
await mkdir(output, { recursive: true });
assert.match(await readFile('tests/fixtures/project-instructions-harness.ts', 'utf8'), /import\('\.\.\/\.\.\/src\/main'\)/);
assert.doesNotMatch(await readFile('tests/fixtures/project-instructions.css', 'utf8'),
  /\.(?:composer|permission|model-effort|message|performance|context-ring)\b/,
  'The preview must not restyle production components');
let server, browser;
const errors = [];
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/project-instructions.html`);
  const app = page.frameLocator('iframe');
  const input = () => app.getByRole('textbox', { name: /^(消息|Message)$/ });
  const row = () => app.getByRole('option').filter({ has: app.locator('code').filter({ hasText: /^\/init$/ }) });
  const open = async (text = '/in') => {
    await input().click();
    await input().press('ControlOrMeta+a');
    for (const [index, line] of text.split('\n').entries()) {
      if (index) await input().press('Shift+Enter');
      await input().pressSequentially(line);
    }
    await row().waitFor();
  };
  const checkBounds = async () => {
    await settleLayout(row());
    await settleLayout(input());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const layout = await row().evaluate(element => {
      const style = getComputedStyle(element);
      const detail = element.querySelector('.composer-discovery-detail');
      const label = element.querySelector('.composer-discovery-title').getBoundingClientRect();
      const keyword = element.querySelector('code').getBoundingClientRect();
      const description = detail.getBoundingClientRect();
      return { height: element.getBoundingClientRect().height, display: style.display,
        gap: style.gap, title: element.title, detail: detail.textContent,
        whiteSpace: getComputedStyle(detail).whiteSpace,
        sameLine: Math.abs(label.top + label.height / 2 - description.top - description.height / 2) <= 2,
        overlap: description.width > 0 && description.left < keyword.right - 1 };
    });
    assert.equal(layout.height, 34, 'Keep the native compact command row');
    assert.equal(layout.display, 'inline-flex');
    assert.equal(layout.gap, '9px');
    assert.equal(layout.whiteSpace, 'nowrap');
    assert.equal(layout.title, layout.detail, 'The native tooltip retains the full explanation');
    assert.ok(layout.sameLine);
    assert.equal(layout.overlap, false);
    const focus = await input().evaluate(element => {
      const box = element.closest('.composer').getBoundingClientRect();
      const extent = { left: box.left - 4, right: box.right + 4, top: box.top - 4, bottom: box.bottom + 4 };
      const clipped = [];
      for (let parent = element.closest('.composer').parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        const x = /auto|scroll|hidden|clip/.test(style.overflowX);
        const y = /auto|scroll|hidden|clip/.test(style.overflowY);
        if (x && (extent.left < bounds.left - 1 || extent.right > bounds.right + 1)
          || y && (extent.top < bounds.top - 1 || extent.bottom > bounds.bottom + 1)) clipped.push(parent.className);
      }
      return { ...extent, width: innerWidth, height: innerHeight, clipped,
        outline: getComputedStyle(element.closest('.composer')).outlineWidth,
        overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.ok(focus.left >= 0 && focus.right <= focus.width && focus.top >= 0 && focus.bottom <= focus.height);
    assert.deepEqual(focus.clipped, [], 'Keep the entire focus extent inside clipping ancestors');
    assert.equal(focus.outline, '2px');
    assert.equal(focus.overflow, false);
  };
  const ready = async title => {
    await app.locator('.composer-input[aria-disabled="false"]').waitFor();
    await row().filter({ hasText: title }).waitFor();
  };
  await ready('检查 AI 工作规范');
  assert.equal(await input().getAttribute('contenteditable'), 'true');
  assert.equal(await app.locator('.composer textarea').count(), 0);
  await app.getByRole('button', { name: '添加附件', exact: true }).waitFor();
  await app.getByRole('button', { name: '访问权限', exact: true }).waitFor();
  await app.getByRole('meter', { name: '上下文用量' }).waitFor();
  await app.getByRole('button', { name: '模型与思考强度', exact: true }).waitFor();
  await app.getByRole('region', { name: '性能信息' }).waitFor();
  assert.equal(await app.locator('.composer-action-icon .action-pixel').count(), 144);
  assert.equal(await app.locator('.composer-discovery-group').allTextContents().then(text => text.join(',')), '指令,技能');
  assert.equal(await app.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
  await checkBounds();
  await page.screenshot({ path: resolve(output, '01-review-native-wine.png'), fullPage: true });
  assert.deepEqual(await input().evaluate(element => {
    const value = element.value;
    element.selectionStart = 1;
    element.selectionEnd = 2;
    const selected = [element.selectionStart, element.selectionEnd];
    element.selectionStart = value.length;
    const collapsed = [element.selectionStart, element.selectionEnd];
    element.setSelectionRange(0, value.length, 'backward');
    element.selectionEnd = 1;
    const shortened = [element.selectionStart, element.selectionEnd];
    element.setSelectionRange(value.length, value.length);
    return { selected, collapsed, shortened, value: element.value };
  }), { selected: [1, 2], collapsed: [3, 3], shortened: [0, 1], value: '/in' },
  'React-compatible property writes preserve canonical selection and never change text');
  await input().dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  assert.equal(await input().evaluate(element => element.value), '/in', 'IME Enter must not choose or submit a command');
  await input().press('Enter');
  assert.equal(await input().evaluate(element => element.value), '/init ');
  assert.equal(await app.locator('.composer-inline-command-icon').count(), 1);
  await input().press('Enter');
  await app.getByText('本轮未修改任何文件。', { exact: true }).waitFor();
  await app.locator('.composer-action-button[data-action="send"]').waitFor();
  await page.screenshot({ path: resolve(output, '02-review-native-result.png'), fullPage: true });

  await app.getByRole('button', { name: '添加附件', exact: true }).click();
  await app.getByRole('listbox', { name: '附件与引用' }).waitFor();
  await input().press('Escape');
  await app.getByRole('button', { name: '访问权限', exact: true }).click();
  await app.getByRole('menuitemradio', { name: /^请求批准/ }).click();
  await app.locator('.permission-trigger.permission-ask').waitFor();
  await app.getByRole('button', { name: '模型与思考强度', exact: true }).click();
  const slider = app.getByRole('slider');
  await slider.press('End');
  await app.locator('.model-effort-trigger').filter({ hasText: '最高' }).waitFor();
  await app.getByRole('button', { name: '选择模型', exact: true }).click();
  await app.locator('.model-picker-select').filter({ hasText: 'step-4' }).click();
  await app.locator('.model-effort-trigger').filter({ hasText: 'step-4' }).waitFor();
  await slider.press('Escape');

  await page.getByLabel('项目状态').selectOption('create');
  await ready('创建 AI 工作规范');
  await page.screenshot({ path: resolve(output, '03-create-native-wine.png'), fullPage: true });
  await input().press('Enter'); await input().press('Enter');
  await app.getByText('已创建', { exact: false }).waitFor();
  await app.locator('.composer-action-button[data-action="send"]').waitFor();
  await open('/init');
  await row().filter({ hasText: '检查 AI 工作规范' }).waitFor();
  for (const mode of ['unavailable', 'choose-project']) {
    await page.getByLabel('项目状态').selectOption(mode);
    await ready('AI 工作规范');
    await row().filter({ hasText: mode === 'unavailable' ? '不会按' : '先选择项目' }).waitFor();
    await checkBounds();
    await row().click(); await input().press('Enter');
    await app.locator('.app-error-banner').filter({ hasText: mode === 'unavailable' ? '无法读取' : '先选择项目' }).waitFor();
    assert.equal(await input().evaluate(element => element.value.trim()), '/init');
  }
  await page.getByLabel('项目状态').selectOption('review');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['original-light', 'original-dark', 'wine']) {
      await page.getByLabel('主题', { exact: true }).selectOption(theme);
      await ready('检查 AI 工作规范');
      await open();
      await row().filter({ hasText: '检查 AI 工作规范' }).waitFor();
      await checkBounds();
      await open('保留现有人工约定\n/in');
      await checkBounds();
      await page.screenshot({ path: resolve(output, `04-review-${width}-${theme}.png`), fullPage: true });
    }
  }
  await page.getByLabel('语言', { exact: true }).selectOption('en');
  await ready('Check AI project rules');
  await checkBounds();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await app.locator('.composer-discovery').evaluate(element => getComputedStyle(element).animationName), 'none');
  await input().press('Escape');
  assert.equal(await app.locator('.composer-discovery').count(), 0);
  await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/fulltext-search-native.html`);
  await page.locator('.fulltext-hit').first().waitFor();
  const matches = await page.locator('.fulltext-hit').count();
  await page.getByRole('button', { name: '预览状态', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '摘要不可预览', exact: true }).click();
  const unavailable = page.locator('.fulltext-hit').filter({ hasText: '匹配摘要暂不可预览' });
  await unavailable.first().waitFor();
  assert.equal(await unavailable.count(), matches, 'Unconfirmed excerpts preserve all match navigation entries');
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-palette') !== `original-${theme}`)
        await page.getByRole('button', { name: '切换主题', exact: true }).click();
      await settleLayout(unavailable.first());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.ok(await unavailable.first().evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.screenshot({ path: resolve(output, `05-search-unconfirmed-${width}-${theme}.png`), fullPage: true });
    }
  }
  await unavailable.first().click();
  await page.locator('.fulltext-history .message').first().waitFor();
  assert.equal(await page.getByRole('button', { name: '打开并定位', exact: true }).isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, widths: [1280, 390, 320], themes: ['light', 'dark'],
    palettes: ['original-light', 'original-dark', 'wine'], mainApplication: true,
    languages: ['zh', 'en'], states: ['create', 'review', 'unavailable', 'choose-project'],
    unconfirmedSearchMatches: true, errors, output }));
} finally {
  await browser?.close();
  await server?.close();
}
