import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, Plus, Trash2, Eye, EyeOff, Save, Check, X, Download, LoaderCircle, Stethoscope, Copy } from 'lucide-react';
import type { CustomProvider, ProviderInfo, ProviderModel, ProviderApi, DiscoveredProviderModel, ProviderDiagnostic, Model } from './contracts';
import { AppMenu } from './AppMenu';
import { DisclosureChevron } from './DisclosureChevron';
import { SubagentStatusIcon } from './SubagentStatusIcon';
import './provider-settings.css';
import { ProviderThinkingSettings, thinkingSummary } from './ProviderThinkingSettings';
import { importProviderModel } from './provider-model-import';
import { providerDiscoveryError } from './provider-discovery-error';
import { officialModelCapabilities, officialResponsesRequired } from './official-model-capabilities';
import { catalogProviders, type CatalogSelection } from './provider-catalog';
import { ProviderPresetPicker } from './ProviderPresetPicker';
import { ProviderPresetMark } from './ProviderBrand';
import { providerBillingLabels, providerBrandFor, providerCredentialIssue, providerPresetFor, providerRequiresOfficialKey, sameProviderCredentialScope, type ProviderBrandId } from './provider-presets';

const formats: { id: ProviderApi; label: string }[] = [
  { id: 'openai-completions', label: 'Chat Completions · /chat/completions' },
  { id: 'openai-responses', label: 'Responses · /responses' },
  { id: 'anthropic-messages', label: 'Anthropic Messages · /messages' },
];
const blank = (): ProviderInfo => ({ id: '', name: '', baseUrl: '', api: 'openai-completions', enabled: true, keyless: false, hasKey: false, models: [] });
const model = (): ProviderModel => ({ id: '', name: '', reasoning: false, vision: false, contextWindow: 128000, maxTokens: 16384,
  capabilitySources: { contextWindow: 'default', maxTokens: 'default', vision: 'default', thinking: 'default' } });
function capabilitySource(model: ProviderModel, field: 'contextWindow' | 'maxTokens' | 'vision', language: string): string {
  const zh = language !== 'en';
  const source = model.capabilitySources?.[field];
  return source === 'official' ? zh ? '官方资料' : 'Official documentation'
    : source === 'catalog' ? `models.dev${model.catalogMetadata?.stale ? zh ? ' · 缓存' : ' · Cached' : ''}`
    : source === 'upstream' ? zh ? '上游声明' : 'Provider declared'
      : source === 'manual' ? zh ? '手动配置' : 'Manual'
        : source === 'default' ? zh ? '未知 · 临时值' : 'Unknown · Fallback'
          : zh ? '旧配置 · 来源未确认' : 'Legacy · Unconfirmed source';
}
export function ProviderSettings({ providers, language, pending, onSave, onDelete, onDiscover, onTest, onCancelTest, onCopyDiagnostic, activeModel, onBusyChange }: {
  providers: ProviderInfo[]; language: string; pending?: boolean;
  onSave: (provider: CustomProvider, key?: string) => Promise<ProviderInfo[]>;
  onDelete: (id: string) => Promise<ProviderInfo[]>;
  onDiscover: (provider: CustomProvider, key?: string) => Promise<DiscoveredProviderModel[]>;
  onTest: (provider: CustomProvider, modelId: string, key?: string) => Promise<ProviderDiagnostic>;
  onCancelTest: () => Promise<void>;
  onCopyDiagnostic: (text: string) => Promise<void>;
  activeModel?: Model;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  const [draft, setDraft] = useState<ProviderInfo | undefined>(() => providers[0]);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState<'delete' | 'picker' | ProviderInfo>();
  const [picker, setPicker] = useState(false);
  const [returnBrand, setReturnBrand] = useState<ProviderBrandId>();
  const addAnchor = useRef<HTMLButtonElement>(null);
  const editorName = useRef<HTMLInputElement>(null);
  const focusAfterPicker = useRef<'add' | 'editor'>(undefined);
  useEffect(() => {
    if (picker || !focusAfterPicker.current) return;
    (focusAfterPicker.current === 'editor' ? editorName.current : addAnchor.current)?.focus();
    focusAfterPicker.current = undefined;
  }, [picker]);
  const [menu, setMenu] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredProviderModel[] | undefined>();
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  const [catalogMenu, setCatalogMenu] = useState(false);
  const catalogAnchor = useRef<HTMLButtonElement>(null);
  const closeCatalogMenu = useCallback(() => setCatalogMenu(false), []);
  const [recommendationMenu, setRecommendationMenu] = useState(false);
  const recommendationAnchor = useRef<HTMLButtonElement>(null);
  const closeRecommendationMenu = useCallback(() => setRecommendationMenu(false), []);
  const [testing, setTesting] = useState(false);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [diagnostic, setDiagnostic] = useState<ProviderDiagnostic>();
  const [testModel, setTestModel] = useState('');
  const [testMenu, setTestMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const testAnchor = useRef<HTMLButtonElement>(null);
  const closeTestMenu = useCallback(() => setTestMenu(false), []);
  const lifecycle = useRef({ mounted: false, testing: false });
  const cancelTest = useRef(onCancelTest);
  cancelTest.current = onCancelTest;
  useEffect(() => {
    lifecycle.current.mounted = true;
    return () => { lifecycle.current.mounted = false; if (lifecycle.current.testing) void cancelTest.current().catch(() => {}); };
  }, []);
  const blocked = saving || discovering || testing;
  const preset = draft && providerPresetFor(draft);
  const stored = draft?.hasKey && providers.find(p => p.id === draft.id);
  const hasStoredKey = Boolean(stored && sameProviderCredentialScope(stored, draft!));
  const needsKey = Boolean(draft && !draft.keyless && !hasStoredKey && !key.trim());
  const keyIssue = draft && key.trim() ? providerCredentialIssue(draft, key.trim()) : undefined;
  const keyError = keyIssue === 'plan-key' ? t('请输入该套餐的专属 API Key。', 'Enter the API key issued for this subscription.')
    : keyIssue === 'usage-key' ? t('这是套餐 Key，请选择对应的套餐入口。', 'This is a subscription key. Choose its subscription preset.')
    : keyIssue === 'official-key' && !draft?.keyless ? t('请输入官方开放平台 API Key。', 'Enter an official platform API key.') : undefined;
  const fixedPlanRoute = Boolean(preset?.subscriptionKeyPrefix && draft?.presetId);
  const billingLabel = (billing: keyof typeof providerBillingLabels) => providerBillingLabels[billing][language === 'en' ? 1 : 0];
  const recommendations = preset?.recommendations?.filter(id => !draft?.models.some(m => m.id === id)) ?? [];
  useEffect(() => { onBusyChange?.(blocked); return () => onBusyChange?.(false); }, [blocked, onBusyChange]);
  useEffect(() => {
    if (dirty || blocked) return;
    const current = providers.find(provider => provider.id === draft?.id);
    if (current) setDraft(current);
  }, [providers, dirty, blocked, draft?.id]);
  const modelId = draft?.models.find(m => m.id === testModel)?.id
    ?? (activeModel?.provider === draft?.id ? draft?.models.find(m => m.id === activeModel?.id)?.id : undefined)
    ?? draft?.models[0]?.id ?? '';
  const diagnosticMessages: Record<ProviderDiagnostic['outcome'], string> = {
    reply: t('收到有效模型回复', 'Received a valid model reply'),
    authentication: t('认证失败，请检查密钥或权限', 'Authentication failed; check the key or permissions'),
    'not-found': t('模型或接口不可用', 'Model or endpoint unavailable'),
    'rate-limit': t('请求受限，请稍后重试', 'Rate limited; try again later'),
    'http-error': t('上游拒绝请求', 'Provider rejected the request'),
    'invalid-response': t('未收到有效文本回复', 'No valid text reply received'),
    timeout: t('请求超时（30 秒）', 'Request timed out (30 seconds)'),
    cancelled: t('测试已取消', 'Test cancelled'),
    network: t('无法连接，请检查地址、网络或证书', 'Connection failed; check the address, network or certificate'),
    'invalid-config': t('配置不完整，请检查地址、模型和密钥', 'Incomplete configuration; check the address, model and key'),
  };
  const runTest = async () => {
    if (!draft || testing || saving || discovering || !modelId) return;
    setTesting(true); lifecycle.current.testing = true; setDiagnosticOpen(true); setDiagnostic(undefined); setCopied(false); setCopyFailed(false);
    try {
      const result = await onTest(draft, modelId, key.trim() ? key : undefined);
      if (lifecycle.current.mounted) setDiagnostic(result);
    } catch {
      if (lifecycle.current.mounted) setDiagnostic({ ok: false, outcome: 'network', model: modelId, api: draft.api, endpoint: '', elapsedMs: 0 });
    } finally {
      lifecycle.current.testing = false;
      if (lifecycle.current.mounted) setTesting(false);
    }
  };
  const copyDiagnostic = async () => {
    if (!diagnostic) return;
    try { await onCopyDiagnostic(JSON.stringify(diagnostic, null, 2)); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };
  const select = (p?: ProviderInfo) => {
    setPicker(false); setMenu(false); setCatalogMenu(false); setRecommendationMenu(false);
    setDraft(p); setKey(''); setShowKey(false); setDirty(false); setError(''); setSaved(false); setConfirmation(undefined); setDiscovered(undefined); setSelected([]); setFilter('');
    setDiagnosticOpen(false); setDiagnostic(undefined); setTestModel(''); setTestMenu(false); setCopied(false); setCopyFailed(false);
  };
  const choose = (p: ProviderInfo) => {
    if (dirty) setConfirmation(p); else select(p);
  };
  const openPicker = () => {
    setReturnBrand(draft?.id === '' ? preset?.brand : undefined);
    select((draft?.id && providers.find(p => p.id === draft.id)) || providers[0]);
    setPicker(true);
  };
  const choosePicker = () => {
    if (dirty) setConfirmation('picker'); else openPicker();
  };
  const closePicker = () => {
    focusAfterPicker.current = 'add';
    setPicker(false);
  };
  const selectPreset = (p: ProviderInfo) => {
    focusAfterPicker.current = 'editor';
    select(p);
  };
  const update = (patch: Partial<ProviderInfo>) => {
    if (draft && !sameProviderCredentialScope(draft, { ...draft, ...patch })) {
      setKey(''); setShowKey(false);
    }
    setDraft(p => {
      if (!p) return p;
      const apiChanged = patch.api !== undefined && patch.api !== p.api;
      const endpointChanged = patch.baseUrl !== undefined && patch.baseUrl !== p.baseUrl;
      const catalogChanged = 'catalogProvider' in patch && patch.catalogProvider !== p.catalogProvider;
      const models = apiChanged || endpointChanged || catalogChanged ? p.models.map(m => {
        if (!apiChanged && !endpointChanged) {
          const next = { ...m, catalogMetadata: undefined, capabilitySources: { ...m.capabilitySources } };
          for (const field of ['contextWindow', 'maxTokens', 'vision'] as const) {
            if (m.capabilitySources?.[field] !== 'catalog') continue;
            Object.assign(next, { [field]: field === 'contextWindow' ? 128000 : field === 'maxTokens' ? 16384 : false });
            next.capabilitySources[field] = 'default';
          }
          if (m.capabilitySources?.vision === 'catalog') { next.declaredInput = undefined; next.declaredOutput = undefined; }
          if (m.declaredThinkingSource === 'catalog') { next.declaredThinkingLevels = undefined; next.declaredThinkingSource = undefined; }
          if (m.thinkingControl?.source === 'catalog') {
            next.thinkingControl = undefined; next.thinkingLevels = undefined; next.reasoning = false; next.capabilitySources.thinking = 'default';
          }
          return next;
        }
        const next = { ...m, catalogMetadata: undefined, officialDocumentation: undefined, declaredThinkingLevels: undefined, declaredThinkingSource: undefined,
          declaredInput: undefined, declaredOutput: undefined, capabilitySources: { ...m.capabilitySources } };
        for (const field of ['contextWindow', 'maxTokens', 'vision'] as const) {
          if (['official', 'upstream', 'catalog'].includes(m.capabilitySources?.[field] ?? '')) {
            Object.assign(next, { [field]: field === 'contextWindow' ? 128000 : field === 'maxTokens' ? 16384 : false });
            next.capabilitySources[field] = 'default';
          }
        }
        if (apiChanged || m.thinkingControl?.source !== 'manual') {
          next.thinkingLevels = undefined; next.thinkingControl = undefined; next.reasoning = false;
          next.capabilitySources.thinking = 'default';
        }
        return next;
      }) : p.models;
      const next = { ...p, ...patch, models: patch.models ?? models };
      if (next.presetId && !providerPresetFor(next)) next.presetId = undefined;
      return next;
    }); setDirty(true); setSaved(false); setError('');
    setDiagnosticOpen(false); setDiagnostic(undefined); setCopied(false);
    setDiscovered(undefined); setSelected([]);
  };
  const updateModel = (index: number, patch: Partial<ProviderModel>) => update({ models: draft!.models.map((m, i) => {
    if (i !== index) return m;
    const next = { ...m, ...patch, metadataSource: 'manual' as const };
    if ('thinkingControl' in patch) next.capabilitySources = { ...next.capabilitySources, thinking: patch.thinkingControl?.source ?? 'default' };
    if (patch.id !== undefined && patch.id !== m.id) {
      next.officialDocumentation = undefined;
      next.catalogMetadata = undefined;
      next.declaredThinkingLevels = undefined; next.declaredThinkingSource = undefined;
      next.thinkingLevels = undefined; next.thinkingControl = undefined; next.reasoning = false;
      next.capabilitySources = { contextWindow: 'manual', maxTokens: 'manual', vision: 'manual', thinking: 'default' };
      if (m.capabilitySources?.contextWindow !== 'manual') { next.contextWindow = 128000; next.capabilitySources.contextWindow = 'default'; }
      if (m.capabilitySources?.maxTokens !== 'manual') { next.maxTokens = 16384; next.capabilitySources.maxTokens = 'default'; }
      if (m.capabilitySources?.vision !== 'manual') { next.vision = false; next.capabilitySources.vision = 'default'; }
      next.declaredInput = undefined; next.declaredOutput = undefined;
    }
    return next;
  }) });
  const discover = async () => {
    if (!draft || discovering) return;
    setDiscovering(true); setError(''); setDiscovered(undefined); setSelected([]); setFilter('');
    try { setDiscovered(await onDiscover(draft, key.trim() ? key : undefined)); }
    catch (error) { setError(providerDiscoveryError(error, language)); }
    finally { setDiscovering(false); }
  };
  const importModels = () => {
    if (!draft || !discovered) return;
    const chosen = discovered.filter(m => selected.includes(m.id));
    const added = chosen.filter(m => !draft.models.some(existing => existing.id === m.id));
    if (draft.models.length + added.length > 100) { setError(t('每个供应商最多配置 100 个模型，请减少选择。', 'Each provider supports up to 100 models. Select fewer models.')); return; }
    update({ models: [...draft.models.map(existing => {
      const found = chosen.find(m => m.id === existing.id);
      return found ? importProviderModel(found, existing) : existing;
    }), ...added.map(m => importProviderModel(m))] });
    setDiscovered(undefined); setSelected([]);
  };
  const save = async () => {
    if (!draft || blocked || keyError) return;
    setSaving(true); setError('');
    try {
      const next = await onSave(draft, key.trim() ? key : undefined);
      select(next.find(p => p.id === draft.id) ?? next.at(-1)!);
      setSaved(true);
    } catch {
      setError(t('保存失败。请检查地址、密钥、模型 ID 和容量；正在运行或有排队消息的会话需先结束。', 'Could not save. Check the address, key, model IDs and limits; finish running or queued tasks first.'));
    } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!draft?.id || blocked) return;
    setSaving(true); setError('');
    try { const next = await onDelete(draft.id); select(next[0] ?? blank()); }
    catch { setError(t('移除失败，请先结束运行中的任务和排队消息。', 'Could not remove. Finish running and queued tasks first.')); }
    finally { setSaving(false); }
  };
  return <section className="provider-settings">
    <div className="provider-heading"><h3>{t('自定义供应商', 'Custom providers')}</h3>
      <button type="button" ref={addAnchor} disabled={blocked || picker} onClick={choosePicker}><Plus size={15}/>{t('添加供应商', 'Add provider')}</button></div>
    <div className="provider-workbench">
      <nav className="provider-list" aria-label={t('供应商列表', 'Provider list')}>
        {providers.map(p => {
          const connection = providerPresetFor(p);
          return <button type="button" key={p.id} disabled={blocked} aria-pressed={!picker && draft?.id === p.id}
            className={!picker && draft?.id === p.id ? 'selected' : ''} onClick={() => choose(p)}>
            <ProviderPresetMark brand={providerBrandFor(p)} size={15}/><span className="provider-list-identity" title={p.name}>{p.name}
              {connection && <small>{billingLabel(connection.billing)}</small>}</span><i className={p.enabled ? 'enabled' : ''} title={p.enabled ? t('已启用', 'Enabled') : t('已停用', 'Disabled')}/></button>;
        })}
        {!picker && draft?.id === '' && <button type="button" className="selected" aria-pressed="true"><ProviderPresetMark brand={preset?.brand} size={15}/><span>{draft.name || t('新供应商', 'New provider')}</span></button>}
      </nav>
      {picker ? <ProviderPresetPicker language={language} returnBrand={returnBrand} onBack={closePicker} onSelect={selectPreset} onCustom={() => selectPreset(blank())}/>
      : !draft ? <div className="provider-empty"><Box size={26}/><span>{t('暂无自定义供应商', 'No custom providers')}</span>
        <button type="button" onClick={openPicker}><Plus size={15}/>{t('添加供应商', 'Add provider')}</button></div>
      : <form className="provider-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={saving || discovering || testing}>
          <div className="provider-editor-top">{!draft.id && <button type="button" className="provider-icon" title={t('返回供应商预设', 'Back to provider presets')} aria-label={t('返回供应商预设', 'Back to provider presets')} onClick={choosePicker}><ArrowLeft size={16}/></button>}
            <ProviderPresetMark brand={providerBrandFor(draft)} size={17}/><input ref={editorName} className="provider-name" aria-label={t('名称', 'Name')} title={t('名称', 'Name')} required maxLength={100} value={draft.name} placeholder={t('新供应商', 'New provider')} onChange={e => update({ name: e.target.value })}/>
            {preset && <small className="provider-preset-kind">{billingLabel(preset.billing)}</small>}
            <button type="button" role="switch" aria-checked={draft.enabled} aria-label={t('启用供应商', 'Enable provider')}
              className={`provider-switch${draft.enabled ? ' on' : ''}`} onClick={() => update({ enabled: !draft.enabled })}><span/></button>
            {draft.id && <button type="button" className="provider-icon" title={t('移除供应商', 'Remove provider')} aria-label={t('移除供应商', 'Remove provider')} disabled={blocked} onClick={() => setConfirmation('delete')}><Trash2 size={15}/></button>}
          </div>
          <label>Base URL<input required type="url" readOnly={fixedPlanRoute} maxLength={2048} value={draft.baseUrl} placeholder="https://api.example.com/v1" onChange={e => update({ baseUrl: e.target.value })}/></label>
          <div className="provider-format"><span id="provider-api-label">{t('API 格式', 'API format')}</span>
            <button type="button" className="form-focus-trigger" ref={anchor} disabled={fixedPlanRoute} aria-labelledby="provider-api-label provider-api-value" aria-haspopup="menu" aria-expanded={menu}
              onClick={() => setMenu(v => !v)}><span id="provider-api-value">{preset?.brand === 'anthropic' ? 'Anthropic Messages · /v1/messages' : formats.find(f => f.id === draft.api)?.label}</span><DisclosureChevron/></button>
            <AppMenu anchor={anchor} open={menu} label={t('API 格式', 'API format')} items={formats} selected={draft.api}
              onSelect={id => update({ api: id as ProviderApi })} onClose={closeMenu}/>
          </div>
          <div className="provider-format"><span id="provider-catalog-label">{t('公共模型目录', 'Public model catalog')}</span>
            <button type="button" className="form-focus-trigger" ref={catalogAnchor} aria-labelledby="provider-catalog-label provider-catalog-value" aria-haspopup="menu" aria-expanded={catalogMenu}
              onClick={() => setCatalogMenu(value => !value)}><span id="provider-catalog-value">{draft.catalogProvider === 'none' ? t('不使用', 'Disabled') : catalogProviders.find(p => p.id === draft.catalogProvider)?.label ?? t('自动匹配官方地址', 'Auto: official endpoints')}</span><DisclosureChevron/></button>
            <AppMenu anchor={catalogAnchor} open={catalogMenu} label={t('公共模型目录', 'Public model catalog')} selected={draft.catalogProvider ?? 'auto'}
              items={[{ id: 'auto', label: t('自动匹配官方地址', 'Auto: official endpoints') }, { id: 'none', label: t('不使用', 'Disabled') }, ...catalogProviders.map(({ id, label }) => ({ id, label }))]}
              onSelect={id => update({ catalogProvider: id === 'auto' ? undefined : id as CatalogSelection })} onClose={closeCatalogMenu}/>
          </div>
          <label>{fixedPlanRoute ? t('套餐 API Key', 'Subscription API Key') : 'API Key'}<div className="provider-key"><input aria-label={fixedPlanRoute ? t('套餐 API Key', 'Subscription API Key') : 'API Key'} aria-invalid={keyError ? true : undefined}
            aria-describedby={keyError ? 'provider-key-error' : undefined} type={showKey ? 'text' : 'password'} autoComplete="off" maxLength={8192}
            disabled={draft.keyless} value={key} placeholder={hasStoredKey ? t('已加密保存 · 留空保留', 'Saved securely · Leave blank to keep') : t('输入 API Key', 'Enter API key')}
            onChange={e => { setKey(e.target.value); setDirty(true); setSaved(false); setDiagnostic(undefined); setDiagnosticOpen(false); }}/>
            <button type="button" className="provider-icon" title={showKey ? t('隐藏密钥', 'Hide key') : t('显示密钥', 'Show key')} aria-label={showKey ? t('隐藏密钥', 'Hide key') : t('显示密钥', 'Show key')} onClick={() => setShowKey(v => !v)}>{showKey ? <EyeOff size={15}/> : <Eye size={15}/>}</button></div></label>
          {keyError && <p id="provider-key-error" className="provider-capability-note" role="status">{keyError}</p>}
          {preset?.interactiveOnly && <p className="provider-capability-note">{t('仅限交互式编程，不用于 Cron 或其他后台任务。', 'Interactive coding only. Do not use for Cron or other background tasks.')}</p>}
          {(!providerRequiresOfficialKey(draft) || draft.keyless) && <label className="provider-checkbox"><input type="checkbox" checked={draft.keyless} onChange={e => update({ keyless: e.target.checked })}/>{t('无需密钥（本地服务）', 'No key required (local server)')}</label>}
          <div className="provider-model-heading"><h4>{t('模型列表', 'Models')}</h4>
            {preset?.listFromEndpoint !== false && <button type="button" disabled={!draft.baseUrl.trim() || needsKey} onClick={() => void discover()}>{discovering ? <LoaderCircle size={14} className="provider-discovery-spinner"/> : <Download size={14}/>} {discovering ? t('获取中…', 'Fetching…') : t('从上游获取', 'Fetch models')}</button>}
            {!!preset?.recommendations?.length && <>
              <button type="button" ref={recommendationAnchor} disabled={!recommendations.length || draft.models.length >= 100} aria-haspopup="menu" aria-expanded={recommendationMenu} onClick={() => setRecommendationMenu(value => !value)}>
                {t('推荐模型', 'Suggested models')}<DisclosureChevron/>
              </button>
              <AppMenu anchor={recommendationAnchor} open={recommendationMenu} label={t('推荐模型', 'Suggested models')}
                items={recommendations.map(id => ({ id, label: id }))} onClose={closeRecommendationMenu}
                onSelect={id => update({ models: [...draft.models, importProviderModel({ id, name: id })] })}/>
            </>}
            <button type="button" disabled={draft.models.length >= 100} onClick={() => update({ models: [...draft.models, model()] })}><Plus size={14}/>{t('添加模型', 'Add model')}</button>
          </div>
          {preset?.id === 'kimi-code-cn' && <p className="provider-capability-note">{t('可用模型取决于 Kimi Code 会员档位。', 'Model access depends on your Kimi Code membership tier.')}</p>}
          {discovered && <section className="provider-discovery" aria-label={t('上游模型', 'Available models')}>
            <div className="provider-discovery-top"><span>{t('上游模型', 'Available models')} · {discovered.length}</span><button type="button" className="provider-icon" aria-label={t('关闭模型列表', 'Close model list')} onClick={() => setDiscovered(undefined)}><X size={14}/></button></div>
            {discovered.some(m => m.catalogMatch === 'unavailable') && <p role="status" className="provider-capability-note">{t('公共目录暂不可用，仅显示上游结果。', 'Public catalog unavailable. Showing provider results only.')}</p>}
            <input aria-label={t('搜索模型', 'Search models')} placeholder={t('搜索模型 ID', 'Search model ID')} value={filter} onChange={e => setFilter(e.target.value)}/>
            <div className="provider-discovery-list">
              {discovered.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(filter.toLowerCase())).map(m => {
                const exists = draft.models.some(existing => existing.id === m.id);
                return <label className="provider-checkbox" key={m.id}><input type="checkbox" checked={selected.includes(m.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))}/><span>{m.id}{m.thinkingLevels && <small className="provider-discovered-capabilities">{t('思考', 'Thinking')}: {m.thinkingLevels.join(' · ')}{m.thinkingDefaultLevel && ` · ${t('默认', 'Default')} ${m.thinkingDefaultLevel}`}</small>}{m.catalogMetadata && <small className="provider-discovered-capabilities">models.dev · {m.catalogMetadata.provider} · {m.catalogMetadata.stale ? t('缓存', 'Cached') : t('精确匹配', 'Exact match')}</small>}{m.declaredInput && <small className="provider-discovered-capabilities">{m.declaredInput.join(' · ')}</small>}</span>{exists && <small>{t('已添加 · 可更新', 'Added · Refreshable')}</small>}</label>;
              })}
              {!discovered.length && <span>{t('上游未返回模型', 'No models returned')}</span>}
            </div>
            <div className="provider-discovery-bottom"><span>{t('已有模型可更新声明，手动思考配置保留', 'Refresh declarations; manual thinking overrides are preserved')}</span><button type="button" disabled={!selected.length} onClick={importModels}><Plus size={14}/>{selected.some(id => draft.models.some(m => m.id === id)) ? t('应用', 'Apply') : t('加入', 'Add')} {selected.length || ''}</button></div>
          </section>}
          {!draft.models.length && <div className="provider-model-empty">{t('尚未添加模型', 'No models added')}</div>}
          {draft.models.map((m, index) => <div className="provider-model" key={index}>
            <div className="provider-model-fields">
              <label>{t('模型 ID', 'Model ID')}<input aria-label={`${t('模型 ID', 'Model ID')} ${index + 1}`} required maxLength={300} value={m.id}
                placeholder={preset?.brand === 'ark' ? t('模型 ID 或接入点 ID（ep-…）', 'Model ID or endpoint ID (ep-…)') : 'model-id'} onChange={e => updateModel(index, { id: e.target.value })}/></label>
              <label>{t('显示名', 'Display name')}<input aria-label={`${t('显示名', 'Display name')} ${index + 1}`} maxLength={200} value={m.name} placeholder={m.id || t('可选', 'Optional')} onChange={e => updateModel(index, { name: e.target.value })}/></label>
              <button type="button" className="provider-icon" title={t('移除模型', 'Remove model')} aria-label={`${t('移除模型', 'Remove model')} ${index + 1}`} onClick={() => update({ models: draft.models.filter((_, i) => i !== index) })}><X size={14}/></button>
            </div>
            {officialModelCapabilities(draft.baseUrl, draft.api, m.id) && <div className="provider-official">
              <button type="button" onClick={() => {
                const official = officialModelCapabilities(draft.baseUrl, draft.api, m.id)!;
                update({ models: draft.models.map((item, i) => i === index ? importProviderModel(official, item) : item) });
              }}><Download size={13}/>{t('更新官方资料', 'Update official metadata')}</button>
              {m.officialDocumentation && <a href={m.officialDocumentation.url} target="_blank" rel="noreferrer">{t('官方资料', 'Official documentation')} · {m.officialDocumentation.verifiedAt}</a>}
            </div>}
            {officialResponsesRequired(draft.baseUrl, draft.api, m.id) && <p className="provider-error">{t('此模型的工具调用需要 Responses API，请切换 API 格式。', 'Tool use with this model requires Responses API. Change the API format.')}</p>}
            <details className="provider-model-advanced"><summary><DisclosureChevron/>{t('能力与容量', 'Capabilities and limits')}<span className={`provider-thinking-summary${m.thinkingControl?.source === 'manual' && m.thinkingLevels?.length ? ' provider-thinking-manual' : ''}`}>{thinkingSummary(m, language, draft.api)}</span></summary>
            <div className="provider-model-limits">
              <label>{t('上下文容量', 'Context window')}<input aria-label={`${t('上下文容量', 'Context window')} ${index + 1}`} type="number" min={1} max={10000000}
                placeholder={`${t('未知，暂用', 'Unknown; fallback')} ${m.contextWindow}`} value={m.capabilitySources?.contextWindow === 'default' ? '' : m.contextWindow || ''}
                onChange={e => updateModel(index, { contextWindow: e.target.value ? Number(e.target.value) : 128000, capabilitySources: { ...m.capabilitySources, contextWindow: e.target.value ? 'manual' : 'default' } })}/>
                <small className="provider-source">{capabilitySource(m, 'contextWindow', language)}</small></label>
              <label>{t('最大输出', 'Max output')}<input aria-label={`${t('最大输出', 'Max output')} ${index + 1}`} type="number" min={1} max={m.contextWindow}
                placeholder={`${t('未知，暂用', 'Unknown; fallback')} ${m.maxTokens}`} value={m.capabilitySources?.maxTokens === 'default' ? '' : m.maxTokens || ''}
                onChange={e => updateModel(index, { maxTokens: e.target.value ? Number(e.target.value) : Math.min(16384, m.contextWindow), capabilitySources: { ...m.capabilitySources, maxTokens: e.target.value ? 'manual' : 'default' } })}/>
                <small className="provider-source">{capabilitySource(m, 'maxTokens', language)}</small></label>
            </div>
            <div className="provider-model-capabilities">
              <label className="provider-checkbox"><input type="checkbox" checked={m.vision} onChange={e => updateModel(index, { vision: e.target.checked, capabilitySources: { ...m.capabilitySources, vision: 'manual' }, declaredInput: e.target.checked ? [...new Set([...(m.declaredInput ?? ['text']), 'image'])] : m.declaredInput?.filter(v => v !== 'image') ?? ['text'] })}/>{t('图片输入', 'Image input')}<small className="provider-source">{capabilitySource(m, 'vision', language)}</small></label>
            </div>
            <ProviderThinkingSettings model={m} api={draft.api} baseUrl={draft.baseUrl} index={index} language={language} onChange={patch => updateModel(index, patch)}/>
            {(m.declaredInput || m.declaredOutput) && <p className="provider-capability-note">{t('输入与输出资料', 'Input and output metadata')}: {m.declaredInput?.join(' / ') ?? '—'} → {m.declaredOutput?.join(' / ') ?? '—'}{[...(m.declaredInput ?? []), ...(m.declaredOutput ?? [])].some(v => !['text', 'image'].includes(v)) && <span>{t(' · 音频、视频和文件模态暂不接入', ' · Audio, video and file modalities are not supported')}</span>}{m.declaredOutput?.includes('image') && <span>{t(' · 暂不支持图片生成', ' · Image generation is not supported')}</span>}</p>}
            {m.catalogMetadata && <p className="provider-capability-note">models.dev · {m.catalogMetadata.provider}/{m.catalogMetadata.modelId} · {m.catalogMetadata.retrievedAt.slice(0, 10)} · {m.catalogMetadata.stale ? t('缓存资料 · 接口未验证', 'Cached metadata · Endpoint unverified') : t('目录资料 · 接口未验证', 'Catalog metadata · Endpoint unverified')}</p>}
            </details>
          </div>)}
          {confirmation && <div className="provider-confirm" role="alert">
            <span>{confirmation === 'delete' ? t('移除此供应商及其密钥？会话历史不会删除。', 'Remove this provider and its key? History is retained.') : t('放弃未保存的修改？', 'Discard unsaved changes?')}</span>
            <button type="button" onClick={() => setConfirmation(undefined)}>{t('取消', 'Cancel')}</button>
            <button type="button" className={confirmation === 'delete' ? 'provider-danger' : ''} disabled={blocked} onClick={() => confirmation === 'delete' ? void remove() : confirmation === 'picker' ? openPicker() : select(confirmation)}>{confirmation === 'delete' ? t('移除', 'Remove') : t('放弃', 'Discard')}</button>
          </div>}
          {error && <p className="provider-error" role="alert">{error}</p>}
        </fieldset>
          <div className={`provider-test-reveal${diagnosticOpen ? ' open' : ''}`} inert={!diagnosticOpen} aria-hidden={!diagnosticOpen}>
            <section className="provider-test-result" aria-label={t('连接诊断', 'Connection diagnostic')}>
              <div className="provider-test-top">
                <span role="status" className={diagnostic?.ok ? 'success' : diagnostic && diagnostic.outcome !== 'cancelled' ? 'failure' : ''}>
                  <SubagentStatusIcon language={language === 'zh' ? 'zh' : 'en'} detail={testing ? t('正在等待模型回复…', 'Waiting for a model reply…') : diagnostic ? diagnosticMessages[diagnostic.outcome] : t('尚未发起连接测试。', 'No connection test has been started.')}
                    state={testing ? 'running' : diagnostic?.ok ? 'done' : diagnostic?.outcome === 'cancelled' ? 'stopped' : diagnostic ? 'failed' : 'pending'}/>
                  {testing ? t('正在等待模型回复…', 'Waiting for a model reply…') : diagnostic ? diagnosticMessages[diagnostic.outcome] : t('待测试', 'Ready to test')}
                </span>
                <button type="button" className="provider-icon" aria-label={testing ? t('取消测试', 'Cancel test') : t('收起诊断', 'Close diagnostic')} onClick={() => {
                  if (testing) void onCancelTest().catch(() => {});
                  else setDiagnosticOpen(false);
                }}><X size={15}/></button>
              </div>
              <div className="provider-test-meta">
                <button type="button" ref={testAnchor} disabled={testing} aria-label={t('测试模型', 'Test model')} aria-haspopup="menu" aria-expanded={testMenu} onClick={() => setTestMenu(v => !v)}><span>{modelId}</span><DisclosureChevron/></button>
                <AppMenu anchor={testAnchor} open={testMenu} label={t('测试模型', 'Test model')} items={draft.models.filter(m => m.id.trim()).map(m => ({ id: m.id, label: m.name || m.id }))} selected={modelId}
                  onSelect={id => { setTestModel(id); setDiagnostic(undefined); setCopied(false); }} onClose={closeTestMenu}/>
                {diagnostic && <small>{diagnostic.status ? `HTTP ${diagnostic.status} · ` : ''}{(diagnostic.elapsedMs / 1000).toFixed(1)}s</small>}
              </div>
              {diagnostic && <details className="provider-test-details"><summary><DisclosureChevron/>{t('诊断详情', 'Diagnostic details')}</summary><div>
                <dl><div><dt>{t('协议', 'Protocol')}</dt><dd>{diagnostic.api}</dd></div><div><dt>{t('地址', 'Endpoint')}</dt><dd>{diagnostic.endpoint || t('未发起请求', 'No request sent')}</dd></div><div><dt>{t('验证范围', 'Scope')}</dt><dd>{t('基础非流式文本请求；不验证工具、图片和思考档位', 'Basic non-streaming text request; excludes tools, images and reasoning levels')}</dd></div></dl>
                <button type="button" onClick={() => void copyDiagnostic()}><Copy size={13}/>{copyFailed ? t('复制失败', 'Copy failed') : copied ? t('已复制', 'Copied') : t('复制诊断', 'Copy diagnostic')}</button>
              </div></details>}
              <small className="provider-test-cost">{t('发送短请求，可能产生少量费用；不进入会话历史', 'Sends a short request; charges may apply. Not added to chat history.')}</small>
            </section>
          </div>
          <div className="provider-save"><span role="status">{dirty ? t('未保存', 'Unsaved') : pending ? t('已保存，待任务空闲后应用', 'Saved; applies when tasks are idle') : saved ? <><Check size={14}/>{t('已保存', 'Saved')}</> : ''}</span>
            <button type="button" className="provider-test-trigger" title={t('发送短请求，可能产生少量费用', 'Sends a short request; charges may apply')} disabled={blocked || !draft.baseUrl.trim() || !modelId.trim() || needsKey || Boolean(keyError)} onClick={() => void runTest()}><Stethoscope size={14}/>{testing ? t('测试中…', 'Testing…') : t('测试连接', 'Test connection')}</button>
            <button type="submit" className="primary" disabled={blocked || !dirty || !draft.models.length || needsKey || Boolean(keyError)}><Save size={14}/>{saving ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button></div>
      </form>}
    </div>
  </section>;
}
