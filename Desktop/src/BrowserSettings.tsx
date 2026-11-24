import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Bot, Database, Monitor, Pencil, Plus, Trash2, X } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { DisclosureSelect } from './DisclosureSelect';
import { SiteIcon } from './SiteIcon';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import type { BrowserPresetMode, BrowserProfile, BrowserProfileSnapshot, BrowserProfileTarget, DesktopBridge } from './contracts';
import './browser-settings.css';

type Draft = { domain: string; mode: BrowserPresetMode; previous?: string };
type Removal = { domain: string; profile?: BrowserProfile; host?: string };
type Localize = (zh: string, en: string) => string;
const parseDomain = (value: string) => value.trim().toLowerCase();

function ProfileSites({ profile, sites, title, t, busy, onOpen, onClear }: {
  profile: BrowserProfile; sites: BrowserProfileSnapshot['sites'][BrowserProfile]; title: string; t: Localize; busy: boolean;
  onOpen: (target: BrowserProfileTarget) => void; onClear: (domain: string, host?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { details, body } = useAnimatedDisclosure(expanded);
  const Icon = profile === 'agent' ? Bot : Monitor;
  return <details className="bs-profile" ref={details} data-expanded={expanded}>
    <summary aria-expanded={expanded} onClick={event => { event.preventDefault(); setExpanded(value => !value); }}>
      <span className="bs-profile-icon"><Icon size={18}/></span>
      <span className="bs-copy"><strong>{title}</strong><small>{profile === 'personal'
        ? t('你在内置浏览器里使用的资料', 'Your own built-in browser profile')
        : t('登录与站点数据和「我的浏览器」分开保存', 'Sign-ins and site data are separate from My browser')}</small></span>
      <span className="bs-count">{t(`${sites.length} 个站点`, `${sites.length} ${sites.length === 1 ? 'site' : 'sites'}`)}</span>
      <span className="bs-chevron"><DisclosureChevron/></span>
    </summary>
    <div ref={body} className="bs-site-body" inert={!expanded}>
      {sites.length ? <ul aria-label={t('站点', 'Sites')}>{sites.map(({ openOrigin, ...site }) => <li key={site.domain} className="bs-site-row">
        <SiteIcon source={site.favicon} size={15}/><span className="bs-copy"><strong>{site.host ?? site.domain}</strong>
          {!site.host && <small>{t('仅有站点数据', 'Site data only')}</small>}</span>
        {openOrigin && <button type="button" className="icon-button" disabled={busy} aria-label={`${t('打开', 'Open')} ${site.host}`}
          data-tooltip={t('在此资料中打开', 'Open in this profile')} onClick={() => onOpen({ origin: openOrigin })}><ArrowUpRight size={16}/></button>}
        <button type="button" className="icon-button bs-clear-site" disabled={busy}
          aria-label={`${t('清除站点数据', 'Clear site data for')} ${site.host ?? site.domain}`}
          data-tooltip={t('清除站点数据', 'Clear site data')} onClick={() => onClear(site.domain, site.host)}><Trash2 size={15}/></button>
      </li>)}</ul> : <p className="bs-empty">{t('此资料还没有站点。', 'No sites in this profile yet.')}</p>}
      <form className="bs-open-form" onSubmit={event => {
        event.preventDefault();
        onOpen(parseDomain(String(new FormData(event.currentTarget).get('domain'))));
      }}>
        <input name="domain" required maxLength={253} pattern="[A-Za-z0-9.\\-]+" spellCheck={false} placeholder="example.com"
          aria-label={t('要打开的域名', 'Domain to open')}/>
        <button type="submit" disabled={busy}><ArrowUpRight size={15}/>{t('打开站点', 'Open site')}</button>
      </form>
    </div>
  </details>;
}

export function BrowserSettings({ bridge, language, onOpen }: {
  bridge: DesktopBridge; language: 'zh' | 'en'; onOpen: (profile: BrowserProfile, target: BrowserProfileTarget) => Promise<void>;
}) {
  const t: Localize = (zh, en) => language === 'zh' ? zh : en;
  const [data, setData] = useState<BrowserProfileSnapshot>();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>();
  const [removal, setRemoval] = useState<Removal>();
  const confirm = useRef<HTMLDialogElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const name = (profile: BrowserProfile) => profile === 'agent' ? t('Agent 专用', 'Agent profile') : t('我的浏览器', 'My browser');
  const modeName = (mode: BrowserPresetMode) => mode === 'agent' ? name('agent') : t('匿名会话', 'Anonymous');
  useEffect(() => {
    let active = true;
    void bridge.browserProfiles().then(value => { if (active) setData(value); }, () => {
      if (active) setError(t('无法读取浏览器资料。', 'Could not load browser profiles.'));
    });
    return () => { active = false; };
  }, [bridge, language, reload]);
  useEffect(() => {
    if (!removal || !confirm.current) return;
    const dialog = confirm.current;
    dialog.showModal();
    return () => dialog.close();
  }, [removal]);
  async function run(task: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await task(); }
    catch { setError(message); }
    finally { setBusy(false); }
  }
  function finishDraft() {
    setDraft(undefined);
    requestAnimationFrame(() => add.current?.focus());
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    void run(async () => {
      setData(await bridge.browserPreset(parseDomain(draft.domain), draft.mode, draft.previous));
      finishDraft();
    }, t('无法保存预设。请检查域名是否有效或已有预设。', 'Could not save. Check the domain and existing presets.'));
  }
  return <div className="bs-content" aria-busy={!data && !error || busy}>
    <div className="bs-title"><h1>{t('内置浏览器', 'Built-in browser')}</h1></div>
    {error && <p className="bs-error" role="alert">{error} {!data && <button type="button" onClick={() => { setError(''); setReload(value => value + 1); }}>{t('重试', 'Retry')}</button>}</p>}
    {!data && !error && <p className="bs-empty" role="status">{t('正在读取浏览器资料…', 'Loading browser profiles…')}</p>}
      <section className="bs-section" data-settings-anchor="browser-profiles">
        <div className="bs-section-heading"><Database size={17}/><h2>{t('浏览器资料', 'Browser profiles')}</h2></div>
        {data && <>
        <p className="bs-section-note">{t('按资料管理站点数据。列表不代表当前登录状态。', 'Manage site data by profile. A listed site may not be signed in.')}</p>
        <div className="bs-list">{(['personal', 'agent'] as const).map(profile => <ProfileSites
          key={profile} profile={profile} title={name(profile)} sites={data.sites[profile]} t={t} busy={busy}
          onOpen={target => void run(() => onOpen(profile, target), t('无法打开站点，请检查域名或切回当前会话。', 'Could not open the site. Check the domain or return to the current conversation.'))}
          onClear={(domain, host) => setRemoval({ domain, profile, host })}/>)}</div>
        </>}
      </section>
      <section className="bs-section" data-settings-anchor="browser-presets">
        <div className="bs-section-heading"><Bot size={17}/><h2>{t('Agent 打开预设', 'Agent opening presets')}</h2></div>
        {data && <>
        <p className="bs-section-note">{t('只影响 Agent 新开的标签；用 Agent 专用资料打开时仅查看。', 'Applies to new Agent tabs. Tabs opened with the Agent profile are view-only.')}</p>
        <div className="bs-list">
          <div className="bs-preset-row"><span className="bs-copy"><strong>{t('未匹配预设的站点', 'Sites without a preset')}</strong></span>
            <span className="bs-mode">{modeName('anonymous')}</span></div>
          {data.presets.map(rule => <div className="bs-preset-row bs-rule" key={rule.domain}>
            <SiteIcon source={rule.favicon} size={15}/><span className="bs-copy"><strong>{rule.domain}</strong></span>
            <span className="bs-mode" data-mode={rule.mode}>{modeName(rule.mode)}</span>
            <div className="bs-row-actions">
              <button type="button" disabled={busy} className="icon-button" aria-label={`${t('编辑预设', 'Edit preset for')} ${rule.domain}`}
                data-tooltip={t('编辑预设', 'Edit preset')} onClick={() => setDraft({ ...rule, previous: rule.domain })}><Pencil size={15}/></button>
              <button type="button" disabled={busy} className="icon-button" aria-label={`${t('移除预设', 'Remove preset for')} ${rule.domain}`}
                data-tooltip={t('移除预设', 'Remove preset')} onClick={() => setRemoval({ domain: rule.domain })}><Trash2 size={15}/></button>
            </div>
          </div>)}
        </div>
        {draft ? <form className="bs-editor" onSubmit={save}>
          <label>{t('站点域名', 'Site domain')}<input autoFocus key={draft.previous ?? 'new'} required maxLength={253} pattern="[A-Za-z0-9.\\-]+"
            spellCheck={false} placeholder="example.com" value={draft.domain} onChange={event => setDraft({ ...draft, domain: event.target.value })}/></label>
          <label>{t('打开方式', 'Open with')}<DisclosureSelect value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value as BrowserPresetMode })}>
            <option value="agent">{modeName('agent')}</option><option value="anonymous">{modeName('anonymous')}</option>
          </DisclosureSelect></label>
          <div className="bs-editor-actions"><button type="button" disabled={busy} onClick={finishDraft}>{t('取消', 'Cancel')}</button>
            <button type="submit" disabled={busy} className="primary">{t('保存', 'Save')}</button></div>
        </form> : <button type="button" ref={add} className="bs-add" disabled={busy} onClick={() => setDraft({ domain: '', mode: 'agent' })}>
          <Plus size={16}/>{t('添加站点预设', 'Add site preset')}</button>}
        </>}
      </section>
    {removal && <dialog ref={confirm} className="bs-modal" aria-labelledby="bs-remove-title"
      onCancel={event => { event.preventDefault(); if (!busy) setRemoval(undefined); }}>
      <header><h2 id="bs-remove-title">{removal.profile ? t('清除站点数据？', 'Clear site data?') : t('移除站点预设？', 'Remove site preset?')}</h2>
        <button type="button" className="icon-button" disabled={busy} aria-label={t('关闭', 'Close')} onClick={() => setRemoval(undefined)}><X size={17}/></button></header>
      <p><strong>{removal.domain}</strong>{removal.profile && ` · ${name(removal.profile)}`}</p>
      {removal.host && removal.host !== removal.domain && <p>{t(`清除范围包括 ${removal.domain} 及其子域名。`,
        `This also affects other subdomains of ${removal.domain}.`)}</p>}
      <p>{removal.profile ? t('会清除此资料下该站点的 Cookie 和已知站点存储，可能退出登录。打开的网页可能重新写入数据。', 'Clears cookies and known storage for this site in this profile. Open pages may recreate data, and you may be signed out.')
        : t('以后 Agent 新开此站点时将使用匿名会话。', 'New Agent tabs for this site will open anonymously.')}</p>
      <footer><button type="button" autoFocus disabled={busy} onClick={() => setRemoval(undefined)}>{t('取消', 'Cancel')}</button>
        <button type="button" className="bs-destructive" disabled={busy} onClick={() => {
          setRemoval(undefined);
          void run(async () => setData(removal.profile ? await bridge.browserProfileClear(removal.profile, removal.domain)
            : await bridge.browserPreset(removal.domain, null)), t('无法完成操作，请重试。', 'Could not complete the operation. Try again.'));
        }}>{removal.profile ? t('清除数据', 'Clear data') : t('移除预设', 'Remove preset')}</button></footer>
    </dialog>}
  </div>;
}
