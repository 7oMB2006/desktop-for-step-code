import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StellarWorkspace } from '../../src/StellarWorkspace';
import { ConversationMessages } from '../../src/ConversationMessages';
import { ComposerInput } from '../../src/ComposerInput';
import { SummaryBoard } from '../../src/SummaryBoard';
import { DEFAULT_BACKGROUND_OPTIONS, type CustomBackgroundState, type BackgroundOptions } from '../../src/custom-background';
import type { DesktopBridge, Preferences, Message } from '../../src/contracts';
import type { ThemeImage, ThemePack } from '../../src/theme-packs';
import { applyTheme, themes } from '../../src/theme';
import '../../src/style.css';
import '../../src/theme.css';
import '../../src/layout.css';
import './custom-background-rendering.css';

const urls = ['cover.png', 'icon.png'].map(name => new URL(`../../../theme-marketplace/plugins/stellar-cruise/${name}`, import.meta.url).href);
const images = await Promise.all(urls.map(async url => {
  const blob = await fetch(url).then(response => response.blob()), bitmap = await createImageBitmap(blob);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
  });
  const image = { dataUrl, width: bitmap.width, height: bitmap.height }; bitmap.close(); return image;
}));
const resources = new Map<string, ThemeImage>([['initial', images[0]]]);
const pending = new Map<string, { image: ThemeImage; resolve(value: ThemeImage): void }>();
let deferred = false, loads = 0;
const sceneUrl = new URL('../../../theme-marketplace/plugins/stellar-cruise/scene.json', import.meta.url).href;
const scene = await fetch(sceneUrl).then(response => response.json());
const bridge = {
  themeScene: async () => scene, themePoster: async () => images[0].dataUrl, themeImage: async () => images[0],
  customBackgroundImage: async (revision: string) => {
    loads++;
    const image = resources.get(revision);
    if (!image) throw new Error('custom-background:missing');
    return deferred ? new Promise<ThemeImage>(resolve => pending.set(revision, { image, resolve })) : image;
  },
} as unknown as DesktopBridge;
type Mode = 'builtin' | 'closed' | 'open' | 'standard';
const theme = (mode: Mode): ThemePack | undefined => mode === 'builtin' ? undefined : {
  id: `plugin:fixture-${mode}`, name: mode, version: '1.0.0', renderer: 'stellar-v1',
  palette: { ...themes.find(palette => palette.id === 'dark')!, id: `plugin:fixture-${mode}`, group: 'plugin' },
  ...(['open', 'standard'].includes(mode) ? { composition: { ui: mode === 'standard' ? 'standard-v1' : 'stellar-v1',
    background: { renderer: 'stellar-v1', source: 'scene.json' }, accepts: ['image-v1'] } } : {}),
};
const messages = [
  { role: 'user', content: '整理一下发布前检查，保留现有工作区。' },
  { role: 'assistant', content: [{ type: 'text', text: '## 发布前检查\n\n现有会话与草稿保持不变。\n\n```ts\nconst release = { platform: "Windows", channel: "preview" };\n```\n\n接下来核对窗口布局与输入框。' }] },
] as Message[];
function Fixture() {
  const [mode, setMode] = useState<Mode>('builtin'), [mounted, setMounted] = useState(true);
  const [paused, setPaused] = useState(false), [motion, setMotion] = useState(true), [clicks, setClicks] = useState(0);
  const [draft, setDraft] = useState('继续检查窗口布局');
  const [state, setState] = useState<CustomBackgroundState>({
    available: true, options: { ...DEFAULT_BACKGROUND_OPTIONS, enabled: true },
    image: { revision: 'initial', width: images[0].width, height: images[0].height },
  });
  const preferences: Preferences = { language: 'zh', theme: mode === 'builtin' ? 'light' : `plugin:fixture-${mode}`,
    workspaces: [], themeBrightness: 40, themeMotion: motion };
  window.backgroundRenderingFixture = {
    options: patch => setState(value => ({ ...value, options: { ...value.options, ...patch } })),
    state: () => structuredClone(state), mode: setMode, mount: setMounted, paused: setPaused, motion: setMotion,
    resource: (revision, index = 0) => {
      resources.set(revision, images[index]);
      setState(value => ({ ...value, image: { revision, width: images[index].width, height: images[index].height } }));
    },
    broken: () => {
      resources.set('broken', { dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 });
      setState(value => ({ ...value, image: { revision: 'broken', width: 1, height: 1 } }));
    },
    missing: () => setState(value => ({ ...value, image: { revision: 'missing', width: 1, height: 1 } })),
    issue: issue => setState(value => ({ ...value, issue })),
    defer: value => { deferred = value; }, pending: () => [...pending.keys()],
    resolve: revision => { const request = pending.get(revision); if (!request) throw new Error('Unknown request'); pending.delete(revision); request.resolve(request.image); },
    loads: () => loads,
  };
  return <div className="app background-rendering-fixture">
    {mounted && <StellarWorkspace bridge={bridge} pack={theme(mode)} preferences={preferences} reading paused={paused} customBackground={state}/>}
    <header>Desktop for Step Code</header>
    <div className="background-rendering-body">
      <aside className="sidebar"><h3>项目</h3><div className="session-row selected"><button type="button"><span>发布前检查</span></button></div>
        <div className="session-row"><button type="button"><span>界面整理</span></button></div></aside>
      <main className="main-content">
        <div className="conversation-shell"><section className="conversation"><div className="messages background-rendering-document">
          <ConversationMessages messages={messages} language="zh" busy={false} canEdit={false} openImage={() => {}}
            edit={async () => {}} onError={() => {}} branch={() => {}} onOpenSubagent={() => {}}/>
        </div></section></div>
        <div className="composer-wrap"><div className="composer">
          <ComposerInput label="消息" placeholder="你想做什么？" language="zh" value={draft} disabled={false}
            onChange={setDraft} onPaste={() => {}} onKeyDown={() => {}}/>
          <div className="composer-tools"><button type="button" onClick={() => setClicks(value => value + 1)}>继续检查</button>
            <output aria-label="点击次数">{clicks}</output></div>
        </div></div>
      </main>
      <aside className="summary-board"><SummaryBoard language="zh" onOpenChanges={() => {}} messages={messages}/></aside>
    </div>
    <dialog className="pc-dialog background-rendering-dialog"><h2>确认操作</h2><button type="button">取消</button></dialog>
  </div>;
}
declare global {
  interface Window {
    backgroundRenderingFixture: {
      options(patch: Partial<BackgroundOptions>): void; state(): CustomBackgroundState; mode(value: Mode): void;
      mount(value: boolean): void; paused(value: boolean): void; motion(value: boolean): void;
      resource(revision: string, index?: number): void; broken(): void; missing(): void;
      issue(value: CustomBackgroundState['issue']): void;
      defer(value: boolean): void; pending(): string[]; resolve(revision: string): void; loads(): number;
    };
  }
}
applyTheme('light', false);
createRoot(document.getElementById('root')!).render(<Fixture/>);
