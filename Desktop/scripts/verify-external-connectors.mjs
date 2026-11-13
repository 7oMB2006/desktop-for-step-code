import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { settleLayout } from './settle-layout.mjs';

const output = process.env.DESKTOP_VERIFY_OUTPUT || 'test-results/external-connectors-browser';
await mkdir(output, { recursive: true });
const checks = [], errors = [];
let browser, server;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const base = new URL('/tests/fixtures/external-connectors.html', server.resolvedUrls.local[0]);
  const open = async (theme = 'light', language = 'zh', extra = '') => {
    await page.goto(`${base}?theme=${theme}&lang=${language}${extra}`);
    await page.getByRole('button', { name: /外部 Agent|External agents/ }).click();
    await page.getByRole('switch').waitFor();
  };
  const focus = async locator => {
    await locator.scrollIntoViewIfNeeded();
    await page.keyboard.press('Tab'); await locator.focus();
    const issues = await locator.evaluate(element => {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
      const gutter = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
      const issues = [];
      if (style.outlineStyle === 'none' || gutter < 4) issues.push('Missing shared focus');
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const clip = getComputedStyle(ancestor), rect = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(clip.overflowX)
          && (bounds.left - gutter < rect.left - 1 || bounds.right + gutter > rect.right + 1)) issues.push(`Horizontal: ${ancestor.className}`);
        if (/(auto|scroll|hidden|clip)/.test(clip.overflowY)
          && (bounds.top - gutter < rect.top - 1 || bounds.bottom + gutter > rect.bottom + 1)) issues.push(`Vertical: ${ancestor.className}`);
      }
      return issues;
    });
    assert.deepEqual(issues, []);
  };
  for (const [theme, width, language] of [['light', 1360, 'zh'], ['dark', 1360, 'en'], ['light', 390, 'zh'], ['dark', 390, 'en']]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: width < 700 ? 'reduce' : 'no-preference' });
    await open(theme, language);
    assert.equal(await page.getByRole('switch').isChecked(), false);
    assert.equal(await page.locator('.external-connector-form button[type=submit]').isDisabled(), true);
    await page.getByRole('switch').click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.checked);
    const name = page.locator('.external-connector-form input:not([type=checkbox])');
    await name.fill('Hermes x DFSC');
    await focus(name);
    await page.locator('.external-connector-form input[type=checkbox]').check();
    const submit = page.locator('.external-connector-form button[type=submit]');
    await submit.click();
    const confirmation = page.locator('.external-connector-confirmation');
    await settleLayout(confirmation);
    const confirm = confirmation.getByRole('button').last();
    await focus(confirm);
    await confirm.click();
    await page.locator('.external-connector-row').waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.external-connectors h2'));
    const config = page.locator('.external-connector-config code');
    assert.match(await config.innerText(), /config\.json$/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    await config.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${theme}-${width}-${language}.png`, fullPage: true });
    await page.locator('.external-connector-config button').click();
    assert.equal(await page.evaluate(() => window.externalFixture.copied), await config.innerText());
    assert.equal(await page.locator('.external-connector-announcement').evaluate(element =>
      element.getBoundingClientRect().width <= 1 && getComputedStyle(element).clipPath === 'inset(50%)'), true);
    await page.locator('.external-connector-row-heading button').click();
    await settleLayout(confirmation);
    await confirmation.getByRole('button').last().click();
    await page.waitForFunction(() => !document.querySelector('.external-connector-row'));
    await page.waitForFunction(() => document.activeElement === document.querySelector('.external-connectors h2'));
    checks.push(`${theme}/${width}/${language}: pair, scope, copy, revoke, focus bounds and fallback`);
  }
  await open('light', 'zh', '&empty=1');
  await page.getByRole('switch').click();
  assert.equal(await page.locator('.external-connector-form button[type=submit]').isDisabled(), true);
  checks.push('empty project list cannot authorize');
  await open();
  await page.getByRole('switch').click();
  await page.locator('.external-connector-form input:not([type=checkbox])').fill('Hermes');
  await page.locator('.external-connector-form input[type=checkbox]').check();
  const submit = page.locator('.external-connector-form button[type=submit]');
  await submit.click();
  await page.evaluate(() => { window.externalFixture.failNext(); window.externalFixture.holdNext(); });
  await page.locator('.external-connector-confirmation button').last().click();
  assert.equal(await submit.isDisabled(), true);
  await page.evaluate(() => window.externalFixture.release());
  await page.getByRole('alert').waitFor();
  await page.waitForFunction(() => document.activeElement === document.querySelector('.external-connector-form button[type=submit]'));
  assert.equal(await page.locator('.external-connector-row').count(), 0);
  checks.push('held failed authorization cannot create a connection and restores keyboard focus');
  for (const [theme, width, language] of [['light', 1360, 'zh'], ['dark', 1360, 'en'], ['light', 390, 'zh'], ['dark', 390, 'en']]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: width < 700 ? 'reduce' : 'no-preference' });
    await open(theme, language, '&tasks=1');
    const row = page.locator('.external-approval-task');
    const trigger = row.getByRole('button', { name: /委托此任务审批|Delegate this task/ });
    await trigger.click();
    await settleLayout(row.locator('details'));
    assert.match(await row.innerText(), /Hermes x DFSC/);
    const types = row.getByRole('checkbox');
    await types.nth(0).uncheck(); await types.nth(1).uncheck();
    const confirm = row.getByRole('button', { name: /确认委托审批|Confirm approval delegation/ });
    assert.equal(await confirm.isDisabled(), true);
    await types.nth(1).check();
    await focus(types.nth(1));
    await row.getByRole('combobox').selectOption('15');
    await focus(row.getByRole('combobox'));
    await focus(confirm);
    await page.screenshot({ path: `${output}/delegation-scope-${theme}-${width}-${language}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    await trigger.click(); await settleLayout(row.locator('details'));
    await confirm.click();
    const revoke = row.getByRole('button', { name: /撤销审批委托|Revoke approval delegation/ });
    await revoke.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.match(/撤销审批委托|Revoke approval delegation/));
    await focus(revoke);
    await page.getByRole('button', { name: /审批记录|Approval history/ }).click();
    await settleLayout(page.locator('.external-approval-audit').locator('..').locator('..'));
    await page.screenshot({ path: `${output}/delegation-active-${theme}-${width}-${language}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'delegation has no horizontal overflow');
    await revoke.click(); await trigger.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.match(/委托此任务审批|Delegate this task/));
    assert.equal(await row.locator('.external-connector-status').innerText(), language === 'zh' ? '本机审批' : 'Local review');
    checks.push(`${theme}/${width}/${language}: task scope, duration, empty selection, Escape, revoke, audit and full focus bounds`);
  }
  await open('light', 'zh', '&tasks=1');
  const row = page.locator('.external-approval-task');
  await row.getByRole('button', { name: '委托此任务审批', exact: true }).click();
  await page.evaluate(() => window.externalFixture.failNext());
  await row.getByRole('button', { name: '确认委托审批', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await row.locator('details').getAttribute('open'), '');
  assert.equal(await row.locator('.external-connector-status').innerText(), '本机审批');
  checks.push('failed delegation never displays authority and retains selected scope for recovery');
  assert.deepEqual(errors, []);
  console.log(`External connector browser acceptance passed (${checks.length} groups).`);
} finally {
  await browser?.close(); await server?.close();
  await writeFile(`${output}/verification.json`, JSON.stringify({ checks, errors, fixtureOnly: true }, null, 2) + '\n');
}
