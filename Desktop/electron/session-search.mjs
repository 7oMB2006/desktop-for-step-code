import { dirname, isAbsolute, join, relative } from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';

// The upstream service owns SQLite, projection and fallback. This adapter owns
// only Desktop roots and cancellation; it never opens a model session.
export function createDesktopSessionSearch(upstream, { storageRoot, agentDir, sessions }) {
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
        const shortQuery = status.state !== 'degraded' && request.text.trim().split(/\s+/u).some(token => [...token].length < 3);
        const limit = shortQuery ? 50 : 100;
        return {
          id: request.id, hits: signal.aborted ? [] : hits.slice(0, 100),
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
