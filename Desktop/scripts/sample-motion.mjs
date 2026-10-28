// Inspect real CSS transitions at their creation commit, before a native action's
// Playwright/IPC round trip can consume the whole animation. The fixture seeks
// actual effects; it never adds an animation or changes the product's CSS.
export async function sampleMotion(page, options, action) {
  const key = `motion-${Date.now()}-${Math.random()}`;
  await page.evaluate(({ key, options }) => {
    const { label, state, targets, duration, easing, timeoutMs = 5000 } = options;
    const read = () => Object.fromEntries(targets.map(({ name, selector, pseudoElements = [], customProperties = [] }) => {
      const element = document.querySelector(selector);
      if (!element) return [name, null];
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      const pseudo = Object.fromEntries(pseudoElements.map(pseudoElement => {
        const style = getComputedStyle(element, pseudoElement);
        return [pseudoElement, { width: parseFloat(style.width), transform: style.transform,
          transformMatrixX: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41,
          backgroundColor: style.backgroundColor }];
      }));
      return [name, { x: box.x, y: box.y, width: box.width, height: box.height,
        right: box.right, bottom: box.bottom, opacity: Number(style.opacity), display: style.display,
        basis: parseFloat(style.flexBasis), flexBasis: parseFloat(style.flexBasis), inert: element.inert,
        transform: style.transform, clipPath: style.clipPath, backgroundColor: style.backgroundColor, pseudo,
        customProperties: Object.fromEntries(customProperties.map(property => [property, style.getPropertyValue(property).trim()])) }];
    }));
    const matches = () => {
      const element = document.querySelector(state.selector);
      return Boolean(element && (!state.attribute || element.getAttribute(state.attribute) === state.value));
    };
    // Flush the preceding state so a real transition can be created on mutation.
    const before = read();
    if (matches()) throw new Error(`${label}: requested motion state is already active`);
    const samples = globalThis.desktopMotionSamples ??= new Map();
    let resolveResult;
    // Store an outcome instead of a rejecting Promise: the native action can be
    // awaiting IPC while the observer detects and reports a missing transition.
    const result = new Promise(resolve => { resolveResult = resolve; });
    let observer, timer, finished = false;
    const finish = outcome => {
      if (finished) return;
      finished = true; observer?.disconnect(); clearTimeout(timer); resolveResult(outcome);
    };
    samples.set(key, { result, cancel: () => finish({ error: `${label}: action did not complete` }) });
    observer = new MutationObserver(() => {
      if (!matches()) return;
      const captured = [];
      try {
        for (const { name, selector, properties = [], pseudoProperties = {} } of targets) {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing motion target ${selector}`);
          getComputedStyle(element).width;
          // Chromium includes pseudo-element effects only with subtree:true.
          // Keep the exact target filter so descendant motion cannot satisfy a
          // required transition on this element or one of its pseudo-elements.
          const transitions = element.getAnimations({ subtree: true }).filter(animation =>
            animation instanceof CSSTransition && animation.effect?.target === element);
          for (const property of properties) if (!transitions.some(animation =>
            animation.transitionProperty === property && !animation.effect.pseudoElement))
            throw new Error(`Missing ${name} ${property} transition`);
          for (const [pseudoElement, required] of Object.entries(pseudoProperties))
            for (const property of required) if (!transitions.some(animation =>
              animation.transitionProperty === property && animation.effect.pseudoElement === pseudoElement))
              throw new Error(`Missing ${name}${pseudoElement} ${property} transition`);
          for (const animation of transitions) {
            const timing = animation.effect.getTiming();
            // Visibility may have a deliberate zero-duration delayed transition;
            // it is not motion. Required properties must still animate.
            const required = animation.effect.pseudoElement ? pseudoProperties[animation.effect.pseudoElement] ?? [] : properties;
            if (timing.duration === 0 && !required.includes(animation.transitionProperty)) continue;
            const detail = { target: name, property: animation.transitionProperty, playState: animation.playState,
              pseudoElement: animation.effect.pseudoElement,
              duration: timing.duration, easing: timing.easing, currentTime: animation.currentTime };
            if (animation.playState !== 'running' || !(timing.duration > 0) || !Number.isFinite(timing.duration))
              throw new Error(`Motion must be finite and running: ${JSON.stringify(detail)}`);
            if (duration !== undefined && timing.duration !== duration)
              throw new Error(`Unexpected motion duration: ${JSON.stringify(detail)}`);
            if (easing !== undefined && timing.easing !== easing)
              throw new Error(`Unexpected motion easing: ${JSON.stringify(detail)}`);
            captured.push({ animation, detail });
          }
        }
        if (!captured.length) throw new Error('No CSS transitions were created');
        captured.forEach(({ animation }) => animation.pause());
        const frames = [0, .25, .5, 1].map(progress => {
          for (const { animation, detail } of captured) animation.currentTime = detail.duration * progress;
          return { progress, ...read() };
        });
        finish({ value: { label, before, frames, transitions: captured.map(({ detail }) => detail),
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          visibility: document.visibilityState } });
      } catch (error) {
        finish({ error: `${label}: ${error.message}; state=${JSON.stringify(read())}` });
      } finally {
        // Restore playback immediately, before the 260ms retained-close timer.
        for (const { animation, detail } of captured) {
          animation.currentTime = detail.currentTime;
          animation.play();
        }
      }
    });
    timer = setTimeout(() => finish({ error: `${label}: motion state did not change; state=${JSON.stringify(read())}` }), timeoutMs);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
      attributeFilter: [...new Set(['class', 'style', 'data-width', 'aria-hidden', state.attribute].filter(Boolean))] });
  }, { key, options });
  try {
    await action();
    const outcome = await page.evaluate(key => globalThis.desktopMotionSamples.get(key).result, key);
    if (outcome.error) throw new Error(outcome.error);
    console.log('CSS motion sample:', JSON.stringify(outcome.value));
    return outcome.value;
  } finally {
    await page.evaluate(key => {
      const samples = globalThis.desktopMotionSamples;
      samples?.get(key)?.cancel(); samples?.delete(key);
    }, key);
  }
}
