import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AlertCircle, ArrowLeft, LocateFixed, Search, X } from 'lucide-react';
import type { Message } from './contracts';
import type { SearchLocation } from './fulltext-search';
import { markSearchMessage, revealSearchHighlight, searchMessageElement } from './search-location';
import { afterConversationLayout } from './conversation-layout';

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
  const [matched, setMatched] = useState(false);
  const located = useRef<{ location: SearchLocation; requestId: number } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!visible || !location) return;
    const target = searchMessageElement(root.current, index, location.text);
    setRendered(Boolean(target));
    const marker = target ? markSearchMessage(target, location.text, 'desktop-conversation-search-match') : undefined;
    setMatched(Boolean(marker?.matched));
    return marker?.cleanup;
  }, [visible, location, requestId, messages, index, root]);
  useLayoutEffect(() => {
    if (!visible || !location) return;
    const target = searchMessageElement(root.current, index, location.text);
    if (!target) return;
    const tabIndex = target.getAttribute('tabindex');
    target.tabIndex = -1;
    let cancel = () => {};
    if (located.current?.location !== location || located.current.requestId !== requestId) {
      cancel = afterConversationLayout(root.current, () => {
        const current = searchMessageElement(root.current, index, location.text);
        if (!current) return;
        located.current = { location, requestId };
        onLocate(current, revealSearchHighlight('desktop-conversation-search-match'));
        current.focus({ preventScroll: true });
      });
    }
    return () => {
      cancel();
      if (tabIndex === null) target.removeAttribute('tabindex');
      else target.setAttribute('tabindex', tabIndex);
    };
  }, [visible, location, requestId, index, root, onLocate]);
  if (!visible || !location) return null;
  const found = index >= 0 && rendered;
  return <div className="conversation-search-location" aria-label={zh ? '搜索定位' : 'Search location'}>
    <button onClick={onReturn}><ArrowLeft size={14}/><span>{zh ? '返回搜索结果' : 'Back to results'}</span></button>
    <span className="conversation-search-location-status" role="status">{found && matched ? <Search size={14}/> : <AlertCircle size={14}/>}
      <span>{found ? matched ? (zh ? '已定位搜索消息' : 'Search message located')
        : (zh ? '已找到消息，但当前可见正文没有匹配关键词' : 'Message found; the query is not in the visible text')
        : location.entryId === null ? (zh ? '会话级匹配，无法定位具体消息' : 'Conversation-level match; no message location')
          : (zh ? '命中消息已不在当前上下文中' : 'The matched message is no longer in the current context')}</span>
    </span>
    {location.entryId !== null && <button onClick={onRetry}><LocateFixed size={14}/><span>{zh ? '重新定位' : 'Locate again'}</span></button>}
    <button className="icon-button" aria-label={zh ? '关闭搜索定位' : 'Dismiss search location'}
      data-tooltip={zh ? '关闭搜索定位' : 'Dismiss search location'} onClick={onDismiss}><X size={14}/></button>
  </div>;
}
