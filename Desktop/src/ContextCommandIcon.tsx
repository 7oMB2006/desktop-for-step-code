import { createContext, useContext } from 'react';
import type { LucideProps } from 'lucide-react';
import { ContextRing } from './ContextRing';
import type { SessionStats } from './contracts';

export const CommandContextUsage = createContext<{ usage?: SessionStats['contextUsage']; language: 'zh' | 'en' }>({ language: 'zh' });

function ContextCommandIcon({ kind, size = 16, className, color, style }: LucideProps & { kind: 'com' | 'clm' }) {
  const { usage, language } = useContext(CommandContextUsage);
  const dimension = typeof size === 'number' ? `${size}px` : size;
  return <span className={`context-command-icon ${className ?? ''}`} aria-hidden="true"
    style={{ color, ...style, width: `calc(${dimension} + 7px)`, height: `calc(${dimension} + 6px)` }}>
    <ContextRing usage={usage} language={language} decorative />
    <span className="context-command-badge">{kind === 'com' ? 'o' : 'l'}</span>
  </span>;
}

export const CompactContextIcon = (props: LucideProps) => <ContextCommandIcon {...props} kind="com" />;
export const WorkingContextIcon = (props: LucideProps) => <ContextCommandIcon {...props} kind="clm" />;
export const OrganizeContextIcon = (props: LucideProps) => <ContextCommandIcon {...props} kind="clm" />;
