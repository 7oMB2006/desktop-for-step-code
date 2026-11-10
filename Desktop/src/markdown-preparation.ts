import type { Root } from 'mdast';
import type { Message } from './contracts';
import type { PreparedMarkdown } from './markdown-parser';

export function historyMarkdownTexts(messages: Message[]): string[] {
  const texts = new Set<string>();
  let size = 0;
  for (const message of messages) {
    if (message.role !== 'assistant' && message.role !== 'user') continue;
    const values = typeof message.content === 'string' ? [message.content]
      : message.content.filter(block => block.type === 'text').map(block => block.text ?? '');
    for (const text of values) if (text.length >= 256 && text.length <= 32_768 && !texts.has(text)) {
      size += text.length;
      if (size > 4_194_304 || texts.size >= 512) return [];
      texts.add(text);
    }
  }
  return [...texts];
}

export function prepareHistoryMarkdown(messages: Message[], signal: AbortSignal): Promise<PreparedMarkdown | undefined> {
  const texts = historyMarkdownTexts(messages);
  if (signal.aborted || typeof Worker === 'undefined' || texts.reduce((size, text) => size + text.length, 0) < 131_072)
    return Promise.resolve(undefined);
  return new Promise(resolve => {
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (trees?: PreparedMarkdown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker?.terminate();
      resolve(trees);
    };
    const abort = () => finish();
    try {
      worker = new Worker(new URL('./markdown-parser.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<[string, Root][]>) => {
        const entries = event.data;
        finish(Array.isArray(entries) && entries.length === texts.length && entries.every((entry, index) =>
          Array.isArray(entry) && entry[0] === texts[index] && entry[1]?.type === 'root' && Array.isArray(entry[1].children))
          ? new Map(entries) : undefined);
      };
      worker.onerror = event => { event.preventDefault(); finish(); };
      worker.onmessageerror = () => finish();
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, 5000);
      worker.postMessage(texts);
    } catch { finish(); }
  });
}
