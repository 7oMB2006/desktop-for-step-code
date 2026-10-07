import assert from 'node:assert/strict';
import test from 'node:test';
import { developerMottos, firstGreeting, greetingPool, nextGreeting } from '../src/session-greetings';

test('greetings follow local time boundaries and weekends', () => {
  const date = (hour: number, day = 7) => new Date(2026, 9, day, hour);
  for (const [hour, text] of [[6, '早上好！'], [11, '中午好！'], [14, '下午好！'], [18, '晚上好！'], [23, '少熬夜呀！'], [0, '少熬夜呀！']] as const) {
    assert.ok(greetingPool('zh', date(hour)).includes(text));
  }
  assert.ok(greetingPool('zh', date(14, 10)).includes('周末好！'));
  assert.ok(!greetingPool('zh', date(14)).includes('周末好！'));
  assert.equal(firstGreeting.zh, '让梦想阶跃星辰');
  assert.equal(developerMottos[0], '踽踽而行 步履不停');
});

test('ordinary greetings exhaust without repetition and mottos remain low-frequency', () => {
  const seen = new Set<string>();
  const date = new Date(2026, 9, 7, 8);
  const pool = greetingPool('zh', date);
  let previous = firstGreeting.zh;
  for (let i = 0; i < pool.length; i++) {
    const next = nextGreeting('zh', previous, seen, date, () => .5);
    assert.notEqual(next, previous);
    previous = next;
  }
  assert.equal(seen.size, pool.length);
  assert.notEqual(nextGreeting('zh', previous, seen, date, () => .5), previous);
  assert.equal(nextGreeting('zh', previous, seen, date, () => 0), developerMottos[0]);
  assert.notEqual(nextGreeting('zh', developerMottos[0], seen, date, () => 0), developerMottos[0]);
});
