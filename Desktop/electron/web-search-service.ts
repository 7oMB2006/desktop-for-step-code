import { webSearchProviders, type WebSearchAttempt, type WebSearchOutcome, type WebSearchProvider } from '../src/web-search';
import { record, webSearchRoute } from './web-search-config';
import { execFile } from 'node:child_process';

type Failure = Exclude<WebSearchOutcome, 'success' | 'empty'>;
type ExternalProvider = Exclude<WebSearchProvider, 'step'>;
type Fetch = (url: string, options: RequestInit) => Promise<Response>;
type StepSearch = (account: NonNullable<ReturnType<typeof webSearchRoute>['step']>, query: string, signal: AbortSignal) =>
  Promise<{ text: string; count: number }>;
const LIMIT = 8;
const MAX_RESPONSE = 2 * 1024 * 1024;
const RETRY = new Set<Failure>(['timeout', 'rate', 'quota']);

export class WebSearchFailure extends Error {
  constructor(readonly outcome: Failure) { super(outcome); }
}

function checkStatus(status: number, id: ExternalProvider) {
  if (status === 401 || status === 403 && id !== 'searxng') throw new WebSearchFailure('auth');
  if (status === 429) throw new WebSearchFailure('rate');
  if (status === 402 || id === 'tavily' && (status === 432 || status === 433)) throw new WebSearchFailure('quota');
  if (status === 408 || status === 504) throw new WebSearchFailure('timeout');
  if (status < 200 || status >= 300) throw new WebSearchFailure('unavailable');
}

export function classifyStepSearchError(error: unknown): WebSearchFailure {
  const message = error instanceof Error ? error.message : '';
  if (/\b(?:HTTP|status(?: code)?|HTTP status)[: (=]*40[13]\b/i.test(message)
    || /\b(?:invalid (?:api key|credential|token)|unauthorized|authentication failed)\b/i.test(message)) return new WebSearchFailure('auth');
  if (/\b(?:HTTP|status(?: code)?)[ : (=]*429\b|\brate limit(?:ed| exceeded)?\b/i.test(message)) return new WebSearchFailure('rate');
  if (/\b(?:HTTP|status(?: code)?)[ : (=]*402\b|\b(?:quota exceeded|quota exhausted|insufficient (?:quota|balance)|out of credits)\b/i.test(message))
    return new WebSearchFailure('quota');
  if (/\b(?:request timed out|timeout|deadline exceeded)\b/i.test(message)) return new WebSearchFailure('timeout');
  return new WebSearchFailure('unavailable');
}

export function nativeStepSearch(node: string, entry: string, bundlePath: string, cwd: string, environment: () => NodeJS.ProcessEnv): StepSearch {
  return async (account, query, signal) => {
    signal.throwIfAborted();
    // Keep Node's MCP transport behind the same Desktop proxy as the runtime.
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(node, ['--use-env-proxy', entry, bundlePath], {
        cwd, env: environment(), signal, windowsHide: true, maxBuffer: 160 * 1024,
      }, (error, stdout) => error ? reject(new WebSearchFailure('unavailable')) : resolve(stdout));
      child.stdin?.on('error', () => {});
      child.stdin?.end(JSON.stringify({ ...account, query }));
    });
    const result = record(JSON.parse(output));
    if (typeof result.error === 'string') throw classifyStepSearchError(new Error(result.error));
    if (typeof result.text !== 'string' || typeof result.count !== 'number') throw new WebSearchFailure('unavailable');
    return { text: result.text, count: result.count };
  };
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.body) throw new WebSearchFailure('unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) throw new WebSearchFailure('unavailable');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function redact(value: string, secret: string): string {
  const encoded = encodeURIComponent(secret);
  return [...new Set([secret, encoded])].filter(Boolean).reduce((text, key) => text.split(key).join('[redacted]'), value);
}
const tidy = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, max) : '';

async function externalSearch(fetch: Fetch, id: ExternalProvider, credential: string, query: string, signal: AbortSignal) {
  const headers: Record<string, string> = { accept: 'application/json' };
  let url: URL, payload: unknown;
  switch (id) {
    case 'tavily':
      url = new URL('https://api.tavily.com/search');
      headers.authorization = `Bearer ${credential}`;
      payload = { query, search_depth: 'basic', max_results: LIMIT };
      break;
    case 'exa':
      url = new URL('https://api.exa.ai/search');
      headers['x-api-key'] = credential;
      payload = { query, numResults: LIMIT, contents: { highlights: { maxCharacters: 450 } } };
      break;
    case 'brave':
      url = new URL('https://api.search.brave.com/res/v1/web/search');
      headers['x-subscription-token'] = credential;
      url.search = new URLSearchParams({ q: query, count: String(LIMIT), result_filter: 'web' }).toString();
      break;
    case 'bocha':
      url = new URL('https://api.bochaai.com/v1/web-search');
      headers.authorization = `Bearer ${credential}`;
      payload = { query, count: LIMIT, summary: true };
      break;
    case 'searxng':
      url = new URL(credential);
      if (!url.pathname.endsWith('/search')) url.pathname = `${url.pathname.replace(/\/$/, '')}/search`;
      url.search = new URLSearchParams({ q: query, format: 'json' }).toString();
      break;
  }
  if (payload) headers['content-type'] = 'application/json';
  const response = await fetch(url.href, { method: payload ? 'POST' : 'GET', headers, body: payload ? JSON.stringify(payload) : undefined,
    signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    checkStatus(response.status, id);
  }
  const data = record(await responseJson(response));
  if (id === 'bocha' && data.code !== undefined && Number(data.code) !== 200) checkStatus(Number(data.code) || 500, id);
  const pages = record(record(data.data).webPages);
  const items = id === 'brave' ? record(data.web).results ?? (data.type === 'search' && data.web === undefined ? [] : undefined)
    : id === 'bocha' ? pages.value ?? (pages.totalEstimatedMatches === 0 ? [] : undefined)
    : data.results;
  if (!Array.isArray(items)) throw new WebSearchFailure('unavailable');
  const secret = id === 'searxng' ? undefined : credential;
  const redactField = (value: unknown, length: number) =>
    tidy(typeof value === 'string' && secret ? redact(value, secret) : value, length);
  const results = items.slice(0, LIMIT).flatMap(raw => {
    const item = record(raw);
    try {
      const link = new URL(redactField(item.url, 2048));
      if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password) return [];
      const title = (redactField(item.title ?? item.name, 180) || link.hostname).replace(/[\\[\]]/g, '\\$&');
      const snippet = redactField(item.summary ?? item.snippet ?? item.description ??
        (Array.isArray(item.highlights) ? item.highlights.filter(x => typeof x === 'string').join(' ') : item.content), 450);
      return [`[${title}](<${link.href.replace(/[<>]/g, encodeURIComponent)}>)${snippet ? `\n   ${snippet}` : ''}`];
    } catch { return []; }
  });
  if (items.length && !results.length) throw new WebSearchFailure('unavailable');
  return { text: results.map((result, i) => `${i + 1}. ${result}`).join('\n\n'), count: results.length };
}

export function createWebSearch(fetch: Fetch, stepSearch: StepSearch, limits = { total: 35000, attempt: 8000 }) {
  let active = 0;
  return async (auth: Record<string, unknown>, rawQuery: unknown, signal: AbortSignal) => {
    if (typeof rawQuery !== 'string' || !rawQuery.trim() || rawQuery.length > 2000)
      return { text: 'Search query must contain 1 to 2000 characters.', attempts: [], failed: true };
    signal.throwIfAborted();
    if (active >= 4) return { text: 'Too many concurrent web searches. Try again shortly.', attempts: [], failed: true };
    active++;
    try {
      const { order, fallback, step, credentials } = webSearchRoute(auth);
      const query = rawQuery.trim();
      const attempts: WebSearchAttempt[] = [];
      const deadline = AbortSignal.timeout(limits.total);
      for (const provider of order) {
        signal.throwIfAborted();
        if (deadline.aborted) break;
        const timeout = AbortSignal.timeout(limits.attempt);
        const request = AbortSignal.any([signal, deadline, timeout]);
        try {
          const result = provider === 'step' ? await stepSearch(step!, query, request)
            : await externalSearch(fetch, provider, credentials[provider]!, query, request);
          request.throwIfAborted();
          attempts.push({ provider, outcome: result.count ? 'success' : 'empty' });
          const text = provider === 'step' ? redact(result.text, step!.key) : result.text;
          return { text: text.slice(0, 24000) || 'No search results.', attempts, failed: false };
        } catch (error) {
          signal.throwIfAborted();
          const outcome = timeout.aborted || deadline.aborted ? 'timeout'
            : error instanceof WebSearchFailure ? error.outcome : 'unavailable';
          attempts.push({ provider, outcome });
          if (!fallback || !RETRY.has(outcome)) break;
        }
      }
      const last = attempts.at(-1);
      return { text: last ? `${webSearchProviders[last.provider].name[1]}: web search failed (${last.outcome}).`
        : 'No web search service is enabled.', attempts, failed: true };
    } finally { active--; }
  };
}
