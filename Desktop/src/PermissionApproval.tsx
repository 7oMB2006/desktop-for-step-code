import { useId, useState } from 'react';
import { CircleHelp, ShieldAlert, Terminal } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import type { PermissionApprovalPresentation } from './approval-presentation';
import './permission-approval.css';

export function PermissionApproval({ presentation: p, language, onLater, onRespond }: {
  presentation: PermissionApprovalPresentation;
  language: string;
  onLater: () => void;
  onRespond: (value: { confirmed: true } | { cancelled: true }) => Promise<void>;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const rawId = useId();
  const titleId = useId();
  const reasonId = useId();
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const Icon = p.category === 'hazardous' ? ShieldAlert : p.category === 'uncertain' ? CircleHelp : Terminal;
  const respond = async (value: { confirmed: true } | { cancelled: true }) => {
    if (pending) return;
    setPending(true);
    try { await onRespond(value); } finally { setPending(false); }
  };
  return <div className="modal-backdrop higher">
    <section className="small-dialog permission-approval" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={reasonId}>
      <div className="permission-approval-content">
      <div className={`permission-approval-category ${p.category}`}><Icon size={17}/>
        <span>{p.category === 'uncertain' ? t('无法自动判断', 'Analysis incomplete')
          : p.category === 'hazardous' ? t('命中高风险规则', 'High-risk rule matched') : t('等待你的批准', 'Awaiting approval')}</span>
      </div>
      <h2 id={titleId}>{p.title}</h2>
      <p id={reasonId} className="permission-approval-reason">{p.reason}</p>
      {p.category === 'uncertain' && <p className="permission-approval-note">{t('无法分析不等于已经判断为危险或安全。', 'Incomplete analysis is not a verdict that the command is dangerous or safe.')}</p>}
      <div className="permission-approval-input-heading">
        <strong>{p.inputKind === 'command' ? t('完整命令', 'Full command')
          : p.inputKind === 'parameters' ? t('完整调用参数', 'Full tool input') : t('调用摘要', 'Tool call summary')}</strong>
        <code>{p.toolName}</code>
      </div>
      <pre className="permission-approval-input" tabIndex={0}>{p.input}</pre>
      {p.otherParameters && <><p className="permission-approval-input-heading">{t('其他调用参数', 'Other tool parameters')}</p><pre className="permission-approval-input">{p.otherParameters}</pre></>}
      {p.inputKind === 'summary' && <p className="permission-approval-note">{t('完整参数暂不可用；上游摘要可能已截断。', 'Full input is unavailable; the upstream summary may be truncated.')}</p>}
      <button type="button" className="permission-approval-disclosure" aria-expanded={rawOpen} aria-controls={rawId} onClick={() => setRawOpen(value => !value)}>
        <DisclosureChevron/>{t('原始审批信息', 'Original approval details')}
      </button>
      {rawOpen && <pre id={rawId} className="permission-approval-raw">{p.rawMessage}</pre>}
      <p className="permission-approval-note">{t('本次批准仅针对这一次工具调用。', 'Approval applies only to this tool call.')}</p>
      </div>
      <div className="button-row">
        <button type="button" disabled={pending} onClick={onLater}>{t('稍后处理', 'Review later')}</button>
        <button type="button" disabled={pending} onClick={() => void respond({ cancelled: true })}>{t('拒绝本次操作', 'Deny this call')}</button>
        <button type="button" className="primary" disabled={pending} onClick={() => void respond({ confirmed: true })}>{t('批准本次操作', 'Approve this call')}</button>
      </div>
    </section>
  </div>;
}
