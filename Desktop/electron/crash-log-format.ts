import { decodeString } from 'micromark-util-decode-string';
import { types } from 'node:util';

const redacted = '[redacted]';
const unavailable = '[unavailable]';
const maxText = 16000;
const maxNodes = 256;
const nativeStackGetter = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get;

export function crashRecord(text: string): string {
  const marker = '\n[truncated]\n';
  if (Buffer.byteLength(text) <= 64 * 1024) return text;
  const buffer = Buffer.alloc(64 * 1024 - Buffer.byteLength(marker));
  const length = buffer.write(text);
  return buffer.toString('utf8', 0, length) + marker;
}

function decodeText(text: string): string {
  let value = text.slice(0, maxText);
  for (let pass = 0; pass < 8; pass++) {
    const next = decodeString(value).replace(/\\u([0-9a-f]{4})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (next === value) break;
    value = next;
  }
  return value;
}

function sensitiveKey(key: string) {
  const name = decodeText(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /(?:apikey|accesstoken|refreshtoken|authtoken|password|passwd|secret|credential|cookie|authorization)$/.test(name)
    || ['token', 'credentials', 'auth', 'authentication', 'passwords', 'secrets'].includes(name);
}

/** Matching is bounded; decoding happens only on diagnostic copies, not caller data. */
export function crashText(text: string): string {
  let value = decodeText(text);
  if (text.length > maxText)
    value = value.replace(/(https?:\/\/)[^\s/]*$/gi, `$1${redacted}`);
  value = value.replace(/(https?:\/\/)[^\s/]+@/gi, `$1${redacted}@`);
  value = value.replace(/\b((?:set-)?cookie|authorization)\s*:\s*[^\r\n]*/gi, `$1: ${redacted}`);
  value = value.replace(/\b(Bearer|Basic)\s+[a-z0-9+/_.=-]+/gi, `$1 ${redacted}`);
  value = value.replace(/([?&])([^?&=\s]+)=([^&#\s]*)/g, (match, prefix, key) => {
    let decoded = key;
    try { decoded = decodeURIComponent(key); } catch {}
    return sensitiveKey(decoded) ? `${prefix}${key}=${redacted}` : match;
  });
  value = value.replace(/(["']?)((?:[a-z0-9_.-]*(?:api[-_.]?key|access[-_.]?token|refresh[-_.]?token|auth[-_.]?token|password|passwd|secret|credential|cookie|authorization))|token|credentials|auth|authentication)(\1\s*[:=]\s*)("(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;}&]+)/gi,
    (_match, quote, key, separator) => `${quote}${key}${separator}${redacted}`);
  return value + (text.length > maxText ? '\n[truncated]' : '');
}

function property(value: object, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/** Never invoke user-controlled getters, toJSON or toString while crashing. */
export function crashValue(value: unknown): string {
  let nodes = 0;
  const seen = new Set<object>();
  const copy = (entry: unknown, depth: number): unknown => {
    if (++nodes > maxNodes || depth > 8) return '[truncated]';
    if (typeof entry === 'string') return crashText(entry);
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'number') return entry;
    if (typeof entry === 'bigint') return String(entry);
    if (!entry || typeof entry !== 'object' || types.isProxy(entry)) return unavailable;
    if (seen.has(entry)) return '[circular]';
    seen.add(entry);
    try {
      if (Array.isArray(entry)) {
        const result = [];
        const length = Math.min(property(entry, 'length') ?? 0, maxNodes);
        for (let index = 0; index < length && nodes < maxNodes; index++) result.push(copy(property(entry, String(index)), depth + 1));
        return result;
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(entry).slice(0, maxNodes)) {
        if (nodes >= maxNodes) { result['[truncated]'] = true; break; }
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        result[crashText(key)] = sensitiveKey(key) ? redacted : descriptor && 'value' in descriptor
          ? copy(descriptor.value, depth + 1) : unavailable;
      }
      return result;
    } finally { seen.delete(entry); }
  };
  try {
    if (typeof value === 'string') return crashText(value.trim() ? value : '(empty)');
    return crashText(JSON.stringify(copy(value, 0)) ?? unavailable);
  } catch { return unavailable; }
}

export function crashError(error: unknown): { message: string; stack: string } {
  try {
    if (types.isProxy(error)) return { message: unavailable, stack: '(none)' };
    if (!(error instanceof Error)) return { message: crashValue(error), stack: '(none)' };
    const message = property(error, 'message');
    // V8 may format a lazy stack even while inspecting its descriptor. Use a
    // synchronous diagnostic-only formatter, and restore the exact global hook.
    // Reading the lazy stack caches the diagnostic frames on the Error; message
    // and detail data are never changed.
    const formatter = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
    let stack: unknown;
    try {
      Object.defineProperty(Error, 'prepareStackTrace', { configurable: true, writable: true,
        value: (_error: Error, sites: NodeJS.CallSite[]) => sites.slice(0, 32).map(site => `    at ${site}`).join('\n') });
      const descriptor = Object.getOwnPropertyDescriptor(error, 'stack');
      stack = descriptor && 'value' in descriptor ? descriptor.value
        : nativeStackGetter && descriptor?.get === nativeStackGetter ? nativeStackGetter.call(error) : undefined;
    } catch { /* An immutable formatter or hostile stack is not trusted. */ }
    finally {
      if (formatter) Object.defineProperty(Error, 'prepareStackTrace', formatter);
      else Reflect.deleteProperty(Error, 'prepareStackTrace');
    }
    // Built-in errors keep name on the prototype; a custom accessor is not trusted.
    let prototype: object | null = error;
    let name: unknown;
    for (let depth = 0; prototype && depth < 8 && name === undefined; depth++) {
      if (types.isProxy(prototype)) break;
      name = property(prototype, 'name');
      prototype = Object.getPrototypeOf(prototype);
    }
    return {
      message: `${typeof name === 'string' ? crashText(name) : 'Error'}: ${typeof message === 'string' ? crashText(message) : unavailable}`,
      stack: typeof stack === 'string' ? crashText(stack) : '(none)',
    };
  } catch { return { message: unavailable, stack: '(none)' }; }
}

export function crashDetails(details: unknown): string[] {
  try {
    if (!details || typeof details !== 'object') return [];
    if (types.isProxy(details)) return [unavailable];
    return Object.keys(details).slice(0, 64).map(key => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(details, key);
        const value = sensitiveKey(key) ? redacted : descriptor && 'value' in descriptor ? crashValue(descriptor.value) : unavailable;
        return `${crashText(key)}: ${value}`;
      } catch { return unavailable; }
    });
  } catch { return [unavailable]; }
}
