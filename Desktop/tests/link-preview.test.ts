import test from 'node:test';
import assert from 'node:assert/strict';
import { previewMetadata, previewUrl, publicAddress } from '../electron/link-preview';

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
