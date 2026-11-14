import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Copy, Link2, Plus, RefreshCw, ShieldCheck, Unlink, X } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import type { ExternalConnectorAction, ExternalConnectorState } from './external-connectors';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import { ExternalApprovalPanel } from './ExternalApprovalPanel';
import { ExternalApprovalPolicies } from './ExternalApprovalPolicies';
import './external-connectors.css';

export function ExternalConnectorPanel({ bridge, language }: { bridge: DesktopBridge; language: string }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [state, setState] = useState<ExternalConnectorState>();
  const [name, setName] = useState('');
  const [roots, setRoots] = useState<string[]>([]);
  const [pluginRef, setPluginRef] = useState('');
  const [associations, setAssociations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [confirmation, setConfirmation] = useState<ExternalConnectorAction>();
  const alive = useRef(true);
  const trigger = useRef<HTMLElement | null>(null);
  const restoringFocus = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const disclosure = useAnimatedDisclosure(Boolean(confirmation));
  const failure = () => t('操作未完成，请刷新状态后重试。', 'Operation did not complete. Refresh the state and try again.');
  useEffect(() => {
    alive.current = true;
    void bridge.externalConnectorState().then(value => { if (alive.current) setState(value); })
      .catch(() => { if (alive.current) setError(failure()); });
    return () => { alive.current = false; };
  }, [bridge]);
  useEffect(() => { if (confirmation) cancel.current?.focus({ preventScroll: true }); }, [confirmation]);
  const close = () => { setConfirmation(undefined); trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!restoringFocus.current || busy || confirmation) return;
    restoringFocus.current = false;
    const target = trigger.current?.isConnected && !trigger.current.matches(':disabled') ? trigger.current : heading.current;
    target?.focus({ preventScroll: true });
  }, [busy, confirmation, state]);
  const restoreFocus = () => { restoringFocus.current = true; };
  const ask = (action: ExternalConnectorAction, element: HTMLElement) => {
    trigger.current = element; setConfirmation(action); setError('');
  };
  const act = async (action?: ExternalConnectorAction) => {
    if (busy) return false;
    setBusy(true); setError(''); setCopied('');
    try {
      const next = action ? await bridge.externalConnectorAction(action) : await bridge.externalConnectorState();
      if (!alive.current) return false;
      setState(next); setConfirmation(undefined);
      if (action?.type === 'pair') { setName(''); setRoots([]); setPluginRef(''); }
      if (confirmation) restoreFocus();
      return true;
    } catch (cause) {
      if (alive.current) {
        const message = cause instanceof Error ? cause.message : '';
        const detail = message.includes('connector:confirmation-cancelled') ? ''
          : /capability:(?:stale|invalid-confirmation)|connector:confirmation-stale/u.test(message)
            ? t('插件或风险声明已变化或不可用，请刷新并核对插件。若已重装，请撤销此连接后重新配对。',
              'The plugin or risk declaration changed or is unavailable. Refresh and check the plugin. After reinstalling, revoke this connection and pair again.')
            : message.includes('connector:confirmation-busy')
              ? t('请先完成或取消已打开的风险确认。', 'Finish or cancel the open risk confirmation first.')
              : action?.type === 'bind-plugin' && message.includes('connector:busy')
                ? t('请先停止此连接的任务并撤销长期委托，再关联插件。', 'Stop this connection’s tasks and revoke persistent policies before associating a plugin.')
                : failure();
        setConfirmation(undefined); setError(detail);
        if (confirmation) restoreFocus();
      }
      return false;
    }
    finally { if (alive.current) setBusy(false); }
  };
  const selected = roots.filter(root => state?.projects.some(project => project.workspace === root));
  const revoking = confirmation?.type === 'revoke'
    ? state?.connections.find(item => item.agentId === confirmation.agentId) : undefined;
  return <section className="external-connectors" aria-label={t('外部 Agent', 'External agents')} aria-busy={busy}>
    <div className="remote-section-heading">
      <h2 ref={heading} tabIndex={-1}>{t('本机外部委托', 'Local delegation')}</h2>
      <button className="icon-button" aria-label={t('刷新接入状态', 'Refresh connector state')}
        data-tooltip={t('刷新接入状态', 'Refresh connector state')} disabled={busy}
        onClick={() => void act()}><RefreshCw size={15}/></button>
    </div>
    <div className="external-connector-enable">
      <label className="checkbox"><input type="checkbox" role="switch" checked={Boolean(state?.enabled)}
        disabled={busy || !state} onChange={event => {
          if (event.target.checked) void act({ type: 'enable' });
          else ask({ type: 'disable' }, event.currentTarget);
        }}/><span>{t('允许本机 Agent 接入', 'Allow local agents')}</span></label>
      <span className={`external-connector-status ${state?.listening ? 'is-ready' : state?.error ? 'is-error' : ''}`} role="status">
        {state?.listening ? <Check size={14}/> : state?.error ? <CircleAlert size={14}/> : <X size={14}/>}
        {!state ? t('读取中', 'Loading') : state.error ? t('接入异常', 'Unavailable') : state.listening
          ? t('已开启', 'Enabled') : t('已关闭', 'Disabled')}
      </span>
    </div>
    <dl className="remote-properties external-connector-properties">
      <div><dt>{t('连接范围', 'Transport')}</dt><dd>127.0.0.1</dd></div>
      <div><dt>{t('工具审批与问题', 'Approvals and questions')}</dt><dd>{t('默认本机审批，可按任务委托普通工具请求', 'Local by default; ordinary tool requests can be delegated per task')}</dd></div>
      <div><dt>{t('退出 DFSC 后', 'When DFSC exits')}</dt><dd>{t('不可用，不自动重放任务', 'Offline; no task replay')}</dd></div>
    </dl>
    {state?.pluginDiscoveryUnavailable && <p role="status">{t(
      '插件列表暂不可用，无法新增插件关联。已有连接仍可停止或撤销；关联插件的授权仍需通过检查。',
      'The plugin list is unavailable, so new associations cannot be added. Existing connections can still be stopped or revoked; plugin-bound grants must still pass validation.')}</p>}
    <form className="external-connector-form" onSubmit={event => {
      event.preventDefault();
      if (state?.listening && name.trim() && selected.length)
        ask({ type: 'pair', displayName: name.trim(), roots: selected, ...(pluginRef ? { pluginRef } : {}) },
          event.currentTarget.querySelector('button[type=submit]')!);
    }}>
      <h3>{t('添加连接', 'Add connection')}</h3>
      <label><span>{t('连接名称', 'Connection name')}</span><input value={name} maxLength={100}
        placeholder={t('例如 Hermes', 'For example, Hermes')} disabled={busy || !state?.listening}
        onChange={event => { setName(event.target.value); setConfirmation(undefined); }}/></label>
      {Boolean(state?.plugins?.length) && <label><span>{t('关联插件', 'Associated plugin')}</span>
        <select value={pluginRef} disabled={busy || !state?.listening} onChange={event => {
          setPluginRef(event.target.value); setConfirmation(undefined);
        }}><option value="">{t('普通连接（不关联插件）', 'Generic connection (no plugin)')}</option>
          {state?.plugins?.map(plugin => <option key={plugin.ref} value={plugin.ref}>{plugin.name} ({plugin.id})</option>)}
        </select></label>}
      <fieldset className="remote-scope" disabled={busy || !state?.listening}>
        <legend>{t('授权项目', 'Authorized projects')}</legend>
        {state?.projects.map(project => <label key={project.workspace}>
          <input type="checkbox" checked={selected.includes(project.workspace)} onChange={event => {
            setRoots(previous => event.target.checked ? [...previous, project.workspace] : previous.filter(root => root !== project.workspace));
            setConfirmation(undefined);
          }}/><span><strong>{project.name}</strong><small>{project.workspace}</small></span>
        </label>)}
        {state && !state.projects.length && <p>{t('暂无可授权项目', 'No projects available')}</p>}
      </fieldset>
      <div className="remote-form-actions"><button type="submit" className="primary"
        disabled={busy || !state?.listening || !name.trim() || !selected.length || selected.length > 32 || state.connections.length >= 8}>
        <Plus size={14}/>{t('添加连接', 'Add connection')}</button></div>
    </form>
    <details className="remote-confirmation external-connector-confirmation" ref={disclosure.details}
      onKeyDown={event => { if (event.key === 'Escape' && confirmation && !busy) { event.preventDefault(); close(); } }}>
      <summary hidden>{t('确认授权操作', 'Confirm authorization')}</summary>
      <div ref={disclosure.body} inert={!confirmation}><div className="remote-confirmation-content">
        <strong>{confirmation?.type === 'pair' ? t(`授权 ${confirmation.displayName}？`, `Authorize ${confirmation.displayName}?`)
          : confirmation?.type === 'bind-plugin' ? t('将此连接关联到插件？', 'Associate this connection with a plugin?')
          : confirmation?.type === 'revoke' ? t(`撤销 ${revoking?.displayName ?? ''}？`, `Revoke ${revoking?.displayName ?? ''}?`)
            : t('关闭本机接入？', 'Disable local access?')}</strong>
        <p>{confirmation?.type === 'pair'
          ? t('允许持有连接凭据的本机进程在以下项目创建任务并读取其回答。不会验证它收到的消息是否来自真人；默认本机审批，委托需另外授权。目录授权不是文件系统沙箱。',
            'The local credential holder may create tasks and read their replies in these projects. Incoming messages are not verified as human instructions. Approvals are local by default; delegation requires separate authorization. Project scope is not a filesystem sandbox.')
          : confirmation?.type === 'bind-plugin' ? t('此连接之后的审批授权将检查该插件声明的风险。请先停止此连接的任务并撤销长期委托。关联不能直接解除或替换，需撤销连接后重新配对。',
            'Future approval grants for this connection will check the plugin risk declarations. Stop its tasks and revoke persistent policies first. The association cannot be detached or replaced without revoking and pairing again.')
          : t('新请求会被拒绝，尚未发出的输入会尝试撤回。已开始的任务保留，可在本机会话中停止。',
            'New requests will be rejected and unsent input will be withdrawn where possible. Started tasks remain available to stop locally.')}</p>
        {confirmation?.type === 'pair' && <ul>{confirmation.roots.map(root => <li key={root}>{root}</li>)}</ul>}
        {(confirmation?.type === 'pair' && confirmation.pluginRef || confirmation?.type === 'bind-plugin') && <p>
          {t('关联插件', 'Associated plugin')} · {state?.plugins?.find(plugin => plugin.ref === confirmation.pluginRef)?.name}
        </p>}
        <div className="remote-form-actions"><button ref={cancel} disabled={busy} onClick={close}>{t('取消', 'Cancel')}</button>
          <button className={confirmation?.type === 'pair' || confirmation?.type === 'bind-plugin' ? 'primary' : 'remote-danger'} disabled={busy}
            onClick={() => void act(confirmation)}><ShieldCheck size={14}/>{confirmation?.type === 'pair'
              ? t('确认授权', 'Confirm authorization') : confirmation?.type === 'bind-plugin' ? t('确认关联', 'Confirm association')
                : confirmation?.type === 'revoke' ? t('撤销连接', 'Revoke connection') : t('关闭接入', 'Disable access')}</button>
        </div>
      </div></div>
    </details>
    <section className="external-connector-list" aria-label={t('已授权 Agent', 'Authorized agents')}>
      <div className="remote-section-heading"><h3>{t('已授权 Agent', 'Authorized agents')}</h3><span>{state?.connections.length ?? 0} / 8</span></div>
      {state?.connections.map(item => <article key={item.agentId} className="external-connector-row">
        <div className="external-connector-row-heading"><Link2 size={16}/><strong>{item.displayName}</strong>
          <button className="icon-button" aria-label={t(`撤销 ${item.displayName}`, `Revoke ${item.displayName}`)}
            data-tooltip={t('撤销连接', 'Revoke connection')} disabled={busy}
            onClick={event => ask({ type: 'revoke', agentId: item.agentId }, event.currentTarget)}><Unlink size={15}/></button></div>
        <ul>{item.roots.map(root => <li key={root}>{root}</li>)}</ul>
        {item.plugin ? <p className="external-plugin-identity">{t('关联插件', 'Associated plugin')} · {item.plugin.id}</p>
          : Boolean(state.plugins?.length) && <div className="external-plugin-association">
            <label><span>{t('关联插件', 'Associated plugin')}</span>
              <select aria-label={t(`为 ${item.displayName} 选择插件`, `Choose a plugin for ${item.displayName}`)}
                value={associations[item.agentId] ?? ''} disabled={busy} onChange={event =>
                  setAssociations(value => ({ ...value, [item.agentId]: event.target.value }))}>
                <option value="">{t('选择插件', 'Choose a plugin')}</option>
                {state.plugins?.map(plugin => <option key={plugin.ref} value={plugin.ref}>{plugin.name} ({plugin.id})</option>)}
              </select></label>
            <button disabled={busy || !state.listening || !associations[item.agentId]} onClick={event =>
              ask({ type: 'bind-plugin', agentId: item.agentId, pluginRef: associations[item.agentId] }, event.currentTarget)}>
              <Link2 size={14}/>{t('关联插件', 'Associate plugin')}</button>
          </div>}
        <div className="external-connector-config"><span>{t('连接配置', 'Connection config')}</span><code>{item.configPath}</code>
          <button className="icon-button" aria-label={t(`复制 ${item.displayName} 配置路径`, `Copy ${item.displayName} config path`)}
            data-tooltip={t('复制配置路径', 'Copy config path')} onClick={() => void bridge.copyText(item.configPath)
              .then(() => { if (alive.current) setCopied(item.agentId); })
              .catch(() => { if (alive.current) setError(t('复制失败', 'Copy failed')); })}>
            {copied === item.agentId ? <Check size={14}/> : <Copy size={14}/>}</button></div>
      </article>)}
      {state && !state.connections.length && <p className="external-connector-empty">{t('暂无已授权 Agent', 'No authorized agents')}</p>}
    </section>
    {state?.approvals && <ExternalApprovalPolicies state={state} language={language}
      busy={busy} canDelegate={!error && state.listening} act={act}/>}
    {state?.approvals && <ExternalApprovalPanel state={state.approvals} language={language}
      names={new Map(state.connections.map(item => [item.agentId, item.displayName]))}
      busy={busy} canDelegate={!error && state.listening} act={act}/>}
    {error && <p className="remote-stage-error" role="alert"><CircleAlert size={14}/> {error}</p>}
    {copied && <span className="external-connector-announcement" role="status">{t('配置路径已复制', 'Config path copied')}</span>}
  </section>;
}
