import test from 'node:test';
import assert from 'node:assert/strict';
import { setTextHighlight } from '../src/text-highlights';

function fixture(t: test.TestContext) {
  const attributes = new Map<string, string>();
  const writes: string[] = [];
  const highlights = new Map<string, Highlight>();
  const originalCSS = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { highlights } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => { attributes.set(name, value); writes.push(name); },
    removeAttribute: (name: string) => attributes.delete(name),
  } } });
  t.after(() => {
    if (originalCSS) Object.defineProperty(globalThis, 'CSS', originalCSS);
    else Reflect.deleteProperty(globalThis, 'CSS');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const highlight = (size = 1) => ({ size } as Highlight);
  return { attributes, writes, highlights, highlight };
}

test('styles are enabled only while their named ranges are registered', t => {
  const f = fixture(t), highlight = f.highlight();
  const clear = setTextHighlight('desktop-search-match', highlight);
  assert.equal(f.highlights.get('desktop-search-match'), highlight);
  assert.equal(f.attributes.has('data-highlight-desktop-search-match'), true);
  clear();
  assert.equal(f.highlights.size, 0);
  assert.equal(f.attributes.size, 0);
});

test('empty range sets deactivate their own styles without affecting another name', t => {
  const f = fixture(t);
  setTextHighlight('quote-annotation-marks', f.highlight(2));
  setTextHighlight('desktop-search-match', f.highlight());
  setTextHighlight('quote-annotation-marks', f.highlight(0));
  assert.equal(f.highlights.has('quote-annotation-marks'), false);
  assert.equal(f.attributes.has('data-highlight-quote-annotation-marks'), false);
  assert.equal(f.highlights.has('desktop-search-match'), true);
  assert.equal(f.attributes.has('data-highlight-desktop-search-match'), true);
});

test('superseded owner cleanup cannot remove the current ranges or stylesheet scope', t => {
  const f = fixture(t);
  const clearOld = setTextHighlight('quote-annotation-selection', f.highlight());
  const latest = f.highlight();
  const clearLatest = setTextHighlight('quote-annotation-selection', latest);
  clearOld();
  assert.equal(f.highlights.get('quote-annotation-selection'), latest);
  assert.equal(f.attributes.has('data-highlight-quote-annotation-selection'), true);
  assert.equal(f.writes.length, 1, 'Updating active ranges must not rewrite the root attribute');
  clearLatest(); clearOld();
  assert.equal(f.highlights.size, 0);
  assert.equal(f.attributes.size, 0);
});

test('annotation priority and combined owner ranges stay on the original Highlight', t => {
  const f = fixture(t), highlight = Object.assign(f.highlight(3), { priority: 1 });
  setTextHighlight('quote-annotation-focus', highlight);
  assert.equal(f.highlights.get('quote-annotation-focus'), highlight);
  assert.equal(f.highlights.get('quote-annotation-focus')?.priority, 1);
  assert.equal(f.highlights.get('quote-annotation-focus')?.size, 3);
});

test('unsupported custom highlights do not require a DOM', () => {
  assert.doesNotThrow(() => setTextHighlight('desktop-search-match', { size: 1 } as Highlight)());
});
