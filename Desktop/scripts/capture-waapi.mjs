// Capture the product-created WAAPI effect before returning it to the component.
// This keeps short disclosures available even if the action's IPC/Playwright
// round trip takes longer than their duration. Callers own seeking and playback.
export async function captureWaapi(page, target, action) {
  const key = `waapi-${Date.now()}-${Math.random()}`;
  const selector = typeof target === 'string' ? target : undefined;
  const element = selector ? undefined : await target.elementHandle();
  await page.evaluate(({ key, selector, element }) => {
    const samples = globalThis.desktopWaapiSamples ??= new Map();
    const original = Element.prototype.animate;
    let resolveResult, timer, captured;
    const result = new Promise(resolve => { resolveResult = resolve; });
    const restore = () => {
      if (Element.prototype.animate === hook) Element.prototype.animate = original;
      clearTimeout(timer);
    };
    const hook = function (...args) {
      const animation = original.apply(this, args);
      if (element ? this !== element : !this.matches(selector)) return animation;
      restore();
      const timing = animation.effect?.getTiming();
      if (animation.playState !== 'running' || !(timing?.duration > 0) || !Number.isFinite(timing.duration)) {
        resolveResult({ error: `Expected a finite running WAAPI effect: ${JSON.stringify({
          selector, playState: animation.playState, duration: timing?.duration })}` });
      } else {
        captured = animation;
        animation.pause(); animation.currentTime = 0;
        resolveResult({ animation });
      }
      return animation;
    };
    samples.set(key, { result, cleanup: resume => {
      restore();
      if (resume && captured?.playState === 'paused') captured.play();
    } });
    Element.prototype.animate = hook;
    timer = setTimeout(() => {
      restore(); resolveResult({ error: `Missing WAAPI effect for ${selector ?? element?.className}` });
    }, 5000);
  }, { key, selector, element });
  let returned = false;
  try {
    await action();
    const animation = await page.evaluateHandle(async key => {
      const outcome = await globalThis.desktopWaapiSamples.get(key).result;
      if (outcome.error) throw new Error(outcome.error);
      return outcome.animation;
    }, key);
    returned = true;
    return animation;
  } finally {
    await page.evaluate(({ key, returned }) => {
      const samples = globalThis.desktopWaapiSamples;
      samples?.get(key)?.cleanup(!returned); samples?.delete(key);
    }, { key, returned });
    await element?.dispose();
  }
}
