import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import './subagent-status.css';

export type SubagentStatus = 'running' | 'done' | 'failed';
const cubicIn = 'cubic-bezier(.55, .055, .675, .19)';
const cubicOut = 'cubic-bezier(.215, .61, .355, 1)';

export function SubagentStatusIcon({ state }: { state: SubagentStatus }) {
  const slot = useRef<HTMLSpanElement>(null);
  const previous = useRef(state);
  const [settling, setSettling] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    const complete = previous.current === 'running' && state === 'done';
    previous.current = state;
    setSettling(false);
    if (!complete || reduced) return;
    const mark = slot.current!;
    const spinner = mark.querySelector<HTMLElement>('.subagent-status-spinner')!;
    const circle = mark.querySelector<SVGElement>('.subagent-status-check')!;
    const check = circle.querySelector('path')!;
    check.setAttribute('pathLength', '1');
    setSettling(true);
    // The ring contracts for 180ms, holds for 70ms, then regrows for 210ms.
    // Its fixed slot stays put; only after regrowth does the check write itself.
    const scale = mark.animate([
      { transform: 'scale(1)', offset: 0, easing: cubicOut },
      { transform: 'scale(.18)', offset: 180 / 660, easing: 'linear' },
      { transform: 'scale(.18)', offset: 250 / 660, easing: cubicIn },
      { transform: 'scale(1)', offset: 460 / 660 },
      { transform: 'scale(1)', offset: 1 },
    ], { duration: 660, fill: 'both' });
    const fadeOut = spinner.animate([{ opacity: 1 }, { opacity: 0 }],
      { delay: 180, duration: 70, fill: 'both' });
    const fadeIn = circle.animate([{ opacity: 0 }, { opacity: 1 }],
      { delay: 180, duration: 70, fill: 'both' });
    const draw = check.animate([{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }],
      { delay: 460, duration: 200, easing: cubicOut, fill: 'both' });
    let cancelled = false;
    void draw.finished.then(() => { if (!cancelled) setSettling(false); }).catch(() => {});
    return () => {
      cancelled = true;
      [scale, fadeOut, fadeIn, draw].forEach(animation => animation.cancel());
    };
  }, [state, reduced]);
  return <span ref={slot} className="subagent-status-icon" data-state={state} data-settling={settling} aria-hidden="true">
    <span className="subagent-status-spinner"><LoaderCircle size={16} strokeWidth={1.9}/></span>
    <CircleCheck className="subagent-status-check" size={16} strokeWidth={1.9}/>
    {state === 'failed' && <CircleAlert size={16} strokeWidth={1.9}/>}
  </span>;
}
