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

function callInput(messages: Message[], callId: string, toolName: string): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const call = message.content.find(block => block.type === 'toolCall' && block.id === callId && block.name === toolName);
    const input = call?.arguments;
    if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>;
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
  const envelope = /^Call: (\S+)\n([^\n]+)\n\n([\s\S]+?)\n\nBatch calls may ask separately\nbefore approved tools begin running\.$/.exec(rawMessage.replace(/\r\n/g, '\n'));
  if (!title || !envelope || title[3] !== envelope[1].slice(-8)) return;
  const [, callId, sourceReason, summary] = envelope;
  const toolName = title[2];
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
    sourceReason === `Policy override for ${toolName}: confirm`
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
    inputKind: 'summary', rawMessage: redactApprovalText(rawMessage),
  };
  // Never recover inputs by the short display ID or from another runtime.
  if (request.runtimeId && request.runtimeId !== runtimeId) return result;
  const input = callInput(messages, callId, toolName);
  if (!input) return result;
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
  } catch { return { ...result, input: redactApprovalText(summary), inputKind: 'summary', otherParameters: undefined }; }
  return result;
}
