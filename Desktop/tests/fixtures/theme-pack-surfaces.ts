import type { DesktopBridge, Preferences } from '../../src/contracts';
import type { CapabilityCatalog, CapabilityPlugin, PluginDocument } from '../../src/capabilities';
import type { ThemePack } from '../../src/theme-packs';
import { resolveTheme } from '../../src/theme';
import { resolveThemeMaterial } from '../../src/theme-material';
import { defaultCompactionConfiguration, validateCompactionUpdate, type CompactionSettings } from '../../src/compaction-settings';

const cover = new URL('../../../theme-marketplace/plugins/stellar-cruise/cover.png', import.meta.url).href;
const guide = '# 星辰工作簿\n\n本页为离线组件样例，使用真实的插件工作区组件。\n\n'
  + '## 航行记录\n\n| 项目 | 状态 |\n| --- | --- |\n| 阅读材质 | 石墨 |\n| 分隔线 | 铅笔细线 |\n\n'
  + '```ts\nconst theme = "stellar-cruise";\n```\n\n[校对记录](NOTES.md)';

export function themePackSurfaces(pack: ThemePack, preferences: () => Preferences,
  emit: (event: Record<string, unknown>) => void): Partial<DesktopBridge> {
  const theme: CapabilityPlugin = {
    id: 'stellar-cruise', name: pack.name, version: pack.version, mcpServers: [], warnings: [],
    description: '双龙星海、石墨阅读面与铅笔细线。',
    package: { ref: 'offline-stellar', provenance: 'recorded', author: pack.author, dataOnlyTheme: true,
      documentation: { readme: 'README.md', changelog: 'CHANGELOG.md' }, tutorials: [], links: [],
      categories: ['themes'], requirements: { external: [] }, warnings: [] },
  };
  const workbooks = (['main-view', 'side-panel', 'window'] as const).map((surface, index): CapabilityPlugin => ({
    id: `offline-workbook-${index}`, name: '离线工作簿', version: '1.0.0', mcpServers: [], warnings: [],
    description: '插件工作区离线样例。',
    package: { ref: `offline-workbook-${index}`, provenance: 'recorded', documentation: { readme: 'README.md' },
      tutorials: [], links: [], warnings: [], desktop: { title: '星辰工作簿', surface, symbol: 'book',
        pages: [{ id: 'start', title: '航行记录', document: 'README.md' },
          { id: 'notes', title: '校对记录', document: 'NOTES.md' }] } },
  }));
  const catalog: CapabilityCatalog = {
    plugins: [theme, ...workbooks], available: [], marketplaces: [], mcp: [], skills: [], warnings: [],
  };
  let instructions = { path: 'D:\\Preview\\Stellar\\AGENTS.md', content: '请保持改动范围清晰，先核对证据再给结论。\n', revision: 'offline-1' };
  let revision = 1;
  const defaults = defaultCompactionConfiguration();
  let compaction: CompactionSettings = { ...defaults, defaultTriggerRatio: defaults.triggerRatio, revision: revision.toString(16).padStart(64, '0'),
    policy: 'v2', enabled: true, invalidConfiguration: false };
  let pinned = true;
  return {
    capabilityCatalog: async () => structuredClone(catalog),
    pluginDesktopCatalog: async () => structuredClone({ ...catalog, plugins: workbooks }),
    pluginWindowState: async () => ({ plugin: workbooks[2], preferences: preferences(),
      themeAppearance: { colors: resolveTheme(preferences().theme, true, preferences().accentColor),
        material: resolveThemeMaterial([pack], preferences().theme) } }),
    pluginDocument: async (input): Promise<PluginDocument> => {
      if (input.ref === theme.package!.ref && ['README.md', 'CHANGELOG.md'].includes(input.path)) {
        const text = input.path === 'README.md' ? '# 星辰巡航\n\n![星辰巡航](cover.png)\n\n双龙星海与石墨阅读面。'
          : `# 更新记录\n\n## ${pack.version}\n\n离线插件文档样例。`;
        return { path: input.path, text, images: { 'cover.png': cover }, links: {} };
      }
      if (!workbooks.some(plugin => plugin.package!.ref === input.ref)
        || !['README.md', 'NOTES.md'].includes(input.path)) throw new Error('离线样例文档不存在');
      return { path: input.path, text: input.path === 'README.md' ? guide : '# 校对记录\n\n本页不调用模型或操作实际文件。',
        images: {}, links: { 'NOTES.md': 'NOTES.md' } };
    },
    pluginWindowConfigure: async () => {},
    globalInstructions: async () => structuredClone(instructions),
    saveGlobalInstructions: async (content, revision) => {
      if (revision !== instructions.revision) throw new Error('离线样例内容已变化');
      instructions = { ...instructions, content, revision: `${revision}-next` };
      return structuredClone(instructions);
    },
    compactionSettings: async () => structuredClone(compaction),
    saveCompactionSettings: async input => {
      const update = validateCompactionUpdate(input);
      if (update.revision !== compaction.revision) throw new Error('compaction:conflict');
      compaction = { ...compaction, ...update.configuration, revision: (++revision).toString(16).padStart(64, '0') };
      return structuredClone(compaction);
    },
    remoteState: async () => ({ revision: 1, status: 'idle', approvalReady: false, sessions: [], projects: [] }),
    miniChatState: async () => ({ open: true, pinned }),
    miniChatPin: async value => { pinned = value; emit({ type: 'desktop_mini_chat', state: { open: true, pinned } }); return { open: true, pinned }; },
  };
}
