export function completionBadgeText(count: number): string {
  return count === 0 ? '' : count > 9 ? '9+' : String(count);
}

export class TaskbarBadge {
  private unread = new Set<string>();
  private applied?: number;

  constructor(private options: {
    foreground: (id: string) => boolean;
    archived: (id: string) => boolean;
    apply: (count: number) => boolean;
  }) {}

  complete(id: string) {
    if (!this.options.foreground(id) && !this.options.archived(id)) this.unread.add(id);
    this.sync();
  }

  clear(id: string) {
    this.unread.delete(id);
    this.sync();
  }

  sync(force = false) {
    for (const id of this.unread)
      if (this.options.foreground(id) || this.options.archived(id)) this.unread.delete(id);
    const count = this.unread.size;
    if (!force && this.applied === count) return;
    if (this.options.apply(count)) this.applied = count;
  }
}
