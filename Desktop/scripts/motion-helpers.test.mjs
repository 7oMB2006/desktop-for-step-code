import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import ts from 'typescript';
import { sampleMotion } from './sample-motion.mjs';
import { captureWaapi } from './capture-waapi.mjs';
import { settleLayout } from './settle-layout.mjs';

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

test('session search acceptance waits for sidebar entrance and still rejects persistent focus clipping', { timeout: 15000 }, async () => {
  // Execute the verifier's own geometry block so a misplaced wait cannot pass.
  const source = ts.createSourceFile('verify-session-search.mjs',
    await readFile(new URL('./verify-session-search.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let statements;
  const visit = node => {
    if (ts.isForOfStatement(node) && ts.isBlock(node.statement)) {
      const body = [...node.statement.statements];
      const focus = body.findIndex(statement => ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'focus'));
      if (focus >= 0) {
        const keyboard = body.findIndex(statement => ts.isExpressionStatement(statement)
          && statement.getText(source) === "await search.press('ArrowRight');");
        assert.ok(keyboard >= 0 && keyboard < focus);
        statements = body.slice(keyboard + 1, focus + 2).map(statement => statement.getText(source)).join('\n');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(statements, 'Exercise the native verifier focus measurement and assertion');
  const inspect = new Function('search', 'settleLayout', 'assert', `return (async () => { ${statements} })();`);
  const css = (await Promise.all(['layout.css', 'scheduled-tasks.css', 'session-search.css']
    .map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');
  for (const width of [1200, 600]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    try {
      await page.setContent(`<style>
        * { box-sizing: border-box; }
        :root { --primary: #267347; }
        body { margin: 0; }
        .app { display: flex; height: 100dvh; overflow: hidden; }
        .sidebar { flex-direction: column; }
        ${css}
      </style><div class="app sidebar-hidden ${width < 760 ? 'sidebar-compact' : ''}">
        <aside class="sidebar"><div class="sidebar-task-actions">
          <div class="sidebar-utility-row" data-search-open="true">
            <div class="sidebar-search-field"><input aria-label="Search sessions"></div>
          </div>
        </div></aside>
      </div>`);
      const search = page.getByRole('textbox', { name: 'Search sessions' });
      const before = await page.locator('.app').evaluate(element => {
        const sidebar = element.querySelector('.sidebar');
        getComputedStyle(sidebar).transform;
        element.classList.remove('sidebar-hidden');
        getComputedStyle(sidebar).transform;
        const effects = sidebar.getAnimations().filter(animation => animation.transitionProperty === 'transform');
        if (effects.length !== 1) throw new Error('The real sidebar entrance must animate');
        effects[0].pause();
        effects[0].currentTime = 0;
        sidebar.querySelector('input').focus({ preventScroll: true });
        return element.querySelector('.sidebar-utility-row').getBoundingClientRect().left;
      });
      assert.ok(before < 0, 'The focus ring is initially outside the clipping viewport');
      let settled = false;
      await inspect(search, async locator => {
        await page.locator('.sidebar').evaluate(element => {
          for (const animation of element.getAnimations()) animation.play();
        });
        await settleLayout(locator);
        settled = true;
      }, assert);
      assert.equal(settled, true, 'Geometry must be measured after the native sidebar animation finishes');
      await page.locator('.sidebar-utility-row').evaluate(element => { element.style.marginLeft = '-20px'; });
      await assert.rejects(inspect(search, settleLayout, assert), error =>
        error instanceof assert.AssertionError && error.actual?.contained === false
        && error.actual?.outline === '2px', 'A genuinely clipped focus ring must still fail after settling');
    } finally { await page.close(); }
  }
});

test('conversation timing acceptance waits for timestamp and parent fades but rejects persistent opacity', { timeout: 15000 }, async () => {
  const source = ts.createSourceFile('verify-conversation-timing.mjs',
    await readFile(new URL('./verify-conversation-timing.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const body = source.statements.find(ts.isTryStatement)?.tryBlock.statements;
  assert.ok(body);
  const hover = body.findIndex(statement =>
    statement.getText(source) === "await page.locator('.assistant-actions').hover();");
  const assertion = body.findIndex((statement, index) => index > hover
    && statement.getText(source).startsWith("assert.equal(await page.locator('.assistant-actions .message-time')")
    && statement.getText(source).endsWith("'1');"));
  assert.ok(hover >= 0 && assertion > hover, 'Exercise the verifier hover and strict final-opacity assertion');
  const statements = body.slice(hover, assertion + 1).map(statement => statement.getText(source)).join('\n');
  assert.ok(statements.includes('await settleLayout('), 'The native verifier must settle before measuring opacity');
  const inspect = new Function('page', 'messageTime', 'settleLayout', 'assert',
    `return (async () => { ${statements} })();`);
  const css = await readFile(new URL('../src/layout.css', import.meta.url), 'utf8');
  for (const heldTarget of ['timestamp', 'parent']) {
    const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
    try {
      await page.setContent(`<style>
        ${css}
        * { box-sizing: border-box; }
        body { margin: 0; }
        .message { width: 500px; margin: 40px 0 0 180px; padding: 20px; }
        .assistant-footer-row { display: flex; }
      </style><article class="message assistant"><div class="assistant-footer-row">
        <div class="message-actions assistant-actions"><button>Copy</button>
          <span class="message-time">12:30</span><span class="elapsed-total">1m 23s</span>
        </div>
      </div></article>`);
      const messageTime = page.locator('.assistant-actions .message-time');
      await page.locator('.assistant-actions').evaluate((element, heldTarget) => {
        const timestamp = element.querySelector('.message-time');
        getComputedStyle(element).opacity;
        getComputedStyle(timestamp).opacity;
        // Capture real :hover transitions before a protocol round trip can
        // outlast them, then hold only the layer under test at a middle frame.
        element.addEventListener('pointerover', () => {
          getComputedStyle(timestamp).opacity;
          const effects = [element, timestamp].map(target => target.getAnimations().find(animation =>
            animation instanceof CSSTransition && animation.transitionProperty === 'opacity'));
          if (effects.some(effect => !effect)) throw new Error('Both real footer opacity transitions must exist');
          const held = effects[heldTarget === 'parent' ? 0 : 1];
          for (const effect of effects) {
            if (effect === held) { effect.pause(); effect.currentTime = 75; }
            else effect.finish();
          }
          globalThis.timingFade = held;
          globalThis.timingFadeTarget = heldTarget === 'parent' ? element : timestamp;
        }, { once: true });
      }, heldTarget);
      let entered;
      const waiting = new Promise(resolve => { entered = resolve; });
      let measured = false;
      const pending = inspect(page, messageTime, async locator => {
        entered();
        await settleLayout(locator);
      }, assert).then(() => { measured = true; return { ok: true }; }, error => ({ error }));
      const started = await Promise.race([waiting.then(() => true), pending.then(() => false)]);
      assert.equal(started, true, 'The native verifier must reach its layout wait');
      const middle = await page.evaluate(() => ({
        opacity: Number(getComputedStyle(globalThis.timingFadeTarget).opacity),
        state: globalThis.timingFade.playState, duration: globalThis.timingFade.effect.getTiming().duration,
      }));
      assert.equal(middle.state, 'paused');
      assert.equal(middle.duration, 150);
      assert.ok(middle.opacity > 0 && middle.opacity < 1, 'The held effect must be a real intermediate fade');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(measured, false, `The ${heldTarget} fade must settle before final opacity is measured`);
      await page.evaluate(() => globalThis.timingFade.play());
      const outcome = await pending;
      assert.ifError(outcome.error);
      assert.equal(outcome.ok, true);
      await page.addStyleTag({ content: '.assistant-actions .message-time { opacity: .5 !important; }' });
      await assert.rejects(inspect(page, messageTime, settleLayout, assert), error =>
        error instanceof assert.AssertionError && error.actual === '0.5' && error.expected === '1',
      'A permanently half-transparent timestamp must still fail after settling');
    } finally { await page.close(); }
  }
});

test('layout settling waits for ancestor pseudo-element track motion before measuring a nested form', { timeout: 5000 }, async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<style>
      #host { display: flex; width: 640px; }
      #host::before { content: ''; flex: 0 0 244px; transition: flex-basis 280ms linear; }
      #host.compact::before { flex-basis: 0px; }
      main { flex: 1; min-width: 0; }
      #rows { display: flex; flex-wrap: wrap; }
      #rows span { width: 190px; height: 40px; }
      textarea { display: block; }
    </style><div id="host"><main><div id="rows"><span></span><span></span><span></span></div><textarea></textarea></main></div><div id="unrelated"></div>`);
    const before = await page.locator('textarea').boundingBox();
    await page.locator('#host').evaluate(element => {
      getComputedStyle(element, '::before').flexBasis;
      element.classList.add('compact');
      getComputedStyle(element, '::before').flexBasis;
      if (!element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))
        throw new Error('The ancestor track must actually animate');
      document.querySelector('#unrelated').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60000 });
    });
    await settleLayout(page.locator('textarea'));
    const after = await page.locator('textarea').boundingBox();
    assert.equal(before.y - after.y, 40, 'Ancestor resizing changes the form row wrapping');
    assert.equal(await page.locator('#host').evaluate(element =>
      parseFloat(getComputedStyle(element, '::before').flexBasis)), 0);
  } finally { await page.close(); }
});

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

test('layout settlement waits for a finite pseudo-element flex track before measuring its child', { timeout: 10000 }, async () => {
  await fixture(async page => {
    const start = await page.locator('#target').evaluate(element => {
      getComputedStyle(element, '::before').flexBasis;
      element.classList.add('open');
      getComputedStyle(element, '::before').flexBasis;
      const transition = element.getAnimations({ subtree: true }).find(animation =>
        animation instanceof CSSTransition && animation.transitionProperty === 'flex-basis');
      if (!transition) throw new Error('Missing fixture flex track transition');
      transition.pause();
      transition.currentTime = 0;
      globalThis.layoutTrack = transition;
      return element.querySelector('#child').getBoundingClientRect().x;
    });
    let settled = false;
    const pending = settleLayout(page.locator('#target')).then(() => { settled = true; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(settled, false, 'A paused finite ancestor track must not yield a geometry baseline');
    await page.evaluate(() => globalThis.layoutTrack.finish());
    await pending;
    assert.equal(await page.locator('#child').evaluate(element => element.getBoundingClientRect().x), start + 100);
  }, `#target, #target.open { display: flex; width: 300px; transition: none; }
      #target::before { position: static; width: auto; flex: 0 0 0px; transform: none; transition: flex-basis 120ms ${easing}; }
      #target.open::before { flex-basis: 100px; transform: none; }
      #child { display: block; width: 100px; height: 20px; }`);
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
