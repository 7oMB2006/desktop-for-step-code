const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/;
const PREFIX = 'stepcode-desktop://sessions/';

export function sessionReference(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error('Invalid session ID');
  return `${PREFIX}${id}`;
}

export function sessionIdFromReference(value: string): string {
  const text = value.trim();
  if (SESSION_ID.test(text)) return text;
  try {
    const url = new URL(text);
    const id = url.pathname.slice(1);
    if (url.protocol === 'stepcode-desktop:' && url.hostname === 'sessions'
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && SESSION_ID.test(id) && text === sessionReference(id)) return id;
  } catch {}
  throw new Error('Expected a session ID or stepcode-desktop://sessions/<id> reference');
}
