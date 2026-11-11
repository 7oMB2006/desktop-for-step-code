import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { CapabilityGate, type CapabilityGateHooks } from '../electron/capability-gate';
import type { CapabilityPolicy } from '../electron/capability-policy';
import { SessionRuntimes, type SessionRuntime } from '../electron/session-runtimes';
import type { RemoteHost } from '../electron/remote-manager';
import type { UIRequest } from '../src/contracts';

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const gate = new CapabilityGate();
  const events: string[] = [];
  let locked = false;
  const hooks: CapabilityGateHooks = {
    assertAvailable() { events.push('available'); assert.equal(locked, false); },
    acquireRuntime() {
      events.push('acquire'); locked = true;
      return () => { events.push('release'); locked = false; };
    },
    async assertIdle() { events.push('idle'); assert.equal(locked, true); },
    async assertResource(id) { events.push(`resource:${id}`); },
  };
  return { gate, hooks, events, locked: () => locked };
}

test('run reserves synchronously and remains active through proof, mutation and theme refresh', async () => {
  const f = fixture(), proof = deferred(), guarded = deferred(), mutation = deferred(), refresh = deferred(), finish = deferred();
  const operation = f.gate.run(async () => {
    assert.equal(f.gate.active, true);
    await proof.promise;
    const release = await f.gate.guard({ scope: 'runtime' }, f.hooks);
    guarded.resolve();
    await mutation.promise;
    release();
    refresh.resolve();
    await finish.promise;
    return 42;
  });
  assert.equal(f.gate.active, true);
  assert.deepEqual(f.events, []);
  let entered = false;
  const concurrent = () => f.gate.run(async () => { entered = true; });
  await assert.rejects(concurrent(), /capability:busy/);
  proof.resolve(); await guarded.promise;
  assert.equal(f.locked(), true);
  await assert.rejects(concurrent(), /capability:busy/);
  mutation.resolve(); await refresh.promise;
  assert.equal(f.locked(), false);
  assert.equal(f.gate.active, true);
  await assert.rejects(concurrent(), /capability:busy/);
  finish.resolve();
  assert.equal(await operation, 42);
  assert.equal(entered, false);
  assert.equal(f.gate.active, false);
});

for (const policy of [
  { scope: 'discovery', pluginId: 'not-a-theme' },
  { scope: 'theme' },
  { scope: 'theme', pluginId: 'theme-a' },
] satisfies CapabilityPolicy[]) {
  test(`${policy.scope}/${policy.pluginId ?? 'no-id'} never acquires runtime or asserts session idle`, async () => {
    const f = fixture();
    await f.gate.run(async () => {
      const release = await f.gate.guard(policy, f.hooks);
      assert.deepEqual(f.events, policy.scope === 'theme' && policy.pluginId
        ? ['available', `resource:${policy.pluginId}`, 'available'] : ['available']);
      release(); release();
      assert.equal(f.gate.active, true);
      assert.equal(f.locked(), false);
    });
    assert.equal(f.gate.active, false);
  });
}

test('theme resource observation is optional and never falls back to session idle', async () => {
  const f = fixture();
  await f.gate.run(async () => {
    const { assertResource: _, ...hooks } = f.hooks;
    (await f.gate.guard({ scope: 'theme', pluginId: 'theme-a' }, hooks))();
  });
  assert.deepEqual(f.events, ['available', 'available']);
});

test('runtime holds its lease through idle, resource observation, idle recheck and an idempotent release', async () => {
  const f = fixture(), idle = deferred(), resource = deferred(), observing = deferred();
  const recheck = deferred(), rechecking = deferred(), ready = deferred(), finish = deferred();
  let idleChecks = 0;
  f.hooks.assertIdle = async () => {
    f.events.push('idle');
    assert.equal(f.locked(), true);
    if (++idleChecks === 1) await idle.promise;
    else { rechecking.resolve(); await recheck.promise; }
  };
  f.hooks.assertResource = async id => {
    f.events.push(`resource:${id}`);
    assert.equal(id, 'ordinary-plugin');
    assert.equal(f.locked(), true);
    observing.resolve(); await resource.promise;
  };
  let release!: () => void;
  const operation = f.gate.run(async () => {
    release = await f.gate.guard({ scope: 'runtime', pluginId: 'ordinary-plugin' }, f.hooks);
    ready.resolve();
    await finish.promise;
  });
  assert.deepEqual(f.events, ['available', 'acquire', 'idle']);
  assert.equal(f.locked(), true);
  await assert.rejects(f.gate.guard({ scope: 'discovery' }, f.hooks), /capability:busy/);
  idle.resolve(); await observing.promise;
  assert.deepEqual(f.events, ['available', 'acquire', 'idle', 'resource:ordinary-plugin']);
  assert.equal(f.locked(), true);
  await assert.rejects(f.gate.run(async () => {}), /capability:busy/);
  resource.resolve(); await rechecking.promise;
  assert.deepEqual(f.events, ['available', 'acquire', 'idle', 'resource:ordinary-plugin', 'idle']);
  assert.equal(f.locked(), true);
  recheck.resolve(); await ready.promise;
  assert.equal(f.locked(), true);
  release(); release();
  assert.deepEqual(f.events, ['available', 'acquire', 'idle', 'resource:ordinary-plugin', 'idle', 'release']);
  assert.equal(f.gate.active, true);
  finish.resolve(); await operation;
  assert.equal(f.gate.active, false);
});

for (const stage of ['available', 'acquire', 'idle', 'resource', 'runtime-resource', 'runtime-recheck'] as const) {
  test(`a failing ${stage} check releases only its own lease and permits a new operation`, async () => {
    const f = fixture(), pending = deferred(), entered = deferred(), failure = new Error(stage);
    const original = { ...f.hooks };
    const runtimeResource = stage === 'runtime-resource' || stage === 'runtime-recheck';
    if (stage === 'available') f.hooks.assertAvailable = () => { throw failure; };
    if (stage === 'acquire') f.hooks.acquireRuntime = () => { throw failure; };
    if (stage === 'idle') f.hooks.assertIdle = async () => { entered.resolve(); await pending.promise; };
    if (stage === 'resource' || stage === 'runtime-resource')
      f.hooks.assertResource = async () => { entered.resolve(); await pending.promise; };
    if (stage === 'runtime-recheck') {
      let checks = 0;
      f.hooks.assertIdle = async () => { if (++checks === 2) { entered.resolve(); await pending.promise; } };
    }
    const operation = f.gate.run(async () => {
      await f.gate.guard(stage === 'resource' ? { scope: 'theme', pluginId: 'theme-a' }
        : runtimeResource ? { scope: 'runtime', pluginId: 'ordinary-plugin' } : { scope: 'runtime' }, f.hooks);
    });
    const rejected = assert.rejects(operation, error => error === failure);
    if (stage === 'idle' || stage === 'resource' || runtimeResource) {
      await entered.promise;
      assert.equal(f.gate.active, true);
      assert.equal(f.locked(), stage === 'idle' || runtimeResource);
      pending.reject(failure);
    }
    await rejected;
    assert.equal(f.gate.active, false);
    assert.equal(f.locked(), false);
    assert.equal(f.events.filter(event => event === 'release').length, stage === 'idle' || runtimeResource ? 1 : 0);
    await f.gate.run(async () => { (await f.gate.guard({ scope: 'runtime' }, original))(); });
    assert.equal(f.gate.active, false);
  });
}

test('runtime rejects a session that becomes busy while resource observation is awaiting', async () => {
  const f = fixture(), observation = deferred(), observing = deferred(), failure = new Error('session became busy');
  let busy = false, committed = false;
  f.hooks.assertIdle = async () => {
    f.events.push('idle');
    assert.equal(f.locked(), true);
    if (busy) throw failure;
  };
  f.hooks.assertResource = async id => {
    f.events.push(`resource:${id}`);
    observing.resolve(); await observation.promise;
  };
  const operation = f.gate.run(async () => {
    await f.gate.guard({ scope: 'runtime', pluginId: 'ordinary-plugin' }, f.hooks);
    committed = true;
  });
  const rejected = assert.rejects(operation, error => error === failure);
  await observing.promise;
  assert.equal(f.locked(), true);
  busy = true; observation.resolve();
  await rejected;
  assert.equal(committed, false);
  assert.equal(f.locked(), false);
  assert.equal(f.gate.active, false);
  assert.deepEqual(f.events, ['available', 'acquire', 'idle', 'resource:ordinary-plugin', 'idle', 'release']);
});

test('runtime with a plugin ID cannot silently omit resource observation', async () => {
  const f = fixture(), { assertResource: _, ...hooks } = f.hooks;
  await assert.rejects(f.gate.run(async () => {
    await f.gate.guard({ scope: 'runtime', pluginId: 'ordinary-plugin' }, hooks);
  }), /capability:resource-check-required/);
  assert.deepEqual(f.events, ['available', 'acquire', 'idle', 'release']);
  assert.equal(f.locked(), false);
  assert.equal(f.gate.active, false);
});

test('theme rechecks availability after resource observation without acquiring runtime or checking idle', async () => {
  const f = fixture(), observation = deferred(), observing = deferred(), failure = new Error('Desktop unavailable');
  let available = true, committed = false;
  f.hooks.assertAvailable = () => {
    f.events.push('available');
    assert.equal(f.locked(), false);
    if (!available) throw failure;
  };
  f.hooks.assertResource = async id => {
    f.events.push(`resource:${id}`);
    assert.equal(f.locked(), false);
    observing.resolve(); await observation.promise;
  };
  const operation = f.gate.run(async () => {
    await f.gate.guard({ scope: 'theme', pluginId: 'theme-a' }, f.hooks);
    committed = true;
  });
  const rejected = assert.rejects(operation, error => error === failure);
  await observing.promise;
  available = false; observation.resolve();
  await rejected;
  assert.equal(committed, false);
  assert.equal(f.gate.active, false);
  assert.deepEqual(f.events, ['available', 'resource:theme-a', 'available']);
});

test('an action failure and a forgotten release both unwind the runtime lease', async () => {
  const f = fixture(), failure = new Error('mutation');
  await assert.rejects(f.gate.run(async () => {
    await f.gate.guard({ scope: 'runtime' }, f.hooks);
    throw failure;
  }), error => error === failure);
  assert.equal(f.gate.active, false);
  assert.equal(f.locked(), false);
  await f.gate.run(async () => { await f.gate.guard({ scope: 'runtime' }, f.hooks); });
  assert.equal(f.locked(), false);
  assert.equal(f.events.filter(event => event === 'release').length, 2);
  await assert.rejects(f.gate.run(() => { throw failure; }), error => error === failure);
  assert.equal(f.gate.active, false);
});

test('a throwing cleanup cannot leave the operation owner stuck', async () => {
  const f = fixture(), failure = new Error('cleanup');
  await assert.rejects(f.gate.run(async () => {
    await f.gate.guard({ scope: 'runtime' }, { ...f.hooks, acquireRuntime: () => () => { throw failure; } });
  }), error => error === failure);
  assert.equal(f.gate.active, false);
  await f.gate.run(async () => {});
});

test('expired releases cannot unlock another lease in either the same or a new operation', async () => {
  const f = fixture();
  const expired = await f.gate.run(async () => await f.gate.guard({ scope: 'runtime' }, f.hooks));
  assert.equal(f.locked(), false);
  const idle = deferred(), ready = deferred(), finish = deferred();
  f.hooks.assertIdle = async () => { await idle.promise; };
  const operation = f.gate.run(async () => {
    const first = await f.gate.guard({ scope: 'runtime' }, f.hooks);
    first();
    const second = await f.gate.guard({ scope: 'runtime' }, f.hooks);
    first(); expired();
    assert.equal(f.locked(), true);
    ready.resolve();
    await finish.promise;
    second();
  });
  expired(); expired();
  assert.equal(f.gate.active, true);
  assert.equal(f.locked(), true);
  idle.resolve(); await ready.promise;
  expired();
  assert.equal(f.locked(), true);
  finish.resolve(); await operation;
  assert.equal(f.gate.active, false);
  assert.equal(f.locked(), false);
  assert.equal(f.events.filter(event => event === 'release').length, 3);
});

for (const outcome of ['resolve', 'reject'] as const) {
  test(`a late idle ${outcome} cannot acquire or release the next operation's ownership`, async () => {
    const f = fixture(), oldIdle = deferred(), finish = deferred(), ready = deferred();
    f.hooks.assertIdle = async () => { await oldIdle.promise; };
    let oldGuard!: Promise<() => void>;
    await f.gate.run(async () => { oldGuard = f.gate.guard({ scope: 'runtime' }, f.hooks); });
    assert.equal(f.locked(), false);
    f.hooks.assertIdle = async () => {};
    const operation = f.gate.run(async () => {
      await f.gate.guard({ scope: 'runtime' }, f.hooks);
      ready.resolve(); await finish.promise;
    });
    await ready.promise;
    const lateFailure = new Error('obsolete idle');
    const rejected = assert.rejects(oldGuard, outcome === 'resolve' ? /capability:busy/ : error => error === lateFailure);
    if (outcome === 'resolve') oldIdle.resolve();
    else oldIdle.reject(lateFailure);
    await rejected;
    assert.equal(f.gate.active, true);
    assert.equal(f.locked(), true);
    assert.equal(f.events.filter(event => event === 'release').length, 1);
    finish.resolve(); await operation;
    assert.equal(f.locked(), false);
  });
}

for (const scope of ['runtime', 'theme'] as const) {
  test(`a stale ${scope} resource observation cannot run further checks against the next owner`, async () => {
    const f = fixture(), observation = deferred(), observing = deferred(), ready = deferred(), finish = deferred();
    f.hooks.assertResource = async id => {
      f.events.push(`resource:${id}`);
      observing.resolve(); await observation.promise;
    };
    let oldGuard!: Promise<() => void>;
    await f.gate.run(async () => {
      oldGuard = f.gate.guard({ scope, pluginId: 'old-plugin' }, f.hooks);
      await observing.promise;
    });
    assert.equal(f.locked(), false);
    const operation = f.gate.run(async () => {
      await f.gate.guard({ scope: 'runtime' }, f.hooks);
      ready.resolve(); await finish.promise;
    });
    await ready.promise;
    const before = [...f.events], rejected = assert.rejects(oldGuard, /capability:busy/);
    observation.resolve(); await rejected;
    assert.deepEqual(f.events, before);
    assert.equal(f.gate.active, true);
    assert.equal(f.locked(), true);
    finish.resolve(); await operation;
    assert.equal(f.locked(), false);
  });
}

test('guards without an operation or with an unknown scope fail closed without hooks', async () => {
  const f = fixture();
  await assert.rejects(f.gate.guard({ scope: 'runtime' }, f.hooks), /capability:busy/);
  await assert.rejects(f.gate.run(async () => {
    await f.gate.guard({ scope: 'future' } as unknown as CapabilityPolicy, f.hooks);
  }), /capability:invalid-input/);
  assert.deepEqual(f.events, []);
  assert.equal(f.gate.active, false);
});

// Extract the actual main host callbacks: fixtures must not replace their business guards.
const main = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const remoteDeclaration = main.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find(node => ts.isIdentifier(node.name) && node.name.text === 'remote');
assert.ok(remoteDeclaration?.initializer && ts.isNewExpression(remoteDeclaration.initializer));
const host = remoteDeclaration.initializer.arguments?.[0];
assert.ok(host && ts.isObjectLiteralExpression(host));
const hostProperties = host.properties;
function remoteCallback(name: 'submit' | 'respond') {
  const property = hostProperties.find(node => ts.isPropertyAssignment(node) && node.name.getText(main) === name);
  assert.ok(property && ts.isPropertyAssignment(property));
  return property.initializer.getText(main);
}
const mainFlags = () => ({
  transition: false, sessionNavigation: { busy: false }, settingsMutation: false, undoBusy: false,
  quitting: false, quitPending: false, updateInstalling: false, providerSettingsPending: false,
});
const callbacks = new Function(...Object.keys(mainFlags()), 'pendingMessages', 'runtimes', 'remote', 'capabilityGate', 'externalTasks',
  ts.transpileModule(`return { submit: ${remoteCallback('submit')}, respond: ${remoteCallback('respond')} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText) as
  (...args: unknown[]) => Pick<RemoteHost, 'submit' | 'respond'>;

function remoteFixture(gate: CapabilityGate) {
  const state = mainFlags(), queued: string[] = [], answers: Record<string, unknown>[] = [], events: string[] = [];
  const externalWorkers = new Set<SessionRuntime>();
  const runtimes = new SessionRuntimes(() => {}, () => { throw new Error('No native workers in this test'); });
  const worker = {
    id: 'runtime-a', cwd: 'fixture', status: 'connected', state: { sessionId: 'session-a' }, remoteAttached: true,
    busy: true, pendingUI: new Map(), uiTimers: new Map(),
    rpc: { respond: (answer: Record<string, unknown>) => { answers.push(answer); } },
  } as unknown as SessionRuntime;
  const pendingMessages = {
    enqueue: (_worker: SessionRuntime, message: string) => { queued.push(message); return `queue-${queued.length}`; },
    resumed: () => { events.push('resumed'); }, drain: async () => { events.push('drain'); },
  };
  const current = () => callbacks(...Object.values(state), pendingMessages, runtimes,
    { runtimeEvent: () => { events.push('ui-expired'); } }, gate,
    { retains: (value: SessionRuntime) => externalWorkers.has(value) });
  return {
    state, worker, queued, answers, events, externalWorkers,
    submit: () => current().submit(worker, 'remote input', id => { events.push(`accepted:${id}`); }),
    respond: () => current().respond(worker, { id: 'approval', confirmed: true }),
    approval: () => worker.pendingUI.set('approval', {
      type: 'extension_ui_request', runtimeId: worker.id, id: 'approval', method: 'confirm', title: 'Fixture approval',
    } satisfies UIRequest),
  };
}

test('actual main Remote cannot submit or answer approvals for an external-owned task', async () => {
  const f = fixture(), remote = remoteFixture(f.gate);
  remote.externalWorkers.add(remote.worker);
  remote.approval();
  await assert.rejects(remote.submit(), /This session belongs to an external task/);
  assert.throws(remote.respond, /Review external task approvals locally/);
  assert.deepEqual(remote.queued, []);
  assert.deepEqual(remote.answers, []);
  assert.equal(remote.worker.pendingUI.size, 1);
  remote.externalWorkers.delete(remote.worker);
  remote.respond();
  await remote.submit();
  assert.equal(remote.answers.length, 1);
  assert.equal(remote.queued.length, 1);
});

for (const scope of ['discovery', 'theme'] as const) {
  test(`${scope} permits real main submit/respond guards during observation, mutation and refresh`, async () => {
    const f = fixture(), remote = remoteFixture(f.gate);
    const observation = deferred(), observed = deferred(), mutation = deferred(), mutating = deferred();
    const refresh = deferred(), refreshing = deferred();
    f.hooks.assertResource = async id => {
      assert.equal(id, 'theme-a');
      observed.resolve(); await observation.promise;
    };
    f.hooks.acquireRuntime = () => { throw new Error('Maintenance must not lock runtime'); };
    f.hooks.assertIdle = async () => { throw new Error('Maintenance must not inspect session idle'); };
    const operation = f.gate.run(async () => {
      const release = await f.gate.guard({ scope, pluginId: 'theme-a' }, f.hooks);
      mutating.resolve();
      try { await mutation.promise; } finally { release(); }
      refreshing.resolve(); await refresh.promise;
    });
    const io = async () => {
      assert.equal(f.gate.active, true);
      assert.equal(remote.state.settingsMutation, false);
      await remote.submit();
      remote.approval();
      await assert.rejects(remote.submit(), /Review the session/);
      remote.respond();
      assert.equal(remote.worker.pendingUI.size, 0);
      assert.throws(remote.respond, /expired/);
      assert.equal(remote.worker.remoteAttached, true);
    };
    if (scope === 'theme') {
      await observed.promise; await io(); observation.resolve();
    }
    await mutating.promise; await io();
    mutation.resolve(); await refreshing.promise; await io();
    refresh.resolve(); await operation;
    const phases = scope === 'theme' ? 3 : 2;
    assert.equal(remote.queued.length, phases);
    assert.equal(remote.answers.length, phases);
    assert.equal(remote.events.filter(event => event === 'drain').length, phases);
    assert.equal(f.gate.active, false);
  });
}

test('runtime blocks actual main Remote I/O before idle resolves and through its mutation', async () => {
  const f = fixture(), remote = remoteFixture(f.gate), idle = deferred(), ready = deferred(), finish = deferred();
  f.hooks.acquireRuntime = () => {
    remote.state.settingsMutation = true;
    return () => { remote.state.settingsMutation = false; };
  };
  f.hooks.assertIdle = async () => { await idle.promise; };
  const operation = f.gate.run(async () => {
    await f.gate.guard({ scope: 'runtime' }, f.hooks);
    ready.resolve(); await finish.promise;
  });
  remote.approval();
  await assert.rejects(remote.submit(), /Review the session/);
  assert.throws(remote.respond, /Desktop is unavailable/);
  idle.resolve(); await ready.promise;
  await assert.rejects(remote.submit(), /Review the session/);
  assert.throws(remote.respond, /Desktop is unavailable/);
  assert.equal(remote.worker.pendingUI.size, 1);
  finish.resolve(); await operation;
  remote.respond();
  await remote.submit();
  assert.equal(remote.answers.length, 1);
  assert.equal(remote.queued.length, 1);
});

test('maintenance does not bypass main submit business restrictions or reply shutdown barriers', async () => {
  const f = fixture();
  await f.gate.run(async () => {
    const release = await f.gate.guard({ scope: 'discovery' }, f.hooks);
    const blockers: ((remote: ReturnType<typeof remoteFixture>) => void)[] = [
      remote => { remote.state.transition = true; },
      remote => { remote.state.sessionNavigation.busy = true; },
      remote => { remote.state.settingsMutation = true; },
      remote => { remote.state.undoBusy = true; },
      remote => { remote.state.quitting = true; },
      remote => { remote.state.quitPending = true; },
      remote => { remote.state.updateInstalling = true; },
      remote => { remote.state.providerSettingsPending = true; },
      remote => { remote.worker.mutating = true; },
      remote => { remote.worker.stopping = true; },
      remote => { remote.approval(); },
      remote => { remote.worker.failed = true; },
      remote => { remote.worker.interrupted = true; },
      remote => { remote.worker.launch = { goalArmed: true } as SessionRuntime['launch']; },
      remote => { remote.worker.launch = { goal: { status: 'active' } } as SessionRuntime['launch']; },
    ];
    for (const block of blockers) {
      const remote = remoteFixture(f.gate);
      block(remote);
      await assert.rejects(remote.submit(), /Review the session/);
      assert.deepEqual(remote.queued, []);
    }
    for (const flag of ['settingsMutation', 'quitting', 'quitPending', 'updateInstalling'] as const) {
      const remote = remoteFixture(f.gate);
      remote.approval(); remote.state[flag] = true;
      assert.throws(remote.respond, /Desktop is unavailable/);
      assert.deepEqual(remote.answers, []);
      assert.equal(remote.worker.pendingUI.size, 1);
    }
    release();
  });
});
