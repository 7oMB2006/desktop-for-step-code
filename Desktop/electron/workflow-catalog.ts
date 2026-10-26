import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { WorkflowCatalog, WorkflowRunRecord } from '../src/workflow-catalog';
import { projectWorkflow, workflowIsActive } from '../src/workflow-state';
import { redactSensitiveText } from '../src/subagent-redact';

const MAX_ENTRIES = 2000;
const MAX_SAVED = 100;
const MAX_RUNS = 20;
const MAX_PROGRESS_BYTES = 1024 * 1024;
const runIdPattern = /^wf_[a-zA-Z0-9_-]{1,100}$/;
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\');
};
const displayName = (value: string) => redactSensitiveText(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);

/** Read the native v1 catalog without importing/executing saved scripts or modifying storage. */
export async function readWorkflowCatalog(cwd: string, desktopRoot: string,
  liveRuns: { runId: string; startedAt: number }[] = []): Promise<WorkflowCatalog> {
  const result: WorkflowCatalog = { saved: [], runs: [], issues: [] };
  const issue = (section: WorkflowCatalog['issues'][number]['section'], reason: WorkflowCatalog['issues'][number]['reason']) => {
    if (!result.issues.some(item => item.section === section && item.reason === reason)) result.issues.push({ section, reason });
  };
  async function directory(root: string, parts: string[], section: WorkflowCatalog['issues'][number]['section']) {
    let base: string;
    try {
      base = await realpath(root);
    } catch (error) {
      if (section !== 'desktop' || !missing(error)) issue(section, 'unavailable');
      return undefined;
    }
    try {
      const path = await realpath(join(base, ...parts));
      if (!inside(base, path)) throw new Error('Outside catalog root');
      return path;
    } catch (error) {
      if (!missing(error)) issue(section, 'unavailable');
      return undefined;
    }
  }
  async function entries(path: string, section: WorkflowCatalog['issues'][number]['section']) {
    const found = [];
    try {
      const dir = await opendir(path);
      for await (const entry of dir) {
        if (found.length >= MAX_ENTRIES) { issue(section, 'limited'); break; }
        found.push(entry);
      }
    } catch { issue(section, 'unavailable'); }
    return found;
  }
  // Project names take precedence, matching upstream saved-workflow resolution.
  const saved = new Map<string, WorkflowCatalog['saved'][number]>();
  for (const scope of ['project', 'desktop'] as const) {
    const path = await directory(scope === 'project' ? cwd : desktopRoot,
      scope === 'project' ? ['.stepcode', 'workflows', 'saved'] : ['workflows', 'saved'], scope);
    if (!path) continue;
    for (const entry of await entries(path, scope)) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const name = entry.name.slice(0, -3);
      if (saved.has(name)) continue;
      saved.set(name, { id: createHash('sha256').update(scope + ':' + name).digest('hex'),
        name: displayName(name), scope });
    }
  }
  const sorted = [...saved.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (sorted.length > MAX_SAVED) issue('project', 'limited');
  result.saved = sorted.slice(0, MAX_SAVED);
  const runsRoot = await directory(cwd, ['.stepcode', 'workflows', 'runs'], 'runs');
  if (!runsRoot) return result;
  const candidates: { runId: string; modifiedAt: number }[] = [];
  for (const entry of await entries(runsRoot, 'runs')) {
    if (!entry.isDirectory() || !runIdPattern.test(entry.name)) continue;
    try {
      const path = await realpath(join(runsRoot, entry.name));
      if (!inside(runsRoot, path)) throw new Error('Outside runs root');
      candidates.push({ runId: entry.name, modifiedAt: (await stat(path)).mtimeMs });
    } catch { issue('runs', 'unavailable'); }
  }
  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt || a.runId.localeCompare(b.runId));
  if (candidates.length > MAX_RUNS) issue('runs', 'limited');
  for (const candidate of candidates.slice(0, MAX_RUNS)) {
    const row: WorkflowRunRecord = { ...candidate, status: 'unknown' };
    result.runs.push(row);
    try {
      const path = join(runsRoot, candidate.runId, 'progress.json');
      const resolved = await realpath(path);
      if (!inside(runsRoot, resolved) || !(await lstat(path)).isFile()) throw new Error('Invalid progress path');
      const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
      let raw: unknown;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_PROGRESS_BYTES) throw new Error('Invalid progress file');
        const buffer = Buffer.alloc(MAX_PROGRESS_BYTES + 1);
        let bytes = 0;
        while (bytes < buffer.length) {
          const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
          if (!read.bytesRead) break;
          bytes += read.bytesRead;
        }
        if (bytes > MAX_PROGRESS_BYTES) throw new Error('Progress file is too large');
        raw = JSON.parse(buffer.subarray(0, bytes).toString('utf8'));
      } finally { await handle.close(); }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid progress');
      if ((raw as Record<string, unknown>).schemaVersion !== 1) { issue('runs', 'unsupported'); continue; }
      const flow = projectWorkflow(raw, '');
      if (!flow || flow.runId !== candidate.runId) throw new Error('Invalid progress identity');
      const active = workflowIsActive(flow.status);
      const confirmed = liveRuns.some(run => run.runId === flow.runId && run.startedAt === flow.startedAt);
      Object.assign(row, {
        name: flow.name, status: active && !confirmed ? 'unknown' : flow.status,
        ...(active && !confirmed ? { recordedStatus: flow.status } : {}),
        startedAt: flow.startedAt, completedAgents: flow.completedAgents, totalAgents: flow.totalAgents,
      });
      if (row.totalAgents !== undefined && row.completedAgents !== undefined && row.completedAgents > row.totalAgents) {
        delete row.completedAgents;
        issue('runs', 'invalid');
      }
    } catch (error) {
      // Missing progress can mean a newly created or interrupted run, never success.
      if (!missing(error)) issue('runs', 'invalid');
    }
  }
  return result;
}
