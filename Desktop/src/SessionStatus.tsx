import { useEffect, useState, type ReactNode } from 'react';
import { Brain, Check, Copy, Cpu, Folder, Hash, Shield, UserRound, Lightbulb, ListOrdered, Activity } from 'lucide-react';
import type { Snapshot, SessionStatusDetails } from './contracts';
import { effortLabel } from './ModelEffortPicker';
import { DisclosureChevron } from './DisclosureChevron';
import './session-status.css';

export function SessionStatus({ snapshot, title, onError, revision = 0, busy }: {
  snapshot: Snapshot; title: string; onError: (message: string) => void; revision?: number; busy?: boolean;
}) {
  const { state, modelSelection, permissionPreset, statusAccount: account } = snapshot;
  const zh = snapshot.preferences.language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const missing = t('未知', 'Unknown');
  const model = state?.model;
  const custom = Boolean(model && model.provider !== 'step');
  const pending = modelSelection && (modelSelection.model.id !== model?.id
    || modelSelection.model.provider !== model?.provider || modelSelection.thinkingLevel !== state?.thinkingLevel);
  const permissions = {
    ask: t('请求批准', 'Ask'), 'approve-for-me': t('代我批准', 'Approve for Me'), 'full-access': t('完全访问', 'Full Access'),
  };
  const [copied, setCopied] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const connected = snapshot.status === 'ready' || snapshot.status === 'connected';
  const canRead = connected && !snapshot.draftId && Boolean(snapshot.runtimeId && state?.sessionId);
  const detailKey = JSON.stringify([snapshot.runtimeId, state?.sessionId, model?.provider, model?.id, snapshot.launch?.plan, revision, canRead]);
  const [reading, setReading] = useState<{ key: string; data?: SessionStatusDetails; failed?: boolean }>({ key: '' });
  const details = reading.key === detailKey ? reading.data : undefined;
  const readFailed = reading.key === detailKey && reading.failed;
  useEffect(() => {
    if (!canRead || !window.desktop) return;
    let cancelled = false;
    const runtimeId = snapshot.runtimeId!;
    void window.desktop.summary(runtimeId).then(result => {
      if (cancelled) return;
      if (result.sessionId !== state?.sessionId) throw new Error('Session changed');
      const status = result.status;
      if (status?.provider && status.provider !== model?.provider || status?.model && status.model !== model?.id)
        throw new Error('Model changed');
      setReading({ key: detailKey, data: status });
    }).catch(() => { if (!cancelled) setReading({ key: detailKey, failed: true }); });
    return () => { cancelled = true; };
  }, [detailKey]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(''), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (value: string, label: string) => <button type="button" className="icon-button"
    aria-label={t(`复制${label}`, `Copy ${label}`)} data-tooltip={t(`复制${label}`, `Copy ${label}`)}
    onClick={() => { void window.desktop?.copyText(value).then(() => setCopied(label)).catch(error => onError(String(error))); }}>
    {copied === label ? <Check size={13}/> : <Copy size={13}/>}
  </button>;
  const row = (label: string, value: ReactNode, icon?: ReactNode) => <div className="session-status-row">
    <dt>{icon}{label}</dt><dd>{value}</dd>
  </div>;
  const thinking = model?.thinkingServiceDefault ? t('服务默认', 'Service default')
    : state?.thinkingLevel ? effortLabel(state.thinkingLevel, snapshot.preferences.language)
    : model?.reasoning === false ? t('不支持', 'Not supported') : missing;
  const route = custom ? model?.providerName ?? model?.provider ?? missing
    : account?.mode === 'plan' ? 'Step Plan' : account?.mode === 'api' ? t('官方 API', 'Official API')
    : account?.mode === 'none' ? t('未登录', 'Signed out') : missing;
  const waiting = Boolean(snapshot.requests?.length);
  const active = busy ?? state?.isStreaming;
  const runtimeState = !connected ? t('已断开', 'Disconnected') : snapshot.draftId ? t('待启动', 'Not started')
    : waiting ? t('等待确认', 'Waiting for approval') : state?.isCompacting ? t('整理上下文', 'Compacting')
    : active ? t('运行中', 'Running') : t('空闲', 'Idle');
  const notRead = !canRead ? t('暂无运行时数据', 'Runtime data unavailable') : readFailed ? t('读取失败', 'Read failed')
    : reading.key !== detailKey ? t('读取中', 'Loading') : t('未提供', 'Not provided');
  const plan = canRead && details?.collaboration === 'Plan' ? true
    : canRead && details?.collaboration === 'Default' ? false : snapshot.launch?.plan;
  return <div className="session-status-content">
    <div className="context-identity"><strong>{title}</strong><span>{!connected ? t('已断开 · 上次状态', 'Disconnected · Last known state')
      : snapshot.draftId ? t('待启动', 'Not started') : t('当前会话', 'Current session')}</span></div>
    <section><h3>{snapshot.draftId ? t('启动配置', 'Launch configuration') : t('运行配置', 'Runtime configuration')}</h3>
      <dl>
        {row(t('状态', 'State'), runtimeState, <Activity size={14}/>)}
        {row(t('模型', 'Model'), <><strong>{model?.name ?? missing}</strong>
          {model && <small>{model.providerName ?? model.provider} / {model.id}</small>}</>, <Cpu size={14}/>)}
        {row(t('思考', 'Thinking'), thinking, <Brain size={14}/>)}
        {row(t('权限', 'Permissions'), permissionPreset ? permissions[permissionPreset] : missing, <Shield size={14}/>)}
        {row(t('Plan 模式', 'Plan mode'), snapshot.draftId ? snapshot.launch?.plan || snapshot.launch?.planArmed
          ? t('发车时启用', 'Enable on send') : t('未选择', 'Not selected')
          : plan === undefined ? notRead : plan ? t('已启用', 'Enabled') : t('未启用', 'Disabled'), <Lightbulb size={14}/>)}
        {row(t('桌面队列', 'Desktop queue'), snapshot.draftId ? 0 : snapshot.pendingMessages?.length ?? missing, <ListOrdered size={14}/>)}
        {row(t('运行时队列', 'Runtime queue'), snapshot.draftId ? t('尚未启动', 'Not started')
          : state?.pendingMessageCount ?? missing, <ListOrdered size={14}/>)}
        {row(t('上下文', 'Context'), snapshot.stats?.contextUsage
          ? `${snapshot.stats.contextUsage.tokens?.toLocaleString() ?? '--'} / ${snapshot.stats.contextUsage.contextWindow.toLocaleString()}`
          : t('暂无数据', 'Unavailable'))}
      </dl>
      {pending && <div className="session-status-pending"><span>{t('下一轮生效', 'Applies next turn')}</span>
        <strong>{modelSelection.model.name}</strong><small>{modelSelection.thinkingLevel
          ? effortLabel(modelSelection.thinkingLevel, snapshot.preferences.language) : missing}</small></div>}
    </section>
    <section><h3>{t('请求账户', 'Request account')}</h3><dl>
      {row(t('方式', 'Method'), route, <UserRound size={14}/>)}
      {!custom && account?.region && row(t('地区', 'Region'), account.region === 'cn' ? t('国内', 'Mainland China') : t('海外', 'Global'))}
      {!custom && account?.userId && row(t('用户 ID', 'User ID'), <code>{account.userId}</code>)}
    </dl></section>
    <section><h3>{t('位置与会话', 'Workspace and session')}</h3><dl>
      {row(t('项目信任', 'Project trust'), details?.trusted === undefined ? notRead
        : details.trusted ? t('已信任', 'Trusted') : t('未信任', 'Not trusted'), <Shield size={14}/>)}
      {row(t('工作目录', 'Workspace'), snapshot.preferences.workspace
        ? <div className="session-status-copy"><code>{snapshot.preferences.workspace}</code>{copy(snapshot.preferences.workspace, t('工作目录', 'workspace'))}</div>
        : t('未选择项目', 'No project selected'), <Folder size={14}/>)}
      {row(t('会话 ID', 'Session ID'), state?.sessionId
        ? <div className="session-status-copy"><code>{state.sessionId}</code>{copy(state.sessionId, t('会话 ID', 'session ID'))}</div>
        : t('尚未创建', 'Not created'), <Hash size={14}/>)}
    </dl></section>
    <section className="session-status-detail-section">
      <button type="button" className="session-status-detail-toggle" aria-expanded={detailsOpen}
        aria-controls="session-status-details" onClick={() => setDetailsOpen(value => !value)}>
        <span>{t('详细信息', 'Details')}</span><DisclosureChevron/>
      </button>
      <div id="session-status-details" className={`session-status-details${detailsOpen ? ' is-open' : ''}`}
        aria-hidden={!detailsOpen} inert={!detailsOpen}>
        <div><dl>
          {row(t('Runtime 版本', 'Runtime version'), details?.version
            ? <><code>{details.version}</code><small>{details.versionSource === 'fallback' ? t('源码默认值', 'Source default')
              : details.versionSource === 'override' ? t('显式覆盖', 'Explicit override')
                : details.versionSource === 'embedded' ? t('构建内嵌', 'Embedded build') : missing}</small></> : notRead)}
          {row(t('源码钉点', 'Source commit'), details?.commit ? <code>{details.commit}</code> : notRead)}
          {row('Node.js', details?.node ? <code>{details.node}</code> : notRead)}
          {row(t('请求端点', 'Endpoint'), details?.endpoint ? <code>{details.endpoint}</code> : notRead)}
          {row(t('项目指引', 'Instructions'), details?.agents
            ? details.agents.length ? <ul className="session-status-agents">{details.agents.map(path => <li key={path}><code>{path}</code></li>)}
              {details.agentsTruncated && <li>{t('仅展示前 128 项', 'Showing the first 128 entries')}</li>}</ul>
              : t('未加载指引文件', 'No instruction files loaded') : notRead)}
        </dl></div>
      </div>
    </section>
  </div>;
}
