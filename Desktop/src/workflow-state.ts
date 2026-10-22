import type { Message } from './contracts';
import { redactSensitiveText } from './subagent-redact';
import { isUserMessage } from './user-message';
import { cronMessage } from './cron-message';

const lastTurnBoundary = (messages: Message[]) => messages.reduce((last, message, index) =>
  isUserMessage(message) || cronMessage(message) ? index : last, -1);

export interface WorkflowAgent {
  id: string; label: string; task: string; phase?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'cached' | 'unknown';
  startedAt?: number; finishedAt?: number; usageTokens?: number;
  error?: { code: string; message: string; retryable?: boolean; retryExhausted?: boolean };
  rateLimitRetries?: number; retry?: { attempt: number; maxRetries: number; delayMs: number };
}
export interface WorkflowTaskFailure {
  script?: string; primitive: 'parallel' | 'pipeline'; index: number; stage?: number; message: string;
}
export interface WorkflowState {
  runId?: string; toolCallId: string; name: string;
  status: 'running' | 'stopping' | 'completed' | 'partial_failed' | 'failed' | 'aborted' | 'budget_exceeded' | 'unknown';
  agents: WorkflowAgent[]; totalAgents?: number; completedAgents?: number;
  currentPhase?: string; startedAt?: number; finishedAt?: number; spentTokens?: number;
  failedAgents?: number; failedCallbacks?: number; cacheHits?: number; taskFailures?: WorkflowTaskFailure[];
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit = 4000) => typeof value === 'string' ? redactSensitiveText(value.slice(0, limit)) : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
const states = ['running', 'stopping', 'completed', 'partial_failed', 'failed', 'aborted', 'budget_exceeded'] as const;
const agentStates = ['queued', 'running', 'completed', 'failed', 'aborted', 'cached'] as const;

export function workflowIsActive(status: WorkflowState['status']) {
  return status === 'running' || status === 'stopping';
}

function projectAgents(value: unknown, failuresOnly = false): WorkflowAgent[] {
  const seen = new Set<string>();
  const agents: WorkflowAgent[] = [];
  for (const item of Array.isArray(value) ? value.slice(0, 1000) : []) {
    const agent = record(item);
    if (typeof agent.id !== 'string' || !agent.id || agent.id.length > 200 || seen.has(agent.id)
      || !agentStates.includes(agent.status as typeof agentStates[number])
      || failuresOnly && agent.status !== 'failed' && agent.status !== 'aborted') continue;
    seen.add(agent.id);
    const error = record(agent.error);
    const retry = record(agent.retry);
    const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : '';
    const message = text(error.message);
    const attempt = count(retry.attempt), maxRetries = count(retry.maxRetries), delayMs = number(retry.delayMs);
    agents.push({ id: agent.id, label: text(agent.label, 200), task: text(agent.task, 16000),
      phase: text(agent.phase, 200) || undefined, status: agent.status as WorkflowAgent['status'],
      startedAt: number(agent.startedAt), finishedAt: number(agent.finishedAt), usageTokens: number(agent.usageTokens),
      error: code || message ? { code, message, retryable: typeof error.retryable === 'boolean' ? error.retryable : undefined,
        retryExhausted: typeof error.retryExhausted === 'boolean' ? error.retryExhausted : undefined } : undefined,
      rateLimitRetries: count(agent.rateLimitRetries),
      retry: agent.status === 'running' && attempt !== undefined && attempt > 0 && maxRetries !== undefined
        && attempt <= maxRetries && delayMs !== undefined ? { attempt, maxRetries, delayMs } : undefined });
  }
  return agents;
}

/** Allowlisted presentation only: no executable scripts, raw output or environment. */
export function projectWorkflow(value: unknown, toolCallId: string): WorkflowState | undefined {
  const raw = record(value);
  const summary = record(raw.summary);
  if (raw.schemaVersion !== 1 || typeof raw.runId !== 'string' || !/^wf_[a-zA-Z0-9_-]{1,100}$/.test(raw.runId)
    || !states.includes(raw.status as typeof states[number])) return undefined;
  const agents = (Array.isArray(raw.agents) ? projectAgents(raw.agents) : projectAgents(raw.failures, true))
    .map(agent => workflowIsActive(raw.status as WorkflowState['status']) ? agent : { ...agent, retry: undefined });
  const taskFailures = Array.isArray(raw.taskFailures) ? raw.taskFailures.slice(0, 100).flatMap(item => {
    const failure = record(item);
    const index = count(failure.index);
    if ((failure.primitive !== 'parallel' && failure.primitive !== 'pipeline') || index === undefined) return [];
    // Only a bounded source label, never an executable body or filesystem path.
    const script = typeof failure.script === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,95}$/.test(failure.script)
      ? text(failure.script, 96) : undefined;
    return [{ primitive: failure.primitive, index, stage: count(failure.stage), script,
      message: text(failure.message) } as WorkflowTaskFailure];
  }) : undefined;
  return { runId: raw.runId, toolCallId, name: text(raw.name, 200) || 'Ultracode', status: raw.status as WorkflowState['status'],
    agents, totalAgents: count(raw.totalAgents) ?? count(summary.total) ?? count(raw.agentCalls),
    completedAgents: count(raw.completedAgents) ?? count(summary.completed),
    failedAgents: count(summary.failed), failedCallbacks: count(summary.failedCallbacks), cacheHits: count(raw.cacheHits), taskFailures,
    currentPhase: text(raw.currentPhase, 200) || undefined, startedAt: number(raw.startedAt),
    finishedAt: number(raw.finishedAt), spentTokens: number(raw.spentTokens) };
}

/** A final result omits agents. Keep the last progress snapshot without overriding final status. */
export function preserveWorkflow(previous: Message | undefined, next: Message): Message {
  if (next.toolName !== 'workflow' || !next.toolCallId) return next;
  const current = projectWorkflow(next.details, next.toolCallId);
  const saved = next.desktopWorkflow ?? previous?.desktopWorkflow;
  if (!current) return saved ? { ...next, desktopWorkflow: next.isError
    ? { ...saved, status: 'failed', agents: saved.agents.map(agent => ({ ...agent, retry: undefined,
      status: agent.status === 'running' || agent.status === 'queued' ? 'unknown' as const : agent.status })) } : saved } : next;
  const compatible = saved && saved.runId === current.runId && (saved.startedAt === undefined || current.startedAt === undefined
    || saved.startedAt === current.startedAt) ? saved : undefined;
  const final = !Array.isArray(next.details?.agents);
  const savedAgents = new Map(compatible?.agents.map(agent => [agent.id, agent]));
  const merged = new Map(savedAgents);
  for (const agent of current.agents) {
    const old = savedAgents.get(agent.id);
    merged.set(agent.id, old ? { ...agent, label: agent.label || old.label, task: agent.task || old.task,
      phase: agent.phase ?? old.phase, startedAt: agent.startedAt ?? old.startedAt,
      finishedAt: agent.finishedAt ?? old.finishedAt, usageTokens: agent.usageTokens ?? old.usageTokens } : agent);
  }
  const agents = final ? [...merged.values()].slice(0, 1000) : current.agents;
  const clearCallbacks = final && (current.status === 'completed' || current.failedCallbacks === 0);
  return { ...next, desktopWorkflow: { ...current,
    agents: final && !workflowIsActive(current.status) ? agents.map(agent => ({ ...agent, retry: undefined,
      rateLimitRetries: agent.rateLimitRetries ?? savedAgents.get(agent.id)?.rateLimitRetries,
      status: agent.status === 'running' || agent.status === 'queued' ? 'unknown' as const : agent.status })) : agents,
    totalAgents: current.totalAgents ?? compatible?.totalAgents,
    completedAgents: current.completedAgents ?? compatible?.completedAgents,
    failedAgents: current.failedAgents,
    failedCallbacks: clearCallbacks ? 0 : current.failedCallbacks ?? compatible?.failedCallbacks,
    cacheHits: current.cacheHits ?? compatible?.cacheHits,
    taskFailures: clearCallbacks ? [] : current.taskFailures ?? compatible?.taskFailures,
    // Final results are not proof that every individual agent succeeded.
    currentPhase: final ? undefined : current.currentPhase,
  } };
}

export function workflowsFromMessages(messages: Message[], active = true): WorkflowState[] {
  const lastUser = lastTurnBoundary(messages);
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
  return [...flows.values()].map(flow => (!active || !activeCalls.has(flow.toolCallId)) && workflowIsActive(flow.status)
    ? { ...flow, status: 'unknown' as const, agents: flow.agents.map(agent => agent.status === 'running' || agent.status === 'queued'
      ? { ...agent, status: 'unknown' as const, retry: undefined } : agent) } : flow);
}

export function workflowIcon(status: WorkflowState['status'] | WorkflowAgent['status']) {
  return status === 'running' ? 'running' : status === 'completed' || status === 'cached' ? 'done'
    : status === 'aborted' ? 'stopped' : status === 'queued' || status === 'unknown' || status === 'stopping' ? 'pending' : 'failed';
}

export function currentTurnWorkflows(messages: Message[], active = true): WorkflowState[] {
  const lastUser = lastTurnBoundary(messages);
  return workflowsFromMessages(messages.slice(lastUser + 1), active);
}
export function workflowCount(flow: WorkflowState) {
  const done = flow.completedAgents ?? flow.agents.filter(a => a.status === 'completed' || a.status === 'cached').length;
  return flow.agents.length ? `${done} / ${flow.totalAgents ?? flow.agents.length}`
    : flow.totalAgents !== undefined ? flow.completedAgents !== undefined ? `${done} / ${flow.totalAgents}` : `${flow.totalAgents}` : '';
}
export function workflowIssues(flow: WorkflowState, language: 'zh' | 'en') {
  const failed = flow.failedAgents ?? flow.agents.filter(agent => agent.status === 'failed').length;
  const callbacks = flow.failedCallbacks ?? flow.taskFailures?.length ?? 0;
  return [failed ? language === 'zh' ? `${failed} 节点失败` : `${failed} failed ${failed === 1 ? 'node' : 'nodes'}` : '',
    callbacks ? language === 'zh' ? `${callbacks} 回调错误` : `${callbacks} callback ${callbacks === 1 ? 'error' : 'errors'}` : ''].filter(Boolean).join(' · ');
}
export function workflowRetryText(agent: WorkflowAgent, language: 'zh' | 'en') {
  if (agent.retry) return language === 'zh'
    ? `重试 ${agent.retry.attempt}/${agent.retry.maxRetries} · 等待 ${(agent.retry.delayMs / 1000).toFixed(1)} 秒`
    : `Retry ${agent.retry.attempt}/${agent.retry.maxRetries} · wait ${(agent.retry.delayMs / 1000).toFixed(1)} s`;
  if (!agent.rateLimitRetries && !agent.error?.retryExhausted) return '';
  const count = agent.rateLimitRetries ?? 0;
  return language === 'zh'
    ? `${agent.status === 'completed' ? '重试恢复 · ' : ''}已重试 ${count} 次${agent.error?.retryExhausted ? ' · 重试次数已耗尽' : ''}`
    : `${agent.status === 'completed' ? 'Recovered · ' : ''}${count} ${count === 1 ? 'retry' : 'retries'}${agent.error?.retryExhausted ? ' · retries exhausted' : ''}`;
}
