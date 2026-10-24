import test from 'node:test';
import assert from 'node:assert/strict';
import { followAfterScroll, scrollKeyIntent, scrollOverlayWheel } from '../src/conversation-scroll';

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


test('overlay wheel gestures reach the sibling viewport in pixel, line and page units', () => {
  for (const [deltaY, deltaMode, expected] of [[-40, 0, 260], [-2, 1, 260], [-1, 2, 0], [1, 2, 700], [9999, 0, 700]]) {
    const scroll = { scrollTop: 300, scrollHeight: 1100, clientHeight: 400 };
    let prevented = false;
    assert.equal(scrollOverlayWheel(scroll, { deltaY, deltaMode, ctrlKey: false, defaultPrevented: false,
      preventDefault() { prevented = true; } }), true);
    assert.equal(scroll.scrollTop, expected);
    assert.equal(prevented, true);
  }
});

test('overlay forwarding preserves zoom, consumed events and nonvertical gestures', () => {
  for (const override of [{ ctrlKey: true }, { defaultPrevented: true }, { deltaY: 0 }]) {
    const scroll = { scrollTop: 300, scrollHeight: 1100, clientHeight: 400 };
    assert.equal(scrollOverlayWheel(scroll, { deltaY: -40, deltaMode: 0, ctrlKey: false, defaultPrevented: false,
      preventDefault() { assert.fail('Must not consume this gesture'); }, ...override }), false);
    assert.equal(scroll.scrollTop, 300);
  }
  assert.equal(scrollOverlayWheel({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 }, {
    deltaY: -40, deltaMode: 0, ctrlKey: false, defaultPrevented: false,
    preventDefault() { assert.fail('No overflowing transcript'); },
  }), false);
});
