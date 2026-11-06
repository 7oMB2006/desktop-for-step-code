import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Archive, ArrowLeft, ArrowRight, Folder, LoaderCircle, MessageSquare, RotateCw, Search, TextSearch, X } from 'lucide-react';
import type { DesktopBridge, Preferences, Session, SessionReading } from './contracts';
import type { FulltextHit, FulltextResult, SearchLocation } from './fulltext-search';
import { snippetParts } from './fulltext-search';
import { markSearchMessage, revealSearchHighlight, scrollSearchMessage, searchMessageElement } from './search-location';
import { normalizedWorkspaceKey } from './workspace-key';
import { ScheduledTaskSelect } from './ScheduledTasks';
import { ConversationMessages } from './ConversationMessages';
import { normalizeInterfaceSettings } from './interface-presets';
import './fulltext-search.css';

type SearchBridge = Pick<DesktopBridge, 'searchSessions' | 'cancelSessionSearch' | 'sessionReading'>;
interface Props {
  active: boolean;
  request: { id: number; text: string };
  returnRequest?: number;
  bridge: SearchBridge;
  sessions: Session[];
  preferences: Preferences;
  onClose: () => void;
  onOpen: (session: Session, location: SearchLocation) => Promise<boolean>;
  openImage: (src: string, name: string, anchor: HTMLElement) => void;
}

export function SessionSearchPanel({ active, request, returnRequest = 0, bridge, sessions, preferences, onClose, onOpen, openImage }: Props) {
  const zh = preferences.language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const [text, setText] = useState(request.text);
  const [project, setProject] = useState('');
  const [range, setRange] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [result, setResult] = useState<FulltextResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [visible, setVisible] = useState(30);
  const [selected, setSelected] = useState<FulltextHit>();
  const [reading, setReading] = useState<SessionReading | null>();
  const [previewError, setPreviewError] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewMatched, setPreviewMatched] = useState(false);
  const [opening, setOpening] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);
  const focusKey = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const previousQuery = useRef('');
  const known = new Map(sessions.map(session => [session.id, session]));
  const archived = new Set(preferences.archivedSessionIds);
  const key = (path: string) => normalizedWorkspaceKey(path, window.desktop?.platform ?? 'win32');
  const projects = [...new Map(sessions.map(session => {
    const path = session.workspacePath ?? session.cwd;
    return [key(path), path];
  })).values()];
  const projectLabel = (path: string) => preferences.workspaceNames?.[key(path)] ?? path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
  const hits = result?.hits.filter(hit => known.has(hit.sessionId) && (includeArchived || !archived.has(hit.sessionId))) ?? [];
  const groups = new Map<string, FulltextHit[]>();
  for (const hit of hits.slice(0, visible)) groups.set(hit.sessionId, [...groups.get(hit.sessionId) ?? [], hit]);
  const previewSession = selected && known.get(selected.sessionId);
  const matchIndex = selected?.entryId && reading ? reading.messages.findIndex(message => message.entryId === selected.entryId) : -1;
  const interfaceSettings = useMemo(() => normalizeInterfaceSettings(preferences.interfaceSettings), [preferences.interfaceSettings]);
  const hitKey = (hit: FulltextHit) => JSON.stringify([hit.sessionId, hit.entryId]);
  const returnToResults = useCallback(() => {
    previewGeneration.current++; setSelected(undefined); setReading(undefined); setPreviewBusy(false);
  }, []);
  useEffect(() => {
    if (returnRequest) returnToResults();
  }, [returnRequest, returnToResults]);

  useEffect(() => {
    previewGeneration.current++; setPreviewBusy(false); setPreviewError('');
    setText(request.text); setSelected(undefined); setReading(undefined);
    scrollPosition.current = 0; focusKey.current = undefined;
  }, [request.id]);
  useEffect(() => {
    if (!active) { previewGeneration.current++; return; }
    const run = ++generation.current;
    let queryId: string | undefined;
    let disposed = false;
    const signature = JSON.stringify([text, project, range, includeArchived, request.id]);
    if (previousQuery.current !== signature) {
      previousQuery.current = signature;
      setResult(undefined); setVisible(30);
      scrollPosition.current = 0; focusKey.current = undefined;
      if (list.current) list.current.scrollTop = 0;
    }
    setBusy(Boolean(text.trim()));
    setError('');
    const timer = window.setTimeout(async () => {
      if (!text.trim()) { setBusy(false); return; }
      queryId = crypto.randomUUID();
      try {
        const next = await bridge.searchSessions({ id: queryId, text,
          project: project || undefined, includeArchived,
          since: range ? Date.now() - Number(range) * 86400000 : undefined });
        if (!disposed && run === generation.current && !next.cancelled) setResult(next);
      } catch { if (!disposed && run === generation.current) setError(t('暂时无法查询，关键词与筛选已保留。', 'Search is unavailable. Your query and filters are retained.')); }
      finally { if (!disposed && run === generation.current) setBusy(false); }
    }, 220);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (queryId) void bridge.cancelSessionSearch(queryId).catch(() => {});
    };
  }, [active, text, project, range, includeArchived, revision, request.id]);
  useEffect(() => {
    if (!active || selected || result?.index.state !== 'backfilling') return;
    const timer = window.setTimeout(() => setRevision(value => value + 1), 1800);
    return () => window.clearTimeout(timer);
  }, [active, selected, result]);
  useLayoutEffect(() => {
    if (!active || selected) return;
    if (list.current) list.current.scrollTop = scrollPosition.current;
    const target = focusKey.current && [...list.current?.querySelectorAll<HTMLElement>('[data-search-key]') ?? []]
      .find(element => element.dataset.searchKey === focusKey.current);
    if (target) target.focus({ preventScroll: true });
    else input.current?.focus();
  }, [active, selected, request.id]);
  useLayoutEffect(() => {
    if (active && selected) back.current?.focus({ preventScroll: true });
  }, [active, selected]);
  useEffect(() => {
    if (selected && !sessions.some(session => session.id === selected.sessionId)) {
      previewGeneration.current++; setReading(undefined); setPreviewBusy(false);
      setPreviewError(t('这条会话已不可用，请返回搜索结果。', 'This conversation is no longer available. Return to the results.'));
    }
  }, [sessions, selected]);
  useLayoutEffect(() => {
    if (!active || !selected || !reading) { setPreviewMatched(false); return; }
    const target = searchMessageElement(history.current, matchIndex, text);
    const marker = target ? markSearchMessage(target, text, 'desktop-search-match') : undefined;
    setPreviewMatched(Boolean(marker?.matched));
    if (target) {
      const tabIndex = target.getAttribute('tabindex');
      target.tabIndex = -1;
      if (history.current) scrollSearchMessage(history.current, target, revealSearchHighlight('desktop-search-match'));
      target.focus({ preventScroll: true });
      return () => {
        marker?.cleanup();
        if (tabIndex === null) target.removeAttribute('tabindex');
        else target.setAttribute('tabindex', tabIndex);
      };
    }
  }, [active, selected, reading, matchIndex, text]);
  const openHit = async (hit: FulltextHit) => {
    const current = ++previewGeneration.current;
    scrollPosition.current = list.current?.scrollTop ?? 0;
    focusKey.current = hitKey(hit);
    setSelected(hit); setReading(undefined); setPreviewError(''); setPreviewBusy(true);
    try {
      const value = await bridge.sessionReading(hit.sessionId);
      if (previewGeneration.current === current) {
        if (value?.sessionId === hit.sessionId) setReading(value);
        else { setReading(null); setPreviewError(t('这条会话暂时无法预览。', 'This conversation cannot be previewed.')); }
      }
    } catch { if (previewGeneration.current === current) setPreviewError(t('读取会话失败。记录可能已删除或变化。', 'The conversation could not be read. It may have changed or been deleted.')); }
    finally { if (previewGeneration.current === current) setPreviewBusy(false); }
  };
  const cannotMutate = async () => { setPreviewError(t('请先打开此会话。', 'Open this conversation first.')); };
  const date = (timestamp: number) => new Date(timestamp).toLocaleDateString(zh ? 'zh-CN' : 'en-US');
  return <section className="fulltext-panel" hidden={!active} aria-label={t('聊天记录搜索', 'Search chat history')} onKeyDown={event => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented || document.querySelector(':popover-open')) return;
    event.stopPropagation();
    selected ? returnToResults() : onClose();
  }}>
    <header className="fulltext-header">
      <button ref={back} className="icon-button" aria-label={selected ? t('返回搜索结果', 'Back to results') : t('返回会话', 'Back to conversation')}
        data-tooltip={selected ? t('返回搜索结果', 'Back to results') : t('返回会话', 'Back to conversation')}
        onClick={selected ? returnToResults : onClose}><ArrowLeft size={17}/></button>
      <h1>{selected ? previewSession?.name || previewSession?.firstMessage || t('会话记录', 'Conversation') : t('聊天记录搜索', 'Search chat history')}</h1>
      <span>{selected ? t('只读记录', 'Read-only history') : t('本机记录', 'Local history')}</span>
      {selected && <button className="icon-button" aria-label={t('关闭搜索', 'Close search')} data-tooltip={t('关闭搜索', 'Close search')} onClick={onClose}><X size={16}/></button>}
    </header>
    <div className="fulltext-results" hidden={Boolean(selected)}>
      <div className="fulltext-controls">
        <div className="fulltext-input"><Search size={18}/><input ref={input} value={text} maxLength={500}
          aria-label={t('搜索聊天记录关键词', 'Search chat history keywords')} placeholder={t('搜索聊天记录…', 'Search chat history…')}
          onChange={event => { scrollPosition.current = 0; focusKey.current = undefined; setText(event.target.value); }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) setRevision(value => value + 1); }}/>
          {text && <button className="icon-button" aria-label={t('清空关键词', 'Clear query')} data-tooltip={t('清空关键词', 'Clear query')}
            onClick={() => { setText(''); input.current?.focus(); }}><X size={15}/></button>}
        </div>
        <div className="fulltext-filters">
          <ScheduledTaskSelect label={t('筛选项目', 'Filter project')} value={project} onChange={setProject}
            options={[{ id: '', label: t('全部项目', 'All projects') }, ...projects.map(path => ({ id: path, label: projectLabel(path) }))]}/>
          <ScheduledTaskSelect label={t('筛选时间', 'Filter time')} value={range} onChange={setRange}
            options={[{ id: '', label: t('不限时间', 'Any time') }, { id: '7', label: t('最近 7 天', 'Last 7 days') }, { id: '30', label: t('最近 30 天', 'Last 30 days') }]}/>
          <label><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)}/>{t('包含归档', 'Include archived')}</label>
          <button className="icon-button" disabled={busy || !text.trim()} aria-label={t('刷新搜索', 'Refresh search')} data-tooltip={t('刷新搜索', 'Refresh search')}
            onClick={() => setRevision(value => value + 1)}><RotateCw size={15}/></button>
        </div>
      </div>
      {result?.index.state === 'backfilling' && <div className="fulltext-notice" role="status"><LoaderCircle size={14}/><span>{t('索引建立中，结果尚未覆盖全部记录。', 'Indexing. Results do not cover all history yet.')}</span><span>{result.index.indexed} / {result.index.total}</span></div>}
      {result?.index.errors ? <div className="fulltext-notice" role="status"><AlertCircle size={14}/>{t('部分记录未能索引，当前结果可能不完整。', 'Some records could not be indexed. Results may be incomplete.')}</div> : null}
      {result?.sessionOnly && <div className="fulltext-notice" role="status"><AlertCircle size={14}/>{t('索引不可用，已降级为会话级匹配，无法定位具体消息。', 'Index unavailable. Using conversation-level matches without message locations.')}</div>}
      {result?.shortQuery && <div className="fulltext-notice" role="status"><AlertCircle size={14}/>{t('短关键词仅搜索所选时间内最近 200 个会话，最多 50 条；不限时间时默认近 30 天。', 'Short terms search the latest 200 conversations in the selected period, up to 50 matches. Any time defaults to 30 days.')}</div>}
      {result?.limited && <div className="fulltext-notice" role="status"><AlertCircle size={14}/>{t(`已达到 ${result.limit} 条查询上限；项目与归档筛选仅作用于这批结果，请缩小关键词。`, `Search reached its ${result.limit}-match limit. Project and archive filters apply to this batch; narrow your query.`)}</div>}
      <div className="fulltext-scroll" ref={list} aria-busy={busy}>
        {!text.trim() ? <div className="fulltext-empty"><TextSearch size={28}/><h2>{t('暂无查询', 'No query')}</h2></div>
          : busy && !result ? <div className="fulltext-empty" role="status"><LoaderCircle className="fulltext-spinner" size={23}/><p>{t('正在查询…', 'Searching…')}</p></div>
            : error ? <div className="fulltext-empty" role="alert"><AlertCircle size={25}/><p>{error}</p><button onClick={() => setRevision(value => value + 1)}><RotateCw size={14}/>{t('重新查询', 'Retry')}</button></div>
              : !hits.length ? <div className="fulltext-empty"><Search size={26}/><h2>{t('当前结果中没有匹配', 'No matches in current results')}</h2>
                <p>{result?.limited || result?.shortQuery || result?.index.state !== 'ready' ? t('查询范围尚未完整覆盖，请调整关键词或稍后刷新。', 'Coverage is incomplete. Refine your query or refresh later.') : t('当前筛选范围内未找到匹配。', 'No matches in the selected scope.')}</p></div>
                : <><div className="fulltext-count" role="status"><span>{t(`${hits.length} 条匹配 · ${new Set(hits.map(hit => hit.sessionId)).size} 个会话`, `${hits.length} matches · ${new Set(hits.map(hit => hit.sessionId)).size} conversations`)}</span><span>{busy ? <LoaderCircle className="fulltext-spinner" size={13}/> : result?.shortQuery || result?.sessionOnly ? t('最近匹配', 'Recent matches') : t('相关性排序', 'Ranked matches')}</span></div>
                  {[...groups].map(([id, entries]) => {
                    const session = known.get(id)!;
                    return <section className="fulltext-group" key={id}><header><MessageSquare size={14}/>
                      <h2>{session.name || session.firstMessage || t('新会话', 'New conversation')}</h2>
                      {archived.has(id) && <Archive size={13} aria-label={t('已归档', 'Archived')}/>}
                      <span>{projectLabel(session.workspacePath ?? session.cwd)}</span></header>
                      {entries.map(hit => <button className="fulltext-hit" data-search-key={hitKey(hit)} key={hitKey(hit)} onClick={() => void openHit(hit)}>
                        <span className="fulltext-role">{hit.entryId === null ? t('会话', 'Conversation') : hit.role === 'user' ? t('你', 'You') : hit.role === 'assistant' ? 'Step Code' : t('记录', 'Record')}</span>
                        <span className="fulltext-snippet">{hit.snippet
                          ? snippetParts(hit.snippet).map((part, index) => part.matched ? <mark key={index}>{part.text}</mark> : part.text)
                          : t('匹配摘要暂不可预览，请打开会话查看。', 'Match preview unavailable. Open the conversation to inspect.')}</span>
                        <time>{date(hit.timestamp)}</time><ArrowRight size={14}/></button>)}
                    </section>;
                  })}
                  {visible < hits.length && <button className="fulltext-more" onClick={() => setVisible(value => value + 30)}>{t('加载更多', 'Load more')}<span>{visible} / {hits.length}</span></button>}
                </>}
      </div>
      <footer className="fulltext-footer"><span>{t('本地索引', 'Local index')}</span><span>{t('不含工具输出与子代理会话', 'Excludes tool output and child-agent sessions')}</span></footer>
    </div>
    {selected && <div className="fulltext-preview">
      <div className="fulltext-preview-meta"><Folder size={14}/><span>{previewSession && projectLabel(previewSession.workspacePath ?? previewSession.cwd)}</span><time>{date(selected.timestamp)}</time></div>
      {previewError && <div className="fulltext-notice" role="alert"><AlertCircle size={14}/>{previewError}</div>}
      {!!reading && (selected.entryId === null || matchIndex < 0) && <div className="fulltext-notice" role="status"><AlertCircle size={14}/>{selected.entryId === null
        ? t('这是会话级匹配，显示当前可见上下文。', 'Conversation-level match. Showing the currently visible context.')
        : t('命中不在当前可见分支，或已被压缩；显示会话当前上下文。', 'The match is outside the visible branch or was compacted. Showing current context.')}</div>}
      {!!reading && matchIndex >= 0 && !previewMatched && <div className="fulltext-notice" role="status"><AlertCircle size={14}/>
        {t('已找到消息，但当前可见正文没有匹配关键词。', 'Message found, but the query is not in the visible text.')}</div>}
      <div className="fulltext-history" ref={history}>
        {previewBusy ? <div className="fulltext-empty" role="status"><LoaderCircle className="fulltext-spinner" size={23}/>{t('读取记录…', 'Reading history…')}</div>
          : reading ? <div className="messages"><ConversationMessages messages={reading.messages} modelChanges={reading.modelChanges}
            language={preferences.language} busy={false} canEdit={false} interfaceSettings={interfaceSettings}
            searchTarget={{ entryId: selected.entryId, text, requestId: request.id }}
            openImage={openImage} edit={cannotMutate} branch={() => void cannotMutate()} onError={setPreviewError}
            onOpenSubagent={() => void cannotMutate()} onOpenWorkflow={() => void cannotMutate()}/></div> : null}
      </div>
      <footer className="fulltext-preview-footer"><button onClick={returnToResults}><ArrowLeft size={14}/>{t('搜索结果', 'Search results')}</button>
        <button disabled={!previewSession || opening} onClick={async () => {
          if (!previewSession || opening) return;
          setOpening(true);
          try {
            if (!await onOpen(previewSession, { sessionId: selected.sessionId, entryId: selected.entryId, text }))
              setPreviewError(t('会话未能打开，请稍后重试。', 'The conversation could not be opened. Try again.'));
          }
          catch { setPreviewError(t('会话打开失败。', 'Could not open the conversation.')); }
          finally { setOpening(false); }
        }}>{opening ? <LoaderCircle size={14}/> : <MessageSquare size={14}/>}<span>{selected.entryId === null
          ? t('打开此会话', 'Open conversation') : t('打开并定位', 'Open and locate')}</span><ArrowRight size={14}/></button></footer>
    </div>}
  </section>;
}
