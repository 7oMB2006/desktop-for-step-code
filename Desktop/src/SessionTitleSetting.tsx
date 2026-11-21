import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import type { Preferences } from './contracts';

export function SessionTitleSetting({ preferences, onChange }: {
  preferences: Preferences;
  onChange: (patch: Pick<Preferences, 'autoGenerateSessionTitles'>) => Promise<unknown>;
}) {
  const [pending, setPending] = useState<boolean>();
  const t = (zh: string, en: string) => preferences.language === 'zh' ? zh : en;
  const description = t(
    '支持的阶跃会话会用轻量模型概括首条消息。每个新会话最多一次额外请求，可能消耗少量额度。关闭后保留首句标题。',
    'Supported Step sessions use a lightweight model to summarize the first message. Each new session can make one extra request, which may use a small amount of quota. Turn this off to keep the first message as the title.',
  );
  return <div className="settings-session-title-row">
    <label className="checkbox" data-settings-anchor="auto-session-title">
      <input type="checkbox" role="switch" checked={pending ?? (preferences.autoGenerateSessionTitles !== false)}
        disabled={pending !== undefined} onChange={event => {
          const enabled = event.target.checked;
          setPending(enabled);
          void onChange({ autoGenerateSessionTitles: enabled }).catch(() => {}).finally(() => setPending(undefined));
        }}/>
      {t('自动生成会话标题', 'Generate session titles automatically')}
    </label>
    <button type="button" className="icon-button settings-session-title-help"
      aria-label={t('自动标题说明', 'About automatic session titles')} aria-description={description} data-tooltip={description}>
      <CircleHelp size={15}/>
    </button>
  </div>;
}
