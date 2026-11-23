import type { FocusEvent } from 'react';

export function revealFocusedTextField(event: FocusEvent<HTMLElement>) {
  const field = event.target;
  if (field instanceof HTMLTextAreaElement
    || field instanceof HTMLSelectElement
    || field instanceof HTMLButtonElement && field.classList.contains('form-focus-trigger')
    || field instanceof HTMLInputElement && /^(text|search|url|password|number|email|tel|date|time)$/.test(field.type)) {
    // Native focus may scroll only to the caret, not the complete outline.
    field.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }
}
