import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Bot, ChevronRight, Copy, FileText, Pencil, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { AgentRoleIcon, roleFor } from './AgentRole';
import { DisclosureSelect } from './DisclosureSelect';
import { RoleRow, SubagentModelSection } from './SubagentRoleSettings';
import type { DesktopBridge, Model } from './contracts';
import type { PersonalSubagent, SubagentDefinition, SubagentDefinitionCatalog, SubagentDefinitionDraft } from './subagent-definitions';
import { isSubagentRole, subagentModelLevels, type SubagentRoleSettings } from './subagent-role-models';
import './subagent-definitions-settings.css';

type Editor = SubagentDefinitionDraft & { revision: string | null };
type Language = 'zh' | 'en';
const blank: Editor = { slug: '', description: '', prompt: '', model: null, profile: 'read', revision: null };
const newId = '@new';
const groups = ['builtin', 'personal', 'file'] as const;
const labels = (language: Language) => (zh: string, en: string) => language === 'zh' ? zh : en;
const modelId = (model: Pick<Model, 'provider' | 'id'>) => `${model.provider}/${model.id}`;
const profileLabels = (t: ReturnType<typeof labels>) => ({
  read: t('读取和搜索', 'Read and search'),
  command: t('读取和命令', 'Read and run commands'),
  edit: t('读取、修改和命令', 'Read, edit and run commands'),
});
const editable = ({ slug, description, prompt, model, profile, revision }: PersonalSubagent): Editor =>
  ({ slug, description, prompt, model, profile, revision });
const effortLabel = (effort: string, language: Language) =>
  effort === 'off' ? labels(language)('关闭', 'Off') : effort[0].toUpperCase() + effort.slice(1);

function ModelValue({ label, value }: { label: string; value: string }) {
  return <div className="subagent-definition-model-value"><span>{label}</span><span>{value}</span></div>;
}

function RoleDefinition({ title, children }: { title: string; children: ReactNode }) {
  return <div className="subagent-definition-definition"><h4>{title}</h4>{children}</div>;
}

function RoleDialog({ title, cancel, children }: { title: string; cancel(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="skills-preview-dialog subagent-role-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); cancel(); }}
    onKeyDown={event => event.stopPropagation()}>
    <header><h3 id={titleId}>{title}</h3></header>
    {children}
  </dialog>;
}

function PersonalEditor({ initial, language, models, onSave, onClose }: {
  initial: Editor; language: Language; models: Model[];
  onSave(value: Editor): Promise<void>; onClose(): void;
}) {
  const t = labels(language);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState('');
  const firstField = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { firstField.current?.focus(); }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const valid = /^[a-z0-9][a-z0-9-]{0,47}$/u.test(draft.slug) && draft.description.trim() && draft.prompt.trim();
  const set = (patch: Partial<Editor>) => { setDraft(current => ({ ...current, ...patch })); setError(''); };
  function cancel() {
    if (busy) return;
    if (discard) { setDiscard(false); requestAnimationFrame(() => firstField.current?.focus()); }
    else if (dirty) setDiscard(true);
    else onClose();
  }
  async function save() {
    if (!valid || busy || discard || (initial.revision && !dirty)) return;
    setBusy(true);
    setError('');
    try { await onSave(draft); }
    catch (cause) {
      setError(String(cause).includes('subagent:conflict')
        ? t('角色已存在或已在别处更改。可换一个标识，或取消后重新加载。',
          'This role already exists or changed elsewhere. Choose another identifier, or cancel and reload.')
        : t('无法保存角色，编辑内容已保留。', 'Could not save the role. Your draft is preserved.'));
    } finally { setBusy(false); }
  }
  return <form className="subagent-definition-form" aria-label={initial.revision ? t('编辑个人角色', 'Edit personal role') : t('新建角色', 'Create role')}
    onSubmit={event => { event.preventDefault(); void save(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
    <fieldset disabled={busy || discard}>
      {!initial.revision && <label>{t('角色标识', 'Role identifier')}
        <input ref={firstField} value={draft.slug} maxLength={48} required pattern={'[a-z0-9][a-z0-9\\-]{0,47}'}
          placeholder="release-review" onChange={event => set({ slug: event.target.value })}/>
      </label>}
      <label>{t('职责', 'Description')}
        <input ref={initial.revision ? firstField : undefined} value={draft.description} maxLength={240} required
          onChange={event => set({ description: event.target.value })}/>
      </label>
      <SubagentModelSection title={t('模型设置', 'Model settings')}>
        <label>{t('模型', 'Model')}
          <DisclosureSelect value={draft.model ?? ''} onChange={event => set({ model: event.target.value || null })}>
            <option value="">{t('继承主会话', 'Inherit conversation')}</option>
            {draft.model && !models.some(model => modelId(model) === draft.model) &&
              <option value={draft.model}>{draft.model} ({t('不可用', 'unavailable')})</option>}
            {models.map(model => <option key={modelId(model)} value={modelId(model)}>{model.name} · {model.providerName ?? model.provider}</option>)}
          </DisclosureSelect>
        </label>
        <ModelValue label={t('思考强度', 'Thinking effort')} value={t('不单独设置', 'Not set separately')}/>
      </SubagentModelSection>
      <RoleDefinition title={t('角色定义', 'Role definition')}>
        <label>{t('可用工具', 'Available tools')}
          <DisclosureSelect value={draft.profile} onChange={event => set({ profile: event.target.value as Editor['profile'] })}>
            {Object.entries(profileLabels(t)).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </DisclosureSelect>
        </label>
        <label>{t('系统提示词', 'System prompt')}
          <textarea value={draft.prompt} maxLength={12000} spellCheck={false} required onChange={event => set({ prompt: event.target.value })}/>
        </label>
      </RoleDefinition>
      {error && <p className="subagent-definition-error" role="alert">{error}</p>}
    </fieldset>
    <footer className="subagent-definition-footer">
      <small className="muted" role="status">{discard ? t('放弃未保存的更改？', 'Discard unsaved changes?') : dirty ? t('未保存', 'Unsaved') : ''}</small>
      <div className="subagent-definition-actions">{discard ? <>
        <button type="button" ref={button => button?.focus()} onClick={cancel}>{t('继续编辑', 'Keep editing')}</button>
        <button type="button" onClick={onClose}>{t('放弃更改', 'Discard changes')}</button>
      </> : <>
        <button type="button" disabled={busy} onClick={cancel}>{t('取消', 'Cancel')}</button>
        <button className="primary" type="submit" disabled={busy || !valid || Boolean(initial.revision && !dirty)}>
          <Save size={15}/>{t('保存角色', 'Save role')}</button>
      </>}</div>
    </footer>
  </form>;
}

export function SubagentDefinitionsSettings({ bridge, language, models }: {
  bridge: Pick<DesktopBridge, 'subagentDefinitions' | 'saveSubagentDefinition' | 'removeSubagentDefinition' | 'copyText' |
    'subagentRoleSettings' | 'saveSubagentRole'>;
  language: Language;
  models: Model[];
}) {
  const t = labels(language);
  const [catalog, setCatalog] = useState<SubagentDefinitionCatalog>();
  const [builtin, setBuiltin] = useState<SubagentRoleSettings>();
  const [selectedId, setSelectedId] = useState('review');
  const [showDetail, setShowDetail] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Editor>>({});
  const [pendingDelete, setPendingDelete] = useState<PersonalSubagent>();
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [builtinError, setBuiltinError] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const editFocus = useRef<string | null>(null);
  const roles = catalog?.roles ?? [];
  const newDraft = drafts[newId];
  const editableModels = models.filter(model => subagentModelLevels(model).length);
  const inherit = t('继承主会话', 'Inherit conversation');
  const modelTitle = (id: string | null) => models.find(model => modelId(model) === id)?.name ?? id ?? inherit;
  const roleTitle = (role: SubagentDefinition) => role.source === 'builtin' ? roleFor(role.id).name[language === 'zh' ? 0 : 1]
    : role.source === 'personal' ? role.slug : role.id;
  const sourceLabel = (source: SubagentDefinition['source']) => source === 'builtin' ? t('内置角色', 'Built-in role')
    : source === 'file' ? t('本地配置文件 · 只读', 'Local configuration file · Read only') : t('个人角色', 'Personal role');
  const groupTitle = { builtin: t('内置角色', 'Built-in roles'), personal: t('个人角色', 'Personal roles'),
    file: t('本地配置文件', 'Local configuration files') };

  const refresh = useCallback(async (active: () => boolean = () => true) => {
    setLoading(true);
    setCatalogError(false);
    setBuiltinError(false);
    const [definitions, settings] = await Promise.allSettled([bridge.subagentDefinitions(), bridge.subagentRoleSettings()]);
    if (!active()) return;
    if (definitions.status === 'fulfilled') {
      setCatalog(definitions.value);
      setSelectedId(id => definitions.value.roles.some(role => role.id === id) ? id
        : (definitions.value.roles.find(role => role.id === 'review') ?? definitions.value.roles[0])?.id ?? '');
    } else setCatalogError(true);
    if (settings.status === 'fulfilled') setBuiltin(settings.value);
    else setBuiltinError(true);
    setLoading(false);
  }, [bridge]);
  useEffect(() => {
    let active = true;
    void refresh(() => active);
    return () => { active = false; };
  }, [refresh]);

  function select(id: string) {
    setSelectedId(id);
    setShowDetail(true);
    setStatus('');
    setError('');
    requestAnimationFrame(() => {
      if (inspector.current) inspector.current.scrollTop = 0;
      if (backButton.current?.checkVisibility()) inspector.current?.focus();
    });
  }
  function returnToList() {
    setShowDetail(false);
    requestAnimationFrame(() => (list.current?.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? addButton.current)?.focus());
  }
  function startNew(role?: SubagentDefinition) {
    if (newDraft) { select(newId); return; }
    const stem = role?.id.split(':').at(-1)?.replace(/[^a-z0-9-]/gu, '-').replace(/^-+/u, '').slice(0, 39);
    let slug = stem ? `${stem}-copy` : '';
    for (let index = 2; slug && roles.some(item => item.id === `custom:${slug}`); index++) slug = `${stem}-copy-${index}`;
    // Duplication must not grant the source role's permissions or model.
    setDrafts(current => ({ ...current, [newId]: role ? { ...blank, slug, description: role.description.slice(0, 240),
      prompt: role.prompt.slice(0, 12000) } : blank }));
    setSelectedId(newId);
    setShowDetail(true);
    setStatus('');
    setError('');
    if (inspector.current) inspector.current.scrollTop = 0;
  }
  function closeDraft(id: string) {
    setDrafts(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  // The edit button is mounted by the commit that closes the editor.
  useLayoutEffect(() => {
    const id = editFocus.current;
    if (!id) return;
    editFocus.current = null;
    if (selectedId !== id || !showDetail) return;
    const detail = inspector.current?.querySelector<HTMLElement>('section[data-definition-id]:not([hidden])');
    if (detail?.dataset.definitionId === id && detail.checkVisibility()) detail.querySelector<HTMLButtonElement>('.subagent-definition-edit')?.focus();
  }, [drafts, selectedId, showDetail]);
  async function save(id: string, draft: Editor) {
    const saved = await bridge.saveSubagentDefinition(draft);
    editFocus.current = saved.id;
    setCatalog(current => current && { ...current, roles: [...current.roles.filter(role => role.id !== saved.id), saved] });
    closeDraft(id);
    setSelectedId(current => current === id ? saved.id : current);
    setStatus(t('角色已保存', 'Role saved'));
  }
  async function remove() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await bridge.removeSubagentDefinition({ slug: pendingDelete.slug, revision: pendingDelete.revision });
      setCatalog(current => current && { ...current, roles: current.roles.filter(role => role.id !== pendingDelete.id) });
      setSelectedId('review');
      setShowDetail(false);
      setStatus(t('角色已删除', 'Role deleted'));
      requestAnimationFrame(() => addButton.current?.focus());
    } catch (cause) {
      setError(String(cause).includes('subagent:conflict') ? t('角色已在别处更改。请重新加载后再删除。',
        'This role changed elsewhere. Reload before deleting it.') : t('无法删除角色。', 'Could not delete the role.'));
    } finally { setDeleting(false); setPendingDelete(undefined); }
  }

  return <section className="subagent-definitions" data-detail={showDetail ? 'open' : 'closed'} aria-labelledby="subagent-definitions-title">
    <header className="subagent-definition-header">
      <h3 id="subagent-definitions-title">{t('子代理', 'Subagents')}</h3>
      <small className="muted" role="status">{status}</small>
      <div className="subagent-definition-actions">
        <button type="button" ref={addButton} disabled={!catalog?.available || loading} onClick={() => startNew()}>
          <Plus size={15}/>{t('新建子代理', 'New subagent')}</button>
        <button type="button" className="icon-button" disabled={loading || Object.keys(drafts).length > 0}
          aria-label={t('重新加载角色', 'Reload roles')} data-tooltip={t('重新加载角色', 'Reload roles')}
          onClick={() => { setError(''); setStatus(''); void refresh(); }}><RotateCcw size={15}/></button>
      </div>
    </header>
    {(catalogError || error) && <p role="alert" className="subagent-definition-message subagent-definition-error">
      {error || t('无法读取角色。', 'Could not load roles.')}</p>}
    {loading && !catalog && <p className="muted subagent-definition-message" role="status">{t('加载中…', 'Loading…')}</p>}
    {catalog && !catalog.available && <p className="muted subagent-definition-message">
      {t('当前运行时不支持自定义角色。内置模型设置仍可在「通用」中使用。',
        'This runtime does not support custom roles. Built-in model settings are still in General.')}</p>}
    {catalog?.available && <div className="subagent-definition-workspace">
      <div className="subagent-definition-list" ref={list} aria-label={t('角色列表', 'Role list')}>
        <div className="subagent-definition-columns"><span>{t('角色', 'Role')}</span><span>{t('当前模型', 'Current model')}</span></div>
        {groups.map(group => {
          const items = roles.filter(role => role.source === group);
          if (group === 'file' && !items.length) return null;
          if (group !== 'builtin') items.sort((a, b) => a.id.localeCompare(b.id));
          return <section key={group} className="subagent-definition-group" aria-labelledby={`subagent-group-${group}`}>
            <h4 id={`subagent-group-${group}`}>{groupTitle[group]}</h4>
            {group === 'personal' && newDraft && <button type="button" className="subagent-definition-row"
              aria-controls="subagent-inspector" aria-current={selectedId === newId || undefined} onClick={() => select(newId)}>
              <Plus size={15}/><strong>{t('新角色草稿', 'New role draft')}</strong>
              <span className="subagent-definition-row-model muted">{t('未保存', 'Unsaved')}</span><ChevronRight size={14}/>
            </button>}
            {!items.length && !(group === 'personal' && newDraft) && <p className="muted">{t('暂无角色', 'No roles')}</p>}
            {items.map(role => {
              const config = role.source === 'builtin' && isSubagentRole(role.id) ? builtin?.values[role.id] : undefined;
              const model = modelTitle(config ? modelId(config) : role.model);
              const Icon = role.source === 'file' ? FileText : Bot;
              return <button key={role.id} type="button" className="subagent-definition-row" data-role-id={role.id}
                aria-controls="subagent-inspector" aria-current={selectedId === role.id || undefined} onClick={() => select(role.id)}>
                {role.source === 'builtin' ? <span aria-hidden="true"><AgentRoleIcon agent={role.id} language={language}/></span> : <Icon size={15} aria-hidden="true"/>}
                <span title={role.id}><strong>{roleTitle(role)}</strong>
                  {(role.source === 'builtin' || drafts[role.id]) &&
                    <small>{drafts[role.id] ? t('编辑中', 'Editing') : role.id}</small>}</span>
                <span title={model} className="subagent-definition-row-model">{model}
                  {config && <small>{effortLabel(config.effort, language)}</small>}</span>
                <ChevronRight size={14} aria-hidden="true"/>
              </button>;
            })}
          </section>;
        })}
      </div>
      <div className="subagent-definition-inspector" id="subagent-inspector" tabIndex={-1} ref={inspector} aria-label={t('角色详情', 'Role details')}>
        <button type="button" className="subagent-definition-back" ref={backButton} onClick={returnToList}>
          <ArrowLeft size={15}/>{t('返回角色列表', 'Back to roles')}</button>
        {newDraft && <section hidden={selectedId !== newId}>
          <div className="subagent-definition-heading"><h3>{t('新建子代理', 'New subagent')}</h3></div>
          <PersonalEditor initial={newDraft} language={language} models={models} onSave={draft => save(newId, draft)} onClose={() => {
            closeDraft(newId);
            setSelectedId('review');
            returnToList();
          }}/>
        </section>}
        {roles.map(role => {
          const editing = drafts[role.id];
          const modelRole = role.source === 'builtin' && isSubagentRole(role.id) ? role.id : undefined;
          if (selectedId !== role.id && !editing && !modelRole) return null;
          return <section key={role.id} data-definition-id={role.id} hidden={selectedId !== role.id} aria-label={`${roleTitle(role)} ${t('详情', 'details')}`}>
            <div className="subagent-definition-heading">
              <div><h3>{roleTitle(role)}</h3>
                <p className="subagent-definition-identity">
                  <span>{sourceLabel(role.source)}</span><code>{role.id}</code>
                  <button type="button" className="icon-button" aria-label={t('复制调用名', 'Copy role ID')}
                    data-tooltip={t('复制调用名', 'Copy role ID')} onClick={() => {
                      void bridge.copyText(role.id).then(() => setStatus(t('调用名已复制', 'Role ID copied')),
                        () => setError(t('无法复制调用名。', 'Could not copy the role ID.')));
                    }}><Copy size={14}/></button>
                </p>
              </div>
              {role.source === 'personal' && !editing && <button type="button" className="icon-button"
                aria-label={t('删除角色', 'Delete role')} data-tooltip={t('删除角色', 'Delete role')}
                onClick={() => { setError(''); setPendingDelete(role); }}><Trash2 size={15}/></button>}
            </div>
            {editing ? <PersonalEditor initial={editing} language={language} models={models} onSave={draft => save(role.id, draft)}
              onClose={() => { editFocus.current = role.id; closeDraft(role.id); }}/> : <>
              <p className="subagent-definition-duty">{role.description}</p>
              {modelRole && builtin?.available ? <RoleRow role={modelRole} language={language} models={editableModels} detail
                saved={builtin.values[modelRole]} onSave={async value => {
                  const values = await bridge.saveSubagentRole(modelRole, value);
                  setBuiltin(current => current && { ...current, values });
                }}/> : <SubagentModelSection title={t('模型设置', 'Model settings')}
                  footer={role.source === 'personal' && <button type="button" className="subagent-definition-edit" onClick={() => {
                    setStatus('');
                    setDrafts(current => ({ ...current, [role.id]: editable(role) }));
                  }}><Pencil size={14}/>{t('编辑角色', 'Edit role')}</button>}>
                <ModelValue label={t('模型', 'Model')} value={modelRole && (loading || builtinError)
                  ? loading ? t('加载中…', 'Loading…') : t('无法读取角色配置', 'Could not read role settings') : modelTitle(role.model)}/>
                <ModelValue label={t('思考强度', 'Thinking effort')} value={role.source === 'personal'
                  ? t('不单独设置', 'Not set separately') : inherit}/>
              </SubagentModelSection>}
              <RoleDefinition title={t('角色定义', 'Role definition')}>
                <dl className="subagent-definition-properties">
                  <dt>{t('可用工具', 'Available tools')}</dt>
                  <dd>{role.source === 'personal' ? profileLabels(t)[role.profile] : role.tools
                    ? <code>{role.tools.join(', ')}</code> : t('默认子代理工具', 'Default subagent tools')}</dd>
                  <dt>{t('系统提示词', 'System prompt')}</dt><dd className="subagent-definition-prompt">{role.prompt}</dd>
                </dl>
                <button type="button" disabled={Boolean(newDraft)} onClick={() => startNew(role)}>
                  <Copy size={14}/>{t('复制为个人角色', 'Duplicate as personal role')}</button>
              </RoleDefinition>
            </>}
          </section>;
        })}
      </div>
    </div>}
    {pendingDelete && <RoleDialog cancel={() => { if (!deleting) setPendingDelete(undefined); }}
      title={t('删除个人角色？', 'Delete personal role?')}>
      <div className="skills-preview-dialog-content"><code>{pendingDelete.id}</code></div>
      <footer className="subagent-definition-actions">
        <button type="button" autoFocus disabled={deleting} onClick={() => setPendingDelete(undefined)}>{t('取消', 'Cancel')}</button>
        <button type="button" disabled={deleting} onClick={() => void remove()}>{t('确认删除', 'Confirm delete')}</button>
      </footer>
    </RoleDialog>}
  </section>;
}
