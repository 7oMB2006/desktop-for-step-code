import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { applyResolvedTheme, applyTheme, contrastRatio, normalizeAccent, normalizeTheme, resolveTheme, themePreferencePatch, themes } from '../src/theme';
import { applyThemeMaterial } from '../src/theme-material';

test('six named themes plus original monochrome, system compatibility and safe preference validation', () => {
  assert.deepEqual(themes.map(theme => theme.id), ['light', 'paper', 'dark', 'blue', 'wine', 'jade', 'original-light', 'original-dark']);
  assert.equal(themes.filter(theme => theme.group !== 'original').length, 6);
  assert.equal(resolveTheme('original-light', true).tokens['--bg'], '#ffffff');
  assert.equal(resolveTheme('original-dark', false).tokens['--bg'], '#141414');
  assert.equal(normalizeTheme(undefined), 'system');
  assert.equal(normalizeTheme('bad'), 'system');
  assert.equal(resolveTheme('system', false).id, 'light');
  assert.equal(resolveTheme('system', true).id, 'dark');
  for (const theme of themes) {
    assert.equal(resolveTheme(theme.id, true).id, theme.id);
    assert.equal(resolveTheme(theme.id, false).id, theme.id);
    assert.ok(contrastRatio(theme.ink, theme.bg) >= 4.5);
    for (const background of [theme.bg, theme.side, theme.surface]) {
      assert.ok(contrastRatio(theme.muted, background) >= 4.5, `${theme.id} secondary text on ${background}`);
    }
  }
  assert.equal(normalizeAccent('#AbC'), '#aabbcc');
  assert.equal(normalizeAccent(' #ABCDEF '), '#abcdef');
  for (const bad of [null, '', '#abcd', '#aabbccdd', 'url(test)', 'red', 1, {}]) assert.equal(normalizeAccent(bad), undefined);
  assert.deepEqual(themePreferencePatch({ theme: 'jade', accentColor: '#aBc' }), { theme: 'jade', accentColor: '#aabbcc' });
  assert.deepEqual(themePreferencePatch({ accentColor: null }), { accentColor: null });
  assert.deepEqual(themePreferencePatch({}), {});
  assert.throws(() => themePreferencePatch({ theme: 'unknown' }), /Invalid theme/);
  assert.throws(() => themePreferencePatch({ accentColor: 'url(test)' }), /Invalid accent/);
});

test('custom accents remain readable on every surface without changing semantic state colors', () => {
  for (const theme of themes) {
    for (const accent of ['#ffffff', '#000000', '#ffff00', '#00ff00', '#0000ff', '#ff0000', '#888888', theme.accent]) {
      const resolved = resolveTheme(theme.id, false, accent);
      assert.equal(resolved.accent, accent);
      for (const bg of [theme.bg, theme.side, theme.surface]) {
        assert.ok(contrastRatio(resolved.tokens['--primary'], bg) >= 4.5, `${theme.id}: ${accent} on ${bg}`);
      }
      assert.ok(contrastRatio(resolved.tokens['--primary'], resolved.tokens['--on-primary']) >= 4.5);
      assert.equal('--danger' in resolved.tokens, false);
      assert.equal('--green' in resolved.tokens, false);
    }
  }
});

test('bootstrap installs palette and accent before its first theme attribute write', () => {
  const bootstrap = readFileSync(new URL('../public/theme-bootstrap.js', import.meta.url), 'utf8');
  for (const theme of themes) {
    const colors = resolveTheme(theme.id, false, '#00ffff');
    const properties = new Map<string, string>();
    let observed: unknown;
    const dataset = new Proxy({} as Record<string, string>, {
      set(target, key: string, value: string) {
        target[key] = value;
        if (key === 'theme') observed = { palette: target.palette, bg: properties.get(`--theme-${value}-bg`), primary: properties.get(`--theme-${value}-primary`) };
        return true;
      },
    });
    runInNewContext(bootstrap, {
      window: { desktopTheme: { resolved: colors.scheme, palette: colors.id, tokens: colors.tokens } },
      document: { documentElement: { dataset, style: { setProperty: (key: string, value: string) => properties.set(key, value) } } },
    });
    assert.deepEqual(observed, { palette: theme.id, bg: theme.bg, primary: colors.tokens['--primary'] });
  }
});

test('auxiliary windows apply trusted plugin tokens without registering a plugin, and fully reset on switch', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const properties = new Map<string, string>();
  const root = { dataset: {} as Record<string, string>, style: {
    setProperty: (key: string, value: string) => properties.set(key, value),
    removeProperty: (key: string) => properties.delete(key),
  } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true,
    value: (callback: () => void) => { callback(); return 1; } });
  try {
    assert.equal(normalizeTheme('plugin:stellar-cruise'), 'system', 'this window has no plugin registry');
    const colors = { ...resolveTheme('dark', false), id: 'plugin:stellar-cruise' as const,
      tokens: { ...resolveTheme('dark', false).tokens, '--bg': '#080d12', '--primary': '#9de5dd' } };
    applyResolvedTheme(colors);
    applyThemeMaterial('stellar');
    assert.equal(root.dataset.palette, 'plugin:stellar-cruise');
    assert.equal(root.dataset.themeMaterial, 'stellar');
    assert.equal(properties.get('--theme-dark-bg'), '#080d12');
    assert.equal(properties.get('--theme-dark-primary'), '#9de5dd');
    applyTheme('original-light', true);
    applyThemeMaterial();
    assert.equal(root.dataset.themeMaterial, undefined);
    assert.equal(root.dataset.palette, 'original-light');
    assert.equal(properties.get('--theme-light-bg'), '#ffffff');
    assert.equal(properties.has('--theme-dark-bg'), false);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (originalFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', originalFrame);
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  }
});
