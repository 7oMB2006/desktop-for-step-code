export function pluginWindowMethodAllowed(method: unknown, args: unknown[], ref: string) {
  if (method === 'pluginWindowState' || method === 'pluginWindowConfigure') return args.length === 0;
  if (method === 'windowControl') return args.length === 1
    && ['state', 'minimize', 'toggleMaximize', 'close'].includes(args[0] as string);
  if (method !== 'pluginDocument' || args.length !== 1) return false;
  const input = args[0];
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    && (input as { ref?: unknown }).ref === ref && typeof (input as { path?: unknown }).path === 'string';
}
