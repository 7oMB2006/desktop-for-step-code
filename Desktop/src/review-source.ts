import type { Message } from './contracts';
import { conversationEntries } from './conversation-presentation';

export function lastCompletedResponse(messages: Message[], busy: boolean) {
  const entries = conversationEntries(messages);
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== 'response' || busy && index === entries.length - 1) continue;
    const users = messages.slice(0, entry.index).filter(message => message.role === 'user');
    return { items: entry.items, number: users.length, timestamp: users.at(-1)?.timestamp };
  }
  return undefined;
}

export function sensitiveDiffPath(path: string) {
  const name = path.replace(/\\/g, '/').split('/').at(-1) ?? '';
  return /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|auth\.json|credentials(?:\..*)?|id_(?:rsa|ed25519)(?:\..*)?)$/i.test(name)
    || /\.(?:pem|key|p12|pfx)$/i.test(name);
}

export function redactDiffText(text: string) {
  return text.replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/(["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1"[redacted]"');
}
