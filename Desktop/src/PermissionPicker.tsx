import { useEffect, useRef, useState } from 'react';
import { Check, Eye, Hand, ShieldAlert, RefreshCw, Shield } from 'lucide-react';
import type { PermissionPreset } from './contracts';

const presets: { id: PermissionPreset; zh: string; en: string; descriptionZh: string; descriptionEn: string }[] = [
  { id: 'ask', zh: '请求批准', en: 'Ask', descriptionZh: '写入与命令执行先确认', descriptionEn: 'Confirm writes and commands' },
  { id: 'read-only', zh: '只读', en: 'Read Only', descriptionZh: '只允许读取与查找', descriptionEn: 'Read and discover only' },
  { id: 'bypass', zh: '常规免确认', en: 'Bypass', descriptionZh: '常规操作免确认，危险命令仍需批准', descriptionEn: 'Ordinary tools run; dangerous commands still ask' },
  { id: 'autopilot', zh: '自动驾驶', en: 'Autopilot', descriptionZh: '常规免确认，失败后可自动续跑', descriptionEn: 'Ordinary tools run; retries transient failures' },
];
const icons = { ask: Hand, 'read-only': Eye, bypass: ShieldAlert, autopilot: RefreshCw };

interface Props {
  preset?: PermissionPreset;
  language: 'zh' | 'en';
  disabled: boolean;
  supported: boolean;
  onSelect: (preset: PermissionPreset) => Promise<unknown>;
}

export function PermissionPicker({ preset, language, disabled, supported, onSelect }: Props) {
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
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (disabled || !supported) setOpen(false); }, [disabled, supported]);
  const active = presets.find(item => item.id === preset);
  const ActiveIcon = preset ? icons[preset] : Shield;
  return <div className="permission-picker" ref={root}>
    <button ref={trigger} type="button" className={`permission-trigger${preset ? ` permission-${preset}` : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={zh ? '访问权限' : 'Access permissions'} data-tooltip={!supported ? (zh ? '当前运行时不支持权限切换' : 'Permission switching unavailable') : undefined} disabled={disabled || !supported || pending} onClick={() => setOpen(value => !value)}>
      <ActiveIcon size={16}/><span>{active ? (zh ? active.zh : active.en) : (zh ? '访问权限' : 'Permissions')}</span>
    </button>
    {open && <div className="permission-menu" role="menu" aria-label={zh ? '访问权限' : 'Access permissions'}>
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
