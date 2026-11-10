import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CronOverview, DesktopBridge, Session } from './contracts';
import { ScheduledTasks, type ScheduledTaskCreation, type ScheduledTaskView } from './ScheduledTasks';
import { cronRevision } from './cron-revision';

const empty: CronOverview = { tasks: [], hosts: [], issues: [] };
export function CronManager({ bridge, onOpenHost }: {
  bridge: DesktopBridge; onOpenHost?: (session: Session, runtimeId: string) => Promise<void>;
}) {
  const [data, setData] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const alive = useRef(true);
  const inflight = useRef<Promise<void> | undefined>(undefined);
  const dirty = useRef(false);
  const mutating = useRef(false);
  const reload = useCallback((): Promise<void> => {
    if (mutating.current) { dirty.current = true; return Promise.resolve(); }
    if (inflight.current) { dirty.current = true; return inflight.current; }
    const request = (async () => {
      do {
        dirty.current = false;
        if (alive.current) setLoading(true);
        try {
          // A failed snapshot must still drain the list's host read lock.
          const [next, snapshot] = await Promise.allSettled([bridge.cronList(), bridge.snapshot()]);
          if (next.status !== 'fulfilled' || snapshot.status !== 'fulfilled') throw new Error('Cron refresh failed');
          if (alive.current) {
            setData(next.value); setSessions(snapshot.value.sessions.filter(session => !snapshot.value.preferences.archivedSessionIds?.includes(session.id)));
            setFailed(false);
          }
        } catch { if (alive.current) setFailed(true); }
      } while (dirty.current && alive.current && !mutating.current);
    })().finally(() => {
      inflight.current = undefined;
      if (alive.current) setLoading(false);
    });
    inflight.current = request;
    return request;
  }, [bridge]);
  useEffect(() => {
    alive.current = true;
    void reload();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = bridge.onEvent(event => {
      if (!['desktop_cron_changed', 'desktop_exit', 'desktop_sessions_changed'].includes(event.type)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 180);
    });
    return () => { alive.current = false; clearTimeout(timer); unsubscribe(); };
  }, [bridge, reload]);
  const mutate = async <T,>(action: () => Promise<T>): Promise<T> => {
    if (mutating.current) throw new Error('Wait for the current Cron operation to finish');
    // Drain this page's reads before writing; events are coalesced until confirmation.
    mutating.current = true;
    try {
      await inflight.current;
      if (!alive.current) throw new Error('Cron management is no longer open');
      return await action();
    } finally {
      mutating.current = false;
      if (alive.current) await reload();
    }
  };
  const format = (time: number) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(time);
  const jobs: ScheduledTaskView[] = data.tasks.map(job => ({
    id: job.key, jobId: job.id, runtimeId: job.runtimeId, hostName: job.hostName,
    association: job.association, paused: job.desktopPausedAt !== undefined, revision: cronRevision(job),
    automatic: job.automatic, history: job.history,
    title: job.prompt.trim().split('\n')[0].slice(0, 64), prompt: job.prompt, workspace: job.workspace,
    schedule: job.cron, next: format(job.nextFireAt), expires: job.autoExpireAt === undefined ? undefined : format(job.autoExpireAt),
    recurring: job.recurring, durable: job.durable, host: job.runtimeId ? 'online' : 'offline',
  }));
  const create = async (value: ScheduledTaskCreation) => {
    await mutate(() => bridge.cronCreate({ runtimeId: value.runtimeId, cron: value.cron, prompt: value.prompt, recurring: value.recurring, durable: value.durable }));
  };
  const remove = async (key: string) => {
    const task = data.tasks.find(job => job.key === key);
    if (!task?.runtimeId) throw new Error('Open the project host before deleting this job');
    await mutate(() => bridge.cronDelete(task.runtimeId!, task.id));
  };
  return <ScheduledTasks jobs={jobs} hosts={data.hosts} sessions={sessions} history={data.history}
    onOpenHost={onOpenHost ? async runtimeId => {
      const host = data.hosts.find(host => host.runtimeId === runtimeId);
      const session = (await bridge.sessions()).find(session => session.id === host?.sessionId);
      if (!session) throw new Error('Cron host changed; refresh before opening');
      await onOpenHost(session, runtimeId);
    } : undefined}
    onUpdate={async (key, expected, changes) => {
      const task = data.tasks.find(job => job.key === key);
      if (!task?.runtimeId) throw new Error('Open the project host before updating this job');
      await mutate(() => bridge.cronUpdate({ runtimeId: task.runtimeId!, jobId: task.id, expected, ...changes }));
    }}
    onPrepareRecovery={(key, sessionId) => bridge.cronRecoveryPreview(key, sessionId)}
    onRecover={async (token, automatic, acknowledged) => { await mutate(() => bridge.cronRecover(token, automatic, acknowledged)); }}
    onDisableAutomatic={async key => { await mutate(() => bridge.cronDisableAutomatic(key)); }}
    live refreshing={loading} onRefresh={() => void reload()} onCreate={create} onDelete={remove}
    issue={failed ? '读取失败，正在保留上次结果。请刷新重试，当前列表可能已过期。'
      : data.issues.some(issue => issue.reason === 'unavailable') ? '部分项目或宿主暂时无法读取，列表可能不完整。'
      : data.issues.some(issue => issue.reason === 'untrusted') ? '未信任项目的持久任务未加载；完全访问不代表项目信任。' : undefined}/>;
}
