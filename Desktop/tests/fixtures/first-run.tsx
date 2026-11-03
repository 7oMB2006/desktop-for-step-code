import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, ArrowUp, Check, CircleHelp, Cloud, ExternalLink, FolderOpen, KeyRound, LoaderCircle, MessageSquare, Play, RotateCcw, ShieldCheck, SunMoon, X } from 'lucide-react';
import { AppMenu, type AppMenuItem } from '../../src/AppMenu';
import { AppTooltip } from '../../src/AppTooltip';
import { DisclosureChevron } from '../../src/DisclosureChevron';
import { ModelEffortPicker } from '../../src/ModelEffortPicker';
import { PermissionPicker } from '../../src/PermissionPicker';
import { NewSession } from '../../src/NewSession';
import { StepPlatformIcon } from '../../src/ProviderBrand';
import { applyTheme } from '../../src/theme';
import type { Model, PermissionPreset } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/model-picker-list.css';
import './first-run.css';

type Kind = 'plan' | 'api' | 'custom';
type Region = 'cn' | 'global';
type Scenario = 'success' | 'no-plan' | 'network';
type Account = { kind: Kind; region: Region; name: string };
const params = new URLSearchParams(location.search);
const logoUrl = new URL('../../public/StepCode.svg', import.meta.url).href;
const wordmarkLight = new URL('../../public/wordmark-light.png', import.meta.url).href;
const wordmarkDark = new URL('../../public/wordmark-dark.png', import.meta.url).href;
const paths = ['D:\\Projects\\hello-step', 'D:\\Projects\\my-website', 'D:\\Projects\\research-notes'];
const stepModel: Model = { id: 'step-5-preview', name: 'step-5-preview', provider: 'step' };
const customModel: Model = { id: 'example-model', name: 'example-model', provider: 'desktop-custom-example', providerName: 'Custom provider' };
const noop = () => {};

function Menu({ label, value, items, onChange, disabled = false }: {
  label: string; value: string; items: AppMenuItem[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <div className="first-run-menu">
    <button ref={anchor} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
      onClick={() => setOpen(!open)}><span>{items.find(item => item.id === value)?.label ?? label}</span><DisclosureChevron/></button>
    <AppMenu anchor={anchor} open={open} label={label} items={items} selected={value} onSelect={onChange} onClose={close}/>
  </div>;
}

function Preview() {
  const [language, setLanguage] = useState<'zh' | 'en'>(params.get('lang') === 'en' ? 'en' : 'zh');
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [motion, setMotion] = useState(params.get('motion') !== 'off');
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [replay, setReplay] = useState(0);
  const [intro, setIntro] = useState(false);
  const [stage, setStage] = useState(0);
  const [kind, setKind] = useState<Kind>('plan');
  const [region, setRegion] = useState<Region>('cn');
  const [scenario, setScenario] = useState<Scenario>('success');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.example.com/v1');
  const [format, setFormat] = useState('openai-completions');
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState<Scenario | undefined>();
  const [account, setAccount] = useState<Account>();
  const [scope, setScope] = useState<'project' | 'independent'>('project');
  const [path, setPath] = useState('');
  const [pickedDirectory, setPickedDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState(false);
  const [permission, setPermission] = useState<PermissionPreset>('ask');
  const [model, setModel] = useState<Model>(stepModel);
  const [effort, setEffort] = useState('medium');
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mark = useRef<HTMLImageElement>(null);
  const brand = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const animations = useRef<Animation[]>([]);
  const introRun = useRef(0);
  const initialStage = useRef(true);
  const stopIntro = useCallback(() => {
    introRun.current += 1;
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    setIntro(false);
  }, []);
  const cancel = useCallback(() => { clearTimeout(timer.current); setPending(false); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { applyTheme(dark ? 'original-dark' : 'original-light', dark); }, [dark]);
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; }, [language]);
  useLayoutEffect(() => {
    stopIntro();
    if (!motion || reduced || stage === 3 || !brand.current || !mark.current || !content.current) return;
    const run = introRun.current;
    setIntro(true);
    void Promise.all([...brand.current.querySelectorAll('img')].map(image => image.decode().catch(() => {}))).then(() => {
      if (introRun.current !== run || !brand.current || !content.current) return;
      const box = brand.current.getBoundingClientRect();
      const dx = innerWidth / 2 - box.x - box.width / 2;
      const dy = innerHeight * .43 - box.y - box.height / 2;
      const ease = 'cubic-bezier(.22, 1, .36, 1)';
      const logo = brand.current.animate([
        { opacity: 0, transform: `translate(${dx}px, ${dy + 16}px) scale(1.12)`, offset: 0, easing: ease },
        { opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(1.12)`, offset: .22 },
        { opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(1.12)`, offset: .46, easing: ease },
        { opacity: 1, transform: 'translate(0, 0) scale(1)', offset: .84 },
        { opacity: 1, transform: 'translate(0, 0) scale(1)', offset: 1 },
      ], { duration: 2300, fill: 'both' });
      const form = content.current.animate([
        { opacity: 0, transform: 'translateY(12px)', offset: 0 },
        { opacity: 0, transform: 'translateY(12px)', offset: .73, easing: ease },
        { opacity: 1, transform: 'translateY(0)', offset: 1 },
      ], { duration: 2300, fill: 'both' });
      animations.current = [logo, form];
      void Promise.all([logo.finished, form.finished]).then(() => {
        if (introRun.current === run) stopIntro();
      }).catch(() => {});
    });
    const resize = () => stopIntro();
    window.addEventListener('resize', resize);
    return () => { stopIntro(); window.removeEventListener('resize', resize); };
    // Replaying is explicit; navigating the flow must not replay the introduction.
  }, [replay, motion, reduced, stopIntro]);
  useLayoutEffect(() => {
    if (stage !== 3 || !motion || reduced || !workspace.current) return;
    const entrance = workspace.current.animate([
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 460, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    return () => entrance.cancel();
  }, [stage, motion, reduced]);
  useEffect(() => {
    if (initialStage.current) { initialStage.current = false; return; }
    title.current?.focus({ preventScroll: true });
  }, [stage]);
  const editAccount = (next: Kind) => {
    cancel(); setKind(next); setIssue(undefined); setKey('');
  };
  const enterStage = (next: number) => { stopIntro(); setStage(next); };
  const editPath = (value: string) => { setPath(value); setPickedDirectory(false); setDirectoryError(false); };
  const browseDirectory = async () => {
    const picker = (window as Window & { showDirectoryPicker?: (options: { mode: 'read' }) => Promise<{ name: string }> }).showDirectoryPicker;
    if (!picker) { setDirectoryError(true); return; }
    try {
      const directory = await picker.call(window, { mode: 'read' });
      setPath(directory.name);
      setPickedDirectory(true);
      setDirectoryError(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setDirectoryError(true);
    }
  };
  const authorize = () => {
    stopIntro(); setIssue(undefined); setPending(true);
    timer.current = setTimeout(() => {
      setPending(false);
      if (scenario === 'network' || scenario === 'no-plan' && kind === 'plan') { setIssue(scenario); return; }
      setAccount({ kind, region, name: kind === 'plan' ? 'Step Plan' : kind === 'api' ? 'Step API' : 'Custom provider' });
      setModel(kind === 'custom' ? customModel : stepModel);
      setKey('');
      setStage(1);
    }, 1000);
  };
  const reset = () => {
    cancel(); stopIntro(); setStage(0); setKind('plan'); setRegion('cn'); setIssue(undefined); setAccount(undefined);
    setKey(''); setScope('project'); editPath(''); setPermission('ask'); setDraft(''); setSent(false); setModel(stepModel); setReplay(value => value + 1);
  };
  const selectPermission = async (value: PermissionPreset) => {
    if (value === 'full-access' && !window.confirm(t('完全访问会跳过危险命令的审批。确认选择？本预览不会修改真实权限。', 'Full Access skips approval even for dangerous commands. Continue? This preview does not change real permissions.'))) return;
    setPermission(value);
  };
  const permissionPicker = <PermissionPicker preset={permission} language={language} disabled={false} supported onSelect={selectPermission}/>;
  const regionName = (value: Region) => value === 'cn' ? t('中国大陆', 'Mainland China') : t('海外', 'International');
  const billing = (value?: Kind) => value === 'plan' ? t('套餐额度', 'Plan allowance')
    : value === 'api' ? t('API 按量付费', 'Pay-as-you-go API') : value === 'custom' ? t('按供应商规则', 'Provider billing') : t('未配置', 'Not configured');
  const options: { id: Kind; label: string; detail: string; icon: ReactNode }[] = [
    { id: 'plan', label: 'Step Plan', detail: t('套餐额度', 'Plan allowance'), icon: <StepPlatformIcon size={23}/> },
    { id: 'api', label: t('阶跃 API', 'Step API'), detail: t('按量付费', 'Pay as you go'), icon: <KeyRound size={22}/> },
    { id: 'custom', label: t('其他供应商', 'Other provider'), detail: t('自定义端点', 'Custom endpoint'), icon: <Cloud size={23}/> },
  ];
  const labels = [t('账户', 'Account'), t('工作范围', 'Workspace'), t('确认', 'Review')];
  const readyToAuthorize = kind === 'plan' || Boolean(key.trim()) && (kind !== 'custom' || /^https?:\/\/[^/\s]+/.test(baseUrl));
  return <div className={`first-run-preview${intro ? ' is-intro' : ''}`}>
    <header className="first-run-lab">
      <span className="first-run-preview-label">{t('交互预览 · 模拟账户', 'Interactive preview · Simulated account')}</span>
      <div className="first-run-lab-actions">
        <Menu label={t('预览状态', 'Preview state')} value={scenario} items={[
          { id: 'success', label: t('正常', 'Success') }, { id: 'no-plan', label: t('无套餐', 'No plan') }, { id: 'network', label: t('网络失败', 'Network error') },
        ]} onChange={value => { cancel(); setScenario(value as Scenario); setIssue(undefined); }}/>
        <label className="first-run-motion"><input type="checkbox" checked={motion} onChange={event => setMotion(event.target.checked)}/>{t('开场动画', 'Intro')}</label>
        <button className="icon-button" aria-label={t('重播开场', 'Replay intro')} data-tooltip={t('重播开场', 'Replay intro')} disabled={!motion || reduced || pending} onClick={() => { stopIntro(); setStage(0); setReplay(value => value + 1); }}><Play size={15}/></button>
        <button className="icon-button" aria-label={t('重新开始', 'Start over')} data-tooltip={t('重新开始', 'Start over')} onClick={reset}><RotateCcw size={16}/></button>
        <button className="icon-button" aria-label={t('切换主题', 'Toggle theme')} data-tooltip={t('切换主题', 'Toggle theme')} onClick={() => setDark(!dark)}><SunMoon size={17}/></button>
        <button className="first-run-language" aria-label="Language" onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}>{language === 'zh' ? 'EN' : '中'}</button>
      </div>
    </header>
    {stage < 3 ? <main className="first-run-main">
      <header ref={brand} className="first-run-brand"><img ref={mark} className="first-run-mark" src={logoUrl} width="44" height="44" alt=""/><img className="first-run-wordmark" src={dark ? wordmarkDark : wordmarkLight} width="1000" height="151" alt="Desktop for Step Code"/></header>
      <div ref={content} className="first-run-flow" onPointerDown={stopIntro} onKeyDown={stopIntro}>
        <nav className="first-run-steps" aria-label={t('初次设置', 'Initial setup')}>
          {labels.map((label, index) => <button type="button" key={label} aria-current={stage === index ? 'step' : undefined}
            disabled={pending || index > stage} onClick={() => enterStage(index)}>
            <span>{index < stage ? <Check size={13}/> : index + 1}</span>{label}
          </button>)}
        </nav>
        <section key={stage} className="first-run-stage" aria-labelledby="first-run-heading">
          <div className="first-run-heading">
            <h1 ref={title} id="first-run-heading" tabIndex={-1}>{stage === 0 ? t('连接模型服务', 'Connect a model service')
              : stage === 1 ? t('从哪里开始？', 'Where will you work?') : t('开始阶跃', 'Take the first step')}</h1>
            <span className="first-run-step-count">{stage + 1} / 3</span>
          </div>
          {stage === 0 && <>
            <fieldset className="first-run-services" disabled={pending}><legend className="first-run-sr">{t('模型服务', 'Model service')}</legend>
              {options.map(option => <label key={option.id} className={`first-run-service${kind === option.id ? ' is-selected' : ''}`}>
                <input type="radio" name="service" value={option.id} checked={kind === option.id} onChange={() => editAccount(option.id)}/>
                <span className="first-run-service-icon">{option.icon}</span>
                <span className="first-run-service-name">{option.label}</span><span className="first-run-service-detail">{option.detail}</span>
                <span className="first-run-radio" aria-hidden="true">{kind === option.id && <Check size={12}/>}</span>
              </label>)}
            </fieldset>
            <div className="first-run-credentials" key={kind}>
              {kind !== 'custom' ? <div className="first-run-field-row"><span>{t('账户地区', 'Account region')}</span>
                <div className="first-run-segmented" role="group" aria-label={t('账户地区', 'Account region')}>
                  {(['cn', 'global'] as const).map(item => <button type="button" key={item} aria-pressed={region === item} disabled={pending}
                    onClick={() => { setRegion(item); setIssue(undefined); }}>{regionName(item)}</button>)}
                </div></div> : <>
                <label>Base URL<input type="url" value={baseUrl} disabled={pending} onChange={event => setBaseUrl(event.target.value)}/></label>
                <div className="first-run-field-row"><span>{t('API 格式', 'API format')}</span><Menu label={t('API 格式', 'API format')} value={format} disabled={pending}
                  items={[{ id: 'openai-completions', label: 'Chat Completions' }, { id: 'openai-responses', label: 'Responses' }, { id: 'anthropic-messages', label: 'Anthropic Messages' }]} onChange={setFormat}/></div>
              </>}
              {kind !== 'plan' && <label>API Key<input type="password" autoComplete="off" value={key} disabled={pending} placeholder={t('输入任意示例值', 'Enter a sample value')} onChange={event => { setKey(event.target.value); setIssue(undefined); }}/></label>}
              <div className="first-run-route"><ShieldCheck size={15}/><span>{kind === 'plan' ? t('Step Plan · 不自动转为 API 计费', 'Step Plan · No automatic API billing fallback') : kind === 'api' ? t('官方 API · 与 Plan 套餐分开计费', 'Official API · Billed separately from Plan') : t('自定义供应商 · 与阶跃账户独立', 'Custom provider · Separate from your Step account')}</span></div>
            </div>
            {issue && <div className="first-run-issue" role="alert"><CircleHelp size={18}/><div>
              <strong>{issue === 'no-plan' ? t('没有查询到可用套餐', 'No available plan found') : t('暂时无法验证账户', 'Could not verify the account')}</strong>
              <p>{issue === 'no-plan' ? t('当前仍为 Plan 方式，尚未切换计费。', 'Plan remains selected. The billing method has not changed.') : t('未应用新账户，可以重试或取消。', 'No new account was applied. Retry or cancel.')}</p>
              {issue === 'no-plan' && <button type="button" onClick={() => editAccount('api')}>{t('改用 API Key 登录', 'Sign in with API key')}<ArrowRight size={14}/></button>}
            </div></div>}
          </>}
          {stage === 1 && <>
            <div className="first-run-connected"><Check size={15}/><span>{account?.name} · {account?.kind === 'custom' ? t('自定义端点', 'Custom endpoint') : regionName(account?.region ?? 'cn')}</span>
              <button type="button" onClick={() => enterStage(0)}>{t('更改', 'Change')}</button></div>
            <fieldset className="first-run-scope"><legend className="first-run-sr">{t('工作范围', 'Workspace')}</legend>
              <label className={scope === 'project' ? 'is-selected' : ''}><input type="radio" name="scope" checked={scope === 'project'} onChange={() => setScope('project')}/><FolderOpen size={24}/><span>{t('项目会话', 'Project')}</span><span className="first-run-radio">{scope === 'project' && <Check size={12}/>}</span></label>
              <label className={scope === 'independent' ? 'is-selected' : ''}><input type="radio" name="scope" checked={scope === 'independent'} onChange={() => setScope('independent')}/><MessageSquare size={24}/><span>{t('独立会话', 'Independent')}</span><span className="first-run-radio">{scope === 'independent' && <Check size={12}/>}</span></label>
            </fieldset>
            {scope === 'project' ? <div className="first-run-directory">
              <label htmlFor="project-directory">{t('项目目录', 'Project folder')}</label>
              <div className="first-run-directory-field">
                <input id="project-directory" value={path} placeholder={t('选择文件夹或输入完整路径', 'Choose a folder or enter its full path')} onChange={event => editPath(event.target.value)}/>
                <button type="button" className="icon-button" aria-label={t('浏览文件夹', 'Browse folders')} data-tooltip={t('浏览文件夹', 'Browse folders')} onClick={() => void browseDirectory()}><FolderOpen size={18}/></button>
              </div>
              {pickedDirectory && <small className="first-run-directory-note">{t('已选择目录；浏览器仅提供目录名，未读取目录内容。', 'Folder selected. The browser provides its name only; no contents were read.')}</small>}
              {directoryError && <small role="alert" className="first-run-directory-note">{t('无法打开文件夹选择器，请手动输入项目路径。', 'Folder picker unavailable. Enter the project path instead.')}</small>}
              <Menu label={t('选择示例目录', 'Choose sample folder')} value={path} items={paths.map(value => ({ id: value, label: value, icon: <FolderOpen size={15}/> }))} onChange={editPath}/>
            </div> : <div className="first-run-independent"><MessageSquare size={18}/><span>{t('未关联项目目录', 'No project folder attached')}</span></div>}
            <div className="first-run-permission"><ShieldCheck size={20}/><div><strong>{t('访问权限', 'Access permissions')}</strong><span>{permission === 'ask' ? t('写入与命令执行先确认', 'Confirm writes and commands') : permission === 'approve-for-me' ? t('常规操作自动执行，风险操作仍需确认', 'Routine actions run; risky actions still ask') : t('危险命令也免确认，请谨慎使用', 'Dangerous commands run without approval')}</span></div>{permissionPicker}</div>
          </>}
          {stage === 2 && <>
            <dl className="first-run-review">
              <div><dt>{t('模型服务', 'Service')}</dt><dd>{account?.name}<small>{account?.kind !== 'custom' && regionName(account?.region ?? 'cn')}</small></dd></div>
              <div><dt>{t('计费方式', 'Billing')}</dt><dd className="first-run-billing">{billing(account?.kind)}</dd></div>
              <div><dt>{t('工作范围', 'Workspace')}</dt><dd>{scope === 'project' ? <><FolderOpen size={15}/><span>{path}</span></> : <><MessageSquare size={15}/>{t('独立会话', 'Independent session')}</>}</dd></div>
              <div><dt>{t('模型与思考', 'Model and thinking')}</dt><dd><ModelEffortPicker model={model} models={[account?.kind === 'custom' ? customModel : stepModel]} level={effort} levels={['low', 'medium', 'high']} language={language} disabled={false} onModel={async value => setModel(value)} onEffort={async value => setEffort(value)}/></dd></div>
              <div><dt>{t('权限', 'Permissions')}</dt><dd>{permissionPicker}</dd></div>
            </dl>
            <div className="first-run-ready"><span className="first-run-ready-icon"><Check size={17}/></span><span>{t('配置已就绪，尚未发送模型请求。', 'Setup is ready. No model request has been sent.')}</span></div>
          </>}
        </section>
        <footer className="first-run-footer">
          {stage === 0 ? <button className="first-run-later" type="button" disabled={pending} onClick={() => { cancel(); enterStage(3); }}>{t('稍后设置', 'Set up later')}</button>
            : <button type="button" className="first-run-back" onClick={() => enterStage(stage - 1)}><ArrowLeft size={16}/>{t('上一步', 'Back')}</button>}
          <div className="first-run-footer-actions">
            {pending && <button type="button" className="icon-button" aria-label={t('取消授权', 'Cancel authorization')} data-tooltip={t('取消授权', 'Cancel authorization')} onClick={cancel}><X size={17}/></button>}
            <button type="button" className="primary first-run-next" disabled={stage === 0 ? pending || !readyToAuthorize : stage === 1 ? scope === 'project' && !path.trim() : false}
              onClick={() => stage === 0 ? authorize() : enterStage(stage + 1)}>
              {pending ? <><LoaderCircle size={17} className="first-run-spinner"/>{t('正在验证…', 'Verifying…')}</>
                : stage === 0 ? <>{kind === 'plan' ? <ExternalLink size={16}/> : <KeyRound size={16}/>} {kind === 'plan' ? t('浏览器授权', 'Authorize in browser') : t('连接并继续', 'Connect and continue')}</>
                : <>{stage === 1 ? t('继续', 'Continue') : t('开始会话', 'Start a conversation')}<ArrowRight size={16}/></>}
            </button>
          </div>
        </footer>
      </div>
      <div className="first-run-bottom"><span>{t('独立社区项目', 'Independent community project')}</span><span>{t('凭据与个人 CLI 配置分离', 'Separate from your personal CLI profile')}</span></div>
      {intro && <button className="first-run-skip-motion" onClick={stopIntro}>{t('跳过动画', 'Skip animation')}<ArrowRight size={14}/></button>}
    </main> : <main ref={workspace} className="first-run-workspace">
      <header className="first-run-workspace-header"><img src={logoUrl} width="26" height="26" alt=""/><img className="first-run-wordmark" src={dark ? wordmarkDark : wordmarkLight} width="1000" height="151" alt="Desktop for Step Code"/><button onClick={() => enterStage(0)}>{t('初次设置', 'Initial setup')}</button></header>
      <div className="first-run-workspace-body"><NewSession language={language} workspace={scope === 'project' && path ? path : undefined} workspaces={paths} title={value => value.split('\\').at(-1) ?? value}
        disabled={false} composing={false} onSelect={value => { setScope(value ? 'project' : 'independent'); editPath(value ?? ''); }} onOpenProject={() => enterStage(1)} onSettings={() => enterStage(0)} onOpenChange={noop}/></div>
      <div className="composer-wrap first-run-composer-wrap"><div className="composer">
        <textarea aria-label={t('消息', 'Message')} placeholder={t('你想先做什么？', 'What would you like to work on?')} value={draft} onChange={event => { setDraft(event.target.value); setSent(false); }}/>
        <div className="composer-tools">{permissionPicker}<span className="spacer"/><ModelEffortPicker model={model} models={[model]} level={effort} levels={['low', 'medium', 'high']} language={language} disabled={!account} onModel={async value => setModel(value)} onEffort={async value => setEffort(value)}/>
          <button className="send-button" aria-label={t('模拟发送', 'Simulate send')} data-tooltip={t('模拟发送', 'Simulate send')} disabled={!account || !draft.trim()} onClick={() => setSent(true)}><ArrowUp size={17}/></button></div>
      </div><div className="composer-footer"><span>{account ? `${account.name} · ${billing(account.kind)}` : t('尚未配置账户', 'Account not configured')}</span><span>{sent ? t('已模拟发送 · 无模型调用', 'Simulated · No model call') : t('仅本页模拟，不保存数据', 'Simulation only · Nothing is saved')}</span></div></div>
    </main>}
    <AppTooltip/>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview/>);
