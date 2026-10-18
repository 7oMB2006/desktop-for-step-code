import type { UsageUnit } from './usage-unit';
import './usage-unit.css';

const units: UsageUnit[] = ['default', 'K', 'M', 'B'];
export function UsageUnitButton({ value, onChange, language = 'zh' }: {
  value: UsageUnit; onChange: (value: UsageUnit) => void; language?: 'zh' | 'en';
}) {
  const label = value === 'default' ? (language === 'zh' ? '默认' : 'Raw') : value;
  const description = value === 'default' ? (language === 'zh' ? '完整 Token 数' : 'Exact token count')
    : language === 'zh' ? `以${value === 'K' ? '千' : value === 'M' ? '百万' : '十亿'} Token 为单位`
      : `${value === 'K' ? 'Thousand' : value === 'M' ? 'Million' : 'Billion'} tokens`;
  return <button className="usage-unit-cycle" type="button"
    aria-label={language === 'zh' ? `切换显示单位，当前${label}` : `Change display unit, currently ${label}`}
    data-tooltip={language === 'zh' ? `${description}，点击切换` : `${description}. Click to change`}
    onClick={() => onChange(units[(units.indexOf(value) + 1) % units.length])}>
    <span>{label}</span>
  </button>;
}
