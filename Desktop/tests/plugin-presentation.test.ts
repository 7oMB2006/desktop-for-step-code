import assert from 'node:assert/strict';
import test from 'node:test';
import { pluginCategoryLabel, pluginClassificationText, pluginPresentation, pluginSourceLabel } from '../src/plugin-presentation';
import type { PluginPackage } from '../src/capabilities';

test('eight category labels follow the UI language without guessing unknown classifications', () => {
  const zh = ['开发辅助', '搜索研究', '文本与文档', '知识管理', '音视频', '图像与设计', '效率自动化', '界面主题'];
  const en = ['Development', 'Search & research', 'Text & documents', 'Knowledge management', 'Audio & video', 'Images & design', 'Automation', 'Themes'];
  const ids = ['development', 'research', 'text-documents', 'knowledge', 'audio-video', 'image-design', 'automation', 'themes'];
  assert.deepEqual(ids.map(id => pluginCategoryLabel(id, 'zh')), zh);
  assert.deepEqual(ids.map(id => pluginCategoryLabel(id, 'en')), en);
  for (const id of ['future-category', 'constructor', 'toString', '__proto__'])
    assert.equal(pluginCategoryLabel(id, 'zh'), undefined);
});
test('classification search includes both category languages, stable IDs and original author keywords', () => {
  const pkg = { categories: ['research', 'audio-video', 'future-category'], keywords: ['语音转写', 'ASR'] };
  const text = pluginClassificationText(pkg);
  for (const term of ['research', '搜索研究', 'Search & research', 'audio-video', 'Audio & video', '音视频', 'future-category', '语音转写', 'ASR'])
    assert.ok(text.includes(term), term);
  assert.equal(pluginClassificationText(), '');
  assert.deepEqual(pkg.keywords, ['语音转写', 'ASR']);
});

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
