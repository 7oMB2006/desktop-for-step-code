import { useEffect, useId, useRef, useState } from 'react';
import { RotateCcw, Settings2 } from 'lucide-react';
import type { CapabilityCatalog } from './capabilities';
import type { DesktopBridge, SessionSummary } from './contracts';
import { DisclosureChevron } from './DisclosureChevron';
import { McpIcon } from './McpIcon';

export function SummaryMcp({ servers, language, busy, revision, onChanged, onRestart, onManage }: {
  servers?: SessionSummary['mcp']; language: 'zh' | 'en'; busy: boolean; revision?: number;
  onChanged?: () => Promise<void>; onRestart?: () => Promise<void>; onManage?: () => void;
}) {
  const bridge: Pick<DesktopBridge, 'capabilityCatalog' | 'capabilityMutate'> | undefined = window.desktop;
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CapabilityCatalog>();
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef(false);
  const alive = useRef(true);
  const id = useId();
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open || !bridge?.capabilityCatalog) return;
    let live = true;
    setReading(true);
    void bridge.capabilityCatalog().then(value => { if (live) { setCatalog(value); setError(''); } })
      .catch(() => { if (live) setError(t('无法读取启停配置，请重试或打开 MCP 设置。', 'Could not read configuration. Retry or open MCP settings.')); })
      .finally(() => { if (live) setReading(false); });
    return () => { live = false; };
  }, [open, revision, bridge]);
  const toggle = async (name: string, enabled: boolean) => {
    if (operation.current || reading || busy || !bridge?.capabilityMutate) return;
    operation.current = true; setPending(true); setError('');
    let saved = false;
    try {
      await bridge.capabilityMutate({ action: 'mcp-toggle', name, enabled });
      saved = true;
      if (alive.current) setCatalog(value => value && ({ ...value, mcp: value.mcp.map(server => server.name === name ? { ...server, enabled } : server) }));
      await onChanged?.();
    } catch {
      if (alive.current) setError(saved
        ? t('配置已保存，但刷新失败；重启前请重新核对设置。', 'Configuration was saved, but refresh failed. Review settings before restarting.')
        : t('未能更改配置。请等待所有会话空闲后重试。', 'Configuration was not updated. Wait for all sessions to become idle and retry.'));
    } finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const restart = async () => {
    if (operation.current || busy || !onRestart) return;
    operation.current = true; setPending(true); setError('');
    try { await onRestart(); }
    catch {
      if (alive.current) setError(t('未能重启，请先结束运行任务；定时宿主需在定时任务中处理。', 'Could not restart. Finish running work; manage scheduled hosts in Schedules first.'));
    } finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const changed = servers?.some(server => {
    const configured = catalog?.mcp.find(item => item.name === server.name);
    return configured && configured.enabled !== (server.status !== 'disabled');
  });
  return <section className="sb-mcp">
    <div className="sb-mcp-heading">
      <button className="sb-mcp-trigger" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <McpIcon size={14}/><span>MCP</span><span className={`sb-fold-icon${open ? ' is-open' : ''}`}><DisclosureChevron/></span>
        <span className="sb-mcp-count">{servers ? `${servers.filter(server => server.status === 'connected').length} / ${servers.length}` : '--'}</span>
      </button>
      {onManage && <button type="button" className="icon-button" aria-label={t('MCP 设置', 'MCP settings')}
        data-tooltip={t('MCP 设置', 'MCP settings')} onClick={onManage}><Settings2 size={13}/></button>}
    </div>
    <div id={id} className={`sb-disclosure${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}><div>
      <ul className="sb-mcp-list">{servers?.map(server => {
        const configured = catalog?.mcp.find(item => item.name === server.name);
        const enabled = configured?.enabled ?? server.status !== 'disabled';
        const waiting = configured && configured.enabled !== (server.status !== 'disabled');
        return <li key={server.name} className={`sb-mcp-server is-${server.status}`}>
          <button type="button" role="switch" aria-checked={enabled} aria-label={t(`启用 ${server.name}`, `Enable ${server.name}`)}
            className={`sb-service-switch${enabled ? ' is-enabled' : ''}`}
            disabled={busy || reading || pending || !configured?.configurable || !bridge?.capabilityMutate}
            onClick={() => void toggle(server.name, !enabled)}><i/></button>
          <span className="sb-server-name">{server.name}</span>
          <span className={`sb-server-status${waiting ? ' is-pending' : ''}`}>{waiting ? t('待重启', 'Restart pending') : ({
            connected: t('已连接', 'Connected'), connecting: t('连接中', 'Connecting'),
            failed: t('连接失败', 'Failed'), disabled: t('已关闭', 'Disabled'),
          })[server.status]}</span>
        </li>;
      })}{servers && !servers.length && <li className="sb-state">{t('没有已配置的服务', 'No configured servers')}</li>}</ul>
      {changed && <div className="sb-mcp-apply" role="status">
        <span>{t('配置已保存，当前连接尚未改变。', 'Saved; current connections are unchanged.')}</span>
        {onRestart && <button type="button" disabled={busy || pending} onClick={() => void restart()}>
          <RotateCcw size={12}/>{t('重启会话应用', 'Restart session to apply')}</button>}
      </div>}
      {error && <p className="sb-state sb-mcp-error" role="alert">{error}</p>}
    </div></div>
  </section>;
}
