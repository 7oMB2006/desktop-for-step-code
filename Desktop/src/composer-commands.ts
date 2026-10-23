export interface ComposerCommand { name: string; description?: string; source?: string }

// The pinned runtime handles these commands in core, outside get_commands.
const coreCommands: ComposerCommand[] = [
  { name: 'status', source: 'desktop', description: 'View current session, model, permissions and account' },
  { name: 'plugin', source: 'desktop', description: 'Browse and manage upstream plugins and marketplaces' },
  { name: 'mcp', source: 'desktop', description: 'Manage MCP servers' },
  { name: 'skills', source: 'desktop', description: 'Manage installed Skills' },
  { name: 'clm', source: 'core', description: 'Inspect working context; on, off, diff or reset' },
  { name: 'clm-compact', source: 'core', description: 'Organize working context with optional retention instructions' },
];
const localCommands: ComposerCommand[] = [
  { name: 'trust', source: 'desktop', description: 'Approve project trust for future runtime launches' },
  { name: 'compact', source: 'desktop', description: 'Compact the current conversation with optional retention instructions' },
];

export function isStatusCommand(message: string, attachments = 0, quotes = 0): boolean {
  return message.trim() === '/status' && attachments === 0 && quotes === 0;
}

export function desktopCommand(message: string, attachments = 0, quotes = 0) {
  if (attachments || quotes) return;
  const match = /^\/(status|usage|cron|compact)(?:\s+([\s\S]*))?$/.exec(message.trim());
  if (!match) return;
  const name = match[1], args = match[2]?.trim() ?? '';
  if ((name === 'status' || name === 'cron') && args) return;
  if (name === 'usage' && args && !['overview', 'account'].includes(args)) return;
  return { name, args };
}

export function desktopCommands(commands: ComposerCommand[]): ComposerCommand[] {
  const names = new Set([...coreCommands, ...localCommands].map(command => command.name));
  return [
    ...commands.filter(command => !command.name.startsWith('_desktop_') && !names.has(command.name)),
    ...coreCommands.map(command => ({ ...command })),
    ...localCommands.map(command => ({ ...command })),
  ];
}
