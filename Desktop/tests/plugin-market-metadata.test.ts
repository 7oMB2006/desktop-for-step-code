import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import {
  PluginAuthor, PluginCardRequirements, PluginDownloads, PluginExternalRequirementSummary,
  PluginRequirements, PluginVersionRequirement,
} from '../src/PluginMarketplaceMetadata';
import { pluginMarketplaceSearchText, pluginVersionStatus } from '../src/plugin-market-metadata';
import type { PluginPackage } from '../src/capabilities';

const pkg = (requirements?: PluginPackage['requirements']): PluginPackage => ({
  ref: 'fixture', provenance: 'recorded', documentation: {}, tutorials: [], links: [], warnings: [], requirements,
});

test('version comparison follows semantic ranges without claiming environment readiness', () => {
  assert.equal(pluginVersionStatus(undefined, '0.6.0'), 'undeclared');
  assert.equal(pluginVersionStatus('>=0.6.0', undefined), 'unknown');
  assert.equal(pluginVersionStatus('>=0.6.0', 'development-build'), 'unknown');
  assert.equal(pluginVersionStatus('>=0.6.0 <1', '0.6.0'), 'matches');
  assert.equal(pluginVersionStatus('>=0.7.0', '0.6.0'), 'mismatch');
  assert.equal(pluginVersionStatus('^0.6.0', '0.7.0'), 'mismatch');
  assert.equal(pluginVersionStatus('>=0.6.0', '0.7.0-beta.1'), 'mismatch');
  assert.equal(pluginVersionStatus('>=0.7.0-beta.1 <0.7.0', '0.7.0-beta.2'), 'matches');
  for (const range of ['', '   ', 'not-semver', 'a'.repeat(129)])
    assert.equal(pluginVersionStatus(range, '0.6.0'), 'invalid');
});

test('metadata search includes declared authors, adapter and named external requirements', () => {
  assert.equal(pluginMarketplaceSearchText(), '');
  const text = pluginMarketplaceSearchText({ ...pkg({ dfsc: '>=0.6.0',
    external: [{ name: 'Python', description: 'Local interpreter' }] }), author: 'Original author', maintainer: 'Adapter' });
  for (const term of ['Original author', 'Adapter', 'Python', 'Local interpreter', '>=0.6.0']) assert.ok(text.includes(term));
});

test('undeclared external dependencies differ from an explicit author declaration of none', () => {
  for (const language of ['zh', 'en']) {
    const missing = renderToStaticMarkup(createElement(PluginCardRequirements, { language, pkg: pkg() }));
    const none = renderToStaticMarkup(createElement(PluginCardRequirements, { language, pkg: pkg({ external: [] }) }));
    const missingChip = parseHTML(missing).document.querySelector('.pc-extra-requirement')!;
    const noneChip = parseHTML(none).document.querySelector('.pc-extra-requirement')!;
    assert.equal(missingChip.textContent?.trim(), language === 'zh' ? '额外依赖未声明' : 'Extra requirements not declared');
    assert.equal(noneChip.textContent?.trim(), language === 'zh' ? '无额外依赖' : 'No extra requirements');
    for (const chip of [missingChip, noneChip]) {
      assert.match(chip.getAttribute('aria-label') ?? '', language === 'zh' ? /作者声明/ : /Author declarations/);
      assert.match(chip.getAttribute('aria-label') ?? '', language === 'zh' ? /未检测本机环境/ : /Local environment not checked/);
    }
  }
  const { document } = parseHTML(renderToStaticMarkup(createElement(PluginCardRequirements, {
    language: 'zh', pkg: pkg({ external: [{ name: 'Hermes' }, { name: 'Channel', optional: true }] }),
  })));
  assert.equal(document.querySelector('.pc-extra-requirement')?.textContent, '额外准备 2 项');
});

test('card requirements pair a quiet version chip with an independent dependency-dialog button', () => {
  const { document } = parseHTML(renderToStaticMarkup(createElement(PluginCardRequirements, {
    language: 'zh', currentVersion: '0.6.0', pkg: pkg({ dfsc: '>=0.6.0 <1', external: [] }),
  })));
  assert.equal(document.querySelectorAll('.pc-card-requirements .pc-requirement-chip').length, 2);
  const version = document.querySelector('.pc-version-requirement')!;
  assert.equal(version.getAttribute('data-version-status'), 'matches');
  assert.match(version.querySelector('.pc-requirement-label')?.textContent ?? '', /DFSC[\s\S]*>=0.6.0 <1/);
  assert.equal(version.querySelectorAll('.pc-requirement-label svg').length, 1);
  assert.equal(version.querySelectorAll('.pc-requirement-label .lucide-monitor').length, 1);
  assert.equal(version.querySelectorAll('.pc-version-verdict').length, 0);
  assert.doesNotMatch(version.textContent ?? '', /版本符合/);
  assert.equal(document.querySelectorAll('.pc-extra-requirement svg.lucide').length, 1);
  const trigger = document.querySelector('.pc-extra-requirement')!;
  assert.equal(trigger.tagName, 'BUTTON');
  assert.equal(trigger.getAttribute('type'), 'button');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.ok(trigger.getAttribute('aria-controls'));
  assert.equal(trigger.querySelectorAll('button,a,input,select').length, 0);
  assert.equal(document.querySelectorAll('.pc-downloads').length, 0);
  assert.doesNotMatch(document.querySelector('.pc-extra-requirement')?.textContent ?? '', /（作者声明）/);
});

test('cards and details keep a matching version quiet without treating it as overall compatibility', () => {
  for (const Component of [PluginCardRequirements, PluginRequirements]) {
    const { document } = parseHTML(renderToStaticMarkup(createElement(Component, {
      language: 'zh', currentVersion: '0.6.0', pkg: pkg({ dfsc: '>=0.6.0', external: [] }),
    })));
    const version = document.querySelector('.pc-version-requirement')!;
    assert.doesNotMatch(version.textContent ?? '', /版本符合/);
    assert.doesNotMatch(version.textContent ?? '', /可派工|就绪|已兼容/);
    assert.equal(version.getAttribute('data-version-status'), 'matches');
    for (const attribute of ['aria-label', 'data-tooltip']) {
      assert.match(version.getAttribute(attribute) ?? '', /版本符合/);
      assert.match(version.getAttribute(attribute) ?? '', /仅比较 DFSC 版本，不代表依赖或服务已就绪/);
    }
  }
});

test('standalone version chips keep all localized verdicts and are shared by the detail view', () => {
  const cases = [
    { range: undefined, version: '0.6.0', status: 'undeclared', zh: '版本要求未声明', en: 'Version requirement not declared', icon: 'circle-help' },
    { range: 'not-semver', version: '0.6.0', status: 'invalid', zh: '版本要求无效', en: 'Invalid version requirement', icon: 'circle-alert' },
    { range: '>=0.6.0', version: undefined, status: 'unknown', zh: '当前版本未确认', en: 'Current version unconfirmed', icon: 'circle-help' },
    { range: '>=0.6.0', version: '0.6.0', status: 'matches', zh: '版本符合', en: 'Version matches', icon: 'monitor' },
    { range: '>=0.7.0', version: '0.6.0', status: 'mismatch', zh: '版本不符', en: 'Version mismatch', icon: 'circle-alert' },
  ] as const;
  for (const language of ['zh', 'en'] as const) for (const item of cases) {
    const props = { language, currentVersion: item.version, pkg: pkg({ dfsc: item.range }) };
    const standalone = parseHTML(renderToStaticMarkup(createElement(PluginVersionRequirement, props))).document;
    const chip = standalone.querySelector('.pc-requirement-chip.pc-version-requirement')!;
    assert.equal(chip.getAttribute('data-version-status'), item.status);
    assert.equal(chip.querySelectorAll('svg').length, 1);
    assert.equal(chip.querySelectorAll(`.pc-requirement-label .lucide-${item.icon}`).length, 1);
    if (item.status === 'matches') {
      assert.equal(chip.querySelectorAll('.pc-version-verdict').length, 0);
      assert.doesNotMatch(chip.textContent ?? '', /版本符合|Version matches/);
    } else {
      assert.equal(chip.querySelector('.pc-version-verdict')?.textContent, item[language]);
      assert.equal(chip.querySelectorAll('.pc-version-verdict svg').length, 0);
    }
    assert.equal(chip.querySelector('code')?.textContent, item.range);
    for (const attribute of ['aria-label', 'data-tooltip']) {
      const declaration = chip.getAttribute(attribute) ?? '';
      assert.ok(declaration.includes(item[language]));
      assert.ok(declaration.includes(language === 'zh'
        ? '仅比较 DFSC 版本，不代表依赖或服务已就绪'
        : 'DFSC version comparison only; dependencies and services have not been checked'));
    }
    const detail = parseHTML(renderToStaticMarkup(createElement(PluginRequirements, props))).document;
    assert.equal(detail.querySelector('.pc-version-fact > .pc-version-requirement')?.outerHTML, chip.outerHTML);
    assert.equal(detail.querySelector('.pc-current-version')?.textContent,
      item.version ? `${language === 'zh' ? '当前' : 'Current'} ${item.version}` : undefined);
  }
});

test('standalone dependency chips retain declaration boundaries for missing, empty and named requirements', () => {
  const cases = [
    { requirements: undefined, zh: '额外依赖未声明', en: 'Extra requirements not declared' },
    { requirements: { external: [] }, zh: '无额外依赖', en: 'No extra requirements' },
    { requirements: { external: [{ name: 'Hermes' }, { name: 'Channel', optional: true }] },
      zh: '额外准备 2 项', en: '2 extra requirements' },
    { requirements: { external: [{ name: 'Hermes' }] }, zh: '需准备 1 项', en: '1 extra requirement' },
    { requirements: { external: [{ name: 'Channel', optional: true }] }, zh: '可选 1 项', en: '1 optional' },
  ];
  for (const language of ['zh', 'en'] as const) for (const item of cases) {
    const { document } = parseHTML(renderToStaticMarkup(createElement(PluginExternalRequirementSummary, {
      language, pkg: pkg(item.requirements),
    })));
    const chip = document.querySelector('.pc-requirement-chip.pc-extra-requirement')!;
    assert.equal(chip.textContent, item[language]);
    assert.equal(chip.tagName, 'BUTTON');
    assert.equal(chip.getAttribute('type'), 'button');
    assert.equal(chip.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(chip.getAttribute('aria-expanded'), 'false');
    assert.ok(chip.getAttribute('aria-controls'));
    assert.equal(chip.getAttribute('aria-label'), `${language === 'zh'
      ? '作者声明 · 未检测本机环境' : 'Author declarations · Local environment not checked'} · ${item[language]}`);
    assert.equal(chip.querySelectorAll('svg.lucide').length, 1);
    assert.equal(chip.querySelectorAll('button,a,input,select').length, 0);
  }
});

test('external links are credential-free HTTPS only and declarations render as plain text', () => {
  const { document } = parseHTML(renderToStaticMarkup(createElement(PluginRequirements, {
    language: 'en', pkg: pkg({ external: [
      { name: '<script>not executable</script>', description: '<img src=tracker>', url: 'https://example.com/setup' },
      ...['javascript:alert(1)', 'file:///C:/secret', 'http://example.com', 'https://user:secret@example.com']
        .map(url => ({ name: 'Unsafe', url })),
    ] }),
  })));
  assert.equal(document.querySelectorAll('a').length, 1);
  assert.equal(document.querySelector('a')?.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(document.querySelector('a')?.getAttribute('href'), 'https://example.com/setup');
  assert.equal(document.querySelectorAll('script,img').length, 0);
  assert.match(document.textContent ?? document.documentElement?.textContent ?? '', /not executable/);
});

test('unknown author does not fall back to adapter or source owner', () => {
  for (const language of ['zh', 'en']) {
    const { document } = parseHTML(renderToStaticMarkup(createElement(PluginAuthor, {
      language, pkg: { ...pkg(), maintainer: 'Not the author' },
    })));
    const author = document.querySelector('.pc-market-author')!;
    const name = language === 'zh' ? '未声明' : 'Not declared';
    assert.equal(author.textContent?.trim(), name);
    assert.equal(author.getAttribute('role'), 'group');
    assert.equal(author.getAttribute('aria-label'), language === 'zh' ? `作者：${name}` : `Author: ${name}`);
    assert.doesNotMatch(author.textContent ?? '', /Not the author/);
  }
});

test('declared author displays only the name while keeping the localized accessible label', () => {
  for (const language of ['zh', 'en']) {
    const name = '<script>Original author</script>';
    const { document } = parseHTML(renderToStaticMarkup(createElement(PluginAuthor, {
      language, pkg: { ...pkg(), author: name, maintainer: 'Different adapter' },
    })));
    const author = document.querySelector('.pc-market-author')!;
    assert.equal(author.textContent?.trim(), name);
    assert.equal(author.getAttribute('role'), 'group');
    assert.equal(author.getAttribute('aria-label'), language === 'zh' ? `作者：${name}` : `Author: ${name}`);
    assert.equal(document.querySelectorAll('script').length, 0);
    assert.doesNotMatch(author.textContent ?? '', /Different adapter/);
  }
});

test('downloads show an explicit absence of statistics, never invented zero or star counts', () => {
  for (const language of ['zh', 'en']) {
    const html = renderToStaticMarkup(createElement(PluginDownloads, { language }));
    assert.match(html, language === 'zh' ? /下载量：暂无统计/ : /Downloads: no statistics/);
    assert.doesNotMatch(html, />0<|Stars|GitHub/);
  }
});
