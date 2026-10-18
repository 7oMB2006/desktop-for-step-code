import { useLayoutEffect, useRef, useState } from 'react';
import { formatUsageTotal, type UsageUnit } from './usage-unit';

export function UsageTokenValue({ value, unit }: { value?: number; unit: UsageUnit }) {
  const latest = useRef({ value, unit });
  const [previous, setPrevious] = useState<{ value?: number; unit: UsageUnit }>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    if (latest.current.unit !== unit) {
      clearTimeout(timer.current);
      setPrevious(latest.current);
      timer.current = setTimeout(() => setPrevious(undefined), 200);
    }
    latest.current = { value, unit };
  }, [value, unit]);
  useLayoutEffect(() => () => clearTimeout(timer.current), []);
  const text = (amount: number | undefined, displayUnit: UsageUnit) => amount === undefined ? '--' : formatUsageTotal(amount, displayUnit);
  return <span className={`usage-token-value${previous ? ' is-switching' : ''}`}>
    {previous && <span key={`old-${previous.unit}`} className="usage-token-outgoing" aria-hidden="true">{text(previous.value, previous.unit)}</span>}
    <span key={unit} className="usage-token-current">{text(value, unit)}</span>
  </span>;
}
