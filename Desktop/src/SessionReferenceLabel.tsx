import { createContext, useContext, type ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import './message-link.css';

export const SessionReferenceTitles = createContext<ReadonlyMap<string, string> | undefined>(undefined);

export function SessionReferenceLabel({ id, fallback }: { id: string; fallback?: ReactNode }) {
  const title = useContext(SessionReferenceTitles)?.get(id);
  return title ? <span className="session-reference-label"><MessageSquare size={14} aria-hidden="true"/>{title}</span> : <>{fallback}</>;
}
