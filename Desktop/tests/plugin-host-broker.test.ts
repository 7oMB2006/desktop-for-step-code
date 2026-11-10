import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { hostService } from './fixtures/plugin-host-service';
import { PluginConfigurationStore } from '../electron/plugin-configuration.mjs';
import { HOST_ENV, LIMITS, newRequestId } from '../../examples/plugins/host-client/protocol.mjs';
import { createHostClient } from '../../examples/plugins/host-client/client.mjs';
import type { FollowLaunch, Invocation } from '../../examples/plugins/host-client/protocol.mjs';

const input = (revision: string): Invocation<'model.text'> => ({ revision, requestId: newRequestId(),
  capability: 'model.text', input: { messages: [{ role: 'user', content: 'fixture prompt' }] } });
async function clientFor(t: test.TestContext, fixture: Awaited<ReturnType<typeof hostService>>) {
  const launch = await fixture.broker.issue(fixture.descriptor, fixture.worker) as FollowLaunch;
  const client = createHostClient({ pluginId: 'dfsc-host-example', consumer: 'example',
    environment: { [HOST_ENV]: JSON.stringify(launch) } });
  t.after(() => client.close());
  return { launch, client };
}
const post = async (launch: FollowLaunch, route: string, value: unknown = {}, headers: Record<string, string> = {}) => {
  const response = await fetch(`${launch.broker.origin}/v1/${route}`, { method: 'POST',
    headers: { authorization: `Bearer ${launch.broker.token}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(value) });
  return { status: response.status, value: await response.json() as Record<string, any> };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
test('a failed native startup releases only its own lease', async t => {
  const fixture = await hostService(t);
  const first = await clientFor(t, fixture), second = await clientFor(t, fixture);
  fixture.broker.release(first.launch);
  await assert.rejects(first.client.context(), /STALE_CONTEXT/);
  assert.equal((await second.client.context()).capabilities[0].model, 'step-5-preview');
});

test('only main can issue a receipt-bound lease; missing choice and conflicting transports never gain access', async t => {
  const fixture = await hostService(t, { configured: false });
  await assert.rejects(fixture.broker.issue(fixture.descriptor, fixture.worker), /AUTHORIZATION_REQUIRED/);
  await fixture.store.select(fixture.descriptor, { revision: 'unconfigured', mode: 'follow' });
  fixture.state.transportAllowed = false;
  await assert.rejects(fixture.broker.issue(fixture.descriptor, fixture.worker), /DENIED/);
  fixture.state.transportAllowed = true;
  await assert.rejects(fixture.broker.issue({ ...fixture.descriptor, instance: randomUUID() }, fixture.worker));
  const { launch, client } = await clientFor(t, fixture);
  assert.equal((await post(launch, 'issue', { pluginId: 'dfsc-host-example' })).status, 403);
  assert.equal((await client.context()).capabilities[0].model, 'step-5-preview');
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.state.confirmations.length, 0);
  assert.doesNotMatch(JSON.stringify(await client.context()), /fixture-main-private-key|Bearer|endpoint/);
});
test('independent mode receives no broker and never reads or requires a host account', async t => {
  const fixture = await hostService(t, { configured: false, settings: true });
  const configurations = new PluginConfigurationStore(fixture.root);
  const saved = await configurations.save(fixture.descriptor, { ref: fixture.descriptor.ref,
    revision: 'unconfigured', values: {}, secrets: { key: { action: 'replace', value: 'fixture-independent-key' } } });
  await fixture.store.select(fixture.descriptor, { revision: 'unconfigured',
    mode: 'independent', configurationRevision: saved.revision });
  fixture.state.auth = {};
  fixture.provider.read = async () => { assert.fail('independent mode must not read host accounts'); };
  const launch = await fixture.broker.issue(fixture.descriptor, fixture.worker);
  assert.equal(launch.mode, 'independent');
  assert.equal(launch.broker, undefined);
  assert.equal(launch.configurationRevision, saved.revision);
  assert.doesNotMatch(JSON.stringify(launch), /fixture-independent-key|fixture-main-private-key/);
  assert.equal(fixture.state.confirmations.length, 0);
  assert.equal(fixture.calls.length, 0);
});
test('runtime mutation during an awaited account read cannot issue or use a lease', async t => {
  const fixture = await hostService(t);
  const read = fixture.provider.read.bind(fixture.provider);
  fixture.provider.read = async (...args) => {
    const snapshot = await read(...args);
    fixture.worker.mutating = true;
    return snapshot;
  };
  await assert.rejects(fixture.broker.issue(fixture.descriptor, fixture.worker), /STALE_CONTEXT/);
  fixture.worker.mutating = false;
  fixture.provider.read = read;
  const { client } = await clientFor(t, fixture);
  const context = await client.context();
  fixture.provider.read = async (...args) => {
    const snapshot = await read(...args);
    fixture.worker.mutating = true;
    return snapshot;
  };
  await assert.rejects(client.invoke(input(context.revision)), /STALE_CONTEXT/);
  assert.equal(fixture.calls.length, 0);
});
test('HTTP rejects origin even when empty, wrong host, authentication, query paths and extra context fields', async t => {
  const fixture = await hostService(t);
  const { launch } = await clientFor(t, fixture);
  const invalidHeaders: Array<Record<string, string>> = [{ origin: 'https://example.invalid' }, { origin: '' },
    { authorization: 'Bearer wrong' }];
  for (const headers of invalidHeaders) {
    assert.ok((await post(launch, 'context', {}, headers)).status >= 400, JSON.stringify(headers));
  }
  const wrongHost = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${launch.broker.origin}/v1/context`, { method: 'POST',
      headers: { host: 'localhost', authorization: `Bearer ${launch.broker.token}`, 'content-type': 'application/json' } },
    response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(wrongHost, 403);
  assert.equal((await post(launch, 'context?other=true')).status, 403);
  assert.equal((await post(launch, 'context', { authorized: true })).status, 400);
  assert.equal(fixture.calls.length, 0);
});
test('the selected model and four official routes stay paired with no independent-Key or billing fallback', async t => {
  for (const [profile, endpoint, channel, region] of [
    ['step_plan', 'https://api.stepfun.com/step_plan/v1', 'plan', 'cn'],
    ['step_plan_oversea', 'https://api.stepfun.ai/step_plan/v1', 'plan', 'oversea'],
    ['platform_cn', 'https://api.stepfun.com/v1', 'api', 'cn'],
    ['platform_oversea', 'https://api.stepfun.ai/v1', 'api', 'oversea'],
  ]) {
    const fixture = await hostService(t, { profile });
    const { client } = await clientFor(t, fixture);
    const context = await client.context();
    assert.equal(context.capabilities[0].channel, channel);
    assert.equal(context.capabilities[0].region, region);
    assert.equal((await client.invoke(input(context.revision))).text, 'host result');
    assert.equal(fixture.calls[0].url, `${endpoint}/chat/completions`);
    assert.equal(fixture.calls[0].init?.redirect, 'error');
    assert.equal(new Headers(fixture.calls[0].init?.headers).get('authorization'), 'Bearer fixture-main-private-key');
    assert.equal(JSON.parse(String(fixture.calls[0].init?.body)).model, 'step-5-preview');
    assert.equal(fixture.state.confirmations.length, 1);
    assert.match(fixture.state.confirmations[0], /dfsc-host-example.*model.text/su);
    assert.doesNotMatch(fixture.state.confirmations[0], /fixture-main-private-key|Bearer/);
  }
});
test('declined and background approvals do not call a provider; approval is scoped per launch and capability', async t => {
  const fixture = await hostService(t, { capabilities: ['model.text', 'model.video'] });
  const { client } = await clientFor(t, fixture);
  const context = await client.context();
  fixture.pool.activeId = undefined;
  await assert.rejects(client.invoke(input(context.revision)), /AUTHORIZATION_REQUIRED/);
  assert.equal(fixture.state.confirmations.length, 0);
  fixture.pool.activeId = fixture.worker.id;
  fixture.state.approved = false;
  await assert.rejects(client.invoke(input(context.revision)), /DENIED/);
  fixture.state.approved = true;
  await assert.rejects(client.invoke(input(context.revision)), /DENIED/);
  const { client: fresh } = await clientFor(t, fixture);
  const selected = await fresh.context();
  await fresh.invoke(input(selected.revision));
  await fresh.invoke(input(selected.revision));
  assert.equal(fixture.state.confirmations.length, 2);
  await fresh.invoke({ ...input(selected.revision), capability: 'model.video',
    input: { messages: [{ role: 'user', content: 'inspect' }], video: { mimeType: 'video/mp4', data: 'YWJjZA==' } } });
  assert.equal(fixture.state.confirmations.length, 3);
  assert.equal(fixture.calls.length, 3);
});
test('unknown TTS/ASR models and unverified image-only video are explicitly unavailable without provider calls', async t => {
  const fixture = await hostService(t, { capabilities: ['model.video', 'model.asr', 'model.tts'] });
  fixture.worker.state!.model!.id = 'image-only-unknown';
  const current = await fixture.store.current(fixture.descriptor);
  await fixture.store.select(fixture.descriptor, { revision: current.revision, mode: 'follow',
    models: { 'model.asr': 'not-verified', 'model.tts': 'not-verified' } });
  const { client } = await clientFor(t, fixture);
  const context = await client.context();
  assert.ok(context.capabilities.every(item => !item.available && item.reason === 'CAPABILITY_UNAVAILABLE'));
  await assert.rejects(client.invoke({ revision: context.revision, requestId: newRequestId(), capability: 'model.tts',
    input: { text: 'fixture', voice: 'fixture', format: 'wav' } }), /CAPABILITY_UNAVAILABLE/);
  assert.equal(fixture.state.confirmations.length, 0);
  assert.equal(fixture.calls.length, 0);
});
test('ASR keeps the dedicated model on each selected account channel, not the chat model', async t => {
  for (const profile of ['step_plan', 'step_plan_oversea', 'platform_cn', 'platform_oversea']) {
    const fixture = await hostService(t, { profile, capabilities: ['model.asr'], request: async () =>
      new Response('data: {"type":"transcript.text.done","text":"fixture transcript"}\n\n') });
    const { client } = await clientFor(t, fixture);
    const context = await client.context();
    const result = await client.invoke({ requestId: newRequestId(), revision: context.revision, capability: 'model.asr',
      input: { audio: { mimeType: 'audio/wav', data: 'YWJjZA==' } } });
    assert.equal(result.text, 'fixture transcript');
    assert.match(fixture.calls[0].url, /\/audio\/asr\/sse$/u);
    assert.equal(fixture.calls[0].url.includes('/step_plan/'), profile.startsWith('step_plan'));
    assert.equal(JSON.parse(String(fixture.calls[0].init?.body)).audio.input.transcription.model, 'stepaudio-2.5-asr');
  }
});
test('account, live model, mode, package, session, runtime and transport changes revoke old leases', async t => {
  const changes: Array<(fixture: Awaited<ReturnType<typeof hostService>>) => unknown> = [
    fixture => { fixture.state.auth.step.access = 'changed-private-key'; },
    fixture => { fixture.worker.rpc.request = async () => ({ ...fixture.worker.state, model: { provider: 'step', id: 'changed-model' } }); },
    async fixture => {
      const current = await fixture.store.current(fixture.descriptor);
      await fixture.store.select(fixture.descriptor, { revision: current.revision, mode: 'follow' });
    },
    fixture => writeFile(join(fixture.directory, 'changed.txt'), 'changed'),
    fixture => { fixture.worker.state!.sessionId = randomUUID(); },
    fixture => { fixture.pool.workers.delete(fixture.worker.id); },
    fixture => { fixture.state.transportAllowed = false; },
    fixture => { fixture.state.changing = true; },
  ];
  for (const change of changes) {
    const fixture = await hostService(t);
    const { client } = await clientFor(t, fixture);
    const context = await client.context();
    await change(fixture);
    await assert.rejects(client.invoke(input(context.revision)), /STALE_CONTEXT/);
    assert.equal(fixture.calls.length, 0);
  }
});
test('late confirmation after a changed account cannot grant access', async t => {
  const fixture = await hostService(t);
  const gate = deferred<boolean>(), entered = deferred<void>();
  fixture.state.confirm = async () => { entered.resolve(); return gate.promise; };
  const { client } = await clientFor(t, fixture);
  const context = await client.context();
  const request = client.invoke(input(context.revision));
  await entered.promise;
  fixture.state.auth.step.access = 'changed-private-key';
  gate.resolve(true);
  await assert.rejects(request, /STALE_CONTEXT/);
  assert.equal(fixture.calls.length, 0);
});
test('per-plugin/session slots span multiple leases and cancelled queued requests never invoke a provider', async t => {
  const gate = deferred<void>(), two = deferred<void>();
  let active = 0;
  const fixture = await hostService(t, { request: async () => {
    if (++active === 2) two.resolve();
    await gate.promise;
    return Response.json({ choices: [{ message: { content: 'done' } }] });
  } });
  const { client: a } = await clientFor(t, fixture), { client: b } = await clientFor(t, fixture);
  const ca = await a.context(), cb = await b.context();
  const first = a.invoke(input(ca.revision)), second = b.invoke(input(cb.revision));
  await two.promise;
  const controller = new AbortController(), queued = a.invoke(input(ca.revision), { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, /CANCELLED/);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(active, 2);
});
test('cancellation belongs to its lease, aborts active provider work and does not stop another lease', async t => {
  const entered = deferred<void>();
  let stopped = false;
  const fixture = await hostService(t, { request: async (_url, init) => {
    entered.resolve();
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => {
      stopped = true; reject(new Error('private-provider-error'));
    }, { once: true }));
  } });
  const { client: a, launch } = await clientFor(t, fixture), { client: b } = await clientFor(t, fixture);
  const context = await a.context(), value = input(context.revision);
  const request = a.invoke(value);
  await entered.promise;
  assert.equal(await b.cancel(value.requestId), false);
  assert.equal(await a.cancel(value.requestId), true);
  await assert.rejects(request, /CANCELLED/);
  assert.equal(stopped, true);
  assert.ok(await b.context());
  await assert.rejects(a.invoke(value), /INVALID_REQUEST/);
  assert.equal((await post(launch, 'cancel', { requestId: newRequestId() })).value.cancelled, false);
});
test('the global eight-slot budget spans sessions and another session can cancel its queued ninth request', async t => {
  let blocked = false, active = 0, peak = 0;
  const gate = deferred<void>(), eight = deferred<void>();
  const fixture = await hostService(t, { request: async () => {
    if (blocked) {
      peak = Math.max(peak, ++active);
      if (active === 8) eight.resolve();
      await gate.promise;
      active--;
    }
    return Response.json({ choices: [{ message: { content: 'fixture' } }] });
  } });
  const clients = [];
  for (let index = 0; index < 5; index++) {
    const source = { ...fixture.worker, id: randomUUID(),
      state: { ...fixture.worker.state!, sessionId: randomUUID() }, rpc: { ...fixture.worker.rpc } };
    source.rpc.request = async () => source.state;
    fixture.pool.workers.set(source.id, source);
    fixture.pool.activeId = source.id;
    const launch = await fixture.broker.issue(fixture.descriptor, source);
    const client = createHostClient({ pluginId: 'dfsc-host-example', consumer: 'example',
      environment: { [HOST_ENV]: JSON.stringify(launch) } });
    t.after(() => client.close());
    const context = await client.context();
    await client.invoke(input(context.revision));
    clients.push({ client, context });
  }
  blocked = true;
  const running = clients.slice(0, 4).flatMap(({ client, context }) =>
    [client.invoke(input(context.revision)), client.invoke(input(context.revision))]);
  await eight.promise;
  const ninthInput = input(clients[4].context.revision);
  const ninth = clients[4].client.invoke(ninthInput);
  let cancelled = false;
  for (let attempt = 0; attempt < 100 && !cancelled; attempt++) {
    cancelled = await clients[4].client.cancel(ninthInput.requestId);
    if (!cancelled) await delay(10);
  }
  assert.equal(cancelled, true);
  await assert.rejects(ninth, /CANCELLED/);
  assert.equal(active, 8);
  gate.resolve();
  await Promise.all(running);
  assert.equal(peak, 8);
  assert.ok(await clients[4].client.context());
});
test('revocation aborts pending requests and removes usable leases', async t => {
  const gate = deferred<Response>(), entered = deferred<void>();
  const fixture = await hostService(t, { request: async () => { entered.resolve(); return gate.promise; } });
  const { client } = await clientFor(t, fixture);
  const context = await client.context(), request = client.invoke(input(context.revision));
  await entered.promise;
  fixture.broker.invalidate(fixture.worker);
  await assert.rejects(request, /STALE_CONTEXT/);
  gate.resolve(Response.json({ choices: [{ message: { content: 'must not escape' } }] }));
  await assert.rejects(client.context(), /STALE_CONTEXT/);
});
test('lease expiry aborts work even when the provider ignores cancellation', async t => {
  const entered = deferred<void>();
  const fixture = await hostService(t, { budgets: { lease: 1000 },
    request: async () => { entered.resolve(); return new Promise(() => {}); } });
  const { client } = await clientFor(t, fixture);
  const context = await client.context(), request = client.invoke(input(context.revision));
  await entered.promise;
  await assert.rejects(request, /STALE_CONTEXT/);
});
test('confirmation, queue and provider deadlines are enforced even if an adapter ignores cancellation', async t => {
  for (const phase of ['confirmation', 'provider', 'queue'] as const) {
    const entered = deferred<void>();
    const fixture = await hostService(t, { budgets: { [phase]: 150 },
      request: async () => { entered.resolve(); return new Promise(() => {}); } });
    if (phase === 'confirmation') fixture.state.confirm = async () => new Promise(() => {});
    const { client } = await clientFor(t, fixture);
    const context = await client.context();
    if (phase === 'queue') {
      const first = client.invoke(input(context.revision)), second = client.invoke(input(context.revision));
      await entered.promise;
      const queued = client.invoke(input(context.revision));
      await assert.rejects(queued, /TIMEOUT/);
      fixture.broker.invalidate();
      await Promise.all([assert.rejects(first, /STALE_CONTEXT/), assert.rejects(second, /STALE_CONTEXT/)]);
    } else await assert.rejects(client.invoke(input(context.revision)), /TIMEOUT/);
  }
});
test('provider failures are normalized without raw bodies, repeated calls or Plan-to-API fallback', async t => {
  const fixture = await hostService(t, { request: async () => new Response('fixture-main-private-key raw diagnostic', { status: 401 }) });
  const { client } = await clientFor(t, fixture);
  const context = await client.context();
  await assert.rejects(client.invoke(input(context.revision)), error =>
    error instanceof Error && error.message === 'dfsc-host:PROVIDER_FAILED');
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].url, 'https://api.stepfun.com/step_plan/v1/chat/completions');
  await assert.rejects(client.invoke({ ...input(context.revision), input: {
    messages: [{ role: 'user', content: 'fixture' }], url: 'https://example.invalid',
  } } as never), /INVALID_REQUEST/);
  assert.equal(fixture.calls.length, 1);
});
test('HTTP request sizes and streamed provider output are bounded before results reach a plugin', async t => {
  const fixture = await hostService(t, { request: async () => new Response('x'.repeat(LIMITS.text + 1)) });
  const { client, launch } = await clientFor(t, fixture);
  const oversized = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(`${launch.broker.origin}/v1/invoke`, { method: 'POST',
      headers: { authorization: `Bearer ${launch.broker.token}`, 'content-type': 'application/json',
        'content-length': LIMITS.request + 1 } }, response => {
      let body = '';
      response.on('data', bytes => { body += bytes.toString(); });
      response.on('end', () => resolve({ status: response.statusCode!, body }));
    });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(oversized.status, 413);
  assert.equal(JSON.parse(oversized.body).error.code, 'TOO_LARGE');
  assert.equal(fixture.calls.length, 0);
  const context = await client.context();
  await assert.rejects(client.invoke(input(context.revision)), /TOO_LARGE/);
  assert.equal(fixture.calls.length, 1);
});
test('service shutdown aborts owned work and unsafe resource budget overrides are rejected', async t => {
  const entered = deferred<void>(), stopped = deferred<void>();
  const fixture = await hostService(t, { request: async (_url, init) => {
    entered.resolve();
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => {
      stopped.resolve(); reject(new Error('private shutdown diagnostic'));
    }, { once: true }));
  } });
  const { client } = await clientFor(t, fixture);
  const context = await client.context();
  const request = client.invoke(input(context.revision));
  const rejected = assert.rejects(request, /STALE_CONTEXT|HOST_UNAVAILABLE/);
  await entered.promise;
  await fixture.broker.close();
  await Promise.all([stopped.promise, rejected]);
  await assert.rejects(client.context(), /HOST_UNAVAILABLE/);
  await assert.rejects(fixture.broker.issue(fixture.descriptor, fixture.worker), /HOST_UNAVAILABLE/);
  await assert.rejects(hostService(t, { budgets: { provider: LIMITS.provider + 1 } }), /INVALID_REQUEST/);
});
