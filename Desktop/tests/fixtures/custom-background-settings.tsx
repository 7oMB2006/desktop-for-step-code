import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginCenter, type PluginCenterBridge } from '../../src/PluginCenter';
import { BackgroundStatus } from '../../src/BackgroundStatus';
import { CustomBackgroundSettings, type CustomBackgroundBridge } from '../../src/CustomBackgroundSettings';
import { DEFAULT_BACKGROUND_OPTIONS, type CustomBackgroundState, type BackgroundOptions } from '../../src/custom-background';
import type { CapabilityCatalog } from '../../src/capabilities';
import type { RuntimeEvent } from '../../src/contracts';
import type { ThemeImage, ThemePack } from '../../src/theme-packs';
import { applyTheme, themes } from '../../src/theme';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './custom-background-settings.css';

const params = new URLSearchParams(location.search);
let state: CustomBackgroundState = { options: { ...DEFAULT_BACKGROUND_OPTIONS }, available: true, ref: 'fixture-background' };
let imageRevision = 0, failure: 'load' | 'save' | 'import' | 'image' | undefined, canceled = false;
let held: Promise<void> | undefined, release: (() => void) | undefined;
let deferredReads = params.has('defer');
const reads: { snapshot: CustomBackgroundState; resolve(value: CustomBackgroundState): void }[] = [];
const pendingStates: boolean[] = [];
const patches: Partial<BackgroundOptions>[] = [];
const events = new Set<(event: RuntimeEvent) => void>();
const counts = { loads: 0, imports: 0, saves: 0, removes: 0, restarts: 0, mutations: 0 };
let statusActions: ('configure' | 'discover')[] = [];
const source = new URL('../../../theme-marketplace/plugins/stellar-cruise/cover.png', import.meta.url).href;
const blob = await fetch(source).then(response => response.blob());
const bitmap = await createImageBitmap(blob);
const dataUrl = await new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
});
const image: ThemeImage = { dataUrl, width: bitmap.width, height: bitmap.height };
bitmap.close();
const catalog: CapabilityCatalog = { plugins: [{
  id: 'custom-background', name: '自定义背景', description: '本机图片背景', version: '0.1.0', mcpServers: [], warnings: [],
  package: { ref: 'fixture-background', provenance: 'recorded', hostConfiguration: 'custom-background-v1',
    author: 'Desktop for Step Code', documentation: {}, tutorials: [], links: [], warnings: [], categories: ['appearance'] },
}], available: [], mcp: [], marketplaces: [], skills: [], warnings: [] };
const broadcast = () => { for (const listener of events) listener({ type: 'desktop_custom_background', state: structuredClone(state) }); };
const bridge = {
  platform: 'win32', capabilityCatalog: async () => structuredClone(catalog),
  capabilityMutate: async () => { counts.mutations++; return { warnings: [] }; },
  pluginRepositoryInfo: async () => ({ status: 'unavailable' }),
  stepPageState: async () => ({ status: 'missing', installed: false }),
  prepareStepPage: async () => ({ status: 'ready', installed: true }),
  summary: async () => ({ sessionId: 'fixture', tasks: [], subagents: [], workflows: [], skillCount: 0, mcp: [], commands: [] }),
  customBackgroundState: async () => {
    counts.loads++;
    if (failure === 'load') { failure = undefined; throw new Error('custom-background:storage'); }
    if (deferredReads) return new Promise<CustomBackgroundState>(resolve => reads.push({ snapshot: structuredClone(state), resolve }));
    return structuredClone(state);
  },
  customBackgroundImage: async () => {
    if (failure === 'image') { failure = undefined; throw new Error('custom-background:missing'); }
    return image;
  },
  customBackgroundImport: async () => {
    counts.imports++;
    if (canceled) { canceled = false; return null; }
    if (failure === 'import') { failure = undefined; throw new Error('custom-background:invalid-image'); }
    state = { ...state, image: { revision: `image-${++imageRevision}`, width: image.width, height: image.height },
      options: { ...state.options, enabled: true }, issue: undefined };
    broadcast(); return structuredClone(state);
  },
  customBackgroundSave: async ({ patch }: { patch: Partial<BackgroundOptions> }) => {
    counts.saves++; patches.push(structuredClone(patch)); await held;
    if (failure === 'save') { failure = undefined; throw new Error('custom-background:storage'); }
    state = { ...state, options: { ...state.options, ...patch } };
    broadcast(); return structuredClone(state);
  },
  customBackgroundRemove: async () => {
    counts.removes++;
    state = { ...state, image: undefined, options: { ...state.options, enabled: false } };
    broadcast(); return structuredClone(state);
  },
  onEvent: (callback: (event: RuntimeEvent) => void) => { events.add(callback); return () => events.delete(callback); },
} as unknown as PluginCenterBridge;
const alternateBridge = { ...bridge };
const theme = (blocked: boolean): ThemePack | undefined => blocked ? {
  id: 'plugin:fixture-legacy', name: 'Legacy theme', version: '1.0.0', renderer: 'stellar-v1',
  palette: { ...themes.find(palette => palette.id === 'dark')!, id: 'plugin:fixture-legacy', name: ['Legacy', 'Legacy'], title: ['Legacy', 'Legacy'], mood: ['', ''], group: 'plugin' },
} : undefined;
function Fixture() {
  const [language, setLanguage] = useState<'zh' | 'en'>(params.get('lang') === 'en' ? 'en' : 'zh');
  const [blocked, setBlocked] = useState(false);
  const [background, setBackground] = useState(state);
  const [packageRef, setPackageRef] = useState('fixture-background'), [alternate, setAlternate] = useState(false);
  useEffect(() => {
    const listener = () => setBackground(structuredClone(state));
    events.add(listener); return () => { events.delete(listener); };
  }, []);
  window.backgroundFixture = {
    state: () => structuredClone(state), counts: () => ({ ...counts }), patches: () => structuredClone(patches),
    fail: value => { failure = value; }, cancelImport: () => { canceled = true; },
    hold: () => { held = new Promise(resolve => { release = resolve; }); },
    release: () => { release?.(); release = undefined; held = undefined; },
    blocked: setBlocked, language: setLanguage,
    theme: value => applyTheme(value, false),
    external: patch => { state = { ...state, options: { ...state.options, ...patch } }; broadcast(); },
    available: value => { state = { ...state, available: value }; broadcast(); },
    personal: () => {
      state = { ...state, image: { revision: 'status-image', width: image.width, height: image.height },
        options: { ...state.options, enabled: true } }; broadcast();
    },
    statusActions: () => [...statusActions],
    packageRef: value => { state = { ...state, ref: value }; setPackageRef(value); },
    bridge: setAlternate, deferReads: value => { deferredReads = value; }, readCount: () => reads.length,
    resolveRead: index => { const request = reads.splice(index, 1)[0]; request?.resolve(request.snapshot); },
    pendingStates: () => [...pendingStates],
  };
  return <div className="app background-settings-fixture">
    <header>Desktop for Step Code</header>
    <main>{params.has('status') ? <div className="background-status-fixture"><BackgroundStatus state={background} pack={theme(blocked)}
      language={language} onConfigure={() => { statusActions.push(background.available ? 'configure' : 'discover'); }}/></div>
      : params.has('lifecycle') ? <CustomBackgroundSettings bridge={(alternate ? alternateBridge : bridge) as unknown as CustomBackgroundBridge}
        packageRef={packageRef} language={language} visible onPending={value => { pendingStates.push(value); }}/>
      : <PluginCenter bridge={bridge} active language={language} busy runtimeId="fixture-runtime" themePack={theme(blocked)}
      customBackgroundRequest={1} onChanged={async () => {}} onRestart={async () => { counts.restarts++; }}
      onManageMcp={() => {}} onBack={() => {}}/>}</main>
  </div>;
}
declare global {
  interface Window {
    backgroundFixture: {
      state(): CustomBackgroundState; counts(): typeof counts; patches(): Partial<BackgroundOptions>[];
      fail(value: typeof failure): void; cancelImport(): void; hold(): void; release(): void;
      blocked(value: boolean): void; language(value: 'zh' | 'en'): void; theme(value: 'light' | 'dark'): void;
      external(patch: Partial<BackgroundOptions>): void;
      available(value: boolean): void; statusActions(): ('configure' | 'discover')[];
      personal(): void;
      packageRef(value: string): void; bridge(value: boolean): void; deferReads(value: boolean): void;
      readCount(): number; resolveRead(index: number): void; pendingStates(): boolean[];
    };
  }
}
applyTheme(params.get('theme') === 'dark' ? 'dark' : 'light', false);
createRoot(document.getElementById('root')!).render(<Fixture/>);
