export type SettingsCategory = readonly [id: string, label: string, alternateLabel: string];

const entries = [
  ['account', 'usage', '用量统计', 'Usage overview', 'token 用量 消耗'],
  ['web-search', '', '搜索顺序', 'Search order', '阶跃 Tavily Exa Brave 博查 Bocha SearXNG 降级 优先级 fallback'],
  ['browser', 'browser-profiles', '浏览器资料', 'Browser profiles', 'Cookie 登录 站点数据 sign-in storage'],
  ['browser', 'browser-presets', 'Agent 打开预设', 'Agent opening presets', '匿名 会话 站点 anonymous website'],
  ['general', 'approvalNotifications', '审批请求通知', 'Approval request notifications', '审批 提醒 banner'],
  ['general', 'completionNotifications', '任务完成通知', 'Task completion notifications', '提醒 banner'],
  ['general', 'completionSound', '完成提示音', 'Completion sound', '声音 音效 铃声 audio'],
  ['general', 'session-order', '会话排序', 'Session order', '左栏 固定顺序 最近更新 sidebar sort'],
  ['general', 'auto-session-title', '自动生成会话标题', 'Generate session titles automatically', '自动命名 首句 额度 naming quota'],
  ['general', 'session-title-model', '会话标题模型', 'Session title model', '供应商 step plan provider naming'],
  ['general', 'context-maintenance', '上下文整理', 'Context maintenance', '上下文压缩 token compaction'],
  ['general', 'speech', '语音听写', 'Voice dictation', '语音输入 麦克风 speech microphone'],
  ['general', 'network', '网络', 'Network', '代理 proxy'],
  ['general', 'language', '语言', 'Language', '中文 英文 locale'],
  ['general', 'diagnostics', '导出脱敏诊断', 'Export diagnostics', '日志 logs'],
  ['appearance', 'theme', '主题', 'Theme', '颜色 深色 浅色 dark light'],
  ['appearance', 'typography', '文字与排版', 'Typography', '字体 字号 行距 font'],
  ['about', 'build-info', '构建版本', 'Build information', 'Desktop 版本 Step Code 上游 基线 commit version'],
  ['about', 'app-updates', '版本更新', 'Updates', '检查更新 下载更新 更新通道 自动检查 installer update channel'],
] as const;

export function searchSettings(query: string, categories: readonly SettingsCategory[], language: 'zh' | 'en') {
  const normalized = query.normalize('NFKC').trim().toLowerCase();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/);
  return categories.flatMap(([category, categoryLabel, otherCategoryLabel]) =>
    [{ category, categoryLabel, anchor: '', label: categoryLabel, text: otherCategoryLabel },
      ...entries.filter(entry => entry[0] === category).map(([, anchor, zh, en, aliases]) => ({
        category, categoryLabel, anchor, label: language === 'zh' ? zh : en, text: `${zh} ${en} ${aliases}`,
      }))].flatMap(result => {
      const label = result.label.toLowerCase();
      const text = `${label} ${result.text} ${categoryLabel} ${otherCategoryLabel}`.toLowerCase();
      const ownText = `${label} ${result.text}`.toLowerCase();
      return terms.every(term => text.includes(term)) && terms.some(term => ownText.includes(term))
        ? [{ ...result, rank: label === normalized ? 0 : label.includes(normalized) ? 1 : 2 }]
        : [];
    })).sort((a, b) => a.rank - b.rank);
}
