import { useEffect, useRef, useState } from 'react';
import { Check, FileKey2, RefreshCw, ShieldCheck } from 'lucide-react';
import { capabilityErrorText } from './CapabilitySettings';
import { StepPlatformIcon } from './ProviderBrand';
import { editablePluginConfiguration, PluginConfigurationFields } from './PluginConfigurationForm';
import type { DesktopBridge } from './contracts';
import type { PluginConfigurationInput, PluginHostCapability, PluginHostModels, PluginHostRuntime, PluginHostSettings, PluginPackage } from './capabilities';

type Bridge = Pick<DesktopBridge, 'pluginHostSettings' | 'pluginSaveHostSettings' | 'pluginChoosePath'>;
const labels: Record<PluginHostCapability, [string, string]> = {
  'model.text': ['文本', 'Text'], 'model.video': ['视频理解', 'Video understanding'],
  'model.asr': ['语音识别', 'Speech recognition'], 'model.tts': ['语音合成', 'Speech synthesis'],
};
function runtimeLabel(status: PluginHostRuntime['status'], zh: boolean) {
  const values: Record<PluginHostRuntime['status'], [string, string]> = {
    unsupported: ['当前宿主版本不支持', 'Unsupported host version'],
    'no-session': ['尚无已连接会话', 'No connected session'],
    unconfigured: ['尚未选择模型来源', 'Model source not selected'],
    disabled: ['服务已停用', 'Service disabled'],
    'restart-required': ['待重启会话', 'Session restart required'],
    connected: ['当前会话已连接', 'Connected in current session'],
    unavailable: ['连接状态未确认', 'Connection unconfirmed'],
  };
  return values[status][zh ? 0 : 1];
}
export function PluginHostSettingsForm({ bridge, pkg, language, busy, visible, formId, runtimeKey, onState, onSaved }: {
  bridge: Bridge; pkg: PluginPackage; language: string; busy: boolean; visible: boolean; formId: string; runtimeKey: string;
  onState(value: { dirty: boolean; pending: boolean; ready: boolean }): void; onSaved(): Promise<void>;
}) {
  const zh = language === 'zh', t = (cn: string, en: string) => zh ? cn : en;
  const [saved, setSaved] = useState<PluginHostSettings>();
  const [mode, setMode] = useState<'follow' | 'independent' | null>(null), [models, setModels] = useState<PluginHostModels>({});
  const [configuration, setConfiguration] = useState<PluginConfigurationInput>();
  const [runtime, setRuntime] = useState<PluginHostRuntime>(), [pending, setPending] = useState(false);
  const [needsStatus, setNeedsStatus] = useState(false);
  const [error, setError] = useState(''), [reloadReview, setReloadReview] = useState(false);
  const operation = useRef(false), alive = useRef(true), callback = useRef(onState), observedRuntime = useRef(runtimeKey);
  observedRuntime.current = runtimeKey;
  callback.current = onState;
  const dirty = Boolean(saved && mode && (saved.mode !== mode || !saved.configurationCurrent
    || mode === 'follow' && JSON.stringify(models) !== JSON.stringify(saved.models)
    || mode === 'independent' && configuration && saved.independent
      && (!saved.independent.configured || JSON.stringify(configuration) !== JSON.stringify(editablePluginConfiguration(saved.independent)))));
  const supported = saved?.runtime.status !== 'unsupported';
  const ready = Boolean(saved && mode && supported && (mode !== 'independent' || configuration));
  const locked = busy || pending;
  const accept = (value: PluginHostSettings) => {
    setSaved(value); setMode(value.mode); setModels({ ...value.models });
    setConfiguration(value.independent ? editablePluginConfiguration(value.independent) : undefined);
    setRuntime(value.runtime); setReloadReview(false);
  };
  const read = async (statusOnly = false) => {
    if (operation.current) return;
    const currentRuntime = runtimeKey;
    operation.current = true; setPending(true); setRuntime(undefined);
    if (!statusOnly) setError('');
    try {
      const value = await bridge.pluginHostSettings({ ref: pkg.ref });
      if (alive.current) {
        if (!statusOnly) accept(value);
        if (observedRuntime.current === currentRuntime) {
          setRuntime(value.revision === saved?.revision || !statusOnly ? value.runtime : { status: 'restart-required' });
          setNeedsStatus(false);
          if (statusOnly && value.revision !== saved?.revision)
            setError(previous => previous || capabilityErrorText('capability:stale-configuration', zh));
        } else { setRuntime(undefined); setNeedsStatus(true); }
      }
    } catch (error) {
      if (alive.current && observedRuntime.current === currentRuntime) {
        setError(previous => statusOnly && previous ? previous : capabilityErrorText(error, zh)); setNeedsStatus(false);
      }
    }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (visible && !saved && !error) void read(); }, [visible, saved, pkg.ref]);
  useEffect(() => {
    setRuntime(undefined);
    setNeedsStatus(true);
  }, [runtimeKey, visible]);
  useEffect(() => {
    if (saved && visible && needsStatus && !busy && !pending && !operation.current) void read(true);
  }, [saved, visible, needsStatus, busy, pending]);
  useEffect(() => { callback.current({ dirty, pending, ready }); }, [dirty, pending, ready]);
  const submit = async () => {
    if (!saved || !mode || !ready || locked || operation.current) return;
    const currentRuntime = runtimeKey;
    operation.current = true; setPending(true); setError(''); setRuntime(undefined); setNeedsStatus(false);
    try {
      const value = await bridge.pluginSaveHostSettings({ ref: pkg.ref, revision: saved.revision, mode,
        ...(mode === 'follow' ? { models } : { configuration }) });
      if (alive.current) {
        accept(value);
        if (observedRuntime.current !== currentRuntime) { setRuntime(undefined); setNeedsStatus(true); }
      }
      await onSaved();
    } catch (error) {
      if (alive.current) { setError(capabilityErrorText(error, zh)); setRuntime(undefined); setNeedsStatus(true); }
    }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const choosePath = async (field: { id: string }) => {
    if (locked || operation.current) return;
    operation.current = true; setPending(true); setError('');
    try {
      const path = await bridge.pluginChoosePath({ ref: pkg.ref, field: field.id });
      if (path !== null && alive.current) setConfiguration(previous => previous && ({ ...previous, values: { ...previous.values, [field.id]: path } }));
    } catch (error) { if (alive.current) setError(capabilityErrorText(error, zh)); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  return <form id={formId} hidden={!visible} className="pc-generic-form pc-host-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {error && <p className="cap-error" role="alert">{error}</p>}
    {!saved ? <button type="button" disabled={pending} onClick={() => void read()}>{pending ? t('读取中', 'Loading') : t('重试', 'Retry')}</button> : <>
      <fieldset className="pc-form-fields" disabled={locked || !supported}>
        <section className="pc-form-section">
          <div className="pc-section-title"><h3>{t('模型来源', 'Model source')}</h3>
            <span className="pc-section-meta">{saved.mode ? t('已保存', 'Saved') : t('尚未设置', 'Not configured')}</span></div>
          <div className="pc-mode" role="group" aria-label={t('模型来源', 'Model source')}>
            <button type="button" aria-pressed={mode === 'follow'} onClick={() => setMode('follow')}>
              <StepPlatformIcon size={17}/>{t('跟随 DFSC 会话', 'Follow DFSC session')}{mode === 'follow' && <Check size={14}/>}</button>
            <button type="button" disabled={!configuration} aria-pressed={mode === 'independent'} onClick={() => setMode('independent')}>
              <FileKey2 size={17}/>{t('独立配置', 'Independent')}{mode === 'independent' && <Check size={14}/>}</button>
          </div>
          {mode === null && <p className="pc-body-copy">{t('选择并保存后，再重启需要使用此插件的会话。安装和启用服务不会自动授权账户。',
            'Select and save a source, then restart the session that will use this plugin. Installation and enabling the service do not authorize account access.')}</p>}
          {mode === 'follow' && <div className="pc-follow pc-entrance">
            <p className="pc-body-copy">{t('使用实际调用插件的会话账户与已应用模型，不读取独立配置中的 Key。Plan 失败不会切换到直调 API。',
              'Uses the invoking session’s account and applied model, not an independent key. Plan failures never switch to direct API.')}</p>
            {saved.capabilities.includes('model.asr') && <div className="pc-field pc-host-speech"><label>{t('语音识别专用模型', 'Dedicated speech recognition model')}
              <input value={models['model.asr'] ?? ''} placeholder="stepaudio-2.5-asr" maxLength={160} spellCheck={false}
                onChange={event => setModels(previous => {
                  const next = { ...previous }; if (event.target.value) next['model.asr'] = event.target.value; else delete next['model.asr']; return next;
                })}/></label><p className="pc-hint">{t('留空使用 stepaudio-2.5-asr。当前仅支持此模型及 WAV 音频；其他值会显示为不可用。',
                  'Leave blank for stepaudio-2.5-asr. Only this model and WAV audio are supported; other values are unavailable.')}</p></div>}
            <div className="pc-permission-row"><ShieldCheck size={17}/><div><strong>{t('逐项调用前确认', 'Per-capability request confirmation')}</strong>
              <p>{t('保存不是付费授权。首次调用每项能力前仍需确认；授权只覆盖本次启动的会话、账户和模型。',
                'Saving is not paid authorization. Each capability needs first-use confirmation for this launch, session, account and model.')}</p></div></div>
          </div>}
          {mode === 'independent' && <p className="pc-body-copy">{t('使用下方独立连接。插件自行调用，不经过宿主账户代理，也不会借用 DFSC 的 Key。',
            'Uses the independent settings below. Requests are made by the plugin, not the host account broker; DFSC keys are not shared.')}</p>}
          {!configuration && <p className="pc-hint">{saved.independentError ? capabilityErrorText(saved.independentError, zh)
            : t('作者未提供兼容的独立配置，当前仅可选择跟随 DFSC。', 'No compatible independent configuration was provided; only Follow DFSC is available.')}</p>}
        </section>
        {mode === 'independent' && saved.independent && configuration && <div className="pc-entrance">
          <PluginConfigurationFields saved={saved.independent} draft={configuration} setDraft={setConfiguration} language={language} locked={locked} choosePath={choosePath}/>
        </div>}
      </fieldset>
      <section className="pc-form-section pc-host-observation" aria-label={t('宿主连接与授权', 'Host connection and authorization')}>
        <div className="pc-section-title"><h3>{t('宿主连接与授权', 'Host connection and authorization')}</h3>
          <button type="button" className="icon-button" disabled={locked} aria-label={t('刷新宿主状态', 'Refresh host status')}
            onClick={() => void read(true)}><RefreshCw size={14}/></button></div>
        <p className="pc-host-runtime" role="status">{runtime ? runtimeLabel(runtime.status, zh) : t('状态待刷新', 'Status needs refresh')}
          <span>{t('查询快照', 'Snapshot')}</span></p>
        <ul className="pc-host-capabilities">{saved.capabilities.map(id => {
          const state = runtime?.capabilities?.find(item => item.id === id);
          return <li key={id}><div><strong>{labels[id][zh ? 0 : 1]}</strong>
            <span>{state?.model ?? (id === 'model.tts' ? t('当前宿主暂未支持', 'Not supported by this host')
              : saved.mode === 'independent' ? t('由插件独立配置', 'Configured independently')
                : t('连接后按实际会话确认', 'Confirmed from the connected session'))}</span></div>
            <div>{state?.available && <span>{state.channel === 'plan' ? 'Step Plan' : 'API'} · {state.region === 'cn' ? t('中国大陆', 'China') : t('海外', 'Overseas')}</span>}
              <span className={state?.authorization === 'approved' ? 'pc-host-approved' : undefined}>
                {state ? state.authorization === 'approved' ? t('本次启动已授权', 'Approved for this launch')
                  : state.authorization === 'required' ? t('首次调用需确认', 'First use needs confirmation') : t('不可用', 'Unavailable')
                  : t('未确认授权', 'Authorization unconfirmed')}</span></div></li>;
        })}</ul>
        {saved.mode === 'independent' && !saved.configurationCurrent && <p className="cap-error" role="status">{t('独立配置已变化。请核对并重新保存模型来源，旧启动不可继续使用。',
          'Independent settings changed. Review and save the source again; previous launches cannot continue.')}</p>}
      </section>
      <div className="pc-check-row"><button type="button" disabled={pending} onClick={() => dirty ? setReloadReview(true) : void read()}>
        {t('重新载入配置', 'Reload configuration')}</button></div>
      {reloadReview && <div className="pc-reload-review"><p>{t('丢弃当前草稿并重新载入已保存配置？', 'Discard this draft and reload saved settings?')}</p>
        <button type="button" disabled={pending} onClick={() => setReloadReview(false)}>{t('取消', 'Cancel')}</button>
        <button type="button" disabled={pending} onClick={() => void read()}>{t('丢弃并载入', 'Discard and reload')}</button></div>}
    </>}
  </form>;
}
