import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThemeComposition } from '../electron/theme-composition.mjs';

const composition = (renderer = 'solid-v1', source?: string, accepts?: unknown) => ({
  schemaVersion: 2,
  ui: { renderer: 'standard-v1' },
  background: { renderer, ...(source === undefined ? {} : { source }), ...(accepts === undefined ? {} : { accepts }) },
});

test('legacy stellar composition normalizes to a closed background slot without mutating metadata', () => {
  const raw = { schemaVersion: 1, renderer: 'stellar-v1', scene: 'scene.json', customMetadata: 'preserved' };
  const before = structuredClone(raw);
  assert.deepEqual(parseThemeComposition(raw), {
    ui: 'stellar-v1', background: { renderer: 'stellar-v1', source: 'scene.json' }, accepts: [],
  });
  assert.deepEqual(raw, before);
  assert.throws(() => parseThemeComposition({ ...raw, scene: '../scene.json' }));
  assert.throws(() => parseThemeComposition({ ...raw, renderer: 'arbitrary-js' }));
});

test('version two declares reviewed UI and background renderers independently', () => {
  for (const ui of ['standard-v1', 'stellar-v1']) {
    for (const [renderer, source] of [
      ['solid-v1', undefined], ['stellar-v1', 'scene.json'],
      ['image-v1', 'background.png'], ['image-v1', 'background.jpg'],
    ] as const) {
      const raw = { ...composition(renderer, source), ui: { renderer: ui } };
      assert.deepEqual(parseThemeComposition(raw), {
        ui, background: { renderer, ...(source === undefined ? {} : { source }) }, accepts: [],
      });
    }
  }
});

test('image substitution requires an explicit capability and returns an independent array', () => {
  const closed = composition();
  assert.deepEqual(parseThemeComposition(closed).accepts, []);
  const open = composition('stellar-v1', 'scene.json', ['image-v1']);
  const normalized = parseThemeComposition(open);
  assert.deepEqual(normalized.accepts, ['image-v1']);
  normalized.accepts.length = 0;
  assert.deepEqual(open.background.accepts, ['image-v1']);
});

test('version two accepts bounded inert schema metadata without treating it as a resource', () => {
  assert.deepEqual(parseThemeComposition({ ...composition(), $schema: 'https://example.invalid/theme.schema.json' }),
    parseThemeComposition(composition()));
  for (const $schema of [false, null, 2, {}, 'x'.repeat(2049), 'schema\ninjected']) {
    assert.throws(() => parseThemeComposition({ ...composition(), $schema }));
  }
});

test('unknown versions, renderers, descriptor keys and behavior declarations fail closed', () => {
  const valid = composition();
  for (const invalid of [
    null, [], true, {}, { ...valid, schemaVersion: 3 },
    { ...valid, renderer: 'stellar-v1' }, { ...valid, scene: 'scene.json' },
    { ...valid, script: 'index.js' }, { ...valid, entry: 'index.js' }, { ...valid, capabilities: {} },
    { ...valid, extension: {} }, { ...valid, ui: { renderer: 'experimental-v1' } },
    { ...valid, ui: { renderer: 'standard-v1', entry: 'index.js' } },
    { ...valid, background: { renderer: 'html-v1', source: 'background.html' } },
    { ...valid, background: { renderer: 'solid-v1', input: 'pointer' } },
    { ...valid, background: { renderer: 'solid-v1', interactive: true } },
    { ...valid, background: { renderer: 'solid-v1', source: undefined } },
  ]) assert.throws(() => parseThemeComposition(invalid));
});

test('background sources are engine-specific package filenames rather than paths or URLs', () => {
  for (const [renderer, sources] of [
    ['solid-v1', ['background.png', '', null]],
    ['stellar-v1', [undefined, 'background.png', 'https://example.com/scene.json', '../scene.json']],
    ['image-v1', [undefined, 'scene.json', 'background.jpeg', 'background.webp', 'Background.png', '../background.png',
      'images/background.png', 'file:///background.png', 'https://example.com/background.png', 'data:image/png;base64,eA==']],
  ] as const) {
    for (const source of sources) {
      assert.throws(() => parseThemeComposition({
        ...composition(), background: { renderer, ...(source === undefined ? {} : { source }) },
      }));
    }
  }
});

test('replacement capabilities are bounded to one static image provider', () => {
  for (const accepts of [null, false, 'image-v1', {}, ['stellar-v1'], ['html-v1'],
    ['image-v1', 'image-v1'], ['image-v1', 'html-v1']]) {
    assert.throws(() => parseThemeComposition(composition('solid-v1', undefined, accepts)));
  }
});
