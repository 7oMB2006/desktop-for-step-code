import { useCallback, useId, useRef, useState, type PointerEventHandler, type ReactNode } from 'react';
import { ExternalLink, FolderOpen, GitBranch, MessagesSquare, Pin, PinOff, Plus, X } from 'lucide-react';
import { AppMenu } from './AppMenu';
import { DisclosureChevron } from './DisclosureChevron';
import './mini-chat.css';

export type MiniChatSession = { id: string; title: string; project?: string; branch?: string };

export function MiniChatFrame({ language, session, sessions, pinned, onPinned, onSession, onReturn, onClose, onNewSession,
  onDragStart, children }: {
  language: 'zh' | 'en'; session: MiniChatSession; sessions: MiniChatSession[]; pinned: boolean;
  onPinned: (pinned: boolean) => void; onSession: (id: string) => void;
  onReturn: () => void; onClose: () => void; onDragStart?: PointerEventHandler<HTMLElement>;
  onNewSession?: () => void;
  children: ReactNode;
}) {
  const zh = language === 'zh';
  const heading = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [switching, setSwitching] = useState(false);
  const closeMenu = useCallback(() => setSwitching(false), []);
  return <section className="mini-chat-frame" aria-labelledby={heading}>
    <header className="mini-chat-header" onPointerDown={onDragStart}>
      <img className="mini-chat-mark" src={location.protocol === 'file:' ? './StepCode.svg' : '/StepCode.svg'} width="19" height="19" alt="" draggable={false}/>
      <button ref={trigger} type="button" className="mini-chat-session" aria-haspopup="menu"
        aria-expanded={switching} aria-label={zh ? '切换小窗会话' : 'Switch MiniChat conversation'}
        onClick={() => setSwitching(value => !value)}>
        <span className="mini-chat-session-copy">
          <strong id={heading} data-tooltip={session.title}>{session.title}</strong>
          <span className="mini-chat-project">
            {session.project && <span><FolderOpen size={11}/>{session.project}</span>}
            {session.branch && <span><GitBranch size={11}/>{session.branch}</span>}
          </span>
        </span>
        <DisclosureChevron/>
      </button>
      <div className="mini-chat-window-actions">
        <button type="button" className="icon-button" aria-pressed={pinned}
          aria-label={pinned ? zh ? '取消置顶' : 'Unpin window' : zh ? '置顶窗口' : 'Pin window'}
          data-tooltip={pinned ? zh ? '取消置顶' : 'Unpin window' : zh ? '置顶窗口' : 'Pin window'}
          onClick={() => onPinned(!pinned)}>{pinned ? <Pin size={15}/> : <PinOff size={15}/>}</button>
        <button type="button" className="icon-button" aria-label={zh ? '回到主窗口' : 'Return to main window'}
          data-tooltip={zh ? '回到主窗口' : 'Return to main window'} onClick={onReturn}><ExternalLink size={16}/></button>
        <button type="button" className="icon-button mini-chat-close" aria-label={zh ? '关闭小窗' : 'Close MiniChat'}
          data-tooltip={zh ? '关闭小窗' : 'Close MiniChat'} onClick={onClose}><X size={16}/></button>
      </div>
    </header>
    <AppMenu anchor={trigger} open={switching} label={zh ? '小窗会话' : 'MiniChat conversations'}
      items={[...(onNewSession ? [{ id: '__new__', label: zh ? '新会话' : 'New session', icon: <Plus size={15}/> }] : []),
        ...sessions.map(item => ({ id: item.id, label: item.title, icon: <MessagesSquare size={15}/> }))]}
      selected={session.id} onSelect={id => { if (id === '__new__') onNewSession?.(); else onSession(id); }} onClose={closeMenu} maxVisibleItems={8}/>
    <div className="mini-chat-content">{children}</div>
  </section>;
}
