import test from 'node:test';
import assert from 'node:assert/strict';
import { followAfterScroll, scrollKeyIntent } from '../src/conversation-scroll';

test('an upward gesture stays paused even at the bottom of a short transcript', () => {
  for (const distance of [0, .5, 1, 40, 62, 99, 100, 240]) {
    assert.equal(followAfterScroll(false, distance, 'backward'), false);
    assert.equal(followAfterScroll(true, distance, 'backward'), false);
  }
});

test('resuming needs the actual bottom, not the old near-bottom threshold', () => {
  for (const distance of [2, 40, 62, 99, 120]) {
    assert.equal(followAfterScroll(false, distance, 'forward'), false);
  }
  for (const distance of [-.5, 0, .5, 1]) {
    assert.equal(followAfterScroll(false, distance, 'forward'), true);
  }
});

test('automatic following and unmarked layout changes retain their reflow tolerance', () => {
  assert.equal(followAfterScroll(true, 40), true);
  assert.equal(followAfterScroll(true, 99), true);
  assert.equal(followAfterScroll(true, 100), false);
  assert.equal(followAfterScroll(false, 62), true);
  assert.equal(followAfterScroll(false, 100), false);
  assert.equal(followAfterScroll(false, 0), true);
});

test('an explicit return follows a moving tail throughout smooth scrolling', () => {
  for (const distance of [0, 40, 99, 100, 240, 2000]) {
    assert.equal(followAfterScroll(true, distance, 'tail'), true);
  }
  assert.equal(followAfterScroll(false, 40, 'backward'), false);
});

test('scroll keys distinguish backward reading from returning to the tail', () => {
  const event = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, key: '' };
  for (const key of ['ArrowUp', 'PageUp', 'Home']) assert.equal(scrollKeyIntent({ ...event, key }), 'backward');
  for (const key of ['ArrowDown', 'PageDown', 'End', ' ']) assert.equal(scrollKeyIntent({ ...event, key }), 'forward');
  assert.equal(scrollKeyIntent({ ...event, key: ' ', shiftKey: true }), 'backward');
  assert.equal(scrollKeyIntent({ ...event, key: 'Enter' }), undefined);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(scrollKeyIntent({ ...event, key: 'Home', [modifier]: true }), undefined);
  }
});
