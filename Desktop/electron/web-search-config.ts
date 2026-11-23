import { isWebSearchProvider, webSearchIds, type WebSearchProvider, type WebSearchSettings } from '../src/web-search';

export const WEB_SEARCH_FIELD = '__desktopWebSearch';
type Auth = Record<string, unknown>;
type Config = {
  revision: number; enabled: boolean; fallback: boolean; step: { plan?: boolean; api?: boolean }; manualOrder: boolean;
  order: WebSearchProvider[]; credentials: Partial<Record<Exclude<WebSearchProvider, 'step'>, string>>;
};
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function stepSearchAccount(auth: Auth) {
  const step = record(auth.step);
  const credential = step.type === 'oauth' ? step.access : step.type === 'api_key' ? step.key : undefined;
  if (typeof credential !== 'string' || !credential.trim() || credential.trim() === '<your_api_key>') return;
  const profile = step.profile === 'step' ? 'step_plan' : step.profile ?? (step.type === 'oauth' ? 'step_plan' : 'platform_cn');
  if (typeof profile !== 'string' || !['step_plan', 'step_plan_oversea', 'platform_cn', 'platform_oversea'].includes(profile)) return;
  const mode = profile.startsWith('step_plan') ? 'plan' : 'api';
  const host = profile.endsWith('_oversea') ? 'api.stepfun.ai' : 'api.stepfun.com';
  return { mode, key: credential.trim(), url: `https://${host}${mode === 'plan' ? '/step_plan' : ''}/v1/mcp/web_search/mcp` } as const;
}

function instance(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('web-search:invalid-instance'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('web-search:invalid-instance');
  return url.href.replace(/\/+$/, '');
}

function config(auth: Auth): Config {
  const raw = record(auth[WEB_SEARCH_FIELD]);
  const credentials: Config['credentials'] = {};
  for (const id of webSearchIds) {
    if (id === 'step') continue;
    const value = record(raw.credentials)[id];
    if (typeof value === 'string' && value.length && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value)) {
      try { credentials[id] = id === 'searxng' ? instance(value) : value; } catch { /* Ignore invalid stored URLs. */ }
    }
  }
  return {
    revision: typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    enabled: raw.enabled !== false, fallback: raw.fallback !== false, manualOrder: raw.manualOrder === true,
    step: Object.fromEntries(Object.entries(record(raw.step)).filter(([mode, enabled]) =>
      (mode === 'plan' || mode === 'api') && typeof enabled === 'boolean')),
    order: Array.isArray(raw.order) ? [...new Set(raw.order.filter(isWebSearchProvider))] : [], credentials,
  };
}

const stepEnabled = (value: Config, step?: 'plan' | 'api') =>
  step === 'plan' ? value.step.plan !== false : step === 'api' && value.step.api === true;

function savedOrder(value: Config, step?: 'plan' | 'api'): WebSearchProvider[] {
  const remaining = value.order.filter(id => id !== 'step' && value.credentials[id]);
  const slot = value.order.indexOf('step');
  if (slot >= 0 || stepEnabled(value, step)) {
    remaining.splice(value.manualOrder && slot >= 0 ? Math.min(slot, remaining.length) : 0, 0, 'step');
  }
  return remaining;
}

export function webSearchSettings(auth: Auth): WebSearchSettings {
  const value = config(auth);
  const step = stepSearchAccount(auth)?.mode;
  return {
    revision: value.revision, enabled: value.enabled, fallback: value.fallback, step,
    order: savedOrder(value, step).filter(id => id !== 'step' || stepEnabled(value, step)),
    configured: webSearchIds.filter(id => id === 'step' ? step !== undefined : Boolean(value.credentials[id])),
    instance: value.credentials.searxng,
  };
}

export function webSearchRoute(auth: Auth) {
  const settings = webSearchSettings(auth);
  const { credentials } = config(auth);
  return {
    order: settings.enabled ? settings.order : [],
    fallback: settings.fallback,
    credentials,
    step: stepSearchAccount(auth),
  };
}

export function saveWebSearch(auth: Auth, revision: unknown, input: unknown): Auth {
  const value = config(auth);
  if (revision !== value.revision) throw new Error('web-search:stale');
  const edit = record(input);
  const step = stepSearchAccount(auth)?.mode;
  const order = savedOrder(value, step);
  if (edit.action === 'policy' && (edit.field === 'enabled' || edit.field === 'fallback') && typeof edit.value === 'boolean') {
    value[edit.field] = edit.value;
  } else if (edit.action === 'order' && Array.isArray(edit.order)) {
    const enabled = stepEnabled(value, step);
    const visible = order.filter(id => id !== 'step' || enabled);
    if (edit.order.length !== visible.length || new Set(edit.order).size !== visible.length
      || !edit.order.every(id => isWebSearchProvider(id) && visible.includes(id))) throw new Error('web-search:stale');
    value.order = [...edit.order];
    if (!enabled && order.includes('step')) value.order.splice(order.indexOf('step'), 0, 'step');
    value.manualOrder = true;
  } else if (isWebSearchProvider(edit.id)) {
    const id = edit.id;
    if (edit.action === 'remove' && id !== 'step') {
      delete value.credentials[id];
      value.order = order.filter(provider => provider !== id);
    } else if (edit.action === 'service' && typeof edit.enabled === 'boolean') {
      if (id === 'step') {
        if (!step || edit.credential !== undefined) throw new Error('web-search:invalid-service');
        value.step[step] = edit.enabled;
      } else {
        const raw = edit.credential;
        if (raw !== undefined && (typeof raw !== 'string' || raw.length > 2048
          || !raw.trim() || /[\x00-\x1f\x7f]/.test(raw))) throw new Error('web-search:invalid-credential');
        if (typeof raw === 'string') value.credentials[id] = id === 'searxng' ? instance(raw.trim()) : raw.trim();
        if (!value.credentials[id]) throw new Error('web-search:invalid-credential');
      }
      value.order = edit.enabled ? order.includes(id) ? order : id === 'step' && !value.manualOrder ? [id, ...order] : [...order, id]
        : order.filter(provider => provider !== id);
    } else throw new Error('web-search:invalid-service');
  } else throw new Error('web-search:invalid-service');
  return { ...auth, [WEB_SEARCH_FIELD]: { ...value, revision: value.revision + 1 } };
}
