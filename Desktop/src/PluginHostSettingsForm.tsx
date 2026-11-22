import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { capabilityErrorText } from './CapabilitySettings';
import { PluginConnectionSources } from './PluginConnectionSources';
import { editablePluginConfiguration, PluginConfigurationEnumField, PluginConfigurationFields } from './PluginConfigurationForm';
import type { DesktopBridge } from './contracts';
import type { PluginConfigurationInput, PluginHostCapability, PluginHostModels, PluginHostRuntime, PluginHostSettings, PluginPackage } from './capabilities';
import { stepHostModels, stepHostUnavailable, type StepHostUnavailable } from './step-host-catalog';

type Bridge = Pick<DesktopBridge, 'pluginHostSettings' | 'pluginSaveHostSettings' | 'pluginChoosePath'>;
const labels: Record<PluginHostCapability, [string, string]> = {
  'model.text': ['文本', 'Text'], 'model.video': ['视频理解', 'Video understanding'],
  'model.asr': ['语音识别', 'Speech recognition'], 'model.tts': ['语音合成', 'Speech synthesis'],
  'model.image': ['图片理解', 'Image understanding'],
};
const unavailableLabels: Record<StepHostUnavailable, [string, string]> = {
  'channel-unconfirmed': ['当前渠道未确认支持', 'Not confirmed for this channel'],
  'region-unconfirmed': ['当前地区未确认支持', 'Not confirmed for this region'],
  'model-not-adapted': ['DFSC 尚未适配此模型', 'Model not integrated in DFSC'],
  'model-not-selected': ['未选择插件模型', 'No plugin model selected'],
};
function runtimeLabel(status: PluginHostRuntime['status'], zh: boolean) {
  const values: Record<PluginHostRuntime['status'], [string, string]> = {
    unsupported: ['当前宿主版本不支持', 'Unsupported host version'],
    'no-session': ['尚无已连接会话', 'No connected session'],
    unconfigured: ['尚未选择模型来源', 'Model source not selected'],
    disabled: ['服务已停用', 'Service disabled'],
    'source-paused': ['模型连接已暂停', 'Model connections paused'],
    'restart-required': ['待重启会话', 'Session restart required'],
    connected: ['当前会话已连接', 'Connected in current session'],
    unavailable: ['连接状态未确认', 'Connection unconfirmed'],
    'choose-account': ['请重新选择额度账户', 'Select a quota account again'],
    'account-unavailable': ['额度账户未连接', 'Quota account not connected'],
    'account-expired': ['额度账户登录已过期', 'Quota account login expired'],
    'account-changed': ['额度账户已变化，请重新选择', 'Quota account changed; select it again'],
  };
  return values[status][zh ? 0 : 1];
}
export function PluginHostSettingsForm({ bridge, pkg, language, busy, visible, formId, runtimeKey, onState, onSaved }: {
  bridge: Bridge; pkg: PluginPackage; language: string; busy: boolean; visible: boolean; formId: string; runtimeKey: string;
  onState(value: { dirty: boolean; pending: boolean; ready: boolean }): void; onSaved(): Promise<void>;
}) {
  const zh = language === 'zh', t = (cn: string, en: string) => zh ? cn : en;
  const [saved, setSaved] = useState<PluginHostSettings>();
  const [mode, setMode] = useState<PluginHostSettings['mode']>(null), [models, setModels] = useState<PluginHostModels>({});
  const [selectedRows, setSelectedRows] = useState<PluginHostCapability[]>([]);
  const [independentRows, setIndependentRows] = useState<PluginHostCapability[]>([]);
  const [routeAccount, setRouteAccount] = useState(false);
  const [account, setAccount] = useState<PluginHostSettings['account']>();
  const [ticket, setTicket] = useState<string>();
  const [reselected, setReselected] = useState(false);
  const [configuration, setConfiguration] = useState<PluginConfigurationInput>();
  const [runtime, setRuntime] = useState<PluginHostRuntime>(), [pending, setPending] = useState(false);
  const [needsStatus, setNeedsStatus] = useState(false);
  const [error, setError] = useState(''), [reloadReview, setReloadReview] = useState(false);
  const operation = useRef(false), alive = useRef(true), callback = useRef(onState), observedRuntime = useRef(runtimeKey);
  observedRuntime.current = runtimeKey;
  callback.current = onState;
  const routed = mode === 'routed', accountEnabled = mode === 'account' || routed && routeAccount;
  const directEnabled = mode === 'independent' || routed;
  const independentSupport = saved?.supportedIndependentCapabilities;
  const canMix = Boolean(independentSupport?.length && saved?.independent);
  const incomplete = accountEnabled && selectedRows.some(id => !models[id]);
  const missingRoutes = routed && (!independentRows.length || routeAccount && !selectedRows.length);
  const dirty = Boolean(saved && mode && (saved.mode !== mode || mode !== 'paused' && !saved.configurationCurrent
    || accountEnabled && (reselected || incomplete || saved.capabilities.some(id => models[id] !== saved.models[id]))
    || routed && (routeAccount !== Boolean(saved.source) || saved.capabilities.some(id =>
      independentRows.includes(id) !== Boolean(saved.independentCapabilities?.includes(id))))
    || directEnabled && configuration && saved.independent
      && (!saved.independent.configured || JSON.stringify(configuration) !== JSON.stringify(editablePluginConfiguration(saved.independent)))));
  const supported = saved?.runtime.status !== 'unsupported';
  const accountReady = Boolean(ticket && ticket === account?.ticket);
  const ready = Boolean(saved && supported && mode && (!accountEnabled || accountReady && !incomplete)
    && (!directEnabled || configuration) && !missingRoutes);
  const locked = busy || pending;
  const source = accountReady && account ? account : saved?.source;
  const channelName = (value: 'plan' | 'api') => value === 'plan' ? 'Step Plan' : t('开放平台 API', 'Open Platform API');
  const regionName = (value: 'cn' | 'oversea') => value === 'cn' ? t('中国大陆', 'China') : t('海外', 'Overseas');
  const unavailable = (reason: StepHostUnavailable) => unavailableLabels[reason][zh ? 0 : 1];
  const accept = (value: PluginHostSettings) => {
    setSaved(value); setMode(value.mode); setModels({ ...value.models });
    setSelectedRows(value.capabilities.filter(id => Boolean(value.models[id])));
    setIndependentRows(value.independentCapabilities ?? []);
    setRouteAccount(value.mode === 'routed' && Boolean(value.source));
    setAccount(value.account); setReselected(false);
    setTicket((value.mode === 'account' || value.mode === 'routed') && value.accountMatches ? value.account?.ticket : undefined);
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
          setAccount(value.account);
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
        ...(accountEnabled ? { models, accountTicket: ticket } : {}),
        ...(directEnabled ? { configuration } : {}),
        ...(routed ? { independentCapabilities: independentRows } : {}) });
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
  const chooseAccount = () => {
    if (!saved || !account) return;
    const mix = directEnabled && canMix;
    setMode(mix ? 'routed' : 'account'); setRouteAccount(mix); setTicket(account.ticket);
    setReselected(previous => previous || Boolean(saved.source && (!ticket || ticket !== account.ticket)));
    if ((mode === 'independent' && mix) || source?.channel !== account.channel || source.region !== account.region) {
      setModels({}); setSelectedRows([]);
    }
  };
  const pause = () => setMode(saved && saved.revision !== 'unconfigured' ? 'paused' : null);
  const toggleAccount = () => {
    if (routed) { setRouteAccount(false); setTicket(undefined); setModels({}); setSelectedRows([]); }
    else pause();
  };
  const toggleIndependent = () => {
    if (directEnabled) {
      setIndependentRows([]);
      if (accountEnabled) setMode('account');
      else pause();
      return;
    }
    if (canMix) {
      setRouteAccount(accountEnabled);
      if (!accountEnabled) { setModels({}); setSelectedRows([]); }
      setMode('routed');
    } else setMode('independent');
  };
  const chooseRowSource = (id: PluginHostCapability, value: string) => {
    const direct = value === 'independent';
    setIndependentRows(previous => direct ? [...previous.filter(item => item !== id), id] : previous.filter(item => item !== id));
    setSelectedRows(previous => value && !direct ? [...previous.filter(item => item !== id), id] : previous.filter(item => item !== id));
    if (direct || !value) setModels(previous => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };
  const officialSource = (channel: 'plan' | 'api') => {
    const enabled = accountEnabled && source?.channel === channel;
    if (enabled) return { enabled, toggle: toggleAccount };
    if ((accountEnabled && canMix) || account?.channel !== channel) return {};
    return { toggle: chooseAccount };
  };
  return <form id={formId} hidden={!visible} className="pc-generic-form pc-host-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {error && <p className="cap-error" role="alert">{error}</p>}
    {!saved ? <button type="button" disabled={pending} onClick={() => void read()}>{pending ? t('读取中', 'Loading') : t('重试', 'Retry')}</button> : <>
      <fieldset className="pc-form-fields" disabled={locked || !supported}>
        <PluginConnectionSources language={language}
          summary={accountEnabled && directEnabled ? t('2 项已启用', '2 enabled')
              : accountEnabled || directEnabled ? t('1 项已启用', '1 enabled')
              : t('未启用', 'None enabled')}
          sources={{ plan: officialSource('plan'), api: officialSource('api'), independent: directEnabled
            ? { enabled: true, toggle: toggleIndependent }
            : configuration ? { toggle: toggleIndependent } : {} }}>
          <p className="pc-hint">{canMix
            ? t('官方连接使用当前登录的 Step 账户；独立配置可与其同时启用。每项能力只使用所选来源。',
              'The signed-in Step account and independent configuration can be enabled together. Each capability uses only its selected source.')
            : t('此版本插件每次仅使用一种连接来源。', 'This plugin version uses one source per launch.')}</p>
          {!account && !directEnabled && <p className="pc-hint">{t('请先在账户设置中连接官方 Step 账户。', 'Connect an official Step account in account settings first.')}</p>}
          {saved.legacyFollow && mode === null && <p className="pc-hint">{t('旧版「跟随会话」已停用，请重新选择额度来源。',
            'The legacy session-following setting is inactive. Select a billing source again.')}</p>}
        </PluginConnectionSources>
        <section className="pc-form-section" aria-label={t('模型调用', 'Model calls')}>
          <div className="pc-section-title"><h3>{t('模型调用', 'Model calls')}</h3>
            <button type="button" className="icon-button" disabled={locked} aria-label={t('刷新宿主状态', 'Refresh host status')}
              onClick={() => void read(true)}><RefreshCw size={14}/></button></div>
          <p className="pc-host-runtime" role="status">{runtime ? runtimeLabel(runtime.status, zh) : t('状态待刷新', 'Status needs refresh')}
            <span>{t('当前会话快照', 'Current session snapshot')}</span></p>
          <div className="pc-host-route-grid pc-host-route-head" aria-hidden="true">
            <span>{t('能力', 'Capability')}</span><span>{t('调用来源', 'Source')}</span><span>{t('模型', 'Model')}</span>
            <span>{t('当前会话', 'Current session')}</span>
          </div>
          <ul className="pc-host-routes">{saved.capabilities.map(id => {
            const label = labels[id][zh ? 0 : 1];
            const direct = routed && independentRows.includes(id);
            const canUseDirect = routed && Boolean(independentSupport?.includes(id));
            const selected = selectedRows.includes(id) && Boolean(source) && !direct;
            const state = runtime?.capabilities?.find(item => item.id === id);
            const runningDirect = runtime?.independentCapabilities?.includes(id);
            const editableAccount = accountEnabled && accountReady && Boolean(source);
            return <li key={id} className="pc-host-route-grid">
              <strong>{label}</strong>
              <div className="pc-host-route-field"><PluginConfigurationEnumField field={{
                label: `${label} · ${t('调用来源', 'Source')}`, options: [
                  { value: '', label: t('不使用', 'Do not use') },
                  ...(['plan', 'api'] as const).map(option => ({
                    value: option, label: channelName(option), disabled: !editableAccount || option !== source?.channel,
                  })),
                  ...(canMix ? [{ value: 'independent', label: t('独立配置', 'Independent'), disabled: !canUseDirect }] : []),
                ],
              }} value={direct ? 'independent' : selected ? source!.channel : ''}
                disabled={!editableAccount && !canUseDirect && !(routed && selected)}
                onChange={value => chooseRowSource(id, value)}/></div>
              <div className="pc-host-route-field"><PluginConfigurationEnumField field={{
                label: `${label} · ${t('模型', 'Model')}`, options: [
                  { value: 'independent', label: t('由插件配置', 'Set by plugin'), disabled: true },
                  { value: '', label: t('选择模型', 'Select a model'), disabled: true },
                  ...stepHostModels(id).map(value => {
                    const reason = source && stepHostUnavailable(id, source, value);
                    return { value, label: reason ? `${value} · ${unavailable(reason)}` : value, disabled: Boolean(reason) };
                  }),
                ],
              }} value={direct ? 'independent' : models[id] ?? ''} disabled={!editableAccount || !selected}
                onChange={value => setModels(previous => ({ ...previous, [id]: value }))}/></div>
              <div className="pc-host-route-state">
                <span className={state?.authorization === 'approved' ? 'pc-host-approved' : undefined}>
                  {runningDirect ? t('插件独立直连', 'Plugin connects directly')
                    : state?.authorization === 'approved' ? t('本次启动已授权', 'Approved for this launch')
                    : state?.authorization === 'required' ? t('首次调用需确认', 'First use needs confirmation')
                      : state?.unavailable ? unavailable(state.unavailable)
                        : state ? t('不可用', 'Unavailable')
                          : runtime?.status === 'connected' && saved.mode === 'routed' ? t('未启用', 'Not enabled')
                            : t('未确认授权', 'Authorization unconfirmed')}</span>
                {state?.available && state.channel && state.region && <small>{channelName(state.channel)} · {regionName(state.region)} · {state.model}</small>}
              </div>
            </li>;
          })}</ul>
          {incomplete && <p className="pc-hint" role="status">{t('请为已选来源的能力补选模型。', 'Select a model for each capability with a source.')}</p>}
          {missingRoutes && <p className="pc-hint" role="status">{t('请为每个已启用的来源至少分配一项能力。',
            'Assign at least one capability to each enabled source.')}</p>}
          {accountEnabled && <div className="pc-permission-row"><ShieldCheck size={17}/><div>
            <strong>{t('逐项调用前确认', 'Per-capability request confirmation')}</strong>
            <p>{t('使用官方账户的能力，首次调用仍需确认。', 'First use of each capability routed to the official account requires confirmation.')}</p></div></div>}
        </section>
        {directEnabled && saved.independent && configuration && <div className="pc-entrance">
          <p className="pc-body-copy">{t('独立配置由插件直连，不经过 Broker，不使用 DFSC 额度。', 'Independent calls go directly through the plugin, without Broker or DFSC quota.')}</p>
          <PluginConfigurationFields saved={saved.independent} draft={configuration} setDraft={setConfiguration} language={language} locked={locked} choosePath={choosePath}/>
        </div>}
        {saved.independentError && !configuration && <p className="pc-hint">{capabilityErrorText(saved.independentError, zh)}</p>}
      </fieldset>
      {(saved.mode === 'independent' || saved.mode === 'routed') && !saved.configurationCurrent && <p className="cap-error" role="status">{t('独立配置已变化。请核对并重新保存模型来源，旧启动不可继续使用。',
          'Independent settings changed. Review and save the source again; previous launches cannot continue.')}</p>}
      <div className="pc-check-row"><button type="button" disabled={pending} onClick={() => dirty ? setReloadReview(true) : void read()}>
        {t('重新载入配置', 'Reload configuration')}</button></div>
      {reloadReview && <div className="pc-reload-review"><p>{t('丢弃当前草稿并重新载入已保存配置？', 'Discard this draft and reload saved settings?')}</p>
        <button type="button" disabled={pending} onClick={() => setReloadReview(false)}>{t('取消', 'Cancel')}</button>
        <button type="button" disabled={pending} onClick={() => void read()}>{t('丢弃并载入', 'Discard and reload')}</button></div>}
    </>}
  </form>;
}
