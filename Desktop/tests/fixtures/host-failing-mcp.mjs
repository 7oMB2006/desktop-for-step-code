import { createInterface } from 'node:readline';

// Echoing a private launch in a failed initialize response must not reach UI.
createInterface({ input: process.stdin }).on('line', line => {
  const input = JSON.parse(line);
  if (input.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: input.id,
    error: { code: -32603, message: process.env.DFSC_LAUNCH_CONTEXT ?? 'fixture startup error' } })}\n`);
});
