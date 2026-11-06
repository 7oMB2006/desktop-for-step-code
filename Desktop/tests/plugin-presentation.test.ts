import assert from 'node:assert/strict';
import test from 'node:test';
import { pluginPresentation, pluginSourceLabel } from '../src/plugin-presentation';
import type { PluginPackage } from '../src/capabilities';

test('author locales select description and documents without changing identity or the source snapshot', () => {
  const pkg: PluginPackage = { ref: 'package', provenance: 'unknown', documentation: { readme: 'README.md', changelog: 'CHANGELOG.md' },
    tutorials: [], links: [], warnings: [], locales: {
      zh: { description: '中文介绍', documentation: { readme: 'README.zh-CN.md' } },
      en: { description: 'English introduction' },
    } };
  const plugin = { id: 'third-party', name: 'Project name', description: 'Original', package: pkg };
  const zh = pluginPresentation(plugin, 'zh');
  assert.equal(zh.description, '中文介绍');
  assert.equal(zh.name, 'Project name');
  assert.deepEqual(zh.package?.documentation, { readme: 'README.zh-CN.md', changelog: 'CHANGELOG.md' });
  assert.equal(pluginPresentation(plugin, 'en').description, 'English introduction');
  assert.equal(pkg.documentation.readme, 'README.md');
  assert.equal(plugin.description, 'Original');
});

test('legacy translations match exact copy, not a plugin identity or an arbitrary similar description', () => {
  const description = 'Browser automation and end-to-end testing MCP server by Microsoft. Drives web pages, takes screenshots, fills forms, clicks elements and runs automated browser test flows.';
  assert.match(pluginPresentation({ description }, 'zh').description!, /浏览器自动化/);
  assert.equal(pluginPresentation({ description }, 'en').description, description);
  assert.equal(pluginPresentation({ id: 'playwright', description: 'Third-party copy' }, 'zh').description, 'Third-party copy');
  assert.equal(pluginPresentation({ description: `${description} Extra capabilities.` }, 'zh').description, `${description} Extra capabilities.`);
});

test('source labels distinguish recorded, matched, ambiguous and unknown installations in both languages', () => {
  assert.equal(pluginSourceLabel({ marketplace: 'legacy-market' }, 'zh'), '市场 · legacy-market');
  assert.equal(pluginSourceLabel({ installationSource: { status: 'recorded', marketplaces: ['removed-market'] } }, 'en'), 'Marketplace · removed-market');
  assert.equal(pluginSourceLabel({ installationSource: { status: 'matched', marketplaces: ['builtin'] } }, 'zh'), '匹配市场 · builtin');
  assert.equal(pluginSourceLabel({ installationSource: { status: 'matched', marketplaces: ['a', 'b'] } }, 'en'), 'Matching marketplace · a / b');
  assert.equal(pluginSourceLabel({}, 'zh'), '来源未确认');
  assert.equal(pluginSourceLabel({ installationSource: { status: 'unknown', marketplaces: [] } }, 'en'), 'Source unconfirmed');
  assert.equal(pluginSourceLabel({ marketplace: 'old', installationSource: { status: 'conflict', marketplaces: ['a'] } }, 'zh'), '来源冲突');
});
