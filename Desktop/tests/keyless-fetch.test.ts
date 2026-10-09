import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { keylessFetch, installKeylessFetch } from '../electron/keyless-fetch';
import { keylessEnvironment, saveProviderAuth, providerList } from '../electron/custom-providers';
import { isolatedEnvironment } from '../electron/runtime';

test('no-auth adapter removes internal sentinel headers for matching endpoints only', async () => {
  const requests: { url: string; headers: Headers; init?: RequestInit }[] = [];
  const original: typeof fetch = async (input, init) => {
    requests.push({ url: input instanceof Request ? input.url : String(input), headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)), init });
    return new Response('OK');
  };
  const send = keylessFetch(original, [{ baseUrl: 'https://local.test/v1', token: 'fixture-sentinel' }]);
  const auth = { Authorization: 'Bearer fixture-sentinel', 'x-api-key': 'fixture-sentinel', Accept: 'application/json' };
  await send('https://local.test/v1/chat/completions', { method: 'POST', headers: auth, body: 'body' });
  assert.equal(requests.at(-1)!.headers.get('authorization'), null);
  assert.equal(requests.at(-1)!.headers.get('x-api-key'), null);
  assert.equal(requests.at(-1)!.headers.get('accept'), 'application/json');
  assert.equal(requests.at(-1)!.init!.body, 'body');
  for (const url of ['https://other.test/v1/messages', 'http://local.test/v1/messages', 'https://local.test:8443/v1/messages', 'https://local.test/v10/messages']) {
    await send(url, { headers: auth });
    assert.equal(requests.at(-1)!.headers.get('authorization'), auth.Authorization);
  }
  await send('https://local.test/v1/messages', { headers: { Authorization: 'Bearer real-key', 'x-api-key': 'real-key' } });
  assert.equal(requests.at(-1)!.headers.get('authorization'), 'Bearer real-key');
  assert.equal(requests.at(-1)!.headers.get('x-api-key'), 'real-key');
  const controller = new AbortController();
  const request = new Request('https://local.test/v1/messages', { method: 'POST', headers: auth, body: 'request-body', signal: controller.signal });
  await send(request);
  assert.equal(requests.at(-1)!.headers.has('authorization'), false);
  await send(request, { headers: { Authorization: 'Bearer override' } });
  assert.equal(requests.at(-1)!.headers.get('authorization'), 'Bearer override');
});

test('no-auth adapter preserves live request bodies, responses and cancellation', async () => {
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['x-api-key'], undefined);
    if (req.url === '/v1/hold') return;
    let body = '';
    for await (const part of req) body += part;
    res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  const send = keylessFetch(fetch, [{ baseUrl: url, token: 'fixture-sentinel' }]);
  try {
    const request = new Request(`${url}/messages`, { method: 'POST', headers: { 'x-api-key': 'fixture-sentinel' }, body: 'request-body' });
    assert.equal(await (await send(request)).text(), 'request-body');
    const controller = new AbortController();
    const pending = send(`${url}/hold`, { headers: { Authorization: 'Bearer fixture-sentinel' }, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('no-auth policy survives runtime fetch replacement without bypassing the new transport', async () => {
  const headers: Headers[] = [];
  const transport = (label: string): typeof fetch => async (_input, init) => { headers.push(new Headers(init?.headers)); return new Response(label); };
  const scope = { fetch: transport('first') };
  installKeylessFetch([{ baseUrl: 'https://local.test/v1', token: 'fixture-sentinel' }], scope);
  const options = { headers: { Authorization: 'Bearer fixture-sentinel' } };
  assert.equal(await (await scope.fetch('https://local.test/v1/messages', options)).text(), 'first');
  scope.fetch = transport('replacement');
  assert.equal(await (await scope.fetch('https://local.test/v1/messages', options)).text(), 'replacement');
  assert.equal(headers.every(h => !h.has('authorization')), true);
  await scope.fetch('https://other.test/v1/messages', options);
  assert.equal(headers.at(-1)!.get('authorization'), 'Bearer fixture-sentinel');
});

test('Desktop no-auth bootstrap loads from spaced paths in actual Node children', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop no-auth bootstrap '));
  const bootstrap = join(root, 'runtime adapters', 'keyless-fetch.cjs');
  const server = createServer((req, res) => {
    if (req.headers.authorization || req.headers['x-api-key']) { res.writeHead(400); res.end('Unexpected authentication'); return; }
    res.end('OK');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  try {
    await build({ entryPoints: ['electron/keyless-fetch.ts'], outfile: bootstrap, bundle: true, platform: 'node', format: 'cjs' });
    const auth = saveProviderAuth({}, { id: '', name: 'No auth', baseUrl, api: 'openai-completions', enabled: true, keyless: true,
      models: [{ id: 'fixture', name: 'Fixture', reasoning: false, vision: false, contextWindow: 1000, maxTokens: 100 }] });
    const id = providerList(auth)[0].id;
    const env = { ...isolatedEnvironment(root), ...keylessEnvironment(auth, bootstrap) };
    const script = `const r = await fetch(${JSON.stringify(`${baseUrl}/chat/completions`)}, { headers: { Authorization: ${JSON.stringify(`Bearer desktop-no-auth-${id}`)} } }); if (r.status !== 200) throw new Error('No-auth request failed'); console.log(await r.text());`;
    const { stdout } = await promisify(execFile)(resolve('runtime/node/node.exe'), ['--input-type=module', '-e', script], { env, windowsHide: true, timeout: 15000 });
    assert.equal(stdout.trim(), 'OK');
    assert.deepEqual(keylessEnvironment({}, bootstrap), {}, 'no bootstrap for ordinary providers');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
