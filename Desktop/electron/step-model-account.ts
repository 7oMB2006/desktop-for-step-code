import type { SessionRuntime } from './session-runtimes';

export type StepModelAccount = {
  key: string; endpoint: string; model: string; sessionId: string; expires: number;
  channel: 'plan' | 'api'; region: 'cn' | 'global'; video: boolean;
};
export class StepModelAccountError extends Error {}

// Account credentials stay in main. These four routes must never fall back to one another.
export function stepModelAccount(auth: Record<string, unknown>, worker: SessionRuntime,
  changing = false, now = Date.now()): StepModelAccount {
  const model = worker.state?.model;
  if (changing || worker.status !== 'connected' || worker.stopping || !worker.state?.sessionId || !model)
    throw new StepModelAccountError('DFSC account or session is not ready');
  if (model.provider !== 'step')
    throw new StepModelAccountError('Follow DFSC currently supports official Step accounts only; choose independent mode for another provider');
  const credential = auth.step as Record<string, unknown> | undefined;
  if (!credential || credential.type !== 'oauth' || typeof credential.access !== 'string' || !credential.access.trim())
    throw new StepModelAccountError('Sign in to an official Step account in DFSC first');
  const profile = credential.profile === 'step' ? 'step_plan' : credential.profile;
  if (!['step_plan', 'step_plan_oversea', 'platform_cn', 'platform_oversea'].includes(String(profile)))
    throw new StepModelAccountError('The active DFSC account has no supported billing profile');
  if (typeof credential.expires !== 'number' || !Number.isFinite(credential.expires) || credential.expires <= now + 1000)
    throw new StepModelAccountError('DFSC login expired; sign in again');
  const channel = String(profile).startsWith('platform_') ? 'api' : 'plan';
  const region = String(profile).endsWith('oversea') ? 'global' : 'cn';
  return {
    key: credential.access, expires: credential.expires, channel, region, model: model.id,
    sessionId: worker.state.sessionId,
    endpoint: `https://${region === 'global' ? 'api.stepfun.ai' : 'api.stepfun.com'}${channel === 'plan' ? '/step_plan' : ''}/v1`,
    video: ['step-3.7-flash', 'step-5-preview'].includes(model.id) || Boolean(model.input?.includes('video')),
  };
}
