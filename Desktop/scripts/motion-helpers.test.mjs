import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { sampleMotion } from './sample-motion.mjs';
import { captureWaapi } from './capture-waapi.mjs';

// Browser regressions stay outside the protocol-only tests/*.test.ts inventory.
// Run after installing the test browser: node --test scripts/motion-helpers.test.mjs
const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(run, extra = '') {
  const page = await browser.newPage();
  try {
    await page.setContent(`<style>
      #target { width: 100px; height: 20px; position: relative;
        transition: width 120ms ${easing}; }
      #target.open { width: 300px; }
      #target::before { content: ''; position: absolute; width: 100px; height: 20px;
        transform: translateX(0); transition: transform 120ms ${easing}; }
      #target.open::before { transform: translateX(-100px); }
      ${extra}
    </style><div id="target"><span id="child"></span></div>`);
    await run(page);
  } finally { await page.close(); }
}

const options = (extra = {}) => ({
  label: 'motion helper regression',
  state: { selector: '#target.open' },
  targets: [{ name: 'target', selector: '#target', properties: ['width'] }],
  duration: 120, easing, timeoutMs: 500, ...extra,
});
const changeState = page => page.locator('#target').evaluate(element => element.classList.add('open'));
const animate = (page, frames = [{ translate: '-100px' }, { translate: '0px' }], timing = { duration: 120, easing }) =>
  page.locator('#target').evaluate((element, { frames, timing }) => {
    globalThis.nativeAnimation = element.animate(frames, timing);
  }, { frames, timing });
const cleanCss = page => page.evaluate(() => globalThis.desktopMotionSamples.size);
const cleanWaapi = page => page.evaluate(() => globalThis.desktopWaapiSamples.size);

test('CSS sampling survives action latency, samples real geometry and restores native playback', { timeout: 10000 }, async () => {
  await fixture(async page => {
    let restored;
    const result = await sampleMotion(page, options(), async () => {
      // This observer runs after the helper's observer in the same mutation
      // delivery. A separate protocol read could itself outlast the effect.
      restored = await page.locator('#target').evaluate(element => new Promise(resolve => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve(element.getAnimations().some(animation => animation.playState === 'running'));
        });
        observer.observe(element, { attributes: true });
        element.classList.add('open');
      }));
      // Longer than the complete 120ms effect: a late sampler would miss it.
      await page.waitForTimeout(300);
    });
    assert.equal(restored, true);
    assert.equal(result.before.target.width, 100);
    assert.equal(result.frames[0].target.width, 100);
    assert.equal(result.frames.at(-1).target.width, 300);
    assert.ok(result.frames.slice(1, -1).every(frame => frame.target.width > 100 && frame.target.width < 300));
    await page.locator('#target').evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
    });
    assert.equal(await page.locator('#target').evaluate(element => element.getBoundingClientRect().width), 300);
    assert.equal(await cleanCss(page), 0);
  });
});

test('CSS sampling captures host and exact pseudo-element effects together', async () => {
  await fixture(async page => {
    const result = await sampleMotion(page, options({ targets: [{ name: 'target', selector: '#target',
      properties: ['width'], pseudoProperties: { '::before': ['transform'] }, pseudoElements: ['::before'] }] }), () => changeState(page));
    assert.ok(result.transitions.some(effect => effect.property === 'width' && !effect.pseudoElement));
    assert.ok(result.transitions.some(effect => effect.property === 'transform' && effect.pseudoElement === '::before'));
    for (const frame of result.frames.slice(1, -1)) {
      assert.ok(frame.target.pseudo['::before'].transformMatrixX < 0);
      assert.ok(frame.target.pseudo['::before'].transformMatrixX > -100);
    }
    await page.locator('#target').evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
    });
    assert.equal(await cleanCss(page), 0);
  });
});

for (const [label, css] of [
  ['missing', '#target { transition: none; }'],
  ['zero duration', '#target { transition-duration: 0ms; }'],
  ['constant width', '#target.open { width: 100px; }'],
]) test(`CSS sampling rejects ${label} required motion`, async () => {
  await fixture(async page => {
    await assert.rejects(sampleMotion(page, options(), () => changeState(page)), /Missing target width transition/);
    assert.equal(await cleanCss(page), 0);
  }, css);
});

test('CSS sampling rejects paused native motion without starting it', async () => {
  await fixture(async page => {
    // Register before the helper observer, as a product-owned pause would be.
    await page.evaluate(() => {
      const element = document.querySelector('#target');
      const observer = new MutationObserver(() => {
        for (const animation of element.getAnimations()) animation.pause();
        observer.disconnect();
      });
      observer.observe(element, { attributes: true });
    });
    await assert.rejects(sampleMotion(page, options(), () => changeState(page)), /Motion must be finite and running/);
    assert.equal(await page.locator('#target').evaluate(element => element.getAnimations()[0].playState), 'paused');
    assert.equal(await cleanCss(page), 0);
  });
});

test('CSS host requirement cannot be satisfied by a pseudo-element transition', async () => {
  await fixture(async page => {
    await assert.rejects(sampleMotion(page, options({
      targets: [{ name: 'target', selector: '#target', properties: ['transform'] }],
    }), () => changeState(page)), /Missing target transform transition/);
  });
});

test('CSS pseudo requirement cannot be satisfied by host or different-pseudo motion', async () => {
  await fixture(async page => {
    await assert.rejects(sampleMotion(page, options({ targets: [{ name: 'target', selector: '#target',
      pseudoProperties: { '::after': ['transform'] } }] }), () => changeState(page)), /Missing target::after transform transition/);
  }, `#target { transform: translateX(0); transition: transform 120ms ${easing}; }
      #target.open { transform: translateX(-100px); }`);
});

test('CSS host requirement cannot be satisfied by a descendant transition', async () => {
  await fixture(async page => {
    await assert.rejects(sampleMotion(page, options(), () => changeState(page)), /Missing target width transition/);
  }, `#target { transition: none; } #child { display: block; width: 10px; transition: width 120ms ${easing}; }
      #target.open #child { width: 40px; }`);
});

test('CSS absent state is bounded and removes the pending sample', async () => {
  await fixture(async page => {
    await assert.rejects(sampleMotion(page, options(), async () => {}), /motion state did not change/);
    assert.equal(await cleanCss(page), 0);
  });
});

test('WAAPI capture holds the actual effect through delayed action and restores the hook', { timeout: 10000 }, async () => {
  await fixture(async page => {
    const original = await page.evaluateHandle(() => Element.prototype.animate);
    const animation = await captureWaapi(page, page.locator('#target'), async () => {
      await animate(page);
      await page.waitForTimeout(300);
    });
    try {
      const result = await animation.evaluate(effect => {
        const timing = effect.effect.getTiming();
        return { native: effect === globalThis.nativeAnimation, state: effect.playState,
          duration: timing.duration, easing: timing.easing,
          values: [0, .25, .5, 1].map(progress => {
            effect.currentTime = progress * timing.duration;
            const translate = getComputedStyle(effect.effect.target).translate;
            return translate === 'none' ? 0 : parseFloat(translate);
          }) };
      });
      assert.equal(result.native, true);
      assert.equal(result.state, 'paused');
      assert.equal(result.duration, 120);
      assert.equal(result.easing, easing);
      assert.equal(result.values[0], -100);
      assert.equal(result.values.at(-1), 0);
      assert.ok(result.values.slice(1, -1).every(value => value > -100 && value < 0));
      assert.equal(await page.evaluate(handle => Element.prototype.animate === handle, original), true);
      assert.equal(await cleanWaapi(page), 0);
    } finally {
      await animation.evaluate(async effect => { effect.currentTime = 0; effect.play(); await effect.finished; });
      await animation.dispose(); await original.dispose();
    }
  });
});

test('WAAPI zero duration is rejected without leaving the hook installed', async () => {
  await fixture(async page => {
    const original = await page.evaluateHandle(() => Element.prototype.animate);
    try {
      await assert.rejects(captureWaapi(page, '#target', () => animate(page, undefined, { duration: 0 })), /Expected a finite running WAAPI effect/);
      assert.equal(await page.evaluate(handle => Element.prototype.animate === handle, original), true);
      assert.equal(await cleanWaapi(page), 0);
    } finally { await original.dispose(); }
  });
});

test('WAAPI pre-paused native effect is rejected without starting it', async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = original.apply(this, args);
        animation.pause();
        return animation;
      };
    });
    await assert.rejects(captureWaapi(page, '#target', () => animate(page)), /Expected a finite running WAAPI effect/);
    assert.equal(await page.evaluate(() => globalThis.nativeAnimation.playState), 'paused');
    assert.equal(await cleanWaapi(page), 0);
  });
});

test('WAAPI absent effect is bounded and restores the hook', { timeout: 15000 }, async () => {
  await fixture(async page => {
    const original = await page.evaluateHandle(() => Element.prototype.animate);
    try {
      await assert.rejects(captureWaapi(page, '#target', async () => {}), /Missing WAAPI effect/);
      assert.equal(await page.evaluate(handle => Element.prototype.animate === handle, original), true);
      assert.equal(await cleanWaapi(page), 0);
    } finally { await original.dispose(); }
  });
});

test('WAAPI action failure resumes a held native effect and restores the hook', async () => {
  await fixture(async page => {
    const original = await page.evaluateHandle(() => Element.prototype.animate);
    try {
      await assert.rejects(captureWaapi(page, '#target', async () => {
        await animate(page, undefined, { duration: 10000, easing });
        throw new Error('action failed control');
      }), /action failed control/);
      assert.equal(await page.evaluate(() => globalThis.nativeAnimation.playState), 'running');
      assert.equal(await page.evaluate(handle => Element.prototype.animate === handle, original), true);
      assert.equal(await cleanWaapi(page), 0);
    } finally { await original.dispose(); }
  });
});
