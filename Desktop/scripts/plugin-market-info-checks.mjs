import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { settleLayout } from './settle-layout.mjs';

export async function verifyPluginMarketInfo({ browser, base, output }) {
  await mkdir(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [], externalRequests = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/u.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin)
      externalRequests.push(request.url());
  });
  const url = `${base.replace(/\/$/u, '')}/tests/fixtures/plugin-center-live.html?metadata=1`;
  const card = name => page.locator('.pc-plugin-row').filter({ has: page.locator('.pc-card-heading strong', { hasText: new RegExp(`^${name}$`, 'u') }) });
  const guide = name => page.getByRole('button', { name: new RegExp(`^(?:查看 ${name} 使用说明|Read ${name} guide)$`, 'u') });
  const assertAuthor = async (scope, name, language = 'zh') => {
    const author = scope.locator('.pc-market-author');
    assert.equal((await author.innerText()).trim(), name);
    assert.equal(await author.getAttribute('role'), 'group');
    assert.equal(await author.getAttribute('aria-label'), language === 'zh' ? `作者：${name}` : `Author: ${name}`);
  };
  const requirements = page.locator('.pc-install-requirements');
  const back = () => page.getByRole('button', { name: /^(?:全部插件|All plugins)$/u }).click();
  const popover = () => page.locator('.pc-requirements-popover');
  const cardBoxes = () => page.locator('.pc-plugin-row').evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const assertNoOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(await page.locator('.pc-plugin-row,.pc-card-requirements,.pc-install-requirements,.pc-requirement-facts,.pc-requirements-popover').evaluateAll(elements =>
      elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), []);
  };
  const assertUnifiedRequirementChips = async () => {
    const rows = await page.locator('.pc-card-requirements').evaluateAll(elements => elements.map(element => {
      const version = element.querySelector('.pc-version-requirement'), dependency = element.querySelector('.pc-extra-requirement');
      const common = node => {
        const style = getComputedStyle(node);
        return Object.fromEntries(['minHeight', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius',
          'borderBottomLeftRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap']
          .map(property => [property, style[property]]));
      };
      return {
        version: common(version), dependency: common(dependency),
        fontFamily: getComputedStyle(version).fontFamily,
        inner: [...version.querySelectorAll('.pc-requirement-label,.pc-version-verdict,code')].map(node => {
          const style = getComputedStyle(node);
          return { tag: node.tagName, className: node.className, fontFamily: style.fontFamily,
            border: ['Top', 'Right', 'Bottom', 'Left'].map(side => style[`border${side}Width`]),
            padding: ['Top', 'Right', 'Bottom', 'Left'].map(side => style[`padding${side}`]),
            backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
        }),
      };
    }));
    for (const row of rows) {
      assert.deepEqual(row.version, row.dependency, 'version and dependency chips share their base dimensions and spacing');
      assert.ok(parseFloat(row.version.minHeight) > 0, 'requirement chips retain a stable minimum height');
      for (const inner of row.inner) {
        assert.deepEqual(inner.border, ['0px', '0px', '0px', '0px'], `${inner.className || inner.tag}: no internal segment borders`);
        assert.deepEqual(inner.padding, ['0px', '0px', '0px', '0px'], `${inner.className || inner.tag}: no internal segment padding`);
        assert.equal(inner.backgroundColor, 'rgba(0, 0, 0, 0)', `${inner.className || inner.tag}: no internal segment background`);
        assert.equal(inner.backgroundImage, 'none');
        if (inner.tag === 'CODE') assert.equal(inner.fontFamily, row.fontFamily, 'version ranges inherit the chip font instead of a code box');
      }
    }
  };
  const assertFocusOutline = async (control, context) => {
    assert.equal(await control.evaluate(element => element === document.activeElement && element.matches(':focus-visible')), true,
      `${context}: keyboard focus is visible`);
    await settleLayout(control);
    const clips = await control.evaluate(element => {
      const rect = element.getBoundingClientRect(), css = getComputedStyle(element);
      const extent = Math.max(0, parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset));
      const failures = [];
      if (rect.left - extent < 0 || rect.right + extent > innerWidth
        || rect.top - extent < 0 || rect.bottom + extent > innerHeight) failures.push('viewport');
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/u.test(style.overflowX)
          && (rect.left - extent < box.left + parent.clientLeft - 1 || rect.right + extent > box.left + parent.clientLeft + parent.clientWidth + 1))
          failures.push(`${parent.className}:x`);
        if (/(hidden|clip|auto|scroll)/u.test(style.overflowY)
          && (rect.top - extent < box.top + parent.clientTop - 1 || rect.bottom + extent > box.top + parent.clientTop + parent.clientHeight + 1))
          failures.push(`${parent.className}:y`);
      }
      return failures;
    });
    assert.deepEqual(clips, [], `${context}: full focus outline`);
  };
  const openDependencies = async (row, language) => {
    const trigger = row.locator('.pc-extra-requirement');
    assert.equal(await trigger.evaluate(element => element.tagName === 'BUTTON' && !element.closest('.pc-card-open')), true,
      'dependency disclosure is an independent button, never nested inside the guide button');
    assert.equal(await trigger.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await trigger.scrollIntoViewIfNeeded();
    await settleLayout(row);
    const before = await cardBoxes();
    await trigger.click();
    const panel = popover();
    await panel.waitFor({ state: 'visible' });
    await settleLayout(panel);
    assert.equal(await panel.getAttribute('role'), 'dialog');
    assert.equal(await panel.getAttribute('id'), await trigger.getAttribute('aria-controls'));
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await panel.evaluate(element => element.matches(':popover-open')), true, 'dependency dialog uses the native top layer');
    await panel.getByText(language === 'zh' ? '额外准备' : 'Extra requirements', { exact: true }).waitFor();
    await panel.getByText(language === 'zh' ? '作者声明 · 未检测本机环境'
      : 'Author declarations · Local environment not checked', { exact: true }).waitFor();
    assert.deepEqual(await cardBoxes(), before, 'opening a dependency dialog does not resize or move cards');
    assert.equal(await page.locator('.pc-detail:visible').count(), 0, 'dependency disclosure does not open the plugin detail');
    assert.equal(await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    }), true, 'dependency dialog stays inside the viewport');
    await assertNoOverflow();
    return { trigger, panel };
  };
  const assertClosed = async trigger => {
    await popover().waitFor({ state: 'hidden' });
    const id = await trigger.getAttribute('aria-controls');
    await page.waitForFunction(id => {
      const button = [...document.querySelectorAll('.pc-extra-requirement')]
        .find(element => element.getAttribute('aria-controls') === id);
      return button?.getAttribute('aria-expanded') === 'false';
    }, id);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.pc-requirements-popover:popover-open').count(), 0);
  };
  try {
    await page.goto(url);
    await guide('资源工具包').waitFor();
    await settleLayout(page.locator('.pc-catalog-page'));
    await assertAuthor(card('资源工具包'), '示例资源贡献者');
    assert.equal(await card('资源工具包').locator('[data-version-status=matches]').count(), 1);
    assert.equal((await card('资源工具包').locator('.pc-extra-requirement').innerText()).trim(), '无额外依赖');
    assert.equal(await card('资源工具包').locator('.pc-card-requirements .pc-requirement-chip').count(), 2);
    assert.doesNotMatch(await card('资源工具包').locator('.pc-version-requirement').innerText(), /版本符合/u);
    assert.match(await card('资源工具包').locator('.pc-version-requirement').getAttribute('aria-label'), /版本符合[\s\S]*仅比较 DFSC 版本/u);
    assert.match(await card('新版本工程工具').innerText(), /版本不符[\s\S]*额外准备 2 项/u);
    await assertAuthor(card('旧版插件'), '未声明');
    assert.match(await card('旧版插件').innerText(), /版本要求未声明[\s\S]*额外依赖未声明/u);
    assert.equal(await card('仅版本声明').locator('[data-version-status=matches]').count(), 1);
    assert.match(await card('仅版本声明').innerText(), /额外依赖未声明/u);
    assert.match(await card('资源工具包').locator('.pc-stars').getAttribute('aria-label'), /128/u);
    assert.equal(await page.locator('.pc-plugin-row .pc-downloads').count(), 0);
    assert.equal(await page.locator('.pc-card-open .pc-extra-requirement').count(), 0);
    await assertUnifiedRequirementChips();
    checks.push('authors, quiet matching versions, distinct dependency declarations and stars without unavailable card downloads');

    const search = page.getByRole('textbox', { name: '搜索插件', exact: true });
    await search.fill('示例资源贡献者');
    assert.equal(await page.locator('.pc-plugin-row').count(), 1);
    await search.fill('可选媒体转换工具');
    assert.equal(await page.locator('.pc-plugin-row').count(), 1);
    assert.equal(await card('新版本工程工具').count(), 1);
    await search.fill('');
    checks.push('search includes author and declared dependencies');

    await page.getByRole('tab', { name: '发现', exact: true }).click();
    assert.match(await card('资源工具包').locator('.pc-card-version').innerText(), /^v2.0.0[\s\S]*已安装 v1.0.0/u);
    await assertAuthor(card('资源工具包'), '市场新版作者');
    assert.match(await card('资源工具包').innerText(), /版本不符[\s\S]*需准备 1 项/u);
    await guide('资源工具包').click();
    await requirements.waitFor();
    assert.match(await page.locator('.pc-plugin-title').innerText(), /v2.0.0[\s\S]*已安装 v1.0.0[\s\S]*市场新版作者/u);
    await assertAuthor(page.locator('.pc-plugin-title'), '市场新版作者');
    assert.match(await requirements.innerText(), />=99.0.0[\s\S]*版本不符[\s\S]*新版运行组件/u);
    await page.getByRole('heading', { name: '市场新版使用说明', exact: true }).waitFor();
    await back();
    await page.getByRole('tab', { name: /^已安装/u }).click();
    await guide('资源工具包').click();
    assert.match(await page.locator('.pc-plugin-title').innerText(), /v1.0.0[\s\S]*示例资源贡献者/u);
    await assertAuthor(page.locator('.pc-plugin-title'), '示例资源贡献者');
    assert.equal(await requirements.locator('[data-version-status=matches]').count(), 1);
    assert.doesNotMatch(await requirements.locator('.pc-version-requirement').innerText(), /版本符合/u);
    assert.match(await requirements.innerText(), /作者声明无需额外依赖/u);
    assert.equal(await requirements.locator('.pc-downloads').getAttribute('aria-label'), '下载量：暂无统计');
    checks.push('Discover candidate version, author, requirements and document stay separate from the installed copy');
    await back();

    await card('新版本工程工具').getByRole('button', { name: '配置 新版本工程工具', exact: true }).click();
    await page.getByRole('tab', { name: '配置', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: '配置', exact: true }).getAttribute('aria-selected'), 'true');
    await requirements.waitFor({ state: 'hidden' });
    await page.getByRole('tabpanel', { name: '配置', exact: true }).waitFor();
    await page.getByRole('tab', { name: '使用说明', exact: true }).click();
    await requirements.waitFor({ state: 'visible' });
    assert.equal(await requirements.evaluate(element => element.closest('[role=tabpanel]')?.getAttribute('aria-labelledby')
      ?.endsWith('-detail-about')), true, 'long requirement declarations belong to the guide, never above configuration navigation');
    checks.push('configuration shortcuts bypass the long requirement list; guide owns the complete declaration');
    await back();

    await guide('依赖链接验证').click();
    assert.equal(await requirements.getByRole('link').count(), 1);
    const safe = requirements.getByRole('link', { name: '打开 安全 HTTPS 文档 说明', exact: true });
    assert.equal(await safe.getAttribute('href'), 'https://nodejs.org/en/download');
    assert.equal(await safe.getAttribute('rel'), 'noopener noreferrer');
    checks.push('malicious dependency URLs stay non-interactive');
    await back();

    const safeDisclosure = await openDependencies(card('依赖链接验证'), 'zh');
    assert.equal(await safeDisclosure.panel.locator('.pc-external-requirements li').count(), 5);
    assert.equal(await safeDisclosure.panel.getByRole('link').count(), 1);
    assert.equal(await safeDisclosure.panel.getByRole('link').getAttribute('href'), 'https://nodejs.org/en/download');
    assert.equal(await safeDisclosure.panel.getByRole('link').getAttribute('rel'), 'noopener noreferrer');
    await page.keyboard.press('Escape');
    await assertClosed(safeDisclosure.trigger);
    assert.equal(await safeDisclosure.trigger.evaluate(element => element === document.activeElement), true);
    await openDependencies(card('依赖链接验证'), 'zh');
    await safeDisclosure.trigger.click();
    await assertClosed(safeDisclosure.trigger);
    await openDependencies(card('依赖链接验证'), 'zh');
    await page.locator('.pc-preview-label').click();
    await assertClosed(safeDisclosure.trigger);
    await openDependencies(card('依赖链接验证'), 'zh');
    await search.focus();
    await assertClosed(safeDisclosure.trigger);
    for (const [name, explanation] of [['资源工具包', '作者声明无需额外依赖。'], ['旧版插件', '作者尚未声明，请核对使用说明。']]) {
      const disclosure = await openDependencies(card(name), 'zh');
      await disclosure.panel.getByText(explanation, { exact: true }).waitFor();
      assert.equal(await disclosure.panel.locator('.pc-external-requirements li').count(), 0);
      await disclosure.panel.getByRole('button', { name: '关闭额外准备', exact: true }).click();
      await assertClosed(disclosure.trigger);
    }
    checks.push('dependency dialogs filter unsafe links, explain empty versus missing declarations, and close on Escape, repeated activation, outside click, focus departure and explicit close');

    for (const language of ['zh', 'en']) {
      if (language === 'en') await page.getByRole('button', { name: '切换为英文', exact: true }).click();
      await assertAuthor(card('资源工具包'), '示例资源贡献者', language);
      await assertAuthor(card('旧版插件'), language === 'zh' ? '未声明' : 'Not declared', language);
      for (const theme of ['light', 'dark']) {
        if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme)
          await page.getByRole('button', { name: language === 'zh' ? '切换明暗主题' : 'Toggle light and dark', exact: true }).click();
        for (const [width, height] of [[1440, 980], [900, 820], [390, 844]]) {
          await page.setViewportSize({ width, height });
          await page.emulateMedia({ reducedMotion: width < 700 ? 'reduce' : 'no-preference' });
          await settleLayout(page.locator('.pc-catalog-page'));
          await assertNoOverflow();
          await assertUnifiedRequirementChips();
          await page.screenshot({ path: `${output}/catalog-${language}-${theme}-${width}.png` });
          const disclosure = await openDependencies(card('新版本工程工具'), language);
          assert.equal(await disclosure.panel.locator('.pc-external-requirements li').count(), 2);
          const kinds = await disclosure.panel.locator('.pc-requirement-kind').allTextContents();
          assert.deepEqual(kinds, language === 'zh' ? ['必需', '可选'] : ['Required', 'Optional']);
          assert.deepEqual(await disclosure.panel.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))),
            ['https://nodejs.org/', 'https://ffmpeg.org/download.html']);
          const popoverLink = disclosure.panel.getByRole('link').first();
          await popoverLink.focus();
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
          await assertFocusOutline(popoverLink, `${language}/${theme}/${width}: popover dependency link`);
          await page.screenshot({ path: `${output}/requirements-popover-${language}-${theme}-${width}.png` });
          await page.keyboard.press('Escape');
          await assertClosed(disclosure.trigger);
          await assertFocusOutline(disclosure.trigger, `${language}/${theme}/${width}: restored dependency trigger`);
          await guide('新版本工程工具').click();
          await settleLayout(requirements);
          await assertNoOverflow();
          assert.match(await requirements.innerText(), language === 'zh' ? /必需[\s\S]*可选/u : /Required[\s\S]*Optional/u);
          const link = requirements.getByRole('link').first();
          await link.focus();
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
          await assertFocusOutline(link, `${language}/${theme}/${width}: detail dependency link`);
          await page.screenshot({ path: `${output}/detail-${language}-${theme}-${width}.png` });
          await back();
          checks.push(`${language}/${theme}/${width}: unified non-segmented requirement chips, anchored native dependency dialog, no card layout shift, exact required/optional details, Escape focus return, wrapping and complete focus outlines`);
        }
      }
    }
    const scrollingDisclosure = await openDependencies(card('资源工具包'), 'en');
    const list = page.locator('.pc-plugin-list');
    assert.equal(await list.evaluate(element => {
      const before = element.scrollTop;
      element.scrollTop = before > 30 ? before - 30 : before + 30;
      return element.scrollTop !== before;
    }), true, 'the narrow catalog performs a real scroll');
    await assertClosed(scrollingDisclosure.trigger);
    await page.setViewportSize({ width: 1440, height: 980 });
    await settleLayout(page.locator('.pc-catalog-page'));
    const hiddenDisclosure = await openDependencies(card('资源工具包'), 'en');
    await page.getByRole('button', { name: 'Back to conversation', exact: true }).evaluate(element => element.click());
    await page.locator('.plugin-center').waitFor({ state: 'hidden' });
    await popover().waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '插件市场', exact: true }).click();
    await guide('资源工具包').waitFor();
    assert.equal(await hiddenDisclosure.trigger.getAttribute('aria-expanded'), 'false');
    await guide('资源工具包').click();
    await page.getByRole('button', { name: 'Uninstall plugin', exact: true }).click();
    await page.locator('.pc-dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await card('资源工具包').waitFor({ state: 'detached' });
    assert.equal(await popover().count(), 0, 'uninstall leaves no orphaned native dependency dialog');
    checks.push('real narrow catalog scrolling and deactivating the center close dependency dialogs; UI uninstall leaves no orphaned disclosure');
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    checks.push('zero renderer errors and zero external or model requests');
    await writeFile(`${output}/verification.json`, JSON.stringify({ passed: true, checks, errors, externalRequests }, null, 2));
    console.log(`Plugin marketplace information passed ${checks.length} checks.`);
  } finally { await page.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'dfsc-market-info-'));
  let server, browser;
  try {
    if (!process.env.DESKTOP_PREVIEW_URL) {
      server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn' });
      await server.listen();
    }
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    await verifyPluginMarketInfo({
      browser, base: process.env.DESKTOP_PREVIEW_URL || server.resolvedUrls.local[0],
      output: process.env.DESKTOP_PREVIEW_OUTPUT || 'test-results/plugin-market-info',
    });
  } finally {
    await browser?.close(); await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
}
