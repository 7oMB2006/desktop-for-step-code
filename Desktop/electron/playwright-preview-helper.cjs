const { createRequire } = require('node:module');
const { createConnection } = require('@playwright/mcp');
const { chromium } = createRequire(require.resolve('@playwright/mcp'))('playwright');

const port = process.parentPort;
let connection;
let server;
let protocol;
let page;
let nextId = 0;
let ready;
const pending = new Map();

function send(value) {
  port.postMessage(value);
}

function rpc(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    protocol.onmessage({ jsonrpc: '2.0', id, method, params });
  }).finally(() => pending.delete(id));
}

async function connect(outputDir) {
  const transport = {
    send(message) { send({ type: 'cdp-command', message }); },
    close() { this.onclose?.('Preview connection ended'); },
  };
  connection = transport;
  const browser = await chromium.connectOverCDP(transport, { noDefaults: true, timeout: 5000 });
  const [context] = browser.contexts();
  if (context?.pages().length !== 1) throw new Error('Expected exactly one preview page');
  [page] = context.pages();
  server = await createConnection({ browser: { isolated: false }, outputDir, outputMode: 'stdout',
    ignoreRoots: true, timeouts: { action: 5000, navigation: 8000 } }, async () => context);
  protocol = {
    async start() {},
    async close() { for (const request of pending.values()) request.reject(new Error('Preview connection ended')); },
    async send({ id, result, error }) {
      if (error) pending.get(id)?.reject(new Error(error.message));
      else pending.get(id)?.resolve(result);
    },
  };
  await server.connect(protocol);
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'DFSC Playwright preview', version: '1' } });
  protocol.onmessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

// Build arguments here, not by forwarding the caller's MCP payload.
const tools = {
  snapshot: () => ['browser_snapshot', {}],
  navigate: input => ['browser_navigate', { url: input.url }],
  click: input => ['browser_click', { target: input.ref }],
  type: input => ['browser_type', { target: input.ref, text: input.text }],
  press: input => ['browser_press_key', { key: input.key }],
  console: () => ['browser_console_messages', { level: 'error' }],
  network: () => ['browser_network_requests', { static: false }],
  screenshot: () => ['browser_take_screenshot', { type: 'png' }],
};

port.on('message', ({ data }) => {
  if (data.type === 'cdp-response') { connection?.onmessage?.(data.message); return; }
  if (data.type === 'start' && !ready) {
    ready = connect(data.outputDir);
    void ready.then(() => send({ type: 'ready' }), () => send({ type: 'failed' }));
    return;
  }
  if (data.type !== 'call') return;
  void (async () => {
    try {
      if (!ready || !Object.hasOwn(tools, data.input.action)) throw new Error('Unavailable browser operation');
      await ready;
      if (data.fillOnly) {
        if (!/^e\d{1,10}$/.test(data.input.ref)) throw new Error('Fill requires an ordinary field in the main page');
        const field = page.locator(`aria-ref=${data.input.ref}`).and(page.locator(
          `:is(textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"])
           :not([autocomplete*="password" i],[autocomplete*="one-time-code" i],[autocomplete*="cc-" i],[autocomplete*="webauthn" i])`.replace(/\s+/g, ''),
        ));
        if (await field.count() !== 1) {
          send({ type: 'result', id: data.id, result: { isError: true,
            content: [{ type: 'text', text: 'This reference does not identify an ordinary field in the shared page.' }] } });
          return;
        }
        await field.fill(data.input.text, { timeout: 5000 });
        send({ type: 'result', id: data.id, result: { content: [{ type: 'text', text: 'Filled the field. No submit action was sent.' }] } });
        return;
      }
      const [name, args] = tools[data.input.action](data.input);
      const result = await rpc('tools/call', { name, arguments: args });
      send({ type: 'result', id: data.id, result });
    } catch {
      send({ type: 'result', id: data.id, result: { isError: true,
        content: [{ type: 'text', text: 'Built-in Playwright operation failed.' }] } });
    }
  })();
});
