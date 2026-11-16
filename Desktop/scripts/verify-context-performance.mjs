import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { _electron as electron } from 'playwright';
import { mkdtemp } from './test-profile.mjs';

const executablePath = process.env.DESKTOP_VERIFY_EXE;
const renderer = process.env.DESKTOP_PERF_RENDERER;
const variant = process.env.DESKTOP_PERF_VARIANT ?? (renderer ? 'virtual' : 'baseline');
assert.ok(['baseline', 'virtual'].includes(variant), 'DESKTOP_PERF_VARIANT must be baseline or virtual');
const dense = process.env.DESKTOP_PERF_DENSE === '1';
const disableBackdrop = process.env.DESKTOP_PERF_DISABLE_BACKDROP === '1';
const warmDisclosures = Number(process.env.DESKTOP_PERF_WARM_DISCLOSURES ?? 0);
assert.ok(Number.isInteger(warmDisclosures) && warmDisclosures >= 0 && warmDisclosures <= 300);
const output = resolve(process.env.DESKTOP_PERF_OUTPUT ?? 'test-results/context-performance');
const profile = await mkdtemp(join(tmpdir(), 'step-context-performance-'));
await mkdir(output, { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'dark', workspaces: [], autoCheckUpdates: false,
}));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'],
  env, timeout: 60000,
});

function syntheticMessages() {
  const messages = [];
  const now = Date.now() - 1112 * 1000;
  const add = value => messages.push({ ...value, entryId: `context-perf-${messages.length}`,
    timestamp: now + messages.length * 1000 });
  const usage = { input: 2180, output: 1157, cacheRead: 800768, cacheWrite: 0, totalTokens: 804105 };
  let assistants = 0, tools = 0;
  for (let turn = 0; turn < 39; turn++) {
    add({ role: 'user', content: `Fixture request ${turn + 1}: inspect the local event sequence and run focused tests.` });
    const count = Math.floor(484 / 39) + (turn < 484 % 39 ? 1 : 0);
    for (let step = 0; step < count; step++) {
      const calls = tools < 204 ? 2 : 1;
      const last = step === count - 1;
      const content = [{ type: 'thinking', thinking: 'Inspect the event boundary and preserve message ordering. '.repeat(8) }];
      if (last || dense) content.push({ type: 'text', text: `## Fixture response ${turn + 1}.${step + 1}\n\n`
        + 'The event ordering is stable. Keep the change scoped to the presentation boundary.\n\n'.repeat(12)
        + '- Local fixtures passed.\n- Provider acceptance was not attempted.\n'
        + (dense ? '\n```ts\nexport function inspectEvent(event: Event) {\n'
          + '  const sequence = event.sequence;\n  return { sequence, complete: true };\n}\n```\n\n'
          + '| Event | State |\n| --- | --- |\n| Start | Ready |\n| End | Complete |\n\n' : '') });
      for (let call = 0; call < calls && tools + call < 586; call++) content.push({
        type: 'toolCall', id: `call-${tools + call}`, name: 'run_command',
        arguments: { command: 'node --test focused.test.mjs' },
      });
      add({ role: 'assistant', provider: 'step', model: 'step-5-preview', content, usage,
        stopReason: last ? 'stop' : 'toolUse' });
      assistants++;
      for (let call = 0; call < calls && tools < 586; call++) {
        const tool = tools++;
        add({ role: 'toolResult', toolCallId: `call-${tool}`, toolName: 'run_command',
          content: [{ type: 'text', text: `Fixture output ${tool}\n`
            + 'PASS local event ordering and isolated presentation checks.\n'.repeat(tool % 20 === 0 ? 1500 : 70) }] });
      }
    }
  }
  for (let index = 0; index < 3; index++) add({ role: 'compactionSummary', content: 'Synthetic summary.' });
  assert.equal(assistants, 484);
  assert.equal(tools, 586);
  assert.equal(messages.length, 1112);
  return messages;
}

function traceSummary(events) {
  const names = ['RunTask', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Commit',
    'RasterTask', 'MinorGC', 'MajorGC', 'V8.GC_SCAVENGER', 'V8.GC_MARK_COMPACTOR'];
  const threads = events.filter(event => event.ph === 'M' && event.name === 'thread_name');
  const renderer = threads.find(event => event.args.name === 'CrRendererMain');
  assert.ok(renderer, 'Trace must identify the renderer main thread');
  const actions = events.filter(event => /^((open|close)-\d+)-start$/.test(event.name)).map(start => {
    const label = start.name.slice(0, -'-start'.length);
    const end = events.find(event => event.name === `${label}-end`);
    assert.ok(end, `Missing timing boundary: ${label}`);
    return { label, start: start.ts, end: end.ts };
  });
  assert.equal(actions.length, 6);
  return {
    renderer: { pid: renderer.pid, tid: renderer.tid },
    actions: actions.map(({ label, start, end }) => ({
      label, wallMs: (end - start) / 1000,
      mainThread: Object.fromEntries(names.map(name => {
        const values = events.filter(event => event.pid === renderer.pid && event.tid === renderer.tid
          && event.name === name && event.ph === 'X' && event.ts < end && event.ts + (event.dur ?? 0) > start)
          .map(event => Math.max(0, Math.min(end, event.ts + (event.dur ?? 0)) - Math.max(start, event.ts)) / 1000);
        return [name, { count: values.length, totalMs: +values.reduce((a, b) => a + b, 0).toFixed(2),
          maxMs: +Math.max(0, ...values).toFixed(2) }];
      })),
    })),
  };
}

function cpuSummary(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const times = new Map();
  for (let index = 0; index < (profile.samples?.length ?? 0); index++) {
    const id = profile.samples[index];
    times.set(id, (times.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
  }
  return [...times].map(([id, microseconds]) => ({
    name: nodes.get(id)?.callFrame.functionName || '(anonymous)',
    url: nodes.get(id)?.callFrame.url,
    line: (nodes.get(id)?.callFrame.lineNumber ?? -1) + 1, selfMs: +(microseconds / 1000).toFixed(2),
  })).sort((a, b) => b.selfMs - a.selfMs).slice(0, 18);
}

async function readTrace(client) {
  const complete = new Promise(resolve => client.once('Tracing.tracingComplete', resolve));
  await client.send('Tracing.end');
  const { stream } = await complete;
  let text = '';
  for (;;) {
    const result = await client.send('IO.read', { handle: stream });
    text += result.base64Encoded ? Buffer.from(result.data, 'base64').toString() : result.data;
    if (result.eof) break;
  }
  await client.send('IO.close', { handle: stream });
  return text;
}

try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.setSize(1920, 1032);
    window.showInactive();
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.desktop), undefined, { timeout: 60000 });
  const original = await page.evaluate(() => window.desktop.snapshot());
  const messages = syntheticMessages();
  const fixture = {
    ...original, draftId: undefined, runtimeId: 'context-perf-runtime', status: 'connected', firstRun: { required: false },
    preferences: { ...original.preferences, language: 'zh', theme: 'dark', workspaces: ['D:/fixture'],
      workspace: 'D:/fixture', appearance: { uiFont: 'system', bodyFont: 'yahei', codeFont: 'consolas',
        uiSize: 14, bodySize: 16, codeSize: 12, lineHeight: 1.75 } },
    state: { sessionId: 'context-perf-session', sessionName: 'Long context fixture', isStreaming: false,
      model: { id: 'step-5-preview', name: 'step-5-preview', provider: 'step', contextWindow: 1024000 } },
    sessions: [{ id: 'context-perf-session', name: 'Long context fixture', path: 'D:/fixture/session.jsonl',
      cwd: 'D:/fixture', firstMessage: 'Synthetic performance fixture', modified: new Date().toISOString(), messageCount: 1112 }],
    messages, requests: [], pendingMessages: [], themePacks: [],
    stats: { toolCalls: 586, assistantMessages: 484, userMessages: 39, toolResults: 586, totalMessages: 1112,
      tokens: { input: 2180, output: 1157, cacheRead: 800768, cacheWrite: 0, total: 226645693 },
      contextUsage: { tokens: 803405, contextWindow: 1024000, percent: 78.5 } },
  };
  let image;
  if (process.env.DESKTOP_PERF_BACKGROUND) {
    const data = await readFile(process.env.DESKTOP_PERF_BACKGROUND);
    image = { dataUrl: `data:image/png;base64,${data.toString('base64')}`, width: 1672, height: 941 };
  }
  await app.evaluate(({ ipcMain }, { fixture, image }) => {
    globalThis.contextPerfFixture = fixture;
    globalThis.contextPerfImage = image;
    globalThis.contextPerfCalls = [];
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      globalThis.contextPerfCalls.push(method);
      if (method === 'snapshot') return globalThis.contextPerfFixture;
      if (method === 'preferences') {
        Object.assign(globalThis.contextPerfFixture.preferences, args[0]);
        return globalThis.contextPerfFixture.preferences;
      }
      if (method === 'customBackgroundImage') return globalThis.contextPerfImage;
      if (method === 'summary') return { sessionId: 'context-perf-session', tasks: [], mcp: [], skillCount: 0 };
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: ['off', 'high'] };
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      if (method === 'settings') return { account: { loggedIn: false, validity: 'unknown' }, profiles: [], mcp: {}, skills: [] };
      return {};
    });
  }, { fixture, image });
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 1000 });
  const results = [];
  const modes = process.env.DESKTOP_PERF_MODES?.split(',')
    ?? (image ? ['solid', 'image-static', 'image-parallax'] : ['solid']);
  for (const mode of modes) {
    await app.evaluate((_electron, mode) => {
      globalThis.contextPerfFixture.customBackground = mode === 'solid' ? undefined : {
        available: true, image: { revision: 'perf-image', width: 1672, height: 941 },
        options: { enabled: true, fit: 'cover', positionX: 50, positionY: 50, zoom: 100, brightness: 59,
          blur: 0, parallax: mode === 'image-parallax' ? 12 : 0, contentTransparency: 70,
          sidebarTransparency: 20, panelTransparency: 20, composerTransparency: 10, surfaceBlur: 0 },
      };
    }, mode);
    if (renderer) await app.evaluate(({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), resolve(renderer));
    else await page.reload();
    await page.locator('.composer > .composer-input').waitFor();
    await page.locator('.messages > article').last().waitFor();
    if (disableBackdrop) await page.addStyleTag({ content:
      ':root[data-custom-background-surfaces=true] :is(.sidebar,main,.summary-track,.composer,.right-tool-rail,'
      + '.summary-board,.context-panel,.conversation-nav-panel,.btw-panel,.file-preview-panel,.browser-panel,'
      + '.terminal-panel,.review-panel,.subagent-panel,.plugin-side-surface)::before{backdrop-filter:none!important}',
    });
    await page.waitForTimeout(1200);
    const warmed = await page.evaluate(async count => {
      if (!count) return 0;
      const thinking = [...document.querySelectorAll('.messages .thinking > summary')].slice(0, count);
      const tools = [...document.querySelectorAll('.messages .process-tool > summary')].slice(0, count);
      const summaries = [...thinking, ...tools];
      for (const summary of summaries) summary.click();
      await new Promise(resolve => setTimeout(resolve, 700));
      for (const summary of summaries) {
        if (summary.parentElement.dataset.expanded === 'true') summary.click();
      }
      await new Promise(resolve => setTimeout(resolve, 700));
      return summaries.length;
    }, warmDisclosures);
    await page.evaluate(() => {
      const viewport = document.querySelector('#conversation-scroll');
      viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight - 320;
    });
    await page.waitForTimeout(400);
    const metricsBefore = await client.send('Performance.getMetrics');
    await client.send('Tracing.start', {
      categories: 'devtools.timeline,v8,blink,blink.user_timing,cc,gpu,disabled-by-default-devtools.timeline,disabled-by-default-v8.gc',
      transferMode: 'ReturnAsStream',
    });
    await client.send('Profiler.start');
    const samples = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const action of ['open', 'close']) {
        const sample = await page.evaluate(async ({ action, cycle }) => {
          const label = `${action}-${cycle}`;
          const tasks = [];
          const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => ({
            start: entry.startTime, duration: entry.duration,
          }))));
          observer.observe({ type: 'longtask', buffered: false });
          const frames = [];
          let pointerEvents = 0;
          let last = performance.now();
          const start = last;
          performance.mark(`${label}-start`);
          document.querySelector('.right-tool-rail button[aria-label="\u4e0a\u4e0b\u6587"]').click();
          await new Promise(resolve => {
            function frame() {
              const now = performance.now();
              frames.push(now - last);
              last = now;
              if (frames.length === 1) performance.mark(`${label}-next-frame`);
              window.dispatchEvent(new PointerEvent('pointermove', {
                clientX: 600 + Math.sin(now / 180) * 300, clientY: 400 + Math.cos(now / 180) * 250,
              }));
              pointerEvents++;
              if (now - start < 1200) requestAnimationFrame(frame);
              else resolve();
            }
            requestAnimationFrame(frame);
          });
          await new Promise(resolve => setTimeout(resolve, 30));
          performance.mark(`${label}-end`);
          observer.disconnect();
          return { action, cycle, frameCount: frames.length, maxFrameMs: Math.max(...frames),
            firstFrameMs: frames[0],
            framesOver50: frames.filter(value => value > 50).length, pointerEvents,
            longTasks: tasks, rows: document.querySelectorAll('.context-message').length,
            articles: document.querySelectorAll('.messages > article').length,
            nodes: document.querySelectorAll('*').length,
            customBackground: document.documentElement.dataset.customBackgroundSurfaces,
            layoutWindow: document.querySelector('#conversation-scroll')?.dataset.layoutWindow };
        }, { action, cycle });
        assert.equal(sample.rows > 0, action === 'open');
        if (action === 'open') {
          if (variant === 'virtual') assert.ok(sample.rows <= 50, 'The optimized inspector mounts only the visible window and overscan');
          else assert.equal(sample.rows, messages.length, 'The baseline inspector mounts the entire fixture');
        }
        samples.push(sample);
      }
    }
    const { profile: cpu } = await client.send('Profiler.stop');
    const text = await readTrace(client);
    const metricsAfter = await client.send('Performance.getMetrics');
    const previous = new Map(metricsBefore.metrics.map(metric => [metric.name, metric.value]));
    const metrics = Object.fromEntries(metricsAfter.metrics.filter(metric => [
      'TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize', 'Nodes',
    ].includes(metric.name)).map(metric => [metric.name, { value: metric.value, delta: metric.value - (previous.get(metric.name) ?? 0) }]));
    const result = { mode, warmed, samples, metrics, trace: traceSummary(JSON.parse(text).traceEvents), cpu: cpuSummary(cpu) };
    results.push(result);
    await writeFile(join(output, `${mode}.trace.json.gz`), gzipSync(text));
    await writeFile(join(output, `${mode}.cpu.json.gz`), gzipSync(JSON.stringify(cpu)));
    await page.locator('.right-tool-rail button[aria-label="\u4e0a\u4e0b\u6587"]').click();
    await page.screenshot({ path: join(output, `${mode}.png`) });
    console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({
    synthetic: true, variant, dense, disableBackdrop, warmDisclosures, messages: messages.length, textBytes: Buffer.byteLength(JSON.stringify(messages)), renderer,
    executablePath, windowOpacity: 0, note: 'Isolated renderer benchmark, not an operating-system stall reproduction.',
    results, errors,
  }, null, 2));
  console.log(`Context performance evidence: ${output}`);
} finally {
  await app.close();
}
