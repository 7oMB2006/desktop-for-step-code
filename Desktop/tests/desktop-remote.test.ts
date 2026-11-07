import test from 'node:test';
import assert from 'node:assert/strict';

const { default: register } = await import(new URL('../electron/desktop-remote.mjs', import.meta.url).href);
const OUTSIDE = 'Image is outside this session workspace. Move it into the workspace before sending.';
const secret = 'fixture-private-broker-token';
type Tool = { name: string; description: string; parameters: any; execute: (...args: any[]) => Promise<any> };
async function fixture(run: (tool: Tool, calls: { url: string; init: RequestInit }[]) => Promise<void>,
  respond: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ delivered: true, messageId: 'remote-message' }))) {
  const keys = ['DESKTOP_SESSION_URL', 'DESKTOP_SESSION_TOKEN', 'STEPCODE_SUBAGENT_CHILD'] as const;
  const previous = keys.map(key => process.env[key]), fetch = globalThis.fetch;
  const tools: Tool[] = [], calls: { url: string; init: RequestInit }[] = [];
  try {
    process.env.DESKTOP_SESSION_URL = 'http://127.0.0.1:12345/sessions';
    process.env.DESKTOP_SESSION_TOKEN = secret;
    delete process.env.STEPCODE_SUBAGENT_CHILD;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as typeof globalThis.fetch;
    register({ registerTool: (tool: Tool) => tools.push(tool) });
    assert.equal(tools.length, 1);
    await run(tools[0], calls);
  } finally {
    globalThis.fetch = fetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}
function value(result: any) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

test('registers one ordinary runtime-permission tool and routes explicit delivery through the authenticated sessions broker', async () => {
  await fixture(async (tool, calls) => {
    assert.equal(tool.name, 'desktop_send_image');
    assert.match(tool.description, /live attached Remote run/);
    assert.deepEqual(tool.parameters.required, ['path']);
    assert.equal(tool.parameters.additionalProperties, false);
    const sent = await tool.execute('call-one', { path: 'result.png', caption: 'Requested chart' });
    assert.deepEqual(value(sent), { delivered: true, messageId: 'remote-message' });
    assert.equal(sent.isError, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:12345/sessions');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Bearer ${secret}`);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { action: 'remote-image', path: 'result.png', caption: 'Requested chart' });
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.ok(!JSON.stringify(sent).includes(secret));
    assert.ok(!JSON.stringify(sent).includes('result.png'));
  });
});

test('caption is optional and no worker, binding, session or credential can be supplied as tool arguments', async () => {
  await fixture(async (tool, calls) => {
    await tool.execute('call', { path: 'result.png' });
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { action: 'remote-image', path: 'result.png' });
    for (const args of [{ path: 'result.png', bindingId: 'forged' }, { path: 'result.png', sessionKey: 'peer' },
      { path: 'result.png', token: 'forged' }, { path: 'result.png', action: 'send' }]) {
      assert.equal((await tool.execute('call', args)).isError, true);
    }
    assert.equal(calls.length, 1);
  });
});

test('does not load in a child, without authenticated Desktop context, or with a non-loopback endpoint', () => {
  const keys = ['DESKTOP_SESSION_URL', 'DESKTOP_SESSION_TOKEN', 'STEPCODE_SUBAGENT_CHILD'] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    for (const [url, token, child] of [
      ['', secret, ''], ['http://127.0.0.1:12345/sessions', '', ''],
      ['http://127.0.0.1:12345/sessions', secret, '1'], ['https://evil.test/sessions', secret, ''],
      ['http://127.0.0.1:12345/other', secret, ''], ['http://user:pass@127.0.0.1:12345/sessions', secret, ''],
      ['http://127.0.0.1:12345/sessions?token=secret', secret, ''], ['not-a-url', secret, ''],
    ]) {
      process.env.DESKTOP_SESSION_URL = url;
      process.env.DESKTOP_SESSION_TOKEN = token;
      process.env.STEPCODE_SUBAGENT_CHILD = child;
      const tools: Tool[] = [];
      register({ registerTool: (tool: Tool) => tools.push(tool) });
      assert.equal(tools.length, 0);
    }
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test('validates explicit tool parameters before any request and never infers paths from prose or Markdown', async () => {
  await fixture(async (tool, calls) => {
    for (const args of [null, [], {}, { path: '' }, { path: 1 }, { path: 'a'.repeat(4097) },
      { path: 'https://example.test/image.png' }, { path: 'file:///image.png' }, { path: '\\\\server\\image.png' },
      { path: '//server/image.png' }, { path: 'result.png\n' }, { path: 'result.png', caption: 1 },
      { path: 'result.png', caption: 'x'.repeat(1001) }, { path: 'result.png', caption: '\u0000' }]) {
      const result = await tool.execute('call', args);
      assert.equal(result.isError, true);
      assert.equal(value(result).delivered, false);
    }
    assert.equal(calls.length, 0);
  });
});

test('outside-workspace failures remain explicit without widening file access', async () => {
  for (const status of [200, 400]) {
    await fixture(async tool => {
      const result = await tool.execute('call', { path: '../private.png' });
      assert.equal(result.isError, true);
      assert.deepEqual(value(result), { delivered: false, reason: OUTSIDE });
    }, () => new Response(JSON.stringify(status === 400 ? { error: OUTSIDE } : { delivered: false, reason: OUTSIDE }), { status }));
  }
});

test('main scope or permission rejection is not delivery, and raw broker errors never escape', async () => {
  for (const status of [200, 400, 403, 500]) {
    await fixture(async (tool, calls) => {
      const result = await tool.execute('call', { path: 'result.png' });
      assert.equal(result.isError, true);
      assert.equal(value(result).delivered, false);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
      assert.equal(calls.length, 1);
    }, () => new Response(JSON.stringify({ delivered: false, error: secret, reason: secret }), { status }));
  }
});

test('only a valid delivered acknowledgement counts, not upload success, malformed JSON or a lost response', async () => {
  for (const reply of [undefined, null, [], {}, { uploaded: true }, { messageId: 'one' },
    { delivered: true }, { delivered: true, messageId: '' }, { delivered: true, messageId: 'bad\nid' },
    { delivered: true, messageId: 'x'.repeat(201) }, 'invalid-json', 'throw']) {
    await fixture(async (tool, calls) => {
      const result = await tool.execute('call', { path: 'result.png' });
      assert.equal(result.isError, true);
      assert.equal(value(result).delivered, false);
      assert.match(value(result).reason, /not confirmed/);
      assert.match(value(result).reason, /do not automatically retry/);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
      assert.equal(calls.length, 1, 'non-idempotent delivery is never retried');
    }, () => {
      if (reply === 'throw') throw new Error(secret);
      return new Response(reply === 'invalid-json' ? 'invalid-json' : JSON.stringify(reply) ?? '');
    });
  }
});

test('cancellation before dispatch makes no request; cancellation during delivery cannot become a success', async () => {
  const controller = new AbortController();
  controller.abort();
  await fixture(async (tool, calls) => {
    const result = await tool.execute('call', { path: 'result.png' }, controller.signal);
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
  });
  const active = new AbortController();
  await fixture(async (tool, calls) => {
    const result = await tool.execute('call', { path: 'result.png' }, active.signal);
    assert.equal(result.isError, true);
    assert.match(value(result).reason, /not confirmed/);
    assert.equal(calls.length, 1);
  }, () => {
    active.abort();
    return new Response(JSON.stringify({ delivered: true, messageId: 'one' }));
  });
});

test('broker response extras and oversized bodies never reveal private data', async () => {
  await fixture(async tool => {
    const result = await tool.execute('call', { path: 'result.png' });
    assert.deepEqual(value(result), { delivered: true, messageId: 'remote-message' });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  }, () => new Response(JSON.stringify({ delivered: true, messageId: 'remote-message', token: secret, path: secret })));
  await fixture(async tool => {
    const result = await tool.execute('call', { path: 'result.png' });
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  }, () => new Response(JSON.stringify({ delivered: true, messageId: 'one', private: secret.repeat(4096) })));
});
