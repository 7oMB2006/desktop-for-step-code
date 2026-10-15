import { toolPresentation, toolSubject, type ResponseItem } from './conversation-presentation';
import { groupableTool, toolGroupLabel } from './tool-groups';

export type ProcessItem = Extract<ResponseItem, { type: 'tool' }> | (ResponseItem & { type: 'thinking' });
export type ProcessGroup = { type: 'process-group'; key: string; index: number; items: ProcessItem[]; running: boolean };

/** Only the last nonempty thinking block can still be receiving thought deltas. */
export function liveThinkingKey(content: ResponseItem[], active: boolean): string | undefined {
  if (!active) return;
  const tail = [...content].reverse().find(item => item.type !== 'text' || Boolean(item.block.text?.trim()));
  return tail?.type === 'thinking' ? tail.key : undefined;
}

export function thinkingPreview(text: string, running: boolean): string {
  const paragraphs = text.split(/\r?\n[\t ]*\r?\n/).map(value => value.trim()).filter(Boolean);
  const paragraph = running ? paragraphs.at(-1) : paragraphs[0];
  return (paragraph?.split(/\r?\n/, 1)[0] ?? '').replaceAll('**', '').replace(/\s+/gu, ' ').trim();
}

/** A reply, attachment or dedicated interaction closes the current process range. */
export function groupProcesses(content: ResponseItem[], active: boolean, awaiting: readonly string[] = []): (ResponseItem | ProcessGroup)[] {
  const result: (ResponseItem | ProcessGroup)[] = [];
  let pending: ProcessItem[] = [];
  const liveThought = liveThinkingKey(content, active);
  const flush = () => {
    if (!pending.length) return;
    result.push({
      type: 'process-group', key: `process:${pending[0].key}`, index: pending[0].index, items: pending,
      running: pending.some(item => item.key === liveThought
        || (active && item.type === 'tool' && (!item.result || item.result.desktopToolPending))),
    });
    pending = [];
  };
  for (const item of content) {
    if (item.type === 'thinking') pending.push({ ...item, type: 'thinking' });
    else if (groupableTool(item, active, awaiting)) pending.push(item);
    else {
      // Empty streaming placeholders are not actual prose boundaries.
      if (item.type === 'text' && !item.block.text?.trim()) continue;
      flush();
      result.push(item);
    }
  }
  flush();
  return result;
}

export function processGroupSummary(group: ProcessGroup, language: 'zh' | 'en'): { label: string; detail: string } {
  const zh = language === 'zh';
  const tools = group.items.filter(item => item.type === 'tool');
  const current = group.running ? [...tools].reverse().find(item => !item.result || item.result.desktopToolPending) : undefined;
  if (current) {
    const name = current.call?.name ?? current.result?.toolName ?? '';
    return { label: toolPresentation(name, current.result, true, language).label, detail: toolSubject(current.call) };
  }
  if (group.running) {
    const thought = [...group.items].reverse().find(item => item.type === 'thinking');
    return { label: zh ? '正在思考' : 'Thinking', detail: thought?.type === 'thinking' ? thinkingPreview(thought.block.thinking ?? '', true) : '' };
  }
  return { label: tools.length ? toolGroupLabel(tools, language) : zh ? '已完成思考' : 'Thinking completed', detail: '' };
}
