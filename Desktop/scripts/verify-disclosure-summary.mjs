import assert from 'node:assert/strict';
import { captureWaapi } from './capture-waapi.mjs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
await server.listen();
const url = server.resolvedUrls.local[0] + 'tests/fixtures/disclosure-summary.html';
let browser;
await mkdir('test-results', { recursive: true });
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_TEST_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_TEST_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.disclosureFixture);
  const compact = page.locator('.compact-process');
  const heading = compact.locator('.tool-group-trigger');
  const thought = compact.locator('.thinking');
  const load = async (kind, busy = false) => page.evaluate(({ kind, busy }) => {
    const f = window.disclosureFixture;
    const history = kind === 'thought' ? [f.thought] : kind === 'tool' ? [f.command, f.result]
      : kind === 'pending' ? [f.thought, f.command] : [f.thought, f.command, f.result];
    f.load(history, busy);
  }, { kind, busy });
  await load('thought');
  await page.waitForFunction(() => document.querySelector('.thinking')?.dataset.running !== 'true');
  assert.equal(await heading.isVisible(), false);
  await thought.locator('summary').click();
  await page.evaluate(() => { window.originalThought = document.querySelector('.thinking'); });
  await load('pending', true);
  await page.waitForFunction(() => document.querySelector('.compact-process')?.dataset.single === 'false');
  assert.equal(await heading.getAttribute('aria-expanded'), 'true');
  assert.equal(await thought.getAttribute('data-expanded'), 'true');
  assert.equal(await page.evaluate(() => window.originalThought === document.querySelector('.thinking')), true);
  await load('group');
  await heading.focus();
  await load('thought');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.thinking > summary'));
  assert.equal(await heading.isVisible(), false);
  await thought.locator('summary').click();
  await load('group');
  await page.waitForFunction(() => document.querySelector('.compact-process')?.dataset.single === 'false');
  // A previously opened group retains the user's expansion choice.
  assert.equal(await heading.getAttribute('aria-expanded'), 'false');
  await load('tool');
  await page.locator('.process-tool > summary').click();
  await page.waitForFunction(() => document.querySelector('.process-tool')?.dataset.expanded === 'true');
  const body = page.locator('.process-tool-body');
  await page.waitForTimeout(280);
  assert.match(await body.innerText(), /export function App/);
  const closeAnimation = await captureWaapi(page, '.process-tool-body', () => page.locator('.process-tool > summary').click());
  const closing = await closeAnimation.evaluate(animation => {
    const element = animation.effect.target;
    animation.currentTime = 120;
    return { height: element.getBoundingClientRect().height, full: element.scrollHeight,
      easing: animation.effect.getTiming().easing };
  });
  assert.ok(closing && closing.height > 0 && closing.height < closing.full, 'tool closing must have intermediate height');
  assert.equal(closing.easing, 'cubic-bezier(0.215, 0.61, 0.355, 1)');
  assert.equal(await body.getAttribute('inert'), '');
  await closeAnimation.evaluate(animation => animation.play());
  await page.waitForFunction(() => !document.querySelector('.process-tool')?.open);
  await closeAnimation.dispose();
  await page.locator('.process-tool > summary').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.process-tool').getAttribute('data-expanded'), 'true', 'rapid toggles settle expanded');
  await page.evaluate(() => { window.originalTool = document.querySelector('.process-tool'); });
  await load('group');
  assert.equal(await page.evaluate(() => window.originalTool === document.querySelector('.process-tool')), false, 'a different range owner starts a new group');
  // Verify identity when a tool is the first member and a thought arrives afterward.
  await load('tool');
  await page.locator('.process-tool > summary').click();
  await page.locator('.tool-output > summary').click();
  await page.evaluate(() => {
    window.originalTool = document.querySelector('.process-tool');
    const f = window.disclosureFixture;
    f.load([f.command, f.result, f.thought], false);
  });
  await page.waitForFunction(() => document.querySelector('.compact-process')?.dataset.single === 'false');
  assert.equal(await page.evaluate(() => window.originalTool === document.querySelector('.process-tool')), true);
  assert.equal(await heading.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.tool-output').getAttribute('open'), null, 'member-local output choice survives group growth');
  const geometry = await thought.locator('summary').evaluate(element => {
    const arrow = element.querySelector('.thinking-chevron').getBoundingClientRect();
    const label = element.querySelector('.process-tool-label').getBoundingClientRect();
    return { gap: arrow.left - label.right, arrowRight: arrow.right, previewLeft: element.querySelector('.thinking-preview')?.getBoundingClientRect().left };
  });
  assert.ok(geometry.gap >= 0 && geometry.gap <= 10);
  if (geometry.previewLeft !== undefined) assert.ok(geometry.arrowRight <= geometry.previewLeft);
  const progress = page.getByRole('progressbar');
  assert.equal(await progress.getAttribute('aria-valuenow'), '1');
  assert.equal(await progress.getAttribute('aria-valuemax'), '3');
  assert.equal(await page.locator('.sb-activity').getAttribute('data-state'), 'running');
  await page.getByRole('button', { name: '组合过程', exact: true }).click();
  await page.locator('.sb-agent-row').click();
  await page.getByRole('status').getByText('核对交互边界', { exact: true }).waitFor();
  assert.equal(await page.locator('.sb-header-metrics [aria-label="1 条代理记录"]').count(), 1);
  await page.getByRole('button', { name: '跨轮记录', exact: true }).click();
  await page.locator('.historical-agents').waitFor();
  assert.equal(await page.locator('.sb-agent-row').count(), 1, 'only this turn maps to the summary');
  assert.equal(await page.locator('.historical-agents').getAttribute('data-expanded'), 'false');
  assert.equal(await page.locator('.lane-row').count(), 1, 'previous-turn agent details mount on demand');
  await page.locator('.historical-agents > summary').click();
  await page.locator('.historical-agents .lane-row').first().waitFor();
  assert.equal(await page.locator('.historical-agents .lane-row').count(), 2);
  await page.locator('.historical-agents .lane-row').last().click();
  await page.getByRole('status').getByText('检查上一轮边界', { exact: true }).waitFor();
  assert.equal(await page.locator('.sb-agent-row').count(), 1, 'opening history never repopulates summary rows');
  await page.locator('.historical-agents > summary').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.historical-agents').getAttribute('open'), null);
  await page.locator('.historical-agents > summary').click();
  assert.equal(await page.locator('.historical-agents .lane-row').count(), 2, 'history does not duplicate on reopen');
  await page.locator('.historical-agents > summary').click();
  await page.screenshot({ path: 'test-results/disclosure-summary-turn-scope.png', fullPage: true });
  await page.evaluate(() => {
    const dispatch = (id, task) => [
      { role: 'assistant', content: [{ type: 'toolCall', id, name: 'subagent', arguments: {} }] },
      { role: 'toolResult', toolName: 'subagent', toolCallId: id, content: '',
        details: { results: [{ agent: 'reader', task, status: 'completed', messages: [] }] } },
    ];
    const history = [
      { role: 'user', content: 'Original task' },
      ...dispatch('before-cron', 'Previous agent'),
      { role: 'custom', customType: 'step-cron', content: '[cron] Check again' },
      ...dispatch('after-cron', 'Cron agent'),
    ];
    window.disclosureFixture.load(history, false);
  });
  await page.locator('.cron-message-trigger').waitFor();
  assert.equal(await page.locator('.message.assistant').count(), 2);
  assert.equal(await page.locator('.historical-agents').count(), 1, 'previous response folds at the same Cron boundary');
  assert.equal(await page.locator('.sb-agent-row').count(), 1, 'summary shows only the Cron turn');
  assert.match(await page.locator('.sb-agent-row').innerText(), /Cron agent/);
  await page.locator('.historical-agents > summary').click();
  await page.locator('.historical-agents .lane-row').waitFor();
  assert.match(await page.locator('.historical-agents').innerText(), /Previous agent/);
  assert.equal(await page.locator('.sb-agent-row').count(), 1, 'expanding pre-Cron history does not restore it to summary');
  const currentSummary = { sessionId: 'fixture', tasks: [], mcp: [], skillCount: 0 };
  await page.evaluate(value => window.disclosureFixture.summary(value), currentSummary);
  await page.locator('.sb-steps').getByText('本轮暂无任务清单', { exact: true }).waitFor();
  assert.equal(await page.locator('.sb-steps .sb-step-count').count(), 0, 'empty current turns have no task counter');
  assert.equal(await progress.count(), 0, 'empty tasks do not imply a completion percentage');
  await load('thought', true);
  assert.equal(await page.locator('.sb-activity').getAttribute('data-state'), 'running', 'live conversation does not wait for summary polling');
  assert.equal(await page.locator('.sb-activity').getAttribute('aria-label'), '会话运行中');
  await load('pending', true);
  assert.equal(await page.locator('.sb-activity').getAttribute('data-state'), 'running', 'ordinary tool execution is live activity');
  assert.equal(await progress.count(), 0, 'live activity never invents task completion');
  await load('tool', false);
  assert.equal(await page.locator('.sb-activity').getAttribute('data-state'), 'idle', 'ending an unplanned turn does not invent completion');
  await page.evaluate(value => window.disclosureFixture.summary(value), { ...currentSummary,
    tasks: [{ id: '1', subject: '任务', description: '', status: 'completed' }] });
  await page.waitForFunction(() => document.querySelector('.sb-activity')?.getAttribute('data-state') === 'completed');
  await load('thought', true);
  assert.equal(await page.locator('.sb-activity').getAttribute('data-state'), 'running', 'a new turn overrides the preceding completed plan immediately');
  assert.equal(await progress.getAttribute('aria-valuenow'), '1', 'runtime activity does not rewrite canonical task counts');
  await load('tool', false);
  assert.equal(await page.locator('.sb-activity').getAttribute('data-state'), 'completed');
  await load('thought', true);
  await page.evaluate(value => window.disclosureFixture.summary(value), { ...currentSummary,
    tasks: [{ id: '1', subject: '任务', description: '', status: 'in_progress' }] });
  for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [320, 'dark']]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/disclosure-summary-${width}-${theme}.png`, fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.thinking > summary').click();
  assert.equal(await page.locator('.thinking-body').evaluate(element => element.getAnimations().length), 0);
  assert.equal(await page.locator('.sb-activity').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.goto(url + '?lang=en&theme=light');
  await page.waitForFunction(() => document.querySelector('.sb-header-title'));
  assert.equal(await page.locator('.sb-header-title').innerText(), 'Summary');
  await page.getByRole('progressbar', { name: 'Task completion' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Disclosure/Summary: singleton identity and focus, native details motion, lazy body, keyboard, record navigation, canonical progress, activity semantics, zh/en, themes and 320/390px passed.');
} finally {
  await browser?.close();
  await server.close();
}
