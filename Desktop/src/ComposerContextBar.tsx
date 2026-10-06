import { Component, createRef } from 'react';
import type { ReactNode } from 'react';

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
