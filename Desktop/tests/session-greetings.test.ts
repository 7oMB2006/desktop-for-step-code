import assert from 'node:assert/strict';
import test from 'node:test';
import { developerMottos, firstGreeting, greetingPool, nextGreeting, openingGreetings, selectFirstGreeting } from '../src/session-greetings';

test('Chinese opening greetings have equal probability and English stays unchanged', () => {
  assert.deepEqual(openingGreetings.zh, ['让想法阶跃星辰', '星辰因你而阶跃']);
  for (const value of [0, .25, .499999]) assert.equal(selectFirstGreeting('zh', () => value), openingGreetings.zh[0]);
  for (const value of [.5, .75, .999999]) assert.equal(selectFirstGreeting('zh', () => value), openingGreetings.zh[1]);
  for (const value of [0, .5, .999999]) assert.equal(selectFirstGreeting('en', () => value), firstGreeting.en);
  assert.ok(openingGreetings.zh.every(text => !greetingPool('zh', new Date(2026, 9, 8, 8)).includes(text)));
});

test('greetings follow local time boundaries and weekends', () => {
  const date = (hour: number, day = 7) => new Date(2026, 9, day, hour);
  for (const [hour, text] of [[6, '早上好！'], [11, '中午好！'], [14, '下午好！'], [18, '晚上好！'], [23, '少熬夜呀！'], [0, '少熬夜呀！']] as const) {
    assert.ok(greetingPool('zh', date(hour)).includes(text));
  }
  assert.ok(greetingPool('zh', date(14, 10)).includes('周末好！'));
  assert.ok(!greetingPool('zh', date(14)).includes('周末好！'));
  assert.equal(firstGreeting.zh, '让想法阶跃星辰');
  assert.equal(firstGreeting.en, 'Let ideas reach the stars');
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
