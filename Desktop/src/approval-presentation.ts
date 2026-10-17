import type { Message, UIRequest } from './contracts';

export interface PermissionApprovalPresentation {
  title: string;
  category: 'uncertain' | 'hazardous' | 'ordinary';
  reason: string;
  reasonCode?: string;
  toolName: string;
  callId: string;
  input: string;
  inputKind: 'command' | 'parameters' | 'summary';
  otherParameters?: string;
  rawMessage: string;
  operation: 'command' | 'file' | 'question' | 'tool';
  action: string;
  target?: string;
  preview?: string;
  previewLabel?: string;
  choices?: { label: string; description?: string }[];
  agentNote?: string;
  verificationCommand?: string;
}

const dangerousRules: Record<string, [string, string]> = {
  'recursive-force-remove': ['命令包含强制递归删除，可能不可恢复地删除文件。', 'This command includes forced recursive deletion and may irreversibly remove files.'],
  'system-lifecycle': ['命令包含系统关机或重启操作。', 'This command includes a system shutdown or restart.'],
  'format-filesystem': ['命令包含文件系统格式化，可能清除已有数据。', 'This command includes filesystem formatting and may erase existing data.'],
  'copy-device': ['命令命中了 dd 数据复制规则，可能覆盖目标数据。', 'This command matched the dd data-copy rule and may overwrite destination data.'],
  'truncate-device': ['命令包含向设备路径重定向写入，可能破坏数据。', 'This command redirects output to a device path and may damage data.'],
  'destructive-git': ['命令包含 Git 强制重置、清理或推送，可能丢失改动或覆盖远端历史。', 'This command includes a destructive Git reset, clean or push and may discard changes or overwrite remote history.'],
  'destructive-sql': ['命令包含删除数据库或清空数据表，可能不可恢复地删除数据。', 'This command includes dropping a database or truncating a table and may irreversibly delete data.'],
};

const sensitiveKey = /(?:api[-_]?key|access[-_]?key|token|secret|password|passwd|credential|cookie|authorization|client[-_]?secret|env)/i;

export function redactApprovalText(value: string): string {
  return value
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/(?<![A-Za-z0-9_$-])(["']?[A-Za-z0-9_$-]*(?:api[-_]?key|access[-_]?key|token|secret|password|passwd|credential|cookie|authorization|client[-_]?secret)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|Bearer\s+\[redacted\]|[^\s,;&]+)/gi,
      (_match, prefix: string, secret: string) => `${prefix}${/^Bearer\s+\[redacted\]$/i.test(secret) ? secret : '[redacted]'}`);
}

function redactApprovalValue(value: unknown, key?: string): unknown {
  if (key && sensitiveKey.test(key)) {
    if (key.toLowerCase() === 'env' && value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value as Record<string, unknown>).map(name => [name, '[redacted]']));
    }
    return '[redacted]';
  }
  if (typeof value === 'string') return redactApprovalText(value);
  if (Array.isArray(value)) return value.map(item => redactApprovalValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([name, item]) => [name, redactApprovalValue(item, name)]));
  }
  return value;
}

function callContext(messages: Message[], callId: string, toolName: string): { input: Record<string, unknown>; note?: string } | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const position = message.content.findIndex(block => block.type === 'toolCall' && block.id === callId && block.name === toolName);
    if (position < 0) continue;
    const input = message.content[position].arguments;
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const before = message.content.slice(0, position);
      let priorCall = -1;
      for (let cursor = before.length - 1; cursor >= 0; cursor--) {
        if (before[cursor].type === 'toolCall') { priorCall = cursor; break; }
      }
      const note = before.slice(priorCall + 1).filter(block => block.type === 'text')
        .map(block => block.text ?? '').join('\n').trim();
      return { input: input as Record<string, unknown>, note: note ? redactApprovalText(note) : undefined };
    }
  }
}

function describeOperation(result: PermissionApprovalPresentation, input: Record<string, unknown>, zh: boolean) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const text = (...keys: string[]) => {
    const value = keys.map(key => input[key]).find(value => typeof value === 'string');
    return typeof value === 'string' ? redactApprovalText(value) : undefined;
  };
  if (['run_command', 'bash', 'powershell'].includes(result.toolName)) {
    result.operation = 'command';
    result.action = t('执行以下命令', 'Execute this command');
    result.target = text('cwd', 'working_directory', 'workdir');
    result.preview = result.inputKind === 'command' ? result.input : undefined;
    result.previewLabel = t('命令', 'Command');
  } else if (['write_file', 'write', 'edit_file', 'edit'].includes(result.toolName)) {
    const write = ['write_file', 'write'].includes(result.toolName);
    result.operation = 'file';
    result.action = write ? t('写入文件', 'Write a file') : t('修改文件', 'Edit a file');
    result.target = text('path', 'file_path', 'filePath');
    if (write) result.preview = text('content');
    else {
      if (Array.isArray(input.edits) && input.edits.length && input.edits.every(edit =>
        edit && typeof edit === 'object' && typeof edit.oldText === 'string' && typeof edit.newText === 'string')) {
        result.action = `${t('修改文件', 'Edit a file')} · ${input.edits.length} ${t('处替换', 'replacements')}`;
        result.preview = input.edits.map((edit, index) =>
          `${index + 1}. ${t('替换前', 'Before')}\n${redactApprovalText(edit.oldText)}\n\n${t('替换后', 'After')}\n${redactApprovalText(edit.newText)}`).join('\n\n');
      } else if (!Array.isArray(input.edits)) {
        const before = text('search', 'oldText', 'old_text', 'old_string');
        const after = text('replace', 'newText', 'new_text', 'new_string');
        if (before !== undefined && after !== undefined) {
          result.preview = `${t('替换前', 'Before')}\n${before}\n\n${t('替换后', 'After')}\n${after}`;
        }
      }
    }
    result.previewLabel = write ? t('写入内容', 'Content to write') : t('替换内容', 'Replacement');
  } else if (result.toolName === 'clarify_user') {
    result.operation = 'question';
    result.action = t('向你发起询问', 'Ask you a question');
    result.preview = text('question');
    if (Array.isArray(input.questions) && input.questions.length) {
      result.preview = input.questions.slice(0, 12).flatMap((value, index) => {
        if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).question !== 'string') return [];
        return [`${index + 1}. ${redactApprovalText((value as { question: string }).question)}`];
      }).join('\n') || result.preview;
    }
    result.previewLabel = t('问题', 'Question');
    if (Array.isArray(input.options)) result.choices = input.options.flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const option = value as Record<string, unknown>;
      return typeof option.label === 'string' ? [{
        label: redactApprovalText(option.label),
        description: typeof option.description === 'string' ? redactApprovalText(option.description) : undefined,
      }] : [];
    });
  } else {
    result.action = `${t('调用工具', 'Call tool')} ${result.toolName}`;
    result.target = text('path', 'file_path', 'url', 'query');
  }
}

// Only adapt the known upstream permission envelope. Other extension dialogs
// keep their original content rather than receiving a guessed translation.
export function permissionApprovalPresentation(
  request: UIRequest | undefined, messages: Message[], language: string, runtimeId?: string,
): PermissionApprovalPresentation | undefined {
  if (!request || request.method !== 'confirm' || request.messageStyle === 'preformatted') return;
  const title = /^(Approve|Dangerous) (\S+) \[([^\]\r\n]+)\]$/.exec(request.title ?? '');
  const rawMessage = request.message ?? '';
  const envelope = /^Call: (\S+)\n([\s\S]+?)\n\n([^\n]+)\n\nBatch calls may ask separately\nbefore approved tools begin running\.$/.exec(rawMessage.replace(/\r\n/g, '\n'));
  if (!title || !envelope || title[3] !== envelope[1].slice(-8)) return;
  const [, callId, reasonEnvelope, summary] = envelope;
  const toolName = title[2];
  const fused = /^(?:then_run \(run_command\): )?([^\n]+)\nthen_run: ([\s\S]+)$/.exec(reasonEnvelope);
  if (fused && !['edit_file', 'write_file'].includes(toolName)) return;
  if (!fused && reasonEnvelope.includes('\n')) return;
  const sourceReason = fused?.[1] ?? reasonEnvelope;
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const analysis = /^Shell command could not be fully analyzed \(([^()\n]+)\); explicit approval is required\.$/.exec(sourceReason);
  const danger = /^Dangerous command requires confirmation \(([^()\n]+)\): /.exec(sourceReason);
  let category: PermissionApprovalPresentation['category'];
  let reason: string;
  let reasonCode: string | undefined;
  if (analysis && title[1] === 'Approve') {
    category = 'uncertain';
    reasonCode = analysis[1];
    reason = reasonCode === 'unsupported-shell'
      ? t('这条命令使用了当前分析器不支持的 Shell，无法完整分析，需要你审阅后决定是否执行。', 'This command uses a shell the analyzer does not support. It cannot fully analyze the command and needs your decision before execution.')
      : reasonCode === 'shell-configuration'
        ? t('当前 Shell 配置无法用于命令分析，需要你审阅后决定是否执行。', 'The current shell configuration cannot be used for command analysis. Review the command before deciding whether to execute it.')
        : t('分析器无法完整判断这条命令，需要你审阅后决定是否执行。', 'The analyzer could not fully analyze this command. Review it before deciding whether to execute it.');
  } else if (danger && title[1] === 'Dangerous') {
    category = 'hazardous';
    reasonCode = danger[1];
    const translation = dangerousRules[reasonCode];
    reason = translation ? translation[zh ? 0 : 1]
      : t('这条命令命中了上游的高风险规则，需要你批准后才能执行。', 'This command matched an upstream high-risk rule and needs your approval before execution.');
  } else if (title[1] === 'Approve' && (
    sourceReason === `${toolName} can modify the workspace or execute a command` ||
    sourceReason === `Policy override for ${toolName}: confirm` ||
    fused && (sourceReason === 'run_command can modify the workspace or execute a command'
      || sourceReason === 'Policy override for run_command: confirm')
  )) {
    category = 'ordinary';
    reason = t('当前权限设置要求先批准这次工具操作。', 'The current permission settings require approval for this tool call.');
  } else return;

  const commandTool = ['run_command', 'bash', 'powershell'].includes(toolName);
  const writingTool = ['write_file', 'write', 'edit_file', 'edit'].includes(toolName);
  const result: PermissionApprovalPresentation = {
    title: category === 'hazardous' ? t('高风险操作需要批准', 'Approve high-risk operation')
      : commandTool ? t('批准执行命令', 'Approve command execution')
        : writingTool ? t('批准文件修改', 'Approve file changes') : t('批准工具操作', 'Approve tool call'),
    category, reason, reasonCode, toolName, callId, input: redactApprovalText(summary),
    operation: commandTool ? 'command' : writingTool ? 'file' : 'tool',
    action: commandTool ? t('执行命令', 'Execute a command') : writingTool ? t('修改文件', 'Change a file') : `${t('调用工具', 'Call tool')} ${toolName}`,
    inputKind: 'summary', rawMessage: redactApprovalText(rawMessage),
    verificationCommand: fused ? redactApprovalText(fused[2]) : undefined,
  };
  // Never recover inputs by the short display ID or from another runtime.
  const describeFused = () => {
    if (result.verificationCommand !== undefined) result.action += t('并执行验证命令', ' and run a verification command');
  };
  if (request.runtimeId && request.runtimeId !== runtimeId) { describeFused(); return result; }
  const context = callContext(messages, callId, toolName);
  if (!context) { describeFused(); return result; }
  const { input } = context;
  result.agentNote = context.note;
  try {
    const commandKey = ['command', 'cmd', 'script'].find(key => typeof input[key] === 'string');
    if (commandKey) {
      result.input = redactApprovalText(input[commandKey] as string);
      result.inputKind = 'command';
      const other = Object.fromEntries(Object.entries(input)
        .filter(([key]) => key !== commandKey)
        .map(([key, value]) => [key, redactApprovalValue(value, key)]));
      if (Object.keys(other).length) result.otherParameters = JSON.stringify(other, null, 2);
    } else {
      result.input = JSON.stringify(redactApprovalValue(input), null, 2);
      result.inputKind = 'parameters';
    }
    describeOperation(result, input, zh);
    describeFused();
  } catch { return { ...result, input: redactApprovalText(summary), inputKind: 'summary', otherParameters: undefined }; }
  return result;
}
