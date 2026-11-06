import type { CapabilityPlugin, PluginPackage } from './capabilities';

const categoryLabels: Record<string, readonly [string, string]> = {
  development: ['开发辅助', 'Development'],
  research: ['搜索研究', 'Search & research'],
  'text-documents': ['文本与文档', 'Text & documents'],
  knowledge: ['知识管理', 'Knowledge management'],
  'audio-video': ['音视频', 'Audio & video'],
  'image-design': ['图像与设计', 'Images & design'],
  automation: ['效率自动化', 'Automation'],
  themes: ['界面主题', 'Themes'],
};
export function pluginCategoryLabel(category: string, language: string): string | undefined {
  return Object.hasOwn(categoryLabels, category) ? categoryLabels[category][language === 'zh' ? 0 : 1] : undefined;
}
export function pluginClassificationText(pkg?: Pick<PluginPackage, 'categories' | 'keywords'>): string {
  return [...(pkg?.categories ?? []).flatMap(category =>
    [category, pluginCategoryLabel(category, 'zh') ?? '', pluginCategoryLabel(category, 'en') ?? '']),
    ...(pkg?.keywords ?? [])].join(' ');
}

// Translate bundled legacy copy by exact text, never by a third-party plugin's ID.
const legacyDescriptions = new Map([
  ['Evidence-aware Bilibili research. Follow the DFSC session account/model with confirmation, or choose independent configuration. Requires a separately installed BVR runtime.',
    '结合字幕、语音与画面研究哔哩哔哩视频。可经确认跟随 DFSC 会话账户与模型，或使用独立配置；需另行准备 BVR 运行环境。'],
  ['Browser automation and end-to-end testing MCP server by Microsoft. Drives web pages, takes screenshots, fills forms, clicks elements and runs automated browser test flows.',
    'Microsoft 提供的浏览器自动化与端到端测试 MCP 服务，支持网页操作、截图、表单填写和浏览器测试。'],
  ["Deploy and manage static sites on StepFun's Page hosting product. Publishes a local directory or .zip, lists sites and versions, promotes or rolls back a release, and mints shareable preview links.",
    '在 StepFun Page 发布和管理静态网站。支持上传本地目录或 ZIP、查看站点与版本、发布与回滚，以及生成预览链接。'],
]);

export function pluginPresentation<T extends { description?: string; package?: PluginPackage }>(plugin: T, language: string): T {
  const locale = plugin.package?.locales?.[language === 'zh' ? 'zh' : 'en'];
  return { ...plugin,
    description: locale?.description ?? (language === 'zh' ? legacyDescriptions.get(plugin.description ?? '') : undefined) ?? plugin.description,
    package: plugin.package && { ...plugin.package, documentation: { ...plugin.package.documentation, ...locale?.documentation } },
  };
}

export function pluginSourceLabel(plugin: Pick<CapabilityPlugin, 'marketplace' | 'installationSource'>, language: string) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const source = plugin.installationSource;
  if (source?.status === 'conflict') return t('来源冲突', 'Source conflict');
  if (source?.status === 'matched' && source.marketplaces.length)
    return `${t('匹配市场', 'Matching marketplace')} · ${source.marketplaces.join(' / ')}`;
  const recorded = source?.status === 'recorded' ? source.marketplaces : plugin.marketplace ? [plugin.marketplace] : [];
  return recorded.length ? `${t('市场', 'Marketplace')} · ${recorded.join(' / ')}` : t('来源未确认', 'Source unconfirmed');
}
