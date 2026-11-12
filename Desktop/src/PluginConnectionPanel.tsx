import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Cable, CircleCheck, FolderOpen, RefreshCw, X } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import type { PluginConnection } from './capabilities';
import { PluginConnectionPreparation } from './PluginConnectionPreparation';
import type { PluginConnectionGuide } from './plugin-connection-preparation';
import './plugin-connection.css';

export type PluginConnectionBridge = Partial<Pick<DesktopBridge,
  'pluginConnectionState' | 'pluginConnectionChooseProfile' | 'pluginConnectionForgetProfile'>>;

const copy = {
  zh: {
    title: '准备检查', readOnly: '只读', refresh: '重新检查',
    forget: '忘记此选择', guide: '安装指南', checking: '正在检查连接…', failed: '连接检查未完成，请重试。',
    unsupported: '当前客户端不支持此连接面板，请更新客户端。',
    profile: 'Profile 目录', identity: '连接身份', roots: '可见目录', noRoots: '当前身份没有可见的授权目录。',
    tasks: '任务摘要', batch: '首批记录 · 最多 20 项', noTasks: '首批记录中没有符合当前身份与目录范围的任务。',
    checked: '检查于', untitled: '未命名任务',
    agentStatus: '智能体状态', quickBatch: '首批记录 · 最多 5 项',
    quickReady: '当前身份已核验。仅显示本次查询结果，不代表配套组件已加载或可以派工。',
    quickSetup: '请打开完整工作台，在连接页选择已安装 companion 的本机 profile。',
    status: {
      unselected: ['尚未选择 profile', '先选择 Agent 使用的独立 profile，再检查准备情况。安装市场插件不会自动安装或连接 Agent。'],
      'profile-missing': ['Profile 不可用', '所选目录不存在，或不是包含 config.yaml 的本机 profile。请重新选择。'],
      'companion-missing': ['缺少 companion 配置', '此 profile 没有 dfsc-bridge 配置。请先按安装指南完成 companion 安装。'],
      'configuration-invalid': ['连接配置无效', '请检查 companion 配置及本机 Bridge 描述文件。此处不会自动修改它们。'],
      'pairing-required': ['缺少配对凭据', '请按安装指南完成配对并导入配置。本机模式使用 DFSC「远程访问」中的「外部 Agent」；旧版模式需专版宿主。'],
      'connection-unavailable': ['无法连接 Agent Bridge', '请确认配置指向的连接服务正在运行、配对仍有效，且授权目录仍存在。'],
      'identity-mismatch': ['连接身份不匹配', '所选 profile、配对凭据与宿主返回的身份不一致，已停止读取任务。'],
      ready: ['只读连接已核验', '这不代表 companion 已加载，也不代表可以派工。请在配置对应的 DFSC 或专版宿主中管理配对、授权与任务。'],
    },
    phase: { creating: '创建中', queued: '排队中', interrupted: '已中断', running: '运行中', waiting: '等待中', review: '待审查', paused: '已暂停',
      completed: '已完成', accepted: '已验收', stopped: '已停止', failed: '失败', unknown: '状态未知' },
  },
  en: {
    title: 'Preparation check', readOnly: 'Read only', refresh: 'Check again',
    forget: 'Forget selection', guide: 'Setup guide', checking: 'Checking connection…', failed: 'Connection check did not complete. Try again.',
    unsupported: 'Update the desktop client to use this connection panel.',
    profile: 'Profile directory', identity: 'Agent identity', roots: 'Visible directories', noRoots: 'No authorized directories are visible to this identity.',
    tasks: 'Task summaries', batch: 'First batch · Up to 20', noTasks: 'No tasks in the first batch match this identity and directory scope.',
    checked: 'Checked at', untitled: 'Untitled task',
    agentStatus: 'Agent status', quickBatch: 'First batch · Up to 5',
    quickReady: 'Identity verified for this check only. Companion loading and dispatch readiness are not established.',
    quickSetup: 'Open the full workspace and choose a local profile with the companion installed on the Connection tab.',
    status: {
      unselected: ['No profile selected', 'Choose the Agent’s independent profile, then check preparation. Marketplace installation does not install or connect the Agent.'],
      'profile-missing': ['Profile unavailable', 'The selected directory is missing or is not a local profile containing config.yaml. Choose another directory.'],
      'companion-missing': ['Companion configuration missing', 'This profile has no dfsc-bridge configuration. Complete companion installation using the setup guide.'],
      'configuration-invalid': ['Invalid connection configuration', 'Check the companion configuration and local Bridge descriptor. This panel will not modify either.'],
      'pairing-required': ['Pairing credentials missing', 'Follow the setup guide to pair and import the configuration. Local mode uses DFSC Remote access > External agents; legacy mode needs its dedicated host.'],
      'connection-unavailable': ['Agent Bridge unavailable', 'Check that the configured connection service is running, pairing is still valid, and authorized directories still exist.'],
      'identity-mismatch': ['Agent identity mismatch', 'The selected profile, pairing credentials and host identity disagree. Task reading has stopped.'],
      ready: ['Read-only connection verified', 'This does not establish companion loading or dispatch readiness. Manage pairing, authorization and tasks in the DFSC or dedicated host named by the configuration.'],
    },
    phase: { creating: 'Creating', queued: 'Queued', interrupted: 'Interrupted', running: 'Running', waiting: 'Waiting', review: 'In review', paused: 'Paused',
      completed: 'Completed', accepted: 'Accepted', stopped: 'Stopped', failed: 'Failed', unknown: 'Unknown' },
  },
} as const;

export function PluginConnectionPanel({ bridge, packageRef, language, active, onGuide, compact = false, hasFirstTask = false }: {
  bridge: PluginConnectionBridge; packageRef: string; language: 'zh' | 'en'; active: boolean; onGuide(guide?: PluginConnectionGuide): void;
  compact?: boolean; hasFirstTask?: boolean;
}) {
  const c = copy[language];
  const [state, setState] = useState<PluginConnection>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const profileButton = useRef<HTMLButtonElement>(null);
  const available = !!(bridge.pluginConnectionState && bridge.pluginConnectionChooseProfile && bridge.pluginConnectionForgetProfile);
  const run = useCallback(async (action: 'read' | 'choose' | 'forget') => {
    const ticket = ++generation.current;
    setPending(true);
    // A failed new observation must not leave an old verified identity or task list on screen.
    if (action !== 'choose') { setState(undefined); setFailed(false); }
    try {
      const method = action === 'read' ? bridge.pluginConnectionState
        : action === 'choose' ? bridge.pluginConnectionChooseProfile : bridge.pluginConnectionForgetProfile;
      if (!method) throw new Error('Unavailable');
      const result = await method({ ref: packageRef });
      if (generation.current === ticket && result) { setState(result); setFailed(false); }
    } catch {
      if (generation.current === ticket) { setState(undefined); setFailed(true); }
    } finally {
      if (generation.current === ticket) {
        setPending(false);
        if (action === 'forget') requestAnimationFrame(() => {
          const button = profileButton.current;
          if (generation.current === ticket && button?.isConnected && !button.disabled
            && button.getClientRects().length && !button.closest('[hidden], [inert]'))
            button.focus({ preventScroll: true });
        });
      }
    }
  }, [bridge, packageRef]);
  useEffect(() => {
    if (active && available) void run('read');
    return () => { generation.current++; };
  }, [active, available, run]);
  const status = state && c.status[state.status];
  const ready = !pending && !failed && state?.status === 'ready';
  const attention = !pending && (failed || (state !== undefined && state.status !== 'unselected' && state.status !== 'ready'));
  return <div className={`plugin-connection${compact ? ' is-compact' : ''}`} aria-busy={pending} data-connection-status={failed ? 'error' : state?.status ?? 'loading'}>
    <header className="plugin-connection-heading">
      <h2>{compact ? c.agentStatus : c.title}</h2><span className="plugin-connection-mode">{c.readOnly}</span>
      {available && <button type="button" className="icon-button" disabled={pending}
        aria-label={c.refresh} data-tooltip={c.refresh} onClick={() => void run('read')}><RefreshCw size={16}/></button>}
    </header>
    <div className={`plugin-connection-status${ready ? ' is-verified' : attention ? ' is-attention' : ''}`} role={failed ? 'alert' : 'status'}>
      {ready ? <CircleCheck size={20}/> : <Cable size={20}/>}
      <div>
        <h3>{!available ? c.unsupported : pending ? c.checking : failed ? c.failed : status?.[0]}</h3>
        {!pending && !failed && available && <p>{compact && ready ? c.quickReady
          : compact && state?.status === 'unselected' ? c.quickSetup : status?.[1]}</p>}
      </div>
    </div>
    {!compact && !ready && <div className="plugin-connection-actions">
      <button type="button" onClick={() => onGuide('setup')}><BookOpen size={15}/>{c.guide}</button>
    </div>}
    {!pending && state?.profile && (!compact || ready) && <dl className="plugin-connection-details">
      {!compact && <div><dt>{c.profile}</dt><dd className="plugin-connection-profile"><span>{state.profile}</span>
        <button type="button" className="icon-button" aria-label={c.forget} data-tooltip={c.forget}
          onClick={() => void run('forget')}><X size={16}/></button></dd></div>}
      {state.agentId && <div><dt>{c.identity}</dt><dd>{state.displayName && <span>{state.displayName} · </span>}<code>{state.agentId}</code></dd></div>}
    </dl>}
    {!compact && <PluginConnectionPreparation state={pending || failed || !available ? undefined : state}
      language={language} pending={pending} available={available} hasFirstTask={hasFirstTask} profileButton={profileButton}
      onChoose={() => void run('choose')} onGuide={onGuide}/>}
    {!pending && ready && <>
      {!compact && <section className="plugin-connection-section" aria-label={c.roots}>
        <h3>{c.roots}<span>{state.roots.length}</span></h3>
        {state.roots.length ? <ul className="plugin-connection-roots">{state.roots.map(root =>
          <li key={root}><FolderOpen size={15}/><span>{root}</span></li>)}</ul>
          : <p className="plugin-connection-empty">{c.noRoots}</p>}
      </section>}
      <section className="plugin-connection-section" aria-label={c.tasks}>
        <h3>{c.tasks}<span>{compact ? c.quickBatch : c.batch}</span></h3>
        {state.tasks.length ? <ul className="plugin-connection-tasks">{state.tasks.slice(0, compact ? 5 : 20).map((task, index) => <li key={`${task.id}-${index}`}>
          <div><strong>{task.title || c.untitled}</strong><span className="plugin-connection-phase">
            {c.phase[task.phase as keyof typeof c.phase] ?? c.phase.unknown}</span></div>
          <p><code>{task.id}</code>{!compact && <span>{task.cwd}</span>}</p>
        </li>)}</ul> : <p className="plugin-connection-empty">{c.noTasks}</p>}
      </section>
      {state.checkedAt && <p className="plugin-connection-checked">{c.checked} <time dateTime={new Date(state.checkedAt).toISOString()}>
        {new Date(state.checkedAt).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US')}</time></p>}
    </>}
  </div>;
}
