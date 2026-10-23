import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, ArrowRightLeft, Eye, FolderOpen, RefreshCw, Search, Square, AlertCircle, MessageSquare, X } from 'lucide-react';
import type { SessionImportBridge, ImportCandidate, ImportPreview, ImportJob, ImportSelection } from './session-import';
import { importWarning } from './session-import';
import { AppMenu } from './AppMenu';
import { DisclosureChevron } from './DisclosureChevron';
import { ImportConfirmation } from './ImportConfirmation';
import './session-import.css';

const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 5;

function ImportJobRecord({ job, language, status, pending, stopping, onCancel, onOpen }: {
  job: ImportJob; language: string; status: string; pending: boolean; stopping: boolean;
  onCancel(): void; onOpen(id: string): void;
}) {
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const [disclosure, setDisclosure] = useState<{ status: ImportJob['status']; expanded: boolean }>();
  const expanded = disclosure?.status === job.status ? disclosure.expanded : job.status === 'running';
  const detailsId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded && details.current?.contains(document.activeElement)) trigger.current?.focus();
  }, [expanded]);
  const imported = job.results.filter(result => result.status === 'imported').length;
  const skipped = job.results.filter(result => result.status === 'skipped').length;
  const failed = job.results.filter(result => result.status === 'failed').length;
  return <div className="import-job">
    <header>
      <button type="button" className="import-job-trigger" ref={trigger}
        aria-expanded={expanded} aria-controls={detailsId}
        onClick={() => setDisclosure({ status: job.status, expanded: !expanded })}>
        <MessageSquare size={15}/><strong>{status}</strong>
        <span>{job.results.filter(result => result.candidateId).length} / {job.total}</span>
        <span className="import-sources-chevron"><DisclosureChevron/></span>
      </button>
      {job.status === 'running' && <button type="button" disabled={pending || stopping} onClick={onCancel}><Square size={12}/>{t('停止剩余导入', 'Stop remaining imports')}</button>}
    </header>
    <div className="import-job-summary">
      <time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-GB')}</time>
      <span>{t(`已导入 ${imported} · 跳过 ${skipped}`, `${imported} imported · ${skipped} skipped`)}</span>
      {failed > 0 && <span className="import-error">{t(`失败 ${failed}`, `${failed} failed`)}</span>}
    </div>
    <div id={detailsId} ref={details} className={`import-sources-details${expanded ? ' is-expanded' : ''}`}
      inert={!expanded} aria-hidden={!expanded}><div>
      <ul className="import-job-results" tabIndex={expanded ? 0 : -1}
        aria-label={t('导入明细', 'Import details')}>
        {job.results.map((result, index) => <li key={`${result.candidateId}:${index}`}>
          <span className="import-result-title">{result.title || t('会话', 'Session')}</span>
          <span className={result.status === 'failed' ? 'import-error' : 'muted'}>{result.status === 'imported' ? t('已导入', 'Imported') : result.status === 'skipped' ? t('已有相同副本', 'Copy already exists') : t('导入失败', 'Import failed')}</span>
          {result.error && <small>{t('请检查目标目录、源格式与磁盘空间后重试。', 'Check the destination, source format and disk space before retrying.')}</small>}
          {result.warning && <small>{t('副本已保存，索引刷新失败。', 'Copy saved; index refresh failed.')}</small>}
          {result.sessionId && <button type="button" disabled={pending} aria-label={`${t('打开', 'Open')} ${result.title ?? ''}`} data-tooltip={t('打开会话', 'Open session')} onClick={() => onOpen(result.sessionId!)}><ArrowRight size={14}/></button>}
        </li>)}
      </ul>
    </div></div>
  </div>;
}

export function SessionImportSettings({ bridge, language, onOpen }: {
  bridge: SessionImportBridge; language: string; onOpen(id: string): Promise<void>;
}) {
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const [codexRoot, setCodexRoot] = useState('');
  const [claudeRoot, setClaudeRoot] = useState('');
  const [archived, setArchived] = useState(false);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [scanned, setScanned] = useState(false);
  const [sourceErrors, setSourceErrors] = useState<{ source: string; message: string }[]>([]);
  const [previews, setPreviews] = useState<Record<string, ImportPreview>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState<string>();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [page, setPage] = useState(1);
  const candidateList = useRef<HTMLDivElement>(null);
  useEffect(() => { candidateList.current?.scrollTo({ top: 0 }); }, [page, query, source]);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const sourcesId = useId();
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const sourceAnchor = useRef<HTMLButtonElement>(null);
  const closeSourceMenu = useCallback(() => setSourceMenuOpen(false), []);
  const sourceOptions = [
    { id: 'all', label: t('全部来源', 'All sources') },
    { id: 'codex', label: 'Codex' },
    { id: 'claude-code', label: 'Claude Code' },
  ];
  const [pending, setPending] = useState(false);
  const [preparing, setPreparing] = useState<{ done: number; total: number }>();
  const [confirmation, setConfirmation] = useState<ImportSelection[]>();
  const preparationCancelled = useRef(false);
  const selectPage = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [jobsError, setJobsError] = useState('');
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const alive = useRef(true);
  const revision = useRef(0);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await bridge.importJobs();
        if (!stopped) { setJobs(next.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); setJobsError(''); }
      } catch { if (!stopped) setJobsError(t('无法读取导入记录', 'Could not read import history')); }
      finally { if (!stopped) timer = setTimeout(() => { void poll(); }, 1200); }
    };
    void poll();
    return () => { stopped = true; alive.current = false; revision.current++; clearTimeout(timer); };
  }, [bridge, language]);
  const act = async (operation: () => Promise<void>) => {
    setPending(true); setError('');
    try { await operation(); }
    catch { if (alive.current) setError(t('操作未完成。请检查目录和源格式；预览过期时请重新扫描、预览。', 'Operation failed. Check directories and source format; scan and preview again if the preview expired.')); }
    finally { if (alive.current) setPending(false); }
  };
  const scan = () => act(async () => {
    const version = ++revision.current;
    const result = await bridge.importScan({
      ...(codexRoot.trim() ? { codexRoot: codexRoot.trim() } : {}),
      ...(claudeRoot.trim() ? { claudeRoot: claudeRoot.trim() } : {}),
      includeArchived: archived,
    });
    if (!alive.current || version !== revision.current) return;
    setCandidates(result.candidates); setSourceErrors(result.errors); setScanned(true);
    setPreviews({}); setSelected(new Set()); setDestinations({}); setCurrent(undefined);
    setPage(1);
    candidateList.current?.scrollTo({ top: 0 });
  });
  const preview = (candidate: ImportCandidate) => act(async () => {
    const version = revision.current;
    const value = await bridge.importPreview(candidate.id);
    if (!alive.current || version !== revision.current) return;
    setPreviews(old => ({ ...old, [candidate.id]: value }));
    setDestinations(old => ({ ...old, [candidate.id]: old[candidate.id] ?? value.cwd }));
    setCurrent(candidate.id);
  });
  const choose = (id: string) => act(async () => {
    const path = await bridge.importChooseDirectory();
    if (alive.current && path) setDestinations(old => ({ ...old, [id]: path }));
  });
  const start = () => act(async () => {
    const version = revision.current;
    const ids = [...selected];
    if (!ids.length) return;
    preparationCancelled.current = false;
    setPreparing({ done: 0, total: ids.length });
    const selections: ImportSelection[] = [];
    try {
      for (const id of ids) {
        if (!alive.current || version !== revision.current || preparationCancelled.current) return;
        const value = previews[id] ?? await bridge.importPreview(id);
        if (!alive.current || version !== revision.current || preparationCancelled.current) return;
        const cwd = destinations[id] ?? value.cwd;
        setPreviews(old => ({ ...old, [id]: value }));
        setDestinations(old => ({ ...old, [id]: old[id] ?? value.cwd }));
        if (!cwd.trim()) {
          setCurrent(id);
          setError(t(`请为“${value.title}”选择目标项目目录后重试。`, `Choose a destination project directory for "${value.title}" and try again.`));
          return;
        }
        selections.push({ candidateId: id, fingerprint: value.fingerprint, cwd });
        setPreparing({ done: selections.length, total: ids.length });
      }
    } finally {
      if (alive.current) setPreparing(undefined);
    }
    if (!alive.current || version !== revision.current || preparationCancelled.current) return;
    setConfirmation(selections);
  });
  const cancel = (id: string) => act(async () => {
    await bridge.importCancel(id);
    if (alive.current) setCancelling(old => new Set([...old, id]));
  });
  const activePreview = current ? previews[current] : undefined;
  const finishedJobs = jobs.filter(job => job.status !== 'running');
  const historyPages = Math.max(1, Math.ceil(finishedJobs.length / HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, historyPages);
  const historyOffset = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const visibleJobs = [...jobs.filter(job => job.status === 'running'),
    ...finishedJobs.slice(historyOffset, historyOffset + HISTORY_PAGE_SIZE)];
  const filtered = candidates.filter(candidate => (source === 'all' || source === candidate.source)
    && `${candidate.title} ${previews[candidate.id]?.title ?? ''} ${candidate.cwd} ${candidate.sessionId}`.toLowerCase().includes(query.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(offset, offset + PAGE_SIZE);
  const hiddenSelected = selected.size - visible.filter(candidate => selected.has(candidate.id)).length;
  const pageSelected = visible.filter(candidate => selected.has(candidate.id)).length;
  const pageFullySelected = visible.length > 0 && pageSelected === visible.length;
  const pageAdditions = visible.length - pageSelected;
  const allAdditions = filtered.filter(candidate => !selected.has(candidate.id)).length;
  useEffect(() => { if (selectPage.current) selectPage.current.indeterminate = pageSelected > 0 && !pageFullySelected; }, [pageSelected, pageFullySelected]);
  const addSelection = (items: ImportCandidate[]) => setSelected(old => {
    const next = new Set(old);
    for (const item of items) next.add(item.id);
    return next.size <= 100 ? next : old;
  });
  const toggleSelection = (id: string) => setSelected(old => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id);
    else if (next.size < 100) next.add(id);
    return next;
  });
  const sourceName = (value: string) => value === 'codex' ? 'Codex' : 'Claude Code';
  const jobStatus = (job: ImportJob) => ({
    running: cancelling.has(job.id) ? t('正在停止', 'Stopping') : t('导入中', 'Importing'),
    completed: t('已结束', 'Finished'), cancelled: t('已取消', 'Cancelled'), interrupted: t('已中断', 'Interrupted'),
  }[job.status]);
  return <section className="session-import-settings" aria-label={t('会话迁移', 'Session migration')}>
    {confirmation && <ImportConfirmation selections={confirmation} language={language}
      onCancel={() => setConfirmation(undefined)} onConfirm={async addProjects => {
        setPending(true);
        try {
          const job = await bridge.importStart(confirmation, { addProjects });
          if (!alive.current) return;
          setJobs(old => [job, ...old.filter(item => item.id !== job.id)]);
          setHistoryPage(1); setSelected(new Set()); setConfirmation(undefined);
        } finally { if (alive.current) setPending(false); }
      }}/>}
    <h3>{t('会话迁移', 'Session migration')}</h3>
    <p className="muted">{t('从本机 Codex 或 Claude Code 导入历史。不会运行来源工具，也不会迁入凭据、审批和模型配置。', 'Import local Codex or Claude Code history. Source tools are not replayed; credentials, approvals and model settings are not migrated.')}</p>
    <div className="import-sources">
      <button type="button" className="import-sources-trigger" aria-expanded={sourcesExpanded}
        aria-controls={sourcesId} onClick={() => setSourcesExpanded(value => !value)}>
        <span>{t('来源目录', 'Source directories')}</span><span className="import-sources-chevron"><DisclosureChevron/></span>
      </button>
      <div id={sourcesId} className={`import-sources-details${sourcesExpanded ? ' is-expanded' : ''}`}
        inert={!sourcesExpanded} aria-hidden={!sourcesExpanded}><div>
      <label>Codex<input value={codexRoot} placeholder={t('默认使用 CODEX_HOME 或 ~/.codex', 'CODEX_HOME or ~/.codex by default')} disabled={pending} onChange={e => setCodexRoot(e.target.value)}/></label>
      <label>Claude Code<input value={claudeRoot} placeholder={t('默认使用 Claude projects 目录', 'Claude projects directory by default')} disabled={pending} onChange={e => setClaudeRoot(e.target.value)}/></label>
      <label className="import-checkbox"><input type="checkbox" checked={archived} disabled={pending} onChange={e => setArchived(e.target.checked)}/>{t('包含 Codex 归档会话', 'Include archived Codex sessions')}</label>
      </div></div>
    </div>
    <div className="import-toolbar import-filter">
      <button type="button" disabled={pending} onClick={() => void scan()}><RefreshCw size={15}/>{pending ? t('处理中…', 'Working…') : scanned ? t('重新扫描', 'Scan again') : t('扫描本机会话', 'Scan local sessions')}</button>
      {scanned && <>
      <label className="import-search"><Search size={15}/><input aria-label={t('搜索来源会话', 'Search source sessions')} placeholder={t('搜索会话或项目', 'Search sessions or projects')} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}/></label>
      <button type="button" ref={sourceAnchor} className="import-source-select" aria-label={t('来源', 'Source')}
        aria-haspopup="menu" aria-expanded={sourceMenuOpen} onClick={() => setSourceMenuOpen(value => !value)}>
        <span>{sourceOptions.find(option => option.id === source)?.label}</span><DisclosureChevron/>
      </button>
      <AppMenu anchor={sourceAnchor} open={sourceMenuOpen} label={t('来源', 'Source')} selected={source}
        items={sourceOptions} onSelect={value => { setSource(value); setPage(1); }} onClose={closeSourceMenu}/>
      </>}
    </div>
    {error && <p className="import-error" role="alert"><AlertCircle size={15}/>{error}</p>}
    {sourceErrors.map((issue, index) => <p className="import-error" key={`${issue.source}:${index}`} role="status">{sourceName(issue.source)}: {t('部分来源无法读取，请检查目录。其他来源仍可导入。', 'Some sources could not be read. Check directories; other sources remain available.')}</p>)}
    {scanned && <div className="import-submit">
      <span className="muted import-found">{filtered.length === candidates.length
        ? t(`发现 ${candidates.length} 个会话`, `${candidates.length} sessions found`)
        : t(`匹配 ${filtered.length} / ${candidates.length} 个会话`, `${filtered.length} / ${candidates.length} sessions matched`)}</span>
      <span className="import-selection" role="status">
        <span>{t(`已选 ${selected.size} / 100`, `${selected.size} / 100 selected`)}</span>
        {hiddenSelected > 0 && <small className="muted">{t(`含其他页或筛选外 ${hiddenSelected} 个`, `${hiddenSelected} outside this page or filter`)}</small>}
      </span>
      {selected.size > 0 && <button type="button" className="import-clear" disabled={pending}
        aria-label={t('清空选择', 'Clear selection')} data-tooltip={t('清空选择', 'Clear selection')}
        onClick={() => setSelected(new Set())}><X size={14}/></button>}
      {preparing && <button type="button" className="import-clear" aria-label={t('取消准备', 'Cancel preparation')}
        data-tooltip={t('取消准备', 'Cancel preparation')} onClick={() => { preparationCancelled.current = true; }}><Square size={12}/></button>}
      <button type="button" disabled={pending || selected.size === 0} onClick={() => void start()}><ArrowRightLeft size={15}/>{preparing
        ? t(`准备中 ${preparing.done} / ${preparing.total}`, `Preparing ${preparing.done} / ${preparing.total}`)
        : t('导入所选会话', 'Import selected sessions')}</button>
    </div>}
    {filtered.length > 0 && <div className="import-bulk">
      <label className="import-checkbox"><input type="checkbox" ref={selectPage} checked={pageFullySelected}
        disabled={pending || !pageFullySelected && selected.size + pageAdditions > 100}
        onChange={event => {
          if (event.target.checked) addSelection(visible);
          else setSelected(old => { const next = new Set(old); for (const item of visible) next.delete(item.id); return next; });
        }}/>{t('全选本页', 'Select page')}</label>
      <button type="button" disabled={pending || allAdditions === 0 || selected.size + allAdditions > 100}
        data-tooltip={selected.size + allAdditions > 100 ? t('每批最多导入 100 个会话', 'Up to 100 sessions per batch') : undefined}
        onClick={() => addSelection(filtered)}>{t(`选择全部匹配（${filtered.length}）`, `Select all matches (${filtered.length})`)}</button>
    </div>}
    {scanned && !filtered.length && <p className="import-empty">{t('没有匹配的会话', 'No matching sessions')}</p>}
    {filtered.length > 0 && <div className="import-candidates" ref={candidateList} aria-label={t('来源会话', 'Source sessions')}>
      {visible.map(candidate => {
        const reviewed = previews[candidate.id];
        return <div className={`import-candidate${selected.has(candidate.id) ? ' is-selected' : ''}`} key={candidate.id}>
          <input type="checkbox" aria-label={`${t('选择', 'Select')} ${candidate.title}`} disabled={pending || !selected.has(candidate.id) && selected.size >= 100}
            checked={selected.has(candidate.id)} onChange={e => setSelected(old => { const next = new Set(old); e.target.checked ? next.add(candidate.id) : next.delete(candidate.id); return next; })}/>
          <button type="button" className="import-candidate-title" disabled={pending || !selected.has(candidate.id) && selected.size >= 100}
            aria-pressed={selected.has(candidate.id)} onClick={() => toggleSelection(candidate.id)}>
            <strong>{reviewed?.title || candidate.title}</strong>
            <span>{sourceName(candidate.source)} · {candidate.version}{candidate.archived ? t(' · 已归档', ' · Archived') : ''}</span>
            <small>{candidate.cwd || t('未记录项目目录', 'No project directory recorded')}</small>
          </button>
          <button type="button" className="import-candidate-preview" disabled={pending} aria-label={`${t('预览', 'Preview')} ${candidate.title}`}
            onClick={() => void preview(candidate)}><Eye size={15}/><span>{t('预览', 'Preview')}</span></button>
        </div>;
      })}
    </div>}
    {filtered.length > 0 && <nav className="import-pagination" aria-label={t('会话分页', 'Session pages')}>
      <span className="muted" role="status">{t(`显示 ${offset + 1}–${offset + visible.length} / ${filtered.length}`, `${offset + 1}–${offset + visible.length} of ${filtered.length}`)}</span>
      <div>
        <button type="button" disabled={currentPage === 1} aria-label={t('上一页', 'Previous page')}
          data-tooltip={t('上一页', 'Previous page')} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15}/></button>
        <span className="import-page-number">{currentPage} / {pageCount}</span>
        <button type="button" disabled={currentPage === pageCount} aria-label={t('下一页', 'Next page')}
          data-tooltip={t('下一页', 'Next page')} onClick={() => setPage(currentPage + 1)}><ChevronRight size={15}/></button>
      </div>
    </nav>}
    {activePreview && <section className="import-preview" aria-label={t('兼容性预览', 'Compatibility preview')}>
      <h4>{activePreview.title}</h4>
      <div className="import-preview-meta"><span>{sourceName(activePreview.source)}</span><span>{t(`${activePreview.messageCount} 条消息`, `${activePreview.messageCount} messages`)}</span><span>{t(`${activePreview.toolCount} 次历史工具调用`, `${activePreview.toolCount} historical tool calls`)}</span></div>
      {activePreview.warnings.length > 0 && <ul className="import-warnings">{activePreview.warnings.map(warning => <li key={warning.code}>{importWarning(warning.code, language)} ×{warning.count}</li>)}</ul>}
      <pre tabIndex={0}>{activePreview.excerpt || t('无可预览正文', 'No prose preview available')}</pre>
      <label>{t('目标项目目录', 'Destination project directory')}<div className="import-destination"><input aria-label={t('目标项目目录', 'Destination project directory')} value={destinations[activePreview.id] ?? ''} disabled={pending} onChange={e => setDestinations(old => ({ ...old, [activePreview.id]: e.target.value }))}/><button type="button" disabled={pending} aria-label={t('选择目标目录', 'Choose destination directory')} data-tooltip={t('选择目标目录', 'Choose destination directory')} onClick={() => void choose(activePreview.id)}><FolderOpen size={16}/></button></div></label>
    </section>}
    <section className="import-jobs" aria-label={t('导入记录', 'Import history')}>
      <h4>{t('导入记录', 'Import history')}</h4>
      {jobsError && <p role="alert" className="import-error">{jobsError}</p>}
      {!jobs.length && !jobsError && <p className="muted">{t('暂无导入记录', 'No import history')}</p>}
      {visibleJobs.map(job => <ImportJobRecord key={job.id} job={job} language={language}
        status={jobStatus(job)} pending={pending} stopping={cancelling.has(job.id)}
        onCancel={() => void cancel(job.id)} onOpen={id => void act(() => onOpen(id))}/>)}
      {historyPages > 1 && <nav className="import-pagination" aria-label={t('导入记录分页', 'Import history pages')}>
        <span className="muted">{t(`已结束批次 ${historyOffset + 1}–${Math.min(historyOffset + HISTORY_PAGE_SIZE, finishedJobs.length)} / ${finishedJobs.length}`,
          `Finished batches ${historyOffset + 1}–${Math.min(historyOffset + HISTORY_PAGE_SIZE, finishedJobs.length)} of ${finishedJobs.length}`)}</span>
        <div>
          <button type="button" disabled={currentHistoryPage === 1} aria-label={t('上一页记录', 'Previous history page')}
            data-tooltip={t('上一页记录', 'Previous history page')} onClick={() => setHistoryPage(currentHistoryPage - 1)}><ChevronLeft size={15}/></button>
          <span className="import-page-number">{currentHistoryPage} / {historyPages}</span>
          <button type="button" disabled={currentHistoryPage === historyPages} aria-label={t('下一页记录', 'Next history page')}
            data-tooltip={t('下一页记录', 'Next history page')} onClick={() => setHistoryPage(currentHistoryPage + 1)}><ChevronRight size={15}/></button>
        </div>
      </nav>}
    </section>
  </section>;
}
