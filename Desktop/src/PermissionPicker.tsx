import { useEffect, useRef, useState } from 'react';
import { Check, Goal, Hand, ShieldAlert, ShieldCheck, Shield, Lightbulb, Network } from 'lucide-react';
import type { PermissionPreset } from './contracts';
import { emptyLaunch, type LaunchMode, type LaunchState } from './launch-state';

const presets: { id: PermissionPreset; zh: string; en: string; descriptionZh: string; descriptionEn: string }[] = [
  { id: 'ask', zh: '请求批准', en: 'Ask', descriptionZh: '写入与命令执行先确认', descriptionEn: 'Confirm writes and commands' },
  { id: 'approve-for-me', zh: '代我批准', en: 'Approve for Me', descriptionZh: '常规操作自动执行，风险操作仍需确认', descriptionEn: 'Routine actions run; risky actions still ask' },
  { id: 'full-access', zh: '完全访问', en: 'Full Access', descriptionZh: '包括危险命令也免确认，启用前需确认风险', descriptionEn: 'Dangerous commands run too; risk acknowledgment required' },
];
const icons = { ask: Hand, 'approve-for-me': ShieldCheck, 'full-access': ShieldAlert };

interface Props {
  preset?: PermissionPreset;
  language: 'zh' | 'en';
  disabled: boolean;
  supported: boolean;
  onSelect: (preset: PermissionPreset) => Promise<unknown>;
  onReview?: () => void;
  launch?: LaunchState;
  launchSupported?: Record<LaunchMode, boolean>;
  busy?: boolean;
  onLaunch?: (mode: LaunchMode, enabled: boolean) => Promise<unknown>;
}

export function PermissionPicker({ preset, language, disabled, supported, onSelect, onReview,
  launch = emptyLaunch(), launchSupported, busy, onLaunch }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const zh = language === 'zh';
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    const frame = requestAnimationFrame(() => {
      (root.current?.querySelector<HTMLButtonElement>('.permission-menu button[aria-checked="true"]:not(:disabled)')
        ?? root.current?.querySelector<HTMLButtonElement>('.permission-menu button:not(:disabled)'))?.focus();
    });
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (disabled || !supported || onReview) setOpen(false); }, [disabled, supported, Boolean(onReview)]);
  const active = presets.find(item => item.id === preset);
  const ActiveIcon = onReview ? Hand : preset ? icons[preset] : Shield;
  return <div className="permission-picker" ref={root}>
    <button ref={trigger} type="button" className={`permission-trigger${onReview ? ' permission-review' : preset ? ` permission-${preset}` : ''}`}
      aria-haspopup={onReview ? 'dialog' : 'menu'} aria-expanded={onReview ? false : open}
      aria-label={onReview ? (zh ? '处理审批' : 'Review approval') : (zh ? '访问权限' : 'Access permissions')}
      data-tooltip={!onReview && !supported ? (zh ? '当前运行时不支持权限切换' : 'Permission switching unavailable') : undefined}
      disabled={disabled || (!onReview && (!supported || pending))} onClick={() => onReview ? onReview() : setOpen(value => !value)}>
      <ActiveIcon size={16}/><span>{onReview ? (zh ? '处理审批' : 'Review approval') : active ? (zh ? active.zh : active.en) : (zh ? '访问权限' : 'Permissions')}</span>
    </button>
    {open && !onReview && <div className="permission-menu" role="menu" aria-label={zh ? '访问权限' : 'Access permissions'}
      onKeyDown={event => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        } else if (event.key === 'Tab') { setOpen(false); trigger.current?.focus(); }
      }}>
      {onLaunch && <>
        <div className="permission-launch-heading" role="presentation">{zh ? '任务' : 'Task'}</div>
        {([
          { id: 'plan', Icon: Lightbulb, zh: '计划模式', en: 'Plan', selected: Boolean(launch.planArmed) },
          { id: 'goal', Icon: Goal, zh: '目标模式', en: 'Goal', selected: launch.goalArmed },
          { id: 'ultracode', Icon: Network, zh: 'Ultracode', en: 'Ultracode', selected: Boolean(launch.ultracodeArmed) },
        ] as const).map(({ id, Icon, selected, ...item }) => <button type="button" role="menuitemcheckbox" aria-checked={selected}
          key={id} className="permission-launch-option" disabled={pending || !launchSupported?.[id]
            || id === 'goal' && (Boolean(launch.goal && launch.goal.status !== 'complete') || busy)}
          onClick={async () => { setOpen(false); setPending(true); try { await onLaunch(id, !selected); } finally { setPending(false); } }}>
          <Icon size={17}/><span className="permission-option"><strong>{zh ? item.zh : item.en}</strong></span>
          {selected && <Check size={15}/>}
        </button>)}
        <div className="permission-launch-divider" role="separator"/>
        <div className="permission-launch-heading" role="presentation">{zh ? '权限审批' : 'Permissions'}</div>
      </>}
      {presets.map(item => {
        const Icon = icons[item.id];
        return <button type="button" role="menuitemradio" aria-checked={item.id === preset} className={`permission-option-${item.id}`} key={item.id} disabled={pending} onClick={async () => {
          setOpen(false);
          if (item.id === preset) return;
          setPending(true);
          try { await onSelect(item.id); } finally { setPending(false); }
        }}>
          <Icon size={17}/>
          <span className="permission-option"><strong>{zh ? item.zh : item.en}</strong><small>{zh ? item.descriptionZh : item.descriptionEn}</small></span>
          {item.id === preset && <Check size={15}/>}
        </button>;
      })}
    </div>}
  </div>;
}
