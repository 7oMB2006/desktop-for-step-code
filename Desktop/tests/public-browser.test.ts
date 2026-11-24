import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { test } from 'node:test';
import { automationNavigation, browserAutomationTarget } from '../electron/browser-policy';
import { publicBrowserResource } from '../electron/public-browser-policy';
import { publicBrowserEndpoint } from '../electron/public-browser-proxy';

test('public automation scopes top-level and frame navigation to a registrable site', () => {
  const { url, scope } = browserAutomationTarget('https://www.bilibili.com/');
  assert.equal(url, 'https://www.bilibili.com/');
  assert.deepEqual(scope, { kind: 'public', site: 'bilibili.com' });
  assert.equal(automationNavigation('https://search.bilibili.com/upuser?keyword=fixture', scope), true);
  assert.equal(automationNavigation('https://bilibili.com.example.org/', scope), false);
  const tenant = browserAutomationTarget('https://alice.github.io/').scope;
  assert.equal(automationNavigation('https://bob.github.io/', tenant), false);
  assert.equal(automationNavigation('https://alice.github.io/post/', tenant), true);
  for (const invalid of ['http://example.com', 'https://example.com:8443', 'https://a:b@example.com', 'https://[::1]',
    'https://127.0.0.1', 'https://0177.0.0.1', 'https://dev.localhost', 'https://nas.home', 'file:///test']) {
    assert.throws(() => browserAutomationTarget(invalid), invalid);
  }
});

test('guest browsing loads public HTTPS assets but cannot submit unsafe methods or navigate an outside frame', () => {
  const allowed = (url: string, method: string, type: string) => publicBrowserResource(url, method, type, 'example.com');
  assert.equal(allowed('https://cdn.example.net/bundle.js', 'GET', 'script'), true);
  assert.equal(allowed('https://cdn.example.net/ping', 'HEAD', 'xhr'), true);
  assert.equal(allowed('https://search.example.com/?q=fixture', 'GET', 'mainFrame'), true);
  assert.equal(allowed('https://example.com/submit', 'POST', 'mainFrame'), false);
  assert.equal(allowed('https://cdn.example.net/log', 'POST', 'xhr'), false);
  assert.equal(allowed('https://other.example.net/', 'GET', 'subFrame'), false);
  assert.equal(allowed('http://cdn.example.net/bundle.js', 'GET', 'script'), false);
  assert.equal(allowed('https://192.168.1.1/private', 'GET', 'xhr'), false);
  assert.equal(allowed('data:image/png,fixture', 'GET', 'image'), true);
  assert.equal(allowed('blob:https://example.com/id', 'GET', 'image'), true);
  assert.equal(allowed('data:text/html,fixture', 'GET', 'subFrame'), false);
});

test('the egress broker resolves exactly the HTTPS host and refuses any non-public DNS answer', async () => {
  const allowed = { address: '8.8.8.8', family: 4 };
  const resolve = (addresses: Array<{ address: string; family: number }>) => (async (host: string, options: unknown) => {
    assert.equal(host, 'www.example.com');
    assert.deepEqual(options, { all: true });
    return addresses;
  }) as typeof lookup;
  const endpoint = (addresses: Array<{ address: string; family: number }>) =>
    publicBrowserEndpoint('www.example.com:443', resolve(addresses));
  assert.deepEqual(await endpoint([allowed]), allowed);
  assert.equal(await endpoint([]), null);
  for (const address of ['127.0.0.1', '169.254.169.254', '10.1.2.3', '192.168.1.1', '100.64.0.1', '192.0.2.1',
    '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1']) {
    assert.equal(await endpoint([allowed, { address, family: address.includes(':') ? 6 : 4 }]), null, address);
  }
  assert.equal(await publicBrowserEndpoint('www.example.com:80', resolve([allowed])), null);
  assert.equal(await publicBrowserEndpoint('www.example.com:443/path', resolve([allowed])), null);
  const fake = { address: '198.18.0.91', family: 4 };
  const query = async (hostname: string) => {
    assert.equal(hostname, 'www.example.com');
    return [allowed];
  };
  assert.deepEqual(await publicBrowserEndpoint('www.example.com:443', resolve([fake]), query), allowed);
  assert.equal(await publicBrowserEndpoint('www.example.com:443', resolve([fake]), async () => [fake]), null);
  assert.equal(await publicBrowserEndpoint('www.example.com:443', resolve([fake, allowed]), query), null);
});
