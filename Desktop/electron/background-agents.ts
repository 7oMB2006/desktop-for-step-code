import { MAX_BACKGROUND_REPLY_LENGTH, type BackgroundAgentLane, type BackgroundAgentReplyRequest,
  type BackgroundAgentReplyReceipt, type BackgroundAgentSnapshot, type BackgroundAgentStep } from '../src/background-agents';
import { redactSensitiveLines, redactSensitiveText } from '../src/subagent-redact';
import type { SessionRuntime } from './session-runtimes';

const statuses = ['queued', 'running', 'completed', 'failed', 'aborted', 'skipped'];
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const time = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  && value <= Date.now() + 60000 ? value : undefined;
const string = (value: unknown, limit: number) => typeof value === 'string' ? redactSensitiveText(value).slice(0, limit) : '';

/** A bounded, credential-filtered view of native lanes, never a new task authority. */
export function backgroundAgentsSnapshot(value: unknown, sessionId: string, settling: ReadonlySet<string> = new Set()): BackgroundAgentSnapshot {
  const raw = object(value);
  if (raw.sessionId !== sessionId || !Array.isArray(raw.lanes)) throw new Error('Background agent snapshot unavailable');
  const lanes: BackgroundAgentLane[] = [];
  const seen = new Set<string>();
  let remaining = 64;
  let outputBudget = 32000;
  for (const item of raw.lanes.slice(0, 24)) {
    const lane = object(item);
    if (typeof lane.agentId !== 'string' || !/^lane_[0-9a-f]{8}$/.test(lane.agentId) || seen.has(lane.agentId)
      || !['single', 'parallel', 'chain'].includes(String(lane.mode)) || !statuses.includes(String(lane.status))
      || !Array.isArray(lane.results)) throw new Error('Background agent snapshot unavailable');
    seen.add(lane.agentId);
    const records = lane.results.slice(0, remaining);
    remaining -= records.length;
    const steps: BackgroundAgentStep[] = records.map((entry, index) => {
      const step = object(entry), usage = object(step.usage);
      // Redact before taking a tail; clipping a credential first can remove its identifying prefix.
      const output = redactSensitiveLines(typeof step.activeText === 'string' ? step.activeText : '');
      const limit = Math.min(12000, outputBudget);
      const text = limit ? output.text.slice(-limit) : '';
      outputBudget -= text.length;
      return { index, agent: string(step.agent, 200), task: string(step.task, 4000),
        status: statuses.includes(String(step.status)) ? step.status as BackgroundAgentStep['status'] : 'unknown',
        model: string(step.model, 300) || undefined, startedAt: time(step.startedAt), updatedAt: time(step.updatedAt),
        usage: Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'turns']
          .flatMap(key => number(usage[key]) === undefined ? [] : [[key, usage[key]]])),
        output: text, outputTruncated: step.outputTruncated === true || output.text.length > text.length,
        activeTool: string(step.activeTool, 100) || undefined, error: string(step.errorMessage, 2000) || undefined,
        redacted: output.redacted };
    });
    lanes.push({ id: lane.agentId, mode: lane.mode as BackgroundAgentLane['mode'],
      status: lane.status as BackgroundAgentLane['status'], settling: settling.has(lane.agentId),
      startedAt: time(lane.startedAt), updatedAt: time(lane.updatedAt), steps,
      omittedSteps: Math.min(100000, (number(lane.omittedResults) ?? 0) + lane.results.length - records.length) });
  }
  return { sessionId, lanes, replyAvailable: raw.replyAvailable === true };
}

export class BackgroundAgents {
  private stopping = new Set<string>();
  private replying = new Set<string>();
  private reading = new Map<SessionRuntime, { sessionId: string; rpc: SessionRuntime['rpc']; promise: Promise<BackgroundAgentSnapshot> }>();
  constructor(private workers: ReadonlyMap<string, SessionRuntime>, private blocked: () => boolean = () => false,
    private safeOutput = false, private replies = false) {}
  private require(runtimeId: string, sessionId: string) {
    if (!this.safeOutput) throw new Error('Background agent output safety is unavailable');
    const worker = this.workers.get(runtimeId);
    if (!sessionId || worker?.status !== 'connected' || worker.state?.sessionId !== sessionId || this.blocked()
      || worker.mutating || worker.stopping) throw new Error('Session is not ready');
    return worker;
  }
  private current(worker: SessionRuntime, sessionId: string, rpc: SessionRuntime['rpc']) {
    return this.require(worker.id, sessionId) === worker && worker.rpc === rpc;
  }
  read(runtimeId: string, sessionId: string) {
    const worker = this.require(runtimeId, sessionId);
    const pending = this.reading.get(worker);
    if (pending?.sessionId === sessionId && pending.rpc === worker.rpc) return pending.promise;
    const rpc = worker.rpc;
    worker.operations++;
    const read = (async () => {
      try {
        const raw = await rpc.request('desktop_subagents', { sessionId, action: 'list' }, 10000);
        if (!this.current(worker, sessionId, rpc)) throw new Error('Session changed');
        const snapshot = backgroundAgentsSnapshot(raw, sessionId,
          new Set(worker.backgroundLanes?.filter(lane => lane.status === 'settling').map(lane => lane.id)));
        snapshot.replyAvailable = this.replies && snapshot.replyAvailable;
        return snapshot;
      } finally { worker.operations--; }
    })();
    this.reading.set(worker, { sessionId, rpc, promise: read });
    void read.finally(() => { if (this.reading.get(worker)?.promise === read) this.reading.delete(worker); }).catch(() => {});
    return read;
  }
  async stop(runtimeId: string, sessionId: string, laneId: string) {
    const worker = this.require(runtimeId, sessionId), rpc = worker.rpc;
    if (!/^lane_[0-9a-f]{8}$/.test(laneId)) throw new Error('Invalid background lane id');
    const key = `${runtimeId}:${laneId}`;
    if (this.stopping.has(key) || this.replying.has(key)) throw new Error('Background lane action is already pending');
    this.stopping.add(key);
    this.reading.delete(worker);
    worker.operations++;
    try {
      const result = await rpc.request('desktop_subagents', { sessionId, action: 'stop', laneId }, 10000);
      if (!this.current(worker, sessionId, rpc) || result?.sessionId !== sessionId || result?.requested !== true)
        throw new Error('Background lane stop was not confirmed');
      // Do not abort the parent, pause its queue, release its host or invent a final lane event.
    } finally { worker.operations--; this.stopping.delete(key); }
  }
  async reply(request: BackgroundAgentReplyRequest): Promise<BackgroundAgentReplyReceipt> {
    if (!request || typeof request !== 'object' || !this.replies) throw new Error('Background replies are unavailable');
    const { runtimeId, sessionId, laneId, requestId, prompt } = request;
    const worker = this.require(runtimeId, sessionId), rpc = worker.rpc;
    if (typeof laneId !== 'string' || !/^lane_[0-9a-f]{8}$/.test(laneId)
      || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{24,80}$/.test(requestId)
      || typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_BACKGROUND_REPLY_LENGTH)
      throw new Error('Invalid background reply');
    const key = `${runtimeId}:${laneId}`;
    if (this.stopping.has(key) || this.replying.has(key)) throw new Error('Background lane action is already pending');
    if (worker.backgroundLanes?.some(lane => lane.id === laneId && lane.status === 'settling'))
      throw new Error('Wait for the background lane to settle');
    this.replying.add(key);
    this.reading.delete(worker);
    worker.operations++;
    try {
      const result = await rpc.request('desktop_subagents', { sessionId, action: 'reply', laneId, requestId, prompt }, 10000);
      if (!this.current(worker, sessionId, rpc) || result?.sessionId !== sessionId || result?.laneId !== laneId
        || result?.requestId !== requestId || !['queued', 'started'].includes(result?.delivery))
        throw new Error('Background reply was not confirmed');
      return { sessionId, laneId, requestId, delivery: result.delivery };
    } finally {
      worker.operations--; this.replying.delete(key);
    }
  }
}
