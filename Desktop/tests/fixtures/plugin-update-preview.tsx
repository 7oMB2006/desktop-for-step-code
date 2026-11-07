import { useEffect, useRef, useState } from 'react';
import { Languages, Moon, RotateCcw, Sun } from 'lucide-react';
import type { CapabilityCatalog } from '../../src/capabilities';
import type { PluginUpdateState, PluginUpdatesPresentation } from '../../src/PluginUpdatePresentation';
import { ScheduledTaskSelect } from '../../src/ScheduledTasks';
import { applyTheme } from '../../src/theme';
import bvrUpdateLogo from './plugin-center-assets/bvr-update.png?inline';

const bvrId = 'bilibili-video-research';
const initialUpdates = (): Record<string, PluginUpdateState> => ({
  [bvrId]: { phase: 'available', version: '0.1.1', summary: '更换插件图标，修正外侧白边；研究能力与配置方式保持不变。' },
  playwright: { phase: 'current', version: '1.0.0' },
  'fixture-long-name': { phase: 'unavailable', version: '0.1.0', error: '此安装没有已确认的市场来源，不会自动选择同名插件覆盖。' },
});
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function usePluginUpdatePreview({ readCatalog, replaceCatalog, onRestart, language }: {
  readCatalog(): CapabilityCatalog; replaceCatalog(value: CapabilityCatalog): void; onRestart(): Promise<void>; language: string;
}) {
  const initial = useRef<CapabilityCatalog | undefined>(undefined);
  if (!initial.current) initial.current = structuredClone(readCatalog());
  const [items, setItems] = useState(initialUpdates);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState('success');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0), working = useRef(false), failed = useRef(false), attempts = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const onUpdate = async (id: string) => {
    const state = items[id];
    if (working.current || !state || !['available', 'failed'].includes(state.phase)) return false;
    working.current = true; attempts.current++;
    const run = generation.current;
    const stage = (phase: PluginUpdateState['phase'], progress: number) =>
      setItems(current => ({ ...current, [id]: { ...state, phase, progress, error: undefined } }));
    try {
      stage('downloading', 12);
      await pause(550); if (run !== generation.current) return false;
      stage('downloading', 48);
      await pause(600); if (run !== generation.current) return false;
      stage('verifying', 76);
      await pause(700); if (run !== generation.current) return false;
      if (result === 'failure' && !failed.current) {
        failed.current = true;
        setItems(current => ({ ...current, [id]: { ...state, phase: 'failed',
          error: '资源校验未通过，已保留原来的 v0.1.0，配置与服务开关未改变。' } }));
        return false;
      }
      stage('applying', 93);
      await pause(650); if (run !== generation.current) return false;
      const next = structuredClone(readCatalog());
      const plugin = next.plugins.find(plugin => plugin.id === id);
      if (!plugin) return false;
      plugin.version = state.version;
      if (id === bvrId) plugin.icon = { kind: 'png', dataUrl: bvrUpdateLogo };
      replaceCatalog(next);
      setItems(current => ({ ...current, [id]: { ...state, phase: 'updated', progress: 100, restartRequired: true } }));
      return true;
    } finally { if (run === generation.current) working.current = false; }
  };
  const restart = async () => {
    await onRestart();
    setItems(current => Object.fromEntries(Object.entries(current).map(([id, state]) =>
      [id, state.phase === 'updated' ? { ...state, restartRequired: false } : state])));
  };
  const reset = () => {
    generation.current++; working.current = false; failed.current = false; attempts.current = 0;
    replaceCatalog(structuredClone(initial.current!));
    setItems(initialUpdates()); setChecking(false); setRevision(value => value + 1);
  };
  const displayedItems = Object.fromEntries(Object.entries(items).map(([id, state]) => [id, {
    ...state,
    ...(id === bvrId ? {
      summary: language === 'zh' ? '更换插件图标，修正外侧白边；研究能力与配置方式保持不变。'
        : 'New plugin artwork with transparent outer edges. Research capabilities and configuration are unchanged.',
      error: state.phase === 'failed' ? language === 'zh' ? '资源校验未通过，已保留原来的 v0.1.0，配置与服务开关未改变。'
        : 'File verification failed. Version 0.1.0, configuration and service switches were kept.' : undefined,
    } : {}),
    ...(state.phase === 'unavailable' ? { error: language === 'zh' ? '此安装没有已确认的市场来源，不会自动选择同名插件覆盖。'
      : 'The installation source is unconfirmed. A same-name package will not replace it automatically.' } : {}),
  }]));
  const updates: PluginUpdatesPresentation = {
    items: displayedItems, checking, onUpdate,
    onCheck: async () => {
      if (working.current || checking) return;
      const run = generation.current;
      setChecking(true);
      await pause(700);
      if (run === generation.current) setChecking(false);
    },
  };
  Object.assign(window, { pluginUpdateTest: {
    snapshot: () => structuredClone({ items: displayedItems, checking, attempts: attempts.current }),
    reset,
    result: (value: string) => { failed.current = false; setResult(value); },
  } });
  return { updates, restart, reset, result, setResult, revision, working: working.current || checking };
}

export function PluginUpdatePreviewControls({ language, onLanguage, preview }: {
  language: 'zh' | 'en'; onLanguage(value: 'zh' | 'en'): void; preview: ReturnType<typeof usePluginUpdatePreview>;
}) {
  const [dark, setDark] = useState(false);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  return <div className="pc-update-preview-controls">
    <ScheduledTaskSelect label={t('更新结果', 'Update result')} value={preview.result}
      options={[{ id: 'success', label: t('更新成功', 'Success') }, { id: 'failure', label: t('首次失败', 'Fail once') }]}
      onChange={value => { preview.setResult(value); preview.reset(); }}/>
    <button className="icon-button" type="button" aria-label={t('重置更新预览', 'Reset update preview')} onClick={preview.reset}><RotateCcw size={15}/></button>
    <button className="icon-button" type="button" aria-label={t('切换明暗主题', 'Toggle light and dark')} onClick={() => {
      setDark(!dark); applyTheme(dark ? 'light' : 'dark', false);
    }}>{dark ? <Sun size={15}/> : <Moon size={15}/>}</button>
    <button className="icon-button" type="button" aria-label={t('切换为英文', 'Switch to Chinese')}
      onClick={() => onLanguage(language === 'zh' ? 'en' : 'zh')}><Languages size={15}/></button>
  </div>;
}
