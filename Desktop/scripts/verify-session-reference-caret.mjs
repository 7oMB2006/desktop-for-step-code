import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:4197';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const reference = 'stepcode-desktop://sessions/components';
try {
  for (const [theme, viewport] of [
    ['original-light', { width: 1280, height: 820 }],
    ['original-dark', { width: 640, height: 540 }],
    ['plugin:stellar-cruise', { width: 1280, height: 820 }],
  ]) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(theme => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
      JSON.stringify({ theme, themeMotion: false })), theme);
    await page.goto(`${base}/tests/fixtures/theme-pack.html?view=chat`);
    await page.addStyleTag({ content: '.composer-input { caret-color: #ff00ff; caret-animation: manual; }' });
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    const label = input.locator('.session-reference-label');
    const position = () => input.evaluate(element => [element.selectionStart, element.selectionEnd]);
    const value = () => input.evaluate(element => element.value);
    const paste = text => input.evaluate((element, text) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    }, text);
    const checkCaret = async (offset, edge) => {
      await page.waitForFunction(offset => {
        const element = document.activeElement;
        return element?.matches('.composer-input')
          && element.selectionStart === offset && element.selectionEnd === offset;
      }, offset);
      const expectedX = await input.evaluate((element, edge) => {
        const label = element.querySelector('.session-reference-label');
        const bounds = element.getBoundingClientRect();
        return label.getBoundingClientRect()[edge] - bounds.left;
      }, edge);
      // A focused editor and a correct model offset can still paint no caret.
      const countPixels = async () => page.evaluate(async ({ png, x }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const left = Math.max(0, Math.floor(x) - 2);
        const width = Math.min(5, canvas.width - left);
        const { data } = ctx.getImageData(left, 0, width, canvas.height);
        let pixels = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] >= 220 && data[i + 1] < 35 && data[i + 2] >= 220) pixels++;
        }
        return pixels;
      }, { png: (await input.screenshot({ caret: 'initial' })).toString('base64'), x: expectedX });
      let count = 0;
      for (let attempt = 0; attempt < 4 && count < 8; attempt++) {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        count = await countPixels();
      }
      assert.ok(count >= 8, `${theme}: visible caret at ${edge} of mapped title`);
    };

    await input.click();
    await paste(reference);
    await label.waitFor();
    assert.equal(await value(), reference);
    await checkCaret(reference.length, 'right');
    await page.keyboard.press('Home');
    await checkCaret(0, 'left');
    await page.keyboard.press('End');
    await checkCaret(reference.length, 'right');
    await page.keyboard.press('ArrowLeft');
    await label.waitFor({ state: 'detached' });
    assert.deepEqual(await position(), [reference.length - 1, reference.length - 1]);
    await page.keyboard.press('ArrowRight');
    await label.waitFor();
    await checkCaret(reference.length, 'right');

    await page.keyboard.type(' next');
    assert.equal(await value(), `${reference} next`);
    await input.evaluate((element, offset) => element.setSelectionRange(offset, offset), reference.length);
    await page.keyboard.press('Backspace');
    assert.equal(await value(), ' next', 'Backspace still removes the complete mapped reference');
    await page.keyboard.press('ControlOrMeta+Z');
    assert.equal(await value(), `${reference} next`, 'Undo restores the original reference');
    await page.keyboard.press('ControlOrMeta+A');
    const copied = await input.evaluate(element => {
      const transfer = new DataTransfer();
      element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer }));
      return transfer.getData('text/plain');
    });
    assert.equal(copied, `${reference} next`, 'Copy still exports the canonical source, not the displayed title');
    await input.fill('');
    await paste(`First line\n${reference}`);
    await label.waitFor();
    await checkCaret(`First line\n${reference}`.length, 'right');
    await page.close();
  }
  console.log('Mapped session reference caret, navigation, input, deletion and undo passed in light, narrow dark and Stellar.');
} finally {
  await browser.close();
}
