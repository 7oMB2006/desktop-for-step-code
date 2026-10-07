import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Globe, AppWindow } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { AppMenu } from './AppMenu';
import type { FileOpeningOptions, FileTarget } from './contracts';
import './file-opening.css';

export const FileOpeningContext = createContext<{
  openFile: (target?: FileTarget, destination?: string) => Promise<void>;
  openWeb: (url: string) => Promise<void>;
  onError: (message: string) => void;
}>({
  openFile: async () => { throw new Error('File opening is unavailable'); },
  openWeb: async () => { throw new Error('Browser opening is unavailable'); },
  onError: () => {},
});
export function FileOpenButton({ target, kind, language, onError, disabled = false }: {
  target: FileTarget; kind?: string; language: 'zh' | 'en'; onError: (message: string) => void; disabled?: boolean;
}) {
  const { openFile } = useContext(FileOpeningContext);
  const [options, setOptions] = useState<FileOpeningOptions>();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const key = JSON.stringify(target);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    let live = true;
    setOptions(undefined); setMenuOpen(false);
    const load = () => {
      void window.desktop?.fileOpenOptions(JSON.parse(key)).then(value => { if (live) setOptions(value); })
        .catch(error => { if (live) onError(String(error instanceof Error ? error.message : error)); });
    };
    load();
    window.addEventListener('file-opening-choice', load);
    return () => { live = false; window.removeEventListener('file-opening-choice', load); };
  }, [key, onError]);
  const choice = options?.choices.find(item => item.id === options.selected);
  const zh = language === 'zh';
  const label = choice?.label ?? (kind === 'website' ? (zh ? '内置浏览器' : 'Built-in browser') : (zh ? '文件预览' : 'File preview'));
  const run = async (destination?: string) => {
    setBusy(true);
    try {
      await openFile(target, destination);
      window.dispatchEvent(new Event('file-opening-choice'));
    }
    catch (error) { onError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  return <div className="file-open-control">
    <button type="button" disabled={disabled || busy || !options} onClick={() => void run(choice?.id)}>
      {choice?.icon ? <img src={choice.icon} alt=""/> : kind === 'website' && (!choice || choice.id === 'internal') ? <Globe size={14}/> : choice && choice.id !== 'internal' ? <ExternalLink size={14}/> : <FileText size={14}/>}
      <span>{label}</span>
    </button>
    <button ref={trigger} type="button" className="file-open-options" aria-label={zh ? '选择打开方式' : 'Choose how to open'}
      aria-haspopup="menu" aria-expanded={menuOpen}
      data-tooltip={zh ? '选择打开方式' : 'Choose how to open'} disabled={disabled || busy || !options}
      onClick={() => setMenuOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setMenuOpen(true); } }}><DisclosureChevron/></button>
    <AppMenu anchor={trigger} open={menuOpen && !disabled} label={zh ? '打开方式' : 'Open with'} selected={choice?.id}
      items={(options?.choices ?? []).map(item => ({ ...item, icon: item.icon ? <img src={item.icon} alt=""/>
        : item.id === 'internal' ? kind === 'website' ? <Globe/> : <FileText/>
        : item.id === 'other' ? <AppWindow/> : <ExternalLink/> }))}
      onClose={closeMenu} onSelect={id => void run(id)}/>
  </div>;
}
