import { useEffect, useId, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCheck, CircleAlert, Clock3, Folder, Globe2, Info, Link2, LockKeyhole, Monitor, Radio, RefreshCw, Save, Server, ShieldCheck, Smartphone, Unlink, X } from 'lucide-react';
import { ScheduledTaskSelect } from '../../src/ScheduledTasks';
import { useAnimatedDisclosure } from '../../src/useAnimatedDisclosure';

export type RemoteScenario = 'connected' | 'offline' | 'unconfigured' | 'pairing' | 'error';
export const remoteScenarios = [
  { id: 'connected', label: '已连接', en: 'Connected' },
  { id: 'offline', label: '已断开', en: 'Disconnected' },
  { id: 'unconfigured', label: '未配置', en: 'Not configured' },
  { id: 'pairing', label: '等待授权', en: 'Awaiting authorization' },
  { id: 'error', label: '连接异常', en: 'Connection error' },
];
export const remoteSessions = [
  { id: 'recovery', label: '排查会话恢复链路', en: 'Review session recovery', project: 'Desktop for Step Code' },
  { id: 'release', label: '整理发布说明', en: 'Prepare release notes', project: 'Desktop for Step Code' },
  { id: 'website', label: '检查站点布局', en: 'Review website layout', project: 'Website' },
];
type Page = 'channels' | 'connections' | 'runtime';
type Channel = 'feishu' | 'web';

function FeishuIcon({ size }: { size: number }) {
  return <img className="remote-feishu-icon" src={new URL('../../src/assets/feishu.svg', import.meta.url).href}
    alt="" aria-hidden="true" width={size} height={size}/>;
}

export function RemoteAccessView({ scenario, onScenario, session, onSession, bound, onBound, approvalReady, onApprovalReady, onBack, language = 'zh' }: {
  scenario: RemoteScenario; onScenario: (value: RemoteScenario) => void;
  session: string; onSession: (value: string) => void;
  bound: boolean; onBound: (value: boolean) => void;
  approvalReady: boolean; onApprovalReady: (value: boolean) => void;
  onBack: () => void; language?: 'zh' | 'en';
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [page, setPage] = useState<Page>('channels');
  const [channel, setChannel] = useState<Channel>();
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draftSession, setDraftSession] = useState(session);
  const [confirm, setConfirm] = useState<'disconnect' | 'unbind'>();
  const [alias, setAlias] = useState('Step Code');
  const [savedAlias, setSavedAlias] = useState('Step Code');
  const [notice, setNotice] = useState('');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const confirmCancel = useRef<HTMLButtonElement>(null);
  const disconnect = useRef<HTMLButtonElement>(null);
  const bindButton = useRef<HTMLButtonElement>(null);
  const channelButton = useRef<HTMLButtonElement>(null);
  const webButton = useRef<HTMLButtonElement>(null);
  const stageTitle = useRef<HTMLHeadingElement>(null);
  const bindingDisclosure = useAnimatedDisclosure(editing);
  const confirmDisclosure = useAnimatedDisclosure(Boolean(confirm));
  const id = useId();
  const connected = scenario === 'connected';
  const configured = scenario !== 'unconfigured';
  const paired = configured && scenario !== 'pairing';
  const current = remoteSessions.find(item => item.id === session) ?? remoteSessions[0];
  const pages: { id: Page; label: string }[] = [
    { id: 'channels', label: t('接入渠道', 'Channels') },
    { id: 'connections', label: t('已授权连接', 'Authorized connections') },
    { id: 'runtime', label: t('运行状态', 'Host status') },
  ];
  const status = remoteScenarios.find(item => item.id === scenario)!;
  const channelStatus = t(status.label, status.en);
  const clearTransient = () => { setEditing(false); setConfirm(undefined); setNotice(''); };
  const navigate = (value: Page) => { clearTransient(); setChannel(undefined); setPage(value); };
  const setSelectedChannel = (value: Channel) => { clearTransient(); setStep(0); setChannel(value); };
  const setStage = (value: number) => { clearTransient(); setStep(value); };
  const showChannels = () => {
    clearTransient(); setChannel(undefined);
    requestAnimationFrame(() => (channel === 'web' ? webButton : channelButton).current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    if (channel) stageTitle.current?.focus({ preventScroll: true });
  }, [channel, step]);
  const closeConfirm = () => {
    const action = confirm;
    setConfirm(undefined);
    if (action === 'disconnect') disconnect.current?.focus();
    else bindButton.current?.focus();
  };
  const ask = (action: 'disconnect' | 'unbind') => {
    setConfirm(action);
    requestAnimationFrame(() => confirmCancel.current?.focus({ preventScroll: true }));
  };
  const connect = () => {
    clearTransient(); onBound(false); onApprovalReady(false); onScenario('pairing');
  };
  const finishConfirmation = () => {
    if (confirm === 'disconnect') {
      onScenario('offline');
      setNotice(t('飞书已断开，已开始的任务继续运行。', 'Feishu disconnected. Tasks already started keep running.'));
    } else {
      onBound(false); onApprovalReady(false);
      setNotice(t('已解除私聊与会话的绑定。', 'The private chat is no longer bound to a session.'));
    }
    setConfirm(undefined);
    requestAnimationFrame(() => {
      if (page === 'connections') tabs.current[1]?.focus({ preventScroll: true });
      else stageTitle.current?.focus({ preventScroll: true });
    });
  };
  return <section className="usage-overview-preview remote-access-view" aria-label={t('远程访问', 'Remote access')}>
    <header>
      <button onClick={onBack}><ArrowLeft size={15}/>{t('返回会话', 'Back to conversation')}</button>
      <span>{t('远程访问', 'Remote access')}</span>
    </header>
    <div className="usage-overview-scroll remote-scroll">
      <div className="remote-page">
        <header className="remote-header">
          <div className="remote-page-title"><Smartphone size={23}/><h1>{t('远程访问', 'Remote access')}</h1></div>
          <span className={`remote-status ${connected ? 'is-online' : ''}`}><i/>{connected
            ? t('1 个渠道在线', '1 channel online') : t('没有在线渠道', 'No channels online')}</span>
        </header>
        <nav className="remote-tabs" role="tablist" aria-label={t('远程访问页面', 'Remote access pages')}>
          {pages.map((item, index) => <button key={item.id} ref={element => { tabs.current[index] = element; }} role="tab"
            id={`${id}-tab-${item.id}`} aria-selected={page === item.id} aria-controls={`${id}-panel`}
            tabIndex={page === item.id ? 0 : -1} onClick={() => navigate(item.id)}
            onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % pages.length
                : event.key === 'ArrowLeft' ? (index + pages.length - 1) % pages.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : undefined;
              if (next === undefined) return;
              event.preventDefault(); navigate(pages[next].id); tabs.current[next]?.focus();
            }}>{item.label}{item.id === 'connections' && paired && bound && <span>1</span>}</button>)}
        </nav>
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${page}`} className="remote-tab-content">
          {page === 'channels' && !channel && <section className="remote-channel-overview" aria-label={t('渠道总览', 'Channel overview')}>
            <div className="remote-section-heading"><h2>{t('接入渠道', 'Channels')}</h2><span className="remote-section-subtitle">{t('1 个可用 · 1 个规划中', '1 available · 1 planned')}</span></div>
            <div className="remote-channel-options">
              <button ref={channelButton} className="remote-channel-option" aria-label={t('配置飞书', 'Configure Feishu')} onClick={() => setSelectedChannel('feishu')}>
                <FeishuIcon size={34}/><span className="remote-option-info"><strong>{t('飞书', 'Feishu')}</strong>
                  <span>{t('通过飞书私聊连接本机会话', 'Connect a local session through a Feishu private chat')}</span>
                  <span className={`remote-status ${connected ? 'is-online' : ''}`}><i/>{channelStatus}</span>
                </span><span className="remote-option-action">{configured ? t('管理配置', 'Manage') : t('开始配置', 'Set up')}<ArrowRight size={15}/></span>
              </button>
              <button ref={webButton} className="remote-channel-option is-planned" aria-label={t('查看浏览器访问', 'View browser access')} onClick={() => setSelectedChannel('web')}>
                <Globe2 size={32} strokeWidth={1.5}/><span className="remote-option-info"><strong>{t('浏览器访问', 'Browser access')}</strong>
                  <span>{t('手机或电脑通过 URL 访问', 'Access from a phone or computer via URL')}</span>
                  <span className="remote-planned">{t('规划中', 'Planned')}</span>
                </span><ArrowRight size={15}/>
              </button>
            </div>
          </section>}
          {page === 'channels' && channel && <div className="remote-channel-flow">
            <button className="remote-text-action remote-channel-back" onClick={showChannels}><ArrowLeft size={14}/>{t('返回接入渠道', 'Back to channels')}</button>
            <div className="remote-channel-detail" key={channel}>
              <div className="remote-detail-heading">
                <div className="remote-channel-name">{channel === 'feishu' ? <FeishuIcon size={23}/> : <Globe2 size={23}/>}
                  <div><h2 ref={channel === 'web' ? stageTitle : undefined} tabIndex={channel === 'web' ? -1 : undefined}>{channel === 'feishu' ? t('飞书', 'Feishu') : t('浏览器访问', 'Browser access')}</h2>
                    <p>{channel === 'feishu' ? t('即时通讯渠道', 'Messaging channel') : t('手机与电脑', 'Phone and computer')}</p></div>
                </div>
                <span className={`remote-status ${channel === 'feishu' && connected ? 'is-online' : ''}`}>
                  <i/>{channel === 'feishu' ? channelStatus : t('规划中', 'Planned')}</span>
              </div>
              {channel === 'feishu' ? <>
                <nav className="remote-setup-steps" aria-label={t('飞书配置步骤', 'Feishu setup steps')}>
                  {[t('连接授权', 'Connection'), t('会话绑定', 'Binding'), t('就绪检查', 'Readiness')].map((label, index) =>
                    <button key={index} aria-label={label} aria-current={step === index ? 'step' : undefined}
                      disabled={index > 0 && !connected || index === 2 && !bound} onClick={() => setStage(index)}>
                      <span>{index === 0 && connected || index === 1 && connected && bound ? <Check size={12}/> : index + 1}</span>{label}
                    </button>)}
                </nav>
                <section className="remote-setup-stage" key={step} aria-labelledby={`${id}-stage-title`}>
                  <div className="remote-setup-heading"><h3 ref={stageTitle} tabIndex={-1} id={`${id}-stage-title`}>
                    {step === 0 ? t('连接飞书', 'Connect Feishu') : step === 1 ? t('选择绑定的会话', 'Choose a session') : t('检查远端可用范围', 'Review remote access')}</h3>
                    <span>{step + 1} / 3</span></div>
                {step === 2 && connected && <ol className="remote-stages" aria-label={t('渠道就绪状态', 'Channel readiness')}>
                  {[
                    { label: t('配对授权', 'Paired'), done: true },
                    { label: t('消息连接', 'Transport'), done: true },
                    { label: t('私聊绑定', 'Chat bound'), done: bound },
                    { label: t('审批回调', 'Approvals'), done: bound && approvalReady },
                  ].map(item => <li key={item.label} data-ready={item.done}>
                    <span>{item.done ? <Check size={12}/> : <span/>}</span>{item.label}
                  </li>)}
                </ol>}
                {step === 0 && <>{scenario === 'pairing' ? <div className="remote-connection-notice" role="status">
                  <Radio size={20}/><div><strong>{t('等待飞书授权', 'Waiting for Feishu authorization')}</strong>
                    <p>{t('尚未建立消息连接，也未绑定私聊。', 'No message connection or private chat is bound yet.')}</p></div>
                  <button onClick={() => { onScenario('unconfigured'); onBound(false); }}>{t('取消配对', 'Cancel pairing')}</button>
                </div> : !connected && <div className={`remote-connection-notice${scenario === 'error' ? ' is-error' : ''}`} role={scenario === 'error' ? 'alert' : 'status'}>
                  {scenario === 'error' ? <CircleAlert size={20}/> : <Link2 size={20}/>}
                  <div><strong>{scenario === 'error' ? t('消息连接中断', 'Message connection interrupted') : scenario === 'unconfigured'
                    ? t('尚未连接飞书', 'Feishu is not configured') : t('飞书已断开', 'Feishu is disconnected')}</strong>
                    <p>{scenario === 'error' ? t('消息收发暂停，连接恢复前不接收远端操作。', 'Messaging is paused. Remote actions are unavailable until reconnection.')
                      : t('本机会话不受影响。', 'Local conversations are unaffected.')}</p></div>
                  <button className="primary" ref={disconnect} onClick={scenario === 'error' || scenario === 'offline'
                    ? () => { onScenario('connected'); setNotice(t('示例连接已恢复。', 'Sample connection restored.')); } : connect}>
                    {scenario === 'unconfigured' ? <Link2 size={14}/> : <RefreshCw size={14}/>}
                    {scenario === 'unconfigured' ? t('连接飞书', 'Connect Feishu') : t('重新连接', 'Reconnect')}</button>
                </div>}
                  {connected && <div className="remote-connected"><CheckCheck size={16}/><span>{t('飞书消息连接已建立', 'Feishu messaging is connected')}</span></div>}
                  <form className="remote-connection-form" onSubmit={event => { event.preventDefault(); setSavedAlias(alias.trim() || 'Step Code'); setNotice(t('连接名称已保存。', 'Connection name saved.')); }}>
                    <label><span>{t('连接名称', 'Connection name')}</span><input value={alias} maxLength={60} required
                      onChange={event => setAlias(event.target.value)} autoComplete="off"/></label>
                    <dl className="remote-properties">
                      <div><dt>{t('授权方式', 'Authorization')}</dt><dd>{t('本机配对授权', 'Local pairing')}</dd></div>
                      <div><dt>{t('已保存名称', 'Saved name')}</dt><dd>{savedAlias}</dd></div>
                    </dl>
                    <div className="remote-form-actions">
                      {configured && <button type="button" disabled={scenario === 'pairing'} onClick={connect}><Link2 size={14}/>{t('重新配对', 'Pair again')}</button>}
                      <button type="submit"><Save size={14}/>{t('保存名称', 'Save name')}</button>
                    </div>
                  </form>
                  <p className="remote-inline-note"><LockKeyhole size={13}/>{t('凭据由本机保管，不与个人 CLI 配置混用。', 'Credentials stay on this computer, separate from your personal CLI profile.')}</p>
                </>}
                {step === 1 && <section className="remote-section remote-binding-step">
                  <div className="remote-section-heading"><h3>{t('会话绑定', 'Session binding')}</h3>
                    <button ref={bindButton} disabled={!connected} className="remote-text-action" aria-expanded={editing}
                      aria-controls={`${id}-binding`} onClick={() => {
                        setDraftSession(session); setEditing(value => !value);
                      }}>{bound ? t('更换绑定', 'Change binding') : t('绑定会话', 'Bind a session')}<ArrowUpRight size={13}/></button></div>
                  {paired && bound ? <div className="remote-binding">
                    <span className="remote-binding-symbol"><Link2 size={17}/></span>
                    <div><span className="remote-binding-caption">{connected ? t('当前绑定', 'Currently bound') : t('上次绑定', 'Last binding')}</span>
                      <strong>{t(current.label, current.en)}</strong><small><Folder size={12}/>{current.project}</small></div>
                    <span className="remote-tag">{t('仅此会话', 'This session only')}</span>
                  </div> : <p className="remote-empty-binding">{t('尚未绑定会话', 'No session is bound')}</p>}
                  <details className="remote-binding-editor" ref={bindingDisclosure.details}>
                    <summary hidden>{t('更换会话绑定', 'Change session binding')}</summary>
                    <div ref={bindingDisclosure.body} inert={!editing} id={`${id}-binding`}>
                      <div className="remote-inline-form">
                        <label><span>{t('目标会话', 'Target session')}</span>
                          <ScheduledTaskSelect label={t('目标会话', 'Target session')} value={draftSession}
                            options={remoteSessions.map(item => ({ id: item.id, label: t(item.label, item.en) }))}
                            onChange={setDraftSession}/></label>
                        <div className="remote-form-actions">
                          <button onClick={() => { setEditing(false); bindButton.current?.focus(); }}>{t('取消', 'Cancel')}</button>
                          <button className="primary" onClick={() => {
                            onSession(draftSession); onBound(true); setEditing(false); bindButton.current?.focus();
                            setNotice(t('会话绑定已更新。', 'Session binding updated.'));
                          }}><Check size={14}/>{t('保存绑定', 'Save binding')}</button>
                        </div>
                      </div>
                    </div>
                  </details>
                  <dl className="remote-properties">
                    <div><dt>{t('远端会话', 'Remote chat')}</dt><dd>{paired && bound ? t('个人私聊', 'Private chat') : '—'}</dd></div>
                    <div><dt>{t('接收范围', 'Input scope')}</dt><dd>{t('仅绑定的私聊', 'Bound private chat only')}</dd></div>
                  </dl>
                </section>}
                {step === 2 && <><section className="remote-section">
                  <div className="remote-section-heading"><h3>{t('远端权限', 'Remote permissions')}</h3><ShieldCheck size={15}/></div>
                  <dl className="remote-properties">
                    <div><dt>{t('消息与回复', 'Messages and replies')}</dt><dd>{connected && bound
                      ? <span className="remote-positive"><CheckCheck size={14}/>{t('可用', 'Available')}</span> : t('未就绪', 'Not ready')}</dd></div>
                    <div><dt>{t('工具审批', 'Tool approvals')}</dt><dd>{connected && bound && approvalReady
                      ? <span className="remote-positive"><Check size={14}/>{t('回调已验证', 'Callback verified')}</span>
                      : <span className="remote-pending"><CircleAlert size={13}/>{t('回调未验证', 'Callback not verified')}</span>}</dd></div>
                    <div><dt>{t('账户登录与交互表单', 'Sign-in and interactive forms')}</dt><dd><Monitor size={13}/>{t('仅在本机', 'Local only')}</dd></div>
                  </dl>
                  {connected && !approvalReady && <p className="remote-inline-note"><Info size={13}/>{t('工具审批仍需在本机处理。', 'Tool approvals still require this computer.')}</p>}
                </section>
                {connected && <footer className="remote-channel-footer"><span><LockKeyhole size={13}/>{t('凭据由本机保管', 'Credentials stay on this computer')}</span>
                  <button ref={disconnect} className="remote-text-action" onClick={() => ask('disconnect')}><Unlink size={14}/>{t('断开连接', 'Disconnect')}</button></footer>}
                {!connected && <p className="remote-inline-note"><CircleAlert size={13}/>{t('连接已断开，可返回连接授权重新连接。', 'Disconnected. Return to Connection to reconnect.')}</p>}</>}
                </section>
                <footer className="remote-setup-footer">
                  <button onClick={() => step === 0 ? showChannels() : setStage(step - 1)}><ArrowLeft size={14}/>{step === 0 ? t('渠道总览', 'Channels') : t('上一步', 'Back')}</button>
                  <button className="primary" disabled={step === 0 ? !connected : step === 1 ? !bound || !connected : false}
                    onClick={() => step === 2 ? showChannels() : setStage(step + 1)}>
                    {step === 2 ? t('完成', 'Done') : t('继续', 'Continue')}{step === 2 ? <Check size={14}/> : <ArrowRight size={14}/>}
                  </button>
                </footer>
              </> : <>
                <div className="remote-web-placeholder"><Smartphone size={33} strokeWidth={1.5}/><Monitor size={44} strokeWidth={1.5}/>
                  <div><strong>{t('浏览器服务尚未接入', 'Browser service is not connected')}</strong><span>{t('访问地址未生成', 'No access URL has been created')}</span></div></div>
                <dl className="remote-properties remote-web-properties">
                  <div><dt>{t('渠道', 'Channel')}</dt><dd>Web</dd></div>
                  <div><dt>{t('连接方式', 'Connection method')}</dt><dd>URL</dd></div>
                  <div><dt>{t('使用设备', 'Devices')}</dt><dd>{t('手机、电脑', 'Phone, computer')}</dd></div>
                  <div><dt>{t('设备授权', 'Device authorization')}</dt><dd>{t('待接入', 'Not integrated')}</dd></div>
                  <div><dt>{t('扫码与公网访问', 'QR pairing and public access')}</dt><dd>{t('待确认', 'To be scoped')}</dd></div>
                </dl>
              </>}
            </div>
          </div>}
          {page === 'connections' && <section className="remote-connections">
            <div className="remote-section-heading"><div><h2>{t('已授权连接', 'Authorized connections')}</h2>
              <p className="remote-section-subtitle">{t('渠道绑定与访问范围', 'Channel bindings and access scope')}</p></div><ShieldCheck size={19}/></div>
            {paired && bound ? <div className="remote-authorized-row">
              <FeishuIcon size={22}/><div className="remote-authorized-info"><strong>{t('个人私聊', 'Private chat')}<span className="remote-tag">{t('飞书', 'Feishu')}</span></strong>
                <span>{t(current.label, current.en)}</span><small>{current.project}</small></div>
              <span className={`remote-status ${connected ? 'is-online' : ''}`}><i/>{connected ? t('已连接', 'Connected') : t('已离线', 'Offline')}</span>
              <button ref={bindButton} onClick={() => ask('unbind')}><Unlink size={14}/>{t('解除绑定', 'Unbind')}</button>
            </div> : <div className="remote-empty"><ShieldCheck size={30} strokeWidth={1.4}/><h3>{t('暂无已授权连接', 'No authorized connections')}</h3>
              <button onClick={() => navigate('channels')}>{t('查看接入渠道', 'View channels')}<ArrowUpRight size={14}/></button></div>}
            <p className="remote-inline-note"><Info size={14}/>{t('私聊绑定是消息接收范围，不代表已验证对方设备或个人身份。', 'A chat binding defines message scope, not verified device or personal identity.')}</p>
          </section>}
          {page === 'runtime' && <section className="remote-runtime">
            <div className="remote-section-heading"><div><h2>{t('本机宿主', 'Local host')}</h2><p className="remote-section-subtitle">Desktop for Step Code</p></div><Server size={21}/></div>
            <dl className="remote-properties">
              <div><dt>{t('运行方式', 'Hosting')}</dt><dd><Monitor size={14}/>{t('随 Desktop 运行', 'Hosted by Desktop')}</dd></div>
              <div><dt>{t('在线渠道', 'Online channels')}</dt><dd>{connected ? t('飞书', 'Feishu') : t('无', 'None')}</dd></div>
              <div><dt>{t('浏览器服务', 'Browser service')}</dt><dd>{t('尚未接入', 'Not integrated')}</dd></div>
              <div><dt>{t('独立常驻服务', 'Standalone service')}</dt><dd>{t('尚未接入', 'Not integrated')}</dd></div>
            </dl>
            <p className="remote-runtime-note"><Info size={15}/>{t('退出 Desktop 将断开渠道，并结束由它托管的任务。关闭远端页面不等于停止任务。', 'Quitting Desktop disconnects channels and ends hosted tasks. Closing a remote page does not stop a task.')}</p>
            <section className="remote-section"><div className="remote-section-heading"><h3>{t('连接记录', 'Connection events')}</h3><Activity size={15}/></div>
              <ol className="remote-events">
                <li><span><Clock3 size={13}/>{t('刚刚', 'Just now')}</span><div><strong>{channelStatus}</strong><small>{t('飞书消息连接', 'Feishu message connection')}</small></div></li>
                {paired && bound && <li><span><Link2 size={13}/>{t('本次连接', 'This connection')}</span><div><strong>{t('已保留会话绑定', 'Session binding retained')}</strong><small>{t(current.label, current.en)}</small></div></li>}
                <li><span><LockKeyhole size={13}/>{t('本机', 'Local')}</span><div><strong>{t('独立常驻服务未接入', 'Standalone service not integrated')}</strong><small>{t('未开放浏览器访问地址', 'No browser access URL is exposed')}</small></div></li>
              </ol>
            </section>
          </section>}
          <details className="remote-confirmation" ref={confirmDisclosure.details} onKeyDown={event => {
            if (event.key === 'Escape' && confirm) { event.preventDefault(); closeConfirm(); }
          }}>
            <summary hidden>{t('确认连接操作', 'Confirm connection action')}</summary>
            <div ref={confirmDisclosure.body} inert={!confirm}>
              <div className="remote-confirmation-content" role={confirm ? 'group' : undefined} aria-label={t('确认连接操作', 'Confirm connection action')}>
                <div><strong>{confirm === 'disconnect' ? t('断开飞书连接？', 'Disconnect Feishu?') : t('解除此私聊绑定？', 'Unbind this private chat?')}</strong>
                  <p>{confirm === 'disconnect'
                    ? t('消息收发将暂停。已开始的任务继续运行，飞书平台授权不会撤销。', 'Messaging will pause. Started tasks keep running. Feishu platform authorization is not revoked.')
                    : t('此私聊将不能继续向绑定会话发送消息或审批。已开始的任务不受影响。', 'This chat will lose messaging and approval access to the bound session. Started tasks are unaffected.')}</p></div>
                <div className="remote-form-actions"><button ref={confirmCancel} onClick={closeConfirm}>{t('取消', 'Cancel')}</button>
                  <button className="remote-danger" onClick={finishConfirmation}><Unlink size={14}/>{confirm === 'disconnect' ? t('确认断开', 'Disconnect') : t('确认解绑', 'Unbind')}</button></div>
              </div>
            </div>
          </details>
        </div>
        <div className="remote-feedback" role="status" aria-live="polite">{notice && <><Check size={14}/><span>{notice}</span><button className="icon-button"
          aria-label={t('关闭提示', 'Dismiss notice')} onClick={() => setNotice('')}><X size={13}/></button></>}</div>
      </div>
    </div>
  </section>;
}
