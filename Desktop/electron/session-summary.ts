import type { SessionSummary, SummaryTask } from '../src/contracts';
import { statusDetails } from './session-status';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown, limit = 4000) { return typeof value === 'string' ? value.slice(0, limit) : ''; }
function taskList(value: unknown, limit = 1000): SummaryTask[] {
  const tasks: SummaryTask[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (tasks.length >= limit) break;
    const task = record(item), id = string(task.id, 200);
    if (!id || seen.has(id) || !['pending', 'in_progress', 'completed', 'failed'].includes(String(task.status))) continue;
    seen.add(id);
    tasks.push({ id, subject: string(task.subject), description: string(task.description, 16000), status: task.status as SummaryTask['status'],
      ...Object.fromEntries(['createdAt', 'updatedAt'].flatMap(key =>
        typeof task[key] === 'number' && Number.isSafeInteger(task[key]) && task[key] > 0 ? [[key, task[key]]] : [])) });
  }
  return tasks;
}
// Project only presentation fields. Runtime task metadata and MCP configuration stay private.
export function sessionSummary(value: unknown, sessionId: string): SessionSummary {
  const raw = record(value);
  if (raw.sessionId !== sessionId) throw new Error('Session changed while reading summary');
  const data = record(raw.tasks);
  const plan = record(data.activePlan);
  const tasks = taskList(data.tasks);
  const archivedPlans: NonNullable<SessionSummary['archivedPlans']> = [];
  const seenPlans = new Set<string>();
  let historyBudget = 1000;
  for (const item of Array.isArray(data.archivedPlans) ? data.archivedPlans : []) {
    if (archivedPlans.length >= 50 || !historyBudget) break;
    const entry = record(item), id = string(entry.id, 200);
    if (!id || id === plan.id || seenPlans.has(id) || typeof entry.title !== 'string') continue;
    seenPlans.add(id);
    const historyTasks = taskList(entry.tasks, historyBudget);
    if (!historyTasks.length) continue;
    historyBudget -= historyTasks.length;
    archivedPlans.push({ id, title: string(entry.title), tasks: historyTasks });
  }
  const mcp: SessionSummary['mcp'] = [];
  for (const item of Array.isArray(raw.mcp) ? raw.mcp : []) {
    const server = record(item);
    if (typeof server.name !== 'string' || !['connecting', 'connected', 'failed', 'disabled'].includes(String(server.status))) continue;
    mcp.push({ name: string(server.name, 512), status: server.status as SessionSummary['mcp'][number]['status'],
      toolCount: typeof server.toolCount === 'number' && Number.isSafeInteger(server.toolCount) ? Math.max(0, server.toolCount) : 0 });
  }
  return { sessionId, plan: typeof plan.id === 'string' && typeof plan.title === 'string' ? { id: string(plan.id, 200), title: string(plan.title) } : undefined,
    tasks, archivedPlans, mcp, skillCount: typeof raw.skillCount === 'number' && Number.isSafeInteger(raw.skillCount) ? Math.max(0, raw.skillCount) : 0,
    status: statusDetails(raw.status) };
}
