// /proc/<pid>/cmdline is mutable: the pinned Step CLI sets process.title = 'step'.
// Call this only for descendants of the isolated Electron process, and compare
// canonical executable paths so an unrelated 'step' binary cannot qualify.
export function runtimeProcessKind(args, executable, expected) {
  if (executable !== expected.node) return undefined;
  if (args.includes(expected.entry)
    || (args[0] === 'step' && args.slice(1).every(arg => arg === ''))) return 'runtime';
  if (args.includes(expected.admin)) return 'admin';
  if (args.includes(expected.terminal)) return 'terminal';
  return undefined;
}
