import assert from 'node:assert/strict';

export async function assertPersistentTurnStatus(trigger) {
  const presentation = await trigger.evaluate(element => {
    const style = getComputedStyle(element);
    return { shared: element.classList.contains('turn-status-trigger'),
      visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      pointerEvents: style.pointerEvents, height: style.height, gap: style.gap,
      padding: style.padding, radius: style.borderRadius, fontSize: style.fontSize,
      chevrons: element.querySelectorAll('.turn-status-chevron').length };
  });
  assert.deepEqual(presentation, { shared: true, visible: true, pointerEvents: 'auto',
    height: '24px', gap: '6px', padding: '2px 7px', radius: '4px', fontSize: '12px', chevrons: 1 },
  'Turn status stays visible and uses the shared trigger presentation without hover');
}
