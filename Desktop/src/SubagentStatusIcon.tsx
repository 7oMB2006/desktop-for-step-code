import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Circle, CircleX, CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react';
import { StatusTooltip } from './StatusTooltip';
import './subagent-status.css';

export type SubagentStatus = 'pending' | 'running' | 'done' | 'failed' | 'stopped';
const cubicIn = 'cubic-bezier(.55, .055, .675, .19)';
const cubicOut = 'cubic-bezier(.215, .61, .355, 1)';

export function SubagentStatusIcon({ state, language = 'zh', detail }: { state: SubagentStatus; language?: 'zh' | 'en'; detail?: string }) {
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
    const complete = (previous.current === 'pending' || previous.current === 'running') && (state === 'done' || state === 'failed' || state === 'stopped');
    previous.current = state;
    setSettling(false);
    if (!complete || reduced) return;
    const mark = slot.current!;
    const spinner = mark.querySelector<HTMLElement>('.subagent-status-spinner')!;
    const circle = mark.querySelector<SVGElement>(state === 'done' ? '.subagent-status-check' : state === 'stopped' ? '.subagent-status-warning' : '.subagent-status-failure')!;
    const paths = [...circle.querySelectorAll('path')];
    paths.forEach(path => path.setAttribute('pathLength', '1'));
    setSettling(true);
    // The ring contracts for 180ms, holds for 70ms, then regrows for 210ms.
    // Its fixed slot stays put; the success/failure mark draws after regrowth.
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
    const draws = paths.map((path, index) => path.animate([{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }],
      { delay: 460 + index * 200 / paths.length, duration: 200 / paths.length, easing: cubicOut, fill: 'both' }));
    let cancelled = false;
    void Promise.all(draws.map(draw => draw.finished)).then(() => { if (!cancelled) setSettling(false); }).catch(() => {});
    return () => {
      cancelled = true;
      [scale, fadeOut, fadeIn, ...draws].forEach(animation => animation.cancel());
    };
  }, [state, reduced]);
  return <StatusTooltip state={state} language={language} detail={detail}><span ref={slot} className="subagent-status-icon" data-state={state} data-settling={settling} aria-hidden="true">
    {state === 'pending' && <Circle size={12} strokeWidth={1.5}/>}
    <span className="subagent-status-spinner"><LoaderCircle size={16} strokeWidth={1.9}/></span>
    <CircleCheck className="subagent-status-check" size={16} strokeWidth={1.9}/>
    <CircleX className="subagent-status-failure" size={16} strokeWidth={1.9}/>
    <TriangleAlert className="subagent-status-warning" size={16} strokeWidth={1.9}/>
  </span></StatusTooltip>;
}
