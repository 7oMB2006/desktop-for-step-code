import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUpRight, Check, ChevronRight, Copy, RefreshCw, X } from 'lucide-react';
import type { Message, RuntimeState, SessionStats } from './contracts';
import { contextCapacityColors, contextMessageCounts, contextMessageJson, contextMessagePreview, finiteAmount, type MessageFilter } from './context-inspector';
import './context-panel.css';
import { RightPanelExpandButton } from './RightPanelExpandButton';
import { RightPanelWidthControl, type RightPanelWidth } from './RightPanelWidthControl';
import { isUserMessage } from './user-message';
import { ContextEstimate } from './ContextEstimate';
import type { SessionEstimate } from './usage-estimates';
import type { Snapshot } from './contracts';
import { SessionStatus } from './SessionStatus';
import { ClmPanel } from './ClmPanel';
import { UsageUnitButton } from './UsageUnitButton';
import { UsageTokenValue } from './UsageTokenValue';
import type { UsageUnit } from './usage-unit';

type ContextRow = { message: Message; index: number; key: string };

function JsonCode({ json }: { json: string }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  const tokens = /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const match of json.matchAll(tokens)) {
    const index = match.index;
    nodes.push(json.slice(cursor, index));
    const key = match[0].startsWith('"') && /^\s*:/.test(json.slice(index + match[0].length));
    nodes.push(<span key={index} className={key ? 'context-json-key' : match[0].startsWith('"') ? 'context-json-string' : 'context-json-number'}>{match[0]}</span>);
    cursor = index + match[0].length;
  }
  nodes.push(json.slice(cursor));
  return <code>{nodes}</code>;
}

function MessageJson({ message, language, onError }: { message: Message; language: 'zh' | 'en'; onError: (error: string) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const json = useMemo(() => contextMessageJson(message), [message]);
  return <div className="context-json">
    <div className="context-json-tools"><span>JSON</span>
      <button className="icon-button" type="button" aria-label={language === 'zh' ? '复制消息 JSON' : 'Copy message JSON'}
        data-tooltip={language === 'zh' ? '复制消息 JSON' : 'Copy message JSON'} onClick={() => {
          void window.desktop?.copyText(json).then(() => setCopied(true)).catch(error => onError(String(error)));
        }}>{copied ? <Check size={13}/> : <Copy size={13}/>}</button>
    </div><pre tabIndex={0} role="region" aria-label={language === 'zh' ? '消息 JSON' : 'Message JSON'}><JsonCode json={json}/></pre>
  </div>;
}

function messageRole(value: string, language: 'zh' | 'en') {
  const labels: Record<string, [string, string]> = { user: ['用户', 'User'], assistant: ['助手', 'Assistant'], toolResult: ['工具', 'Tool'],
    compactionSummary: ['压缩', 'Compaction'], branchSummary: ['分支摘要', 'Branch summary'], custom: ['扩展', 'Custom'], bashExecution: ['命令', 'Command'] };
  return labels[value]?.[language === 'zh' ? 0 : 1] ?? value;
}

function messageTime(stamp: number | undefined, format: Intl.DateTimeFormat) {
  return stamp && Number.isFinite(stamp) && !Number.isNaN(new Date(stamp).getTime()) ? format.format(stamp) : '--';
}

const ContextMessage = memo(function ContextMessage({ message, index, rowKey, expanded, language, timeFormat, onToggle, onError }: {
  message: Message; index: number; rowKey: string; expanded: boolean; language: 'zh' | 'en'; timeFormat: Intl.DateTimeFormat;
  onToggle: (key: string, open: boolean) => void; onError: (error: string) => void;
}) {
  const role = isUserMessage(message) ? 'user' : message.role;
  return <details className={`context-message context-role-${role}`}
    open={expanded} onToggle={event => onToggle(rowKey, event.currentTarget.open)}>
    <summary><span className="context-message-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="context-message-caption"><span><b>{messageRole(role, language)}</b><time>{messageTime(message.timestamp, timeFormat)}</time></span>
        <span className="context-message-preview">{contextMessagePreview(message)}</span></span><ChevronRight className="context-message-chevron" size={13}/></summary>
    {expanded && <MessageJson message={message} language={language} onError={onError}/>}
  </details>;
});

function contextRowFocusTargets(row: HTMLElement) {
  return [...row.querySelectorAll<HTMLElement>('summary, button, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
}

function ContextMessageList({ rows, scroll, expanded, filter, language, timeFormat, onToggle, onError }: {
  rows: ContextRow[]; scroll: RefObject<HTMLDivElement | null>; expanded: string | null; filter: MessageFilter;
  language: 'zh' | 'en'; timeFormat: Intl.DateTimeFormat;
  onToggle: (key: string, open: boolean) => void; onError: (error: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [pendingFocus, setPendingFocus] = useState<{ key: string; edge: 'first' | 'last' } | null>(null);
  const indices = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows]);
  const getItemKey = useCallback((index: number) => rows[index].key, [rows]);
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const result = new Set(defaultRangeExtractor(range));
    // Keep active controls and selection endpoints alive outside the viewport.
    for (const key of [expanded, focused, pendingFocus?.key, ...selection]) {
      const index = key == null ? undefined : indices.get(key);
      if (index !== undefined) result.add(index);
    }
    return [...result].sort((a, b) => a - b);
  }, [expanded, focused, pendingFocus, selection, indices]);
  const virtualizer = useVirtualizer({
    count: rows.length, getScrollElement: () => scroll.current, getItemKey,
    estimateSize: () => 62, overscan: 6, scrollMargin: margin, rangeExtractor,
    // Newest-first data prepends at the top. Keep a reader's message in place,
    // but let new records appear normally while the statistics are in view.
    anchorTo: (scroll.current?.scrollTop ?? 0) > margin ? 'end' : 'start',
  });
  // The parent scroll ref attaches after child layout effects on first mount.
  useEffect(() => {
    const viewport = scroll.current;
    const element = list.current;
    if (!viewport || !element) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - viewport.clientTop;
      setMargin(previous => Math.abs(previous - top) > .5 ? top : previous);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(element.closest('.context-content')!);
    return () => observer.disconnect();
  }, [scroll]);
  useLayoutEffect(() => {
    const viewport = scroll.current;
    const element = list.current;
    if (!viewport || !element) return;
    const top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - viewport.clientTop;
    if (viewport.scrollTop > top) viewport.scrollTop = top;
  }, [scroll]);
  useEffect(() => {
    const selectedRow = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement;
      const row = element?.closest<HTMLElement>('[data-context-key]');
      return row && list.current?.contains(row) ? row.dataset.contextKey : undefined;
    };
    const update = () => {
      const value = document.getSelection();
      const keys = value && !value.isCollapsed ? [selectedRow(value.anchorNode), selectedRow(value.focusNode)].filter((key): key is string => !!key) : [];
      setSelection(previous => previous.length === keys.length && previous.every((key, index) => key === keys[index]) ? previous : keys);
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);
  useLayoutEffect(() => {
    if (focused && !indices.has(focused)) {
      document.getElementById(`context-tab-${filter}`)?.focus({ preventScroll: true });
      setFocused(null);
    }
    if (!pendingFocus) return;
    const index = indices.get(pendingFocus.key);
    if (index === undefined) { setPendingFocus(null); return; }
    const row = list.current?.querySelector<HTMLElement>(`[data-context-key="${CSS.escape(pendingFocus.key)}"]`);
    const targets = row ? contextRowFocusTargets(row) : [];
    const target = pendingFocus.edge === 'last' ? targets.at(-1) : targets[0];
    const viewport = scroll.current;
    if (!target || !viewport) return;
    virtualizer.scrollToIndex(index, { align: 'auto' });
    target.focus({ preventScroll: true });
    const rect = target.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    if (rect.top < bounds.top) viewport.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) viewport.scrollTop += rect.bottom - bounds.bottom;
    setPendingFocus(null);
  }, [focused, indices, filter, pendingFocus, scroll, virtualizer]);
  return <div ref={list} id="context-message-list" role="tabpanel" aria-labelledby={`context-tab-${filter}`}
    className="context-message-list" style={{ height: rows.length ? virtualizer.getTotalSize() : undefined }}
    onFocusCapture={event => setFocused((event.target as HTMLElement).closest<HTMLElement>('[data-context-key]')?.dataset.contextKey ?? null)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}
    onKeyDown={event => {
      if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>('[data-context-key]');
      const index = row?.dataset.contextKey ? indices.get(row.dataset.contextKey) : undefined;
      if (!row || index === undefined) return;
      // Only bridge virtual rows; keep native traversal within each message.
      const targets = contextRowFocusTargets(row);
      if (target !== (event.shiftKey ? targets[0] : targets.at(-1))) return;
      const next = index + (event.shiftKey ? -1 : 1);
      if (!rows[next]) return;
      event.preventDefault();
      setPendingFocus({ key: rows[next].key, edge: event.shiftKey ? 'last' : 'first' });
    }}>
    <div role="list">{virtualizer.getVirtualItems().map(item => {
      const row = rows[item.index];
      return <div key={row.key} ref={virtualizer.measureElement} data-index={item.index} data-context-key={row.key}
        role="listitem" aria-posinset={item.index + 1} aria-setsize={rows.length}
        className="context-message-row" style={{ transform: `translateY(${item.start - margin}px)` }}>
        <ContextMessage message={row.message} index={row.index} rowKey={row.key} expanded={expanded === row.key}
          onToggle={onToggle} language={language} timeFormat={timeFormat} onError={onError}/>
      </div>;
    })}</div>
    {!rows.length && <p className="context-message-empty">{language === 'zh' ? '暂无消息' : 'No messages'}</p>}
  </div>;
}

export function ContextPanel({ messages, stats, state, estimate, title, language, busy, connected, expanded: fullView, onToggleExpanded, onClose, onRefresh, onError, snapshot, view = 'context', onView, runtimeRevision = 0, width = 'standard', onWidthChange }: {
  snapshot?: Snapshot; view?: 'status' | 'context' | 'clm'; onView?: (view: 'status' | 'context' | 'clm') => void;
  runtimeRevision?: number;
  messages: Message[]; stats?: SessionStats; state?: RuntimeState; title: string; language: 'zh' | 'en'; busy: boolean; connected: boolean;
  estimate?: SessionEstimate;
  onClose: () => void; onRefresh: () => Promise<void>; onError: (error: string) => void;
  expanded: boolean; onToggleExpanded: () => void;
  width?: 'standard' | 'wide'; onWidthChange?: (value: RightPanelWidth) => void;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [filter, setFilter] = useState<MessageFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [statusRevision, setStatusRevision] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [unit, setUnit] = useState<UsageUnit>('default');
  const scroll = useRef<HTMLDivElement>(null);
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-GB',
    { hour: '2-digit', minute: '2-digit', hour12: false }), [language]);
  const counts = useMemo(() => contextMessageCounts(messages), [messages]);
  const rows = useMemo(() => messages.map((message, index) => ({ message, index, key: message.entryId ?? `${index}:${message.timestamp ?? ''}:${message.role}` }))
    .filter(({ message }) => filter === 'all' || (filter === 'user' ? isUserMessage(message) : message.role === filter)).reverse(), [messages, filter]);
  const toggleMessage = useCallback((key: string, open: boolean) => {
    if (open) setExpanded(key);
    else setExpanded(previous => previous === key ? null : previous);
  }, []);
  const last = [...messages].reverse().find(message => message.role === 'assistant' && message.usage);
  const number = (value: unknown) => {
    const amount = finiteAmount(value);
    return amount === undefined ? '--' : amount.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
  };
  const percent = finiteAmount(stats?.contextUsage?.percent);
  const capacityColors = contextCapacityColors(percent);
  const used = finiteAmount(stats?.contextUsage?.tokens);
  const capacity = finiteAmount(stats?.contextUsage?.contextWindow);
  const custom = state?.model?.provider !== 'step';
  const usage = last?.usage;
  const prompt = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
  const hit = usage && prompt > 0 && usage.cacheRead + usage.cacheWrite > 0 ? usage.cacheRead / prompt * 100 : undefined;
  const role = (value: string) => messageRole(value, language);
  const time = (stamp?: number) => messageTime(stamp, timeFormat);
  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); setStatusRevision(value => value + 1); } catch (error) { onError(String(error)); } finally { setRefreshing(false); }
  };
  return <aside className={`context-panel${fullView ? ' is-expanded' : ''}`} aria-label={t('上下文', 'Context')} id="context-panel">
    <header className="context-panel-header right-panel-header">
      {snapshot && onView ? <div className="context-view-tabs text-tabs" role="tablist" aria-label={t('会话检查', 'Session inspector')}>
        {(['context', 'status', 'clm'] as const).map(tab => <button key={tab} type="button" role="tab" id={`inspector-tab-${tab}`}
          aria-selected={view === tab} aria-controls="inspector-content" tabIndex={view === tab ? 0 : -1}
          onClick={() => onView(tab)} onKeyDown={event => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const tabs = ['context', 'status', 'clm'] as const;
              const next = event.key === 'Home' ? 'context' : event.key === 'End' ? 'clm' : tabs[(tabs.indexOf(view) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
              onView(next); document.getElementById(`inspector-tab-${next}`)?.focus();
            }
          }}>{tab === 'clm' ? 'CLM' : tab === 'status' ? t('状态', 'Status') : t('上下文', 'Context')}</button>)}
      </div> : <h2>{t('上下文', 'Context')}</h2>}
      <span className={`context-status${busy && connected ? ' is-running' : ''}`}>{!connected ? t('未连接', 'Offline') : busy ? t('运行中', 'Running') : t('就绪', 'Ready')}</span>
      {onWidthChange && <RightPanelWidthControl value={fullView ? 'fullscreen' : width} language={language} panel="context" onChange={onWidthChange}/>}
      <RightPanelExpandButton expanded={fullView} language={language} onToggle={onToggleExpanded}/>
      <button type="button" className={`icon-button${refreshing ? ' is-refreshing' : ''}`} disabled={refreshing || !connected}
        aria-label={t('刷新上下文', 'Refresh context')} data-tooltip={t('刷新上下文', 'Refresh context')} onClick={() => void refresh()}><RefreshCw size={15}/></button>
      <button type="button" className="icon-button" aria-label={t('关闭上下文', 'Close context')} onClick={onClose}><X size={16}/></button>
    </header>
    <div ref={scroll} className="context-panel-scroll context-view-content" id="inspector-content"
      role={snapshot && onView ? 'tabpanel' : undefined} aria-labelledby={snapshot && onView ? `inspector-tab-${view}` : undefined}>
      {snapshot && <div hidden={view !== 'clm'}><ClmPanel key={snapshot.runtimeId + ':' + snapshot.state?.sessionId} snapshot={snapshot} busy={busy} visible={view === 'clm'} revision={statusRevision + runtimeRevision}/></div>}
      {view === 'clm' ? null :
        view === 'status' && snapshot ? <SessionStatus snapshot={snapshot} title={title} onError={onError} revision={statusRevision + runtimeRevision} busy={busy}/> : <>
      <div className="context-content">
      <div className="context-identity"><strong>{title}</strong><span>{state?.model?.name ?? last?.model ?? '--'}</span>
        <small>{state?.model?.provider ?? last?.provider ?? '--'}</small></div>
      <section className="context-capacity" aria-label={t('当前上下文', 'Current context')}
        style={capacityColors ? { '--capacity-light': capacityColors.light, '--capacity-dark': capacityColors.dark } as CSSProperties : undefined}>
        <div className="context-section-title"><h3>{t('当前上下文', 'Current context')}</h3><span>{t('估算', 'Estimated')}</span></div>
        <div className="context-capacity-number"><strong>{percent === undefined ? '--' : percent.toFixed(1)}<small>%</small></strong>
          <span>{number(used)}<span> / {number(capacity)}</span></span></div>
        <div className={`context-capacity-strip${percent === undefined ? ' is-unknown' : ''}`} role="meter"
          aria-label={t('上下文占用', 'Context occupancy')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === undefined ? undefined : Math.min(100, percent)}
          aria-valuetext={percent === undefined ? t('未知', 'Unknown') : `${percent.toFixed(1)}%`}>
          {Array.from({ length: 40 }, (_, index) => <i key={index} className={percent !== undefined && index < percent / 2.5 ? ' is-used' : ''}
            style={{ '--tick-fill': `${Math.max(0, Math.min(1, (percent ?? 0) / 2.5 - index)) * 100}%` } as CSSProperties}/>)}
        </div>
      </section>
      <section className="context-session-totals" aria-label={t('会话累计', 'Session totals')}>
        <div><div className="context-token-label"><span>{t('累计用量', 'Total tokens')}</span><UsageUnitButton value={unit} onChange={setUnit} language={language}/></div>
          <strong><UsageTokenValue value={finiteAmount(stats?.tokens.total)} unit={unit}/><small> tok</small></strong></div>
        <ContextEstimate value={estimate} custom={custom} language={language}/>
      </section>
      <section className="context-last-response" aria-label={t('最近一次响应', 'Latest response')}>
        <div className="context-section-title"><h3>{t('最近一次响应', 'Latest response')}</h3><time>{time(last?.timestamp)}</time></div>
        <dl className="context-usage-list">
          <div className="context-usage-input"><dt><i/>{t('输入', 'Input')}</dt><dd>{number(usage?.input)}</dd></div>
          <div className="context-usage-cache"><dt><i/>{t('缓存读取', 'Cache read')}</dt><dd>{number(usage?.cacheRead)}</dd></div>
          <div className="context-usage-write"><dt><i/>{t('缓存写入', 'Cache write')}</dt><dd>{number(usage?.cacheWrite)}</dd></div>
          <div className="context-usage-output"><dt><i/>{t('输出', 'Output')}<ArrowUpRight size={12}/></dt><dd>{number(usage?.output)}</dd></div>
        </dl>
        <div className="context-response-extra"><span>{t('其中推理', 'Of which reasoning')} <b>{number(usage?.reasoning)}</b></span>
          <span>{t('缓存命中', 'Cache hit')} <b>{hit === undefined ? '--' : `${hit.toFixed(1)}%`}</b></span></div>
      </section>
      <section className="context-message-section" aria-label={t('当前消息', 'Current messages')}>
        <div className="context-section-title"><h3>{t('当前消息', 'Current messages')}</h3><span>{number(counts.all)}</span></div>
        <div className="context-message-tabs text-tabs" role="tablist" aria-label={t('消息类别', 'Message roles')}>
          {(['all', 'user', 'assistant', 'toolResult'] as const).map(value => <button key={value} type="button" role="tab"
            id={`context-tab-${value}`} aria-selected={filter === value} aria-controls="context-message-list" onClick={() => setFilter(value)}
            tabIndex={filter === value ? 0 : -1} onKeyDown={event => {
              const options: MessageFilter[] = ['all', 'user', 'assistant', 'toolResult'];
              const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!direction && event.key !== 'Home' && event.key !== 'End') return;
              event.preventDefault();
              const target = event.key === 'Home' ? 'all' : event.key === 'End' ? 'toolResult' : options[(options.indexOf(value) + direction + 4) % 4];
              setFilter(target); document.getElementById(`context-tab-${target}`)?.focus();
            }}>{value === 'all' ? t('全部', 'All') : role(value)}<small>{counts[value]}</small></button>)}
        </div>
        <ContextMessageList key={filter} rows={rows} scroll={scroll} expanded={expanded} filter={filter}
          language={language} timeFormat={timeFormat} onToggle={toggleMessage} onError={onError}/>
      </section>
      </div>
      </>}
    </div>
  </aside>;
}
