const codes = new Set([
  'invalid-input', 'already-exists', 'not-found', 'stale', 'plugin-conflict',
  'invalid-configuration', 'stale-configuration', 'configuration-schema-changed',
  'configuration-consumer-conflict', 'invalid-path', 'read-only', 'too-large',
  'marketplace-failed', 'profile-isolation', 'resource-in-use', 'storage',
  'invalid-presentation', 'update-capabilities-changed', 'update-recovery-required',
  'operation-failed', 'busy', 'workspace-busy', 'session-busy', 'remote-attached',
  'side-question-active', 'background-active', 'goal-active', 'messages-queued',
  'runtime-unavailable', 'access-denied', 'operation-denied', 'file-in-use',
  'directory-not-empty',
  'management-unavailable', 'management-committed', 'management-uncertain', 'scheduled-work',
  'marketplace-network', 'marketplace-dns', 'marketplace-proxy', 'marketplace-tls',
  'marketplace-auth', 'marketplace-source-unavailable', 'marketplace-git-missing',
  'marketplace-permission', 'marketplace-locked', 'marketplace-conflict',
  'marketplace-timeout', 'marketplace-cancelled', 'marketplace-output-limit',
]);

const idleFailures = new Map([
  ['Shared settings operation in progress', 'busy'],
  ['Undo in progress', 'busy'],
  ['Workspace operation in progress', 'workspace-busy'],
  ['Session operation in progress', 'session-busy'],
  ['Unbind Remote before changing this session runtime', 'remote-attached'],
  ['Finish or cancel the side question first', 'side-question-active'],
  ['Stop background agents before changing this session runtime', 'background-active'],
  ['Pause the active goal first', 'goal-active'],
  ['Send or withdraw the pending messages first', 'messages-queued'],
  ['Stop this session task first', 'session-busy'],
  ['Runtime is not connected', 'runtime-unavailable'],
  ['Runtime timed out: get_state', 'runtime-unavailable'],
]);

const filesystemFailures = new Map([
  ['EACCES', 'access-denied'], ['EPERM', 'operation-denied'],
  ['EBUSY', 'file-in-use'], ['ENOTEMPTY', 'directory-not-empty'],
  ['ENOENT', 'not-found'],
]);

// Only fixed codes cross RPC or enter diagnostics; raw errors can contain secrets.
export function capabilityFailureCode(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    if (codes.has(error.code)) return error.code;
    const filesystem = filesystemFailures.get(error.code);
    if (filesystem) return filesystem;
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const explicit = /^capability:([a-z-]+)$/u.exec(message)?.[1];
  if (explicit && codes.has(explicit)) return explicit;
  return idleFailures.get(message) ?? 'operation-failed';
}

// Classify locally; neither subprocess output nor upstream warning text leaves here.
export function marketplaceFailureCode(error, signal) {
  if (signal?.aborted) return signal.reason?.name === 'TimeoutError'
    ? 'marketplace-timeout' : 'marketplace-cancelled';
  const code = error?.code;
  if (code === 'ENOENT') return 'marketplace-git-missing';
  if (code === 'EACCES' || code === 'EPERM') return 'marketplace-permission';
  if (code === 'EBUSY') return 'marketplace-locked';
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'marketplace-output-limit';
  if (code === 'ETIMEDOUT' || error?.killed === true) return 'marketplace-timeout';
  const text = (Array.isArray(error) ? error.filter(value => typeof value === 'string').join('\n')
    : `${typeof error?.stderr === 'string' ? error.stderr : ''}\n${typeof error?.message === 'string' ? error.message : ''}`)
    .slice(-65536);
  if (/could not resolve proxy|failed to connect to .*proxy|proxy connect (?:aborted|failed)|proxy authentication required|HTTP code 407/iu.test(text))
    return 'marketplace-proxy';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code) || /could not resolve host|name or service not known|temporary failure in name resolution/iu.test(text))
    return 'marketplace-dns';
  if (/SSL certificate problem|server certificate verification failed|unable to get local issuer certificate|certificate verify failed|schannel:.*(?:certificate|CERT_)/iu.test(text))
    return 'marketplace-tls';
  if (/authentication failed|could not read (?:Username|Password)|terminal prompts disabled|permission denied \(publickey\)|HTTP (?:code |error )?(?:401|403)\b|requested URL returned error: (?:401|403)\b/iu.test(text))
    return 'marketplace-auth';
  if (/repository .+ not found|does not appear to be a git repository|could not read from remote repository/iu.test(text))
    return 'marketplace-source-unavailable';
  if (/another git process|cannot lock ref|unable to create .+\.lock|\.lock['": ]+.*file exists/iu.test(text))
    return 'marketplace-locked';
  if (/permission denied|access is denied|insufficient permission|operation not permitted/iu.test(text))
    return 'marketplace-permission';
  if (/not possible to fast-forward|divergent branches|would be overwritten by merge|need to specify how to reconcile|^CONFLICT\b/imu.test(text))
    return 'marketplace-conflict';
  if (/timed out|timeout was reached/iu.test(text)) return 'marketplace-timeout';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)
    || /failed to connect|connection (?:reset|refused|aborted)|network is unreachable|could not connect|TLS connection was non-properly terminated|HTTP\/2 stream|RPC failed; curl/iu.test(text))
    return 'marketplace-network';
  return 'marketplace-failed';
}

const gitSystemCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'ETIMEDOUT',
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH',
  'ABORT_ERR', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']);
const gitSignals = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP']);

export function capabilityFailureDetails(error) {
  const value = error?.details;
  if (!value || value.operation !== 'marketplace-refresh') return undefined;
  return {
    operation: 'marketplace-refresh',
    elapsedMs: Number.isSafeInteger(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs <= 3600000
      ? value.elapsedMs : null,
    gitExitCode: Number.isSafeInteger(value.gitExitCode) && value.gitExitCode >= 0 && value.gitExitCode <= 255
      ? value.gitExitCode : null,
    gitSignal: gitSignals.has(value.gitSignal) ? value.gitSignal : null,
    gitSystemCode: gitSystemCodes.has(value.gitSystemCode) ? value.gitSystemCode : null,
  };
}
