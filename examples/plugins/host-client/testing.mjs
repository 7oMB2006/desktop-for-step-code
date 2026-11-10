import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostClientError, LIMITS, parseInvoke } from './protocol.mjs';

// Offline wire fixture, not a production broker, permission UI or provider adapter.
export async function mockHost() {
  const leases = new Map(), counts = { context: 0, invoke: 0, cancel: 0, provider: 0 };
  const reply = (response, status, value) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.headers.origin !== undefined
        || request.headers.host !== `127.0.0.1:${server.address().port}`) throw new HostClientError('DENIED');
      const lease = leases.get(request.headers.authorization);
      if (!lease || lease.revoked || lease.expiresAt <= Date.now()) throw new HostClientError('STALE_CONTEXT');
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > LIMITS.request) throw new HostClientError('TOO_LARGE');
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HostClientError('INVALID_REQUEST'); }
      if (request.url === '/v1/context') {
        counts.context++;
        if (Object.keys(body).length) throw new HostClientError('INVALID_REQUEST');
        reply(response, 200, { version: 1, revision: lease.contextRevision, capabilities: lease.capabilities.map(id =>
          ({ id, available: true, model: 'offline-fixture', channel: 'plan', region: 'cn' })) });
      } else if (request.url === '/v1/invoke') {
        counts.invoke++;
        const value = parseInvoke(body);
        if (value.revision !== lease.contextRevision) throw new HostClientError('STALE_CONTEXT');
        if (!lease.capabilities.includes(value.capability)) throw new HostClientError('DENIED');
        if (!lease.granted) throw new HostClientError('AUTHORIZATION_REQUIRED');
        if (lease.requests.has(value.requestId)) throw new HostClientError('INVALID_REQUEST');
        lease.requests.add(value.requestId);
        reply(response, 200, { version: 1, requestId: value.requestId, result: value.capability === 'model.tts'
          ? { type: 'audio', mimeType: { mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/pcm' }[value.input.format],
            data: Buffer.from('offline audio fixture').toString('base64') }
          : { type: 'text', text: 'Offline fixture summary' } });
      } else if (request.url === '/v1/cancel') {
        counts.cancel++;
        if (Object.keys(body).length !== 1 || typeof body.requestId !== 'string')
          throw new HostClientError('INVALID_REQUEST');
        reply(response, 200, { version: 1, requestId: body.requestId, cancelled: lease.requests.has(body.requestId) });
      } else throw new HostClientError('INVALID_REQUEST');
    } catch (error) {
      reply(response, 403, { version: 1, error: {
        code: error instanceof HostClientError ? error.code : 'INVALID_REQUEST',
      } });
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    counts,
    launch(overrides = {}) {
      const token = randomBytes(32).toString('base64url'), expiresAt = Date.now() + 60000;
      const value = {
        version: 'dfsc-launch-v1', mode: 'follow', pluginId: 'dfsc-host-example', consumer: 'example',
        instance: randomUUID(), fingerprint: 'a'.repeat(64), declarationHash: 'b'.repeat(64),
        revision: 'c'.repeat(64), configurationRevision: null, launchId: randomUUID(), runtimeId: randomUUID(),
        sessionId: randomUUID(), accountRevision: 'd'.repeat(64), capabilities: ['model.text'], models: {},
        dataDirectory: join(tmpdir(), 'dfsc-fixture-data'), broker: { origin, token, expiresAt }, ...overrides,
      };
      leases.set(`Bearer ${token}`, { capabilities: value.capabilities, contextRevision: 'e'.repeat(64),
        expiresAt, granted: false, requests: new Set() });
      return value;
    },
    grant(launch) { leases.get(`Bearer ${launch.broker.token}`).granted = true; },
    revoke(launch) { leases.get(`Bearer ${launch.broker.token}`).revoked = true; },
    changeRevision(launch) { leases.get(`Bearer ${launch.broker.token}`).contextRevision = 'f'.repeat(64); },
    async close() {
      leases.clear();
      server.closeAllConnections();
      await new Promise(done => server.close(done));
    },
  };
}
