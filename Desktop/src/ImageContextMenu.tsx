import { useLayoutEffect, useRef } from 'react';
import { Copy, Download, FolderOpen, MessageSquarePlus } from 'lucide-react';

export type ImageMenuAction = 'add' | 'copy' | 'save' | 'reveal';
export interface ImageMenuTarget { src: string; name: string; x: number; y: number; transcript: boolean; anchor: HTMLElement }

export function ImageContextMenu({ target, language, canAdd, onAction, onClose }: {
  target: ImageMenuTarget; language: 'zh' | 'en'; canAdd: boolean;
  onAction: (action: ImageMenuAction) => void; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  useLayoutEffect(() => {
    const element = menu.current!;
    const previous = document.activeElement as HTMLElement | null;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(target.x, innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(target.y, innerHeight - bounds.height - 8))}px`;
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => { if (!element.contains(event.target as Node)) onClose(); };
    const reposition = () => onClose();
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      const restore = target.anchor.tabIndex >= 0 ? target.anchor : previous;
      if (restore?.isConnected) restore.focus({ preventScroll: true });
    };
  }, [target]);
  return <div ref={menu} className="sidebar-context image-context" role="menu" aria-label={t('图片操作', 'Image actions')}
    style={{ left: target.x, top: target.y }} onPointerDown={e => e.stopPropagation()}
    onKeyDown={e => {
      e.stopPropagation();
      const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}>
    {target.transcript && <button role="menuitem" disabled={!canAdd} onClick={() => onAction('add')}><MessageSquarePlus size={15}/>{t('添加到聊天', 'Add to chat')}</button>}
    <button role="menuitem" onClick={() => onAction('copy')}><Copy size={15}/>{target.transcript ? t('复制图像', 'Copy image') : t('复制', 'Copy')}</button>
    {target.transcript && <button role="menuitem" onClick={() => onAction('reveal')}><FolderOpen size={15}/>{t('在资源管理器中打开', 'Open in Explorer')}</button>}
    <button role="menuitem" onClick={() => onAction('save')}><Download size={15}/>{target.transcript ? t('下载副本', 'Download a copy') : t('另存为', 'Save As')}</button>
  </div>;
}
