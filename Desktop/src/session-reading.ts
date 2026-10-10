import type { Message, ModelChange, Session } from './contracts';

export interface ReadingPosition {
  follow: boolean;
  top: number;
  anchor?: { entryId?: string; index: number; role: string; timestamp?: number; offset: number };
}
export interface SessionReading {
  sessionId: string;
  messages: Message[];
  modelChanges?: ModelChange[];
}

/** A bounded, disposable reading cache. No runtime, credentials, approvals or actions. */
export class SessionReadingCache {
  private entries = new Map<string, { reading: SessionReading; modified: string; count: number; bytes: number }>();
  private bytes = 0;
  constructor(private maxEntries = 6, private maxBytes = 12 * 1024 * 1024) {}
  set(session: Session, messages: Message[], modelChanges?: ModelChange[]) {
    this.delete(session.id);
    const bytes = (JSON.stringify(messages).length + JSON.stringify(modelChanges ?? []).length) * 2;
    if (bytes > this.maxBytes) return;
    this.entries.set(session.id, {
      reading: { sessionId: session.id, messages: structuredClone(messages), ...(modelChanges ? { modelChanges: structuredClone(modelChanges) } : {}) },
      modified: session.modified, count: session.messageCount, bytes,
    });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value!);
  }
  get(session: Session): SessionReading | undefined {
    const entry = this.entries.get(session.id);
    if (!entry) return;
    if (entry.modified !== session.modified || entry.count !== session.messageCount) {
      this.delete(session.id);
      return;
    }
    this.entries.delete(session.id);
    this.entries.set(session.id, entry);
    return entry.reading;
  }
  delete(id: string) {
    const entry = this.entries.get(id);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(id);
  }
  retain(sessions: Session[]) {
    const ids = new Set(sessions.map(session => session.id));
    for (const id of this.entries.keys()) if (!ids.has(id)) this.delete(id);
  }
}

export function captureReadingPosition(viewport: HTMLElement | null, messages: Message[], follow: boolean): ReadingPosition {
  const position: ReadingPosition = { follow, top: viewport?.scrollTop ?? 0 };
  if (!viewport || follow) return position;
  const top = viewport.getBoundingClientRect().top;
  const article = [...viewport.querySelectorAll<HTMLElement>('.messages > article[data-message-index]')]
    .find(element => element.getBoundingClientRect().bottom > top);
  const index = Number(article?.dataset.messageIndex);
  const message = messages[index];
  if (article && message) position.anchor = {
    entryId: message.entryId, index, role: message.role, timestamp: message.timestamp,
    offset: article.getBoundingClientRect().top - top,
  };
  return position;
}

export function restoreReadingPosition(viewport: HTMLElement, messages: Message[], position: ReadingPosition) {
  if (position.follow) { viewport.scrollTop = viewport.scrollHeight; return; }
  const anchor = position.anchor;
  const index = anchor?.entryId ? messages.findIndex(message => message.entryId === anchor.entryId) : anchor?.index;
  const message = index === undefined ? undefined : messages[index];
  const article = index === undefined ? null
    : viewport.querySelector<HTMLElement>(`.messages > article[data-message-index="${index}"]`);
  if (anchor && article && message?.role === anchor.role && message.timestamp === anchor.timestamp) {
    viewport.scrollTop += article.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
  } else viewport.scrollTop = position.top;
}
