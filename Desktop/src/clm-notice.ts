export function clmNotice(message: string, language: 'zh' | 'en'): string {
  const status = /^CLM revision (\d+); ~(\d+) context tokens\.\nIndex: [^\r\n]+\nMirror: [^\r\n]+\nArchive: [^\r\n]+$/.exec(message);
  if (status) {
    const tokens = Number(status[2]).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
    return language === 'zh' ? `工作上下文 · 修订 ${status[1]} · 约 ${tokens} tokens` : `Working context · Revision ${status[1]} · ~${tokens} tokens`;
  }
  return message;
}
