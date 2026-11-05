import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, Copy, Globe2, Info, Link2, LockKeyhole, Monitor, Radio, RefreshCw, Server, ShieldCheck, Smartphone, Square, Unlink } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import type { RemoteAction, RemoteSnapshot } from './remote';
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
  const status = !state ? t('读取中', 'Loading') : ({
    idle: t('未连接', 'Not connected'), pairing: t('等待授权', 'Awaiting authorization'),
    connecting: t('连接中', 'Connecting'), connected: t('已连接', 'Connected'),
    degraded: t('重连中', 'Reconnecting'), error: t('连接异常', 'Connection error'),
  })[state.status];
  const pages = [{ id: 'channels' as const, label: t('接入渠道', 'Channels') },
    { id: 'connections' as const, label: t('已授权连接', 'Authorized connections') },
    { id: 'runtime' as const, label: t('运行状态', 'Host status') }];
  const code = state?.bindingCode && state.bindingCode.expiresAt > now ? state.bindingCode : undefined;
  const selected = state?.sessions.find(session => session.runtimeId === target);
  const resetPage = (value: typeof page) => { setConfirmation(undefined); setChannel(undefined); setPage(value); setError(''); };
  const feishu = (size: number) => <img className="remote-feishu-icon" src={feishuIcon} width={size} height={size} alt="" aria-hidden="true"/>;
  const ask = (value: 'disconnect' | 'unbind', trigger: HTMLButtonElement) => { confirmTrigger.current = trigger; setConfirmation(value); };
  const closeConfirmation = () => { setConfirmation(undefined); confirmTrigger.current?.focus(); };
  const disconnectButton = <button className="remote-text-action" onClick={event => ask('disconnect', event.currentTarget)}><Unlink size={14}/>{t('断开连接', 'Disconnect')}</button>;
  return <section className="remote-access-view remote-live" aria-label={t('远程访问', 'Remote access')}>
    <header><button onClick={onBack}><ArrowLeft size={15}/>{t('返回会话', 'Back to conversation')}</button><span>{t('远程访问', 'Remote access')}</span></header>
    <div className="remote-scroll"><div className="remote-page">
      <header className="remote-header"><div className="remote-page-title"><Smartphone size={23}/><h1>{t('远程访问', 'Remote access')}</h1></div>
        <span className={`remote-status ${connected ? 'is-online' : ''}`}><i/>{status}</span></header>
      <nav className="remote-tabs" role="tablist" aria-label={t('远程访问页面', 'Remote access pages')}>
        {pages.map((item, index) => <button ref={element => { tabs.current[index] = element; }} key={item.id} role="tab" aria-label={item.label}
          id={`${id}-${item.id}`} aria-controls={`${id}-panel`} aria-selected={page === item.id} tabIndex={page === item.id ? 0 : -1}
          onClick={() => resetPage(item.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : undefined;
            if (next !== undefined) { event.preventDefault(); resetPage(pages[next].id); tabs.current[next]?.focus(); }
          }}>{item.label}{item.id === 'connections' && binding && <span>1</span>}</button>)}
      </nav>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${page}`} className="remote-tab-content">
        {page === 'channels' && !channel && <section className="remote-channel-overview">
          <div className="remote-section-heading"><h2>{t('接入渠道', 'Channels')}</h2><span className="remote-section-subtitle">{t('1 个可用 · 1 个规划中', '1 available · 1 planned')}</span></div>
          <div className="remote-channel-options">
            <button className="remote-channel-option" onClick={() => { setChannel('feishu'); setStep(0); }}>{feishu(34)}
              <span className="remote-option-info"><strong>{t('飞书', 'Feishu')}</strong><span>{t('通过飞书私聊连接本机会话', 'Connect a local session through a private chat')}</span>
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
              {[t('连接授权', 'Connection'), t('会话绑定', 'Binding'), t('就绪检查', 'Readiness')].map((label, index) =>
                <button key={label} aria-current={step === index ? 'step' : undefined} disabled={index > 0 && !connected || index === 2 && !binding}
                  onClick={() => { setStep(index); setConfirmation(undefined); }}><span>{index === 0 && connected || index === 1 && binding ? <Check size={12}/> : index + 1}</span>{label}</button>)}
            </nav>
            <section className="remote-setup-stage">
              <div className="remote-setup-heading"><h3 ref={stage} tabIndex={-1}>{step === 0 ? t('连接飞书', 'Connect Feishu') : step === 1 ? t('选择绑定的会话', 'Choose a session') : t('检查远端可用范围', 'Review remote access')}</h3><span>{step + 1} / 3</span></div>
              {step === 0 && <>
                <div className="remote-connection-notice" role="status">{connected ? <Check size={20}/> : connecting ? <Radio size={20}/> : <Link2 size={20}/>}
                  <div><strong>{connected ? state?.botName || status : status}</strong><p>{t('凭据仅在本次连接期间保管；退出后需重新配对。', 'Credentials are kept in memory for this connection. Pair again after quitting.')}</p></div>
                  {!connecting && !connected && <button className="primary" disabled={busy || !state} onClick={() => void (async () => {
                    if (state?.status !== 'idle') { if (!await act({ type: 'disconnect' })) return; }
                    await act({ type: 'connect' });
                  })()}><Link2 size={14}/>{t('连接飞书', 'Connect Feishu')}</button>}
                </div>
                {state?.authorization && <div className="remote-form-actions"><button disabled={busy || state.authorization.expiresAt <= now} onClick={() => void act({ type: 'openAuthorization' })}>
                  <ArrowUpRight size={14}/>{t('打开飞书授权', 'Open Feishu authorization')}</button></div>}
                {(connecting || connected || state?.status === 'degraded') && <div className="remote-form-actions">{disconnectButton}</div>}
                {state?.status === 'error' && <p className="remote-inline-note"><CircleAlert size={13}/>{t(`失败阶段：${state.stage ?? 'transport'}`, `Failed stage: ${state.stage ?? 'transport'}`)}</p>}
                <dl className="remote-properties"><div><dt>{t('授权方式', 'Authorization')}</dt><dd>{t('本机配对授权', 'Local pairing')}</dd></div>
                  <div><dt>{t('凭据保存', 'Credential storage')}</dt><dd>{t('仅内存', 'Memory only')}</dd></div></dl>
              </>}
              {step === 1 && <>
                {binding ? <><div className="remote-binding"><Link2 size={20}/><div><span className="remote-binding-caption">{t('当前绑定', 'Currently bound')}</span><strong>{binding.name}</strong><small>{binding.workspace}</small></div><span className="remote-tag">{t('仅此会话', 'This session only')}</span></div>
                  <div className="remote-form-actions"><button onClick={event => ask('unbind', event.currentTarget)}><Unlink size={14}/>{t('解除绑定', 'Unbind')}</button></div></> : <>
                  <div className="remote-form-actions"><button disabled={busy || !connected} onClick={() => void act({ type: 'armBinding' })}><RefreshCw size={14}/>{code ? t('重新生成验证码', 'New verification code') : t('生成验证码', 'Generate verification code')}</button></div>
                  {code && <><div className="remote-binding-code"><code>{code.code}</code><small>{Math.max(0, Math.ceil((code.expiresAt - now) / 1000))}s</small>
                    <button className="icon-button" aria-label={t('复制验证码', 'Copy verification code')} data-tooltip={t('复制验证码', 'Copy verification code')} onClick={() => void bridge.copyText(code.code).catch(() => setError(t('复制失败', 'Copy failed')))}><Copy size={14}/></button></div>
                    <p className="remote-inline-note"><LockKeyhole size={13}/>{t('在飞书机器人的私聊中发送此验证码。请勿分享验证码。', 'Send this code in a private chat with the bot. Do not share it.')}</p></>}
                  <label><span>{t('目标会话', 'Target session')}</span><ScheduledTaskSelect label={t('目标会话', 'Target session')} value={target}
                    options={[{ id: '', label: t('选择已打开的空闲会话', 'Choose an open idle session') }, ...(state?.sessions ?? []).map(session => ({ id: session.runtimeId, label: session.name }))]}
                    onChange={setTarget}/></label>
                  {selected && <p className="remote-inline-note">{selected.workspace}</p>}
                  {code && state?.candidate && <p className="remote-inline-note" role="status"><Check size={13}/>{t('已收到验证码。确认后，此私聊可接收该会话后续的助手回复、发送消息、停止任务及批准工具操作。不发送已有历史。', 'Code received. Confirm to share future assistant replies, send messages, stop tasks and approve tools for this session. Existing history is not sent.')}</p>}
                  <div className="remote-form-actions"><button className="primary" disabled={busy || !connected || !code || !state?.candidate || !selected} onClick={() => {
                    if (selected && state?.candidate) void act({ type: 'bind', candidateId: state.candidate.id, runtimeId: selected.runtimeId, sessionId: selected.sessionId });
                  }}><ShieldCheck size={14}/>{t('确认并绑定', 'Confirm and bind')}</button></div>
                </>}
              </>}
              {step === 2 && <>
                <ol className="remote-stages">{[{ label: t('配对授权', 'Paired'), done: connected }, { label: t('消息连接', 'Transport'), done: connected },
                  { label: t('私聊绑定', 'Chat bound'), done: !!binding }, { label: t('审批回调', 'Approvals'), done: !!state?.approvalReady }].map(item =>
                  <li key={item.label} data-ready={item.done}><span>{item.done ? <Check size={12}/> : <span/>}</span>{item.label}</li>)}</ol>
                <dl className="remote-properties"><div><dt>{t('绑定会话', 'Bound session')}</dt><dd>{binding?.name || t('未绑定', 'Not bound')}</dd></div>
                  <div><dt>{t('工具审批', 'Tool approvals')}</dt><dd>{state?.approvalReady ? t('回调已验证', 'Callback verified') : t('回调未验证', 'Callback not verified')}</dd></div>
                  <div><dt>{t('登录、表单与权限等级', 'Sign-in, forms and permission tiers')}</dt><dd>{t('仅在本机', 'Local only')}</dd></div>
                </dl>
                <div className="remote-form-actions"><button disabled={busy || !connected} onClick={() => void act({ type: 'openCallbacks' })}><ArrowUpRight size={14}/>{t('配置飞书回调', 'Configure Feishu callbacks')}</button>
                  <button disabled={busy || !connected || !binding} onClick={() => void act({ type: 'checkCallbacks' })}><ShieldCheck size={14}/>{t('发送验证卡片', 'Send verification card')}</button></div>
                <p className="remote-inline-note"><Info size={13}/>{t('验证按钮不批准工具。未验证时仍可在本机审批。', 'Verification does not approve tools. Local approval remains available.')}</p>
                <footer className="remote-channel-footer">{disconnectButton}<button className="remote-text-action" disabled={busy || !connected || !binding} onClick={() => void act({ type: 'stop' })}><Square size={13}/>{t('停止绑定会话的任务', 'Stop the bound session task')}</button></footer>
              </>}
              {!connected && step > 0 && <p className="remote-inline-note"><CircleAlert size={14}/>{t('远端操作已暂停，请先恢复连接。', 'Remote actions are paused. Restore the connection first')}</p>}
            </section>
            <footer className="remote-setup-footer"><button onClick={() => step ? setStep(step - 1) : setChannel(undefined)}><ArrowLeft size={14}/>{step ? t('上一步', 'Back') : t('渠道总览', 'Channels')}</button>
              <button className="primary" disabled={step < 2 && (!connected || step === 1 && !binding)} onClick={() => step === 2 ? setChannel(undefined) : setStep(step + 1)}>{step === 2 ? t('完成', 'Done') : t('继续', 'Continue')}<ArrowRight size={14}/></button></footer>
          </>}</div>
        </div>}
        {page === 'connections' && <section className="remote-connections"><div className="remote-section-heading"><h2>{t('已授权连接', 'Authorized connections')}</h2><ShieldCheck size={19}/></div>
          {binding ? <div className="remote-authorized-row">{feishu(22)}<div className="remote-authorized-info"><strong>{t('飞书私聊', 'Feishu private chat')}</strong><span>{binding.name}</span><small>{binding.workspace}</small></div>
            <span className="remote-status">{status}</span><button onClick={event => ask('unbind', event.currentTarget)}><Unlink size={14}/>{t('解除绑定', 'Unbind')}</button></div>
            : <div className="remote-empty"><ShieldCheck size={30}/><h3>{t('暂无已授权连接', 'No authorized connections')}</h3><button onClick={() => resetPage('channels')}>{t('查看接入渠道', 'View channels')}<ArrowUpRight size={14}/></button></div>}
        </section>}
        {page === 'runtime' && <section className="remote-runtime"><div className="remote-section-heading"><h2>{t('本机宿主', 'Local host')}</h2><Server size={21}/></div>
          <dl className="remote-properties"><div><dt>{t('运行方式', 'Hosting')}</dt><dd>{t('随 Desktop 运行', 'Hosted by Desktop')}</dd></div><div><dt>{t('飞书', 'Feishu')}</dt><dd>{status}</dd></div>
            <div><dt>{t('浏览器与常驻服务', 'Browser and standalone service')}</dt><dd>{t('尚未接入', 'Not integrated')}</dd></div></dl>
          <p className="remote-runtime-note"><Info size={15}/>{t('退出 Desktop 将断开渠道，并结束由它托管的任务。仅断开渠道或解除绑定不会停止已开始的任务。', 'Quitting Desktop disconnects channels and ends hosted tasks. Disconnecting or unbinding alone does not stop tasks.')}</p>
          {state && state.status !== 'idle' && disconnectButton}
        </section>}
        <details className="remote-confirmation" ref={disclosure.details} onKeyDown={event => { if (event.key === 'Escape' && confirmation) { event.preventDefault(); closeConfirmation(); } }}>
          <summary hidden>{t('确认连接操作', 'Confirm connection action')}</summary><div ref={disclosure.body} inert={!confirmation}><div className="remote-confirmation-content">
            <strong>{confirmation === 'disconnect' ? t('断开飞书连接？', 'Disconnect Feishu?') : t('解除此私聊绑定？', 'Unbind this private chat?')}</strong>
            <p>{t('消息和审批收发将暂停，已接收的消息队列与已开始的任务保留。飞书平台授权不会撤销。', 'Messaging and remote approvals will pause. Accepted queued messages and started tasks remain. Platform authorization is not revoked.')}</p>
            <div className="remote-form-actions"><button ref={cancel} onClick={closeConfirmation}>{t('取消', 'Cancel')}</button><button className="remote-danger" onClick={() => void (async () => {
              const type = confirmation; if (type && await act({ type })) { setConfirmation(undefined); tabs.current[page === 'connections' ? 1 : 0]?.focus(); }
            })()}><Unlink size={14}/>{t('确认', 'Confirm')}</button></div>
          </div></div>
        </details>
      </div>
      {error && <p className="remote-stage-error" role="alert">{error}</p>}
      {state?.stage === 'delivery' && <p className="remote-stage-error" role="alert">{t('部分飞书卡片发送失败，请在本机查看会话；任务未自动重试。', 'Some cards could not be delivered. Review the local session; tasks were not retried.')}</p>}
      {state?.stage === 'runtime' && <p className="remote-stage-error" role="alert">{t('会话运行时已变化，请重新确认绑定。', 'The session runtime changed. Confirm a new binding.')}</p>}
    </div></div>
  </section>;
}
