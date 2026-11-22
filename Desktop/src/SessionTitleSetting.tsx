import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import type { Preferences, ProviderInfo } from './contracts';
import { DisclosureSelect } from './DisclosureSelect';
import { modelKey } from './model-favorites';
import { titleModelProviders } from './session-title-model';

type TitlePreferences = Pick<Preferences, 'autoGenerateSessionTitles' | 'sessionTitleModel'>;

export function SessionTitleSetting({ preferences, providers, onChange }: {
  preferences: Preferences;
  providers: ProviderInfo[];
  onChange: (patch: TitlePreferences) => Promise<unknown>;
}) {
  const [pending, setPending] = useState<TitlePreferences>();
  const [failed, setFailed] = useState(false);
  const t = (zh: string, en: string) => preferences.language === 'zh' ? zh : en;
  const enabled = (pending?.autoGenerateSessionTitles ?? preferences.autoGenerateSessionTitles) !== false;
  const current = pending?.sessionTitleModel !== undefined ? pending.sessionTitleModel : preferences.sessionTitleModel;
  const value = current ? modelKey(current) : '';
  const groups = titleModelProviders(providers);
  const unavailable = current && !groups.some(provider => provider.id === current.provider
    && provider.models.some(model => model.id === current.id));
  const description = t(
    '默认登录 Step Plan 后，即使用第三方模型聊天，也会将首条消息的一小段文字发给阶跃。开放平台 API 仅用于支持的阶跃会话。手选模型时，只会发给所选供应商。每个新会话最多一次额外请求，可能消耗少量额度。关闭或生成失败时保留首句标题。',
    'By default, Step Plan sends a short excerpt of the first message to Step even when you chat with a third-party model. Open Platform API applies only to supported Step chats. A manual selection sends it only to the chosen provider. Each new chat makes at most one extra request, which can use quota. If disabled or unsuccessful, the first message stays as the title.',
  );
  const save = (patch: TitlePreferences) => {
    setFailed(false);
    setPending(patch);
    void onChange(patch).catch(() => setFailed(true)).finally(() => setPending(undefined));
  };
  return <>
    <div className="settings-session-title-row">
      <label className="checkbox" data-settings-anchor="auto-session-title">
        <input type="checkbox" role="switch" checked={enabled}
          aria-disabled={pending !== undefined || undefined} onChange={event => {
            if (!pending) save({ autoGenerateSessionTitles: event.target.checked });
          }}/>
        {t('自动生成会话标题', 'Generate session titles automatically')}
      </label>
      <button type="button" className="icon-button settings-session-title-help"
        aria-label={t('自动标题说明', 'About automatic session titles')} aria-description={description} data-tooltip={description}>
        <CircleHelp size={15}/>
      </button>
    </div>
    <label data-settings-anchor="session-title-model">
      {t('会话标题模型', 'Session title model')}
      <DisclosureSelect aria-label={t('会话标题模型', 'Session title model')}
        value={value} disabled={!enabled} aria-disabled={pending !== undefined || undefined} onChange={event => {
          if (pending) return;
          const next = event.target.value;
          if (!next) { save({ sessionTitleModel: null }); return; }
          for (const provider of groups) {
            const model = provider.models.find(model => modelKey({ provider: provider.id, id: model.id }) === next);
            if (model) { save({ sessionTitleModel: { provider: provider.id, id: model.id } }); return; }
          }
        }}>
        <option value="">{t('自动（优先 Step Plan）', 'Automatic (prefer Step Plan)')}</option>
        {unavailable && <option value={value} disabled>{current.id} · {t('不可用', 'Unavailable')}</option>}
        {groups.map(provider => <optgroup key={provider.id} label={provider.name}>
          {provider.models.map(model => {
            const key = modelKey({ provider: provider.id, id: model.id });
            return <option key={key} value={key}>{model.name} · {provider.name}</option>;
          })}
        </optgroup>)}
      </DisclosureSelect>
    </label>
    {failed && <small role="alert">{t('未能保存标题设置，请重试。', 'Could not save title settings. Try again.')}</small>}
  </>;
}
