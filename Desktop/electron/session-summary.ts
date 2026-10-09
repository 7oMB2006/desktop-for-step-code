import type { SessionSummary } from '../src/contracts';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown, limit = 4000) { return typeof value === 'string' ? value.slice(0, limit) : ''; }
// Project only presentation fields. Runtime task metadata and MCP configuration stay private.
export function sessionSummary(value: unknown, sessionId: string): SessionSummary {
  const raw = record(value);
  if (raw.sessionId !== sessionId) throw new Error('Session changed while reading summary');
  const data = record(raw.tasks);
  const plan = record(data.activePlan);
  const tasks: SessionSummary['tasks'] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(data.tasks) ? data.tasks : []) {
    const task = record(item), id = string(task.id, 200);
    if (!id || seen.has(id) || !['pending', 'in_progress', 'completed', 'failed'].includes(String(task.status))) continue;
    seen.add(id);
    tasks.push({ id, subject: string(task.subject), description: string(task.description, 16000), status: task.status as SessionSummary['tasks'][number]['status'] });
    if (tasks.length >= 1000) break;
  }
  const mcp: SessionSummary['mcp'] = [];
  for (const item of Array.isArray(raw.mcp) ? raw.mcp : []) {
    const server = record(item);
    if (typeof server.name !== 'string' || !['connecting', 'connected', 'failed', 'disabled'].includes(String(server.status))) continue;
    mcp.push({ name: string(server.name, 512), status: server.status as SessionSummary['mcp'][number]['status'],
      toolCount: typeof server.toolCount === 'number' && Number.isSafeInteger(server.toolCount) ? Math.max(0, server.toolCount) : 0 });
  }
  return { sessionId, plan: typeof plan.id === 'string' && typeof plan.title === 'string' ? { id: string(plan.id, 200), title: string(plan.title) } : undefined,
    tasks, mcp, skillCount: typeof raw.skillCount === 'number' && Number.isSafeInteger(raw.skillCount) ? Math.max(0, raw.skillCount) : 0 };
}
