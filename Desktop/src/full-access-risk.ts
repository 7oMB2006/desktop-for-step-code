import type { UIRequest } from './contracts';

const options = [
  'Yes, continue anyway \u2014 apply full access for this session',
  "Yes, and don't ask again \u2014 enable full access and remember this choice",
  'Cancel \u2014 go back without enabling full access',
] as const;

export function isFullAccessRisk(request: { method?: unknown; title?: unknown; options?: unknown }): boolean {
  const choices = request.options;
  return request.method === 'select' && typeof request.title === 'string' && request.title.startsWith('Enable full access?\n\n')
    && Array.isArray(choices) && choices.length === options.length && options.every((value, index) => choices[index] === value);
}

export function fullAccessRiskPresentation(request: UIRequest | undefined, language: string) {
  if (!request || !isFullAccessRisk(request)) return undefined;
  const zh = language === 'zh';
  return {
    title: zh ? '启用完全访问？' : 'Enable full access?',
    message: zh
      ? '启用后，Agent 可以修改电脑上的文件、执行命令和访问网络，包括危险或无法可靠分析的命令，不再逐次请求批准。这会显著增加数据丢失、信息泄露和意外行为的风险。请仅在可信环境中启用。显式设置的工具禁用和确认规则仍然生效。'
      : 'The agent can edit files, run commands and access the network without individual approvals, including dangerous or unanalyzable commands. This significantly increases the risk of data loss, leaks and unexpected behavior. Enable only in trusted environments. Explicit tool deny and confirm rules still apply.',
    labels: zh ? ['仅本会话启用', '启用并记住选择', '取消，保持当前权限']
      : ['Enable for this session', 'Enable and remember', 'Cancel, keep current permissions'],
  };
}
