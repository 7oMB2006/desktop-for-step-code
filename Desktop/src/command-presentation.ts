import { Activity, BookOpen, ChartBar, Clock3, Command, Cpu, FileText, Goal, Lightbulb, ListTodo, MessageSquare, Minimize2, Network, Plug, Shield, Sparkles } from 'lucide-react';
import { McpIcon } from './McpIcon';
import type { ComposerCommand } from './composer-commands';

const builtins = {
  status: { labels: ['会话状态', 'Session status'], description: '查看当前模型、权限、目录与账户状态', Icon: Activity },
  usage: { labels: ['用量统计', 'Usage'], description: '查看用量统计；account 打开账户与额度', Icon: ChartBar },
  goal: { labels: ['目标', 'Goal'], description: '查看或设置持续推进的目标', Icon: Goal },
  plan: { labels: ['计划模式', 'Plan mode'], description: '进入或退出计划模式', Icon: Lightbulb },
  todos: { labels: ['推进清单', 'Tasks'], description: '查看当前会话的任务清单', Icon: ListTodo },
  todo: { labels: ['推进清单', 'Tasks'], description: '查看当前会话的任务清单', Icon: ListTodo },
  workflows: { labels: ['工作流', 'Workflows'], description: '查看已保存的工作流与近期运行记录', Icon: Network },
  ultracode: { labels: ['多代理编排', 'Ultracode'], description: '开启、关闭或查看多代理编排', Icon: Network },
  ultraloop: { labels: ['多代理编排', 'Ultraloop'], description: '开启、关闭或查看多代理编排', Icon: Network },
  compact: { labels: ['压缩上下文', 'Compact context'], description: '压缩当前对话，可补充保留重点', Icon: Minimize2 },
  init: { labels: ['项目指引', 'Project instructions'], description: '创建或更新项目 AGENTS.md', Icon: FileText },
  cron: { labels: ['定时任务', 'Scheduled tasks'], description: '打开定时任务；带参数时使用运行时指令', Icon: Clock3 },
  plugin: { labels: ['插件', 'Plugins'], description: '查看与管理 Step Code 插件', Icon: Plug },
  mcp: { labels: ['MCP', 'MCP'], description: '查看与管理服务器', Icon: McpIcon },
  model: { labels: ['模型', 'Model'], description: '选择模型与思考档位', Icon: Cpu },
  permissions: { labels: ['访问权限', 'Permissions'], description: '调整此会话的权限', Icon: Shield },
  clm: { labels: ['工作上下文', 'Working context'], description: '查看状态；支持 on、off、diff、reset', Icon: Command },
  'clm-compact': { labels: ['整理工作上下文', 'Organize working context'], description: '整理工作上下文，可补充需要保留的重点', Icon: Command },
  trust: { labels: ['项目信任', 'Project trust'], description: '确认项目信任，保存后重启运行时生效', Icon: Shield },
  feedback: { labels: ['反馈', 'Feedback'], description: '向 Step Code 提交反馈；提交前确认上传内容', Icon: MessageSquare },
} as const;

export function commandPresentation(command: ComposerCommand, zh: boolean) {
  const sourceIcon = command.source === 'skill' ? BookOpen : command.source === 'prompt' ? Sparkles : undefined;
  const builtin = sourceIcon ? undefined : builtins[command.name as keyof typeof builtins];
  return {
    title: builtin?.labels[zh ? 0 : 1] ?? command.name,
    detail: zh ? builtin?.description ?? command.description ?? '' : command.description ?? '',
    Icon: sourceIcon ?? builtin?.Icon ?? Command,
  };
}
