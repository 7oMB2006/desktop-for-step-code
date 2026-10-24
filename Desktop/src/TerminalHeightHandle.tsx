import { useEffect, useRef } from 'react';

export function TerminalHeightHandle({ height, min, max, language, onPreview, onCommit, onDragging }: {
  height: number; min: number; max: number; language: 'zh' | 'en';
  onPreview: (height: number) => void; onCommit: (height: number) => void; onDragging: (active: boolean) => void;
}) {
  const drag = useRef<{ y: number; height: number; next: number } | null>(null);
  const clamp = (value: number) => Math.max(min, Math.min(max, Math.round(value)));
  useEffect(() => () => onDragging(false), [onDragging]);
  const cancel = () => {
    if (!drag.current) return;
    onPreview(drag.current.height); drag.current = null; onDragging(false);
  };
  return <div className="terminal-height-handle" role="separator" tabIndex={0} aria-orientation="horizontal"
    aria-label={language === 'zh' ? '调整终端高度' : 'Resize terminal height'} aria-controls="terminal-panel"
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={height}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancel(); return; }
      const next = event.key === 'ArrowUp' ? height + 20 : event.key === 'ArrowDown' ? height - 20
        : event.key === 'Home' ? min : event.key === 'End' ? max : undefined;
      if (next === undefined) return;
      event.preventDefault(); onPreview(clamp(next)); onCommit(clamp(next));
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { y: event.clientY, height, next: height };
      event.currentTarget.setPointerCapture(event.pointerId); onDragging(true);
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      drag.current.next = clamp(drag.current.height + drag.current.y - event.clientY);
      onPreview(drag.current.next);
    }}
    onPointerUp={() => {
      if (!drag.current) return;
      const next = drag.current.next;
      drag.current = null; onDragging(false); onCommit(next);
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
  ><span/></div>;
}
