import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dataOnlyThemeFingerprint, packageFingerprint } from '../electron/plugin-files.mjs';
import { PluginLibrary, parsePresentation } from '../electron/plugin-library.mjs';
import type { CapabilityCatalog } from '../src/capabilities';

test('the source Stellar theme is a data-only package with readable offline documents', async () => {
  const root = await realpath(resolve('../theme-marketplace/plugins/stellar-cruise'));
  const fingerprint = await dataOnlyThemeFingerprint(root, 'stellar-cruise');
  assert.match(fingerprint!, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint, await packageFingerprint(root));
  const manifest = JSON.parse(await readFile(join(root, 'step.plugin.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.0');
  const presentation = parsePresentation(JSON.parse(await readFile(join(root, 'dfsc.plugin.json'), 'utf8')));
  assert.equal(presentation.author, '7oMB2006');
  assert.deepEqual(presentation.requirements, { dfsc: '^1.0.0', external: [] });
  assert.deepEqual(presentation.documentation, { readme: 'README.md', changelog: 'CHANGELOG.md' });
  const library = new PluginLibrary(await realpath(resolve(root, '../..')));
  const catalog = { plugins: [{ id: manifest.id, name: manifest.name, version: manifest.version, mcpServers: [], warnings: [],
    packageDescriptor: { root, fingerprint, id: manifest.id, kind: 'installed', provenance: 'recorded', name: manifest.name } }],
    available: [], marketplaces: [], mcp: [], skills: [], warnings: [] } as unknown as CapabilityCatalog;
  const pack = (await library.project(catalog)).plugins[0].package!;
  assert.deepEqual(pack.warnings, []);
  const readme = await library.document({ ref: pack.ref, path: 'README.md' });
  assert.match(readme.images['cover.png'], /^data:image\/png;base64,/);
  assert.match(readme.text, /0\.2\.0/);
  assert.match((await library.document({ ref: pack.ref, path: 'CHANGELOG.md' })).text, /0\.2\.0/);
  await assert.rejects(library.document({ ref: pack.ref, path: 'scene.json' }), /invalid-path/);
});
