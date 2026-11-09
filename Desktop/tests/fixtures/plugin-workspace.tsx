import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppTooltip } from '../../src/AppTooltip';
import { WindowBar } from '../../src/WindowBar';
import { PluginActionGroup } from '../../src/PluginActionGroup';
import { PluginWorkspace } from '../../src/PluginWorkspace';
import { getPluginDesktopEntries } from '../../src/plugin-desktop';
import { applyTheme } from '../../src/theme';
import type { CapabilityCatalog, CapabilityPlugin, PluginConnection, PluginDesktop, PluginDocument } from '../../src/capabilities';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './plugin-workspace.css';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const side = params.get('surface') === 'side';
const zh = params.get('language') !== 'en';
applyTheme(theme, false);
const iconBlob = await fetch(new URL('./plugin-center-assets/bvr.png', import.meta.url)).then(response => response.blob());
const customIcon = await new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(iconBlob);
});
const desktop: PluginDesktop = {
  title: 'Hermes 工程桥', surface: side ? 'side-panel' : 'main-view', symbol: 'bot', defaultPage: 'start',
  pages: [
    { id: 'start', title: '开始使用', document: 'docs/start.md' },
    { id: 'setup', title: '连接准备', document: 'docs/setup.md' },
    { id: 'first-task', title: '第一项任务', document: 'docs/first-task.md' },
    { id: 'troubleshooting', title: '排查问题', document: 'docs/troubleshooting.md' },
    { id: 'missing', title: '离线帮助', document: 'docs/missing.md' },
  ],
};
function makePlugin(index: number): CapabilityPlugin {
  const names = ['Hermes 工程桥', '文本整理台', '视频研究', '研究工具箱', '图像工作台'];
  const symbols = ['bot', 'book', 'book', 'wrench', 'sparkles'] as const;
  return {
    id: `plugin-${index}`, name: names[index], version: '0.2.0', mcpServers: [], warnings: [],
    package: {
      ref: `package-${index}`, provenance: 'recorded', documentation: {}, tutorials: [], links: [], warnings: [],
      desktop: { ...desktop, ...(index === 0 && params.has('connection') ? { connection: { protocol: 'agent-bridge-v1' as const } } : {}),
        title: names[index], symbol: symbols[index], icon: index === 1
        ? { light: 'data:image/png;base64,AA==' } : index === 2 ? { light: customIcon, dark: customIcon } : undefined },
    },
  };
}
const catalog: CapabilityCatalog = {
  plugins: Array.from({ length: params.get('mode') === 'single' ? 1 : 5 }, (_, index) => makePlugin(index)),
  available: [], marketplaces: [], mcp: [], skills: [], warnings: [],
};
const entries = getPluginDesktopEntries(catalog);
const paragraphs = Array.from({ length: 24 }, (_, index) => `### 核对项目 ${index + 1}\n\n只在本次明确选择的工程目录中执行。连接状态、授权范围和任务结果分别核对；没有记录的检查应保持未验证。`).join('\n\n');
const documents: Record<string, string> = {
  'docs/start.md': '# 从第一项委托开始\n\nHermes 负责接收需求和检查结果，DFSC 负责在本机工程中执行。你可以在桌面查看同一项工作，遇到问题时暂停或接管。\n\n## 安装资源不等于已连接\n\n这个资源包提供帮助和工程协作规范。实际派工还需要支持 Agent Bridge 的 DFSC 宿主、Hermes companion，以及单独的身份配对和目录授权。\n\n[查看连接准备](setup.md)\n\n## 第一次先做一个小任务\n\n选择一个专用测试目录，写下交付目标和检查方式。先确认任务在 DFSC 中出现，再检查完成结果。\n\n[查看第一项任务](first-task.md)\n\n' + paragraphs,
  'docs/setup.md': '# 连接准备\n\n## 连接前需要什么\n\n| 组件 | 需要核对 |\n| --- | --- |\n| DFSC 宿主 | 是否支持 Agent Bridge |\n| Hermes companion | 是否安装到正确的身份 |\n| 工程目录 | 是否由本人明确授权 |\n\n配对和目录授权需要本人确认。不要通过复制其他身份的连接文件来跳过配对。\n\n[返回使用说明](start.md)\n\n' + paragraphs,
  'docs/first-task.md': '# 第一项任务\n\n1. 选择一个空的测试目录。\n2. 请 Hermes 整理三项待办并写入 Markdown 文件，不修改目录外文件。\n3. 在 DFSC 查看收到的任务与执行记录。\n4. 检查文件内容与实际测试结果。\n\n## 示例委托\n\n```text\n在已授权的测试目录中创建 checklist.md，写入三项待办。\n只创建这个文件，不运行网络请求，不修改其他文件。\n完成后报告文件路径和检查结果。\n```\n\n没有通过完整链路验证之前，不把“安装成功”当成“工程执行成功”。',
  'docs/troubleshooting.md': '# 排查问题\n\n## 找不到工程面板\n\n先核对宿主是否支持 Agent Bridge。普通 DFSC 安装资源包不会自动获得工程桥服务。\n\n## 安装后没有收到任务\n\n分别核对 companion、目标身份、配对和授权目录。恢复连接后先查询原任务，不要重复创建任务猜测结果。\n\n## 想暂停使用\n\n停止任务、关闭接入、撤销身份授权与卸载资料是不同操作。卸载资源不会自动停止已有工程。',
};
const reads: { ref: string; path: string }[] = [];
const snapshot = (status: PluginConnection['status']): PluginConnection => ({
  status, ...(status === 'unselected' ? {} : { profile: 'C:/Isolated profiles/agent-profile', agentId: 'test-agent', displayName: '测试身份' }),
  roots: status === 'ready' ? ['C:/Projects/Authorized project'] : [],
  tasks: status === 'ready' ? [{ id: 'task-42', title: '检查项目的测试结果与交付清单', phase: 'review', cwd: 'C:/Projects/Authorized project' }] : [],
  ...(status === 'ready' ? { checkedAt: 1794180000000 } : {}),
});
const connectionFixture = {
  result: snapshot('unselected'), calls: [] as string[], canceled: false, failed: false, hold: false,
  releases: [] as (() => void)[], snapshot,
};
Object.assign(window, { pluginWorkspaceFixture: { reads, connection: connectionFixture } });
async function observe(method: string): Promise<PluginConnection> {
  connectionFixture.calls.push(method);
  const result = structuredClone(connectionFixture.result);
  if (connectionFixture.hold) await new Promise<void>(resolve => connectionFixture.releases.push(resolve));
  if (connectionFixture.failed) throw new Error('PRIVATE_CONNECTION_ERROR');
  return result;
}
const bridge = {
  pluginConnectionState: () => observe('read'),
  async pluginConnectionChooseProfile() {
    if (connectionFixture.canceled) { connectionFixture.calls.push('cancel'); return null; }
    connectionFixture.result = snapshot('ready');
    return observe('choose');
  },
  async pluginConnectionForgetProfile() {
    connectionFixture.result = snapshot('unselected');
    return observe('forget');
  },
  async pluginDocument(input: { ref: string; path: string }): Promise<PluginDocument> {
    reads.push(input);
    await new Promise(resolve => setTimeout(resolve, 20));
    if (!documents[input.path]) throw new Error('Document unavailable');
    return { path: input.path, text: documents[input.path], images: {}, links: {
      'setup.md': 'docs/setup.md', 'first-task.md': 'docs/first-task.md', 'start.md': 'docs/start.md',
    } };
  },
};
function Fixture() {
  const [active, setActive] = useState<string | undefined>(params.get('open') === '1' ? entries[0].id : undefined);
  const [visited, setVisited] = useState(() => new Set(active ? [active] : []));
  const [mini, setMini] = useState(false);
  return <div className="app plugin-workspace-fixture" data-fixture-surface={side ? 'side' : 'main'}>
    <WindowBar language={zh ? 'zh' : 'en'} menus={[]} sessionTitle="工程任务与项目资料"
      sidebarVisible={false} toggleSidebar={() => {}}
      miniChat={{ open: mini, onOpen: () => setMini(value => !value) }}
      pluginActions={<PluginActionGroup entries={entries} language={zh ? 'zh' : 'en'} activeId={active}
        onOpen={entry => { setVisited(value => new Set([...value, entry.id])); setActive(value => value === entry.id ? undefined : entry.id); }}/>}/>
    <main className="plugin-fixture-main" hidden={Boolean(active) && !side}>
      <div className="plugin-fixture-conversation"><h1>项目工作区</h1><p>本周待办</p>
        <ul><li>核对工程目录</li><li>整理测试清单</li><li>检查交付结果</li></ul>
        <div className="plugin-fixture-draft"><label htmlFor="draft">新的需求</label><textarea id="draft" defaultValue="先检查已有任务，不要重新派工。"/></div>
      </div>
    </main>
    <div className={side ? 'plugin-fixture-side' : 'plugin-fixture-workspaces'} hidden={!active}>
      {entries.filter(entry => visited.has(entry.id)).map(entry => <PluginWorkspace key={entry.id} entry={entry} bridge={bridge}
        language={zh ? 'zh' : 'en'} active={active === entry.id}
        onBack={side ? undefined : () => setActive(undefined)} onClose={side ? () => setActive(undefined) : undefined}
        onConfigure={() => {}}/>)}
    </div>
    <AppTooltip/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
