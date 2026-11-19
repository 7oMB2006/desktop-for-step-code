import React, { useEffect, useId, useState } from 'react';
import { Plug, RotateCcw, Settings } from 'lucide-react';
import { startupNeedsAttention, startupWaiting, type RuntimeStartup } from './runtime-startup';
import { DisclosureChevron } from './DisclosureChevron';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import './capability-settings.css';

export function RuntimeStartupStatus({ state, language, disabled, reconnect, settings }: {
  state?: RuntimeStartup; language: string; disabled: boolean;
  reconnect?: () => void; settings(): void;
}) {
  const [, tick] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const { details, body } = useAnimatedDisclosure(expanded);
  const bodyId = useId();
  const waiting = startupWaiting(state);
  const visible = Boolean(state && (waiting || startupNeedsAttention(state)));
  useEffect(() => { if (!visible) setExpanded(false); }, [visible]);
  useEffect(() => {
    if (!waiting || !expanded) return;
    const timer = setInterval(() => tick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [waiting, expanded]);
  if (!visible || !state) return null;
  const zh = language === 'zh';
  const title = state.discovery === 'failed' ? zh ? '工具发现失败' : 'Tool discovery failed'
    : !state.cleanupConfirmed || state.tools.some(tool => tool.cleanupConfirmed === false) ? zh ? '工具清理未确认，需要重新连接' : 'Tool cleanup unconfirmed; reconnect required'
    : startupNeedsAttention(state) ? zh ? '部分工具不可用' : 'Some tools are unavailable'
    : zh ? '工具连接中' : 'Connecting tools';
  const tools = state.tools.filter(tool => tool.cleanupConfirmed === false || !['connected', 'disabled'].includes(tool.status));
  return <details ref={details} className="cap-disclosure runtime-startup-status" data-expanded={expanded}
    data-attention={startupNeedsAttention(state)}
    aria-label={zh ? '当前会话工具状态' : 'Current session tool status'}>
    <summary className="runtime-startup-heading" aria-expanded={expanded} aria-controls={bodyId}
      onClick={event => { event.preventDefault(); setExpanded(value => !value); }}>
      <Plug size={15}/><span>{zh ? '当前会话' : 'Current session'} · <span role="status">{title}</span></span>
      <span className="cap-chevron"><DisclosureChevron/></span>
    </summary>
    <div ref={body} id={bodyId} className="cap-disclosure-body" aria-hidden={!expanded} inert={!expanded}>
    {!!tools.length && <ul>{tools.map(tool => <li key={tool.name}
      data-attention={tool.status === 'failed' || tool.cleanupConfirmed === false}>
      <span>{tool.name}</span><span>{tool.cleanupConfirmed === false ? zh ? '清理未确认' : 'Cleanup unconfirmed'
        : tool.status === 'failed' ? zh ? '不可用' : 'Unavailable'
        : tool.status === 'pending' ? zh ? '等待宿主' : 'Waiting for host' : zh ? '连接中' : 'Connecting'}</span>
      <time>{Math.max(0, Math.floor(((tool.settledAt ?? Date.now()) - tool.startedAt) / 1000))}s</time>
    </li>)}</ul>}
    <div className="runtime-startup-actions">
      <button type="button" className="icon-button" aria-label={zh ? 'MCP 设置' : 'MCP settings'}
        data-tooltip={zh ? 'MCP 设置' : 'MCP settings'} onClick={settings}><Settings size={15}/></button>
      {reconnect && <button type="button" className="icon-button" aria-label={zh ? '重新连接运行时' : 'Reconnect runtime'}
        data-tooltip={zh ? '重新连接运行时' : 'Reconnect runtime'} disabled={disabled}
        onClick={reconnect}><RotateCcw size={15}/></button>}
    </div>
    </div>
  </details>;
}
