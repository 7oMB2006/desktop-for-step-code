# BVR Account Bridge

This optional post-0.6.0 integration lets BVR follow the applied Desktop Step
account and its own session's live model. It does not change the upstream pin.
It does not install BVR, install dependencies, publish a community entry or
modify the user's personal Step Code profile.

## Consent and Transport

BVR's configuration tool writes `step-runtime/bvr/config.json` with
`schemaVersion: 2`, `mode: "dfsc"` and `hostAccess: "confirm"`.
Installing a marketplace plugin is not this opt-in. Legacy BVR configurations
remain independent until the user explicitly changes them.

The main-view plugin center also supports this explicit configuration through
BVR's detail page. It saves the runtime directory, mode and advanced download
preferences in the Desktop-owned profile. Independent mode provides separate
official Step endpoint/key/model groups for video/synthesis and ASR. Neither
connection borrows the other's key or endpoint, and no credential value is
returned to the renderer. Blank key fields retain saved values; successful saves
clear newly entered values. Unsupported legacy provider or credential-bearing
proxy/endpoint configuration is protected from UI overwrite.

The runtime directory must identify an updated BVR checkout with
`dfscConfigurationVersion: 1`, Node.js 24+ and dependencies already installed.
The environment check resolves dependencies without executing them or calling a
provider. This integration is not a runtime installer or a general custom-provider
form. Existing Gemini configurations can still use BVR's configuration CLI.

Main starts a loopback-only HTTP service and writes a private, app-instance
connection descriptor at `step-runtime/bvr/host.json`. Its random capability
is not a Step API key. No login credential is exposed to the renderer, plugin
manifest, descriptor, model context or tool output. The BVR launcher reads this
descriptor, strips inherited provider credentials, disables local dotenv
provider loading and identifies its runtime by its launcher's parent PID.
The BVR MCP declaration supplies a nonsecret `STEPFUN_API_KEY` placeholder so
the upstream MCP environment resolver does not auto-inject the host's real key
into the launcher. Independent mode replaces it only from its private file.

`POST /context` reads `get_state` from that resident runtime and returns only
the active model, channel, region, capabilities and an opaque revision.
`POST /complete` accepts text/video/ASR operations bound to that revision.
Main owns the endpoint, credential and model in every request; caller-supplied
URLs, keys, model IDs or headers are not forwarded.

The first paid request requires native confirmation for that session, account
and model, including under Full Access. The prompt names the channel and the
quota cost. Invalid tokens, browser origins, nonresident PIDs, absent opt-in
and stale revisions fail closed. This is a same-OS-user capability, not a
sandbox against malicious native plugins that can read the user's files.

## Billing and Lifecycle

Only profiled, unexpired official Step OAuth credentials are supported.
The four CN/overseas API/Plan profiles each map to a fixed official endpoint.
Unprofiled keys and custom providers are rejected rather than guessed.

The BVR caller pins one context across all stages of a research operation.
Account persistence, model selection, runtime disposal and application shutdown
invalidate outstanding leases and abort in-flight requests. Live runtime state
is rechecked before sending and returning results, including after approval.
Pending UI choices are not active accounts or models. Abort cannot undo provider
work already accepted or guarantee that it was not billed.

Saving does not implicitly restart any session or stop an idle Cron host.
Existing sessions require an explicit restart to adopt the new configuration.
The plugin launcher snapshots the configuration and private environment, and BVR
rechecks that revision before operations and provider requests, including between
ASR and synthesis. Changed, deleted or unreadable configuration blocks further
model requests from the old process with restart guidance, instead of continuing
under old direct-API credentials. Standalone BVR startup remains unchanged.
This does not cancel a provider request that was already accepted or prevent a
same-OS-user native process from bypassing the integration deliberately.

There is no Plan-to-API retry, alternate model selection or provider fallback.
Video support is conservative: the BVR stable model `step-3.7-flash`, recorded
compatibility model `step-5-preview`, or explicit video input capability.
Image capability alone is insufficient. Both Plan and API ASR use the dedicated
`stepaudio-2.5-asr` model at the current region/account/channel's `/audio/asr/sse`
endpoint, not the chat model. ASR failure is reported without switching to direct
API. Captions and transcripts are summarized by the current model. Local fixture
coverage does not establish current real-account availability or billing.

Requests are limited to 32 MiB JSON, responses to 2 MiB, two simultaneous model
requests per session, and a 120-second model deadline. Only JSON content is
supported; redirects and remote file operations are not exposed. BVR limits
individual media to 23 MiB and uses video data URLs instead of an API upload
fallback. Larger inputs require shorter windows.

## Verification Boundary

Use `tests/bvr-bridge.test.ts` for route pairing, opt-in, native consent,
revocation, stale snapshots, cancellation and error redaction. The BVR repository
contains launcher and client tests and an isolated real-MCP bridge verification
script. `scripts/verify-bvr-host.mjs` additionally runs a real staged Step runtime,
its discovered BVR child, the native session confirmation and a complete tool
round trip against local model fixtures. `scripts/verify-bvr-electron.mjs`
checks actual Electron startup, renderer isolation, missing opt-in and shutdown.
These use fake account data and model responses. They do not establish
real-account quota deductions, all media/model compatibility, release readiness
or native macOS acceptance.

`scripts/verify-plugin-center.mjs` mounts the production component with a fixture
bridge for responsive/theme/focus/draft checks. The updated
`scripts/verify-capabilities.mjs` exercises native marketplace/MCP management,
and `scripts/verify-bvr-settings-electron.mjs` installs the actual plugin,
saves two independent connections and initializes its real MCP child without
issuing a model request. These scripts do not publish a marketplace entry.

The BVR-based layout/control/copy contract and resource-vs-host boundaries are
described in [Plugin Authoring](PLUGIN_AUTHORING.md). Reusable resource and
host-field examples live in [examples/plugins](../examples/plugins/README.md).
