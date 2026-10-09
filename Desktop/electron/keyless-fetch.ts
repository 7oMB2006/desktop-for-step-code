export interface KeylessEndpoint { baseUrl: string; token: string }

// The upstream SDKs require an internal API-key value even for no-auth services.
// Remove only our endpoint-scoped sentinel, never a real credential.
export function keylessFetch(original: typeof fetch, endpoints: KeylessEndpoint[]): typeof fetch {
  const targets = endpoints.map(endpoint => {
    const url = new URL(endpoint.baseUrl);
    return { origin: url.origin, path: `${url.pathname.replace(/\/$/, '')}/`, token: endpoint.token };
  });
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    let changed = false;
    for (const target of targets) {
      if (url.origin !== target.origin || !url.pathname.startsWith(target.path)) continue;
      if (headers.get('authorization') === `Bearer ${target.token}`) { headers.delete('authorization'); changed = true; }
      if (headers.get('x-api-key') === target.token) { headers.delete('x-api-key'); changed = true; }
    }
    return original(input, changed ? { ...init, headers } : init);
  };
}
export function installKeylessFetch(endpoints: KeylessEndpoint[], scope: { fetch: typeof fetch } = globalThis) {
  let current = keylessFetch(scope.fetch, endpoints);
  // Runtime timeout/proxy setup replaces fetch with Undici; preserve that transport
  // while retaining our header policy across each replacement.
  Object.defineProperty(scope, 'fetch', {
    configurable: true, enumerable: true,
    get: () => current,
    set: (transport: typeof fetch) => { current = keylessFetch(transport, endpoints); },
  });
}

const configuration = process.env.STEPCODE_DESKTOP_KEYLESS_ENDPOINTS;
if (configuration) {
  const endpoints: KeylessEndpoint[] = JSON.parse(configuration);
  if (!Array.isArray(endpoints) || endpoints.length > 50 || endpoints.some(endpoint => {
    if (typeof endpoint?.token !== 'string' || !/^desktop-no-auth-desktop-custom-[a-f0-9-]{36}$/.test(endpoint.token)) return true;
    const url = new URL(endpoint.baseUrl);
    return !['http:', 'https:'].includes(url.protocol) || Boolean(url.username || url.password || url.search || url.hash);
  })) throw new Error('Invalid Desktop no-auth configuration');
  installKeylessFetch(endpoints);
}
