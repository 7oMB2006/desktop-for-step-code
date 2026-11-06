import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Moon, Pencil, Settings, SlidersHorizontal, Sun, SunMoon, X } from 'lucide-react';
import { AppearanceSettings } from '../../src/AppearanceSettings';
import { InterfaceSettings } from '../../src/InterfaceSettings';
import { AppTooltip } from '../../src/AppTooltip';
import { DisclosureChevron } from '../../src/DisclosureChevron';
import { CompactionSettings } from '../../src/CompactionSettings';
import { defaultCompactionConfiguration, validateCompactionUpdate, type CompactionSettings as SettingsValue } from '../../src/compaction-settings';
import { applyAppearance, defaultAppearance, type Appearance } from '../../src/appearance';
import { selectInterfacePreset } from '../../src/interface-presets';
import { applyTheme } from '../../src/theme';
import type { DesktopBridge, Model } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/appearance.css';
import '../../src/settings-dialog.css';
import './compaction-settings-preview.css';

const params = new URLSearchParams(location.search);
const initialLanguage = params.get('lang') === 'en' ? 'en' : 'zh';
const initialDark = params.get('theme') === 'dark';
applyTheme(initialDark ? 'original-dark' : 'original-light', false);
const models: Model[] = ['step-5-preview', 'step-4'].map(id => ({ provider: 'step', id, name: id }));
let sequence = 0;
let readCount = 0;
let saveCount = 0;
let stored: SettingsValue = { ...defaultCompactionConfiguration(), revision: String(sequence).padStart(64, '0'),
  policy: params.has('legacy') ? 'legacy' : 'v2', enabled: !params.has('disabled'), invalidConfiguration: false };
const pause = () => new Promise(resolve => setTimeout(resolve, Number(params.get('delay') ?? 120)));
const bridge: Pick<DesktopBridge, 'compactionSettings' | 'saveCompactionSettings'> = {
  compactionSettings: async () => {
    await pause(); readCount++;
    if (params.has('readError') && readCount === 1) throw new Error('fixture read error');
    return structuredClone(stored);
  },
  saveCompactionSettings: async input => {
    await pause(); saveCount++;
    const update = validateCompactionUpdate(input);
    if (params.has('saveError') && saveCount === 1) throw new Error('fixture save error');
    if (params.has('conflict') && saveCount === 1) {
      stored = { ...stored, triggerRatio: .75, revision: String(++sequence).padStart(64, '0') };
      throw new Error('compaction:conflict');
    }
    if (update.revision !== stored.revision) throw new Error('compaction:conflict');
    stored = { ...stored, ...update.configuration, revision: String(++sequence).padStart(64, '0'),
      policy: update.useRatioPolicy ? 'v2' : stored.policy };
    return structuredClone(stored);
  },
};

function Harness() {
  const [language, setLanguage] = useState<'zh' | 'en'>(initialLanguage);
  const [dark, setDark] = useState(initialDark);
  const [tab, setTab] = useState<'general' | 'interface' | 'appearance'>('general');
  const [open, setOpen] = useState(true);
  const [closing, setClosing] = useState(false);
  const [sort, setSort] = useState('manual');
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  const [complexity, setComplexity] = useState(() => selectInterfacePreset('standard'));
  const dialog = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const close = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setOpen(false); return; }
    setClosing(true);
  };
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; }, [language]);
  useEffect(() => {
    if (!open) { launcher.current?.focus(); return; }
    dialog.current?.querySelector<HTMLElement>('button[aria-current="page"]')?.focus();
  }, [open]);
  return <>
    <main className="compaction-preview-launcher" inert={open}>
      <img src="/StepCode.svg" alt="Step Code" width={40} height={40}/>
      <button ref={launcher} onClick={() => { setClosing(false); setOpen(true); }}><Settings size={16}/>{t('设置', 'Settings')}</button>
    </main>
    {open && <div className={`modal-backdrop settings-backdrop${closing ? ' is-closing' : ''}`}
      onAnimationEnd={event => {
        if (event.target === event.currentTarget && event.animationName === 'settings-backdrop-exit') setOpen(false);
      }}>
      <section ref={dialog} className="settings-dialog" inert={closing} role="dialog" aria-modal="true" aria-label={t('设置', 'Settings')}
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); }
          if (event.key !== 'Tab') return;
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, summary, textarea')]
            .filter(element => !element.closest('[inert]') && !element.matches(':disabled') && element.getClientRects().length);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <header><h2>{t('设置', 'Settings')}</h2><div className="compaction-preview-actions">
          <button className="icon-button" aria-label={t('切换明暗主题', 'Toggle color scheme')} data-tooltip={t('切换明暗主题', 'Toggle color scheme')}
            onClick={() => { setDark(!dark); applyTheme(dark ? 'original-light' : 'original-dark', false); }}>
            {dark ? <Sun size={17}/> : <Moon size={17}/>}
          </button>
          <button className="icon-button" aria-label={t('关闭设置', 'Close settings')} onClick={close}><X size={19}/></button>
        </div></header>
        <div className="settings-layout">
          <nav aria-label={t('设置分类', 'Settings categories')}>
            {([
              ['general', SunMoon, t('通用', 'General')],
              ['interface', SlidersHorizontal, t('界面复杂度', 'Interface complexity')],
              ['appearance', Pencil, t('外观', 'Appearance')],
            ] as const).map(([id, Icon, label]) => <button key={id} className={tab === id ? 'selected' : ''}
              aria-label={label} aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}><Icon size={17}/>{label}</button>)}
          </nav>
          <div className="settings-content" key={tab}>
            {tab === 'general' ? <div className="compaction-general">
              <section><h3>{t('左栏', 'Sidebar')}</h3>
                <label className="appearance-row"><span>{t('会话排序', 'Session order')}</span>
                  <span className="appearance-select"><select aria-label={t('会话排序', 'Session order')} value={sort} onChange={event => setSort(event.target.value)}>
                    <option value="manual">{t('固定顺序', 'Manual order')}</option><option value="updated">{t('最新在前', 'Recently updated first')}</option>
                  </select><DisclosureChevron/></span>
                </label>
              </section>
              <CompactionSettings bridge={bridge} language={language} models={models} model={models[0]}/>
              <section><h3>{t('语言', 'Language')}</h3>
                <label className="appearance-row"><span>{t('语言', 'Language')}</span>
                  <span className="appearance-select"><select aria-label={t('语言', 'Language')} value={language} onChange={event => setLanguage(event.target.value as 'zh' | 'en')}>
                    <option value="zh">简体中文</option><option value="en">English</option>
                  </select><DisclosureChevron/></span>
                </label>
              </section>
            </div> : tab === 'interface'
              ? <InterfaceSettings language={language} value={complexity} onChange={setComplexity}/>
              : <AppearanceSettings language={language} value={appearance} onChange={patch => setAppearance(current => {
                const next = { ...current, ...patch }; applyAppearance(next); return next;
              })}/>}
          </div>
        </div>
      </section>
    </div>}
    <AppTooltip/>
  </>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
