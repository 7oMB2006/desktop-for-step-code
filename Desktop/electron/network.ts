import { Agent, createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import type { NetworkConfig, NetworkProbe } from '../src/contracts';

export function validateNetwork(raw: unknown): NetworkConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid network settings');
  const value = raw as NetworkConfig;
  if (!['system', 'direct', 'manual'].includes(value.mode)) throw new Error('Invalid proxy mode');
  if (value.mode !== 'manual') return { mode: value.mode, proxyUrl: '' };
  if (typeof value.proxyUrl !== 'string' || value.proxyUrl.length > 2048) throw new Error('Invalid proxy address');
  const url = new URL(value.proxyUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTP(S) proxy address without credentials or path');
  }
  return { mode: 'manual', proxyUrl: url.origin };
}

type NetworkSession = {
  setProxy(config: { mode: 'system' | 'direct' | 'fixed_servers'; proxyRules?: string; proxyBypassRules?: string }): Promise<void>;
  closeAllConnections(): Promise<void>;
  resolveProxy(url: string): Promise<string>;
  fetch(url: string, init: RequestInit): Promise<Response>;
};

// Proxy clients use absolute-form HTTP or CONNECT. HTTPS stays an opaque tunnel;
// plain HTTP is streamed without buffering or logging request headers/bodies.
export class DesktopNetwork {
  private config: NetworkConfig = { mode: 'system', proxyUrl: '' };
  private servers = ['http:', 'https:'].map(protocol => ({
    protocol, server: createServer(),
  }));
  private sockets = new Set<Duplex>();
  private credential = `Basic ${Buffer.from(`desktop:${randomBytes(32).toString('hex')}`).toString('base64')}`;
  private addresses: string[] = [];
  private applying = false;
  private epoch = 0;
  private stopped = false;
  constructor(private session: NetworkSession) {
    for (const { server, protocol } of this.servers) {
    server.maxHeadersCount = 32;
    server.headersTimeout = 10000;
    server.on('connection', socket => this.track(socket));
    server.on('clientError', (_error, socket) => socket.destroy());
    server.on('request', (req, res) => {
      if (req.headers['proxy-authorization'] !== this.credential) {
        res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Desktop"', Connection: 'close' }); res.end(); return;
      }
      let target: URL;
      try {
        target = new URL(req.url ?? '');
        if (protocol !== 'http:' || target.protocol !== 'http:' || target.username || target.password || target.hash) throw new Error();
      } catch { res.writeHead(400, { Connection: 'close' }); res.end(); return; }
      const abort = new AbortController();
      res.once('close', () => abort.abort());
      void this.tunnel(target, abort.signal).then(remote => {
        if (res.destroyed || this.applying) { remote.destroy(); res.destroy(); return; }
        const agent = new Agent({ keepAlive: false });
        agent.createConnection = () => remote as Socket;
        const headers = { ...req.headers, host: target.host, connection: 'close' };
        for (const header of (req.headers.connection ?? '').split(',')) delete headers[header.trim().toLowerCase() as keyof typeof headers];
        delete headers['proxy-authorization' as keyof typeof headers];
        delete headers['proxy-connection' as keyof typeof headers];
        const outgoing = httpRequest(target, { method: req.method, headers, agent, signal: abort.signal }, response => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
          response.on('error', () => res.destroy());
        });
        outgoing.on('error', () => {
          if (!res.headersSent) res.writeHead(502, { Connection: 'close' });
          res.end();
        });
        res.once('close', () => { outgoing.destroy(); agent.destroy(); remote.destroy(); });
        req.pipe(outgoing);
      }, () => { if (!res.destroyed) { res.writeHead(502, { Connection: 'close' }); res.end(); } });
    });
    server.on('connect', (req, client, head) => {
      if (req.headers['proxy-authorization'] !== this.credential) {
        client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Desktop"\r\nConnection: close\r\n\r\n');
        return;
      }
      let target: URL;
      try {
        const port = /:([0-9]+)$/.exec(req.url ?? '')?.[1];
        if (!req.url || !port || Number(port) < 1 || Number(port) > 65535 || /[\/\\?#@\s]/.test(req.url)) throw new Error();
        target = new URL(`${protocol}//${req.url}`);
        if (!target.hostname) throw new Error();
      } catch { client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
      const abort = new AbortController();
      client.once('close', () => abort.abort());
      void this.tunnel(target, abort.signal).then(remote => {
        if (client.destroyed || this.applying) { remote.destroy(); client.destroy(); return; }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) remote.write(head);
        client.pipe(remote); remote.pipe(client);
        client.once('close', () => remote.destroy());
        remote.once('close', () => client.destroy());
        remote.on('error', () => client.destroy());
        client.on('error', () => remote.destroy());
      }, () => { if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
    });
    }
  }
  private track(socket: Duplex) {
    this.sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => this.sockets.delete(socket));
    return socket;
  }
  async start(config: NetworkConfig) {
    await this.apply(config);
    try {
      for (const { server } of this.servers) {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
        });
        server.unref();
        const port = (server.address() as { port: number }).port;
        const auth = Buffer.from(this.credential.slice(6), 'base64').toString('utf8');
        this.addresses.push(`http://${auth}@127.0.0.1:${port}`);
      }
    } catch (error) { await this.stop(); throw error; }
  }
  settings(): NetworkConfig { return { ...this.config }; }
  environment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    if (this.addresses.length !== 2) throw new Error('Desktop network is not ready');
    const env = { ...parent };
    for (const key of Object.keys(env)) if (/^(http_proxy|https_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
    return { ...env, HTTP_PROXY: this.addresses[0], HTTPS_PROXY: this.addresses[1], NO_PROXY: '' };
  }
  async apply(raw: unknown) {
    const config = validateNetwork(raw);
    if (this.applying) throw new Error('Network settings are changing');
    this.applying = true;
    this.epoch++;
    const policy = (value: NetworkConfig) => value.mode === 'manual'
      ? { mode: 'fixed_servers' as const, proxyRules: value.proxyUrl }
      : { mode: value.mode };
    try {
      await this.session.setProxy(policy(config));
      await this.session.closeAllConnections();
      for (const socket of this.sockets) socket.destroy();
      this.config = config;
    } catch (error) {
      for (const socket of this.sockets) socket.destroy();
      try {
        await this.session.setProxy(policy(this.config));
        await this.session.closeAllConnections();
      } catch {
        // Keep the broker closed if Chromium cannot restore the previous policy.
        this.stopped = true;
      }
      throw error;
    } finally { this.applying = false; }
  }
  private async tunnel(target: URL, signal: AbortSignal): Promise<Duplex> {
    const epoch = this.epoch;
    const current = () => {
      signal.throwIfAborted();
      if (this.applying || this.stopped || epoch !== this.epoch) throw new Error('Network settings are changing');
    };
    current();
    // Resolution is per destination, including system PAC and bypass rules.
    const routes = (await this.session.resolveProxy(target.href)).split(';').map(route => route.trim());
    current();
    const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    for (const route of routes) {
      try {
        current();
        if (route === 'DIRECT') {
          const remote = await new Promise<Socket>((resolve, reject) => {
            const socket = this.track(connect({ host: hostname, port, signal })) as Socket;
            socket.setTimeout(10000, () => socket.destroy(new Error('Connection timed out')));
            socket.once('error', reject);
            socket.once('connect', () => { socket.setTimeout(0); resolve(socket); });
          });
          try { current(); return remote; } catch (error) { remote.destroy(); throw error; }
        }
        const match = /^(PROXY|HTTPS)\s+([^\s]+)$/.exec(route);
        if (!match) throw new Error('Unsupported system proxy protocol');
        const proxy = new URL(`${match[1] === 'HTTPS' ? 'https' : 'http'}://${match[2]}`);
        if (proxy.username || proxy.password || proxy.pathname !== '/' || !proxy.hostname) throw new Error('Invalid system proxy route');
        const remote = await new Promise<Duplex>((resolve, reject) => {
          const req = (proxy.protocol === 'https:' ? httpsRequest : httpRequest)(proxy, {
            method: 'CONNECT', path: `${target.hostname}:${port}`, agent: false, signal,
            headers: { Host: `${target.hostname}:${port}` },
          });
          const timer = setTimeout(() => req.destroy(new Error('Proxy connection timed out')), 10000);
          req.once('error', error => { clearTimeout(timer); reject(error); });
          req.once('connect', (res, socket, head) => {
            clearTimeout(timer);
            if (res.statusCode !== 200) { socket.destroy(); reject(new Error('Proxy refused tunnel')); return; }
            this.track(socket);
            if (head.length) socket.unshift(head);
            resolve(socket);
          });
          req.end();
        });
        try { current(); return remote; } catch (error) { remote.destroy(); throw error; }
      } catch {
        current();
        // Failover only follows the explicit PAC route order, before model bytes.
      }
    }
    throw new Error('No supported proxy route connected');
  }
  async probe(raw: unknown): Promise<NetworkProbe> {
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Invalid network probe address');
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid network probe address');
    const started = performance.now();
    const timeout = AbortSignal.timeout(15000);
    let route: NetworkProbe['route'] = 'unknown';
    try {
      const resolved = await this.session.resolveProxy(url.href);
      route = resolved.trim() === 'DIRECT' ? 'direct' : 'proxy';
      const response = await this.session.fetch(url.href, { method: 'HEAD', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: timeout });
      await response.body?.cancel();
      return { outcome: 'reachable', status: response.status, route, elapsedMs: Math.round(performance.now() - started) };
    } catch {
      return { outcome: timeout.aborted ? 'timeout' : 'network', route, elapsedMs: Math.round(performance.now() - started) };
    }
  }
  async stop() {
    this.stopped = true;
    this.epoch++;
    for (const socket of this.sockets) socket.destroy();
    await Promise.all(this.servers.map(({ server }) => server.listening
      ? new Promise<void>(resolve => server.close(() => resolve())) : Promise.resolve()));
    this.addresses = [];
  }
}
