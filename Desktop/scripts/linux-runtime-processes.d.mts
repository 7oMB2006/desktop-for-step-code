export function runtimeProcessKind(args: readonly string[], executable: string, expected: {
  node: string;
  entry: string;
  admin: string;
  terminal: string;
}): 'runtime' | 'admin' | 'terminal' | undefined;
