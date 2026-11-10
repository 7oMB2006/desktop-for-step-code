import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

let browser;
let bundle;
before(async () => {
  const output = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { CronManager } from './src/CronManager';
        window.mountManager = bridge => {
          const root = createRoot(document.getElementById('root'));
          root.render(<CronManager bridge={bridge}/>);
          window.unmountManager = () => root.unmount();
        };`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx',
    },
    bundle: true, write: false, outdir: 'test-results', platform: 'browser', format: 'iife',
  });
  bundle = output.outputFiles.find(file => file.path.endsWith('.js')).text;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

async function fixture(run) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => {
      const job = { key: 'task', id: 'one', runtimeId: 'host', workspace: 'project',
        cron: '0 9 * * *', prompt: 'Read/write regression', recurring: true, durable: true,
        createdAt: 100, nextFireAt: 200, autoExpireAt: 300, desktopPausedAt: 123 };
      const state = window.cronFixture = {
        job, reads: 0, updates: [], activeReads: 0, pendingReads: [], pendingWrites: [],
        holdReads: false, holdWrites: false, rejectWrite: false, rejectSnapshot: false, overlaps: 0,
        event: undefined,
      };
      window.mountManager({
        cronList: async () => {
          state.reads++;
          state.activeReads++;
          try {
            if (state.holdReads) await new Promise(resolve => state.pendingReads.push(resolve));
            return { tasks: [{ ...job }], hosts: [], issues: [] };
          } finally { state.activeReads--; }
        },
        snapshot: async () => {
          if (state.rejectSnapshot) throw new Error('Snapshot unavailable');
          return { sessions: [], preferences: {} };
        },
        onEvent: callback => { state.event = callback; return () => { state.event = undefined; }; },
        cronUpdate: async input => {
          state.updates.push(input);
          if (state.activeReads) { state.overlaps++; throw new Error('Cron host is busy; refresh and retry'); }
          if (state.holdWrites) await new Promise(resolve => state.pendingWrites.push(resolve));
          const revision = JSON.stringify([job.id, job.createdAt, job.cron, job.prompt, job.recurring,
            job.durable, job.autoExpireAt ?? null, job.desktopPausedAt ?? null]);
          if (input.expected !== revision) throw new Error('Cron task changed; refresh');
          if (state.rejectWrite) throw new Error('Unconfirmed write');
          if (input.paused) job.desktopPausedAt = 123;
          else delete job.desktopPausedAt;
        },
      });
    });
    await page.getByRole('button').filter({ hasText: 'Read/write regression' }).click();
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

const emit = page => page.evaluate(() => window.cronFixture.event({ type: 'desktop_cron_changed' }));
const releaseReads = page => page.evaluate(() => {
  const state = window.cronFixture;
  state.holdReads = false;
  state.pendingReads.splice(0).forEach(resolve => resolve());
});

test('Cron edits wait for an event-driven list read and coalesce subsequent refreshes', { timeout: 15000 }, async () => {
  await fixture(async page => {
    await page.evaluate(() => { window.cronFixture.holdReads = true; });
    await emit(page);
    await page.waitForFunction(() => window.cronFixture.pendingReads.length === 1);
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.scheduled-page').inert
      || window.cronFixture.updates.length > 0);
    assert.equal(await page.evaluate(() => window.cronFixture.updates.length), 0,
      'A user edit must not race an in-flight Cron list operation');
    await emit(page);
    await releaseReads(page);
    await page.getByRole('button', { name: '暂停任务 Beta', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.scheduled-page').inert);
    assert.deepEqual(await page.evaluate(() => ({
      writes: window.cronFixture.updates.length, overlaps: window.cronFixture.overlaps,
      alerts: document.querySelectorAll('[role="alert"]').length,
    })), { writes: 1, overlaps: 0, alerts: 0 });
  });
});

test('Cron events cannot start a read while an edit is unconfirmed', { timeout: 15000 }, async () => {
  await fixture(async page => {
    await page.clock.install();
    await page.evaluate(() => { window.cronFixture.holdWrites = true; });
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).click();
    await page.waitForFunction(() => window.cronFixture.pendingWrites.length === 1);
    const reads = await page.evaluate(() => window.cronFixture.reads);
    await emit(page);
    await page.clock.fastForward(180);
    assert.equal(await page.evaluate(() => window.cronFixture.reads), reads,
      'Background list refreshes must wait for a pending write');
    await page.evaluate(() => window.cronFixture.pendingWrites.splice(0).forEach(resolve => resolve()));
    await page.getByRole('button', { name: '暂停任务 Beta', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.scheduled-page').inert);
    assert.equal(await page.evaluate(() => window.cronFixture.updates.length), 1);
    assert.ok(await page.evaluate(() => window.cronFixture.reads) > reads);
  });
});

test('A failed snapshot cannot release a Cron list read that is still in flight', { timeout: 15000 }, async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      window.cronFixture.holdReads = true;
      window.cronFixture.rejectSnapshot = true;
    });
    await emit(page);
    await page.waitForFunction(() => window.cronFixture.pendingReads.length === 1);
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.scheduled-page').inert
      || window.cronFixture.updates.length > 0);
    assert.equal(await page.evaluate(() => window.cronFixture.updates.length), 0);
    await page.evaluate(() => { window.cronFixture.rejectSnapshot = false; });
    await releaseReads(page);
    await page.getByRole('button', { name: '暂停任务 Beta', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.cronFixture.overlaps), 0);
  });
});

test('Waiting for a Cron read never rebases an edit onto changed task content', { timeout: 15000 }, async () => {
  await fixture(async page => {
    await page.evaluate(() => { window.cronFixture.holdReads = true; });
    await emit(page);
    await page.waitForFunction(() => window.cronFixture.pendingReads.length === 1);
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).click();
    await page.evaluate(() => { window.cronFixture.job.prompt = 'Changed outside the editor'; });
    await releaseReads(page);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => window.cronFixture.updates.length), 1);
    assert.equal(await page.evaluate(() => window.cronFixture.job.desktopPausedAt), 123);
    assert.ok((await page.evaluate(() => window.cronFixture.updates[0].expected)).includes('Read/write regression'));
  });
});

test('Closing Cron management while draining a read cancels the pending edit', { timeout: 15000 }, async () => {
  await fixture(async page => {
    await page.evaluate(() => { window.cronFixture.holdReads = true; });
    await emit(page);
    await page.waitForFunction(() => window.cronFixture.pendingReads.length === 1);
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).click();
    await page.evaluate(() => window.unmountManager());
    await releaseReads(page);
    await page.waitForFunction(() => window.cronFixture.activeReads === 0);
    assert.equal(await page.evaluate(() => window.cronFixture.updates.length), 0);
  });
});

test('Cron edit failures are surfaced without retrying a possibly committed write', { timeout: 15000 }, async () => {
  await fixture(async page => {
    await page.evaluate(() => { window.cronFixture.rejectWrite = true; });
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).click();
    await page.getByRole('alert').waitFor();
    const reads = await page.evaluate(() => window.cronFixture.reads);
    await emit(page);
    await page.waitForFunction(reads => window.cronFixture.reads > reads, reads);
    assert.equal(await page.evaluate(() => window.cronFixture.updates.length), 1);
    assert.equal(await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).count(), 1);
  });
});
