import { _electron as electron } from 'playwright';
import { sampleMotion } from './sample-motion.mjs';
import { settleLayout } from './settle-layout.mjs';
import { build } from 'esbuild';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const outputs = await build({ entryPoints: ['tests/fixtures/model-effort-harness.tsx'], bundle: true, write: false, outdir: 'test-results', platform: 'browser', format: 'iife', jsx: 'automatic' });
const js = outputs.outputFiles.find(file => file.path.endsWith('.js'))?.text;
const css = outputs.outputFiles.find(file => file.path.endsWith('.css'))?.text;
assert.ok(js && css);
const profile = await mkdtemp(join(tmpdir(), 'step-fader-'));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [resolve('.')], env });
try {
  const pagePromise = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }) => {
    const window = new BrowserWindow({ width: 640, height: 520, show: false, focusable: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.setOpacity(0);
    if (window.getOpacity() !== 0) throw new Error('Transparent acceptance window is unavailable');
    window.setIgnoreMouseEvents(true);
    await window.loadURL('about:blank');
    window.showInactive();
  });
  const page = await pagePromise;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused())), false);
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: `${css}\nbody { height: 100vh; display: flex; align-items: flex-end; justify-content: center; } .test-composer { width: min(500px, calc(100vw - 36px)); display: flex; justify-content: flex-end; padding-right: 30px; margin-bottom: 45px; }` });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.addScriptTag({ content: js });
  await page.getByRole('button', { name: '模型与思考强度' }).click();
  const dialog = page.getByRole('dialog', { name: '模型与思考强度' });
  const slider = dialog.getByRole('slider', { name: '思考强度' });
  const recordFaderMotion = async (interact, label) => {
    await page.evaluate(() => {
      const frames = [];
      window.faderMotionFrames = frames;
      window.faderMotionSampling = true;
      const sample = () => {
        if (window.faderMotionFrames !== frames) return;
        const thumb = document.querySelector('.model-effort-fader-thumb').getBoundingClientRect();
        const fill = document.querySelector('.model-effort-fader-fill').getBoundingClientRect();
        frames.push({ thumb: thumb.y + thumb.height / 2, fill: fill.y });
        if (window.faderMotionSampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await interact();
    await page.waitForTimeout(300);
    const frames = await page.evaluate(() => {
      window.faderMotionSampling = false;
      return window.faderMotionFrames;
    });
    assert.ok(frames.length >= 3, `${label}: should sample motion, not just endpoints`);
    const centers = frames.map(frame => frame.thumb);
    assert.ok(Math.max(...centers) - Math.min(...centers) > 1, `${label}: must exercise visible movement`);
    assert.ok(new Set(centers.map(center => center.toFixed(2))).size > 3, `${label}: motion must have intermediate positions, not jump`);
    const drift = Math.max(...frames.map(frame => Math.abs(frame.thumb - frame.fill)));
    assert.ok(drift <= 1, `${label}: fill must follow the thumb center on every frame, drift ${drift.toFixed(2)}px`);
    console.log(`${label}: ${frames.length} frames, max fill/thumb drift ${drift.toFixed(2)}px`);
  };
  // Capture this component's CSS keyframes in the same DOM commit as the
  // keyboard change, before an IPC round trip can consume their 380ms lifetime.
  const sampleHeadingThreshold = async interact => {
    await page.evaluate(() => {
      const stage = document.querySelector('.model-effort-heading-level-stage');
      const previous = document.querySelector('.model-effort-heading-level-current');
      let resolveResult, observer, timer, finished = false;
      const result = new Promise(resolve => { resolveResult = resolve; });
      const finish = outcome => {
        if (finished) return;
        finished = true; observer.disconnect(); clearTimeout(timer); resolveResult(outcome);
      };
      window.effortHeadingSample = { result, cancel: () => finish({ error: 'Heading change did not complete' }) };
      observer = new MutationObserver(() => {
        const incoming = stage.querySelector('.model-effort-heading-level-entering');
        if (!incoming || incoming === previous) return;
        const captured = [];
        try {
          for (const [selector, name] of [
            ['.model-effort-heading-level-entering', 'model-effort-level-in'],
            ['.model-effort-heading-level-outgoing', 'model-effort-level-out'],
          ]) {
            const element = stage.querySelector(selector);
            if (!element) throw new Error(`Missing heading ${selector}`);
            getComputedStyle(element).transform;
            const animation = element.getAnimations().find(animation => animation instanceof CSSAnimation
              && animation.animationName === name && animation.effect?.target === element);
            const timing = animation?.effect.getTiming();
            if (!animation || animation.playState !== 'running' || timing.duration !== 380)
              throw new Error(`Missing running 380ms ${name} animation`);
            captured.push({ animation, currentTime: animation.currentTime, name, duration: timing.duration });
          }
          for (const { animation, duration } of captured) {
            animation.pause(); animation.currentTime = duration * .48;
          }
          finish({ value: new DOMMatrix(getComputedStyle(incoming).transform).m41,
            animations: captured.map(({ name, duration }) => ({ name, duration })) });
        } catch (error) {
          finish({ error: error.message });
        } finally {
          // Restore the real timeline before the product's 380ms retention timer.
          for (const { animation, currentTime } of captured) {
            animation.currentTime = currentTime; animation.play();
          }
        }
      });
      timer = setTimeout(() => finish({ error: 'Heading animation did not commit' }), 5000);
      observer.observe(stage, { subtree: true, childList: true, attributes: true });
    });
    try {
      await interact();
      const outcome = await page.evaluate(() => window.effortHeadingSample.result);
      if (outcome.error) throw new Error(outcome.error);
      console.log('Model effort heading threshold:', JSON.stringify(outcome));
      return outcome.value;
    } finally {
      await page.evaluate(() => { window.effortHeadingSample.cancel(); delete window.effortHeadingSample; });
    }
  };
  await slider.waitFor();
  const box = await slider.boundingBox();
  assert.ok(box);
  const step = await slider.locator('.model-effort-fader-travel').evaluate(element => element.getBoundingClientRect().height / 6);
  const x = box.x + box.width / 2;
  const startY = box.y + box.height - 19 - step * 2;
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/model-effort-fader.png' });
  assert.equal(await dialog.locator('.model-effort-heading-level-current').textContent(), '轻度');
  assert.equal(await dialog.locator('.model-effort-heading > svg').count(), 0, 'Model area should not have a disclosure arrow');
  assert.equal(await dialog.locator('[data-provider-brand="step"] svg rect').count(), 5);
  assert.match(await dialog.locator('[data-provider-brand="step"]').evaluate(e => getComputedStyle(e).maskImage), /linear-gradient/);
  await dialog.screenshot({ path: 'test-results/model-provider-step-dark.png' });
  await dialog.getByRole('button', { name: '选择模型' }).click();
  await dialog.locator('.model-picker-select').filter({ hasText: 'Custom Model' }).click();
  await page.waitForTimeout(350);
  assert.equal(await dialog.locator('[data-provider-brand="custom"] svg').count(), 1);
  await dialog.screenshot({ path: 'test-results/model-provider-custom-dark.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await dialog.screenshot({ path: 'test-results/model-provider-custom-light.png' });
  await dialog.getByRole('button', { name: '选择模型' }).click();
  await dialog.locator('.model-picker-select').filter({ has: page.getByText('step-5-preview', { exact: true }) }).click();
  await page.waitForTimeout(350);
  await dialog.screenshot({ path: 'test-results/model-provider-step-light.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  assert.match(await dialog.locator('.model-effort-preview-capacity').textContent(), /128K/);
  assert.equal(await dialog.locator('.model-effort-preview-modalities svg').count(), 2);
  await page.screenshot({ path: 'test-results/model-effort-preview-dark.png' });
  await dialog.getByRole('button', { name: '模型参数', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await dialog.getByRole('slider').count(), 0, 'Parameters cover the fader accessibly');
  assert.match(await dialog.locator('.model-parameters-modalities').textContent(), /文本.*图片/);
  assert.match(await dialog.locator('.model-parameters-values').textContent(), /128,000.*16,384/);
  await page.screenshot({ path: 'test-results/model-effort-parameters-dark.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.screenshot({ path: 'test-results/model-effort-parameters-light.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await dialog.getByRole('button', { name: '模型参数', exact: true }).click();
  await settleLayout(dialog);
  assert.equal(await dialog.locator('.model-effort-effort-panel').evaluate(e => getComputedStyle(e).transform), 'matrix(1, 0, 0, 1, 0, 0)');
  assert.match(await dialog.locator('.model-effort-fader-fill').evaluate(element => getComputedStyle(element).backgroundImage), /linear-gradient/);
  assert.equal(await dialog.locator('.model-effort-fader-thumb').textContent(), '');
  const darkLabelColor = await dialog.locator('.model-effort-heading-level-current')
    .evaluate(element => getComputedStyle(element).color);
  assert.equal(darkLabelColor, 'rgb(253, 179, 162)');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.waitForTimeout(220);
  assert.equal(await dialog.locator('.model-effort-heading-level-current')
    .evaluate(element => getComputedStyle(element).color), darkLabelColor);
  assert.equal(await dialog.locator('.model-effort-fader-thumb')
    .evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-results/model-effort-light.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(220);
  const effortBounds = await dialog.boundingBox();
  const modelReveal = await sampleMotion(page, {
    label: 'model picker panel reveal', state: { selector: '.model-effort-popover.models-view' },
    targets: [{ name: 'models', selector: '.model-effort-models-panel', properties: ['clip-path', 'transform'] }],
    duration: 320, easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
  }, () => dialog.getByRole('button', { name: '选择模型' }).click());
  assert.equal(await dialog.getByRole('slider').count(), 0, 'The covered effort panel must not be accessible');
  assert.equal(await dialog.getByRole('group', { name: '模型', exact: true }).count(), 1);
  const midReveal = modelReveal.frames[2].models.clipPath;
  assert.match(midReveal, /inset\(0px 0px [1-9]/, 'The model panel should reveal from top to bottom');
  await page.screenshot({ path: 'test-results/model-effort-models-transition.png' });
  await settleLayout(dialog);
  assert.equal(await dialog.locator('.model-effort-models-panel').evaluate(element => getComputedStyle(element).clipPath), 'inset(0px)');
  const modelBack = dialog.getByRole('button', { name: '返回思考强度', exact: true });
  const toolbarGeometry = await dialog.locator('.model-picker-toolbar').evaluate(toolbar => {
    const back = toolbar.querySelector('.model-picker-back').getBoundingClientRect();
    const search = toolbar.querySelector('.model-picker-search').getBoundingClientRect();
    return { sameRow: Math.abs(back.y + back.height / 2 - search.y - search.height / 2) <= 1,
      separateControls: back.right <= search.left,
      height: toolbar.getBoundingClientRect().height,
      listHeight: toolbar.nextElementSibling.clientHeight };
  });
  assert.equal(toolbarGeometry.sameRow && toolbarGeometry.separateControls, true, 'back and search share one row without overlapping');
  assert.ok(toolbarGeometry.height <= 40 && toolbarGeometry.listHeight >= 190,
    `the merged header returns space to the fixed-size model list: ${JSON.stringify(toolbarGeometry)}`);
  await dialog.getByRole('searchbox', { name: '搜索模型', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await modelBack.evaluate(button => button === document.activeElement), true);
  const backFocus = await modelBack.evaluate(button => {
    const control = button.getBoundingClientRect();
    const clip = button.closest('.model-effort-models-panel').getBoundingClientRect();
    const style = getComputedStyle(button);
    const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    return { outlined: style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) > 0,
      inside: control.left - extent >= clip.left && control.right + extent <= clip.right
        && control.top - extent >= clip.top && control.bottom + extent <= clip.bottom };
  });
  assert.deepEqual(backFocus, { outlined: true, inside: true }, 'the compact back button retains its complete keyboard focus indicator');
  await page.screenshot({ path: 'test-results/model-effort-models.png' });
  await modelBack.press('Enter');
  await settleLayout(dialog);
  assert.equal(await dialog.getByRole('slider').count(), 1);
  assert.equal(await dialog.getByRole('button', { name: '选择模型', exact: true }).evaluate(button => button === document.activeElement), true,
    'returning from the model list restores focus to the model heading');
  assert.equal(await dialog.getByRole('group', { name: '模型', exact: true }).count(), 0, 'The hidden model panel must not be accessible');
  assert.deepEqual(await dialog.boundingBox(), effortBounds, 'Switching views must not move or resize the popover');
  await page.mouse.click(x, box.y + 20);
  assert.equal(await slider.getAttribute('aria-valuenow'), '2', 'Clicking the rail must not jump');
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await recordFaderMotion(async () => {
    await page.mouse.move(x, startY - step * .4, { steps: 8 });
  }, 'Sub-threshold drag');
  assert.equal(await slider.getAttribute('aria-valuenow'), '2');
  const pressure = await slider.evaluate(element => element.style.getPropertyValue('--effort-fader-pressure'));
  assert.notEqual(pressure, '0', 'Sub-threshold drag should visibly compress the thumb');
  await page.screenshot({ path: 'test-results/model-effort-pressure.png' });
  assert.deepEqual(await page.evaluate(() => window.effortCalls), []);
  await page.mouse.move(x, startY - step * .8, { steps: 8 });
  assert.equal(await slider.getAttribute('aria-valuenow'), '3');
  assert.equal(await dialog.locator('.model-effort-heading-level-current').textContent(), '中');
  assert.match(await dialog.locator('.model-effort-heading-level-current').evaluate(element => getComputedStyle(element).animationName), /model-effort-level-in/);
  assert.deepEqual(await page.evaluate(() => window.effortCalls), [], 'Drag should submit only on release');
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.effortCalls), ['medium']);
  assert.equal(await dialog.locator('.model-effort-heading-level-current').textContent(), '中');
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => window.effortCalls.includes('high'));
  assert.equal(await slider.getAttribute('aria-valuetext'), '高');
  await slider.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => window.effortCalls.at(-1) === 'medium');
  assert.equal(await slider.getAttribute('aria-valuenow'), '3');
  await slider.press('End');
  await page.waitForTimeout(420);
  const well = await dialog.locator('.model-effort-fader-well').boundingBox();
  const thumb = await dialog.locator('.model-effort-fader-thumb').boundingBox();
  const fill = await dialog.locator('.model-effort-fader-fill').boundingBox();
  assert.ok(well && thumb && fill);
  assert.ok(thumb.x <= well.x && thumb.x + thumb.width >= well.x + well.width, 'Thumb must cover the well edge to edge');
  assert.ok(thumb.y <= well.y && thumb.y + thumb.height >= fill.y, 'Full capacity must disappear beneath the top thumb');
  assert.equal(await dialog.locator('.model-effort-heading-level-outgoing').count(), 0, 'Old level must leave after the animation');
  assert.equal(await slider.locator('.model-effort-fader-pixel').count(), 9);
  assert.match(await slider.locator('.model-effort-fader-fill').evaluate(element => getComputedStyle(element, '::before').animationName), /model-effort-current/);
  const flowingWell = dialog.locator('.model-effort-fader-well');
  const firstFrame = await flowingWell.screenshot();
  await page.waitForTimeout(500);
  const nextFrame = await flowingWell.screenshot();
  assert.ok(!firstFrame.equals(nextFrame), 'The max-level pool should keep flowing');
  await page.screenshot({ path: 'test-results/model-effort-full.png' });
  await page.screenshot({ path: 'test-results/model-effort-flow.png' });
  const peak = await sampleHeadingThreshold(() => slider.press('ArrowDown'));
  assert.equal(await slider.locator('.model-effort-fader-pixel').count(), 0);
  assert.equal(await slider.evaluate(element => element.classList.contains('is-max')), false);
  assert.ok(Math.abs(peak + 12.8) < .5, `A lower level should hit the left threshold, got ${peak}px`);
  await page.screenshot({ path: 'test-results/model-effort-threshold.png' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/model-effort-transition.png' });
  assert.equal(await dialog.locator('.model-effort-heading-level-current').textContent(), '极高');
  await dialog.locator('.model-effort-heading-level-outgoing').waitFor({ state: 'detached' });
  assert.equal(await dialog.locator('.model-effort-heading-level-outgoing').count(), 0);
  const risingPeak = await sampleHeadingThreshold(() => slider.press('ArrowUp'));
  assert.ok(Math.abs(risingPeak - 12.8) < .5, `A higher level should hit the right threshold, got ${risingPeak}px`);
  await settleLayout(dialog);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await slider.press('Home');
    await page.waitForTimeout(250);
    const bottomThumb = await slider.locator('.model-effort-fader-thumb').boundingBox();
    const origin = bottomThumb.y + bottomThumb.height / 2;
    const callsBefore = await page.evaluate(() => window.effortCalls.length);
    await recordFaderMotion(async () => {
      await page.mouse.move(x, origin);
      await page.mouse.down();
      await page.mouse.move(x, origin - step * 4.8, { steps: 12 });
      await page.mouse.move(x, origin - step * 1.4, { steps: 10 });
      assert.equal(await slider.getAttribute('aria-valuenow'), '1');
      assert.equal(await page.evaluate(() => window.effortCalls.length), callsBefore, 'Crossing and reversing must not submit while dragging');
      await page.mouse.up();
    }, `${theme}: multi-stop drag, reversal and release`);
    assert.equal(await page.evaluate(() => window.effortCalls.length), callsBefore + 1, 'Release must commit exactly once');
    assert.equal(await slider.getAttribute('aria-valuetext'), '极简');
    await recordFaderMotion(async () => {
      const handle = await slider.locator('.model-effort-fader-thumb').boundingBox();
      await page.mouse.move(x, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, handle.y + handle.height / 2 - step * 3, { steps: 8 });
      await slider.dispatchEvent('pointercancel', { pointerId: 1 });
      await page.mouse.up();
    }, `${theme}: cancelled drag returns to committed level`);
    assert.equal(await slider.getAttribute('aria-valuetext'), '极简');
    assert.equal(await page.evaluate(() => window.effortCalls.length), callsBefore + 1, 'Cancel must not commit a preview');
    await recordFaderMotion(async () => {
      await slider.press('End');
    }, `${theme}: keyboard full-range jump`);
    await recordFaderMotion(async () => {
      await page.mouse.move(x, box.y + box.height / 2);
      await page.mouse.wheel(0, 100);
      await page.waitForFunction(() => document.querySelector('[role=slider]').getAttribute('aria-valuenow') === '5');
    }, `${theme}: wheel step`);
    await page.screenshot({ path: `test-results/model-effort-synced-${theme}.png` });
  }
  await slider.press('End');
  await page.waitForTimeout(250);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await slider.evaluate(element => getComputedStyle(element).transitionDuration), '0s', 'Reduced motion must disable the shared transition');
  assert.equal(await slider.locator('.model-effort-fader-pixel').first().evaluate(element => getComputedStyle(element).display), 'none');
  assert.equal(await slider.locator('.model-effort-fader-fill').evaluate(element => getComputedStyle(element, '::before').animationName), 'none');
  await slider.press('ArrowDown');
  assert.equal(await dialog.locator('.model-effort-heading-level-current').textContent(), '极高');
  assert.equal(await dialog.locator('.model-effort-heading-level-current').evaluate(element => getComputedStyle(element).animationName), 'none');
  const rect = await dialog.boundingBox();
  assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= await page.evaluate(() => innerWidth));
  await dialog.getByRole('button', { name: '选择模型', exact: true }).click();
  const favoriteGroup = dialog.getByRole('group', { name: '已收藏', exact: true });
  const otherGroup = dialog.getByRole('group', { name: '其他模型', exact: true });
  const modelButtons = dialog.locator('.model-picker-select');
  const starFor = name => dialog.locator('.model-picker-row').filter({ has: page.getByText(name, { exact: true }) }).locator('.model-picker-star');
  assert.equal(await favoriteGroup.count(), 0, 'selecting a model never creates a favorite');
  assert.equal(await dialog.locator('.model-picker-section').count(), 0, 'no empty favorite heading is reserved');
  assert.equal(await modelButtons.count(), 3);
  const callsBeforeFavorites = await page.evaluate(() => ({ models: window.modelCalls, efforts: window.effortCalls }));
  await starFor('step-4').hover();
  await page.getByRole('tooltip').filter({ hasText: '收藏模型' }).waitFor();
  await starFor('step-4').click();
  await favoriteGroup.waitFor();
  assert.equal(await starFor('step-4').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.activeElement?.classList.contains('model-picker-star')
    && document.activeElement.closest('.model-picker-row')?.textContent.includes('step-4'));
  assert.deepEqual(await dialog.boundingBox(), rect, 'favoriting must not resize the compact picker');
  const search = dialog.getByRole('searchbox', { name: '搜索模型', exact: true });
  await search.fill('CUSTOM provider');
  assert.equal(await modelButtons.count(), 1, 'search matches provider terms without duplicates');
  assert.equal(await favoriteGroup.count(), 0);
  await starFor('Custom Model').click();
  await page.waitForFunction(() => document.querySelector('.model-picker-star')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await search.inputValue(), 'CUSTOM provider', 'favoriting search results retains the query');
  assert.equal(await modelButtons.count(), 1);
  assert.equal(await dialog.count(), 1, 'the independent star button never selects or closes');
  assert.deepEqual(await page.evaluate(() => ({ models: window.modelCalls, efforts: window.effortCalls })), callsBeforeFavorites,
    'favorite controls must not invoke model or effort selection');
  assert.equal(await dialog.locator('.model-picker-star').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await search.focus();
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    for (const key of ['ArrowDown', 'Escape']) {
      await search.dispatchEvent('keydown', { key, ...composition });
      assert.equal(await dialog.count(), 1, 'IME candidate keys must not dismiss the model picker');
      assert.equal(await search.evaluate(element => element === document.activeElement), true, 'IME candidate keys must retain search focus');
      assert.equal(await search.inputValue(), 'CUSTOM provider');
    }
  }
  await search.press('ArrowDown');
  assert.equal(await modelButtons.evaluate(element => element === document.activeElement), true);
  await search.fill('missing model');
  await dialog.getByRole('status').filter({ hasText: '没有匹配的模型' }).waitFor();
  await dialog.getByRole('button', { name: '清空搜索', exact: true }).click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await search.evaluate(element => element === document.activeElement), true);
  assert.equal(await favoriteGroup.locator('.model-picker-select').count(), 2);
  assert.equal(await otherGroup.locator('.model-picker-select').count(), 1);
  assert.equal(await modelButtons.count(), 3, 'favorites do not repeat in the other group');
  assert.equal(await dialog.locator('.model-picker-list').evaluate(element => element.scrollHeight <= element.clientHeight), true,
    'three compact rows and their headings must not create a redundant scrollbar');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.screenshot({ path: `test-results/model-favorites-${theme}.png` });
  }
  await search.press('ArrowDown');
  const firstOption = modelButtons.first();
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    await firstOption.dispatchEvent('keydown', { key: 'ArrowDown', ...composition });
    assert.equal(await firstOption.evaluate(element => element === document.activeElement), true, 'Composing keys must not navigate the list');
  }
  await page.keyboard.press('End');
  assert.equal(await modelButtons.last().evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await modelButtons.first().evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await starFor('step-4').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await starFor('Custom Model').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await favoriteGroup.locator('.model-picker-select').last().evaluate(element => element === document.activeElement), true);
  await search.focus();
  const focusGeometry = await search.evaluate(input => {
    const field = input.parentElement.getBoundingClientRect();
    const panel = input.closest('.model-effort-models-panel').getBoundingClientRect();
    const style = getComputedStyle(input.parentElement);
    const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    return { focused: input === document.activeElement, outlined: style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) > 0,
      visible: field.left - extent >= panel.left && field.right + extent <= panel.right
      && field.top - extent >= panel.top && field.bottom + extent <= panel.bottom, extent };
  });
  assert.equal(focusGeometry.focused && focusGeometry.outlined, true, 'measure the rendered focus indicator, not the unfocused field');
  assert.ok(focusGeometry.extent > 0 && focusGeometry.extent <= 4, `Visible outline stays within the 4px gutter: ${JSON.stringify(focusGeometry)}`);
  assert.equal(focusGeometry.visible, true, 'search focus indicator fits within the animated panel');
  await page.evaluate(() => window.modelPickerFixture.configure({ favoriteFailure: true }));
  await starFor('step-5-preview').click();
  await dialog.getByRole('alert').filter({ hasText: '收藏未保存' }).waitFor();
  assert.equal(await starFor('step-5-preview').getAttribute('aria-pressed'), 'false', 'a failed save must not claim a favorite');
  assert.equal(await modelButtons.count(), 3);
  await page.evaluate(() => window.modelPickerFixture.configure({ favoriteFailure: false }));
  await starFor('step-5-preview').click();
  await page.waitForFunction(() => document.querySelectorAll('.model-picker-star[aria-pressed=true]').length === 3);
  assert.equal(await dialog.getByRole('alert').count(), 0, 'retry clears the failure');
  await starFor('step-4').click();
  await page.waitForFunction(() => document.querySelectorAll('.model-picker-star[aria-pressed=true]').length === 2);
  assert.equal(await otherGroup.locator('.model-picker-select').count(), 1, 'unfavorite returns a model to the available list exactly once');
  await page.evaluate(() => window.modelPickerFixture.configure({ favorites: [] }));
  await favoriteGroup.waitFor({ state: 'hidden' });
  assert.equal(await dialog.locator('.model-picker-section').count(), 0);
  assert.equal(await modelButtons.count(), 3);
  await page.evaluate(() => window.modelPickerFixture.configure({
    models: Array.from({ length: 24 }, (_, index) => ({ provider: 'fixture', id: String(index), name: `Model ${index}` })),
    favorites: [{ provider: 'fixture', id: '0' }],
  }));
  await search.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  const lastStarBounds = await dialog.locator('.model-picker-star').last().evaluate(button => {
    const control = button.getBoundingClientRect();
    const clip = button.closest('.model-picker-list').getBoundingClientRect();
    const style = getComputedStyle(button);
    const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    return { focused: document.activeElement === button,
      outlined: style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) > 0,
      inside: control.left - extent >= clip.left && control.right + extent <= clip.right
        && control.top - extent >= clip.top && control.bottom + extent <= clip.bottom };
  });
  assert.deepEqual(lastStarBounds, { focused: true, outlined: true, inside: true }, 'scrolled last-row star keeps all four focus sides visible');
  assert.deepEqual(await dialog.boundingBox(), rect, 'a long catalog scrolls internally without growing the compact picker');
  await page.evaluate(() => window.modelPickerFixture.configure({
    models: [
      { provider: 'step', id: 'shared', name: 'A long model name that must not resize its picker', providerName: 'Step' },
      { provider: 'custom', id: 'shared', name: 'A long model name that must not resize its picker', providerName: 'A long custom provider name' },
    ],
    favorites: [{ provider: 'missing', id: 'shared' }, { provider: 'custom', id: 'shared' }],
  }));
  assert.equal(await favoriteGroup.locator('.model-picker-select').count(), 1, 'unavailable favorite is hidden');
  assert.equal(await otherGroup.locator('.model-picker-select').count(), 1, 'same ID from another provider stays separate');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().at(-1).setSize(380, 620));
    await search.focus();
    const overflow = await dialog.evaluate(element => ({
      width: element.scrollWidth > element.clientWidth,
      rows: [...element.querySelectorAll('.model-picker-row')].some(row => row.scrollWidth > row.clientWidth),
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    }));
    assert.equal(overflow.width, false);
    assert.equal(overflow.rows, false);
    assert.ok(overflow.left >= 0 && overflow.right <= 380, JSON.stringify(overflow));
    await page.screenshot({ path: `test-results/model-favorites-narrow-${theme}.png` });
  }
  await page.evaluate(() => window.modelPickerFixture.configure({ language: 'en' }));
  await page.getByRole('searchbox', { name: 'Search models', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Back to thinking level', exact: true }).count(), 1);
  assert.equal(await page.getByRole('group', { name: 'Favorites', exact: true }).count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: 'Model and thinking level' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Model and thinking level', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.setViewportSize({ width: 640, height: 600 });
  await page.evaluate(() => window.modelPickerFixture.configure({ language: 'zh', models: [
    { id: 'ultra', name: 'Ultra Preview', provider: 'desktop-custom-fixture', input: ['text', 'image'], contextWindow: 200000,
      thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    { id: 'ordinary', name: 'Ordinary Model', provider: 'fixture' },
  ] }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '模型与思考强度' }).click();
  await dialog.getByRole('button', { name: '选择模型', exact: true }).click();
  await dialog.locator('.model-picker-select').filter({ hasText: 'Ultra Preview' }).click();
  await settleLayout(dialog);
  assert.equal(await slider.getAttribute('aria-valuemax'), '7');
  await slider.press('End');
  await page.waitForTimeout(420);
  assert.equal(await page.evaluate(() => window.effortCalls.at(-1)), 'ultra', 'Ultra keeps an independent raw identity');
  assert.equal(await slider.getAttribute('aria-valuetext'), 'Ultra');
  assert.equal(await dialog.locator('.model-effort-fader-tick').count(), 8);
  assert.equal(await dialog.locator('.model-effort-heading-level-current').evaluate(e => e.style.getPropertyValue('--effort-color')), '#9E72FB');
  const ultraText = dialog.locator('.model-effort-heading-level-current .model-effort-ultra-text');
  const triggerText = page.locator('.model-effort-trigger .model-effort-ultra-text');
  for (const text of [ultraText, triggerText]) {
    assert.equal(await text.textContent(), 'Ultra');
    assert.equal(await text.evaluate(e => getComputedStyle(e).fontStyle), 'italic');
    assert.equal(await text.evaluate(e => getComputedStyle(e).animationName), 'model-effort-ultra-flow');
    assert.equal(await text.evaluate(e => getComputedStyle(e).animationDuration), '1.8s');
  }
  const ultraFrame = await ultraText.screenshot();
  await page.waitForTimeout(600);
  assert.ok(!ultraFrame.equals(await ultraText.screenshot()), 'Ultra gradient visibly flows');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.waitForTimeout(250);
    await recordFaderMotion(() => slider.press('Home'), `${theme}: Ultra full-range down`);
    await recordFaderMotion(() => slider.press('End'), `${theme}: Ultra full-range up`);
    await page.waitForTimeout(420);
    const minContrast = await ultraText.evaluate(element => {
      const context = document.createElement('canvas').getContext('2d');
      const luminance = color => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
          const value = channel / 255;
          return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const background = luminance(getComputedStyle(element.closest('button')).backgroundColor);
      return Math.min(...['--ultra-ink', '--ultra-shine', '--ultra-core'].map(variable => {
        const foreground = luminance(getComputedStyle(element).getPropertyValue(variable));
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      }));
    });
    assert.ok(minContrast >= 4.5, `${theme}: Ultra text contrast ${minContrast}`);
    await page.screenshot({ path: `test-results/model-effort-ultra-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 600 });
  const narrowUltra = await dialog.boundingBox();
  assert.ok(narrowUltra.x >= 0 && narrowUltra.y >= 0 && narrowUltra.x + narrowUltra.width <= 390);
  await page.screenshot({ path: 'test-results/model-effort-ultra-narrow.png' });
  for (const media of [{ reducedMotion: 'reduce' }, { reducedMotion: 'no-preference', forcedColors: 'active' }]) {
    await page.emulateMedia(media);
    for (const text of [ultraText, triggerText]) {
      assert.equal(await text.evaluate(e => getComputedStyle(e).animationName), 'none');
      assert.equal(await text.evaluate(e => getComputedStyle(e).backgroundImage), 'none');
      assert.notEqual(await text.evaluate(e => getComputedStyle(e).webkitTextFillColor), 'rgba(0, 0, 0, 0)');
    }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
  await slider.press('ArrowDown');
  await page.waitForTimeout(420);
  assert.equal(await slider.getAttribute('aria-valuetext'), '最高');
  assert.equal(await dialog.locator('.model-effort-ultra-text').count(), 0);
  await slider.press('End');
  await dialog.getByRole('button', { name: '选择模型', exact: true }).click();
  await dialog.locator('.model-picker-select').filter({ hasText: 'Ordinary Model' }).click();
  await page.waitForTimeout(420);
  assert.equal(await slider.getAttribute('aria-valuemax'), '6', 'Ordinary models retain seven stops');
  assert.equal(await page.locator('.model-effort-ultra-text').count(), 0);
  console.log('Ultra passed: independent identity, purple endpoint, italic flow, contrast, themes, narrow layout, shared fader motion and accessibility fallbacks.');
  console.log('Fader acceptance passed: no click jump, resisted drag, release commit, wheel and keyboard.');
  console.log('Model picker passed: explicit favorites, no automatic collection or model selection, search, failed save and retry, provider identity, availability, keyboard focus, IME guards, focus bounds, narrow themes and English.');
} finally {
  await app.close();
}
