import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { assertFocusVisible } from './assert-focus-visible.mjs';

const url = new URL('/tests/fixtures/capability-settings.html?preview=skill-detail&theme=light&lang=en',
  process.argv[2] ?? 'http://127.0.0.1:4178');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: typeof name === 'string' });
  const dialog = name => page.getByRole('dialog', { name, exact: true });
  const heading = name => page.getByRole('heading', { name, exact: true });
  const seen = locator => locator.waitFor({ state: 'visible', timeout: 5000 });
  const focused = locator => locator.evaluate(el => document.activeElement === el);
  const search = page.getByRole('searchbox', { name: 'Search skills' });
  const searchShell = page.locator('.skills-preview-search');
  const outline = () => searchShell.evaluate(shell => {
    const style = getComputedStyle(shell);
    return { width: style.outlineWidth, offset: style.outlineOffset, color: style.outlineColor, duration: style.transitionDuration };
  });
  const assertSearchOutline = async (width, duration) => {
    const { color, ...style } = await outline();
    assert.deepEqual(style, { width, offset: '2px', duration });
    assert.equal(await focused(search), true);
    assert.equal(await search.evaluate(input => getComputedStyle(input).outlineStyle), 'none', 'No second outline on the input');
    const clipped = await searchShell.evaluate(shell => {
      const style = getComputedStyle(shell);
      const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const rect = shell.getBoundingClientRect();
      if (rect.left < extent || rect.top < extent || rect.right + extent > innerWidth || rect.bottom + extent > innerHeight) return true;
      for (let parent = shell.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        const left = bounds.left + parent.clientLeft, top = bounds.top + parent.clientTop;
        if (css.overflowX !== 'visible' && (rect.left - extent < left || rect.right + extent > left + parent.clientWidth)
          || css.overflowY !== 'visible' && (rect.top - extent < top || rect.bottom + extent > top + parent.clientHeight)) return true;
      }
      return false;
    });
    assert.equal(clipped, false, 'Search outline fits all clipping ancestors');
    return color;
  };

  await page.goto(url.href);
  await seen(heading('Code review'));
  const idle = await outline();
  assert.equal(idle.color, 'rgba(0, 0, 0, 0)');
  await search.click();
  await assertSearchOutline('1px', '0.24s');
  await page.waitForFunction(color => {
    const shell = document.querySelector('.skills-preview-search');
    return getComputedStyle(shell).outlineColor !== color && !shell.getAnimations().length;
  }, idle.color);
  await search.fill('browser-acceptance');
  await seen(button('browser-acceptance'));
  assert.equal(await button('code-review').count(), 0);
  await button('Clear search').click();
  assert.equal(await search.inputValue(), '');
  await button('Refresh skills').focus();
  assert.equal((await outline()).duration, '0.18s');
  await page.waitForFunction(color => getComputedStyle(document.querySelector('.skills-preview-search')).outlineColor === color, idle.color);
  assert.deepEqual(await outline(), idle);
  await button('Source').click();
  await seen(page.locator('.skills-preview-source'));
  await button('New').click();
  let modal = dialog('New skill');
  await modal.getByLabel('Name').fill('code-review');
  await modal.getByLabel('Description').fill('Sample description');
  await modal.getByLabel('Body (Markdown)').fill('# Sample heading');
  await button('Save', modal).click();
  await seen(modal.getByRole('alert'));
  await modal.getByLabel('Name').fill('preview-test');
  await button('Save', modal).click();
  await seen(heading('Sample heading'));

  const mode = button('Invocation');
  const modeMenu = page.getByRole('menu', { name: 'Invocation', exact: true });
  const option = name => modeMenu.getByRole('menuitemradio', { name, exact: true });
  const chooseMode = async name => {
    await mode.click();
    await option(name).click();
    await seen(mode.filter({ hasText: name }));
  };
  await mode.focus();
  await page.keyboard.press('Enter');
  await seen(modeMenu);
  assert.equal(await option('Automatic').getAttribute('aria-checked'), 'true');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-checked') === 'true');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(option('Manual only')), true);
  await page.keyboard.press('Enter');
  await seen(mode.filter({ hasText: 'Manual only' }));
  assert.equal(await focused(mode), true);
  await button('Source').click();
  assert.match(await page.locator('.skills-preview-source').innerText(), /disable-model-invocation: true/);
  await button('Copy invocation command').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '/skill:preview-test');
  await chooseMode('Off');
  assert.equal(await button('Copy invocation command').count(), 0);
  await chooseMode('Automatic');
  await button('Edit').click();
  modal = dialog('Edit skill');
  await modal.getByLabel('Body (Markdown)').fill('# Discard this');
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  await button('Read').click();
  await seen(heading('Sample heading'));
  await button('Edit').click();
  await modal.getByLabel('Body (Markdown)').fill('# Saved edit');
  await button('Save', modal).click();
  await seen(heading('Saved edit'));

  await button(/^Files /).click();
  await button('New file').click();
  modal = dialog('New file');
  await modal.getByLabel('File path').fill('../invalid');
  await modal.getByLabel('Text content').fill('a first version');
  await button('Save', modal).click();
  await seen(modal.getByRole('alert'));
  await modal.getByLabel('File path').fill('references/steps.md');
  await button('Save', modal).click();
  await seen(page.getByText('a first version', { exact: true }));
  await button('Edit file').click();
  modal = dialog('Edit file');
  await modal.getByLabel('File path').fill('references/renamed.md');
  await modal.getByLabel('Text content').fill('a second version');
  await button('Save', modal).click();
  await seen(page.getByText('a second version', { exact: true }));
  assert.equal(await button('references/renamed.md').getAttribute('aria-expanded'), 'true');
  assert.equal(await button('references/steps.md').count(), 0);
  await button('Delete file').click();
  await button('Delete', dialog('Delete file?')).click();
  await seen(page.getByText('No supporting files'));
  await button('Delete skill').click();
  await button('Cancel', dialog('Delete skill?')).click();
  await seen(heading('preview-test'));
  await button('Delete skill').click();
  await button('Delete', dialog('Delete skill?')).click();
  await button('preview-test').waitFor({ state: 'hidden' });

  await button('browser-acceptance').click();
  assert.equal(await button('Edit').count(), 0);
  assert.equal(await mode.count(), 0);
  await button(/^Files /).click();
  await button('references/evidence.md').click();
  assert.equal(await button('Edit file').count(), 0);
  await seen(page.getByText(/Observed result/));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button('Import folder').click()]);
  await chooser.setFiles(fileURLToPath(new URL('../../examples/plugins/resource-starter/plugins/dfsc-example/skills/dfsc-example', import.meta.url)));
  await seen(heading('dfsc-example'));
  await button('Source').click();
  assert.match(await page.locator('.skills-preview-source').innerText(), /name: dfsc-example/);
  await button('Edit').click();
  await seen(dialog('Edit skill').getByLabel('Body (Markdown)'));
  await page.keyboard.press('Escape');

  url.searchParams.set('skill-conflict', '');
  await page.goto(url.href);
  await button('Edit').click();
  modal = dialog('Edit skill');
  const body = modal.getByLabel('Body (Markdown)');
  await body.fill('# Unsaved draft');
  await button('Save', modal).click();
  await seen(modal.getByRole('alert').filter({ hasText: 'changed elsewhere' }));
  assert.equal(await body.inputValue(), '# Unsaved draft');
  await button('Copy draft', modal).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /# Unsaved draft/);
  await button('Cancel', modal).click();
  await button('Refresh skills').click();
  await seen(heading('Code review'));
  assert.equal(await heading('Unsaved draft').count(), 0);

  url.searchParams.delete('skill-conflict');
  url.searchParams.set('theme', 'dark');
  await page.setViewportSize({ width: 375, height: 620 });
  await page.goto(url.href);
  await button('Refresh skills').focus();
  await page.keyboard.press('Tab');
  await assertSearchOutline('1px', '0.24s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.notEqual(await assertSearchOutline('1px', '0s'), idle.color);
  await page.emulateMedia({ forcedColors: 'active' });
  assert.notEqual(await assertSearchOutline('2px', '0s'), idle.color);
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
  await button('code-review').click();
  await seen(heading('Code review'));
  assert.equal(await focused(heading('code-review')), true);
  await mode.click();
  await seen(modeMenu);
  const menuBounds = await modeMenu.boundingBox();
  assert(menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 375
    && menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 620);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-checked') === 'true');
  await page.keyboard.press('Escape');
  await modeMenu.waitFor({ state: 'hidden' });
  assert.equal(await focused(mode), true);
  assert.equal(await mode.innerText(), 'Automatic');
  await button('Edit').click();
  await page.keyboard.press('Escape');
  await dialog('Edit skill').waitFor({ state: 'hidden' });
  assert.equal(await focused(button('Edit')), true);
  await button('Skills', page.locator('.skills-preview-detail')).click();
  assert.equal(await focused(button('code-review')), true);
  await page.setViewportSize({ width: 375, height: 420 });
  await button('New').click();
  modal = dialog('New skill');
  const bounds = await modal.boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 375 && bounds.y >= 0 && bounds.y + bounds.height <= 420);
  for (const name of ['Name', 'Description', 'Body (Markdown)']) {
    const field = modal.getByLabel(name);
    if (!await focused(field)) await page.keyboard.press('Tab');
    await assertFocusVisible(page, field, name, { focus: false });
    assert.deepEqual(await field.evaluate(el => {
      const css = getComputedStyle(el);
      return [css.outlineWidth, css.outlineOffset, css.transitionDuration];
    }), ['1px', '2px', '0.24s']);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('Skills preview passed: search focus, local management, modes, clipboard, files, read-only plugins, real directory import and narrow keyboard navigation.');
} finally {
  await browser.close();
}
