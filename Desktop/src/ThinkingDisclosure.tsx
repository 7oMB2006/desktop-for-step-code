import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Brain } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { ProcessRowLabel } from './ProcessRowLabel';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';

export function ThinkingDisclosure({ autoOpen, running, preview, resetKey, index, label, elapsed, children, onLayoutChange, onExpandedChange }: {
  autoOpen: boolean; running?: boolean; preview?: string; resetKey?: string; index: number; label: string; elapsed?: ReactNode; children: ReactNode; onLayoutChange?: () => void; onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(autoOpen);
  const [visited, setVisited] = useState(autoOpen);
  const { details, body } = useAnimatedDisclosure(expanded, onLayoutChange);
  useEffect(() => {
    setExpanded(autoOpen);
    if (autoOpen) setVisited(true);
  }, [autoOpen, resetKey]);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) setExpanded(false);
    wasRunning.current = running;
  }, [running]);
  return <details className="thinking" ref={details} data-message-index={index} data-expanded={expanded} data-running={running || undefined}>
    <summary onClick={event => { event.preventDefault(); setVisited(true); setExpanded(!expanded); onExpandedChange?.(!expanded); }} aria-expanded={expanded}>
      <Brain size={14} aria-hidden="true"/><ProcessRowLabel label={label} running={Boolean(running)}/>{elapsed}
      <span className="thinking-chevron"><DisclosureChevron/></span>
      {!expanded && preview && <span className="thinking-preview">{preview}</span>}
    </summary>
    <div ref={body} className="thinking-body" aria-hidden={!expanded} inert={!expanded}>{visited && children}</div>
  </details>;
}
