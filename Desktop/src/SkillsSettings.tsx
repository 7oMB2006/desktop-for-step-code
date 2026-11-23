import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, CodeXml, Copy, FileQuestion, FileText, FolderOpen, Pencil, Plug, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import { CapabilityDisclosure } from './CapabilitySettings';
import { DisclosureChevron } from './DisclosureChevron';
import { revealFocusedTextField } from './form-focus';
import { PageLoadingState } from './PageLoadingState';
import { ScheduledTaskSelect } from './ScheduledTasks';
import { capabilityErrorText, capabilityWarningText } from './capability-errors';
import type { CapabilityTarget } from './capability-command';
import type { CapabilityCatalog, CapabilityMutation, CapabilityResult, CapabilitySkillDetail, CapabilitySkillText } from './capabilities';
import type { ComposerCommand } from './composer-commands';
import type { DesktopBridge } from './contracts';
import './skills-settings.css';

export type SkillsSettingsBridge = Pick<DesktopBridge, 'capabilityCatalog' | 'capabilitySkillDetail' | 'capabilitySkillFile'
  | 'capabilityMutate' | 'capabilityImportSkill' | 'copyText'>;

type Draft =
  | { kind: 'skill'; name: string; description: string; body: string; target?: { id: string; revision: string } }
  | { kind: 'file'; id: string; path: string; body: string; target?: { id: string; revision: string } }
  | { kind: 'remove-skill'; id: string; name: string; revision?: string }
  | { kind: 'remove-file'; id: string; target: { id: string; revision: string }; path: string };
type Read<T> = { key: string; version: string; value: T; error?: never } | { key: string; version: string; value?: never; error: unknown };
function useSkillRead<T>(key: string, version: string, read: (key: string) => Promise<T>) {
  const [result, setResult] = useState<Read<T>>();
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!key) return;
    let current = true;
    void readRef.current(key).then(value => {
      if (current) setResult({ key, version, value });
    }, error => {
      if (current) setResult({ key, version, error });
    });
    return () => { current = false; };
  }, [key, version]);
  const matching = result?.key === key ? result : undefined;
  return {
    value: matching?.value,
    error: matching?.version === version ? matching.error : undefined,
    loading: Boolean(key) && matching?.version !== version,
  };
}

const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const textLimit = 128 * 1024;
const narrow = () => window.matchMedia('(max-width: 860px)').matches;

function SkillDialog({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="skills-preview-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onCancel(); }}>
    <header><h3 id={titleId}>{title}</h3></header>
    {children}
  </dialog>;
}

export function SkillsSettings({ bridge, language, busy, runtimeId, revision, target, commands = [], onRestart, preview = false }: {
  bridge: SkillsSettingsBridge; language: string; busy: boolean; runtimeId?: string;
  revision: number; target?: CapabilityTarget; commands?: ComposerCommand[]; onRestart(): Promise<void>; preview?: boolean;
}) {
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const [query, setQuery] = useState(target?.query ?? '');
  const [selected, setSelected] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [view, setView] = useState<'read' | 'source'>('read');
  const [tab, setTab] = useState<'document' | 'files'>('document');
  const [filePath, setFilePath] = useState('');
  const [draft, setDraft] = useState<Draft>();
  const [draftError, setDraftError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [draftConflict, setDraftConflict] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [pendingRestart, setPendingRestart] = useState(false);
  const [pending, setPending] = useState<'mutate' | 'import' | 'restart'>();
  const [reload, setReload] = useState(0);
  const busyRef = useRef(false);
  const lifecycle = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const activeRow = useRef<HTMLButtonElement>(null);
  const article = useRef<HTMLElement>(null);
  const fileTab = useRef<HTMLButtonElement>(null);
  const focus = useRef<'list' | 'detail'>(undefined);
  const version = `${revision}:${reload}`;
  const catalog = useSkillRead<CapabilityCatalog>('catalog', version, () => bridge.capabilityCatalog());
  const filter = query.trim().toLowerCase();
  const matches = (catalog.value?.skills ?? []).filter(item =>
    `${item.name} ${item.description} ${item.pluginName ?? ''}`.toLowerCase().includes(filter));
  const skill = matches.find(item => item.id === selected) ?? ((!selected || !catalog.loading) ? matches[0] : undefined);
  const detail = useSkillRead<CapabilitySkillDetail>(skill?.id ?? '', version, id => bridge.capabilitySkillDetail(id));
  const files = detail.value?.files ?? [];
  const file = files.find(item => item.path === filePath);
  const fileRead = useSkillRead<CapabilitySkillText>(tab === 'files' && skill && file ? `${skill.id}:${file.id}` : '',
    version, () => bridge.capabilitySkillFile(skill!.id, file!.id));
  const document = detail.value?.document;
  const invocation = t('调用方式', 'Invocation');
  const mode = skill?.enabled === false ? 'off' : skill?.manualOnly ? 'manual' : 'auto';
  const local = skill?.source === 'user';
  const locked = busy || pending !== undefined || catalog.loading || !catalog.value || catalog.error !== undefined;
  const detailReady = !detail.loading && detail.value !== undefined;
  const canEdit = local && detail.value?.editable && document?.body !== undefined;
  const canManageFiles = local && detail.value?.manageFiles;
  const command = skill ? `/skill:${skill.name}` : '';
  const matchingCommands = commands.filter(item => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(filter));

  useEffect(() => {
    lifecycle.current = true;
    return () => { lifecycle.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (article.current) article.current.scrollTop = 0;
    if (focus.current === 'list') (activeRow.current ?? search.current)?.focus({ preventScroll: true });
    if (focus.current === 'detail' && narrow()) {
      if (!heading.current) return;
      heading.current.focus({ preventScroll: true });
    }
    focus.current = undefined;
  }, [showDetail, skill?.id, view, tab]);

  function open(id: string, reset = skill?.id !== id) {
    if (reset) { setView('read'); setTab('document'); setFilePath(''); }
    if (!showDetail || skill?.id !== id) focus.current = 'detail';
    setSelected(id);
    setShowDetail(true);
  }
  function back() {
    focus.current = 'list';
    setShowDetail(false);
  }
  function refresh() {
    setOperationError('');
    setReload(value => value + 1);
  }
  function openDraft(next: Draft) {
    setDraftError('');
    setDraftNotice('');
    setDraftConflict(false);
    setDraft(next);
  }
  function errorText(error: unknown, inDialog = false) {
    return /\bcapability:stale(?![a-z-])/u.test(String(error))
      ? inDialog
        ? t('文件已被其他操作修改。草稿已保留，请刷新后核对。', 'This file changed elsewhere. Your draft is retained; refresh and review.')
        : t('Skill 已变化，请刷新后核对。', 'The skill changed. Refresh and review.')
      : capabilityErrorText(error, language === 'zh');
  }
  async function perform(kind: 'mutate' | 'import', work: () => Promise<CapabilityResult | null>, success: string,
    onSaved: (result: CapabilityResult) => void = () => {}, inDialog = false) {
    if (locked || busyRef.current) return;
    busyRef.current = true;
    setPending(kind);
    setOperationError('');
    if (inDialog) setDraftError('');
    try {
      const result = await work();
      if (!result || !lifecycle.current) return;
      setPendingRestart(true);
      setWarnings(result.warnings);
      setNotice(success);
      setDraft(undefined);
      setReload(value => value + 1);
      onSaved(result);
    } catch (error) {
      if (!lifecycle.current) return;
      const message = errorText(error, inDialog);
      if (inDialog) {
        setDraftError(message);
        setDraftConflict(/\bcapability:stale(?:-configuration)?(?![a-z-])/u.test(String(error)));
      }
      else setOperationError(message);
    } finally {
      busyRef.current = false;
      if (lifecycle.current) setPending(undefined);
    }
  }
  async function copyDraft() {
    if (!draft || (draft.kind !== 'skill' && draft.kind !== 'file')) return;
    const text = draft.kind === 'skill' ? `${draft.description}\n\n${draft.body}` : draft.body;
    try {
      await bridge.copyText(text);
      if (lifecycle.current) setDraftNotice(t('草稿已复制。', 'Draft copied.'));
    } catch {
      if (lifecycle.current) setDraftError(t('未能复制，草稿仍然保留。', 'Could not copy. Your draft is retained.'));
    }
  }
  function revealCreated(result: CapabilityResult) {
    setQuery('');
    if (result.skillId) open(result.skillId, true);
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || locked || busyRef.current) return;
    let mutation: CapabilityMutation;
    let success: string;
    let saved: ((result: CapabilityResult) => void) | undefined;
    if (draft.kind === 'skill') {
      const name = draft.name.trim(), description = draft.description.trim();
      if (!draft.target && (name.length > 64 || !validName.test(name))) {
        setDraftError(t('名称须为 1–64 个小写字母、数字或连字符，不能以连字符开头或结尾。', 'Use 1–64 lowercase letters, digits, or single interior hyphens.'));
        return;
      }
      if (!description || (!draft.target && !draft.body.trim())) {
        setDraftError(t('请填写必填字段。', 'Complete all required fields.'));
        return;
      }
      if (new TextEncoder().encode(draft.body).length > textLimit) {
        setDraftError(t('正文不能超过 128 KiB。', 'The body must not exceed 128 KiB.'));
        return;
      }
      mutation = draft.target ? { action: 'skill-save', ...draft.target, description, instructions: draft.body }
        : { action: 'skill-create', name, description, instructions: draft.body };
      success = t('Skill 已保存。', 'Skill saved.');
      saved = draft.target ? () => {
        if (!`${name} ${description}`.toLowerCase().includes(filter)) setQuery('');
      } : revealCreated;
    } else if (draft.kind === 'file') {
      const path = draft.path.trim();
      if (new TextEncoder().encode(draft.body).length > textLimit) {
        setDraftError(t('文件不能超过 128 KiB。', 'The file must not exceed 128 KiB.'));
        return;
      }
      mutation = { action: 'skill-file-save', id: draft.id, fileId: draft.target?.id, revision: draft.target?.revision, path, text: draft.body };
      success = t('文件已保存。', 'File saved.');
      saved = () => setFilePath(path);
    } else if (draft.kind === 'remove-file') {
      mutation = { action: 'skill-file-remove', id: draft.id, fileId: draft.target.id, revision: draft.target.revision };
      success = t('文件已删除。', 'File deleted.');
      saved = () => {
        setFilePath('');
        requestAnimationFrame(() => fileTab.current?.focus());
      };
    } else {
      mutation = { action: 'skill-remove', id: draft.id, revision: draft.revision };
      success = t('Skill 已移除。', 'Skill removed.');
      saved = () => {
        setSelected(''); setShowDetail(false); setFilePath(''); setTab('document'); setView('read');
        requestAnimationFrame(() => search.current?.focus());
      };
    }
    void perform('mutate', () => bridge.capabilityMutate(mutation), success, saved, true);
  }
  async function restart() {
    if (!runtimeId || busy || pending || busyRef.current || catalog.loading) return;
    busyRef.current = true;
    setPending('restart');
    setOperationError('');
    try {
      await onRestart();
      if (!lifecycle.current) return;
      setPendingRestart(false);
      setNotice(t('已重启当前会话。', 'Current session restarted.'));
    } catch (error) {
      if (lifecycle.current) setOperationError(capabilityErrorText(error, language === 'zh'));
    } finally {
      busyRef.current = false;
      if (lifecycle.current) setPending(undefined);
    }
  }
  function renderBody() {
    const content = view === 'source' ? document?.text : document?.body;
    if (content === undefined) return <div className="skills-preview-empty"><FileQuestion size={22}/><p>{t('正文不可读取', 'Document unavailable')}</p></div>;
    if (view === 'read') return <div className="skills-preview-markdown"><Markdown
      components={{ img: ({ alt }) => <span>{alt}</span>, a: ({ children }) => <span>{children}</span> }}>{content}</Markdown></div>;
    return <pre className="skills-preview-source"><code>{content.split(/\r?\n/).map((line, index) => <span key={index}>
      <i aria-hidden="true">{index + 1}</i><span>{line || ' '}</span>
    </span>)}</code></pre>;
  }

  return <section className="skills-settings" aria-label="Skills" data-detail={showDetail && Boolean(skill)}
    onKeyDown={event => {
      if (event.key !== 'Escape' || draft || !showDetail || !narrow() || event.nativeEvent.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      back();
    }}>
    <div className="skills-preview-index">
      <header>
        <div className="skills-preview-list-title"><h3>Skills</h3><span aria-live="polite">{t(`${matches.length} 项`, `${matches.length} skills`)}</span>
          <button type="button" className="icon-button" aria-label={t('刷新 Skills', 'Refresh skills')} data-tooltip={t('刷新 Skills', 'Refresh skills')}
            disabled={catalog.loading || pending !== undefined} onClick={refresh}><RefreshCw size={14}/></button>
        </div>
        <div className="skills-preview-search"><Search size={15} aria-hidden="true"/>
          <input ref={search} type="search" aria-label={t('搜索 Skills', 'Search skills')} placeholder={t('搜索 Skills', 'Search skills')}
            value={query} onChange={event => { setQuery(event.currentTarget.value); setShowDetail(false); }}/>
          {query && <button type="button" className="icon-button" aria-label={t('清除搜索', 'Clear search')}
            onClick={() => { setQuery(''); search.current?.focus(); }}><X size={14}/></button>}
        </div>
        <div className="skills-preview-list-actions">
          <button type="button" disabled={locked}
            onClick={() => openDraft({ kind: 'skill', name: '', description: '', body: '' })}><Plus size={14}/>{t('新建', 'New')}</button>
          <button type="button" disabled={locked} onClick={() => void perform('import', () => bridge.capabilityImportSkill(),
            t('已导入 Skill。', 'Skill imported.'), revealCreated)}>
            <FolderOpen size={14}/>{pending === 'import' ? t('导入中…', 'Importing…') : t('导入文件夹', 'Import folder')}
          </button>
        </div>
      </header>
      <div className="skills-preview-list-pane"><PageLoadingState pending={!catalog.value && catalog.loading} message={t('正在加载 Skills', 'Loading skills')}>
        <div className="skills-preview-list">
          {(['user', 'plugin'] as const).map(source => {
            const group = matches.filter(item => item.source === source);
            if (!group.length) return null;
            return <section key={source}>
              <h4>{source === 'plugin' ? t('插件提供', 'From plugins') : t('本地', 'Local')}</h4>
              <ul>{group.map(item => <li key={item.id}>
                <button type="button" ref={item.id === skill?.id ? activeRow : undefined} aria-current={item.id === skill?.id ? 'true' : undefined}
                  onClick={() => open(item.id)}>
                  {item.source === 'plugin' ? <Plug size={15} aria-hidden="true"/> : <BookOpen size={15} aria-hidden="true"/>}
                  <span>{item.name}{item.pluginName && matches.some(other => other.id !== item.id && other.name === item.name) && <small>{item.pluginName}</small>}</span>
                  <ChevronRight size={13} aria-hidden="true"/>
                </button>
              </li>)}</ul>
            </section>;
          })}
          {!matches.length && catalog.value && <p className="skills-preview-list-empty">{filter
            ? t('没有匹配的 Skills', 'No matching skills') : t('没有已发现的 Skills', 'No discovered skills')}</p>}
          {matchingCommands.length > 0 && <CapabilityDisclosure className="cap-preparation skills-session-commands"
            label={<>{t('会话命令', 'Session commands')} · {matchingCommands.length}</>}>
            <ul>{matchingCommands.map(item => <li key={item.name}><code>/{item.name}</code>{item.description && <small>{item.description}</small>}</li>)}</ul>
          </CapabilityDisclosure>}
        </div>
      </PageLoadingState></div>
    </div>
    <div className="skills-preview-detail">
      {skill ? <>
        <header className="skills-preview-detail-header">
          <button type="button" className="skills-preview-back" onClick={back}><ArrowLeft size={15}/>Skills</button>
          <div className="skills-preview-identity"><h3 ref={heading} tabIndex={-1}>{skill.name}</h3>
            {!local ? <span className="skills-preview-tag">{t('插件管理 · 只读', 'Plugin-managed · Read only')}</span> : <div className="skills-preview-actions">
              <button type="button" disabled={locked || !detailReady || !canEdit} onClick={() => {
                if (!document || document.body === undefined) return;
                openDraft({ kind: 'skill', name: skill.name, description: document.description ?? skill.description,
                  body: document.body, target: { id: skill.id, revision: document.revision } });
              }}><Pencil size={14}/>{t('编辑', 'Edit')}</button>
              {skill.deletable && <button type="button" className="icon-button" disabled={locked || detail.loading}
                data-tooltip={t('删除 Skill', 'Delete skill')} aria-label={t('删除 Skill', 'Delete skill')}
                onClick={() => openDraft({ kind: 'remove-skill', id: skill.id, name: skill.name, revision: document?.revision })}><Trash2 size={15}/></button>}
            </div>}
          </div>
          <div className="skills-preview-origin">
            {local ? <BookOpen size={14} aria-hidden="true"/> : <Plug size={14} aria-hidden="true"/>}
            <span>{skill.pluginName ?? t('Desktop 本地', 'Desktop local')}</span><span className="skills-preview-origin-divider" aria-hidden="true"/>
            <code>{skill.location}</code>
          </div>
          {skill.description && <p>{skill.description}</p>}
          <div className="skills-preview-runtime">
            {local && skill.toggleable && <div className="skills-preview-invocation" lang={language}>
              <span aria-hidden="true">{invocation}</span>
              <ScheduledTaskSelect key={skill.id} label={invocation} value={mode} options={[
                { id: 'auto', label: t('自动', 'Automatic'), disabled: locked || !detailReady || !document || (!canEdit && skill.manualOnly !== false) },
                { id: 'manual', label: t('仅手动', 'Manual only'), disabled: locked || !detailReady || !document || (!canEdit && skill.manualOnly !== true) },
                { id: 'off', label: t('关闭', 'Off'), disabled: locked },
              ]} onChange={id => {
                if (id === mode || (id !== 'auto' && id !== 'manual' && id !== 'off')) return;
                void perform('mutate', () => bridge.capabilityMutate({ action: 'skill-mode', id: skill.id, mode: id, revision: document?.revision }),
                  t('调用方式已保存。', 'Invocation saved.'));
              }}/>
            </div>}
            {mode !== 'off' && <div className="skills-preview-command">
              <code>{command}</code>
              <button type="button" className="icon-button" data-tooltip={t('复制调用命令', 'Copy invocation command')}
                aria-label={t('复制调用命令', 'Copy invocation command')} onClick={async () => {
                  try {
                    await bridge.copyText(command);
                    if (lifecycle.current) setNotice(t('已复制调用命令。', 'Invocation command copied.'));
                  } catch {
                    if (lifecycle.current) setOperationError(t('未能复制；可以选中命令手动复制。', 'Could not copy. Select the command to copy it manually.'));
                  }
                }}><Copy size={13}/></button>
            </div>}
          </div>
        </header>
        <div className="skills-preview-docbar">
          <div className="skills-preview-tabs" role="group" aria-label={t('Skill 内容', 'Skill contents')}>
            <button type="button" aria-pressed={tab === 'document'} onClick={() => { setTab('document'); setView('read'); }}><FileText size={14}/>SKILL.md</button>
            <button type="button" ref={fileTab} aria-pressed={tab === 'files'} onClick={() => { setTab('files'); setView('read'); }}><FolderOpen size={14}/>{t('配套文件', 'Files')}<small>{files.length}</small></button>
          </div>
          {tab === 'document' ? document?.text !== undefined && <div className="skills-preview-segment" role="group" aria-label={t('文档视图', 'Document view')}>
            <button type="button" aria-pressed={view === 'read'} onClick={() => setView('read')}><BookOpen size={13}/>{t('阅读', 'Read')}</button>
            <button type="button" aria-pressed={view === 'source'} onClick={() => setView('source')}><CodeXml size={13}/>{t('源文', 'Source')}</button>
          </div> : canManageFiles && <button type="button" disabled={locked || !detailReady}
            onClick={() => openDraft({ kind: 'file', id: skill.id, path: '', body: '' })}><Plus size={14}/>{t('新建文件', 'New file')}</button>}
        </div>
        <article ref={article} className="skills-preview-scroll skills-preview-doc" aria-label={tab === 'document' ? 'SKILL.md' : t('配套文件', 'Files')} tabIndex={0}>
          <PageLoadingState pending={!detail.value && detail.loading} message={t('正在读取 Skill', 'Loading skill')}>
          {detail.error !== undefined ? <div className="skills-preview-empty">
            <p role="alert">{errorText(detail.error)}</p><button type="button" onClick={refresh}>{t('重试', 'Retry')}</button>
          </div> : tab === 'document' ? renderBody() : <>
              {files.length > 0 ? <ul className="skills-preview-files">{files.map(item => <li key={item.id}>
                <button type="button" aria-expanded={file?.id === item.id} onClick={() => setFilePath(filePath === item.path ? '' : item.path)}>
                  <FileText size={14}/><code>{item.path}</code><DisclosureChevron/>
                </button>
                {file?.id === item.id && <div className="skills-preview-file">
                  {canManageFiles && fileRead.value && <div className="skills-preview-actions">
                    {fileRead.value.text !== undefined && <button type="button" disabled={locked || !detailReady || fileRead.loading}
                      onClick={() => openDraft({ kind: 'file', id: skill.id, path: item.path, body: fileRead.value!.text!,
                        target: { id: item.id, revision: fileRead.value!.revision } })}><Pencil size={14}/>{t('编辑文件', 'Edit file')}</button>}
                    <button type="button" className="icon-button" disabled={locked || !detailReady || fileRead.loading}
                      data-tooltip={t('删除文件', 'Delete file')} aria-label={t('删除文件', 'Delete file')}
                      onClick={() => openDraft({ kind: 'remove-file', id: skill.id, path: item.path,
                        target: { id: item.id, revision: fileRead.value!.revision } })}><Trash2 size={15}/></button>
                  </div>}
                  {fileRead.error !== undefined ? <p className="skills-preview-error" role="alert">{errorText(fileRead.error)}</p>
                    : fileRead.value?.text !== undefined ? <pre>{fileRead.value.text}</pre>
                      : fileRead.loading ? <p role="status">{t('正在读取', 'Loading')}</p> : <p>{t('该文件无法作为文本预览。', 'This file cannot be previewed as text.')}</p>}
                </div>}
              </li>)}</ul> : <div className="skills-preview-empty"><FolderOpen size={22}/><p>{t('没有配套文件', 'No supporting files')}</p></div>}
            </>}
          </PageLoadingState>
        </article>
      </> : <div className="skills-preview-empty"><BookOpen size={22}/><p>{t('未选中 Skill', 'No skill selected')}</p></div>}
    </div>
    <footer className="skills-preview-foot">
      <div>
        {(operationError || catalog.error !== undefined) && <p className="skills-preview-error" role="alert">
          {operationError || capabilityErrorText(catalog.error, language === 'zh')}
        </p>}
        {preview && <p>{t('预览 · 不写入真实设置', 'Preview · Does not write settings')}</p>}
        <p role="status">{notice || (!preview && t('Desktop 独立配置', 'Desktop profile'))}</p>
        {pendingRestart && !preview && <p>{t('配置已保存，已打开的会话需重启后才会应用。', 'Configuration saved. Open sessions apply it after restart.')}</p>}
        {[...(catalog.value?.warnings ?? []), ...warnings].map((warning, index) => <p key={`${index}:${warning}`}>{capabilityWarningText(warning, language === 'zh')}</p>)}
      </div>
      {runtimeId && <button type="button" disabled={busy || Boolean(pending) || catalog.loading} onClick={() => void restart()}>
        <RotateCcw size={14}/>{pending === 'restart' ? t('正在重启', 'Restarting') : t('重启当前会话', 'Restart current session')}
      </button>}
    </footer>
    {draft && <SkillDialog key={draft.kind} onCancel={() => { if (!busyRef.current) setDraft(undefined); }} title={
      draft.kind === 'skill' ? draft.target ? t('编辑 Skill', 'Edit skill') : t('新建 Skill', 'New skill')
        : draft.kind === 'file' ? draft.target ? t('编辑文件', 'Edit file') : t('新建文件', 'New file')
          : draft.kind === 'remove-skill' ? t('删除 Skill？', 'Delete skill?') : t('删除文件？', 'Delete file?')
    }>
      <form onSubmit={save}>
        <div className="skills-preview-dialog-content form-text-focus" onFocusCapture={revealFocusedTextField}>
          {draft.kind === 'skill' ? <>
            <label>{t('名称', 'Name')}<input required readOnly={Boolean(draft.target)} maxLength={64} placeholder="my-skill"
              value={draft.name} disabled={Boolean(pending)} onChange={event => setDraft({ ...draft, name: event.currentTarget.value })}/></label>
            <label>{t('描述', 'Description')}<textarea required maxLength={1024} rows={2}
              value={draft.description} disabled={Boolean(pending)} onChange={event => setDraft({ ...draft, description: event.currentTarget.value })}/></label>
            <label>{t('正文 (Markdown)', 'Body (Markdown)')}<textarea required={!draft.target} rows={9} maxLength={textLimit}
              className="skills-preview-editor" value={draft.body} disabled={Boolean(pending)} onChange={event => setDraft({ ...draft, body: event.currentTarget.value })}/></label>
          </> : draft.kind === 'file' ? <>
            <label>{t('文件路径', 'File path')}<input required maxLength={180} placeholder="references/checklist.md"
              value={draft.path} disabled={Boolean(pending)} onChange={event => setDraft({ ...draft, path: event.currentTarget.value })}/></label>
            <label>{t('文本内容', 'Text content')}<textarea rows={9} maxLength={textLimit} className="skills-preview-editor"
              value={draft.body} disabled={Boolean(pending)} onChange={event => setDraft({ ...draft, body: event.currentTarget.value })}/></label>
          </> : <p>{draft.kind === 'remove-skill'
            ? <>{t('将移除 ', 'Remove ')}<code>{draft.name}</code>{t(' 及其配套文件。', ' and its files.')}</>
            : <>{t('将移除 ', 'Remove ')}<code>{draft.path}</code>{t('。', '.')}</>}</p>}
          {draftError && <p className="skills-preview-error" role="alert">{draftError}</p>}
          {draftNotice && <p role="status">{draftNotice}</p>}
        </div>
        <footer>
          {draftConflict && (draft.kind === 'skill' || draft.kind === 'file') && <button type="button" disabled={Boolean(pending)}
            onClick={() => void copyDraft()}><Copy size={14}/>{t('复制草稿', 'Copy draft')}</button>}
          <button type="button" disabled={Boolean(pending)} onClick={() => setDraft(undefined)}>{t('取消', 'Cancel')}</button>
          {draft.kind === 'remove-file' || draft.kind === 'remove-skill'
            ? <button className="skills-preview-danger" type="submit" disabled={locked}>{pending ? t('正在删除', 'Deleting') : t('删除', 'Delete')}</button>
            : <button className="primary" type="submit" disabled={locked}>{pending ? t('正在保存', 'Saving') : t('保存', 'Save')}</button>}
        </footer>
      </form>
    </SkillDialog>}
  </section>;
}
