import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Globe } from 'lucide-react';
import type { LinkPreview } from './contracts';
import { FileOpeningContext } from './FileOpening';
import './message-link.css';

const previews = new Map<string, Promise<LinkPreview>>();
const requests: (() => void)[] = [];
let activeRequests = 0;
function drain() {
  while (activeRequests < 3 && requests.length) { activeRequests++; requests.shift()!(); }
}
function load(url: string) {
  let result = previews.get(url);
  if (!result) {
    result = new Promise<LinkPreview>(resolve => {
      requests.push(() => {
        const request = window.desktop?.linkPreview(url) ?? Promise.resolve({ url });
        void request.catch(() => ({ url })).then(resolve).finally(() => { activeRequests--; drain(); });
      });
      drain();
    });
    if (previews.size >= 128) previews.delete(previews.keys().next().value!);
    previews.set(url, result);
  }
  return result;
}
export function MessageLink({ href, children, language }: { href?: string; children: ReactNode; language: 'zh' | 'en' }) {
  const opening = useContext(FileOpeningContext);
  const anchor = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [preview, setPreview] = useState<LinkPreview>();
  const [iconFailed, setIconFailed] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId();
  let url: URL | undefined;
  try { const parsed = new URL(href ?? ''); if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed; } catch { /* Non-web links retain normal navigation. */ }
  const address = url?.href;
  useEffect(() => { setPreview(undefined); setIconFailed(false); setOpen(false); }, [address]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    const exit = setTimeout(() => setPresent(false), 160);
    return () => clearTimeout(exit);
  }, [open]);
  useEffect(() => {
    if (!address || !open) return;
    let mounted = true;
    void load(address).then(value => { if (mounted) setPreview(value); });
    return () => { mounted = false; };
  }, [address, open]);
  useLayoutEffect(() => {
    if (!present) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(344, window.innerWidth - 24);
      const height = 170;
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: rect.bottom + height + 12 > window.innerHeight ? Math.max(12, rect.top - height - 8) : rect.bottom + 8 });
    };
    place();
    const close = () => setOpen(false);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', key); };
  }, [present]);
  if (!address) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  const enter = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 280); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 180); };
  const openBrowser = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault(); setOpen(false);
    void opening.openWeb(address).catch(error => opening.onError(String(error.message ?? error)));
  };
  const icon = preview?.icon && !iconFailed ? <img className="message-link-icon" src={preview.icon} alt="" onError={() => setIconFailed(true)}/> : <Globe size={14} aria-hidden="true"/>;
  return <>
    <a ref={anchor} className="message-link" href={address} target="_blank" rel="noreferrer" aria-describedby={open ? id : undefined}
      onClick={openBrowser} onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}>
      <span className="message-link-site" aria-hidden="true">{icon}</span><span className="message-link-label">{children}</span>
    </a>
    {present && createPortal(<aside id={id} className={`link-preview${open ? '' : ' is-closing'}`} aria-hidden={!open} inert={!open} aria-label={language === 'zh' ? '链接预览' : 'Link preview'}
      style={position} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={leave}
      onFocus={() => clearTimeout(timer.current)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) leave(); }}>
      <div className="link-preview-top"><span className="link-preview-host">{icon}<span>{url!.hostname}</span></span>
        <a href={address} onClick={openBrowser}>{language === 'zh' ? '打开' : 'Open'}</a>
        <a href={address} target="_blank" rel="noreferrer" aria-label={language === 'zh' ? '在外部浏览器打开' : 'Open in external browser'}><ExternalLink size={13}/></a></div>
      <div className="link-preview-body"><strong>{preview?.title || (typeof children === 'string' && children !== address ? children : url!.hostname)}</strong>
        {preview?.description ? <p>{preview.description}</p> : preview ? <p className="link-preview-address">{url!.pathname === '/' ? url!.origin : `${url!.origin}${url!.pathname}`}</p>
          : <div className="link-preview-loading" aria-label={language === 'zh' ? '正在获取网页信息' : 'Loading page details'}><span/><span/></div>}
      </div>
    </aside>, document.body)}
  </>;
}
