const OUTSIDE_WORKSPACE = 'Image is outside this session workspace. Move it into the workspace before sending.';
const UNKNOWN_DELIVERY = 'Remote image delivery was not confirmed. Check the remote chat before retrying; do not automatically retry.';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const result = (value, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });
const failed = reason => result({ delivered: false, reason }, true);

export default function registerDesktopRemote(pi) {
  const url = process.env.DESKTOP_SESSION_URL, token = process.env.DESKTOP_SESSION_TOKEN;
  if (!url || !token || process.env.STEPCODE_SUBAGENT_CHILD === '1') return;
  try {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
      || endpoint.pathname !== '/sessions' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return;
  } catch { return; }
  pi.registerTool({
    name: 'desktop_send_image',
    label: 'Send Remote image',
    description: 'Deliver one explicit workspace-local PNG, JPEG or WebP image to the attached Remote chat. Requires a live attached Remote run and the human-approved image-delivery opt-in. Use only to deliver a requested image, not to scan files or infer delivery from Markdown paths. Files outside this session workspace are rejected. A successful upload alone is not delivery. Never automatically retry an unconfirmed send.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['path'],
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Exact local image file path within this session workspace. No URL or network path.' },
        caption: { type: 'string', maxLength: 500, description: 'Optional compact caption, delivered as a separate message after the image.' },
      },
    },
    execute: async (_id, args, signal) => {
      if (!record(args) || Object.keys(args).some(key => !['path', 'caption'].includes(key))
        || typeof args.path !== 'string' || !args.path.trim() || args.path.length > 4096 || /[\x00-\x1f\x7f]/.test(args.path)
        || /^(?:[a-z][a-z\d+.-]*:)/i.test(args.path) && !/^[a-z]:[\\/]/i.test(args.path)
        || args.path.startsWith('\\\\') || args.path.startsWith('//')
        || args.caption !== undefined && (typeof args.caption !== 'string' || args.caption.length > 500 || /[\x00-\x08\x0b-\x1f\x7f]/.test(args.caption)))
        return failed('Expected an explicit local image path and an optional caption of at most 500 characters.');
      if (signal?.aborted) return failed('Remote image request was cancelled before delivery.');
      try {
        const response = await fetch(url, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'remote-image', path: args.path, ...(args.caption !== undefined ? { caption: args.caption } : {}) }),
          signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(150000)]),
          redirect: 'error',
        });
        const text = await response.text();
        if (text.length > 4096) return failed(UNKNOWN_DELIVERY);
        const value = JSON.parse(text);
        if (signal?.aborted) return failed(UNKNOWN_DELIVERY);
        if (!record(value)) return failed(UNKNOWN_DELIVERY);
        // Do not reflect arbitrary broker errors, paths, credentials or tool payloads.
        if (value.error === OUTSIDE_WORKSPACE || value.delivered === false && value.reason === OUTSIDE_WORKSPACE)
          return failed(OUTSIDE_WORKSPACE);
        if (!response.ok || value.delivered !== true || typeof value.messageId !== 'string'
          || !value.messageId.length || value.messageId.length > 200 || /[\x00-\x20\x7f]/.test(value.messageId))
          return failed(UNKNOWN_DELIVERY);
        return result({ delivered: true, messageId: value.messageId,
          ...(typeof value.captionDelivered === 'boolean' ? { captionDelivered: value.captionDelivered } : {}) });
      } catch { return failed(UNKNOWN_DELIVERY); }
    },
  });
}
