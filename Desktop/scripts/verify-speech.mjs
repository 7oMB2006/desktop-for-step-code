import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { createPatch } from 'diff';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { sampleMotion } from './sample-motion.mjs';
import { settleLayout } from './settle-layout.mjs';

const evidence = resolve(process.env.DESKTOP_SPEECH_EVIDENCE || 'test-results/speech');
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(evidence, 'profile-'));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'original-dark', workspaces: [] }));
await writeFile(join(root, 'auth.json'), JSON.stringify({ step: {
  type: 'oauth', profile: 'step_plan', access: 'speech-fixture-plan-key', expires: Date.now() + 3600000,
} }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "step"\ndefaultModel = "step-5-preview"\n[telemetry]\nenabled = false\n');
// Loop a voiced PCM fixture so short recordings do not depend on the default
// fake microphone's timing and actually exercise ASR rather than silent discard.
const microphone = join(profile, 'microphone.wav');
const wav = Buffer.alloc(44 + 16000 * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let sample = 0; sample < 16000; sample++) {
  wav.writeInt16LE(Math.round(0.2 * 32767 * Math.sin(2 * Math.PI * 440 * sample / 16000)), 44 + sample * 2);
}
await writeFile(microphone, wav);
let mode = 'ok';
const calls = [], failures = [];
const server = createServer(async (request, response) => {
  try {
    const proxy = new URL(request.url, 'http://fixture');
    const url = proxy.searchParams.has('url') ? new URL(proxy.searchParams.get('url')) : proxy;
    if (url.pathname.endsWith('/models')) {
      response.end(JSON.stringify({ data: [{ id: 'step-5-preview', name: 'Offline fixture' }] })); return;
    }
    if (url.pathname.includes('/models/')) {
      response.end(JSON.stringify({ id: 'step-5-preview', enable_reason: false, reasoning_effort_support_list: ['off'] })); return;
    }
    if (url.pathname.endsWith('/accounts')) {
      response.end(JSON.stringify({ object: 'account', type: 'prepaid', balance: 12 })); return;
    }
    if (url.pathname === '/step_plan/v1/usage') {
      response.writeHead(404); response.end('{}'); return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const asr = url.pathname.endsWith('/audio/asr/sse');
    assert.ok(asr || url.pathname === '/v1/audio/transcriptions', `Unexpected fixture route: ${url.origin}${url.pathname}`);
    if (asr) {
      const body = JSON.parse(raw.toString('utf8'));
      assert.equal(body.audio.input.transcription.model, 'stepaudio-2.5-asr');
      assert.equal(Buffer.from(body.audio.data, 'base64').toString('ascii', 0, 4), 'RIFF');
      assert.ok(Buffer.from(body.audio.data, 'base64').length <= 44 + 4 * 32000, 'Only a short, non-cumulative segment is uploaded');
      const expected = url.pathname.includes('/step_plan/') ? 'speech-fixture-plan-key' : 'speech-fixture-oversea-key';
      assert.equal(request.headers.authorization, `Bearer ${expected}`);
      calls.push({ url: url.href, protocol: 'step-sse' });
    } else {
      assert.equal(request.headers.authorization, 'Bearer speech-fixture-custom-key');
      assert.ok(raw.includes(Buffer.from('RIFF')));
      assert.ok(raw.includes(Buffer.from('fixture-independent-model')));
      calls.push({ url: url.pathname, protocol: 'multipart' });
    }
    if (mode === 'hold') { await new Promise(done => response.once('close', done)); return; }
    response.writeHead(mode === 'error' ? 401 : 200, { 'content-type': asr ? 'text/event-stream' : 'application/json' });
    response.end(mode === 'error' ? 'private upstream diagnostic'
      : asr ? 'data: {"type":"transcript.text.done","text":"语音输入验收文本"}\n\n'
        : JSON.stringify({ text: '独立模型验收文本' }));
  } catch (error) {
    failures.push(String(error));
    response.writeHead(500); response.end('{}');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const preload = join(profile, 'loopback.cjs'), entry = join(profile, 'entry.cjs');
await writeFile(preload, `
let transport = globalThis.fetch;
const route = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === '127.0.0.1') return transport(input, init);
  if (!['api.stepfun.com', 'api.stepfun.ai'].includes(url.hostname)) throw new Error('External fixture request blocked');
  return transport(${JSON.stringify(base)} + '/?url=' + encodeURIComponent(url.href), init);
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => route,
  set: value => { if (value !== route) transport = value; } });
`);
await writeFile(entry, `
const { app, net, ipcMain } = require('electron');
// Playwright's loader replaces --disable-features before loading this entry.
// Merge here so only the fixture audio utility can read the synthetic WAV.
const disabled = new Set(app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean));
disabled.add('AudioServiceSandbox');
app.commandLine.appendSwitch('disable-features', [...disabled].join(','));
const handle = ipcMain.handle;
ipcMain.handle = function(channel, handler) {
  if (channel !== 'desktop') return handle.call(this, channel, handler);
  return handle.call(this, channel, async (event, method, ...args) => {
    const result = await handler(event, method, ...args);
    const gate = globalThis.speechSettingsGate;
    if (method === 'speechSettings' && gate) { gate.entered = true; await gate.promise; }
    return result;
  });
};
const cp = require('node:child_process'), spawn = cp.spawn;
cp.spawn = function(file, args, options) {
  if (args?.some(arg => /(?:admin\\.mjs|step\\.js)$/.test(arg))) args = ['--require', ${JSON.stringify(preload)}, ...args];
  return spawn.call(this, file, args, options);
};
require('node:module').syncBuiltinESMExports();
require(${JSON.stringify(preload)});
net.fetch = (input, init) => globalThis.fetch(input, init);
require(${JSON.stringify(resolve('dist/main.cjs'))});
`);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  DESKTOP_STEPPAGE_BUNDLE: join(profile, 'no-personal-steppage.mjs') };
for (const key of Object.keys(env)) {
  if (/^(ELECTRON_RUN_AS_NODE|DESKTOP_DEV_URL|NODE_OPTIONS|STEP|PI_|AI_AGENT)/i.test(key)
    || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|COOKIE)$/i.test(key)) delete env[key];
}
let app, page;
const errors = [];
const nativeAudioErrors = [];
const audioProcesses = () => app.evaluate(({ app }) => app.getAppMetrics()
  .filter(process => process.name === 'Audio Service' || process.serviceName === 'audio.mojom.AudioService')
  .map(({ type, name, serviceName, sandboxed }) => ({ type, name, serviceName, sandboxed })));
const launch = async () => {
  app = await electron.launch({ args: [entry, '--use-fake-device-for-media-stream',
    '--enable-logging=stderr',
    `--use-file-for-fake-audio-capture=${microphone}`], env, timeout: 60000 });
  const stderr = app.process().stderr;
  if (stderr) createInterface({ input: stderr }).on('line', line => {
    if (/Failed to read .*as input to the fake device|Input file to fake device|WAV data could be read but is not valid/.test(line)) {
      if (nativeAudioErrors.length < 10) nativeAudioErrors.push(line.replaceAll(profile, '<fixture-profile>'));
    }
  });
  page = await app.firstWindow();
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => {
    const { sandbox, contextIsolation, nodeIntegration } = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox, contextIsolation, nodeIntegration };
  }), { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.equal(await app.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')), false);
  assert.equal(await app.evaluate(({ app }) =>
    app.commandLine.getSwitchValue('disable-features').split(',').includes('AudioServiceSandbox')), true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
  });
  await input().waitFor();
  assert.equal(await app.evaluate(({ app, BrowserWindow }) => {
    const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId();
    return app.getAppMetrics().find(process => process.pid === pid)?.sandboxed;
  }), true, 'The renderer must retain its OS-level sandbox');
  await page.waitForFunction(() => document.querySelector('.composer-input')?.getAttribute('aria-disabled') === 'false');
  await page.evaluate(() => {
    const media = navigator.mediaDevices, getUserMedia = media.getUserMedia.bind(media);
    window.__speechFixtureTracks = [];
    // Chromium recommends unprocessed input for WAV-backed fake microphones.
    // Keep native permission/capture; only prevent speech filters from removing the test tone.
    media.getUserMedia = async constraints => {
      const stream = await getUserMedia({ ...constraints, audio: constraints.audio ? {
        ...(typeof constraints.audio === 'object' ? constraints.audio : {}),
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      } : constraints.audio });
      for (const track of stream.getAudioTracks()) {
        const { echoCancellation, noiseSuppression, autoGainControl, sampleRate, channelCount } = track.getSettings();
        window.__speechFixtureTracks.push({ echoCancellation, noiseSuppression, autoGainControl, sampleRate, channelCount });
      }
      return stream;
    };
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(...args) {
        super(...args);
        if (args[1] !== 'desktop-speech-capture') return;
        const capture = { samples: 0, voicedSamples: 0, maxRms: 0 };
        window.__speechFixtureCapture = capture;
        // Observe the production worklet without replacing capture or transcription.
        this.port.addEventListener('message', ({ data }) => {
          if (data?.type !== 'samples') return;
          capture.samples += data.samples.length;
          let energy = 0;
          for (const sample of data.samples) energy += sample * sample;
          const rms = Math.sqrt(energy / Math.max(1, data.samples.length));
          capture.maxRms = Math.max(capture.maxRms, rms);
          if (rms >= 0.01) capture.voicedSamples += data.samples.length;
        });
      }
    };
  });
};
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const settingsValue = () => page.evaluate(() => window.desktop.speechSettings());
const input = () => page.getByRole('textbox', { name: /^(消息|Message)$/ });
const text = () => input().innerText();
const begin = async () => {
  await page.getByRole('button', { name: '语音听写', exact: true }).click();
  await page.getByRole('button', { name: '结束听写', exact: true }).waitFor();
};
const finish = async () => {
  const voiced = await page.evaluate(() => window.__speechFixtureCapture.voicedSamples);
  await page.waitForFunction(voiced => window.__speechFixtureCapture.voicedSamples >= voiced + 6400, voiced, { timeout: 20000 });
  await page.getByRole('button', { name: '结束听写', exact: true }).click();
};
const until = async (condition, label, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (!await condition()) {
    assert.deepEqual(failures, []);
    assert.deepEqual(nativeAudioErrors, []);
    assert.ok(Date.now() < end, label);
    await new Promise(done => setTimeout(done, 30));
  }
};
const configure = async () => {
  // Hold the real IPC result until the loading state is observed, then require
  // loaded controls rather than treating the unconditional heading as readiness.
  await app.evaluate(() => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    globalThis.speechSettingsGate = { promise, release, entered: false };
  });
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('heading', { name: '语音听写', exact: true }).waitFor();
  await page.locator('.speech-settings').getByText('加载中…', { exact: true }).waitFor();
  await until(() => app.evaluate(() => Boolean(globalThis.speechSettingsGate?.entered)), 'Settings read did not reach the real IPC handler');
  await app.evaluate(() => { globalThis.speechSettingsGate.release(); delete globalThis.speechSettingsGate; });
  await page.locator('.speech-settings').getByLabel('识别服务', { exact: true }).waitFor();
};
const closeSettings = async () => {
  await page.locator('.settings-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'hidden' });
};
const permission = () => page.evaluate(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop()); return true;
  } catch { return false; }
});
const statusDoesNotOverlap = () => page.locator('.speech-progress[data-open=true]').evaluate(element => {
  const wrap = element.closest('.composer-wrap');
  const composer = wrap.querySelector('.composer');
  const status = element.getBoundingClientRect();
  const editor = composer.querySelector('.composer-input').getBoundingClientRect();
  const tools = composer.querySelector('.composer-tools').getBoundingClientRect();
  const parent = composer.getBoundingClientRect();
  const bar = element.closest('.composer-context-bar')?.getBoundingClientRect();
  return Boolean(element.parentElement.matches('.composer-context-center') && bar?.height === 34
    && status.bottom <= parent.top - 4 && status.bottom <= editor.top && status.bottom <= tools.top
    && status.left >= parent.left && status.right <= parent.right);
});
const geometry = () => page.locator('.composer').evaluate(element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
});
const assertGeometry = async before => {
  const after = await geometry();
  for (const key of Object.keys(before)) assert.ok(Math.abs(before[key] - after[key]) < .5,
    `Dictation must not move or resize the composer: ${JSON.stringify({ before, after })}`);
};
const checkContextRow = async split => {
  await settleLayout(page.locator('.composer-context-center'));
  assert.equal(await statusDoesNotOverlap(), true);
  const boxes = await page.locator('.composer-context-bar').evaluate(element => {
    const read = e => { const { x, y, width, height, right, bottom } = e.getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
    return {
      bar: read(element), center: read(element.querySelector('.composer-context-center')),
      status: read(element.querySelector('.speech-progress')),
      diff: element.querySelector('.live-turn-context') ? read(element.querySelector('.live-turn-context')) : null,
      controls: [...element.querySelectorAll('.quote-chip, .queue-trigger, .live-turn-chip, .speech-progress-body, .jump-to-bottom')].map(read),
    };
  });
  if (!await page.locator('.queue-trigger').count()) assert.ok(Math.abs(boxes.center.x + boxes.center.width / 2 - boxes.bar.x - boxes.bar.width / 2) < 1,
    'Dictation and changes share the centered context slot');
  if (split) {
    assert.ok(boxes.diff && Math.abs(boxes.diff.width - boxes.status.width) < 1, 'Diff and dictation get equal halves');
    assert.ok(boxes.diff.right <= boxes.status.x, 'Diff and dictation must not overlap');
  }
  for (const [index, box] of boxes.controls.entries()) {
    assert.ok(box.x >= boxes.bar.x - 1 && box.right <= boxes.bar.right + 1, 'Context controls stay within the row');
    for (const other of boxes.controls.slice(index + 1)) assert.ok(box.right <= other.x + .5 || other.right <= box.x + .5,
      `Context controls must not overlap: ${JSON.stringify(boxes)}`);
  }
  return boxes;
};
const motionOptions = (label, open) => ({
  label, state: { selector: '.speech-progress', attribute: 'data-open', value: String(open) },
  duration: 240, easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
  targets: [{ name: 'status', selector: '.speech-progress', properties: ['width', 'opacity'] }],
});
try {
  console.log('Speech acceptance: account-backed first use');
  await launch();
  const before = await snapshot();
  assert.ok(before.draftId); assert.equal(before.runtimeId, undefined);
  assert.equal((await settingsValue()).followAvailable, true);
  assert.equal(await permission(), false);
  await input().fill('保留已有草稿');
  await page.getByRole('button', { name: '语音听写', exact: true }).click();
  const consent = page.getByRole('dialog', { name: '启用语音听写', exact: true });
  await consent.waitFor({ state: 'visible' });
  assert.match(await consent.innerText(), /社区版.*无法提供官方 Desktop.*ASR/s);
  assert.match(await consent.innerText(), /Step Plan/);
  assert.match(await consent.innerText(), /录音期间.*4 秒.*每段.*取消.*保留/s);
  assert.equal(await permission(), false); assert.equal(calls.length, 0);
  await page.screenshot({ path: join(evidence, 'first-use-plan-dark.png') });
  const idleGeometry = await geometry();
  const entrance = await sampleMotion(page, motionOptions('dictation opens in the existing context row', true),
    () => consent.getByRole('button', { name: '同意并录音', exact: true }).click());
  assert.ok(entrance.frames[0].status.width < entrance.frames.at(-1).status.width - 100);
  assert.ok(entrance.frames[1].status.width > entrance.frames[0].status.width && entrance.frames[1].status.width < entrance.frames.at(-1).status.width);
  await page.getByRole('button', { name: '结束听写', exact: true }).waitFor();
  await checkContextRow(false);
  await assertGeometry(idleGeometry);
  await page.screenshot({ path: join(evidence, 'recording-dark.png') });
  await until(async () => (await text()).includes('语音输入验收文本'), 'Continuous ASR did not append while recording');
  const continuousCapture = await page.evaluate(() => ({
    ...window.__speechFixtureCapture, tracks: window.__speechFixtureTracks,
  }));
  assert.ok(continuousCapture.voicedSamples >= 3200, 'The native worklet must receive voiced PCM before ASR');
  assert.ok(continuousCapture.maxRms > 0.1, 'The unprocessed WAV must retain its fixture amplitude');
  assert.deepEqual(nativeAudioErrors, []);
  const audio = await audioProcesses();
  assert.ok(audio.length > 0 && audio.every(process => process.sandboxed === false),
    `Only the fixture audio utility must be unsandboxed: ${JSON.stringify(audio)}`);
  assert.ok(continuousCapture.tracks.length > 0);
  for (const track of continuousCapture.tracks) {
    assert.equal(track.echoCancellation, false);
    assert.equal(track.noiseSuppression, false);
    assert.equal(track.autoGainControl, false);
  }
  assert.equal(await page.getByRole('button', { name: '结束听写', exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  assert.equal(await text(), '保留已有草稿\n语音输入验收文本');
  await input().fill('保留已有草稿\n语音输入验收文本，手动补充');
  await page.screenshot({ path: join(evidence, 'continuous-text-before-finish.png') });
  await finish();
  await page.getByRole('button', { name: '语音听写', exact: true }).waitFor();
  assert.match(await text(), /^保留已有草稿\n语音输入验收文本，手动补充/);
  assert.equal((await text()).split('语音输入验收文本').length - 1, calls.length);
  assert.ok(calls.length >= 2, 'Finish sends only the remaining PCM, not the whole recording');
  assert.deepEqual(calls[0], { url: 'https://api.stepfun.com/step_plan/v1/audio/asr/sse', protocol: 'step-sse' });
  assert.equal((await snapshot()).messages.length, 0);
  assert.equal((await snapshot()).runtimeId, undefined, 'Dictation never starts an Agent worker');
  assert.equal(await permission(), false);
  assert.equal(typeof await page.evaluate(() => window.require), 'undefined');

  console.log('Speech acceptance: cancel, failure, and navigation');
  const completed = calls.length, keptDraft = await text();
  const cancelGeometry = await geometry();
  await begin();
  await settleLayout(page.locator('.speech-progress'));
  const exit = await sampleMotion(page, motionOptions('dictation collapses without resizing the composer', false),
    () => page.getByRole('button', { name: '取消听写', exact: true }).click());
  assert.ok(exit.frames[0].status.width > exit.frames.at(-1).status.width + 100);
  await page.locator('.speech-progress').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: '语音听写', exact: true }).evaluate(element => element === document.activeElement), true);
  await assertGeometry(cancelGeometry);
  assert.equal(calls.length, completed); assert.equal(await permission(), false);
  mode = 'error';
  await begin(); await finish();
  await page.locator('.speech-error[role="alert"]').waitFor();
  assert.equal(calls.length, completed + 1, 'The error case must reach the real ASR transport');
  await settleLayout(page.locator('.speech-error'));
  assert.equal(await statusDoesNotOverlap(), true, 'Errors also stay in the context row');
  await assertGeometry(cancelGeometry);
  assert.doesNotMatch(await page.locator('.speech-error[role="alert"]').innerText(), /private upstream/);
  assert.equal(await text(), keptDraft);
  await page.locator('.speech-error').getByRole('button', { name: '关闭', exact: true }).click();
  mode = 'hold';
  await begin(); await finish();
  await until(() => calls.length === completed + 2, 'Held account request did not start');
  await page.getByRole('button', { name: '取消听写', exact: true }).first().click();
  await page.getByRole('button', { name: '语音听写', exact: true }).waitFor();
  mode = 'ok';
  // New Session deliberately reuses an unsubmitted draft. Materialize an idle
  // fixture session first, so this exercises a real ownership transition.
  await page.evaluate(async () => {
    const current = await window.desktop.snapshot();
    await window.desktop.createDraftSession(current.draftId);
  });
  await until(async () => Boolean((await snapshot()).runtimeId), 'Fixture session did not become active');
  await begin();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('button[aria-label="语音听写"]') && !document.querySelector('.speech-progress'));
  await until(async () => {
    const current = await snapshot();
    return Boolean(current.draftId && current.draftId !== before.draftId) && (await text()).trim() === '';
  }, 'Navigation did not install the new draft');
  assert.equal(calls.length, completed + 2); assert.equal(await permission(), false);
  assert.equal((await text()).trim(), '', 'Navigation never moves recognized text to the new draft');

  console.log('Speech acceptance: bounded backpressure without repeated requests');
  mode = 'hold';
  await input().fill('慢服务前保留草稿');
  await begin();
  await until(async () => await page.locator('.speech-error[role="alert"]').count() > 0,
    'A slow provider did not stop bounded continuous recording', 35000);
  assert.match(await page.locator('.speech-error[role="alert"]').innerText(), /响应较慢/);
  assert.equal(calls.length, completed + 3, 'Backpressure must not send additional queued requests');
  assert.equal(await text(), '慢服务前保留草稿');
  assert.equal(await permission(), false);
  await page.locator('.speech-error').getByRole('button', { name: '关闭', exact: true }).click();
  mode = 'ok';

  console.log('Speech acceptance: independent settings and layouts');
  await configure();
  const settings = page.locator('.speech-settings');
  assert.match(await settings.innerText(), /Step Plan.*国内/);
  await settings.getByLabel('识别服务', { exact: true }).selectOption('custom');
  await settings.getByLabel('完整转写接口地址', { exact: true }).fill(`${base}/v1/audio/transcriptions`);
  await settings.getByLabel('模型', { exact: true }).fill('fixture-independent-model');
  await settings.getByLabel('API Key', { exact: true }).fill('speech-fixture-custom-key');
  await settings.getByRole('button', { name: '保存听写设置', exact: true }).click();
  await settings.getByText('已保存', { exact: true }).waitFor();
  assert.equal((await settingsValue()).hasKey, true);
  assert.doesNotMatch(JSON.stringify(await settingsValue()), /speech-fixture.*key/);
  await settings.getByLabel('模型', { exact: true }).focus();
  await page.screenshot({ path: join(evidence, 'settings-dark-focused.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(680, 820));
  await settings.getByLabel('API Key', { exact: true }).focus();
  await page.screenshot({ path: join(evidence, 'settings-dark-narrow-focused.png') });
  assert.equal(await settings.evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.evaluate(() => window.desktop.preferences({ theme: 'original-light', language: 'en' }));
  await page.getByRole('heading', { name: 'Voice dictation', exact: true }).waitFor();
  await settings.getByLabel('Model', { exact: true }).focus();
  await page.screenshot({ path: join(evidence, 'settings-light-english-narrow-focused.png') });
  await page.evaluate(() => window.desktop.preferences({ language: 'zh' }));
  await closeSettings();
  await begin();
  await input().fill('窄窗口正文保持可编辑。'.repeat(30));
  assert.equal(await statusDoesNotOverlap(), true, 'Narrow listening status must not cover long input');
  await page.screenshot({ path: join(evidence, 'continuous-light-narrow-long-input.png') });
  await finish();
  await until(async () => (await text()).includes('独立模型验收文本'), 'Independent model did not append a transcript');
  assert.equal(calls.at(-1).protocol, 'multipart');

  console.log('Speech acceptance: persisted consent and isolated account replacement');
  await page.evaluate(() => window.desktop.logout());
  assert.equal((await settingsValue()).acknowledged, true);
  assert.equal((await settingsValue()).hasKey, true);
  await page.evaluate(() => window.desktop.login('platform_oversea', 'speech-fixture-oversea-key'));
  await page.evaluate(async () => {
    const settings = await window.desktop.speechSettings();
    await window.desktop.saveSpeech({ source: 'follow', endpoint: '', model: 'stepaudio-2.5-asr', language: 'en' }, settings.revision);
  });
  assert.equal((await settingsValue()).followChannel, 'api');
  assert.equal((await settingsValue()).followRegion, 'global');
  await begin(); await finish();
  await until(() => calls.at(-1)?.url === 'https://api.stepfun.ai/v1/audio/asr/sse', 'Overseas account request did not arrive');
  await page.getByRole('button', { name: '语音听写', exact: true }).waitFor();
  assert.deepEqual(calls.at(-1), { url: 'https://api.stepfun.ai/v1/audio/asr/sse', protocol: 'step-sse' });

  console.log('Speech acceptance: shared quote/diff/queue row and reduced motion');
  // Presentation fixtures exercise the real components without running an Agent
  // or changing the main process's conversation/recording ownership.
  const layoutMessages = [
    { role: 'user', content: '检查输入区布局。', timestamp: Date.now() - 1000 },
    { role: 'assistant', content: '保留这段引用，听写状态与变更共用原来的辅助行。\n\n' + '向上阅读时保留录音与回到底部入口。\n\n'.repeat(30), timestamp: Date.now() },
    { role: 'assistant', content: [{ type: 'toolCall', name: 'edit_file', id: 'speech-layout-edit', arguments: { path: 'fixture.ts' } }] },
    { role: 'toolResult', toolName: 'edit_file', toolCallId: 'speech-layout-edit', content: 'Done',
      details: { patch: createPatch('fixture.ts', 'old\n', 'new\n') } },
  ];
  const emit = events => app.evaluate(({ BrowserWindow }, events) => {
    for (const event of events) BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', event);
  }, events);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await page.evaluate(() => window.desktop.preferences({ theme: 'original-dark' }));
  await input().fill('正文保持原位。');
  await emit([{ type: 'desktop_history', messages: layoutMessages }, { type: 'agent_start' }]);
  await page.locator('.live-turn-chip').waitFor();
  await until(() => page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    const owner = snapshot.draftId ? { draftId: snapshot.draftId } : { sessionId: snapshot.state.sessionId };
    const composer = await window.desktop.composerRead(owner);
    if (composer.value.text !== '正文保持原位。') return false;
    const text = '保留这段引用，听写状态与变更共用原来的辅助行。';
    return (await window.desktop.composerWrite({ owner, revision: composer.revision, value: {
      quotes: [{ id: 'speech-layout-quote', messageIndex: 1, role: 'assistant', text, markdown: text, startOffset: 0, endOffset: text.length }],
    } })).accepted;
  }), 'The layout fixture did not install its explicit pending reference');
  await page.locator('.quote-chip').waitFor();
  mode = 'hold';
  const contextGeometry = await geometry();
  await begin();
  assert.equal(await page.locator('.quote-chip').count(), 1, 'The pending reference stays visible during dictation');
  await page.locator('#conversation-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.locator('.jump-to-bottom').waitFor();
  const layouts = [{ name: 'split-dark-quoted', boxes: await checkContextRow(true) }];
  await assertGeometry(contextGeometry);
  assert.equal(await page.getByRole('button', { name: '停止此轮', exact: true }).isEnabled(), true);
  await page.screenshot({ path: join(evidence, 'context-split-dark-quoted.png') });
  await emit([{ type: 'desktop_queue', pendingMessages: [{ id: 'speech-layout-queued', version: 1, message: '下一条草稿', attachmentCount: 0 }] }]);
  await page.locator('.queue-trigger').waitFor();
  layouts.push({ name: 'split-dark-quoted-queued', boxes: await checkContextRow(true) });
  await page.screenshot({ path: join(evidence, 'context-split-dark-quoted-queued.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(680, 820));
  await page.evaluate(() => window.desktop.preferences({ theme: 'original-light', language: 'en' }));
  await page.getByRole('button', { name: 'Finish dictation', exact: true }).waitFor();
  layouts.push({ name: 'split-light-narrow-english-quoted-queued', boxes: await checkContextRow(true) });
  await page.locator('.speech-progress').getByRole('button', { name: 'Cancel dictation', exact: true }).focus();
  const focus = await page.locator('.speech-progress').evaluate(element => {
    const control = document.activeElement.getBoundingClientRect(), clip = element.getBoundingClientRect();
    return control.left - 4 >= clip.left && control.right + 4 <= clip.right
      && control.top - 4 >= clip.top && control.bottom + 4 <= clip.bottom;
  });
  assert.equal(focus, true, 'Animated clip reserves the complete focus outline');
  await page.screenshot({ path: join(evidence, 'context-split-light-narrow-english-focused.png') });
  await page.locator('.speech-progress').getByRole('button', { name: 'Cancel dictation', exact: true }).click();
  await page.locator('.speech-progress').waitFor({ state: 'detached' });
  await emit([{ type: 'desktop_queue', pendingMessages: [] }, { type: 'agent_end' }, { type: 'desktop_history', messages: [] }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Voice dictation', exact: true }).click();
  await page.getByRole('button', { name: 'Finish dictation', exact: true }).waitFor();
  await checkContextRow(false);
  assert.equal(await page.locator('.speech-progress').evaluate(element => element.getAnimations().length), 0);
  await page.screenshot({ path: join(evidence, 'context-light-narrow-reduced-motion.png') });
  await page.locator('.speech-progress').getByRole('button', { name: 'Cancel dictation', exact: true }).click();
  await page.locator('.speech-progress').waitFor({ state: 'detached' });
  mode = 'ok';
  await writeFile(join(evidence, 'context-layout.json'), JSON.stringify({ entrance, exit, layouts, focus }, null, 2));
  await closeDesktopFixtureAndWait(app); app = undefined;
  const encrypted = await readFile(join(root, 'auth.dpapi'));
  assert.equal(encrypted.includes(Buffer.from('speech-fixture-oversea-key')), false);
  assert.equal(encrypted.includes(Buffer.from('speech-fixture-custom-key')), false);
  await launch();
  assert.equal((await snapshot()).preferences.language, 'en');
  assert.equal((await settingsValue()).acknowledged, true);
  assert.equal((await settingsValue()).source, 'follow');
  assert.equal(await permission(), false);
  assert.deepEqual(errors, []); assert.deepEqual(failures, []); assert.deepEqual(nativeAudioErrors, []);
  const result = { ok: true, requests: calls, evidence, continuousCapture, audioProcesses: audio, nativeAudioErrors, checks: [
    'production Electron and synthetic microphone', 'first-use disclosure and Plan route',
    'renderer OS sandbox, context isolation and no Node integration',
    'fixture audio utility only is unsandboxed; no global sandbox bypass',
    'same shared adapter as plugins and BVR', 'no Agent worker or automatic prompt',
    'text before Finish without whole-recording reupload', 'manual edits survive incremental append',
    'cancel recording and upload', 'bounded slow-provider backpressure', 'navigation isolation', 'redacted failures',
    'independent model and encrypted key', 'dark/light narrow focused layouts',
    'settings loading until the real IPC read resolves',
    'login/logout preservation and overseas API route', 'persisted consent',
    'centered shared context row without composer resize', 'equal diff/dictation halves with quotes and queue',
    '240ms cubic entrance/exit and reduced motion', 'status focus outline and trigger focus return',
  ], boundary: 'Loopback fixtures only. No real account, entitlement, billing, physical microphone or installer acceptance.' };
  await writeFile(join(evidence, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(evidence, 'failure.png') });
    await writeFile(join(evidence, 'failure-diagnostic.json'), JSON.stringify({
      calls, failures, errors, nativeAudioErrors, audioProcesses: await audioProcesses(), capture: await page.evaluate(() => ({
        ...window.__speechFixtureCapture, tracks: window.__speechFixtureTracks,
      })),
    }, null, 2));
    console.error(await page.locator('body').innerText());
  }
  throw error;
} finally {
  if (app) await closeDesktopFixtureAndWait(app);
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
