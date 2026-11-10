import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image, RefreshCw, Send, Square } from 'lucide-react';
import type { DesktopBridge, Preferences } from '../../src/contracts';
import { StellarWorkspace } from '../../src/StellarWorkspace';
import { ThemePackCard } from '../../src/ThemePackCard';
import { applyTheme, registerPluginThemes } from '../../src/theme';
import { resolveThemeBackground, type StellarScene, type ThemeImage, type ThemePack } from '../../src/theme-packs';
import '../../src/style.css';
import '../../src/theme.css';
import './theme-composition.css';

const coverUrl = new URL('../../../theme-marketplace/plugins/stellar-cruise/cover.png', import.meta.url).href;
const iconUrl = new URL('../../../theme-marketplace/plugins/stellar-cruise/icon.png', import.meta.url).href;
const sceneUrl = new URL('../../../theme-marketplace/plugins/stellar-cruise/scene.json', import.meta.url).href;
const metadata = await fetch(new URL('../../../theme-marketplace/plugins/stellar-cruise/dfsc.theme.json', import.meta.url)).then(response => response.json());
async function resource(url: string): Promise<ThemeImage> {
  const blob = await fetch(url).then(response => response.blob());
  const bitmap = await createImageBitmap(blob);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const result = { dataUrl, width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return result;
}
const images = await Promise.all([resource(coverUrl), resource(iconUrl)]);
const definitions = [
  ['legacy', '旧版星辰', 'stellar-v1', undefined],
  ['composable', '可组合星辰', 'stellar-v1', { ui: 'stellar-v1', background: { renderer: 'stellar-v1', source: 'scene.json' }, accepts: ['image-v1'] }],
  ['image', '标准图片', 'image-v1', { ui: 'standard-v1', background: { renderer: 'image-v1', source: 'background.png' }, accepts: [] }],
  ['stellar-image', '星辰图片', 'image-v1', { ui: 'stellar-v1', background: { renderer: 'image-v1', source: 'background.png' }, accepts: ['image-v1'] }],
  ['solid', '星辰纯色', 'solid-v1', { ui: 'stellar-v1', background: { renderer: 'solid-v1' }, accepts: [] }],
] as const;
type Mode = typeof definitions[number][0];
function theme(mode: Mode, revision: number): ThemePack {
  const [, name, renderer, composition] = definitions.find(item => item[0] === mode)!;
  const id = `plugin:composition-${mode}` as const;
  return {
    id, name, version: '1.0.0', revision: `fixture-${revision}`, author: 'DFSC Fixture', renderer, hasCover: true,
    composition: composition ? { ui: composition.ui, background: { ...composition.background }, accepts: [...composition.accepts] } : undefined,
    palette: { ...metadata.colors, id, scheme: 'dark', group: 'plugin', name: [name, name], title: [name, name], mood: ['', ''] },
  };
}
registerPluginThemes(definitions.map(([mode]) => theme(mode, 0)));
let currentImage = images[0], resourceIndex = 0, deferImageLoads = false, requestSerial = 0;
const pending = new Map<number, { image: ThemeImage; resolve(image: ThemeImage): void }>();
const counters = { imageLoads: 0, sceneLoads: 0, posterLoads: 0 };
let scene: Promise<StellarScene> | undefined;
const bridge = {
  themeScene: async () => {
    counters.sceneLoads++;
    return scene ??= fetch(sceneUrl).then(response => response.json());
  },
  themePoster: async () => { counters.posterLoads++; return currentImage.dataUrl; },
  themeImage: async () => {
    counters.imageLoads++;
    const image = currentImage;
    if (!deferImageLoads) return image;
    return new Promise<ThemeImage>(resolve => pending.set(++requestSerial, { image, resolve }));
  },
} as unknown as DesktopBridge;

declare global {
  interface Window {
    compositionFixture: {
      counters: typeof counters;
      deferImageLoads(value: boolean): void;
      pendingLoads(): { id: number; image: ThemeImage }[];
      resolveLoad(id: number): void;
      breakImage(): void;
    };
  }
}

function Fixture() {
  const [mode, setMode] = useState<Mode>('legacy');
  const [revision, setRevision] = useState(0);
  const [override, setOverride] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [preferences, setPreferences] = useState<Preferences>({
    theme: theme('legacy', 0).id, language: 'zh', workspaces: [], themeMotion: true, themeBrightness: 90,
  });
  const pack = theme(mode, revision);
  const activePreferences = { ...preferences, theme: pack.id };
  const resolved = resolveThemeBackground(pack, override ? 'image-v1' : undefined);
  useLayoutEffect(() => { applyTheme(pack.id, true); }, [pack.id]);
  window.compositionFixture = {
    counters,
    deferImageLoads(value) { deferImageLoads = value; },
    pendingLoads: () => [...pending].map(([id, entry]) => ({ id, image: entry.image })),
    resolveLoad(id) {
      const entry = pending.get(id);
      if (!entry) throw new Error('Unknown fixture request');
      pending.delete(id); entry.resolve(entry.image);
    },
    breakImage() {
      currentImage = { dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 };
      setRevision(value => value + 1);
    },
  };
  const update = () => {
    resourceIndex = 1 - resourceIndex;
    currentImage = images[resourceIndex];
    setRevision(value => value + 1);
  };
  return <div className="app composition-fixture" data-mode={mode} data-revision={revision} data-mounted={mounted}>
    {mounted && <StellarWorkspace pack={pack} preferences={activePreferences} bridge={bridge} reading
      paused={paused} override={override ? images[0] : undefined}/>}
    <header className="fixture-toolbar">
      <strong>Desktop for Step Code</strong>
      <div role="tablist" aria-label="主题样例">
        {definitions.map(([value, name]) => <button key={value} type="button" role="tab" aria-selected={mode === value}
          onClick={() => setMode(value)}>{name}</button>)}
      </div>
      <div className="fixture-tools">
        <label><input type="checkbox" checked={override} onChange={event => setOverride(event.target.checked)}/>替换背景</label>
        <label><input type="checkbox" checked={paused} onChange={event => setPaused(event.target.checked)}/>暂停</label>
        <button type="button" aria-label="更新图片" title="更新图片" onClick={update}><RefreshCw size={16}/></button>
        <button type="button" aria-label={mounted ? '移除工作区' : '恢复工作区'} title={mounted ? '移除工作区' : '恢复工作区'}
          onClick={() => setMounted(value => !value)}><Square size={16}/></button>
      </div>
    </header>
    <div className="fixture-body">
      <aside className="sidebar fixture-sidebar">
        <div className="section-label">项目</div>
        <div className="workspace-heading">Desktop for Step Code</div>
        <div className="session-row selected"><button type="button"><span>发布前检查</span></button></div>
        <div className="session-row"><button type="button"><span>界面整理</span></button></div>
        <div className="session-row"><button type="button"><span>周末计划</span></button></div>
      </aside>
      <main className="main-content fixture-main">
        <section className="conversation">
          <div className="messages">
            <article className="message user"><div className="message-label">你</div><div className="message-body">
              整理一下发布前的检查项，先保留现有工作区。
            </div></article>
            <article className="message"><div className="message-label">Step</div><div className="message-body">
              <h2>发布前检查</h2>
              <p>已核对本地配置和资源清单。接下来检查窗口缩放、输入框焦点和恢复行为。</p>
              <pre><code>{'const release = {\n  platform: "Windows",\n  channel: "preview"\n};'}</code></pre>
              <p>现有会话与草稿保持不变。</p>
            </div></article>
          </div>
        </section>
        <div className="composer-wrap">
          <div className="composer">
            <textarea id="fixture-input" aria-label="消息" defaultValue="继续检查窄窗口布局"/>
            <div className="composer-tools"><button type="button" className="icon-button fixture-anchor-button" aria-label="附加图片"><Image size={17}/></button>
              <span className="spacer"/><button type="button" className="send-button" aria-label="发送"><Send size={16}/></button></div>
          </div>
        </div>
      </main>
      <aside className="fixture-settings" aria-label="主题设置">
        <h2>外观</h2>
        <ThemePackCard pack={pack} preferences={activePreferences} zh onSelect={() => {}}
          onChange={patch => setPreferences(value => ({ ...value, ...patch }))}
          loadScene={bridge.themeScene} loadPoster={bridge.themePoster}/>
        <output className="fixture-resolution" aria-label="背景状态" data-blocked={resolved.blocked}>
          {resolved.blocked ? '当前主题不接受替换' : resolved.renderer}
        </output>
      </aside>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
