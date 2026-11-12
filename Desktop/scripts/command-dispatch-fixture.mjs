export function taskSectionIsRevealed(element) {
  if (!element || element !== element.ownerDocument.activeElement) return false;
  const container = element.closest('.summary-content');
  if (!container) return false;
  const heading = element.getBoundingClientRect(), viewport = container.getBoundingClientRect();
  return heading.top >= viewport.top && heading.bottom <= viewport.bottom;
}

export async function prepareDispatchInput(page, input, text, timeout = 5000) {
  await input.fill(text);
  const handle = await input.elementHandle();
  if (!handle) throw new Error('Composer input is not mounted');
  let phase = 'editor readiness';
  try {
    // contenteditable fill can return before ProseMirror and React commit.
    await page.waitForFunction(({ element, text }) => element.isConnected
      && element.ownerDocument.activeElement === element && element.value === text
      && element.dataset.empty === String(!text), { element: handle, text }, { timeout });
    const command = /(?:^|\s)\/([^\s@/]+)$/u.exec(text);
    phase = 'completion readiness';
    if (command) {
      await page.locator('.composer-discovery[data-mode="commands"]')
        .getByText(`/${command[1]}`, { exact: true }).waitFor({ timeout });
    }
    phase = 'completion dismissal';
    // Locator.press can refocus inactive native editors and reopen completion.
    await page.keyboard.press('Escape');
    await page.waitForFunction(({ element, text }) => element.value === text
      && element.getAttribute('aria-expanded') === 'false'
      && !element.closest('.composer-menu-anchor')?.querySelector('.composer-discovery'),
    { element: handle, text }, { timeout });
  } catch (error) {
    const state = await input.evaluate(element => {
      const document = element.ownerDocument, active = document.activeElement;
      return { value: element.value, domText: element.textContent, empty: element.dataset.empty,
        expanded: element.getAttribute('aria-expanded'), connected: element.isConnected,
        focused: active === element, documentFocused: document.hasFocus(),
        activeElement: active && { tag: active.tagName, className: active.className },
        menu: element.closest('.composer-menu-anchor')?.querySelector('.composer-discovery')?.textContent,
        theme: document.documentElement.dataset.theme, language: document.documentElement.lang,
        viewport: { width: innerWidth, height: innerHeight } };
    }).catch(() => ({ unavailable: true }));
    console.error('Command dispatch input did not settle:', JSON.stringify({ phase, expected: text, ...state }));
    throw error;
  } finally {
    await handle.dispose();
  }
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
      const active = element.ownerDocument.activeElement;
      const input = element.ownerDocument.querySelector('.composer > .composer-input');
      return { focused: element === document.activeElement, heading: { top: rect.top, bottom: rect.bottom },
        viewport: viewport && { top: viewport.top, bottom: viewport.bottom },
        connected: element.isConnected,
        activeElement: active && { tag: active.tagName, id: active.id, className: active.className,
          role: active.getAttribute('role') },
        composer: input && { value: input.value, expanded: input.getAttribute('aria-expanded') } };
    }).catch(() => ({ detached: true }));
    console.error('Task section reveal did not settle:', JSON.stringify(state));
    throw error;
  } finally {
    await handle.dispose();
  }
}
