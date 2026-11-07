export type CommandOutcome = {
  status: 'exited' | 'timed_out' | 'signaled' | 'canceled' | 'unknown';
  exitCode: number | null;
  signal: string | null;
  timeoutSeconds?: number;
};

export function readCommandOutcome(value: unknown): CommandOutcome | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (typeof row.status !== 'string' || !['exited', 'timed_out', 'signaled', 'canceled', 'unknown'].includes(row.status)) return;
  const exitCode = row.exitCode ?? null;
  const signal = row.signal ?? null;
  if (exitCode !== null && !(typeof exitCode === 'number' && Number.isSafeInteger(exitCode))) return;
  if (signal !== null && !(typeof signal === 'string' && signal.length <= 80 && !/[\r\n]/.test(signal))) return;
  if (row.timeoutSeconds !== undefined
    && !(typeof row.timeoutSeconds === 'number' && Number.isFinite(row.timeoutSeconds) && row.timeoutSeconds >= 0)) return;
  if (row.status === 'exited' && exitCode === null || row.status === 'signaled' && !signal) return;
  return { status: row.status as CommandOutcome['status'], exitCode: exitCode as number | null,
    signal: signal as string | null, ...(row.timeoutSeconds === undefined ? {} : { timeoutSeconds: row.timeoutSeconds as number }) };
}

export function commandOutcomePresentation(outcome: CommandOutcome, language: 'zh' | 'en', check = false) {
  const zh = language === 'zh';
  const subject = check ? zh ? '验证' : 'Check' : zh ? '命令' : 'Command';
  const signal = outcome.signal ? ` · ${zh ? '信号' : 'signal'} ${outcome.signal}` : '';
  const code = outcome.exitCode !== null ? ` · ${zh ? '退出码' : 'exit'} ${outcome.exitCode}` : '';
  switch (outcome.status) {
    case 'exited':
      return outcome.exitCode === 0
        ? { state: 'done' as const, label: `${subject}${zh ? '通过' : ' passed'}` }
        : { state: 'failed' as const, label: `${subject}${zh ? '失败' : ' failed'}${code}` };
    case 'timed_out':
      return { state: 'failed' as const, label: `${subject}${zh ? '超时' : ' timed out'}${
        outcome.timeoutSeconds === undefined ? '' : ` · ${outcome.timeoutSeconds}s`}${signal}${code}` };
    case 'signaled':
      return { state: 'failed' as const, label: `${subject}${zh ? '被信号终止' : ' terminated'}${signal}${code}` };
    case 'canceled':
      return { state: 'stopped' as const, label: `${subject}${zh ? '已取消' : ' cancelled'}${signal}${code}` };
    default:
      return { state: 'unknown' as const, label: `${subject}${zh ? '结果未知' : ' outcome unknown'}` };
  }
}
