import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as tcpServer, connect } from 'node:net';
import { createServer, request } from 'node:http';
import type { Duplex } from 'node:stream';
import { DesktopNetwork, validateNetwork } from '../electron/network';

test('network settings normalize HTTP(S) addresses and reject credential-bearing or unsupported proxy URLs', () => {
  assert.deepEqual(validateNetwork({ mode: 'manual', proxyUrl: 'http://127.0.0.1:7897/' }), { mode: 'manual', proxyUrl: 'http://127.0.0.1:7897' });
  assert.deepEqual(validateNetwork({ mode: 'direct', proxyUrl: 'ignored' }), { mode: 'direct', proxyUrl: '' });
  assert.deepEqual(validateNetwork({ mode: 'system' }), { mode: 'system', proxyUrl: '' });
  for (const proxyUrl of ['socks5://localhost:1080', 'file:///secret', 'http://u:secret@localhost', 'http://localhost/path', 'http://localhost?secret=1', 'http://localhost#secret']) {
    assert.throws(() => validateNetwork({ mode: 'manual', proxyUrl }));
  }
  for (const value of [null, [], {}, { mode: 'unknown' }, { mode: 'manual', proxyUrl: 3 }]) assert.throws(() => validateNetwork(value));
});

test('runtime tunnels authenticate, preserve HTTP/HTTPS resolution, obey PAC failover and retire old connections', async () => {
  const owned = new Set<Duplex>();
  const track = (socket: Duplex) => { owned.add(socket); socket.on('error', () => {}); socket.once('close', () => owned.delete(socket)); };
  const echo = tcpServer(socket => { track(socket); socket.pipe(socket); });
  const proxy = createServer();
  let proxied = 0;
  proxy.on('connection', track);
  proxy.on('connect', (_req, client, head) => {
    proxied++;
    const remote = connect((echo.address() as { port: number }).port, '127.0.0.1');
    track(remote);
    remote.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote); remote.pipe(client);
    });
    client.once('close', () => remote.destroy()); remote.once('close', () => client.destroy());
  });
  await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve));
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const route = `PROXY 127.0.0.1:${(proxy.address() as { port: number }).port}`;
  let routes = route;
  const resolved: string[] = [];
  const configs: any[] = [];
  const network = new DesktopNetwork({
    setProxy: async config => { configs.push(config); },
    closeAllConnections: async () => {},
    resolveProxy: async url => { resolved.push(url); return routes; },
    fetch: globalThis.fetch,
  });
  const tunnel = (gateway: string, target: string, authenticate = true) => new Promise<{ status: number; socket: Duplex }>((resolve, reject) => {
    const url = new URL(gateway);
    const req = request({ host: url.hostname, port: url.port, method: 'CONNECT', path: target,
      headers: authenticate ? { 'proxy-authorization': `Basic ${Buffer.from(`${url.username}:${url.password}`).toString('base64')}` } : {} });
    req.once('connect', (response, socket) => { track(socket); resolve({ status: response.statusCode!, socket }); });
    req.once('error', reject); req.end();
  });
  try {
    assert.throws(() => network.environment({}));
    await network.start({ mode: 'system', proxyUrl: '' });
    const env = network.environment({ http_proxy: 'http://old', HTTPS_PROXY: 'http://old', no_proxy: '*', ALL_PROXY: 'http://old', Path: 'preserved' });
    assert.equal(env.http_proxy, undefined); assert.equal(env.no_proxy, undefined); assert.equal(env.ALL_PROXY, undefined);
    assert.equal(env.Path, 'preserved'); assert.equal(env.NO_PROXY, '');
    assert.notEqual(env.HTTP_PROXY, env.HTTPS_PROXY, 'separate listeners retain the original URL scheme');
    assert.equal(JSON.stringify(network.settings()).includes('desktop:'), false);
    const rejected = await tunnel(env.HTTPS_PROXY!, 'provider.invalid:443', false);
    assert.equal(rejected.status, 407); rejected.socket.destroy();
    const invalid = await tunnel(env.HTTP_PROXY!, 'user@provider.invalid:80');
    assert.equal(invalid.status, 400); invalid.socket.destroy();
    const http = await tunnel(env.HTTP_PROXY!, 'provider.invalid:80');
    assert.equal(http.status, 200);
    assert.equal(resolved.at(-1), 'http://provider.invalid/');
    const https = await tunnel(env.HTTPS_PROXY!, 'provider.invalid:443');
    assert.equal(https.status, 200);
    assert.equal(resolved.at(-1), 'https://provider.invalid/');
    const reply = new Promise<Buffer>(resolve => https.socket.once('data', resolve));
    https.socket.write('opaque TLS bytes');
    assert.equal((await reply).toString(), 'opaque TLS bytes');
    assert.equal(proxied, 2);
    const closed = new Promise<void>(resolve => https.socket.once('close', resolve));
    await network.apply({ mode: 'direct', proxyUrl: '' });
    https.socket.resume();
    await closed;
    assert.deepEqual(configs.at(-1), { mode: 'direct' });
    routes = 'PROXY 127.0.0.1:1';
    const failed = await tunnel(env.HTTP_PROXY!, `127.0.0.1:${(echo.address() as { port: number }).port}`);
    assert.equal(failed.status, 502, 'an unavailable proxy never silently falls back to direct');
    failed.socket.destroy();
    routes += '; DIRECT';
    const fallback = await tunnel(env.HTTP_PROXY!, `127.0.0.1:${(echo.address() as { port: number }).port}`);
    assert.equal(fallback.status, 200, 'explicit PAC DIRECT fallback is respected');
    fallback.socket.destroy();
    routes = 'SOCKS5 localhost:1080';
    const unsupported = await tunnel(env.HTTPS_PROXY!, 'provider.invalid:443');
    assert.equal(unsupported.status, 502); unsupported.socket.destroy();
    await network.apply({ mode: 'manual', proxyUrl: 'https://127.0.0.1:7897' });
    assert.deepEqual(configs.at(-1), { mode: 'fixed_servers', proxyRules: 'https://127.0.0.1:7897' });
  } finally {
    await network.stop();
    for (const socket of owned) socket.destroy();
    await Promise.all([new Promise<void>(resolve => echo.close(() => resolve())), new Promise<void>(resolve => proxy.close(() => resolve()))]);
  }
});

test('network probes treat HTTP denial as reachability and never return upstream secrets', async () => {
  const network = new DesktopNetwork({
    setProxy: async () => {}, closeAllConnections: async () => {},
    resolveProxy: async () => 'PROXY localhost:7897',
    fetch: async () => new Response('private-key upstream text', { status: 401 }),
  });
  const result = await network.probe('https://api.openai.com/v1/models');
  assert.equal(result.outcome, 'reachable'); assert.equal(result.route, 'proxy'); assert.equal(result.status, 401);
  assert.equal(JSON.stringify(result).includes('private-key'), false);
  for (const url of ['file:///secret', 'https://u:secret@example.com', 'https://example.com?key=secret', 'https://example.com#secret']) await assert.rejects(network.probe(url));
});

test('failed policy application restores the previous Chromium policy', async () => {
  const configs: unknown[] = [];
  let fail = false;
  const network = new DesktopNetwork({
    setProxy: async config => { configs.push(config); },
    closeAllConnections: async () => { if (fail) { fail = false; throw new Error('fixture'); } },
    resolveProxy: async () => 'DIRECT', fetch: globalThis.fetch,
  });
  await network.apply({ mode: 'direct', proxyUrl: '' });
  fail = true;
  await assert.rejects(network.apply({ mode: 'manual', proxyUrl: 'http://localhost:7897' }));
  assert.deepEqual(network.settings(), { mode: 'direct', proxyUrl: '' });
  assert.deepEqual(configs.at(-1), { mode: 'direct' });
});

test('a route resolution started before a policy change cannot open a stale tunnel', async () => {
  let finish!: (route: string) => void;
  const network = new DesktopNetwork({
    setProxy: async () => {}, closeAllConnections: async () => {},
    resolveProxy: () => new Promise<string>(resolve => { finish = resolve; }), fetch: globalThis.fetch,
  });
  await network.apply({ mode: 'system', proxyUrl: '' });
  const pending = (network as unknown as { tunnel(url: URL, signal: AbortSignal): Promise<Duplex> })
    .tunnel(new URL('http://localhost:1'), new AbortController().signal);
  const rejected = assert.rejects(pending, /settings are changing/);
  await network.apply({ mode: 'direct', proxyUrl: '' });
  finish('DIRECT');
  await rejected;
});
