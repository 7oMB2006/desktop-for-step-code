import type { FileOpenResult, FilePreviewData, FileTarget } from '../../src/contracts';

const text = [
  '# 星辰巡航',
  '',
  '> 离线文件样例，不读取磁盘，也不启动外部应用。',
  '',
  '## 工作区场景',
  '',
  '场景由工作区持有。切换会话时复用渲染器，进入阅读状态后降低运动强度。',
  '',
  '| 状态 | 行为 |',
  '| --- | --- |',
  '| 阅读消息 | 保持背景安静 |',
  '| 切换会话 | 复用场景资源 |',
  '| 窗口隐藏 | 暂停渲染 |',
  '',
  '## 生命周期',
  '',
  '```ts',
  'const speed = reading ? 12 : 45;',
  'scene.configure({ ...settings, speed });',
  '```',
  '',
  '- 保留原版控件尺寸。',
  '- 更换主题后释放渲染资源。',
  '- 减少动态效果时保留静态星海。',
  '',
].join('\n');

export const themePreviewFile: FilePreviewData = {
  id: 'offline-stellar-notes', name: 'stellar-notes.md', path: 'D:\\Preview\\Stellar\\stellar-notes.md',
  mode: 'markdown', language: 'markdown', text, size: new TextEncoder().encode(text).length,
};

// A single in-memory grant, not a fixture that silently accepts arbitrary native paths.
export function openThemePreviewFile(target?: FileTarget, destination?: string): FileOpenResult {
  if (destination && destination !== 'preview') throw new Error('离线样例只支持内置预览');
  if (target && ('grantId' in target ? target.grantId !== themePreviewFile.id
    : !['stellar-notes.md', themePreviewFile.path].includes(target.path))) {
    throw new Error('此文件不在离线样例中');
  }
  return { destination: 'preview', file: { ...themePreviewFile } };
}
