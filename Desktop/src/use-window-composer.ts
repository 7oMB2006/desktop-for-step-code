import { useEffect, useRef, useState, type SetStateAction } from 'react';
import type { DesktopBridge } from './contracts';
import { composerKey, emptyComposer, type ComposerOwner, type ComposerReceipt, type ComposerSnapshot, type ComposerUpdate, type ComposerValue } from './window-conversation';

type RecordState = {
  owner: ComposerOwner; value: ComposerValue; confirmed?: ComposerSnapshot; loading?: Promise<void>;
  writing?: Promise<void>; pending?: { revision: number; version: number; value: ComposerValue };
  taking?: { revision: number; version: number }; resyncing?: Promise<void>; dirty: boolean; conflict: boolean; version: number; failed?: unknown;
};
const equalList = (a: unknown[], b: unknown[]) => a === b || JSON.stringify(a) === JSON.stringify(b);
const same = (a: ComposerValue, b: ComposerValue) => a.text === b.text && equalList(a.quotes, b.quotes) && equalList(a.attachments, b.attachments);

/** Local edits survive CAS rejection. Only a user decision may replace a divergent draft. */
export class WindowComposerClient {
  private records = new Map<string, RecordState>();
  private aliases = new Map<string, ComposerOwner>();
  active?: RecordState;
  constructor(private bridge: DesktopBridge | undefined, private changed: () => void, private error: (message: string) => void) {}
  private record(owner: ComposerOwner) {
    owner = this.aliases.get(composerKey(owner)) ?? owner;
    const key = composerKey(owner);
    let record = this.records.get(key);
    if (!record) {
      record = { owner, value: emptyComposer(), dirty: false, conflict: false, version: 0 };
      this.records.set(key, record);
      if (this.bridge?.composerRead) {
        const target = record;
        target.loading = this.bridge.composerRead(owner).then(snapshot => {
          // Older renderer fixtures deliberately omit the native protocol.
          if (snapshot?.owner && Number.isSafeInteger(snapshot.revision)) this.accept(snapshot, target);
        }).catch(reason => { target.failed = reason; this.error(String(reason)); })
          .finally(() => { target.loading = undefined; this.changed(); });
      }
      for (const [id, cached] of this.records) {
        if (this.records.size <= 128) break;
        if (cached !== this.active && !cached.dirty && !cached.loading && !cached.writing && !cached.taking
          && !cached.value.text && !cached.value.quotes.length && !cached.value.attachments.length) this.records.delete(id);
      }
    }
    return record;
  }
  select(owner?: ComposerOwner) {
    const record = owner ? this.record(owner) : undefined;
    if (this.active !== record) { this.active = record; this.changed(); }
  }
  accept(update: ComposerUpdate, target?: RecordState) {
    const record = target ?? this.records.get(composerKey(update.owner));
    if (!record || record.confirmed && update.revision <= record.confirmed.revision) return;
    if ('baseRevision' in update && update.baseRevision !== record.confirmed?.revision) {
      if (!record.resyncing && this.bridge?.composerRead) {
        record.resyncing = this.bridge.composerRead(record.owner).then(snapshot => this.accept(snapshot, record))
          .catch(reason => this.error(String(reason))).finally(() => { record.resyncing = undefined; });
      }
      return;
    }
    const snapshot: ComposerSnapshot = 'baseRevision' in update
      ? { owner: update.owner, revision: update.revision, value: { ...record.confirmed!.value, ...update.value } } : update;
    const initialEmpty = !record.confirmed && same(snapshot.value, emptyComposer());
    const ownWrite = record.pending && snapshot.revision === record.pending.revision + 1 && same(snapshot.value, record.pending.value);
    const ownTake = record.taking && snapshot.revision === record.taking.revision + 1 && same(snapshot.value, emptyComposer());
    record.confirmed = snapshot;
    if (ownWrite) {
      if (record.version === record.pending!.version) { record.value = snapshot.value; record.dirty = false; }
    } else if (ownTake) {
      if (record.version === record.taking!.version) { record.value = snapshot.value; record.dirty = false; }
    } else if (record.dirty && initialEmpty) { /* First read establishes the empty CAS baseline. */ }
    else if (record.dirty && !same(record.value, snapshot.value)) record.conflict = true;
    else { record.value = snapshot.value; record.dirty = false; }
    this.changed();
  }
  promote(draftId: string, sessionId: string) {
    const key = composerKey({ draftId }), record = this.records.get(key);
    this.aliases.set(key, { sessionId });
    if (!record) return;
    this.records.delete(key);
    record.owner = { sessionId };
    this.records.set(composerKey(record.owner), record);
    void this.bridge?.composerRead(record.owner).then(snapshot => this.accept(snapshot, record)).catch(reason => this.error(String(reason)));
  }
  update(owner: ComposerOwner, action: (value: ComposerValue) => ComposerValue) {
    const record = this.record(owner);
    const next = action(record.value);
    if (same(next, record.value)) return;
    record.value = next; record.version++; record.dirty = true;
    this.changed();
    void this.flushRecord(record).catch(reason => {
      if (!String(reason).includes('COMPOSER_CONFLICT')) this.error(String(reason instanceof Error ? reason.message : reason));
    });
  }
  private async flushRecord(record: RecordState): Promise<void> {
    await record.loading;
    await record.resyncing;
    if (record.failed) throw record.failed;
    if (record.writing) { await record.writing; return this.flushRecord(record); }
    if (record.taking) return;
    if (record.conflict) throw new Error('COMPOSER_CONFLICT');
    if (!record.dirty || !record.confirmed || !this.bridge?.composerWrite) return;
    const pending = { value: record.value, version: record.version, revision: record.confirmed.revision };
    record.pending = pending;
    record.writing = (async () => {
      const baseline = record.confirmed!.value;
      const patch: Partial<ComposerValue> = {};
      if (pending.value.text !== baseline.text) patch.text = pending.value.text;
      if (!equalList(pending.value.quotes, baseline.quotes)) patch.quotes = pending.value.quotes;
      if (!equalList(pending.value.attachments, baseline.attachments)) patch.attachments = pending.value.attachments;
      const result = await this.bridge!.composerWrite({ owner: record.owner, revision: pending.revision, value: patch });
      if (!result?.snapshot) throw new Error('Composer synchronization unavailable');
      if (result.accepted) {
        this.accept(result.snapshot, record);
        await record.resyncing;
        // A later remote revision is safe only after the local write was accepted.
        if (record.version === pending.version && record.confirmed) {
          record.value = record.confirmed.value; record.dirty = false; record.conflict = false;
        }
      }
      else {
        this.accept(result.snapshot, record);
        await record.resyncing;
        if (record.confirmed && same(record.value, record.confirmed.value)) { record.dirty = false; return; }
        record.conflict = true;
        throw new Error('COMPOSER_CONFLICT');
      }
      await record.resyncing;
    })();
    try { await record.writing; }
    finally { record.writing = undefined; record.pending = undefined; this.changed(); }
    if (record.dirty) await this.flushRecord(record);
  }
  async flush() {
    if (this.active) await this.flushRecord(this.active);
  }
  async take(expected: ComposerValue): Promise<ComposerReceipt | undefined> {
    const record = this.active;
    if (!record || record.taking) throw new Error('Composer submission in progress');
    const version = record.version;
    await this.flushRecord(record);
    if (this.active !== record || record.version !== version || !same(record.value, expected) || record.taking)
      throw new Error('Composer changed; review the current draft before sending');
    if (!record.confirmed || !this.bridge?.composerTake) {
      record.value = emptyComposer(); record.dirty = false; this.changed(); return;
    }
    record.taking = { revision: record.confirmed.revision, version };
    try {
      const result = await this.bridge.composerTake(record.owner, record.confirmed.revision);
      this.accept(result.snapshot, record);
      return result.receipt;
    } finally {
      record.taking = undefined; this.changed();
      if (record.dirty) void this.flushRecord(record).catch(reason => this.error(String(reason)));
    }
  }
  async restore(receipt: ComposerReceipt) {
    const record = this.record(receipt.owner);
    await this.flushRecord(record).catch(() => {});
    const snapshot = await this.bridge!.composerRestore(receipt);
    this.accept(snapshot, record);
  }
  async resolveConflict(keepLocal: boolean) {
    const record = this.active;
    if (!record?.confirmed) return;
    if (!keepLocal) { record.value = record.confirmed.value; record.dirty = false; }
    record.conflict = false; this.changed();
    await this.flushRecord(record);
  }
  peek(owner: ComposerOwner) { return this.records.get(composerKey(owner))?.value; }
}

export function useWindowComposer(bridge: DesktopBridge | undefined, onError: (message: string) => void) {
  const [, render] = useState(0);
  const error = useRef(onError); error.current = onError;
  const [client] = useState(() => new WindowComposerClient(bridge, () => render(value => value + 1), message => error.current(message)));
  useEffect(() => bridge?.onEvent(event => {
    if (event.type === 'desktop_composer' && event.snapshot?.owner) client.accept(event.snapshot);
    if (event.type === 'desktop_draft_created') client.promote(event.draftId, event.sessionId);
  }), [bridge, client]);
  const setField = <K extends keyof ComposerValue>(field: K, action: SetStateAction<ComposerValue[K]>) => {
    const owner = client.active?.owner;
    if (owner) client.update(owner, value => ({ ...value, [field]: typeof action === 'function'
      ? (action as (previous: ComposerValue[K]) => ComposerValue[K])(value[field]) : action }));
  };
  return {
    client, value: client.active?.value ?? emptyComposer(), conflict: Boolean(client.active?.conflict),
    setDraft: (action: SetStateAction<string>) => setField('text', action),
    setQuotes: (action: SetStateAction<ComposerValue['quotes']>) => setField('quotes', action),
    setAttachments: (action: SetStateAction<ComposerValue['attachments']>) => setField('attachments', action),
  };
}
