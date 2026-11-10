import { createRoot } from 'react-dom/client';
import { PluginWindowApp } from '../../src/PluginWindowApp';
import type { DesktopBridge, PluginWindowSnapshot, RuntimeEvent } from '../../src/contracts';
import type { PluginDocument } from '../../src/capabilities';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';

const subscribers = new Set<(event: RuntimeEvent) => void>();
const state = {
  requests: [] as { resolve: (snapshot: PluginWindowSnapshot) => void; reject: (error: Error) => void }[],
  manual: false, unavailable: false, reads: 0, configured: 0, illegal: 0, controls: [] as string[],
  theme: 'system' as PluginWindowSnapshot['preferences']['theme'],
  ref: 'bridge-package',
  emit(type: string, input: Record<string, unknown> = {}) { for (const subscriber of subscribers) subscriber({ type, ...input }); },
  snapshot(title = 'Hermes 工程桥'): PluginWindowSnapshot {
    return {
      plugin: { id: 'bridge', name: 'Hermes 工程桥', version: '0.2.0', mcpServers: [], warnings: [], package: {
        ref: state.ref, provenance: 'recorded', documentation: {}, tutorials: [], links: [], warnings: [],
        desktop: { title, surface: 'window', symbol: 'bot', pages: [
          { id: 'start', title: '开始使用', document: 'docs/start.md' },
          { id: 'setup', title: '连接准备', document: 'docs/setup.md' },
        ] },
      } },
      preferences: { language: 'zh', theme: state.theme },
    };
  },
};
const bridge = {
  platform: 'win32',
  async pluginWindowState() {
    state.reads++;
    if (state.manual) return new Promise<PluginWindowSnapshot>((resolve, reject) => state.requests.push({ resolve, reject }));
    if (state.unavailable) throw new Error('PRIVATE_TOKEN_MUST_NOT_RENDER');
    return state.snapshot();
  },
  async pluginWindowConfigure() { state.configured++; },
  async pluginDocument(input: { ref: string; path: string }): Promise<PluginDocument> {
    return {
      path: input.path,
      text: input.path === 'docs/setup.md' ? '# 连接准备\n\n核对独立身份、目标目录和人工授权。' : '# 开始使用\n\n安装协作资源不会自动获得工程执行权限。\n\n[查看连接准备](setup.md)',
      images: {}, links: { 'setup.md': 'docs/setup.md' },
    };
  },
  onEvent(callback: (event: RuntimeEvent) => void) { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
  async windowControl(action: string) { state.controls.push(action); return { maximized: false, fullscreen: false, focused: true }; },
  async snapshot() { state.illegal++; throw new Error('Conversation API forbidden'); },
  async command() { state.illegal++; throw new Error('Conversation API forbidden'); },
};
Object.assign(window, { desktop: bridge as unknown as DesktopBridge, pluginWindowFixture: state });
createRoot(document.getElementById('root')!).render(<PluginWindowApp bridge={bridge}/>);
