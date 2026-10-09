import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { testProvider } from '../electron/provider-diagnostic';
import { providerList, saveProviderAuth } from '../electron/custom-providers';
import type { CustomProvider } from '../src/contracts';

const provider = (baseUrl: string): CustomProvider => ({
  id: '', name: 'Fixture', baseUrl, api: 'openai-completions', enabled: true, keyless: false,
  models: [{ id: 'test-model', name: 'Test', reasoning: false, vision: false, contextWindow: 128000, maxTokens: 16384 }],
});
test('isolated diagnostics validate actual protocol replies, use literal keys and never expose response secrets', async () => {
  let status = 200;
  let malformed = false;
  let oversize = false;
  let redirect = false;
  let requests = 0;
  let expectedKey: string | undefined = '!literal$VALUE';
  const seen: Record<string, any>[] = [];
  const server = createServer(async (req, res) => {
    requests++;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    seen.push(body);
    assert.equal(body.stream, false);
    assert.equal(body.model, 'test-model');
    assert.equal(req.headers.authorization ?? req.headers['x-api-key'], expectedKey ? (req.url?.endsWith('/messages') ? expectedKey : `Bearer ${expectedKey}`) : undefined);
    if (redirect) { res.writeHead(302, { location: '/target' }); res.end(); return; }
    res.writeHead(status, { 'content-type': 'application/json', 'set-cookie': 'private-cookie' });
    if (status !== 200) { res.end(JSON.stringify({ error: { message: `key=${expectedKey}; private-error` } })); return; }
    if (oversize) { res.end('x'.repeat(1024 * 1024 + 1)); return; }
    if (malformed) { res.end(JSON.stringify({ choices: [], error: null, private: expectedKey })); return; }
    const text = `${expectedKey ?? ''} private-output`;
    res.end(JSON.stringify(req.url?.endsWith('/responses')
      ? { object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }
      : req.url?.endsWith('/messages')
        ? { type: 'message', role: 'assistant', content: [{ type: 'text', text }] }
        : { choices: [{ message: { role: 'assistant', content: text } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const p = provider(`http://127.0.0.1:${address.port}/v1`);
  try {
    const auth = saveProviderAuth({}, p, expectedKey);
    const saved = providerList(auth)[0];
    const original = JSON.stringify(auth);
    for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
      const result = await testProvider(auth, { ...saved, api }, 'test-model', undefined);
      assert.equal(result.ok, true);
      assert.equal(result.status, 200);
      assert.ok(result.elapsedMs >= 0);
      assert.equal(result.api, api);
      for (const secret of [expectedKey!, 'private-output', 'private-cookie']) assert.equal(JSON.stringify(result).includes(secret), false);
    }
    assert.equal(seen[1].store, false);
    assert.equal(seen[1].max_output_tokens, 256);
    assert.equal(seen[2].max_tokens, 256);
    expectedKey = 'replacement';
    assert.equal((await testProvider(auth, saved, 'test-model', expectedKey)).ok, true);
    expectedKey = undefined;
    assert.equal((await testProvider({}, { ...p, keyless: true }, 'test-model', undefined)).ok, true);
    expectedKey = '!literal$VALUE';
    for (const [code, outcome] of [[401, 'authentication'], [403, 'authentication'], [404, 'not-found'], [429, 'rate-limit'], [500, 'http-error']] as const) {
      status = code;
      const result = await testProvider({}, p, 'test-model', expectedKey);
      assert.equal(result.outcome, outcome);
      assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes('private-error'), false);
    }
    status = 200; malformed = true;
    assert.equal((await testProvider({}, p, 'test-model', expectedKey)).outcome, 'invalid-response');
    malformed = false; oversize = true;
    assert.equal((await testProvider({}, p, 'test-model', expectedKey)).outcome, 'invalid-response');
    oversize = false; redirect = true;
    const before = requests;
    assert.equal((await testProvider({}, p, 'test-model', expectedKey)).outcome, 'network');
    assert.equal(requests, before + 1, 'redirect is not followed and test never retries');
    assert.equal(JSON.stringify(auth), original, 'testing does not save configuration');
    const count = requests;
    for (const invalid of [{ ...p, baseUrl: 'file:///C:/secret' }, { ...p, baseUrl: 'https://key@example.test' }, { ...p, baseUrl: `${p.baseUrl}?key=secret` }]) {
      assert.equal((await testProvider({}, invalid, 'test-model', expectedKey)).outcome, 'invalid-config');
    }
    assert.equal((await testProvider({}, p, 'unknown', expectedKey)).outcome, 'invalid-config');
    assert.equal((await testProvider({}, p, 'test-model', undefined)).outcome, 'invalid-config');
    assert.equal(requests, count);
    const cancelled = new AbortController();
    cancelled.abort();
    assert.equal((await testProvider({}, p, 'test-model', expectedKey, cancelled.signal)).outcome, 'cancelled');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
