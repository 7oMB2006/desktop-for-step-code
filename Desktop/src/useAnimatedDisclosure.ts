import { useEffect, useLayoutEffect, useRef } from 'react';

/** Keep native details open through the closing animation; hidden bodies are inert. */
export function useAnimatedDisclosure(expanded: boolean, onLayoutChange?: () => void) {
  const details = useRef<HTMLDetailsElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const animation = useRef<Animation | null>(null);
  const notify = useRef(onLayoutChange);
  useLayoutEffect(() => { notify.current = onLayoutChange; });
  useLayoutEffect(() => {
    const panel = details.current;
    const content = body.current;
    if (!panel || !content) return;
    const from = panel.open ? content.getBoundingClientRect().height : 0;
    const opacity = panel.open ? getComputedStyle(content).opacity : '0';
    animation.current?.cancel();
    animation.current = null;
    if (!initialized.current || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      initialized.current = true;
      panel.open = expanded;
      content.style.overflow = '';
      notify.current?.();
      return;
    }
    panel.open = true;
    content.style.overflow = 'hidden';
    const tween = content.animate(
      [{ height: `${from}px`, opacity }, { height: `${expanded ? content.scrollHeight : 0}px`, opacity: expanded ? 1 : 0 }],
      { duration: 240, easing: 'cubic-bezier(.215, .61, .355, 1)', fill: 'both' },
    );
    animation.current = tween;
    void tween.finished.then(() => {
      if (animation.current !== tween) return;
      panel.open = expanded;
      tween.cancel();
      animation.current = null;
      content.style.overflow = '';
      notify.current?.();
    }).catch(() => {});
  }, [expanded]);
  useEffect(() => () => animation.current?.cancel(), []);
  return { details, body };
}
