import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, Copy, Globe2, Info, Link2, LockKeyhole, Monitor, Radio, RefreshCw, Server, ShieldCheck, Smartphone, Square, Unlink } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import { remoteCommands, remoteWorkspaceLimit, type RemoteAction, type RemoteSnapshot } from './remote';
import { ScheduledTaskSelect } from './ScheduledTasks';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import './remote-access.css';

const feishuIcon = new URL('./assets/feishu.svg', import.meta.url).href;
export function RemoteAccessPanel({ bridge, language, onBack }: { bridge: DesktopBridge; language: string; onBack: () => void }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [state, setState] = useState<RemoteSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<'channels' | 'connections' | 'runtime'>('channels');
  const [channel, setChannel] = useState<'feishu' | 'web'>();
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState('');
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [allowImages, setAllowImages] = useState(false);
  const [confirmation, setConfirmation] = useState<'disconnect' | 'unbind'>();
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  const stage = useRef<HTMLHeadingElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const confirmTrigger = useRef<HTMLButtonElement>(null);
  const disclosure = useAnimatedDisclosure(Boolean(confirmation));
  const id = useId();
  const accept = (next: RemoteSnapshot) => setState(previous => !previous || next.revision >= previous.revision ? next : previous);
  useEffect(() => {
    alive.current = true;
    const load = () => void bridge.remoteState().then(next => { if (alive.current) accept(next); })
      .catch(() => { if (alive.current) setError(t('无法读取远程连接状态', 'Could not read Remote state')); });
    load();
    const unsubscribe = bridge.onEvent(event => {
      if (event.type === 'desktop_remote') accept(event.state);
      else if (event.type === 'desktop_runtimes') load();
    });
    return () => { alive.current = false; unsubscribe(); };
  }, [bridge, language]);
  useEffect(() => {
    if (!state?.authorization && !state?.bindingCode) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state?.authorization?.expiresAt, state?.bindingCode?.expiresAt]);
  useEffect(() => { if (channel) stage.current?.focus({ preventScroll: true }); }, [channel, step]);
  useEffect(() => { if (confirmation) cancel.current?.focus({ preventScroll: true }); }, [confirmation]);
  const act = async (action: RemoteAction) => {
    setError(''); setBusy(true);
    try {
      const next = await bridge.remoteAction(action);
      if (alive.current) accept(next);
      return true;
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : t('操作失败', 'Operation failed'));
      return false;
    } finally { if (alive.current) setBusy(false); }
  };
  const connected = state?.status === 'connected';
  const connecting = state?.status === 'pairing' || state?.status === 'connecting';
  const binding = state?.binding;
  const authorized = state?.authorized;
  const status = !state ? t('读取中', 'Loading') : ({
    idle: t('未连接', 'Not connected'), pairing: t('等待授权', 'Awaiting authorization'),
    connecting: t('连接中', 'Connecting'), connected: t('已连接', 'Connected'),
    degraded: t('重连中', 'Reconnecting'), error: t('连接异常', 'Connection error'),
  })[state.status];
  const pages = [{ id: 'channels' as const, label: t('接入渠道', 'Channels') },
    { id: 'connections' as const, label: t('已授权连接', 'Authorized connections') },
    { id: 'runtime' as const, label: t('运行状态', 'Host status') }];
  const code = state?.bindingCode && state.bindingCode.expiresAt > now ? state.bindingCode : undefined;
  const selected = state?.sessions.find(session => session.sessionId === target);
  const projects = [...new Set(state?.projects?.map(project => project.workspace) ?? state?.sessions.map(session => session.workspace) ?? [])];
  const scope = [...new Set([...(selected ? [selected.workspace] : []), ...workspaces])].filter(workspace => projects.includes(workspace));
  const sessions = state?.sessions.filter(session => !authorized || authorized.workspaces.includes(session.workspace)) ?? [];
  const resetPage = (value: typeof page) => { setConfirmation(undefined); setChannel(undefined); setPage(value); setError(''); };
  const feishu = (size: number) => <img className="remote-feishu-icon" src={feishuIcon} width={size} height={size} alt="" aria-hidden="true"/>;
  const ask = (value: 'disconnect' | 'unbind', trigger: HTMLButtonElement) => { confirmTrigger.current = trigger; setConfirmation(value); };
  const closeConfirmation = () => { setConfirmation(undefined); confirmTrigger.current?.focus(); };
  const disconnectButton = <button className="remote-text-action" onClick={event => ask('disconnect', event.currentTarget)}><Unlink size={14}/>{t('断开连接', 'Disconnect')}</button>;
  return <section className="remote-access-view remote-live" aria-label={t('远程访问', 'Remote access')}>
    <header><button onClick={onBack}><ArrowLeft size={15}/>{t('返回会话', 'Back to conversation')}</button><span>{t('远程访问', 'Remote access')}</span></header>
    <div className="remote-scroll"><div className="remote-page">
      <header className="remote-header"><div className="remote-page-title"><Smartphone size={23}/><h1>{t('远程访问', 'Remote access')}</h1><span className="remote-tag">Beta</span></div>
        <span className={`remote-status ${connected ? 'is-online' : ''}`}><i/>{status}</span></header>
      <nav className="remote-tabs" role="tablist" aria-label={t('远程访问页面', 'Remote access pages')}>
        {pages.map((item, index) => <button ref={element => { tabs.current[index] = element; }} key={item.id} role="tab" aria-label={item.label}
          id={`${id}-${item.id}`} aria-controls={`${id}-panel`} aria-selected={page === item.id} tabIndex={page === item.id ? 0 : -1}
          onClick={() => resetPage(item.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : undefined;
            if (next !== undefined) { event.preventDefault(); resetPage(pages[next].id); tabs.current[next]?.focus(); }
          }}>{item.label}{item.id === 'connections' && authorized && <span>1</span>}</button>)}
      </nav>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${page}`} className="remote-tab-content">
        {page === 'channels' && !channel && <section className="remote-channel-overview">
          <div className="remote-section-heading"><h2>{t('接入渠道', 'Channels')}</h2><span className="remote-section-subtitle">{t('1 个可用 · 1 个规划中', '1 available · 1 planned')}</span></div>
          <div className="remote-channel-options">
            <button className="remote-channel-option" onClick={() => { setChannel('feishu'); setStep(0); }}>{feishu(34)}
              <span className="remote-option-info"><strong>{t('飞书', 'Feishu')}</strong><span>{t('私聊远程访问 · 多会话 Beta', 'Private-chat access · Multi-session Beta')}</span>
                <span className={`remote-status ${connected ? 'is-online' : ''}`}><i/>{status}</span></span>
              <span className="remote-option-action">{t('管理配置', 'Manage')}<ArrowRight size={15}/></span></button>
            <button className="remote-channel-option is-planned" onClick={() => setChannel('web')}><Globe2 size={32}/>
              <span className="remote-option-info"><strong>{t('浏览器访问', 'Browser access')}</strong><span>{t('手机或电脑通过 URL 访问', 'Access from a phone or computer via URL')}</span><span>{t('规划中', 'Planned')}</span></span><ArrowRight size={15}/></button>
          </div>
        </section>}
        {page === 'channels' && channel && <div className="remote-channel-flow">
          <button className="remote-text-action remote-channel-back" onClick={() => { setChannel(undefined); setConfirmation(undefined); }}><ArrowLeft size={14}/>{t('返回接入渠道', 'Back to channels')}</button>
          <div className="remote-channel-detail"><div className="remote-detail-heading"><div className="remote-channel-name">
            {channel === 'feishu' ? feishu(23) : <Globe2 size={23}/>}<div><h2>{channel === 'feishu' ? t('飞书', 'Feishu') : t('浏览器访问', 'Browser access')}</h2><p>{t('远程渠道', 'Remote channel')}</p></div>
          </div><span className={`remote-status ${connected && channel === 'feishu' ? 'is-online' : ''}`}><i/>{channel === 'feishu' ? status : t('规划中', 'Planned')}</span></div>
          {channel === 'web' ? <div className="remote-web-placeholder"><Smartphone size={33}/><Monitor size={44}/><div><strong>{t('浏览器服务尚未接入', 'Browser service is not integrated')}</strong><span>{t('访问地址未生成', 'No access URL has been created')}</span></div></div> : <>
            <nav className="remote-setup-steps" aria-label={t('飞书配置步骤', 'Feishu setup steps')}>
              {[t('连接授权', 'Connection'), t('访问范围', 'Access scope'), t('就绪检查', 'Readiness')].map((label, index) =>
                <button key={label} aria-current={step === index ? 'step' : undefined} disabled={index > 0 && !connected || index === 2 && !authorized}
                  onClick={() => { setStep(index); setConfirmation(undefined); }}><span>{index === 0 && connected || index === 1 && authorized ? <Check size={12}/> : index + 1}</span>{label}</button>)}
            </nav>
            <section className="remote-setup-stage">
              <div className="remote-setup-heading"><h3 ref={stage} tabIndex={-1}>{step === 0 ? t('连接飞书', 'Connect Feishu') : step === 1 ? t('私聊与项目授权', 'Chat and project access') : t('检查远端可用范围', 'Review remote access')}</h3><span>{step + 1} / 3</span></div>
              {step === 0 && <>
                <div className="remote-connection-notice" role="status">{connected ? <Check size={20}/> : connecting ? <Radio size={20}/> : <Link2 size={20}/>}
                  <div><strong>{connected ? state?.botName || status : status}</strong><p>{t('连接凭据在本机加密保存，重新打开 Desktop 后恢复。Desktop 退出期间不可用。', 'Connection credentials are encrypted locally and restored when Desktop reopens. Remote is unavailable while Desktop is closed.')}</p></div>
                  {!connecting && !connected && <button className="primary" disabled={busy || !state} onClick={() => void (async () => {
                    await act({ type: 'connect' });
                  })()}><Link2 size={14}/>{state?.saved ? t('重试连接', 'Retry connection') : t('连接飞书', 'Connect Feishu')}</button>}
                </div>
                {state?.authorization && <div className="remote-form-actions"><button disabled={busy || state.authorization.expiresAt <= now} onClick={() => void act({ type: 'openAuthorization' })}>
                  <ArrowUpRight size={14}/>{t('打开飞书授权', 'Open Feishu authorization')}</button></div>}
                {(connecting || connected || state?.status === 'degraded' || state?.saved || state?.storageError) && <div className="remote-form-actions">{disconnectButton}</div>}
                {state?.status === 'error' && <p className="remote-inline-note"><CircleAlert size={13}/>{t(`失败阶段：${state.stage ?? 'transport'}`, `Failed stage: ${state.stage ?? 'transport'}`)}</p>}
                <dl className="remote-properties"><div><dt>{t('授权方式', 'Authorization')}</dt><dd>{t('本机配对授权', 'Local pairing')}</dd></div>
                  <div><dt>{t('凭据保存', 'Credential storage')}</dt><dd>{state?.storageError ? t('保存异常', 'Storage error') : state?.saved ? t('本机加密', 'Encrypted locally') : t('尚未保存', 'Not saved yet')}</dd></div></dl>
              </>}
              {step === 1 && <>
                {authorized ? <><div className="remote-binding"><Link2 size={20}/><div><span className="remote-binding-caption">{t('当前远程会话', 'Current remote session')}</span><strong>{binding?.name ?? t('尚未选择', 'Not selected')}</strong><small>{binding?.workspace}</small></div><span className="remote-tag">{t('可切换', 'Switchable')}</span></div>
                  {state?.targetUnconfirmed && <p className="remote-stage-error" role="status">{t('输入目标待确认。成功选择会话前，新的正文和图片不会发送。', 'Input target is unconfirmed. Select a session before sending more text or images.')}</p>}
                  <label><span>{t('目标会话', 'Target session')}</span><ScheduledTaskSelect label={t('目标会话', 'Target session')} value={target || binding?.sessionId || ''}
                    options={[{ id: '', label: t('选择会话', 'Choose a session') }, ...sessions.map(session => ({ id: session.sessionId, label: session.name }))]}
                    onChange={setTarget}/></label>
                  <div className="remote-form-actions"><button disabled={busy || !connected || !selected || selected.sessionId === binding?.sessionId && !state?.targetUnconfirmed}
                    onClick={() => selected && void act({ type: 'select', sessionId: selected.sessionId })}><ArrowRight size={14}/>{t('切换远程会话', 'Switch remote session')}</button></div>
                  <dl className="remote-properties">{authorized.workspaces.map(workspace => <div key={workspace}><dt>{t('已授权项目', 'Authorized project')}</dt><dd>{workspace}</dd></div>)}</dl>
                  <label className="checkbox"><input type="checkbox" checked={state?.imagesAllowed === true} disabled={busy || !connected}
                    onChange={event => void act({ type: 'images', allowed: event.target.checked })}/><span>{t('允许图片输入与明确交付的图片外发', 'Allow image input and explicit image delivery')}</span></label>
                  <div className="remote-form-actions"><button onClick={event => ask('unbind', event.currentTarget)}><Unlink size={14}/>{t('解除绑定', 'Unbind')}</button></div></> : <>
                  <div className="remote-form-actions"><button disabled={busy || !connected} onClick={() => void act({ type: 'armBinding' })}><RefreshCw size={14}/>{code ? t('重新生成验证码', 'New verification code') : t('生成验证码', 'Generate verification code')}</button></div>
                  {code && <><div className="remote-binding-code"><code>{code.code}</code><small>{Math.max(0, Math.ceil((code.expiresAt - now) / 1000))}s</small>
                    <button className="icon-button" aria-label={t('复制验证码', 'Copy verification code')} data-tooltip={t('复制验证码', 'Copy verification code')} onClick={() => void bridge.copyText(code.code).catch(() => setError(t('复制失败', 'Copy failed')))}><Copy size={14}/></button></div>
                    <p className="remote-inline-note"><LockKeyhole size={13}/>{t('在飞书机器人的私聊中发送此验证码。请勿分享验证码。', 'Send this code in a private chat with the bot. Do not share it.')}</p></>}
                  <label><span>{t('目标会话', 'Target session')}</span><ScheduledTaskSelect label={t('目标会话', 'Target session')} value={target}
                    options={[{ id: '', label: t('选择起始会话', 'Choose a starting session') }, ...sessions.map(session => ({ id: session.sessionId, label: session.name }))]}
                    onChange={setTarget}/></label>
                  {selected && <p className="remote-inline-note">{selected.workspace}</p>}
                  <fieldset className="remote-scope"><legend>{t('允许访问的项目', 'Authorized projects')} · {scope.length} / {remoteWorkspaceLimit}</legend>{projects.map(workspace =>
                    <label key={workspace}><input type="checkbox" checked={scope.includes(workspace)}
                      disabled={workspace === selected?.workspace || !scope.includes(workspace) && scope.length >= remoteWorkspaceLimit}
                      onChange={event => setWorkspaces(previous => event.target.checked ? [...previous, workspace] : previous.filter(value => value !== workspace))}/><span>{workspace}</span></label>)}</fieldset>
                  <label className="checkbox"><input type="checkbox" checked={allowImages} onChange={event => setAllowImages(event.target.checked)}/>
                    <span>{t('允许图片输入与明确交付的图片外发', 'Allow image input and explicit image delivery')}</span></label>
                  {scope.length > remoteWorkspaceLimit && <p className="remote-stage-error" role="alert">{t(`最多授权 ${remoteWorkspaceLimit} 个项目`, `Authorize at most ${remoteWorkspaceLimit} projects`)}</p>}
                  {code && state?.candidate && <p className="remote-inline-note" role="status"><Check size={13}/>{t('已收到验证码。确认将允许此私聊列出、切换和新建所选项目内的会话，并收发选中会话后续回复、消息、停止与工具审批。已有对话正文不主动发送。', 'Code received. Confirm to allow listing, switching and creating sessions in the selected projects, future replies and messages in attached sessions, task stopping and tool approval. Existing transcript content is not automatically sent.')}</p>}
                  <div className="remote-form-actions"><button className="primary" disabled={busy || !connected || !code || !state?.candidate || !selected || scope.length > remoteWorkspaceLimit} onClick={() => {
                    if (selected && state?.candidate) void act({ type: 'bind', candidateId: state.candidate.id, runtimeId: selected.runtimeId, sessionId: selected.sessionId, workspaces: scope, imagesAllowed: allowImages });
                  }}><ShieldCheck size={14}/>{t('确认并绑定', 'Confirm and bind')}</button></div>
                </>}
              </>}
              {step === 2 && <>
                <ol className="remote-stages">{[{ label: t('配对授权', 'Paired'), done: connected }, { label: t('消息连接', 'Transport'), done: connected },
                  { label: t('私聊授权', 'Chat authorized'), done: !!authorized }, { label: t('审批回调', 'Approvals'), done: !!state?.approvalReady }].map(item =>
                  <li key={item.label} data-ready={item.done}><span>{item.done ? <Check size={12}/> : <span/>}</span>{item.label}</li>)}</ol>
                <dl className="remote-properties"><div><dt>{t('当前远程会话', 'Current remote session')}</dt><dd>{binding?.name || t('未选择', 'Not selected')}</dd></div>
                  <div><dt>{t('已授权项目', 'Authorized projects')}</dt><dd>{authorized?.workspaces.length ?? 0}</dd></div>
                  <div><dt>{t('工具审批', 'Tool approvals')}</dt><dd>{state?.approvalReady ? t('回调已验证', 'Callback verified') : t('回调未验证', 'Callback not verified')}</dd></div>
                  <div><dt>{t('登录、表单与权限等级', 'Sign-in, forms and permission tiers')}</dt><dd>{t('仅在本机', 'Local only')}</dd></div>
                </dl>
                <div className="remote-form-actions"><button disabled={busy || !connected} onClick={() => void act({ type: 'openCallbacks' })}><ArrowUpRight size={14}/>{t('配置飞书回调', 'Configure Feishu callbacks')}</button>
                  <button disabled={busy || !connected || !authorized} onClick={() => void act({ type: 'checkCallbacks' })}><ShieldCheck size={14}/>{t('发送验证卡片', 'Send verification card')}</button></div>
                <p className="remote-inline-note"><Info size={13}/>{t('验证按钮不批准工具。未验证时仍可在本机审批。', 'Verification does not approve tools. Local approval remains available.')}</p>
                <dl className="remote-command-list">{remoteCommands.map(item => <div key={item.command}><dt><code>{item.command}</code></dt><dd>{t(item.zh, item.en)}</dd></div>)}</dl>
                <footer className="remote-channel-footer">{disconnectButton}<button className="remote-text-action" disabled={busy || !connected || !binding} onClick={() => void act({ type: 'stop' })}><Square size={13}/>{t('停止当前远程任务', 'Stop the current remote task')}</button></footer>
              </>}
              {!connected && step > 0 && <p className="remote-inline-note"><CircleAlert size={14}/>{t('远端操作已暂停，请先恢复连接。', 'Remote actions are paused. Restore the connection first')}</p>}
            </section>
            <footer className="remote-setup-footer"><button onClick={() => step ? setStep(step - 1) : setChannel(undefined)}><ArrowLeft size={14}/>{step ? t('上一步', 'Back') : t('渠道总览', 'Channels')}</button>
              <button className="primary" disabled={step < 2 && (!connected || step === 1 && !authorized)} onClick={() => step === 2 ? setChannel(undefined) : setStep(step + 1)}>{step === 2 ? t('完成', 'Done') : t('继续', 'Continue')}<ArrowRight size={14}/></button></footer>
          </>}</div>
        </div>}
        {page === 'connections' && <section className="remote-connections"><div className="remote-section-heading"><h2>{t('已授权连接', 'Authorized connections')}</h2><ShieldCheck size={19}/></div>
          {authorized ? <div className="remote-authorized-row">{feishu(22)}<div className="remote-authorized-info"><strong>{t('飞书私聊', 'Feishu private chat')}</strong><span>{binding?.name ?? t('未选择会话', 'No session selected')}</span><small>{authorized.workspaces.length} {t('个授权项目', 'authorized project(s)')}</small></div>
            <span className="remote-status">{status}</span><button onClick={event => ask('unbind', event.currentTarget)}><Unlink size={14}/>{t('解除绑定', 'Unbind')}</button></div>
            : <div className="remote-empty"><ShieldCheck size={30}/><h3>{t('暂无已授权连接', 'No authorized connections')}</h3><button onClick={() => resetPage('channels')}>{t('查看接入渠道', 'View channels')}<ArrowUpRight size={14}/></button></div>}
          {authorized && <section className="remote-forwarding"><div className="remote-section-heading"><h3>{t('正在回传的会话', 'Forwarding sessions')}</h3><span>{state?.sharing?.length ?? 0}</span></div>
            {(state?.sharing ?? []).map(item => <div className="remote-authorized-row" key={item.sessionId}><Link2 size={16}/>
              <div className="remote-authorized-info"><strong>{item.name}</strong><small>{item.workspace}</small></div>
              <button disabled={busy || !connected} onClick={() => void act({ type: 'detach', sessionId: item.sessionId })}><Unlink size={14}/>{t('退出回传', 'Stop forwarding')}</button></div>)}
            {!state?.sharing?.length && <p className="remote-inline-note">{t('没有会话正在回传，本机任务不受影响。', 'No sessions are forwarding. Local work is unchanged.')}</p>}
          </section>}
        </section>}
        {page === 'runtime' && <section className="remote-runtime"><div className="remote-section-heading"><h2>{t('本机宿主', 'Local host')}</h2><Server size={21}/></div>
          <dl className="remote-properties"><div><dt>{t('运行方式', 'Hosting')}</dt><dd>{t('随 Desktop 运行', 'Hosted by Desktop')}</dd></div><div><dt>{t('飞书', 'Feishu')}</dt><dd>{status}</dd></div>
            <div><dt>{t('浏览器与常驻服务', 'Browser and standalone service')}</dt><dd>{t('尚未接入', 'Not integrated')}</dd></div></dl>
          <p className="remote-runtime-note"><Info size={15}/>{t('退出 Desktop 将断开渠道，并结束由它托管的任务。重新打开后恢复已保存的连接和授权，不重放离线消息、中断任务或旧审批。手动断开连接会删除本机保存的连接。', 'Quitting Desktop disconnects channels and ends hosted tasks. Reopening restores saved connections and access, not offline messages, interrupted tasks or old approvals. Manually disconnecting removes the saved connection.')}</p>
          {state && state.status !== 'idle' && disconnectButton}
        </section>}
        <details className="remote-confirmation" ref={disclosure.details} onKeyDown={event => { if (event.key === 'Escape' && confirmation) { event.preventDefault(); closeConfirmation(); } }}>
          <summary hidden>{t('确认连接操作', 'Confirm connection action')}</summary><div ref={disclosure.body} inert={!confirmation}><div className="remote-confirmation-content">
            <strong>{confirmation === 'disconnect' ? t('断开飞书连接？', 'Disconnect Feishu?') : t('解除此私聊绑定？', 'Unbind this private chat?')}</strong>
            <p>{confirmation === 'disconnect'
              ? t('将删除本机保存的飞书连接和私聊授权，下次需重新配对。已接收的消息队列与已开始的任务保留，飞书平台授权不会撤销。', 'This removes the saved connection and chat access from this computer. Pair again next time. Accepted queues and started tasks remain; platform authorization is not revoked.')
              : t('将删除已保存的私聊与项目授权，保留机器人连接。此私聊不能再操作，直到重新验证并确认。已接收的消息队列与已开始的任务保留。', 'This removes saved chat and project access, keeping the bot connection. The chat cannot act until verified and confirmed again. Accepted queues and started tasks remain.')}</p>
            <div className="remote-form-actions"><button ref={cancel} onClick={closeConfirmation}>{t('取消', 'Cancel')}</button><button className="remote-danger" onClick={() => void (async () => {
              const type = confirmation; if (type && await act({ type })) { setConfirmation(undefined); tabs.current[page === 'connections' ? 1 : 0]?.focus(); }
            })()}><Unlink size={14}/>{t('确认', 'Confirm')}</button></div>
          </div></div>
        </details>
      </div>
      {error && <p className="remote-stage-error" role="alert">{error}</p>}
      {state?.storageError && <p className="remote-stage-error" role="alert">{t('无法保存或解锁飞书连接。当前连接不保证重启恢复；请重试或断开连接后重新配对。', 'The saved connection could not be stored or unlocked. Restart recovery is not guaranteed. Retry, or disconnect and pair again.')}</p>}
      {state?.stage === 'delivery' && <p className="remote-stage-error" role="alert">{t('部分飞书卡片发送失败，请在本机查看会话；任务未自动重试。', 'Some cards could not be delivered. Review the local session; tasks were not retried.')}</p>}
      {state?.stage === 'runtime' && <p className="remote-stage-error" role="alert">{authorized
        ? t('会话运行时已变化，可重新选择远程会话；私聊授权仍保留。', 'A session runtime changed. Select a remote session again; private-chat authorization is retained.')
        : t('已保存的项目范围不再可用，请重新确认私聊与项目授权。', 'The saved project scope is no longer available. Verify the chat and project access again.')}</p>}
    </div></div>
  </section>;
}
