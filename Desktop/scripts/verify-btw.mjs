import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { settleLayout } from './settle-layout.mjs';

const output = process.env.DESKTOP_VERIFY_OUTPUT || 'test-results/btw';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `${server.resolvedUrls.local[0]}tests/fixtures/btw-panel.html`;
  const panel = page.getByRole('complementary', { name: '旁问', exact: true });
  const open = async () => {
    await page.getByRole('button', { name: '旁问', exact: true }).click();
    await panel.waitFor();
    await settleLayout(panel);
  };
  await page.goto(url);
  const composer = page.locator('main .composer-input');
  await composer.fill('KEEP-MAIN-DRAFT');
  await open();
  assert.equal(await page.locator('.composer-wrap').count(), 1,
    'Reusing composer styling does not add a second main-composer layout identity');
  assert.equal(await page.locator('.composer-tools [aria-controls="btw-panel"]').count(), 0);
  assert.equal(await page.locator('.right-tool-rail [aria-controls="btw-panel"]').count(), 1);
  assert.equal(await panel.evaluate(el => Math.round(innerWidth - el.getBoundingClientRect().right)), 44,
    'Side questions use the real right-rail slot');
  assert.equal(await composer.innerText(), 'KEEP-MAIN-DRAFT', 'Opening a side question preserves the main draft');
  assert.equal(await page.getByLabel('旁问内容', { exact: true }).evaluate(el => el === document.activeElement), true);
  const sideEditor = page.getByLabel('旁问内容', { exact: true });
  assert.equal(await sideEditor.getAttribute('contenteditable'), 'true', 'Side questions use the actual ProseMirror editor');
  assert.equal(await panel.locator('.btw-compose textarea').count(), 0, 'No independent textarea implementation remains');
  const appearance = (element, properties) => element.evaluate((el, names) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(names.map(name => [name, style[name]]));
  }, properties);
  const alignedComposers = async () => {
    await settleLayout(panel.locator('.btw-compose'));
    const edges = await page.evaluate(() => {
      const main = document.querySelector('main .composer').getBoundingClientRect();
      const side = document.querySelector('#btw-panel .composer').getBoundingClientRect();
      const mainRow = document.querySelector('main .composer-context-bar').getBoundingClientRect();
      const sideRow = document.querySelector('#btw-panel .composer-context-bar').getBoundingClientRect();
      return { top: side.top - main.top, bottom: side.bottom - main.bottom, row: sideRow.top - mainRow.top };
    });
    for (const [edge, distance] of Object.entries(edges))
      assert.ok(Math.abs(distance) < 1, `Main and side ${edge} align, not stagger (${distance}px)`);
  };
  await alignedComposers();
  assert.deepEqual(await appearance(panel.locator('.composer-context-bar'), ['display', 'height', 'gap', 'marginBottom']),
    await appearance(page.locator('main .composer-context-bar'), ['display', 'height', 'gap', 'marginBottom']),
    'Quotes and running changes use the same context-action row');
  const veil = element => element.evaluate(el => {
    const style = getComputedStyle(el, '::before');
    return { background: style.backgroundImage, top: style.top, height: style.height, pointerEvents: style.pointerEvents };
  });
  const mainVeil = await veil(page.locator('main .composer-wrap'));
  assert.match(mainVeil.background, /^linear-gradient/);
  assert.deepEqual(await veil(panel.locator('.btw-compose')), mainVeil,
    'Both transcripts fade into the same shared composer veil');
  assert.equal(await panel.locator('.btw-compose').evaluate(el => getComputedStyle(el).borderTopWidth), '0px',
    'There is no separate hard divider across the reference row');
  await page.getByRole('button', { name: '性能信息', exact: true }).click();
  await alignedComposers();
  assert.equal(await page.locator('main .performance-bar').count(), 0);
  await page.getByRole('button', { name: '性能信息', exact: true }).click();
  await alignedComposers();
  assert.deepEqual(await appearance(sideEditor, ['fontFamily', 'fontSize', 'lineHeight', 'padding', 'minHeight', 'maxHeight', 'whiteSpace']),
    await appearance(composer, ['fontFamily', 'fontSize', 'lineHeight', 'padding', 'minHeight', 'maxHeight', 'whiteSpace']),
    'Main and side editors share the same sizing, typography and spacing');
  assert.deepEqual(await appearance(panel.locator('.composer'), ['backgroundColor', 'border', 'borderRadius', 'boxShadow']),
    await appearance(page.locator('main .composer'), ['backgroundColor', 'border', 'borderRadius', 'boxShadow']),
    'The side composer uses the main composer surface instead of a similar custom shell');
  assert.deepEqual(await appearance(panel.locator('.composer-tools'), ['minHeight', 'gap', 'padding']),
    await appearance(page.locator('main .composer-tools'), ['minHeight', 'gap', 'padding']));
  assert.deepEqual(await appearance(panel.locator('.composer-action-button'), ['width', 'height', 'padding', 'borderRadius', 'backgroundColor']),
    await appearance(page.locator('main .composer-action-button'), ['width', 'height', 'padding', 'borderRadius', 'backgroundColor']));
  await panel.locator('.composer-action-icon[data-mode="send"]').waitFor();
  await sideEditor.fill('First line');
  await sideEditor.press('End');
  await sideEditor.press('Shift+Enter');
  await sideEditor.pressSequentially('第二行');
  assert.equal(await sideEditor.evaluate(el => el.value), 'First line\n第二行', 'Shift+Enter preserves multiline text without sending');
  await sideEditor.press('ControlOrMeta+a');
  await sideEditor.press('Backspace');
  assert.equal(await sideEditor.evaluate(el => el.value), '', 'Select-all deletion updates the side draft');
  await sideEditor.fill('保留输入法草稿');
  await sideEditor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true });
  assert.equal(await page.evaluate(() => window.btwFixture.calls.filter(call => call.type === 'ask').length), 0,
    'Multiline edits and IME confirmation never submit a side request');
  await sideEditor.fill('x'.repeat(8001));
  await sideEditor.press('Enter');
  await panel.getByRole('alert').filter({ hasText: '不能超过 8000' }).waitFor();
  assert.equal(await sideEditor.evaluate(el => el.value), 'x'.repeat(8001), 'Oversized edits remain available to shorten instead of being silently truncated');
  assert.equal(await page.evaluate(() => window.btwFixture.calls.filter(call => call.type === 'ask').length), 0);
  await page.getByLabel('旁问内容', { exact: true }).fill('为什么独立旁问不影响主任务？');
  await page.getByRole('button', { name: '发送旁问', exact: true }).click();
  await panel.locator('[data-state="done"]').waitFor();
  await panel.getByText('12,480', { exact: false }).waitFor();
  const answer = panel.locator('.btw-response');
  const typography = async element => element.evaluate(el => {
    const style = getComputedStyle(el);
    return { font: style.fontFamily, size: style.fontSize, leading: style.lineHeight };
  });
  assert.deepEqual(await typography(answer.locator('.message-body')), await typography(page.locator('main .message.assistant .message-body').first()),
    'Side prose uses the same body typography as the main conversation');
  assert.equal(await panel.locator('.btw-compose footer').count(), 0, 'No permanent explanatory footer is added below the composer');
  assert.ok(Math.abs((await panel.locator('.btw-compose').boundingBox()).height
    - (await page.locator('main .composer-wrap').boundingBox()).height) < 1,
    'The side composer reserves only the shared row, field and actual main footer');
  await answer.hover();
  await answer.locator('.message-actions .elapsed-total').waitFor();
  assert.ok(await answer.locator('.message-actions time').getAttribute('dateTime'));
  assert.equal(await answer.locator('.branch-action').count(), 0, 'Side answers do not expose unsupported main-session branching');
  await panel.getByRole('button', { name: '复制旁问回答', exact: true }).click();
  assert.equal(await page.evaluate(() => window.btwFixture.calls.at(-1).type), 'copy');
  await panel.getByRole('button', { name: '旁问宽度', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '全屏', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await panel.evaluate(el => el.classList.contains('is-expanded')), true);
  assert.equal(await panel.locator('[data-state="done"]').count(), 1, 'Expanding preserves answers');
  await panel.getByRole('button', { name: '还原侧栏', exact: true }).focus();
  await page.keyboard.press('Escape');
  assert.equal(await panel.evaluate(el => el.classList.contains('is-expanded')), false);
  await page.waitForTimeout(300);
  assert.equal(await panel.isVisible(), true, 'First Escape restores the right panel instead of closing it');
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '旁问', exact: true }).evaluate(el => el === document.activeElement), true);
  await open();
  assert.equal(await panel.locator('[data-state="done"]').count(), 1, 'Reopening retains the same in-memory history');
  await panel.getByRole('button', { name: '清空旁问', exact: true }).click();
  await panel.getByText('就当前任务问个问题', { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '旁问内容');
  await page.keyboard.press('Escape');
  await page.getByLabel('Scenario').selectOption('slow');
  await open();
  await page.getByLabel('旁问内容', { exact: true }).fill('取消我');
  await page.getByLabel('旁问内容', { exact: true }).press('Enter');
  await panel.getByRole('button', { name: '停止旁问', exact: true }).waitFor();
  await panel.locator('.composer-action-icon[data-mode="stop"]').waitFor();
  await panel.locator('[data-state="running"] .working-indicator .matrix-pulse[data-mode="responding"]').waitFor();
  await panel.locator('[data-state="running"] .btw-outcome .elapsed-label').waitFor();
  const revealSample = await page.waitForFunction(() => {
    const span = document.querySelector('#btw-panel .stream-reveal');
    const animation = span?.getAnimations().find(value => value.animationName === 'stream-text-in');
    if (!animation) return false;
    animation.pause(); animation.currentTime = 90;
    return { opacity: Number(getComputedStyle(span).opacity), text: span.closest('.btw-answer').textContent,
      duration: animation.effect.getTiming().duration };
  });
  const reveal = await revealSample.jsonValue();
  await revealSample.dispose();
  assert.equal(reveal.duration, 180, 'Side responses use the main streaming text animation');
  assert.ok(reveal.opacity > .3 && reveal.opacity < 1, 'New side text really fades in instead of appearing fully opaque');
  assert.ok(reveal.text.length > 0, 'The reveal never hides the answer');
  await panel.getByRole('button', { name: '停止旁问', exact: true }).click();
  await panel.locator('[data-state="cancelled"]').waitFor();
  await page.getByLabel('旁问内容', { exact: true }).fill('关闭取消');
  await page.getByLabel('旁问内容', { exact: true }).press('Enter');
  await panel.getByRole('button', { name: '停止旁问', exact: true }).waitFor();
  await panel.getByRole('button', { name: '关闭旁问', exact: true }).click();
  await page.waitForFunction(() => window.btwFixture.active.size === 0);
  await open();
  assert.equal(await panel.locator('[data-state="cancelled"]').count(), 2);
  await page.keyboard.press('Escape');
  await page.getByLabel('Scenario').selectOption('error');
  await open();
  await page.getByLabel('旁问内容', { exact: true }).fill('失败场景');
  await page.getByLabel('旁问内容', { exact: true }).press('Enter');
  await panel.locator('[data-state="error"]').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await open();
  assert.equal(await panel.locator('article').count(), 0, 'New conversation has no old temporary answers');
  await page.keyboard.press('Escape');
  await page.getByLabel('Scenario').selectOption('normal');
  await composer.fill('/btw explain snapshot isolation');
  await composer.press('Enter');
  await panel.getByText('explain snapshot isolation', { exact: true }).waitFor();
  await panel.locator('[data-state="done"]').waitFor();
  const old = await page.evaluate(() => window.btwFixture.calls.filter(call => call.type === 'ask').at(-1).input);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await open();
  await page.evaluate(old => window.btwFixture.emit(old, { kind: 'done', text: 'FOREIGN-ANSWER' }), old);
  assert.equal(await panel.getByText('FOREIGN-ANSWER', { exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await composer.fill('KEEP-MAIN-QUOTE-DRAFT');
  const toolbar = page.getByRole('toolbar', { name: '选中文字', exact: true });
  const select = async selector => {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.locator(selector).first().evaluate(el => {
      document.activeElement?.blur();
      const selection = getSelection(), range = document.createRange();
      range.selectNodeContents(el); selection.removeAllRanges(); selection.addRange(range);
    });
    await toolbar.waitFor();
  };
  await select('.response-text > p');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  const mainQuotes = page.locator('main .composer-quotes');
  await mainQuotes.getByRole('button', { name: '查看引用', exact: true }).waitFor();
  const beforeQuote = await page.evaluate(() => window.btwFixture.calls.filter(call => call.type === 'ask').length);
  await select('.response-text > p');
  await toolbar.getByRole('button', { name: '旁问', exact: true }).click();
  const viewQuotes = panel.getByRole('button', { name: '查看引用', exact: true });
  await viewQuotes.waitFor();
  await alignedComposers();
  const sideInput = panel.getByRole('textbox', { name: '旁问内容', exact: true });
  assert.equal(await sideInput.evaluate(el => el.value), '');
  assert.equal(await sideInput.evaluate(el => el === document.activeElement), true);
  assert.equal(await composer.innerText(), 'KEEP-MAIN-QUOTE-DRAFT');
  assert.equal(await mainQuotes.locator('.quote-chip').count(), 1);
  assert.equal(await page.evaluate(() => window.btwFixture.calls.filter(call => call.type === 'ask').length), beforeQuote,
    'Selecting Ask in side only prepares a quote and never calls the provider');
  await sideInput.fill('KEEP-SIDE-DRAFT');
  await select('.response-text > p');
  await toolbar.getByRole('button', { name: '旁问', exact: true }).click();
  assert.equal(await viewQuotes.innerText(), '1 条引用', 'Repeated selection is deduplicated');
  assert.equal(await sideInput.evaluate(el => el.value), 'KEEP-SIDE-DRAFT');
  await select('.response-text pre code');
  await toolbar.getByRole('button', { name: '旁问', exact: true }).click();
  assert.equal(await viewQuotes.innerText(), '2 条引用');
  await settleLayout(panel.locator('.btw-input-row'));
  const composeBox = await panel.locator('.btw-input-row').boundingBox();
  await viewQuotes.click();
  const quotePopover = page.getByRole('dialog', { name: '引用预览', exact: true });
  await quotePopover.waitFor();
  assert.equal(await quotePopover.locator('.composer-quote').count(), 2);
  await settleLayout(panel.locator('.btw-input-row'));
  assert.deepEqual(await panel.locator('.btw-input-row').boundingBox(), composeBox, 'Opening references does not displace the input');
  await quotePopover.getByRole('button', { name: '查看引用 1 的原文', exact: true }).focus();
  await page.keyboard.press('Escape');
  await quotePopover.waitFor({ state: 'hidden' });
  assert.equal(await panel.isVisible(), true, 'Escape closes the quote popover before the side panel');
  assert.equal(await viewQuotes.evaluate(el => el === document.activeElement), true);
  await viewQuotes.click();
  await quotePopover.getByRole('button', { name: '移除引用 2', exact: true }).click();
  assert.equal(await sideInput.evaluate(el => el === document.activeElement), true);
  await sideInput.fill('解释这里的配置');
  await sideInput.press('Enter');
  await panel.locator('[data-state="done"]').waitFor();
  const quoted = await page.evaluate(() => window.btwFixture.calls.filter(call => call.type === 'ask').at(-1).input.question);
  assert.match(quoted, /> 正在核对\*\*测试和构建配置\*\*/);
  assert.ok(quoted.endsWith('解释这里的配置'));
  assert.equal(await panel.locator('.composer-quotes').count(), 0);
  assert.equal(await panel.locator('.btw-sent-quotes blockquote').count(), 1);
  assert.equal(await composer.innerText(), 'KEEP-MAIN-QUOTE-DRAFT');
  assert.equal(await mainQuotes.locator('.quote-chip').count(), 1, 'Sending side references leaves main references untouched');
  await panel.getByRole('button', { name: '查看引用 1 的原文', exact: true }).click();
  assert.equal(await panel.getByRole('alert').count(), 0, 'Verified source can be revealed');
  await page.locator('.response-text').first().evaluate(el => el.dataset.messageEntryId = 'replaced-entry');
  await panel.getByRole('button', { name: '查看引用 1 的原文', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: '找不到这段原文' }).waitFor();
  await page.locator('.response-text').first().evaluate(el => el.dataset.messageEntryId = 'preview-assistant');
  await sideInput.fill('NEXT-DRAFT');
  await select('.response-text pre code');
  await toolbar.getByRole('button', { name: '旁问', exact: true }).click();
  await page.keyboard.press('Escape');
  await open();
  assert.equal(await viewQuotes.innerText(), '1 条引用', 'Closing retains pending side references');
  assert.equal(await sideInput.evaluate(el => el.value), 'NEXT-DRAFT');
  await viewQuotes.click();
  await quotePopover.waitFor();
  await panel.getByRole('button', { name: '关闭旁问', exact: true }).click();
  await quotePopover.waitFor({ state: 'hidden' });
  await open();
  assert.equal(await viewQuotes.innerText(), '1 条引用', 'Hiding the quote popover never discards references');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await open();
  assert.equal(await panel.locator('.composer-quotes').count(), 0);
  assert.equal(await sideInput.evaluate(el => el.value), '', 'New conversation discards pending side references and draft');
  for (const theme of ['light', 'dark']) for (const width of [1600, 1100, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${url}?theme=${theme}&lang=en`);
    await page.getByRole('button', { name: 'Side question', exact: true }).click();
    const dialog = page.getByRole('complementary', { name: 'Side question', exact: true });
    const textarea = page.getByLabel('Side question text', { exact: true });
    await dialog.getByRole('button', { name: 'Close side question', exact: true }).click();
    await page.locator('.response-text > p').first().scrollIntoViewIfNeeded();
    await page.locator('.response-text > p').first().evaluate(el => {
      document.activeElement?.blur();
      const range = document.createRange(); range.selectNodeContents(el);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    const englishToolbar = page.getByRole('toolbar', { name: 'Selected text', exact: true });
    await englishToolbar.waitFor();
    assert.equal(await englishToolbar.evaluate(el => {
      const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;
    }), true, 'The selection toolbar fits the viewport with the new side-question action');
    await englishToolbar.getByRole('button', { name: 'Ask in side', exact: true }).click();
    const pending = dialog.locator('.composer-context-bar .composer-quotes');
    await pending.waitFor();
    await dialog.getByRole('button', { name: 'View quotes', exact: true }).focus();
    await page.waitForTimeout(280);
    assert.equal(await pending.evaluate(el => [...el.querySelectorAll('button')].every(control => {
        const box = control.getBoundingClientRect();
        for (let parent = control.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (!/(hidden|auto|scroll|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
          const clip = parent.getBoundingClientRect();
          if (box.left - 4 < clip.left || box.right + 4 > clip.right
            || box.top - 4 < clip.top || box.bottom + 4 > clip.bottom) return false;
        }
        return box.left >= 4 && box.right + 4 <= innerWidth && box.top >= 4 && box.bottom + 4 <= innerHeight;
      })), true, 'Pending quote controls reserve their full four-sided focus extent inside every clipping ancestor');
    await settleLayout(dialog.locator('.btw-compose'));
    assert.ok(Math.abs((await dialog.locator('.composer').boundingBox()).y
      - (await page.locator('main .composer').boundingBox()).y) < 1,
      'Default composer tops align in both themes and narrow layouts, including a wrapped performance strip');
    await page.screenshot({ path: join(output, `${theme}-quotes-${width}.png`) });
    await dialog.getByRole('button', { name: 'View quotes', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Quote preview', exact: true });
    await preview.waitFor();
    await preview.getByRole('button', { name: 'Show source of quote 1', exact: true }).focus();
    assert.equal(await preview.evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    }), true, 'The shared reference popover fits narrow and desktop viewports');
    await page.waitForTimeout(160);
    await page.screenshot({ path: join(output, `${theme}-quote-popover-${width}.png`) });
    await page.keyboard.press('Escape');
    await preview.waitFor({ state: 'hidden' });
    assert.equal(await dialog.isVisible(), true);
    const shortInputHeight = (await textarea.boundingBox()).height;
    await textarea.fill('A longer draft\n'.repeat(24));
    assert.ok((await textarea.boundingBox()).height > shortInputHeight, 'The editor grows for multiline drafts without a manual resize handle');
    assert.equal(await textarea.evaluate(el => getComputedStyle(el).resize), 'none');
    await textarea.fill('x'.repeat(8000));
    const beforeOversize = await page.evaluate(() => window.btwFixture.calls.filter(call => call.type === 'ask').length);
    await textarea.press('Enter');
    await dialog.getByRole('alert').filter({ hasText: 'exceed 8,000' }).waitFor();
    assert.equal(await page.evaluate(() => window.btwFixture.calls.filter(call => call.type === 'ask').length), beforeOversize,
      'Combined quote/prompt length is rejected before making a model request');
    assert.equal(await pending.getByRole('button', { name: 'View quotes', exact: true }).innerText(), '1 quote', 'Oversized send retains the selected reference');
    assert.equal(await textarea.evaluate(el => el.value), 'x'.repeat(8000), 'Oversized send retains the side draft');
    await textarea.fill('Explain.');
    assert.ok((await textarea.boundingBox()).height <= shortInputHeight + 1, 'The editor shrinks again when the draft becomes short');
    await textarea.press('Enter');
    await dialog.locator('[data-state="done"]').waitFor();
    await textarea.focus();
    await page.waitForTimeout(260);
    assert.equal(await dialog.locator('.btw-input-row').evaluate(el => {
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) < 2) return false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const clipStyle = getComputedStyle(parent);
        if (!/(hidden|auto|scroll|clip)/.test(`${clipStyle.overflowX} ${clipStyle.overflowY}`)) continue;
        const clip = parent.getBoundingClientRect();
        if (box.left - 4 < clip.left || box.right + 4 > clip.right || box.top - 4 < clip.top || box.bottom + 4 > clip.bottom) return false;
      }
      return true;
    }), true, 'The composite field retains the complete shared focus ring around its outer boundary');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await dialog.locator('.right-panel-header').evaluate(el => el.scrollWidth > el.clientWidth), false,
      'All header controls fit even in a narrow right panel');
    assert.equal(await textarea.evaluate(el => {
      const box = el.getBoundingClientRect();
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(hidden|auto|scroll|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
          const clip = parent.getBoundingClientRect();
          if (box.left - 4 < clip.left || box.right + 4 > clip.right || box.top - 4 < clip.top || box.bottom + 4 > clip.bottom) return false;
        }
      }
      return box.left >= 4 && box.right + 4 <= innerWidth && box.top >= 4 && box.bottom + 4 <= innerHeight;
    }), true, 'Four-sided focus extent stays inside every clipping ancestor and viewport');
    if (width === 1600) assert.equal(await page.evaluate(() => {
      const edge = document.querySelector('#btw-panel').getBoundingClientRect().left;
      return ['.btw-preview-conversation .message.user', '.composer'].every(selector => document.querySelector(selector).getBoundingClientRect().right <= edge);
    }), true, 'Docked preview reuses the reading column so the main content stays clear of the panel');
    await page.screenshot({ path: join(output, `${theme}-${width}.png`) });
    if (width === 1600) {
      const standard = await dialog.evaluate(el => el.getBoundingClientRect().width);
      await dialog.getByRole('button', { name: 'Side question width', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Wide', exact: true }).click();
      await page.waitForTimeout(300);
      assert.ok(await dialog.evaluate(el => el.getBoundingClientRect().width) > standard);
      const docked = await page.locator('.btw-track').evaluate(el => el.getBoundingClientRect().width);
      assert.ok(docked > 0, 'Wide windows reserve layout space for the panel');
      await page.getByRole('button', { name: 'Adjust panel width', exact: true }).press('ArrowLeft');
      await page.waitForTimeout(300);
      assert.equal(await dialog.evaluate(el => el.classList.contains('is-expanded')), true);
      await dialog.getByRole('button', { name: 'Restore sidebar', exact: true }).click();
      await page.waitForTimeout(300);
      assert.equal(await dialog.locator('[data-state="done"]').count(), 1);
      await page.screenshot({ path: join(output, `${theme}-wide-${width}.png`) });
    }
    if (width === 320) {
      await page.keyboard.press('Escape');
      await page.getByLabel('Scenario').selectOption('rich');
      await page.getByRole('button', { name: 'Side question', exact: true }).click();
      await textarea.fill('Show rich Markdown.');
      await textarea.press('Enter');
      await dialog.locator('[data-state="done"]').nth(1).waitFor();
      await dialog.locator('.btw-answer table').waitFor();
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false, 'Rich text never widens the panel');
      assert.equal(await dialog.locator('.btw-history').evaluate(el => el.scrollWidth > el.clientWidth), false,
        'Only code and table surfaces scroll horizontally, not the whole history');
      assert.equal(await dialog.locator('.btw-answer pre').evaluate(el => getComputedStyle(el).whiteSpace), 'pre');
      assert.equal(await dialog.locator('.btw-answer table').evaluate(el => getComputedStyle(el).overflowX), 'auto');
      assert.equal(await dialog.locator('.btw-answer table').evaluate(el => el.scrollWidth > el.clientWidth), true,
        'Wide tables scroll instead of squeezing headers into vertical text');
      assert.equal(await dialog.locator('.btw-answer table th').evaluateAll(cells =>
        cells.every(cell => cell.getBoundingClientRect().height < 48)), true);
      await dialog.locator('.btw-answer pre .icon-button').click();
      assert.equal(await page.evaluate(() => window.btwFixture.calls.at(-1).type), 'copy');
      await page.screenshot({ path: join(output, `${theme}-rich-320.png`) });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.btw-panel').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await page.goto(`${url}?theme=dark&open=1&state=slow`);
  await page.getByRole('textbox', { name: '旁问内容', exact: true }).fill('Reduced motion answer');
  await page.getByRole('textbox', { name: '旁问内容', exact: true }).press('Enter');
  await page.locator('#btw-panel .btw-answer').waitFor();
  assert.equal(await page.locator('#btw-panel .btw-answer').evaluate(el =>
    el.getAnimations({ subtree: true }).some(animation => animation.animationName === 'stream-text-in')), false,
    'Reduced motion retains visible streamed answers without text animations');
  await alignedComposers();
  assert.deepEqual(errors, []);
  console.log('BTW: quote toolbar, independent main/side drafts and references, no auto-send, Markdown, deduplication, removal, length guards, verified source identity, session isolation, right rail, widths, streaming, themes, narrow layout and focus passed.');
} finally { await browser.close(); await server.close(); }
