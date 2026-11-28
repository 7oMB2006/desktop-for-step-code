import { useEffect, useState, type ReactNode } from 'react';
import { Save } from 'lucide-react';
import type { DesktopBridge, Model } from './contracts';
import { AgentRoleIcon } from './AgentRole';
import { DisclosureSelect } from './DisclosureSelect';
import { subagentModelLevels, subagentRoles, type SubagentRole, type SubagentRoleModel, type SubagentRoleSettings } from './subagent-role-models';
import './subagent-role-settings.css';

const names = { general: ['通用', 'General'], explore: ['探路', 'Explore'], review: ['审查', 'Review'], planner: ['规划', 'Planner'] };
const key = (model: Pick<Model, 'provider' | 'id'>) => JSON.stringify([model.provider, model.id]);

export function SubagentModelSection({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return <div className="subagent-definition-model">
    <h4>{title}</h4>
    <div className="subagent-definition-model-fields">{children}</div>
    {footer && <div className="subagent-definition-footer">{footer}</div>}
  </div>;
}

export function LegacySubagentRoleSettings(props: Parameters<typeof SubagentRoleSettings>[0] & {
  bridge: Pick<DesktopBridge, 'subagentRoleSettings' | 'saveSubagentRole' | 'subagentDefinitions'>;
}) {
  const [legacy, setLegacy] = useState(false);
  useEffect(() => {
    let active = true;
    void props.bridge.subagentDefinitions().then(result => { if (active) setLegacy(!result.available); },
      () => { if (active) setLegacy(true); });
    return () => { active = false; };
  }, [props.bridge]);
  return legacy ? <SubagentRoleSettings {...props}/> : null;
}

export function SubagentRoleSettings({ bridge, language, models }: {
  bridge: Pick<DesktopBridge, 'subagentRoleSettings' | 'saveSubagentRole'>;
  language: 'zh' | 'en';
  models: Model[];
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [settings, setSettings] = useState<SubagentRoleSettings>();
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void bridge.subagentRoleSettings().then(value => { if (active) setSettings(value); },
      () => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [bridge, attempt]);
  const eligible = models.filter(model => subagentModelLevels(model).length);
  return <section className="subagent-role-settings" data-settings-anchor="subagent-models">
    <h3>{t('子代理模型', 'Subagent models')}</h3>
    {loadError ? <div role="alert">{t('无法读取角色配置。', 'Could not read role settings.')} <button onClick={() => { setLoadError(false); setAttempt(n => n + 1); }}>{t('重试', 'Retry')}</button></div>
      : !settings ? <p role="status">{t('加载中…', 'Loading…')}</p>
        : !settings.available ? <p>{t('当前 Step Code 运行时不支持角色配置。', 'This Step Code runtime does not support role settings.')}</p>
          : <>
            <p className="subagent-role-scope">{t('仅用于新发起的普通委派。Workflow 和已启动的子代理不受影响。', 'Applies to new standard delegations. Workflows and existing subagents are unaffected.')}</p>
            {subagentRoles.map(role => <RoleRow key={role} role={role} language={language} models={eligible} saved={settings.values[role]}
              onSave={async value => { const result = await bridge.saveSubagentRole(role, value); setSettings(current => current && ({ ...current, values: result })); }}/>)}
          </>}
  </section>;
}

export function RoleRow({ role, language, models, saved, onSave, detail }: {
  role: SubagentRole;
  language: 'zh' | 'en';
  models: Model[];
  saved?: SubagentRoleModel;
  onSave: (value: SubagentRoleModel | null) => Promise<void>;
  detail?: boolean;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const name = names[role][language === 'zh' ? 0 : 1];
  const [pending, setDraft] = useState<SubagentRoleModel | null>();
  const draft = pending === undefined ? saved ?? null : pending;
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'saved' | 'error'>();
  const selected = draft && models.find(model => key(model) === key(draft));
  const levels = selected ? subagentModelLevels(selected) : [];
  const invalid = Boolean(draft && !levels.includes(draft.effort));
  const changed = JSON.stringify(draft) !== JSON.stringify(saved ?? null);
  const fields = <>
    <label>{t('模型', 'Model')}<DisclosureSelect aria-label={`${name} ${t('模型', 'model')}`} value={draft ? key(draft) : ''} aria-disabled={busy || undefined} onChange={event => {
      if (busy) return;
      setState(undefined);
      const model = models.find(item => key(item) === event.target.value);
      setDraft(model ? { provider: model.provider, id: model.id, effort: subagentModelLevels(model)[0] } : null);
    }}>
      <option value="">{t('继承主会话', 'Inherit conversation')}</option>
      {draft && !selected && <option value={key(draft)}>{draft.id} ({t('不可用', 'unavailable')})</option>}
      {models.map(model => <option key={key(model)} value={key(model)}>{model.name} · {model.providerName ?? model.provider}</option>)}
    </DisclosureSelect></label>
    <label>{t('思考强度', 'Thinking effort')}<DisclosureSelect aria-label={`${name} ${t('思考强度', 'thinking effort')}`} value={draft?.effort ?? ''} disabled={!selected} aria-disabled={busy || !selected || undefined} onChange={event => {
      if (busy || !draft) return;
      const effort = levels.find(level => level === event.target.value);
      if (effort) { setState(undefined); setDraft({ ...draft, effort }); }
    }}>
      {!draft && <option value="">{t('继承', 'Inherited')}</option>}
      {draft && !levels.includes(draft.effort) && <option value={draft.effort}>{draft.effort}</option>}
      {levels.map(level => <option key={level} value={level}>{level === 'off' ? t('关闭', 'Off') : level[0].toUpperCase() + level.slice(1)}</option>)}
    </DisclosureSelect></label>
  </>;
  const save = <button type="button" aria-label={`${t('保存', 'Save')} ${name}`} aria-disabled={!changed || invalid || busy} onClick={() => {
      if (!changed || invalid || busy) return;
      setBusy(true); setState(undefined);
      void onSave(draft).then(() => { setDraft(undefined); setState('saved'); }, () => setState('error')).finally(() => setBusy(false));
    }}>{detail && <Save size={14}/>}
      {busy ? t('保存中…', 'Saving…') : detail ? t('保存模型设置', 'Save model settings') : t('保存', 'Save')}</button>;
  const result = (invalid || state) && <small className="subagent-role-result" role={invalid || state === 'error' ? 'alert' : 'status'}>{invalid
      ? t('所选模型或档位不可用。', 'The selected model or effort is unavailable.') : state === 'error'
        ? t('保存失败，请检查模型后重试。', 'Save failed. Check the model and retry.') : t('已保存', 'Saved')}</small>;
  if (detail) return <SubagentModelSection title={t('模型设置', 'Model settings')}
    footer={<>{result || <small role="status" className="muted">{changed ? t('未保存', 'Unsaved') : ''}</small>}{save}</>}>
    {fields}
  </SubagentModelSection>;
  return <div className="subagent-role-row">
    <div className="subagent-role-name">
      <span aria-hidden="true"><AgentRoleIcon agent={role} language={language}/></span>
      <div className="subagent-role-name-text"><strong>{name}</strong><small>{role}</small></div>
    </div>
    {fields}{save}{result}
  </div>;
}
