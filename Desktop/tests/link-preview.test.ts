import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchFavicon, fetchSameOriginFavicon, inlineFavicon, previewMetadata, previewUrl, publicAddress } from '../electron/link-preview';

test('preview excludes private destinations and unsupported URL forms', () => {
  for (const address of ['127.0.0.1', '10.0.0.4', '172.31.2.3', '192.168.1.4', '169.254.169.254', '100.64.1.2', '::1', '::ffff:127.0.0.1', 'fc00::1'])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700::1111'), true);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com/', 'https://example.com:8080/'])
    assert.throws(() => previewUrl(url));
});
test('metadata uses parsed text, normalizes whitespace and resolves relative icons', () => {
  const result = previewMetadata('<title>Fallback</title><meta property="og:title" content="Hello &amp; world"><meta name="description" content="A   page"><link rel="shortcut icon" href="/brand.png">', new URL('https://example.com/page'));
  assert.equal(result.title, 'Hello & world');
  assert.equal(result.description, 'A page');
  assert.equal(result.iconUrl, 'https://example.com/brand.png');
});

test('browser-session favicon requests stay on the page origin and omit credentials and redirects', async () => {
  const page = new URL('https://example.com/search');
  const signal = AbortSignal.timeout(5000);
  const requests: RequestInit[] = [];
  const fetchResource = async (_address: string, options: RequestInit) => {
    requests.push(options);
    return new Response('fixture', { headers: { 'Content-Type': 'Image/X-Icon; charset=binary' } });
  };
  for (const address of ['https://other.example/favicon.ico', 'https://user:pass@example.com/icon', 'http://example.com/icon'])
    assert.equal(await fetchSameOriginFavicon(address, page, signal, fetchResource), undefined);
  assert.equal(await fetchSameOriginFavicon(`${page.origin}/favicon.ico`, page, signal, fetchResource),
    `data:image/x-icon;base64,${Buffer.from('fixture').toString('base64')}`);
  assert.deepEqual(requests, [{ signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'image/*' } }]);
  assert.equal(await fetchSameOriginFavicon(`${page.origin}/icon`, page, signal,
    async () => new Response('not an image', { headers: { 'Content-Type': 'text/html' } })), undefined);
  assert.equal(await fetchSameOriginFavicon(`${page.origin}/icon`, page, signal,
    async () => new Response(new Uint8Array(96 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } })), undefined);
});

test('favicons from local previews are credential-free and stay on the visited origin', async () => {
  const seen: { url?: string; cookie?: string }[] = [];
  const server = createServer((request, response) => {
    seen.push({ url: request.url, cookie: request.headers.cookie });
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/icon' }).end(); return; }
    response.writeHead(200, { 'Content-Type': 'image/png' }).end('fixture');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const page = new URL(`http://127.0.0.1:${address.port}`);
    const signal = AbortSignal.timeout(5000);
    const icon = await fetchFavicon(`${page.origin}/icon`, signal, page);
    assert.equal(icon, `data:image/png;base64,${Buffer.from('fixture').toString('base64')}`);
    assert.equal(inlineFavicon(icon), icon);
    assert.equal(inlineFavicon('data:text/html;base64,Zm9v'), undefined);
    assert.equal(inlineFavicon(`data:image/png;base64,${'A'.repeat(132_000)}`), undefined);
    await assert.rejects(fetchFavicon(`${page.origin}/redirect`, signal, page));
    await assert.rejects(fetchFavicon(`http://localhost:${address.port}/icon`, signal, page));
    await assert.rejects(fetchFavicon(`${page.origin}/icon`, signal));
    assert.deepEqual(seen, [{ url: '/icon', cookie: undefined }, { url: '/redirect', cookie: undefined }]);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
