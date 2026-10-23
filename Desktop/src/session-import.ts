export type ImportSource = 'codex' | 'claude-code';
export interface ImportCandidate {
  id: string; source: ImportSource; sessionId: string; title: string; cwd: string;
  modified: string; archived: boolean; version: string;
}
export interface ImportPreview extends ImportCandidate {
  fingerprint: string; messageCount: number; toolCount: number;
  warnings: { code: string; count: number }[]; excerpt: string;
}
export interface ImportSelection { candidateId: string; fingerprint: string; cwd: string }
export interface ImportStartOptions { addProjects: boolean }
export interface ImportResult {
  candidateId: string; title?: string; status: 'imported' | 'skipped' | 'failed';
  sessionId?: string; error?: string; warning?: string;
}
export interface ImportJob {
  id: string; createdAt: string; status: 'running' | 'completed' | 'cancelled' | 'interrupted';
  total: number; results: ImportResult[];
}
export interface ImportScanOptions { codexRoot?: string; claudeRoot?: string; includeArchived?: boolean }
export interface ImportScanResult {
  candidates: ImportCandidate[]; errors: { source: ImportSource; message: string }[];
}
export interface SessionImportBridge {
  importScan(options: ImportScanOptions): Promise<ImportScanResult>;
  importPreview(candidateId: string): Promise<ImportPreview>;
  importStart(selections: ImportSelection[], options?: ImportStartOptions): Promise<ImportJob>;
  importJobs(): Promise<ImportJob[]>;
  importCancel(id: string): Promise<ImportJob>;
  importChooseDirectory(): Promise<string | null>;
}

export function importWarning(code: string, language: string): string {
  const labels: Record<string, [string, string]> = {
    attachment_missing: ['部分附件缺失或不受支持', 'Some attachments are missing or unsupported'],
    unsupported_content: ['部分内容仅保留为历史文本或未迁移', 'Some content is historical text only or omitted'],
    encrypted_reasoning_excluded: ['加密思考未迁移', 'Encrypted reasoning was not imported'],
    branch_parent_missing: ['来源消息链有缺失', 'The source message chain is incomplete'],
    source_compaction: ['来源经过压缩，可能不含全部历史', 'The source was compacted and may not contain all history'],
    claude_compaction: ['Claude 压缩边界未重建，仅迁移可恢复的消息链', 'Claude compaction boundaries were not reconstructed; only the recoverable message chain is imported'],
    source_instructions_excluded: ['来源系统指令未激活', 'Source system instructions were not activated'],
    tool_arguments_as_text: ['工具参数保留为原始文本', 'Tool arguments are preserved as raw text'],
    rolled_back_history: ['已按来源回退边界恢复历史', 'History follows the source rollback boundary'],
    unsupported_item: ['部分记录类型不受支持', 'Some record types are unsupported'],
    child_history_excluded: ['子代理记录未迁移', 'Child-agent history was excluded'],
    tool_result_missing: ['部分历史工具未记录结果', 'Some historical tools have no recorded result'],
    tool_call_missing: ['部分历史结果缺少对应调用', 'Some historical results have no matching call'],
  };
  return labels[code]?.[language === 'zh' ? 0 : 1] ?? (language === 'zh' ? `兼容性提示：${code}` : `Compatibility: ${code}`);
}
