import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, _electron as electron } from 'playwright';
import { mkdtemp } from './test-profile.mjs';

const output = resolve(process.argv[2] || 'test-results/stellar-effort');
const diagnose = process.argv.includes('--diagnose');
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(join(output, 'fixture-'));
const bundle = await build({
  stdin: { contents: `
    import './tests/fixtures/model-effort-harness.tsx';
    import './src/stellar-workspace.css';
    import './src/stellar-records.css';
    import './src/stellar-chrome.css';
    import './src/stellar-controls.css';
  `, resolveDir: resolve('.'), loader: 'tsx' },
  bundle: true, write: false, outdir: fixture, platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const main = join(fixture, 'main.cjs');
await build({
  stdin: { contents: `
    const { app, BrowserWindow } = require('electron');
    app.setPath('userData', process.env.STELLAR_EFFORT_PROFILE);
    app.whenReady().then(() => {
      const window = new BrowserWindow({ width: 640, height: 520, show: false, focusable: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      window.setOpacity(0);
      if (window.getOpacity() !== 0) throw new Error('Transparent acceptance window is unavailable');
      window.setIgnoreMouseEvents(true);
      window.loadURL('about:blank').then(() => window.showInactive());
    });
    app.on('window-all-closed', () => app.quit());
  `, resolveDir: resolve('.'), loader: 'js' },
  bundle: true, outfile: main, platform: 'node', format: 'cjs', external: ['electron'],
});
const errors = [], results = [];
let browser, native, currentPage;
const env = { ...process.env, STELLAR_EFFORT_PROFILE: join(fixture, 'profile') };
delete env.ELECTRON_RUN_AS_NODE;

async function run(page, engine) {
  currentPage = page;
  page.on('pageerror', error => errors.push(`${engine}: ${error.message}`));
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: `${css}
    body { height: 100vh; display: flex; align-items: flex-end; justify-content: center; }
    .test-composer { width: min(500px, calc(100vw - 36px)); display: flex; justify-content: flex-end; margin-bottom: 45px; }
  ` });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.themeMaterial = 'stellar';
    document.documentElement.dataset.stellarMotion = 'true';
  });
  await page.addScriptTag({ content: js });
  const trigger = page.getByRole('button', { name: '模型与思考强度', exact: true });
  const dialog = page.getByRole('dialog', { name: '模型与思考强度', exact: true });
  const slider = page.getByRole('slider', { name: '思考强度', exact: true });
  await trigger.click();
  await page.waitForTimeout(400);
  const dimensions = () => dialog.evaluate(el => {
    const size = e => [e.offsetWidth, e.offsetHeight];
    return { panel: size(el), slider: size(el.querySelector('[role=slider]')),
      thumb: size(el.querySelector('.model-effort-fader-thumb')) };
  });
  const original = await dimensions();
  assert.deepEqual(original, { panel: [370, 258], slider: [82, 228], thumb: [78, 38] });
  const shot = name => dialog.screenshot({ path: join(output, `${engine}-${name}.png`) });

  // Freeze the real CSS transitions at known times, including the hidden back face.
  const flip = async (direction, reverseAt) => {
    await page.evaluate(() => {
      const popup = document.querySelector('.model-effort-popover');
      window.effortTransitions = null;
      const observer = new MutationObserver(() => {
        getComputedStyle(popup.querySelector('.model-effort-effort-panel')).transform;
        window.effortTransitions = popup.getAnimations({ subtree: true });
        window.effortTransitions.forEach(a => { a.pause(); a.currentTime = 0; });
        observer.disconnect();
      });
      observer.observe(popup, { attributes: true, attributeFilter: ['class'] });
    });
    await page.locator(direction === 'forward' ? '.model-effort-details-space'
      : '.model-effort-parameters-panel .model-effort-back').evaluate(e => e.click());
    await page.waitForFunction(() => window.effortTransitions !== null);
    const frames = [];
    for (const time of reverseAt ? [reverseAt] : [0, 60, 150, 190, 270, 339]) {
      await page.evaluate(time => window.effortTransitions.forEach(a => { a.currentTime = time; }), time);
      const faces = await page.locator('.model-effort-effort-panel, .model-effort-parameters-panel').evaluateAll(es =>
        es.map(e => ({ face: e.className, visible: getComputedStyle(e).visibility,
          front: new DOMMatrix(getComputedStyle(e.parentElement).transform)
            .multiply(new DOMMatrix(getComputedStyle(e).transform)).m33 >= 0 })));
      await shot(`${direction}-${time}`);
      // Removing a back-facing panel must not change the visible artwork.
      const before = await dialog.screenshot();
      await page.evaluate(() => {
        for (const e of document.querySelectorAll('.model-effort-effort-panel, .model-effort-parameters-panel'))
          if (new DOMMatrix(getComputedStyle(e.parentElement).transform)
            .multiply(new DOMMatrix(getComputedStyle(e).transform)).m33 < 0) e.style.opacity = '0';
      });
      const after = await dialog.screenshot();
      const difference = await page.evaluate(async ([first, second]) => {
        const pixels = async bytes => {
          const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
          const canvas = document.createElement('canvas');
          canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
          return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const a = await pixels(first), b = await pixels(second);
        let changed = 0, largest = 0;
        for (let i = 0; i < a.length; i += 4) {
          const delta = Math.max(...[0, 1, 2, 3].map(c => Math.abs(a[i + c] - b[i + c])));
          // Ignore low-amplitude subpixel AA when changing compositor layers.
          if (delta > 16) changed++;
          largest = Math.max(largest, delta);
        }
        return { changed, largest };
      }, [[...before], [...after]]);
      const same = difference.changed === 0;
      if (!same) {
        await writeFile(join(output, `${engine}-${direction}-${time}-before.png`), before);
        await writeFile(join(output, `${engine}-${direction}-${time}-hidden.png`), after);
      }
      await page.evaluate(() => document.querySelectorAll('.model-effort-panel').forEach(e => e.style.removeProperty('opacity')));
      frames.push({ time, faces, backfaceClean: same, difference });
      if (!diagnose) assert.ok(same, `${engine} ${direction} ${time}ms: hidden back face leaked ${JSON.stringify(difference)}`);
    }
    if (!reverseAt) {
      await page.evaluate(() => window.effortTransitions.forEach(a => {
        if (Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish();
      }));
      await page.waitForTimeout(360);
    }
    return frames;
  };
  const forward = await flip('forward');
  const back = await flip('back');
  const reversed = await flip('forward', 100);
  await flip('back');
  await dialog.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.waitForTimeout(360);
  await shot('models');
  const rows = await page.locator('.model-picker-row').evaluateAll(es => es.map(e => {
    const select = e.querySelector('.model-picker-select'), star = e.querySelector('.model-picker-star');
    const box = star.getBoundingClientRect(), row = e.getBoundingClientRect();
    return { height: row.height, starHeight: box.height, starWidth: box.width,
      centered: Math.abs(box.y + box.height / 2 - row.y - row.height / 2) < .5,
      selectShadow: getComputedStyle(select).boxShadow, starShadow: getComputedStyle(star).boxShadow };
  }));
  if (!diagnose) for (const row of rows) {
    assert.equal(row.height, 32); assert.equal(row.starHeight, 26); assert.equal(row.starWidth, 26);
    assert.ok(row.centered); assert.equal(row.selectShadow, 'none'); assert.equal(row.starShadow, 'none');
  }
  const focusFits = async locator => {
    await page.keyboard.press('Tab');
    await locator.focus();
    const value = await locator.evaluate(e => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      const extent = Math.max(0, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
      const clips = [];
      for (let parent = e.parentElement; parent; parent = parent.parentElement) {
        const ps = getComputedStyle(parent), box = parent.getBoundingClientRect();
        const paint = ps.contain.includes('paint');
        if (paint || ps.clipPath !== 'none' || /(auto|hidden|scroll|clip)/.test(ps.overflowX))
          clips.push(r.left - extent >= box.left - .5 && r.right + extent <= box.right + .5);
        if (paint || ps.clipPath !== 'none' || /(auto|hidden|scroll|clip)/.test(ps.overflowY))
          clips.push(r.top - extent >= box.top - .5 && r.bottom + extent <= box.bottom + .5);
      }
      return { focused: e === document.activeElement, outline: parseFloat(s.outlineWidth), clips };
    });
    assert.ok(value.focused && value.outline >= 2 && value.clips.every(Boolean), JSON.stringify(value));
  };
  await focusFits(page.getByRole('searchbox', { name: '搜索模型' }));
  await focusFits(page.locator('.model-picker-star').last());
  await page.locator('.model-picker-select').first().focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.model-picker-star').first().evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Enter');
  await page.getByRole('group', { name: '已收藏', exact: true }).waitFor();
  await page.locator('.model-picker-select').first().click();
  await page.waitForTimeout(400);
  await slider.press('Home');
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.effortFaderFrames = [];
    window.effortFaderRecording = true;
    const record = () => {
      const thumb = document.querySelector('.model-effort-fader-thumb').getBoundingClientRect();
      const fill = document.querySelector('.model-effort-fader-fill').getBoundingClientRect();
      window.effortFaderFrames.push({ thumb: thumb.y + thumb.height / 2, fill: fill.y });
      if (window.effortFaderRecording) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await slider.press('End');
  await page.waitForTimeout(450);
  const motion = await page.evaluate(() => {
    window.effortFaderRecording = false;
    return window.effortFaderFrames;
  });
  assert.ok(new Set(motion.map(frame => frame.thumb.toFixed(2))).size > 3);
  const drift = Math.max(...motion.map(frame => Math.abs(frame.thumb - frame.fill)));
  assert.ok(drift <= 1.1, `fill must follow the thumb: ${drift}px`);
  assert.equal(await slider.getAttribute('aria-valuenow'), '6');
  await page.evaluate(() => document.querySelector('.model-effort-popover').getAnimations({ subtree: true })
    .filter(a => a instanceof CSSAnimation && a.animationName.startsWith('stellar-effort-')).forEach(a => a.play()));
  const well = page.locator('.model-effort-fader-well');
  const sweep = await page.locator('.model-effort-fader-fill').evaluate(e => {
    const animations = e.getAnimations({ subtree: true });
    window.effortSweepSnapshots = animations.map(animation => ({
      animation, time: animation.currentTime, state: animation.playState,
    }));
    animations.forEach(animation => animation.pause());
    const current = animations.find(a =>
      a instanceof CSSAnimation && a.animationName === 'stellar-effort-current');
    current.currentTime = 0;
    return { name: getComputedStyle(e).animationName, duration: getComputedStyle(e).animationDuration,
      size: getComputedStyle(e).backgroundSize.split(',')[1].trim(),
      start: parseFloat(getComputedStyle(e).backgroundPositionY.split(',')[1]) };
  });
  assert.equal(sweep.name, 'stellar-effort-current'); assert.equal(sweep.duration, '3.6s');
  assert.equal(sweep.size, '100% 144px'); assert.equal(sweep.start, -144);
  const bandStart = await well.screenshot({ path: join(output, `${engine}-band-start.png`) });
  sweep.mid = await page.locator('.model-effort-fader-fill').evaluate(e => {
    e.getAnimations().find(a => a instanceof CSSAnimation && a.animationName === 'stellar-effort-current').currentTime = 1800;
    return parseFloat(getComputedStyle(e).backgroundPositionY.split(',')[1]);
  });
  assert.equal(sweep.mid, 36);
  const bandMid = await well.screenshot({ path: join(output, `${engine}-band-mid.png`) });
  assert.ok(!bandStart.equals(bandMid), 'the stellar wave must change actual pixels with all other animation paused');
  sweep.response = await page.evaluate(async ([first, second]) => {
    const pixels = async bytes => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
      return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    };
    const a = await pixels(first), b = await pixels(second);
    const counts = [0, 0], delta = [0, 0];
    for (let y = 44; y < a.height - 5; y++) for (let x = 5; x < a.width - 5; x++) {
      const i = (y * a.width + x) * 4, light = Math.max(...a.data.slice(i, i + 3));
      const group = light < 35 ? 0 : light > 100 ? 1 : -1;
      if (group < 0) continue;
      counts[group]++;
      delta[group] += Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i + c] - b.data[i + c])));
    }
    return { darkDelta: delta[0] / counts[0], starDelta: delta[1] / counts[1] };
  }, [[...bandStart], [...bandMid]]);
  assert.ok(sweep.response.darkDelta < 3, `dark gaps must not become a grey stripe: ${JSON.stringify(sweep.response)}`);
  assert.ok(sweep.response.starDelta > 10 && sweep.response.starDelta > sweep.response.darkDelta * 2,
    `the wave must primarily brighten stars: ${JSON.stringify(sweep.response)}`);
  await page.evaluate(() => window.effortSweepSnapshots.forEach(({ animation, time, state }) => {
    animation.currentTime = time;
    if (state === 'running') animation.play();
  }));
  const starFrame = await well.screenshot();
  await page.waitForTimeout(800);
  assert.ok(!starFrame.equals(await well.screenshot()), 'the star material must actually move');
  const palette = await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e).backgroundImage);
  for (const color of ['255, 220, 98', '253, 179, 162', '213, 143, 239', '158, 114, 251'])
    assert.ok(palette.includes(`rgb(${color})`), `the Stellar fader must keep the shared palette: ${color}`);
  const sharedPalette = await page.locator('.model-effort-fader-fill').evaluate(e =>
    getComputedStyle(e).getPropertyValue('--effort-fader-palette').trim());
  assert.match(palette, /url\("data:image\/png;base64,/);
  assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e).backgroundBlendMode),
    'multiply, screen, normal');
  const seaPixels = await page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0, lit = 0, gold = 0, violet = 0, total = 0;
    for (let y = 44; y < canvas.height - 5; y++) for (let x = 5; x < canvas.width - 5; x++) {
      const i = (y * canvas.width + x) * 4, [r, g, b] = data.slice(i, i + 3);
      const light = Math.max(r, g, b);
      dark += light < 45; lit += light > 100;
      gold += light > 65 && r > b * 1.3 && g > b * 1.1;
      violet += light > 65 && b > r * 1.15 && b > g * 1.15;
      total++;
    }
    return { dark: dark / total, lit: lit / total, gold, violet };
  }, [...bandStart]);
  assert.ok(seaPixels.dark > .4 && seaPixels.dark < .98, 'the sea needs dark spaces between its stars');
  assert.ok(seaPixels.lit > .06, 'the wider tracks must render a bright star field, not sparse dim threads');
  assert.ok(seaPixels.gold > 10 && seaPixels.violet > 10, `the rendered sea must retain both ends of the effort palette: ${JSON.stringify(seaPixels)}`);
  const field = await page.locator('.model-effort-fader-fill').evaluate(async e => {
    const image = new Image();
    image.src = getComputedStyle(e).backgroundImage.match(/url\("([^"]+)"\)/)[1];
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let bands = 0, separated = 0;
    for (let y = 6; y < canvas.height - 6; y += 6) {
      const bright = [];
      // Sample 3 CSS pixels of sparse stars, not a solid one-pixel scanline.
      for (let x = 5; x < canvas.width - 5; x++) for (let dy = 0; dy < 6; dy++) {
        if (data[((y + dy) * canvas.width + x) * 4] > 110) {
          bright.push(x);
          break;
        }
      }
      separated += bright.length > 1 && bright.at(-1) - bright[0] > canvas.width * .2;
      bands++;
    }
    const sides = [0, 0], sidePixels = [0, 0];
    for (let y = 6; y < canvas.height - 6; y++) for (let x = 4; x < canvas.width - 4; x++) {
      const side = x < canvas.width * .14 ? 0 : x > canvas.width * .86 ? 1 : -1;
      if (side < 0) continue;
      sidePixels[side]++;
      sides[side] += data[(y * canvas.width + x) * 4] > 110;
    }
    return { width: image.width, height: image.height, spreadBands: separated / bands,
      edgeStars: sides.map((lit, side) => lit / sidePixels[side]) };
  });
  assert.equal(field.width, 144); assert.equal(field.height, 432);
  assert.ok(field.spreadBands > .6, 'the broad field must not collapse into one thin filament');
  assert.ok(field.edgeStars.every(fraction => fraction > .035), 'visible stars must reach both sides of the inner frame');
  assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e, '::after').animationName),
    'stellar-effort-drift');
  assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e, '::before').animationName),
    'stellar-effort-drift');
  const trails = await page.locator('.model-effort-fader-pixel').evaluateAll(es => es.map(e => {
    const head = getComputedStyle(e), tail = getComputedStyle(e, '::before');
    const animation = e.getAnimations().find(a =>
      a instanceof CSSAnimation && a.animationName === 'stellar-effort-spark');
    const duration = parseFloat(head.animationDuration), time = animation.currentTime, state = animation.playState;
    // Match the cycle phase despite each meteor's negative CSS delay.
    const sampleTime = animation.effect.getTiming().delay + duration * 1250;
    animation.pause(); animation.currentTime = sampleTime;
    const firstY = new DOMMatrix(getComputedStyle(e).transform).m42;
    const peakOpacity = parseFloat(getComputedStyle(e).opacity);
    animation.currentTime = sampleTime + 100;
    const velocity = (new DOMMatrix(getComputedStyle(e).transform).m42 - firstY) * 10;
    animation.currentTime = time;
    if (state === 'running') animation.play();
    return { head: head.display, animation: head.animationName, content: tail.content,
      width: parseFloat(tail.width), height: parseFloat(tail.height), background: tail.backgroundImage,
      bottom: parseFloat(tail.bottom), pointerEvents: tail.pointerEvents, duration, velocity, peakOpacity };
  }));
  assert.equal(trails.length, 9);
  for (const trail of trails) {
    assert.equal(trail.head, 'block'); assert.equal(trail.animation, 'stellar-effort-spark');
    assert.equal(trail.content, '""'); assert.equal(trail.width, 1);
    assert.ok(trail.height >= 10 && trail.height <= 18);
    assert.match(trail.background, /linear-gradient/); assert.equal(trail.bottom, 1);
    assert.equal(trail.pointerEvents, 'none');
    assert.ok(trail.peakOpacity > .9, 'meteor heads must stay brighter than the surrounding dust');
    assert.ok(Math.abs(trail.velocity - 216 / trail.duration) < .1, 'actual meteor motion must follow its duration');
  }
  const fastTrails = trails.filter((_, index) => [1, 4, 7].includes(index));
  const slowTrails = trails.filter((_, index) => ![1, 4, 7].includes(index));
  assert.deepEqual(fastTrails.map(trail => trail.duration), [1.6, 1.85, 2.1]);
  assert.ok(slowTrails.every(trail => trail.duration >= 2.6), 'other meteors keep their original slower pace');
  assert.ok(Math.min(...fastTrails.map(trail => trail.velocity)) >
    Math.max(...slowTrails.map(trail => trail.velocity)) * 1.2, 'three meteors must visibly outrun the rest');
  await page.mouse.move(10, 10);
  await shot('stars-max');
  await slider.press('Home');
  await page.waitForTimeout(250);
  const thumb = await page.locator('.model-effort-fader-thumb').boundingBox();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 - 95, { steps: 15 });
  await page.mouse.up();
  assert.equal(await slider.getAttribute('aria-valuenow'), '3');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e).animationName), 'none',
    'the original light band is reserved for the highest effort');
  await page.mouse.move(10, 10);
  await shot('stars-mid');
  await page.evaluate(() => { document.documentElement.dataset.stellarMotion = 'false'; });
  const staticMaterial = await page.locator('.model-effort-fader-fill').evaluate(e =>
    ['::before', '::after'].map(pseudo => getComputedStyle(e, pseudo).animationName));
  assert.deepEqual(staticMaterial, ['none', 'none']);
  assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e).animationName), 'none');
  await slider.press('End');
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e).animationName), 'none');
  assert.equal(await page.locator('.model-effort-fader-pixel').first().evaluate(e => getComputedStyle(e).display), 'none');
  assert.equal(await page.locator('.model-effort-fader-pixel').first().evaluate(e => getComputedStyle(e, '::before').content), 'none');
  const staticFrame = await well.screenshot();
  await page.waitForTimeout(200);
  assert.ok(staticFrame.equals(await well.screenshot()), 'motion-off keeps a stable star material');
  await page.evaluate(() => { document.documentElement.dataset.stellarMotion = 'true'; });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.model-effort-flip').evaluate(e => getComputedStyle(e).transitionDuration), '0s');
  assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e, '::before').animationName), 'none');
  assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e).animationName), 'none');
  assert.equal(await page.locator('.model-effort-fader-pixel').first().evaluate(e => getComputedStyle(e).display), 'none');
  const reducedFrame = await well.screenshot();
  await page.waitForTimeout(200);
  assert.ok(reducedFrame.equals(await well.screenshot()), 'reduced motion must also stop the trails');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await focusFits(slider);
  await dialog.getByRole('button', { name: '模型参数', exact: true }).click();
  await page.waitForTimeout(400);
  await focusFits(dialog.getByRole('button', { name: '模型参数', exact: true }));
  await page.keyboard.press('Escape');

  for (const width of [390, 760]) {
    await page.setViewportSize({ width, height: 880 });
    await page.locator('.test-composer').evaluate((e, width) => {
      e.style.paddingRight = width === 390 ? '92px' : '';
    }, width);
    await trigger.click();
    await page.waitForTimeout(400);
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + .5);
    await focusFits(slider);
    await dialog.getByRole('button', { name: '选择模型', exact: true }).click();
    await page.waitForTimeout(360);
    await focusFits(page.getByRole('searchbox', { name: '搜索模型' }));
    await focusFits(page.locator('.model-picker-star').last());
    await page.mouse.move(10, 10);
    await shot(`models-${width}`);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 640, height: 520 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => {
      delete document.documentElement.dataset.themeMaterial;
      document.documentElement.dataset.theme = theme;
    }, theme);
    await trigger.click();
    await page.waitForTimeout(400);
    assert.deepEqual(await dimensions(), original);
    assert.match(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e).backgroundImage),
      /rgb\(255, 220, 98\)/, 'built-in themes keep their original gradient');
    assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e =>
      getComputedStyle(e).getPropertyValue('--effort-fader-palette').trim()), sharedPalette,
    'Stellar must reuse the exact shared palette, not a separate approximation');
    assert.doesNotMatch(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e).backgroundImage), /url\(/,
      'built-in themes must not inherit the Stellar grain');
    assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e).animationName), 'none',
      'built-in themes keep their own sweep layer');
    assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e, '::before').animationDuration),
      '3s', 'built-in themes keep their original sweep cadence');
    assert.equal(await page.locator('.model-effort-fader-fill').evaluate(e => getComputedStyle(e, '::before').backgroundSize),
      '100% 94px', 'built-in themes keep their original sweep width');
    assert.equal(await page.locator('.model-effort-fader-pixel').first().evaluate(e => getComputedStyle(e, '::before').content), 'none',
      'built-in themes must not inherit the Stellar trails');
    await dialog.getByRole('button', { name: '模型参数', exact: true }).click();
    await page.waitForTimeout(400);
    await focusFits(dialog.getByRole('button', { name: '模型参数', exact: true }));
    await page.mouse.move(10, 10);
    await shot(`built-in-${theme}`);
    await page.keyboard.press('Escape');
  }
  results.push({ engine, original, forward, back, reversed, rows, maximumFaderDrift: drift,
    faderFrames: motion.length, staticMaterial, sharedPalette, seaPixels, field, sweep, trails });
}
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  await run(await browser.newPage({ viewport: { width: 640, height: 520 } }), 'chrome');
  native = await electron.launch({ args: [main], env });
  await run(await native.firstWindow(), 'electron');
  assert.equal(await native.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(window => window.isFocused())), false);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: !diagnose, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: !diagnose, results, errors }));
} catch (error) {
  await currentPage?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await native?.close();
  await browser?.close();
}
