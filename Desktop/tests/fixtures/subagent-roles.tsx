import { createRoot } from 'react-dom/client';
import { PanelTop, Settings, SunMoon } from 'lucide-react';
import { AgentRoleIcon, AgentRoleLabel } from '../../src/AgentRole';
import { SubagentRoleSettings } from '../../src/SubagentRoleSettings';
import { applyTheme } from '../../src/theme';
import type { DesktopBridge, Model } from '../../src/contracts';
import type { SubagentRoleModels } from '../../src/subagent-role-models';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/appearance.css';
import '../../src/settings-dialog.css';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const dark = params.get('theme') !== 'light';
document.documentElement.lang = language;
applyTheme(dark ? 'original-dark' : 'original-light', false);
const t = (zh: string, en: string) => language === 'zh' ? zh : en;
const models: Model[] = [
  { provider: 'fixture-step', providerName: 'Step', id: 'step-flash', name: 'Step Flash', reasoning: true, thinkingLevels: ['off', 'low', 'medium'] },
  { provider: 'fixture-team', providerName: t('团队供应商', 'Team provider'), id: 'review-pro', name: 'Review Pro', reasoning: true, thinkingLevels: ['medium', 'high', 'max'] },
  { provider: 'fixture-local', providerName: t('本地供应商', 'Local provider'), id: 'local-fast', name: 'Local Fast', reasoning: false },
];
let values: SubagentRoleModels = {
  explore: { provider: 'fixture-step', id: 'step-flash', effort: 'low' },
  review: { provider: 'fixture-team', id: 'review-pro', effort: 'high' },
  ...(params.has('unavailable') ? { planner: { provider: 'retired', id: 'old-planner', effort: 'high' } } : {}),
};
const bridge: Pick<DesktopBridge, 'subagentRoleSettings' | 'saveSubagentRole'> = {
  subagentRoleSettings: async () => ({ available: true, values: { ...values } }),
  saveSubagentRole: async (role, model) => {
    values = { ...values };
    if (model) values[role] = model;
    else delete values[role];
    return { ...values };
  },
};

function RoleIconGallery() {
  const roles = ['general', 'explore', 'review', 'planner', 'implement', 'test'];
  return <section className="role-icon-gallery" aria-labelledby="role-icon-gallery-title">
    <h3 id="role-icon-gallery-title">{t('子代理角色图标', 'Subagent role icons')}</h3>
    <ul aria-label={t('角色图标组', 'Role icon set')}>
      {roles.map(role => <li key={role}><AgentRoleLabel agent={role} language={language}/></li>)}
    </ul>
    <h4>{t('兜底图标', 'Fallback icons')}</h4>
    <ul aria-label={t('兜底图标', 'Fallback icons')}>
      <li><AgentRoleLabel agent="custom" language={language}/></li>
      <li><span className="agent-role-label"><AgentRoleIcon language={language}/><span>{t('未提供角色', 'Role not reported')}</span></span></li>
    </ul>
  </section>;
}

createRoot(document.querySelector('#root')!).render(
  <div className="modal-backdrop settings-backdrop">
    <section className="settings-dialog" aria-label={t('设置预览', 'Settings preview')}>
      <header><h2><Settings size={16}/> {t('设置 · 示例数据', 'Settings · Sample data')}</h2></header>
      <div className="settings-layout">
        <nav aria-label={t('设置分类', 'Settings categories')}>
          <button className="selected" aria-current="page"><SunMoon size={17}/>{t('通用', 'General')}</button>
          <button onClick={() => applyTheme(dark ? 'original-light' : 'original-dark', false)}><PanelTop size={17}/>{t('另一套主题', 'Other theme')}</button>
        </nav>
        <div className="settings-content">
          <RoleIconGallery/>
          <SubagentRoleSettings bridge={bridge} language={language} models={models}/>
        </div>
      </div>
    </section>
  </div>,
);
