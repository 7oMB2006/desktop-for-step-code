import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { DisclosureChevron } from './DisclosureChevron';
import './turn-status-trigger.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  icon: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  tone?: 'neutral' | 'success' | 'danger' | 'warning';
};

export function TurnStatusTrigger({ icon, label, detail, tone = 'neutral', className = '', ...props }: Props) {
  const expanded = props['aria-expanded'] === true || props['aria-expanded'] === 'true';
  return <button {...props} type="button" className={`turn-status-trigger ${className}`} data-tone={tone}>
    <span className="turn-status-icon">{icon}</span><span className="turn-status-label">{label}</span>
    {detail && <span className="turn-status-detail">{detail}</span>}
    <span className="turn-status-chevron" data-open={expanded}><DisclosureChevron/></span>
  </button>;
}
