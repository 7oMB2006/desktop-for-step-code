import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Settings, X } from 'lucide-react';
import { NewSession } from '../../src/NewSession';
import { ThemeSettings } from '../../src/ThemeSettings';
import { ThemeWelcome } from '../../src/ThemeWelcome';
import { applyTheme, registerPluginThemes } from '../../src/theme';
import type { Preferences } from '../../src/contracts';
import type { ThemePack } from '../../src/theme-packs';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './theme-pack.css';

const pack = await fetch(new URL('../../../theme-marketplace/plugins/stellar-cruise/dfsc.theme.json', import.meta.url)).then(r => r.json());
const theme: ThemePack = { id: 'plugin:stellar-cruise', name: pack.name, author: pack.author, hasCover: true, version: '0.1.0', renderer: pack.renderer,
  palette: { ...pack.colors, id: 'plugin:stellar-cruise', group: 'plugin', scheme: pack.scheme,
    name: [pack.name, pack.name], title: [pack.name, pack.name], mood: ['', ''] } };
registerPluginThemes([theme]);
const load = () => fetch(new URL('../../../theme-marketplace/plugins/stellar-cruise/scene.json', import.meta.url)).then(r => r.json());
const loadPoster = async () => new URL('../../../theme-marketplace/plugins/stellar-cruise/cover.png', import.meta.url).href;
const lifecycleTest = new URLSearchParams(location.search).get('lifecycle') === '1';
function Preview() {
  const [preferences, setPreferences] = useState<Preferences>({ theme: theme.id, language: 'zh', workspaces: [], themeMotion: true });
  const [settings, setSettings] = useState(false);
  const [conversation, setConversation] = useState(false);
  useEffect(() => { applyTheme(preferences.theme, true, preferences.accentColor); }, [preferences]);
  const welcome = <NewSession language="zh" workspaces={[]} title={p => p} disabled={false} composing={false}
    onSelect={() => {}} onOpenProject={() => {}} onSettings={() => setSettings(true)} onOpenChange={() => {}}/>;
  return <div className="theme-preview">
    <header><span>Desktop for Step Code</span><button aria-label="外观设置" onClick={() => setSettings(true)}><Settings size={18}/></button></header>
    <main>{lifecycleTest && conversation ? <div className="theme-preview-message">让想法阶跃星辰。</div> : preferences.theme.startsWith('plugin:')
      ? <ThemeWelcome id={preferences.theme} motion={preferences.themeMotion !== false} brightness={preferences.themeBrightness} load={load}>{welcome}</ThemeWelcome> : welcome}</main>
    {lifecycleTest && <footer><button onClick={() => setConversation(v => !v)}>{conversation ? '新建会话' : '进入会话'}</button></footer>}
    {settings && <div className="theme-preview-backdrop"><section role="dialog" aria-label="外观">
      <header><h2>外观</h2><button aria-label="关闭" onClick={() => setSettings(false)}><X size={18}/></button></header>
      <ThemeSettings preferences={preferences} systemDark={true} language="zh" packs={[theme]} loadScene={load} loadPoster={loadPoster}
        onChange={patch => setPreferences(p => ({ ...p, ...patch }))}/>
    </section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
