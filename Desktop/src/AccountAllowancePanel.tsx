import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountAllowance, AllowanceIssue } from './account-allowance';
import { hasAccountSnapshot } from './account-allowance';
import type { Account, DesktopBridge } from './contracts';
import { PlanAllowance, type PlanAllowanceView } from './PlanAllowance';
import { ApiBalance } from './ApiBalance';

export function allowanceView(value: AccountAllowance, language: string): PlanAllowanceView {
  const en = language === 'en';
  const t = (zh: string, english: string) => en ? english : zh;
  const date = (at: number) => new Intl.DateTimeFormat(en ? 'en-US' : 'zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', year: 'numeric',
  }).format(at);
  const issues: Record<AllowanceIssue, string> = {
    'signed-out': t('登录个人 Step Plan 账户后查看额度。', 'Sign in with a personal Step Plan account to view allowance.'),
    unsupported: t('当前登录方式不支持查询个人 Plan 额度。', 'This sign-in method does not support personal Plan allowance queries.'),
    authentication: t('无法验证额度查询权限，请刷新或重新登录。', 'Unable to verify quota access. Refresh or sign in again.'),
    'not-available': t('官方额度查询接口暂未开放。', 'The official allowance API is not available yet.'),
    'rate-limit': t('查询过于频繁，请稍后刷新。', 'Too many queries. Refresh after the cooldown.'),
    network: t('暂时无法获取额度，请稍后刷新。', 'Unable to retrieve allowance. Try refreshing later.'),
    'invalid-response': t('暂时无法解析官方额度数据，请稍后刷新。', 'Unable to read the official allowance data. Try refreshing later.'),
    identity: t('额度与当前账户不一致，请重新登录后查询。', 'Allowance belongs to a different account. Sign in again.'),
    partial: t('部分额度数据暂不可用。', 'Some allowance data is temporarily unavailable.'),
    expired: t('额度数据已过期，请刷新。', 'Allowance data has expired. Refresh to retrieve it.'),
  };
  const labels = {
    five_hour: t('5 小时额度', '5-hour allowance'), weekly: t('每周额度', 'Weekly allowance'),
    subscription: t('订阅额度', 'Subscription allowance'), topup: t('充值额度', 'Top-up allowance'),
    unsupported: t('其他额度', 'Other allowance'),
  };
  const noPlan = value.plan?.state === 'known' && value.plan.family === 'none';
  let message = value.issue ? issues[value.issue] : noPlan ? t('当前账户没有有效订阅。', 'No active subscription on this account.') : undefined;
  if (value.status === 'stale' && value.issue) message += t(' 显示的是上次获取的数据。', ' Showing the last retrieved data.');
  return {
    status: value.status === 'idle' ? 'loading' : value.status,
    planName: value.plan?.name,
    noPlan,
    restriction: value.quota?.allowed === false && !noPlan
      ? value.quota.reason === 'subscription_expired'
        ? t('套餐已到期，当前账户暂不可使用。', 'Your subscription has expired. This account cannot currently be used.')
        : t('官方已限制当前账户使用；剩余额度不代表当前可用。', 'Usage is restricted by the service; remaining allowance does not mean this account can currently be used.')
      : undefined,
    expiry: value.plan?.expiresAt ? t(`${date(value.plan.expiresAt)} 到期`, `Expires ${date(value.plan.expiresAt)}`) : undefined,
    updated: value.fetchedAt ? t(`更新于 ${date(value.fetchedAt)}`, `Updated ${date(value.fetchedAt)}`) : undefined,
    message,
    meters: value.meters.map((m, index) => ({
      id: `${m.kind}-${index}`, label: labels[m.kind], remainingPercent: m.remainingPercent, unlimited: m.unlimited,
      timing: [
        m.resetsAt ? t(`${date(m.resetsAt)} 重置`, `Resets ${date(m.resetsAt)}`) : '',
        m.expiresAt ? t(`${date(m.expiresAt)} 到期`, `Expires ${date(m.expiresAt)}`) : '',
      ].filter(Boolean).join(' · '),
    })),
  };
}

export function AccountAllowancePanel({ bridge, account, language, active = true }: {
  bridge: Pick<DesktopBridge, 'accountAllowance' | 'cancelAccountAllowance'>;
  account: Account; language: string; active?: boolean;
}) {
  const [value, setValue] = useState<AccountAllowance>({ status: 'loading', meters: [] });
  const [coolingDown, setCoolingDown] = useState(false);
  const revision = useRef(0);
  const load = useCallback(async (force: boolean) => {
    const request = ++revision.current;
    setValue(previous => ({ ...previous, status: 'loading' }));
    try {
      const next = await bridge.accountAllowance(force);
      if (revision.current === request) setValue(next);
    } catch {
      if (revision.current === request) setValue(previous => ({
        ...previous, status: hasAccountSnapshot(previous) ? 'stale' : 'error', issue: 'network',
      }));
    }
  }, [bridge]);
  useEffect(() => {
    if (active) {
      setValue({ status: 'loading', meters: [] });
      void load(false);
    }
    return () => { revision.current++; void bridge.cancelAccountAllowance().catch(() => {}); };
  }, [bridge, account, active, load]);
  // Age only the visible snapshot. These timers never trigger network requests.
  useEffect(() => {
    if (!value.fetchedAt) return;
    const now = Date.now();
    const boundaries = [value.fetchedAt + 30000, value.plan?.expiresAt,
      ...value.meters.flatMap(m => [m.resetsAt, m.expiresAt])].filter((at): at is number => at !== undefined && at > now);
    const stale = boundaries.length ? window.setTimeout(() => setValue(previous => previous.status === 'ready'
      ? { ...previous, status: 'stale' } : previous), Math.min(...boundaries) - now) : undefined;
    const expires = window.setTimeout(() => setValue(previous => previous.fetchedAt === value.fetchedAt
      ? { source: previous.source, status: 'error', issue: 'expired', meters: [] } : previous), Math.max(0, (value.expiresAt ?? value.fetchedAt + 300000) - now));
    return () => { window.clearTimeout(stale); window.clearTimeout(expires); };
  }, [value.fetchedAt, value.expiresAt, value.plan, value.meters]);
  useEffect(() => {
    const remaining = (value.retryAt ?? 0) - Date.now();
    setCoolingDown(remaining > 0);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setCoolingDown(false), remaining);
    return () => window.clearTimeout(timer);
  }, [value.retryAt]);
  if (['platform_cn', 'platform_oversea'].includes(account.profile ?? '')) return <ApiBalance value={value} language={language}
    refreshDisabled={coolingDown || !active} onRefresh={() => { if (!coolingDown && active) void load(true); }}
    website={account.profile === 'platform_oversea' ? 'https://platform.stepfun.ai' : 'https://platform.stepfun.com/account-overview'}/>;
  return <PlanAllowance value={allowanceView(value, language)} language={language} refreshDisabled={coolingDown || !active}
    onRefresh={() => { if (!coolingDown && active) void load(true); }}/>;
}
