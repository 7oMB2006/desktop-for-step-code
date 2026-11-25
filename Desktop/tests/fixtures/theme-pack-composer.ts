import { restoreQuotes } from '../../src/chat-quotes';
import {
  composerKey, emptyComposer, type ComposerOwner, type ComposerReceipt, type ComposerSnapshot,
  type WindowConversationBridge,
} from '../../src/window-conversation';

// One isolated preview tab, with no native IPC, persistence or runtime access.
export function createThemePreviewComposer() {
  const records = new Map<string, ComposerSnapshot>();
  const aliases = new Map<string, ComposerOwner>();
  const receipts = new Map<string, ComposerReceipt>();
  const pending = new Set<string>();
  const owner = (value: ComposerOwner) => aliases.get(composerKey(value)) ?? value;
  const read = (input: ComposerOwner): ComposerSnapshot => {
    const current = owner(input), key = composerKey(current);
    if (!records.has(key)) records.set(key, { owner: current, revision: 0, value: emptyComposer() });
    return structuredClone(records.get(key)!);
  };
  const commit = (snapshot: ComposerSnapshot) => {
    const next = { ...snapshot, revision: snapshot.revision + 1 };
    records.set(composerKey(next.owner), structuredClone(next));
    return structuredClone(next);
  };
  const restore = (receipt: ComposerReceipt) => {
    const saved = receipts.get(receipt.token);
    if (!saved || pending.has(receipt.token) || composerKey(owner(saved.owner)) !== composerKey(owner(receipt.owner)))
      throw new Error('Offline draft receipt expired');
    receipts.delete(receipt.token);
    const current = read(saved.owner);
    return commit({ ...current, value: {
      text: [saved.value.text, current.value.text].filter(Boolean).join('\n'),
      quotes: restoreQuotes(saved.value.quotes, current.value.quotes),
      attachments: [...saved.value.attachments, ...current.value.attachments],
    } });
  };
  const bridge: Pick<WindowConversationBridge, 'composerRead' | 'composerWrite' | 'composerTake' | 'composerRestore'> = {
    composerRead: async input => read(input),
    composerWrite: async input => {
      const current = read(input.owner);
      if (current.revision !== input.revision) return { accepted: false, snapshot: current };
      return { accepted: true, snapshot: commit({ ...current, value: { ...current.value, ...input.value } }) };
    },
    composerTake: async (input, revision) => {
      const current = read(input);
      if (current.revision !== revision) throw new Error('Composer changed in offline preview');
      const receipt = { owner: current.owner, token: crypto.randomUUID(), value: current.value };
      receipts.set(receipt.token, structuredClone(receipt));
      return { snapshot: commit({ ...current, value: emptyComposer() }), receipt };
    },
    composerRestore: async receipt => restore(receipt),
  };
  return {
    bridge,
    promote(draftId: string, sessionId: string) {
      const source = { draftId }, current = read(source), target = { sessionId };
      aliases.set(composerKey(source), target);
      records.delete(composerKey(source));
      commit({ ...current, owner: target });
    },
    async submit<T>(token: string | undefined, input: ComposerOwner, operation: () => T | Promise<T>) {
      if (!token) return operation();
      const receipt = receipts.get(token);
      if (!receipt || pending.has(token)) throw new Error('Offline draft receipt expired');
      pending.add(token);
      try {
        if (composerKey(owner(receipt.owner)) !== composerKey(owner(input)))
          throw new Error('Offline draft belongs to another conversation');
        const result = await operation();
        receipts.delete(token);
        return result;
      } catch (error) {
        pending.delete(token);
        restore(receipt);
        throw error;
      } finally { pending.delete(token); }
    },
  };
}
