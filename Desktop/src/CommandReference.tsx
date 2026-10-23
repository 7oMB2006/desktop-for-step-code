import { createContext } from 'react';
import { commandPresentation } from './command-presentation';
import { commandRanges } from './command-references';
import type { ComposerCommand } from './composer-commands';
import './command-reference.css';

export const CommandCatalog = createContext<ComposerCommand[]>([]);
export function commandReference(text: string, commands: ComposerCommand[]) {
  const range = commandRanges(text, commands)[0];
  if (range?.from !== 0) return;
  return { name: range.name, source: range.source, length: range.to };
}
export function CommandReference({ name, source }: { name: string; source?: string }) {
  const { Icon } = commandPresentation({ name, source }, false);
  return <span className="command-reference"><span className="command-reference-icon"><Icon aria-hidden="true"/></span><span>{name}</span></span>;
}
