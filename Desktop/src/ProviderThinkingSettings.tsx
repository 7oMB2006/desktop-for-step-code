import { Plus, X } from 'lucide-react';
import type { ProviderModel, ProviderApi } from './contracts';
import { effortLabel } from './ModelEffortPicker';
import { DisclosureChevron } from './DisclosureChevron';

const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export function thinkingSummary(model: ProviderModel, language: string, api?: ProviderApi): string {
  const zh = language !== 'en';
  if (!model.thinkingLevels?.length) return zh ? '思考控制未知 · 服务默认' : 'Unknown control · Service default';
  if (api === 'anthropic-messages' && model.thinkingControl?.adaptive !== true)
    return zh ? '控制方式待确认 · 服务默认' : 'Control mode unconfirmed · Service default';
  const source = model.thinkingControl?.source === 'upstream'
    ? zh ? '上游声明' : 'Provider declared'
    : zh ? '手动配置 · 未验证' : 'Manual · Unverified';
  return `${source} · ${model.thinkingLevels.length}${zh ? ' 档' : ' levels'}`;
}

export function ProviderThinkingSettings({ model, api, index, language, onChange }: {
  model: ProviderModel; api: ProviderApi; index: number; language: string; onChange: (patch: Partial<ProviderModel>) => void;
}) {
  const zh = language !== 'en';
  const t = (cn: string, en: string) => zh ? cn : en;
  const manual = model.thinkingControl?.source === 'manual' || Boolean(model.thinkingLevels?.length && !model.thinkingControl);
  const selected = model.thinkingLevels ?? [];
  const mapping = model.thinkingControl?.mapping ?? Object.fromEntries(selected.map(level => [level, level]));
  const apply = (next: string[], nextMapping: Record<string, string>) => onChange({
    reasoning: next.some(level => level !== 'off'), thinkingLevels: next.length ? levels.filter(level => next.includes(level)) : undefined,
    thinkingControl: next.length ? { source: 'manual', levels: levels.filter(level => next.includes(level)), ...(api === 'anthropic-messages' ? { adaptive: model.thinkingControl?.adaptive === true } : {}), mapping: Object.fromEntries(next.map(level => [level, nextMapping[level] ?? level])) } : undefined,
  });
  const reset = () => {
    const declared = model.declaredThinkingLevels;
    onChange({ thinkingLevels: declared, thinkingControl: declared ? { source: 'upstream', levels: declared } : undefined,
      reasoning: declared ? declared.some(level => level !== 'off') : model.reasoning });
  };
  return <section className="provider-thinking-control" aria-label={`${t('思考控制', 'Thinking control')} ${index + 1}`}>
    <div className="provider-thinking-heading"><strong>{t('思考控制', 'Thinking control')}</strong>
      <span className={manual ? 'provider-thinking-manual' : ''}>{thinkingSummary(model, language, api)}</span></div>
    {!manual && (selected.length ? <div className="provider-thinking-declared">{selected.map(level => <span key={level}>{effortLabel(level, zh ? 'zh' : 'en')} · {level}</span>)}</div>
      : <p className="provider-capability-note">{t('未提供可用的思考控制信息。不附加思考参数，使用服务默认。', 'No usable thinking control metadata. Use the service default without thinking parameters.')}</p>)}
    {!manual && model.thinkingControl?.defaultLevel && <p className="provider-capability-note">{t('接口声明默认强度', 'Declared default effort')}: {effortLabel(model.thinkingControl.defaultLevel, zh ? 'zh' : 'en')} · {model.thinkingControl.defaultLevel}</p>}
    <details className="provider-thinking-override" open={manual || undefined}>
      <summary><DisclosureChevron/>{t('自定义思考控制', 'Customize thinking control')}</summary>
      <div className="provider-thinking-edit">
        <p className="provider-capability-note provider-thinking-manual">{t('按供应商文档添加档位及发送值，尚未验证接口支持。', 'Add levels and request values from the provider documentation. Endpoint support is unverified.')}</p>
        {api === 'anthropic-messages' && <label className="provider-checkbox"><input type="checkbox" disabled={!selected.length} checked={model.thinkingControl?.adaptive === true}
          onChange={event => onChange({ thinkingControl: { source: 'manual', levels: selected, mapping, adaptive: event.target.checked } })}/>{t('接口支持 adaptive 思考与 effort 参数', 'Endpoint supports adaptive thinking and effort')}</label>}
        <span className="provider-capability-note">{t('请求字段', 'Request field')}: <code>{api === 'openai-completions' ? 'reasoning_effort' : api === 'openai-responses' ? 'reasoning.effort' : model.thinkingControl?.adaptive ? 'output_config.effort' : t('未启用', 'Inactive')}</code>
          {api === 'anthropic-messages' && !model.thinkingControl?.adaptive && t(' · 预算控制暂不接入，当前使用服务默认；请先添加档位并确认 adaptive 支持', ' · Budget controls are unavailable; service default is used until adaptive support is configured')}</span>
        {selected.map(level => <div className="provider-thinking-row" key={level}>
          <span>{effortLabel(level, zh ? 'zh' : 'en')} <small>{level}</small></span>
          <input aria-label={`${t('发送值', 'Request value')} ${index + 1} ${level}`} required maxLength={40} pattern="[a-zA-Z0-9_-]+" value={mapping[level] ?? level}
            onChange={event => apply(selected, { ...mapping, [level]: event.target.value })}/>
          <button type="button" className="provider-icon" aria-label={`${t('移除档位', 'Remove level')} ${index + 1} ${level}`} onClick={() => apply(selected.filter(value => value !== level), mapping)}><X size={14}/></button>
        </div>)}
        <div className="provider-thinking-add">{levels.filter(level => !selected.includes(level)).map(level => <button type="button" key={level}
          aria-label={`${t('添加档位', 'Add level')} ${index + 1} ${level}`} onClick={() => apply([...selected, level], { ...mapping, [level]: level })}><Plus size={12}/>{effortLabel(level, zh ? 'zh' : 'en')}</button>)}</div>
        <button type="button" className="provider-thinking-reset" onClick={reset}>{model.declaredThinkingLevels ? t('恢复上游声明', 'Restore provider declaration') : t('使用服务默认', 'Use service default')}</button>
      </div>
    </details>
  </section>;
}
