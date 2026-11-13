export function residueTestSafetyIssues(input: {
  disposableAccountAcknowledged: boolean;
  protectedPaths: Array<{ label: string; path: string; exists: boolean }>;
  uninstallEntries: number | null;
  appRunning: boolean | null;
  runtimeOverrides?: string[];
}): string[];
