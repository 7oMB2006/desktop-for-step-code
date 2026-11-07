import { useCallback, useId, useRef, useState, type PointerEventHandler, type ReactNode } from 'react';
import { ExternalLink, FolderOpen, GitBranch, MessagesSquare, Pin, PinOff, X } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { MiniChatSessionPicker } from './MiniChatSessionPicker';
import { MINI_INDEPENDENT_PROJECT, type MiniChatProject, type MiniChatSession } from './mini-chat-sessions';
import './mini-chat.css';

export type { MiniChatSession } from './mini-chat-sessions';

export function MiniChatFrame({ language, session, projects, sessions, pinned, onPinned, onSession, onReturn, onClose, onNewSession,
  onDragStart, children }: {
  language: 'zh' | 'en'; session: MiniChatSession; projects: MiniChatProject[]; sessions: MiniChatSession[]; pinned: boolean;
  onPinned: (pinned: boolean) => void; onSession: (id: string) => void;
  onReturn: () => void; onClose: () => void; onDragStart?: PointerEventHandler<HTMLElement>;
  onNewSession?: (project: string) => void;
  children: ReactNode;
}) {
  const zh = language === 'zh';
  const heading = useId();
  const pickerId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [switching, setSwitching] = useState(false);
  const closeMenu = useCallback(() => setSwitching(false), []);
  return <section className="mini-chat-frame" aria-labelledby={heading}>
    <header className="mini-chat-header" onPointerDown={onDragStart}>
      <img className="mini-chat-mark" src={location.protocol === 'file:' ? './StepCode.svg' : '/StepCode.svg'} width="19" height="19" alt="" draggable={false}/>
      <button ref={trigger} type="button" className="mini-chat-session" aria-haspopup="dialog" aria-controls={switching ? pickerId : undefined}
        aria-expanded={switching} aria-label={zh ? '切换小窗会话' : 'Switch MiniChat conversation'}
        onClick={() => setSwitching(value => !value)}>
        <span className="mini-chat-session-copy">
          <strong id={heading} data-tooltip={session.title}>{session.title}</strong>
          <span className="mini-chat-project">
            {session.project && <span>{session.projectId === MINI_INDEPENDENT_PROJECT ? <MessagesSquare size={11}/> : <FolderOpen size={11}/>}<span>{session.project}</span></span>}
            {session.branch && <span><GitBranch size={11}/><span>{session.branch}</span></span>}
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
    <MiniChatSessionPicker id={pickerId} anchor={trigger} open={switching} session={session} projects={projects} sessions={sessions}
      language={language} onSelect={onSession} onCreate={onNewSession} onClose={closeMenu}/>
    <div className="mini-chat-content">{children}</div>
  </section>;
}
