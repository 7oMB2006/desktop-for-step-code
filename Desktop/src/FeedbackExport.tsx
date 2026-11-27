import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DesktopBridge, FeedbackEvent, FeedbackExcerpt, FeedbackOptions, FeedbackReport } from './contracts';
import { DisclosureChevron } from './DisclosureChevron';
import { DisclosureSelect } from './DisclosureSelect';
import { FeedbackIncidentTime } from './FeedbackIncidentTime';
import { feedbackIncidentTime } from './feedback-incident-time';
import './feedback-export.css';

function FeedbackSummary({ report, content, zh }: { report: FeedbackReport; content: string; zh: boolean }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const missing = t('未记录', 'Not recorded');
  const { events, context, summary } = report;
  const date = (value: string | null) => value ? new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'shortOffset',
  }) : missing;
  const text = (value: FeedbackExcerpt) => <span className="feedback-preview-text">{value.text || missing}
    {value.truncated && <small>{t('已截断', 'Truncated')}</small>}</span>;
  const row = (title: string, value: React.ReactNode) => <div><dt>{title}</dt><dd>{value}</dd></div>;
  const scope = report.scope === 'current_turn' ? t('当前轮', 'Current turn') : t('最近一次失败所在轮', 'Latest failed turn');
  const result = (event: FeedbackEvent) => {
    if (event.kind === 'model') return {
      error: t('回复失败', 'Response failed'), reply: t('已返回回复', 'Reply returned'),
      aborted: t('请求已中止', 'Request interrupted'), request: t('返回工具调用', 'Tool call returned'),
    }[event.result];
    return {
      started: t('已开始', 'Started'), ok: t('已完成', 'Completed'), error: t('失败', 'Failed'), timeout: t('超时', 'Timed out'),
      aborted: t('已中止', 'Interrupted'), denied: t('未获批准', 'Approval denied'), blocked: t('被策略阻止', 'Blocked by policy'),
      not_run: t('未执行', 'Not run'),
    }[event.result];
  };
  return <div className="feedback-summary">
    <section>
      <h3>{t('问题描述', 'Problem description')}</h3>
      <dl>
        {row(t('实际行为', 'Actual behavior'), text(report.actual))}
        {row(t('预期行为', 'Expected behavior'), text(report.expected))}
        {report.reportedAt && row(t('你填写的时间', 'Time you reported'), date(report.reportedAt))}
      </dl>
    </section>
    <section>
      <h3>{t('应用记录', 'Recorded by the app')}</h3>
      <dl>
        {row(t('运行环境', 'Environment'), <>DFSC {context.desktop} · {context.platform} {context.arch}<br/>
          Step Code {context.stepCode ? `${context.stepCode.baseline} (${context.stepCode.commit.slice(0, 8)})` : missing}</>)}
        {row(t('会话范围', 'Conversation scope'), scope)}
        {row(t('错误记录', 'Recorded errors'), t(`模型 ${summary.modelErrors} 条 · 工具 ${summary.toolErrors} 条`,
          `Model: ${summary.modelErrors} · Tool: ${summary.toolErrors}`))}
      </dl>
    </section>
    <section>
      <h3>{t('事件记录', 'Event timeline')}</h3>
      {summary.omittedEvents > 0 && <p>{t(`已截断：省略更早的 ${summary.omittedEvents} 条事件。`,
        `Truncated: ${summary.omittedEvents} earlier events omitted.`)}</p>}
      {!events.length ? <p>{t('未记录相关模型或工具事件。', 'No related model or tool events were recorded.')}</p> :
        <ol className="feedback-events">{events.map((event, index) => <li key={index}>
          <div className="feedback-event-heading">
            <strong>{event.kind === 'model' ? t('模型请求', 'Model request') : t(`工具调用 ${event.call}`, `Tool call ${event.call}`)}
              {' · '}{result(event)}</strong>
            <time dateTime={event.at ?? undefined}>{date(event.at)}</time>
          </div>
          {event.kind === 'tool' ? <>
            {event.toolName && <code>{event.toolName}</code>}
            {event.result !== 'started' && summary.toolsWithOnlyFinalResult.includes(event.call)
              && <p>{t('仅记录最终结果，未记录中间过程。', 'Only the final result was recorded.')}</p>}
            {summary.toolsWithNoResult.includes(event.call) && <p>{t('未记录结束结果。', 'No final result was recorded.')}</p>}
          </> : <dl>
            {row(t('模型', 'Model'), event.model
              ? `${event.model}${event.modelSource === 'requested' ? t('（请求时）', ' (requested)') : ''}` : missing)}
            {event.provider && row(t('提供方', 'Provider'), event.provider)}
            {event.statusCode !== null && row(t('HTTP 状态', 'HTTP status'), event.statusSource === 'error_text'
              ? `${event.statusCode}${t('（来自错误提示）', ' (from error text)')}` : event.statusCode)}
            {event.outcome === 'transport_error' && row(t('请求结果', 'Request outcome'), t('传输异常或中断', 'Transport error or interruption'))}
            {row(t('请求 ID', 'Request ID'), event.requestId ? <code>{event.requestId}</code> : missing)}
            {event.transportAttempts !== null && event.transportAttempts > 1 && row(t('传输次数', 'Transport attempts'),
              t(`${event.transportAttempts}（仅有计数，无逐次记录）`, `${event.transportAttempts} (count only; no per-attempt records)`))}
            {event.errorDetail && row(t('回复错误详情', 'Response error detail'), text(event.errorDetail))}
          </dl>}
        </li>)}</ol>}
    </section>
    <section>
      <h3>{t('可选正文', 'Optional excerpts')}</h3>
      {report.excerpts.length > 0 && <dl>
        {report.excerpts.map((excerpt, index) => <div key={index}>
          <dt>{excerpt.role === 'user' ? t('用户', 'User') : excerpt.role === 'toolResult' ? t('工具', 'Tool') : t('助手', 'Assistant')}</dt>
          <dd>{text(excerpt)}</dd>
        </div>)}
      </dl>}
      {summary.optionalText === 'excluded' && <p>{t('未包含会话正文或错误文本片段。', 'No conversation or error text excerpts included.')}</p>}
      {summary.optionalText === 'not_recorded' && <p>{t('未记录所选类型的文本片段。', 'No text was recorded for the selected excerpt types.')}</p>}
      {summary.optionalText === 'redaction_limit' && <p>{t('超出脱敏范围，已省略可选文本。', 'Optional text omitted because the redaction limit was reached.')}</p>}
      {summary.optionalText === 'included' && report.omittedEligibleMessages > 0 &&
        <p>{t(`已截断：另有 ${report.omittedEligibleMessages} 条文本未收录。`, `Truncated: ${report.omittedEligibleMessages} more excerpts omitted.`)}</p>}
      <p>{t('不含完整会话、附件、工作区文件、环境变量或原始日志。', 'Full sessions, attachments, workspace files, environment variables, and raw logs are excluded.')}</p>
    </section>
    <details className="feedback-json">
      <summary><DisclosureChevron/>{t('查看原始 JSON', 'View raw JSON')}</summary>
      <pre tabIndex={0}>{content}</pre>
    </details>
  </div>;
}

export function FeedbackExport({ bridge, runtimeId, sessionId, sessionTitle, zh, onClose, onSaved }: {
  bridge: DesktopBridge; runtimeId: string; sessionId: string; sessionTitle: string; zh: boolean;
  onClose: () => void; onSaved: (destination: 'default' | 'choose') => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [options, setOptions] = useState<FeedbackOptions>({ expected: '', actual: '', conversation: false, tools: false });
  const [preview, setPreview] = useState<Awaited<ReturnType<DesktopBridge['previewFeedback']>>>();
  const [incidentDate, setIncidentDate] = useState('');
  const [incidentTime, setIncidentTime] = useState('');
  const [validateIncident, setValidateIncident] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = zh ? '导出反馈包' : 'Export feedback bundle';
  const errorAt = feedbackIncidentTime(incidentDate, incidentTime);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    if (preview) heading.current?.focus({ preventScroll: true });
  }, [preview]);
  function close() {
    dialog.current?.close();
    onClose();
  }
  async function submit(destination?: 'default' | 'choose') {
    if (!preview && errorAt === null) { setValidateIncident(true); return; }
    setBusy(true); setError('');
    try {
      if (!preview) setPreview(await bridge.previewFeedback(runtimeId, sessionId, {
        ...options, errorAt: errorAt ?? undefined,
      }));
      else if (destination && await bridge.saveFeedback(runtimeId, sessionId, preview.token, destination)) {
        close();
        onSaved(destination);
      }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return createPortal(<dialog className="feedback-dialog" ref={dialog} aria-labelledby="feedback-title"
      onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
      <header>
        <h2 id="feedback-title" tabIndex={-1} ref={heading}>{title}</h2>
        <p title={sessionTitle}>{zh ? '当前会话 · ' : 'Conversation · '}{sessionTitle}</p>
      </header>
      <div className="feedback-body" ref={body}>{preview ? <>
        <FeedbackSummary report={JSON.parse(preview.content) as FeedbackReport} content={preview.content} zh={zh}/>
        <p className="feedback-destination">{zh ? '默认保存目录：' : 'Default folder: '}<code>{preview.defaultDirectory}</code></p>
      </> : <>
        <label>{zh ? '实际行为' : 'Actual behavior'}<textarea disabled={busy} maxLength={1000} value={options.actual}
          onChange={e => setOptions({ ...options, actual: e.target.value })}/></label>
        <label>{zh ? '预期行为' : 'Expected behavior'}<textarea disabled={busy} maxLength={1000} value={options.expected}
          onChange={e => setOptions({ ...options, expected: e.target.value })}/></label>
        <FeedbackIncidentTime date={incidentDate} time={incidentTime} setDate={setIncidentDate} setTime={setIncidentTime}
          zh={zh} disabled={busy} invalid={validateIncident && errorAt === null}/>
        <label className="feedback-event-choice">{zh ? '会话范围' : 'Conversation scope'}
          <DisclosureSelect disabled={busy} value={options.focus ?? 'failure'}
            onChange={event => setOptions({ ...options, focus: event.target.value === 'current' ? 'current' : 'failure' })}>
            <option value="failure">{zh ? '最近失败（无失败时取当前轮）' : 'Latest failure, or current turn'}</option>
            <option value="current">{zh ? '当前轮' : 'Current turn'}</option>
          </DisclosureSelect>
        </label>
        <fieldset disabled={busy}><legend>{zh ? '可选材料' : 'Optional evidence'}</legend>
          <label><input type="checkbox" checked={options.conversation} onChange={e => setOptions({ ...options, conversation: e.target.checked })}/>
            {zh ? '包含相关会话片段和回复错误详情' : 'Include conversation excerpts and response error details'}</label>
          <label><input type="checkbox" checked={options.tools} onChange={e => setOptions({ ...options, tools: e.target.checked })}/>
            {zh ? '包含失败工具输出片段' : 'Include failed tool output excerpts'}</label>
        </fieldset>
        <p>{zh ? '脱敏不保证移除所有敏感内容。' : 'Redaction may not remove all sensitive content.'}</p>
      </>}
      </div>
      {error && <p role="alert">{error}</p>}
      <footer><button disabled={busy} onClick={close}>{zh ? '取消' : 'Cancel'}</button>
        {preview ? <>
          <button disabled={busy} onClick={() => setPreview(undefined)}>{zh ? '返回编辑' : 'Edit'}</button>
          <button disabled={busy} onClick={() => void submit('choose')}>{zh ? '另存为…' : 'Save as…'}</button>
          <button className="primary" disabled={busy} onClick={() => void submit('default')}>{zh ? '保存到默认目录' : 'Save to default folder'}</button>
        </> : <button className="primary" disabled={busy} onClick={() => void submit()}>{zh ? '预览' : 'Preview'}</button>}</footer>
    </dialog>, document.body);
}
