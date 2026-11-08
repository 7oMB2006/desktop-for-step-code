import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = process.env.PLUGIN_SHELL_OUTPUT || 'test-results/plugin-shell';
await mkdir(output, { recursive: true });
let server, browser;
const errors = [];
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    ...(process.env.DESKTOP_VERIFY_BROWSER ? { executablePath: process.env.DESKTOP_VERIFY_BROWSER } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const listeners = new Set();
    const plugin = (id, surface, ref = `${id}-ref-1`) => ({
      id, name: id === 'main-plugin' ? 'Main Guide' : 'Side Guide', version: '0.2.0',
      mcpServers: [], warnings: [],
      package: {
        ref, provenance: 'recorded', documentation: { readme: 'README.md' },
        tutorials: [], links: [], warnings: [],
        desktop: {
          title: id === 'main-plugin' ? 'Main Guide' : 'Side Guide', surface, symbol: 'bot',
          pages: [{ id: 'start', title: 'Start', document: 'docs/start.md' },
            { id: 'setup', title: 'Setup', document: 'docs/setup.md' }],
        },
      },
    });
    const catalog = {
      plugins: [plugin('main-plugin', 'main-view'), plugin('side-plugin', 'side-panel')],
      available: [], marketplaces: [], mcp: [], skills: [], warnings: [],
    };
    const messages = Array.from({ length: 36 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', entryId: `message-${index}`,
      content: `Conversation item ${index}\n\n${'Keep the reading position and main draft unchanged. '.repeat(12)}`,
    }));
    const snapshot = {
      preferences: { language: 'en', theme: 'light', workspaces: [] },
      runtimeId: 'fixture-runtime', status: 'connected', runtimeRevision: 1,
      state: { sessionId: 'fixture-session', sessionName: 'Retained conversation', isStreaming: false },
      messages, models: [], sessions: [{
        id: 'fixture-session', path: 'fixture.jsonl', cwd: 'D:\\Fixture', firstMessage: 'Retained conversation',
        modified: '2026-11-09T00:00:00Z', messageCount: messages.length, independent: true,
      }],
    };
    const fixture = window.pluginShellFixture = {
      catalog, plugin, manual: false, failure: false, pending: [], reads: [], calls: [],
      emit: type => listeners.forEach(listener => listener({ type })),
    };
    window.desktop = new Proxy({
      platform: 'win32', surface: 'main',
      onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      onUpdateEvent: () => () => {},
      onTerminalData: () => () => {},
      snapshot: async () => snapshot,
      capabilityCatalog: () => {
        if (fixture.manual) return new Promise((resolve, reject) => fixture.pending.push({ resolve, reject }));
        if (fixture.failure) return Promise.reject(new Error('PRIVATE_CATALOG_ERROR'));
        return Promise.resolve(structuredClone(fixture.catalog));
      },
      pluginDocument: async input => {
        fixture.reads.push(input);
        return { path: input.path, text: `# ${input.path}\n\nPackage ${input.ref}\n\n${'Retained plugin content.\n\n'.repeat(60)}`, images: {}, links: {} };
      },
      settings: async () => ({ account: {}, profiles: [], mcp: {}, skills: [] }),
      systemTheme: async () => ({ systemDark: false }),
      miniChatState: async () => ({ open: false, pinned: false }),
      updateState: async () => ({ currentVersion: '0.6.0', status: 'idle', updateAvailable: false }),
      command: async () => ({ levels: [], commands: [] }),
      summary: async () => ({ sessionId: 'fixture-session', tasks: [], mcp: [], skillCount: 0 }),
      browserList: async () => ({ tabs: [] }),
    }, { get: (target, key) => key in target ? target[key] : (...args) => {
      fixture.calls.push({ method: key, args });
      return Promise.resolve(undefined);
    } });
  });
  await page.goto(server.resolvedUrls.local[0]);
  const mainAction = page.getByRole('button', { name: 'Main Guide', exact: true });
  const sideAction = page.getByRole('button', { name: 'Side Guide', exact: true });
  const main = page.locator('[data-plugin-workspace="main-plugin"]');
  const side = page.locator('[data-plugin-workspace="side-plugin"]');
  const composer = page.locator('main .composer-input');
  const conversation = page.locator('#conversation-scroll');
  await mainAction.waitFor();
  await composer.fill('KEEP THE MAIN DRAFT');
  await conversation.hover();
  await page.mouse.wheel(0, -2400);
  await page.waitForTimeout(100);
  const scrollBefore = await conversation.evaluate(element => element.scrollTop);
  assert.ok(scrollBefore > 0);
  await mainAction.click();
  await main.getByRole('heading', { name: 'docs/start.md', exact: true }).waitFor();
  assert.equal(await page.locator('main:visible').count(), 1, 'one visible main surface');
  assert.equal(await page.getByRole('region', { name: 'Plugin center', exact: true }).count(), 0);
  await main.getByRole('tab', { name: 'Setup', exact: true }).click();
  await main.getByRole('heading', { name: 'docs/setup.md', exact: true }).waitFor();
  await main.getByRole('tabpanel').evaluate(element => { element.scrollTop = 500; });
  await main.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await composer.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-plugin-action') === 'main-plugin');
  assert.equal(await composer.innerText(), 'KEEP THE MAIN DRAFT');
  const scrollAfter = await conversation.evaluate(element => element.scrollTop);
  assert.ok(Math.abs(scrollBefore - scrollAfter) < 2, `reading position survives main hide/reopen (${scrollBefore} -> ${scrollAfter})`);
  await mainAction.click();
  assert.equal(await main.getByRole('tab', { name: 'Setup', exact: true }).getAttribute('aria-selected'), 'true');
  assert.ok(await main.getByRole('tabpanel').evaluate(element => element.scrollTop) > 400);
  await sideAction.click();
  await side.getByRole('heading', { name: 'docs/start.md', exact: true }).waitFor();
  assert.equal(await composer.innerText(), 'KEEP THE MAIN DRAFT');
  assert.equal(await main.isVisible(), false);
  await page.keyboard.press('Escape');
  await side.waitFor({ state: 'hidden' });
  assert.equal(await sideAction.evaluate(element => element === document.activeElement), true, 'side close restores its titlebar opener');
  await sideAction.click();
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  await side.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  const center = page.getByRole('region', { name: 'Plugin center', exact: true });
  await center.getByRole('button', { name: 'Read Main Guide guide', exact: true }).click();
  await center.getByRole('button', { name: 'Open Main Guide', exact: true }).click();
  await main.getByRole('heading', { name: 'docs/setup.md', exact: true }).waitFor();
  assert.equal(await center.isVisible(), false, 'installed detail opens the plugin workspace instead of overlapping it');
  assert.equal(await page.locator('main:visible').count(), 1);
  await page.screenshot({ path: `${output}/main-shell.png`, fullPage: true });
  const previousReads = await page.evaluate(() => window.pluginShellFixture.reads.length);
  await page.evaluate(() => {
    const fixture = window.pluginShellFixture;
    fixture.catalog.plugins[0] = fixture.plugin('main-plugin', 'main-view', 'main-ref-2');
    fixture.emit('desktop_plugin_catalog_changed');
  });
  await page.waitForFunction(count => window.pluginShellFixture.reads.length > count, previousReads);
  await main.getByRole('heading', { name: 'docs/start.md', exact: true }).waitFor();
  assert.ok((await main.innerText()).includes('main-ref-2'), 'changed package ref remounts stale readers');
  assert.equal(await main.getByRole('tab', { name: 'Start', exact: true }).getAttribute('aria-selected'), 'true');
  await page.evaluate(() => {
    window.pluginShellFixture.manual = true;
    window.pluginShellFixture.emit('desktop_plugin_catalog_changed');
  });
  await page.waitForFunction(() => window.pluginShellFixture.pending.length === 1);
  await page.evaluate(() => window.pluginShellFixture.emit('desktop_plugin_catalog_changed'));
  await page.waitForFunction(() => window.pluginShellFixture.pending.length === 2);
  await page.evaluate(() => {
    const fixture = window.pluginShellFixture;
    fixture.pending[1].resolve(structuredClone(fixture.catalog));
    fixture.pending[0].reject(new Error('STALE_PRIVATE_ERROR'));
  });
  await page.waitForTimeout(50);
  assert.equal(await main.isVisible(), true, 'stale catalog failure cannot clear a newer successful refresh');
  await page.evaluate(() => {
    const fixture = window.pluginShellFixture;
    fixture.manual = false; fixture.failure = true;
    fixture.emit('desktop_plugin_catalog_changed');
  });
  await main.waitFor({ state: 'detached' });
  assert.equal(await page.locator('main:visible').count(), 1, 'catalog failure leaves one non-stale main surface');
  assert.equal(await mainAction.count(), 0, 'failed catalog clears stale titlebar actions');
  assert.equal(await composer.innerText(), 'KEEP THE MAIN DRAFT');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, screenshots: output, checks: [
    'single visible main', 'real composer draft retention', 'reading-position retention',
    'workspace tab/scroll retention', 'main/side return focus', 'official right-tool replacement', 'installed-detail entry',
    'package ref remount', 'catalog race protection', 'failed refresh stale-content removal',
  ] }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
}
