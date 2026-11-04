import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Cloud, ExternalLink, FolderOpen, KeyRound, LoaderCircle, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { AppMenu, type AppMenuItem } from './AppMenu';
import { DisclosureChevron } from './DisclosureChevron';
import { ModelEffortPicker } from './ModelEffortPicker';
import { PermissionPicker } from './PermissionPicker';
import { ProviderSettings } from './ProviderSettings';
import { StepPlatformIcon } from './ProviderBrand';
import type { DesktopBridge, Model, Settings, Snapshot } from './contracts';
import './first-run.css';

type Kind = 'plan' | 'api' | 'custom';
type Region = 'cn' | 'global';

function Menu({ label, value, items, disabled, onChange }: {
  label: string; value: string; items: AppMenuItem[]; disabled?: boolean; onChange: (value: string) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <div className="first-run-menu">
    <button type="button" ref={anchor} disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)}><span>{items.find(item => item.id === value)?.label ?? label}</span><DisclosureChevron/></button>
    <AppMenu anchor={anchor} open={open} label={label} items={items} selected={value} onSelect={onChange} onClose={close}/>
  </div>;
}

export function FirstRun({ bridge, snapshot, onSnapshot }: {
  bridge: DesktopBridge; snapshot: Snapshot; onSnapshot: (value: Snapshot) => unknown;
}) {
  const language = snapshot.preferences.language;
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [settings, setSettings] = useState<Settings>();
  const [stage, setStage] = useState(0);
  const [kind, setKind] = useState<Kind>('plan');
  const [region, setRegion] = useState<Region>('cn');
  const [key, setKey] = useState('');
  const [customId, setCustomId] = useState('');
  const [scope, setScope] = useState<'project' | 'independent'>('project');
  const [workspace, setWorkspace] = useState(snapshot.independent ? '' : snapshot.preferences.workspace ?? '');
  const [pending, setPending] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState('');
  const [intro, setIntro] = useState(false);
  const lock = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const brand = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const animations = useRef<Animation[]>([]);
  const stopIntro = useCallback(() => {
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    setIntro(false);
  }, []);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches || !brand.current || !content.current) return;
    let cancelled = false;
    setIntro(true);
    const timeout = window.setTimeout(() => { cancelled = true; stopIntro(); }, 4000);
    void Promise.all([...brand.current.querySelectorAll('img')].map(image => image.decode().catch(() => {}))).then(() => {
      if (cancelled || !brand.current || !content.current) return;
      const box = brand.current.getBoundingClientRect();
      const dx = innerWidth / 2 - box.x - box.width / 2;
      const dy = innerHeight * .43 - box.y - box.height / 2;
      const ease = 'cubic-bezier(.22, 1, .36, 1)';
      animations.current = [
        brand.current.animate([
          { opacity: 0, transform: `translate(${dx}px, ${dy + 16}px) scale(1.12)`, offset: 0, easing: ease },
          { opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(1.12)`, offset: .22 },
          { opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(1.12)`, offset: .46, easing: ease },
          { opacity: 1, transform: 'none', offset: .84 },
          { opacity: 1, transform: 'none', offset: 1 },
        ], { duration: 2300, fill: 'both' }),
        content.current.animate([
          { opacity: 0, transform: 'translateY(12px)', offset: 0 },
          { opacity: 0, transform: 'translateY(12px)', offset: .73, easing: ease },
          { opacity: 1, transform: 'none', offset: 1 },
        ], { duration: 2300, fill: 'both' }),
      ];
      void Promise.all(animations.current.map(animation => animation.finished)).then(stopIntro).catch(() => {});
    });
    const stop = () => { cancelled = true; stopIntro(); };
    window.addEventListener('resize', stop);
    media.addEventListener('change', stop);
    return () => { stop(); clearTimeout(timeout); window.removeEventListener('resize', stop); media.removeEventListener('change', stop); };
  }, [stopIntro]);
  useEffect(() => {
    let mounted = true;
    void bridge.settings().then(value => {
      if (!mounted) return;
      setSettings(value);
      if (value.account.profile) {
        setKind(value.account.profile.startsWith('step_plan') ? 'plan' : 'api');
        setRegion(value.account.profile.endsWith('oversea') ? 'global' : 'cn');
      } else if (value.providers?.some(provider => provider.enabled && provider.models.length)) setKind('custom');
    }).catch(() => { if (mounted) setError(t('无法读取账户设置，请重试。', 'Could not load account settings. Retry.')); });
    return () => { mounted = false; };
  }, [bridge]);
  useEffect(() => { if (stage) title.current?.focus({ preventScroll: true }); }, [stage]);
  const act = async (action: () => Promise<void>) => {
    if (lock.current || providerBusy) return;
    lock.current = true; setPending(true); setError(''); stopIntro();
    try { await action(); }
    catch {
      // RPC errors can contain a user-supplied endpoint; keep onboarding errors bounded and credential-free.
      setError(t('未能完成这一步，请检查配置或网络后重试。', 'Could not complete this step. Check the configuration or connection and retry.'));
    } finally { lock.current = false; setPending(false); setAuthorizing(false); }
  };
  const refresh = async () => {
    const value = await bridge.snapshot();
    onSnapshot(value);
    return value;
  };
  const profile = kind === 'plan' ? region === 'cn' ? 'step_plan' : 'step_plan_oversea'
    : region === 'cn' ? 'platform_cn' : 'platform_oversea';
  const accountReady = settings?.account.loggedIn && settings.account.profile === profile && settings.account.validity !== 'invalid';
  const providers = settings?.providers?.filter(provider => provider.enabled && provider.models.length && (provider.hasKey || provider.keyless)) ?? [];
  const provider = providers.find(value => value.id === customId) ?? providers[0];
  const model = snapshot.state?.model;
  const labels = [t('账户', 'Account'), t('工作范围', 'Workspace'), t('确认', 'Review')];
  const regionName = region === 'cn' ? t('中国大陆', 'Mainland China') : t('海外', 'International');
  const serviceName = kind === 'custom' ? provider?.name ?? t('其他供应商', 'Other provider') : `${kind === 'plan' ? 'Step Plan' : 'Step API'} · ${regionName}`;
  const billing = kind === 'plan' ? t('套餐额度', 'Plan allowance') : kind === 'api' ? t('API 按量付费', 'Pay-as-you-go API') : t('按供应商规则', 'Provider billing');
  const selectModel = async (value: Model) => {
    await bridge.command('set_model', { provider: value.provider, modelId: value.id });
    await refresh();
  };
  const next = () => void act(async () => {
    if (stage === 0) {
      let value: Snapshot;
      if (kind === 'custom') {
        if (!provider) throw new Error('Provider required');
        value = await refresh();
        const selected = value.models.find(model => model.provider === provider.id);
        if (!selected || value.providerSettingsPending) throw new Error('Provider unavailable');
        await selectModel(selected);
      } else {
        if (!settings) setSettings(await bridge.settings());
        if (!accountReady) {
          setAuthorizing(true);
          await bridge.login(profile, kind === 'api' ? key : undefined);
          setKey('');
        }
        const applied = await bridge.settings();
        setSettings(applied);
        if (!applied.account.loggedIn || applied.account.profile !== profile || applied.account.validity === 'invalid')
          throw new Error('Account not applied');
        value = await refresh();
        const official = value.models.find(model => model.provider === 'step');
        if (!official) throw new Error('Official model unavailable');
        if (value.state?.model?.provider !== 'step') await selectModel(official);
      }
      setStage(1);
    } else if (stage === 1) {
      onSnapshot(await bridge.beginSession(scope === 'project' ? workspace : undefined));
      setStage(2);
    } else onSnapshot(await bridge.finishFirstRun('completed'));
  });
  const permission = <PermissionPicker language={language} preset={snapshot.permissionPreset} supported disabled={pending}
    onSelect={preset => act(async () => { await bridge.command('set_permission_preset', { preset }); await refresh(); })}/>;
  const options: { id: Kind; name: string; detail: string; icon: ReactNode }[] = [
    { id: 'plan', name: 'Step Plan', detail: t('套餐额度', 'Plan allowance'), icon: <StepPlatformIcon size={23}/> },
    { id: 'api', name: t('阶跃 API', 'Step API'), detail: t('按量付费', 'Pay as you go'), icon: <KeyRound size={22}/> },
    { id: 'custom', name: t('其他供应商', 'Other provider'), detail: t('自定义端点', 'Custom endpoint'), icon: <Cloud size={23}/> },
  ];
  return <div className={`first-run-preview first-run-production${intro ? ' is-intro' : ''}`}>
    <main className="first-run-main">
      <header ref={brand} className="first-run-brand"><img className="first-run-mark" src="./StepCode.svg" width="44" height="44" alt=""/>
        <img className="first-run-wordmark wordmark-light" src="./wordmark-light.png" width="1000" height="151" alt="Desktop for Step Code"/>
        <img className="first-run-wordmark wordmark-dark" src="./wordmark-dark.png" width="1000" height="151" alt="Desktop for Step Code"/></header>
      <div ref={content} className="first-run-flow" onPointerDown={stopIntro} onKeyDown={stopIntro}>
        <div className="first-run-language-controls"><Menu label={t('语言', 'Language')} value={language} disabled={pending || providerBusy} items={[
          { id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' },
        ]} onChange={value => void act(async () => { await bridge.preferences({ language: value as 'zh' | 'en' }); await refresh(); })}/></div>
        <nav className="first-run-steps" aria-label={t('初次设置', 'Initial setup')}>{labels.map((label, index) =>
          <button type="button" key={index} disabled={pending || providerBusy || index > stage} aria-current={index === stage ? 'step' : undefined}
            onClick={() => { setStage(index); setError(''); }}><span>{index < stage ? <Check size={13}/> : index + 1}</span>{label}</button>)}</nav>
        <section className="first-run-stage" key={stage} aria-labelledby="first-run-heading">
          <div className="first-run-heading"><h1 ref={title} id="first-run-heading" tabIndex={-1}>
            {stage === 0 ? t('连接模型服务', 'Connect a model service') : stage === 1 ? t('从哪里开始？', 'Where will you work?') : t('开始阶跃。', 'Take the first step.')}</h1>
            <span className="first-run-step-count">{stage + 1} / 3</span></div>
          {stage === 0 && <>
            <fieldset className="first-run-services" disabled={pending || providerBusy}><legend className="first-run-sr">{t('模型服务', 'Model service')}</legend>
              {options.map(option => <label key={option.id} className={`first-run-service${kind === option.id ? ' is-selected' : ''}`}>
                <input type="radio" name="service" checked={kind === option.id} onChange={() => { setKind(option.id); setKey(''); setError(''); }}/>
                <span className="first-run-service-icon">{option.icon}</span><span className="first-run-service-name">{option.name}</span>
                <span className="first-run-service-detail">{option.detail}</span><span className="first-run-radio" aria-hidden="true">{kind === option.id && <Check size={12}/>}</span>
              </label>)}</fieldset>
            {kind !== 'custom' ? <div className="first-run-credentials">
              <div className="first-run-field-row"><span>{t('账户地区', 'Account region')}</span><div className="first-run-segmented" role="group" aria-label={t('账户地区', 'Account region')}>
                {(['cn', 'global'] as const).map(value => <button type="button" key={value} aria-pressed={region === value} disabled={pending}
                  onClick={() => { setRegion(value); setKey(''); setError(''); }}>{value === 'cn' ? t('中国大陆', 'Mainland China') : t('海外', 'International')}</button>)}
              </div></div>
              {kind === 'api' && !accountReady && <label>API Key<input type="password" autoComplete="off" value={key} disabled={pending} onChange={event => setKey(event.target.value)}/></label>}
              <div className="first-run-route"><ShieldCheck size={15}/><span>{kind === 'plan' ? t('Step Plan · 不自动转为 API 计费', 'Step Plan · No automatic API billing fallback')
                : t('官方 API · 与 Plan 套餐分开计费', 'Official API · Billed separately from Plan')}</span></div>
              {accountReady && <p className="first-run-status">{settings?.account.validity === 'valid' ? t('已连接，可继续设置。', 'Connected. Continue setup.')
                : t('凭据已保存，暂无法验证。继续不会发送模型请求。', 'Credentials saved; verification unavailable. Continuing sends no model request.')}</p>}
            </div> : settings ? <fieldset className="first-run-provider" disabled={pending}>
              <legend className="first-run-sr">{t('其他供应商', 'Other provider')}</legend>
              <ProviderSettings language={language} providers={settings.providers ?? []} pending={snapshot.providerSettingsPending}
                activeModel={model} onBusyChange={setProviderBusy} onDiscover={(provider, key) => bridge.discoverProviderModels(provider, key)}
                onTest={(provider, modelId, key) => bridge.testProvider(provider, modelId, key)} onCancelTest={() => bridge.cancelProviderTest()}
                onCopyDiagnostic={value => bridge.copyText(value)}
                onSave={async (provider, key) => {
                  onSnapshot(await bridge.saveProvider(provider, key));
                  const value = await bridge.settings();
                  setSettings(value);
                  setCustomId(value.providers?.find(item => item.id === provider.id)?.id ?? value.providers?.at(-1)?.id ?? '');
                  return value.providers ?? [];
                }}
                onDelete={async id => {
                  onSnapshot(await bridge.deleteProvider(id));
                  const value = await bridge.settings(); setSettings(value);
                  return value.providers ?? [];
                }}/>
              {!!providers.length && <Menu label={t('使用供应商', 'Use provider')} value={provider?.id ?? ''} disabled={pending || providerBusy}
                items={providers.map(provider => ({ id: provider.id, label: provider.name }))} onChange={setCustomId}/>}
            </fieldset> : <p className="first-run-status">{t('正在读取供应商设置…', 'Loading provider settings…')}</p>}
          </>}
          {stage === 1 && <>
            <div className="first-run-connected"><Check size={15}/><span>{serviceName}</span>
              <button type="button" disabled={pending} onClick={() => setStage(0)}>{t('更改', 'Change')}</button></div>
            <fieldset className="first-run-scope" disabled={pending}><legend className="first-run-sr">{t('工作范围', 'Workspace')}</legend>
              {(['project', 'independent'] as const).map(value => <label className={scope === value ? 'is-selected' : ''} key={value}>
                <input type="radio" name="scope" checked={scope === value} onChange={() => setScope(value)}/>
                {value === 'project' ? <FolderOpen size={24}/> : <MessageSquare size={24}/>}
                <span>{value === 'project' ? t('项目会话', 'Project') : t('独立会话', 'Independent')}</span>
                <span className="first-run-radio">{scope === value && <Check size={12}/>}</span></label>)}
            </fieldset>
            {scope === 'project' ? <div className="first-run-directory">
              <label htmlFor="first-run-directory">{t('项目目录', 'Project folder')}</label><div className="first-run-directory-field">
                <input id="first-run-directory" readOnly value={workspace} placeholder={t('选择项目文件夹', 'Choose a project folder')}/>
                <button type="button" className="icon-button" disabled={pending} aria-label={t('浏览文件夹', 'Browse folders')} data-tooltip={t('浏览文件夹', 'Browse folders')}
                  onClick={() => void act(async () => { const value = await bridge.chooseSessionProject(); if (value) { onSnapshot(value); setWorkspace(value.preferences.workspace ?? ''); } })}><FolderOpen size={18}/></button>
              </div>{!!snapshot.preferences.workspaces.length && <Menu label={t('选择已有项目', 'Choose existing project')} value={workspace} disabled={pending}
                items={snapshot.preferences.workspaces.map(path => ({ id: path, label: path, icon: <FolderOpen size={15}/> }))} onChange={setWorkspace}/>}
            </div> : <div className="first-run-independent"><MessageSquare size={18}/>{t('未关联项目目录', 'No project folder attached')}</div>}
            <div className="first-run-permission"><ShieldCheck size={20}/><div><strong>{t('访问权限', 'Access permissions')}</strong>
              <span>{snapshot.permissionPreset === 'full-access' ? t('首次执行前仍需确认完全访问风险', 'Full Access risk acknowledgment is still required before execution')
                : snapshot.permissionPreset === 'approve-for-me' ? t('常规操作自动执行，风险操作仍需确认', 'Routine actions run; risky actions still ask')
                : t('写入与命令执行先确认', 'Confirm writes and commands')}</span></div>{permission}</div>
          </>}
          {stage === 2 && <>
            <dl className="first-run-review">
              <div><dt>{t('模型服务', 'Service')}</dt><dd>{serviceName}</dd></div>
              <div><dt>{t('计费方式', 'Billing')}</dt><dd className="first-run-billing">{billing}</dd></div>
              <div><dt>{t('工作范围', 'Workspace')}</dt><dd>{scope === 'project' ? <><FolderOpen size={15}/><span>{workspace}</span></> : <><MessageSquare size={15}/>{t('独立会话', 'Independent session')}</>}</dd></div>
              <div><dt>{t('模型与思考', 'Model and thinking')}</dt><dd><ModelEffortPicker model={model} models={snapshot.models.filter(value => kind === 'custom' ? value.provider === provider?.id : value.provider === 'step')}
                level={snapshot.state?.thinkingLevel ?? ''} levels={model?.thinkingLevels ?? []} language={language} disabled={pending}
                onModel={value => act(() => selectModel(value))}
                onEffort={level => act(async () => { await bridge.command('set_thinking_level', { level }); await refresh(); })}/></dd></div>
              <div><dt>{t('权限', 'Permissions')}</dt><dd>{permission}</dd></div>
            </dl>
            <div className="first-run-ready"><Check size={17}/><span>{t('开始会话不会自动发送模型请求。', 'Starting a conversation will not send a model request.')}</span></div>
          </>}
          {error && <p className="first-run-error" role="alert">{error}</p>}
        </section>
        <footer className="first-run-footer">
          {stage === 0 ? <button type="button" className="first-run-later" disabled={pending || providerBusy}
            onClick={() => void act(async () => { onSnapshot(await bridge.finishFirstRun('skipped')); })}>{t('稍后设置', 'Set up later')}</button>
            : <button type="button" className="first-run-back" disabled={pending} onClick={() => { setStage(stage - 1); setError(''); }}><ArrowLeft size={16}/>{t('上一步', 'Back')}</button>}
          <div className="first-run-footer-actions">
            {authorizing && kind === 'plan' && <button type="button" className="icon-button" aria-label={t('取消授权', 'Cancel authorization')} data-tooltip={t('取消授权', 'Cancel authorization')}
              onClick={() => { void bridge.cancelLogin().catch(() => {}); }}><X size={17}/></button>}
            <button type="button" className="primary first-run-next" onClick={next}
              disabled={pending || providerBusy || stage === 0 && (kind === 'custom' ? !provider : kind === 'api' && !accountReady && !key.trim()) || stage === 1 && scope === 'project' && !workspace || stage === 2 && !model}>
              {pending ? <><LoaderCircle size={17} className="first-run-spinner"/>{authorizing ? t('等待授权…', 'Waiting for sign-in…') : t('正在应用…', 'Applying…')}</>
                : stage === 0 && kind === 'plan' && !accountReady ? <><ExternalLink size={16}/>{t('浏览器授权', 'Authorize in browser')}</>
                : <>{stage === 2 ? t('开始会话', 'Start a conversation') : t('继续', 'Continue')}<ArrowRight size={16}/></>}
            </button>
          </div>
        </footer>
      </div>
      <div className="first-run-bottom"><span>{t('独立社区项目', 'Independent community project')}</span><span>{t('凭据与个人 CLI 配置分离', 'Separate from your personal CLI profile')}</span></div>
      {intro && <button type="button" className="first-run-skip-motion" onClick={stopIntro}>{t('跳过动画', 'Skip animation')}<ArrowRight size={14}/></button>}
    </main>
  </div>;
}
