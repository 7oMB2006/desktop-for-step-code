export type RemoteCommand =
  | { type: 'message'; text: string }
  | { type: 'help' | 'projects' | 'current' | 'disconnect' }
  | { type: 'sessions'; page: number }
  | { type: 'select'; ref: string }
  | { type: 'new'; ref?: string }
  | { type: 'status' | 'stop'; ref?: string }
  | { type: 'invalid' };

// Remote control is a whitelist, never a passthrough to runtime slash commands.
export function parseRemoteCommand(text: string): RemoteCommand {
  const value = text.trim();
  if (!value.startsWith('/')) return { type: 'message', text };
  const [raw, ...args] = value.split(/\s+/);
  let name = raw.slice(1).toLowerCase();
  if (name === 'session') {
    const sub = args[0]?.toLowerCase();
    if (!sub || sub === 'list') { name = 'sessions'; if (sub) args.shift(); }
    else if (['new', 'current', 'switch'].includes(sub)) { name = sub; args.shift(); }
    else name = 'switch';
  }
  if (['sessions', 'list'].includes(name)) {
    if (args.length > 1 || args[0] !== undefined && !/^[1-9]\d{0,3}$/.test(args[0])) return { type: 'invalid' };
    return { type: 'sessions', page: args[0] ? Number(args[0]) : 1 };
  }
  if (name === 'switch') return args.length === 1 && args[0].length <= 200 ? { type: 'select', ref: args[0] } : { type: 'invalid' };
  if (['new', 'status', 'stop'].includes(name))
    return args.length <= 1 && (args[0]?.length ?? 0) <= 200
      ? { type: name as 'new' | 'status' | 'stop', ref: args[0] } : { type: 'invalid' };
  if (['help', 'projects', 'current', 'disconnect'].includes(name) && !args.length)
    return { type: name as 'help' | 'projects' | 'current' | 'disconnect' };
  return { type: 'invalid' };
}
