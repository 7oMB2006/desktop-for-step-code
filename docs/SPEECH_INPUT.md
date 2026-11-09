# Native Voice Dictation

## Architecture

The main-window microphone is a core Desktop input feature, not an installed
plugin or Agent tool. Settings live under General. V1 does not add a MiniChat
microphone, live voice conversation, model download or third-party code loader.

Native dictation, the generic plugin host provider and the legacy BVR bridge
share `electron/step-asr.ts`. All use the same official-account routing resolver
in `electron/step-model-account.ts`. Plugin receipt/lease/confirmation checks
remain in their existing brokers. Native capture has its own explicit consent,
recording identity, window-generation and conversation ownership checks; it
does not acquire a synthetic plugin identity or authorize any plugin.

The default source is the applied DFSC Step account. It works on a proposed
conversation before an Agent worker exists, independently of the chat model.
The supported profiles map to the same four fixed routes as plugin consumers:

| Profile | Base | Channel |
| --- | --- | --- |
| `step_plan` (legacy `step`) | `https://api.stepfun.com/step_plan/v1` | Plan |
| `step_plan_oversea` | `https://api.stepfun.ai/step_plan/v1` | Plan |
| `platform_cn` | `https://api.stepfun.com/v1` | API |
| `platform_oversea` | `https://api.stepfun.ai/v1` | API |

Each account-backed ASR call uses `/audio/asr/sse` and the dedicated
`stepaudio-2.5-asr` model, not the chat model. Unknown host-account models are
rejected. There is no retry, Plan-to-API fallback, alternate account or
automatic independent-service fallback. An unavailable/expired account fails
closed. Routing support is not proof of real-account ASR entitlement or billing.

## Capture and Consent

First invocation explains that DFSC is a community client and cannot provide
the official Desktop built-in ASR service. It discloses audio transmission,
possible quota/cost, no billing fallback and draft-only output. Available
account-backed first use names its channel, region and dedicated model.
No microphone access or ASR call precedes explicit acceptance.

Audio stays in memory. Web Audio captures continuous mono 16 kHz PCM through
an AudioWorklet with silent output, without restarting the microphone between
phrases. A simple energy/pause detector cuts non-overlapping phrases after
about 700 ms of silence or at four seconds. Pure silence is not uploaded.
Each phrase is encoded as PCM16 WAV, sent sequentially and appended to the
current composer through its existing synchronization/CAS protocol while
recording continues. Manual edits are not replaced and successive phrases
do not create a new paragraph each time. Finish flushes the remaining phrase
and waits for queued results; it does not re-upload prior audio.

This is near-real-time segmented dictation over the existing HTTP/SSE or
multipart route, not bidirectional WebSocket or per-word streaming. Hard
phrase boundaries can affect recognition accuracy; very quiet speech can
miss the energy threshold. Latency includes phrase detection and provider
processing. The Step Plan audio integration documentation, checked on
2026-11-09, explicitly limits its ASR to `stepaudio-2.5-asr` over HTTP/SSE.
No unsupported Plan WebSocket route or different billable API is guessed.

Consent version 2 explicitly covers uploads **during** recording and possible
per-segment requests/costs. Earlier after-stop consent is not sufficient and
requires acknowledgment again. No audio precedes acceptance. Dictation never
submits an Agent prompt or creates a conversation worker. Recording and
finishing disable sending; task Stop remains available.

Recording, finishing and error states use the existing centered composer
context row beside quotes, queue and return-to-bottom, not an extra row inside
the editor. Live changes and dictation share equal halves when both are
present. The status expands/collapses over 240 ms with cubic-out easing;
reduced motion settles directly. The recording waveform follows the current
theme accent; Stop and errors retain their semantic danger color.
The fixed row and four-pixel control-focus
gutter keep the editor's position and height unchanged. Long errors truncate
in the row with their complete message available on hover or keyboard focus.
While dictating during a running task, the main action stays Stop even when
the pending draft has text, references or attachments.

Cancel, navigation, settings opening, hide, reload, shutdown, account/config
changes and conversation replacement invalidate capture or pending output.
The main process rechecks ownership before sending and returning a result.
Cancellation discards queued/in-flight unfinished output and keeps words already
inserted into the draft. It cannot undo provider work already accepted or guarantee no charge.
DFSC does not write audio to disk; the chosen service has its own retention
policy, and a transcript subsequently sent by the user becomes normal history.

## Independent Services and Replacement Adapters

Independent ASR accepts a full HTTPS endpoint, a literal private key, a model
ID and an optional language. HTTP is allowed only on `localhost`, `127.0.0.1`
or `[::1]`. The local-adapter source requires loopback and sends no key or
DFSC account credential.

Authors can wrap a recognizer or another provider behind this service contract:

```http
POST <configured endpoint>
Content-Type: multipart/form-data; boundary=...
Authorization: Bearer <independent key, absent for local adapters>
```

Fields: `file` (`dictation.wav`, PCM WAV), `model`, `response_format=json`,
optional `language`. Return `{"text":"Recognized words"}`.

This lets a user replace the service/model without changing the core UI.
V1 adapters are user-operated services, not a new installed-plugin ASR-provider
ABI. DFSC does not install/start these programs or load their JavaScript in
the renderer. The existing generic `model.asr` plugin contract remains a
consumer of host ASR, not a reverse registration API for dictation providers.

## Storage and Limits

Settings, consent and independent key use the existing encrypted Desktop vault
under `__desktopSpeech`. Renderer queries expose only key presence, a CAS
revision and nonsecret route metadata. Login/logout preserve this field;
runtime-auth projection excludes it, and runtime responses cannot inject it.
Saving settings is serialized with shared account writes and checks the
revision. Changing service/destination cannot silently reuse its old key.

- One capture session and one in-flight upload per Desktop instance.
- 60-second total PCM duration; at most four seconds per continuous segment.
- At most four queued segments. A slow/full queue stops capture and discards
  unfinished audio without retrying or sending additional queued requests.
- Main-owned operation ID, exact monotonic segment sequence, at most 64
  segments and 60 seconds of total uploaded PCM per lease. Explicit Finish
  releases the lease only when no upload is in flight.
- Strict WAV validation and a 2 MiB IPC bound; continuous segments are at
  most 128,044 bytes each. No compressed full-recording buffer is retained.
- 60-second network deadline and 180-second recording lease.
- Independent response at most 256 KiB, Step SSE at most 2 MiB.
- Native transcript at most 50,000 characters across the whole recording.
- No credentials/query/fragment in endpoints, redirects, provider-body errors
  or automatic retries.
- Microphone permission is audio-only, main-renderer-only and armed for at
  most 15 seconds by an explicit recording action. Browser pages and MiniChat
  do not gain media permissions.

## Verification

From `Desktop/`:

```powershell
corepack pnpm typecheck
corepack pnpm exec tsx --test tests/speech.test.ts tests/speech-segments.test.ts tests/speech-main.test.ts tests/plugin-host-broker.test.ts tests/bvr-bridge.test.ts
corepack pnpm build
$env:DESKTOP_SPEECH_EVIDENCE = 'D:\DFSC-Preview-QA\native-speech-20261109'
node scripts/verify-speech.mjs
```

The Electron verifier runs the actual bundled main/preload/renderer and staged
runtime with a synthetic microphone, isolated profile and loopback-only
provider fixtures. Official account URLs are intercepted before product
startup and in child processes. No personal profile, real account, paid
request, ASR accuracy, physical microphone, installer or macOS acceptance is
established by these checks.

For a manual source preview on this Windows host, run
`Desktop/scripts/start-speech-preview.ps1`. It uses a dedicated D: profile,
does not copy credentials, and neither replaces the installed app nor changes
the desktop shortcut. Sign in or configure an independent service in the preview.
The script does not inject synthetic audio or intercept requests.
