import { createContext } from 'react';
import { BookOpen, Command, Plug } from 'lucide-react';
import type { ComposerCommand } from './composer-commands';
import './command-reference.css';

export const CommandCatalog = createContext<ComposerCommand[]>([]);
export function commandReference(text: string, commands: ComposerCommand[]) {
  const match = /^\/([^\s/]+)(?=\s|$)/.exec(text);
  if (!match) return;
  const command = commands.find(item => item.name === match[1]);
  if (!command && !['clm', 'clm-compact', 'plugin'].includes(match[1])) return;
  return { name: match[1], source: command?.source, length: match[0].length };
}
export function CommandReference({ name, source }: { name: string; source?: string }) {
  const Icon = source === 'skill' ? BookOpen : name === 'plugin' ? Plug : Command;
  return <span className="command-reference"><span className="command-reference-icon"><Icon aria-hidden="true"/></span><span>{name}</span></span>;
}
