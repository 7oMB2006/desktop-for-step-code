import { isAbsolute, join } from 'node:path';
import { open } from 'node:fs/promises';
import { RpcProcess, isolatedEnvironment } from './runtime';
import type { ImportJob, ImportScanOptions, ImportSelection, ImportStartOptions } from '../src/session-import';

export function importStartOptions(input: unknown): ImportStartOptions {
  if (input === undefined) return { addProjects: false };
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => key !== 'addProjects')
    || typeof (input as ImportStartOptions).addProjects !== 'boolean') throw new Error('Invalid import grouping options');
  return { addProjects: (input as ImportStartOptions).addProjects };
}

export async function importedProjectDirectory(root: string, sessionId: string): Promise<string> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/.test(sessionId))
    throw new Error('Invalid imported session ID');
  const file = await open(join(root, 'sessions', 'imported', `${sessionId}.jsonl`), 'r');
  try {
    // Only the native header is needed, even when a transcript is many megabytes.
    const buffer = Buffer.alloc(64 * 1024);
    let length = 0;
    let end = -1;
    while (length < buffer.length && end < 0) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
      end = buffer.subarray(0, length).indexOf(10);
    }
    if (end < 0) throw new Error('Invalid imported session header');
    const header = JSON.parse(buffer.toString('utf8', 0, end));
    if (header.type !== 'session' || header.id !== sessionId
      || !boundedText(header.cwd, 4096) || !isAbsolute(header.cwd)) throw new Error('Invalid imported directory');
    return header.cwd;
  } finally { await file.close(); }
}

const boundedText = (value: unknown, max: number) => typeof value === 'string' && value.length > 0
  && value.length <= max && !value.includes('\0');
export function importEnvironment(root: string, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set(['SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP',
    'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']);
  return isolatedEnvironment(root, Object.fromEntries(Object.entries(parent).filter(([key]) => allowed.has(key.toUpperCase()))));
}
export function importScanOptions(input: unknown): ImportScanOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid import options');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['codexRoot', 'claudeRoot', 'includeArchived'].includes(key))
    || value.includeArchived !== undefined && typeof value.includeArchived !== 'boolean') throw new Error('Invalid import options');
  for (const key of ['codexRoot', 'claudeRoot'])
    if (value[key] !== undefined && (!boundedText(value[key], 4096) || !isAbsolute(value[key] as string)))
      throw new Error('Choose an absolute source directory');
  return value as ImportScanOptions;
}
export function importSelections(input: unknown): ImportSelection[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) throw new Error('Select 1 to 100 reviewed sessions');
  const seen = new Set<string>();
  return input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !boundedText(value.candidateId, 80) || !/^[a-f0-9]{64}$/.test(value.fingerprint)
      || !boundedText(value.cwd, 4096) || !isAbsolute(value.cwd) || seen.has(value.candidateId))
      throw new Error('Invalid selection. Preview each session and choose its destination project');
    seen.add(value.candidateId);
    return { candidateId: value.candidateId, fingerprint: value.fingerprint, cwd: value.cwd };
  });
}

export class SessionImports {
  private rpc?: RpcProcess;
  private closing = false;
  private running = false;
  private projectSelections = new Map<string, Set<string>>();
  private projectWrites: Promise<void> = Promise.resolve();
  get busy() { return this.running || Boolean(this.rpc?.hasPendingRequests); }
  constructor(private node: string, private entry: string, private root: string, private changed: () => void,
    private addProjects: (sessionIds: string[]) => Promise<void> = async () => {}) {}
  private reconcile(jobs: ImportJob[]) {
    const write = this.projectWrites.catch(() => {}).then(async () => {
      for (const job of jobs) {
        const selections = this.projectSelections.get(job.id);
        if (!selections) continue;
        const saved = job.results.filter(result => result.sessionId && (result.status === 'imported' || result.status === 'skipped'))
          .filter(result => selections.has(result.candidateId));
        if (saved.length) {
          await this.addProjects([...new Set(saved.map(result => result.sessionId!))]);
          for (const result of saved) selections.delete(result.candidateId);
          this.changed();
        }
        if (job.status !== 'running') this.projectSelections.delete(job.id);
      }
    });
    this.projectWrites = write;
    return write;
  }
  private process() {
    if (this.closing) throw new Error('Session importer is closing');
    if (!this.rpc) {
      const rpc = new RpcProcess(event => {
        if (event.type === 'desktop_sessions_changed') this.changed();
        if (event.type === 'desktop_import_state') {
          this.running = event.running === true;
          if (!this.running) void this.jobs().catch(() => {});
        }
        if (event.type === 'desktop_exit' && this.rpc === rpc) { this.rpc = undefined; this.running = false; }
      });
      // No credentials are needed for offline history migration.
      rpc.start(this.node, this.entry, this.root, importEnvironment(this.root));
      this.rpc = rpc;
    }
    return this.rpc;
  }
  scan(input: unknown) { return this.process().request('scan', { options: importScanOptions(input) }, 120000); }
  preview(id: string) { return this.process().request('preview', { candidateId: id }, 120000); }
  async start(input: unknown, options?: unknown): Promise<ImportJob> {
    const selections = importSelections(input);
    const grouping = importStartOptions(options);
    const rpc = this.process();
    this.running = true;
    try {
      const job: ImportJob = await rpc.request('start', { selections });
      if (grouping.addProjects) this.projectSelections.set(job.id,
        new Set(selections.map(selection => selection.candidateId)));
      // The job is already accepted. A project-write failure must not invite a second start.
      await this.reconcile([job]).catch(() => {});
      return job;
    }
    catch (error) {
      // Reconcile a rejected start without clearing another batch's busy state.
      await this.jobs().catch(() => {});
      throw error;
    }
  }
  async jobs(): Promise<ImportJob[]> {
    const jobs: ImportJob[] = await this.process().request('jobs');
    this.running = jobs.some(job => job.status === 'running');
    await this.reconcile(jobs);
    return jobs;
  }
  cancel(id: string): Promise<ImportJob> { return this.process().request('cancel', { jobId: id }); }
  async close() {
    this.closing = true;
    const rpc = this.rpc;
    if (!rpc) { this.closing = false; return; }
    try {
      await rpc.request('close', {}, 120000);
      const jobs: ImportJob[] = await rpc.request('jobs');
      await this.reconcile(jobs);
    }
    finally { await rpc.stop(); this.rpc = undefined; this.running = false; this.closing = false; }
  }
}
