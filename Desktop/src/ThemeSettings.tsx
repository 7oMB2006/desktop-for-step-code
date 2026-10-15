import { Check, Monitor, Palette, RotateCcw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { HexColorPicker } from 'react-colorful';
import type { Preferences } from './contracts';
import { applyTheme, contrastRatio, normalizeAccent, resolveTheme, themes, type ThemePreference } from './theme';
import './theme-settings.css';

type ColorPreferences = Pick<Preferences, 'theme' | 'accentColor'>;
const accents = [
  ['#b62e5d', '玫红', 'Rose'], ['#c46535', '橙', 'Orange'], ['#bd921e', '金', 'Gold'],
  ['#338366', '绿', 'Green'], ['#21849a', '青', 'Cyan'], ['#487bd1', '蓝', 'Blue'],
  ['#9168d3', '紫', 'Violet'],
] as const;

function AccentEditor({ preferences, systemDark, onChange, onClose, zh, active }: {
  preferences: ColorPreferences; systemDark: boolean; zh: boolean; active: boolean;
  onChange: (patch: Partial<ColorPreferences>) => void; onClose: () => void;
}) {
  const [color, setColor] = useState(resolveTheme(preferences.theme, systemDark, preferences.accentColor).accent);
  const [hex, setHex] = useState(color);
  const saved = useRef({ preferences, systemDark });
  saved.current = { preferences, systemDark };
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    applyTheme(preferences.theme, systemDark, active ? color : preferences.accentColor);
  }, [preferences.theme, preferences.accentColor, systemDark, color, active]);
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    return () => {
      const { preferences: latest, systemDark: dark } = saved.current;
      applyTheme(latest.theme, dark, latest.accentColor);
    };
  }, []);
  const valid = normalizeAccent(hex);
  return <div className="accent-editor" role="group" aria-label={zh ? '自定义强调色' : 'Custom accent color'}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <HexColorPicker color={color} onChange={value => { setColor(value); setHex(value); }}/>
    <div className="accent-editor-controls">
      <label htmlFor="accent-hex">HEX</label>
      <div className="accent-hex-field">
        <span aria-hidden="true" style={{ background: color }}/>
        <input ref={input} id="accent-hex" value={hex} maxLength={7} spellCheck={false} autoComplete="off"
          aria-invalid={!valid} onChange={event => {
            setHex(event.target.value);
            const value = normalizeAccent(event.target.value);
            if (value) setColor(value);
          }}/>
      </div>
      <div className="accent-editor-actions">
        <button type="button" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button>
        <button type="button" className="primary" disabled={!valid} onClick={() => { onChange({ accentColor: valid }); onClose(); }}>
          <Check size={14}/>{zh ? '应用' : 'Apply'}
        </button>
      </div>
    </div>
  </div>;
}

export function ThemeSettings({ preferences, systemDark, onChange, language }: {
  preferences: ColorPreferences; systemDark: boolean; language: 'zh' | 'en';
  onChange: (patch: Partial<ColorPreferences>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [editorPresent, setEditorPresent] = useState(false);
  useEffect(() => {
    if (editing) { setEditorPresent(true); return; }
    const timer = setTimeout(() => setEditorPresent(false), 220);
    return () => clearTimeout(timer);
  }, [editing]);
  const customTrigger = useRef<HTMLButtonElement>(null);
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const chosen = normalizeAccent(preferences.accentColor);
  const changeTheme = (theme: ThemePreference) => { setEditing(false); onChange({ theme }); };
  const closeEditor = () => { setEditing(false); customTrigger.current?.focus({ preventScroll: true }); };
  return <section className="theme-settings" aria-label={t('主题与强调色', 'Theme and accent')}>
    <div className="theme-heading"><h3>{t('主题', 'Theme')}</h3>
      <div className="theme-heading-controls">
      {themes.filter(theme => theme.group === 'original').map(theme =>
        <button key={theme.id} className="theme-original" type="button" aria-label={t(...theme.name)}
          data-tooltip={t(...theme.name)} aria-pressed={preferences.theme === theme.id}
          onClick={() => changeTheme(theme.id)} style={{ '--original-bg': theme.bg, '--original-ink': theme.ink, '--original-border': theme.border } as CSSProperties}>
          <Check size={13} aria-hidden="true"/>
        </button>)}
      <button className="theme-system" type="button" aria-pressed={preferences.theme === 'system'} onClick={() => changeTheme('system')}>
        <Monitor size={15}/>{t('跟随系统', 'System')} {preferences.theme === 'system' && <Check size={13}/>}
      </button>
      </div>
    </div>
    {(['classic', 'color'] as const).map(group => <fieldset className="theme-group" key={group}>
      <legend>{group === 'classic' ? t('经典系 · 光与影', 'Classic · Light and Shadow') : t('色彩系 · 山海之间', 'Color · Between Mountains and Seas')}</legend>
      <div className="theme-grid">
        {themes.filter(theme => theme.group === group).map(theme => {
          const preview = resolveTheme(theme.id, systemDark, preferences.accentColor);
          return <button type="button" className="theme-tile" key={theme.id} aria-pressed={preferences.theme === theme.id}
            aria-label={t(...theme.name)} aria-describedby={`theme-title-${theme.id}`} onClick={() => changeTheme(theme.id)} style={{ ...preview.tokens, '--theme-corner': theme.accent } as CSSProperties}>
            <span className="theme-miniature" aria-hidden="true">
              <span className="theme-mini-sidebar"><i/><i/><i/></span>
              <span className="theme-mini-chat"><i/><i/><i/><span><b/></span></span>
            </span>
            <span className="theme-tile-label"><span><span id={`theme-title-${theme.id}`} className="theme-tile-title">{t(...theme.title)}</span>
              <span className="theme-tile-caption">{t(...theme.name)} · {t(...theme.mood)}</span></span><Check size={14}/></span>
          </button>;
        })}
      </div>
    </fieldset>)}
    <div className="accent-heading"><h4>{t('强调色', 'Accent color')}</h4>
      <button type="button" className="icon-button" aria-label={t('恢复主题强调色', 'Reset theme accent')}
        data-tooltip={t('恢复主题强调色', 'Reset theme accent')} disabled={!chosen && !editing}
        onClick={() => { setEditing(false); onChange({ accentColor: null }); }}><RotateCcw size={15}/></button>
    </div>
    <div className="accent-swatches">
      {accents.map(([color, cn, en]) => <button key={color} type="button" className="accent-swatch"
        aria-label={t(`${cn}强调色`, `${en} accent`)} data-tooltip={t(cn, en)} aria-pressed={chosen === color}
        style={{ '--swatch': color, '--swatch-ink': contrastRatio(color, '#ffffff') > contrastRatio(color, '#000000') ? '#fff' : '#000' } as CSSProperties}
        onClick={() => { setEditing(false); onChange({ accentColor: color }); }}><Check size={14}/></button>)}
      <button ref={customTrigger} type="button" className="accent-custom" aria-expanded={editing} aria-controls="accent-editor-region"
        aria-label={t('自定义强调色', 'Custom accent color')} data-tooltip={t('自定义强调色', 'Custom accent color')}
        onClick={() => {
          if (!editing) setEditorRevision(value => value + 1);
          setEditing(value => !value);
        }}><Palette size={17}/></button>
      <span className="accent-value">{chosen?.toUpperCase() ?? t('主题默认', 'Theme default')}</span>
    </div>
    <div id="accent-editor-region" className={`accent-disclosure${editing ? ' is-open' : ''}`}>
      <div inert={!editing} aria-hidden={!editing}>{editorPresent && <AccentEditor key={`${preferences.theme}:${editorRevision}`} preferences={preferences} systemDark={systemDark}
        active={editing} zh={zh} onChange={onChange} onClose={closeEditor}/>}</div>
    </div>
  </section>;
}
