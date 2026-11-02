import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFulltextQuery, projectFulltextResult } from '../electron/session-search';
import { searchTerms, searchTextMatch, snippetParts } from '../src/fulltext-search';
import type { FulltextQuery } from '../src/fulltext-search';
import type { Session } from '../src/contracts';
import { parseHTML } from 'linkedom';
import { searchMessageElement } from '../src/search-location';
// @ts-expect-error Staged Node ESM adapter.
import { createDesktopSessionSearch } from '../electron/session-search.mjs';

const query: FulltextQuery = { id: 'search-1', text: 'context' };
const session: Session = { id: 'session-1', path: resolve('fixture/session.jsonl'), cwd: resolve('project'),
  firstMessage: 'First message', messageCount: 2, modified: new Date().toISOString() };
const hit = { sessionId: session.id, sessionPath: session.path, entryId: 'answer', role: 'assistant', ts: 1, snippet: '\u0002context\u0003' };
const index = { state: 'ready', indexed: 1, total: 1, pending: 0, errors: 0, dbPath: 'PRIVATE_DB_PATH' };

test('fulltext requests are bounded and have opaque cancellation identities', () => {
  assert.equal(parseFulltextQuery({ ...query, text: '  context  ' }).text, 'context');
  for (const change of [{ text: '' }, { text: 'a'.repeat(501) }, { id: '../file' },
    { since: NaN }, { since: -1 }, { project: 5 }, { includeArchived: 'yes' }])
    assert.throws(() => parseFulltextQuery({ ...query, ...change }));
});
test('result projection excludes unknown, child, mismatched, archived and relocated-project records', () => {
  const child = { ...session, id: 'subagent-child', path: resolve('fixture/child.jsonl') };
  const raw = { id: query.id, index, hits: [hit, hit, { ...hit, sessionId: 'private' },
    { ...hit, sessionPath: resolve('personal/session.jsonl') },
    { ...hit, sessionId: child.id, sessionPath: child.path }], limited: true, sessionOnly: false };
  const result = projectFulltextResult(raw, query, [session, child], {});
  assert.equal(result.hits.length, 1);
  assert.equal(result.limited, true);
  assert.equal(JSON.stringify(result).includes('PRIVATE_DB_PATH'), false);
  assert.equal('sessionPath' in result.hits[0], false);
  assert.equal(projectFulltextResult(raw, query, [session], { archivedSessionIds: [session.id] }).hits.length, 0);
  assert.equal(projectFulltextResult(raw, { ...query, includeArchived: true }, [session], { archivedSessionIds: [session.id] }).hits.length, 1);
  const moved = { ...session, workspacePath: resolve('new-project') };
  assert.equal(projectFulltextResult(raw, { ...query, project: moved.workspacePath }, [moved], {}).hits.length, 1);
  assert.equal(projectFulltextResult(raw, { ...query, project: session.cwd }, [moved], {}).hits.length, 0);
  assert.throws(() => projectFulltextResult({ ...raw, id: 'other' }, query, [session], {}));
});
test('snippets are parsed as text, not HTML, and preserve exact match boundaries', () => {
  assert.deepEqual(snippetParts('before \u0002<img src=x>\u0003 after'),
    [{ text: 'before ', matched: false }, { text: '<img src=x>', matched: true }, { text: ' after', matched: false }]);
  assert.deepEqual(searchTerms(' Cache   CACHE 命中 '), ['cache', '命中']);
});
test('message locations prefer exact response prose rather than its grouped article', () => {
  const { document } = parseHTML('<main><article data-message-index="1">' +
    '<div class="response-text" data-message-index="1">first</div>' +
    '<div class="response-text" data-message-index="3">next</div></article>' +
    '<article data-message-index="4">user</article></main>');
  const root = document.querySelector('main') as unknown as HTMLElement;
  assert.equal(searchMessageElement(root, 1)?.className, 'response-text');
  assert.equal(searchMessageElement(root, 3)?.textContent, 'next');
  assert.equal(searchMessageElement(root, 4)?.textContent, 'user');
  assert.equal(searchMessageElement(root, 9), null);
  assert.equal(searchMessageElement(root, -1), null);
  assert.equal(searchMessageElement(null, 1), null);
});
test('message location selects the matching block of the exact entry, not the first block or grouped neighbour', () => {
  const { document } = parseHTML('<main><article data-message-index="1">' +
    '<div class="response-text" data-message-index="1">first block</div>' +
    '<div class="response-text" data-message-index="1"><p>later BLOCKNEEDLE</p></div>' +
    '<div class="response-text" data-message-index="3">neighbourneedle</div></article>' +
    '<article data-message-index="4"><button>controlneedle</button><p>userneedle</p></article></main>');
  const root = document.querySelector('main') as unknown as HTMLElement;
  assert.equal(searchMessageElement(root, 1, 'blockneedle')?.textContent, 'later BLOCKNEEDLE');
  assert.equal(searchMessageElement(root, 1, 'neighbourneedle')?.textContent, 'first block');
  assert.equal(searchMessageElement(root, 4, 'userneedle')?.tagName, 'ARTICLE');
  assert.equal(searchMessageElement(root, 9, 'blockneedle'), null);
});
test('search text matching retains exact offsets on later pages and page-spanning literal keywords', () => {
  const later = 'x'.repeat(40_000) + 'Page[needle]' + 'y'.repeat(8_000);
  const match = searchTextMatch(later, 'PAGE[NEEDLE]');
  assert.equal(match?.index, 40_000);
  assert.equal(match?.[0], 'Page[needle]');
  assert.equal(Math.floor(match!.index / 16_384), 2);
  const spanning = searchTextMatch('x'.repeat(32_764) + '跨页定位关键词', '跨页定位关键词');
  assert.equal(spanning?.index, 32_764);
  assert.ok(spanning!.index + spanning![0].length > 32_768);
  assert.equal(searchTextMatch('İ pageword', 'pageword')?.index, 2, 'Unicode case matching cannot shift raw-text offsets');
  assert.equal(searchTextMatch('unmatched', 'missing'), null);
  assert.equal(searchTextMatch('text', '   '), null);
});
test('query cancellation before index startup discards the old request without cancelling a newer one', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-fulltext-cancel-')));
  await mkdir(join(root, 'sessions'));
  await mkdir(join(root, 'agent'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const calls: any[] = [];
  const search = createDesktopSessionSearch({
    openSessionIndex: async (options: unknown) => { calls.push(options); await ready; return { close: async () => {} }; },
    createSessionSearchService: () => ({
      async *searchQuery(params: unknown, signal: AbortSignal) { if (!signal.aborted) yield { hits: [{ ...hit, params }] }; },
      indexStatus: async () => index,
    }),
  }, { storageRoot: root, agentDir: join(root, 'agent'), sessions: join(root, 'sessions') });
  const first = search.query(query);
  const next = search.query({ ...query, id: 'search-2' });
  search.cancel(query.id);
  release();
  assert.equal((await first).cancelled, true);
  assert.equal((await next).hits.length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].roots, [{ path: join(root, 'sessions'), kind: 'custom' }]);
  assert.equal(calls[0].dbPath, join(root, 'agent', 'index', 'desktop-session-search.v1.db'));
  await search.close();
});
test('search creates only the Desktop agent directory and rejects storage outside the isolated root', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-fulltext-roots-')));
  const desktop = join(root, 'desktop'), personal = join(root, 'personal');
  await mkdir(join(desktop, 'sessions'), { recursive: true });
  await mkdir(personal);
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const calls: any[] = [];
  const upstream = {
    openSessionIndex: async (options: unknown) => { calls.push(options); return { close: async () => {} }; },
    createSessionSearchService: () => ({
      async *searchQuery() { yield { hits: [] }; },
      indexStatus: async () => index,
    }),
  };
  const search = createDesktopSessionSearch(upstream, {
    storageRoot: desktop, agentDir: join(desktop, 'agent'), sessions: join(desktop, 'sessions'),
  });
  await search.query(query);
  assert.equal(existsSync(join(desktop, 'agent')), true, 'A draft can search before starting a runtime');
  assert.equal(calls.length, 1);
  await search.close();
  for (const options of [
    { storageRoot: desktop, agentDir: join(personal, 'agent'), sessions: join(desktop, 'sessions') },
    { storageRoot: desktop, agentDir: join(desktop, 'agent'), sessions: personal },
    { agentDir: join(desktop, 'agent'), sessions: join(desktop, 'sessions') },
  ]) {
    const rejected = createDesktopSessionSearch(upstream, options);
    await assert.rejects(rejected.query(query), /Search requires/);
    await rejected.close();
  }
  assert.equal(calls.length, 1, 'An invalid boundary cannot start the index');
  assert.equal(existsSync(join(personal, 'agent')), false);
});

const bundle = resolve('runtime/step/dist/bundle/index.js');
test('native index searches real Desktop and imported messages, excludes tools/children, and refreshes appends/deletes', { skip: !existsSync(bundle) }, async t => {
  const upstream = await import(pathToFileURL(bundle).href);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-fulltext-native-')));
  const sessions = join(root, 'sessions'), imported = join(sessions, 'imported');
  await mkdir(imported, { recursive: true });
  await mkdir(join(root, 'agent'));
  const stamp = new Date().toISOString();
  const make = (id: string, text: string) => [
    { type: 'session', id, version: 3, cwd: resolve('project'), timestamp: stamp },
    { type: 'message', id: 'user', parentId: null, timestamp: stamp, message: { role: 'user', content: 'initial prompt', timestamp: 1 } },
    { type: 'message', id: 'answer', parentId: 'user', timestamp: stamp,
      message: { role: 'assistant', content: [{ type: 'text', text }], timestamp: 2 } },
    { type: 'message', id: 'tool', parentId: 'answer', timestamp: stamp,
      message: { role: 'toolResult', toolCallId: 'tool', content: [{ type: 'text', text: 'PRIVATE_TOOL_NEEDLE' }], timestamp: 3 } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
  const file = join(sessions, 'one.jsonl');
  await writeFile(file, make('one', 'native_search_needle 命中结果正文'));
  await writeFile(join(imported, 'two.jsonl'), make('two', 'imported_search_needle'));
  await writeFile(join(sessions, 'child.jsonl'), make('subagent-1', 'child_private_needle'));
  await mkdir(join(root, 'agent', 'sessions'));
  await writeFile(join(root, 'agent', 'sessions', 'personal.jsonl'), make('private', 'personal_private_needle'));
  const before = await readFile(file);
  const search = createDesktopSessionSearch(upstream, { storageRoot: root, agentDir: join(root, 'agent'), sessions });
  t.after(async () => { await search.close(); await rm(root, { recursive: true, force: true }); });
  let result;
  for (let attempt = 0; attempt < 80; attempt++) {
    result = await search.query({ ...query, text: 'native_search_needle' });
    if (result.index.state === 'ready' && result.hits.length) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(result.index.state, 'ready', 'The staged bundle must run SQLite, not silently fall back');
  assert.equal(result.hits[0].entryId, 'answer');
  assert.equal(result.sessionOnly, false);
  assert.equal((await search.query({ ...query, text: 'imported_search_needle' })).hits.length, 1);
  assert.equal((await search.query({ ...query, text: 'PRIVATE_TOOL_NEEDLE' })).hits.length, 0);
  assert.equal((await search.query({ ...query, text: 'child_private_needle' })).hits.length, 0);
  assert.equal((await search.query({ ...query, text: 'personal_private_needle' })).hits.length, 0);
  assert.equal((await search.query({ ...query, text: '命中' })).shortQuery, true);
  assert.equal((await search.query({ ...query, text: '命中' })).sessionOnly, false);
  assert.deepEqual(await readFile(file), before, 'Search cannot migrate or rewrite authoritative JSONL');
  await writeFile(file, before + JSON.stringify({ type: 'message', id: 'new', parentId: 'tool', timestamp: stamp,
    message: { role: 'user', content: 'appended_search_needle', timestamp: Date.now() } }) + '\n');
  assert.equal((await search.query({ ...query, text: 'appended_search_needle' })).hits.length, 1);
  await rm(file);
  assert.equal((await search.query({ ...query, text: 'native_search_needle' })).hits.length, 0);
  const blocked = join(root, 'blocked-db-directory');
  await writeFile(blocked, 'not a directory');
  const fallback = createDesktopSessionSearch({
    ...upstream, openSessionIndex: (options: object) => upstream.openSessionIndex({ ...options, dbPath: join(blocked, 'search.db') }),
  }, { storageRoot: root, agentDir: join(root, 'agent'), sessions });
  t.after(() => fallback.close());
  const degraded = await fallback.query({ ...query, text: 'imported_search_needle' });
  assert.equal(degraded.index.state, 'degraded');
  assert.equal(degraded.sessionOnly, true);
  assert.equal(degraded.hits.length, 1);
  assert.equal(degraded.hits[0].entryId, null, 'Native JSONL fallback cannot promise a message location');
  assert.equal((await fallback.query({ ...query, text: 'personal_private_needle' })).hits.length, 0);
  await fallback.close();
});
