# Desktop Remote

## Scope

The first integration is a Desktop-hosted Feishu channel, not a standalone
service. Desktop must remain running and its host must stay awake and online.
Closing the window to the tray is different from quitting the application.
The independent Remote page is opened by the phone icon immediately to the
right of Settings; channel selection and channel configuration are separate.

This MVP supports one human private chat bound to one already-open session:
text input, bounded assistant-text cards, stopping the bound task, and known
one-time tool permission confirmations. It does not expose a Web URL, public
listener, tunnel, mobile application, group chat, attachment transport, remote
login, arbitrary extension forms, permission-tier changes or project trust.
It does not fulfill the separate self-hosted Windows/Linux Web Remote TODO.

## Connection And Binding

1. Open Remote, choose Feishu and explicitly start pairing. The authorization
   link is opened by a separate user action in the system browser.
2. After platform authorization and the socket's readiness handshake, generate
   a two-minute verification code. Send it to the bot in a private chat.
3. Choose an already-open, connected, idle Desktop session and confirm the
   received candidate locally. Authorization alone never binds a chat, and an
   arbitrary first message cannot claim the binding.
4. Configure card callbacks through the official platform link and send a
   verification card. Its button only tests callbacks; it approves no tool.
   A connected message socket does not establish callback readiness.

The confirmation authorizes forwarding future assistant replies in the bound
session, including locally initiated rounds. Existing transcript history,
thinking blocks, raw tool results and attachments are not forwarded. A response
may intentionally describe local information, so use a suitable session and do
not treat redaction as a general data-loss-prevention system.

The helper retains the exact sender and private-chat identity. Main retains
the runtime ID, session ID, worker object, RPC object and a fresh binding ID.
Changing the locally viewed session never changes the remote target.
Replacing/disconnecting that worker invalidates the binding. Bound hosts are
not reused for a new session or recycled as idle workers. History and
configuration mutations require unbinding first.

## Process And Permission Boundaries

- Electron main owns the agent, message queue, session routing and approvals.
  The renderer has only typed `remoteState` / `remoteAction` IPC and receives no
  Feishu credentials or authorization URL.
- A separate Node helper owns the SDK socket and in-memory Feishu credentials.
  It does not launch a second agent or receive the model's API keys, transcript,
  personal Step Code profile, or arbitrary parent environment. Only the platform
  executable/temp variables and explicit HTTP proxy variables are inherited.
  Process separation is not an operating-system sandbox.
- Credentials are not saved. Disconnect or quit destroys the helper; reconnect
  requires pairing again. This does not revoke authorization on Feishu itself.
- Only the known native permission `confirm` envelope, tied to the exact pending
  tool call and runtime, becomes an Allow once / Deny card. Unknown forms,
  clarifications, login, project trust and permission-level acknowledgments stay
  local. Actionable cards recover the complete, redacted tool input from that
  call, not the upstream's shortened summary. Unrecoverable inputs and details
  exceeding the card's 5,000-character limit stay local rather than offering
  approval for clipped content. Existing native permission policy still applies.
- Both ends answer the same pending request. The first valid response wins.
  Remote tokens are opaque, single-use, bound to the chat, valid for at most ten
  minutes, and revoked on local completion, expiry or unbinding. A token never
  grants a standing permission or answers a replacement request.

## Delivery And Lifecycle

Remote text uses the existing Desktop pending-message queue and the session's
effective model/account configuration. It does not change billing mode, consume
local one-shot composer selections, or launch a Goal. Pending local approvals,
armed/active Goals, failed/interrupted workers and configuration transitions can
reject remote input rather than silently recover or resubmit it.

Inbound text is limited to 12,000 characters; leading slash commands and all
non-text messages are rejected. The pinned upstream gate validates message age
and deduplicates eligible IDs. Main adds bounded, connection-local deduplication
and queue limits. This is not durable exactly-once delivery across restarts.

Assistant text is coalesced into updates to one card per round, with a bounded
5,000-character visible tail. Known credential-shaped strings are redacted;
this cannot identify every possible secret in generated prose. Thinking and
tool payloads are excluded. Only authoritative task completion labels a round
Completed; failures and user cancellation are not successes. Old stop buttons
cannot stop a later round.

Socket reconnection pauses remote input and retains the current binding while
Desktop work continues. Fatal connection errors release the binding and helper,
not the local task. Disconnect/unbind immediately fences old events and tokens.
Already accepted queued messages and running tasks remain in Desktop; unbinding
is not a stop or queue withdrawal operation. Card-delivery failures are shown
locally and do not retry model work. Ambiguous card POST failures are not retried
automatically, since their receipt may be unknown. Missed output is not a
durable replay log. Quitting Desktop also stops its hosted agent runtimes.

## Staging And Automated Verification

`Desktop/scripts/build-remote-adapter.mjs` bundles the unchanged
`packages/lark-adapter` from pin
`81e79bc4b699148d6823fedde9b5e70d9a80255f` with its locked Feishu SDK 1.76.0.
It rejects a different pin, modified adapter sources or an unexpected SDK.
`stage-runtime.mjs` includes this step. The existing whole-runtime packaging
rule includes the helper, adapter and bundled dependency notices. No runtime
pin upgrade or change to the upstream checkout is part of this feature.

From `Desktop/`, with the fixed runtime staged:

```powershell
corepack pnpm typecheck
corepack pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts
corepack pnpm build
node scripts/verify-remote-access.mjs
$env:PLAYWRIGHT_CHANNEL = 'msedge'
node scripts/verify-remote-access-preview.mjs
```

The Remote Electron verifier is registered in the shared runtime CI group. It
uses the real staged SDK/helper for offline loading and gate checks, then an
isolated fake network helper and loopback model provider for the complete
Desktop route. Injection exists only in the test process; production has no
fake-transport environment switch. Unit tests cover the helper through an
injected SDK boundary. These checks never authorize Feishu, call a paid model
or send user content to an external chat.

The earlier `tests/fixtures/remote-access.html` remains an interactive design
preview with illustrative data, not proof of a working platform connection.

## Manual Acceptance Still Required

Use a test bot/private chat, a disposable project and an Ask session. The owner
must explicitly perform real platform authorization; automated tests do not.

1. Cancel authorization, retry, authorize and confirm that message transport
   and card callback readiness are reported separately.
2. Verify that the wrong/expired code, another human, a group and another chat
   cannot bind or control a session. Confirm that no old transcript is sent.
3. Bind session A, view session B locally, and send a harmless text request
   remotely. Check A's transcript and effective account/model; B and its draft
   must remain unchanged.
4. Request a harmless tool operation that requires Ask. Answer locally and then
   remotely, and repeat in the opposite order. Exactly one original request
   may settle; old cards must not authorize subsequent operations. Verify that
   clarification, login and project trust remain local.
5. Stop a long-running harmless task. An old round's button must not stop the
   next round. Unbind/disconnect without stopping another running task and
   inspect any accepted queue locally.
6. Interrupt network access, reconnect, close to tray, and quit/restart.
   Check actual SDK reconnection, token invalidation and helper cleanup. A
   restarted app requires pairing; restored history is not a resumed process.
7. Check the staged resources in a newly built installer and run the same
   acceptance against that exact package. Native macOS and cloud CI are
   separate gates.

No real-account, packaged, macOS-native, cloud-CI or release readiness is
established by the source-only deterministic acceptance.
