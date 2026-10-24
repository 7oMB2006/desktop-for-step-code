import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

await mkdir('test-results', { recursive: true });
let preview;
let browser;
try {
  if (!process.env.DESKTOP_PREVIEW_URL) {
    preview = await createServer({ server: { host: '127.0.0.1', port: 0 } });
    await preview.listen();
  }
  const base = process.env.DESKTOP_PREVIEW_URL ?? preview.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `${base}/tests/fixtures/performance-matrix.html`;
  async function assertTextTreatment() {
    const ratios = await page.locator('.working-label').evaluate(label => {
      const context = document.createElement('canvas').getContext('2d');
      const rgba = color => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      const luminance = rgb => rgb.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const style = getComputedStyle(label);
      const bg = rgba(getComputedStyle(document.documentElement).getPropertyValue('--bg'));
      const background = luminance(bg);
      if (document.documentElement.dataset.theme === 'light') {
        const expected = [[158, 114, 251], [213, 143, 239], [253, 179, 162], [255, 220, 98]];
        const palette = ['purple', 'pink', 'coral', 'gold'].map(name => rgba(style.getPropertyValue(`--pulse-${name}`)).slice(0, 3));
        if (JSON.stringify(palette) !== JSON.stringify(expected)) throw new Error('Light theme must preserve original brand colors');
        if (parseFloat(style.webkitTextStrokeWidth) !== 0) throw new Error('Light brand text must not have a dark outline');
        if (style.textShadow !== 'none') throw new Error('Light brand text must not have a shadow');
        // Pale brand fills on white preserve visual fidelity, not 4.5:1 contrast.
        return null;
      }
      return ['purple', 'pink', 'coral', 'gold'].map(name => {
        const color = rgba(style.getPropertyValue(`--pulse-${name}`));
        const opacity = .9 * .94;
        const foreground = luminance(color.map((value, i) => value * opacity + bg[i] * (1 - opacity)));
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      });
    });
    if (ratios !== null) assert.ok(ratios.every(ratio => ratio >= 4.5), `dark fill must retain contrast at minimum breathing opacity: ${ratios}`);
  }
  await page.goto(url);
  await page.locator('.matrix-pulse').waitFor();
  await assertTextTreatment();
  const labelMotion = await page.locator('.working-text').evaluate(async label => {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const style = getComputedStyle(label);
      samples.push({ position: style.backgroundPosition, opacity: Number(style.opacity), box: label.getBoundingClientRect().toJSON() });
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    return samples;
  });
  assert.notEqual(labelMotion[0].position, labelMotion[1].position, 'brand gradient must flow');
  assert.notEqual(labelMotion[0].opacity, labelMotion[1].opacity, 'status text must breathe subtly');
  assert.deepEqual(labelMotion[0].box, labelMotion[1].box, 'text motion cannot move or resize the label');
  assert.equal(await page.locator('.working-elapsed').evaluate(el => getComputedStyle(el).animationName), 'none', 'duration shares parent flow rather than a separate animation');
  assert.equal(await page.locator('.working-text > .working-elapsed').count(), 1, 'label and duration share a single gradient surface');
  assert.equal(await page.locator('.performance-summary').evaluate(el => getComputedStyle(el).animationName), 'none', 'bottom performance strip remains neutral');
  assert.equal(await page.locator('.performance-metric').count(), 4);
  assert.match(await page.locator('.performance-metric').nth(1).innerText(), /48 tok\/s/);
  assert.equal(await page.locator('.matrix-executing .matrix-pixel').count(), 9);
  const frames = await page.locator('.matrix-executing').evaluate(async el => {
    const frames = [];
    for (let step = 0; step < 4; step++) {
      frames.push([...el.querySelectorAll('rect')].map(pixel => Number(getComputedStyle(pixel).opacity)));
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    return frames;
  });
  assert.notDeepEqual(frames[0], frames[1], 'pixels must move rather than remain static');
  assert.deepEqual(frames.map(frame => frame[4]), [1, 1, 1, 1], 'center pixel anchors the orbit');
  await page.screenshot({ path: 'test-results/performance-matrix-running-dark.png' });
  await page.locator('.working').screenshot({ path: 'test-results/matrix-running-detail.png' });
  const initialTime = await page.locator('.working-elapsed').innerText();
  assert.match(initialTime, /^总耗时 /, 'pulse reports total run duration, not phase duration');
  await page.waitForFunction(initial => document.querySelector('.working-elapsed').textContent !== initial, initialTime);
  const iconBox = await page.locator('.matrix-pulse').boundingBox();
  await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.waitForTimeout(80);
  const crossfade = await page.locator('.matrix-pulse').evaluate(el => ({
    incoming: Number(getComputedStyle(el.querySelector('.matrix-thinking')).opacity),
    outgoing: Number(getComputedStyle(el.querySelector('.matrix-executing')).opacity),
    easing: getComputedStyle(el.querySelector('.matrix-thinking')).transitionTimingFunction,
  }));
  assert.ok(crossfade.incoming > 0 && crossfade.incoming < 1 && crossfade.outgoing > 0 && crossfade.outgoing < 1, 'mode change must crossfade rather than jump');
  assert.match(crossfade.easing, /cubic-bezier/);
  assert.equal(await page.locator('.matrix-thinking .matrix-orbit-pixel').first().evaluate(el => getComputedStyle(el).animationDuration), '4.8s');
  await page.waitForTimeout(350);
  assert.deepEqual(await page.locator('.matrix-pulse').boundingBox(), iconBox, 'mode changes must preserve icon geometry');
  await page.screenshot({ path: 'test-results/performance-matrix-thinking-dark.png' });
  await page.getByRole('button', { name: '等待', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.matrix-pulse').getAttribute('data-mode'), 'waiting');
  assert.ok(await page.locator('.matrix-pulse').evaluate(el => [...el.querySelectorAll('.matrix-pixel, .matrix-orbit-pixel')].every(pixel => getComputedStyle(pixel).animationPlayState === 'paused')), 'waiting pauses both pixel animations');
  assert.equal(await page.locator('.matrix-waiting.is-active rect').count(), 6);
  assert.deepEqual(await page.locator('.matrix-waiting rect').evaluateAll(pixels => pixels.map(pixel => Number(pixel.getAttribute('x')))), [0, 12, 0, 12, 0, 12], 'pause uses the two outer matrix columns');
  const breathing = await page.locator('.matrix-waiting-breath').evaluate(async el => {
    const samples = [];
    for (let i = 0; i < 4; i++) {
      samples.push(Number(getComputedStyle(el).opacity));
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    return samples;
  });
  assert.ok(Math.max(...breathing) - Math.min(...breathing) > .15, 'waiting matrix must breathe');
  assert.deepEqual(await page.locator('.matrix-pulse').boundingBox(), iconBox, 'breathing preserves icon geometry');
  await page.screenshot({ path: 'test-results/performance-matrix-waiting-dark.png' });
  await page.getByRole('button', { name: '等待响应', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.matrix-responding rect').count(), 5);
  const responseTiming = await page.locator('.matrix-response-pixel').evaluateAll(pixels => pixels.map(pixel => getComputedStyle(pixel).animationDelay));
  assert.deepEqual(responseTiming, ['0s', '0.45s', '0.45s', '0.45s', '0.45s'], 'center leads the four arms');
  const responseFrames = await page.locator('.matrix-responding').evaluate(async el => {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      samples.push([...el.querySelectorAll('rect')].map(pixel => Number(getComputedStyle(pixel).opacity)));
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    return samples;
  });
  assert.notDeepEqual(responseFrames[0], responseFrames[1], 'response star must radiate');
  await page.screenshot({ path: 'test-results/performance-matrix-responding-dark.png' });
  await page.getByRole('button', { name: '压缩', exact: true }).click();
  await page.waitForTimeout(350);
  const compressionFrames = await page.locator('.matrix-compacting').evaluate(el => {
    const pixels = [...el.querySelectorAll('rect')];
    const animations = pixels.map(pixel => pixel.getAnimations()[0]);
    animations.forEach(animation => animation.pause());
    return [0, 800, 1600, 2400].map(time => {
      animations.forEach(animation => { animation.currentTime = time; });
      return pixels.flatMap((pixel, index) => Number(getComputedStyle(pixel).opacity) > .9 ? [index + 1] : []);
    });
  });
  assert.deepEqual(compressionFrames, [[1, 2, 3, 5], [4, 5, 6, 8], [7, 8, 9], [2]], 'compression follows the requested falling sequence');
  await page.locator('.matrix-compression-pixel').evaluateAll(pixels => pixels.forEach(pixel => { const animation = pixel.getAnimations()[0]; animation.currentTime = 0; animation.play(); }));
  assert.deepEqual(await page.locator('.matrix-pulse').boundingBox(), iconBox);
  await page.screenshot({ path: 'test-results/performance-matrix-compacting-dark.png' });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  assert.equal(await page.locator('.working-indicator').count(), 0);
  const completedStats = await page.locator('.performance-summary').innerText();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.performance-summary').innerText(), completedStats);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  const token = page.locator('.performance-metric').nth(2);
  await token.focus();
  await page.getByRole('tooltip').waitFor();
  assert.match(await page.getByRole('tooltip').innerText(), /输入 \/ 输出/);
  await page.setViewportSize({ width: 600, height: 740 });
  await page.goto(`${url}?theme=light&lang=en`);
  await page.locator('.matrix-pulse').waitFor();
  await assertTextTreatment();
  assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  const row = await page.locator('.performance-summary').evaluate(el => {
    const items = [...el.children].map(child => child.getBoundingClientRect());
    return { tops: items.map(item => item.top), left: items[0].left, right: items.at(-1).right, center: (el.getBoundingClientRect().left + el.getBoundingClientRect().right) / 2 };
  });
  assert.equal(new Set(row.tops).size, 1, 'normal narrow statistics stay on one row');
  assert.ok(Math.abs((row.left + row.right) / 2 - row.center) < 2);
  await page.screenshot({ path: 'test-results/performance-matrix-narrow-light.png' });
  await page.locator('.working').screenshot({ path: 'test-results/matrix-running-detail-light.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.matrix-pixel').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.matrix-waiting-breath').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.matrix-response-pixel').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.matrix-compression-pixel').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.working-text').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ forcedColors: 'active' });
  const forcedStyle = await page.locator('.working-text').evaluate(el => {
    const style = getComputedStyle(el);
    return { fill: style.webkitTextFillColor, image: style.backgroundImage };
  });
  assert.notEqual(forcedStyle.fill, 'rgba(0, 0, 0, 0)');
  assert.equal(forcedStyle.image, 'none');
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
  for (const language of ['zh', 'en']) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const [ms, compact, chinese] of [
        [59999, '59s', '59秒'],
        [60000, '1m 0s', '1分 0秒'],
        [3599999, '59m 59s', '59分 59秒'],
        [3600000, '1h 0m 0s', '1小时 0分 0秒'],
        [14421000, '4h 0m 21s', '4小时 0分 21秒'],
        [86400000, '24h 0m 0s', '24小时 0分 0秒'],
      ]) {
        await page.goto(`${url}?theme=${theme}&lang=${language}&elapsedMs=${ms}&frozen=1`);
        assert.equal(await page.locator('.working-elapsed').innerText(), language === 'zh' ? `总耗时 ${chinese}` : `Total ${compact}`);
        assert.equal(await page.locator('.performance-metric strong').first().innerText(), compact);
        assert.ok(await page.locator('.working-elapsed').evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth;
        }), `running duration must stay visible: ${theme}/${language}/${compact}`);
        await page.getByRole('button', { name: language === 'zh' ? '完成' : 'Finish', exact: true }).click();
        assert.equal(await page.locator('.elapsed-total').innerText(), `${language === 'zh' ? '共耗时' : 'Total'} ${compact}`);
        assert.equal(await page.locator('.performance-metric strong').first().innerText(), compact);
        assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        for (const selector of ['.elapsed-total', '.performance-metric:first-child']) {
          assert.ok(await page.locator(selector).evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth;
          }), `${selector} must stay visible: ${theme}/${language}/${compact}`);
        }
      }
      await page.screenshot({ path: `test-results/elapsed-duration-${theme}-${language}-narrow.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log('Performance/matrix: centered metrics, execution flow, slow thinking orbit, cubic mode crossfade, gradient pause, elapsed clock, completion, tooltips, narrow layout and reduced motion passed.');
} finally {
  if (browser) await browser.close();
  if (preview) await preview.close();
}
