import adapter from './remote/lark-adapter.cjs';
import { RemoteConnection } from './remote-channel-core.mjs';

// Only protocol messages reach stdout. No raw SDK exceptions or diagnostics escape.
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
const connection = new RemoteConnection(adapter, write);
let buffer = '';
const close = () => { void connection.close().finally(() => process.exit(0)); };
process.on('SIGTERM', close);
process.on('SIGINT', close);
process.stdin.on('end', close);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  if (buffer.length > 65536) { close(); return; }
  for (;;) {
    const end = buffer.indexOf('\n');
    if (end < 0) break;
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    let value;
    try { value = JSON.parse(line); } catch { close(); return; }
    if (!value || typeof value.id !== 'string' || value.id.length > 80 || typeof value.type !== 'string') { close(); return; }
    Promise.resolve().then(() => connection.command(value.type, value))
      .then(data => write({ type: 'response', id: value.id, success: true, data }))
      .catch(() => write({ type: 'response', id: value.id, success: false, error: 'Remote operation unavailable' }));
  }
});
