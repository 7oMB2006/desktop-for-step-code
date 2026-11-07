import { useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { RotateCcw } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import { compactionModelKey, defaultCompactionConfiguration,
  type CompactionConfiguration, type CompactionSettings as SettingsValue, type CompactionSettingsUpdate } from './compaction-settings';
import type { DesktopBridge, Model } from './contracts';
import './compaction-settings.css';

const configuration = (value: CompactionConfiguration): CompactionConfiguration => ({
  triggerRatio: value.triggerRatio, tokenLimit: value.tokenLimit, modelTriggerRatios: { ...value.modelTriggerRatios },
});
const equal = (a: CompactionConfiguration, b: CompactionConfiguration) => a.triggerRatio === b.triggerRatio
  && a.tokenLimit === b.tokenLimit && Object.keys(a.modelTriggerRatios).length === Object.keys(b.modelTriggerRatios).length
  && Object.entries(a.modelTriggerRatios).every(([key, value]) => b.modelTriggerRatios[key] === value);
const percent = (ratio: number) => Number((ratio * 100).toFixed(6));

function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="appearance-select"><select {...props}/><DisclosureChevron/></span>;
}

function AdvancedSettings({ label, children }: { label: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const disclosure = useAnimatedDisclosure(expanded);
  return <details className="compaction-advanced" ref={disclosure.details}>
    <summary aria-expanded={expanded} onClick={event => { event.preventDefault(); setExpanded(current => !current); }}>
      <span>{label}</span><DisclosureChevron/>
    </summary>
    <div ref={disclosure.body} inert={!expanded}><div className="compaction-advanced-content">{children}</div></div>
  </details>;
}

function NumberField({ value, min, max, label, integer = false, onCommit }: {
  value: number; min: number; max: number; label: string; integer?: boolean; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const parsed = draft.trim() ? Number(draft) : NaN;
    const bounded = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
    const next = integer ? Math.round(bounded) : bounded;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return <input type="number" aria-label={label} min={min} max={max} step={integer ? 1 : 'any'} value={draft}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { event.stopPropagation(); setDraft(String(value)); }
    }}/>;
}

export function CompactionSettings({ bridge, language, models, model }: {
  bridge: Pick<DesktopBridge, 'compactionSettings' | 'saveCompactionSettings'>;
  language: 'zh' | 'en'; models: Model[]; model?: Model;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [value, setValue] = useState<SettingsValue | null>(null);
  const [draft, setDraft] = useState<CompactionConfiguration>(defaultCompactionConfiguration);
  const draftRef = useRef(draft);
  const confirmed = useRef(value);
  const saving = useRef(false);
  const retryUseRatioPolicy = useRef(false);
  const focusAfterSave = useRef<HTMLElement | null>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [shownModels, setShownModels] = useState<string[]>([]);
  useEffect(() => {
    if (busy) return;
    const control = focusAfterSave.current;
    focusAfterSave.current = null;
    if (control?.isConnected && !control.matches(':disabled') && document.activeElement === document.body)
      control.focus({ preventScroll: true });
  }, [busy]);
  const stage = (next: CompactionConfiguration) => { draftRef.current = next; setDraft(next); };
  const install = (next: SettingsValue) => {
    retryUseRatioPolicy.current = false;
    confirmed.current = next; setValue(next); stage(configuration(next));
    setShownModels(current => [...new Set([...current, ...Object.keys(next.modelTriggerRatios)])]);
  };
  const load = async () => {
    const request = ++generation.current;
    setBusy(true); setError(''); setSaved(false);
    try { const next = await bridge.compactionSettings(); if (alive.current && generation.current === request) install(next); }
    catch { if (alive.current && generation.current === request) setError('load'); }
    finally { if (alive.current && generation.current === request) setBusy(false); }
  };
  useEffect(() => {
    alive.current = true; void load();
    return () => { alive.current = false; generation.current++; };
  }, [bridge]);
  const persist = async (next: CompactionConfiguration, useRatioPolicy = false) => {
    const current = confirmed.current;
    if (!current || saving.current) return;
    retryUseRatioPolicy.current = useRatioPolicy;
    if (!useRatioPolicy && !current.invalidConfiguration && equal(next, current)) {
      stage(next); setError(''); setSaved(false);
      return;
    }
    const request = generation.current;
    const focused = document.activeElement;
    focusAfterSave.current = focused instanceof HTMLElement && focused.closest('.compaction-fields') ? focused : null;
    stage(next); saving.current = true; setBusy(true); setError(''); setSaved(false);
    const update: CompactionSettingsUpdate = { revision: current.revision, configuration: next,
      ...(useRatioPolicy ? { useRatioPolicy: true } : {}) };
    try {
      const result = await bridge.saveCompactionSettings(update);
      if (alive.current && generation.current === request) { install(result); setSaved(true); }
    } catch (failure) {
      if (alive.current && generation.current === request)
        setError(failure instanceof Error && failure.message.includes('compaction:conflict') ? 'conflict' : 'save');
    } finally {
      saving.current = false;
      if (alive.current && generation.current === request) setBusy(false);
    }
  };
  const disabled = busy || value?.policy === 'legacy';
  const available = new Map(models.map(item => [compactionModelKey(item), item]));
  if (model) available.set(compactionModelKey(model), model);
  const keys = [...new Set([...(model ? [compactionModelKey(model)] : []), ...shownModels, ...Object.keys(draft.modelTriggerRatios)])];
  const chooseSource = (key: string, custom: boolean) => {
    const ratios = { ...draftRef.current.modelTriggerRatios };
    if (custom) ratios[key] = draftRef.current.triggerRatio;
    else delete ratios[key];
    void persist({ ...draftRef.current, modelTriggerRatios: ratios });
  };

  return <section className="compaction-settings" aria-labelledby="compaction-heading">
    <div className="appearance-heading">
      <h3 id="compaction-heading">{t('上下文整理', 'Context maintenance')}</h3>
      <button className="icon-button" disabled={!value || disabled} aria-label={t('恢复上下文整理默认值', 'Reset context maintenance')}
        data-tooltip={t('仅重置触发比例、Token 上限和模型覆盖', 'Reset the threshold, token limit and model overrides only')}
        onClick={() => void persist(defaultCompactionConfiguration())}><RotateCcw size={16}/></button>
    </div>
    {!value ? error ? <div className="compaction-feedback" role="alert">
      <span>{t('无法读取上下文整理配置。', 'Could not read context maintenance settings.')}</span>
      <button onClick={() => void load()} disabled={busy}>{t('重新读取', 'Reload settings')}</button>
    </div> : <div className="compaction-loading" aria-label={t('加载配置', 'Loading settings')} aria-busy="true"><div/><div/></div> : <>
      {value.policy === 'legacy' && <div className="compaction-feedback" role="status">
        <span>{t('当前使用旧版触发策略，比例设置尚不适用。', 'The legacy trigger policy is active; ratio settings do not apply yet.')}</span>
        <button disabled={busy} onClick={() => void persist(draftRef.current, true)}>{t('使用比例触发策略', 'Use ratio-based triggering')}</button>
      </div>}
      {!value.enabled && <p className="compaction-description">{t('自动整理当前已关闭。调整阈值不会将它启用。',
        'Automatic maintenance is disabled. Changing thresholds does not enable it.')}</p>}
      {value.invalidConfiguration && <p className="compaction-description">{t('原配置含无效阈值，以下显示回退值；保存时会修正这些阈值。',
        'Invalid thresholds are shown as fallback values and will be corrected on save.')}</p>}
      <fieldset disabled={disabled} className="compaction-fields" aria-label={t('上下文整理阈值', 'Context maintenance thresholds')}>
        <div className="compaction-ratio-heading">
          <label htmlFor="compaction-ratio">{t('自动整理触发比例', 'Automatic maintenance threshold')}</label>
          <span className="compaction-percent">
            <NumberField label={t('触发比例百分比', 'Threshold percentage')} value={percent(draft.triggerRatio)} min={50} max={95}
              onCommit={ratio => void persist({ ...draftRef.current, triggerRatio: ratio / 100 })}/><span aria-hidden="true">%</span>
          </span>
        </div>
        <p className="compaction-description" id="compaction-ratio-description">
          {t('默认 90%。实际触发点还受模型窗口与回复预留空间限制。',
            'Default: 90%. The actual trigger also depends on the model window and reply headroom.')}
        </p>
        <div className="compaction-slider">
          <input id="compaction-ratio" aria-describedby="compaction-ratio-description" type="range" min={50} max={95} step="any"
            aria-valuetext={`${percent(draft.triggerRatio)}%`} value={draft.triggerRatio * 100}
            style={{ '--compaction-fill': `calc(${(draft.triggerRatio - .5) / .45 * 100}% + ${7 - (draft.triggerRatio - .5) / .45 * 14}px)` } as React.CSSProperties}
            onChange={event => stage({ ...draftRef.current, triggerRatio: Math.round(Number(event.target.value)) / 100 })}
            onPointerUp={() => void persist(draftRef.current)} onPointerCancel={() => void persist(draftRef.current)}
            onBlur={() => void persist(draftRef.current)}
            onKeyDown={event => {
              const step = ['ArrowRight', 'ArrowUp'].includes(event.key) ? .01 : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -.01
                : event.key === 'PageUp' ? .05 : event.key === 'PageDown' ? -.05 : 0;
              if (!step && !['Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const ratio = event.key === 'Home' ? .5 : event.key === 'End' ? .95
                : Math.round((draftRef.current.triggerRatio + step) * 100) / 100;
              stage({ ...draftRef.current, triggerRatio: Math.max(.5, Math.min(.95, ratio)) });
            }}
            onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void persist(draftRef.current); }}/>
          <div className="compaction-scale" aria-hidden="true"><span>50%</span><span>95%</span></div>
        </div>
        <AdvancedSettings label={t('高级设置', 'Advanced settings')}>
              <div className="compaction-limit">
                <label className="checkbox"><input type="checkbox" checked={draft.tokenLimit !== null}
                  onChange={event => void persist({ ...draftRef.current, tokenLimit: event.target.checked ? 100000 : null })}/>
                  <span>{t('同时限制 Token 数量', 'Also limit token count')}</span>
                </label>
                {draft.tokenLimit !== null && <span className="compaction-token-field">
                  <NumberField label={t('全局 Token 上限', 'Global token limit')} value={draft.tokenLimit} min={1} max={Number.MAX_SAFE_INTEGER} integer
                    onCommit={tokenLimit => void persist({ ...draftRef.current, tokenLimit })}/><span>tokens</span>
                </span>}
              </div>
              <p className="compaction-description">{t('Token 上限适用于所有模型，与比例取先达到的一项。',
                'The token limit applies to every model. The earlier limit applies.')}</p>
              <div className="compaction-model-heading"><h4>{t('按模型设置', 'Per-model settings')}</h4>
                <span>{t('未自定义的模型继承全局比例', 'Other models inherit the global ratio')}</span>
              </div>
              <div className="compaction-model-list">
                {keys.map(key => {
                  const custom = Object.hasOwn(draft.modelTriggerRatios, key);
                  const identity = available.get(key);
                  const provider = identity?.provider ?? key.slice(0, key.indexOf('/'));
                  const id = identity?.id ?? key.slice(key.indexOf('/') + 1);
                  return <div className="compaction-model" key={key} data-model={key}>
                    <div className="compaction-model-row">
                      <div className="compaction-model-identity"><span className="compaction-model-name">{id}</span>
                        <span>{provider}{!identity && t(' · 当前不可用', ' · Currently unavailable')}</span></div>
                      <Select aria-label={t(`${key} 设置来源`, `${key} policy source`)} value={custom ? 'custom' : 'inherit'}
                        onChange={event => chooseSource(key, event.target.value === 'custom')}>
                        <option value="inherit">{t('继承全局', 'Inherit global')}</option><option value="custom">{t('自定义', 'Custom')}</option>
                      </Select>
                    </div>
                    {custom ? <label className="compaction-model-ratio">
                      <span>{t('触发比例', 'Threshold')}</span><span className="compaction-percent">
                        <NumberField label={t(`${key} 触发比例`, `${key} threshold`)} value={percent(draft.modelTriggerRatios[key])} min={50} max={95}
                          onCommit={ratio => void persist({ ...draftRef.current, modelTriggerRatios: { ...draftRef.current.modelTriggerRatios, [key]: ratio / 100 } })}/>
                        <span aria-hidden="true">%</span>
                      </span>
                    </label> : <p className="compaction-model-inherited">{percent(draft.triggerRatio)}%</p>}
                  </div>;
                })}
                {keys.length === 0 && <p className="compaction-description">{t('尚无单独配置的模型。', 'No model-specific settings.')}</p>}
              </div>
              {[...available.keys()].some(key => !keys.includes(key)) && <Select value="" aria-label={t('添加模型设置', 'Add model settings')}
                onChange={event => { const key = event.target.value; setShownModels(current => [...new Set([...current, key])]); }}>
                <option value="" disabled>{t('添加模型…', 'Add model…')}</option>
                {[...available].filter(([key]) => !keys.includes(key)).map(([key, item]) => <option key={key} value={key}>{item.id} · {item.provider}</option>)}
              </Select>}
        </AdvancedSettings>
      </fieldset>
      <p className="compaction-application">{t('全局配置在会话运行时下次启动时生效，已打开的会话需手动重启。项目配置可覆盖。',
        'Global settings apply when a session runtime next starts. Restart open sessions manually. Project settings may override them.')}</p>
      <div className="compaction-save-status" role={error ? 'alert' : 'status'} aria-live="polite">
        {busy ? saving.current ? t('正在保存…', 'Saving…') : t('正在读取…', 'Loading…') : error === 'conflict'
          ? t('配置已被其他操作更改。请重新读取后再修改。', 'Settings changed elsewhere. Reload before editing again.')
          : error === 'load' ? t('无法重新读取配置，当前修改仍保留。', 'Could not reload settings. Your changes are retained.')
          : error ? t('保存未确认，当前修改仍保留。', 'Save was not confirmed. Your changes are retained.')
          : saved ? t('已保存，现有会话未更改。', 'Saved. Existing sessions were not changed.') : ''}
        {error && <div className="compaction-retry-actions">
          {error === 'save' && <button disabled={busy} onClick={() => void persist(draftRef.current, retryUseRatioPolicy.current)}>{t('重试保存', 'Retry save')}</button>}
          <button disabled={busy} onClick={() => void load()}>{t('重新读取', 'Reload settings')}</button>
        </div>}
      </div>
    </>}
  </section>;
}
