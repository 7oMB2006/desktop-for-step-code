import { useEffect, useId, useLayoutEffect, useMemo, useState } from 'react';
import { FileCode2, GitBranch, RefreshCw, X } from 'lucide-react';
import type { Message, RepositoryDiff, RepositoryFile, RepositoryFileDiff } from './contracts';
import { createTurnChangesReader, type TurnFile } from './turn-changes';
import { lastCompletedResponse, redactDiffText, sensitiveDiffPath } from './review-source';
import { FilePreview } from './TurnChanges';
import { DiffCount } from './DiffCount';
import { DisclosureChevron } from './DisclosureChevron';
import { RightPanelExpandButton } from './RightPanelExpandButton';
import { turnTime } from './ConversationNavigation';
import './review-panel.css';

type Source = 'turn' | 'branch';
type ReviewFile = { file: TurnFile; repository?: RepositoryFile };
function DiffFile({ file, repository, source, runtimeId, base, revision, language, onError }: ReviewFile & {
  source: Source; runtimeId?: string; base?: string; revision: string; language: 'zh' | 'en'; onError: (error: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [patch, setPatch] = useState<RepositoryFileDiff>();
  const [failed, setFailed] = useState(false);
  const id = useId();
  if (open && !present) setPresent(true);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
    return () => clearTimeout(timer);
  }, [open, present]);
  useEffect(() => {
    if (!open || source !== 'branch' || !runtimeId || !base || !window.desktop) return;
    let live = true;
    setFailed(false);
    void window.desktop.repositoryFileDiff(runtimeId, base, file.path).then(value => { if (live) setPatch(value); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, source, runtimeId, base, file.path, revision]);
  const zh = language === 'zh';
  const normalized = file.path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const sensitive = sensitiveDiffPath(file.path) || file.edits.some(edit =>
    edit.rows.some(row => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(row.text)));
  const preview = sensitive ? undefined : source === 'turn' ? {
    ...file, edits: file.edits.map(edit => ({ ...edit, rows: edit.rows.map(row => ({ ...row, text: redactDiffText(row.text) })) })),
  } : patch?.rows.length ? {
    path: file.path, added: patch.added, removed: patch.removed,
    edits: [{ id: file.path, added: patch.added, removed: patch.removed, rows: patch.rows }],
  } : undefined;
  const reason = sensitive || patch?.reason === 'sensitive' ? (zh ? '敏感文件，内容不展示' : 'Sensitive file. Content is hidden.')
    : failed ? (zh ? '读取失败，请刷新后重试' : 'Could not read this change. Refresh to retry.')
    : patch?.reason === 'binary' ? (zh ? '二进制文件' : 'Binary file')
    : patch?.reason === 'too-large' ? (zh ? '文件超过预览上限' : 'File exceeds preview limits')
    : patch?.reason === 'unsupported' ? (zh ? '无法预览此文件类型或路径' : 'File type or path cannot be previewed')
    : patch?.reason ? (zh ? '无可预览的文本变化' : 'No text changes to preview')
    : (zh ? '读取中' : 'Loading');
  return <div className={`review-file${open ? ' is-open' : ''}`}>
    <button type="button" className="review-file-row" aria-expanded={open} aria-controls={id}
      aria-label={`${zh ? '预览变更' : 'Preview changes'} ${file.path}`} onClick={() => setOpen(value => !value)}>
      {repository ? <span className={`review-status status-${repository.status === '?' ? 'new' : repository.status}`}
        title={{ M: zh ? '修改' : 'Modified', A: zh ? '新增' : 'Added', D: zh ? '删除' : 'Deleted', '?': zh ? '未跟踪' : 'Untracked' }[repository.status]}>
        {repository.status}</span> : <FileCode2 size={15}/>}
      <span className="review-file-name"><b>{normalized.slice(slash + 1)}</b><small title={file.path}>
        {slash >= 0 ? normalized.slice(0, slash) : './'}
        {source === 'turn' && file.edits.length > 1 ? ` · ${file.edits.length} ${zh ? '次编辑' : 'edits'}` : ''}
      </small></span>
      <span className="review-file-counts">{repository?.binary ? <small>{zh ? '二进制' : 'Binary'}</small>
        : repository?.unavailable ? <small>--</small>
        : <><DiffCount value={file.added} kind="added"/><DiffCount value={file.removed} kind="removed"/></>}</span>
    </button>
    <div id={id} className={`review-file-body${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      <div className="review-file-inner">{present && (preview
        ? <FilePreview file={preview} language={language} onError={onError}/>
        : <p className="review-preview-state" role={failed ? 'alert' : undefined}>{reason}</p>)}</div>
    </div>
  </div>;
}

function ReviewContent({ runtimeId, messages, busy, active, language, expanded, onToggleExpanded, onClose, onError }: {
  runtimeId?: string; messages: Message[]; busy: boolean; active: boolean; language: 'zh' | 'en';
  onClose: () => void; onError: (error: string) => void;
  expanded: boolean; onToggleExpanded: () => void;
}) {
  const [source, setSource] = useState<Source>('turn');
  const [base, setBase] = useState('');
  const [repository, setRepository] = useState<RepositoryDiff>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const read = useMemo(createTurnChangesReader, []);
  const last = useMemo(() => lastCompletedResponse(messages, busy), [messages, busy]);
  const changes = read(last?.items ?? []);
  const toolResults = messages.filter(message => message.role === 'toolResult').length;
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  useEffect(() => {
    if (!active || !runtimeId || !window.desktop) return;
    let live = true;
    setLoading(true); setFailed(false);
    void window.desktop.repositoryDiff(runtimeId, base || undefined).then(value => {
      if (!live) return;
      setRepository(value);
    }).catch(() => { if (live) setFailed(true); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [active, runtimeId, base, revision, busy, toolResults]);
  const files: ReviewFile[] = source === 'turn' ? changes.files.map(file => ({ file })) : (repository?.files ?? []).map(repo => ({
    repository: repo, file: { path: repo.path, added: repo.added, removed: repo.removed, edits: [] },
  }));
  const added = source === 'turn' ? changes.added : repository?.added ?? 0;
  const removed = source === 'turn' ? changes.removed : repository?.removed ?? 0;
  const partial = source === 'turn' ? changes.incomplete : repository?.truncated || repository?.files.some(file => file.unavailable);
  const time = last?.timestamp ? turnTime(last.timestamp, language) : '';
  const choose = async (kind: 'source' | 'base', button: HTMLButtonElement) => {
    if (!window.desktop) return;
    const box = button.getBoundingClientRect();
    try {
      const value = await window.desktop.reviewMenu(runtimeId, kind, kind === 'source' ? source : base || repository?.base || '',
        { x: box.left, y: box.bottom });
      if (value === undefined) return;
      if (kind === 'source' && (value === 'turn' || value === 'branch')) setSource(value);
      else if (kind === 'base') { setBase(value); setRevision(value => value + 1); }
    } catch { onError(t('无法打开变更菜单', 'Could not open the changes menu')); }
  };
  const empty = source === 'turn' ? t('上一轮没有已记录的文件变更', 'No recorded file changes in the last turn')
    : loading ? t('读取中', 'Loading')
    : failed ? t('仓库读取失败，请刷新重试', 'Could not read the repository. Refresh to retry.')
    : !runtimeId ? t('请先打开一个会话', 'Open a session first.')
    : repository?.state === 'not-git' ? t('当前目录不是 Git 仓库，无法查看分支差异。', 'This directory is not a Git repository. Branch differences are unavailable.')
    : repository?.state === 'unborn' ? t('仓库尚无提交，暂时没有可对比的分支基线。', 'This repository has no commits yet. No branch baseline is available.')
    : repository?.state === 'unavailable' ? t('Git 不可用，无法读取分支差异。', 'Git is unavailable. Branch differences cannot be read.')
    : t('与基线一致', 'No changes from the base');
  return <>
    <header className="review-header right-panel-header"><h2>{t('变更', 'Changes')}</h2>
      <RightPanelExpandButton expanded={expanded} language={language} onToggle={onToggleExpanded}/>
      <button type="button" className={`icon-button${loading ? ' is-refreshing' : ''}`} disabled={loading || !runtimeId}
        aria-label={t('刷新变更', 'Refresh changes')} data-tooltip={t('刷新变更', 'Refresh changes')}
        onClick={() => setRevision(value => value + 1)}><RefreshCw size={15}/></button>
      <button type="button" className="icon-button" aria-label={t('关闭变更', 'Close changes')} onClick={onClose}><X size={16}/></button>
    </header>
    <div className="review-toolbar">
      <button type="button" className="review-select" aria-label={t('变更来源', 'Change source')} aria-haspopup="menu"
        onClick={event => void choose('source', event.currentTarget)}>
      {source === 'turn' ? t('上一轮', 'Last turn') : t('分支', 'Branch')}
      <DisclosureChevron/>
      </button>
      {(source === 'turn' || repository?.state === 'ready') &&
        <span className="review-totals"><DiffCount value={added} kind="added"/><DiffCount value={removed} kind="removed"/></span>}
    </div>
    {source === 'branch' && repository?.state === 'ready' ? <div className="review-base">
      <GitBranch size={14}/><span className="review-current-branch" title={repository?.branch}>{repository?.branch}</span><span>←</span>
      <button type="button" className="review-select" aria-label={t('对比基线', 'Comparison base')} aria-haspopup="menu"
        onClick={event => void choose('base', event.currentTarget)}>
      <span>{base || repository.base}</span>
      <DisclosureChevron/>
      </button>
    </div> : null}
    <div className="review-scope">
      <span>{source === 'turn' ? `${t('工具记录', 'Tool records')}${last ? ` · ${t(`第 ${last.number} 轮`, `Turn ${last.number}`)}` : ''}`
        : repository?.state === 'ready' ? t('仓库净变化 · 含工作区', 'Repository net changes · includes worktree')
          : t('分支比较', 'Branch comparison')}</span>
      <span>{partial ? t('部分记录', 'Partial') : source === 'turn' ? time
        : repository?.state === 'ready' ? `${files.length} ${t('个文件', 'files')}` : ''}</span>
    </div>
    {failed && <div className="review-error" role="alert">{t('仓库读取失败，可重试刷新', 'Repository refresh failed. Retry refreshing.')}</div>}
    <div className="review-scroll" aria-busy={source === 'branch' && loading}>
      {files.map(item => <DiffFile key={`${source}:${source === 'branch' ? base || repository?.base : ''}:${item.file.path}`} {...item} source={source}
        base={base || repository?.base} runtimeId={runtimeId} revision={`${revision}:${toolResults}:${busy}`}
        language={language} onError={onError}/>)}
      {!files.length && <div className="review-empty"><FileCode2 size={22}/>
        <p>{empty}</p>
      </div>}
    </div>
    <footer className="review-footer"><span>{source === 'turn' ? t('按次累计', 'Per-edit totals') : t('只读比较', 'Read-only comparison')}</span>
      <span>{source === 'turn' ? `${files.length} ${t('个文件', 'files')}` : repository?.revision?.slice(0, 8)}</span></footer>
  </>;
}

export function ReviewPanel({ open, replaced, overlay, ...props }: {
  open: boolean; replaced: boolean; overlay: boolean; runtimeId?: string; messages: Message[]; busy: boolean;
  language: 'zh' | 'en'; onClose: () => void; onError: (error: string) => void;
  expanded: boolean; onToggleExpanded: () => void;
}) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  useLayoutEffect(() => {
    if (!open && matchMedia('(prefers-reduced-motion: reduce)').matches) setPresent(false);
  }, [open]);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), 260);
    return () => clearTimeout(timer);
  }, [open, present]);
  if (!present) return null;
  return <div className={`review-track${open ? ' is-open' : ''}${overlay ? ' is-overlay' : ''}${replaced ? ' is-replaced' : ''}`}>
    <aside className={`review-panel right-inspector-surface${props.expanded ? ' is-expanded' : ''}${open ? '' : ' is-closing'}`} id="review-panel"
      aria-label={props.language === 'zh' ? '变更' : 'Changes'} aria-hidden={!open} inert={!open}>
      <ReviewContent key={props.runtimeId ?? 'empty'} {...props} active={open}/>
    </aside>
  </div>;
}
