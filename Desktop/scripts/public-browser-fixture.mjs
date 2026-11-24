import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const publicHome = 'https://www.dfsc-fixture.example.com/';
export const publicSearch = 'https://search.dfsc-fixture.example.com/';
export const outsideSite = 'https://outside.dfsc-fixture.example.org/';
const cdn = 'assets.dfsc-fixture.example.net';
const privateHost = 'private.dfsc-fixture.example.net';

export async function publicBrowserFixture(profile) {
  const hosts = [publicHome, publicSearch, outsideSite].map(url => new URL(url).hostname).concat(cdn);
  const key = join(profile, 'public-fixture-key.pem');
  const cert = join(profile, 'public-fixture-cert.pem');
  await promisify(execFile)(process.env.DESKTOP_TEST_OPENSSL || (process.platform === 'win32'
    ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'), [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
    '-subj', `/CN=${hosts[0]}`, '-addext', `subjectAltName=${hosts.map(host => `DNS:${host}`).join(',')}`,
  ], { windowsHide: true });
  const pem = await readFile(cert, 'utf8');
  const requests = [];
  const server = createServer({ key: await readFile(key), cert: pem }, (req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    requests.push({ host: url.host, path: url.pathname, method: req.method, cookie: req.headers.cookie });
    if (url.host === cdn) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end("document.querySelector('#cdn').textContent = 'Public CDN loaded'"); return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (url.pathname === '/profile') { res.end('<title>Public profile</title><h1>Public profile opened</h1>'); return; }
    if (url.pathname === '/results') {
      const result = url.searchParams.get('q') === 'browser fixture' ? 'Anonymous search result' : 'No results';
      res.end(`<title>Search results</title><h1>${result}</h1><a target="_blank" href="/profile">Open profile</a>`);
      return;
    }
    res.end(`<!doctype html><title>Public fixture</title><p id="cdn"></p>
      <h1>${req.headers.cookie?.includes('agent_fixture=isolated') ? 'Agent profile sign-in' : 'Guest access'}</h1>
      <form action="${publicSearch}results"><label>Search <input name="q"></label><button>Search</button></form>
      <script src="https://${cdn}/asset.js"></script>
      <script>
        fetch('/write', {method:'POST',body:'fixture'}).catch(()=>{});
        fetch('https://${privateHost}/private').catch(()=>{});
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    requests,
    attach: app => app.evaluate(async ({ app, session }, { port, pem, hosts, privateHost, publicHome }) => {
      const dns = process.getBuiltinModule('node:dns/promises');
      const net = process.getBuiltinModule('node:net');
      const lookup = dns.lookup;
      const connect = net.connect;
      // Substitute fixture DNS and transport only in the disposable test process.
      dns.lookup = (host, options, ...args) => hosts.includes(host) && options?.all
        ? Promise.resolve([{ address: '8.8.4.4', family: 4 }])
        : host === privateHost && options?.all ? Promise.resolve([{ address: '127.0.0.1', family: 4 }])
          : lookup(host, options, ...args);
      net.connect = (options, ...args) => options?.host === '8.8.4.4' && options?.port === 443
        ? connect({ host: '127.0.0.1', port }, ...args) : connect(options, ...args);
      app.on('certificate-error', (event, _contents, address, _error, certificate, callback) => {
        if (hosts.includes(new URL(address).hostname) && certificate.data.trim() === pem.trim()) {
          event.preventDefault(); callback(true);
        }
      });
      await session.fromPartition('persist:desktop-browser').cookies.set({ url: publicHome, name: 'manual_fixture', value: 'private' });
      const agent = session.fromPartition('persist:desktop-browser-agent');
      await agent.cookies.set({ url: publicHome, name: 'agent_fixture', value: 'isolated', expirationDate: Date.now() / 1000 + 86400 });
      await agent.cookies.set({ url: 'https://assets.dfsc-fixture.example.net/', name: 'asset_fixture', value: 'private',
        sameSite: 'no_restriction', secure: true });
    }, { port: server.address().port, pem, hosts, privateHost, publicHome }),
    close: () => new Promise(resolve => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}
