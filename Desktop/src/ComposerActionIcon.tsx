import React, { useId } from 'react';
import { ArrowUp, Square } from 'lucide-react';

const pixels = Array.from({ length: 144 }, (_, index) => ({
  x: index % 12,
  y: Math.floor(index / 12),
  order: (index * 53) % 144,
}));

export function ComposerActionIcon({ stop }: { stop: boolean }) {
  const mask = useId();
  return <svg className="composer-action-icon" data-mode={stop ? 'stop' : 'send'} viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
    <defs>
      {/* Keep the shared arrow underneath; a full square avoids mask-edge seams. */}
      <mask id={mask} x="0" y="0" width="24" height="24" maskUnits="userSpaceOnUse" style={{ maskType: 'luminance' }}>
        <Square size={24} fill="white" stroke="none"/>
      </mask>
    </defs>
    <ArrowUp className="action-pixel-shared" size={24} strokeWidth={2}/>
    <g mask={`url(#${mask})`} fill="currentColor">
      {pixels.map(({ x, y, order }) => <rect key={`${x}-${y}`} className="action-pixel action-pixel-p"
        x={x * 2} y={y * 2} width="2" height="2" shapeRendering="crispEdges"
        style={{ transitionDelay: `${(stop ? 50 : 0) + order * .8}ms` }}/>)}
    </g>
  </svg>;
}
