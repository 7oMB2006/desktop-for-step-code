export type SettingsCategory = readonly [id: string, label: string, alternateLabel: string];

const entries = [
  ['account', 'usage', '用量统计', 'Usage overview', 'token 用量 消耗'],
  ['general', 'approvalNotifications', '审批请求通知', 'Approval request notifications', '审批 提醒 banner'],
  ['general', 'completionNotifications', '任务完成通知', 'Task completion notifications', '提醒 banner'],
  ['general', 'completionSound', '完成提示音', 'Completion sound', '声音 音效 铃声 audio'],
  ['general', 'session-order', '会话排序', 'Session order', '左栏 固定顺序 最近更新 sidebar sort'],
  ['general', 'context-maintenance', '上下文整理', 'Context maintenance', '上下文压缩 token compaction'],
  ['general', 'speech', '语音听写', 'Voice dictation', '语音输入 麦克风 speech microphone'],
  ['general', 'network', '网络', 'Network', '代理 proxy'],
  ['general', 'language', '语言', 'Language', '中文 英文 locale'],
  ['general', 'diagnostics', '导出脱敏诊断', 'Export diagnostics', '日志 logs'],
  ['appearance', 'theme', '主题', 'Theme', '颜色 深色 浅色 dark light'],
  ['appearance', 'typography', '文字与排版', 'Typography', '字体 字号 行距 font'],
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
