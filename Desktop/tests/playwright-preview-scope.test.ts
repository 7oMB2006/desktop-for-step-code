import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { WebContents } from 'electron';
import { PreviewProtocolScope, previewNetworkSummary, previewResourceAllowed } from '../electron/playwright-preview-scope';

const origin = 'http://127.0.0.1:5173';
const home = `${origin}/preview`;
const fixture = () => {
  class Debugger extends EventEmitter {
    active = false;
    forwarded: Array<[string, unknown]> = [];
    attach() { this.active = true; }
    isAttached() { return this.active; }
    detach() { this.active = false; this.emit('detach'); }
    async sendCommand(method: string, parameters?: unknown) {
      this.forwarded.push([method, parameters]);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame' } } };
      return {};
    }
  }
  const debuggerClient = new Debugger();
  const forwarded: Record<string, any>[] = [];
  let url = home;
  const guest = { debugger: debuggerClient, getURL: () => url, getTitle: () => 'Test preview',
    getUserAgent: () => 'Chrome fixture' } as unknown as WebContents;
  const scope = new PreviewProtocolScope(guest, { kind: 'local', origin }, value => forwarded.push(value), () => scope.close());
  return { scope, debuggerClient, forwarded, redirect: () => { url = 'https://example.invalid'; } };
};

test('the preview only makes same-origin requests and allows same-port HMR and passive data/blob assets', () => {
  for (const url of [`${origin}/app`, 'ws://127.0.0.1:5173/hmr', 'blob:http://127.0.0.1:5173/id', 'data:image/png;base64,AA=='])
    assert.equal(previewResourceAllowed(url, origin, 'script'), true, url);
  for (const url of ['http://127.0.0.1:5174/api', 'http://localhost:5173/hmr', 'http://user@127.0.0.1:5173/',
    'ws://127.0.0.1:5174/hmr', 'https://example.invalid', 'blob:http://127.0.0.1:5174/id', 'file:///C:/file', 'bogus'])
    assert.equal(previewResourceAllowed(url, origin, 'script'), false, url);
  assert.equal(previewResourceAllowed('data:text/html,example', origin, 'subFrame'), false);
});

test('network diagnostics strip query, fragments and reason text and omit other origins', () => {
  assert.equal(previewNetworkSummary([
    `1. [POST] ${origin}/api?private=value#fragment => [201] Custom reason`,
    `2. [GET] ${origin}/failed => [FAILED] net::ERR_ABORTED`,
    '3. [GET] http://127.0.0.1:5174/outside => [FAILED] net::ERR_BLOCKED_BY_CLIENT',
    '4. [GET] http://user@127.0.0.1:5173/credentials => [200] OK',
    `5. [GET] blob:${origin}/id => [200] OK`,
    'Unexpected output not intended as a request line',
  ].join('\n'), origin), 'POST /api [201]\nGET /failed [FAILED]');
});

test('only one real target is announced and unknown targets, global storage, focus, and external navigation are never forwarded', async () => {
  const { scope, debuggerClient, forwarded, redirect } = fixture();
  await scope.attach();
  await scope.dispatch({ id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true, flatten: true } });
  const sessionId = forwarded[0].params.sessionId;
  await scope.dispatch({ id: 2, method: 'Target.setAutoAttach', params: { autoAttach: true, flatten: true } });
  assert.equal(forwarded.length, 1);
  const { targetInfos } = await scope.dispatch({ id: 3, method: 'Target.getTargets' }) as { targetInfos: { targetId: string }[] };
  assert.deepEqual(targetInfos.map(target => target.targetId), ['main-frame']);
  for (const [method, params] of [['Target.attachToTarget', { targetId: 'other' }],
    ['Target.createTarget', { url: home }], ['Target.getTargetInfo', { targetId: 'other' }],
    ['Storage.getCookies', {}], ['Browser.setDownloadBehavior', {}]] as const)
    await assert.rejects(scope.dispatch({ id: 4, method, params }), /unavailable/);
  await assert.rejects(scope.dispatch({ id: 5, sessionId: 'other', method: 'Runtime.evaluate' }), /unavailable/);
  await assert.rejects(scope.dispatch({ id: 6, sessionId, method: 'Page.navigate', params: { url: 'http://127.0.0.1:5174/' } }), /unavailable/);
  await assert.rejects(scope.dispatch({ id: 7, sessionId, method: 'Page.addScriptToEvaluateOnNewDocument', params: { source: 'untrusted()' } }), /unavailable/);
  await scope.dispatch({ id: 11, sessionId, method: 'Page.setInterceptFileChooserDialog', params: { enabled: false } });
  await assert.rejects(scope.dispatch({ id: 12, sessionId, method: 'DOM.setFileInputFiles' }), /unavailable/);
  await scope.dispatch({ id: 8, sessionId, method: 'Page.bringToFront' });
  await scope.dispatch({ id: 9, sessionId, method: 'Page.createIsolatedWorld',
    params: { frameId: 'main-frame', worldName: 'utility', grantUniveralAccess: true } });
  assert.deepEqual(debuggerClient.forwarded, [['Page.getFrameTree', undefined],
    ['Page.setInterceptFileChooserDialog', { enabled: true }],
    ['Page.createIsolatedWorld', { frameId: 'main-frame', worldName: 'utility', grantUniveralAccess: false }]]);
  debuggerClient.emit('message', {}, 'Runtime.consoleAPICalled', {}, 'child-session');
  debuggerClient.emit('message', {}, 'Target.attachedToTarget', { targetInfo: { targetId: 'other' } });
  assert.equal(forwarded.length, 1);
  redirect();
  await assert.rejects(scope.dispatch({ id: 10, sessionId, method: 'Runtime.evaluate' }), /unavailable/);
  scope.close();
  assert.equal(debuggerClient.isAttached(), false);
});

test('revocation drops the debugger and stale commands without touching the page', async () => {
  const { scope, debuggerClient } = fixture();
  await scope.attach();
  await scope.layout({ width: 800, height: 600 });
  await scope.layout({ width: 800, height: 600 });
  await scope.layout();
  scope.close();
  await assert.rejects(scope.dispatch({ id: 1, method: 'Target.getTargets' }), /unavailable/);
  assert.equal(debuggerClient.isAttached(), false);
  assert.equal(debuggerClient.listenerCount('message'), 0);
  assert.deepEqual(debuggerClient.forwarded.map(([command]) => command),
    ['Page.getFrameTree', 'Page.setInterceptFileChooserDialog', 'Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride']);
});
