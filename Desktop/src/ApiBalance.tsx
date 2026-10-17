import { AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';
import type { AccountAllowance, AllowanceIssue } from './account-allowance';
import './plan-allowance.css';

export function ApiBalance({ value, language, refreshDisabled = false, onRefresh, website = 'https://platform.stepfun.com/account-overview' }: {
  value: AccountAllowance; language: string; refreshDisabled?: boolean;
  onRefresh: () => void; website?: 'https://platform.stepfun.com/account-overview' | 'https://platform.stepfun.ai';
}) {
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  const loading = value.status === 'loading' || value.status === 'idle';
  const balance = value.balance;
  const currency = balance?.currency;
  const amount = balance?.amount;
  const number = amount === undefined ? '--' : amount !== 0 && Math.abs(amount) < 1e-8
    ? amount.toExponential(4)
    : new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-CN', {
      minimumFractionDigits: 2, maximumFractionDigits: 8,
    }).format(amount);
  const issues: Record<AllowanceIssue, string> = {
    'signed-out': t('登录官方 API Key 后查看账户余额。', 'Sign in with an official API key to view your balance.'),
    unsupported: t('当前登录方式不支持查询官方 API 余额。', 'This sign-in method does not support official API balance queries.'),
    authentication: t('无法验证余额查询权限，请刷新或重新登录。', 'Unable to verify balance access. Refresh or sign in again.'),
    'not-available': t('官方余额查询接口暂不可用。', 'The official balance API is currently unavailable.'),
    'rate-limit': t('查询过于频繁，请稍后刷新。', 'Too many queries. Refresh after the cooldown.'),
    network: t('暂时无法获取余额，请稍后刷新。', 'Unable to retrieve balance. Try refreshing later.'),
    'invalid-response': t('暂时无法解析官方余额数据，请稍后刷新。', 'Unable to read the official balance data. Try refreshing later.'),
    identity: t('账户已变化，请重新查询余额。', 'The account has changed. Refresh its balance.'),
    partial: t('余额数据暂不可用。', 'Balance data is temporarily unavailable.'),
    expired: t('余额数据已过期，请刷新。', 'Balance data has expired. Refresh to retrieve it.'),
  };
  const insufficient = balance?.accountType === 'prepaid' && amount !== undefined && amount <= 0;
  const updated = value.fetchedAt ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(value.fetchedAt) : undefined;
  return <section className="plan-allowance api-balance" aria-label={t('API 账户余额', 'API account balance')} aria-busy={loading}>
    <div className="plan-allowance-heading">
      <h4>{t('API 账户余额', 'API account balance')}</h4>
      <button type="button" className="plan-refresh" aria-label={t('刷新余额', 'Refresh balance')}
        data-tooltip={t('刷新余额', 'Refresh balance')} disabled={loading || value.status === 'unsupported' || refreshDisabled} onClick={onRefresh}>
        <RefreshCw size={14} className={loading ? 'is-refreshing' : undefined}/>
      </button>
    </div>
    <div className="api-balance-label">{t('可用余额', 'Available balance')}</div>
    {loading && !balance ? <div className="plan-skeleton" aria-label={t('正在查询余额', 'Loading balance')}><i/><i/></div>
      : <div className="api-balance-amount" data-empty={amount === undefined} data-low={insufficient}>
        {currency && <span>{currency}</span>}<strong>{number}</strong>
      </div>}
    {balance && !currency && <div className="api-balance-currency">{t('接口未标注币种，以官网为准', 'Currency is not specified by the API; refer to the website')}</div>}
    {value.issue && <div className={`plan-notice${value.status === 'error' ? ' is-error' : ''}`} role="status">
      <AlertCircle size={14}/><span>{issues[value.issue]}{value.status === 'stale' && t(' 显示的是上次获取的数据。', ' Showing the last retrieved data.')}</span>
    </div>}
    {insufficient && <div className="plan-notice is-error" role="status"><AlertCircle size={14}/><span>
      {t('可用余额不足，请前往官网查看或充值。', 'Insufficient balance. View your account or top up on the website.')}
    </span></div>}
    <div className="api-balance-footer">
      <span className="plan-updated" role="status">{loading ? t('正在刷新余额…', 'Refreshing balance…')
        : updated ? t(`更新于 ${updated}`, `Updated ${updated}`) : t('尚未获取余额', 'Balance not retrieved')}
        {value.status === 'stale' && <span>{t(' · 数据待刷新', ' · Refresh needed')}</span>}
      </span>
      <a className="api-balance-website" href={website} target="_blank" rel="noreferrer">
        {t('前往官网', 'Open website')}<ExternalLink size={12}/>
      </a>
    </div>
  </section>;
}
