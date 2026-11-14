import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { ExternalApprovalCategory, ExternalApprovalState, ExternalConnectorAction } from './external-connectors';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import { DisclosureChevron } from './DisclosureChevron';

type Task = ExternalApprovalState['tasks'][number];
type Props = { language: string; busy: boolean; canDelegate: boolean; act(action: ExternalConnectorAction): Promise<boolean> };
export function approvalTypeName(value: ExternalApprovalCategory, language: string) {
  return ({ command: ['普通命令', 'Ordinary commands'], file: ['文件修改', 'File changes'],
    risk: ['高风险工具操作', 'High-risk tools'], question: ['提问与回答', 'Questions and answers'] })[value][language === 'zh' ? 0 : 1];
}
export function ApprovalTypes({ categories, setCategories, language, busy }: {
  categories: ExternalApprovalCategory[]; setCategories(value: ExternalApprovalCategory[]): void; language: string; busy: boolean;
}) {
  return <fieldset disabled={busy}><legend>{language === 'zh' ? '可代审批类型' : 'Delegated request types'}</legend>
    {(['command', 'file', 'risk', 'question'] as const).map(category => <label className="checkbox" key={category}>
      <input type="checkbox" checked={categories.includes(category)} onChange={event =>
        setCategories(event.target.checked ? [...categories, category] : categories.filter(value => value !== category))}/>
      <span>{approvalTypeName(category, language)}</span>
    </label>)}
  </fieldset>;
}
function ApprovalTask({ task, name, language, busy, canDelegate, act }: Props & { task: Task; name: string }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(30);
  const [categories, setCategories] = useState<ExternalApprovalCategory[]>(['command', 'file']);
  const [now, setNow] = useState(Date.now());
  const disclosure = useAnimatedDisclosure(open);
  const trigger = useRef<HTMLButtonElement>(null);
  const [restore, setRestore] = useState(false);
  const active = task.delegation && (task.delegation.expiresAt === null || task.delegation.expiresAt > now) ? task.delegation : undefined;
  useEffect(() => {
    setNow(Date.now());
    if (!task.delegation) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task.delegation?.expiresAt]);
  useEffect(() => {
    if (!restore || busy) return;
    trigger.current?.focus({ preventScroll: true }); setRestore(false);
  }, [restore, busy, active]);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <article className="external-connector-row external-approval-task">
    <div className="external-connector-row-heading"><ShieldCheck size={16}/><strong>{task.title}</strong>
      <span className={`external-connector-status ${active ? 'is-ready' : ''}`}>
        {active ? t('委托中', 'Delegated') : t('本机审批', 'Local review')}
      </span></div>
    <p className="external-approval-owner">{name} <small>{task.agentId}</small></p>
    <p>{t('任务 ID', 'Task ID')} · <code>{task.taskId}</code></p>
    <code>{task.cwd}</code>
    <p>{task.pending ? t(`${task.pending} 项待处理请求`, `${task.pending} pending requests`)
      : t('暂无待处理请求', 'No pending requests')}{active && <> · {active.expiresAt === null
        ? active.policyId ? t('直到手动撤销', 'Until revoked') : t('本次任务有效', 'This task only')
        : `${t('到期', 'Expires')} ${new Date(active.expiresAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}`}</>}</p>
    {active && <p>{active.categories.map(value => approvalTypeName(value, language)).join(' · ')}</p>}
    <div className="remote-form-actions">
      {active ? <button ref={trigger} className="remote-danger" disabled={busy} onClick={() => {
        void act({ type: 'undelegate', taskId: task.taskId }).then(() => setRestore(true));
      }}>
        <ShieldOff size={14}/>{t('撤销审批委托', 'Revoke approval delegation')}</button>
        : <button ref={trigger} disabled={busy || !canDelegate} aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <ShieldCheck size={14}/>{t('委托此任务审批', 'Delegate this task’s approvals')}</button>}
    </div>
    <details className="remote-confirmation" ref={disclosure.details}
      onKeyDown={event => { if (event.key === 'Escape' && open && !busy) { event.preventDefault(); close(); } }}>
      <summary hidden>{t('委托范围', 'Delegation scope')}</summary>
      <div ref={disclosure.body} inert={!open}><div className="remote-confirmation-content external-approval-form">
        <p>{t('仅委托本任务选中的类型，Agent 可能判断错误。高风险和回答问题需要单独勾选；目录授权不是沙箱。无法完整分析、项目信任和权限提升仍留在本机。任务结束、到期或 DFSC 重启后失效。',
          'Only selected types are delegated for this task. Agent judgment can be wrong. Select high-risk tools and answering questions separately. Scope is not a sandbox. Incomplete requests, project trust and permission changes stay local. Ends with this task, expiry or restart.')}</p>
        <ApprovalTypes categories={categories} setCategories={setCategories} language={language} busy={busy}/>
        <label><span>{t('有效期', 'Duration')}</span><select value={minutes} disabled={busy} onChange={event => setMinutes(Number(event.target.value))}>
          <option value={0}>{t('本次任务', 'This task')}</option>
          {[15, 30, 60].map(value => <option value={value} key={value}>{value} {t('分钟', 'minutes')}</option>)}
        </select></label>
        <div className="remote-form-actions"><button disabled={busy} onClick={close}>{t('取消', 'Cancel')}</button>
          <button className="primary" disabled={busy || !canDelegate || !categories.length} onClick={() => {
            void act({ type: 'delegate', taskId: task.taskId, minutes, categories }).then(success => {
              if (success) { setOpen(false); setRestore(true); }
            });
          }}><ShieldCheck size={14}/>{t('确认委托审批', 'Confirm approval delegation')}</button></div>
      </div></div>
    </details>
  </article>;
}

export function ExternalApprovalPanel({ state, names, ...props }: Props & {
  state: ExternalApprovalState; names: Map<string, string>;
}) {
  const t = (zh: string, en: string) => props.language === 'zh' ? zh : en;
  const [auditOpen, setAuditOpen] = useState(false);
  const disclosure = useAnimatedDisclosure(auditOpen);
  const actions = {
    grant: t('开启委托', 'Delegation granted'), revoke: t('撤销委托', 'Delegation revoked'),
    allow: t('单次允许', 'Allowed once'), deny: t('拒绝', 'Denied'), escalate: t('转交人工', 'Escalated'),
  };
  return <section className="external-connector-list" aria-label={t('任务审批委托', 'Task approval delegation')}>
    <h3>{t('任务审批委托', 'Task approval delegation')}</h3>
    {state.tasks.length ? state.tasks.map(task => <ApprovalTask key={task.taskId} task={task}
      name={names.get(task.agentId) ?? task.agentId} {...props}/>)
      : <p className="external-connector-empty">{t('暂无进行中的外部任务', 'No active external tasks')}</p>}
    <button className="permission-approval-disclosure" aria-expanded={auditOpen} onClick={() => setAuditOpen(value => !value)}>
      <DisclosureChevron/>{t('审批记录', 'Approval history')} ({state.audit.length} / 200)</button>
    <details ref={disclosure.details}><summary hidden>{t('审批记录', 'Approval history')}</summary>
      <div ref={disclosure.body} inert={!auditOpen}><ol className="external-approval-audit">
        {state.audit.map((entry, index) => <li key={`${entry.at}-${index}`}>
          <strong>{actions[entry.action]}</strong> · {new Date(entry.at).toLocaleString(props.language === 'zh' ? 'zh-CN' : 'en-US')}
          <span>{names.get(entry.agentId) ?? entry.agentId} · {entry.scope === 'policy' ? t('长期策略', 'Persistent policy') : t('任务', 'Task')} · {entry.taskId}</span>
          {entry.callId && <code>{entry.callId}</code>}
          <span>{entry.outcome === 'prepared' ? t('结果未确认，勿重放', 'Outcome unconfirmed; do not replay')
            : entry.outcome === 'not-applied' ? t('未执行', 'Not applied') : t('已生效', 'Applied')} · {entry.reason}</span>
        </li>)}
      </ol></div>
    </details>
  </section>;
}
