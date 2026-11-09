import type { Preferences, RuntimeEvent } from '../src/contracts';
import { notificationPreferences } from '../src/notification-preferences';
import type { SessionRuntime } from './session-runtimes';

type Kind = 'approval' | 'completion';
export interface NativeNotice {
  once(event: 'click' | 'failed', listener: () => void): unknown;
  on(event: 'close', listener: (details: { reason?: string }) => void): unknown;
  show(): void;
  close(): void;
}
interface Entry {
  notice: NativeNotice; kind: Kind; sessionId: string; runtimeId: string; requestId?: string;
}

export class DesktopNotifications {
  private entries = new Map<string, Entry>();
  private seenRequests = new Map<string, Set<string>>();
  constructor(private options: {
    preferences: () => Preferences;
    workers: () => ReadonlyMap<string, SessionRuntime>;
    foreground: (sessionId: string) => boolean;
    create: (options: { title: string; body: string; silent: true }) => NativeNotice | undefined;
    open: (sessionId: string, kind: Kind) => void;
  }) {}

  handle(event: RuntimeEvent) {
    if (!['desktop_task_completed', 'desktop_runtimes', 'agent_start', 'desktop_exit',
      'desktop_ui_expired', 'extension_ui_request'].includes(event.type)) return;
    this.sync();
    const worker = this.options.workers().get(event.runtimeId);
    const sessionId = worker?.state?.sessionId;
    if (!worker || !sessionId) return;
    if (event.type === 'desktop_task_completed') {
      this.show('completion', worker.id, sessionId);
    } else if (event.type === 'extension_ui_request' && worker.pendingUI.has(event.id)) {
      const seen = this.seenRequests.get(worker.id) ?? new Set<string>();
      this.seenRequests.set(worker.id, seen);
      if (seen.has(event.id)) return;
      seen.add(event.id);
      this.show('approval', worker.id, sessionId, event.id);
    }
  }

  sync() {
    const workers = this.options.workers();
    const preferences = notificationPreferences(this.options.preferences());
    for (const [id, seen] of this.seenRequests) {
      const worker = workers.get(id);
      for (const requestId of seen) if (!worker?.pendingUI.has(requestId)) seen.delete(requestId);
      if (!seen.size) this.seenRequests.delete(id);
    }
    for (const [key, entry] of this.entries) {
      const worker = entry.kind === 'approval' ? workers.get(entry.runtimeId)
        : [...workers.values()].find(worker => worker.state?.sessionId === entry.sessionId);
      if (this.options.foreground(entry.sessionId) ||
        (entry.kind === 'approval' ? !preferences.approvalNotifications || worker?.state?.sessionId !== entry.sessionId || !worker.pendingUI.has(entry.requestId!)
          : !preferences.completionNotifications || worker?.runActive)) this.dismiss(key);
    }
  }

  private dismiss(key: string) {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    try { entry?.notice.close(); } catch {}
  }

  private show(kind: Kind, runtimeId: string, sessionId: string, requestId?: string) {
    const preferences = this.options.preferences();
    const enabled = notificationPreferences(preferences);
    if (!(kind === 'approval' ? enabled.approvalNotifications : enabled.completionNotifications) ||
      this.options.foreground(sessionId)) return;
    const key = `${kind}:${sessionId}`;
    this.dismiss(key);
    try {
      const zh = preferences.language === 'zh';
      // Never put commands, paths, prompts or reply content on the lock screen.
      const notice = this.options.create({
        title: kind === 'approval' ? (zh ? '需要审批' : 'Approval requested') : (zh ? '任务已完成' : 'Task completed'),
        body: kind === 'approval' ? (zh ? '有一项操作正在等待你的确认。' : 'An operation is waiting for your confirmation.')
          : (zh ? '本轮任务已完成。' : 'This task has finished.'),
        silent: true,
      });
      if (!notice) return;
      const entry: Entry = { notice, kind, sessionId, runtimeId, requestId };
      this.entries.set(key, entry);
      const forget = () => { if (this.entries.get(key) === entry) this.entries.delete(key); };
      notice.once('click', () => {
        if (this.entries.get(key) !== entry) return;
        this.dismiss(key);
        this.options.open(sessionId, kind);
      });
      // Timed-out banners remain actionable in Windows Notification Center.
      notice.on('close', details => { if (details?.reason !== 'timedOut') forget(); });
      notice.once('failed', forget);
      while (this.entries.size > 32) this.dismiss(this.entries.keys().next().value!);
      notice.show();
    } catch { this.dismiss(key); }
  }

  dispose() {
    for (const key of this.entries.keys()) this.dismiss(key);
    this.seenRequests.clear();
  }
}
