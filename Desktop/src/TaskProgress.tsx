import { useLayoutEffect, useRef } from 'react';
import { onTaskCompletion } from './completion-sound';
import './task-progress.css';

type ProgressProps = {
  runtimeId?: string; sessionId?: string; completed: number; total: number; busy: boolean; language: 'zh' | 'en';
};
const cubicOut = (t: number) => 1 - (1 - t) ** 3;

function completeProgress(root: HTMLDivElement, reduced: boolean) {
  const green = root.querySelector<HTMLElement>('.task-progress-green')!;
  const dust = root.querySelector<HTMLElement>('.task-progress-dust')!;
  const animations: Animation[] = [];
  let raf = 0;
  let stopped = false;
  const finish = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    animations.forEach(animation => animation.cancel());
    dust.replaceChildren();
    green.style.maskImage = 'none';
    root.dataset.phase = 'complete';
  };
  root.dataset.phase = 'settling';
  // A recent snapshot may still have a width transition. Finish only that transition.
  root.querySelector('.task-progress-fill')!.getAnimations().forEach(animation => animation.finish());
  if (reduced) { finish(); return finish; }
  animations.push(root.animate([
    { transform: 'translate(0, 0) scaleY(1)' },
    { transform: 'translate(2px, -2px) scaleY(1.45)', offset: .16 },
    { transform: 'translate(-1.5px, 1.4px) scaleY(1.15)', offset: .38 },
    { transform: 'translate(.8px, -.7px) scaleY(1.08)', offset: .62 },
    { transform: 'translate(-.3px, .3px) scaleY(1)', offset: .8 },
    { transform: 'translate(0, 0) scaleY(1)' },
  ].map(frame => ({ ...frame, easing: 'cubic-bezier(.33,0,.67,1)' })), { duration: 360 }));
  let emitted = 0;
  const emit = (index: number) => {
    const pixel = document.createElement('i');
    const side = index % 2 ? 1 : -1;
    const size = index % 3 === 0 ? 3 : 2;
    pixel.style.cssText = `left:${96 - index * 5.2}%;width:${size}px;height:${size}px;top:${side < 0 ? 0 : 2}px`;
    dust.append(pixel);
    const animation = pixel.animate([
      { opacity: 0, transform: 'translate(0, 0)' },
      { opacity: .72, offset: .12, transform: `translate(1px, ${side * 2}px)` },
      { opacity: .4, offset: .5, transform: `translate(5px, ${side * (5 + index % 3)}px)` },
      { opacity: 0, transform: `translate(${8 + index % 5}px, ${side * (9 + index % 4)}px)` },
    ], { duration: 420 + index % 4 * 55, easing: 'cubic-bezier(.215,.61,.355,1)' });
    animation.onfinish = () => pixel.remove();
    animations.push(animation);
  };
  const start = performance.now();
  const frame = (now: number) => {
    if (stopped) return;
    const t = Math.min(1, (now - start) / 1250);
    const sweep = cubicOut(t);
    const edge = (1 - sweep) * 100;
    green.style.maskImage = t === 1 ? 'none' : `linear-gradient(to right, transparent ${edge - 2}%, #000 ${edge + 2}%)`;
    while (emitted < 18 && sweep >= (4 + emitted * 5.2) / 100) emit(emitted++);
    if (t < 1) raf = requestAnimationFrame(frame);
    else { root.dataset.phase = 'complete'; }
  };
  // The first green pixel, impact and caller's sound start in the same event delivery.
  frame(start);
  return finish;
}

export function TaskProgress(props: ProgressProps) {
  const { completed, total, busy, language, runtimeId, sessionId } = props;
  const root = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  const stop = useRef<(() => void) | null>(null);
  const notified = useRef(false);
  const previousBusy = useRef(busy);
  useLayoutEffect(() => {
    current.current = props;
    if (!root.current) return;
    if (!total || completed !== total || busy && !previousBusy.current) {
      stop.current?.(); stop.current = null;
      notified.current = false;
      root.current.dataset.phase = 'running';
      root.current.querySelector<HTMLElement>('.task-progress-green')!.style.maskImage = '';
    } else if (!stop.current && !busy) {
      root.current.dataset.phase = 'complete';
    }
    previousBusy.current = busy;
  }, [completed, total, busy, runtimeId, sessionId]);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const settle = () => {
      if (document.hidden || media.matches) stop.current?.();
    };
    const unsubscribe = onTaskCompletion(scope => {
      const state = current.current;
      const element = root.current;
      if (!element || notified.current || scope.runtimeId !== state.runtimeId || scope.sessionId !== state.sessionId
        || !state.runtimeId || !state.sessionId || state.total === 0 || state.completed !== state.total) return;
      notified.current = true;
      if (document.hidden || !element.getClientRects().length) {
        element.dataset.phase = 'complete';
        return;
      }
      stop.current = completeProgress(element, media.matches);
    });
    document.addEventListener('visibilitychange', settle);
    media.addEventListener('change', settle);
    return () => {
      unsubscribe();
      stop.current?.();
      document.removeEventListener('visibilitychange', settle);
      media.removeEventListener('change', settle);
    };
  }, []);
  return <div ref={root} className="sb-task-progress" role="progressbar"
    aria-label={language === 'zh' ? '任务完成进度' : 'Task completion'} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}
    aria-valuetext={language === 'zh' ? `${completed} / ${total} 项完成` : `${completed} of ${total} completed`}>
    <div className="task-progress-track">
      <div className="task-progress-fill" style={{ width: `${total ? 100 * completed / total : 0}%` }}><div className="task-progress-current"/></div>
      <div className="task-progress-green"/>
    </div><div className="task-progress-dust" aria-hidden="true"/>
  </div>;
}
