/// <reference types="vite/client" />
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginCenter, type PluginCenterBridge } from '../../src/PluginCenter';
import type { PluginPresentation } from '../../src/PluginDocumentation';
import { SidebarTaskActions } from '../../src/ScheduledTasks';
import type { CapabilityCatalog } from '../../src/capabilities';
import type { PluginConfiguration } from '../../src/capabilities';
import exampleReadme from '../../../examples/plugins/config-starter/plugins/dfsc-config-example/README.md?raw';
import exampleConsumer from '../../../examples/plugins/config-starter/plugins/dfsc-config-example/docs/consumer.md?raw';
import exampleSchema from '../../../examples/plugins/config-starter/plugins/dfsc-config-example/dfsc.settings.json?raw';
import type { BvrConfiguration } from '../../src/bvr-settings';
import { applyTheme } from '../../src/theme';
import bvrLogo from './plugin-center-assets/bvr.png?inline';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';

applyTheme('light', false);
const presentations: Record<string, PluginPresentation> = {
  'bilibili-video-research': {
    author: 'BVR contributors', maintainer: 'DFSC 社区', license: 'MIT',
    stars: { count: 18, checkedAt: '2026-11-04' },
    tutorials: [{ title: '让 Agent 帮你研究视频', creator: '7oMB', source: '哔哩哔哩', kind: 'community',
      url: 'https://www.bilibili.com/video/BV1dPeP6REwM/' }],
    links: [
      { title: '完整项目文档', url: 'https://github.com/7oMB2006/Bilibili-Video-Research/blob/main/README.zh-CN.md' },
      { title: '提交问题', url: 'https://github.com/7oMB2006/Bilibili-Video-Research/issues' },
    ],
    readme: `## 从一段视频开始

把哔哩哔哩链接交给 Agent，并告诉它你想研究什么。BVR 会根据问题使用字幕、语音或视频画面，整理可以追溯来源的研究结果。

### 在 DFSC 中使用

1. 在「配置」中选择跟随 DFSC 会话，或分别填写主力模型与语音识别连接。
2. 确认 BVR 运行目录与依赖就绪，启用服务后重启需要使用它的会话。
3. 在对话里输入研究问题与视频链接，也可以使用 \`/bvr\`。

### 试着问一个具体问题

\`\`\`text
/bvr 这个视频介绍了什么项目？
请分别整理核心功能、使用条件和视频中没有证实的结论。
https://www.bilibili.com/video/BV1dPeP6REwM/
\`\`\`

### 选择合适的证据

| 方式 | 读取内容 | 适合的问题 |
| --- | --- | --- |
| 语言 | 字幕，必要时使用语音识别 | 作者讲了什么、推荐了哪些项目 |
| 视觉 | 视频画面，不依赖声音 | 界面、图表、操作步骤与细节 |
| 多模态 | 语言与画面 | 需要同时核对讲解和屏幕内容 |

### 开始之前

- 模型调用可能消耗 API 余额或套餐额度，首次建议使用较短的公开视频。
- 普通公开视频不要求先配置 Cookie；仅在匿名访问不足时使用自己授权的登录信息。
- 不要把密钥或 Cookie 内容贴进对话、问题反馈或截图。

### 给使用者的话

研究结果中，视频里明确出现的内容、模型的推断，以及评论区的观点，应当分开看待。带着一个具体的问题开始，通常比让模型「分析全部内容」更有帮助。
`,
    changelog: `## 0.1.0

### 首次接入 DFSC

- 提供视频研究技能与 \`/bvr\` 提示指令。
- 在插件配置中分别管理主力模型与 ASR 连接。
- 支持显式选择跟随实际调用的 DFSC 会话。

> 此页为文档排版示例，实际更新内容以插件随包记录为准。
`,
  },
  playwright: {
    author: 'Microsoft', license: 'Apache-2.0',
    readme: `## 浏览器自动化

通过 MCP 为 Agent 提供浏览器交互能力。服务连接后，可在对话中提出页面检查、表单操作或界面验证请求。

### 开始使用

启用插件服务并重启相关会话。在「能力」中确认浏览器服务的实际连接状态。

没有专用表单的参数，可以通过「配置」进入 MCP 设置管理。
`,
  },
};
let catalog: CapabilityCatalog = {
  plugins: [
    { id: 'bilibili-video-research', name: 'Bilibili Video Research', version: '0.1.0', description: '结合字幕、语音与视频画面，整理带时间定位的研究证据。',
      repository: 'https://github.com/7oMB2006/Bilibili-Video-Research', mcpServers: ['bvr'], warnings: [], icon: { kind: 'png', dataUrl: bvrLogo } },
    { id: 'playwright', name: 'Playwright', version: '1.0.0', description: '浏览器自动化', repository: 'https://github.com/microsoft/playwright-mcp',
      mcpServers: ['browser'], warnings: [], icon: { kind: 'step' } },
    { id: 'fixture-long-name', name: 'LongNamePluginWithoutALogoForLayoutVerification', version: '0.1.0',
      description: '本地文件检索与索引', mcpServers: [], warnings: [] },
    { id: 'dfsc-config-example', name: 'DFSC Configuration Example', version: '0.1.0',
      description: '本地便笺格式化；字段来自随包清单。', mcpServers: ['notes'], warnings: [],
      package: { ref: 'fixture-config', provenance: 'recorded', documentation: { readme: 'README.md' }, configurationAvailable: true,
        tutorials: [], links: [], warnings: [], author: 'Desktop for Step Code contributors', license: 'MIT' } },
  ],
  available: [{ name: 'fixture', marketplace: 'fixture-community', displayName: 'Fixture plugin', description: '用于安装验收', installed: false },
    { name: 'dfsc-config-example', marketplace: 'fixture-community', displayName: 'DFSC Configuration Example',
      installed: true, installedId: 'dfsc-config-example',
      package: { ref: 'fixture-market-config', provenance: 'recorded', documentation: {}, configurationAvailable: false,
        tutorials: [], links: [], warnings: [] } }],
  marketplaces: [{ name: 'fixture-community', kind: 'git', origin: 'https://github.com/7oMB2006/dfsc-community-plugins' }],
  mcp: [{ name: 'bilibili-video-research__bvr', source: 'plugin', pluginId: 'bilibili-video-research', transport: 'stdio', enabled: true, configurable: true },
    { name: 'playwright__browser', source: 'plugin', pluginId: 'playwright', transport: 'stdio', enabled: true, configurable: true },
    { name: 'dfsc-config-example__notes', source: 'plugin', pluginId: 'dfsc-config-example', transport: 'stdio', enabled: true, configurable: true }],
  skills: [], warnings: [],
};
for (const plugin of catalog.plugins) {
  const content = presentations[plugin.id];
  if (!content) continue;
  plugin.package = { ref: `fixture-${plugin.id}`, provenance: 'recorded', author: content.author,
    maintainer: content.maintainer, license: content.license, documentation: {
      ...(content.readme ? { readme: 'README.md' } : {}), ...(content.changelog ? { changelog: 'CHANGELOG.md' } : {}),
    }, tutorials: content.tutorials ?? [], links: content.links ?? [], warnings: [],
    stars: content.stars ? { ...content.stars, status: 'fresh' } : undefined };
}
let configuration: BvrConfiguration = { revision: 'fixture-1', configured: true, mode: 'dfsc', runtimeDirectory: 'D:\\Tools\\BVR',
  apiBase: 'https://api.stepfun.com/v1', model: 'step-3.7-flash', hasApiKey: false, asrApiBase: 'https://api.stepfun.com/v1',
  asrModel: 'stepaudio-2.5-asr', hasAsrApiKey: false, cookieFile: '', proxy: '', downloadDirectory: '', preferCaptions: true };
let saves = 0, restarts = 0, catalogReads = 0, preparationRefreshes = 0;
let preparationRefresh: Promise<void> | undefined, releasePreparationRefresh: (() => void) | undefined;
let exampleConfiguration: PluginConfiguration = { ref: 'fixture-config', revision: 'example-1', configured: false,
  schema: JSON.parse(exampleSchema), values: { prefix: 'Note: ', uppercase: false, limit: 160 }, hasSecret: {} };
let exampleFailure = false;
const bridge: PluginCenterBridge = {
  platform: 'win32', capabilityCatalog: async () => { catalogReads++; return structuredClone(catalog); },
  pluginRepositoryInfo: async input => catalog.plugins.find(plugin => plugin.package?.ref === input.ref)?.package?.stars ?? { status: 'unknown' },
  pluginConfiguration: async input => {
    if (input.ref !== 'fixture-config') throw new Error('capability:not-found');
    return structuredClone(exampleConfiguration);
  },
  pluginSaveConfiguration: async input => {
    if (exampleFailure) { exampleFailure = false; throw new Error('capability:storage'); }
    if (input.ref !== 'fixture-config' || input.revision !== exampleConfiguration.revision) throw new Error('capability:stale-configuration');
    exampleConfiguration = { ...exampleConfiguration, configured: true, values: { ...input.values }, revision: `${exampleConfiguration.revision}-next`,
      hasSecret: Object.fromEntries(Object.entries(input.secrets).map(([key, intent]) => [key,
        intent.action === 'replace' ? Boolean(intent.value) : intent.action === 'delete' ? false : exampleConfiguration.hasSecret[key] === true])) };
    return structuredClone(exampleConfiguration);
  },
  pluginChoosePath: async () => 'D:\\Chosen\\Example',
  pluginDocument: async input => {
    if (input.ref === 'fixture-config') return { path: input.path,
      text: input.path === 'README.md' ? exampleReadme : exampleConsumer, images: {},
      links: Object.fromEntries([input.path === 'README.md' ? ['docs/consumer.md', 'docs/consumer.md'] : ['../README.md', 'README.md']]) };
    const content = presentations[input.ref.replace(/^fixture-/u, '')];
    const text = input.path === 'README.md' ? content?.readme : content?.changelog;
    if (!text) throw new Error('capability:not-found');
    return { path: input.path, text, images: {}, links: {} };
  },
  capabilityMutate: async input => {
    if (input.action === 'plugin-toggle') catalog.mcp.filter(server => server.pluginId === input.id).forEach(server => { server.enabled = input.enabled; });
    if (input.action === 'plugin-remove') catalog.plugins = catalog.plugins.filter(plugin => plugin.id !== input.id);
    if (input.action === 'marketplace-add') catalog.marketplaces.push({ name: 'new-market', kind: 'git', origin: input.source });
    if (input.action === 'plugin-install') {
      const available = catalog.available[0]; available.installed = true; available.installedId = 'fixture';
      catalog.plugins.push({ id: 'fixture', name: 'Fixture plugin', warnings: [], mcpServers: [] });
    }
    return { warnings: [] };
  },
  capabilityImportSkill: async () => null, saveMcp: async () => {},
  summary: async () => ({ sessionId: 'fixture-session', tasks: [], subagents: [], workflows: [], skillCount: 0, mcp: [], commands: [] }),
  stepPageState: async () => ({ status: 'missing', installed: false }),
  prepareStepPage: async () => {
    catalog.plugins.push({ id: 'steppage', name: 'StepPage', warnings: [], mcpServers: [] });
    return { status: 'ready', installed: true };
  },
  bvrConfiguration: async () => structuredClone(configuration),
  bvrChoosePath: async kind => kind === 'runtime' ? 'D:\\Chosen\\BVR' : kind === 'cookie' ? 'D:\\BVR\\cookies.txt' : 'D:\\BVR\\downloads',
  bvrCheckEnvironment: async () => ({ node: '24.15.0', dependencies: true, independentConnections: true }),
  bvrSaveConfiguration: async input => {
    if (input.revision !== configuration.revision) throw new Error('bvr:stale');
    if (input.mode === 'independent' && (!input.apiKey && !configuration.hasApiKey || !input.asrApiKey && !configuration.hasAsrApiKey))
      throw new Error('bvr:missing-key');
    const { apiKey, asrApiKey, ...values } = input;
    configuration = { ...values, configured: true, revision: `fixture-${++saves + 1}`,
      hasApiKey: Boolean(apiKey || configuration.hasApiKey), hasAsrApiKey: Boolean(asrApiKey || configuration.hasAsrApiKey) };
    return structuredClone(configuration);
  },
};
Object.assign(window, { pluginCenterTest: { configuration: () => structuredClone(configuration),
  counts: () => ({ saves, restarts, catalogReads, preparationRefreshes }),
  holdPreparationRefresh: () => { preparationRefresh = new Promise(resolve => { releasePreparationRefresh = resolve; }); },
  releasePreparationRefresh: () => { releasePreparationRefresh?.(); preparationRefresh = undefined; },
  exampleConfiguration: () => structuredClone(exampleConfiguration),
  exampleFailure: () => { exampleFailure = true; },
  exampleStale: () => { exampleConfiguration.revision = 'changed-elsewhere'; },
  exampleFields: () => {
    exampleConfiguration.schema.groups.push({ id: 'controls', title: 'Optional controls', fields: [
      { id: 'file', label: 'Source file', type: 'path', selection: 'file', required: false, maxLength: 2048 },
      { id: 'key', label: 'Example secret', type: 'secret', required: false, maxLength: 2048 },
      { id: 'style', label: 'Format', type: 'enum', required: false, maxLength: 160, options: [
        { value: 'plain', label: 'Plain' }, { value: 'short', label: 'Short' },
      ] },
    ] });
  },
  theme: (theme: 'light' | 'dark') => applyTheme(theme, false),
  stale: () => { configuration.revision = 'changed-externally'; } } });
function Fixture() {
  const [active, setActive] = useState(true);
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1001px)').matches);
  const [message, setMessage] = useState('保留会话草稿');
  useEffect(() => {
    const media = matchMedia('(min-width: 1001px)');
    const change = () => setWide(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  return <div className={`app pc-preview${wide ? ' pc-sidebar-open' : ''}`}><header className="pc-window">Desktop for Step Code<span className="pc-preview-label">插件文档预览</span></header>
    <aside className="sidebar"><SidebarTaskActions selected={false} pluginsSelected={active} onNewSession={() => setActive(false)}
      onScheduledTasks={() => setActive(false)} onPlugins={() => setActive(value => !value)}/></aside>
    <main><PluginCenter bridge={bridge} active={active} language="zh" busy={false} runtimeId="fixture-runtime" settings={{ mcp: {} }}
      onChanged={async () => { if (preparationRefresh) { preparationRefreshes++; await preparationRefresh; } }}
      onRestart={async () => { restarts++; }} onManageMcp={() => {}} onBack={() => setActive(false)}/>
      <section hidden={active}><textarea aria-label="会话草稿" value={message} onChange={event => setMessage(event.target.value)}/></section>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
