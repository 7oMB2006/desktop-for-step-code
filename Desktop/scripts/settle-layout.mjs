// Geometry fixtures must observe rendered animation completion. Wall-clock sleeps
// can finish while an unfocused native window has not rendered its entrance yet.
export async function settleLayout(locator, { includeParents = true } = {}) {
  await locator.evaluate(async (element, includeParents) => {
    await document.fonts.ready;
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await frame();
    for (;;) {
      // Reading style flushes newly mounted CSS animations before collecting them.
      getComputedStyle(element).transform;
      const candidates = new Set(element.getAnimations({ subtree: true }));
      // An ancestor transform can move the target even if the target is still.
      if (includeParents) for (let parent = element.parentElement; parent; parent = parent.parentElement)
        for (const animation of parent.getAnimations()) candidates.add(animation);
      const animations = [...candidates].filter(animation =>
        animation.playState !== 'finished'
        && Number.isFinite(animation.effect?.getComputedTiming().endTime));
      if (!animations.length) break;
      await Promise.all(animations.map(animation => animation.finished.catch(error => {
        // A replaced/cancelled animation has no remaining geometry to await.
        // Propagate any other error; geometry assertions belong to the caller.
        if (error?.name !== 'AbortError') throw error;
      })));
      await frame();
    }
    await frame();
    await frame();
  }, includeParents);
}
