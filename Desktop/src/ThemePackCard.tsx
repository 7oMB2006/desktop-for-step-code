import { Check, ImageOff, Play, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Preferences } from './contracts';
import type { StellarScene, ThemePack } from './theme-packs';
import { ThemeWelcome } from './ThemeWelcome';
import './theme-pack-card.css';

export type PackPreferences = Pick<Preferences, 'theme' | 'accentColor' | 'themeMotion' | 'themeBrightness'>;
export function ThemePackCard({ pack, preferences, zh, onSelect, onChange, loadScene, loadPoster }: {
  pack: ThemePack; preferences: PackPreferences; zh: boolean; onSelect(): void;
  onChange(patch: Partial<PackPreferences>): void;
  loadScene?: (id: string) => Promise<StellarScene>;
  loadPoster?: (id: string) => Promise<string | undefined>;
}) {
  const selected = preferences.theme === pack.id;
  const [poster, setPoster] = useState<string>();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState(1);
  const art = useRef<HTMLSpanElement>(null);
  const controls = `theme-pack-controls-${pack.id}`;
  useEffect(() => {
    let cancelled = false;
    setPoster(undefined);
    void loadPoster?.(pack.id).then(value => { if (!cancelled) setPoster(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pack.id, loadPoster]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 960));
    if (art.current) observer.observe(art.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer); setPlaying(false);
      if ((hovered || focused) && preferences.themeMotion !== false && !reduced.matches && !document.hidden)
        timer = setTimeout(() => setPlaying(true), 180);
    };
    update();
    reduced.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer); reduced.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [hovered, focused, preferences.themeMotion]);
  return <article className={`theme-pack${selected ? ' is-selected' : ''}`}>
    <button className="theme-pack-select" type="button" aria-label={pack.name} aria-pressed={selected}
      aria-expanded={selected} aria-controls={controls} onClick={onSelect}
      onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }}
      onPointerLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <span className="theme-pack-art" ref={art} aria-hidden="true">
        {poster ? <img src={poster} alt="" onError={() => setPoster(undefined)}/> : <ImageOff size={24}/>}
        {playing && loadScene && <span className="theme-pack-motion" style={{ transform: `scale(${scale})` }}>
          <ThemeWelcome id={pack.id} load={loadScene} motion={true} brightness={preferences.themeBrightness} preview/>
        </span>}
        <span className="theme-pack-play"><Play size={11} fill="currentColor"/></span>
      </span>
      <span className="theme-pack-info">
        <span className="theme-pack-name">{pack.name}</span>
        <span className="theme-pack-byline">{pack.author ?? (zh ? '作者未注明' : 'Author unspecified')}<span>v{pack.version}</span></span>
        <span className="theme-pack-swatches" aria-hidden="true">
          {[pack.palette.bg, pack.palette.surface, pack.palette.accent, pack.palette.ink].map((color, index) =>
            <i key={index} style={{ background: color }}/>)}
        </span>
        <span className="theme-pack-status">{selected ? <Check size={14}/> : <Play size={13}/>}
          {selected ? (zh ? '使用中' : 'Active') : (zh ? '启用主题' : 'Use theme')}</span>
      </span>
    </button>
    <div id={controls} className="theme-pack-disclosure" inert={!selected} aria-hidden={!selected}>
      <div><div className="theme-pack-controls">
        <label className="theme-pack-toggle">
          <span>{zh ? '动态背景' : 'Motion'}</span>
          <input type="checkbox" aria-label={zh ? '星海动态背景' : 'Animate stellar background'}
            checked={preferences.themeMotion !== false} onChange={e => onChange({ themeMotion: e.target.checked })}/>
        </label>
        <label className="theme-pack-brightness">
          <span><Sun size={15}/>{zh ? '亮度' : 'Brightness'}</span>
          <input type="range" aria-label={zh ? '背景亮度' : 'Background brightness'} min={40} max={120} step={5}
            value={preferences.themeBrightness ?? 90} onChange={e => onChange({ themeBrightness: Number(e.target.value) })}/>
          <output>{preferences.themeBrightness ?? 90}%</output>
        </label>
      </div></div>
    </div>
  </article>;
}
