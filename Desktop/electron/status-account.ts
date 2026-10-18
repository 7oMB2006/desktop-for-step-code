import type { StatusAccount } from '../src/contracts';

// This projection is local-only and deliberately never spreads a credential.
export function statusAccount(auth: Record<string, unknown>): StatusAccount {
  const stored = auth.step;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { mode: 'none' };
  const credential = stored as Record<string, unknown>;
  if (credential.type !== 'oauth' || typeof credential.access !== 'string' || !credential.access.trim())
    return { mode: 'none' };
  const profile = typeof credential.profile === 'string' && credential.profile ? credential.profile : 'step_plan';
  if (!['step_plan', 'step_plan_oversea', 'platform_cn', 'platform_oversea'].includes(profile))
    return { mode: 'unknown' };
  return {
    mode: profile.startsWith('platform_') ? 'api' : 'plan',
    region: profile.endsWith('oversea') ? 'global' : 'cn',
    ...(typeof credential.uid === 'string' && /^\d{1,64}$/.test(credential.uid) ? { userId: credential.uid } : {}),
  };
}
