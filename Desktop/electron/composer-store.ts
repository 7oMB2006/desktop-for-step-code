import { randomUUID } from 'node:crypto';
import { MAX_ANNOTATION_LENGTH, MAX_PROMPT_LENGTH, MAX_QUOTES, MAX_QUOTE_LENGTH, restoreQuotes } from '../src/chat-quotes';
import { composerKey, emptyComposer, type ComposerOwner, type ComposerReceipt, type ComposerSnapshot, type ComposerUpdate, type ComposerValue, type ComposerWrite } from '../src/window-conversation';

export function parseComposerOwner(value: unknown): ComposerOwner {
  if (!value || typeof value !== 'object') throw new Error('Invalid composer owner');
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  const key = keys[0];
  if (keys.length !== 1 || !['sessionId', 'draftId'].includes(key)
    || typeof input[key] !== 'string' || !input[key].length || input[key].length > 300)
    throw new Error('Invalid composer owner');
  return { [key]: input[key] } as ComposerOwner;
}
function parseValue(input: ComposerValue): ComposerValue {
  if (!input || typeof input.text !== 'string' || input.text.length > MAX_PROMPT_LENGTH
    || !Array.isArray(input.quotes) || input.quotes.length > MAX_QUOTES
    || !Array.isArray(input.attachments) || input.attachments.length > 10)
    throw new Error('Invalid composer value');
  const quotes = input.quotes.map(quote => {
    if (!quote || typeof quote.id !== 'string' || quote.id.length > 100
      || !['user', 'assistant'].includes(quote.role) || !Number.isSafeInteger(quote.messageIndex) || quote.messageIndex < 0
      || typeof quote.text !== 'string' || quote.text.length > MAX_QUOTE_LENGTH
      || typeof quote.markdown !== 'string' || quote.markdown.length > MAX_PROMPT_LENGTH
      || !Number.isSafeInteger(quote.startOffset) || quote.startOffset < 0
      || !Number.isSafeInteger(quote.endOffset) || quote.endOffset < quote.startOffset
      || quote.annotation !== undefined && (typeof quote.annotation !== 'string' || quote.annotation.length > MAX_ANNOTATION_LENGTH)
      || quote.entryId !== undefined && (typeof quote.entryId !== 'string' || quote.entryId.length > 300)
      || quote.sourceText !== undefined && (typeof quote.sourceText !== 'string' || quote.sourceText.length > MAX_PROMPT_LENGTH))
      throw new Error('Invalid composer quote');
    if (quote.origin !== undefined && quote.origin !== 'btw'
      || quote.blockIndex !== undefined && (!Number.isSafeInteger(quote.blockIndex) || quote.blockIndex < 0))
      throw new Error('Invalid composer quote source');
    return { id: quote.id, role: quote.role, messageIndex: quote.messageIndex, text: quote.text, markdown: quote.markdown,
      startOffset: quote.startOffset, endOffset: quote.endOffset, entryId: quote.entryId, sourceText: quote.sourceText,
      origin: quote.origin, blockIndex: quote.blockIndex, annotation: quote.annotation };
  });
  const attachments = input.attachments.map(attachment => {
    if (!attachment || typeof attachment.name !== 'string' || attachment.name.length > 255)
      throw new Error('Invalid composer attachment');
    if (attachment.kind === 'file') {
      if (typeof attachment.id !== 'string' || attachment.id.length > 100
        || !Number.isSafeInteger(attachment.size) || attachment.size < 0)
        throw new Error('Invalid composer file');
      return { kind: 'file' as const, id: attachment.id, name: attachment.name, size: attachment.size };
    }
    if (attachment.kind !== 'image' || attachment.content?.type !== 'image'
      || !['image/png', 'image/jpeg', 'image/webp'].includes(attachment.content.mimeType ?? '')
      || typeof attachment.content.data !== 'string' || attachment.content.data.length > 14_000_000)
      throw new Error('Invalid composer image');
    return { kind: 'image' as const, name: attachment.name, content: {
      type: 'image', mimeType: attachment.content.mimeType, data: attachment.content.data,
    } };
  });
  if (attachments.filter(item => item.kind === 'image').length > 5) throw new Error('Too many composer images');
  return { text: input.text, quotes, attachments };
}

/** Session-owned input, not runtime history. Every write and consume is compare-and-swap. */
export class ComposerStore {
  private records = new Map<string, ComposerSnapshot>();
  private aliases = new Map<string, ComposerOwner>();
  private receipts = new Map<string, { owner: ComposerOwner; value: ComposerValue; issuer?: number; submitting?: boolean }>();
  constructor(private publish: (value: ComposerUpdate) => void) {}
  owner(input: ComposerOwner): ComposerOwner {
    const owner = parseComposerOwner(input);
    return this.aliases.get(composerKey(owner)) ?? owner;
  }
  private current(input: ComposerOwner): ComposerSnapshot {
    const owner = this.owner(input), key = composerKey(owner);
    let record = this.records.get(key);
    if (!record) {
      if (this.records.size >= 512) throw new Error('Draft cache is full; restart the app after saving pending input');
      record = { owner, revision: 0, value: emptyComposer() }; this.records.set(key, record);
    }
    return record;
  }
  read(input: ComposerOwner) { return structuredClone(this.current(input)); }
  private commit(owner: ComposerOwner, value: ComposerValue, patch?: Partial<ComposerValue>) {
    const previous = this.current(owner);
    const record = { owner: previous.owner, revision: previous.revision + 1, value };
    this.records.set(composerKey(record.owner), record);
    this.publish(structuredClone(patch ? { ...record, baseRevision: previous.revision, value: patch } : record));
    return record;
  }
  write(input: ComposerWrite) {
    const current = this.current(input.owner);
    if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision)
      return { accepted: false, snapshot: this.read(current.owner) };
    if (!input.value || typeof input.value !== 'object'
      || Object.keys(input.value).some(key => !['text', 'quotes', 'attachments'].includes(key)))
      throw new Error('Invalid composer patch');
    const value = parseValue({ ...current.value, ...input.value });
    const patch = Object.fromEntries(Object.keys(input.value).map(key => [key, value[key as keyof ComposerValue]]));
    const size = (value: ComposerValue) => value.text.length * 2 + JSON.stringify(value.quotes).length * 2
      + value.attachments.reduce((sum, item) => sum + (item.kind === 'image' ? item.content.data!.length * 2 : 512) + item.name.length * 2, 1024);
    const total = [...this.records.values()].reduce((sum, record) =>
      sum + (composerKey(record.owner) === composerKey(current.owner) ? 0 : size(record.value)), size(value))
      + [...this.receipts.values()].reduce((sum, receipt) => sum + size(receipt.value), 0);
    if (total > 128 * 1024 * 1024) throw new Error('Draft attachments exceed the shared memory limit; remove unused attachments');
    const record = this.commit(current.owner, value, patch);
    return { accepted: true, snapshot: structuredClone({ ...record, baseRevision: current.revision, value: patch }) };
  }
  take(owner: ComposerOwner, revision: number, issuer?: number) {
    const current = this.read(owner);
    if (current.revision !== revision) throw new Error('Composer changed in another window; review the current draft before sending');
    if (!current.value.text.trim() && !current.value.quotes.length && !current.value.attachments.length)
      throw new Error('This draft has already been sent or cleared');
    if (this.receipts.size >= 64) throw new Error('Too many pending submissions');
    const token = randomUUID();
    // Outstanding receipts retain only in-flight input and expire after settlement.
    this.receipts.set(token, { owner: current.owner, value: current.value, issuer });
    return { snapshot: structuredClone(this.commit(current.owner, emptyComposer())), receipt: { owner: current.owner, token, value: current.value } };
  }
  settle(token: string) { this.receipts.delete(token); }
  recover(issuer: number) {
    for (const [token, receipt] of this.receipts) {
      if (receipt.issuer === issuer && !receipt.submitting)
        this.restore({ owner: receipt.owner, token, value: receipt.value });
    }
  }
  async submit<T>(token: string, owner: ComposerOwner | undefined, operation: () => Promise<T>): Promise<T> {
    const receipt = this.receipts.get(token);
    if (!receipt || receipt.submitting) throw new Error('This draft submission has expired');
    receipt.submitting = true;
    try {
      if (!owner || composerKey(this.owner(receipt.owner)) !== composerKey(this.owner(owner)))
        throw new Error('Draft submission belongs to a different conversation');
      const result = await operation();
      this.settle(token);
      return result;
    } catch (error) {
      receipt.submitting = false;
      this.restore({ owner: receipt.owner, token, value: receipt.value });
      throw error;
    }
  }
  restore(receipt: ComposerReceipt) {
    if (!receipt || typeof receipt.token !== 'string') throw new Error('Invalid draft restoration');
    const saved = this.receipts.get(receipt.token);
    if (!saved || saved.submitting || composerKey(this.owner(saved.owner)) !== composerKey(this.owner(receipt.owner)))
      throw new Error('This draft restoration has expired');
    this.receipts.delete(receipt.token);
    const current = this.read(saved.owner), original = saved.value;
    const attachmentIds = new Set(current.value.attachments.map(item => item.kind === 'file' ? item.id : `${item.name}:${item.content.data}`));
    const attachments = [...original.attachments.filter(item => !attachmentIds.has(item.kind === 'file' ? item.id : `${item.name}:${item.content.data}`)),
      ...current.value.attachments];
    // Recovery may exceed editor limits; never discard either the sent or newer input.
    return structuredClone(this.commit(current.owner, {
      text: [original.text, current.value.text].filter(Boolean).join('\n'),
      quotes: restoreQuotes(original.quotes, current.value.quotes), attachments,
    }));
  }
  promote(draftId: string, sessionId: string) {
    const source: ComposerOwner = { draftId }, owner: ComposerOwner = { sessionId };
    const previous = this.read(source);
    if (this.aliases.size >= 512) throw new Error('Draft cache is full; restart after saving pending input');
    this.aliases.set(composerKey(source), owner);
    this.records.delete(composerKey(source));
    const record = { owner, revision: previous.revision + 1, value: previous.value };
    this.records.set(composerKey(owner), record);
    this.publish(structuredClone(record));
  }
}
