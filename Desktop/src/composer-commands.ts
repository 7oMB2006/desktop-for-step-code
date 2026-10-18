export interface ComposerCommand { name: string; description?: string; source?: string }

// The pinned runtime handles these commands in core, outside get_commands.
const coreCommands: ComposerCommand[] = [
  { name: 'status', source: 'desktop', description: 'View current session, model, permissions and account' },
  { name: 'clm', source: 'core', description: 'Inspect working context; on, off, diff or reset' },
  { name: 'clm-compact', source: 'core', description: 'Organize working context with optional retention instructions' },
];

export function isStatusCommand(message: string, attachments = 0, quotes = 0): boolean {
  return message.trim() === '/status' && attachments === 0 && quotes === 0;
}

export function desktopCommands(commands: ComposerCommand[]): ComposerCommand[] {
  const names = new Set(coreCommands.map(command => command.name));
  return [
    ...commands.filter(command => !command.name.startsWith('_desktop_') && !names.has(command.name)),
    ...coreCommands.map(command => ({ ...command })),
  ];
}
