import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import { AppMenu } from './AppMenu';
import { DisclosureChevron } from './DisclosureChevron';
import { CapabilityDisclosure, capabilityErrorText } from './CapabilitySettings';
import type { DesktopBridge } from './contracts';
import type { PluginConfiguration, PluginConfigurationField, PluginConfigurationInput, PluginPackage } from './capabilities';

type Bridge = Pick<DesktopBridge, 'pluginConfiguration' | 'pluginSaveConfiguration' | 'pluginChoosePath'>;
function EnumField({ field, value, disabled, onChange }: {
  field: PluginConfigurationField; value: string; disabled: boolean; onChange(value: string): void;
}) {
  const anchor = useRef<HTMLButtonElement>(null), [open, setOpen] = useState(false);
  return <span className="scheduled-select"><button type="button" ref={anchor} disabled={disabled} aria-label={field.label}
    aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
    {field.options?.find(item => item.value === value)?.label ?? field.label}<DisclosureChevron/></button>
    <AppMenu anchor={anchor} open={open} label={field.label} selected={value} items={(field.options ?? []).map(item => ({ id: item.value, label: item.label }))}
      onSelect={onChange} onClose={() => setOpen(false)} maxVisibleItems={8}/></span>;
}
function editable(value: PluginConfiguration): PluginConfigurationInput {
  return { ref: value.ref, revision: value.revision, values: { ...value.values },
    secrets: Object.fromEntries(value.schema.groups.flatMap(group => group.fields)
      .filter(field => field.type === 'secret').map(field => [field.id, { action: 'keep' as const }])) };
}
export function PluginConfigurationForm({ bridge, pkg, language, busy, visible, formId, onState, onSaved }: {
  bridge: Bridge; pkg: PluginPackage; language: string; busy: boolean; visible: boolean; formId: string;
  onState(value: { dirty: boolean; pending: boolean; ready: boolean }): void; onSaved(): Promise<void>;
}) {
  const [saved, setSaved] = useState<PluginConfiguration>(), [draft, setDraft] = useState<PluginConfigurationInput>();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [reloadReview, setReloadReview] = useState(false);
  const operation = useRef(false), alive = useRef(true), callback = useRef(onState);
  callback.current = onState;
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const dirty = Boolean(saved && draft && (!saved.configured || JSON.stringify(draft) !== JSON.stringify(editable(saved))));
  const locked = busy || pending;
  const read = async () => {
    if (operation.current) return;
    operation.current = true; setPending(true); setError('');
    try {
      const result = await bridge.pluginConfiguration({ ref: pkg.ref });
      if (alive.current) { setSaved(result); setDraft(editable(result)); setReloadReview(false); }
    } catch (error) { if (alive.current) setError(capabilityErrorText(error, language === 'zh')); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (visible && !saved && !error) void read(); }, [visible, saved, pkg.ref]);
  useEffect(() => { callback.current({ dirty, pending, ready: Boolean(saved) }); }, [dirty, pending, saved]);
  const submit = async () => {
    if (!draft || operation.current || locked) return;
    operation.current = true; setPending(true); setError('');
    try {
      const value = await bridge.pluginSaveConfiguration(draft);
      if (alive.current) { setSaved(value); setDraft(editable(value)); }
      await onSaved();
    } catch (error) { if (alive.current) setError(capabilityErrorText(error, language === 'zh')); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const update = (field: PluginConfigurationField, value: string | number | boolean) => setDraft(previous =>
    previous && ({ ...previous, values: { ...previous.values, [field.id]: value } }));
  const choosePath = async (field: PluginConfigurationField) => {
    if (locked || operation.current) return;
    operation.current = true; setPending(true); setError('');
    try {
      const path = await bridge.pluginChoosePath({ ref: pkg.ref, field: field.id });
      if (path !== null && alive.current) update(field, path);
    } catch (error) { if (alive.current) setError(capabilityErrorText(error, language === 'zh')); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const field = (field: PluginConfigurationField) => {
    if (!draft || !saved) return null;
    const value = draft.values[field.id], secret = draft.secrets[field.id];
    return <div className="pc-field" key={field.id}>
      {field.type === 'boolean' ? <label className="pc-checkbox"><input type="checkbox" checked={value === true}
        onChange={event => update(field, event.target.checked)}/>{field.label}</label>
        : field.type === 'enum' ? <div><span className="pc-generic-label">{field.label}</span>
          <EnumField field={field} value={String(value ?? '')} disabled={locked} onChange={value => update(field, value)}/></div>
          : <label>{field.label}<span className={['secret', 'path'].includes(field.type) ? 'pc-path' : undefined}>
            <input type={field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text'}
              value={field.type === 'secret' ? secret?.action === 'replace' ? secret.value ?? '' : '' : String(value ?? '')}
              autoComplete="off" spellCheck={false} min={field.min} max={field.max} maxLength={field.maxLength}
              required={field.required && !(field.type === 'secret' && saved.hasSecret[field.id] && secret?.action === 'keep')}
              placeholder={field.type === 'secret' && saved.hasSecret[field.id] ? t('已保存，留空保留', 'Saved; leave blank to keep') : undefined}
              onChange={event => field.type === 'secret' ? setDraft(previous => previous && ({ ...previous,
                secrets: { ...previous.secrets, [field.id]: event.target.value ? { action: 'replace', value: event.target.value } : { action: 'keep' } },
              })) : update(field, field.type === 'number' && event.target.value ? Number(event.target.value) : event.target.value)}/>
            {field.type === 'path' && <button type="button" className="icon-button" aria-label={t(`选择${field.label}`, `Choose ${field.label}`)}
              onClick={() => void choosePath(field)}><FolderOpen size={14}/></button>}
            {field.type === 'secret' && <button type="button" className="icon-button" aria-label={t(`删除${field.label}`, `Delete ${field.label}`)}
              aria-pressed={secret?.action === 'delete'} onClick={() => setDraft(previous => previous && ({ ...previous,
                secrets: { ...previous.secrets, [field.id]: { action: secret?.action === 'delete' ? 'keep' : 'delete' } },
              }))}><Trash2 size={14}/></button>}</span></label>}
      {field.help && <p className="pc-hint">{field.help}</p>}
      {secret?.action === 'delete' && <p className="pc-hint">{t('保存后删除', 'Deleted on save')}</p>}
    </div>;
  };
  return <form id={formId} className="pc-generic-form" hidden={!visible} onSubmit={event => { event.preventDefault(); void submit(); }}>
    {error && <div className="cap-error" role="alert">{error}
      {saved && !reloadReview && <button type="button" disabled={pending} onClick={() => setReloadReview(true)}>{t('重新载入配置', 'Reload configuration')}</button>}
      {reloadReview && <div className="pc-reload-review"><p>{t('丢弃当前草稿并重新载入已保存配置？', 'Discard this draft and reload saved settings?')}</p>
        <button type="button" disabled={pending} onClick={() => setReloadReview(false)}>{t('取消', 'Cancel')}</button>
        <button type="button" disabled={pending} onClick={() => void read()}>{t('丢弃并载入', 'Discard and reload')}</button></div>}
    </div>}
    {!draft || !saved ? <button type="button" disabled={pending} onClick={() => void read()}>{pending ? t('读取中', 'Loading') : t('重试', 'Retry')}</button>
      : <fieldset disabled={locked} className="pc-form-fields">{saved.schema.groups.map((group, index) =>
        index === 0 ? <section className="pc-form-section" key={group.id}><h3>{group.title}</h3><div className="pc-generic-fields">{group.fields.map(field)}</div></section>
          : <CapabilityDisclosure key={group.id} className="pc-form-section" label={group.title}>
            <div className="pc-generic-fields">{group.fields.map(field)}</div></CapabilityDisclosure>)}</fieldset>}
  </form>;
}
