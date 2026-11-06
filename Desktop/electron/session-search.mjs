import { dirname, isAbsolute, join, relative } from 'node:path';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { readSessionHistory } from './session-history.mjs';

function confirmsSnippet(text, snippet) {
  if (typeof text !== 'string') return false;
  const normalize = value => value.replace(/[\u0002\u0003]/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
  const source = normalize(text);
  const parts = normalize(snippet).split(/…|\.{3}/u).map(part => part.trim()).filter(Boolean);
  let offset = 0;
  return parts.length > 0 && parts.every(part => {
    const at = source.indexOf(part, offset);
    if (at < 0) return false;
    offset = at + part.length;
    return true;
  });
}

// SQLite and fallback remain upstream-owned. Legacy display projection reads
// bounded canonical entries without rewriting the authoritative session files.
export function createDesktopSessionSearch(upstream, { storageRoot, agentDir, sessions, projectInput, projectedSnippet }) {
  let opening;
  let active;
  let closed = false;
  const open = () => opening ??= (async () => {
    if (![storageRoot, agentDir, sessions].every(path => typeof path === 'string' && isAbsolute(path)))
      throw new Error('Search requires an isolated profile');
    const [root, agentParent] = await Promise.all([realpath(storageRoot), realpath(dirname(agentDir))]);
    if (relative(root, agentParent)) throw new Error('Search requires Desktop configuration storage');
    // A draft can search before the first runtime has created its agent directory.
    await mkdir(agentDir).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const [agent, directory] = await Promise.all([realpath(agentDir), realpath(sessions)]);
    const inside = directory => {
      const path = relative(root, directory);
      return path && !isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\');
    };
    if (!inside(agent) || !inside(directory))
      throw new Error('Search requires Desktop session storage');
    const index = await upstream.openSessionIndex({
      agentDir: agent, dbPath: join(agent, 'index', 'desktop-session-search.v1.db'),
      roots: [{ path: directory, kind: 'custom' }],
    });
    if (closed) { await index.close(); throw new Error('Search is closed'); }
    return { index, service: upstream.createSessionSearchService(index) };
  })().catch(error => { opening = undefined; throw error; });
  return {
    async query(request) {
      if (closed) throw new Error('Search is closed');
      active?.controller.abort();
      const operation = { id: request.id, controller: new AbortController() };
      active = operation;
      const { signal } = operation.controller;
      try {
        const { service } = await open();
        const hits = [];
        for await (const batch of service.searchQuery({ q: request.text, limit: 100,
          ...(request.since === undefined ? {} : { since: request.since }) }, signal)) {
          if (signal.aborted) break;
          hits.push(...batch.hits);
        }
        const status = await service.indexStatus();
        let visibleHits = hits;
        if (!signal.aborted && projectInput && projectedSnippet) {
          const sources = new Map();
          let remaining = 24 * 1024 * 1024;
          const text = message => typeof message?.content === 'string' ? message.content
            : Array.isArray(message?.content) ? message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') : '';
          const matches = value => request.text.trim().toLowerCase().split(/\s+/u).every(term => value.toLowerCase().includes(term));
          visibleHits = [];
          for (const hit of hits) {
            if (signal.aborted) break;
            if (hit.role !== 'user' && hit.entryId !== null || !projectedSnippet(hit.snippet)) { visibleHits.push(hit); continue; }
            const key = JSON.stringify([hit.sessionPath, hit.sessionId]);
            if (!sources.has(key)) {
              let source = null;
              try {
                const size = (await stat(hit.sessionPath)).size;
                if (size <= remaining) {
                  remaining -= size;
                  const history = await readSessionHistory(upstream, sessions, hit.sessionPath, hit.sessionId, size);
                  if (history) {
                    const inputs = new Map(), messages = new Map();
                    const first = history.entries.find(entry => entry.type === 'message' && entry.message?.role === 'user');
                    for (const entry of history.entries) {
                      if (entry.type !== 'message' || entry.message?.role !== 'user') continue;
                      const original = text(entry.message);
                      messages.set(entry.id, original);
                      const input = projectInput(original);
                      if (input) inputs.set(entry.id, input);
                    }
                    source = { inputs, messages, first: first && inputs.get(first.id),
                      firstText: first && messages.get(first.id),
                      name: history.entries.findLast(entry => entry.type === 'session_info')?.name ?? '' };
                  }
                }
              } catch {}
              sources.set(key, source);
            }
            const source = sources.get(key);
            if (!source) {
              // Preserve an unconfirmed match without leaking or misclassifying its excerpt.
              visibleHits.push({ ...hit, snippet: '' });
              continue;
            }
            const input = hit.entryId === null ? source.first : source.inputs.get(hit.entryId);
            if (!input) {
              const originals = hit.entryId === null ? [source.name, source.firstText] : [source.messages.get(hit.entryId)];
              const confirmed = originals.some(original => confirmsSnippet(original, hit.snippet));
              visibleHits.push(confirmed ? hit : { ...hit, snippet: '' });
              continue;
            }
            const visible = hit.entryId === null && matches(source.name) ? source.name : input;
            if (matches(visible)) visibleHits.push({ ...hit, snippet: visible });
          }
        }
        const shortQuery = status.state !== 'degraded' && request.text.trim().split(/\s+/u).some(token => [...token].length < 3);
        const limit = shortQuery ? 50 : 100;
        return {
          id: request.id, hits: signal.aborted ? [] : visibleHits.slice(0, 100),
          index: { state: status.state, indexed: status.indexed, total: status.total,
            pending: status.pending, errors: status.errors },
          limited: hits.length >= limit, limit, shortQuery,
          sessionOnly: status.state === 'degraded',
          ...(signal.aborted ? { cancelled: true } : {}),
        };
      } finally { if (active === operation) active = undefined; }
    },
    cancel(id) { if (active?.id === id) active.controller.abort(); },
    async close() {
      closed = true;
      active?.controller.abort();
      const current = await opening?.catch(() => undefined);
      await current?.index.close();
    },
  };
}
