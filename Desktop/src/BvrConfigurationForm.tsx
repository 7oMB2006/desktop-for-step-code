import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, CheckCheck, Eye, EyeOff, FileKey2, FolderOpen, Info, LoaderCircle, Mic, ShieldCheck, Video } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import { bvrSettingsError, type BvrConfiguration, type BvrConfigurationInput, type BvrPathKind } from './bvr-settings';
import { CapabilityDisclosure } from './CapabilitySettings';
import { StepPlatformIcon } from './ProviderBrand';

export type BvrSettingsBridge = Pick<DesktopBridge, 'bvrConfiguration' | 'bvrSaveConfiguration'
  | 'bvrCheckEnvironment' | 'bvrChoosePath'>;
function editable(value: BvrConfiguration): BvrConfigurationInput {
  const { revision, mode, runtimeDirectory, apiBase, model, asrApiBase, asrModel,
    cookieFile, proxy, downloadDirectory, preferCaptions } = value;
  return { revision, mode, runtimeDirectory, apiBase, model, asrApiBase, asrModel,
    cookieFile, proxy, downloadDirectory, preferCaptions };
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="pc-field"><label>{label}{children}</label>{hint && <p className="pc-hint">{hint}</p>}</div>;
}
export function BvrConfigurationForm({ bridge, language, busy, formId, visible, onState, onSaved }: {
  bridge: BvrSettingsBridge; language: string; busy: boolean; formId: string; visible: boolean;
  onState(value: { dirty: boolean; pending: boolean; ready: boolean }): void;
  onSaved(): Promise<void>;
}) {
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const [saved, setSaved] = useState<BvrConfiguration>();
  const [draft, setDraft] = useState<BvrConfigurationInput>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState('');
  const [showMain, setShowMain] = useState(false);
  const [showAsr, setShowAsr] = useState(false);
  const operation = useRef(false);
  const alive = useRef(true);
  const stateCallback = useRef(onState);
  stateCallback.current = onState;
  const dirty = Boolean(saved && draft && JSON.stringify(draft) !== JSON.stringify(editable(saved)));
  const locked = busy || pending || Boolean(saved?.legacyProvider);
  const read = async () => {
    if (operation.current) return;
    operation.current = true; setPending(true); setError('');
    try {
      const value = await bridge.bvrConfiguration();
      if (alive.current) { setSaved(value); setDraft(editable(value)); setCheck(''); }
    } catch (error) { if (alive.current) setError(bvrSettingsError(error, language)); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  useEffect(() => { alive.current = true; void read(); return () => { alive.current = false; }; }, [bridge]);
  useEffect(() => { stateCallback.current({ dirty, pending, ready: Boolean(saved && !saved.legacyProvider) }); }, [dirty, pending, saved]);
  useEffect(() => { if (!visible) { setShowMain(false); setShowAsr(false); } }, [visible]);
  const update = <K extends keyof BvrConfigurationInput>(key: K, value: BvrConfigurationInput[K]) => {
    setDraft(previous => previous && ({ ...previous, [key]: value })); setCheck(''); setError('');
  };
  const choose = async (kind: BvrPathKind, key: 'runtimeDirectory' | 'cookieFile' | 'downloadDirectory') => {
    if (operation.current || locked) return;
    operation.current = true; setPending(true);
    try { const value = await bridge.bvrChoosePath(kind); if (value && alive.current) update(key, value); }
    catch (error) { if (alive.current) setError(bvrSettingsError(error, language)); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const perform = async (save: boolean) => {
    if (!draft || operation.current || locked) return;
    operation.current = true; setPending(true); setError(''); setCheck('');
    try {
      if (save) {
        const value = await bridge.bvrSaveConfiguration(draft);
        if (alive.current) { setSaved(value); setDraft(editable(value)); setShowMain(false); setShowAsr(false); }
        await onSaved();
      } else {
        const result = await bridge.bvrCheckEnvironment(draft);
        if (alive.current) setCheck(t(`Node.js ${result.node} · 运行目录与依赖就绪；未验证账户或调用模型。`,
          `Node.js ${result.node} · Runtime and dependencies ready; no account validation or model call.`));
      }
    } catch (error) { if (alive.current) setError(bvrSettingsError(error, language)); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const pathField = (label: string, kind: BvrPathKind, key: 'runtimeDirectory' | 'cookieFile' | 'downloadDirectory', hint?: string) =>
    <Field label={label} hint={hint}><span className="pc-path">
      <input value={draft?.[key] ?? ''} disabled={locked} onChange={event => update(key, event.target.value)} spellCheck={false}/>
      <button type="button" className="icon-button" aria-label={t(`选择${label}`, `Choose ${label}`)} disabled={locked}
        onClick={() => void choose(kind, key)}><FolderOpen size={16}/></button>
    </span></Field>;
  return <form id={formId} className="pc-bvr-form" hidden={!visible} onSubmit={event => { event.preventDefault(); void perform(true); }}>
    {error && <p className="cap-error" role="alert">{error}</p>}
    {!draft ? <button type="button" disabled={pending} onClick={() => void read()}>{pending ? t('读取中', 'Loading') : t('重试', 'Retry')}</button> : <>
      {saved?.legacyProvider && <p className="cap-error" role="alert">{bvrSettingsError(new Error('bvr:legacy-provider'), language)}</p>}
      <fieldset disabled={locked} className="pc-form-fields">
        <section className="pc-form-section">
          <div className="pc-section-title"><h3>{t('模型来源', 'Model source')}</h3><span className="pc-section-meta">{t('仅影响 BVR', 'BVR only')}</span></div>
          <div className="pc-mode" role="group" aria-label={t('模型来源', 'Model source')}>
            <button type="button" aria-pressed={draft.mode === 'dfsc'} onClick={() => { update('mode', 'dfsc'); setShowMain(false); setShowAsr(false); }}>
              <StepPlatformIcon size={17}/>{t('跟随 DFSC 会话', 'Follow DFSC session')}{draft.mode === 'dfsc' && <Check size={14}/>}</button>
            <button type="button" aria-pressed={draft.mode === 'independent'} onClick={() => update('mode', 'independent')}>
              <FileKey2 size={17}/>{t('独立配置', 'Independent')}{draft.mode === 'independent' && <Check size={14}/>}</button>
          </div>
          {draft.mode === 'dfsc' ? <div className="pc-follow pc-entrance">
            <p className="pc-body-copy">{t('使用实际调用 BVR 的会话账户与视觉模型，语音识别使用专用模型 stepaudio-2.5-asr。',
              'Uses the invoking session’s account and visual model, with the dedicated stepaudio-2.5-asr speech model.')}</p>
            <p className="pc-semantic-note"><Info size={14}/><span>{t('仅支持已登录的阶跃官方账户。按实际会话确认计费渠道；Plan 失败不会回退到直调 API。',
              'Requires an applied official Step login. Billing follows the invoking session; Plan failures never fall back to direct API.')}</span></p>
          </div> : <div className="pc-independent pc-entrance">
            <div className="pc-api-services">
              {(['main', 'asr'] as const).map(kind => {
                const asr = kind === 'asr';
                const endpoint = asr ? 'asrApiBase' : 'apiBase', key = asr ? 'asrApiKey' : 'apiKey', model = asr ? 'asrModel' : 'model';
                const show = asr ? showAsr : showMain, hasKey = asr ? saved?.hasAsrApiKey : saved?.hasApiKey;
                const title = asr ? t('语音识别（ASR）', 'Speech recognition (ASR)') : t('主力模型', 'Main model');
                return <fieldset className="pc-api-service" key={kind}><legend>{asr ? <Mic size={15}/> : <Video size={15}/>} {title}</legend>
                  <p className="pc-service-purpose">{asr ? t('没有可用字幕时，将音频转为文字', 'Transcribes audio when captions are unavailable')
                    : t('视频画面分析与内容整理', 'Video analysis and synthesis')}</p>
                  <div className="pc-api-fields">
                    <Field label={asr ? t('ASR 接口地址', 'ASR API address') : t('接口地址', 'API address')}>
                      <input type="url" required value={draft[endpoint]} onChange={event => update(endpoint, event.target.value)} spellCheck={false}/></Field>
                    <Field label={asr ? 'ASR API Key' : 'API Key'} hint={hasKey ? t('已配置，留空保留；输入新值替换。', 'Configured. Leave blank to keep, enter a new value to replace.') : undefined}>
                      <span className="pc-secret"><input type={show ? 'text' : 'password'} value={draft[key] ?? ''}
                        onChange={event => update(key, event.target.value || undefined)} required={!hasKey} autoComplete="new-password" spellCheck={false}
                        placeholder={hasKey ? t('已配置', 'Configured') : t('输入 API Key', 'Enter API Key')}/>
                        <button type="button" className="icon-button" aria-label={t(`${show ? '隐藏' : '显示'}${asr ? ' ASR' : ''} API Key`, `${show ? 'Hide' : 'Show'} ${asr ? 'ASR ' : ''}API Key`)}
                          aria-pressed={show} onClick={() => asr ? setShowAsr(!show) : setShowMain(!show)}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span>
                    </Field>
                    <Field label={asr ? t('语音识别模型', 'ASR model') : t('视频理解模型', 'Video model')}>
                      <input required value={draft[model]} onChange={event => update(model, event.target.value)} spellCheck={false}/></Field>
                  </div>
                </fieldset>;
              })}
            </div>
            <p className="pc-semantic-note"><FileKey2 size={14}/><span>{t('两组连接独立计费，不互相借用接口或 Key。此版本支持阶跃官方 API / Plan 地址与 Step ASR 协议。',
              'Connections are billed independently and never borrow endpoints or keys. This version supports official Step API / Plan endpoints and the Step ASR protocol.')}</span></p>
          </div>}
          {draft.mode === 'dfsc' && <div className="pc-permission-row"><ShieldCheck size={17}/><div><strong>{t('调用前确认', 'Confirm before requests')}</strong>
            <p>{t('首次付费请求前，通过系统确认框核对调用会话、账户、模型与渠道。保存配置不会代替授权。',
              'A native confirmation reviews the session, account, model and channel before the first paid request. Saving is not authorization.')}</p></div></div>}
        </section>
        <section className="pc-form-section">
          <div className="pc-section-title"><h3>{t('本机运行环境', 'Local runtime')}</h3><span className="pc-section-meta">Node.js 24+</span></div>
          {pathField(t('BVR 运行目录', 'BVR runtime directory'), 'runtime', 'runtimeDirectory',
            t('选择已安装依赖的新版 BVR 项目目录，不是插件安装目录。', 'Choose an updated BVR checkout with dependencies installed, not the plugin directory.'))}
          <div className="pc-check-row"><button type="button" disabled={locked} onClick={() => void perform(false)}>
            {pending ? <LoaderCircle size={14} className="pc-spin"/> : <CheckCheck size={14}/>} {t('检查环境', 'Check environment')}</button>
            <span className="pc-hint">{t('不调用模型', 'No model request')}</span></div>
          {check && <p className="pc-check-results" role="status">{check}</p>}
        </section>
        <CapabilityDisclosure className="pc-disclosure" label={t('下载与高级设置', 'Downloads and advanced')}>
          <div className="pc-disclosure-content">
            {pathField(t('临时下载目录', 'Temporary download directory'), 'download', 'downloadDirectory',
              t('每次研究创建独立临时目录，结束后清理媒体。', 'Each research uses a separate temporary folder; media is removed afterwards.'))}
            {pathField(t('Bilibili Cookie 文件', 'Bilibili cookie file'), 'cookie', 'cookieFile')}
            <Field label={t('下载 HTTP 代理', 'Download HTTP proxy')} hint={t('用于媒体下载，不代表模型请求也通过代理。', 'For media downloads; model requests are not covered.')}>
              <input value={draft.proxy} onChange={event => update('proxy', event.target.value)} placeholder="http://127.0.0.1:7897"/></Field>
            <label className="pc-checkbox"><input type="checkbox" checked={draft.preferCaptions} onChange={event => update('preferCaptions', event.target.checked)}/>
              {t('优先使用已有字幕', 'Prefer available captions')}</label>
          </div>
        </CapabilityDisclosure>
      </fieldset>
      <div className="pc-check-row">
        {dirty && <button type="button" disabled={pending} onClick={() => { setDraft(editable(saved!)); setError(''); setCheck(''); setShowMain(false); setShowAsr(false); }}>
          {t('放弃更改', 'Discard changes')}</button>}
        <button type="button" disabled={pending || dirty} onClick={() => void read()}>{t('重新读取配置', 'Read configuration again')}</button>
      </div>
    </>}
  </form>;
}
