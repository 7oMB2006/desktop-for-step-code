import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crashDetails, crashError, crashRecord, crashText } from './crash-log-format';

/**
 * Startup and runtime crash log.
 *
 * A community preview build that fails to start leaves the user with no evidence:
 * no log file and no phase. User data lives in %APPDATA%, separate from the
 * install directory, so reinstalling neither clears it nor explains the failure,
 * and nothing tells the user where to look. This writes one file per failure
 * into userData/logs/ and never throws while doing it: a crash handler that can
 * crash is worse than none, so every failure inside record() stays silent.
 */

export interface CrashDetails {
  exitCode?: number | string | null;
  signal?: string | null;
  stderrTail?: string;
  [key: string]: unknown;
}

/** Never-throwing stringify helpers: the log write runs while the app is dying. */
function attempt<T>(produce: () => T): T | undefined {
  try { return produce(); } catch { return undefined; }
}
export class CrashLog {
  private phase = 'starting';
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Record where the app is, so a later failure can say what it was doing. */
  setPhase(phase: string): void {
    this.phase = phase;
  }

  /** Append one crash record. Never throws; a failed write fails silently. */
  async record(kind: string, error: unknown, details: CrashDetails = {}): Promise<void> {
    try {
      const time = new Date();
      const stamp = time.toISOString().replace(/[:.]/g, '-');
      const target = join(this.root, `crash-${stamp}-${randomUUID().slice(0, 8)}.log`);
      const diagnostic = crashError(error);
      const lines = [
        `time: ${time.toISOString()}`,
        `kind: ${crashText(kind)}`,
        `phase: ${crashText(this.phase)}`,
        `version: ${crashText(attempt(() => app.getVersion()) ?? 'unknown')}`,
        `packaged: ${attempt(() => String(app.isPackaged)) ?? 'unknown'}`,
        `error: ${diagnostic.message}`,
        `stack: ${diagnostic.stack}`,
        ...crashDetails(details),
        `userData: ${crashText(attempt(() => app.getPath('userData')) ?? 'unknown')}`,
        `logs: ${crashText(this.root)}`,
      ];
      const temp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
      await mkdir(this.root, { recursive: true });
      await writeFile(temp, crashRecord(lines.join('\n') + '\n'), { flag: 'wx' });
      await rename(temp, target);
    } catch {
      // Losing the record is acceptable; a second crash from the handler is not.
    }
  }
}

/**
 * Install the handlers and return the log. Call once during early startup.
 * uncaughtException and unhandledRejection keep the existing crash semantics:
 * the app still exits, just with a file written first.
 */
export function installCrashLog(): CrashLog {
  const log = new CrashLog(join(app.getPath('userData'), 'logs'));
  process.on('uncaughtException', error => { void log.record('uncaughtException', error).then(() => app.exit(1)); });
  process.on('unhandledRejection', reason => { void log.record('unhandledRejection', reason).then(() => app.exit(1)); });
  app.on('render-process-gone', (_event, _webContents, details) => { void log.record('render-process-gone', new Error(details?.reason ?? 'renderer gone'), { ...details }); });
  app.on('child-process-gone', (_event, details) => { void log.record('child-process-gone', new Error(details?.reason ?? 'child process gone'), { ...details }); });
  return log;
}
