import { createHash, randomUUID } from 'node:crypto';
import { stepAccount, stepHostRoute } from './step-model-account';
import type { PluginHostAccountBinding } from './plugin-host-contract.mjs';

export const PLUGIN_HOST_ACCOUNT_FIELD = 'desktopPluginHostAccount';

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function storedIdentity(auth: Record<string, unknown>) {
  const stored = auth[PLUGIN_HOST_ACCOUNT_FIELD] as { id?: unknown; credential?: unknown } | undefined;
  if (!auth.step || !stored || typeof stored.id !== 'string'
    || !/^[a-f0-9]{64}$/u.test(stored.id) || stored.credential !== fingerprint(auth.step)) return;
  return stored.id;
}

export function pluginHostAccount(auth: Record<string, unknown>, now = Date.now()) {
  const id = storedIdentity(auth);
  if (!id) return;
  try {
    const account = stepAccount(auth, false, now);
    const binding: PluginHostAccountBinding = { id, ...stepHostRoute(account) };
    return { account, binding };
  } catch { return; }
}

export function withPluginHostAccount(next: Record<string, unknown>, previous?: Record<string, unknown>,
  refresh = false): Record<string, unknown> {
  const result = { ...next };
  delete result[PLUGIN_HOST_ACCOUNT_FIELD];
  if (!next.step) return result;
  const prior = previous && storedIdentity(previous);
  const old = previous?.step as { uid?: unknown; profile?: unknown } | undefined;
  const current = next.step as { uid?: unknown; profile?: unknown };
  const same = refresh && old && typeof old.uid === 'string' && old.uid.trim()
    && old.uid === current.uid && old.profile === current.profile;
  result[PLUGIN_HOST_ACCOUNT_FIELD] = {
    id: (same && prior) || fingerprint(randomUUID()),
    credential: fingerprint(next.step),
  };
  return result;
}
