import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackIncidentTime } from '../src/feedback-incident-time';

test('feedback incident time converts an explicit local date and time, or leaves both blank', () => {
  assert.equal(feedbackIncidentTime('', ''), undefined);
  assert.equal(feedbackIncidentTime('2024-02-29', '14:35'), new Date(2024, 1, 29, 14, 35).toISOString());
});

test('feedback incident time rejects missing values, impossible days and out-of-range times', () => {
  for (const [date, time] of [
    ['2026-02-28', ''], ['', '14:35'], ['2026-02-29', '14:35'],
    ['2026-03-01', '24:00'], ['2026-03-01', '13:60'], ['2026-03-01', '2:10'],
  ]) assert.equal(feedbackIncidentTime(date, time), null, `${date} ${time}`);
});
