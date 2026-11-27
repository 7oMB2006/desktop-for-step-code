import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { MAX_FEEDBACK_TURNS, type DesktopBridge, type FeedbackEvent, type FeedbackExcerpt, type FeedbackNotRunReason,
  type FeedbackOptions, type FeedbackReport, type FeedbackTurn, type FeedbackTurnEvidence } from './contracts';
import { DisclosureChevron } from './DisclosureChevron';
import { DisclosureSelect } from './DisclosureSelect';
import { FeedbackIncidentTime } from './FeedbackIncidentTime';
import { feedbackIncidentTime } from './feedback-incident-time';
import './feedback-export.css';

type Translate = (zh: string, en: string) => string;
function turnEvidenceLabel(evidence: FeedbackTurnEvidence, interrupted: boolean, t: Translate) {
  return [
    interrupted || evidence.outcome === 'aborted' ? t('已中止', 'Interrupted')
      : evidence.outcome === 'error' ? t('轮次失败', 'Turn failed')
      : evidence.outcome === 'completed' ? t('已结束', 'Completed') : t('无结束记录', 'No recorded end'),
    evidence.modelErrors ? t(`回复失败 ${evidence.modelErrors}`, `Response failures: ${evidence.modelErrors}`) : '',
    evidence.toolErrors ? t(`工具异常 ${evidence.toolErrors}`, `Tool issues: ${evidence.toolErrors}`) : '',
    evidence.toolsNotRun ? t(`工具未执行 ${evidence.toolsNotRun}`, `Tools not run: ${evidence.toolsNotRun}`) : '',
  ].filter(Boolean).join(' · ');
}

function FeedbackSummary({ report, content, zh }: { report: FeedbackReport; content: string; zh: boolean }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const missing = t('未记录', 'Not recorded');
  const { events, context, summary } = report;
  const redactionLimited = summary.redactionLimited || summary.optionalText === 'redaction_limit';
  const missingIdentifier = redactionLimited ? t('未显示', 'Not shown') : missing;
  const date = (value: string | null) => value ? new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'shortOffset',
  }) : missing;
  const text = (value: FeedbackExcerpt) => <span className="feedback-preview-text">{value.text || missing}
    {value.truncated && <small>{t('已截断', 'Truncated')}</small>}</span>;
  const row = (title: string, value: React.ReactNode) => <div><dt>{title}</dt><dd>{value}</dd></div>;
  const scope = {
    current_turn: t('最近已保存轮', 'Latest saved turn'), selected_turn: t('指定轮次', 'Selected turn'),
    selected_turns: t(`已选 ${report.turns?.length} 轮`, `${report.turns?.length} selected turns`),
    latest_interrupted_turn: t('最近异常所在轮', 'Latest turn with an issue'),
    latest_failed_turn: t('最近异常所在轮', 'Latest turn with an issue'),
  }[report.scope];
  const notRunLabel = (reason: FeedbackNotRunReason) => ({
    aborted_before_start: t('运行前中止', 'Interrupted before start'),
    invalid_arguments: t('参数校验失败', 'Invalid arguments'),
    output_truncated: t('模型输出截断', 'Model output truncated'),
    skipped_after_stop: t('停止后跳过', 'Skipped after stop'),
    tool_not_found: t('工具不存在', 'Tool not found'),
  })[reason];
  const reasons = (Object.entries(summary.notRunReasons ?? {}) as [FeedbackNotRunReason, number][])
    .map(([reason, count]) => `${notRunLabel(reason)}: ${count}`).join(' · ');
  const toolResultLabel = (result: Extract<FeedbackEvent, { kind: 'tool' }>['result']) => ({
    started: t('已开始', 'Started'), ok: t('已完成', 'Completed'), error: t('失败', 'Failed'), timeout: t('超时', 'Timed out'),
    aborted: t('已中止', 'Interrupted'), denied: t('未获批准', 'Approval denied'), blocked: t('被策略阻止', 'Blocked by policy'),
    not_run: t('未执行', 'Not run'),
  })[result];
  const toolGroups = (notRun: boolean) => {
    const groups = summary.toolIssueGroups?.filter(group => (group.result === 'not_run') === notRun) ?? [];
    return groups.length ? <>
      {groups.slice(0, 3).map((group, index) => <small className="feedback-nonexecution-reasons" key={index}>
        {group.turn && t(`入包轮次 ${group.turn} · `, `Included turn ${group.turn} · `)}
        {group.toolName ? <code>{group.toolName}</code> : t('其他或未识别工具', 'Other or unidentified tool')}
        {' · '}{group.notRunReason ? notRunLabel(group.notRunReason) : toolResultLabel(group.result)}: {group.count}
      </small>)}
      {groups.length > 3 && <small className="feedback-nonexecution-reasons">
        {t(`另有 ${groups.length - 3} 组，见原始 JSON`, `${groups.length - 3} more groups in raw JSON`)}
      </small>}
    </> : notRun && reasons ? <small className="feedback-nonexecution-reasons">{reasons}</small> : null;
  };
  const result = (event: FeedbackEvent) => {
    if (event.kind === 'model') return {
      error: t('回复失败', 'Response failed'), reply: t('已返回回复', 'Reply returned'),
      aborted: t('请求已中止', 'Request interrupted'), request: t('返回工具调用', 'Tool call returned'),
    }[event.result];
    return toolResultLabel(event.result);
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
        {report.turn?.startedAt && row(t('轮次开始', 'Turn started'), date(report.turn.startedAt))}
        {(report.turn?.interrupted || report.turn?.outcome) && row(t('轮次状态', 'Turn status'),
          report.turn.interrupted ? t('已中止', 'Interrupted') : report.turn.outcome === 'error'
            ? t('轮次失败', 'Turn failed') : t('已结束', 'Completed'))}
        {row(t('异常记录', 'Recorded issues'), <>
          {t(`模型 ${summary.modelErrors} 条 · 工具 ${summary.toolErrors} 条`,
            `Model: ${summary.modelErrors} · Tool: ${summary.toolErrors}`)}
          {toolGroups(false)}
        </>)}
        {summary.toolsNotRun > 0 && row(t('工具未执行', 'Tools not run'), <>
          {summary.toolsNotRun}{toolGroups(true)}
        </>)}
      </dl>
    </section>
    {report.turns && <section>
      <h3>{t('轮次与间隔', 'Turns and gaps')}</h3>
      <ol className="feedback-events">{report.turns.map(turn => {
        const gap = report.gaps?.find(item => item.after === turn.turn);
        return <li key={turn.turn}>
          <div className="feedback-event-heading">
            <strong>{t(`入包轮次 ${turn.turn}`, `Included turn ${turn.turn}`)}</strong>
            <time dateTime={turn.startedAt ?? undefined}>{date(turn.startedAt)}</time>
          </div>
          <p>{turnEvidenceLabel(turn, turn.interrupted, t)}{turn.omittedEvents > 0
            && t(` · 省略 ${turn.omittedEvents} 条事件`, ` · ${turn.omittedEvents} events omitted`)}</p>
          {gap && <div className="feedback-gap">
            {!gap.overview ? t(`中间 ${gap.count} 轮未选，未入包。`, `${gap.count} intervening turns not selected or included.`) : <>
              {t(`中间 ${gap.count} 轮，仅附摘要`, `Summary only: ${gap.count} intervening turns`)}
              <p>{t(
                `已结束 ${gap.overview.completed} · 已中止 ${gap.overview.aborted} · 轮次失败 ${gap.overview.failed} · 无结束记录 ${gap.overview.unknown}`,
                `Completed: ${gap.overview.completed} · Interrupted: ${gap.overview.aborted} · Failed: ${gap.overview.failed} · No recorded end: ${gap.overview.unknown}`,
              )}</p>
              <p>{t(`回复失败 ${gap.overview.modelErrors} · 工具异常 ${gap.overview.toolErrors} · 未执行 ${gap.overview.toolsNotRun}`,
                `Response failures: ${gap.overview.modelErrors} · Tool issues: ${gap.overview.toolErrors} · Not run: ${gap.overview.toolsNotRun}`)}</p>
            </>}
          </div>}
        </li>;
      })}</ol>
    </section>}
    <section>
      <h3>{t('事件记录', 'Event timeline')}</h3>
      {summary.omittedEvents > 0 && <p>{t(`达到容量上限，已省略 ${summary.omittedEvents} 条事件。`,
        `Event limit reached: ${summary.omittedEvents} events omitted.`)}</p>}
      {!events.length ? <p>{t('未记录相关模型或工具事件。', 'No related model or tool events were recorded.')}</p> :
        <ol className="feedback-events">{events.map((event, index) => <li key={index}>
          <div className="feedback-event-heading">
            <strong>{event.turn && t(`轮次 ${event.turn} · `, `Turn ${event.turn} · `)}
              {event.kind === 'model' ? t('模型请求', 'Model request') : t(`工具调用 ${event.call}`, `Tool call ${event.call}`)}
              {' · '}{result(event)}</strong>
            <time dateTime={event.at ?? undefined}>{date(event.at)}</time>
          </div>
          {event.kind === 'tool' ? <>
            {event.toolName && <code>{event.toolName}</code>}
            {event.notRunReason && <p>{notRunLabel(event.notRunReason)}</p>}
            {event.result !== 'started' && summary.toolsWithOnlyFinalResult.includes(event.call)
              && <p>{t('仅记录最终结果，未记录中间过程。', 'Only the final result was recorded.')}</p>}
            {summary.toolsWithNoResult.includes(event.call) && <p>{t('未记录结束结果。', 'No final result was recorded.')}</p>}
          </> : <dl>
            {row(t('模型', 'Model'), event.model
              ? `${event.model}${event.modelSource === 'requested' ? t('（请求时）', ' (requested)') : ''}` : missingIdentifier)}
            {event.provider && row(t('提供方', 'Provider'), event.provider)}
            {event.statusCode !== null && row(t('HTTP 状态', 'HTTP status'), event.statusSource === 'error_text'
              ? `${event.statusCode}${t('（来自错误提示）', ' (from error text)')}` : event.statusCode)}
            {event.outcome === 'transport_error' && row(t('请求结果', 'Request outcome'), t('传输异常或中断', 'Transport error or interruption'))}
            {row(t('请求 ID', 'Request ID'), event.requestId ? <code>{event.requestId}</code> : missingIdentifier)}
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
          <dt>{excerpt.turn && t(`轮次 ${excerpt.turn} · `, `Turn ${excerpt.turn} · `)}
            {excerpt.role === 'user' ? t('用户', 'User') : excerpt.role === 'toolResult' ? t('工具', 'Tool') : t('助手', 'Assistant')}</dt>
          <dd>{text(excerpt)}</dd>
        </div>)}
      </dl>}
      {summary.optionalText === 'excluded' && <p>{t('未包含会话正文或错误文本片段。', 'No conversation or error text excerpts included.')}</p>}
      {summary.optionalText === 'not_recorded' && <p>{t('未记录所选类型的文本片段。', 'No text was recorded for the selected excerpt types.')}</p>}
      {redactionLimited && <p>{t(
        '达到脱敏上限，未导出手填说明、可选文本或请求标识。结构化事件和工具汇总仍保留。',
        'The redaction limit was reached. Typed notes, optional excerpts, and request identifiers were not exported. Structured events and tool counts are still included.',
      )}</p>}
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
  const formScroll = useRef<number | undefined>(undefined);
  const [options, setOptions] = useState<FeedbackOptions>({ expected: '', actual: '', conversation: false, tools: false });
  const [turns, setTurns] = useState<FeedbackTurn[]>([]);
  const [turnState, setTurnState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  const [picked, setPicked] = useState<FeedbackTurn[]>([]);
  const [filter, setFilter] = useState<'issues' | 'all' | 'picked'>('issues');
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<Awaited<ReturnType<DesktopBridge['previewFeedback']>>>();
  const [incidentDate, setIncidentDate] = useState('');
  const [incidentTime, setIncidentTime] = useState('');
  const [validateIncident, setValidateIncident] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scopeId = useId();
  const t: Translate = (cn, en) => zh ? cn : en;
  const history = options.focus === 'history';
  const title = zh ? '导出反馈包' : 'Export feedback bundle';
  const errorAt = feedbackIncidentTime(incidentDate, incidentTime);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!history) return;
    let current = true;
    bridge.listFeedbackTurns(runtimeId, sessionId).then(
      value => { if (current) { setTurns(value); setTurnState('ready'); } },
      () => { if (current) setTurnState('error'); },
    );
    return () => { current = false; };
  }, [bridge, runtimeId, sessionId, refresh, history]);
  useEffect(() => {
    if (!body.current) return;
    if (preview) {
      body.current.scrollTop = 0;
      heading.current?.focus({ preventScroll: true });
    } else if (formScroll.current !== undefined) {
      body.current.scrollTop = formScroll.current;
      (document.getElementById(scopeId) ?? heading.current)?.focus({ preventScroll: true });
    }
  }, [preview, scopeId]);
  function close() {
    dialog.current?.close();
    onClose();
  }
  const turnDate = new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const issues = turns.filter(turn => turn.status !== null);
  const byKey = new Map(turns.map(turn => [turn.key, turn]));
  const pickedKeys = new Set(picked.map(turn => turn.key));
  const ordered = picked.map(turn => byKey.get(turn.key) ?? turn).sort((a, b) => b.number - a.number);
  const stale = picked.some(turn => !byKey.has(turn.key));
  const hasGap = ordered.some((turn, index) => index > 0 && ordered[index - 1].number - turn.number > 1);
  const shown = filter === 'issues' ? issues : filter === 'all' ? turns : ordered;
  const pageSize = filter === 'issues' ? 10 : 20;
  const lastPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1);
  const visiblePage = Math.min(page, lastPage);
  const visible = shown.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const available = MAX_FEEDBACK_TURNS - picked.length;
  const recent = issues.slice(0, 10).filter(turn => !pickedKeys.has(turn.key));
  function refreshTurns() {
    setTurnState('loading');
    setRefresh(value => value + 1);
  }
  function toggleTurn(turn: FeedbackTurn) {
    setPicked(previous => previous.some(item => item.key === turn.key) ? previous.filter(item => item.key !== turn.key)
      : previous.length < MAX_FEEDBACK_TURNS ? [...previous, turn] : previous);
  }
  async function submit(destination?: 'default' | 'choose') {
    if (!preview && errorAt === null) { setValidateIncident(true); return; }
    if (!preview && history && (!picked.length || stale || turnState !== 'ready')) return;
    setBusy(true); setError('');
    try {
      if (!preview) {
        formScroll.current = body.current?.scrollTop ?? 0;
        setPreview(await bridge.previewFeedback(runtimeId, sessionId, {
          ...options, errorAt: errorAt ?? undefined, turnKeys: history ? picked.map(turn => turn.key) : undefined,
          includeBetween: history && hasGap && options.includeBetween,
        }));
      }
      else if (destination && await bridge.saveFeedback(runtimeId, sessionId, preview.token, destination)) {
        close();
        onSaved(destination);
      }
    } catch (e) {
      const message = String(e);
      if (message.includes('selected turn is no longer available')) {
        refreshTurns();
        setError(t('已选轮次已变化，请核对后重新选择。', 'Selected turns changed. Review your selection and try again.'));
      } else if (message.includes('No committed feedback history')) {
        setError(t('暂时没有已保存的轮次记录。请等本轮结束后重试。', 'No saved turn history yet. Try again after this turn ends.'));
      } else if (message.includes('Preview the conversation again') || message.includes('Preview the selected conversation again')) {
        setError(t('会话或分支已变化，请返回编辑并重新预览。', 'The conversation or branch changed. Edit and preview again.'));
        if (history) refreshTurns();
      } else setError(message);
    } finally { setBusy(false); }
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
        <label className="feedback-event-choice" htmlFor={scopeId}>{t('会话范围', 'Conversation scope')}
          <DisclosureSelect id={scopeId} disabled={busy} value={options.focus ?? 'failure'}
            onChange={event => {
              const focus = event.target.value as 'failure' | 'current' | 'history';
              setOptions(previous => ({ ...previous, focus }));
              setError('');
              if (focus === 'history') refreshTurns();
            }}>
            <option value="failure">{t('最近异常（无则取最近已保存轮）', 'Latest issue, or latest saved turn')}</option>
            <option value="current">{t('最近已保存轮', 'Latest saved turn')}</option>
            <option value="history">{t('从历史中选择轮次', 'Select turns from history')}</option>
          </DisclosureSelect>
        </label>
        {history && <fieldset className="feedback-turn-picker" aria-label={t('已记录轮次', 'Recorded turns')} disabled={busy}>
          <div className="feedback-turn-toolbar">
            <div className="feedback-turn-filters" role="group" aria-label={t('筛选轮次', 'Filter turns')}>
              {([
                ['issues', t('异常', 'Issues')], ['all', t('全部', 'All')], ['picked', t('已选', 'Selected')],
              ] as const).map(([key, name]) => <button type="button" key={key} aria-pressed={filter === key}
                onClick={() => { setFilter(key); setPage(0); }}>{name}</button>)}
            </div>
            <button className="feedback-icon-button" type="button" disabled={turnState === 'loading'} onClick={refreshTurns}
              title={t('刷新轮次', 'Refresh turns')} aria-label={t('刷新轮次', 'Refresh turns')}><RefreshCw size={14}/></button>
          </div>
          <div className="feedback-turn-selection">
            <span role="status">{t(`已选 ${picked.length} / ${MAX_FEEDBACK_TURNS} 轮`, `${picked.length} / ${MAX_FEEDBACK_TURNS} selected`)}</span>
            {filter === 'issues' && issues.length > 0 && <button type="button"
              disabled={!recent.length || recent.length > available || turnState !== 'ready'}
              onClick={() => setPicked(previous => [...previous, ...recent])}>
              {t(`勾选最近 ${Math.min(issues.length, 10)} 个异常`, `Select latest ${Math.min(issues.length, 10)} issues`)}
            </button>}
            {filter === 'picked' && picked.length > 0 &&
              <button type="button" onClick={() => setPicked([])}>{t('清空已选', 'Clear selection')}</button>}
          </div>
          {turnState === 'loading' && <p role="status">{t('正在读取已保存的轮次…', 'Loading saved turns…')}</p>}
          {turnState === 'error' && <p role="status">{t('无法读取轮次，刷新后重试。', 'Could not read turns. Refresh to try again.')}</p>}
          {turnState === 'ready' && stale && <p role="status">{t('部分已选轮次已变化，请在「已选」中取消失效项。',
            'Some selected turns changed. Remove unavailable turns under Selected.')}</p>}
          {turnState === 'ready' && !shown.length && <p>{filter === 'issues' && turns.length ? t('没有异常记录。', 'No recorded issues.')
            : filter === 'picked' ? t('未选择轮次。', 'No turns selected.') : t('还没有可选择的已保存轮次。', 'No saved turns to select yet.')}</p>}
          {visible.length > 0 && <ul className="feedback-turn-list">
            {visible.map(turn => {
              const checked = pickedKeys.has(turn.key);
              const unavailable = turnState === 'ready' && !byKey.has(turn.key);
              return <li key={turn.key}><label>
                <input type="checkbox" checked={checked} disabled={!checked && (!available || turnState !== 'ready')}
                  onChange={() => toggleTurn(turn)}/>
                <span>
                  <strong>{t(`第 ${turn.number} 轮`, `Turn ${turn.number}`)}</strong>
                  {turn.startedAt && <time dateTime={turn.startedAt}>{turnDate.format(new Date(turn.startedAt))}</time>}
                  <small>{unavailable ? t('已失效', 'Unavailable') : turnEvidenceLabel(turn.evidence, turn.status === 'interrupted', t)}</small>
                </span>
              </label></li>;
            })}
          </ul>}
          {lastPage > 0 && <div className="feedback-turn-pages">
            <button className="feedback-icon-button" type="button" disabled={!visiblePage} onClick={() => setPage(visiblePage - 1)}
              title={t('较新的轮次', 'Newer turns')} aria-label={t('较新的轮次', 'Newer turns')}><ChevronLeft size={15}/></button>
            <span>{visiblePage + 1} / {lastPage + 1}</span>
            <button className="feedback-icon-button" type="button" disabled={visiblePage === lastPage} onClick={() => setPage(visiblePage + 1)}
              title={t('更早的轮次', 'Earlier turns')} aria-label={t('更早的轮次', 'Earlier turns')}><ChevronRight size={15}/></button>
          </div>}
          {hasGap && <label className="feedback-turn-gap-option">
            <input type="checkbox" checked={options.includeBetween ?? false}
              onChange={e => setOptions({ ...options, includeBetween: e.target.checked })}/>
            {t('附上中间轮次的摘要（不含正文）', 'Include intervening turn summaries (no text)')}
          </label>}
        </fieldset>}
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
          <button disabled={busy} onClick={() => { setPreview(undefined); setError(''); }}>{zh ? '返回编辑' : 'Edit'}</button>
          <button disabled={busy} onClick={() => void submit('choose')}>{zh ? '另存为…' : 'Save as…'}</button>
          <button className="primary" disabled={busy} onClick={() => void submit('default')}>{zh ? '保存到默认目录' : 'Save to default folder'}</button>
        </> : <button className="primary" disabled={busy || (history && (!picked.length || stale || turnState !== 'ready'))}
          onClick={() => void submit()}>{zh ? '预览' : 'Preview'}</button>}</footer>
    </dialog>, document.body);
}
