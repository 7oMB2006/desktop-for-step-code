import { isAbsolute } from 'node:path';
import { RpcProcess, isolatedEnvironment } from './runtime';
import type { ImportJob, ImportScanOptions, ImportSelection } from '../src/session-import';

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
  get busy() { return this.running || Boolean(this.rpc?.hasPendingRequests); }
  constructor(private node: string, private entry: string, private root: string, private changed: () => void) {}
  private process() {
    if (this.closing) throw new Error('Session importer is closing');
    if (!this.rpc) {
      const rpc = new RpcProcess(event => {
        if (event.type === 'desktop_sessions_changed') this.changed();
        if (event.type === 'desktop_import_state') this.running = event.running === true;
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
  async start(input: unknown): Promise<ImportJob> {
    const selections = importSelections(input);
    const rpc = this.process();
    this.running = true;
    try { return await rpc.request('start', { selections }); }
    catch (error) {
      // Reconcile a rejected start without clearing another batch's busy state.
      await this.jobs().catch(() => {});
      throw error;
    }
  }
  async jobs(): Promise<ImportJob[]> {
    const jobs: ImportJob[] = await this.process().request('jobs');
    this.running = jobs.some(job => job.status === 'running');
    return jobs;
  }
  cancel(id: string): Promise<ImportJob> { return this.process().request('cancel', { jobId: id }); }
  async close() {
    this.closing = true;
    const rpc = this.rpc;
    if (!rpc) { this.closing = false; return; }
    try { await rpc.request('close', {}, 120000); }
    finally { await rpc.stop(); this.rpc = undefined; this.running = false; this.closing = false; }
  }
}
