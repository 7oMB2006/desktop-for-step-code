import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { observeCodeHighlight } from '../src/viewport-highlight';

function fixture(t: TestContext, observerAvailable = true) {
  const { document, window } = parseHTML('<html><body></body></html>');
  const frames = new Map<number, FrameRequestCallback>();
  const disposers: (() => void)[] = [];
  const observers: { callback: IntersectionObserverCallback; targets: Set<Element>; disconnected: boolean }[] = [];
  let frameId = 0, time = 0;
  let selection: Selection | null = null;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    performance: { now: () => time },
    IntersectionObserver: observerAvailable ? class {
      record: typeof observers[number];
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, targets: new Set(), disconnected: false };
        observers.push(this.record);
      }
      observe(element: Element) { this.record.targets.add(element); }
      unobserve(element: Element) { this.record.targets.delete(element); }
      disconnect() { this.record.targets.clear(); this.record.disconnected = true; }
    } : undefined,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(window, key));
    Object.defineProperty(window, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(document, 'getSelection', { configurable: true, value: () => selection });
  t.after(() => {
    disposers.forEach(dispose => dispose());
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(window, key, descriptor);
      else Reflect.deleteProperty(window, key);
    }
  });
  const elements = Array.from({ length: 80 }, () => {
    const element = document.createElement('code');
    element.textContent = 'const source = "<script>";';
    document.body.append(element);
    return element;
  });
  return {
    document, window, elements, observers, frames,
    add(index: number, run: () => void) {
      const dispose = observeCodeHighlight(elements[index], run);
      disposers.push(dispose);
      return dispose;
    },
    intersect(indexes: number[], isIntersecting = true) {
      const observer = observers.at(-1)!;
      const rect = { x: 0, y: 0, top: 0, bottom: 1, left: 0, right: 1, width: 1, height: 1, toJSON() {} };
      observer.callback(indexes.map(index => ({ target: elements[index], isIntersecting,
        boundingClientRect: rect, intersectionRect: rect, intersectionRatio: isIntersecting ? 1 : 0, rootBounds: null, time })),
      {} as IntersectionObserver);
    },
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(time));
    },
    advance(ms: number) { time += ms; },
    select(indexes: number[]) {
      selection = { isCollapsed: false, rangeCount: indexes.length,
        getRangeAt: (index: number) => ({ intersectsNode: (element: Element) => element === elements[indexes[index]] }) } as Selection;
      document.dispatchEvent(new window.Event('selectionchange'));
    },
    clearSelection() { selection = null; document.dispatchEvent(new window.Event('selectionchange')); },
    event(type: string) { document.dispatchEvent(new window.Event(type)); },
  };
}

test('one observer shares the viewport work; offscreen code remains complete and untouched', t => {
  const f = fixture(t);
  const calls: number[] = [];
  f.elements.forEach((_, index) => f.add(index, () => { calls.push(index); }));
  assert.equal(f.observers.length, 1);
  assert.equal(f.frames.size, 0);
  f.intersect([0, 1, 79]);
  assert.deepEqual(calls, []);
  f.frame();
  assert.deepEqual(calls, [0, 1, 79]);
  assert.equal(f.observers[0].targets.size, 77);
  assert.ok(f.elements.every(element => element.textContent === 'const source = "<script>";'));
  f.intersect([0, 1, 79]);
  f.frame();
  assert.deepEqual(calls, [0, 1, 79], 'Settled code is not highlighted again on observer notifications');
});

test('visible work yields between blocks and cancels work which leaves the viewport', t => {
  const f = fixture(t);
  const calls: number[] = [];
  for (let index = 0; index < 4; index++) f.add(index, () => { calls.push(index); f.advance(5); });
  f.intersect([0, 1, 2, 3]);
  f.frame();
  assert.deepEqual(calls, [0]);
  assert.equal(f.frames.size, 1);
  f.intersect([1], false);
  f.frame();
  assert.deepEqual(calls, [0, 2]);
  f.frame();
  assert.deepEqual(calls, [0, 2, 3]);
  assert.equal(f.frames.size, 0);
  f.intersect([1]);
  f.frame();
  assert.deepEqual(calls, [0, 2, 3, 1]);
  assert.equal(f.observers[0].disconnected, true);
});

test('all selected ranges are protected without blocking unrelated visible code or spinning frames', t => {
  const f = fixture(t);
  const calls: number[] = [];
  for (let index = 0; index < 3; index++) f.add(index, () => { calls.push(index); });
  f.select([0, 1]);
  f.intersect([0, 1, 2]);
  f.frame();
  assert.deepEqual(calls, [2]);
  assert.equal(f.frames.size, 0);
  f.clearSelection();
  f.frame();
  assert.deepEqual(calls, [2, 0, 1]);
});

test('pointer selection pauses pending work until release, cancel or window blur', t => {
  const f = fixture(t);
  const calls: number[] = [];
  for (let index = 0; index < 3; index++) f.add(index, () => { calls.push(index); f.advance(5); });
  f.intersect([0, 1, 2]);
  f.event('pointerdown');
  f.frame();
  assert.deepEqual(calls, []);
  f.event('pointerup');
  f.frame();
  assert.deepEqual(calls, [0]);
  f.event('pointerdown');
  f.frame();
  assert.deepEqual(calls, [0]);
  f.event('pointercancel');
  f.frame();
  assert.deepEqual(calls, [0, 1]);
  f.event('pointerdown');
  f.frame();
  f.window.dispatchEvent(new f.window.Event('blur'));
  f.frame();
  assert.deepEqual(calls, [0, 1, 2]);
});

test('unmount cancels queued work and a replaced source cannot commit an obsolete callback', t => {
  const f = fixture(t);
  const calls: string[] = [];
  const cancel = f.add(0, () => { calls.push('old'); });
  f.intersect([0]);
  cancel();
  assert.equal(f.frames.size, 0);
  assert.equal(f.observers[0].disconnected, true);
  f.add(0, () => { calls.push('current'); });
  f.intersect([0]);
  f.frame();
  assert.deepEqual(calls, ['current']);
  f.add(1, () => { calls.push('detached'); });
  f.intersect([1]);
  f.elements[1].remove();
  f.frame();
  assert.deepEqual(calls, ['current']);
  assert.equal(f.frames.size, 0);
});

test('without IntersectionObserver the full source still paints first and coloring yields', t => {
  const f = fixture(t, false);
  let calls = 0;
  for (let index = 0; index < 3; index++) f.add(index, () => { calls++; f.advance(5); });
  assert.equal(calls, 0);
  assert.ok(f.elements.every(element => element.textContent === 'const source = "<script>";'));
  f.frame();
  assert.equal(calls, 1);
  f.frame();
  f.frame();
  assert.equal(calls, 3);
  assert.equal(f.frames.size, 0);
});
