import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
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

// Keep the native textarea (selection, IME, clipboard and command transport)
// authoritative. Only its command prefix receives a visual overlay.
export function ComposerCommandReference({ draft }: { draft: string }) {
  const commands = useContext(CommandCatalog);
  const reference = commandReference(draft, commands);
  const anchor = useRef<HTMLSpanElement>(null);
  const [geometry, setGeometry] = useState<{ left: number; top: number; width: number; height: number; font: string; visible: boolean }>();
  useLayoutEffect(() => {
    const parent = anchor.current?.parentElement;
    const input = parent?.querySelector('textarea');
    if (!input || !reference) { setGeometry(undefined); return; }
    const originalIndent = input.style.textIndent;
    const measure = () => {
      const style = getComputedStyle(input);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      context.font = style.font;
      const width = context.measureText(`/${reference.name}`).width;
      const slashWidth = context.measureText('/').width;
      const iconSpace = parseFloat(style.fontSize) * 1.15;
      const outset = iconSpace - slashWidth;
      // Reserve the wider icon on the first line without moving its anchor left.
      input.style.textIndent = `${outset}px`;
      const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setGeometry({ left: input.offsetLeft + parseFloat(style.paddingLeft), top: input.offsetTop + parseFloat(style.paddingTop),
        width: width + outset, font: style.font, height: parseFloat(style.lineHeight), visible: input.scrollTop === 0 && width + outset <= available
          && (document.activeElement !== input || input.selectionStart >= reference.length && input.selectionStart === input.selectionEnd) });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    input.addEventListener('scroll', measure);
    document.addEventListener('selectionchange', measure);
    measure();
    return () => { observer.disconnect(); input.removeEventListener('scroll', measure); document.removeEventListener('selectionchange', measure); input.style.textIndent = originalIndent; };
  }, [draft, reference?.name]);
  return <span ref={anchor} className="composer-command-reference" aria-hidden="true"
    style={{ left: geometry?.left, top: geometry?.top, width: geometry?.width, height: geometry?.height, font: geometry?.font,
      visibility: reference && geometry?.visible ? 'visible' : 'hidden' }}>
    {reference && <CommandReference {...reference}/>}
  </span>;
}
