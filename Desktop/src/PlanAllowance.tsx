import { AlertCircle, RefreshCw } from 'lucide-react';
import './plan-allowance.css';

export interface AllowanceMeter {
  id: string;
  label: string;
  remainingPercent: number | null;
  unlimited?: boolean;
  timing: string;
}

// Presentation data only. Credentials and upstream transport stay outside React.
export interface PlanAllowanceView {
  status: 'ready' | 'loading' | 'stale' | 'error' | 'unsupported';
  planName?: string;
  noPlan?: boolean;
  expiry?: string;
  updated?: string;
  message?: string;
  meters: AllowanceMeter[];
}

export function PlanAllowance({ value, language = 'zh', onRefresh, refreshDisabled = false }: {
  value: PlanAllowanceView; language?: string; onRefresh: () => void; refreshDisabled?: boolean;
}) {
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  const loading = value.status === 'loading';
  const unsupported = value.status === 'unsupported';
  const name = value.planName ?? (value.noPlan ? t('未订阅套餐', 'No active subscription') : t('套餐信息暂不可用', 'Plan information unavailable'));
  return <section className="plan-allowance" aria-label={t('套餐与额度', 'Plan and allowance')} aria-busy={loading}>
    <div className="plan-allowance-heading">
      <h4>{t('套餐与额度', 'Plan and allowance')}</h4>
      <button type="button" className="plan-refresh" aria-label={t('刷新额度', 'Refresh allowance')}
        data-tooltip={t('刷新额度', 'Refresh allowance')} disabled={loading || unsupported || refreshDisabled} onClick={onRefresh}>
        <RefreshCw size={14} className={loading ? 'is-refreshing' : undefined}/>
      </button>
    </div>
    {loading && !value.planName && !value.noPlan
      ? <div className="plan-skeleton" aria-label={t('正在查询套餐', 'Loading plan')}><i/><i/></div>
      : <div className="plan-subscription"><strong>{name}</strong>{value.expiry && <span>{value.expiry}</span>}</div>}
    {value.message && <div className={`plan-notice${value.status === 'error' ? ' is-error' : ''}`} role="status">
      <AlertCircle size={14}/><span>{value.message}</span>
    </div>}
    <div className="plan-meter-list">
      {value.meters.map(meter => {
        const known = typeof meter.remainingPercent === 'number' && Number.isFinite(meter.remainingPercent)
          && meter.remainingPercent >= 0 && meter.remainingPercent <= 100;
        const amount = known ? meter.remainingPercent! : undefined;
        const caption = meter.unlimited ? t('不限额', 'Unlimited') : amount === undefined
          ? t('暂不可用', 'Unavailable') : `${Number(amount.toFixed(1))}%`;
        return <div className="plan-meter" key={meter.id} data-low={amount !== undefined && amount <= 15}>
          <div className="plan-meter-label"><span>{meter.label}</span><span>{!meter.unlimited && known && <small>{t('剩余', 'Remaining')} </small>}<b>{caption}</b></span></div>
          <div className="plan-meter-track" role="meter" aria-label={meter.label} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={meter.unlimited ? undefined : amount} aria-valuetext={caption} data-unknown={!known && !meter.unlimited}>
            <span style={{ width: `${meter.unlimited ? 100 : amount ?? 0}%` }}/>
          </div>
          <div className="plan-meter-timing">{meter.timing}</div>
        </div>;
      })}
    </div>
    {(value.updated || loading) && <div className="plan-updated" role="status">
      {loading ? t('正在刷新额度…', 'Refreshing allowance…') : value.updated}
      {value.status === 'stale' && <span>{t(' · 数据待刷新', ' · Refresh needed')}</span>}
    </div>}
  </section>;
}
