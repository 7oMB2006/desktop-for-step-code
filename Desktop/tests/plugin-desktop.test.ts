import assert from 'node:assert/strict';
import test from 'node:test';
import type { CapabilityCatalog, CapabilityPlugin, PluginDesktop } from '../src/capabilities';
import { getPluginDesktopEntries, pluginActionLayout, pluginDesktopDefaultPage, pluginDesktopIconUrl } from '../src/plugin-desktop';

const desktop: PluginDesktop = {
  title: 'Engineering bridge', surface: 'main-view', symbol: 'bot', defaultPage: 'start',
  pages: [{ id: 'start', title: 'Start', document: 'docs/start.md' }, { id: 'setup', title: 'Setup', document: 'docs/setup.md' }],
};
const plugin = (id: string, provenance: 'recorded' | 'unknown' | 'conflict' = 'recorded'): CapabilityPlugin => ({
  id, name: id, mcpServers: [], warnings: [],
  package: { ref: `${id}-package`, provenance, desktop, documentation: {}, tutorials: [], links: [], warnings: [] },
});
const catalog = (plugins: CapabilityPlugin[]): CapabilityCatalog => ({
  plugins, available: [], marketplaces: [], mcp: [], skills: [], warnings: [],
});

test('desktop shortcuts only come from installed, recorded packages and use stable plugin identities', () => {
  const entries = getPluginDesktopEntries(catalog([plugin('bridge'), plugin('unknown', 'unknown'), plugin('conflict', 'conflict')]));
  assert.deepEqual(entries.map(entry => entry.id), ['bridge']);
  assert.equal(entries[0].plugin.package?.ref, 'bridge-package');
  assert.equal(entries[0].desktop, desktop);
});

test('one desktop entry is shown per installed plugin and unavailable packages do not appear', () => {
  const noDesktop = plugin('plain');
  delete noDesktop.package!.desktop;
  const noPages = plugin('empty');
  noPages.package = { ...noPages.package!, desktop: { ...desktop, pages: [] } };
  const entries = getPluginDesktopEntries(catalog([plugin('bridge'), plugin('bridge'), noDesktop, noPages,
    { id: 'legacy', name: 'Legacy', mcpServers: [], warnings: [] }]));
  assert.deepEqual(entries.map(entry => entry.id), ['bridge']);
});

test('a changing opaque package reference does not change shortcut identity', () => {
  const first = plugin('bridge');
  const second = { ...first, package: { ...first.package!, ref: 'new-opaque-reference' } };
  assert.equal(getPluginDesktopEntries(catalog([first]))[0].id, getPluginDesktopEntries(catalog([second]))[0].id);
});

test('the default document is declared by page ID, with a safe first-page fallback', () => {
  assert.equal(pluginDesktopDefaultPage(desktop).document, 'docs/start.md');
  assert.equal(pluginDesktopDefaultPage({ ...desktop, defaultPage: 'setup' }).document, 'docs/setup.md');
  assert.equal(pluginDesktopDefaultPage({ ...desktop, defaultPage: 'missing' }).id, 'start');
});

test('shortcut layout bounds titlebar growth and has no duplicate overflow entries', () => {
  const entries = getPluginDesktopEntries(catalog(Array.from({ length: 7 }, (_, index) => plugin(`entry-${index}`))));
  for (const [narrow, count] of [[false, 3], [true, 1]] as const) {
    const result = pluginActionLayout(entries, narrow);
    assert.equal(result.visible.length, count);
    assert.equal(result.overflow.length, 7 - count);
    assert.deepEqual([...result.visible, ...result.overflow], entries);
    assert.equal(new Set([...result.visible, ...result.overflow].map(entry => entry.id)).size, 7);
  }
  assert.equal(pluginActionLayout(entries, false, 100).visible.length, 3);
  assert.equal(pluginActionLayout(entries, false, 0).visible.length, 1);
  assert.equal(pluginActionLayout(entries, false, NaN).visible.length, 3);
});

test('titlebar custom icons only use host-projected raster data URLs', () => {
  const png = 'data:image/png;base64,aGVsbG8=';
  assert.equal(pluginDesktopIconUrl(png), png);
  for (const mime of ['jpeg', 'webp', 'x-icon']) {
    const image = `data:image/${mime};base64,aGVsbG8=`;
    assert.equal(pluginDesktopIconUrl(image), image);
  }
  for (const value of [undefined, '', 'https://example.test/icon.png', 'file:///C:/secret.png',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,%%%', 'javascript:alert(1)'])
    assert.equal(pluginDesktopIconUrl(value), undefined);
});
