import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatElapsedDuration, elapsedTime } from '../src/elapsed-time';
import { ElapsedLabel } from '../src/ElapsedLabel';
import { PerformanceBar } from '../src/PerformanceBar';
import { updateRunMetrics } from '../src/performance';

const cases = [
  [0, '0s', '0秒'],
  [999, '0s', '0秒'],
  [59999, '59s', '59秒'],
  [60000, '1m 0s', '1分 0秒'],
  [200000, '3m 20s', '3分 20秒'],
  [3599999, '59m 59s', '59分 59秒'],
  [3600000, '1h 0m 0s', '1小时 0分 0秒'],
  [14421000, '4h 0m 21s', '4小时 0分 21秒'],
  [86400000, '24h 0m 0s', '24小时 0分 0秒'],
] as const;

test('elapsed durations share whole-second boundaries and separated units in both languages', () => {
  for (const [ms, compact, chinese] of cases) {
    assert.equal(formatElapsedDuration(ms), compact);
    assert.equal(formatElapsedDuration(ms, 'en'), compact);
    assert.equal(formatElapsedDuration(ms, 'zh'), chinese);
    assert.equal(elapsedTime({ startedAt: 1000 }, ms + 1000), compact);
    assert.equal(elapsedTime({ startedAt: 1000, endedAt: ms + 1000 }, ms + 999999), compact);
  }
  for (const value of [-1000, NaN, Infinity, -Infinity]) assert.equal(formatElapsedDuration(value), '0s');
});

test('performance and completed labels show the same duration and freeze after completion', () => {
  for (const [ms, expected] of cases) {
    const run = updateRunMetrics(null, { type: 'agent_start' }, 1000)!;
    const finished = updateRunMetrics(run, { type: 'agent_end' }, ms + 1000)!;
    for (const language of ['zh', 'en'] as const) {
      const live = renderToStaticMarkup(createElement(PerformanceBar, { run, connected: true, language, now: ms + 1000 }));
      const completed = renderToStaticMarkup(createElement(PerformanceBar, { run: finished, connected: true, language, now: ms + 999999 }));
      const tail = renderToStaticMarkup(createElement(ElapsedLabel, { timing: { startedAt: 1000, endedAt: ms + 1000 }, total: true, language }));
      assert.ok(live.includes(`<strong>${expected}</strong>`), live);
      assert.ok(completed.includes(`<strong>${expected}</strong>`), completed);
      assert.ok(tail.includes(`<span>${expected}</span>`), tail);
    }
  }
});

test('unknown timing stays absent instead of becoming a zero-duration measurement', () => {
  assert.equal(renderToStaticMarkup(createElement(ElapsedLabel, { language: 'zh' })), '');
  assert.equal(renderToStaticMarkup(createElement(ElapsedLabel, { language: 'zh', timing: { startedAt: 1000 } })), '');
  const bar = renderToStaticMarkup(createElement(PerformanceBar, { run: null, connected: true, language: 'zh', now: 1000 }));
  assert.ok(bar.includes('<strong>—</strong>'));
  assert.ok(!bar.includes('<strong>0s</strong>'));
});
