import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CronOverview, DesktopBridge } from './contracts';
import { ScheduledTasks, type ScheduledTaskCreation, type ScheduledTaskView } from './ScheduledTasks';

const empty: CronOverview = { tasks: [], hosts: [], issues: [] };
export function CronManager({ bridge }: { bridge: DesktopBridge }) {
  const [data, setData] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const inflight = useRef<Promise<void> | undefined>(undefined);
  const dirty = useRef(false);
  const reload = useCallback((): Promise<void> => {
    if (inflight.current) { dirty.current = true; return inflight.current; }
    const request = (async () => {
      do {
        dirty.current = false;
        if (alive.current) setLoading(true);
        try {
          const next = await bridge.cronList();
          if (alive.current) { setData(next); setFailed(false); }
        } catch { if (alive.current) setFailed(true); }
      } while (dirty.current && alive.current);
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
  const format = (time: number) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(time);
  const jobs: ScheduledTaskView[] = data.tasks.map(job => ({
    id: job.key, jobId: job.id, runtimeId: job.runtimeId, hostName: job.hostName,
    title: job.prompt.trim().split('\n')[0].slice(0, 64), prompt: job.prompt, workspace: job.workspace,
    schedule: job.cron, next: format(job.nextFireAt), expires: job.autoExpireAt === undefined ? undefined : format(job.autoExpireAt),
    recurring: job.recurring, durable: job.durable, host: job.runtimeId ? 'online' : 'offline',
  }));
  const create = async (value: ScheduledTaskCreation) => {
    await bridge.cronCreate({ runtimeId: value.runtimeId, cron: value.cron, prompt: value.prompt, recurring: value.recurring, durable: value.durable });
    await reload();
  };
  const remove = async (key: string) => {
    const task = data.tasks.find(job => job.key === key);
    if (!task?.runtimeId) throw new Error('Open the project host before deleting this job');
    await bridge.cronDelete(task.runtimeId, task.id);
    await reload();
  };
  return <ScheduledTasks jobs={jobs} hosts={data.hosts} live refreshing={loading} onRefresh={() => void reload()} onCreate={create} onDelete={remove}
    issue={failed ? '读取失败，正在保留上次结果。请刷新重试，当前列表可能已过期。'
      : data.issues.some(issue => issue.reason === 'unavailable') ? '部分项目或宿主暂时无法读取，列表可能不完整。'
      : data.issues.some(issue => issue.reason === 'untrusted') ? '未信任项目的持久任务未加载；完全访问不代表项目信任。' : undefined}/>;
}
