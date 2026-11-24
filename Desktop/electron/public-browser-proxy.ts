import { getServers, lookup, Resolver } from 'node:dns/promises';
import { createServer } from 'node:http';
import { BlockList, connect, Socket } from 'node:net';
import { publicAddress } from './link-preview';
import { publicBrowserSite } from './public-browser-policy';

const specialAddresses = new BlockList();
const syntheticAddress = new BlockList();
syntheticAddress.addSubnet('198.18.0.0', 15, 'ipv4');
for (const address of ['192.0.0.0', '192.0.2.0', '192.88.99.0', '198.51.100.0', '203.0.113.0'])
  specialAddresses.addSubnet(address, 24, 'ipv4');
for (const [address, mask] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const)
  specialAddresses.addSubnet(address, mask, 'ipv6');

async function lookupDns(hostname: string) {
  // Query the other configured resolvers individually: a successful synthetic
  // reply from the VPN stub prevents normal failover to the next DNS server.
  const servers = getServers().filter(server => !syntheticAddress.check(server.replace(/:\d+$/, ''), 'ipv4'));
  const replies = await Promise.all(servers.map(async server => {
    const resolver = new Resolver({ timeout: 1800, tries: 1 });
    resolver.setServers([server]);
    const values = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    return values.flatMap((reply, index) => reply.status === 'fulfilled'
      ? reply.value.map(address => ({ address, family: index === 0 ? 4 : 6 })) : []);
  }));
  return replies.flat().filter(({ address, family }) => family !== 4 || !syntheticAddress.check(address, 'ipv4'));
}

export async function publicBrowserEndpoint(authority: string, resolve = lookup, queryDns = lookupDns) {
  if (!/^[a-z0-9.-]+:443$/i.test(authority) || !publicBrowserSite(`https://${authority}/`)) return null;
  const hostname = authority.slice(0, -4);
  let addresses = await resolve(hostname, { all: true });
  // Some VPN DNS stubs return synthetic addresses. Query configured DNS
  // servers for real records instead; never dial a synthetic or private IP.
  if (addresses.length && addresses.every(({ address, family }) => family === 4 && syntheticAddress.check(address, 'ipv4')))
    addresses = await queryDns(hostname);
  if (!addresses.length || addresses.some(({ address, family }) => !publicAddress(address)
    || specialAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6'))) return null;
  return addresses.find(({ family }) => family === 4) ?? addresses[0];
}

// Chromium keeps end-to-end TLS. Only this broker resolves and dials CONNECT
// targets, so a validated name is never resolved again by the client.
export class PublicBrowserProxy {
  private readonly sockets = new Set<Socket>();
  private closed = false;
  private ready?: Promise<string>;
  private readonly server = createServer({ maxHeaderSize: 8192 }, (_request, response) => response.writeHead(405).end());

  start() {
    if (this.closed) return Promise.reject(new Error('Public browser proxy is closed'));
    return this.ready ??= new Promise<string>((resolve, reject) => {
      this.server.maxConnections = 128;
      this.server.on('connection', socket => {
        this.sockets.add(socket);
        socket.once('close', () => this.sockets.delete(socket));
        socket.on('error', () => socket.destroy());
        socket.setTimeout(10_000, () => socket.destroy());
      });
      this.server.on('connect', (request, client, head) => {
        if (!(client instanceof Socket)) { client.destroy(); return; }
        client.pause();
        void (async () => {
          const endpoint = await publicBrowserEndpoint(request.url ?? '');
          if (client.destroyed || this.closed) return;
          if (!endpoint) { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
          const upstream = connect({ host: endpoint.address, family: endpoint.family, port: 443 });
          client.once('close', () => upstream.destroy());
          upstream.once('close', () => client.destroy());
          upstream.on('error', () => client.destroy());
          upstream.setTimeout(90_000, () => upstream.destroy());
          upstream.once('connect', () => {
            client.setTimeout(90_000);
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) upstream.write(head);
            client.pipe(upstream).pipe(client);
          });
        })().catch(() => client.destroy());
      });
      this.server.on('error', error => { reject(error); this.close(); });
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (!address || typeof address === 'string' || this.closed) { reject(new Error('Public browser proxy unavailable')); return; }
        this.server.unref();
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  }

  close() {
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
    this.server.close();
  }
}
