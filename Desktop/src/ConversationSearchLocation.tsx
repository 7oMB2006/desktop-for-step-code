import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AlertCircle, ArrowLeft, LocateFixed, Search, X } from 'lucide-react';
import type { Message } from './contracts';
import type { SearchLocation } from './fulltext-search';
import { markSearchMessage, searchHighlightRect, searchMessageElement } from './search-location';

export function ConversationSearchLocation({ active, location, requestId, sessionId, messages, root, language,
  onLocate, onRetry, onReturn, onDismiss }: {
  active: boolean; location?: SearchLocation; requestId: number; sessionId?: string; messages: Message[];
  root: RefObject<HTMLDivElement | null>; language: 'zh' | 'en';
  onLocate: (target: HTMLElement, match?: DOMRect) => void; onRetry: () => void; onReturn: () => void; onDismiss: () => void;
}) {
  const zh = language === 'zh';
  const visible = active && location?.sessionId === sessionId;
  const index = location?.entryId ? messages.findIndex(message => message.entryId === location.entryId) : -1;
  const [rendered, setRendered] = useState(false);
  const located = useRef<{ location: SearchLocation; requestId: number } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!visible || !location) return;
    const target = searchMessageElement(root.current, index);
    setRendered(Boolean(target));
    if (!target) return;
    return markSearchMessage(target, location.text, 'desktop-conversation-search-match');
  }, [visible, location, messages, index, root]);
  useLayoutEffect(() => {
    if (!visible || !location) return;
    const target = searchMessageElement(root.current, index);
    if (!target) return;
    const tabIndex = target.getAttribute('tabindex');
    target.tabIndex = -1;
    if (located.current?.location !== location || located.current.requestId !== requestId) {
      located.current = { location, requestId };
      onLocate(target, searchHighlightRect('desktop-conversation-search-match'));
      target.focus({ preventScroll: true });
    }
    return () => {
      if (tabIndex === null) target.removeAttribute('tabindex');
      else target.setAttribute('tabindex', tabIndex);
    };
  }, [visible, location, requestId, index, root, onLocate]);
  if (!visible || !location) return null;
  const found = index >= 0 && rendered;
  return <div className="conversation-search-location" aria-label={zh ? '搜索定位' : 'Search location'}>
    <button onClick={onReturn}><ArrowLeft size={14}/><span>{zh ? '返回搜索结果' : 'Back to results'}</span></button>
    <span className="conversation-search-location-status" role="status">{found ? <Search size={14}/> : <AlertCircle size={14}/>}
      <span>{found ? (zh ? '已定位搜索消息' : 'Search message located')
        : location.entryId === null ? (zh ? '会话级匹配，无法定位具体消息' : 'Conversation-level match; no message location')
          : (zh ? '命中消息已不在当前上下文中' : 'The matched message is no longer in the current context')}</span>
    </span>
    {location.entryId !== null && <button onClick={onRetry}><LocateFixed size={14}/><span>{zh ? '重新定位' : 'Locate again'}</span></button>}
    <button className="icon-button" aria-label={zh ? '关闭搜索定位' : 'Dismiss search location'}
      data-tooltip={zh ? '关闭搜索定位' : 'Dismiss search location'} onClick={onDismiss}><X size={14}/></button>
  </div>;
}
