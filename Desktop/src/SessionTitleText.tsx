import { useLayoutEffect, useRef } from 'react';

export function SessionTitleText({ sessionId, title, automaticTitle, className, tooltip }: {
  sessionId?: string; title: string; automaticTitle?: string; className?: string; tooltip?: string;
}) {
  const committed = useRef<{ sessionId?: string; title: string }>(undefined);
  const currentText = useRef<HTMLSpanElement>(null);
  const outgoingText = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const previous = committed.current;
    committed.current = { sessionId, title };
    if (!sessionId || previous?.sessionId !== sessionId || previous.title === title || automaticTitle !== title) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const outgoing = outgoingText.current, current = currentText.current;
    if (media.matches || !outgoing || !current) return;
    outgoing.dataset.title = previous.title;
    const fadeOut = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 180, easing: 'cubic-bezier(.25, .65, .4, 1)', fill: 'forwards',
    });
    const fadeIn = current.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 240, easing: 'cubic-bezier(.25, .65, .4, 1)',
    });
    const clear = () => {
      delete outgoing.dataset.title;
      fadeOut.cancel();
      fadeIn.cancel();
      media.removeEventListener('change', clear);
    };
    media.addEventListener('change', clear);
    void fadeIn.finished.then(clear, () => {});
    return clear;
  }, [sessionId, title, automaticTitle]);
  return <span className={className ? `session-title-text ${className}` : 'session-title-text'} data-tooltip={tooltip}>
    <span ref={outgoingText} className="session-title-outgoing" aria-hidden="true"/>
    <span ref={currentText} className="session-title-current">{title}</span>
  </span>;
}
