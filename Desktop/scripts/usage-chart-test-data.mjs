import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function seedUsageCharts(profile) {
  const sessions = join(profile, 'step-runtime', 'sessions');
  await mkdir(sessions, { recursive: true });
  const now = new Date(); now.setHours(18, 0, 0, 0);
  const timestamp = now.toISOString();
  const entries = [
    { type: 'session', version: 3, id: 'chart-fixture', cwd: profile, timestamp },
    { type: 'custom', id: 'cap', customType: 'step.activity_capabilities', timestamp,
      data: { version: 1, sessionId: 'chart-fixture', sessionRole: 'user' } },
    ...[['a', 'step', 'step-3.7-flash', 500000], ['b', 'step', 'step-3.5-flash', 100000],
      ['c', 'desktop-custom', 'custom-model', 20000]].map(([id, provider, model, input]) => ({
      type: 'message', id, timestamp, message: { role: 'assistant', content: [], provider, model,
        timestamp: now.getTime(), usage: { input, output: 2000, cacheRead: 5000, cacheWrite: 100 } },
    })),
  ];
  await writeFile(join(sessions, 'chart-fixture.jsonl'), entries.map(row => JSON.stringify(row)).join('\n') + '\n');
}
