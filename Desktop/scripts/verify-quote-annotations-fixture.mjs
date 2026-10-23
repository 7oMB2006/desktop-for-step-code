import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  for (const theme of ['light', 'dark']) {
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`http://127.0.0.1:5195/tests/fixtures/quote-annotations.html?theme=${theme}`);
      await page.locator('.response-text p').first().waitFor();
      await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('.response-text p'));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      await page.getByRole('button', { name: '批注', exact: true }).click();
      const editor = page.getByRole('textbox', { name: '选段批注' });
      await editor.fill('这个保留，但先让我确认目标项目。\n不要默认作为独立会话导入。');
      const bounds = await page.getByRole('toolbar').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 800);
      assert.equal(await page.evaluate(() => CSS.highlights.has('quote-annotation-selection')), true);
      assert.notEqual(await page.locator('.response-text p').first().evaluate(element =>
        getComputedStyle(element, '::highlight(quote-annotation-selection)').backgroundColor), 'rgba(0, 0, 0, 0)');
      await page.screenshot({ path: `test-results/annotation-entry-${theme}-${width}.png` });
      await page.getByRole('button', { name: '添加批注', exact: true }).click();
      const footnote = page.getByRole('button', { name: '查看批注 1', exact: true });
      await footnote.waitFor();
      assert.equal(await footnote.textContent(), '[1]');
      await page.screenshot({ path: `test-results/annotation-footnote-${theme}-${width}.png` });
      const source = await page.locator('.response-text p').first().boundingBox();
      await page.mouse.move(source.x + 35, source.y + 12);
      await page.mouse.down();
      // Hold past the hover-open threshold: a pending timer must not interrupt selection.
      await page.waitForTimeout(500);
      assert.equal(await page.getByRole('dialog', { name: '正文批注', exact: true }).isVisible(), false,
        'Holding the mouse to select text must cancel pending hover');
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.mouse.move(source.x + 40, source.y + 12);
      await page.locator('.annotation-note-text').waitFor();
      assert.equal(await page.getByRole('textbox', { name: '编辑正文批注', exact: true }).count(), 0);
      await page.screenshot({ path: `test-results/annotation-read-${theme}-${width}.png`, animations: 'disabled' });
      const hoverPanel = await page.getByRole('dialog', { name: '正文批注', exact: true }).boundingBox();
      await page.mouse.move(hoverPanel.x + 15, hoverPanel.y + 15, { steps: 8 });
      assert.equal(await page.locator('.annotation-note-text').isVisible(), true);
      await page.mouse.move(width - 2, 790);
      await page.getByRole('dialog', { name: '正文批注', exact: true }).waitFor({ state: 'hidden' });
      await footnote.focus();
      await footnote.press('Enter');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '编辑批注');
      await page.keyboard.press('Escape');
      assert.equal(await footnote.evaluate(element => element === document.activeElement), true,
        'Escape returns keyboard focus to the footnote');
      await footnote.click();
      await page.mouse.move(width - 2, 790);
      assert.equal(await page.getByRole('dialog', { name: '正文批注', exact: true }).isVisible(), true);
      await page.getByRole('button', { name: '编辑批注', exact: true }).click();
      const inline = page.getByRole('textbox', { name: '编辑正文批注', exact: true });
      await inline.fill('');
      assert.equal(await inline.isVisible(), true, 'Clearing a note must not dismiss its editor');
      await inline.fill('先确认项目，然后导入。');
      await inline.waitFor({ state: 'visible' });
      const panelBounds = await page.getByRole('dialog', { name: '正文批注', exact: true }).boundingBox();
      assert.ok(panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= width);
      assert.ok(panelBounds.y >= 0 && panelBounds.y + panelBounds.height <= 800);
      await page.screenshot({ path: `test-results/annotation-inline-${theme}-${width}.png`, animations: 'disabled' });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '查看批注', exact: true }).click();
      const saved = page.getByRole('textbox', { name: '批注 1 内容' });
      assert.equal(await saved.inputValue(), '先确认项目，然后导入。');
      await saved.fill('请先让我确认目标项目，再执行导入。');
      await page.waitForFunction(() => CSS.highlights.get('quote-annotation-focus')?.size === 1);
      await page.screenshot({ path: `test-results/annotation-preview-${theme}-${width}.png` });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => CSS.highlights.get('quote-annotation-focus')?.size === 0);
      await page.getByRole('textbox', { name: '消息', exact: true }).fill('另外两点保持不变。');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      assert.deepEqual(errors, []);
      assert.equal(await page.locator('.sent-quote-annotation > div').textContent(), '请先让我确认目标项目，再执行导入。');
      assert.equal(await page.locator('.quote-chip').count(), 0);
      assert.equal(await page.locator('.annotation-footnote').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `test-results/annotation-sent-${theme}-${width}.png` });
    }
  }
  await page.goto('http://127.0.0.1:5195/tests/fixtures/quote-annotations.html?lang=en');
  await page.locator('.response-text p').first().waitFor();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.response-text p'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.getByRole('button', { name: 'Annotate', exact: true }).click();
  await page.getByRole('textbox', { name: 'Selection annotation' }).fill('Confirm the target first.');
  await page.getByRole('button', { name: 'Add annotation', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  assert.equal(await page.locator('.sent-quote-annotation > div').textContent(), 'Confirm the target first.');
  const excerpts = [
    '导入前展示目标目录与会话数量，用户确认后再开始。目录失效时保留会话，不自动创建空目',
    '录与会话数量，用户确认后再开始。目录失效时保留会话，不自动创建空目录。\n\n预览只负责查看原始记录。选择会话和执行导入仍然是',
  ];
  const recovered = excerpts.map((text, index) => ({
    id: `recovered-${index}`, messageIndex: 0, role: 'assistant', text, markdown: text,
    startOffset: 0, endOffset: text.length, annotation: `批注 ${index + 1}`,
  }));
  await page.goto(`http://127.0.0.1:5195/tests/fixtures/quote-annotations.html?draft=${encodeURIComponent(JSON.stringify(recovered))}`);
  await page.getByRole('button', { name: '查看批注 1', exact: true }).waitFor();
  await page.getByRole('button', { name: '查看批注 2', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '查看批注 2', exact: true }).waitFor();
  await page.getByRole('button', { name: '查看批注 2', exact: true }).click();
  await page.getByRole('button', { name: '编辑批注', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '编辑正文批注', exact: true }).inputValue(), '批注 2');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '清空批注', exact: true }).click();
  assert.equal(await page.locator('.annotation-footnote').count(), 0);
  const plain = { ...recovered[0], id: 'plain', annotation: undefined };
  await page.goto(`http://127.0.0.1:5195/tests/fixtures/quote-annotations.html?draft=${encodeURIComponent(JSON.stringify([plain, ...recovered]))}`);
  await page.getByRole('button', { name: '查看引用', exact: true }).click();
  const quotePanel = page.getByRole('dialog', { name: '引用预览', exact: true });
  await quotePanel.waitFor();
  assert.equal(await quotePanel.locator('.composer-quote').count(), 1);
  assert.equal(await quotePanel.locator('textarea').count(), 0, 'Plain quotes never display annotation editors');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看批注', exact: true }).click();
  const notesPanel = page.getByRole('dialog', { name: '批注预览', exact: true });
  await notesPanel.waitFor();
  assert.equal(await notesPanel.locator('.composer-quote').count(), 2);
  await page.getByRole('button', { name: '查看批注 1', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '批注 1 内容', exact: true }).fill('');
  assert.equal(await notesPanel.locator('.composer-quote').count(), 2, 'Editing an empty annotation keeps it in its own group');
  await page.getByRole('textbox', { name: '批注 1 内容', exact: true }).fill('独立批注');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '清空引用', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '查看引用', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '查看批注', exact: true }).textContent(), '2 条批注');
  await page.getByRole('button', { name: '查看批注 1', exact: true }).click();
  await page.getByRole('button', { name: '移除批注', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '查看引用', exact: true }).count(), 0, 'Removing a note must not create a plain quote');
  await page.getByRole('button', { name: '清空批注', exact: true }).click();
  await page.goto('http://127.0.0.1:5195/tests/fixtures/quote-annotations.html?long=1');
  await page.locator('.response-text p').nth(1).waitFor();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelectorAll('.response-text p')[1]);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.getByRole('button', { name: '批注', exact: true }).click();
  await page.getByRole('textbox', { name: '选段批注', exact: true }).fill('这条批注跨越多个屏幕。');
  await page.getByRole('button', { name: '添加批注', exact: true }).click();
  await page.getByRole('button', { name: '查看批注 1', exact: true }).waitFor();
  await page.getByRole('button', { name: '查看批注 1', exact: true }).click();
  await page.locator('.annotation-note-text').waitFor();
  assert.equal(await page.locator('.annotation-note-text').textContent(), '这条批注跨越多个屏幕。');
  await page.locator('.conversation').evaluate(element => { element.scrollTop = 400; });
  await page.getByRole('button', { name: '查看批注 1', exact: true }).waitFor();
  assert.equal(await page.locator('.annotation-note-text').isVisible(), true, 'A partly visible long excerpt retains its note while scrolling');
  assert.deepEqual(errors, []);
  console.log('Annotation fixture passed: selection, highlight, edit, send, Chinese/English, light/dark, desktop/narrow.');
} finally {
  await browser.close();
}
