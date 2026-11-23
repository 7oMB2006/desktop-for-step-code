import { Component, createRef, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';

export function useComposerChipPresence(visible: boolean) {
  const [present, setPresent] = useState(visible);
  if (visible && !present) setPresent(true);
  useLayoutEffect(() => {
    if (!visible && matchMedia('(prefers-reduced-motion: reduce)').matches) setPresent(false);
  }, [visible]);
  useEffect(() => {
    if (visible || !present) return;
    const timer = setTimeout(() => setPresent(false), 200);
    return () => clearTimeout(timer);
  }, [visible, present]);
  return visible || present;
}

export function ComposerPreparationStatus({ active, label }: { active: boolean; label: string }) {
  if (!useComposerChipPresence(active)) return null;
  return <div className={`composer-prepare-status${active ? '' : ' is-leaving'}`} aria-hidden="true">
    <span className="composer-context-chip"><span className="working-dot"/>{label}</span>
  </div>;
}

// Capture the live visual position before React changes the row's layout.
export class ComposerContextBar extends Component<{ queued: boolean; children: ReactNode }> {
  private root = createRef<HTMLDivElement>();
  private animation?: Animation;
  private destination?: number;
  getSnapshotBeforeUpdate() { return this.root.current?.querySelector('.live-turn-context')?.getBoundingClientRect().x ?? null; }
  componentDidUpdate(previous: Readonly<{ queued: boolean; children: ReactNode }>, _state: unknown, from: number | null) {
    const element = this.root.current?.querySelector<HTMLElement>('.live-turn-context');
    if (element) {
      const offset = parseFloat(getComputedStyle(element).translate) || 0;
      const destination = element.getBoundingClientRect().x - offset;
      if (previous.queued === this.props.queued && this.destination !== undefined && Math.abs(destination - this.destination) < .5) return;
      this.destination = destination;
    } else this.destination = undefined;
    this.animation?.cancel();
    if (!element || from === null || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const distance = from - element.getBoundingClientRect().x;
    if (Math.abs(distance) < .5) return;
    this.animation = element.animate([{ translate: `${distance}px 0` }, { translate: '0px 0' }],
      { duration: 240, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  }
  componentWillUnmount() { this.animation?.cancel(); }
  render() {
    return <div ref={this.root} className={`composer-context-bar${this.props.queued ? ' has-queue' : ''}`} role="group" aria-label="Message context actions">{this.props.children}</div>;
  }
}
