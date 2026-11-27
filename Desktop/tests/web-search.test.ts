import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeRuntimeAuth, runtimeAuth } from '../electron/custom-providers';
import { saveWebSearch, stepSearchAccount, webSearchRoute, webSearchSettings, WEB_SEARCH_FIELD } from '../electron/web-search-config';
import { classifyStepSearchError, createWebSearch } from '../electron/web-search-service';
import type { WebSearchEdit, WebSearchProvider } from '../src/web-search';

type Auth = Record<string, unknown>;
const edit = (auth: Auth, change: WebSearchEdit) => saveWebSearch(auth, webSearchSettings(auth).revision, change);
const setup = (id: WebSearchProvider, enabled = true, auth: Auth = {}) =>
  edit(auth, { action: 'service', id, enabled, credential: id === 'searxng' ? 'http://localhost:9876/instance' : `${id}-fixture-secret` });
const plan = { type: 'oauth', profile: 'step_plan', access: 'step-fixture-secret' };
const runSignal = () => new AbortController().signal;
const noStep = async () => { throw new Error('Unexpected Step search'); };

test('search credentials are saved separately from enabling a service, and excluded from runtime auth', () => {
  const auth = setup('tavily', false);
  const settings = webSearchSettings(auth);
  assert.deepEqual(settings.configured, ['tavily']);
  assert.deepEqual(settings.order, []);
  assert.doesNotMatch(JSON.stringify(settings), /fixture/);
  assert.deepEqual(runtimeAuth(auth), {});
  assert.deepEqual(mergeRuntimeAuth(auth, { [WEB_SEARCH_FIELD]: 'ignored' }), auth);
  assert.deepEqual(webSearchRoute(edit(auth, { action: 'service', id: 'tavily', enabled: true })).order, ['tavily']);
  assert.throws(() => saveWebSearch(auth, 0, { action: 'policy', field: 'enabled', value: false }), /stale/);
  assert.throws(() => edit(auth, { action: 'order', order: ['step'] }), /stale/);
  assert.throws(() => edit(auth, { action: 'service', id: 'searxng', enabled: true, credential: 'https://name:secret@host/' }), /invalid-instance/);
});

test('Step Plan defaults first, remembers a manual order across sign-in and never opts a Plan user into the paid endpoint', () => {
  let auth = setup('tavily', true, { step: plan });
  assert.deepEqual(webSearchRoute(auth).order, ['step', 'tavily']);
  assert.equal(stepSearchAccount(auth)?.url, 'https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp');
  auth = edit(auth, { action: 'order', order: ['tavily', 'step'] });
  const loggedOut = mergeRuntimeAuth(auth, {});
  assert.deepEqual(webSearchRoute(loggedOut).order, ['tavily']);
  const api = { ...loggedOut, step: { type: 'api_key', key: 'step-api-fixture', profile: 'platform_oversea' } };
  assert.deepEqual(webSearchRoute(api).order, ['tavily']);
  assert.equal(stepSearchAccount(api)?.url, 'https://api.stepfun.ai/v1/mcp/web_search/mcp');
  const overseas = { ...loggedOut, step: { ...plan, profile: 'step_plan_oversea' } };
  assert.deepEqual(webSearchRoute(overseas).order, ['tavily', 'step']);
  assert.match(stepSearchAccount(overseas)?.url ?? '', /api\.stepfun\.ai\/step_plan\//);
  assert.deepEqual(webSearchRoute(edit(overseas, { action: 'policy', field: 'enabled', value: false })).order, []);
});

test('search settings show the routed Step account channel and region without exposing credentials', () => {
  const auth = setup('tavily');
  for (const [profile, mode, region, host] of [
    ['step_plan', 'plan', 'cn', 'api.stepfun.com'],
    ['step_plan_oversea', 'plan', 'oversea', 'api.stepfun.ai'],
    ['platform_cn', 'api', 'cn', 'api.stepfun.com'],
    ['platform_oversea', 'api', 'oversea', 'api.stepfun.ai'],
  ] as const) {
    const step = mode === 'plan' ? { ...plan, profile } : { type: 'api_key', profile, key: 'api-fixture-secret' };
    const signedIn = { ...auth, step: { ...step, uid: 'fixture-uid' } };
    const settings = webSearchSettings(signedIn);
    assert.equal(settings.step, mode);
    assert.equal(settings.stepRegion, region);
    assert.deepEqual(settings.configured, ['step', 'tavily']);
    assert.deepEqual(settings.order, mode === 'plan' ? ['step', 'tavily'] : ['tavily']);
    assert.equal(stepSearchAccount(signedIn)?.url, `https://${host}${mode === 'plan' ? '/step_plan' : ''}/v1/mcp/web_search/mcp`);
    assert.doesNotMatch(JSON.stringify(settings), /fixture-secret|fixture-uid|api\.stepfun/);
  }
  const signedOut = webSearchSettings(auth);
  assert.equal(signedOut.step, undefined);
  assert.equal(signedOut.stepRegion, undefined);
  assert.deepEqual(signedOut.configured, ['tavily']);
  assert.deepEqual(signedOut.order, ['tavily']);
});

test('each external adapter sends the expected request and returns bounded citeable results', async () => {
  const good = { url: 'https://example.org/a', title: 'Fixture', content: 'A useful result' };
  const cases = [
    ['tavily', 'https://api.tavily.com/search', 'authorization', 'Bearer tavily-fixture-secret', { results: [good] }],
    ['exa', 'https://api.exa.ai/search', 'x-api-key', 'exa-fixture-secret', { results: [{ ...good, highlights: ['A useful result'] }] }],
    ['brave', 'https://api.search.brave.com/res/v1/web/search', 'x-subscription-token', 'brave-fixture-secret', { web: { results: [{ ...good, description: good.content }] } }],
    ['bocha', 'https://api.bochaai.com/v1/web-search', 'authorization', 'Bearer bocha-fixture-secret', { code: 200, data: { webPages: { value: [{ ...good, summary: good.content }] } } }],
    ['searxng', 'http://localhost:9876/instance/search', 'authorization', null, { results: [good] }],
  ] as const;
  for (const [id, endpoint, header, secret, body] of cases) {
    const search = createWebSearch(async (raw, init) => {
      const url = new URL(raw);
      assert.equal(`${url.origin}${url.pathname}`, endpoint);
      assert.equal(new Headers(init.headers).get(header), secret);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      if (id === 'brave' || id === 'searxng') assert.equal(url.searchParams.get('q'), 'quoted & query');
      else assert.equal(JSON.parse(String(init.body)).query, 'quoted & query');
      return Response.json(body);
    }, noStep);
    const result = await search(setup(id), 'quoted & query', runSignal());
    assert.deepEqual(result.attempts, [{ provider: id, outcome: 'success' }]);
    assert.match(result.text, /Fixture.*https:\/\/example\.org\/a/);
    assert.match(result.text, /A useful result/);
  }
});

test('fallback only proceeds on allowed failures and never sends a query to a saved but disabled service', async () => {
  const auth = setup('bocha', false, setup('exa', true, setup('tavily')));
  for (const [status, results, outcome, attempts] of [
    [429, [], 'rate', 2], [432, [], 'quota', 2], [408, [], 'timeout', 2],
    [401, [], 'auth', 1], [403, [], 'auth', 1], [500, [], 'unavailable', 1], [200, [], 'empty', 1],
  ] as const) {
    const calls: string[] = [];
    const search = createWebSearch(async url => {
      calls.push(url);
      return url.includes('tavily') ? Response.json({ results }, { status }) : Response.json({ results: [] });
    }, noStep);
    const result = await search(auth, 'query', runSignal());
    assert.equal(result.attempts[0]?.outcome, outcome);
    assert.equal(calls.length, attempts);
    assert.ok(calls.every(url => !url.includes('bocha')));
    assert.equal((await search(edit(auth, { action: 'policy', field: 'fallback', value: false }), 'query', runSignal())).attempts.length, 1);
    assert.equal((await search(edit(auth, { action: 'policy', field: 'enabled', value: false }), 'query', runSignal())).attempts.length, 0);
  }
});

test('aborts stop the chain; per-service deadlines continue it without exposing raw provider errors', async () => {
  const auth = setup('exa', true, setup('tavily'));
  const visited: string[] = [];
  const search = createWebSearch(async (url, init) => {
    visited.push(url);
    if (visited.length === 1) return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
    throw new Error('exa-fixture-secret must not be visible');
  }, noStep, { total: 150, attempt: 20 });
  const keepAlive = setTimeout(() => {}, 200);
  try {
    const result = await search(auth, 'query', runSignal());
    assert.deepEqual(result.attempts.map(x => x.outcome), ['timeout', 'unavailable']);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
    visited.length = 0;
    const abort = new AbortController();
    const work = search(auth, 'query', abort.signal);
    abort.abort();
    await assert.rejects(work, /aborted/);
    assert.equal(visited.length, 1);
  } finally { clearTimeout(keepAlive); }
});

test('native Step failure codes are narrowed and successful content is scrubbed', async () => {
  const auth = setup('tavily', true, { step: plan });
  assert.equal(classifyStepSearchError(new Error('Error POSTing to endpoint (HTTP 401)')).outcome, 'auth');
  const search = createWebSearch(async () => Response.json({ results: [] }), async account => {
    assert.match(account.url, /\/step_plan\//);
    return { text: 'Echo step-fixture-secret', count: 1 };
  });
  const result = await search(auth, 'query', runSignal());
  assert.deepEqual(result.attempts, [{ provider: 'step', outcome: 'success' }]);
  assert.equal(result.text, 'Echo [redacted]');
});
