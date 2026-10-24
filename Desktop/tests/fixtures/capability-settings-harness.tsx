import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plug, BookOpen, MessageSquare, X } from 'lucide-react';
import { CapabilitySettings, type CapabilityPage, type CapabilityBridge, type CapabilityTarget } from '../../src/CapabilitySettings';
import { SidebarTaskActions } from '../../src/ScheduledTasks';
import { McpIcon } from '../../src/McpIcon';
import type { CapabilityCatalog } from '../../src/capabilities';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import '../../src/settings-dialog.css';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const fadePreview = params.has('fade');
const sessionTitles = language === 'zh'
  ? ['前端设计', '插件开发', '检查账户设置与额度展示', '整理本周的更新记录', '修复侧栏交互与焦点状态', '核对任务清单和完成提示', '为新插件添加图标', '排查运行时连接问题']
  : ['Frontend design', 'Plugin development', 'Review account settings', 'Weekly release notes', 'Sidebar interaction fixes', 'Task completion review', 'Plugin icon support', 'Runtime connection checks'];
const previewSessions = Array.from({ length: fadePreview ? 32 : 2 }, (_, index) => ({
  id: index, title: sessionTitles[index % sessionTitles.length],
}));
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
const catalog: CapabilityCatalog = {
  plugins: [{ id: 'playwright', name: 'Playwright', version: '1.0.0', description: '浏览器自动化与页面测试', mcpServers: ['playwright__playwright'], warnings: [], icon: { kind: 'step' } }],
  available: [
    { name: 'playwright', description: '浏览器自动化与页面测试', marketplace: 'step-official', installed: true, icon: { kind: 'step' } },
    { name: 'steppage', description: '阶跃网页发布插件', marketplace: 'step-official', installed: false, icon: { kind: 'step' } },
  ],
  marketplaces: [{ name: 'step-official', kind: 'builtin', origin: null }],
  mcp: [
    { name: 'playwright__playwright', pluginName: 'Playwright', source: 'plugin', transport: 'stdio', enabled: true, configurable: true },
    { name: 'project-docs', source: 'user', transport: 'http', enabled: false, configurable: true },
  ],
  skills: [
    { id: 'review', name: 'code-review', description: '检查代码变更中的缺陷、回归和测试覆盖', source: 'user', location: 'agent/skills/code-review/SKILL.md', enabled: true, toggleable: true, deletable: true },
    { id: 'frontend', name: 'frontend-check', description: '核对页面布局、交互与可访问性', source: 'user', location: 'agent/skills/frontend-check/SKILL.md', enabled: false, toggleable: true, deletable: true },
  ],
  warnings: [],
};
const bridge: CapabilityBridge = {
  platform: 'win32',
  capabilityCatalog: async () => structuredClone(catalog),
  capabilityMutate: async input => {
    if (input.action === 'mcp-toggle') catalog.mcp.find(item => item.name === input.name)!.enabled = input.enabled;
    if (input.action === 'skill-toggle') catalog.skills.find(item => item.id === input.id)!.enabled = input.enabled;
    if (input.action === 'skill-remove') catalog.skills = catalog.skills.filter(item => item.id !== input.id);
    if (input.action === 'skill-create') {
      if (catalog.skills.some(item => item.name === input.name)) throw new Error('capability:already-exists');
      catalog.skills.push({ ...input, id: input.name, location: `agent/skills/${input.name}/SKILL.md`, source: 'user', enabled: true, toggleable: true, deletable: true });
    }
    if (input.action === 'plugin-install') {
      catalog.available.find(item => item.name === input.name)!.installed = true;
      catalog.plugins.push({ id: input.name, name: input.name, description: 'Preview installation', mcpServers: [], warnings: [],
        icon: catalog.available.find(item => item.name === input.name)?.icon });
    }
    if (input.action === 'plugin-remove') {
      catalog.plugins = catalog.plugins.filter(item => item.id !== input.id);
      const plugin = catalog.available.find(item => item.name === input.id);
      if (plugin) plugin.installed = false;
    }
    if (input.action === 'marketplace-add') catalog.marketplaces.push({ name: input.source, kind: 'git', origin: input.source });
    if (input.action === 'marketplace-remove') catalog.marketplaces = catalog.marketplaces.filter(item => item.name !== input.name);
    return { warnings: [] };
  },
  capabilityImportSkill: async () => null,
  stepPageState: async () => ({ status: 'missing', installed: false }),
  prepareStepPage: async () => ({ status: 'missing', installed: false }),
  saveMcp: async () => {},
  summary: async () => ({ sessionId: 'preview', tasks: [], skillCount: 2, mcp: [{ name: 'playwright__playwright', status: 'connected', toolCount: 22 }] }),
};
function Preview() {
  const [page, setPage] = useState<CapabilityPage>((params.get('page') as CapabilityPage) || 'plugins');
  const [edit, setEdit] = useState<string>();
  const sidebarPreview = params.has('sidebar') || fadePreview;
  const [settingsOpen, setSettingsOpen] = useState(!sidebarPreview);
  const [target, setTarget] = useState<CapabilityTarget>();
  const [selectedSession, setSelectedSession] = useState(0);
  const tree = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!fadePreview || !tree.current) return;
    const offset = Number(params.get('scroll') ?? 48);
    tree.current.scrollTop = Number.isFinite(offset) ? Math.max(0, offset) : 48;
    tree.current.dataset.scrolled = String(tree.current.scrollTop > 0);
  }, []);
  return <div className="app">{sidebarPreview && <><aside className="sidebar" inert={settingsOpen}>
    <div className="sidebar-identity"><img src="/StepCode.svg" width="26" height="26" alt=""/><span className="sidebar-wordmark"><img className="wordmark-light" src="/wordmark-light.png" alt="Desktop for Step Code"/><img className="wordmark-dark" src="/wordmark-dark.png" alt="Desktop for Step Code"/></span></div>
    <SidebarTaskActions selected={false} language={language} onNewSession={() => {}} onScheduledTasks={() => {}}
      onPlugins={() => { setTarget({ page: 'plugins', tab: 'discover' }); setPage('plugins'); setSettingsOpen(true); }}/>
    <nav ref={tree} className="workspace-tree" aria-label={language === 'zh' ? '会话' : 'Sessions'}
      onScroll={event => { event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 0); }}>
      <div className="workspace-heading"><button className="workspace-toggle"><MessageSquare size={15}/><span>{language === 'zh' ? '独立会话' : 'Independent sessions'}</span><small>{previewSessions.length}</small></button></div>
      {previewSessions.map(session => <div key={session.id} className={`session-row${selectedSession === session.id ? ' selected' : ''}`}>
        <button aria-current={selectedSession === session.id ? 'page' : undefined} onClick={() => setSelectedSession(session.id)}>{session.title}</button>
      </div>)}
    </nav>
  </aside><main/></>}{settingsOpen && <div className="modal-backdrop settings-backdrop"><section className="settings-dialog" role="dialog" aria-label={language === 'zh' ? '设置' : 'Settings'}>
    <header><h2>{language === 'zh' ? '设置' : 'Settings'}</h2><button className="icon-button" aria-label="Close" onClick={() => { setEdit(undefined); if (sidebarPreview) setSettingsOpen(false); }}><X size={18}/></button></header>
    <div className="settings-layout"><nav aria-label="Settings categories">{[
      ['plugins', Plug, language === 'zh' ? '插件' : 'Plugins'], ['mcp', McpIcon, 'MCP'], ['skills', BookOpen, 'Skills'],
    ].map(([id, Icon, title]: any) => <button key={id} className={page === id ? 'selected' : ''} onClick={() => setPage(id)}><Icon size={17}/>{title}</button>)}</nav>
      <div key={page} className="settings-content"><CapabilitySettings page={page} bridge={bridge} language={language} busy={false} runtimeId="preview" target={target}
        settings={{ mcp: {} }} onEditMcp={name => setEdit(name || 'MCP')} onChanged={async () => {}} onRestart={async () => {}}/></div>
    </div></section></div>}
    {edit && <div className="modal-backdrop higher"><section className="small-dialog"><header><h2>{edit}</h2><button className="icon-button" aria-label="Close editor" onClick={() => setEdit(undefined)}><X size={18}/></button></header><label>URL<input defaultValue="https://example.com/mcp"/></label><button onClick={() => setEdit(undefined)}>{language === 'zh' ? '取消' : 'Cancel'}</button></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
