import React, { useEffect, useState } from 'react';
import { Plug, RotateCcw, Settings } from 'lucide-react';
import { startupBlocked, startupMissing, startupWaiting, type RuntimeStartup } from './runtime-startup';

export function RuntimeStartupStatus({ state, language, disabled, reconnect, settings }: {
  state?: RuntimeStartup; language: 'zh' | 'en'; disabled: boolean;
  reconnect?: () => void; settings(): void;
}) {
  const [, tick] = useState(0);
  const waiting = startupWaiting(state);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => tick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [waiting]);
  if (!state || !waiting && !startupMissing(state).length && !startupBlocked(state)) return null;
  const zh = language === 'zh';
  const title = state.discovery === 'failed' ? zh ? '工具发现失败' : 'Tool discovery failed'
    : !state.cleanupConfirmed || state.tools.some(tool => tool.cleanupConfirmed === false) ? zh ? '工具清理未确认，需要重新连接' : 'Tool cleanup unconfirmed; reconnect required'
    : waiting ? zh ? '工具连接中' : 'Connecting tools'
    : zh ? '部分工具不可用' : 'Some tools are unavailable';
  const tools = state.tools.filter(tool => !['connected', 'disabled'].includes(tool.status));
  return <div className="runtime-startup-status">
    <div className="runtime-startup-heading">
      <Plug size={14}/><span role="status">{title}</span>
      <button className="icon-button" aria-label={zh ? 'MCP 设置' : 'MCP settings'}
        data-tooltip={zh ? 'MCP 设置' : 'MCP settings'} onClick={settings}><Settings size={14}/></button>
      {reconnect && <button className="icon-button" aria-label={zh ? '重新连接运行时' : 'Reconnect runtime'}
        data-tooltip={zh ? '重新连接运行时' : 'Reconnect runtime'} disabled={disabled}
        onClick={reconnect}><RotateCcw size={14}/></button>}
    </div>
    {!!tools.length && <ul>{tools.map(tool => <li key={tool.name}>
      <span>{tool.name}</span><span>{tool.status === 'failed' ? zh ? '不可用' : 'Unavailable'
        : tool.status === 'pending' ? zh ? '等待宿主' : 'Waiting for host' : zh ? '连接中' : 'Connecting'}</span>
      <time>{Math.max(0, Math.floor(((tool.settledAt ?? Date.now()) - tool.startedAt) / 1000))}s</time>
    </li>)}</ul>}
  </div>;
}
