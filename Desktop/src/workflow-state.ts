import type { Message } from './contracts';
import { redactSensitiveText } from './subagent-redact';
import { isUserMessage } from './user-message';

export interface WorkflowAgent {
  id: string; label: string; task: string; phase?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'cached' | 'unknown';
  startedAt?: number; finishedAt?: number; usageTokens?: number;
}
export interface WorkflowState {
  runId?: string; toolCallId: string; name: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'budget_exceeded' | 'unknown';
  agents: WorkflowAgent[]; totalAgents?: number; completedAgents?: number;
  currentPhase?: string; startedAt?: number; finishedAt?: number; spentTokens?: number;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit = 4000) => typeof value === 'string' ? redactSensitiveText(value.slice(0, limit)) : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const states = ['running', 'completed', 'failed', 'aborted', 'budget_exceeded'] as const;
const agentStates = ['queued', 'running', 'completed', 'failed', 'aborted', 'cached'] as const;

/** Allowlisted presentation only: no scripts, raw output, environment or paths. */
export function projectWorkflow(value: unknown, toolCallId: string): WorkflowState | undefined {
  const raw = record(value);
  if (raw.schemaVersion !== 1 || typeof raw.runId !== 'string' || !/^wf_[a-zA-Z0-9_-]{1,100}$/.test(raw.runId)
    || !states.includes(raw.status as typeof states[number])) return undefined;
  const seen = new Set<string>();
  const agents: WorkflowAgent[] = [];
  for (const item of Array.isArray(raw.agents) ? raw.agents.slice(0, 1000) : []) {
    const agent = record(item);
    if (typeof agent.id !== 'string' || !agent.id || agent.id.length > 200 || seen.has(agent.id)
      || !agentStates.includes(agent.status as typeof agentStates[number])) continue;
    seen.add(agent.id);
    agents.push({ id: agent.id, label: text(agent.label, 200), task: text(agent.task, 16000),
      phase: text(agent.phase, 200) || undefined, status: agent.status as WorkflowAgent['status'],
      startedAt: number(agent.startedAt), finishedAt: number(agent.finishedAt), usageTokens: number(agent.usageTokens) });
  }
  return { runId: raw.runId, toolCallId, name: text(raw.name, 200) || 'Ultracode', status: raw.status as WorkflowState['status'],
    agents, totalAgents: number(raw.totalAgents) ?? number(raw.agentCalls), completedAgents: number(raw.completedAgents),
    currentPhase: text(raw.currentPhase, 200) || undefined, startedAt: number(raw.startedAt),
    finishedAt: number(raw.finishedAt), spentTokens: number(raw.spentTokens) };
}

/** A final result omits agents. Keep the last progress snapshot without overriding final status. */
export function preserveWorkflow(previous: Message | undefined, next: Message): Message {
  if (next.toolName !== 'workflow' || !next.toolCallId) return next;
  const current = projectWorkflow(next.details, next.toolCallId);
  const saved = next.desktopWorkflow ?? previous?.desktopWorkflow;
  if (!current) return saved ? { ...next, desktopWorkflow: next.isError
    ? { ...saved, status: 'failed', agents: saved.agents.map(agent => agent.status === 'running' || agent.status === 'queued'
      ? { ...agent, status: 'unknown' as const } : agent) } : saved } : next;
  const compatible = saved?.runId === current.runId ? saved : undefined;
  const final = !Array.isArray(next.details?.agents);
  const agents = current.agents.length || !compatible ? current.agents : compatible.agents;
  return { ...next, desktopWorkflow: { ...current,
    agents: final && current.status !== 'running' ? agents.map(agent => agent.status === 'running' || agent.status === 'queued'
      ? { ...agent, status: 'unknown' as const } : agent) : agents,
    totalAgents: current.totalAgents ?? compatible?.totalAgents,
    completedAgents: current.completedAgents ?? compatible?.completedAgents,
    // Final results are not proof that every individual agent succeeded.
    currentPhase: final ? undefined : current.currentPhase,
  } };
}

export function workflowsFromMessages(messages: Message[], active = true): WorkflowState[] {
  const lastUser = messages.reduce((last, message, index) => isUserMessage(message) ? index : last, -1);
  const activeCalls = new Set(messages.slice(lastUser + 1).flatMap(message => Array.isArray(message.content)
    ? message.content.filter(block => block.type === 'toolCall' && block.name === 'workflow').map(block => block.id) : []));
  const results = new Map(messages.filter(m => m.role === 'toolResult' && m.toolCallId).map(m => [m.toolCallId!, m]));
  const flows = new Map<string, WorkflowState>();
  for (const message of messages) {
    if (message.display === false) continue;
    for (const call of Array.isArray(message.content) ? message.content : []) {
      if (call.type !== 'toolCall' || call.name !== 'workflow' || !call.id) continue;
      const result = results.get(call.id);
      const state = result?.desktopWorkflow ?? projectWorkflow(result?.details, call.id);
      const args = record(call.arguments);
      flows.set(call.id, state ?? { toolCallId: call.id, name: text(args.name, 200) || 'Ultracode',
        status: result ? result.isError ? 'failed' : 'unknown' : 'running', agents: [] });
    }
    if (message.role === 'toolResult' && message.toolName === 'workflow' && message.toolCallId) {
      const state = message.desktopWorkflow ?? projectWorkflow(message.details, message.toolCallId);
      if (state) flows.set(message.toolCallId, state);
    }
  }
  return [...flows.values()].map(flow => (!active || !activeCalls.has(flow.toolCallId)) && flow.status === 'running'
    ? { ...flow, status: 'unknown' as const, agents: flow.agents.map(agent => agent.status === 'running' || agent.status === 'queued'
      ? { ...agent, status: 'unknown' as const } : agent) } : flow);
}

export function workflowIcon(status: WorkflowState['status'] | WorkflowAgent['status']) {
  return status === 'running' ? 'running' : status === 'completed' || status === 'cached' ? 'done'
    : status === 'aborted' ? 'stopped' : status === 'queued' || status === 'unknown' ? 'pending' : 'failed';
}

export function currentTurnWorkflows(messages: Message[], active = true): WorkflowState[] {
  const lastUser = messages.reduce((last, message, index) => isUserMessage(message) ? index : last, -1);
  return workflowsFromMessages(messages.slice(lastUser + 1), active);
}
export function workflowCount(flow: WorkflowState) {
  const done = flow.agents.filter(a => a.status === 'completed' || a.status === 'cached').length;
  return flow.agents.length ? `${done} / ${flow.totalAgents ?? flow.agents.length}`
    : flow.totalAgents !== undefined ? `${flow.totalAgents}` : '';
}
