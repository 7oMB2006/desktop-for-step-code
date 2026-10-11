import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import { emptyLaunch, type LaunchMode, type LaunchState } from '../src/launch-state';
import { ultracodeInput } from '../src/ultracode-input';

export class LaunchControls {
  constructor(private pool: SessionRuntimes) {}
  private async supports(worker: SessionRuntime, names: string[]) {
    const { commands } = await worker.rpc.request('get_commands');
    for (const name of names) if (!commands?.some((item: { name: string; source: string }) => item.name === name && item.source === 'extension'))
      throw new Error(`This runtime does not support /${name}`);
  }
  private async command(worker: SessionRuntime, name: string, args = '') {
    await this.supports(worker, [name]);
    await worker.rpc.request('prompt', { message: `/${name}${args ? ` ${args}` : ''}` }, 60000);
    await this.pool.readLaunch(worker);
  }
  async set(worker: SessionRuntime, mode: LaunchMode, enabled: boolean) {
    await this.pool.readLaunch(worker);
    worker.launch ??= emptyLaunch();
    await this.supports(worker, [mode === 'ultracode' ? 'ultraloop' : mode]);
    if (mode === 'ultracode') {
      worker.launch.ultracodeArmed = enabled;
    } else if (mode === 'plan') {
      if (enabled && worker.launch.goal?.status === 'active') await this.goal(worker, 'pause');
      worker.launch.goalArmed = false;
      if (worker.launch.plan !== enabled) await this.command(worker, 'plan');
      if (worker.launch.plan !== enabled) throw new Error('Plan change was not confirmed');
      worker.launch.planArmed = enabled;
    } else {
      if (enabled && worker.launch.plan) {
        await this.command(worker, 'plan');
        if (worker.launch.plan) throw new Error('Exit Plan before enabling Goal');
        worker.launch.planArmed = false;
      }
      const goal = worker.launch.goal;
      if (goal && goal.status !== 'complete') {
        if (enabled && goal.status !== 'active') await this.goal(worker, 'resume');
        if (!enabled && goal.status === 'active') await this.goal(worker, 'pause');
      } else {
        if (enabled && (worker.busy || worker.state?.isStreaming || worker.queued))
          throw new Error('Finish the current task before starting a new goal');
        worker.launch.goalArmed = enabled;
      }
    }
    this.pool.publishLaunch(worker);
  }
  async goal(worker: SessionRuntime, action: string, value?: unknown) {
    await this.pool.readLaunch(worker);
    const goal = worker.launch?.goal;
    if (!goal) throw new Error('No goal is set');
    if (action === 'resume' && goal.status === 'budget_limited') throw new Error('Increase or remove the exhausted Token budget before resuming');
    let args = action;
    if (action === 'edit') {
      if (typeof value !== 'string' || !value.trim() || value.length > 16000) throw new Error('Goal requires 1 to 16000 characters');
      const objective = goal.ultracode ? `ultracode: ${value.trim()}` : value.trim();
      if (objective.length > 16000) throw new Error('Goal is too long for the selected launch options');
      args += ` ${objective}`;
    } else if (action === 'budget') {
      if (value !== null && (!Number.isSafeInteger(value) || Number(value) <= 0)) throw new Error('Budget must be a positive integer');
      args += ` ${value === null ? 'none' : value}`;
    } else if (!['pause', 'resume', 'clear'].includes(action)) throw new Error('Unknown goal action');
    if (action === 'resume' && worker.launch?.plan) {
      await this.command(worker, 'plan');
      if (worker.launch?.plan) throw new Error('Exit Plan before resuming Goal');
      worker.launch.planArmed = false;
    }
    await this.command(worker, 'goal', args);
    const next = worker.launch?.goal;
    if (action === 'clear' ? Boolean(next) : !next || next.id !== goal.id
      || action === 'pause' && next.status !== 'paused'
      || action === 'resume' && !['active', 'complete'].includes(next.status)
      || action === 'budget' && next.tokenBudget !== (value ?? undefined)
      || action === 'edit' && next.objective !== String(value).trim().replace(/\s+/gu, ' '))
      throw new Error('Goal change was not confirmed; check its current state');
  }
  async startGoal(worker: SessionRuntime, payload: Record<string, unknown>, selected?: LaunchState) {
    await this.pool.readLaunch(worker);
    worker.launch ??= emptyLaunch();
    if (!(selected ?? worker.launch)?.goalArmed) return false;
    if (worker.launch.plan) throw new Error('Exit Plan before starting Goal');
    if (worker.busy || worker.state?.isStreaming || worker.queued) throw new Error('Finish the current task before starting a new goal');
    if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 16000)
      throw new Error('Goal requires 1 to 16000 characters');
    if (payload.message.trimStart().startsWith('/')) throw new Error('Send a task description to start Goal, or disable Goal before using a command');
    if (worker.launch.goal && worker.launch.goal.status !== 'complete') throw new Error('An unfinished goal already exists');
    const ultra = (selected ?? worker.launch).ultracodeArmed;
    const objective = ultra ? `ultracode: ${payload.message}` : payload.message;
    if (objective.length > 16000) throw new Error('Goal is too long for the selected launch options');
    const { commands } = await worker.rpc.request('get_commands');
    if (!['goal', '_desktop_goal_input'].every(name => commands?.some((item: { name: string; source: string }) => item.name === name && item.source === 'extension')))
      throw new Error('This runtime does not support Desktop Goal input');
    const previousId = worker.launch.goal?.id;
    if (!selected) this.consume(worker);
    await worker.rpc.request('prompt', { message: `/_desktop_goal_input ${JSON.stringify({ message: payload.message, images: payload.images })}` });
    await this.command(worker, 'goal', `start ${objective}`);
    if (!worker.launch.goal || worker.launch.goal.id === previousId
      || worker.launch.goal.objective !== payload.message.trim().replace(/\s+/gu, ' ')) throw new Error('Goal creation was not confirmed');
    this.pool.publishLaunch(worker);
    return true;
  }
  input(worker: SessionRuntime, payload: Record<string, unknown>, selected = worker.launch) {
    if (selected?.ultracodeArmed && String(payload.message ?? '').trimStart().startsWith('/'))
      throw new Error('Disable the pending Ultracode choice before sending a command');
    return selected?.ultracodeArmed ? { ...payload, message: ultracodeInput(String(payload.message ?? '')) } : payload;
  }
  consume(worker: SessionRuntime) {
    if (!worker.launch) return;
    worker.launch.ultracodeArmed = false;
    worker.launch.planArmed = false;
    worker.launch.goalArmed = false;
    this.pool.publishLaunch(worker);
  }
  async disableStandingUltracode(worker: SessionRuntime) {
    await this.command(worker, 'ultraloop', 'off');
    if (worker.launch?.ultracode) throw new Error('Ultracode change was not confirmed');
  }
}
