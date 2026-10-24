import { useId, type CSSProperties, type ReactNode } from 'react';
import { formatElapsedDuration } from './elapsed-time';
import './working-indicator.css';

const ring = [0, 1, 2, 5, 8, 7, 6, 3];
const base = new Set([1, 2, 4, 6, 7]);
const compressionFrames = [[1, 2, 3, 5], [4, 5, 6, 8], [7, 8, 9], [2]];

export type WorkingMode = 'thinking' | 'executing' | 'waiting' | 'responding' | 'compacting';

export function MatrixPulse({ mode = 'executing' }: { mode?: WorkingMode }) {
  const gradient = useId();
  return <svg className="matrix-pulse" data-mode={mode} width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <defs><linearGradient id={gradient} x1="18" y1="0" x2="0" y2="18" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#9E72FB"/><stop offset="34%" stopColor="#D58FEF"/><stop offset="68%" stopColor="#FDB3A2"/><stop offset="100%" stopColor="#FFDC62"/>
    </linearGradient></defs>
    <g className={`matrix-layer matrix-executing${mode === 'executing' ? ' is-active' : ''}`}>
    {Array.from({ length: 9 }, (_, cell) => {
      const phases = Object.fromEntries(Array.from({ length: 8 }, (_, step) => [`--phase-${step}`, cell === 4 || base.has(ring[(ring.indexOf(cell) - step + 8) % 8]) ? 1 : 0.08]));
      return <rect key={cell} className={`matrix-pixel${base.has(cell) ? ' is-base' : ''}`} x={(cell % 3) * 6} y={Math.floor(cell / 3) * 6}
        width="4.5" height="4.5" fill={`url(#${gradient})`} style={phases as CSSProperties}/>;
    })}</g>
    <g className={`matrix-layer matrix-thinking${mode === 'thinking' ? ' is-active' : ''}`}>
      {ring.map((cell, index) => {
        const phases = Object.fromEntries(Array.from({ length: 8 }, (_, step) => {
          const behind = (step - index + 8) % 8;
          return [`--phase-${step}`, behind === 0 ? 1 : behind === 1 ? .5 : behind === 2 ? .2 : .06];
        }));
        return <rect key={cell} className="matrix-orbit-pixel" x={(cell % 3) * 6} y={Math.floor(cell / 3) * 6}
          width="4.5" height="4.5" fill={`url(#${gradient})`} style={phases as CSSProperties}/>;
      })}
    </g>
    <g className={`matrix-layer matrix-waiting${mode === 'waiting' ? ' is-active' : ''}`}>
      <g className="matrix-waiting-breath">
      {[0, 2, 3, 5, 6, 8].map(cell => <rect key={cell} x={(cell % 3) * 6} y={Math.floor(cell / 3) * 6}
        width="4.5" height="4.5" fill={`url(#${gradient})`}/>)}
      </g>
    </g>
    <g className={`matrix-layer matrix-responding${mode === 'responding' ? ' is-active' : ''}`}>
      {[4, 1, 3, 5, 7].map(cell => <rect key={cell} className={`matrix-response-pixel${cell === 4 ? ' is-center' : ''}`}
        x={(cell % 3) * 6} y={Math.floor(cell / 3) * 6}
        width="4.5" height="4.5" fill={`url(#${gradient})`}/>)}
    </g>
    <g className={`matrix-layer matrix-compacting${mode === 'compacting' ? ' is-active' : ''}`}>
      {Array.from({ length: 9 }, (_, cell) => <rect key={cell} className="matrix-compression-pixel"
        x={(cell % 3) * 6} y={Math.floor(cell / 3) * 6} width="4.5" height="4.5" fill={`url(#${gradient})`}
        style={Object.fromEntries(compressionFrames.map((frame, i) => [`--frame-${i}`, frame.includes(cell + 1) ? 1 : .06])) as CSSProperties}/>)}
    </g>
  </svg>;
}

export function WorkingIndicator({ children, elapsedMs, mode = 'executing', language }: {
  children: ReactNode; elapsedMs?: number; mode?: WorkingMode; language: 'zh' | 'en';
}) {
  const time = elapsedMs === undefined ? undefined : formatElapsedDuration(elapsedMs, language);
  return <span className="working-indicator"><MatrixPulse mode={mode}/><span className="working-text">{children}
    {time !== undefined && <span className="working-elapsed" data-tooltip={language === 'zh' ? '本轮总耗时，包含工具执行与等待' : 'Total run duration, including tools and waits'}>
      {language === 'zh' ? '总耗时 ' : 'Total '}{time}
    </span>}</span>
  </span>;
}
