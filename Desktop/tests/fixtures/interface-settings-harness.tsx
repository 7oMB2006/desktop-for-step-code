import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Pencil, SlidersHorizontal } from 'lucide-react';
import { AppearanceSettings } from '../../src/AppearanceSettings';
import { InterfaceSettings } from '../../src/InterfaceSettings';
import { AppTooltip } from '../../src/AppTooltip';
import { applyAppearance, defaultAppearance, type Appearance } from '../../src/appearance';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/appearance.css';
import '../../src/settings-dialog.css';
import { normalizeInterfaceSettings, selectInterfacePreset, type InterfacePreferences } from '../../src/interface-presets';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
function Harness() {
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  const [preferences, setPreferences] = useState<InterfacePreferences>(() => {
    try { return normalizeInterfaceSettings(JSON.parse(localStorage.getItem('interface-fixture') ?? 'null')); }
    catch { return selectInterfacePreset('standard'); }
  });
  const [tab, setTab] = useState<'complexity' | 'appearance'>('complexity');
  return <div className="modal-backdrop settings-backdrop"><section className="settings-dialog" role="dialog" aria-label={language === 'zh' ? '设置' : 'Settings'}>
    <header><h2>{language === 'zh' ? '设置' : 'Settings'}</h2></header>
    <div className="settings-layout">
      <nav aria-label={language === 'zh' ? '设置分类' : 'Settings categories'}>
        <button className={tab === 'complexity' ? 'selected' : ''} aria-current={tab === 'complexity' ? 'page' : undefined} onClick={() => setTab('complexity')}><SlidersHorizontal size={17}/>{language === 'zh' ? '界面复杂度' : 'Interface complexity'}</button>
        <button className={tab === 'appearance' ? 'selected' : ''} aria-current={tab === 'appearance' ? 'page' : undefined} onClick={() => setTab('appearance')}><Pencil size={17}/>{language === 'zh' ? '外观' : 'Appearance'}</button>
      </nav>
      <div className="settings-content" key={tab}>{tab === 'complexity' ? <InterfaceSettings language={language} value={preferences} onChange={value => { setPreferences(value); localStorage.setItem('interface-fixture', JSON.stringify(value)); }}/> : <AppearanceSettings value={appearance} language={language} onChange={patch => setAppearance(current => { const next = { ...current, ...patch }; applyAppearance(next); return next; })}/>}</div>
    </div>
  </section><AppTooltip/></div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
