import { useId } from 'react';
import { Check, FileKey2 } from 'lucide-react';
import { StepPlatformIcon } from './ProviderBrand';

export type PluginConnectionSource = 'plan' | 'api' | 'independent';
type SourceState = { enabled?: boolean; toggle?: () => void };

export function PluginConnectionSources({ language, sources, summary, children }: {
  language: string; sources: Record<PluginConnectionSource, SourceState>; summary?: string; children?: React.ReactNode;
}) {
  const id = useId();
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const title = t('连接来源', 'Connection sources');
  const labels = {
    plan: t('使用我的 Step Plan 额度', 'Use my Step Plan quota'),
    api: t('开放平台 API（按量计费）', 'Open Platform API (metered)'),
    independent: t('独立配置', 'Independent'),
  };
  return <section className="pc-form-section">
    <div className="pc-section-title"><h3 id={id}>{title}</h3>
      {summary && <span className="pc-section-meta">{summary}</span>}</div>
    <div className="pc-mode pc-host-source-switches" role="group" aria-labelledby={id}>
      {(['plan', 'api', 'independent'] as const).map(source => {
        const { enabled = false, toggle } = sources[source];
        return <button key={source} type="button" role="switch" aria-checked={enabled}
          aria-label={labels[source]} disabled={!toggle} onClick={toggle}>
          {source === 'independent' ? <FileKey2 size={16} aria-hidden="true"/> : <StepPlatformIcon size={16}/>}
          <span>{labels[source]}</span>
          <Check size={13} aria-hidden="true"/>
        </button>;
      })}
    </div>
    {children}
  </section>;
}
