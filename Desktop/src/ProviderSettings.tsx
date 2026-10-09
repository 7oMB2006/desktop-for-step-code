import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Plus, Trash2, Eye, EyeOff, Save, Check, X, Download, LoaderCircle, Stethoscope, Copy } from 'lucide-react';
import type { CustomProvider, ProviderInfo, ProviderModel, ProviderApi, DiscoveredProviderModel, ProviderDiagnostic, Model } from './contracts';
import { AppMenu } from './AppMenu';
import { DisclosureChevron } from './DisclosureChevron';
import { SubagentStatusIcon } from './SubagentStatusIcon';
import './provider-settings.css';

const formats: { id: ProviderApi; label: string }[] = [
  { id: 'openai-completions', label: 'Chat Completions · /chat/completions' },
  { id: 'openai-responses', label: 'Responses · /responses' },
  { id: 'anthropic-messages', label: 'Anthropic Messages · /messages' },
];
const blank = (): ProviderInfo => ({ id: '', name: '', baseUrl: '', api: 'openai-completions', enabled: true, keyless: false, hasKey: false, models: [] });
const model = (): ProviderModel => ({ id: '', name: '', reasoning: false, vision: false, contextWindow: 128000, maxTokens: 16384 });
export function ProviderSettings({ providers, language, busy, onSave, onDelete, onDiscover, onTest, onCancelTest, onCopyDiagnostic, activeModel }: {
  providers: ProviderInfo[]; language: string; busy: boolean;
  onSave: (provider: CustomProvider, key?: string) => Promise<ProviderInfo[]>;
  onDelete: (id: string) => Promise<ProviderInfo[]>;
  onDiscover: (provider: CustomProvider, key?: string) => Promise<DiscoveredProviderModel[]>;
  onTest: (provider: CustomProvider, modelId: string, key?: string) => Promise<ProviderDiagnostic>;
  onCancelTest: () => Promise<void>;
  onCopyDiagnostic: (text: string) => Promise<void>;
  activeModel?: Model;
}) {
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  const [draft, setDraft] = useState<ProviderInfo | undefined>(() => providers[0]);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState<'delete' | ProviderInfo>();
  const [menu, setMenu] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredProviderModel[] | undefined>();
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
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
  const blocked = busy || saving || discovering || testing;
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
  const select = (p: ProviderInfo) => {
    setDraft(p); setKey(''); setShowKey(false); setDirty(false); setError(''); setSaved(false); setConfirmation(undefined); setDiscovered(undefined); setSelected([]); setFilter('');
    setDiagnosticOpen(false); setDiagnostic(undefined); setTestModel(''); setTestMenu(false); setCopied(false); setCopyFailed(false);
  };
  const choose = (p: ProviderInfo) => {
    if (dirty) setConfirmation(p); else select(p);
  };
  const update = (patch: Partial<ProviderInfo>) => {
    setDraft(p => p ? { ...p, ...patch } : p); setDirty(true); setSaved(false); setError('');
    setDiagnosticOpen(false); setDiagnostic(undefined); setCopied(false);
  };
  const updateModel = (index: number, patch: Partial<ProviderModel>) => update({ models: draft!.models.map((m, i) => i === index ? { ...m, ...patch, metadataSource: 'manual' } : m) });
  const discover = async () => {
    if (!draft || discovering) return;
    setDiscovering(true); setError(''); setDiscovered(undefined); setSelected([]); setFilter('');
    try { setDiscovered(await onDiscover(draft, key.trim() ? key : undefined)); }
    catch { setError(t('无法获取模型。请检查地址和密钥；供应商可能不支持 /models 接口，可继续手动添加。', 'Could not retrieve models. Check the address and key; this provider may not support /models. You can still add models manually.')); }
    finally { setDiscovering(false); }
  };
  const importModels = () => {
    if (!draft || !discovered) return;
    const added = discovered.filter(m => selected.includes(m.id) && !draft.models.some(existing => existing.id === m.id));
    if (draft.models.length + added.length > 100) { setError(t('每个供应商最多配置 100 个模型，请减少选择。', 'Each provider supports up to 100 models. Select fewer models.')); return; }
    update({ models: [...draft.models, ...added.map(m => {
      const initial = { ...model(), ...m };
      initial.maxTokens = Math.min(initial.maxTokens, initial.contextWindow);
      return { ...initial, metadataSource: Object.keys(m).length > 2 ? 'upstream' as const : 'manual' as const };
    })] });
    setDiscovered(undefined); setSelected([]);
  };
  const save = async () => {
    if (!draft || blocked) return;
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
      <button type="button" disabled={saving || discovering || testing} onClick={() => choose(blank())}><Plus size={15}/>{t('添加供应商', 'Add provider')}</button></div>
    <div className="provider-workbench">
      <nav className="provider-list" aria-label={t('供应商列表', 'Provider list')}>
        {providers.map(p => <button type="button" key={p.id} disabled={saving || discovering || testing} aria-pressed={draft?.id === p.id}
          className={draft?.id === p.id ? 'selected' : ''} onClick={() => choose(p)}>
          <Box size={15}/><span>{p.name}</span><i className={p.enabled ? 'enabled' : ''} title={p.enabled ? t('已启用', 'Enabled') : t('已停用', 'Disabled')}/></button>)}
        {draft?.id === '' && <button type="button" className="selected" aria-pressed="true"><Box size={15}/><span>{draft.name || t('新供应商', 'New provider')}</span></button>}
      </nav>
      {!draft ? <div className="provider-empty"><Box size={26}/><span>{t('暂无自定义供应商', 'No custom providers')}</span>
        <button onClick={() => select(blank())}><Plus size={15}/>{t('添加供应商', 'Add provider')}</button></div>
      : <form className="provider-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={saving || discovering || testing}>
          <div className="provider-editor-top"><Box size={17}/><input className="provider-name" aria-label={t('名称', 'Name')} title={t('名称', 'Name')} required maxLength={100} value={draft.name} placeholder={t('新供应商', 'New provider')} onChange={e => update({ name: e.target.value })}/>
            <button type="button" role="switch" aria-checked={draft.enabled} aria-label={t('启用供应商', 'Enable provider')}
              className={`provider-switch${draft.enabled ? ' on' : ''}`} onClick={() => update({ enabled: !draft.enabled })}><span/></button>
            {draft.id && <button type="button" className="provider-icon" title={t('移除供应商', 'Remove provider')} aria-label={t('移除供应商', 'Remove provider')} disabled={blocked} onClick={() => setConfirmation('delete')}><Trash2 size={15}/></button>}
          </div>
          <label>Base URL<input required type="url" maxLength={2048} value={draft.baseUrl} placeholder="https://api.example.com/v1" onChange={e => update({ baseUrl: e.target.value })}/></label>
          <div className="provider-format"><span id="provider-api-label">{t('API 格式', 'API format')}</span>
            <button type="button" ref={anchor} aria-labelledby="provider-api-label provider-api-value" aria-haspopup="menu" aria-expanded={menu}
              onClick={() => setMenu(v => !v)}><span id="provider-api-value">{formats.find(f => f.id === draft.api)?.label}</span><DisclosureChevron/></button>
            <AppMenu anchor={anchor} open={menu} label={t('API 格式', 'API format')} items={formats} selected={draft.api}
              onSelect={id => update({ api: id as ProviderApi })} onClose={closeMenu}/>
          </div>
          <label>API Key<div className="provider-key"><input aria-label="API Key" type={showKey ? 'text' : 'password'} autoComplete="off" maxLength={8192}
            disabled={draft.keyless} value={key} placeholder={draft.hasKey ? t('已加密保存 · 留空保留', 'Saved securely · Leave blank to keep') : t('输入 API Key', 'Enter API key')}
            onChange={e => { setKey(e.target.value); setDirty(true); setSaved(false); setDiagnostic(undefined); setDiagnosticOpen(false); }}/>
            <button type="button" className="provider-icon" title={showKey ? t('隐藏密钥', 'Hide key') : t('显示密钥', 'Show key')} aria-label={showKey ? t('隐藏密钥', 'Hide key') : t('显示密钥', 'Show key')} onClick={() => setShowKey(v => !v)}>{showKey ? <EyeOff size={15}/> : <Eye size={15}/>}</button></div></label>
          <label className="provider-checkbox"><input type="checkbox" checked={draft.keyless} onChange={e => update({ keyless: e.target.checked })}/>{t('无需密钥（本地服务）', 'No key required (local server)')}</label>
          <div className="provider-model-heading"><h4>{t('模型列表', 'Models')}</h4><button type="button" disabled={!draft.baseUrl.trim() || (!draft.keyless && !draft.hasKey && !key.trim())} onClick={() => void discover()}>{discovering ? <LoaderCircle size={14} className="provider-discovery-spinner"/> : <Download size={14}/>} {discovering ? t('获取中…', 'Fetching…') : t('从上游获取', 'Fetch models')}</button><button type="button" disabled={draft.models.length >= 100} onClick={() => update({ models: [...draft.models, model()] })}><Plus size={14}/>{t('添加模型', 'Add model')}</button></div>
          {discovered && <section className="provider-discovery" aria-label={t('上游模型', 'Available models')}>
            <div className="provider-discovery-top"><span>{t('上游模型', 'Available models')} · {discovered.length}</span><button type="button" className="provider-icon" aria-label={t('关闭模型列表', 'Close model list')} onClick={() => setDiscovered(undefined)}><X size={14}/></button></div>
            <input aria-label={t('搜索模型', 'Search models')} placeholder={t('搜索模型 ID', 'Search model ID')} value={filter} onChange={e => setFilter(e.target.value)}/>
            <div className="provider-discovery-list">
              {discovered.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(filter.toLowerCase())).map(m => {
                const exists = draft.models.some(existing => existing.id === m.id);
                return <label className="provider-checkbox" key={m.id}><input type="checkbox" disabled={exists} checked={exists || selected.includes(m.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))}/><span>{m.id}{m.declaredInput && <small className="provider-discovered-capabilities">{m.declaredInput.join(' · ')}</small>}</span>{exists && <small>{t('已添加', 'Added')}</small>}</label>;
              })}
              {!discovered.length && <span>{t('上游未返回模型', 'No models returned')}</span>}
            </div>
            <div className="provider-discovery-bottom"><span>{t('能力与容量需确认', 'Review capabilities and limits')}</span><button type="button" disabled={!selected.length} onClick={importModels}><Plus size={14}/>{t('加入', 'Add')} {selected.length || ''}</button></div>
          </section>}
          {!draft.models.length && <div className="provider-model-empty">{t('尚未添加模型', 'No models added')}</div>}
          {draft.models.map((m, index) => <div className="provider-model" key={index}>
            <div className="provider-model-fields">
              <label>{t('模型 ID', 'Model ID')}<input aria-label={`${t('模型 ID', 'Model ID')} ${index + 1}`} required maxLength={300} value={m.id} placeholder="model-id" onChange={e => updateModel(index, { id: e.target.value })}/></label>
              <label>{t('显示名', 'Display name')}<input aria-label={`${t('显示名', 'Display name')} ${index + 1}`} maxLength={200} value={m.name} placeholder={m.id || t('可选', 'Optional')} onChange={e => updateModel(index, { name: e.target.value })}/></label>
              <button type="button" className="provider-icon" title={t('移除模型', 'Remove model')} aria-label={`${t('移除模型', 'Remove model')} ${index + 1}`} onClick={() => update({ models: draft.models.filter((_, i) => i !== index) })}><X size={14}/></button>
            </div>
            <details className="provider-model-advanced"><summary><DisclosureChevron/>{t('能力与容量', 'Capabilities and limits')}</summary>
            <div className="provider-model-limits">
              <label>{t('上下文容量', 'Context window')}<input aria-label={`${t('上下文容量', 'Context window')} ${index + 1}`} type="number" min={1} max={10000000} required value={m.contextWindow || ''} onChange={e => updateModel(index, { contextWindow: Number(e.target.value) })}/></label>
              <label>{t('最大输出', 'Max output')}<input aria-label={`${t('最大输出', 'Max output')} ${index + 1}`} type="number" min={1} max={m.contextWindow} required value={m.maxTokens || ''} onChange={e => updateModel(index, { maxTokens: Number(e.target.value) })}/></label>
            </div>
            <div className="provider-model-capabilities">
              <label className="provider-checkbox"><input type="checkbox" checked={m.reasoning} onChange={e => updateModel(index, { reasoning: e.target.checked, thinkingLevels: e.target.checked ? undefined : ['off'] })}/>{t('思考', 'Reasoning')}</label>
              <label className="provider-checkbox"><input type="checkbox" checked={m.vision} onChange={e => updateModel(index, { vision: e.target.checked, declaredInput: e.target.checked ? [...new Set([...(m.declaredInput ?? ['text']), 'image'])] : m.declaredInput?.filter(v => v !== 'image') ?? ['text'] })}/>{t('图片输入', 'Image input')}</label>
            </div>
            {m.reasoning && <div className="provider-thinking-levels" role="group" aria-label={`${t('支持档位', 'Supported levels')} ${index + 1}`}>
              <span>{t('支持档位', 'Supported levels')}</span>
              {['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level, levelIndex) => {
                const current = m.thinkingLevels ?? ['off', 'minimal', 'low', 'medium', 'high'];
                return <label className="provider-checkbox" key={level}><input type="checkbox" checked={current.includes(level)} onChange={e => {
                  const next = e.target.checked ? [...current, level] : current.filter(v => v !== level);
                  if (!next.length) return;
                  updateModel(index, { thinkingLevels: next, reasoning: next.some(v => v !== 'off') });
                }}/>{t(['关闭', '极简', '轻度', '中', '高', '极高', '最高'][levelIndex], level)}</label>;
              })}
            </div>}
            {(m.declaredInput || m.declaredOutput) && <p className="provider-capability-note">{t('上游声明', 'Declared modalities')}: {m.declaredInput?.join(' / ') ?? '—'} → {m.declaredOutput?.join(' / ') ?? '—'}{[...(m.declaredInput ?? []), ...(m.declaredOutput ?? [])].some(v => !['text', 'image'].includes(v)) && <span>{t(' · 音频、视频和文件模态暂不接入', ' · Audio, video and file modalities are not supported')}</span>}{m.declaredOutput?.includes('image') && <span>{t(' · 暂不支持图片生成', ' · Image generation is not supported')}</span>}</p>}
            </details>
          </div>)}
          {confirmation && <div className="provider-confirm" role="alert">
            <span>{confirmation === 'delete' ? t('移除此供应商及其密钥？会话历史不会删除。', 'Remove this provider and its key? History is retained.') : t('放弃未保存的修改？', 'Discard unsaved changes?')}</span>
            <button type="button" onClick={() => setConfirmation(undefined)}>{t('取消', 'Cancel')}</button>
            <button type="button" className={confirmation === 'delete' ? 'provider-danger' : ''} disabled={blocked} onClick={() => confirmation === 'delete' ? void remove() : select(confirmation)}>{confirmation === 'delete' ? t('移除', 'Remove') : t('放弃', 'Discard')}</button>
          </div>}
          {error && <p className="provider-error" role="alert">{error}</p>}
        </fieldset>
          <div className={`provider-test-reveal${diagnosticOpen ? ' open' : ''}`} inert={!diagnosticOpen} aria-hidden={!diagnosticOpen}>
            <section className="provider-test-result" aria-label={t('连接诊断', 'Connection diagnostic')}>
              <div className="provider-test-top">
                <span role="status" className={diagnostic?.ok ? 'success' : diagnostic && diagnostic.outcome !== 'cancelled' ? 'failure' : ''}>
                  <SubagentStatusIcon state={testing ? 'running' : diagnostic?.ok ? 'done' : diagnostic && diagnostic.outcome !== 'cancelled' ? 'failed' : 'pending'}/>
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
          <div className="provider-save"><span role="status">{saved ? <><Check size={14}/>{t('已保存', 'Saved')}</> : busy ? t('任务结束后可保存', 'Save when tasks finish') : dirty ? t('未保存', 'Unsaved') : ''}</span>
            <button type="button" className="provider-test-trigger" title={t('发送短请求，可能产生少量费用', 'Sends a short request; charges may apply')} disabled={saving || discovering || testing || !draft.baseUrl.trim() || !modelId.trim() || (!draft.keyless && !draft.hasKey && !key.trim())} onClick={() => void runTest()}><Stethoscope size={14}/>{testing ? t('测试中…', 'Testing…') : t('测试连接', 'Test connection')}</button>
            <button type="submit" className="primary" disabled={blocked || !dirty || !draft.models.length || (!draft.keyless && !draft.hasKey && !key.trim())}><Save size={14}/>{saving ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button></div>
      </form>}
    </div>
  </section>;
}
