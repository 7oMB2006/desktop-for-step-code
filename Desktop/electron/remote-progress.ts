import type { RuntimeEvent, UIRequest } from '../src/contracts';
import { permissionApprovalPresentation } from '../src/approval-presentation';
import { toolPresentation } from '../src/conversation-presentation';
import { planReview } from '../src/plan-review';
import { questionnaire } from '../src/questionnaire';
import type { SessionRuntime } from './session-runtimes';

export type RemoteWorkerState = Pick<SessionRuntime, 'id' | 'status' | 'busy' | 'submissions'
  | 'state' | 'pendingUI' | 'failed' | 'interrupted' | 'queued' | 'stopping' | 'runActive'
  | 'backgroundActive' | 'backgroundLanes' | 'btwActive' | 'messages'>;
export interface RemoteWorkerStatus {
  kind: 'waiting' | 'running' | 'queued' | 'interrupted' | 'idle';
  label: string;
  queue: number;
  attention: boolean;
}

function waitingLabel(request: UIRequest, worker: RemoteWorkerState): string {
  if (request.runtimeId !== undefined && request.runtimeId !== worker.id) return '待本机输入 / Local input';
  const approval = permissionApprovalPresentation(request, worker.messages, 'en', worker.id);
  if (approval) return approval.operation === 'project' ? '待项目授权 / Project trust' : '待审批 / Approval';
  const question = questionnaire(request);
  if (question) return question.questions.length > 1 ? '待表单 / Form' : '待回答 / Question';
  if (planReview(request)) return '待计划审批 / Plan approval';
  // UIRequest has no login discriminator. Titles and dialog prose are not provenance.
  return '待本机输入 / Local input';
}

export function remoteWorkerStatus(worker: RemoteWorkerState, desktopQueue?: number): RemoteWorkerStatus {
  const pending = worker.state?.pendingMessageCount;
  const runtimeQueue = typeof pending === 'number' && Number.isFinite(pending) && pending >= 0
    ? Math.floor(pending) : worker.queued ? 1 : 0;
  const queue = typeof desktopQueue === 'number' && Number.isSafeInteger(desktopQueue) && desktopQueue >= 0
    ? (typeof pending === 'number' && Number.isFinite(pending) && pending >= 0 ? Math.floor(pending) : 0) + desktopQueue
    : runtimeQueue;
  const status = (kind: RemoteWorkerStatus['kind'], label: string, attention = false): RemoteWorkerStatus =>
    ({ kind, label, queue, attention });
  if (worker.status === 'disconnected') return status('interrupted', '已断开 / Disconnected', true);
  const request = worker.pendingUI.values().next().value;
  if (request) return status('waiting', waitingLabel(request, worker), true);
  if (worker.stopping) return status('running', '停止中 / Stopping');
  if (worker.status === 'connecting') return status('running', '连接中 / Connecting');
  if (worker.state?.isCompacting) return status('running', '压缩中 / Compacting');
  if (worker.busy || worker.runActive || worker.state?.isStreaming) return status('running', '运行中 / Running');
  if (worker.submissions > 0) return status('running', '提交中 / Submitting');
  if (worker.backgroundActive || worker.backgroundLanes?.length) return status('running', '后台运行 / Background agents');
  if (worker.btwActive) return status('running', '旁问运行 / Side question');
  if (worker.failed || worker.interrupted) return status('interrupted', worker.failed ? '失败 / Failed' : '已中断 / Interrupted', true);
  if (queue > 0) return status('queued', '排队中 / Queued');
  return status('idle', '空闲 / Idle');
}

type ToolKind = ReturnType<typeof toolPresentation>['kind'];
interface ToolCall {
  kind: ToolKind;
  started: boolean;
  ended: boolean;
  failed: boolean;
  cancelled: boolean;
}
const kindLabels: Record<ToolKind, string> = {
  read: '读取/read', write: '写入/write', edit: '修改/edit', command: '命令/command', search: '搜索/search',
  folder: '目录/folder', web: '网页/web', sessions: '列会话/sessions', 'session-read': '读会话/session read',
  'session-send': '传话/session send', other: '工具/other',
};
const maxCalls = 2048;
const maxCallIdLength = 256;
const maxToolNameLength = 128;
function categories(counts: Map<ToolKind, number>, limit: number): string {
  const entries = [...counts];
  const labels = entries.slice(0, limit).map(([kind, count]) => `${kindLabels[kind]} ${count}`);
  const omitted = entries.slice(limit).reduce((total, [, count]) => total + count, 0);
  if (omitted) labels.push(`+${omitted} 次/calls`);
  return labels.join(', ');
}

/** One instance per worker/run stream; bounded private IDs, fixed categories and flags only. */
export class RemoteToolProgress {
  #calls = new Map<string, ToolCall>();
  private settled = false;
  private interrupted = false;
  private partial = false;

  update(event: RuntimeEvent): void {
    if (event.type === 'agent_start') {
      this.#calls.clear();
      this.settled = false;
      this.interrupted = false;
      this.partial = false;
      return;
    }
    if (event.type === 'desktop_exit') {
      this.settled = true;
      this.interrupted = true;
      return;
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant'
      && ['aborted', 'error', 'length'].includes(event.message.stopReason)) this.interrupted = true;
    if (event.type === 'agent_end' || event.type === 'agent_settled') {
      this.settled = true;
      const last = Array.isArray(event.messages) ? event.messages.at(-1) : undefined;
      if (event.cancelled === true || event.aborted === true || last?.role === 'assistant'
        && ['aborted', 'error', 'length'].includes(last.stopReason)) this.interrupted = true;
      return;
    }
    if (event.type !== 'tool_execution_start' && event.type !== 'tool_execution_end') return;
    const id = event.toolCallId;
    if (typeof id !== 'string' || !id || id.length > maxCallIdLength) {
      this.partial = true;
      return;
    }
    let call = this.#calls.get(id);
    // Keep existing IDs so a late result can still close a call at capacity. Never truncate IDs.
    if (!call && this.#calls.size >= maxCalls) {
      this.partial = true;
      return;
    }
    const name = typeof event.toolName === 'string' && event.toolName.length <= maxToolNameLength ? event.toolName : '';
    const kind = toolPresentation(name, undefined, true, 'en').kind;
    if (!call) {
      call = { kind, started: false, ended: false, failed: false, cancelled: false };
      this.#calls.set(id, call);
    } else if (call.kind === 'other') call.kind = kind;
    if (event.type === 'tool_execution_start') {
      call.started = true;
      return;
    }
    call.ended = true;
    call.cancelled ||= event.cancelled === true || event.aborted === true;
    // Reuse structured embedded-check failure detection, without storing any result or command.
    call.failed ||= toolPresentation(name, {
      role: 'toolResult', content: '', isError: event.isError === true,
      details: event.result?.details,
    }, false, 'en').state === 'failed';
  }

  /** settled changes presentation only; a late end can still resolve a missing result. */
  summary(settled = false): string {
    if (!this.#calls.size) return this.partial ? '记录不全/Partial' : '';
    const active = new Map<ToolKind, number>(), returned = new Map<ToolKind, number>();
    let pending = 0, completed = 0, failures = 0, cancelled = 0, missingStarts = 0;
    for (const call of this.#calls.values()) {
      const counts = call.ended ? returned : active;
      counts.set(call.kind, (counts.get(call.kind) ?? 0) + 1);
      if (call.ended) completed++;
      else pending++;
      if (call.failed) failures++;
      if (call.cancelled) cancelled++;
      if (call.ended && !call.started) missingStarts++;
    }
    const render = (limit: number, returnedCategories = true) => {
      const parts: string[] = [];
      if (this.interrupted) parts.push('中断/Interrupted');
      if (this.partial) parts.push('记录不全/Partial');
      if (pending) {
        const label = settled || this.settled ? '未返回/Missing results' : '进行/Active';
        parts.push(`${label}: ${pending} (${categories(active, limit)})`);
      }
      // An end event is an invocation receipt, not proof of a successful task or passing tests.
      if (completed) parts.push(returnedCategories
        ? `已返回/Returned: ${completed} (${categories(returned, limit)})` : `已返回/Returned: ${completed}`);
      if (failures) parts.push(`失败/Failed: ${failures}`);
      if (cancelled) parts.push(`取消/Cancelled: ${cancelled}`);
      if (missingStarts) parts.push(`缺开始/Missing starts: ${missingStarts}`);
      return parts.join('; ');
    };
    for (let limit = 3; limit > 0; limit--) {
      const text = render(limit);
      if (text.length <= 200) return text;
    }
    return render(1, false);
  }
}
