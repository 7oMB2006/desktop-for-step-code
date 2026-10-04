import { parsePatch } from 'diff';
import type { Content, Message } from './contracts';
import type { IndexedMessage } from './conversation-presentation';

export type DiffRow = {
  kind: 'context' | 'add' | 'remove' | 'hunk' | 'note';
  text: string; oldLine?: number; newLine?: number;
};
export type TurnEdit = { id: string; rows: DiffRow[]; added: number; removed: number };
export type TurnFile = { path: string; edits: TurnEdit[]; added: number; removed: number };
export type TurnChanges = { files: TurnFile[]; incomplete: boolean; added: number; removed: number };

export function parseToolPatch(patch: unknown, id: string): TurnEdit | undefined {
  if (typeof patch !== 'string' || patch.length > 200_000) return;
  try {
    const files = parsePatch(patch);
    if (files.length !== 1 || !files[0].hunks.length) return;
    const rows: DiffRow[] = [];
    let added = 0; let removed = 0;
    for (const hunk of files[0].hunks) {
      rows.push({ kind: 'hunk', text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` });
      let oldLine = hunk.oldStart; let newLine = hunk.newStart;
      let oldCount = 0; let newCount = 0;
      for (const line of hunk.lines) {
        if (rows.length >= 5000 || line.length > 12000) return;
        if (line.startsWith('+')) {
          rows.push({ kind: 'add', text: line.slice(1), newLine: newLine++ }); added++; newCount++;
        } else if (line.startsWith('-')) {
          rows.push({ kind: 'remove', text: line.slice(1), oldLine: oldLine++ }); removed++; oldCount++;
        } else if (line.startsWith(' ')) {
          rows.push({ kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ }); oldCount++; newCount++;
        } else if (line.startsWith('\\')) rows.push({ kind: 'note', text: line });
        else return;
      }
      if (oldCount !== hunk.oldLines || newCount !== hunk.newLines) return;
    }
    if (!added && !removed) return;
    return { id, rows, added, removed };
  } catch { return; }
}

export function turnChanges(items: IndexedMessage[]): TurnChanges {
  const calls = new Map<string, Content>();
  const seen = new Set<string>();
  const files = new Map<string, TurnFile>();
  let incomplete = false; let totalRows = 0;
  for (const { message, index } of items) {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) if (part.type === 'toolCall' && part.id) calls.set(part.id, part);
    }
    if (message.role !== 'toolResult' || message.isError || !message.toolCallId || seen.has(message.toolCallId)) continue;
    seen.add(message.toolCallId);
    const call = calls.get(message.toolCallId);
    if (!call || !/^(edit|edit_file|apply_patch|write|write_file)$/.test(call.name ?? '')) continue;
    const args = call.arguments;
    const path = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>).path : undefined;
    const edit = parseToolPatch(message.details?.patch, message.toolCallId ?? String(index));
    if (typeof path !== 'string' || !path.trim() || path.length > 4096 || !edit || totalRows + edit.rows.length > 10000) {
      incomplete = true; continue;
    }
    const key = path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    const file = files.get(key) ?? { path, edits: [], added: 0, removed: 0 };
    file.edits.push(edit); file.added += edit.added; file.removed += edit.removed;
    files.set(key, file); totalRows += edit.rows.length;
  }
  const result = [...files.values()];
  return { files: result, incomplete, added: result.reduce((n, file) => n + file.added, 0),
    removed: result.reduce((n, file) => n + file.removed, 0) };
}

// Live prose deltas must not repeatedly parse already completed tool patches.
export function createTurnChangesReader() {
  let callsKey = '';
  let results: Message[] = [];
  let changes: TurnChanges = { files: [], incomplete: false, added: 0, removed: 0 };
  return (items: IndexedMessage[]) => {
    const nextCalls = JSON.stringify(items.flatMap(({ message }) => message.role === 'assistant' && Array.isArray(message.content)
      ? message.content.filter(part => part.type === 'toolCall').map(part => [part.id, part.name,
        part.arguments && typeof part.arguments === 'object' ? (part.arguments as Record<string, unknown>).path : null]) : []));
    const nextResults = items.filter(item => item.message.role === 'toolResult').map(item => item.message);
    if (nextCalls === callsKey && nextResults.length === results.length && nextResults.every((message, index) => message === results[index])) return changes;
    callsKey = nextCalls; results = nextResults; changes = turnChanges(items);
    return changes;
  };
}
