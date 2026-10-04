import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronRight, Copy, RefreshCw, X } from 'lucide-react';
import type { Message, RuntimeState, SessionStats } from './contracts';
import { contextCapacityColors, contextMessageCounts, contextMessageJson, contextMessagePreview, finiteAmount, type MessageFilter } from './context-inspector';
import './context-panel.css';
import { RightPanelExpandButton } from './RightPanelExpandButton';

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
    </div><pre><JsonCode json={json}/></pre>
  </div>;
}

export function ContextPanel({ messages, stats, state, title, language, busy, connected, expanded: fullView, onToggleExpanded, onClose, onRefresh, onError }: {
  messages: Message[]; stats?: SessionStats; state?: RuntimeState; title: string; language: 'zh' | 'en'; busy: boolean; connected: boolean;
  onClose: () => void; onRefresh: () => Promise<void>; onError: (error: string) => void;
  expanded: boolean; onToggleExpanded: () => void;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [filter, setFilter] = useState<MessageFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const counts = useMemo(() => contextMessageCounts(messages), [messages]);
  const rows = useMemo(() => messages.map((message, index) => ({ message, index, key: message.entryId ?? `${index}:${message.timestamp ?? ''}:${message.role}` }))
    .filter(({ message }) => filter === 'all' || message.role === filter).reverse(), [messages, filter]);
  const last = [...messages].reverse().find(message => message.role === 'assistant' && message.usage);
  const number = (value: unknown) => {
    const amount = finiteAmount(value);
    return amount === undefined ? '--' : amount.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
  };
  const percent = finiteAmount(stats?.contextUsage?.percent);
  const capacityColors = contextCapacityColors(percent);
  const used = finiteAmount(stats?.contextUsage?.tokens);
  const capacity = finiteAmount(stats?.contextUsage?.contextWindow);
  const cost = finiteAmount(stats?.cost);
  const usage = last?.usage;
  const prompt = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
  const hit = usage && prompt > 0 && usage.cacheRead + usage.cacheWrite > 0 ? usage.cacheRead / prompt * 100 : undefined;
  const role = (value: string) => ({ user: t('用户', 'User'), assistant: t('助手', 'Assistant'), toolResult: t('工具', 'Tool'),
    compactionSummary: t('压缩', 'Compaction'), branchSummary: t('分支摘要', 'Branch summary'), custom: t('扩展', 'Custom'), bashExecution: t('命令', 'Command') })[value] ?? value;
  const time = (stamp?: number) => stamp && Number.isFinite(stamp) && !Number.isNaN(new Date(stamp).getTime()) ?
    new Date(stamp).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--';
  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } catch (error) { onError(String(error)); } finally { setRefreshing(false); }
  };
  return <aside className={`context-panel${fullView ? ' is-expanded' : ''}`} aria-label={t('上下文', 'Context')} id="context-panel">
    <header className="context-panel-header right-panel-header"><h2>{t('上下文', 'Context')}</h2>
      <span className={`context-status${busy && connected ? ' is-running' : ''}`}>{!connected ? t('未连接', 'Offline') : busy ? t('运行中', 'Running') : t('就绪', 'Ready')}</span>
      <RightPanelExpandButton expanded={fullView} language={language} onToggle={onToggleExpanded}/>
      <button type="button" className={`icon-button${refreshing ? ' is-refreshing' : ''}`} disabled={refreshing || !connected}
        aria-label={t('刷新上下文', 'Refresh context')} data-tooltip={t('刷新上下文', 'Refresh context')} onClick={() => void refresh()}><RefreshCw size={15}/></button>
      <button type="button" className="icon-button" aria-label={t('关闭上下文', 'Close context')} onClick={onClose}><X size={16}/></button>
    </header>
    <div className="context-panel-scroll">
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
        <div><span>{t('累计用量', 'Total tokens')}</span><strong>{number(stats?.tokens.total)}<small> tok</small></strong></div>
        <div><span>{t('估算费用', 'Estimated cost')}</span><strong>{cost === undefined ? '--' : `$${cost.toFixed(4)}`}</strong></div>
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
        <div className="context-message-tabs" role="tablist" aria-label={t('消息类别', 'Message roles')}>
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
        <div id="context-message-list" role="tabpanel" aria-labelledby={`context-tab-${filter}`}>
          {rows.map(({ message, index, key }) => <details className={`context-message context-role-${message.role}`} key={key}
            open={expanded === key} onToggle={event => { if (event.currentTarget.open) setExpanded(key); else setExpanded(previous => previous === key ? null : previous); }}>
            <summary><span className="context-message-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="context-message-caption"><span><b>{role(message.role)}</b><time>{time(message.timestamp)}</time></span>
                <span className="context-message-preview">{contextMessagePreview(message)}</span></span><ChevronRight className="context-message-chevron" size={13}/></summary>
            {expanded === key && <MessageJson message={message} language={language} onError={onError}/>}
          </details>)}
          {!rows.length && <p className="context-message-empty">{t('暂无消息', 'No messages')}</p>}
        </div>
      </section>
      </div>
    </div>
  </aside>;
}
