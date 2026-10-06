import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function ThinkingDisclosure({ autoOpen, index, label, elapsed, children, onLayoutChange }: {
  autoOpen: boolean; index: number; label: string; elapsed?: ReactNode; children: ReactNode; onLayoutChange?: () => void;
}) {
  const [expanded, setExpanded] = useState(autoOpen);
  const previousAuto = useRef(autoOpen);
  const initialized = useRef(false);
  const details = useRef<HTMLDetailsElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const notify = useRef(onLayoutChange);
  useLayoutEffect(() => { notify.current = onLayoutChange; });
  useEffect(() => {
    if (previousAuto.current !== autoOpen) {
      previousAuto.current = autoOpen;
      setExpanded(autoOpen);
    }
  }, [autoOpen]);
  useLayoutEffect(() => {
    const panel = details.current!;
    const content = body.current!;
    const from = panel.open ? content.getBoundingClientRect().height : 0;
    animation.current?.cancel();
    if (!initialized.current || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      initialized.current = true;
      panel.open = expanded;
      content.style.overflow = '';
      notify.current?.();
      return;
    }
    panel.open = true;
    content.style.overflow = 'hidden';
    const to = expanded ? content.scrollHeight : 0;
    const tween = content.animate(
      [{ height: `${from}px`, opacity: expanded ? 0 : 1 }, { height: `${to}px`, opacity: expanded ? 1 : 0 }],
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
  useEffect(() => () => {
    animation.current?.cancel();
  }, []);
  return <details className="thinking" ref={details} data-message-index={index} data-expanded={expanded}>
    <summary onClick={event => { event.preventDefault(); setExpanded(value => !value); }} aria-expanded={expanded}>
      <ChevronRight size={13} className="disclosure-chevron"/>{label}{elapsed}
    </summary>
    <div ref={body} className="thinking-body" aria-hidden={!expanded} inert={!expanded}>{children}</div>
  </details>;
}
