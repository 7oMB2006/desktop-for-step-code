import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanDesktopUsage } from '../electron/usage-overview.mjs';

const evidence = resolve(process.env.DESKTOP_PREVIEW_EVIDENCE ?? 'test-results/usage-overview-runtime');
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(evidence, 'scan-'));
const sessions = join(root, 'sessions');
await mkdir(sessions);
const runtime = process.env.DESKTOP_MACOS_RESOURCES ? join(process.env.DESKTOP_MACOS_RESOURCES, 'runtime') : resolve('runtime');
const upstream = await import(pathToFileURL(join(runtime, 'step/dist/bundle/index.js')));
const now = new Date(), timestamp = now.toISOString();
const header = id => ({ type: 'session', version: 3, id, cwd: root, timestamp });
const cap = id => ({ type: 'custom', id: `cap-${id}`, customType: 'step.activity_capabilities', timestamp,
  data: { version: 1, sessionId: id, sessionRole: id.startsWith('subagent-') ? 'subagent' : 'user' } });
const response = (id, provider, n) => ({ type: 'message', id, timestamp, message: { role: 'assistant', provider,
  model: 'fixture-model', timestamp: now.getTime(), content: [{ type: 'text', text: 'PRIVATE-CONTENT-MUST-NOT-LEAK' }],
  usage: { input: n, output: 5, cacheRead: 20, cacheWrite: 10 } } });
const a = response('a', 'step', 100);
const write = async (id, entries) => writeFile(join(sessions, `${id}.jsonl`),
  [header(id), cap(id), ...entries].map(row => JSON.stringify(row)).join('\n') + '\n');
await write('original', [a]);
await write('copy', [a, { type: 'custom', id: 'lineage', customType: 'step.usage_lineage', timestamp,
  data: { version: 1, sessionId: 'copy', origins: { a: { sessionId: 'original', cwd: root, role: 'user' } } } }]);
await write('subagent-child', [response('child', 'desktop-custom', 200)]);
await write('compact', [{ type: 'custom', id: 'clm', customType: 'step-auto-clm-usage', timestamp,
  data: { sessionId: 'compact', startedAt: now.getTime(), requestedProvider: 'step', requestedModel: 'compact',
    usage: { input: 10, output: 2, cacheRead: 3, cacheWrite: 0 } } }]);
await write('unknown', [{ type: 'compaction', id: 'summary', timestamp, usage: { input: 7, output: 1, cacheRead: 0, cacheWrite: 0 } }]);
for (let i = 0; i < 2; i++) {
  const out = await scanDesktopUsage(upstream, sessions, join(root, 'cache'));
  const day = out.days.at(-1);
  assert.equal(day.official, 150); assert.equal(day.custom, 235); assert.equal(day.unknown, 8);
  assert.equal(day.samples.reduce((n, s) => n + s.total, 0), 393);
  assert.equal(out.chats.all, 1); assert.equal(out.chats.official, 1); assert.equal(out.chats.custom, 0);
  assert.ok(!JSON.stringify(out).includes('PRIVATE-CONTENT'));
  assert.ok(!JSON.stringify(out).includes(root));
  assert.ok(!out.limited.includes('detail-unavailable'));
}
console.log('PASS native Usage overview: fresh/cache, origin dedup, child, CLM, unknown, no raw content or paths');
