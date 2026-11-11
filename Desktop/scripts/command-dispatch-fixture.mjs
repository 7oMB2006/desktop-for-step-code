export function taskSectionIsRevealed(element) {
  if (!element || element !== element.ownerDocument.activeElement) return false;
  const container = element.closest('.summary-content');
  if (!container) return false;
  const heading = element.getBoundingClientRect(), viewport = container.getBoundingClientRect();
  return heading.top >= viewport.top && heading.bottom <= viewport.bottom;
}

export async function waitForTaskSectionReveal(page, heading, timeout = 5000) {
  const handle = await heading.elementHandle();
  if (!handle) throw new Error('Task heading is not mounted');
  try {
    await page.waitForFunction(taskSectionIsRevealed, handle, { timeout });
  } catch (error) {
    const state = await heading.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const viewport = element.closest('.summary-content')?.getBoundingClientRect();
      return { focused: element === document.activeElement, heading: { top: rect.top, bottom: rect.bottom },
        viewport: viewport && { top: viewport.top, bottom: viewport.bottom },
        activeElement: document.activeElement?.tagName };
    }).catch(() => ({ detached: true }));
    console.error('Task section reveal did not settle:', JSON.stringify(state));
    throw error;
  } finally {
    await handle.dispose();
  }
}
