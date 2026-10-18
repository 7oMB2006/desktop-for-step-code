import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarClock, Clock3, Folder, Info, Play, Plus, RotateCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { AppMenu, type AppMenuItem } from './AppMenu';
import type { CronAssociation, CronHost, CronRecoveryPreview, Session } from './contracts';
import { normalizedWorkspaceKey } from './workspace-key';
import './scheduled-tasks.css';

export function ScheduledTaskSelect({ label, value, options, onChange, name }: {
  label: string; value: string; options: AppMenuItem[]; onChange: (id: string) => void; name?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return <span className="scheduled-select">
    {name && <input type="hidden" name={name} value={value}/>}
    <button type="button" ref={anchor} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <span>{options.find(option => option.id === value)?.label ?? label}</span><DisclosureChevron/>
    </button>
    <AppMenu anchor={anchor} open={open} label={label} selected={value} items={options} maxVisibleItems={5} onSelect={onChange} onClose={close}/>
  </span>;
}

export interface ScheduledTaskView {
  id: string;
  title: string;
  prompt: string;
  workspace: string;
  schedule: string;
  next: string;
  expires?: string;
  recurring: boolean;
  durable: boolean;
  host: 'online' | 'offline';
  runtimeId?: string;
  jobId?: string;
  hostName?: string;
  association?: CronAssociation;
}
export interface ScheduledTaskCreation { title: string; prompt: string; workspace: string; runtimeId: string; cron: string; recurring: boolean; durable: boolean }

export function SidebarTaskActions({ selected, onNewSession, onScheduledTasks, disabled = false, language = 'zh' }: {
  selected: boolean;
  onNewSession: () => void;
  onScheduledTasks: () => void;
  disabled?: boolean;
  language?: 'zh' | 'en';
}) {
  return <div className="sidebar-task-actions">
    <button type="button" className="new-chat" disabled={disabled} onClick={onNewSession}><Plus size={16}/><span>{language === 'zh' ? '新建会话' : 'New chat'}</span></button>
    <button type="button" disabled={disabled} aria-current={selected ? 'page' : undefined} onClick={onScheduledTasks}><Clock3 size={15}/><span>{language === 'zh' ? '定时任务' : 'Schedules'}</span></button>
  </div>;
}

export function ScheduledTasks({ jobs, onCreate, onDelete, hosts = [], sessions = [], onPrepareRecovery, onRecover,
  live = false, refreshing = false, issue, onRefresh }: {
  jobs: ScheduledTaskView[];
  onCreate: (value: ScheduledTaskCreation) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  hosts?: CronHost[]; live?: boolean; refreshing?: boolean; issue?: string; onRefresh?: () => void;
  sessions?: Session[];
  onPrepareRecovery?: (key: string, sessionId: string) => Promise<CronRecoveryPreview>;
  onRecover?: (token: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverySession, setRecoverySession] = useState('');
  const [recovery, setRecovery] = useState<CronRecoveryPreview>();
  const [createWorkspace, setCreateWorkspace] = useState('');
  const [hostId, setHostId] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [recurring, setRecurring] = useState(true);
  const [durable, setDurable] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [failure, setFailure] = useState('');
  const [leaving, setLeaving] = useState(false);
  const pendingNavigation = useRef<(() => void) | undefined>(undefined);
  const navigating = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const recoveryButton = useRef<HTMLButtonElement>(null);
  const task = jobs.find(job => job.id === selected);
  const recoveryTargets = task ? sessions.filter(session => session.path
    && normalizedWorkspaceKey(session.cwd, 'win32') === normalizedWorkspaceKey(task.workspace, 'win32')) : [];
  const associated = task?.association && sessions.find(session => session.id === task.association?.sessionId);
  const projects = [...new Set([...jobs.map(job => job.workspace), ...hosts.map(host => host.workspace)])];
  const selectedHost = hosts.find(host => host.runtimeId === hostId) ?? hosts[0];
  const shown = jobs.filter(job => (!project || job.workspace === project)
    && `${job.title} ${job.prompt} ${job.workspace}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => {
    setConfirmDelete(false);
    if (creating || selected || navigating.current) heading.current?.focus();
    navigating.current = false;
  }, [creating, selected]);
  useEffect(() => {
    if (!leaving) return;
    const finish = () => {
      pendingNavigation.current?.();
      pendingNavigation.current = undefined;
      setLeaving(false);
    };
    const timer = window.setTimeout(finish, 120);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const navigate = (change: () => void) => {
    if (navigating.current || savingRef.current) return;
    setFailure('');
    navigating.current = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }
    pendingNavigation.current = change;
    setLeaving(true);
  };
  const resetPage = () => { setCreating(false); setSelected(undefined); setConfirmDelete(false); setRecovering(false); setRecovery(undefined); };
  const back = () => navigate(resetPage);
  const create = () => navigate(() => setCreating(true));
  const cancelDelete = () => { setConfirmDelete(false); deleteButton.current?.focus(); };
  const save = async (action: () => void | Promise<void>, success: () => void, recoveryAction = false) => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setFailure('');
    try {
      await action();
      savingRef.current = false; setSaving(false);
      success();
    } catch {
      if (recoveryAction) {
        setRecovery(undefined);
        setFailure('未能确认恢复结果。请先刷新列表核对宿主状态；若配置或任务已变化、确认已过期，请重新核对，勿重复启动。');
      } else setFailure('未能确认操作结果。请先刷新列表核对，避免重复创建；同时检查宿主是否空闲、项目信任及时间表达式。');
    } finally { savingRef.current = false; setSaving(false); }
  };
  return <section className="scheduled-tasks" aria-label="定时任务">
    {issue && <div className="scheduled-boundary" role="status"><Info size={15}/><span>{issue}</span></div>}
    {failure && <div className="scheduled-failure" role="alert">{failure}</div>}
    <div key={creating ? 'create' : task ? `task-${task.id}` : 'list'} className={`scheduled-page${leaving ? ' is-leaving' : ''}`} inert={leaving || saving}>
    <header className="scheduled-heading">
      <div className="scheduled-heading-title">
        {(creating || task) && <button type="button" className="icon-button" aria-label="返回任务列表" data-tooltip="返回任务列表" onClick={back}><ArrowLeft size={18}/></button>}
        <h1 ref={heading} tabIndex={-1}>{creating ? '创建定时任务' : task ? task.title : '定时任务'}</h1>
        {!creating && !task && <span className="scheduled-count">{jobs.length}</span>}
      </div>
      {!creating && !task && <div className="scheduled-heading-actions">{onRefresh && <button type="button" className="icon-button" aria-label="刷新定时任务" data-tooltip="刷新定时任务" disabled={refreshing} onClick={onRefresh}><RotateCw size={15}/></button>}
        <button type="button" onClick={create}><Plus size={15}/>创建任务</button></div>}
    </header>
    {creating ? <form className="scheduled-editor" onSubmit={event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const title = String(fields.get('title') ?? '').trim();
      const prompt = String(fields.get('prompt') ?? '').trim();
      if ((!live && !title) || !prompt || live && (!selectedHost || selectedHost.busy || durable && !selectedHost.trusted)) return;
      void save(() => onCreate({ title, prompt, workspace: live ? selectedHost!.workspace : String(fields.get('workspace')),
        runtimeId: selectedHost?.runtimeId ?? '', cron, recurring, durable }), back);
    }}>
      {!live && <label>任务名称<input name="title" required maxLength={100} placeholder="例如：检查项目的待办事项"/></label>}
      {live ? <><label>调度宿主<ScheduledTaskSelect label="调度宿主" value={selectedHost?.runtimeId ?? ''}
        options={hosts.map(host => ({ id: host.runtimeId, label: `${host.workspace.split(/[\\/]/).pop()} · ${host.name}${host.busy ? '（忙碌）' : ''}` }))}
        onChange={id => { setHostId(id); setDurable(false); }}/></label>
        {selectedHost ? <div className="scheduled-boundary"><Info size={15}/><span>{selectedHost.workspace}<br/>
          {selectedHost.model ?? '当前模型'} · {selectedHost.permission ?? '当前权限'} · 沿用宿主当前账户</span></div>
          : <p className="muted">请先打开项目会话并发送消息，启动调度宿主。打开此页面不会自动启动运行时。</p>}
        <label>执行时间（本机时区）<input name="cron" required value={cron} maxLength={100} onChange={event => setCron(event.target.value)}/></label>
        <div className="scheduled-presets">{[{ label: '每天 09:00', value: '0 9 * * *' }, { label: '每周五 18:00', value: '0 18 * * 5' }, { label: '每小时', value: '0 * * * *' }].map(item =>
          <button key={item.value} type="button" onClick={() => setCron(item.value)}>{item.label}</button>)}</div>
        <label className="checkbox"><input type="checkbox" checked={recurring} onChange={event => setRecurring(event.target.checked)}/>周期执行</label>
        <label className="checkbox"><input type="checkbox" checked={durable} disabled={!selectedHost?.trusted} onChange={event => setDurable(event.target.checked)}/>保存为持久任务</label>
        <div className="scheduled-boundary"><Info size={15}/><span>周期任务七天后到期，触发沿用上游时间偏移；单次任务在下次匹配时触发后移除。未信任项目需先在会话中执行 /trust，再手动重启宿主。</span></div>
      </> : <label>项目<ScheduledTaskSelect name="workspace" label="项目" value={createWorkspace || projects[0] || 'Desktop for Step Code'}
        options={(projects.length ? projects : ['Desktop for Step Code']).map(path => ({ id: path, label: path }))}
        onChange={setCreateWorkspace}/></label>}
      <label>任务指令<textarea name="prompt" required maxLength={4000} rows={5} placeholder="描述需要执行的任务，以及什么时候执行。"/></label>
      <div className="scheduled-boundary"><ShieldCheck size={16}/><span>持久任务需要信任项目；运行时使用的账户与权限将在创建时确认。</span></div>
      <footer><button type="button" onClick={back}>取消</button><button type="submit" disabled={live && (!selectedHost || selectedHost.busy || durable && !selectedHost.trusted)}><Plus size={15}/>{live ? '创建任务' : '预览创建'}</button></footer>
    </form> : task ? <div className="scheduled-detail">
      <div className="scheduled-detail-meta"><span><Folder size={14}/>{task.workspace}</span><span className={`scheduled-host ${task.host}`}><i/>{task.host === 'online' ? '调度宿主在线' : '调度宿主离线'}</span></div>
      <dl className="scheduled-properties">
        <div><dt>执行安排</dt><dd>{task.schedule}</dd></div>
        <div><dt>{task.host === 'offline' ? '计划时间' : '下次触发'}</dt><dd className="scheduled-next-time">{task.next}</dd></div>
        <div><dt>任务类型</dt><dd>{task.recurring ? '周期' : '单次'} · {task.durable ? '持久任务' : '临时任务'}</dd></div>
        <div><dt>自动到期</dt><dd>{task.expires ?? (task.recurring ? '未提供' : '触发后移除')}</dd></div>
        {live && task.hostName && <div><dt>当前调度宿主</dt><dd>{task.hostName}</dd></div>}
        {live && task.durable && <div><dt>关联会话 · Beta</dt><dd>{task.association
          ? associated?.name || associated?.firstMessage.slice(0, 60) || `${task.association.sessionId.slice(0, 8)}（当前不可用）`
          : '未记录'}</dd></div>}
      </dl>
      <section className="scheduled-instructions"><h2>任务指令</h2><p>{task.prompt}</p></section>
      <div className="scheduled-boundary"><Info size={16}/><span>{task.host === 'offline'
        ? '当前没有存活的调度宿主。保存的任务不代表正在调度；可手动打开项目会话，或核对配置后恢复项目调度。'
        : '应用退出或电脑休眠期间不执行。任务由项目共享，关联会话不代表独占调度；到时触发不代表执行完成。'}</span></div>
      {task.host === 'offline' && onPrepareRecovery && onRecover && <div id="scheduled-recovery"
        className={`scheduled-recovery-disclosure${recovering ? ' is-open' : ''}`} aria-hidden={!recovering} inert={!recovering}>
      <section className="scheduled-recovery" aria-label="恢复项目调度">
      <div className="scheduled-recovery-content">
        <h2>恢复项目调度 <small>Beta</small></h2>
        <label>承接会话<ScheduledTaskSelect label="承接会话" value={recoverySession} options={[
          { id: '', label: '选择同项目会话', disabled: true },
          ...recoveryTargets.map(session => ({ id: session.id, label: session.name || session.firstMessage.slice(0, 60) || session.id.slice(0, 8) })),
        ]} onChange={id => { setRecoverySession(id); setRecovery(undefined); }}/></label>
        {!recoveryTargets.length && <p className="muted">暂无可用的同项目会话，请先创建并保存会话后再恢复。</p>}
        {recovery && <><dl className="scheduled-properties">
          <div><dt>当前账户</dt><dd>{recovery.account}</dd></div>
          <div><dt>恢复模型</dt><dd>{recovery.model.name} · {recovery.model.provider}</dd></div>
          <div><dt>执行权限</dt><dd>每次询问</dd></div>
          <div><dt>承接会话</dt><dd>{recovery.sessionName}</dd></div>
        </dl><ul>{recovery.jobs.map(job => <li key={job.id}>{job.prompt}</li>)}</ul>
          <div className="scheduled-boundary"><Info size={16}/><span>
            将在所选会话启动本项目全部 {recovery.jobs.length} 个持久任务，使用以上账户与模型，并将该会话权限设为“每次询问”。
            逾期及到期任务沿用上游规则，可能投递提醒并调用模型；不重建过期任务，不保证返回创建任务时的上下文。
          </span></div></>}
        <footer><button type="button" onClick={() => { setRecovering(false); recoveryButton.current?.focus(); }}>取消恢复</button>
          {recovery ? <button type="button" onClick={() => void save(() => onRecover!(recovery.token),
            () => { setRecovery(undefined); setRecovering(false); }, true)}><Play size={15}/>确认恢复调度</button>
            : <button type="button" disabled={!recoverySession} onClick={() => void save(async () =>
              setRecovery(await onPrepareRecovery!(task.id, recoverySession)), () => {}, true)}><ShieldCheck size={15}/>核对恢复配置</button>}
        </footer>
      </div></section></div>}
      <footer className="scheduled-detail-footer">
        {live && task.durable && task.host === 'offline' && onPrepareRecovery && onRecover
          && <button type="button" ref={recoveryButton} className="scheduled-recover" aria-expanded={recovering} aria-controls="scheduled-recovery" onClick={() => {
            if (recovering) { setRecovering(false); return; }
            setRecoverySession(recoveryTargets.some(session => session.id === task.association?.sessionId) ? task.association!.sessionId : '');
            setRecovery(undefined); setRecovering(true);
          }}><Play size={15}/>恢复项目调度 <small>Beta</small></button>}
        {confirmDelete ? <div className="scheduled-delete-confirm" role="group" aria-label="确认删除任务"
        onKeyDown={event => { if (event.key === 'Escape') cancelDelete(); }}>
        <span>删除此定时任务？</span><button type="button" autoFocus onClick={cancelDelete}>保留</button>
        <button type="button" className="scheduled-danger" onClick={() => void save(() => onDelete(task.id), back)}><Trash2 size={14}/>确认删除</button>
      </div> : <button ref={deleteButton} type="button" className="scheduled-delete" disabled={live && !task.runtimeId} onClick={() => setConfirmDelete(true)}><Trash2 size={15}/>删除任务</button>}</footer>
    </div> : <>
      <div className="scheduled-toolbar">
        <div className="scheduled-filters"><label className="scheduled-search"><Search size={15}/><input aria-label="搜索定时任务" placeholder="搜索任务" value={query} onChange={event => setQuery(event.target.value)}/>
          {query && <button type="button" className="icon-button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={13}/></button>}</label>
          <ScheduledTaskSelect label="筛选项目" value={project} onChange={setProject}
            options={[{ id: '', label: '全部项目' }, ...projects.map(path => ({ id: path, label: path }))]}/>
        </div><span>{jobs.filter(job => job.host === 'online').length} 项正在调度</span>
      </div>
      <div className="scheduled-list" aria-label="任务列表">
        {shown.map(job => <button type="button" className="scheduled-row" key={job.id} onClick={() => navigate(() => setSelected(job.id))}>
          <div className="scheduled-row-icon"><CalendarClock size={19}/></div>
          <div className="scheduled-row-content"><strong>{job.title}</strong><span className="scheduled-row-prompt">{job.prompt}</span>
            <span className="scheduled-row-meta"><span><Folder size={12}/>{job.workspace}</span><span>{job.recurring ? '周期' : '单次'} · {job.durable ? '持久' : '临时'}</span></span>
          </div>
          <div className="scheduled-row-timing"><span className={`scheduled-host ${job.host}`}><i/>{job.host === 'online' ? '等待触发' : '宿主离线'}</span>
            <span className="scheduled-next">{job.host === 'offline' && <span className="scheduled-time-label">计划时间</span>}<strong className="scheduled-next-time">{job.next}</strong></span>
            <small>{job.schedule}</small></div><span className="scheduled-row-chevron"><DisclosureChevron/></span>
        </button>)}
        {!shown.length && <div className="scheduled-empty"><CalendarClock size={28}/><h2>{refreshing ? '正在读取任务' : jobs.length ? '没有匹配的任务' : '暂无定时任务'}</h2>
          <button type="button" onClick={() => { if (jobs.length) { setQuery(''); setProject(''); } else create(); }}>
            {jobs.length ? <><X size={14}/>清除筛选</> : <><Plus size={15}/>创建任务</>}
          </button></div>}
      </div>
      <div className="scheduled-boundary"><Info size={15}/><span>仅在调度宿主存活时触发。应用退出或电脑休眠期间不执行。</span></div>
    </>}
    </div>
  </section>;
}
