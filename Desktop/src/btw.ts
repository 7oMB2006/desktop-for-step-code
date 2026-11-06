import type { Model, Usage } from './contracts';
import { MAX_QUOTES, quotePrompt, sameQuoteSelection, type ChatQuote } from './chat-quotes';

export const MAX_BTW_PROMPT_LENGTH = 8000;
export function btwPrompt(question: string, quotes: readonly ChatQuote[], language: 'zh' | 'en') {
  return quotePrompt(question.trim(), quotes, language);
}
export function appendBtwQuote(current: ChatQuote[], quote: ChatQuote, draft: string, language: 'zh' | 'en'):
  { quotes: ChatQuote[]; error?: never } | { quotes?: never; error: 'count' | 'length' } {
  if (current.some(item => sameQuoteSelection(item, quote))) return { quotes: current };
  if (current.length >= MAX_QUOTES) return { error: 'count' };
  const quotes = [...current, quote];
  if (btwPrompt(draft, quotes, language).length > MAX_BTW_PROMPT_LENGTH) return { error: 'length' };
  return { quotes };
}

export interface BtwOwner { runtimeId: string; sessionId: string; scopeId: string }
export interface BtwInput extends BtwOwner { requestId: string; question: string }
export interface BtwEvent extends BtwOwner {
  type: 'desktop_btw';
  requestId: string;
  kind: 'start' | 'delta' | 'done' | 'cancelled' | 'error';
  model?: Pick<Model, 'id' | 'provider' | 'name'>;
  text?: string;
  usage?: Usage;
  truncated?: boolean;
  reason?: 'tools_unavailable';
}
export interface BtwBridge {
  btwAsk(input: BtwInput): Promise<void>;
  btwCancel(input: Omit<BtwInput, 'question'>): Promise<void>;
  btwClear(input: BtwOwner): Promise<void>;
}
export interface BtwExchange {
  requestId: string; question: string; answer: string; state: 'running' | 'done' | 'cancelled' | 'error';
  startedAt?: number; endedAt?: number;
  quotes?: ChatQuote[];
  promptLength?: number;
  model?: BtwEvent['model']; usage?: Usage; truncated?: boolean;
  reason?: BtwEvent['reason'];
}
export function trimBtwHistory(items: BtwExchange[]): BtwExchange[] {
  const completed = items.filter(item => item.state === 'done').slice(-20);
  const sizeOf = (item: BtwExchange) => item.answer.length + (item.promptLength ?? item.question.length);
  let size = completed.reduce((sum, item) => sum + sizeOf(item), 0);
  while (completed.length > 1 && size > 64_000) {
    const removed = completed.shift()!;
    size -= sizeOf(removed);
  }
  const kept = new Set([...completed, ...items.filter(item => item.state === 'error' || item.state === 'cancelled').slice(-5)]);
  return items.filter(item => item.state === 'running' || kept.has(item));
}
export function applyBtwEvent(exchange: BtwExchange, event: BtwEvent, now = Date.now()): BtwExchange {
  if (exchange.requestId !== event.requestId || exchange.state !== 'running') return exchange;
  if (event.kind === 'start') return { ...exchange, model: event.model };
  if (event.kind === 'delta') return { ...exchange, answer: (exchange.answer + (event.text ?? '')).slice(0, 64_000) };
  return { ...exchange, state: event.kind, endedAt: now,
    answer: event.kind === 'error' && event.reason === 'tools_unavailable' ? ''
      : event.kind === 'done' ? event.text ?? exchange.answer : exchange.answer,
    reason: event.kind === 'error' ? event.reason : undefined, usage: event.usage, truncated: event.truncated };
}
