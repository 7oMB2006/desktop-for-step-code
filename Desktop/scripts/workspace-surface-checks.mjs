import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { settleLayout } from './settle-layout.mjs';

// Compare empty workspace areas with a continuous reference plane, not just CSS values.
export async function checkWorkspaceCoverage(page, output, name, { regression = false } = {}) {
  const main = page.locator('main:visible');
  await settleLayout(main);
  await page.locator('.composer-input').blur();
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise(resolve => {
    let previous, stable = 0;
    const tick = () => {
      const style = document.querySelector('.custom-background-plane')?.getAttribute('style');
      stable = style === previous ? stable + 1 : 0; previous = style;
      if (stable >= 4) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const points = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
    const main = [...document.querySelectorAll('main')].find(element => !element.hidden).getBoundingClientRect();
    const shell = rect('.conversation-shell'), composer = rect('.composer');
    const points = [
      ['above-composer-junction', main.x + 5, shell.bottom - 5],
      ['below-composer-junction', main.x + 5, shell.bottom + 5],
      ['composer-gutter', main.x + 5, composer.y + composer.height / 2],
      ['footer', main.x + 5, main.bottom - 3],
    ];
    const track = rect('.summary-track'), board = rect('.summary-board');
    if (track?.width > 12 && board && board.bottom + 24 < track.bottom) {
      points.push(['below-summary', track.x + track.width / 2, board.bottom + 24],
        ['summary-footer', track.x + track.width / 2, track.bottom - 3],
        ['main-track-left', track.x - 5, track.bottom - 24],
        ['main-track-right', track.x + 5, track.bottom - 24]);
    }
    return points.map(([name, x, y]) => ({ name, x: Math.floor(x), y: Math.floor(y) }));
  });
  const reference = `
    :root[data-custom-background-surfaces=true] :is(main, .summary-track)::before {
      background: transparent; backdrop-filter: none;
    }
    .theme-workspace-background::after {
      content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none;
      background: color-mix(in srgb, var(--bg) var(--background-content-opacity), transparent);
      backdrop-filter: blur(var(--background-surface-blur));
    }`;
  const compare = async () => {
    const actual = await page.screenshot();
    const style = await page.addStyleTag({ content: reference });
    let expected;
    try { expected = await page.screenshot(); }
    finally { await style.evaluate(element => element.remove()); }
    return page.evaluate(async ({ actual, expected, points }) => {
      const read = async bytes => {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); image.close();
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [a, b] = await Promise.all([read(actual), read(expected)]);
      const scale = a.width / innerWidth;
      return points.map(point => {
        let difference = 0, samples = 0;
        const px = Math.floor(point.x * scale), py = Math.floor(point.y * scale);
        for (let y = py - 1; y <= py + 1; y++)
          for (let x = px - 1; x <= px + 1; x++)
            for (let channel = 0; channel < 3; channel++) {
              const index = (y * a.width + x) * 4 + channel;
              difference += Math.abs(a.data[index] - b.data[index]); samples++;
            }
        return { ...point, difference: difference / samples };
      });
    }, { actual: [...actual], expected: [...expected], points });
  };
  const measured = await compare();
  for (const point of measured)
    assert.ok(point.difference <= 3, `${name}/${point.name}: discontinuous workspace material (${point.difference})`);
  await page.screenshot({ path: join(output, `${name}.png`) });
  if (regression) {
    const legacy = await page.addStyleTag({ content: `
      :root[data-custom-background-surfaces=true] :is(main, .summary-track)::before {
        background: transparent; backdrop-filter: none;
      }
      :root[data-custom-background-surfaces=true] .conversation-shell { isolation: isolate; }
      :root[data-custom-background-surfaces=true] .conversation-shell::before {
        content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
        background: color-mix(in srgb, var(--bg) var(--background-content-opacity), transparent);
        backdrop-filter: blur(var(--background-surface-blur));
      }` });
    try {
      const broken = await compare();
      assert.ok(broken.filter(point => point.difference > 10).length >= 3,
        'The regression probe must detect the old composer/footer/summary gaps');
    } finally { await legacy.evaluate(element => element.remove()); }
  }
  return measured;
}

export async function verifyWorkspaceSurfaces(browser, base, output) {
  const results = {}, errors = [];
  const sampleBytes = await readFile(new URL('../../theme-marketplace/plugins/stellar-cruise/cover.png', import.meta.url));
  const sampleImage = { dataUrl: `data:image/png;base64,${sampleBytes.toString('base64')}`,
    width: sampleBytes.readUInt32BE(16), height: sampleBytes.readUInt32BE(20) };
  for (const surface of ['main', 'mini']) {
    const page = await browser.newPage({ viewport: surface === 'mini' ? { width: 460, height: 720 } : { width: 1440, height: 960 } });
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(({ surface, sampleImage }) => {
        const listeners = new Set();
        const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1000;
        const context = canvas.getContext('2d');
        // Deliberately sharp, bright texture exposes uncovered strips in either palette.
        for (let y = 0; y < canvas.height; y += 8) for (let x = 0; x < canvas.width; x += 8) {
          const band = Math.floor(x / 240) % 3;
          context.fillStyle = (x / 8 + y / 8) % 2
            ? ['#ebc854', '#f2a9ac', '#d1e99d'][band] : ['#328ebd', '#538a5c', '#bc5248'][band];
          context.fillRect(x, y, 8, 8);
        }
        let image = { dataUrl: canvas.toDataURL(), width: canvas.width, height: canvas.height };
        const options = { enabled: true, fit: 'cover', positionX: 50, positionY: 50, zoom: 100,
          brightness: 90, blur: 0, parallax: 0, contentTransparency: 30, sidebarTransparency: 20,
          panelTransparency: 20, composerTransparency: 10, surfaceBlur: 8 };
        const customBackground = { available: true, ref: 'fixture', options,
          image: { revision: 'fixture', width: image.width, height: image.height } };
        const messages = [
          { role: 'user', entryId: 'user', content: 'Check the main workspace and MiniChat.' },
          { role: 'assistant', entryId: 'assistant', content: [
            { type: 'text', text: '## Workspace acceptance\n\nThe conversation, composer gutters and summary space share a continuous reading surface.\n\n```ts\nconst profile = "isolated fixture";\n```' },
          ] },
        ];
        const snapshot = {
          preferences: { language: 'en', theme: 'light', workspaces: [], autoCheckUpdates: false },
          runtimeId: 'fixture-runtime', runtimeRevision: 1, status: 'connected',
          state: { sessionId: 'fixture-session', sessionName: 'Background acceptance', isStreaming: false },
          customBackground, messages, models: [], sessions: [{
            id: 'fixture-session', path: 'fixture.jsonl', cwd: 'D:\\Fixture', firstMessage: 'Background acceptance',
            modified: '2026-11-10T00:00:00Z', messageCount: messages.length, independent: true,
          }],
        };
        window.workspaceSurfaceFixture = {
          sample: () => {
            image = sampleImage;
            customBackground.image = { revision: 'sample', width: image.width, height: image.height };
            listeners.forEach(listener => listener({ type: 'desktop_custom_background', state: structuredClone(customBackground) }));
          },
          options: patch => {
            Object.assign(options, patch);
            listeners.forEach(listener => listener({ type: 'desktop_custom_background', state: structuredClone(customBackground) }));
          },
        };
        window.desktop = new Proxy({
          platform: 'win32', surface,
          onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
          onUpdateEvent: () => () => {}, onTerminalData: () => () => {},
          snapshot: async () => structuredClone(snapshot),
          capabilityCatalog: async () => ({ plugins: [], available: [], marketplaces: [], mcp: [], skills: [], warnings: [] }),
          settings: async () => ({ account: {}, profiles: [], mcp: {}, skills: [] }),
          systemTheme: async () => ({ systemDark: false }),
          miniChatState: async () => ({ open: surface === 'mini', pinned: false }),
          updateState: async () => ({ currentVersion: '0.6.0', status: 'idle', updateAvailable: false }),
          command: async () => ({ levels: [], commands: [] }),
          summary: async () => ({ sessionId: 'fixture-session', tasks: [], mcp: [], skillCount: 0 }),
          browserList: async () => ({ tabs: [] }),
          customBackgroundImage: async () => image,
        }, { get: (target, key) => key in target ? target[key] : () => Promise.resolve(undefined) });
      }, { surface, sampleImage });
      await page.goto(base);
      await page.locator('.message-body pre').waitFor();
      await page.waitForFunction(() => document.documentElement.dataset.customBackgroundSurfaces === 'true');
      await page.locator('.composer-input').fill('Keep this draft');
      const summary = page.locator('.right-tool-rail button[aria-controls="summary-board"]');
      if (surface === 'main' && await summary.getAttribute('aria-pressed') !== 'true') await summary.click();
      if (surface === 'main') await settleLayout(page.locator('.summary-board'));
      for (const theme of ['light', 'dark']) {
        await page.evaluate(async theme => { const { applyTheme } = await import('/src/theme.ts'); applyTheme(theme, false); }, theme);
        const name = `actual-${surface}-${theme}`;
        results[name] = await checkWorkspaceCoverage(page, output, name, { regression: theme === 'light' });
      }
      await page.evaluate(() => window.workspaceSurfaceFixture.sample());
      await page.waitForFunction(source => {
        const image = document.querySelector('.custom-background-plane img');
        return image?.src === source && image.complete && image.naturalWidth > 0;
      }, sampleImage.dataUrl);
      results[`${surface}-wallpaper`] = await checkWorkspaceCoverage(page, output, `actual-${surface}-wallpaper`);
      if (surface === 'main') {
        await page.locator('.window-sidebar-toggle').click();
        await settleLayout(page.locator('.app'));
        results.sidebarHidden = await checkWorkspaceCoverage(page, output, 'actual-main-sidebar-hidden');
        await summary.click();
        await settleLayout(page.locator('.app'));
        results.summaryClosed = await checkWorkspaceCoverage(page, output, 'actual-main-summary-closed');
        await page.setViewportSize({ width: 760, height: 880 });
        await settleLayout(page.locator('.app'));
        results.narrow = await checkWorkspaceCoverage(page, output, 'actual-main-narrow');
      }
      const before = await page.locator('main:visible').boundingBox();
      await page.evaluate(() => window.workspaceSurfaceFixture.options({
        contentTransparency: 100, composerTransparency: 100, surfaceBlur: 0,
      }));
      await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--background-content-opacity') === '0%');
      results[`${surface}-transparent`] = await checkWorkspaceCoverage(page, output, `actual-${surface}-transparent`);
      assert.deepEqual(await page.locator('main:visible').boundingBox(), before, 'Changing material never changes workspace bounds');
      assert.equal(await page.locator('.composer-input').innerText(), 'Keep this draft');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } catch (error) {
      await page.screenshot({ path: join(output, `actual-${surface}-failure.png`) }).catch(() => {});
      throw error;
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, [], 'The actual application shell must render without errors');
  return results;
}
