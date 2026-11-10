/// <reference types="vite/client" />
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Languages, Moon, Sun } from 'lucide-react';
import { PluginCenter, type PluginCenterBridge } from '../../src/PluginCenter';
import type { PluginPresentation } from '../../src/PluginDocumentation';
import { SidebarTaskActions } from '../../src/ScheduledTasks';
import type { CapabilityCatalog, PluginPackage } from '../../src/capabilities';
import type { PluginConfiguration, PluginHostSettings } from '../../src/capabilities';
import exampleReadme from '../../../examples/plugins/config-starter/plugins/dfsc-config-example/README.md?raw';
import exampleConsumer from '../../../examples/plugins/config-starter/plugins/dfsc-config-example/docs/consumer.md?raw';
import exampleSchema from '../../../examples/plugins/config-starter/plugins/dfsc-config-example/dfsc.settings.json?raw';
import type { BvrConfiguration } from '../../src/bvr-settings';
import { applyTheme } from '../../src/theme';
import bvrLogo from './plugin-center-assets/bvr.png?inline';
import bvrUpdateLogo from './plugin-center-assets/bvr-update.png?inline';
import { PluginUpdatePreviewControls, usePluginUpdatePreview } from './plugin-update-preview';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';

applyTheme('light', false);
const metadataPreview = new URLSearchParams(location.search).get('metadata') === '1';
const hostPreview = !metadataPreview && new URLSearchParams(location.search).get('host') === '1';
const updatePreview = !metadataPreview && new URLSearchParams(location.search).get('updates') === '1';
const nativeUpdates = !metadataPreview && new URLSearchParams(location.search).get('updates') === 'native';
const presentations: Record<string, PluginPresentation & Pick<PluginPackage, 'categories' | 'keywords'>> = {
  'bilibili-video-research': {
    author: 'BVR contributors', maintainer: 'DFSC 社区', license: 'MIT',
    categories: ['research', 'audio-video'], keywords: ['视频研究', '字幕', '语音转写'],
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

更多用法见[完整项目文档](https://github.com/7oMB2006/Bilibili-Video-Research/blob/main/README.zh-CN.md)。
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
    categories: ['development', 'automation'], keywords: ['browser', 'testing'],
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
      installationSource: { status: 'matched', marketplaces: ['bvr-local-preview'] },
      repository: 'https://github.com/7oMB2006/Bilibili-Video-Research', mcpServers: ['bvr'], warnings: [], icon: { kind: 'png', dataUrl: bvrLogo } },
    { id: 'playwright', name: 'Playwright', version: '1.0.0',
      description: 'Browser automation and end-to-end testing MCP server by Microsoft. Drives web pages, takes screenshots, fills forms, clicks elements and runs automated browser test flows.',
      installationSource: { status: 'recorded', marketplaces: ['builtin'] }, repository: 'https://github.com/microsoft/playwright-mcp',
      mcpServers: ['browser'], warnings: [], icon: { kind: 'step' } },
    { id: 'fixture-long-name', name: 'LongNamePluginWithoutALogoForLayoutVerification', version: '0.1.0',
      description: '本地文件检索与索引', mcpServers: [], warnings: [],
      package: { ref: 'fixture-future', provenance: 'unknown', documentation: {}, tutorials: [], links: [], warnings: [],
        categories: ['future-category'], keywords: ['long-keyword-without-spaces-for-layout-checking'] } },
    { id: 'dfsc-config-example', name: 'DFSC Configuration Example', version: '0.1.0',
      marketplace: 'fixture-community',
      description: '本地便笺格式化；字段来自随包清单。', mcpServers: ['notes'], warnings: [],
      package: { ref: 'fixture-config', provenance: 'recorded', documentation: { readme: 'README.md' }, configurationAvailable: true,
        tutorials: [], links: [], warnings: [], author: 'Desktop for Step Code contributors', license: 'MIT',
        categories: ['text-documents'], keywords: ['notes', 'formatting'] } },
  ],
  available: [{ name: 'fixture', marketplace: 'fixture-community', displayName: 'Fixture plugin', description: '用于安装验收', installed: false,
    package: { ref: 'fixture-market', provenance: 'recorded', documentation: {}, tutorials: [], links: [], warnings: [],
      categories: ['development', 'automation', 'knowledge'], keywords: ['catalog acceptance'] } },
    { name: 'dfsc-config-example', marketplace: 'fixture-community', displayName: 'DFSC Configuration Example',
      installed: true, installedId: 'dfsc-config-example',
      package: { ref: 'fixture-market-config', provenance: 'recorded', documentation: {}, configurationAvailable: false,
        tutorials: [], links: [], warnings: [], categories: ['text-documents'], keywords: ['notes', 'formatting'] } }],
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
    categories: content.categories, keywords: content.keywords,
    stars: { status: 'unknown' },
    locales: plugin.id === 'bilibili-video-research' ? {
      en: { description: 'Research public videos using transcripts, audio and frames.', documentation: { readme: 'README.en.md' } },
    } : undefined };
}
if (metadataPreview) {
  const cases: {
    id: string; name: string; description: string; author?: string; maintainer?: string;
    requirements?: PluginPackage['requirements']; repository?: string; stars?: PluginPresentation['stars'];
  }[] = [
    { id: 'metadata-compatible', name: '资源工具包',
      description: '模拟数据：声明的版本范围符合当前 0.6.0，作者声明无额外依赖；不是总体兼容认证。',
      author: '示例资源贡献者', maintainer: '示例包维护者',
      requirements: { dfsc: '>=0.0.0', external: [] },
      repository: 'https://github.com/7oMB2006/desktop-for-step-code', stars: { count: 128, checkedAt: '2026-11-09' } },
    { id: 'metadata-incompatible', name: '新版本工程工具',
      description: '模拟数据：版本范围不符，包含必选与可选准备项；查看声明不会安装依赖、授权账户或调用服务。',
      author: 'CommunityMaintainersWithAnIntentionallyLongUnbrokenAuthorNameForNarrowLayoutVerification',
      maintainer: '独立封装维护者',
      requirements: { dfsc: '>=99.0.0', external: [
        { name: 'RequiredRuntimeWithAnIntentionallyLongUnbrokenDependencyNameForNarrowLayoutVerification',
          description: '必选准备项，由使用者另行取得并核对版本。这里的长说明用于检查详情页在窄屏、不同语言和深浅主题下是否完整换行；声明本身没有检查本机路径、安装依赖、验证账户、建立连接或执行任务。',
          url: 'https://nodejs.org/', optional: false },
        { name: '可选媒体转换工具',
          description: '只在转换本地媒体时需要；不影响阅读资源文档，未查询本机是否安装。',
          url: 'https://ffmpeg.org/download.html', optional: true },
      ] } },
    { id: 'metadata-undeclared', name: '旧版插件',
      description: '模拟数据：没有作者和 requirements；不能从维护者推测作者，也不能把未声明解释为没有依赖。',
      maintainer: '旧包维护者' },
    { id: 'metadata-range-only', name: '仅版本声明',
      description: '模拟数据：仅声明 DFSC 版本范围，external 缺省；外部准备条件仍为未声明。',
      author: '本地文档贡献者', requirements: { dfsc: '^0.6.0' } },
    { id: 'metadata-link-defense', name: '依赖链接验证',
      description: '模拟数据：故意绕过包解析器注入不安全链接，只用于验证渲染层不会把它们变成可点击入口。',
      author: '不可信声明夹具作者', requirements: { external: [
        { name: '脚本链接', url: 'javascript:alert("metadata-link-fixture")' },
        { name: '本机文件链接', url: 'file:///C:/fixture-only/not-a-real-file.txt' },
        { name: '不安全 HTTP 链接', url: 'http://example.invalid/download' },
        { name: '带凭据的 HTTPS 链接', url: 'https://fixture:not-a-secret@example.invalid/download' },
        { name: '安全 HTTPS 文档', url: 'https://nodejs.org/en/download', optional: true },
      ] } },
  ];
  catalog = {
    plugins: cases.map(item => ({
      id: item.id, name: item.name, version: '1.0.0', description: item.description,
      marketplace: 'metadata-preview', repository: item.repository, mcpServers: [], warnings: [],
      installationSource: { status: 'recorded', marketplaces: ['metadata-preview'] },
      package: { ref: `fixture-${item.id}`, provenance: 'recorded', documentation: { readme: 'README.md' },
        author: item.author, maintainer: item.maintainer, requirements: item.requirements,
        tutorials: [], links: [], warnings: [], stars: item.repository ? { status: 'unknown' } : undefined },
    })),
    available: cases.map(item => ({
      name: item.id, displayName: item.name, version: item.id === 'metadata-compatible' ? '2.0.0' : '1.0.0',
      description: item.id === 'metadata-compatible'
        ? '模拟市场候选 v2.0.0：版本范围不符，需要另行准备新版运行组件；已安装版仍为 v1.0.0。' : item.description,
      marketplace: 'metadata-preview', repository: item.repository, installed: true, installedId: item.id,
      package: { ref: item.id === 'metadata-compatible' ? 'fixture-market-metadata-compatible' : `fixture-${item.id}`,
        provenance: 'recorded', documentation: { readme: 'README.md' },
        author: item.id === 'metadata-compatible' ? '市场新版作者' : item.author, maintainer: item.maintainer,
        requirements: item.id === 'metadata-compatible'
          ? { dfsc: '>=99.0.0', external: [{ name: '新版运行组件' }] } : item.requirements,
        tutorials: [], links: [], warnings: [], stars: item.repository ? { status: 'unknown' } : undefined },
    })),
    marketplaces: [{ name: 'metadata-preview', kind: 'local', origin: null }],
    mcp: [], skills: [], warnings: [],
  };
  for (const item of cases) presentations[item.id] = {
    author: item.author, maintainer: item.maintainer, stars: item.stars,
    readme: `## ${item.name}\n\n${item.description}\n\n`
      + '此页全部为布局和状态验证的模拟数据。版本范围命中不表示本机依赖已经安装、账户已授权或服务已连接。下载统计没有可信来源，不能使用模拟 GitHub Star 数代替。\n',
  };
  presentations['market-metadata-compatible'] = { author: '市场新版作者',
    readme: '## 市场新版使用说明\n\n模拟市场候选为 v2.0.0，作者是市场新版作者，要求 DFSC >=99.0.0 和必选的新版运行组件。\n\n'
      + '这不是已安装的 v1.0.0 说明；查看候选不会替换已安装资源或安装依赖。\n' };
}
if (updatePreview || nativeUpdates) {
  const bvr = catalog.plugins.find(plugin => plugin.id === 'bilibili-video-research')!;
  bvr.marketplace = 'dfsc-community';
  bvr.installationSource = { status: 'recorded', marketplaces: ['dfsc-community'] };
  catalog.available.unshift({ name: bvr.id, id: bvr.id, displayName: bvr.name, marketplace: 'dfsc-community',
    version: '0.1.1', description: bvr.description, repository: bvr.repository, installed: true, installedId: bvr.id,
    icon: { kind: 'png', dataUrl: bvrUpdateLogo }, package: bvr.package });
  catalog.marketplaces.unshift({ name: 'dfsc-community', kind: 'git', origin: 'https://github.com/7oMB2006/dfsc-community-plugins' });
  presentations[bvr.id].changelog = '## 0.1.1\n\n- 更换插件图标，去除外侧白边。\n- 研究能力与配置协议保持不变。\n\n'
    + presentations[bvr.id].changelog;
  if (nativeUpdates) {
    catalog.pluginUpdates = true;
    bvr.update = { status: 'available', version: '0.1.1', ref: 'fixture-update' };
    for (const plugin of catalog.plugins) if (plugin !== bvr) plugin.update = { status: 'unavailable', reason: 'source' };
  }
}
let configuration: BvrConfiguration = { revision: 'fixture-1', configured: true, mode: 'dfsc', runtimeDirectory: 'D:\\Tools\\BVR',
  apiBase: 'https://api.stepfun.com/v1', model: 'step-3.7-flash', hasApiKey: false, asrApiBase: 'https://api.stepfun.com/v1',
  asrModel: 'stepaudio-2.5-asr', hasAsrApiKey: false, cookieFile: '', proxy: '', downloadDirectory: '', preferCaptions: true };
let saves = 0, restarts = 0, catalogReads = 0, preparationRefreshes = 0, repositoryReads = 0;
let updateAttempts = 0, updateChecks = 0, updateApplied = 0, updateFailure = false, releaseUpdate: (() => void) | undefined;
let updateCatalogHeld: Promise<void> | undefined, releaseUpdateCatalog: (() => void) | undefined;
let releaseRepositories: (() => void) | undefined;
const repositoriesHeld = new URLSearchParams(location.search).get('repositories') === 'held'
  ? new Promise<void>(resolve => { releaseRepositories = resolve; }) : undefined;
let preparationRefresh: Promise<void> | undefined, releasePreparationRefresh: (() => void) | undefined;
let exampleConfiguration: PluginConfiguration = { ref: 'fixture-config', revision: 'example-1', configured: false,
  schema: JSON.parse(exampleSchema), values: { prefix: 'Note: ', uppercase: false, limit: 160 }, hasSecret: {} };
let exampleFailure = false;
let hostSaves = 0, hostReads = 0, hostFailure = false, hostReadFailure = false, hostAfterCommitFailure = false;
let hostHeld: Promise<void> | undefined, releaseHost: (() => void) | undefined;
let hostConfiguration: PluginHostSettings = {
  ref: 'fixture-host', revision: 'unconfigured', mode: null, consumer: 'example',
  capabilities: ['model.text', 'model.video', 'model.asr', 'model.tts'], models: {}, configurationCurrent: false,
  runtime: { status: 'unconfigured' },
  independent: { ref: 'fixture-host', revision: 'unconfigured', configured: false, values: { endpoint: 'https://api.stepfun.com/v1', model: 'step-5-preview' },
    hasSecret: {}, schema: { schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'example' }, groups: [
      { id: 'connection', title: '独立模型连接', fields: [
        { id: 'endpoint', label: '接口地址', type: 'text', required: true, maxLength: 2048 },
        { id: 'model', label: '模型', type: 'text', required: true, maxLength: 160 },
        { id: 'key', label: 'API Key', type: 'secret', required: true, maxLength: 2048 },
      ] },
      { id: 'advanced', title: '高级设置', fields: [
        { id: 'path', label: '工作目录', type: 'path', selection: 'directory', required: false, maxLength: 2048 },
      ] },
    ] } },
};
if (hostPreview) {
  catalog.plugins.unshift({ id: 'dfsc-host-example', name: '宿主模型示例', version: '0.1.0', description: '宿主模型与独立配置的通用示例。',
    mcpServers: ['example'], warnings: [], icon: { kind: 'step' }, installationSource: { status: 'recorded', marketplaces: ['fixture-community'] },
    package: { ref: 'fixture-host', provenance: 'recorded', documentation: {}, hostSettingsAvailable: true, configurationAvailable: true,
      tutorials: [], links: [], warnings: [], author: 'DFSC 示例作者', categories: ['development'] } });
  catalog.mcp.unshift({ name: 'dfsc-host-example__example', source: 'plugin', pluginId: 'dfsc-host-example',
    transport: 'stdio', enabled: true, configurable: true });
}
const hostConnected = () => {
  hostConfiguration.runtime = hostConfiguration.mode === 'independent' ? { status: 'connected' }
    : { status: 'connected', capabilities: hostConfiguration.capabilities.map(id => ({
      id, available: id !== 'model.tts', ...(id !== 'model.tts' ? {
        model: id === 'model.asr' ? hostConfiguration.models['model.asr'] ?? 'stepaudio-2.5-asr' : 'step-5-preview',
        channel: 'plan' as const, region: 'cn' as const,
      } : {}), authorization: id === 'model.tts' ? 'unavailable' as const : 'required' as const,
    })) };
};
const bridge: PluginCenterBridge = {
  platform: 'win32', capabilityCatalog: async () => { catalogReads++; await updateCatalogHeld; return structuredClone(catalog); },
  pluginRepositoryInfo: async input => {
    repositoryReads++;
    await repositoriesHeld;
    const plugin = catalog.plugins.find(plugin => plugin.package?.ref === input.ref);
    const stars = plugin && presentations[plugin.id]?.stars;
    return stars ? { ...stars, status: 'fresh' } : { status: 'unavailable' };
  },
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
  pluginHostSettings: async input => {
    hostReads++;
    const value = structuredClone(hostConfiguration);
    await hostHeld;
    if (hostReadFailure) { hostReadFailure = false; throw new Error('capability:host-unavailable'); }
    if (input.ref !== hostConfiguration.ref) throw new Error('capability:stale');
    return value;
  },
  pluginSaveHostSettings: async input => {
    hostSaves++;
    if (hostFailure) {
      hostFailure = false; hostConfiguration.runtime = { status: 'restart-required' };
      throw new Error('capability:host-selection-incomplete');
    }
    if (input.revision !== hostConfiguration.revision) throw new Error('capability:stale-configuration');
    if (input.mode === 'independent') {
      if (!input.configuration || !hostConfiguration.independent) throw new Error('capability:invalid-configuration');
      const config = input.configuration;
      hostConfiguration.independent = { ...hostConfiguration.independent, revision: `config-${hostSaves}`, configured: true,
        values: { ...config.values }, hasSecret: { key: config.secrets.key?.action === 'replace' || hostConfiguration.independent.hasSecret.key === true } };
    }
    hostConfiguration = { ...hostConfiguration, mode: input.mode, models: input.models ?? {},
      revision: `host-${hostSaves}`, configurationCurrent: true, runtime: { status: 'restart-required' } };
    if (hostAfterCommitFailure) { hostAfterCommitFailure = false; throw new Error('capability:host-selection-incomplete'); }
    return structuredClone(hostConfiguration);
  },
  pluginChoosePath: async () => 'D:\\Chosen\\Example',
  pluginDocument: async input => {
    if (input.ref === 'fixture-config') return { path: input.path,
      text: input.path === 'README.md' ? exampleReadme : exampleConsumer, images: {},
      links: Object.fromEntries([input.path === 'README.md' ? ['docs/consumer.md', 'docs/consumer.md'] : ['../README.md', 'README.md']]) };
    const content = presentations[input.ref.replace(/^fixture-/u, '')];
    const text = input.path === 'README.en.md' ? '## Video research\n\nAsk a specific question and provide a public video URL.'
      : input.path === 'README.md' ? content?.readme : content?.changelog;
    if (!text) throw new Error('capability:not-found');
    return { path: input.path, text, images: {}, links: {} };
  },
  capabilityMutate: async input => {
    if (input.action === 'plugin-check-updates') { updateChecks++; return { warnings: [] }; }
    if (input.action === 'plugin-update') {
      const plugin = catalog.plugins.find(item => item.id === input.id);
      if (!nativeUpdates || plugin?.package?.ref !== input.ref || plugin.update?.ref !== input.candidate) throw new Error('capability:stale');
      updateAttempts++;
      await new Promise<void>(resolve => { releaseUpdate = resolve; });
      if (updateFailure) { updateFailure = false; throw new Error('capability:resource-in-use'); }
      plugin.version = '0.1.1'; plugin.update = { status: 'current' }; plugin.icon = { kind: 'png', dataUrl: bvrUpdateLogo };
      updateApplied++;
      return { warnings: [] };
    }
    if (input.action === 'plugin-toggle') {
      catalog.mcp.filter(server => server.pluginId === input.id).forEach(server => { server.enabled = input.enabled; });
      if (input.id === 'dfsc-host-example') hostConfiguration.runtime = { status: input.enabled ? 'restart-required' : 'disabled' };
    }
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
  counts: () => ({ saves, restarts, catalogReads, preparationRefreshes, repositoryReads }),
  updateCounts: () => ({ attempts: updateAttempts, checks: updateChecks, applied: updateApplied }),
  holdUpdateCatalog: () => { updateCatalogHeld = new Promise(resolve => { releaseUpdateCatalog = resolve; }); },
  releaseUpdateCatalog: () => { releaseUpdateCatalog?.(); updateCatalogHeld = undefined; },
  releaseUpdate: () => { releaseUpdate?.(); releaseUpdate = undefined; },
  failUpdate: () => { updateFailure = true; },
  releaseRepositories: () => releaseRepositories?.(),
  language: (language: 'zh' | 'en') => dispatchEvent(new CustomEvent('plugin-center-language', { detail: language })),
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
Object.assign(window, { pluginHostTest: {
  snapshot: () => ({ value: structuredClone(hostConfiguration), saves: hostSaves, reads: hostReads, restarts }),
  connected: hostConnected,
  approve: () => { for (const capability of hostConfiguration.runtime.capabilities ?? [])
    if (capability.available) capability.authorization = 'approved'; },
  fail: () => { hostFailure = true; },
  failAfterCommit: () => { hostAfterCommitFailure = true; },
  failRead: () => { hostReadFailure = true; },
  status: (status: PluginHostSettings['runtime']['status']) => { hostConfiguration.runtime = { status }; },
  stale: () => { hostConfiguration.revision = 'changed-elsewhere'; },
  noIndependent: () => { hostConfiguration.independent = undefined; },
  hold: () => { hostHeld = new Promise(resolve => { releaseHost = resolve; }); },
  release: () => { releaseHost?.(); hostHeld = undefined; },
  session: (id: string) => dispatchEvent(new CustomEvent('plugin-host-session', { detail: id })),
} });
function Fixture() {
  const [active, setActive] = useState(true);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [dark, setDark] = useState(false);
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1001px)').matches);
  const [message, setMessage] = useState('保留会话草稿');
  const [hostRuntime, setHostRuntime] = useState('fixture-runtime');
  const updateState = usePluginUpdatePreview({ readCatalog: () => catalog, replaceCatalog: value => { catalog = value; },
    onRestart: async () => { restarts++; }, language });
  useEffect(() => {
    const change = (event: Event) => setLanguage((event as CustomEvent<'zh' | 'en'>).detail);
    addEventListener('plugin-center-language', change);
    return () => removeEventListener('plugin-center-language', change);
  }, []);
  useEffect(() => {
    const change = (event: Event) => setHostRuntime((event as CustomEvent<string>).detail);
    addEventListener('plugin-host-session', change);
    return () => removeEventListener('plugin-host-session', change);
  }, []);
  useEffect(() => {
    const media = matchMedia('(min-width: 1001px)');
    const change = () => setWide(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  return <div className={`app pc-preview${wide ? ' pc-sidebar-open' : ''}`}><header className="pc-window">Desktop for Step Code
    <span className="pc-preview-label">{metadataPreview ? language === 'zh' ? '插件信息预览 · 模拟数据' : 'Plugin metadata · simulated data'
      : hostPreview ? language === 'zh' ? '宿主模型设置 · 模拟数据' : 'Host model settings · simulated data'
      : updatePreview || nativeUpdates ? language === 'zh' ? '插件更新预览 · 模拟数据' : 'Plugin updates · simulated data' : '插件文档预览'}</span>
    {hostPreview && <div className="pc-theme-select"><button type="button" onClick={() => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', false)}>
      {language === 'zh' ? '切换明暗主题' : 'Toggle theme'}</button><button type="button" onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}>{language === 'zh' ? 'English' : '中文'}</button></div>}
    {metadataPreview && <div className="pc-update-preview-controls">
      <button className="icon-button" type="button" aria-label={language === 'zh' ? '切换明暗主题' : 'Toggle light and dark'}
        data-tooltip={language === 'zh' ? '切换明暗主题' : 'Toggle light and dark'} onClick={() => {
          const nextDark = document.documentElement.dataset.theme !== 'dark';
          setDark(nextDark); applyTheme(nextDark ? 'dark' : 'light', false);
        }}>{dark ? <Sun size={15}/> : <Moon size={15}/>}</button>
      <button className="icon-button" type="button" aria-label={language === 'zh' ? '切换为英文' : 'Switch to Chinese'}
        data-tooltip={language === 'zh' ? '切换为英文' : 'Switch to Chinese'}
        onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}><Languages size={15}/></button>
    </div>}
    {updatePreview && <PluginUpdatePreviewControls language={language} onLanguage={setLanguage} preview={updateState}/>}</header>
    <aside className="sidebar"><SidebarTaskActions selected={false} pluginsSelected={active} onNewSession={() => setActive(false)}
      onScheduledTasks={() => setActive(false)} onPlugins={() => setActive(value => !value)}/></aside>
    <main><PluginCenter key={updatePreview ? updateState.revision : 'default'} bridge={bridge} active={active} language={language} busy={false}
      currentVersion={metadataPreview ? '0.6.0' : undefined}
      updates={updatePreview ? updateState.updates : undefined} runtimeId={hostRuntime} settings={{ mcp: {} }}
      onChanged={async () => { if (preparationRefresh) { preparationRefreshes++; await preparationRefresh; } }}
      onRestart={updatePreview ? updateState.restart : async () => { restarts++; if (hostPreview) hostConnected(); }} onManageMcp={() => {}} onBack={() => setActive(false)}/>
      <section hidden={active}><textarea aria-label="会话草稿" value={message} onChange={event => setMessage(event.target.value)}/></section>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
