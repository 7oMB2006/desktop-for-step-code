import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { markdownWorker } from '../vite.config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const label = process.env.DESKTOP_INTERACTION_LABEL ?? 'current';
const baseline = process.env.DESKTOP_INTERACTION_BASELINE === '1';
const layoutBaseline = process.env.DESKTOP_INTERACTION_LAYOUT_BASELINE === '1';
const streamingBaseline = process.env.DESKTOP_INTERACTION_STREAMING_BASELINE === '1';
const scrollDiagnostics = process.env.DESKTOP_INTERACTION_SCROLL_DIAGNOSTICS === '1';
const openingOnly = process.env.DESKTOP_INTERACTION_OPENING_ONLY === '1';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid report label');
const output = resolve(root, 'test-results/long-session-interaction');
const outDir = resolve(output, 'site');
await mkdir(output, { recursive: true });
await build({ root, configFile: false, base: './', logLevel: 'warn', worker: markdownWorker,
  build: { outDir, emptyOutDir: true, rolldownOptions: { input: resolve(root, 'tests/fixtures/long-session-interaction.html') } } });
const server = await preview({ root, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
let browser;
let page;
const reports = [];
const errors = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_BROWSER_CHANNEL } : {}) });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(scrollDiagnostics => {
    const rect = Element.prototype.getBoundingClientRect;
    const query = Element.prototype.querySelector;
    window.interactionSample = null;
    Element.prototype.querySelector = function (selector) {
      if (window.interactionSample && selector.startsWith('article[data-message-index='))
        window.interactionSample.turnQueries++;
      return query.call(this, selector);
    };
    Element.prototype.getBoundingClientRect = function () {
      if (window.interactionSample && this.matches('article[data-message-index]')) window.interactionSample.turnMeasurements++;
      const bounds = rect.call(this);
      if (scrollDiagnostics && window.interactionSample && this.matches('.conversation, article[data-message-index="79"]'))
        window.interactionSample.scrolls.push({ at: performance.now(), geometry: this.id || this.dataset.messageIndex,
          top: bounds.top, width: bounds.width });
      return bounds;
    };
    if (scrollDiagnostics) {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      Object.defineProperty(Element.prototype, 'scrollTop', { ...descriptor,
        get() {
          const value = descriptor.get.call(this);
          if (window.interactionSample && this.id === 'conversation-scroll')
            window.interactionSample.scrolls.push({ at: performance.now(), read: value });
          return value;
        },
        set(value) {
          descriptor.set.call(this, value);
          if (window.interactionSample && this.id === 'conversation-scroll')
            window.interactionSample.scrolls.push({ at: performance.now(), value,
              locked: this.hasAttribute('data-layout-window'), stack: new Error().stack });
        },
      });
      document.addEventListener('scroll', event => {
        if (window.interactionSample && event.target.id === 'conversation-scroll')
          window.interactionSample.scrolls.push({ at: performance.now(), event: true,
            locked: event.target.hasAttribute('data-layout-window') });
      }, true);
    }
    window.beginInteractionSample = () => {
      const sample = { frames: [], tasks: [], turnMeasurements: 0, turnQueries: 0, scrolls: [] };
      window.interactionSample = sample;
      let previous = performance.now();
      const frame = now => {
        sample.frames.push(now - previous); previous = now;
        if (window.interactionSample === sample) requestAnimationFrame(frame);
      };
      const observer = new PerformanceObserver(list => sample.tasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: 'longtask' });
      requestAnimationFrame(frame);
      window.endInteractionSample = () => {
        observer.disconnect(); window.interactionSample = null;
        return sample;
      };
    };
  }, scrollDiagnostics);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const sample = async (name, action) => {
    await page.evaluate(() => window.beginInteractionSample());
    const before = await metrics();
    await action();
    await page.waitForTimeout(450);
    const after = await metrics();
    const result = await page.evaluate(() => window.endInteractionSample());
    const sorted = [...result.frames].sort((a, b) => a - b);
    const report = { name, layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layouts: after.LayoutCount - before.LayoutCount, frames: result.frames.length,
      framesOver32ms: result.frames.filter(value => value > 32).length,
      p95FrameMs: sorted[Math.floor(sorted.length * .95)] ?? 0, maxFrameMs: Math.max(0, ...sorted),
      turnMeasurements: result.turnMeasurements, turnQueries: result.turnQueries, longTasks: result.tasks,
      ...(scrollDiagnostics ? { scrolls: result.scrolls } : {}) };
    console.log(JSON.stringify(report));
    return report;
  };
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/long-session-interaction.html`;
  const settled = () => page.waitForFunction(() => !document.querySelector('[data-layout-locked], [data-layout-window], .app[data-panel-drag]')
    && !document.querySelector('.app')?.getAnimations({ subtree: true }).some(animation =>
      animation instanceof CSSTransition && ['flex-basis', 'max-width'].includes(animation.transitionProperty)));
  const checkWidths = () => page.evaluate(() => [...document.querySelectorAll('.messages > article')]
    .every(element => !element.style.width && !element.hasAttribute('data-layout-locked')));
  for (const size of openingOnly ? [] : ['short', 'long']) {
    await page.goto(`${url}?size=${size}`);
    await page.locator('.response-text').last().waitFor();
    await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled && document.querySelector('.session-row'));
    await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); });
    await page.waitForTimeout(600);
    const initial = await page.locator('.messages > article').count();
    assert.equal(initial, size === 'short' ? 6 : 360);
    await page.evaluate(() => { window.interactionArticles = [...document.querySelectorAll('.messages > article')]; });
    const scenarios = [];
    scenarios.push(await sample('right-open', () => page.locator('.right-tool-rail [aria-controls="context-panel"]').click()));
    await page.locator('#context-panel').waitFor();
    const handle = page.locator('.right-panel-handle');
    let dragState;
    const dragSample = await sample('right-drag', async () => {
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      for (let step = 1; step <= 40; step++) {
        await page.mouse.move(box.x + box.width / 2 - Math.sin(step / 40 * Math.PI) * 240, box.y + box.height / 2);
        if (step === 20) dragState = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('.messages > article')];
          return { locked: rows.filter(element => element.hasAttribute('data-layout-locked')).length,
            mounted: rows.length, liveLocked: Boolean(document.querySelector('.response-active[data-layout-locked]')),
            sameNodes: rows.every((element, index) => element === window.interactionArticles[index]),
            hidden: rows.some(element => getComputedStyle(element).display === 'none' || getComputedStyle(element).contentVisibility === 'hidden') };
        });
      }
      await page.mouse.up();
    });
    assert.equal(dragState.mounted, initial);
    assert.equal(dragState.hidden, false);
    assert.equal(dragState.liveLocked, false);
    assert.equal(dragState.sameNodes, true, 'Resizing must reuse the original message DOM');
    if (!baseline && !layoutBaseline) assert.equal(dragState.locked > 0, size === 'long');
    await settled();
    assert.ok(await checkWidths(), 'All temporary widths must be released after the drag');
    scenarios.push({ ...dragSample, ...dragState });
    await page.locator('#context-panel [aria-label="Close context"]').click();
    scenarios.push(await sample('sidebar-hide', () => page.locator('.window-sidebar-toggle').click()));
    scenarios.push(await sample('sidebar-show', () => page.locator('.window-sidebar-toggle').click()));
    await page.evaluate(() => window.interactionFixture.setPreferenceDelay(350));
    const feedback = await page.locator('.workspace-toggle').filter({ hasText: 'Performance' }).evaluate(async button => {
      const started = performance.now();
      const old = button.getAttribute('aria-expanded');
      const completions = window.interactionFixture.preferenceCompletions;
      const changed = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (button.getAttribute('aria-expanded') === old) return;
          observer.disconnect();
          resolve({ ms: performance.now() - started,
            beforeSave: window.interactionFixture.preferenceCompletions === completions });
        });
        observer.observe(button, { attributes: true, attributeFilter: ['aria-expanded'] });
      });
      button.click();
      return changed;
    });
    console.log(`${size} workspace feedback: ${feedback.ms.toFixed(1)}ms with 350ms preference save; before save: ${feedback.beforeSave}`);
    await page.waitForTimeout(450);
    if (!baseline) assert.ok(feedback.beforeSave, 'Workspace feedback must precede the delayed preference save');
    reports.push({ size, initialArticles: initial, workspaceFeedbackMs: feedback.ms, workspaceFeedbackBeforeSave: feedback.beforeSave, scenarios });
    await page.screenshot({ path: resolve(output, `${label}-${size}.png`) });
  }
  if (!baseline && !openingOnly) {
    const workspace = page.locator('.workspace-toggle').filter({ hasText: 'Performance' });
    const other = page.locator('.workspace-toggle').filter({ hasText: 'Other' });
    // Pending saves must not undo later clicks or another group's desired state.
    await workspace.evaluate(button => { button.click(); button.click(); button.click(); });
    await other.click();
    await page.waitForFunction(() => {
      const closed = window.interactionFixture.preferences.collapsedWorkspaces ?? [];
      return !closed.includes('d:/projects/performance') && closed.includes('d:/projects/other');
    });
    assert.equal(await workspace.getAttribute('aria-expanded'), 'true');
    assert.equal(await other.getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => window.interactionFixture.rejectNextPreferences());
    await workspace.click();
    await page.waitForFunction(() => document.querySelector('.app-error-banner')?.textContent.includes('Fixture preference save failed'));
    assert.equal(await workspace.getAttribute('aria-expanded'), 'true', 'A failed save restores the last confirmed state');
    await page.locator('.app-error-banner [aria-label="Dismiss"]').click();
    await page.evaluate(() => window.interactionFixture.setPreferenceDelay(0));

    // Read an old completed answer, then keep that reader paused during reflow.
    const historical = page.locator('article.assistant[data-message-index="81"]');
    await historical.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, -80);
    await page.waitForTimeout(300);
    assert.ok(await historical.locator('.hljs').count());
    const viewport = page.locator('#conversation-scroll');
    assert.ok(await viewport.evaluate(element => element.scrollTop < element.scrollHeight - element.clientHeight - 1000));
    await page.locator('.right-tool-rail [aria-controls="context-panel"]').click();
    await page.waitForTimeout(400);
    assert.ok(await viewport.evaluate(element => element.scrollTop < element.scrollHeight - element.clientHeight - 1000),
      'Opening a panel while reading history must not pull the reader to the tail');
    const readingAnchor = () => viewport.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const row = [...element.querySelectorAll('.messages > article')].find(row => row.getBoundingClientRect().bottom > bounds.top);
      return { index: row.dataset.messageIndex, offset: row.getBoundingClientRect().top - bounds.top,
        width: element.querySelector('.messages').getBoundingClientRect().width };
    });
    const anchorBefore = await readingAnchor();
    const resized = await sample('historical-right-drag', async () => {
      const box = await page.locator('.right-panel-handle').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 260, box.y + box.height / 2, { steps: 30 });
      await page.mouse.up();
    });
    await settled();
    const anchorAfter = await readingAnchor();
    reports.push({ size: 'long-reading', anchorBefore, anchorAfter, scenarios: [resized] });
    assert.ok(Math.abs(anchorAfter.width - anchorBefore.width) > 80, 'The reading test must finish at a different transcript width');
    if (!layoutBaseline) {
      assert.equal(anchorAfter.index, anchorBefore.index, 'The same historical article must remain the reading anchor');
      assert.ok(Math.abs(anchorAfter.offset - anchorBefore.offset) < 3, 'Reflow must preserve the historical article offset');
    }
    assert.ok(await checkWidths());
    await page.locator('#context-panel [aria-label="Close context"]').click();
    await settled();
    // Reversals dispatch transitioncancel as well as transitionend.
    await page.locator('.window-sidebar-toggle').evaluate(async button => {
      for (let index = 0; index < 4; index++) {
        button.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
    });
    await settled();
    assert.ok(await checkWidths(), 'Rapid reversals must not leave history at an obsolete width');
    await historical.scrollIntoViewIfNeeded();
    await historical.locator('.assistant-actions [aria-label="Copy"]').click({ force: true });
    await historical.locator('.assistant-actions .copy-button[data-copied="true"]').waitFor({ state: 'attached' });
    await historical.locator('.response-text p').first().scrollIntoViewIfNeeded();
    await historical.locator('.response-text p').first().evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const selected = await page.evaluate(() => getSelection().toString());
    await page.locator('.window-sidebar-toggle').evaluate(button => button.click());
    await settled();
    assert.equal(await page.evaluate(() => getSelection().toString()), selected, 'Reflow must not replace selected text nodes');
    assert.ok(await checkWidths(), 'Selected history must bypass width locking');
    await page.locator('.window-sidebar-toggle').evaluate(button => button.click());
    await settled();
    await page.getByRole('button', { name: 'Quote', exact: true }).click();
    await page.getByRole('button', { name: 'View quotes', exact: true }).click();
    const quotePreview = page.getByRole('dialog', { name: 'Quote preview', exact: true });
    await quotePreview.waitFor();
    assert.match(await quotePreview.innerText(), /completed reply remains selectable/);
    await page.keyboard.press('Escape');

    // Stream through the same application event path while resizing.
    await page.evaluate(() => { getSelection()?.removeAllRanges(); window.interactionFixture.startStream(); });
    await page.locator('.response-active').waitFor();
    await page.locator('.right-tool-rail [aria-controls="context-panel"]').click();
    await page.waitForFunction(() => window.interactionFixture.streamUpdates >= 3);
    await settled();
    const streamAnchorBefore = await readingAnchor();
    const dragStreaming = async (name, tail) => {
      const states = [];
      let gestureAnchor;
      const probe = () => page.evaluate(() => {
        const viewport = document.querySelector('#conversation-scroll');
        const top = viewport.getBoundingClientRect().top;
        const row = [...viewport.querySelectorAll('.messages > article')].find(row => row.getBoundingClientRect().bottom > top);
        return { updates: window.interactionFixture.streamUpdates,
          locked: viewport.querySelectorAll('[data-layout-locked]').length,
          liveLocked: Boolean(viewport.querySelector('.response-active[data-layout-locked]')),
          articles: viewport.querySelectorAll('.messages > article').length,
          distance: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
          anchor: { index: row.dataset.messageIndex, offset: row.getBoundingClientRect().top - top } };
      });
      const result = await sample(name, async () => {
        const box = await page.locator('.right-panel-handle').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        gestureAnchor = await readingAnchor();
        for (let step = 1; step <= 4; step++) {
          await page.mouse.move(box.x - step * 35, box.y + box.height / 2, { steps: 4 });
          await page.waitForTimeout(100);
          states.push(await probe());
        }
        await page.evaluate(() => window.interactionFixture.stopStream());
        await page.waitForFunction(() => !document.querySelector('.response-active, .messages > .working'));
        await page.waitForTimeout(100);
        states.push({ ...await probe(), completed: true });
        await page.mouse.move(box.x - 165, box.y + box.height / 2);
        await page.waitForTimeout(80);
        states.push({ ...await probe(), completed: true });
        await page.mouse.up();
      });
      assert.ok(states[3].updates > states[0].updates, 'The response must grow during the gesture');
      for (const state of states) {
        if (!layoutBaseline && !streamingBaseline) assert.ok(state.locked > 0, 'Deltas and completion must retain distant width protection');
        assert.equal(state.liveLocked, false, 'Live prose must continue to reflow normally');
        assert.equal(state.articles, 362);
        if (tail) assert.ok(state.distance <= 2, 'Tail following must remain at the painted tail');
        else if (!layoutBaseline && !streamingBaseline) {
          assert.equal(state.anchor.index, gestureAnchor.index);
          assert.ok(Math.abs(state.anchor.offset - gestureAnchor.offset) < 3, 'Streaming and completion must retain the gesture anchor');
        }
      }
      await settled();
      assert.ok(await checkWidths(), 'Completion and settlement must restore every temporary width');
      if (tail) assert.ok(await page.locator('#conversation-scroll').evaluate(element =>
        element.scrollHeight - element.scrollTop - element.clientHeight <= 2), 'Final reflow must retain the tail');
      const updates = await page.evaluate(() => window.interactionFixture.streamUpdates);
      assert.equal(((await page.locator('.response-text').last().innerText()).match(/Streaming text keeps arriving/g) ?? []).length, updates);
      return { ...result, gestureAnchor, states };
    };
    const streaming = await dragStreaming('streaming-right-drag', false);
    const streamAnchorAfter = await readingAnchor();
    reports.push({ size: 'long-streaming', streamAnchorBefore, streamAnchorAfter, scenarios: [streaming] });
    if (!layoutBaseline && !streamingBaseline) {
      assert.equal(streamAnchorAfter.index, streamAnchorBefore.index);
      assert.ok(Math.abs(streamAnchorAfter.offset - streamAnchorBefore.offset) < 3,
        `Streaming must preserve the paused historical offset: ${JSON.stringify({
          before: streamAnchorBefore, gesture: streaming.gestureAnchor, after: streamAnchorAfter,
        })}`);
    }
    if (!layoutBaseline && !streamingBaseline)
      assert.equal(streaming.turnQueries, 0, 'Assistant-only updates must not reacquire historical turn nodes');
    await page.locator('.context-message').first().locator('summary').click();
    await page.locator('.context-message[open] .context-json').waitFor();
    await page.evaluate(() => window.interactionFixture.stopStream());
    await page.waitForFunction(() => !document.querySelector('.response-active'));
    assert.match(await page.locator('.response-text').last().innerText(), /Streaming text keeps arriving/);
    assert.match(await page.locator('.context-message[open] .context-json').innerText(), /Streaming text keeps arriving/);
    assert.equal(await page.locator('.messages > article').count(), 362, 'No transcript entries are discarded');
    await page.screenshot({ path: resolve(output, `${label}-streaming.png`) });
    // Each deterministic stream starts from the fixture's original history.
    await page.goto(`${url}?size=long`);
    await page.locator('.response-text').last().waitFor();
    await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled && document.querySelector('.session-row'));
    await page.locator('.right-tool-rail [aria-controls="context-panel"]').click();
    await settled();
    await page.evaluate(() => window.interactionFixture.startStream());
    await page.waitForFunction(() => window.interactionFixture.streamUpdates >= 3);
    const tailStreaming = await dragStreaming('tail-streaming-right-drag', true);
    reports.push({ size: 'long-tail-streaming', scenarios: [tailStreaming] });
    for (const cancel of ['Escape', 'pointercancel']) {
      const box = await page.locator('.right-panel-handle').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 3 });
      if (cancel === 'Escape') await page.keyboard.press('Escape');
      else await page.locator('.right-panel-handle').dispatchEvent('pointercancel');
      await page.mouse.up();
      assert.equal(await page.locator('.app[data-panel-drag]').count(), 0);
      assert.equal(await page.locator('.right-inspector-surface[style*="width:"]').count(), 0);
      await page.keyboard.press('Escape');
      await settled();
      assert.ok(await checkWidths(), 'Cancellation must restore real article widths');
    }
    await page.locator('#context-panel [aria-label="Close context"]').click();

    // The full-text route must still reveal and focus a historical match.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('selectable');
    await page.getByRole('button', { name: 'Search chat history', exact: true }).click();
    await page.locator('.fulltext-hit').click();
    await page.getByRole('button', { name: 'Open and locate', exact: true }).click();
    await page.getByText('Search message located', { exact: true }).waitFor();
    assert.equal(await page.locator('#conversation-scroll .response-text[data-message-index="81"]').evaluate(element => {
      const match = CSS.highlights.get('desktop-conversation-search-match')?.values().next().value;
      const rect = match?.getBoundingClientRect(), viewport = element.closest('#conversation-scroll').getBoundingClientRect();
      return element === document.activeElement && rect?.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom;
    }), true, 'A search match must be visible and focused, not only present in the DOM');
    await page.getByRole('button', { name: 'Dismiss search location', exact: true }).click();
    await page.locator('.right-tool-rail [aria-controls="conversation-navigation-panel"]').click();
    await settled();
    const duringTransition = await page.locator('#conversation-navigation-panel nav button').nth(100).evaluate(async button => {
      document.querySelector('.window-sidebar-toggle').click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const active = document.querySelector('.app').getAnimations({ subtree: true })
        .some(animation => animation instanceof CSSTransition && ['flex-basis', 'max-width'].includes(animation.transitionProperty));
      button.click();
      return active;
    });
    assert.equal(duringTransition, true, 'Distant navigation must be tested during a real width transition');
    const navigationLocated = await page.waitForFunction(() => {
      const target = document.querySelector('#conversation-scroll article[data-message-index="200"]');
      const rect = target?.getBoundingClientRect(), viewport = target?.closest('#conversation-scroll').getBoundingClientRect();
      return rect && viewport && rect.top >= viewport.top - 1 && rect.top < viewport.bottom;
    }, undefined, { timeout: 4000 }).then(() => true, () => false);
    reports.push({ size: 'transition-navigation', located: navigationLocated });
    if (!layoutBaseline) assert.equal(navigationLocated, true, 'Navigation during a width transition must locate the requested turn');
    await settled();
    assert.ok(await checkWidths(), 'Navigation must use the released final geometry');

    // Identical user previews in another session must reacquire that session's nodes.
    if (await page.locator('.app.sidebar-hidden').count()) await page.locator('.window-sidebar-toggle').click();
    await page.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('');
    await settled();
    const switched = await sample('same-projection-session-switch', async () => {
      await page.locator('.session-row[data-reorder-id="session-1"] > button').first().click();
      await page.waitForFunction(() => document.querySelector('.session-row[data-reorder-id="session-1"] > button')?.getAttribute('aria-current') === 'page');
    });
    reports.push({ size: 'session-replacement', scenarios: [switched] });
    assert.ok(switched.turnQueries >= 180, 'A new session must reacquire current turn nodes even with identical previews');
    await page.locator('.right-tool-rail [aria-controls="conversation-navigation-panel"]').click();
    await settled();
    await page.locator('#conversation-navigation-panel nav button').nth(40).click();
    await page.waitForFunction(() => {
      const target = document.querySelector('#conversation-scroll article[data-message-index="80"]');
      const rect = target?.getBoundingClientRect(), viewport = target?.closest('#conversation-scroll').getBoundingClientRect();
      return rect && viewport && rect.top >= viewport.top - 1 && rect.top < viewport.bottom;
    });
    await page.locator('#conversation-navigation-panel [aria-label="Close panel"]').click();
    await settled();

    // Memoized providers must still deliver changed usage and current questions.
    await page.evaluate(() => {
      window.interactionFixture.setHistory([
        { role: 'user', content: '/clm', timestamp: 1794000000000 },
        { role: 'assistant', content: [{ type: 'toolCall', id: 'question-call', name: 'clarify_user', arguments: {} }] },
      ]);
      window.interactionFixture.setContextUsage(23);
    });
    const contextPercent = () => page.locator('article.user .context-command-icon .context-ring')
      .evaluate(element => element.style.getPropertyValue('--context-percent'));
    await page.waitForFunction(() => document.querySelector('article.user .context-command-icon .context-ring')
      ?.style.getPropertyValue('--context-percent') === '23%');
    await page.evaluate(() => window.interactionFixture.setContextUsage(67));
    await page.waitForFunction(() => document.querySelector('article.user .context-command-icon .context-ring')
      ?.style.getPropertyValue('--context-percent') === '67%');
    assert.equal(await contextPercent(), '67%');
    const requestQuestions = question => page.evaluate(question => window.interactionFixture.requestQuestions({
      type: 'extension_ui_request', id: 'question-request', method: 'input',
      title: 'Desktop clarification\n' + JSON.stringify({ version: 1, callId: 'question-call',
        questions: [{ id: 'choice', label: 'Choice', question,
          options: [{ label: 'One', value: 'one' }], allowFreeform: false }] }),
    }), question);
    const drawer = page.getByRole('dialog', { name: 'Answer questions', exact: true });
    await requestQuestions('Which first option?');
    await drawer.waitFor();
    await drawer.getByRole('button', { name: 'Answer later', exact: true }).click();
    await drawer.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Open pending questions', exact: true }).click();
    await drawer.waitFor();
    assert.match(await drawer.innerText(), /Which first option/);
    await page.evaluate(() => window.interactionFixture.expireQuestion('question-request'));
    await drawer.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Open pending questions', exact: true }).count(), 0);
    await requestQuestions('Which replacement option?');
    await drawer.waitFor();
    assert.match(await drawer.innerText(), /Which replacement option/);
    await drawer.getByRole('button', { name: 'Answer later', exact: true }).click();
    await drawer.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Open pending questions', exact: true }).click();
    await drawer.waitFor();
    assert.match(await drawer.innerText(), /Which replacement option/);
    await page.evaluate(() => window.interactionFixture.expireQuestion('question-request'));
    await drawer.waitFor({ state: 'hidden' });

    // A preview uses the same hierarchy, but not a previous session's live question context.
    await page.evaluate(() => {
      const history = [
        { role: 'user', entryId: 'preview-user', content: 'Preview question', timestamp: 1794000000000 },
        { role: 'assistant', entryId: 'preview-answer', content: [
          { type: 'toolCall', id: 'question-call', name: 'clarify_user', arguments: {} },
          { type: 'text', text: 'Preview content remains selectable.\n\n```typescript\nconst ready = true;\n```' },
        ], timestamp: 1794000001000 },
      ];
      window.interactionFixture.setHistory(history);
      window.interactionFixture.setReadingHistory(history);
      window.interactionFixture.setNavigationDelays(10, 1200);
    });
    await requestQuestions('Do not expose this live question in a preview.');
    await drawer.waitFor();
    await drawer.getByRole('button', { name: 'Answer later', exact: true }).click();
    await drawer.waitFor({ state: 'hidden' });
    await page.locator('.session-row[data-reorder-id="session-2"] > button').first().click();
    const preview = page.locator('.session-reading-preview');
    await preview.waitFor();
    assert.equal(await preview.getByRole('button', { name: 'Open pending questions', exact: true }).count(), 0);
    assert.equal(await preview.getByText('Do not expose this live question in a preview.', { exact: true }).count(), 0);
    await preview.locator('.response-text').evaluate(element => {
      window.readingProse = element.querySelector('p');
      const range = document.createRange();
      range.selectNodeContents(window.readingProse);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    });
    assert.ok(await page.locator('.composer-action-button').isDisabled());
    await preview.waitFor({ state: 'hidden' });
    const handoffSelection = await page.evaluate(() => ({
      same: window.readingProse === document.querySelector('#conversation-scroll .messages .response-text p'),
      connected: window.readingProse.isConnected, selected: window.getSelection().toString(),
      focused: document.activeElement?.outerHTML,
    }));
    assert.ok(handoffSelection.same && handoffSelection.selected === 'Preview content remains selectable.',
      `A real selected prose node must survive the preview-to-live handoff: ${JSON.stringify(handoffSelection)}`);
    await page.getByRole('button', { name: 'Open pending questions', exact: true }).waitFor();
    await page.evaluate(() => window.interactionFixture.expireQuestion('question-request'));
    await page.waitForFunction(() => !document.querySelector('.question-tool-summary button'));

    const checkSettingsLayer = async (reduced = false) => {
      await page.locator('#context-panel [aria-label="Close context"]').click();
      await settled();
      if (await page.locator('.app.sidebar-hidden').count()) await page.locator('.window-sidebar-toggle').click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.waitFor();
      assert.equal(await page.locator('.window-bar').evaluate(element => getComputedStyle(element).zIndex), '19');
      assert.equal(await page.locator('.app[data-settings-open]').count(), 1);
      const closing = await settings.getByRole('button', { name: 'Close', exact: true }).evaluate(async button => {
        button.click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { present: Boolean(document.querySelector('.settings-backdrop.is-closing')),
          flagged: Boolean(document.querySelector('.app[data-settings-open]')),
          z: getComputedStyle(document.querySelector('.window-bar')).zIndex };
      });
      if (!reduced) assert.deepEqual(closing, { present: true, flagged: true, z: '19' });
      await settings.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.app[data-settings-open]').count(), 0);
      assert.notEqual(await page.locator('.window-bar').evaluate(element => getComputedStyle(element).zIndex), '19');
    };
    for (const theme of ['light', 'dark']) for (const width of [1440, 760, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${url}?size=long&theme=${theme}`);
      await page.locator('.response-text').last().waitFor();
      await page.locator('.right-tool-rail [aria-controls="context-panel"]').click();
      await page.locator('#context-panel').waitFor();
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: resolve(output, `${label}-${theme}-${width}.png`) });
      await checkSettingsLayer();
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.right-tool-rail [aria-controls="context-panel"]').click();
    await page.locator('#context-panel').waitFor();
    await page.locator('.right-panel-handle').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.right-inspector-surface:not([aria-hidden="true"]):not(.is-closing)')
      .evaluate(element => element.getAnimations().length), 0);
    await checkSettingsLayer(true);

    // Time formatting is shared, locale-correct and refreshed for a changed OS time zone.
    await page.addInitScript(() => {
      const original = Intl.DateTimeFormat;
      window.messageTimeFormats = 0; window.legacyMessageTimeCalls = 0;
      Intl.DateTimeFormat = new Proxy(original, {
        construct(target, args) {
          if (args[1]?.hour === '2-digit' && args[1]?.minute === '2-digit') window.messageTimeFormats++;
          return Reflect.construct(target, args);
        },
      });
      const legacy = Date.prototype.toLocaleTimeString;
      Date.prototype.toLocaleTimeString = function (...args) {
        window.legacyMessageTimeCalls++;
        return legacy.apply(this, args);
      };
    });
    for (const [language, timeZone] of [['en', 'America/New_York'], ['zh', 'Asia/Shanghai']]) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: timeZone });
      await page.goto(`${url}?size=long&language=${language}`);
      await page.locator('.response-text').last().waitFor();
      const times = await page.evaluate(({ language, timeZone }) => {
        const formatter = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-GB',
          { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
        const times = [...document.querySelectorAll('.message-time')];
        return { count: times.length, formats: window.messageTimeFormats, legacy: window.legacyMessageTimeCalls,
          correct: times.every(time => time.textContent === formatter.format(new Date(time.dateTime))) };
      }, { language, timeZone });
      assert.equal(times.count, 360);
      assert.ok(times.formats < 30, 'Formatters must not scale with the number of messages');
      assert.equal(times.legacy, 0, 'No per-message locale formatter reconstruction');
      assert.equal(times.correct, true);
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Australia/Perth' });
      await page.evaluate(() => window.interactionFixture.setContextUsage(47));
      await page.waitForFunction(() => [...document.querySelectorAll('.message-time')].every(time =>
        time.textContent === new Intl.DateTimeFormat(undefined, {
          hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Perth',
        }).format(new Date(time.dateTime))));
      await page.evaluate(() => window.interactionFixture.setHistory(
        [undefined, 0, NaN, Infinity, 9e15].flatMap((timestamp, index) => [
          { role: 'user', entryId: `invalid-${index}`, content: 'Invalid date', timestamp },
          { role: 'assistant', content: 'Still readable', timestamp },
        ])));
      await page.waitForFunction(() => document.querySelectorAll('.messages > article').length === 10);
      assert.equal(await page.locator('.message-time').count(), 0, 'Invalid timestamps remain hidden');
    }
  }
  if (!baseline && !layoutBaseline && !streamingBaseline) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Isolate mounting from width transitions; exercise normal disclosures below.
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(`${url}?size=short`);
    await page.locator('.response-text').last().waitFor();
    await page.evaluate(() => {
      window.desktop.turnUndo = async () => ({ state: 'unavailable' });
      window.desktop.artifactFiles = async (_runtime, paths) =>
        paths.map(path => ({ path, exists: true, canOpen: true, kind: 'document' }));
      const history = Array.from({ length: 50 }, (_, turn) => [
        { role: 'user', entryId: `tool-user-${turn}`, content: `Inspect turn ${turn}` },
        { role: 'assistant', content: [
          { type: 'thinking', thinking: `Saved thinking ${turn}. **Keep this readable.**` },
          ...['read_file', 'edit_file', 'exec_command'].map((name, tool) => ({
            type: 'toolCall', id: `${turn}-${tool}`, name, arguments: { path: `src/feature-${turn}.ts` },
          })),
        ] },
        ...['read_file', 'edit_file', 'exec_command'].map((toolName, tool) => ({
          role: 'toolResult', toolCallId: `${turn}-${tool}`, toolName, content: `Tool output ${turn}/${tool}`,
          details: tool === 1 ? { changed: true,
            patch: `--- a/src/feature-${turn}.ts\n+++ b/src/feature-${turn}.ts\n@@ -1 +1 @@\n-before\n+after\n` } : {},
        })),
        { role: 'assistant', entryId: `tool-answer-${turn}`,
          content: `## Tool answer ${turn}\n\nSelectable prose ${turn}.\n\n\`\`\`typescript\nconst value = ${turn};\n\`\`\`` },
      ]).flat();
      window.interactionFixture.setHistory(history);
      window.interactionFixture.setReadingHistory(history);
      window.interactionFixture.setNavigationDelays(10, 2500);
    });
    await page.waitForFunction(() => document.querySelectorAll('#conversation-scroll .messages > article').length === 100);
    await settled();
    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      window.openingScrollWrites = 0;
      window.openingScrollStacks = [];
      window.restoreOpeningScroll = () => Object.defineProperty(Element.prototype, 'scrollTop', descriptor);
      Object.defineProperty(Element.prototype, 'scrollTop', { ...descriptor, set(value) {
        if (this.id === 'conversation-scroll') {
          window.openingScrollWrites++;
          window.openingScrollStacks.push(new Error().stack);
        }
        descriptor.set.call(this, value);
      } });
    });
    await page.locator('.session-row[data-reorder-id="session-1"] > button').first().click();
    await page.locator('.session-reading-preview .response-text').last().waitFor();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Draft remains usable during tool-heavy opening');
    assert.ok(await page.locator('.composer-action-button').isDisabled(), 'Preview input cannot execute');
    await page.locator('.session-reading-preview').waitFor({ state: 'hidden' });
    await settled();
    const writes = await page.evaluate(() => {
      const writes = window.openingScrollWrites;
      window.restoreOpeningScroll();
      return writes;
    });
    assert.ok(writes < 30, `Disclosure mounts must batch viewport restoration, not write once per row: ${writes}\n${JSON.stringify(
      await page.evaluate(() => [...new Set(window.openingScrollStacks)]))}`);
    assert.equal(await page.locator('#conversation-scroll .messages > article').count(), 100);
    assert.equal(await page.locator('#conversation-scroll .response-text code.hljs').count(), 50);
    assert.equal(await page.locator('.composer > .composer-input').evaluate(element => element.value),
      'Draft remains usable during tool-heavy opening');
    reports.push({ size: 'tool-heavy-opening', scrollWrites: writes, articles: 100, highlightedBlocks: 50 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#conversation-scroll').hover();
    const beforeWheel = await page.locator('#conversation-scroll').evaluate(element => element.scrollTop);
    await page.mouse.wheel(0, -500);
    await page.waitForFunction(before => document.querySelector('#conversation-scroll').scrollTop < before - 100, beforeWheel);
    await page.locator('.process-tool-group > .tool-group-trigger').last().click();
    const tool = page.locator('#conversation-scroll details.process-tool').last();
    await tool.locator(':scope > summary').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#conversation-scroll details.process-tool')].at(-1)?.open);
    assert.match(await tool.innerText(), /Tool output 49\/2/);
    await tool.locator(':scope > summary').click();
    const thinking = page.locator('#conversation-scroll details.thinking').last();
    await thinking.locator('summary').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#conversation-scroll details.thinking')].at(-1)?.open);
    assert.match(await thinking.innerText(), /Saved thinking 49/);
    await thinking.locator('summary').click();
    await page.waitForFunction(() => ![...document.querySelectorAll('#conversation-scroll details.thinking')].at(-1)?.open);

    // Artifact memoization must invalidate for changed paths and changed prose.
    const artifactHistory = path => [
      { role: 'user', content: 'Create a report' },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'output', name: 'write_file', arguments: { path } }] },
      { role: 'toolResult', toolCallId: 'output', toolName: 'write_file', content: 'Written' },
      { role: 'assistant', content: 'Report completed.' },
    ];
    await page.evaluate(history => window.interactionFixture.setHistory(history), artifactHistory('old.md'));
    await page.getByRole('button', { name: 'old.md', exact: true }).waitFor();
    await page.evaluate(history => window.interactionFixture.setHistory(history), artifactHistory('new.md'));
    await page.getByRole('button', { name: 'new.md', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'old.md', exact: true }).count(), 0);
    await page.evaluate(() => window.interactionFixture.setHistory([
      { role: 'user', content: 'Link another report' },
      { role: 'assistant', content: '[Final report](./final.pdf)' },
    ]));
    await page.locator('.turn-artifacts').getByRole('button', { name: 'Final report', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'new.md', exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, `${label}.json`), JSON.stringify({ label, browser: browser.version(), reports }, null, 2));
} catch (error) {
  await page?.screenshot({ path: resolve(output, `${label}-failure.png`) }).catch(() => {});
  await writeFile(resolve(output, `${label}-failure.json`), JSON.stringify({ label, error: String(error), errors, reports }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
