import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DESKTOP_PREVIEW_URL || 'http://127.0.0.1:5297';
const output = process.env.DESKTOP_PREVIEW_OUTPUT || 'test-results/plugin-center';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  const external = [];
  const projectPages = [];
  await page.context().route('https://github.com/**', async route => {
    assert.equal(route.request().isNavigationRequest(), true, 'project links must not fetch remote resources in the preview');
    projectPages.push(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Project link test</title>' });
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      external.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  const screenshot = async name => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${name}.png` });
  };
  const openProject = async (link, url) => {
    assert.equal(await link.getAttribute('href'), url);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /\bnoopener\b/);
    assert.match(await link.getAttribute('rel'), /\bnoreferrer\b/);
    const currentUrl = page.url();
    await page.keyboard.press('Tab');
    await focusVisible(link);
    const popupPromise = page.waitForEvent('popup');
    await link.press('Enter');
    const popup = await popupPromise;
    try {
      await popup.waitForURL(url);
      await popup.waitForLoadState();
      assert.equal(await popup.evaluate(() => window.opener === null), true, 'project pages cannot access the configuration window');
    } finally { await popup.close(); }
    assert.equal(page.url(), currentUrl, 'project links must leave the current preview open');
  };
  const chooseTheme = async label => {
    await page.getByRole('button', { name: '预览主题', exact: true }).click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    await page.locator('html').evaluate(async el => {
      await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
  };
  const stableSwitchSurface = async control => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(180);
    const rest = await control.evaluate(el => getComputedStyle(el).backgroundColor);
    await control.hover();
    await page.waitForTimeout(180);
    assert.equal(await control.evaluate(el => getComputedStyle(el).backgroundColor), rest, 'hover must preserve the switch track color');
    await page.mouse.down();
    try {
      assert.equal(await control.evaluate(el => getComputedStyle(el).backgroundColor), rest, 'pointer press must preserve the switch track color');
      await page.mouse.move(0, 0);
    } finally { await page.mouse.up(); }
  };
  const noOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const issues = await page.locator('.pc-detail,.pc-detail-inner,.pc-plugin-header,.pc-plugin-identity,.pc-plugin-summary,.pc-mode,.pc-api-services,.pc-api-service,.pc-api-fields,.pc-plugin-row,.pc-plugin-grid,.pc-catalog-toolbar,.pc-account-grid,.pc-detail-footer,.pc-window').evaluateAll(elements =>
      elements.filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1).map(el => el.className));
    assert.deepEqual(issues, [], 'plugin layout must not overflow');
  };
  const focusVisible = async field => {
    await field.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await field.focus();
    const result = await field.evaluate(el => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const issues = [];
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(css.overflowX)
          && (box.left - extent < rect.left - 1 || box.right + extent > rect.right + 1)) issues.push(`${parent.className}: horizontal`);
        if (/(hidden|clip|auto|scroll)/.test(css.overflowY)
          && (box.top - extent < rect.top - 1 || box.bottom + extent > rect.bottom + 1)) issues.push(`${parent.className}: vertical`);
      }
      return { outline: style.outlineStyle, extent, issues };
    });
    assert.equal(result.outline, 'solid');
    assert.ok(result.extent >= 4);
    assert.deepEqual(result.issues, [], 'complete focus indicator must stay within clipping ancestors');
  };
  const detailRoom = async () => {
    await page.locator('.pc-detail').evaluate(async el => {
      await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    const scroll = page.locator('.pc-detail-scroll');
    assert.equal(await scroll.evaluate(el => getComputedStyle(el).scrollbarWidth), 'none', 'hide the long native scrollbar');
    const available = await scroll.evaluate(el => ({ height: el.clientHeight, viewport: innerHeight }));
    assert.ok(available.height >= available.viewport - 180, 'detail scrolling must use the full workspace height');
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const geometry = await page.locator('.pc-detail').evaluate(el => {
      const box = selector => el.querySelector(selector).getBoundingClientRect();
      return {
        scrollTop: box('.pc-detail-scroll').top + parseFloat(getComputedStyle(el.querySelector('.pc-detail-scroll')).paddingTop),
        tabsTop: box('.pc-detail-tabs').top,
        tabsBottom: box('.pc-detail-tabs').bottom,
        titleBottom: box('.pc-plugin-header').bottom,
        backTop: box('.pc-detail-navigation').top,
        footerBottom: box('.pc-detail-footer').bottom,
        viewport: innerHeight,
      };
    });
    assert.ok(Math.abs(geometry.tabsTop - geometry.scrollTop) <= 1, 'detail tabs remain pinned while plugin metadata scrolls away');
    assert.ok(geometry.titleBottom <= geometry.tabsTop, 'plugin metadata must not permanently consume the editing area');
    assert.ok(geometry.backTop >= 45 && geometry.footerBottom <= geometry.viewport + 1, 'return and save actions remain visible');
    const scrollbar = page.getByRole('scrollbar', { name: '插件详情滚动', exact: true });
    await scrollbar.waitFor();
    const thumb = await scrollbar.locator('.conversation-scroll-thumb').boundingBox();
    assert.ok(thumb.height <= 44 && thumb.width <= 4, 'reuse the compact scroll thumb instead of a full-height handle');
    await scrollbar.press('Home');
    assert.equal(await scroll.evaluate(el => el.scrollTop), 0);
    await scrollbar.press('End');
    assert.ok(await scroll.evaluate(el => el.scrollTop >= el.scrollHeight - el.clientHeight - 1), 'compact scrollbar retains keyboard scrolling');
    await focusVisible(page.getByLabel('BVR 运行目录', { exact: true }));
    assert.ok((await page.getByLabel('BVR 运行目录', { exact: true }).boundingBox()).y >= geometry.tabsBottom + 4,
      'focused fields must remain below the sticky tabs');
    await scroll.evaluate(el => { el.scrollTop = 0; });
    if (page.viewportSize().width > 900) {
      const header = await page.locator('.pc-plugin-header').evaluate(el => {
        const identity = el.querySelector('.pc-plugin-identity').getBoundingClientRect();
        const summary = el.querySelector('.pc-plugin-summary').getBoundingClientRect();
        return { identityRight: identity.right, identityTop: identity.top, summaryLeft: summary.left, summaryTop: summary.top };
      });
      assert.ok(header.summaryLeft > header.identityRight && Math.abs(header.summaryTop - header.identityTop) < 8,
        'description and status sit to the right of the plugin title on desktop');
    }
  };
  const advanced = page.getByText('下载与高级设置', { exact: true });
  await page.goto(`${base}/tests/fixtures/plugin-center.html`);
  await page.locator('.pc-plugin-row').first().waitFor();
  assert.equal(await page.evaluate(() => window.desktop === undefined), true, 'fixture has no real Desktop bridge');
  assert.equal(await page.locator('.pc-plugin-row').count(), 3);
  assert.equal(await page.locator('.pc-detail').isVisible(), false, 'catalog does not show a side-by-side configuration pane');
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  assert.equal(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
  await noOverflow();
  await screenshot('01-installed-light');
  const bvrCard = page.getByRole('article', { name: 'Bilibili Video Research', exact: true });
  const bvrSwitch = bvrCard.getByRole('switch');
  assert.equal(await page.locator('.pc-card-settings').count(), 3);
  assert.deepEqual(await page.locator('.pc-card-settings').evaluateAll(buttons => buttons.map(button => ({
    text: button.textContent, icons: button.querySelectorAll('svg').length,
    width: button.clientWidth, height: button.clientHeight,
  }))), Array.from({ length: 3 }, () => ({ text: '', icons: 1, width: 30, height: 30 })),
  'installed plugin configuration uses only a gear in a stable icon button');
  const bvrProjectUrl = 'https://github.com/7oMB2006/Bilibili-Video-Research';
  const bvrProjectLabel = '打开 Bilibili Video Research GitHub 项目（新标签页）';
  await openProject(bvrCard.getByRole('link', { name: bvrProjectLabel, exact: true }), bvrProjectUrl);
  await openProject(page.getByRole('article', { name: 'Playwright', exact: true }).getByRole('link'),
    'https://github.com/microsoft/playwright-mcp');
  assert.equal(await page.getByRole('article', { name: 'StepPage', exact: true }).getByRole('link').count(), 0,
    'plugins without a confirmed repository must not link to an unrelated marketplace');
  assert.equal(await page.locator('.pc-detail').isVisible(), false, 'project shortcuts must not open plugin configuration');
  assert.equal(await page.locator('button a,a button,a a').count(), 0, 'project links must not be nested in other interactive controls');
  assert.equal(await bvrSwitch.getAttribute('aria-checked'), 'true');
  for (const theme of ['天光初霁', '星河未眠', '绛夜微醺']) {
    await chooseTheme(theme);
    await stableSwitchSurface(bvrSwitch);
    await bvrSwitch.click();
    await stableSwitchSurface(bvrSwitch);
    assert.equal(await bvrSwitch.getAttribute('aria-checked'), 'false');
    await bvrSwitch.click();
  }
  await chooseTheme('天光初霁');
  await bvrSwitch.hover();
  await screenshot('01a-switch-hover-light');
  await bvrSwitch.click();
  assert.equal(await bvrSwitch.getAttribute('aria-checked'), 'false');
  assert.match(await bvrCard.innerText(), /已停用/);
  assert.equal(await page.locator('.pc-detail').isVisible(), false, 'quick toggle must not open details');
  assert.equal(await page.getByRole('switch', { name: '启用 Playwright', exact: true }).getAttribute('aria-checked'), 'true', 'other plugins retain their state');
  await bvrSwitch.press('Space');
  assert.equal(await bvrSwitch.getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('button button').count(), 0, 'switches must not be nested in card buttons');
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  assert.equal(await page.locator('.sidebar').isVisible(), false);
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  assert.equal(await page.locator('.sidebar').isVisible(), true);
  await page.getByRole('button', { name: '配置 Bilibili Video Research', exact: true }).click();
  await page.getByRole('button', { name: '跟随 DFSC 会话', exact: true }).waitFor();
  assert.equal(await page.locator('.pc-plugin-list').isVisible(), false);
  assert.equal(await page.locator('.pc-catalog-toolbar').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: '保存配置', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('switch', { name: '启用插件', exact: true }).getAttribute('aria-checked'), 'true');
  await stableSwitchSurface(page.getByRole('switch', { name: '启用插件', exact: true }));
  await page.getByRole('switch', { name: '启用插件', exact: true }).click();
  await stableSwitchSurface(page.getByRole('switch', { name: '启用插件', exact: true }));
  await page.getByRole('button', { name: '插件列表', exact: true }).click();
  assert.equal(await bvrSwitch.getAttribute('aria-checked'), 'false', 'detail toggle is reflected on the catalog');
  await bvrSwitch.click();
  await page.getByRole('button', { name: '配置 Bilibili Video Research', exact: true }).click();
  for (const height of [800, 640]) {
    await page.setViewportSize({ width: 1440, height });
    await detailRoom();
    await screenshot(`01b-config-height-${height}`);
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  await screenshot('01b-secondary-config-light');

  await page.getByRole('button', { name: '独立配置', exact: true }).click();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.match(await page.getByRole('alert').innerText(), /API Key/);
  const apiBase = page.getByLabel('接口地址', { exact: true });
  const apiModel = page.getByLabel('视频理解模型', { exact: true });
  const asrApiBase = page.getByLabel('ASR 接口地址', { exact: true });
  const asrApiKey = page.getByLabel('ASR API Key', { exact: true });
  const asrModel = page.getByLabel('语音识别模型', { exact: true });
  const apiKey = page.getByLabel('API Key', { exact: true });
  assert.equal(await apiBase.inputValue(), 'https://api.stepfun.com/v1');
  assert.equal(await apiModel.inputValue(), 'step-3.7-flash');
  assert.equal(await asrModel.inputValue(), 'stepaudio-2.5-asr');
  assert.equal(await asrApiBase.inputValue(), 'https://api.stepfun.com/v1');
  assert.equal(await asrApiKey.inputValue(), '');
  assert.equal(await asrApiKey.getAttribute('type'), 'password');
  assert.equal(await apiKey.getAttribute('type'), 'password');
  assert.equal(await page.getByLabel('私有环境文件', { exact: true }).count(), 0);
  await apiBase.fill('not-an-api-address');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.match(await page.getByRole('alert').innerText(), /接口地址/);
  await apiBase.fill('https://api.stepfun.com/v1');
  const previewKey = 'sk-preview-only-not-a-real-key';
  await apiKey.fill(previewKey);
  await apiModel.fill('');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.match(await page.getByRole('alert').innerText(), /模型名称/);
  await apiModel.fill('step-3.7-flash');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.match(await page.getByRole('alert').innerText(), /ASR.*API Key/, 'ASR must not silently inherit the main API key');
  await asrApiBase.fill('not-an-asr-address');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.match(await page.getByRole('alert').innerText(), /ASR.*接口地址/);
  const previewAsrBase = 'https://asr.example.invalid/v1';
  const previewAsrKey = 'sk-asr-preview-only-not-a-real-key';
  await asrApiBase.fill(previewAsrBase);
  await asrApiKey.fill(previewAsrKey);
  assert.equal(await apiBase.inputValue(), 'https://api.stepfun.com/v1', 'ASR endpoint edits must not change the main endpoint');
  assert.equal(await apiKey.inputValue(), previewKey, 'ASR key edits must not change the main key');
  await asrModel.fill('');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.match(await page.getByRole('alert').innerText(), /语音识别模型/);
  await asrModel.fill('preview-asr-model');
  assert.equal(await apiModel.inputValue(), 'step-3.7-flash', 'ASR edits must not change the video model');
  await page.getByRole('button', { name: '跟随 DFSC 会话', exact: true }).click();
  assert.match(await page.locator('.pc-follow').innerText(), /stepaudio-2.5-asr/);
  await page.getByRole('button', { name: '独立配置', exact: true }).click();
  assert.equal(await asrModel.inputValue(), 'preview-asr-model', 'source switching retains the independent ASR draft');
  assert.equal(await asrApiBase.inputValue(), previewAsrBase);
  assert.equal(await asrApiKey.inputValue(), previewAsrKey);
  assert.equal(await apiKey.inputValue(), previewKey);
  await openProject(page.locator('.pc-detail').getByRole('link', { name: bvrProjectLabel, exact: true }), bvrProjectUrl);
  assert.equal(await page.locator('.pc-detail').isVisible(), true);
  assert.equal(await page.getByRole('dialog').isVisible(), false, 'opening a project does not leave or discard the configuration');
  assert.equal(await asrApiKey.inputValue(), previewAsrKey);
  assert.equal(await apiKey.inputValue(), previewKey);
  assert.equal(await asrApiBase.inputValue(), previewAsrBase, 'project shortcuts retain unsaved model connections');
  await asrModel.fill('stepaudio-2.5-asr');
  for (const field of [apiBase, apiModel, asrApiBase, asrModel, apiKey, asrApiKey]) await focusVisible(field);
  await page.getByRole('button', { name: '显示 API Key', exact: true }).click();
  assert.equal(await apiKey.getAttribute('type'), 'text');
  assert.equal(await asrApiKey.getAttribute('type'), 'password');
  await page.getByRole('button', { name: '隐藏 API Key', exact: true }).click();
  assert.equal(await apiKey.getAttribute('type'), 'password');
  assert.equal(await apiKey.inputValue(), previewKey);
  await page.getByRole('button', { name: '显示 ASR API Key', exact: true }).click();
  assert.equal(await asrApiKey.getAttribute('type'), 'text');
  assert.equal(await apiKey.getAttribute('type'), 'password');
  await page.getByRole('button', { name: '隐藏 ASR API Key', exact: true }).click();
  assert.equal(await asrApiKey.getAttribute('type'), 'password');
  await page.getByRole('button', { name: '选择 BVR 运行目录', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.locator('.pc-path-choice').click();
  assert.equal(await page.getByLabel('BVR 运行目录', { exact: true }).inputValue(), 'D:\\Tools\\Bilibili-Video-Research');
  await page.getByRole('button', { name: '检查环境', exact: true }).click();
  await page.locator('.pc-check-results').waitFor();
  assert.match(await page.locator('.pc-check-results').innerText(), /不验证 Key 有效性/);
  await page.locator('.pc-detail-scroll').evaluate(el => { el.scrollTop = 0; });
  await noOverflow();
  await screenshot('02-independent');
  await chooseTheme('星河未眠');
  await focusVisible(apiKey);
  await focusVisible(asrApiKey);
  await screenshot('02a-independent-dark');
  await chooseTheme('天光初霁');
  assert.equal(await page.evaluate(keys => Object.values(localStorage).concat(Object.values(sessionStorage)).some(value => keys.some(key => value.includes(key))), [previewKey, previewAsrKey]),
    false, 'preview credentials must not be written to browser storage');
  await page.getByRole('button', { name: '插件列表', exact: true }).click();
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '独立配置', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '放弃更改', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '跟随 DFSC 会话', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '独立配置', exact: true }).click();
  assert.equal(await apiKey.inputValue(), '');
  assert.equal(await asrApiKey.inputValue(), '');
  assert.equal(await asrApiBase.inputValue(), 'https://api.stepfun.com/v1', 'discard restores both independent connections');
  await page.getByRole('button', { name: '跟随 DFSC 会话', exact: true }).click();

  await advanced.click();
  await page.waitForTimeout(280);
  await page.getByLabel('HTTP 代理', { exact: true }).fill('http://127.0.0.1:7897');
  await focusVisible(page.getByLabel('HTTP 代理', { exact: true }));
  await screenshot('03-advanced-focus-light');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.match(await page.locator('.pc-save-state').innerText(), /待重新加载/);
  assert.equal(await page.locator('.pc-auth-state').innerText(), '首次调用需要授权');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByRole('button', { name: '保存配置', exact: true }).waitFor();
  assert.match(await page.locator('.pc-plugin-summary').innerText(), /MCP 已连接/);
  assert.equal(await page.locator('.pc-auth-state').innerText(), '首次调用需要授权');
  await page.getByRole('tab', { name: '能力', exact: true }).click();
  assert.equal(await page.locator('.pc-capability-row').count(), 5);
  await page.getByRole('tab', { name: '说明', exact: true }).click();
  await page.getByText('首次使用', { exact: true }).click();
  await page.waitForTimeout(280);
  assert.equal(await page.locator('.pc-guide').isVisible(), true);
  await page.getByRole('tab', { name: '配置', exact: true }).click();
  await chooseTheme('星河未眠');
  await focusVisible(page.getByLabel('BVR 运行目录', { exact: true }));
  await screenshot('04-config-dark');
  await noOverflow();
  await chooseTheme('绛夜微醺');
  await screenshot('05-config-wine');

  await page.getByRole('button', { name: '插件列表', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '配置 Bilibili Video Research', exact: true }).evaluate(el => el === document.activeElement), true, 'return restores the configuration trigger focus');
  await page.getByLabel('搜索插件', { exact: true }).fill('Bilibili');
  await page.locator('.pc-plugin-row').first().click();
  await page.getByRole('button', { name: '插件列表', exact: true }).click();
  assert.equal(await page.getByLabel('搜索插件', { exact: true }).inputValue(), 'Bilibili', 'return retains catalog search');
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await page.getByRole('tab', { name: '市场来源', exact: true }).click();
  await page.getByRole('button', { name: '添加来源', exact: true }).click();
  await page.getByLabel('GitHub 仓库地址', { exact: true }).fill('https://github.com/example/plugins');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  assert.equal(await page.locator('.pc-source-row').count(), 3);
  await page.getByRole('button', { name: '移除市场来源', exact: true }).last().click();
  assert.equal(await page.locator('.pc-source-row').count(), 2);
  await screenshot('06-sources');
  await page.getByRole('tab', { name: '发现', exact: true }).click();
  await page.getByLabel('搜索插件', { exact: true }).fill('none');
  assert.equal(await page.locator('.pc-plugin-row').count(), 0);
  await page.getByRole('button', { name: '清空搜索', exact: true }).first().click();
  await page.locator('.pc-plugin-row').filter({ hasText: 'StepPage' }).click();
  await page.getByRole('button', { name: '卸载插件', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '卸载插件', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '安装', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '安装', exact: true }).click();
  await page.getByRole('button', { name: '插件列表', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: /已安装/ }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: '用量统计', exact: true }).click();
  assert.equal(await page.locator('.usage-page').isVisible(), true);
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  assert.equal(await page.getByText('整理项目待办', { exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByLabel('会话草稿', { exact: true }).fill('这段草稿要保留。');
  await page.getByRole('button', { name: '插件市场', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  assert.equal(await page.getByLabel('会话草稿', { exact: true }).inputValue(), '这段草稿要保留。');
  await page.getByRole('button', { name: '预览 BVR 调用确认', exact: true }).click();
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  assert.match(await page.getByRole('dialog').innerText(), /Step Plan/);
  await screenshot('07-call-confirmation');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').isVisible(), false);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/tests/fixtures/plugin-center.html?theme=light`);
  await page.getByRole('button', { name: '跟随 DFSC 会话', exact: true }).waitFor({ state: 'hidden' });
  await noOverflow();
  await openProject(bvrCard.getByRole('link', { name: bvrProjectLabel, exact: true }), bvrProjectUrl);
  await bvrSwitch.click();
  assert.equal(await bvrSwitch.getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('.pc-detail').isVisible(), false);
  await bvrSwitch.click();
  await screenshot('08-mobile-list');
  await page.locator('.pc-plugin-row').filter({ hasText: 'Bilibili' }).click();
  await page.getByRole('button', { name: '跟随 DFSC 会话', exact: true }).waitFor();
  await detailRoom();
  await noOverflow();
  await screenshot('09-mobile-config');
  await focusVisible(page.getByLabel('BVR 运行目录', { exact: true }));
  await advanced.click();
  await page.waitForTimeout(280);
  await focusVisible(page.getByLabel('HTTP 代理', { exact: true }));
  await screenshot('10-mobile-focus-light');
  await chooseTheme('星河未眠');
  await focusVisible(page.getByLabel('HTTP 代理', { exact: true }));
  await screenshot('11-mobile-focus-dark');
  await noOverflow();
  await page.getByRole('button', { name: '插件列表', exact: true }).click();
  assert.equal(await page.locator('.pc-plugin-list').isVisible(), true);
  assert.equal(await page.locator('.pc-detail').isVisible(), false);
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  assert.equal(await page.locator('.sidebar').isVisible(), true);
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click({ position: { x: 375, y: 120 } });
  assert.equal(await page.locator('.sidebar').isVisible(), false);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.pc-plugin-row').filter({ hasText: 'Bilibili' }).click();
  await advanced.click();
  const animations = await page.locator('.pc-disclosure').evaluate(el => el.getAnimations({ subtree: true }).length);
  assert.equal(animations, 0, 'reduced motion must not animate disclosures');
  await page.getByRole('button', { name: '独立配置', exact: true }).click();
  await focusVisible(apiBase);
  await focusVisible(apiModel);
  await focusVisible(asrApiBase);
  await focusVisible(asrModel);
  await focusVisible(apiKey);
  await focusVisible(asrApiKey);
  await noOverflow();
  await screenshot('12-mobile-independent-dark');
  await chooseTheme('天光初霁');
  await focusVisible(apiKey);
  await focusVisible(asrApiKey);
  await screenshot('13-mobile-independent-light');
  await page.getByRole('button', { name: '插件列表', exact: true }).click();
  await page.getByRole('button', { name: '放弃并离开', exact: true }).click();
  assert.equal(await page.locator('.pc-plugin-list').isVisible(), true);
  await noOverflow();
  assert.deepEqual(errors, [], 'no browser errors');
  assert.deepEqual(external, [], 'no external requests');
  assert.equal(projectPages.length, 4, 'project shortcuts were exercised with intercepted, not real, GitHub navigation');
  console.log(JSON.stringify({ result: 'passed', screenshots: output, checks: [
    'two-level catalog/detail navigation on desktop and mobile',
    'catalog and detail GitHub shortcuts open isolated tabs without changing plugin state or unsaved configuration',
    'full-height detail scrolling with sticky tabs and persistent return/save actions',
    'desktop header summary aligned right and compact keyboard-accessible scroll thumb',
    'catalog quick toggles, keyboard activation and detail state synchronization',
    'enabled/disabled switch track remains visible during hover and press in light/dark/wine themes',
    'catalog search and trigger focus retained on return',
    'native sidebar and theme controls', 'BVR follow/independent configuration',
    'direct API address/key/video/ASR model fields, required validation and key masking in light/dark/narrow layouts',
    'main and ASR endpoint/key/model are independent, required and never silently inherited',
    'separate key visibility, source switching retains both drafts and discard restores both connections',
    'preview key is never persisted to browser storage',
    'validation and simulated path selection', 'unsaved navigation guard',
    'save/reload separate from call authorization', 'capabilities and disclosures',
    'market sources, search, uninstall/install', 'usage/schedules main-view navigation',
    'conversation draft retention', 'mobile navigation', 'focus visibility in light/dark',
    'no horizontal overflow', 'reduced motion', 'no Desktop bridge or external requests',
  ] }, null, 2));
} finally {
  await browser.close();
}
