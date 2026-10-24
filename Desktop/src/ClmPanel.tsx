import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Code2, FileText, History, LockKeyhole, Minus, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Snapshot } from './contracts';
import type { ClmAction, ClmSnapshot } from './clm';
import { clmChanges, clmTextTitle } from './clm-diff';
import { WorkingContextIcon } from './ContextCommandIcon';
import { DisclosureChevron } from './DisclosureChevron';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import { MatrixPulse } from './WorkingIndicator';
import './clm-panel.css';
import './context-command-icon.css';

function RevisionLabel({ value }: { value: number }) {
  return <span className={`clm-revision-label${String(value).length > 3 ? ' is-long' : ''}`}><span className="clm-revision-prefix">r</span><span className="clm-revision-number">{value}</span></span>;
}

function fitPicker(select: HTMLSelectElement) {
  select.style.setProperty('--clm-picker-height', `${Math.max(40, innerHeight - select.getBoundingClientRect().bottom - 12)}px`);
}

function Disclosure({ label, children, icon = <ShieldCheck size={14}/> }: { label: string; children: ReactNode; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { details, body } = useAnimatedDisclosure(open);
  return <details ref={details} className="clm-disclosure" data-expanded={open}>
    <summary aria-expanded={open} onClick={event => { event.preventDefault(); setOpen(value => !value); }}>
      {icon}<span>{label}</span><DisclosureChevron/>
    </summary><div ref={body} inert={!open} aria-hidden={!open}>{children}</div>
  </details>;
}

function ReadableText({ text, omitTitle }: { text: string; omitTitle?: string }) {
  const body = text.replace(/^\s*#{1,6}\s+([^\n]+)\n*/, (match, heading: string) => heading.trim() === omitTitle ? '' : match);
  return <div className="clm-readable"><Markdown skipHtml components={{
    a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt}</span>,
  }}>{body}</Markdown></div>;
}

function ClmDiff({ diff, language }: { diff: string; language: 'zh' | 'en' }) {
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const changes = useMemo(() => clmChanges(diff), [diff]);
  const [selection, setSelection] = useState('');
  const active = changes.find(item => item.id === selection) ?? changes[0];
  return <div className="clm-diff">
    {active ? <>
      <label>{t('选择修改', 'Select change')}<span className="clm-select"><select value={active.id} onChange={event => setSelection(event.target.value)}
        onPointerDown={event => fitPicker(event.currentTarget)} onFocus={event => fitPicker(event.currentTarget)}>
        {changes.map((item, index) => <option key={item.id} value={item.id}>{item.title || t(`修改片段 ${index + 1}`, `Change fragment ${index + 1}`)}</option>)}
      </select><DisclosureChevron/></span></label>
      <div className="clm-document-heading"><span>{t('保存的修改片段', 'Saved change fragment')}</span><small>{t('节选', 'Excerpt')}</small></div>
      <h3>{active.title || t('上下文修改', 'Context change')}</h3>
      <div className="clm-comparison">
        <section className="clm-diff-before" aria-label={t('修改前', 'Before')}><header><Minus size={12}/><span>{t('修改前', 'Before')}</span></header>
          {active.before ? <ReadableText text={active.before} omitTitle={active.title}/> : <p className="clm-note">{t('此片段为新增内容。', 'This fragment was added.')}</p>}</section>
        <section className="clm-diff-after" aria-label={t('修改后', 'After')}><header><Plus size={12}/><span>{t('修改后', 'After')}</span></header>
          {active.after ? <ReadableText text={active.after} omitTitle={active.title}/> : <p className="clm-note">{t('此片段已删除。', 'This fragment was removed.')}</p>}</section>
      </div>
    </> : <p className="clm-note">{diff ? t('当前记录未提供可读的修改片段，可查看原始对比。', 'No readable fragments are available; the saved diff is below.') : t('此记录没有保存修改对比。', 'No diff was saved for this record.')}</p>}
    {diff && <Disclosure label={t('原始修改对比', 'Raw saved diff')} icon={<Code2 size={14}/>}>
      <pre>{diff.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') ? 'is-addition' : line.startsWith('-') ? 'is-removal' : ''}>{line}{'\n'}</span>)}</pre>
    </Disclosure>}
  </div>;
}

export function ClmPanel({ snapshot, busy, revision, visible = true }: { snapshot: Snapshot; busy: boolean; revision: number; visible?: boolean }) {
  const zh = snapshot.preferences.language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const sessionId = snapshot.state?.sessionId;
  const runtimeId = snapshot.runtimeId;
  const canRead = Boolean(runtimeId && sessionId && !snapshot.draftId && ['ready', 'connected'].includes(snapshot.status));
  const [selected, setSelected] = useState<string>();
  const [reading, setReading] = useState<{ key: string; data?: ClmSnapshot; error?: string }>({ key: '' });
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<number | null>(null);
  const [view, setView] = useState<'overview' | 'content' | 'diff'>('overview');
  const [blockId, setBlockId] = useState('');
  const [action, setAction] = useState<ClmAction>();
  const [failure, setFailure] = useState('');
  const [intent, setIntent] = useState(false);
  const [guidance, setGuidance] = useState('');
  const { details: formDetails, body: formBody } = useAnimatedDisclosure(intent);
  const owner = `${runtimeId}:${sessionId}`;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const lock = useRef(false);
  const key = JSON.stringify([owner, selected, revision, refresh, canRead, busy, snapshot.state?.isCompacting]);
  const data = canRead && reading.data?.sessionId === sessionId ? reading.data : undefined;
  const pending = reading.key !== key;
  const detail = !pending || action ? data?.selected : undefined;
  useEffect(() => {
    if (!canRead || !window.desktop || action || !visible) return;
    let disposed = false;
    void window.desktop.clm(runtimeId!, selected).then(result => {
      if (disposed) return;
      if (result.sessionId !== sessionId) throw new Error('Session changed');
      setReading({ key, data: result });
    }).catch(error => {
      if (!disposed) setReading({ key, error: String(error) });
    });
    return () => { disposed = true; };
  }, [key, action, visible]);
  const revisions = data?.revisions ?? [];
  const latest = revisions.at(-1);
  const current = revisions.find(item => item.entryId === (selected ?? data?.selected?.entryId));
  const historical = Boolean(current && latest && current.entryId !== latest.entryId);
  const offset = Math.min(page ?? Math.max(0, revisions.length - 5), Math.max(0, revisions.length - 5));
  const blocks = detail?.blocks ?? [];
  const active = blocks.find(block => block.id === blockId) ?? blocks[0];
  const outcome = current && current.entryId === latest?.entryId && data?.lastOutcome?.revision === current.revision && data.lastOutcome.accepted
    ? data.lastOutcome : undefined;
  const disabled = !data || pending || busy || snapshot.state?.isCompacting || Boolean(action) || Boolean(snapshot.requests?.length) ||
    snapshot.launch?.goal?.status === 'active';
  const number = (value?: number) => value === undefined ? '--' : value.toLocaleString(zh ? 'zh-CN' : 'en-US');
  const roleLabel = (role: string) => ({ user: t('用户要求', 'User request'), assistant: t('助手记录', 'Assistant record'),
    notes: t('工作笔记', 'Working notes'), toolResult: t('工具结果', 'Tool result') })[role] ?? role;
  const title = (text: string, role: string) => clmTextTitle(text, roleLabel(role));
  const back = () => { setSelected(undefined); setPage(null); setIntent(false); };
  const perform = async (next: ClmAction) => {
    if (disabled || lock.current || !window.desktop || !runtimeId || !sessionId) return;
    lock.current = true; setAction(next); setFailure(''); setIntent(false);
    try {
      await window.desktop.clmAction(runtimeId, sessionId, next, next === 'compact' ? guidance : undefined);
    } catch (error) {
      if (ownerRef.current === owner) setFailure(String(error));
    } finally {
      lock.current = false;
      if (ownerRef.current === owner) { setAction(undefined); setRefresh(value => value + 1); }
    }
  };
  return <section className="clm-workspace" aria-label={t('CLM 工作上下文', 'CLM working context')}>
    <header className="clm-heading"><WorkingContextIcon size={25}/><div><h2>{t('工作上下文', 'Working context')}</h2><small>{t('上下文版本与修改记录', 'Revisions and changes')}</small></div>
      <label>{t('启用 CLM', 'Enable CLM')}<button type="button" className="clm-toggle" role="switch" aria-label={t('启用 CLM', 'Enable CLM')}
        aria-checked={data?.enabled ?? false} disabled={disabled} onClick={() => void perform(data?.enabled ? 'off' : 'on')}><i/></button></label>
    </header>
    <div className="clm-live" role="status">
      {action === 'compact' || snapshot.state?.isCompacting ? <MatrixPulse mode="compacting"/> : <WorkingContextIcon size={14}/>}
      <span>{action ? t('正在更新工作上下文', 'Updating working context') : !canRead ? t('会话未连接', 'Session offline') :
        !data ? t('状态暂不可用', 'Status unavailable') : data.enabled ? t('CLM 已启用', 'CLM enabled') : t('CLM 已关闭', 'CLM disabled')}</span>
      {data?.revision !== undefined && <small>{t('运行时', 'Runtime')} · <RevisionLabel value={data.revision}/></small>}
    </div>
    <Disclosure label={t('自动整理策略', 'Automatic maintenance')}>
      <p>{t('达到运行时阈值且存在可整理内容时，才尝试自动整理；不是每轮执行，也不是定时任务。整理可能产生模型用量。', 'The runtime attempts maintenance when its threshold is met and reducible content exists, not every turn or on a schedule. Maintenance may use model tokens.')}</p>
    </Disclosure>
    {!data ? <div className="clm-empty">
      <p>{!canRead ? t('启动会话后可查看 CLM。', 'Start a session to inspect CLM.') : reading.key === key && reading.error
        ? t('无法读取 CLM，运行时可能尚未支持此接口。', 'CLM could not be read. This runtime may not support the inspector yet.') : t('读取中…', 'Loading…')}</p>
      {canRead && <button onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14}/>{t('重试', 'Retry')}</button>}
      {selected && <button onClick={back}>{t('回到当前分支', 'Return to current branch')}</button>}
    </div> : <>
      {!data.enabled && <p className="clm-note">{t('已停用工作上下文投影。历史记录仍可只读查看。', 'Working-context projection is disabled. Saved revisions remain read-only.')}</p>}
      <div className="clm-section-title"><h3>{t('上下文版本', 'Context revisions')}</h3><small>{t('当前分支', 'Current branch')} · {data.total}</small></div>
      {data.total > revisions.length && <p className="clm-note">{t('仅展示最近 2000 条记录，未删除历史。', 'Showing the latest 2,000 records; history has not been deleted.')}</p>}
      {revisions.length > 5 && <div className="clm-history-nav">
        <button title={t('更早修订', 'Earlier revisions')} aria-label={t('更早修订', 'Earlier revisions')} disabled={!offset} onClick={() => setPage(Math.max(0, offset - 5))}><ArrowLeft size={14}/></button>
        <span className="clm-revision-range"><RevisionLabel value={revisions[offset].revision}/>–<RevisionLabel value={revisions[Math.min(offset + 4, revisions.length - 1)].revision}/></span>
        <button title={t('更新修订', 'Newer revisions')} aria-label={t('更新修订', 'Newer revisions')} disabled={offset + 5 >= revisions.length} onClick={() => setPage(Math.min(revisions.length - 5, offset + 5))}><ArrowRight size={14}/></button>
        <button onClick={back}>{t('最新', 'Latest')} {latest && <RevisionLabel value={latest.revision}/>}</button>
      </div>}
      <div className="clm-timeline" role="group" aria-label={t('选择修订', 'Select revision')}>{revisions.slice(offset, offset + 5).map(item =>
        <button key={item.entryId} aria-label={`${t('查看修订', 'View revision')} r${item.revision}`} aria-pressed={item.entryId === current?.entryId}
          onClick={() => { setSelected(item.entryId); setIntent(false); setBlockId(''); }}>
          <span className="clm-revision-node"><i/></span><RevisionLabel value={item.revision}/><small>{item.entryId === latest?.entryId ? t('最新', 'Latest') :
            Number.isNaN(Date.parse(item.timestamp)) ? '--' : new Date(item.timestamp).toLocaleTimeString(zh ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</small>
        </button>)}</div>
      {!current ? <p className="clm-note">{t('尚无保存的修订。', 'No saved revisions yet.')}</p> : <>
        <div className={`clm-selection${historical ? ' is-history' : ''}`}><History size={14}/><span><RevisionLabel value={current.revision}/> · {historical ? t('历史只读', 'Read-only history') : t('最近保存版本', 'Latest saved revision')}</span>
          {historical && <button onClick={back}>{t('回到当前', 'Back to latest')}<ArrowRight size={12}/></button>}</div>
        <div className="clm-views" role="group" aria-label={t('修订视图', 'Revision view')}>{(['overview', 'content', 'diff'] as const).map(item =>
          <button key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item === 'overview' ? t('概览', 'Overview') : item === 'content' ? t('工作内容', 'Contents') : t('修改对比', 'Changes')}</button>)}</div>
        {pending && !action ? <p className="clm-note" role="status">{t('读取修订中…', 'Loading revision…')}</p> : view === 'overview' ? <div className="clm-overview">
          <p className="clm-note">{current.kind === 'reset' ? t('重置记录：后续请求恢复使用会话历史。', 'Reset: subsequent requests use session history.') :
            current.kind === 'compaction' ? t('常规压缩保留的工作上下文。', 'Working context retained by regular compaction.') : t('已接受的工作上下文修订。', 'Accepted working-context revision.')}</p>
          <div className="clm-token-flow"><span>{number(outcome?.beforeTokens)}</span><ArrowRight size={15}/><strong>{number(outcome?.afterTokens)}</strong><small>{t('估算 token', 'Estimated tokens')}</small></div>
          {outcome?.beforeTokens && outcome.afterTokens !== undefined ? <div className="clm-reduction"><i style={{ width: `${Math.min(100, outcome.afterTokens / outcome.beforeTokens * 100)}%` }}/></div> : <p className="clm-note">{t('此修订未提供前后用量，不进行反推。', 'Before/after token counts are unavailable for this revision.')}</p>}
          <div className="clm-section-title"><h3>{t('修订时的工作内容', 'Contents at this revision')}</h3><small>{blocks.length}</small></div>
          {blocks.slice(0, 8).map(block => <button className="clm-block-link" key={block.id} onClick={() => { setBlockId(block.id); setView('content'); }}>
            {block.protected ? <LockKeyhole size={14}/> : <FileText size={14}/>}<span><strong>{title(block.text, block.role)}</strong><small>{roleLabel(block.role)}{block.protected ? ` · ${t('受保护', 'Protected')}` : ''}</small><span>{block.text.split('\n').filter(line => line.trim() && !line.startsWith('[[')).slice(1).join(' ').slice(0, 140)}</span></span><ArrowRight size={12}/></button>)}
          {blocks.length > 8 && <button onClick={() => setView('content')}>{t('查看全部内容', 'View all contents')}</button>}
        </div> : view === 'content' ? <div className="clm-document">
          {active ? <><label>{t('选择内容', 'Select content')}<span className="clm-select"><select value={active.id} onChange={event => setBlockId(event.target.value)}
            onPointerDown={event => fitPicker(event.currentTarget)}
            onFocus={event => fitPicker(event.currentTarget)}>
            {blocks.map(block => <option key={block.id} value={block.id}>{title(block.text, block.role)}</option>)}</select><DisclosureChevron/></span></label>
            <div className="clm-document-heading"><span>{roleLabel(active.role)}</span>{active.protected && <small><LockKeyhole size={11}/>{t('受保护', 'Protected')}</small>}</div>
            <ReadableText text={active.text}/></> : <p>{t('此记录没有保存内容。', 'No contents were saved in this record.')}</p>}
        </div> : <ClmDiff key={detail?.entryId} diff={detail?.diff ?? ''} language={snapshot.preferences.language}/>}
        {(detail?.truncated || detail?.diffTruncated) && <p className="clm-note">{t('内容较大，当前显示为截取片段；原始记录未修改。', 'Large content is shown as an excerpt; original records are unchanged.')}</p>}
      </>}
      <Disclosure label={t('原始会话独立保留', 'Original conversation is preserved')}><p>{t('这里只读取当前分支的 CLM 记录。查看修订不会回滚对话、文件或工具操作。', 'This panel reads CLM records on the current branch. Browsing revisions does not roll back conversations, files, or tools.')}</p></Disclosure>
      <div className="clm-actions"><button disabled={disabled || !data.enabled || historical} aria-expanded={intent} onClick={() => setIntent(value => !value)}><WorkingContextIcon size={15}/>{t('整理上下文', 'Organize context')}<DisclosureChevron/></button>
        {action === 'compact' && <button onClick={() => void window.desktop?.command('abort', undefined, runtimeId).catch(error => setFailure(String(error)))}>{t('停止', 'Stop')}</button>}</div>
      <details ref={formDetails} className="clm-form"><summary hidden/><div ref={formBody} inert={!intent} aria-hidden={!intent}>
        <label>{t('保留重点（可选）', 'What to retain (optional)')}<textarea maxLength={4000} value={guidance} onChange={event => setGuidance(event.target.value)}/></label>
        <p className="clm-note">{t('将调用当前模型整理工作上下文，可能产生费用。', 'Uses the current model to organize context and may incur charges.')}</p>
        <button className="clm-confirm" disabled={disabled || !data.enabled || historical} onClick={() => void perform('compact')}>{t('开始整理', 'Start organizing')}</button>
      </div></details>
    </>}
    {failure && <p className="clm-error" role="alert">{failure}</p>}
  </section>;
}
