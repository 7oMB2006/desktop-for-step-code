# Provider Discovery and Network Policy

## Discovery Layers

Model listing and generation are separate contracts. Discovery uses the selected
runtime protocol: OpenAI Chat Completions, OpenAI Responses or Anthropic Messages.
It reads one bounded listing, at most 1,000 model IDs, from `data[]`, a bare array
or an enriched `models{}` map. Anthropic root addresses normalize to `/v1/models`;
deployment prefixes stay intact. There is no trial generation request, alternate
host sweep, Gemini adapter or automatic pagination.

Missing capabilities can be supplemented by reviewed official documentation,
then an exact provider/model match from `https://models.dev/api.json`. Official
endpoint matching is exact; relay addresses require an explicit catalog binding.
Supported catalog identities are OpenAI, Anthropic, DeepSeek, OpenRouter, xAI and
Mistral. Users can disable catalog access. No provider credentials, endpoint,
cookies or model query are sent to the public directory.

The public response has an 8-second deadline and a 16 MiB limit. Concurrent reads
share one request, memory cache freshness lasts 10 minutes, and a failed refresh
can use a visibly marked snapshot no older than 24 hours. Cold failure leaves
upstream results usable. An upstream error or empty list never becomes a list of
directory model IDs. Optional enrichment can add up to 8 seconds.

Priority is manual values, explicit upstream declarations, reviewed official
metadata, then public-directory metadata. Fields retain individual provenance.
Refresh removes withdrawn automatic metadata and preserves manual overrides.
Changing endpoint, protocol or model identity invalidates automatic facts;
changing only the catalog binding clears directory facts, preserving other
sources. Saved credentials are reused only for the same discovery endpoint.

Directory membership is not account entitlement or verified gateway support.
Only explicit effort enums representable by the current adapters become
controls. Boolean reasoning flags, token budgets and unfamiliar enums do not
invent levels. The API value `none` becomes UI `off` through an explicit map.
Existing Ultra support, manual mappings and deferred provider application remain
intact.

## Official Snapshot

The reviewed 2026-11-16 snapshot covers five exact OpenAI endpoint IDs:
`gpt-6.1-terra`, `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna`, `gpt-6-sol`.
Each record links its model documentation. Unknown IDs and relay addresses never
inherit these facts. Runtime fallback capacities are displayed as unknown, not
as confirmed model limits. Models requiring Responses tool calling cannot be
newly saved as Chat Completions; existing readable configurations remain readable.

## Proxy Policy

Settings > General > Network offers system, direct and manual HTTP(S) proxy
modes, explicit save, persistence and a bounded reachability probe. This does
not change Windows proxy settings. Manual addresses cannot include credentials,
paths, queries or fragments. Saving is blocked while model tasks, discovery or
provider diagnostics are active.

Discovery and diagnostics use Electron `net.fetch` with the default session's
selected policy, including system PAC resolution. Requests omit ambient browser
credentials, bypass caches and forbid redirects. Listing remains bounded to
15 seconds / 2 MiB; diagnostics to 30 seconds / 1 MiB. Errors expose only
application-generated HTTP status or timeout labels, never raw response bodies.

Step Code child processes receive two authenticated random-port loopback proxy
gateways. Each resolves the destination through Electron's selected policy.
Plain HTTP streams without logging or buffering; HTTPS uses opaque CONNECT
tunnels, without TLS interception. Gateway credentials never reach the renderer
or provider. Runtime stderr filtering also removes proxy URLs and variables.
Keyless endpoint-scoped header removal continues to use its existing bootstrap.

Changing policy retires old connections and pending route resolutions.
Application failure restores the previous policy; failed rollback closes the
gateway until restart. Only PAC-declared fallback routes are attempted before
sending model data.

SOCKS and authenticated upstream proxies are unsupported by the runtime gateway
and fail closed. HTTPS PAC resolution has origin granularity, not the original
request path. The reachability probe tests Electron connectivity, not runtime
proxy compatibility, model entitlement or credential validity. Speech, plugins,
MCP services and arbitrary subprocesses have independent network ownership.

## Verification Boundary

See `VERIFICATION.md` for actual integrated-branch results. Fixture tests do not
establish paid-provider access or live public-directory availability. Source
builds do not update existing trial packages, formal profiles or shortcuts.
