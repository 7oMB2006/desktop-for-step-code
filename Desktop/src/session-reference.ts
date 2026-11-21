const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/;
const PREFIX = 'stepcode-desktop://sessions/';

export function sessionReference(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error('Invalid session ID');
  return `${PREFIX}${id}`;
}

export function sessionIdFromReference(value: string): string {
  const text = value.trim();
  if (SESSION_ID.test(text)) return text;
  const id = sessionLinkId(text);
  if (id) return id;
  throw new Error('Expected a session ID or stepcode-desktop://sessions/<id> reference');
}

export function sessionLinkId(value: string | undefined): string | undefined {
  if (!value?.startsWith(PREFIX)) return;
  const id = value.slice(PREFIX.length);
  return SESSION_ID.test(id) && value === sessionReference(id) ? id : undefined;
}

export function sessionLinkRanges(text: string) {
  if (!text.includes(PREFIX)) return [];
  const pattern = /(?<![A-Za-z0-9_./:@-])stepcode-desktop:\/\/sessions\/([A-Za-z0-9_-]{1,100})(?![A-Za-z0-9_/%#?=&-]|\.[A-Za-z0-9_])/g;
  return Array.from(text.matchAll(pattern), match => ({
    id: match[1], href: match[0], from: match.index, to: match.index + match[0].length,
  }));
}
