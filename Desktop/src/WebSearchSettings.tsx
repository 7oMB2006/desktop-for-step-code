import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, GripVertical, ListOrdered, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { bindPriorityDrag, capturePriorityRows, settlePriorityRows } from './priority-order-motion';
import { webSearchIds, webSearchProviders, type WebSearchBridge, type WebSearchEdit, type WebSearchProvider, type WebSearchSettings as Settings } from './web-search';
import './web-search-settings.css';

const marks: Record<WebSearchProvider, string> = {
  step: new URL('./assets/providers/stepfun-color.svg', import.meta.url).href,
  tavily: new URL('./assets/providers/tavily-color.svg', import.meta.url).href,
  exa: new URL('./assets/providers/exa-color.svg', import.meta.url).href,
  brave: new URL('./assets/providers/brave-color.svg', import.meta.url).href,
  bocha: new URL('./assets/providers/bocha-color.svg', import.meta.url).href,
  searxng: new URL('./assets/providers/searxng-color.svg', import.meta.url).href,
};
type View = 'order' | 'catalog' | WebSearchProvider;
const Brand = ({ id, size = 18 }: { id: WebSearchProvider; size?: number }) =>
  <img className="provider-preset-mark web-search-mark" src={marks[id]} width={size} height={size} alt="" draggable={false}/>;
const IconButton = ({ label, ...props }: ComponentProps<'button'> & { label: string }) =>
  <button type="button" className="icon-button" aria-label={label} title={label} {...props}/>;
const Toggle = ({ label, checked, onClick, disabled }: {
  label: string; checked: boolean; onClick: () => void; disabled?: boolean;
}) => <button type="button" className={`provider-switch${checked ? ' on' : ''}`} role="switch"
  aria-label={label} aria-checked={checked} disabled={disabled} onClick={onClick}><span/></button>;

export function WebSearchSettings({ bridge, language, onAccount }: {
  bridge: WebSearchBridge; language: 'zh' | 'en'; onAccount: () => void;
}) {
  const zh = language === 'zh', index = zh ? 0 : 1;
  const t = (ch: string, en: string) => zh ? ch : en;
  const name = (id: WebSearchProvider) => webSearchProviders[id].name[index];
  const [settings, setSettings] = useState<Settings>();
  const [view, setView] = useState<View>('order');
  const [back, setBack] = useState<'order' | 'catalog'>('order');
  const [returnService, setReturnService] = useState<WebSearchProvider>();
  const [form, setForm] = useState({ enabled: false, credential: '' });
  const [confirm, setConfirm] = useState<'remove' | View>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const scope = useRef<HTMLElement>(null);
  const focus = useRef('');
  const orderList = useRef<HTMLOListElement>(null);
  const beforeMove = useRef<ReturnType<typeof capturePriorityRows> | undefined>(undefined);
  const [pendingOrder, setPendingOrder] = useState<WebSearchProvider[]>();
  const visibleOrder = pendingOrder ?? settings?.order;
  useEffect(() => {
    let alive = true;
    void bridge.webSearchSettings().then(value => { if (alive) setSettings(value); },
      () => { if (alive) setError('load'); });
    return () => { alive = false; };
  }, [bridge]);
  useEffect(() => {
    if (focus.current) scope.current?.querySelector<HTMLElement>(focus.current)?.focus();
    focus.current = '';
  }, [view]);
  useLayoutEffect(() => {
    if (orderList.current && beforeMove.current) settlePriorityRows(orderList.current, beforeMove.current);
    beforeMove.current = undefined;
  }, [visibleOrder]);
  useEffect(() => {
    const list = orderList.current;
    if (!list || !settings || saving) return;
    return bindPriorityDrag(list, (provider, destination, before) => {
      const source = settings.order.find(id => id === provider);
      if (source) move(source, destination, before);
    });
  }, [view, settings, saving]);
  const id = view !== 'order' && view !== 'catalog' ? view : undefined;
  const configured = Boolean(id && settings?.configured.includes(id));
  const dirty = Boolean(id && settings && (form.enabled !== settings.order.includes(id)
    || form.credential !== (id === 'searxng' ? settings.instance ?? '' : '')));
  const note = (provider: WebSearchProvider) => provider === 'step'
    ? settings?.step === 'api' ? t('阶跃开放平台 · 按量', 'Step Open Platform · Pay as you go') : 'Step Plan'
    : webSearchProviders[provider].note[index];

  function open(target: View, force = false) {
    if (!settings || saving || target === view) return;
    if (dirty && !force) { setConfirm(target); return; }
    setConfirm(undefined);
    setError('');
    focus.current = id && target === back
      ? back === 'catalog' ? `[data-search-preset="${returnService ?? id}"]` : `[data-search-rail="${id}"], .web-search-title`
      : '.web-search-title';
    if (target !== 'order' && target !== 'catalog') {
      if (!id) setBack(view === 'catalog' ? 'catalog' : 'order');
      setReturnService(target);
      setForm({ enabled: settings.order.includes(target), credential: target === 'searxng' ? settings.instance ?? '' : '' });
    }
    setView(target);
  }

  async function save(edit: WebSearchEdit) {
    if (!settings || saving) return;
    setSaving(true); setError(''); setConfirm(undefined);
    try {
      const next = await bridge.saveWebSearch(settings.revision, edit);
      setSettings(next);
      if (edit.action === 'service' || edit.action === 'remove') {
        setForm({ enabled: false, credential: '' });
        focus.current = back === 'catalog' ? `[data-search-preset="${edit.id}"]` : '.web-search-title';
        setView(back);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '';
      const code = message.match(/web-search:([\w-]+)/)?.[1];
      if (edit.action === 'order' && orderList.current) beforeMove.current = capturePriorityRows(orderList.current);
      setError(code ?? 'save');
      if (code === 'stale') {
        try { setSettings(await bridge.webSearchSettings()); } catch { /* Keep the current draft. */ }
      }
    } finally {
      if (edit.action === 'order') setPendingOrder(undefined);
      setSaving(false);
    }
  }

  function move(from: WebSearchProvider, to: number, before?: ReturnType<typeof capturePriorityRows>) {
    if (!settings || saving) return;
    const order = [...settings.order], source = order.indexOf(from);
    if (source < 0 || source === to || to < 0 || to >= order.length) return;
    order.splice(source, 1); order.splice(to, 0, from);
    beforeMove.current = before ?? (orderList.current ? capturePriorityRows(orderList.current) : undefined);
    setPendingOrder(order);
    void save({ action: 'order', order });
  }

  const errors: Record<string, string> = {
    load: t('无法读取搜索设置。', 'Could not load search settings.'),
    save: t('无法保存搜索设置，请稍后重试。', 'Could not save search settings. Try again shortly.'),
    stale: t('搜索设置已更新，请确认后重试。', 'Search settings changed. Review and try again.'),
    busy: t('桌面端正在处理其他操作，请稍后重试。', 'Desktop is busy. Try again shortly.'),
    'invalid-instance': t('请输入不含账号、参数或片段的 HTTP(S) 实例地址。', 'Enter an HTTP(S) instance URL without credentials, query, or fragment.'),
    'invalid-credential': t('请输入有效的凭据。', 'Enter a valid credential.'),
    'invalid-service': t('此搜索服务当前不可配置。', 'This search service is not configurable right now.'),
  };
  if (!settings) return <p role={error ? 'alert' : 'status'}>{error ? errors.load : t('加载中…', 'Loading…')}</p>;
  const { enabled, fallback } = settings;
  const order = visibleOrder ?? settings.order;
  const inactive = settings.configured.filter(provider => !order.includes(provider));
  const orderLabel = t('搜索顺序', 'Search order');
  const catalogLabel = t('添加搜索服务', 'Add search service');
  const joinLabel = t('加入搜索顺序', 'Include in search order');
  const fallbackLabel = t('失败时尝试下一家', 'Try the next service on failure');
  const title = id ? name(id) : view === 'catalog' ? catalogLabel : orderLabel;
  return <section className="web-search-settings" ref={scope} onKeyDown={event => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || view === 'order') return;
    event.stopPropagation();
    if (confirm) setConfirm(undefined); else open(id ? back : 'order');
  }}>
    <nav className="provider-list web-search-rail" aria-label={t('搜索服务', 'Search services')}>
      <button type="button" className={view === 'order' ? 'selected' : ''} aria-current={view === 'order' ? 'page' : undefined}
        disabled={saving} onClick={() => open('order')}><ListOrdered size={16}/><span>{orderLabel}</span><b>{enabled ? order.length : 0}</b></button>
      <h4>{t('已配置', 'Configured')}</h4>
      {[...order, ...inactive].map(provider => {
        const rank = order.indexOf(provider) + 1;
        return <button type="button" key={provider} data-search-rail={provider} className={view === provider ? 'selected' : ''}
          aria-current={view === provider ? 'page' : undefined} disabled={saving} onClick={() => open(provider)}>
          <Brand id={provider}/><span>{name(provider)}</span>{rank && enabled
            ? <b aria-label={t(`优先级 ${rank}`, `Priority ${rank}`)}>{rank}</b> : <small>{t('停用', 'Off')}</small>}
        </button>;
      })}
      <button type="button" className={view === 'catalog' ? 'selected' : ''} aria-current={view === 'catalog' ? 'page' : undefined}
        disabled={saving} onClick={() => open('catalog')}><Plus size={16}/><span>{catalogLabel}</span></button>
    </nav>
    <div className="web-search-pane" key={view} aria-busy={saving}>
      <div className="provider-preset-heading">
        {view !== 'order' && <IconButton label={t('返回', 'Back')} disabled={saving} onClick={() => open(id ? back : 'order')}><ArrowLeft size={16}/></IconButton>}
        {id && <Brand id={id} size={22}/>}
        <h3 tabIndex={-1} className="web-search-title">{title}</h3>
      </div>
      {view === 'catalog' ? <>
        <h4 className="provider-preset-section-label">{t('常用搜索服务', 'Popular search services')}</h4>
        <div className="provider-preset-grid">{webSearchIds.map(provider => <button key={provider} type="button"
          className="provider-preset-tile" data-search-preset={provider} onClick={() => open(provider)}>
          <Brand id={provider} size={28}/><span className="provider-preset-label"><strong>{name(provider)}</strong><small>{note(provider)}</small></span>
          <DisclosureChevron/>
        </button>)}</div>
      </> : view === 'order' ? <>
        <div className="web-search-policy">
          <div className="web-search-policy-row"><strong>{t('联网搜索', 'Web search')}</strong><Toggle label={t('联网搜索', 'Web search')}
            checked={enabled} disabled={saving} onClick={() => void save({ action: 'policy', field: 'enabled', value: !enabled })}/></div>
          <div className="web-search-policy-row"><div><strong>{fallbackLabel}</strong>
            <small>{t('超时、限流或额度不足时，查询可能发送给下一家已启用服务。', 'A timeout, rate limit, or exhausted quota may send the query to the next enabled service.')}</small></div>
            <Toggle label={fallbackLabel} checked={fallback} disabled={saving || !enabled}
              onClick={() => void save({ action: 'policy', field: 'fallback', value: !fallback })}/></div>
        </div>
        <h4 className="provider-preset-section-label">{t('优先级', 'Priority')}</h4>
        {order.length ? <ol className="web-search-order" ref={orderList} aria-label={t('启用的搜索服务', 'Enabled search services')}>
          {order.map((provider, rank) => <li key={provider} className="web-search-order-row" data-order={provider}>
            <span className="web-search-grip" data-order-grip aria-disabled={saving || order.length < 2}
              title={t('拖动调整优先级', 'Drag to reorder')}><GripVertical size={15} aria-hidden="true"/></span>
            <b>{rank + 1}</b><Brand id={provider}/><div className="web-search-row-name"><strong>{name(provider)}</strong>
              <small>{rank === 0 && enabled ? `${t('首选', 'Primary')} · ` : ''}{note(provider)}</small></div>
            <div className="web-search-row-actions">
              <IconButton label={t(`上移 ${name(provider)}`, `Move ${name(provider)} up`)} aria-disabled={saving || rank === 0}
                onClick={() => move(provider, rank - 1)}><ArrowUp size={14}/></IconButton>
              <IconButton label={t(`下移 ${name(provider)}`, `Move ${name(provider)} down`)} aria-disabled={saving || rank === order.length - 1}
                onClick={() => move(provider, rank + 1)}><ArrowDown size={14}/></IconButton>
              <IconButton label={t(`配置 ${name(provider)}`, `Configure ${name(provider)}`)} disabled={saving} onClick={() => open(provider)}><Settings2 size={14}/></IconButton>
            </div>
          </li>)}
        </ol> : <p className="web-search-empty">{t('没有启用的搜索服务', 'No search services enabled')}</p>}
        {inactive.length > 0 && <><h4 className="provider-preset-section-label">{t('已停用', 'Disabled')}</h4>
          {inactive.map(provider => <div key={provider} className="web-search-order-row">
            <Brand id={provider}/><div className="web-search-row-name"><strong>{name(provider)}</strong></div>
            <IconButton label={t(`配置 ${name(provider)}`, `Configure ${name(provider)}`)} disabled={saving} onClick={() => open(provider)}><Settings2 size={14}/></IconButton>
          </div>)}</>}
      </> : id && <form className="web-search-form" onSubmit={event => {
        event.preventDefault();
        void save({ action: 'service', id, enabled: form.enabled, credential: form.credential.trim() || undefined });
      }}>
        {id === 'step' ? <div className="web-search-policy-row"><strong>{note(id)}</strong><small>
          {configured ? t('使用当前账户凭据', 'Use current account credentials') : t('未登录阶跃账号', 'Not signed in to Step')}</small>
          {!configured && <button type="button" onClick={onAccount}>{t('前往账户设置', 'Open account settings')}</button>}</div>
          : <label>{id === 'searxng' ? t('实例地址', 'Instance URL') : 'API Key'}
            <input type={id === 'searxng' ? 'url' : 'password'} autoComplete="off" spellCheck={false} maxLength={2048}
              disabled={saving} value={form.credential} onChange={event => setForm({ ...form, credential: event.target.value })}
              placeholder={id === 'searxng' ? 'https://search.example.org' : configured ? t('已保存，留空不变', 'Saved; leave blank to keep') : undefined}/>
          </label>}
        <div className="web-search-policy-row"><strong>{joinLabel}</strong>
          <Toggle label={joinLabel} checked={form.enabled} disabled={saving || id === 'step' && !configured}
            onClick={() => setForm({ ...form, enabled: !form.enabled })}/></div>
        <div className="web-search-form-actions">
          <button type="submit" className="primary" disabled={saving || !dirty || id === 'step' && !configured}><Save size={15}/>{t('保存', 'Save')}</button>
          <button type="button" disabled={saving} onClick={() => open(back)}>{t('取消', 'Cancel')}</button>
          {configured && id !== 'step' && <IconButton label={t('移除服务', 'Remove service')} disabled={saving}
            onClick={() => setConfirm('remove')}><Trash2 size={16}/></IconButton>}
        </div>
      </form>}
      {confirm && <div className="provider-confirm" role="group" aria-label={t('确认更改', 'Confirm change')}>
        <span>{confirm === 'remove' ? t('移除此服务及其凭据？', 'Remove this service and its credentials?')
          : t('放弃未保存的更改？', 'Discard unsaved changes?')}</span>
        <button type="button" onClick={() => confirm === 'remove'
          ? id && id !== 'step' && void save({ action: 'remove', id }) : open(confirm, true)}>
          {confirm === 'remove' ? t('移除', 'Remove') : t('放弃', 'Discard')}</button>
        <button type="button" onClick={() => setConfirm(undefined)}>{t('继续编辑', 'Keep editing')}</button>
      </div>}
      {error && <p className="provider-error" role="alert">{errors[error] ?? errors.save}</p>}
    </div>
  </section>;
}
