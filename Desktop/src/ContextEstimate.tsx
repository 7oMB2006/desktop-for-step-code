import { CircleAlert } from 'lucide-react';
import { formatEstimate, type SessionEstimate } from './usage-estimates';

export function ContextEstimate({ value, custom, language }: { value?: SessionEstimate; custom: boolean; language: string }) {
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  const plan = value?.settings.mode === 'plan';
  const group = value?.active;
  const currentGroups = value?.groups.filter(item => item.currentAccount) ?? [];
  const otherGroups = (value?.groups.length ?? 0) - currentGroups.length;
  const details = [
    custom ? t('第三方模型不提供费用估算，Token 用量照常统计。', 'Third-party costs are not estimated. Token usage is still recorded.')
      : t('仅估算主会话模型响应；不含搜索、子代理及上下文维护。不是官方账单或账户余额。', 'Estimates main-session model responses only, excluding search, subagents and context maintenance. Not an official bill or account balance.'),
    !custom && plan && t('M 为百万 Credit，按本地价格与时段规则换算；不是官方逐请求扣量。', 'M means million Credits, calculated from local prices and time-window rules, not official per-request charges.'),
    !custom && value?.settings.available && (plan
        ? value.settings.region === 'global' ? t('海外 Plan 换算规则尚未核实，暂不估算。', 'International Plan conversion is not verified; estimates are unavailable.')
          : value.settings.rules.planProtected ? t('后续响应：历史订阅保护规则', 'Subsequent responses: protected subscription rates')
            : t('后续响应：北京时间工作日高峰双倍规则', 'Subsequent responses: weekday peak multiplier, Beijing time')
        : value.settings.region === 'cn' && value.settings.rules.apiLegacyCache
          ? t('后续响应：历史 API 缓存价格', 'Subsequent responses: legacy API cache rates')
          : t('后续响应：官方标准 API 价格', 'Subsequent responses: official standard API rates')),
    value?.historicalUnknown && t('部分历史用量缺少请求身份或计费规则，未补算。', 'Some historical usage lacks request identity or pricing rules and is not backfilled.'),
    value?.storageError && t('估算记录读写失败，重启后可能不完整。', 'Estimate storage failed; history may be incomplete after restart.'),
    ...currentGroups.map(item => `${item.mode === 'plan' ? 'Plan' : 'API'} · ${item.region === 'cn' ? t('中国大陆', 'China') : t('海外', 'International')}：${formatEstimate(item, language)}${item.unknown > 0 ? ` (${t('部分不可估算', 'partly unavailable')})` : ''}`),
    otherGroups > 0 && t(`另有 ${otherGroups} 组其他账户记录，切回对应账户可查看。`, `${otherGroups} other account groups retained; switch to that account to view them.`),
    !group && !custom && t('当前计费分组暂无可估算记录。', 'No estimates recorded for the current billing group.'),
  ].filter(Boolean).join('\n\n');
  return <div className="context-estimate">
    <span className="context-estimate-label">
      {plan && !custom ? t('估算 Credit', 'Estimated Credit') : t('估算费用', 'Estimated cost')}
      <button type="button" className="icon-button context-estimate-info"
        aria-label={t('估算明细', 'Estimate details')} aria-description={details}
        data-tooltip={details} data-tooltip-side="left"><CircleAlert size={12} aria-hidden="true"/></button>
    </span>
    <strong>{!custom && group ? formatEstimate(group, language) : '--'}</strong>
  </div>;
}
