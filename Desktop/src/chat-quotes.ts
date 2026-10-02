export type ChatQuote = {
  id: string;
  messageIndex: number;
  role: 'assistant' | 'user';
  text: string;
  markdown: string;
  startOffset: number;
  endOffset: number;
};

export const MAX_QUOTES = 8;
export const MAX_QUOTE_LENGTH = 20000;
export const MAX_PROMPT_LENGTH = 100000;

export function fencedSelection(text: string, language = '') {
  const runs = [...text.matchAll(/`+/g)].map(match => match[0].length);
  const fence = '`'.repeat(Math.max(3, ...runs.map(length => length + 1)));
  return `${fence}${language}\n${text}\n${fence}`;
}

export function quotePrompt(draft: string, quotes: readonly ChatQuote[], language: 'zh' | 'en') {
  if (!quotes.length) return draft;
  const zh = language === 'zh';
  const context = quotes.map((quote, index) => {
    const role = quote.role === 'assistant' ? (zh ? '助手' : 'assistant') : (zh ? '用户' : 'user');
    const label = zh ? `引用 ${index + 1}，来自此前的${role}消息：` : `Quote ${index + 1}, from an earlier ${role} message:`;
    return `${label}\n${quote.markdown.split('\n').map(line => `> ${line}`).join('\n')}`;
  }).join('\n\n');
  const heading = zh ? '以下是用户选取的对话原文，作为本轮回复的参考资料：' : 'The following conversation excerpts were selected by the user as reference for this reply:';
  const reply = draft.trim() ? `${zh ? '用户本轮消息：' : 'Current user message:'}\n${draft}` : '';
  return [heading, context, reply].filter(Boolean).join('\n\n');
}

export function restoreQuotes(sent: readonly ChatQuote[], current: readonly ChatQuote[]) {
  const ids = new Set(current.map(quote => quote.id));
  return [...sent.filter(quote => !ids.has(quote.id)), ...current];
}

// Only unwrap our exact prompt format; ordinary Markdown stays untouched.
export function quotePresentation(text: string) {
  const headings = {
    zh: '以下是用户选取的对话原文，作为本轮回复的参考资料：',
    en: 'The following conversation excerpts were selected by the user as reference for this reply:',
  };
  const language = (Object.keys(headings) as ('zh' | 'en')[])
    .find(key => text.startsWith(`${headings[key]}\n\n`));
  if (!language) return null;
  const lines = text.slice(headings[language].length + 2).split('\n');
  const quotes: ChatQuote[] = [];
  let cursor = 0;
  let draft = '';
  while (cursor < lines.length) {
    const match = language === 'zh'
      ? /^引用 (\d+)，来自此前的(助手|用户)消息：$/.exec(lines[cursor])
      : /^Quote (\d+), from an earlier (assistant|user) message:$/.exec(lines[cursor]);
    if (!match || Number(match[1]) !== quotes.length + 1) return null;
    const role = match[2] === '助手' || match[2] === 'assistant' ? 'assistant' : 'user';
    cursor++;
    const excerpt: string[] = [];
    while (cursor < lines.length && lines[cursor].startsWith('> ')) {
      excerpt.push(lines[cursor++].slice(2));
    }
    if (!excerpt.length) return null;
    const markdown = excerpt.join('\n');
    quotes.push({ id: String(quotes.length), messageIndex: 0, role, text: markdown,
      markdown, startOffset: 0, endOffset: markdown.length });
    if (cursor === lines.length) break;
    if (lines[cursor++] !== '') return null;
    if (lines[cursor] === (language === 'zh' ? '用户本轮消息：' : 'Current user message:')) {
      draft = lines.slice(cursor + 1).join('\n');
      break;
    }
  }
  if (!quotes.length || quotePrompt(draft, quotes, language) !== text) return null;
  return { quotes, draft };
}
