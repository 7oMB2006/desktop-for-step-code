import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Moon, RotateCw, Sun } from 'lucide-react';
import { SessionSearchPanel } from '../../src/SessionSearchPanel';
import { ConversationSearchLocation } from '../../src/ConversationSearchLocation';
import { ConversationMessages } from '../../src/ConversationMessages';
import { ScheduledTaskSelect } from '../../src/ScheduledTasks';
import { applyTheme } from '../../src/theme';
import { searchTerms } from '../../src/fulltext-search';
import { scrollSearchMessage } from '../../src/search-location';
import type { FulltextHit, SearchLocation } from '../../src/fulltext-search';
import type { DesktopBridge, Preferences, SessionReading } from '../../src/contracts';
import { conversations, sidebarPreferences, sidebarSessions } from './fulltext-search-data';
import '../../src/style.css';
import '../../src/theme.css';
import './fulltext-search-native.css';

window.desktop = { platform: 'win32', copyText: text => navigator.clipboard.writeText(text) } as DesktopBridge;

function Preview() {
  const params = new URLSearchParams(location.search);
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [scenario, setScenario] = useState('ready');
  const [active, setActive] = useState(true);
  const [request, setRequest] = useState({ id: 1, text: params.get('q') ?? '计费' });
  const [opened, setOpened] = useState<SessionReading | null>(null);
  const [locationTarget, setLocationTarget] = useState<SearchLocation>();
  const [locateRequest, setLocateRequest] = useState(0);
  const [returnRequest, setReturnRequest] = useState(0);
  const transcript = useRef<HTMLDivElement>(null);
  const locate = useCallback((target: HTMLElement, match?: DOMRect) => {
    const viewport = transcript.current?.parentElement;
    if (viewport) scrollSearchMessage(viewport, target, match);
  }, []);
  const preferences: Preferences = { ...sidebarPreferences, theme: dark ? 'dark' : 'light' };
  useEffect(() => applyTheme(dark ? 'original-dark' : 'original-light', dark), [dark]);
  const bridge = useMemo<Pick<DesktopBridge, 'searchSessions' | 'cancelSessionSearch' | 'sessionReading'>>(() => ({
    cancelSessionSearch: async () => {},
    searchSessions: async query => {
      await new Promise(resolve => setTimeout(resolve, 180));
      if (scenario === 'error') throw new Error('Fixture failure');
      const terms = searchTerms(query.text);
      const expression = new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|'), 'giu');
      const hits = conversations.flatMap(conversation => {
        const session = sidebarSessions.find(item => item.id === conversation.id)!;
        const timestamp = Date.parse(conversation.date);
        if (!query.includeArchived && conversation.archived || query.project && session.cwd !== query.project
          || query.since && timestamp < query.since) return [];
        return conversation.messages.flatMap(message => terms.every(term => message.text.toLowerCase().includes(term)) ? [{
          sessionId: session.id, entryId: scenario === 'degraded' ? null : message.id,
          timestamp, role: message.role, snippet: message.text.replace(expression, match => `\u0002${match}\u0003`),
        } satisfies FulltextHit] : []);
      });
      return { id: query.id, hits, limited: false, limit: 100, shortQuery: terms.some(term => [...term].length < 3),
        sessionOnly: scenario === 'degraded',
        index: { state: scenario === 'partial' ? 'backfilling' : scenario === 'degraded' ? 'degraded' : 'ready',
          indexed: scenario === 'partial' ? 4 : 7, total: 7, pending: scenario === 'partial' ? 3 : 0, errors: 0 } };
    },
    sessionReading: async id => {
      const conversation = conversations.find(item => item.id === id);
      return conversation ? { sessionId: id, version: 'fixture', messages: conversation.messages.map(message => ({
        entryId: message.id, role: message.role, content: [{ type: 'text', text: message.text }],
        timestamp: Date.parse(conversation.date),
      })) } : null;
    },
  }), [scenario]);
  return <div className="fulltext-native-preview">
    <div className="fulltext-native-toolbar"><span>实际组件预览 · 示例数据</span><div>
      <ScheduledTaskSelect label="预览状态" value={scenario}
        options={[{ id: 'ready', label: '正常' }, { id: 'partial', label: '索引建立中' }, { id: 'degraded', label: '索引不可用' }, { id: 'error', label: '查询失败' }]}
        onChange={value => { setScenario(value); setActive(true); setRequest(value => ({ ...value, id: value.id + 1 })); }}/>
      <button className="icon-button" aria-label="切换主题" data-tooltip="切换主题" onClick={() => setDark(value => !value)}>{dark ? <Sun size={16}/> : <Moon size={16}/>}</button>
    </div></div>
    <SessionSearchPanel active={active} request={request} returnRequest={returnRequest} bridge={bridge} sessions={sidebarSessions} preferences={preferences}
      onClose={() => setActive(false)} onOpen={async (session, target) => {
        setOpened(await bridge.sessionReading(session.id)); setLocationTarget(target);
        setLocateRequest(value => value + 1); setActive(false); return true;
      }} openImage={() => {}}/>
    <div className="fulltext-native-conversation" hidden={active || !opened}>
      <ConversationSearchLocation active={!active} location={locationTarget} requestId={locateRequest}
        sessionId={opened?.sessionId} messages={opened?.messages ?? []} root={transcript} language="zh"
        onLocate={locate}
        onRetry={() => setLocateRequest(value => value + 1)} onDismiss={() => setLocationTarget(undefined)}
        onReturn={() => { setReturnRequest(value => value + 1); setActive(true); }}/>
      <div className="conversation"><div className="messages" ref={transcript}>
        {opened && <ConversationMessages messages={opened.messages} language="zh" busy={false} canEdit={false}
          openImage={() => {}} edit={async () => {}} branch={() => {}} onError={() => {}} onOpenSubagent={() => {}}/>}
      </div></div>
    </div>
    {!active && !opened && <div className="fulltext-native-closed"><button onClick={() => {
      setActive(true); setRequest(value => ({ ...value, id: value.id + 1 }));
    }}><RotateCw size={15}/>重新打开搜索</button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
