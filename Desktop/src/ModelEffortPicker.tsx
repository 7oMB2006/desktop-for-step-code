import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import type { Model } from './contracts';

const DRAG_THRESHOLD = 0.62;
const THUMB_SIZE = 38;
const FADER_HEIGHT = 228;
const EFFORT_COLORS = ['#FFDC62', '#FFD083', '#FDB3A2', '#E7A1CF', '#D58FEF', '#BB81F5', '#9E72FB'];

const labels: Record<string, string> = {
  off: '关闭',
  minimal: '极简',
  low: '轻度',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};

export function effortLabel(level: string, language: 'zh' | 'en'): string {
  return language === 'zh' ? labels[level] ?? level : level;
}

export function draggedEffortIndex(start: number, distanceInSteps: number, count: number): number {
  if (count < 1) return 0;
  const crossed = Math.max(0, Math.floor(Math.abs(distanceInSteps) + 1 - DRAG_THRESHOLD));
  return Math.max(0, Math.min(count - 1, start + Math.sign(distanceInSteps) * crossed));
}

export function wheeledEffortIndex(start: number, deltaY: number, count: number): number {
  return Math.max(0, Math.min(count - 1, start - Math.sign(deltaY)));
}

function AnimatedEffortLevel({ level, index, color, language }: { level: string; index: number; color: string; language: 'zh' | 'en' }) {
  const label = level ? effortLabel(level, language) : '';
  const [display, setDisplay] = useState({
    current: { level, index, label, color },
    outgoing: null as { level: string; index: number; label: string; color: string } | null,
    direction: 1,
    revision: 0,
  });
  useLayoutEffect(() => {
    setDisplay(previous => {
      if (previous.current.level === level && previous.current.index === index && previous.current.label === label && previous.current.color === color) return previous;
      return { current: { level, index, label, color }, outgoing: previous.current, direction: index < previous.current.index ? -1 : 1, revision: previous.revision + 1 };
    });
  }, [level, index, label, color]);
  useEffect(() => {
    if (!display.outgoing) return;
    const timer = window.setTimeout(() => setDisplay(previous =>
      previous.revision === display.revision ? { ...previous, outgoing: null } : previous), 380);
    return () => window.clearTimeout(timer);
  }, [display.revision, display.outgoing]);
  return <span className="model-effort-heading-level">
    <span className="model-effort-heading-level-stage" style={{
      '--effort-travel': display.direction > 0 ? '.8em' : '-.8em',
      '--effort-origin': display.direction > 0 ? '-.2em' : '.2em',
      '--effort-settle': display.direction > 0 ? '.2em' : '-.2em',
    } as CSSProperties}>
      {display.outgoing && <span key={`out-${display.revision}`} className="model-effort-heading-level-item model-effort-heading-level-outgoing" style={{ '--effort-color': display.outgoing.color } as CSSProperties} aria-hidden="true">{display.outgoing.label}</span>}
      <span key={`in-${display.revision}`} className={`model-effort-heading-level-item model-effort-heading-level-current${display.revision ? ' model-effort-heading-level-entering' : ''}`} style={{ '--effort-color': display.current.color } as CSSProperties}>{display.current.label}</span>
    </span>
  </span>;
}

interface Props {
  model?: Model;
  models: Model[];
  level?: string;
  levels: string[];
  language: 'zh' | 'en';
  disabled: boolean;
  onModel: (model: Model) => Promise<unknown>;
  onEffort: (level: string) => Promise<unknown>;
}

export function ModelEffortPicker({ model, models, level, levels, language, disabled, onModel, onEffort }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'effort' | 'models'>('effort');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [pressure, setPressure] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fader = useRef<HTMLDivElement>(null);
  const faderColumn = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; startIndex: number } | null>(null);
  const wheel = useRef({ distance: 0, lastEvent: 0, lastStep: 0 });
  const submitted = useRef<string | undefined>(undefined);
  const zh = language === 'zh';
  const modelName = model?.name || model?.id || (zh ? '选择模型' : 'Select model');
  const activeLevel = level && levels.includes(level) ? level : levels[0];
  const currentIndex = Math.max(0, levels.indexOf(activeLevel ?? ''));
  useEffect(() => {
    if (!drag.current) { setPreviewIndex(currentIndex); setPressure(0); }
    submitted.current = undefined;
  }, [currentIndex, model?.id, model?.provider]);
  const previewLevel = levels[previewIndex] ?? activeLevel;
  const effortColor = EFFORT_COLORS[Math.round(previewIndex / Math.max(1, levels.length - 1) * (EFFORT_COLORS.length - 1))];
  const position = (index: number) => levels.length > 1 ? index / (levels.length - 1) * 100 : 0;
  const fillHeight = (THUMB_SIZE / 2 + position(previewIndex) / 100 * (FADER_HEIGHT - THUMB_SIZE)) / FADER_HEIGHT * 100;
  const commitEffort = (index: number) => {
    const next = levels[index];
    if (next && next !== level && next !== submitted.current) {
      submitted.current = next;
      void onEffort(next);
    }
  };
  const moveFader = (clientY: number) => {
    if (!drag.current || !fader.current || levels.length < 2) return previewIndex;
    const step = (fader.current.getBoundingClientRect().height - THUMB_SIZE) / (levels.length - 1);
    const distance = (drag.current.startY - clientY) / step;
    const index = draggedEffortIndex(drag.current.startIndex, distance, levels.length);
    setPreviewIndex(index);
    setPressure(Math.max(-9, Math.min(9, (distance - index + drag.current.startIndex) * 12)));
    return index;
  };
  const stopFader = (pointerId: number, clientY?: number) => {
    if (drag.current?.pointerId !== pointerId) return;
    const index = clientY === undefined ? currentIndex : moveFader(clientY);
    drag.current = null;
    setPressure(0);
    setPreviewIndex(index);
    if (clientY !== undefined) commitEffort(index);
  };
  const onFaderKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const changes: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 1, PageDown: -1 };
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? levels.length - 1
      : event.key in changes ? Math.max(0, Math.min(levels.length - 1, previewIndex + changes[event.key])) : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setPreviewIndex(next);
    setPressure(0);
    commitEffort(next);
  };
  useEffect(() => {
    const column = faderColumn.current;
    if (!open || view !== 'effort' || levels.length < 2 || !column) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (drag.current) return;
      const now = performance.now();
      const state = wheel.current;
      if (now - state.lastEvent > 220) state.distance = 0;
      state.lastEvent = now;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1);
      if (Math.sign(state.distance) !== Math.sign(pixels)) state.distance = 0;
      state.distance += pixels;
      if (Math.abs(state.distance) < 70 || now - state.lastStep < 110) return;
      const next = wheeledEffortIndex(previewIndex, state.distance, levels.length);
      state.distance = 0;
      state.lastStep = now;
      if (next !== previewIndex) { setPreviewIndex(next); commitEffort(next); }
    };
    column.addEventListener('wheel', onWheel, { passive: false });
    return () => column.removeEventListener('wheel', onWheel);
  }, [open, view, levels, previewIndex, level]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setOpen(false); setView('effort'); }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); setView('effort'); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => { if (disabled) { setOpen(false); setView('effort'); drag.current = null; } }, [disabled]);

  const chooseModel = async (next: Model) => {
    if (next.provider !== model?.provider || next.id !== model.id) await onModel(next);
    setView('effort');
  };
  return <div className="model-effort" ref={root}>
    <button ref={trigger} type="button" className="model-effort-trigger" aria-label={zh ? '模型与思考强度' : 'Model and thinking level'} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={() => { setOpen(value => !value); setView('effort'); }}>
      <span className="model-effort-name">{modelName}</span>
      {level && <span className="model-effort-level">{effortLabel(level, language)}</span>}
    </button>
    {open && <div className={`model-effort-popover ${view === 'effort' ? 'effort-view' : 'models-view'}`} style={{ '--effort-color': effortColor } as CSSProperties} role="dialog" aria-label={zh ? '模型与思考强度' : 'Model and thinking level'}>
      <div className="model-effort-panel model-effort-effort-panel" inert={view !== 'effort'} aria-hidden={view !== 'effort'}>
        <div className="model-effort-info">
          <button type="button" className="model-effort-heading" onClick={() => setView('models')} aria-label={zh ? '选择模型' : 'Select model'}>
            <span className="model-effort-heading-copy"><span className="model-effort-heading-name">{modelName}</span><AnimatedEffortLevel level={previewLevel ?? ''} index={previewIndex} color={effortColor} language={language}/></span>
          </button>
          <div className="model-effort-details-space" aria-hidden="true" />
        </div>
        <div className="model-effort-fader-column" ref={faderColumn}>
          {levels.length ? <div ref={fader} className={`model-effort-fader${levels.length > 1 && previewIndex === levels.length - 1 ? ' is-max' : ''}`} role="slider" tabIndex={levels.length > 1 ? 0 : -1} aria-disabled={levels.length < 2} aria-label={zh ? '思考强度' : 'Thinking level'} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={levels.length - 1} aria-valuenow={previewIndex} aria-valuetext={previewLevel ? effortLabel(previewLevel, language) : ''} onKeyDown={onFaderKey}
            onPointerDown={event => {
              if (event.button !== 0 || drag.current || levels.length < 2) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { pointerId: event.pointerId, startY: event.clientY, startIndex: previewIndex };
            }}
            onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) moveFader(event.clientY); }}
            onPointerUp={event => stopFader(event.pointerId, event.clientY)}
            onPointerCancel={event => stopFader(event.pointerId)}>
            <div className="model-effort-fader-well"><span className="model-effort-fader-fill" style={{ height: `calc(${fillHeight}% + ${pressure * .6}px)` }}>
              {levels.length > 1 && previewIndex === levels.length - 1 && Array.from({ length: 9 }, (_, index) => <span className="model-effort-fader-pixel" key={index} />)}
            </span></div>
            <div className="model-effort-fader-travel">
              {levels.map((value, index) => <span className="model-effort-fader-tick" key={value} style={{ bottom: `${position(index)}%` }}/>)}
              <span className="model-effort-fader-thumb" style={{ bottom: `${position(previewIndex)}%`, '--pressure': `${-pressure}px`, '--squeeze': `${Math.min(Math.abs(pressure) / 110, .08)}`, '--stretch': `${Math.min(Math.abs(pressure) / 65, .13)}` } as CSSProperties}><span className="model-effort-fader-grip"/></span>
            </div>
          </div> : <span className="model-effort-single">{activeLevel ? effortLabel(activeLevel, language) : zh ? '暂无可用档位' : 'No levels available'}</span>}
        </div>
      </div>
      <div className="model-effort-panel model-effort-models-panel" inert={view !== 'models'} aria-hidden={view !== 'models'}>
        <button type="button" className="model-effort-back" onClick={() => setView('effort')}><ChevronLeft size={16}/>{zh ? '选择模型' : 'Select model'}</button>
        <div className="model-effort-list" role="listbox" aria-label={zh ? '模型' : 'Models'}>
          {models.length === 0 && <span className="model-effort-single">{zh ? '暂无可用模型' : 'No models available'}</span>}
          {models.map(item => <button type="button" role="option" aria-selected={item.provider === model?.provider && item.id === model.id} key={`${item.provider}/${item.id}`} onClick={() => void chooseModel(item)}><span>{item.name || item.id}</span>{item.provider === model?.provider && item.id === model.id && <Check size={16}/>}</button>)}
        </div>
      </div>
    </div>}
  </div>;
}
