import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { ExternalApprovalCategory, ExternalApprovalPolicy, ExternalConnectorAction, ExternalConnectorState } from './external-connectors';
import { approvalTypeName, ApprovalTypes } from './ExternalApprovalPanel';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';

type Props = { language: string; busy: boolean; canDelegate: boolean; act(action: ExternalConnectorAction): Promise<boolean> };
function PolicyRow({ agentId, name, cwd, policy, language, busy, canDelegate, act }: Props & {
  agentId: string; name: string; cwd: string; policy?: ExternalApprovalPolicy;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState('7');
  const [preset, setPreset] = useState<'ask' | 'approve-for-me'>('ask');
  const [categories, setCategories] = useState<ExternalApprovalCategory[]>(['command', 'file']);
  const disclosure = useAnimatedDisclosure(open);
  const trigger = useRef<HTMLButtonElement>(null);
  const [restore, setRestore] = useState(false);
  useEffect(() => {
    if (restore && !busy) { trigger.current?.focus({ preventScroll: true }); setRestore(false); }
  }, [restore, busy]);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <article className="external-connector-row external-approval-policy">
    <div className="external-connector-row-heading"><ShieldCheck size={16}/><strong>{name}</strong>
      <span className={`external-connector-status ${policy ? 'is-ready' : ''}`}>{policy ? t('长期委托中', 'Policy active') : t('未设置', 'Not configured')}</span></div>
    <code>{cwd}</code>
    {policy && <>
      <p>{policy.permissionPreset === 'ask' ? 'Ask' : t('代我批准', 'Approve for me')} · {policy.expiresAt === null
        ? t('直到手动撤销', 'Until revoked') : new Date(policy.expiresAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</p>
      <p>{policy.categories.map(value => approvalTypeName(value, language)).join(' · ')}</p>
    </>}
    <div className="remote-form-actions">
      <button ref={trigger} disabled={busy || !canDelegate} aria-expanded={open} onClick={() => {
        if (!open && policy) {
          setPreset(policy.permissionPreset); setCategories(policy.categories);
          setDays(policy.expiresAt === null ? 'forever' : String(Math.round((policy.expiresAt - policy.createdAt) / 86400000)));
        }
        setOpen(!open);
      }}><ShieldCheck size={14}/>{policy ? t('修改长期委托', 'Edit policy') : t('设置长期委托', 'Set policy')}</button>
      {policy && <button className="remote-danger" disabled={busy}
        onClick={() => void act({ type: 'unpolicy', agentId, cwd }).then(success => { if (success) { close(); setRestore(true); } })}>
        <ShieldOff size={14}/>{t('撤销长期委托', 'Revoke policy')}</button>}
    </div>
    <details ref={disclosure.details} className="remote-confirmation"
      onKeyDown={event => { if (event.key === 'Escape' && open && !busy) { event.preventDefault(); close(); } }}>
      <summary hidden>{t('长期委托设置', 'Persistent policy')}</summary>
      <div ref={disclosure.body} inert={!open}><div className="remote-confirmation-content external-approval-form">
        <p>{t('仅此 Agent 和此项目，跨任务、跨 DFSC 重启保留。权限档位用于新任务；修改或撤销会中止仍使用旧自动权限的任务。Agent 审阅可能出错，高风险与回答问题请按需单独选择。目录授权不是沙箱，项目信任和权限提升不在委托范围内。',
          'Only this agent and project, across tasks and restarts. The permission tier applies to new tasks; replacing or revoking stops tasks using the old automatic tier. Agent review can be wrong. Select high-risk tools and answering questions separately. Scope is not a sandbox; project trust and permission changes remain local.')}</p>
        <label><span>{t('DFSC 权限档位', 'DFSC permission tier')}</span><select value={preset} disabled={busy}
          onChange={event => setPreset(event.target.value as typeof preset)}>
          <option value="ask">{t('Ask：先审批', 'Ask: review first')}</option>
          <option value="approve-for-me">{t('代我批准：常规自动执行', 'Approve for me')}</option>
        </select></label>
        {preset === 'approve-for-me' && <p>{t('常规命令和写入由 DFSC 自动执行，不受下方勾选项限制；下方仅决定哪些剩余审批交给 Agent。',
          'DFSC runs ordinary commands and writes automatically, regardless of the checkboxes below. These only select which remaining requests the agent may review.')}</p>}
        <ApprovalTypes categories={categories} setCategories={setCategories} language={language} busy={busy}/>
        <label><span>{t('有效期', 'Duration')}</span><select value={days} disabled={busy} onChange={event => setDays(event.target.value)}>
          {[1, 7, 30].map(day => <option key={day} value={day}>{day} {t('天', 'days')}</option>)}
          <option value="forever">{t('直到手动撤销', 'Until revoked')}</option>
        </select></label>
        <div className="remote-form-actions"><button disabled={busy} onClick={close}>{t('取消', 'Cancel')}</button>
          <button className="primary" disabled={busy || !canDelegate || !categories.length} onClick={() =>
            void act({ type: 'policy', agentId, cwd, days: days === 'forever' ? null : Number(days) as 1 | 7 | 30,
              categories, permissionPreset: preset }).then(success => { if (success) { close(); setRestore(true); } })}>
            <ShieldCheck size={14}/>{t('确认长期委托', 'Confirm policy')}</button></div>
      </div></div>
    </details>
  </article>;
}

export function ExternalApprovalPolicies({ state, ...props }: Props & { state: ExternalConnectorState }) {
  if (!state.approvals || !state.connections.length) return null;
  return <section className="external-connector-list" aria-label={props.language === 'zh' ? '长期审批委托' : 'Persistent approval policies'}>
    <h3>{props.language === 'zh' ? '长期审批委托' : 'Persistent approval policies'}</h3>
    {state.connections.flatMap(connection => connection.roots.map(cwd =>
      <PolicyRow key={`${connection.agentId}:${cwd}`} {...props}
        policy={state.approvals?.policies?.find(p => p.agentId === connection.agentId && p.cwd === cwd)}
        agentId={connection.agentId} name={connection.displayName} cwd={cwd}/>))}
  </section>;
}
