import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { contrastRatio, normalizeAccent, normalizeTheme, resolveTheme, themePreferencePatch, themes } from '../src/theme';

test('six themes, system compatibility and safe preference validation', () => {
  assert.deepEqual(themes.map(theme => theme.id), ['light', 'paper', 'dark', 'blue', 'wine', 'jade']);
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
