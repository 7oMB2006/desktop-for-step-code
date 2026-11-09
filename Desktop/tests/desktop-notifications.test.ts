import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { DesktopNotifications } from '../electron/desktop-notifications';
import type { SessionRuntime } from '../electron/session-runtimes';
import type { Preferences } from '../src/contracts';
import { notificationPreferences, notificationPreferencePatch } from '../src/notification-preferences';

class Notice extends EventEmitter {
  shown = false;
  closed = false;
  show() { this.shown = true; }
  close() { this.closed = true; this.emit('close', { reason: 'applicationHidden' }); }
}
function fixture(patch: Partial<Preferences> = {}) {
  const preferences: Preferences = { theme: 'system', language: 'zh', workspaces: [], ...patch };
  const worker = { id: 'worker', state: { sessionId: 'session' }, pendingUI: new Map(), runActive: false } as SessionRuntime;
  const workers = new Map([[worker.id, worker]]);
  const foreground = new Set<string>();
  const notices: Notice[] = [];
  const payloads: { title: string; body: string; silent: true }[] = [];
  const opened: string[][] = [];
  const options = {
    preferences: () => preferences, workers: () => workers, foreground: (id: string) => foreground.has(id),
    create: (payload: typeof payloads[number]) => { payloads.push(payload); const notice = new Notice(); notices.push(notice); return notice; },
    open: (sessionId: string, kind: string) => { opened.push([sessionId, kind]); },
  };
  const controller = new DesktopNotifications(options);
  const approval = (id = 'request') => {
    worker.pendingUI.set(id, { type: 'extension_ui_request', method: 'confirm', id, message: 'secret tool payload' });
    controller.handle({ type: 'extension_ui_request', method: 'confirm', id, runtimeId: worker.id });
  };
  const complete = () => controller.handle({ type: 'desktop_task_completed', runtimeId: worker.id });
  return { controller, preferences, worker, workers, foreground, notices, payloads, opened, options, approval, complete };
}

test('notification defaults are quiet, independent and strictly validated', () => {
  assert.deepEqual(notificationPreferences({}), { approvalNotifications: true, completionNotifications: false, completionSound: false });
  for (const key of ['approvalNotifications', 'completionNotifications', 'completionSound']) {
    for (const value of ['true', 1, null, [], {}]) assert.throws(() => notificationPreferencePatch({ [key]: value }));
    assert.deepEqual(notificationPreferencePatch({ [key]: false }), { [key]: false });
  }
  assert.deepEqual(notificationPreferencePatch({ theme: 'dark' }), {});
  assert.deepEqual(notificationPreferences({ completionSound: true }), {
    approvalNotifications: true, completionNotifications: false, completionSound: true,
  });
});

test('background approvals notify once without exposing payloads or approving anything', () => {
  const f = fixture();
  f.approval(); f.approval();
  assert.equal(f.notices.length, 1);
  assert.equal(f.payloads[0].silent, true);
  assert.ok(!JSON.stringify(f.payloads).includes('secret'));
  f.notices[0].emit('click');
  assert.deepEqual(f.opened, [['session', 'approval']]);
  assert.equal(f.worker.pendingUI.size, 1);
  assert.equal(f.notices[0].closed, true);
  f.controller.dispose();
});

test('the viewed focused session is quiet; another session still notifies', () => {
  const f = fixture({ completionNotifications: true });
  f.foreground.add('session');
  f.approval(); f.complete();
  assert.equal(f.notices.length, 0);
  f.foreground.delete('session');
  f.foreground.add('other');
  f.approval('next'); f.complete();
  assert.equal(f.notices.length, 2);
  f.controller.dispose();
});

test('completion toasts are opt-in and remain silent with completion audio enabled', () => {
  const f = fixture({ completionSound: true });
  f.complete();
  assert.equal(f.notices.length, 0);
  f.preferences.completionNotifications = true;
  f.complete();
  assert.equal(f.notices.length, 1);
  assert.equal(f.payloads[0].silent, true);
  f.controller.dispose();
});

test('informational events and restored history cannot trigger native notices', () => {
  const f = fixture({ completionNotifications: true });
  for (const type of ['desktop_runtimes', 'agent_end', 'message_end', 'desktop_exit', 'desktop_history']) {
    f.controller.handle({ type, runtimeId: f.worker.id });
  }
  f.controller.handle({ type: 'extension_ui_request', method: 'notify', id: 'info', runtimeId: f.worker.id });
  f.controller.handle({ type: 'extension_ui_request', method: 'confirm', id: 'forged', runtimeId: 'missing' });
  assert.equal(f.notices.length, 0);
});

test('requests resolving, expiring or stopping withdraw their native notices', () => {
  const f = fixture();
  f.approval();
  f.worker.pendingUI.clear();
  f.controller.sync();
  assert.equal(f.notices[0].closed, true);
  f.notices[0].emit('click');
  assert.equal(f.opened.length, 0);
  f.approval('new');
  f.workers.clear();
  f.controller.sync();
  assert.equal(f.notices[1].closed, true);
});

test('disabling a preference withdraws notices without replay on re-enabling', () => {
  const f = fixture();
  f.approval();
  f.preferences.approvalNotifications = false;
  f.controller.sync();
  assert.equal(f.notices[0].closed, true);
  f.preferences.approvalNotifications = true;
  f.approval();
  assert.equal(f.notices.length, 1);
  f.controller.dispose();
});

test('foreground activation and new tasks remove obsolete completion notices', () => {
  const f = fixture({ completionNotifications: true });
  f.complete();
  f.foreground.add('session'); f.controller.sync();
  assert.equal(f.notices[0].closed, true);
  f.foreground.clear(); f.complete();
  f.worker.runActive = true; f.controller.sync();
  assert.equal(f.notices[1].closed, true);
});

test('timed-out banners still navigate from Windows Notification Center', () => {
  const f = fixture({ completionNotifications: true });
  f.complete();
  f.notices[0].emit('close', { reason: 'timedOut' });
  f.notices[0].emit('click');
  assert.deepEqual(f.opened, [['session', 'completion']]);
});

test('completion clicks survive worker recycling, while dismissed notices are inert', () => {
  const f = fixture({ completionNotifications: true });
  f.complete();
  f.workers.clear(); f.controller.sync();
  f.notices[0].emit('click');
  assert.deepEqual(f.opened, [['session', 'completion']]);
  f.workers.set(f.worker.id, f.worker); f.complete();
  f.notices[1].emit('close', { reason: 'userCanceled' });
  f.notices[1].emit('click');
  assert.equal(f.opened.length, 1);
  f.controller.dispose();
});

test('a new task on a recycled source session withdraws its old completion banner', () => {
  const f = fixture({ completionNotifications: true });
  f.complete();
  f.workers.clear();
  const replacement = { ...f.worker, id: 'replacement', runActive: true } as SessionRuntime;
  f.workers.set(replacement.id, replacement);
  f.controller.handle({ type: 'agent_start', runtimeId: replacement.id });
  assert.equal(f.notices[0].closed, true);
  f.notices[0].emit('click');
  assert.equal(f.opened.length, 0);
  f.controller.dispose();
});

test('unsupported or failing native notifications never interrupt runtime handling', () => {
  const f = fixture();
  const missing = new DesktopNotifications({ ...f.options, create: () => undefined });
  f.worker.pendingUI.set('request', { type: 'extension_ui_request', id: 'request', method: 'confirm' });
  assert.doesNotThrow(() => missing.handle({ type: 'extension_ui_request', id: 'request', runtimeId: f.worker.id }));
  const failing = new DesktopNotifications({ ...f.options, create: () => { throw new Error('unavailable'); } });
  assert.doesNotThrow(() => failing.handle({ type: 'extension_ui_request', id: 'request', runtimeId: f.worker.id }));
  f.approval();
  f.notices[0].emit('failed');
  f.notices[0].emit('click');
  assert.equal(f.opened.length, 0);
});

test('native handles are bounded and released at application shutdown', () => {
  const f = fixture({ completionNotifications: true });
  for (let i = 0; i < 40; i++) {
    f.worker.state!.sessionId = `session-${i}`;
    f.complete();
  }
  assert.equal(f.notices.filter(notice => !notice.closed).length, 32);
  f.controller.dispose();
  assert.ok(f.notices.every(notice => notice.closed));
});
