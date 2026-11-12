import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { afterConversationLayout, beginConversationLayout, followConversationTail, observeConversationLayout, releaseConversationLayout } from '../src/conversation-layout';

function fixture(t: TestContext, count = 100, clampScroll = false) {
  const { document, window } = parseHTML('<html><body><div class="app"><div class="conversation"><div class="messages"></div></div></div></body></html>');
  const viewport = document.querySelector<HTMLElement>('.conversation')!;
  const content = document.querySelector<HTMLElement>('.messages')!;
  const root = document.querySelector<HTMLElement>('.app')!;
  const frames = new Map<number, FrameRequestCallback>();
  const observers: (() => void)[] = [];
  let nextFrame = 0, width = 600, top = 4000, follow = false, tailGrowth = 0;
  let selection: { isCollapsed: boolean; anchorNode: Node | null; focusNode: Node | null } | null = null;
  let focused: Element | null = document.body;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    getSelection: () => selection,
    ResizeObserver: class {
      constructor(callback: () => void) { observers.push(callback); }
      observe() {}
      disconnect() {}
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(window, key));
    Object.defineProperty(window, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => focused });
  const rows = Array.from({ length: count }, (_, index) => {
    const row = document.createElement('article');
    row.className = `message ${index % 2 ? 'assistant' : 'user'}`;
    row.dataset.messageIndex = String(index);
    row.innerHTML = `<p>Original text ${index}</p><button>Copy</button>`;
    row.style.getPropertyPriority = () => '';
    content.append(row);
    return row;
  });
  const height = (row: HTMLElement) => (Number.parseFloat(row.style.width || String(width)) >= 500 ? 100 : 150)
    + (row === rows.at(-1) ? tailGrowth : 0);
  const rect = (y: number, w: number, h: number) => ({ x: 0, y, top: y, bottom: y + h, left: 0, right: w, width: w, height: h, toJSON() {} });
  viewport.getBoundingClientRect = () => rect(0, width, 500);
  content.getBoundingClientRect = () => rect(-top, width, rows.reduce((sum, row) => sum + height(row), 0));
  for (const row of rows) row.getBoundingClientRect = () =>
    rect(rows.slice(0, rows.indexOf(row)).reduce((sum, previous) => sum + height(previous), 0) - top,
      Number.parseFloat(row.style.width || String(width)), height(row));
  Object.defineProperties(viewport, {
    clientHeight: { get: () => 500 },
    scrollHeight: { get: () => rows.reduce((sum, row) => sum + height(row), 0) },
    scrollTop: { get: () => top, set: (value: number) => {
      top = clampScroll ? Math.max(0, Math.min(value, viewport.scrollHeight - viewport.clientHeight)) : value;
    } },
  });
  const dispose = observeConversationLayout(viewport, content, () => follow);
  t.after(() => {
    dispose();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(window, key, descriptor);
      else Reflect.deleteProperty(window, key);
    }
  });
  const transition = (type: string, property = 'flex-basis', target = root, gesture = true) => {
    const event = new window.Event(type, { bubbles: true });
    Object.assign(event, { propertyName: property, pseudoElement: '' });
    target.dispatchEvent(event);
    if (type === 'transitionrun' && gesture) beginConversationLayout(content);
  };
  return {
    root, viewport, content, rows, document, window, dispose, transition,
    get locked() { return rows.filter(row => row.hasAttribute('data-layout-locked')); },
    resize(value: number, notify = true) { width = value; if (notify) observers.forEach(callback => callback()); },
    growTail(value: number) { tailGrowth += value; },
    focus(element: Element) { focused = element; },
    select(element: HTMLElement) { selection = { isCollapsed: false, anchorNode: element.firstChild, focusNode: element.firstChild }; },
    clearSelection() { selection = null; },
    followTail() { follow = true; viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight; },
    flush() {
      for (let pass = 0; pass < 4 && frames.size; pass++) {
        const callbacks = [...frames.values()]; frames.clear();
        callbacks.forEach(callback => callback(0));
      }
    },
  };
}

test('only distant history keeps its measured width; no message is removed, hidden or height-estimated', t => {
  const f = fixture(t);
  const before = [...f.content.children];
  f.transition('transitionrun');
  assert.ok(f.locked.length > 70);
  assert.ok(!f.rows[40].hasAttribute('data-layout-locked'));
  assert.ok(!f.rows[99].hasAttribute('data-layout-locked'));
  assert.ok(!f.rows[98].hasAttribute('data-layout-locked'));
  for (const row of f.locked) {
    assert.equal(row.style.width, '600px');
    assert.equal(row.style.height, undefined);
    assert.equal(row.style.contentVisibility, undefined);
    assert.match(row.textContent!, /Original text/);
  }
  assert.deepEqual([...f.content.children], before);
});

test('live and keyboard-focused history never locks; pre-existing inline widths survive cleanup', t => {
  const f = fixture(t);
  f.rows[5].classList.add('response-active');
  f.focus(f.rows[8].querySelector('button')!);
  f.rows[3].style.width = '520px';
  f.transition('transitionrun');
  assert.equal(f.rows[5].hasAttribute('data-layout-locked'), false);
  assert.equal(f.rows[8].hasAttribute('data-layout-locked'), false);
  f.transition('transitionend'); f.flush();
  assert.equal(f.rows[3].style.width, '520px');
  assert.equal(f.locked.length, 0);
  assert.equal(f.viewport.hasAttribute('data-layout-window'), false);
});

test('settling reflows once and restores the same historical article and offset at the new width', t => {
  const f = fixture(t);
  const anchor = f.rows[40];
  const offset = anchor.getBoundingClientRect().top;
  f.transition('transitionrun');
  f.resize(400);
  assert.equal(anchor.getBoundingClientRect().top, offset);
  assert.equal(f.rows[0].getBoundingClientRect().height, 100);
  f.transition('transitionend'); f.flush();
  assert.equal(f.rows[0].getBoundingClientRect().height, 150);
  assert.equal(anchor.getBoundingClientRect().top, offset);
  assert.equal(f.viewport.scrollTop, 6000);
});

test('tail followers remain at the real new tail after the final historical reflow', t => {
  const f = fixture(t);
  f.followTail();
  f.transition('transitionrun');
  f.resize(400);
  f.transition('transitionend'); f.flush();
  assert.equal(f.viewport.scrollTop, f.viewport.scrollHeight);
  assert.equal(f.locked.length, 0);
});

test('normal settlement retains the gesture anchor rather than a late automatic scroll correction', t => {
  const f = fixture(t);
  f.transition('transitionrun');
  f.resize(400);
  f.viewport.scrollTop += 79;
  f.transition('transitionend'); f.flush();
  assert.equal(f.rows[40].getBoundingClientRect().top, 0);
});

test('final geometry is read before combining an anchor correction with the current scroll position', t => {
  const f = fixture(t);
  f.transition('transitionrun');
  f.resize(400);
  const row = f.rows[40];
  const rect = row.getBoundingClientRect;
  let corrected = false;
  row.getBoundingClientRect = () => {
    if (!f.locked.length && !corrected) { corrected = true; f.viewport.scrollTop += 79; }
    return rect();
  };
  f.transition('transitionend'); f.flush();
  assert.equal(corrected, true);
  assert.equal(row.getBoundingClientRect().top, 0);
});

test('viewport geometry is settled before sampling the historical anchor rect', t => {
  const f = fixture(t);
  f.transition('transitionrun');
  f.resize(400);
  const rect = f.viewport.getBoundingClientRect;
  let corrected = false;
  f.viewport.getBoundingClientRect = () => {
    if (!f.locked.length && !corrected) { corrected = true; f.viewport.scrollTop += 79; }
    return rect();
  };
  f.transition('transitionend'); f.flush();
  assert.equal(corrected, true);
  assert.equal(f.rows[40].getBoundingClientRect().top, 0);
});

test('live tail corrections keep measured widths, but uncoordinated scrolling still releases them', t => {
  const f = fixture(t, 100, true);
  f.followTail();
  f.transition('transitionrun');
  f.resize(400);
  f.growTail(40);
  followConversationTail(f.viewport);
  f.viewport.dispatchEvent(new f.window.Event('scroll'));
  assert.ok(f.locked.length);
  f.growTail(40);
  followConversationTail(f.viewport);
  f.viewport.dispatchEvent(new f.window.Event('scroll'));
  assert.ok(f.locked.length);
  f.viewport.scrollTop -= 200;
  f.viewport.dispatchEvent(new f.window.Event('scroll'));
  assert.equal(f.locked.length, 0);
  f.transition('transitionend'); f.flush();
  f.dispose();
  f.viewport.scrollTop = 0;
  followConversationTail(f.viewport);
  assert.equal(f.viewport.scrollTop, f.viewport.scrollHeight - f.viewport.clientHeight, 'Unobserved viewports still follow the tail');
});

test('layout scrolling before the width observer retains protection and the gesture anchor', t => {
  const f = fixture(t);
  f.transition('transitionrun');
  f.resize(400, false);
  f.viewport.scrollTop += 79;
  f.viewport.dispatchEvent(new f.window.Event('scroll'));
  assert.ok(f.locked.length, 'A changed width must be reconciled before classifying its scroll');
  assert.equal(f.rows[40].getBoundingClientRect().top, 0);
  f.resize(400);
  f.transition('transitionend'); f.flush();
  assert.equal(f.rows[40].getBoundingClientRect().top, 0);
  assert.equal(f.locked.length, 0);
});

test('real input still cancels protection before a pending width observation', t => {
  const f = fixture(t);
  for (const type of ['wheel', 'touchstart', 'keydown']) {
    f.resize(600);
    f.transition('transitionrun');
    f.resize(400, false);
    f.viewport.dispatchEvent(new f.window.Event(type, { bubbles: true }));
    assert.equal(f.locked.length, 0, type);
    f.transition('transitionend'); f.flush();
  }
});

test('live content and working indicators do not change article membership', async t => {
  const f = fixture(t);
  f.followTail();
  f.transition('transitionrun');
  const locked = [...f.locked];
  const working = f.document.createElement('div');
  working.className = 'working';
  f.content.append(working);
  f.rows[99].querySelector('p')!.textContent += ' Streaming delta';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.locked, locked);
  working.remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.locked, locked, 'Completing a response must not discard active width protection');
  f.transition('transitionend'); f.flush();
  assert.equal(f.locked.length, 0);
});

test('article insertion, replacement and reorder release active widths', async t => {
  const f = fixture(t);
  for (const mutate of [
    () => {
      const row = f.document.createElement('article');
      row.dataset.messageIndex = '100';
      f.content.append(row);
    },
    () => f.content.append(f.rows[1]),
    () => {
      const row = f.document.createElement('article');
      row.dataset.messageIndex = '0';
      f.rows[0].replaceWith(row);
    },
  ]) {
    f.transition('transitionrun');
    assert.ok(f.locked.length);
    mutate();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.locked.length, 0);
    f.transition('transitionend'); f.flush();
  }
});

test('short histories and absent viewports do not receive layout locks', t => {
  const f = fixture(t, 10);
  f.transition('transitionrun');
  assert.equal(f.locked.length, 0);
  assert.doesNotThrow(() => beginConversationLayout(null));
  assert.doesNotThrow(() => releaseConversationLayout(null));
});

test('selected text is retained without changing any historical width', t => {
  const f = fixture(t);
  f.select(f.rows[40]);
  f.transition('transitionrun');
  assert.equal(f.locked.length, 0);
});

test('navigation waits for final geometry, while cancellation and session disposal cancel deferred actions', t => {
  const f = fixture(t);
  f.transition('transitionrun');
  let calls = 0;
  afterConversationLayout(f.content, () => { calls++; });
  assert.equal(f.locked.length, 0);
  f.flush();
  assert.equal(calls, 0);
  f.transition('transitionend'); f.flush();
  assert.equal(calls, 1);
  const cancel = afterConversationLayout(f.content, () => { calls++; });
  cancel(); f.flush();
  assert.equal(calls, 1);
  afterConversationLayout(f.content, () => { calls++; });
  f.dispose(); f.flush();
  assert.equal(calls, 1);
});
test('explicit navigation releases geometry synchronously and does not relock during the same transition', t => {
  const f = fixture(t);
  f.transition('transitionrun');
  assert.ok(f.locked.length);
  releaseConversationLayout(f.content);
  assert.equal(f.locked.length, 0);
  beginConversationLayout(f.content);
  assert.equal(f.locked.length, 0);
  f.transition('transitionend'); f.flush();
  beginConversationLayout(f.content);
  assert.ok(f.locked.length);
});

test('overlapping transitions settle only when all widths finish, including canceled tracks', t => {
  const f = fixture(t);
  f.transition('transitionrun');
  f.transition('transitionrun', 'max-width', f.content);
  f.resize(400);
  f.transition('transitioncancel'); f.flush();
  assert.ok(f.locked.length);
  f.transition('transitionend', 'max-width', f.content); f.flush();
  assert.equal(f.locked.length, 0);
  assert.equal(f.rows[40].getBoundingClientRect().top, 0);
});

test('the latest deferred navigation wins, and subsequent user scrolling cancels it', t => {
  const f = fixture(t);
  const calls: number[] = [];
  f.transition('transitionrun');
  afterConversationLayout(f.content, () => calls.push(1));
  afterConversationLayout(f.content, () => calls.push(2));
  f.transition('transitionend'); f.flush();
  assert.deepEqual(calls, [2]);
  f.transition('transitionrun');
  afterConversationLayout(f.content, () => calls.push(3));
  f.viewport.dispatchEvent(new f.window.Event('wheel'));
  f.transition('transitionend'); f.flush();
  assert.deepEqual(calls, [2]);
  afterConversationLayout(f.content, () => calls.push(4));
  releaseConversationLayout(f.content); f.flush();
  assert.deepEqual(calls, [2]);
});

test('text selection, native resize and history replacement release measured widths', async t => {
  const f = fixture(t);
  f.transition('transitionrun');
  f.select(f.rows[40]);
  f.document.dispatchEvent(new f.window.Event('selectionchange'));
  assert.equal(f.locked.length, 0);
  f.transition('transitionend'); f.flush();
  f.clearSelection();
  f.transition('transitionrun');
  assert.ok(f.locked.length);
  f.window.dispatchEvent(new f.window.Event('resize'));
  assert.equal(f.locked.length, 0);
  f.transition('transitionend'); f.flush();
  f.transition('transitionrun');
  assert.ok(f.locked.length);
  f.rows[0].remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.locked.length, 0);
  f.transition('transitionend'); f.flush();
  f.transition('transitionrun', 'flex-basis', f.root, false);
  f.rows[1].remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  f.resize(400);
  assert.equal(f.locked.length, 0, 'Changed history must also cancel a transition that has not acquired widths yet');
});

test('scrolling, keyboard input, cancellation and disposal restore all inline styles', t => {
  const f = fixture(t);
  f.transition('transitionrun');
  f.viewport.scrollTop = 1000;
  f.viewport.dispatchEvent(new f.window.Event('scroll'));
  assert.equal(f.locked.length, 0);
  f.transition('transitioncancel'); f.flush();
  f.transition('transitionrun');
  assert.ok(f.locked.length);
  f.root.dispatchEvent(new f.window.Event('keydown', { bubbles: true }));
  assert.equal(f.locked.length, 0);
  f.transition('transitionend'); f.flush();
  beginConversationLayout(f.content);
  assert.ok(f.locked.length);
  f.dispose();
  assert.equal(f.locked.length, 0);
  beginConversationLayout(f.content);
  assert.equal(f.locked.length, 0);
});

test('automatic transitions through spare space do not lock history; real reflow keeps the original anchor', t => {
  const f = fixture(t);
  f.transition('transitionrun', 'flex-basis', f.root, false);
  assert.equal(f.locked.length, 0);
  f.resize(600);
  assert.equal(f.locked.length, 0);
  f.resize(400);
  assert.ok(f.locked.length);
  assert.equal(f.rows[40].getBoundingClientRect().top, 0);
  assert.equal(f.rows[40].hasAttribute('data-layout-locked'), false);
  f.transition('transitionend'); f.flush();
  assert.equal(f.locked.length, 0);
  assert.equal(f.rows[40].getBoundingClientRect().top, 0);
});
