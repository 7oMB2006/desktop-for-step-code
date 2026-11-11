import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Eye, FlaskConical, Moon, Sun } from 'lucide-react';
import { AppTooltip } from '../../src/AppTooltip';
import { WindowBar } from '../../src/WindowBar';
import { PluginActionGroup } from '../../src/PluginActionGroup';
import { PluginWorkspace } from '../../src/PluginWorkspace';
import { getPluginDesktopEntries } from '../../src/plugin-desktop';
import { applyTheme } from '../../src/theme';
import type { CapabilityCatalog, CapabilityPlugin, PluginConnection, PluginDocument } from '../../src/capabilities';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './hermes-preview.css';

const params = new URLSearchParams(location.search);
const scenarios = [
  ['ready', '已核验 · 三项任务'],
  ['unselected', '首次安装 · 未配置'],
  ['profile-missing', '身份目录不可用'],
  ['configuration-invalid', '连接配置无效'],
  ['no-roots', '已核验 · 待授权目录'],
  ['empty', '已核验 · 暂无任务'],
  ['long', '已核验 · 较多任务'],
  ['companion-missing', '缺少配套组件配置'],
  ['pairing-required', '尚未配对'],
  ['connection-unavailable', '无法连接'],
  ['identity-mismatch', '身份不匹配'],
  ['slow', '慢速查询'],
  ['error', '查询失败'],
] as const;
type Scenario = typeof scenarios[number][0];

async function image(name: string) {
  const response = await fetch(new URL(`./hermes-preview-assets/${name}`, import.meta.url));
  if (!response.ok) throw new Error('Preview image unavailable');
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
const [portrait, light, dark] = await Promise.all([
  image('icon.png'), image('toolbar-light.png'), image('toolbar-dark.png'),
]);
const plugin: CapabilityPlugin = {
  id: 'hermes-preview', name: 'Hermes x DFSC', version: '0.3.0',
  icon: { kind: 'png', dataUrl: portrait },
  mcpServers: [], warnings: [],
  package: {
    ref: 'hermes-preview-resource', provenance: 'recorded', documentation: {}, tutorials: [], links: [], warnings: [],
    desktop: {
      title: 'Hermes x DFSC', surface: 'main-view', connection: { protocol: 'agent-bridge-v1',
        guides: { setup: 'setup', firstTask: 'first-task', troubleshooting: 'troubleshooting' } },
      symbol: 'bot', icon: { light, dark }, defaultPage: 'start',
      pages: [
        { id: 'start', title: '开始使用', document: 'docs/START.md' },
        { id: 'setup', title: '连接准备', document: 'docs/SETUP.md' },
        { id: 'first-task', title: '第一项任务', document: 'docs/FIRST_TASK.md' },
        { id: 'troubleshooting', title: '排查问题', document: 'docs/TROUBLESHOOTING.md' },
      ],
    },
  },
};
const catalog: CapabilityCatalog = {
  plugins: [plugin], available: [], marketplaces: [], mcp: [], skills: [], warnings: [],
};
const entries = getPluginDesktopEntries(catalog);
const documents: Record<string, string> = {};
for (const name of ['START', 'SETUP', 'FIRST_TASK', 'TROUBLESHOOTING']) {
  const response = await fetch(new URL(`./hermes-preview-assets/${name}.md`, import.meta.url));
  if (!response.ok) throw new Error('Preview document unavailable');
  documents[`docs/${name}.md`] = await response.text();
}
function snapshot(scenario: Scenario): PluginConnection {
  const ready = ['ready', 'empty', 'long', 'slow', 'no-roots'].includes(scenario);
  const status = ready || scenario === 'error' ? 'ready' : scenario as PluginConnection['status'];
  const titles = ['核对测试结果与交付清单', '整理插件的安装引导', '检查顶栏入口的窄窗口布局',
    '补充连接异常的中文提示与重试检查记录，保留已有草稿和原始会话',
    '复核授权目录', '整理下一轮验收记录', '检查浅色与深色图标'];
  const phases = ['review', 'running', 'waiting', 'paused', 'completed', 'accepted', 'stopped'];
  return {
    status,
    ...(status === 'unselected' ? {} : {
      profile: 'C:/Hermes/演示身份', agentId: 'hermes-demo', displayName: '工程助手',
    }),
    roots: ready && scenario !== 'no-roots' ? ['D:/演示项目/工程桥'] : [],
    tasks: ready && !['empty', 'no-roots'].includes(scenario) ? titles.slice(0, scenario === 'long' ? 7 : 3).map((title, index) => ({
      id: `demo-${index + 1}`, title, phase: phases[index], cwd: 'D:/演示项目/工程桥',
    })) : [],
    ...(ready ? { checkedAt: Date.now() } : {}),
  };
}
function Preview() {
  const [scenario, setScenario] = useState<Scenario>(() => {
    const requested = params.get('state');
    return scenarios.find(([value]) => value === requested)?.[0] ?? 'ready';
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(params.get('theme') === 'dark' ? 'dark' : 'light');
  const [active, setActive] = useState(params.get('view') === 'workspace');
  const [visited, setVisited] = useState(params.get('view') === 'workspace');
  const chrome = useRef<HTMLDivElement>(null);
  const showStatus = () => {
    const button = chrome.current?.querySelector<HTMLButtonElement>('[data-plugin-action="hermes-preview"]');
    if (button?.getAttribute('aria-expanded') !== 'true') button?.click();
  };
  const bridge = useMemo(() => {
    let current = snapshot(scenario);
    const observe = async () => {
      await new Promise(resolve => setTimeout(resolve, scenario === 'slow' ? 2200 : 180));
      if (scenario === 'error') throw new Error('Simulated preview failure');
      return structuredClone({ ...current, ...(current.status === 'ready' ? { checkedAt: Date.now() } : {}) });
    };
    return {
      pluginConnectionState: observe,
      async pluginConnectionChooseProfile() { current = snapshot('ready'); return observe(); },
      async pluginConnectionForgetProfile() { current = snapshot('unselected'); return observe(); },
      async pluginDocument(input: { ref: string; path: string }): Promise<PluginDocument> {
        const text = documents[input.path];
        if (!text) throw new Error('Preview document unavailable');
        return {
          path: input.path, text, images: {},
          links: Object.fromEntries(Object.keys(documents).map(path => [path.slice(5), path])),
        };
      },
    };
  }, [scenario]);
  useEffect(() => { applyTheme(theme, false); }, [theme]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('state', scenario);
    url.searchParams.set('theme', theme);
    history.replaceState(null, '', url);
    if (active) return;
    const frame = requestAnimationFrame(showStatus);
    return () => cancelAnimationFrame(frame);
  }, [scenario, theme]);
  return <>
    <aside className="hermes-preview-controls" aria-label="预览控制">
      <div className="hermes-preview-label"><FlaskConical size={17}/><strong>Hermes x DFSC 预览</strong><span>模拟数据 · 未连接真实服务</span></div>
      <div className="hermes-preview-options">
        <label htmlFor="preview-state"><span>状态</span>
          <select id="preview-state" aria-label="模拟连接状态" value={scenario}
            onChange={event => setScenario(event.target.value as Scenario)}>
            {scenarios.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" data-tooltip="查看状态" onClick={showStatus}><Eye size={16}/>查看状态</button>
        <div className="hermes-preview-themes" role="group" aria-label="外观">
          <button type="button" className="icon-button" aria-label="浅色" data-tooltip="浅色"
            aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={16}/></button>
          <button type="button" className="icon-button" aria-label="深色" data-tooltip="深色"
            aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={16}/></button>
        </div>
      </div>
    </aside>
    <div ref={chrome} className="app hermes-preview">
      <WindowBar language="zh" menus={[]} sessionTitle="工程桥的前端调整" sidebarVisible={false}
        showSidebarToggle={false} toggleSidebar={() => {}}
        miniChat={{ open: false, disabled: true, onOpen: () => {} }}
        pluginActions={<PluginActionGroup entries={entries} language="zh" bridge={bridge}
          activeId={active ? entries[0].id : undefined} onOpen={() => { setVisited(true); setActive(true); }}/>}/>
      <main className="hermes-preview-context" hidden={active}>
        <div className="hermes-preview-thread">
          <h1>工程桥的前端调整</h1>
          <article><h2>你</h2><p>先看一下 Hermes 与 DFSC 的连接和工程任务，再继续整理安装引导。</p></article>
          <article><h2>助手</h2><p>我们先核对 Hermes 的连接身份，以及 DFSC 侧可见的工程任务，再检查第一次安装后的使用路径。</p></article>
        </div>
        <div className="hermes-preview-draft">
          <label htmlFor="preview-draft">未发送的草稿</label>
          <textarea id="preview-draft" defaultValue="先保留当前对话，看看 Hermes x DFSC 的协作情况。"/>
        </div>
      </main>
      {visited && <div className="hermes-preview-workspace" hidden={!active}>
        <PluginWorkspace entry={entries[0]} bridge={bridge} language="zh" active={active}
          onBack={() => { setActive(false); requestAnimationFrame(() => {
            chrome.current?.querySelector<HTMLButtonElement>('[data-plugin-action="hermes-preview"]')?.focus();
          }); }}/>
      </div>}
    </div>
    <AppTooltip/>
  </>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
