export async function finalizeCapabilityDiagnostics(operationError, cleanups, report) {
  const failures = [];
  for (const [name, cleanup] of cleanups) {
    try { await cleanup(); }
    catch (error) { failures.push({ name, error }); }
  }
  await report({
    passed: !operationError && failures.length === 0,
    cleanupConfirmed: failures.length === 0,
    failurePhase: operationError ? 'operation' : failures.length ? 'cleanup' : undefined,
    cleanupFailures: failures.map(failure => failure.name),
  });
  const errors = [...(operationError ? [operationError] : []), ...failures.map(failure => failure.error)];
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Capability diagnostics or cleanup failed');
}
