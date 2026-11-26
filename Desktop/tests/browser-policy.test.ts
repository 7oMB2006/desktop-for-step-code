import test from 'node:test';
import assert from 'node:assert/strict';
import { browserAutomationTarget, browserBounds, browserHandoffOrigin, browserHandoffRequestAllowed, browserNavigation, browserPreviewUrl, browserUrl } from '../electron/browser-policy';

test('browser addresses accept explicit web URLs and normalize local preview hosts', () => {
  assert.equal(browserUrl('localhost:4173/path'), 'http://localhost:4173/path');
  assert.equal(browserUrl('127.0.0.1:4173'), 'http://127.0.0.1:4173/');
  assert.equal(browserUrl('[::1]:4173/path'), 'http://[::1]:4173/path');
  assert.equal(browserUrl(' example.com/path '), 'https://example.com/path');
  assert.equal(browserUrl('https://example.com/中文'), 'https://example.com/%E4%B8%AD%E6%96%87');
  assert.equal(browserUrl('about:blank'), 'about:blank');
});
test('browser rejects local files, executable schemes, credentials and malformed input', () => {
  for (const value of ['', ' ', 'file:///C:/secret.txt', 'javascript:alert(1)', 'data:text/html,hello',
    'chrome://settings', 'codex://threads/123', 'mailto:test@example.com', 'ftp://example.com',
    'https://username:password@example.com', 'https://example.com/\nhello', 'https://', 'x'.repeat(8193), 123, null])
    assert.throws(() => browserUrl(value));
});
test('page navigation never treats relative URLs or bare hosts as allowed absolute targets', () => {
  assert.equal(browserNavigation('https://example.com/'), true);
  assert.equal(browserNavigation('http://localhost:4173/'), true);
  assert.equal(browserNavigation('about:blank'), true);
  for (const value of ['example.com', '/relative', 'javascript:alert(1)', 'file:///C:/', 'https://u:p@example.com/'])
    assert.equal(browserNavigation(value), false);
});
test('existing HTTP and HTTPS tabs can be shared without broadening agent-initiated navigation', () => {
  assert.equal(browserHandoffOrigin('http://example.com/write?q=draft'), 'http://example.com');
  assert.equal(browserHandoffOrigin('http://localhost:4173/path'), 'http://localhost:4173');
  assert.equal(browserHandoffOrigin('https://example.com:8443/write'), 'https://example.com:8443');
  assert.equal(browserHandoffOrigin('https://intranet.local/'), 'https://intranet.local');
  for (const url of ['about:blank', 'example.com', 'file:///C:/index.html', 'https://u:p@example.com/'])
    assert.equal(browserHandoffOrigin(url), undefined, url);
  for (const url of ['http://example.com/', 'https://example.com:8443/', 'https://intranet.local/'])
    assert.throws(() => browserAutomationTarget(url), /loopback|public HTTPS/);
});
test('fill-only handoffs permit passive reads but reject requests that can mutate authenticated state', () => {
  for (const method of ['GET', 'HEAD']) assert.equal(browserHandoffRequestAllowed(method, 'fill'), true, method);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'get'])
    assert.equal(browserHandoffRequestAllowed(method, 'fill'), false, method);
  assert.equal(browserHandoffRequestAllowed('POST', 'read'), true);
  assert.equal(browserHandoffRequestAllowed('POST'), true);
});
test('agent previews only accept explicit HTTP URLs on the supported loopback hosts', () => {
  assert.equal(browserPreviewUrl('http://localhost:5173/preview'), 'http://localhost:5173/preview');
  assert.equal(browserPreviewUrl('http://127.0.0.1:4173'), 'http://127.0.0.1:4173/');
  assert.equal(browserPreviewUrl('http://[::1]:4173/#ready'), 'http://[::1]:4173/#ready');
  for (const value of ['localhost:5173', 'https://localhost', 'http://localhost.example.com/',
    'http://127.0.0.1@192.168.1.2/', 'http://user:pass@localhost/', 'http://localhost:bad/',
    'http://2130706433/', 'http://%6cocalhost/', 'about:blank', 'file:///C:/index.html', '///localhost', null])
    assert.throws(() => browserPreviewUrl(value), String(value));
});
test('native browser geometry is finite and clipped to the current content bounds', () => {
  assert.deepEqual(browserBounds({ x: -10, y: 30, width: 400, height: 800 }, 640, 540),
    { x: 0, y: 30, width: 390, height: 510 });
  assert.equal(browserBounds(null, 640, 540), null);
  assert.equal(browserBounds({ x: 1000, y: 20, width: 400, height: 200 }, 640, 540), null);
  for (const value of [{ x: NaN, y: 1, width: 1, height: 1 }, { x: 1, y: 1, width: -1, height: 1 },
    { x: '1', y: 1, width: 1, height: 1 }, {}, 'invalid'])
    assert.throws(() => browserBounds(value, 640, 540));
});
