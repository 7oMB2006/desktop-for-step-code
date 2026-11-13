export function residueTestSafetyIssues({
  disposableAccountAcknowledged,
  protectedPaths,
  uninstallEntries,
  appRunning,
  runtimeOverrides = [],
}) {
  const issues = [];
  if (!disposableAccountAcknowledged) {
    issues.push('confirm a disposable Windows account with --disposable-account');
  }
  for (const target of protectedPaths) {
    if (target.exists) issues.push(`${target.label} already exists: ${target.path}`);
  }
  if (uninstallEntries !== 0) {
    issues.push(uninstallEntries === null
      ? 'could not verify the application uninstall registry entries'
      : `application uninstall registry entries already exist: ${uninstallEntries}`);
  }
  if (appRunning !== false) {
    issues.push(appRunning === null
      ? 'could not verify whether the application is running'
      : 'the application is currently running');
  }
  if (runtimeOverrides.length > 0) {
    issues.push(`runtime storage overrides are set: ${runtimeOverrides.join(', ')}`);
  }
  return issues;
}
