import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarClock, Clock3, Folder, Info, Pause, Pencil, Play, Plug, Plus, RotateCw, Save, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { AppMenu, type AppMenuItem } from './AppMenu';
import type { CronAssociation, CronAutomaticRecovery, CronHistoryEntry, CronHost, CronRecoveryPreview, Session } from './contracts';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
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
  paused?: boolean;
  revision?: string;
  automatic?: CronAutomaticRecovery;
  history?: CronHistoryEntry[];
}
export interface ScheduledTaskCreation { title: string; prompt: string; workspace: string; runtimeId: string; cron: string; recurring: boolean; durable: boolean }

export function SidebarTaskActions({ selected, onNewSession, onScheduledTasks, onPlugins, disabled = false, language = 'zh' }: {
  selected: boolean;
  onNewSession: () => void;
  onScheduledTasks: () => void;
  onPlugins?: () => void;
  disabled?: boolean;
  language?: 'zh' | 'en';
}) {
  const zh = language === 'zh';
  const [searchOpen, setSearchOpen] = useState(false);
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const closeSearch = () => { setSearchOpen(false); searchTrigger.current?.focus(); };
  return <div className="sidebar-task-actions" role="group" aria-label={zh ? '快捷入口' : 'Quick actions'}>
    <div className="sidebar-primary-actions">
      <button type="button" className="new-chat" disabled={disabled} onClick={onNewSession}>
        <Plus size={16}/><span>{zh ? '新建会话' : 'New chat'}</span>
      </button>
      {onPlugins && <button type="button" disabled={disabled} aria-label={zh ? '插件市场' : 'Plugin marketplace'} onClick={onPlugins}>
        <Plug size={16}/><span>{zh ? '插件' : 'Plugins'}</span>
      </button>}
    </div>
    <div className="sidebar-utility-row" data-search-open={searchOpen}>
      <div className="sidebar-utility-links" inert={searchOpen} aria-hidden={searchOpen}>
        <button type="button" disabled={disabled} aria-current={selected ? 'page' : undefined} aria-pressed={selected}
          aria-label={zh ? '定时任务' : 'Schedules'} data-tooltip={selected ? zh ? '返回会话' : 'Back to conversation' : zh ? '定时任务' : 'Schedules'} onClick={onScheduledTasks}>
          <Clock3 size={15} aria-hidden="true"/>
        </button>
      </div>
      {onPlugins && <>
        <div id={searchId} className="sidebar-search-field" inert={!searchOpen} aria-hidden={!searchOpen}>
          <Search size={14} aria-hidden="true"/>
          <input ref={searchInput} readOnly disabled={disabled} tabIndex={searchOpen ? 0 : -1}
            aria-label={zh ? '会话搜索（待接入）' : 'Session search (coming soon)'}
            placeholder={zh ? '搜索会话（待接入）' : 'Search (coming soon)'}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); } }}/>
        </div>
        <button ref={searchTrigger} type="button" className="sidebar-search-toggle" disabled={disabled}
          aria-label={searchOpen ? zh ? '收起搜索' : 'Close search' : zh ? '搜索' : 'Search'}
          aria-expanded={searchOpen} aria-controls={searchId}
          data-tooltip={searchOpen ? zh ? '收起搜索' : 'Close search' : zh ? '搜索' : 'Search'}
          onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}>
          <Search size={15} className="sidebar-search-open-icon" aria-hidden="true"/>
          <X size={15} className="sidebar-search-close-icon" aria-hidden="true"/>
        </button>
      </>}
    </div>
  </div>;
}

function ScheduledHistory({ entries, label = '执行与恢复记录' }: { entries: CronHistoryEntry[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const disclosure = useAnimatedDisclosure(open);
  const labels: Record<CronHistoryEntry['state'], string> = {
    triggered: '已触发，尚未确认执行', running: '执行中', waiting: '等待审批', completed: '本轮已完成',
    failed: '执行失败', interrupted: '执行中断', unknown: '执行结果未确认',
    recovered: '已恢复调度宿主', recovery_failed: '恢复失败', recovery_blocked: '恢复需重新核对',
  };
  return <details className="scheduled-history" ref={disclosure.details}>
    <summary onClick={event => { event.preventDefault(); setOpen(!open); }}>
      {label} <span>{entries.length}</span><span className={open ? 'scheduled-history-chevron is-open' : 'scheduled-history-chevron'}><DisclosureChevron/></span>
    </summary>
    <div ref={disclosure.body} inert={!open}>
      <ol>{entries.map(entry => <li key={entry.id}>
        <span>{labels[entry.state]}{entry.reviewedAt ? ' · 已人工核对' : ''}</span><time dateTime={new Date(entry.updatedAt).toISOString()}>{new Date(entry.updatedAt).toLocaleString('zh-CN')}</time>
        <small>会话 {entry.sessionId.slice(0, 8)}{entry.jobId ? ` · 任务 ${entry.jobId}` : ' · 项目调度'}</small>
      </li>)}</ol>
    </div>
  </details>;
}

export function ScheduledTasks({ jobs, onCreate, onDelete, onUpdate, onDisableAutomatic, onOpenHost, hosts = [], sessions = [], onPrepareRecovery, onRecover,
  history = [], live = false, refreshing = false, issue, onRefresh }: {
  jobs: ScheduledTaskView[];
  onCreate: (value: ScheduledTaskCreation) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onUpdate?: (id: string, expected: string, changes: { cron?: string; prompt?: string; paused?: boolean }) => Promise<void>;
  onDisableAutomatic?: (id: string) => Promise<void>;
  onOpenHost?: (runtimeId: string) => Promise<void>;
  history?: { workspace: string; entries: CronHistoryEntry[] }[];
  hosts?: CronHost[]; live?: boolean; refreshing?: boolean; issue?: string; onRefresh?: () => void;
  sessions?: Session[];
  onPrepareRecovery?: (key: string, sessionId: string) => Promise<CronRecoveryPreview>;
  onRecover?: (token: string, automatic: boolean, acknowledgeUnconfirmed: boolean) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<ScheduledTaskView>();
  const [editOpen, setEditOpen] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoverySession, setRecoverySession] = useState('');
  const [recovery, setRecovery] = useState<CronRecoveryPreview>();
  const [automatic, setAutomatic] = useState(false);
  const [acknowledgeUnconfirmed, setAcknowledgeUnconfirmed] = useState(false);
  const [createWorkspace, setCreateWorkspace] = useState('');
  const [hostId, setHostId] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [recurring, setRecurring] = useState(true);
  const [durable, setDurable] = useState(true);
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
  const resetPage = () => { setCreating(false); setSelected(undefined); setConfirmDelete(false); setRecovering(false); setRecovery(undefined); setEditing(undefined); setEditOpen(false); };
  const back = () => navigate(resetPage);
  const create = () => navigate(() => setCreating(true));
  const cancelDelete = () => { setConfirmDelete(false); deleteButton.current?.focus(); };
  const save = async (action: () => void | Promise<void>, success: () => void, recoveryAction = false, failureMessage?: string) => {
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
      } else setFailure(failureMessage ?? '未能确认操作结果。请先刷新列表核对，避免重复创建；同时检查宿主是否空闲、项目信任及时间表达式。');
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
        onChange={setHostId}/></label>
        {selectedHost ? <div className="scheduled-boundary"><Info size={15}/><span>{selectedHost.workspace}<br/>
          {selectedHost.model ?? '当前模型'} · {selectedHost.permission ?? '当前权限'} · 沿用宿主当前账户</span></div>
          : <p className="muted">请先打开项目会话并发送消息，启动调度宿主。打开此页面不会自动启动运行时。</p>}
        <label>执行时间（本机时区）<input name="cron" required value={cron} maxLength={100} onChange={event => setCron(event.target.value)}/></label>
        <div className="scheduled-presets">{[{ label: '每天 09:00', value: '0 9 * * *' }, { label: '每周五 18:00', value: '0 18 * * 5' }, { label: '每小时', value: '0 * * * *' }].map(item =>
          <button key={item.value} type="button" onClick={() => setCron(item.value)}>{item.label}</button>)}</div>
        <label className="checkbox"><input type="checkbox" checked={recurring} onChange={event => setRecurring(event.target.checked)}/>周期执行</label>
        <fieldset className="scheduled-storage">
          <legend>保存方式</legend>
          <div className="scheduled-storage-options">
            <label><input type="radio" name="storage" value="durable" checked={durable} onChange={() => setDurable(true)} aria-describedby="scheduled-storage-note"/>持久任务</label>
            <label><input type="radio" name="storage" value="temporary" checked={!durable} onChange={() => setDurable(false)} aria-describedby="scheduled-storage-note"/>临时任务</label>
          </div>
          <p id="scheduled-storage-note" role="status">{durable
            ? '任务保存到项目，退出或更新应用后仍保留。重开后需启动项目宿主或手动恢复调度，退出期间不执行。'
            : '仅保留在当前宿主内存中。退出、更新应用或宿主终止后任务丢失，重开不会恢复；周期执行也不例外。'}</p>
          {durable && selectedHost && !selectedHost.trusted && <p className="scheduled-storage-blocked" role="alert">
            当前宿主未加载项目信任，无法创建持久任务。请返回对应会话执行 <code>/trust</code>，批准保存后手动重启宿主，再刷新此页。
            若已有临时任务，请先处理这些任务再重启；不会自动改成临时任务。
          </p>}
        </fieldset>
        <div className="scheduled-boundary"><Info size={15}/><span>执行频率与保存方式互相独立。周期任务七天后到期，触发沿用上游时间偏移；单次任务在下次匹配时触发后移除。</span></div>
      </> : <label>项目<ScheduledTaskSelect name="workspace" label="项目" value={createWorkspace || projects[0] || 'Desktop for Step Code'}
        options={(projects.length ? projects : ['Desktop for Step Code']).map(path => ({ id: path, label: path }))}
        onChange={setCreateWorkspace}/></label>}
      <label>任务指令<textarea name="prompt" required maxLength={4000} rows={5} placeholder="描述需要执行的任务，以及什么时候执行。"/></label>
      <div className="scheduled-boundary"><ShieldCheck size={16}/><span>持久任务需要信任项目；运行时使用的账户与权限将在创建时确认。</span></div>
      <footer><button type="button" onClick={back}>取消</button><button type="submit" disabled={live && (!selectedHost || selectedHost.busy || durable && !selectedHost.trusted)}><Plus size={15}/>{live ? '创建任务' : '预览创建'}</button></footer>
    </form> : task ? <div className="scheduled-detail">
      <div className="scheduled-detail-meta"><span><Folder size={14}/>{task.workspace}</span><span className={`scheduled-host ${task.host}`}><i/>{task.host === 'online' ? '调度宿主在线' : '调度宿主离线'}</span></div>
      <dl className="scheduled-properties">
        {task.paused && <div><dt>任务状态 · Beta</dt><dd>已暂停</dd></div>}
        <div><dt>执行安排</dt><dd>{task.schedule}</dd></div>
        <div><dt>{task.paused ? '暂停前计划时间' : task.host === 'offline' ? '计划时间' : '下次触发'}</dt><dd className="scheduled-next-time">{task.next}</dd></div>
        <div><dt>任务类型</dt><dd>{task.recurring ? '周期' : '单次'} · {task.durable ? '持久任务' : '临时任务'}</dd></div>
        <div><dt>自动到期</dt><dd>{task.expires ?? (task.recurring ? '未提供' : '触发后移除')}</dd></div>
        {(live || onOpenHost) && <div><dt>当前调度宿主</dt><dd className="scheduled-host-session">
          <span>{task.host === 'online' ? task.hostName ?? '在线宿主' : '宿主离线'}</span>
          {onOpenHost && <button type="button" className="icon-button scheduled-host-link" aria-label="前往宿主会话"
            data-tooltip={task.runtimeId && task.host === 'online' ? '前往宿主会话' : '宿主离线，请先恢复项目调度'}
            disabled={!task.runtimeId || task.host !== 'online'}
            onClick={() => void save(() => onOpenHost(task.runtimeId!), () => {}, false,
              '宿主会话暂时无法打开，请刷新任务列表后重试。不会自动重开会话或恢复调度。')}><ArrowUpRight size={14}/></button>}
        </dd></div>}
        {live && task.durable && <div><dt>关联会话 · Beta</dt><dd>{task.association
          ? associated?.name || associated?.firstMessage.slice(0, 60) || `${task.association.sessionId.slice(0, 8)}（当前不可用）`
          : '未记录'}</dd></div>}
      </dl>
      {!task.durable && <div className="scheduled-boundary scheduled-temporary-warning"><Info size={16}/><span>临时任务仅在当前宿主存活期间保留；退出或更新应用后丢失，即使是周期任务也不会跨重启恢复。</span></div>}
      <section className="scheduled-instructions"><h2>任务指令</h2><p>{task.prompt}</p></section>
      {task.automatic && task.automatic.state !== 'disabled' && <div className="scheduled-automatic">
        <span>自动恢复 · Beta：{task.automatic.state === 'enabled' ? '已授权' : '需重新核对'}</span>
        <span>授权到期 {new Date(task.automatic.expires).toLocaleString('zh-CN')}</span>
        {onDisableAutomatic && <button type="button" onClick={() => void save(() => onDisableAutomatic(task.id), () => {})}><Pause size={14}/>关闭自动恢复</button>}
      </div>}
      {Boolean(task.history?.length) && <ScheduledHistory key={task.id} entries={task.history!}/>}
      {task.paused && <div className="scheduled-boundary"><Pause size={15}/><span>暂停期间不触发，七天到期时间照常计算。恢复从下一个匹配时间继续，不补跑暂停期间的任务。</span></div>}
      <div id="scheduled-edit" className={`scheduled-recovery-disclosure${editOpen ? ' is-open' : ''}`} aria-hidden={!editOpen} inert={!editOpen}>
        <section className="scheduled-recovery">
          <form className="scheduled-editor scheduled-recovery-content" aria-label="编辑定时任务" onSubmit={event => {
            event.preventDefault();
            if (!editOpen || !editing?.revision || !onUpdate) return;
            const fields = new FormData(event.currentTarget);
            void save(() => onUpdate(editing.id, editing.revision!, { cron: String(fields.get('cron') ?? ''), prompt: String(fields.get('prompt') ?? '') }),
              () => { setEditOpen(false); editButton.current?.focus(); });
          }}>
            {editing && <React.Fragment key={editing.revision}>
              <h2>编辑任务 <small>Beta</small></h2>
              <label>执行时间（本机时区）<input name="cron" required maxLength={100} defaultValue={editing.schedule}/></label>
              <label>任务指令<textarea aria-label="任务指令" name="prompt" required maxLength={4000} rows={5} defaultValue={editing.prompt}/></label>
              <div className="scheduled-boundary"><Info size={15}/><span>保留任务身份、关联会话、保存方式及原到期时间。修改时间从下次匹配开始，不补跑；修改指令不改变下次触发时间。</span></div>
              <footer><button type="button" onClick={() => { setEditOpen(false); editButton.current?.focus(); }}>取消编辑</button>
                <button type="submit"><Save size={15}/>保存修改</button></footer>
            </React.Fragment>}
          </form>
        </section>
      </div>
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
        {recovery && <label className="checkbox scheduled-auto-option"><input type="checkbox" checked={automatic}
          onChange={event => setAutomatic(event.target.checked)}/>授权应用启动或空闲宿主异常后自动恢复此项目 · Beta</label>}
        {recovery && <p className="muted scheduled-auto-note">默认关闭。仅使用本次核对的已有会话、账户、模型与每次询问权限，授权最长七天。
          会话删除／归档、项目迁移、配置或任务变化、任务逾期及执行结果未确认时停止自动恢复，需重新核对；不新建会话，不自动重试或补跑。</p>}
        {recovery?.unconfirmed && automatic && <label className="checkbox scheduled-auto-option">
          <input type="checkbox" checked={acknowledgeUnconfirmed} onChange={event => setAcknowledgeUnconfirmed(event.target.checked)}/>
          我已核对历史未确认执行，不将其视为成功，也不补跑这些执行
        </label>}
        <footer><button type="button" onClick={() => { setRecovering(false); recoveryButton.current?.focus(); }}>取消恢复</button>
          {recovery ? <button type="button" disabled={automatic && recovery.unconfirmed && !acknowledgeUnconfirmed}
            onClick={() => void save(() => onRecover!(recovery.token, automatic, acknowledgeUnconfirmed),
            () => { setRecovery(undefined); setRecovering(false); }, true)}><Play size={15}/>确认恢复调度</button>
            : <button type="button" disabled={!recoverySession} onClick={() => void save(async () =>
              setRecovery(await onPrepareRecovery!(task.id, recoverySession)), () => {}, true)}><ShieldCheck size={15}/>核对恢复配置</button>}
        </footer>
      </div></section></div>}
      <footer className="scheduled-detail-footer">
        {onUpdate && <>
          <button type="button" ref={editButton} disabled={!task.runtimeId || !task.revision} aria-expanded={editOpen} aria-controls="scheduled-edit"
            onClick={() => { if (!editOpen) setEditing({ ...task }); setEditOpen(!editOpen); setConfirmDelete(false); }}><Pencil size={15}/>编辑 <small>Beta</small></button>
          <button type="button" disabled={!task.runtimeId || !task.revision || editOpen}
            onClick={() => void save(() => onUpdate(task.id, task.revision!, { paused: !task.paused }), () => {})}>
            {task.paused ? <Play size={15}/> : <Pause size={15}/>} {task.paused ? '恢复任务' : '暂停任务'} <small>Beta</small>
          </button>
        </>}
        {live && task.durable && task.host === 'offline' && onPrepareRecovery && onRecover
          && <button type="button" ref={recoveryButton} className="scheduled-recover" aria-expanded={recovering} aria-controls="scheduled-recovery" onClick={() => {
            if (recovering) { setRecovering(false); return; }
            setRecoverySession(recoveryTargets.some(session => session.id === task.association?.sessionId) ? task.association!.sessionId : '');
            setRecovery(undefined); setAutomatic(false); setAcknowledgeUnconfirmed(false); setRecovering(true);
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
        </div><span>{jobs.filter(job => job.host === 'online' && !job.paused).length} 项正在调度</span>
      </div>
      <div className="scheduled-list" aria-label="任务列表">
        {shown.map(job => <button type="button" className="scheduled-row" key={job.id} onClick={() => navigate(() => setSelected(job.id))}>
          <div className="scheduled-row-icon"><CalendarClock size={19}/></div>
          <div className="scheduled-row-content"><strong>{job.title}</strong><span className="scheduled-row-prompt">{job.prompt}</span>
            <span className="scheduled-row-meta"><span><Folder size={12}/>{job.workspace}</span><span>{job.recurring ? '周期' : '单次'} · {job.durable ? '持久' : '临时'}</span></span>
          </div>
          <div className="scheduled-row-timing"><span className={`scheduled-host ${job.paused ? 'offline' : job.host}`}><i/>{job.paused ? '已暂停 · Beta' : job.host === 'online' ? '等待触发' : '宿主离线'}</span>
            <span className="scheduled-next">{job.host === 'offline' && <span className="scheduled-time-label">计划时间</span>}<strong className="scheduled-next-time">{job.next}</strong></span>
            <small>{job.schedule}</small></div><span className="scheduled-row-chevron"><DisclosureChevron/></span>
        </button>)}
        {!shown.length && <div className="scheduled-empty"><CalendarClock size={28}/><h2>{refreshing ? '正在读取任务' : jobs.length ? '没有匹配的任务' : '暂无定时任务'}</h2>
          <button type="button" onClick={() => { if (jobs.length) { setQuery(''); setProject(''); } else create(); }}>
            {jobs.length ? <><X size={14}/>清除筛选</> : <><Plus size={15}/>创建任务</>}
          </button></div>}
      </div>
      {history.map(project => <ScheduledHistory key={project.workspace} entries={project.entries} label={`执行与恢复记录 · ${project.workspace}`}/>)}
      <div className="scheduled-boundary"><Info size={15}/><span>仅在调度宿主存活时触发。应用退出或电脑休眠期间不执行。</span></div>
    </>}
    </div>
  </section>;
}
