import NumberFlow from '@number-flow/react';

const timing = { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' };
const opacityTiming = { duration: 160, easing: 'ease-out' };
const format = { useGrouping: false, maximumFractionDigits: 0 };

export function DiffCount({ value, kind }: { value: number; kind: 'added' | 'removed' }) {
  return <span className={`diff-count diff-${kind}`} data-count={value} data-direction={kind === 'added' ? 'up' : 'down'}>
    <NumberFlow value={value} prefix={kind === 'added' ? '+' : '-'} trend={kind === 'added' ? 1 : -1}
      locales="en-US" format={format} transformTiming={timing} spinTiming={timing} opacityTiming={opacityTiming}
      respectMotionPreference/>
  </span>;
}
