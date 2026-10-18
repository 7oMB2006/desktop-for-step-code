import type { SessionStatusDetails } from '../src/contracts';
import { redactSensitiveText } from '../src/subagent-redact';

function text(value: unknown, limit = 4096): string | undefined {
  if (typeof value !== 'string') return;
  return redactSensitiveText(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\bsk-[a-z0-9_-]{8,}/gi, '[redacted]').slice(0, limit)).trim() || undefined;
}
export function statusDetails(value: unknown): SessionStatusDetails | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  let endpoint: string | undefined;
  if (typeof raw.endpoint === 'string' && raw.endpoint.length <= 8192) {
    try {
      const url = new URL(raw.endpoint);
      if (['http:', 'https:'].includes(url.protocol)) endpoint = text(`${url.origin}${url.pathname}`);
    } catch { /* Invalid or unavailable endpoint. */ }
  }
  const agents = Array.isArray(raw.agents) ? [...new Set(raw.agents.slice(0, 128)
    .map(path => text(path)).filter((path): path is string => Boolean(path)))] : undefined;
  return {
    trusted: typeof raw.trusted === 'boolean' ? raw.trusted : undefined,
    agents, agentsTruncated: Array.isArray(raw.agents) && raw.agents.length > 128 || undefined,
    collaboration: raw.collaboration === 'Plan' || raw.collaboration === 'Default' ? raw.collaboration : undefined,
    version: text(raw.version, 80),
    versionSource: ['override', 'embedded', 'fallback'].includes(String(raw.versionSource))
      ? raw.versionSource as SessionStatusDetails['versionSource'] : undefined,
    endpoint, provider: text(raw.provider, 200), model: text(raw.model, 300),
  };
}

export function statusBuild(value: unknown): Pick<SessionStatusDetails, 'commit' | 'node'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  return {
    commit: typeof raw.commit === 'string' && /^[a-f0-9]{40}$/.test(raw.commit) ? raw.commit : undefined,
    node: typeof raw.node === 'string' && /^v\d+\.\d+\.\d+$/.test(raw.node) ? raw.node : undefined,
  };
}
