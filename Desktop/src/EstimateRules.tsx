import { useEffect, useState } from 'react';
import type { Account, DesktopBridge } from './contracts';
import type { EstimateSettings } from './usage-estimates';

export function EstimateRules({ bridge, account, language, disabled, onChanged }: {
  bridge: Pick<DesktopBridge, 'estimateSettings' | 'setEstimateRules'>; account: Account;
  language: string; disabled: boolean; onChanged: () => Promise<void>;
}) {
  const [settings, setSettings] = useState<EstimateSettings>();
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  useEffect(() => {
    let current = true;
    setSettings(undefined); setError('');
    void bridge.estimateSettings().then(value => { if (current) setSettings(value); })
      .catch(() => { if (current) setError(t('无法读取估算规则', 'Unable to load estimate rules')); });
    return () => { current = false; };
  }, [bridge, account, language]);
  if (!account.loggedIn) return null;
  if (!settings?.available || settings.region !== 'cn') return error ? <p role="alert">{error}</p> : null;
  const plan = settings.mode === 'plan';
  return <div className="account-estimate-rules">
    <label><input type="checkbox" disabled={disabled || saving} checked={plan ? settings.rules.planProtected : settings.rules.apiLegacyCache}
      onChange={event => {
        const rules = { ...settings.rules, [plan ? 'planProtected' : 'apiLegacyCache']: event.target.checked };
        const previous = settings;
        setSettings({ ...settings, rules });
        setSaving(true); setError('');
        void bridge.setEstimateRules(rules, settings.accountRef!).then(async value => {
          setSettings(value);
          try { await onChanged(); }
          catch { setError(t('规则已保存，上下文刷新失败，请稍后刷新。', 'Rules saved, but context refresh failed. Refresh again later.')); }
        }).catch(() => {
          setSettings(previous);
          setError(t('保存失败，请刷新账户后重试。', 'Could not save. Refresh the account and try again.'));
        })
          .finally(() => setSaving(false));
      }}/><span>{plan ? t('按历史订阅保护规则估算', 'Estimate with protected subscription rates')
        : t('按历史 API 缓存价格估算', 'Estimate with legacy API cache rates')}</span></label>
    <p>{plan
      ? t('适用于 2026 年 10 月 15 日前实际付费且保留原套餐权益的账户；Step 5 Preview 不计高峰双倍扣量。', 'For accounts with protected paid subscriptions from before October 15, 2026; excludes the Step 5 Preview peak-time multiplier.')
      : t('适用于北京时间 2026 年 10 月 14 日 00:30 前已调用过 Step 5 Preview 按量 API 的账户；缓存命中按 ¥0.35／百万 Token 估算。', 'For accounts that used the Step 5 Preview pay-as-you-go API before October 14, 2026, 00:30 Beijing time; estimates cache reads at CNY 0.35 per million tokens.')}</p>
    <p>{t('仅影响此账户后续响应的本地估算，不改变套餐、请求方式或官方实际扣费。', 'Only changes local estimates for subsequent responses on this account, never your plan, request routing or official charges.')}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
