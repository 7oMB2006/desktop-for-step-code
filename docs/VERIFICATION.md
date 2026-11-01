# Verification

## Upstream overlay pin: subagent outcomes and session records (2026-11-01)

The v016 baseline carries two upstream commits installed by the applier before
the desktop patches, declared under `upstream.commits` in the manifest:
`7487124e7b27c604535fc8439ccd0d0b81c5c299` (session record of facts,
upstream PR stepfun-ai/Step-Code#318) and
`90a57820c81c6e78e4a3ea5be3f66694ac038611` (preserve subagent outcomes, upstream
PR stepfun-ai/Step-Code#324). They land as uncommitted worktree edits, so the
staging guard still checks HEAD against the pin while `sources` and
`patchedSources` describe the combined state. Upstream PR
stepfun-ai/Step-Code#323 is deliberately skipped: it removes the
`enter_plan_mode` tool the Desktop plan-review bridge is built on, and the two
carried commits do not depend on it. See the [overlay notes](UPSTREAM_V016.md).

Patch rebase evidence: all 13 desktop patches were rebased onto the combined
state. 29 of 34 patched sources remain byte-identical to the previous v016
result; the 5 changed files are exactly the upstream-colliding sources
(lane-lifecycle, rpc-adapter, index, rpc-mode, step-subagent-events test). A
fresh pin checkout replayed by the updated applier is byte-identical to the
reviewed composition, and a tampered preimage rolls every applied patch back in
reverse, leaving the checkout as it was found.

Upstream suite control: the composed tree with desktop patches and the previous
v016 state ran the full upstream coding-agent suite on the same Windows machine.
The deterministic failures are identical to upstream main `90a57820` itself on
this machine (three json-mode-durability tests plus the oversized-output and
rpc live-channel tests); every other per-run difference flipped in isolated
reruns, so the composition adds no new deterministic failure.

Desktop local: typecheck passes. The serial Desktop suite is 807 collected:
793 pass, 14 platform skips, zero failures, including real-runtime background
lane, session worker and slash-handler tests against a locally staged overlay
runtime. The spawn-args assertions pin `--include-live-events`, and a slash
assertion requires `message_update` streaming frames with that flag set.
CI policy/runner/diagnostic tests pass with one platform skip (24 pass,
1 skip).

Staging: staged locally from the composed checkout with Node v24.16.0; the
runtime manifest records the pin plus both upstream commits. Staging now skips
rewriting an identical bundled node binary and prefers the distribution's own
LICENSE before the remote fetch, which keeps restaging idempotent under file
locking and works without access to the license host.

Non-claims: the Electron acceptance scripts did not run on this machine.
Behavior-monitoring software denies file writes by node-family processes under
the repository path and denies Electron processes writes generally, so the
local suite covers the staged runtime through the node test runner only. No
installer, packaged app, real-account or real-model run, native macOS
acceptance or cloud CI result is claimed by this entry; the Windows three-group
run on the PR head remains the required gate for the full acceptance inventory.

## v0.1.6 CI base synchronization (2026-10-31)

PR #170's original Windows interface, sessions and runtime groups passed.
Its macOS run `40284635861` failed `verify-workflow.mjs` at the intermediate
disclosure-height assertion. The latest main includes the shared fixture fix:
explicit motion preference and synchronous sampling of the real CSS effect
before hidden-window frame delivery can skip its intermediate states.
The v0.1.6 branch incorporates that fix without changing product animation,
runtime source identity or acceptance assertions. Replacement current-head
cloud results remain required; the October 26 evidence below is historical.

After synchronizing main, local Windows typecheck/build, real Electron
Workflow UI, command dispatch and the standalone worker probe pass. The serial
Desktop suite has 807 tests: 793 pass, 14 platform skips, zero failures
(`Desktop/test-results/upstream-v016-merge-main-20261031.log`). All 15 browser
motion-helper tests pass; the restored-playback endpoint now awaits the real
animation's `finished` receipt instead of assuming the action's 300ms delay
also completed rendering. Existing intermediate and final geometry assertions
are unchanged. CI policy/runner/diagnostic tests pass with one Mac-only skip.
The updated patch applier also passes a clean Windows source/hash replay.

Replacement head `0dd76ce` passed all Windows groups and the final gate
(`41183029529`). macOS `41183029175` passed the complete source inventory,
including Workflow motion, then failed the packaged Launch modes footer
alignment assertion. That check polled transient alignment before separately
measuring a trigger that can be reparented with a fresh entrance animation.
The fixture now awaits real footer animation completion before the final
atomic geometry read and includes both rectangles in failure diagnostics.
The same 1px center tolerance and non-overlap assertion remain unchanged.
Local real Goal/RPC acceptance passes both normal motion and a 1000ms entrance
control. A persistent 2px trigger offset still fails the original alignment
guard. Replacement package CI is still required.

The next Windows runtime job on `94735be` failed only in the capability
fixture teardown: `rm` reported `EBUSY` for its isolated Desktop directory
after management workers stopped. Cleanup now uses five bounded filesystem
retries at a 100ms base delay; it still rejects if removal cannot finish.
All 12 capability tests pass locally. A native Windows control holding a
temporary working directory reproduces immediate `EBUSY` and verifies that
the same bounded removal succeeds after the owning process exits.

## v0.1.6 development integration (2026-10-26)

The isolated `codex/upstream-v016` worktree stages source baseline
`81e79bc4b699148d6823fedde9b5e70d9a80255f` with `patches/v016`.
This is the announcement source baseline, not a verified official release tag
or a binary/source identity claim. See [integration boundaries](UPSTREAM_V016.md).

Final Windows local verification:

- Desktop typecheck and production build pass. The serial protocol suite has
  799 tests: 785 pass, 14 platform skips, zero failures. The final log is
  `Desktop/test-results/upstream-v016-protocol-handoff.log`.
- The patched upstream full check passes; 32 regression files have 668 passing
  tests and three skips. Coverage includes Plan/cache, CLM, compaction retry,
  permissions, Cron, Workflow, session import and background lane notifications.
- Real pinned RPC with an isolated local HTTP model fixture verifies that a
  delegated lane survives parent idleness and navigation, wakes its original
  session, and completes once without stealing navigation. Suspension clears
  live ownership without reporting false completion. Unit regressions cover
  the pre-`agent_start` parent handoff and cancellation via `agent_settled`.
- Final staging and the standalone copied-bundle worker probe pass: usage
  totals/cache/cancellation and a ready SQLite session index with search.
- Final Electron/native `then_run` acceptance passes approval/denial,
  cancellation, history reload, working-directory, timeout, output limit and
  descendant cleanup checks. Its temporary profile resolves directory
  junctions before comparing workspace identity.
- Earlier local Electron Workflow runtime, Plan review and CLM cancellation
  checks passed before the final parent-handoff change; they were not all
  rerun afterward. CI runner policy tests passed.
- Clean Windows patch replay and all pre/post source hashes pass. Darwin patch
  selection/replay and hashes also pass on Windows; this is not native macOS
  execution.

Remaining gates: replacement Windows/macOS cloud checks, native macOS runtime
acceptance, an installed package and real-account acceptance. No installer,
release or implementation push is represented by these local results. Build
artifacts and isolated test profiles are on D:, and the user's installed app
and shortcut are unchanged. TODO completion boxes remain open pending gates.

## Workflow catalog drawer (2026-10-26, development branch)

The bare `/workflows` command now opens a read-only Desktop drawer. The main
process reads bounded native workflow records and isolated Desktop definitions;
it does not execute scripts, mutate records, or send a model request. Parameters
retain the existing upstream dispatch. The runtime pin is unchanged.

Local Windows checks: TypeScript and production build passed; unit/protocol
tests reported 786 passed, 14 skipped, zero failures. CI inventory/policy tests
reported 19 passed. `verify-command-dispatch.mjs` checks the real listing IPC
against an isolated Desktop profile and rejects a wrong session identity before
switching to mocked IPC for UI routing and page-exit checks.

`verify-workflow-catalog.mjs` uses the production React component with fixture
data in local Edge: five-second expiry and reopen, hover/focus/disclosure
pauses, focus restoration, short/long drag, error recovery, stale response
isolation, reduced motion, and light/dark layouts at 1100/390/320px passed.
The test is assigned to the shared interface CI inventory. Browser fixture
success is not cloud CI, macOS execution, installer or real-account acceptance.
No package or release is claimed by this section.

## Single-slot workflow persistence fixture (2026-10-25)

`2bb6c27` Windows run `40118772782` passed all 83 acceptance checks and the
final gate. Mac `40118772757` passed its first 75 source checks, then failed
the Workflow runtime child-transcript assertion. The existing 10-second file
poll was working; extending it would not resolve the fixture's waiting cycle.

The frozen runtime's default workflow concurrency is CPU-bounded and can be
one slot. Its session manager first creates a JSONL file after a complete
assistant message. The fixture held CHILD-A's first response while requiring
a child transcript to exist; in a single slot CHILD-B cannot start and neither
child can create that first record. The fixture now completes A before holding
B. It still inspects a real persisted child while the workflow is active,
rejects opening/switching to child history and checks every original parallel,
chain, restart, crash, cache, partial-failure and HTTP429 contract.

A supported explicit maxConcurrency=1 control reproduces the old failure with
only A requested and no child files. The corrected source and actual `d6fa5da`
package both pass single-slot and default-slot controls (four passes). The
single-slot result confirms native limit=1/cap=1. No runtime, pin, environment
isolation, timeout or assertion is changed. Static review of the remaining
runtime fixtures found no second held-first-child/await-second-child cycle.
The fixture logs only allowlisted numeric native concurrency fields and fixture
request/file counts before the disk assertion, including on a failed scan.
Mac's complete serial order now starts with runtime, then interface and sessions,
so resource-dependent checks report earlier. All 84 scripts and deadlines remain
identical in both source and package modes; Windows order is unchanged. Existing
CI policy/runner checks pass (18 passed, one Windows-only skip).
The accepted application remains the clean `d6fa5da` build; replacement full
Mac cloud source and package results are still required before merging.

## Complete constrained-display reproduction (2026-10-25)

The ignored local launch wrapper caps native fixture windows to 684px without
changing product code or disabling animations. The full 84-item source
inventory completed successfully after correcting two display-dependent test
premises; both original failed attempts remain in its JSON/log.

Permission Approval's fixed upward gesture was 46px including the grip offset.
At the real 684px viewport its observed drawer range is only 240px →316px,
so that gesture correctly crosses the expansion midpoint. The small-drag
compact-snap test now chooses a displacement from the observed compact/expanded
range. Normal 900px windows retain the same 46px gesture (240→424); short
windows use 19px (240→316). The existing compact-state, large expansion,
keyboard resizing, bounds, defer and response assertions remain unchanged.

Workflow's fifth agent is below the short overview viewport. Playwright must
scroll it into view to click it; the old test compared the restored scroll
against a position captured before that necessary scroll. It now explicitly
reveals the same target, records that actual position and retains the exact
return-to-overview scroll assertion. No product behavior or control is changed.

Each corrected script passes normal source, the actual `d6fa5da` package and
the package capped to 684px (six targeted passes). The full capped source
report has 84 successes, complete=true, and preserves its two pre-fix failures.
Windows `9ae63c0` run `40116856737` also passed all three groups and the final
gate; final Mac cloud source/package results must still come from a head
containing these last two fixture corrections. The accepted application source
and runtime remain unchanged from `d6fa5da`.

## Hidden-window layout synchronization (2026-10-25)

Head `97cb4c1` passed Windows interface 40/40, sessions 18/18, runtime 25/25
and its final gate (`40115080022`). Mac `40115080007` failed earlier at the
composer-menu geometry check: gap `1.8370361328125` instead of the existing
6px ±1 contract, with both horizontal edges aligned. The fixture's 220ms
wall-clock sleep did not establish completion of the 160ms CSS entrance in
the unfocused native window.

`settleLayout` waits for fonts, rendered frames and real finite animations on
the measured element/subtree and its ancestors. Infinite activity indicators
are excluded; replaced animations handle only their AbortError cancellation.
No animation is disabled, no timeout is enlarged and no geometry assertion or
tolerance is changed. The composer, settings, question/permission drawers,
workflow, artifacts, browser and file-preview checks use it where their
contract requires a completed layout. Deliberate intermediate-frame, exit,
cancellation and elapsed-time guards remain. The basic Electron and Subagent
animation fixtures receive the existing Plan/browser Chromium flags to keep
their hidden renderer sampling active. The shared session fixture also requires
its composer element to exist before calling it enabled.

Composer source and the actual `d6fa5da` package pass. Extending the real CSS
entrance to 1000ms produces an initial 1px gap; the helper waits 1056.64ms and
the unchanged final measurement is exactly 6px with both edges aligned.
A final static 3px translation still fails the original geometry assertion
in 1.49 seconds. The five drawer/settings/workflow/artifact scripts and four
background-sampling/browser/file scripts each pass source and actual-package
checks (18 targeted runs), preserving all original assertions. A separate
ignored launch wrapper caps native windows at 684px for a full local inventory
reproduction; its result must be recorded separately from normal-size passes.

This follow-up changes fixture scripts and documentation only. The user-tested
application remains the clean `d6fa5da` build; its runtime pin and binary are
unchanged. Complete replacement Mac source/package cloud checks remain required.

## Plan anchor reference follow-up (2026-10-25)

The `d6fa5da` Windows workflow `40113230323` completed successfully across
interface, sessions, runtime and the final gate; Cron management and transcript
replay both passed. Mac run `40113230356` stopped earlier in Plan with a now
visible exact difference: running trigger x `144.640625 → 144.6875`, y `0 → 0`.
It did not wrap. The old x reference included the preceding working indicator,
whose live elapsed text can legitimately change width independently of expansion.
Running anchors now measure the exact gap from that adjacent indicator's right
edge, while y stays relative to the row top. The fixture also requires adjacency
and vertical overlap. Settled anchors still use the footer row. All comparisons
remain exact; no coordinate tolerance or clock freeze is introduced.

Normal source and the actual `d6fa5da` package pass the updated Plan check.
A controlled 1px increase in the preceding indicator moves the raw button x by
1px while the measured gap stays exactly `{x:8,y:0}` and passes. A 1px translation
of the button itself still fails with `{x:9,y:0}` and exits in 4.90 seconds.
This follow-up changes only acceptance code and documentation, not the renderer
or runtime. Full replacement cloud results are still required.

The independent local `d6fa5da` package completed the 84-item package-configured
inventory and the native zsh/PTY test. The inventory includes source component
fixtures, so it is not described as 84 direct binary checks. ZIP contents,
1,521 files and 14 links, and executable bits match the tested app; its update
metadata matches the 179,215,438-byte ZIP with SHA-256
`a522717b961ac181c6223c92585d616c2f4b36e0e1472d362785c2d7494f0984`.
The Desktop shortcut points at that independent test candidate. Existing Release
Draft assets still identify the earlier accepted `549bb39` RC.

## Cron focus and replay CI follow-up (2026-10-25)

Run `40110441887` passed the repaired project picker and Plan checks, then
failed Cron management focus geometry at a 684px viewport. A partially visible
textarea can receive native focus with its caret visible while its bottom and
outline remain outside the scroller. This was reproduced locally with the
unchanged renderer: its focused outline extended to about 708px in a 684px
viewport. Cron editor controls now scroll their complete box into view on focus;
the scroller and controls reserve 4px for the existing shared outline. No focus
indicator is removed or weakened. Acceptance covers normal and 684px heights,
dark/wide and light/narrow layouts, and both programmatic/keyboard and mouse
focus from a partially scrolled multiline field. The shared geometry helper can
observe an already focused field without refocusing it, retaining every outline,
clipping-ancestor and viewport assertion. Local Cron management's 14 cases pass,
including an additional 540px height reproduction. Typecheck/build and the full
unit/protocol suite pass (790 passed, one Windows-only skip).

Windows run `40110441868` passed interface and sessions but repeated the Cron
transcript timeout after reload. A controlled 12-second navigation IPC delay
reproduces it: the readable cold preview contains both Cron records while main
still has no selected runtime/session; reloading discards that pending navigation.
The fixture now waits for authoritative handoff and strictly checks connected
status, runtime ID and the expected session ID before reload. All original eight
Cron checks and the 60-second limit remain. Normal source, accepted `549bb39`
package and the controlled delay pass. This is a test precondition correction,
not a runtime or Cron message change.

The focus correction changes the renderer, so final Mac packaging and renewed
acceptance are required. Existing Draft assets remain the earlier accepted RC;
neither local fixture results nor the earlier partial cloud runs establish full
cloud success or final source/tag alignment.

## Replacement CI diagnostics follow-up (2026-10-25)

Commit `5ee398d` passed the original project-picker failure in hosted Mac CI
`40107639737`. Source acceptance then failed during the running Plan disclosure
anchor check. The fixture's held provider response and obsolete native-dialog
teardown hid the original assertion behind a 300-second runner timeout.
Plan now prints its original error and before/after coordinates, waits for
actual finite disclosure animations and resulting layout rather than a fixed
sleep, and uses the standard orderly fixture quit review. Its exact coordinate
assertions and all Plan approval/cancellation/reentry contracts remain intact.
A deliberate one-pixel anchor error still fails and reports the original
assertion, then exits in about five seconds instead of hanging. Six local
pre-change 684px repetitions did not reproduce the hosted position failure;
its precise coordinate difference is therefore not claimed as established.
Updated source and 684px packaged Plan acceptance both pass locally.

Windows run `40107639738` passed interface and sessions, but runtime timed out
waiting for the first Cron transcript element in the unchanged saved-history
fixture. Its cause remains unconfirmed. That fixture now preserves the original
error, a bounded state projection and a failure screenshot and uses the same
orderly close helper; its assertions and timeout are unchanged. All eight checks
pass locally against the accepted package. These are test-only follow-ups;
neither the approved RC nor application/runtime sources have been rebuilt.
Fresh complete cloud checks are required; neither failed run is recorded green.

## Mac project-picker CI follow-up and second review (2026-10-24)

Mac run `40101170389` passed upstream tests, build/staging, types and protocol
checks, then failed `verify-new-session.mjs:74`. Its actual renderer was only
684px high despite the fixture requesting 960px. Local reproduction against the
accepted `549bb39` app produced the same failure: six projects were present, but
the bounded picker list was 74px high rather than five rows. The menu stayed
above the composer and its remaining projects were scrollable.

Only acceptance code changes. Measured space determines when the five-complete-
row contract applies; a constrained window must still show a complete row,
scroll all six projects fully into view, select the last project without a
worker/history write, and retain the existing search, proposal, draft, keyboard,
first-send and relaunch assertions. Native bounds can be capped explicitly for
regression reproduction. Geometry and a failure screenshot are retained.

Full local new-session acceptance passed against source at native 1440x960
(190px list, five-row contract enforced) and against the unchanged accepted
package capped to 1440x684 (74px list, all projects reachable). No application
CSS, Electron code, runtime pin or candidate ZIP changed. Replacement Mac CI
must complete both source and package-configured inventories before a green
cloud result is claimed.

The Windows review was checked against current draft asset IDs/digests, the
merged checksum file and a fresh download of its build evidence. Windows RC
source is `9b69eada5666934bdd15f7afbe02a3b31cb91f49`; Mac RC source remains
`549bb39f118c992292afa43e9203b606ac983906`. The draft target is still `0fc0f1e`;
changing that target cannot reattribute either existing binary to final main.
See [Mac second review](releases/v0.6.0-macos-second-review.zh-CN.md) for hashes
and the remaining merge/tag/build-source gates. Draft/Pre-release is retained;
this follow-up neither merges nor publishes anything.

## Authorized PR #164 frontend follow-up (2026-10-24)

The owner explicitly authorized only shared frontend fix
`1038461e7d4ffbb65bf7a39858c5bda1a066ece2` after the PR #163 feature freeze.
Question status labels, icons, the Beta badge and pending-answer entry retain
their intrinsic single-line width; only the long question preview can shrink
and ellipsize. The exact CSS, component fixture, layout acceptance and inventory
entry are ported. The Windows handoff document with an obsolete Mac pin is not
imported. Later `9b69ead` TODO documentation and the Workflow top drawer are
outside this update.

Fresh typecheck/build passed, as did the complete serialized Desktop unit and
protocol suite (790 passed, one Windows-only skip) and all 18 CI policy/runner
checks (one Windows-only skip). The upstream layout acceptance passed all 12
theme/language/width combinations. An expanded actual-component source fixture
passed 16 combinations across seven question states, including 320px width,
full status/Beta text bounds, ellipsis, disclosure/actions and reduced motion.
The rebuilt package receives independent native layout and real-RPC question
acceptance; those results and archive provenance are retained with its BUILD-INFO.

The Mac runtime pin remains `b5dbed938d9ae589397cf522dcf2ff89ecf4c494`, with
the existing v0.1.5/Darwin patches and Node v24.15.0. The staged runtime is
retained and checked by complete file hashes; this frontend change requires a
new renderer build and clean candidate, not reuse of the prior ZIP. Prior
candidate checks below describe their original commits. Fresh targeted visual,
question-flow and package/resource evidence accompanies the rebuilt candidate.
The added layout check uses the source Vite/component fixture even when invoked
from the package-configured inventory; it is not a packaged-renderer test.

## macOS 0.6.0 local candidate acceptance (2026-10-24, user testing pending)

The owner authorized the feature freeze at Windows PR #163 merge
`324e71d1800de020c035cdce598374a6037ba4ca`, superseding the 0.5.1-only scope.
This is a local test-candidate preparation, not publication or real-account
acceptance. The release/draft handoff and manual checklist are recorded in
[0.6.0 Mac preparation](releases/v0.6.0-macos-preparation.zh-CN.md).

Mac now stages Step Code `b5dbed938d9ae589397cf522dcf2ff89ecf4c494`, the complete
v0.1.5 Desktop integration with strict shared/platform hashes, and a Darwin-only
process-tree patch. The original dirty `Step-Code/` checkout was preserved;
builds use a separate source directory. Node is v24.15.0 on ARM64 macOS 26.4.
Offline upstream build, clean patch reapplication and staged usage worker passed.
The complete 27-suite upstream run passed 619 tests with three Linux-only skips,
including real detached-child cancellation with an unrelated process retained.
A hosted three-CPU Mac exposed a unit fixture assuming two runnable slots. A
separate hash-pinned Darwin test patch fixes the test topology and cleanup, while
asserting the production three-core cap remains one. Forced-three-core full-suite
replay passes; shared Windows patches and source hashes are unchanged.

Desktop frozen-lockfile install, typecheck and production build passed. The
full serialized unit/protocol run after product fixes passed 790 tests with one
Windows-only skip, including the final clean `6f042ca` candidate run. The Darwin
CI-test manifest update also passed all four staging guards. CI policy/runner
checks passed 18 tests with one Windows-only cancellation skip.

Product audit enabled Mac Cron recovery/editing/scope and offline session import,
removed the obsolete Mac runtime export gaps, corrected platform workspace keys,
and retained all trust/account/idle/review guards. Actual Mac CLM/status and
capability management fixtures passed. StepPage now uses Desktop-owned bundle
and home paths: missing bundle and enabled-only declarations do not fall back to
personal PATH/HOME or implicit installer. A real runtime sentinel test verifies
that personal executable discovery never runs, followed by successful explicit
preparation against a disposable MCP fixture. Explicit custom configuration and
disabled state remain intact. No real service login or publishing was performed.

Mac acceptance now reuses the shared serial feature inventory (83 checks), excluding
only the Windows native command suite and adding native updater/turn-undo checks.
All 83 source checks passed after the initial sweep and targeted repairs; the
initial failures and rerun results are retained in test-results, with the exact
final inventory in macos-source-final.json. Initial failures exposed stale fixture
assumptions as well as a real wheel-routing gap over sibling conversation markers
and scroll handles; the latter has a product fix and bounded delta/zoom tests.
Native test sizing uses actual window bounds and retains all sub-100px scroll
assertions. Zsh paste requires explicit Enter, preserving bracketed-paste safety.
The official StepPage 1.0.0 bundle matched its pinned SHA-256 and passed a real
13-tool handshake, disable/reconnect, settings-button preparation, isolated HOME,
corrupt-file rejection/repair and Cron-host coexistence checks without login, tool
calls or publishing in the source application.

The first 8669326 packaged candidate exposed a real tray-label clipping defect
that source checks had missed. Tray sizing now measures intrinsic DOM layout
with actual typography/letter spacing, waits for fonts and includes root chrome
without measuring entrance transforms. Native source regression passed both
languages and increased spacing, including strict no-clipping/compactness checks.
The candidate was rebuilt from clean commit `6f042ca`; the rejected package and its
failed report are retained locally. A cloud appearance check also exposed a
fixture measuring its baseline during entrance animation; it now awaits actual
animation completion while retaining exact geometry comparisons.

The `6f042ca` application passed all 83 packaged checks in one serial run, with
no failures. Its 1,335 packaged application/runtime/native files matched staged
inputs, including executable permissions, ARM64 architecture and deployment
targets. The official StepPage bundle also passed packaged fixed-hash validation
and the real 13 -> 0 -> 13 tool registration/disable/restore handshake. The extra
packaged StepPage settings/download preparation check initially timed out before
UI setup. Native sampling traced this to a Security.framework Keychain prompt:
the fixture had replaced macOS's outer HOME with a synthetic directory. The
macOS fixture now retains the OS HOME, while Desktop userData, runtime and
StepPage homes remain isolated; Windows fixture behavior is unchanged. The
complete packaged preparation check then passed official download/UI entry,
13-tool handshake, Cron-host preservation/protected restart, light/narrow views,
disable/relaunch, corrupt-bundle rejection and repair without re-enabling it.
The initial failures, native sample and successful retest are retained.

Windows CI `40094837661` passed for `6f042ca`. Mac CI `40094837652` passed its
upstream tests, build/staging, types and protocol checks, then failed the source
scroll fixture because the clamped native display left a 254px scroll range.
Cloud package checks were consequently skipped. The fixture now tries bounded
shorter content while preserving the failed-command disclosure and every strict
scroll assertion. Two local packaged checks with maximum native height 684
passed, measuring 58px/58px/49px in dark/wide, light/wide and light/narrow views.
Replacement hosted CI remains required before release readiness is claimed.

The earlier `41f8b26` handoff changed only tests and evidence after `6f042ca`.
That packaging retained the staged application/runtime payload, recorded the clean packaging
commit and compares it against the fully tested candidate. Archive hashes,
payload comparison, ZIP round-trip and per-script evidence are stored with the
local candidate's `BUILD-INFO-macos-arm64.md` and verification attachments.

Unsigned/unnotarized installation, real account/model calls, production in-app
upgrade, external services and execution on the minimum supported macOS remain
separate user acceptance gates. Local fixture outcomes cannot satisfy them.

## Automatic Continuation Provenance (2026-10-24)

Windows automatic continuation now retains structured system provenance through
the normal input and `before_agent_start` hooks, model validation, live events and
saved JSONL. Provider input remains the original instruction. Desktop renders it
as a noninteractive timeline event in the original response, not a human message
or copied assistant prose. It records an attempted continuation, not successful
recovery. Its accent semibold label and the model-switch label are both upright.
Unmarked old history and manually authored identical text are not reclassified.

Clean Windows patch replay and all pre/post-image hashes passed. The upstream
build and 97 continuation/permission/prompt tests passed. Desktop typecheck,
production build, 772 tests (13 platform skips), and 15 CI policy/runner tests
passed. The real-component browser fixture passed 24 theme/language/preset/width
cases plus stop, failure, reload, hidden-message and reduced-motion checks.
Isolated-profile Electron acceptance passed persisted history, renderer reload,
same-text user identity and original-response grouping after the authoritative
navigation handoff. Existing model-switch Electron acceptance also passed,
including its computed nonitalic label style and light/dark/narrow layouts.
No installer, paid-provider call, macOS runtime or cloud-CI acceptance is claimed.

## CLM Readability And Inspector Widths (2026-10-24)

CLM contents use read-only Markdown, and saved diffs offer selectable before/after
excerpts with the raw diff collapsed underneath. Structural context headers stay
out of readable excerpts; missing prior contents, identities and revision numbers
are not reconstructed. Context (including Status and CLM) and Changes now share
standard, wide and fullscreen controls, including the existing drag handle.

Typecheck, production build and 15 focused CLM/context tests passed. The real
component fixture passed history, readable/raw diff, content selection, busy
guards, manual confirmation, light/dark themes and 1100/390/320-pixel layouts.
The local unsigned D: preview passed packaged Context and Changes acceptance,
including all three widths, scroll preservation and fullscreen restore, plus
command dispatch and general isolated-profile Electron/relaunch acceptance.
The subsequent serial Node 24.16.0 suite passed 748 tests with 13 platform skips
and no failures.

All 105 Desktop build files, 1,246 staged runtime files and 27 packaged terminal
files match their source hashes. The runtime remains pinned to
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494`; all 28 patched-source hashes match
the branch manifest. Six tests against that packaged runtime passed branch-only
read access, Plan/Goal preservation, invalid-edit fallback and cancellation with
explicit recovery. Profiles and model responses are isolated local fixtures.
This is not paid-provider, installer install/upgrade or cloud-CI acceptance.

The first replacement cloud runs failed in the shared browser fixture on both
Windows and macOS: it still asserted that Context had no width selector. This
was reproduced locally before changing the fixture. It now checks Context's
independent standard default, all three Context widths, hidden inactive native
pages and preservation of the browser's wide mode without stale fullscreen state.
Source and packaged browser acceptance, typecheck and all 15 CI policy/runner
tests pass locally. No application code, runtime pin or workflow gate changes
are included in this fixture repair; replacement cloud checks remain required.

## Sidebar Session Search (2026-10-24)

The former placeholder now filters existing non-archived session metadata in
the renderer. Title, first prompt, project aliases and paths are searchable;
full transcript contents are not scanned. Empty queries preserve the original
catalog. Matching collapsed groups open temporarily without preference writes,
and filtered views cannot rewrite manual ordering.

Typecheck, production build and 15 focused search/order tests passed, including
empty-title localization and a 10,000-session metadata catalog. Isolated-profile
source Electron search acceptance passed real catalog filtering, pinned ordering,
archived exclusion, independent sessions, IME Escape, empty results, restored
collapse state, unchanged draft/runtime identity and explicit result navigation.
Light/dark, narrow layouts and complete composite-field focus bounds are covered.
The existing source Electron session-navigation, sidebar-order/disclosure and full
capability-management regressions passed separately. The initially stale local runtime was restaged
from a separate pinned checkout with the current Desktop patches; all patched
source hashes and management adapters were checked against this branch before
rerunning acceptance. No installed user profile was used. No installer,
paid-model run or complete-suite acceptance is claimed.

## Shared Elapsed Duration Display (2026-10-24)

The running matrix indicator, completed-turn label and performance strip now share
whole-second duration formatting with minute/hour rollover and spaces between
unit groups. Chinese live labels use `4小时 0分 21秒`; compact labels use
`4h 0m 21s`. This changes presentation only, not timing sources or billing.
Typecheck, the production renderer build and 15 focused timing/performance tests
passed, including real isolated RPC timing. Browser acceptance covers the actual
components in light/dark, Chinese/English and 390-pixel layouts, minute/hour
boundaries and 24-hour runs, plus the existing motion and accessibility checks.
Isolated-profile Electron acceptance with the current source renderer passed
history/reload, light/dark/narrow, live ticking and completion freeze checks.
No installer, paid-model run or full-suite acceptance is claimed.

## Transcript Scroll Intent (2026-10-24)

Reproduced upward wheel input being undone by disclosure reflows or subsequent
message events. A single-turn transcript with only 62 pixels of scroll range
could never leave the former 100-pixel near-bottom following threshold.

Explicit upward gestures now pause following before layout correction.
Keyboard scrolling, the separate scroll handle and turn navigation share that
intent. Downward scrolling resumes only at the bottom; explicit return also
follows a moving tail during smooth scrolling. Ordinary disclosure collapse
back to a fitting transcript still permits automatic following unless the
reader explicitly paused it. The return control remains available for short
histories and while reading nested command output.

Typecheck, production renderer compilation, 23 focused scroll/navigation/cache
tests and 15 CI policy/runner tests passed. Isolated-profile source Electron
acceptance covers single/multiple turns, animated failed-command expansion,
small wheel gestures over the body/ruler/handle, keyboard/drag navigation,
sub-100-pixel ranges, content growing from no overflow, explicit/automatic
resumption, nested output and light/dark/narrow/reduced-motion views. The new
check is registered in the Windows interface CI group. Existing stream-motion,
session-navigation/reading handoff and context-panel acceptance also passed.
The local main/preload bundles and management/history adapters were refreshed
for navigation acceptance; this does not update the installed application.
No installer, paid-model or complete-suite acceptance is claimed.

## Capability Form And Sidebar Follow-Up (2026-10-24)

The Skill creation form reproduced horizontal clipping of its outer focus outline
at the capability scroll container. That container now reserves focus gutters and
scroll padding/margins without replacing the shared focus treatment. AGENTS.md
and DESIGN.md require complete four-sided focus indicators for future forms.
Source Electron acceptance checks Name, Description and Instructions against
clipping ancestors in light/dark and wide/narrow layouts, with focused screenshots.
It also verifies that the Schedules icon toggles back to the original draft without
creating a runtime, and that the sidebar's top fade applies only after scrolling,
clears at scroll origin and does not obscure keyboard-visible focus.
Typecheck, production build and the complete capability Electron acceptance passed.
This follow-up has not been repackaged; no installer or paid-model acceptance is
claimed.

Main `c6d0121` integration retains both capability mutation locking and
session-move guards, plus both plugin exports and the session-scoped Cron patch.
Clean Windows patch replay and all patched-source hashes passed; typecheck,
production build and 99 focused integration tests passed. The prepared local
CLI dependency link initially resolved a different checkout's compiled agent.
An isolated CLI dependency overlay now resolves this checkout's agent without
changing shared dependencies; runtime staging was repeated before acceptance.
Source Electron session-move acceptance passed, including unrelated Cron hosts,
relaunch, scoped restart and cold background-work guards. Capability management
and general Electron acceptance also passed against the restaged runtime.
This does not update the previous preview installer.

## Reading-First Session Navigation (2026-10-24)

### Editable Recovery Follow-Up

The follow-up supersedes the inert preview/composer behavior described below.
Cold reading now permits copying and historical disclosures, while the selected
session owns an immediately editable text draft. Enter, attachment imports and
runtime controls remain gated. Authoritative handoff preserves the editor
instance, focus and caret; overtaken and failed targets retain separate drafts.
Readiness fixtures now wait for the composer navigation gate, not just an
editable textbox.

Windows retains up to four recyclable idle workers while free system memory is
at least 3 GiB, otherwise two. Other platforms keep two. Five-minute expiry and
all active task, Goal, Cron, pending-operation and navigation reservations remain
unchanged. This does not prewarm unvisited agents and is not a hard cap on
protected workers. Periodic and post-navigation recycling re-evaluate the budget.

Runtime snapshots include numeric startup durations for process readiness,
session restoration, snapshot loading and model confirmation. They carry no
paths, prompts or credentials. Resident reuse retains the original startup
sample, rather than reporting it as a new startup.

The local offline benchmark in
`Desktop/test-results/session-navigation-performance-current.json` measured:

| Scenario | Readable | Editable | Execution Ready |
| --- | ---: | ---: | ---: |
| Cold 0 | 49ms | 9ms | 792ms |
| Cold 1 | 20ms | 8ms | 754ms |
| Cold 2 | 16ms | 7ms | 758ms |
| Resident | 12ms | 12ms | 28ms |
| Three rapid selections | 99ms | 89ms | 816ms |

Process readiness still accounts for 627-663ms in the cold samples. These
changes remove local interaction blocking and improve residency, not upstream
initialization itself. They do not establish real-account/MCP latency.

Typecheck, build, 77 targeted unit tests and real Electron navigation acceptance
passed, including paused startup, copy/disclosure actions, unsent Enter, caret
handoff, rapid target drafts, failure recovery, identity and billing guards.

The serial TypeScript unit suite passed with `terminal-sessions.test.ts` excluded
because of its previously observed Windows process-tree failure; terminal
acceptance is not claimed here. The 15 CI policy/runner tests also passed.
The complete local Windows `sessions` acceptance group passed all 18 scripts
(`Desktop/test-results/ci-sessions.json`), covering launch consent, cancellation,
concurrency, navigation, branching, ordering, queues, model selection, peer
sessions, imports, movement and large-history continuation. The large-history
fixture opened a 61,761,405-byte source in 2,134ms and continued in 976ms without
paid model requests.

The local Windows `runtime` group also passed all 24 scripts after the timing
fixture was made to delay initial readiness by 1.6 seconds and await navigation
handoff before reloading. This reproduced the cloud reload race before the wait
was added. After synchronizing main, build, typecheck, timing and sidebar-search
acceptance passed again. The search fixture likewise reproduced a premature
session-ID assertion before awaiting the navigation gate; its cleanup now uses
the shared orderly fixture shutdown instead of hanging on quit review.

The unsigned Windows preview was built at
`D:\Desktop For Step Code\Desktop\release\session-navigation-interactive-20261024-preview`.
Its runtime reuses the preceding accepted preview, with all 1,224 staged files
verified identical and runtime pin, patched-source hashes and Node executable
checked. No upstream source was restaged or modified. Fresh renderer/main builds
are included. Packaged navigation and general Electron acceptance passed using
isolated profiles and offline fixtures. Installer metadata matches `latest.yml`;
the 147,260,007-byte installer's SHA256 is
`486c87cb45ae7ad6bd9acf8e584b23ffd414ac90bb4f1e92c15f7d6a7bb4238e`.
The desktop shortcut points to this preview. The running older preview and
other workstreams' packages were preserved.

These checks do not establish personal-account behavior, installer upgrade
lifecycle, macOS acceptance or replacement cloud CI results.

An isolated Windows Electron profile with eight native sessions, three rounds
each and an offline localhost model fixture measured the following milliseconds
on the same machine. Baseline is main `3d38532`; reports are
`Desktop/test-results/session-navigation-performance-{baseline,optimized-final}.json`.
No paid model requests or personal profile data were used.

| Scenario | Baseline Readable | New Readable | Baseline Ready | New Ready |
| --- | ---: | ---: | ---: | ---: |
| Cold 0 | 713 | 43 | 713 | 751 |
| Cold 1 | 673 | 16 | 673 | 745 |
| Cold 2 | 681 | 14 | 681 | 761 |
| Resident | 11 | 11 | 26 | 26 |
| Three rapid selections | 1384 | 93 | 1384 | 842 |

The first RPC response took about 588-606ms after spawning; the subsequent
`switch_session` took about 32ms. Removing that switch alone would not address
the dominant startup cost. Direct `--session` startup was investigated but not
enabled: upstream restores the header cwd, whereas moved sessions require
Desktop's cwd override. No upstream sources, runtime pin or recovery/trust
semantics were changed.

Cold transcript reading now uses the already-running management process, bounded
to 12 MiB of input and a 24 MiB serialized response. It uses upstream in-memory
migration, active-branch and compaction projection, followed by the existing
Desktop imported-history, entry-ID, timing and workflow projections. It never
opens a SessionManager, repairs a newline or rewrites history. Larger,
changing, unavailable or future-format files fall back to ordinary startup.
Only a catalogued Desktop session ID crosses the typed preload boundary; no
renderer-provided path or executable runtime state is accepted.

Previews contain transcript data and a content version, not permissions, model
activation or pending actions. They remain inert and cannot enable sending.
Navigation sequence and session identity guard their delivery. Authoritative
runtime snapshots replace, never append to, previews and retain the existing
live revision checks. The first cold preview now saves its reading anchor even
without a prior composer draft.

Cold preparation has two slots and only one latest queued target. Connected
resident snapshots bypass those slots without starting another runtime; slow
resident reads neither consume cold slots nor override a later selection.
A 60ms cancellable
window coalesces cold selections before spawning, accounting for the small
single-selection ready-time increase above. Already-started overtaken workers
finish without activation or force termination. Idle recycling runs after each
preparation settles and periodically even while obsolete startups remain.
Queued and in-flight navigation targets are reserved, and reservations are
rechecked after awaiting another disposal. Existing running-task, Goal and
Cron protection and idle-retention limits remain. After the latest
runtime commits, session commands can proceed while obsolete preparation
finishes, but account and shared-settings mutations remain locked.

Comparative timing is a registered local-only check, not a hardware-dependent
cloud timing budget. The regular CI navigation acceptance checks cold read-only
delivery, newer-history handoff, drafts and anchors, superseded startup, late
preview rejection, optional-preview failure and disconnected recovery.
Initial typecheck and production build passed. The initial serial protocol suite passed
735 tests with 13 platform skips; all 11 Windows CI-policy tests passed. Real
Electron navigation, session-move, account-routing and the 14-case Cron management
acceptance passed. The first full protocol run failed and hung in the unchanged
terminal-count fixture's process-tree cleanup; its five isolated tests and a
subsequent complete serial run passed. No terminal product code was changed.
The isolated staged runtime is 175.9 MiB on D:, shared dependencies are reused,
and no preview installer was created or previous package deleted.
These synthetic results do not reproduce or quantify the user's several-second
delay with their actual model discovery, MCP services and personal history.
No installer, first-install acceptance, paid-model acceptance or cloud CI is
claimed by this source-only change.

### Navigation Review Follow-Up

Four added regressions failed against the pre-fix implementation. After the
resident bypass and independent recycling fix, all 82 focused history,
navigation and runtime tests and all 15 CI policy/runner tests passed.
The expanded real Electron navigation acceptance passed two held cold startups
followed by a resident switch, repeated navigation with an obsolete startup
still held, bounded connected workers, late-startup isolation and the account
mutation lock. The existing preview, authoritative handoff, draft, anchor,
failure-recovery and dark/narrow/reduced-motion checks also passed.
Session-move and account-routing Electron acceptance passed again, including
domestic/global API and Plan identity, login cancellation, running-task guards
and denied Plan requests never falling back to API. All 14 Cron management
Electron cases also passed against the updated main process.

A fresh fixture timing run is recorded in
`Desktop/test-results/session-navigation-performance-review-fixed.json`.
Cold history was readable in 14-43ms and executable in 775-829ms; the resident
case measured 11ms/27ms, and the three-selection latest target measured
94ms/794ms. As above, this is synthetic local timing, not actual-account/MCP
acceptance or evidence that single cold startup became faster.

The new complete serial run executed 752 tests: 738 passed, 13 platform skips,
and one failure in the unchanged terminal-count fixture's process-tree cleanup.
Its isolated rerun passed four tests and reproduced that same cleanup failure.
Only fixture-host children verified under those test runners were stopped so
the runners could finish; no user terminals or terminal product code changed.
This follow-up therefore does not claim a fully green unit suite or release
readiness.

## Plugin, MCP And Skills Management (2026-10-23)

Management follows the upstream Web/Desktop MVP user-scope APIs, isolated under
Desktop-owned storage. The renderer receives bounded, redacted data through typed
IPC. Configuration changes do not silently reload sessions or stop Cron hosts.

The final serial Node 24.16.0 suite passed 686 tests with 13 platform skips and no
failures. Typecheck, production build, CI policy tests and upstream barrel lint
passed. Clean Windows patch replay and the macOS index patch/hash check passed;
the latter is not native macOS acceptance.

After final runtime staging, real isolated-profile Electron acceptance passed
local marketplace/plugin operations, Skill lifecycle and runtime command reload,
MCP configuration versus live connection state, explicit restart, command routing,
theme and narrow-window rendering. Uninstalling a plugin used by a resident MCP
is blocked before deleting files; disabling and restarting permits removal.
Standalone usage-worker acceptance also passed against the final bundle.

Plugin details, StepPage preparation and session commands now share
DisclosureChevron and useAnimatedDisclosure rather than default markers or a
separate CSS disclosure. Electron acceptance verifies both 240ms cubic directions,
inert collapsed bodies, keyboard activation and reduced-motion settling.
Typecheck and production build passed again after this alignment.

The DFSC Beta icon extension reads only bounded plugin-local PNG files from the
optional `step.plugin.json` icon field. All 12 management tests passed, including
install preservation, invalid/link/oversized paths and built-in placeholder
selection. Real Electron acceptance passed discovery/installed PNG decoding,
corrupt-image fallback and the existing management/disclosure regressions.
Typecheck and production build passed; this is not an upstream schema extension.

The shared SidebarTaskActions now presents equal-width New chat and Plugins
buttons above right-aligned, adjacent Schedules and Search icons. The plugin entry
opens Discover without sending a model prompt. Search expands leftward from its
fixed right-hand trigger using cubic easing; it remains a labeled, read-only
placeholder, not a working session filter. Electron acceptance checks navigation,
equal primary widths, paired icons, containment, the six-pixel inter-row gap, fixed trigger/list geometry, focus return
on Escape, inert hidden controls and reduced-motion behavior. Typecheck and
production build passed; screenshots include the real sidebar and expanded search.

These checks use deterministic local resources, not paid model requests or real
third-party login/publishing. No installer, first-install acceptance or cloud CI
result is established by this run. See `docs/CAPABILITIES.md` for scope.

Mainline integration retains session migration, quote annotations and shared
command presentation. Fresh Windows patch replay and runtime staging passed with
the combined import/plugin exports and source hashes. Migration, command dispatch
and composer-menu Electron regressions also passed against the combined source.
## API Balance Fixture Shutdown (2026-10-24)

After integrating main `985f372`, cloud run `39985959681` passes Windows
sessions/runtime but times out in `verify-account-balance.mjs`. Local repetition
with Node 24.16.0 reproduces a successful balance scenario followed by an
unanswered native quit review: `transitioning` is true while task, Goal and
Cron counts are zero. The direct Playwright close waits for that review.

The balance fixture now uses the existing orderly-shutdown helper, answers
updated review requests, logs each phase and applies a 30-second shutdown
deadline. It retains every balance assertion and checks successful launcher
exit and closed windows; it does not force application exit. A regression
checks existing and changed review requests. Five consecutive packaged balance
runs (both regions), the six shutdown regressions and real quit/Cron acceptance
pass locally. These are fixture-only changes; the replacement head still
requires cloud verification.

## Single-Conversation Project Movement (2026-10-23)

Saved top-level conversations can move from independent history into a registered
project, or between registered projects. A sidebar long-press drop opens a
destination-preselected confirmation; the session context menu opens the same
dialog with a project picker. Updated sorting still permits cross-project drops
without enabling manual same-group ordering. Cancel does not change association
or history. Project removal, whole-project relocation and same-group reordering
remain separate actions.

Movement preserves the session ID and native history file, storing the future
cwd in Desktop's existing per-session redirect metadata. The host prepares a
new cwd-bound transport and verifies its identity and `ask` permission tier
before saving the association. A failed preparation retains the original
association and source worker. Active movement retains the viewed conversation;
background movement preserves the viewed chat or draft. Existing project files,
changes and terminals are not transferred, and historical path references are
not rewritten. Full Access and project trust are not carried from the source.
Reopening or explicitly restarting redirected history starts gated.

Running, compacting, approval-waiting, queued-message, active-Goal and
structured running/queued background-agent workers cannot move. Live Cron hosts
are retained; only saved jobs actually associated with the moved session block
movement. Unrelated or unbound jobs in either project remain there and do not
block a cold conversation. Unreadable schedule/association state fails closed
with distinct host, associated-job and verification messages. This first version
does not offer an independent destination or filesystem movement.

Moved Windows transports use an optional session-scoped view of the original
shared Cron store, including after restart or provider refresh. Foreign/unbound
jobs are not adopted, dispatched, advanced or deleted by that transport. It can
still create and execute its own jobs; shared mutations preserve other records
and enforce the project-wide limit. This requires the additional reviewed
`desktop-session-cron-scope` runtime patch; the upstream commit is unchanged.
The frozen macOS runtime does not gain this patch.

The prepared runtime's loaded messages are also checked before saving the
redirect, so cold histories cannot bypass the background-agent guard. Regression
cases for both `running` and `queued` records reproduced the missing rejection
before the fix and pass afterward, preserving redirects, the viewed draft and
resident runtime count on rejection.

Source Electron acceptance uses an isolated Desktop profile and localhost
provider, never personal CLI credentials or a paid model. It covers cancellation,
dragging with updated sorting, menu confirmation, light/dark/narrow layouts,
Full Access reset, identical session/history identity, a real relative-path tool
write in the new cwd, busy/approval/queued-message/missing-directory rejection,
background movement, app relaunch, explicit runtime restart, unrelated live
destination hosts, unrelated cold-source tasks, new scoped-task creation/deletion
and related Cron guards. The unrelated original host remains registered and its
saved task bytes stay unchanged. Existing sidebar-order acceptance also
passes. The browser fixture uses the real dialog and drag hook but mocked
association updates; it is not runtime or installer evidence. No new installer,
cloud CI result or official-provider continuation is claimed here.

Typecheck and production build pass. The serial unit/protocol run passed 660
tests with 13 platform/dependency skips; the 15 CI policy/inventory tests also
passed. An initial concurrent full-suite run hit the existing terminal-count
fixture's process-tree cleanup timeout; that fixture passed independently and
in the subsequent serial full run. Terminal cleanup code was not changed.

The Cron-scope follow-up reproduced the former destination-wide rejection before
the fix. Its 49 upstream Cron tests, 98 focused Desktop tests and 15 CI policy
tests pass. The final serial Desktop suite passes 663 tests with 13 skips and no
failures. All patch pre/post-images match a replay from the pristine pinned Git
index. Source Electron movement, Cron management (8 cases) and real Cron RPC
(12 cases) acceptance pass with a separately rebuilt/staged Node 24.16.0 runtime.
This follow-up has not replaced the icon-corrected local installer.

The subsequent unsigned D: Windows preview includes the Cron-scope follow-up.
Packaged Electron movement, general app and Cron management acceptance pass,
alongside all 12 real Cron RPC cases pointed at the packaged runtime. Packaged
account routing passes CN/Global API and Plan switching, login cancellation,
busy-session protection and no fallback from denied Plan to API. The same source
routing acceptance also passed eight consecutive isolated runs. The executable
retains the matrix icon; all 105 built Desktop files and 1257 staged runtime files
match their packaged hashes. The desktop shortcut is backed up and updated;
the running old preview is left untouched. These are local fixture results,
not user, paid-provider, first-install or Release acceptance.

Cloud run `39951495926` passes the interface, sessions and macOS jobs. Its runtime
job completed every `then_run` functional assertion before hanging during teardown
and hitting the five-minute outer limit; the old log does not identify the
specific cleanup await. The fixture replaces forced `app.exit()` with the
existing orderly-shutdown helper and logs shutdown boundaries. Assertions and
deadlines remain unchanged. Three consecutive packaged `then_run` runs pass and
complete orderly shutdown, and all 15 CI runner/policy tests pass. The replacement
head still requires cloud verification.

Run `39953993378` again passes interface, sessions and macOS, but exposes the
same runtime teardown hang. Using CI's Node 24.16.0 locally reproduces a successful
launcher `exit` without ChildProcess `close`: Playwright waits for every inherited
pipe, including its additional stdio handles, before completing application
closure. The exact process retaining those handles is not identified.

The `then_run` fixture still requests orderly application shutdown. A narrowly
installed guard releases its controller-owned pipes only after successful
launcher exit and every application page has closed. It cannot turn a live or
failed process into success. The fixture also observes both application and
browser-context closure instead of depending solely on the controller's final
close-RPC reply; it explicitly checks successful exit, a closed context and no
remaining windows. Five regression tests cover both event orders,
nonzero exit, multiple windows and listener disposal. Native shell probes now run
asynchronously after Electron has closed, rather than blocking the browser
controller. Functional assertions and the outer five-minute deadline remain
unchanged; a separate 30-second shutdown deadline localizes future failures.
The complete serial unit/protocol suite passes 668 tests with 13 skips and no
failures, and typecheck passes. With CI's Node version and `CI=true`, five
consecutive source runs and five packaged runs complete every RPC/UI assertion,
orderly shutdown and native command probe. All 15 CI policy/runner tests pass.
These test-only changes do not alter the preview's bundled Desktop/runtime files;
the replacement head still requires cloud verification.

## Command Presentation And Dispatch (2026-10-23)

The command menu, composer and sent user messages now share semantic icons.
Inline commands after prose and newlines are marked without rewriting the
prompt; code, paths, links and unknown tokens stay ordinary text. Markdown
formatting and skill/template source icons are preserved.

Standalone Usage commands open the existing overview or Account settings, bare
Cron opens its existing manager, and Compact uses the dedicated RPC rather than
an ordinary prompt. Compact failure retains the draft; busy sessions do not
queue it as prose. Parameterized Cron commands retain upstream handling.
Prose mentions, attachments and quotes are not consumed as Desktop actions.

Focused parser/catalog/Markdown/trust/status tests, typecheck and production
build passed. Source Electron discovery and editing acceptance passed across
light, dark and narrow layouts. Dedicated dispatch acceptance covers Usage,
Cron, Compact success/failure and the running-session guard. It also protects
against reusing the decoration array consumed by ProseMirror during loading-only
renders.

The real pinned bundle passed read-only task, workflow, CLM, Cron, Goal and
Ultracode checks, Plan toggling, cancelled plugin/feedback dialogs and loopback
Init dispatch. No real model, account balance query, feedback upload or plugin
installation was used in those runtime checks. See [COMMANDS.md](COMMANDS.md)
for the full inventory and deferred mappings. No new installer or packaged
acceptance is claimed by this source verification.

## Migration CI Paths And Unavailable Projects (2026-10-23)

Windows sessions run `39900979276` reached the new grouping assertion with a
`RUNNER~1` temporary-path alias. The client correctly stores native real paths;
the fixture now canonicalizes its isolated profile before constructing and
comparing workspace paths, rather than weakening the grouping assertions.

A separate regression reproduced a saved copy whose original project directory
was deleted before duplicate-import grouping repair. The previous build returned
ENOENT from import-history queries and failed to finish orderly fixture shutdown.
Registration now skips unavailable saved directories without creating replacements
or rewriting the copy. The extended source Electron migration acceptance passes,
including subsequent journal reads and orderly shutdown. Cloud checks remain
required for the replacement head.

## Import Confirmation And Project Grouping (2026-10-23)

Import now confirms directory counts and an optional, default-on sidebar project
registration before starting. Cancel preserves selection and creates no copies
or projects. The host only registers saved imported/skipped results and reads
their bounded native headers, not foreign source text or entire transcripts.
Duplicate copies keep their saved cwd even if a later selection changes it.

Typecheck, production build and 17 focused import/history tests passed.
Source Electron acceptance passed confirmation cancellation, default grouping,
unchecked independent placement, existing project matches, relaunch persistence,
bulk import and explicit duplicate-copy grouping repair. The local fake-provider
continuation and large-text browser responsiveness checks also passed.
The browser fixture is available on port 5194; the prior port 5193 serves a
different checkout. This follow-up was source-only when first verified. CI repair
has since resumed, integrating main's model-refresh race fix without changing the
macOS runtime pin. Replacement cloud checks must validate the combined tree.

## Imported Large-History Responsiveness (2026-10-23)

A real imported conversation exposed two unbounded paths missed by the small
migration fixtures: the RPC decoder repeatedly rescanned the accumulated history,
and multi-megabyte historical text was eagerly parsed as Markdown. A synthetic
56 MiB frame reproduced a roughly 51-second main-thread stall. Fragment-based
decoding reduces that local test to roughly 0.23 seconds while retaining
per-record limits and split UTF-8 handling.

Oversized prose and tool inputs/results now use a bounded, plain-text section
viewer with full-content copying. Closed thinking bodies mount on first opening,
and transcript images use lazy decoding/loading. Imported active-path messages
already carry entry IDs, avoiding redundant full-content identity serialization.
No saved messages, images or model context were removed or rewritten.

`verify-import-performance.mjs` covers a three-million-character historical
payload, deferred thinking and section navigation. `verify-import-large-electron.mjs`
imports a synthetic 62 MB source, opens its actual native copy, expands and pages
the historical tool result, then continues via an isolated local provider. The
source Electron run opened in about 2.8 seconds and completed local continuation
in about 1.9 seconds. These are local observations, not production latency
guarantees. Official-provider prefill with image-heavy history remains separate;
no paid model or private conversation was used in these acceptance requests.
The unsigned D: preview also passed packaged migration and general Electron
acceptance; its synthetic large-history open/continuation measured about
2.6/2.1 seconds. Distribution and staged runtime hashes match the package.

## Summary Turn Alignment And CI Replay (2026-10-22)

The Summary activity dot now follows live conversation execution immediately;
it does not wait for the summary poll or rewrite canonical task progress.
Visible native Cron notices, including missed notices, start a Summary turn
just as they do in the transcript. Historical agents remain inspectable there;
registered queued/running background agents carry forward until settlement.
Late results retain their original dispatch ownership.

Fourteen Summary state tests and the browser regression cover these cases,
including repeated Cron, hidden/non-Cron notices, saved replay, Workflow records
and history expansion without repopulating Summary. The related 49-test run,
typecheck and production build passed.

CI replay now opens lazily mounted tool details before reading their status,
expands historical agent disclosures before inspecting their rows, waits for
the connected page before evaluating the bridge, and arms terminal width-frame
sampling before triggering transitions. The existing assertions are retained.
Local source Electron, hidden-message, clarification and real PowerShell terminal
acceptance passed. The local shared node-pty input was incomplete; generated
terminal resources were repaired from the version 1.1.0 npm archive after
verifying its SHA-512 against the lockfile, without changing shared dependencies.
Cloud and packaged acceptance are tracked separately from these source results.
Background-agent acceptance now addresses each original dispatch independently
of row order and opens settled history before inspecting it. Source and packaged
runs passed completion, failure, restart, interruption, follow-up and reload
checks with identical task descriptions.

## Transcript And Summary Follow-Up (2026-10-21)

The compact transcript now exposes singleton thinking/tool records through their
own disclosure, without another group header or indentation. Stable keyed members
retain manual expansion and output controls when siblings arrive; keyboard focus
moves to the remaining member when its group header disappears. Existing
approval/failure and dedicated-interaction boundaries are unchanged.

Thinking and ordinary tools share the native-details animation hook: 240ms cubic
height/opacity transitions in both directions, inert closed content and lazy
tool-output mounting. Disclosure arrows follow labels/timing before previews.
Thinking completion still folds the active thought, while settled history can
be reopened. Presets, custom defaults and historical reapplication are retained.

Summary adds activity and compact header counts, canonical task progress, and
structured Subagent/Workflow records opening existing read-only inspectors.
Parent streaming and successful dispatches do not imply running/completed tasks.
Unknown legacy records and failed refreshes remain unknown. Repository overview,
theme tokens, panel geometry and existing task completion animations remain.
The activity indicator settles to green only for nonempty, fully successful
task/agent records. Empty, pending, failed, stopped, skipped, unknown and stale
states are covered separately; checklist counts and the official MCP mark retain
the compact header and theme colors.
The agent list now keeps only the latest visible user/Goal turn and registered
live background work carried across turns. Earlier transcript agent calls fold
into one disclosure per response, retain inspector navigation and never
repopulate Summary when expanded. Ten focused state tests cover turn changes,
hidden reminders, late results, background completion and Workflow ownership.
The browser regression also checks history folding, lazy mounting and navigation.

Typecheck and production build passed. The final serialized suite passed 564
tests with 13 platform skips; all 15 CI-policy/runner tests passed.
Electron interface-preference, Summary runtime and Summary layout acceptance
passed, including real pinned task RPC, completion animations, session isolation,
repository navigation and nonmodal layout. The reused Windows runtime's
patched-source hashes match the current manifest; no runtime source was changed.

The new `verify-disclosure-summary.mjs` is registered in interface CI. Local
Playwright validation used installed Edge through its explicit channel override;
CI defaults to its installed Chromium. It passed singleton identity/focus,
member-local controls, keyboard and rapid toggles, intermediate closing frames,
canonical progress, agent-record navigation, zh/en, light/dark, 320/390px and
reduced-motion checks. Screenshots under `Desktop/test-results/` were inspected.
The first Summary/full-suite replay used an older staged runtime and failed the
existing Status-field assertion; replaying against the manifest-matching staged
runtime passed without modifying that assertion. No new installer, real-model
acceptance or cloud result is claimed; the running user package is unchanged.

## Model Selection Persistence (2026-10-22)

Explicit picker choices now persist only provider, model ID and display name in
Desktop's own preferences. New drafts and reused empty runtimes honor that choice;
passively reopening a conversation does not rewrite it. Existing conversations
restore the active branch's last model-change entry, with assistant metadata only
as a legacy fallback. Runtime configuration refresh no longer selects models[0]
when the previous model is absent. Missing selections remain named on new drafts
and creation/restoration fails explicitly rather than sending on another model.
Confirmed Cron recovery retains its separately reviewed model contract.

The management process also retains its last successful official discovery
catalog in memory, scoped by credential, endpoint and model configuration.
Unavailable discovery must not hide Step merely because custom models remain.
No built-in model list is fabricated; the cache does not survive process restart.
Failed or cancelled sign-in leaves the unchanged account's discovered catalog
intact; invalidation follows successful credential replacement. The discovery
fixture returns an explicit 503 during outages instead of abruptly destroying
pooled sockets across its recovery boundary.

Typecheck, build and 119 focused tests passed. Real Electron model-switch
acceptance covers orderly application restart, on-disk default identity,
independent old-session selection, cloning/branching, missing-model rejection
without a generation request, and explicit alternative selection. These are
isolated local fixtures, not live official-account or packaged acceptance.
The elapsed-time Electron fixture now configures its recorded model explicitly,
so missing-model protection is retained rather than bypassed. Its history,
reload, dark/light/narrow, ticking and freezing checks passed locally.
The review-fix replay passed typecheck, build, model-switch and account-routing
Electron checks. The full local protocol run reported 628 passes, 13 platform
skips and one existing terminal-host cleanup timeout (nine concurrent hosts,
three-second tree termination). Its unchanged terminal code is outside this
model fix; this run is not claimed as an all-green suite.
Follow-up provider-save coverage exposed a separate missing-model boundary:
disabling/removing the active provider must save successfully without selecting
an alternative. Explicit provider application now suspends only the affected
model-unavailable worker and retries that same identity on later configuration
application; unrelated transport/application errors still fail closed.
The focused suite now passes 120 tests, including disable/re-enable identity
recovery and rejection of unrelated refresh failures.
Real Electron custom-provider acceptance passed all three wire protocols,
keyed/keyless operation, deferred application, disable/re-enable with unchanged
session/model identity and no generation, removal and restart. The remaining
runtime checks after elapsed-time acceptance also passed locally, including
commands, then_run, workflow, Summary, Usage, background agents and StepPage.

## Cron Transcript Source Disclosure (2026-10-20)

Follow-up: source disclosure alone did not split response entries. The first
preview below still merged preceding assistant content with Cron output, losing
its independent footer. That package is not evidence of correct turn boundaries.
The fixture now puts both replies in the same production message list, rather
than mocking the preceding reply outside the renderer. Regression checks cover
separate settled footers, the previous footer during active Cron, repeated Cron,
reload, and Plan/Goal/workflow ownership. No scheduler behavior is changed.
The corrected source passed typecheck, production build, 113 related unit tests
(three additional platform-specific skips), 24 browser combinations and native
Electron saved-history replay. Both prior and Cron footers survive reload;
the prior footer also survives active Cron. Separate 8s/4s timings, file changes
and delivered output paths are covered. Light/dark separate-footer screenshots
are under `output/playwright/cron-turn-boundary-20261020` on D:.
The corrected Windows x64 preview is
`Desktop/release/cron-turn-boundary-20261020-preview` on D:. Its packaged
saved-history replay passed eight checks, Cron management passed eight cases,
project trust passed three cases and general Electron acceptance passed.
All 105 dist and 1,232 runtime files match the inputs byte for byte.
Installer/update metadata matches; installer SHA-256 is
`6c8f94a0904690477bc1bac4b4e5786f396e2f186de2b4082afaf556753d9a0f`.
The unsigned local preview remains version 0.5.1, not a public release.
The desktop shortcut was backed up, updated and read back. The running earlier
preview was not stopped; it still predates the boundary fix.

Visible `role=custom`, `customType=step-cron` records now render as a dedicated
source disclosure in the shared conversation renderer, including saved reading
and nested transcripts. Ordinary user/assistant text containing `[cron]` is not
reclassified. Normal deliveries and upstream `details.kind=missed` notices have
distinct labels; the latter preserve their original batched notice. Hidden
records stay hidden. All interface presets keep the source outside process/tool
groups. Copy projection and original message storage remain unchanged.

Details expose only supplied instruction, message timestamp, cron expression and
task ID. Ordinary upstream deliveries do not supply a planned fire time, so the
UI does not infer one. No scheduler, account route or task recovery changes.

Typecheck and production build passed. Five new projection tests and the related
conversation, grouping, event, navigation, interface, workflow, Plan and subagent
tests passed (81 total). `node scripts/verify-cron-transcript.mjs` passed 24
theme/preset/language/viewport combinations, pointer and keyboard disclosure,
snapshot-state retention, missed notices, reduced motion, forged-prefix/hidden
record checks and active/reloaded rendering without page errors. Screenshots
were inspected after replacing the static mock with the production renderer.

The follow-up local Windows x64 preview is
`Desktop/release/cron-transcript-20261020-preview` on D:. It includes current
main `61908a9` plus the local transcript changes. Packaged Electron acceptance
passed six native saved-Cron-message replay checks, eight Cron management cases,
three project-trust cases and the general Electron suite. All 105 dist and 1,232
runtime files match the build inputs byte for byte. Installer/update metadata
and SHA-256 were checked; the installer is unsigned and remains version 0.5.1,
not a public release. The desktop shortcut was backed up and updated with readback.

This is not paid-model or installer-upgrade acceptance. Existing user tasks,
accounts and the running old application were not modified or stopped. Cleanup
of five inactive preview directories was requested but blocked by local policy;
those directories remain. The active old package and v0.5.1 release archive
were preserved.

## StepPage Review Guards (2026-10-22)

The new StepPage setup controls and main/admin preparation path now run only on
Windows. Other platforms keep their pre-change legacy registration behavior.
Non-Windows native registration acceptance checks hidden controls and rejected
setup requests in addition to its original cases; it was not run on this
Windows host.

Startup disables matching Desktop-managed MCP declarations when an installed
file fails verification, without executing it, using it as a valid candidate,
or modifying unrelated custom transports. Repair does not silently re-enable
the service. Typecheck/build, 582 serialized tests (thirteen platform skips),
fifteen local CI policy/runner tests and eleven Windows Electron registration
launches passed. Extended real Electron preparation acceptance verified
corruption, protected relaunch, zero tools/no execution marker, and successful
repair with disable preserved. These checks used isolated profiles, not real
credentials or publishing. No review-follow-up package was generated.

## StepPage Preparation With Scheduled Cron (2026-10-21)

Preparation now uses a non-stopping idle check: a waiting Cron host is allowed,
but active tasks, queued messages, active Goals and mutations are still rejected.
Actual restarts and account changes keep their existing Cron protection.
StepPage restart rejection reaches localized feedback and survives readiness
polling instead of being swallowed or erased.

Typecheck/build, 580 serialized tests (thirteen platform skips) and fifteen local
CI policy/runner tests passed. Source and packaged Electron acceptance created
a scheduled job before explicit installation, verified that its host and job
were unchanged, checked persistent protected-restart feedback, and connected a
new independent session to thirteen StepPage tools. Disabled preparation,
restart/relaunch and general packaged Electron acceptance also passed.

The unsigned local preview is `steppage-cron-20261021-preview` in the shared D:
release directory (version 0.5.1, main `61908a9` plus local StepPage changes).
Installer SHA-256:
`1f5b5a24b71d94dffd0a94f528583b80bcb4a2ef7e21a07865aea14a78f67a3a`.
The audit matched 105 built files and 1,242 runtime files; update metadata matches
installer size/SHA-512. The desktop shortcut was updated with its previous value
backed up. No running user instance was stopped or personal profile altered.
Real login, publishing, installer execution and cloud CI are not established.
The same packaged executable passed eight registration groups (eleven launches)
and eight Cron management acceptance cases.

## StepPage Windows Explicit Preparation (2026-10-21)

Settings > Resources now offers StepPage installation/preparation and retry;
MCP settings link to that entry. The main process downloads only on explicit
action, verifies the pinned official artifact, checks syntax/version using
packaged Node, and installs atomically into Desktop-owned storage with a separate
StepPage HOME. No personal credentials are read/copied. Custom transports and
explicit disable are preserved. Failure categories are safe projections, and
preparation never automatically restarts a session or enables a disabled server.

Typecheck/build passed; the serialized suite passed 577 cases with thirteen
platform skips. The real Electron
preparation acceptance used a disposable fresh profile and the Settings button
to download from the official CDN. Exactly one service connected with thirteen
tools; disabling then preparing/restarting yielded zero tools, and application
relaunch retained disable and installed state. No model prompt, MCP tool call,
real login or webpage publishing was performed. This does not establish
installer execution, upgrade lifecycle or cloud CI results. Details and the
fail-closed mutable-CDN pin policy are in [StepPage](STEPPAGE.md).

The follow-up was packaged as unsigned Windows x64 preview
`steppage-prepare-20261021-preview` under the shared D: release directory, still
version 0.5.1 and based on main `61908a9` plus uncommitted StepPage changes.
Packaged explicit-download/13-tool/disable/relaunch acceptance, eight
registration groups (eleven launches) and general Electron acceptance passed.
The audit matched 105 built files and 1,242 runtime files, and verified installer
size/SHA-512 against update metadata. Installer SHA-256:
`b16a3a5c0bf9c8204e248c4d1d2626a321548fa1ba49e3a1af20daa6782bc95b`.
The primary desktop shortcut was updated with its prior version backed up.
No running user instance was stopped; real login and publishing remain untested.

## StepPage Identity And MCP Disable Compatibility (2026-10-20)

Desktop now reconciles the legacy `steppage` declaration to the upstream
`steppage__steppage` identity inside the existing admin settings lock. Complete
declarations survive migration. Managed-path repair preserves explicit disable,
and ownership checks require the known one-bundle launch shape rather than just
a matching runtime Node suffix. No upstream source or personal profile changed.

Typecheck/build passed, with 570 serialized unit/protocol tests passing and
thirteen platform skips. Eight Electron registration groups passed across eleven
launches; fifteen CI-policy/runner checks passed. Deterministic real-runtime
coverage includes plugin suppression, relocation, restart, missing/invalid bundle
failure and later recovery. The optional official-bundle check connected exactly
one server with thirteen tools, then disabled/restarted with zero and
re-enabled/restarted with thirteen.

Windows automatic first installation, real authentication, online publishing,
cloud CI and installer acceptance are not established by these checks. See
[StepPage compatibility](STEPPAGE.md) for the tested artifact, reproduction and
remaining issue #112 boundaries.

The Windows x64 local preview `steppage-mcp-20261020-preview` was then built
from main `61908a9` plus this uncommitted StepPage snapshot in a separate D:
worktree, excluding the parallel fader changes. Typecheck/build and the serialized
suite passed again (570 passed, thirteen skipped). All eight registration groups,
the general Electron acceptance and the official-bundle 13/0/13 check passed
against the packaged runtime. The audit matched 105 Desktop files and 1,242 runtime
files, including the new adapter, and verified the installer/update metadata.
The unsigned installer remains version 0.5.1, with SHA-256
`dd89f499fe4ec670ee616c286d1442abe7528f70fb85581cc3fbefe53b442440`.
The package lives under `D:\Desktop For Step Code\Desktop\release\steppage-mcp-20261020-preview`.
The primary desktop shortcut targets its unpacked executable; the previous
shortcut is backed up with the package. The running user application was not
stopped. This does not establish NSIS upgrade or real login/publishing acceptance.

## Cron Resume Rejection Follow-Up (2026-10-19)

An explicit negative RPC response now has a distinct error type. If the recovery
resume command is rejected before opening its gate, Desktop removes the gated
host so it cannot falsely occupy the project and prevent another reviewed
recovery. Successful resume keeps the host. Timeout and transport failures remain
uncertain: Desktop keeps the potentially activated host and never retries.

Focused recovery/transport tests passed 23 cases with three platform skips,
including a real JSONL child distinguishing negative replies from timeout and
disconnect. The full serialized suite passed 558 tests with thirteen platform
skips. Typecheck, production build and all eight Electron Cron management
acceptance groups passed. This correction has not been packaged.

## Cron Creation Persistence Follow-Up (2026-10-19)

Creation now defaults to durable storage and preserves that choice when selecting
a host. Recurrence remains independent. An untrusted host blocks durable submit
and explains explicit `/trust` approval and a manual restart; it never selects
temporary storage as a fallback. Temporary creation and details disclose loss on
host exit or application update.

The appended Desktop system policy asks models to prefer explicit durable jobs
for ongoing/cross-restart requests, stop on trust failure rather than downgrade,
and treat existence checks as read-only rather than permission to recreate.
This is model guidance, not deterministic enforcement of natural-language intent.
No upstream scheduler, schema, trust defaults or temporary-job recovery changed.

Typecheck, production build and 86 focused session/Cron/trust tests passed.
The complete serialized suite passed 555 tests with 13 platform skips.
Real Electron management acceptance passed eight groups, retaining the native
create/delete, exit/relaunch, offline discovery and explicit recovery sequence.
The new group checks untrusted submission blocking, storage choice preservation,
no task creation/fallback and no model calls; creation also checks single versus
recurring independence. Light/dark and narrow screenshots were inspected.
This follow-up has not been packaged; the existing preview shortcut is unchanged.

## Cron Recovery Latest Main Integration (2026-10-19)

PR #140 integrates main `2eff623`, preserving Usage III and Status. All six
Windows patches applied together to a new pinned-source checkout; every manifest
post-image hash matched. The recovery patch import context and combined RPC hash
were updated for Status, without changing the frozen macOS runtime baseline.
Node v24.16.0 staging, frozen-lockfile installation, typecheck and production build
passed. The serialized suite passed 555 tests with 13 platform skips; all 15
CI-policy tests and all 12 native Cron RPC cases passed. Full Windows Electron
acceptance and composer-editing acceptance passed.

macOS run 39127296032 failed waiting for `fill('')` to clear the controlled
ProseMirror editor; its screenshot still showed the previous draft. The startup
fixture now clears via native select-all and Backspace editor transactions, and
checks both editor value and controlled empty state before typing again. This
sequence also runs on Windows and passed locally. The macOS cloud rerun remains
required; this Windows replay does not establish the original platform's result.

Run 39147045392 passed that startup check and the file-preview fixture, then
exposed an undo-fixture ordering dependency. It modifies a file externally after
the turn ends, but expected an already-mounted status component to notice without
a file-watch event. The fixture now explicitly reloads before testing that
conflict, as its later external-edit scenario already does. Production undo and
its conflict checks are unchanged.

## Cron Manual Recovery Beta (2026-10-18, Local Development)

Issue #138 adds Desktop-side associations and explicit Windows project recovery
on top of merged #137. The upstream task schema, scheduler and expiry remain
unchanged. All six Windows patches applied together to a pristine pinned checkout
and passed pre/post-image checks. Runtime staging with Node v24.16.0, typecheck
and the production Desktop build passed.

The native RPC suite passed twelve cases, including ordinary due delivery and
startup missed notices blocked while recovery is gated, released only by explicit
RPC, rejected repeated release, and Ask without rewriting shared permission
defaults. Both management-created and live native tool-created associations were
verified independently of the upstream task file.

The real Electron management suite passed seven groups: baseline management,
read-only offline discovery, association persistence, review/cancel with no host
or model, changed-task consent rejection and token consumption, then one-host
recovery into the selected saved session with Ask and unchanged defaults. All
management/review operations made zero model calls. Dark/light/narrow screenshots,
cubic disclosure transitions and reduced-motion behavior were checked.

The serialized unit/protocol suite passed 534 cases with 13 platform skips.
After adding the post-start loaded-task guard, the focused recovery, management
and staging subset passed 24 cases. All 15 CI policy/runner tests passed locally.
The post-start guard allows native time advancement/removal but rejects new or
changed instructions before release.

No installer, shortcut update or public release was produced in this phase.
No real account, user task, trust store or active user application was changed.
These local deterministic tests do not qualify real billing, installer upgrade,
sleep/reboot execution, automatic startup recovery or crash exactly-once delivery.

## Status With Latest Main Preview (2026-10-19)

Windows preview source `4a1d7a9` integrates latest fetched main `ad39000`
(Usage III, PR #141) with Status PR #139 and its three review fixes.
Both Status diagnostics/tabs and Usage display-unit controls are retained.
Frozen-lockfile installation, typecheck, production build and runtime staging
passed. The complete serialized suite passed 542 tests with thirteen platform
skips and no failures.

The local unsigned x64 package is
`D:\Desktop For Step Code\Desktop\release\status-main-20261019-preview`.
It retains version 0.5.1; this is not a new public release. The runtime remains
pinned to `b5dbed938d9ae589397cf522dcf2ff89ecf4c494` with Node 24.16.0 and the
verified Windows patch set. Package audit matched all 105 Desktop build files
and 1215 runtime files, plus the native terminal backend and runtime adapter.
Installer SHA-256 is
`62c7e79fdb76193c413d1b10d692adfcca2010f0dcf1bbc9653f17f618a86e6c`;
its update metadata matches. Resource/source identities and checksums are
recorded beside the installer.

Seven packaged Electron acceptance scripts passed: general startup/RPC,
Context/Status inspector (including live approval, actual Plan mode and separate
queues), real runtime Summary, native Usage overview, Usage chart interactions,
composer menu and composer editing. Tests use isolated profiles and local
fixtures, not the user's live account or billing. Screenshots/logs are retained
under the preview's `acceptance` directory.

The ordinary Desktop shortcut was backed up in the preview and retargeted to
its verified unpacked executable, with empty arguments and matching working
directory/icon. Other shortcuts, running user processes and old packages were
preserved. Existing running windows remain on the previous executable until
the user exits and relaunches. Real-account acceptance, installer lifecycle
and cloud CI for this new integration are not inferred from these local tests.

## Desktop Session Status (2026-10-18)

The Status/Context inspector and standalone local `/status` command passed
typecheck, production build and the complete serialized Desktop protocol suite
(503 passed, thirteen platform skips). The account projection tests cover all
four official login profiles, missing credentials, unknown profiles and a
strict field allowlist; no account service is involved.

`verify-context-panel.mjs` passed with an isolated Electron profile and IPC
fixture. Added assertions cover Status opening during a running task without
prompt submission or account requests, next-turn model separation, tab keyboard
navigation and draft viewing without worker creation. Existing Context checks
remain in place. `verify-session-status-view.mjs` passed for light/dark,
1100/375px viewports, English, reduced motion, draft, offline, custom provider
and API views, default-collapsed details and diagnostic failure states.
Screenshots are under `Desktop/test-results/session-status-*`.

The real pinned-runtime status test and `verify-summary-runtime.mjs` passed,
including the Electron main/preload/RPC path. Checks cover actual Plan mode,
project trust, loaded instruction paths, sanitized endpoint, runtime-reported
version/source and manifest-provided commit/Node identity. Opening Status makes
no model request, changes no session messages and exposes no instruction content
or credentials. The source build reports 0.1.0 with a fallback source; the UI
labels that source default separately from the actual pinned commit instead of
claiming an official v0.1.5 runtime version. Full upstream `pnpm run check`
passed without formatter changes.

These are deterministic local checks, not real-account or packaged acceptance.
No installer or public release was produced for this change.

After integrating main `f23df66` (Cron PR #137), typecheck, production build and
the complete serialized Desktop suite passed again: 529 passed, thirteen platform
skips, zero failures. The merged command catalog retains both local Status and
project trust entries. All five Windows patches apply in sequence to a pristine
pinned index, with every resulting normalized source hash matching the manifest.
The first integration check reused the staged Status runtime. After staging the
integrated Cron/Status runtime with Node 24.16.0, all twenty runtime-group
acceptance scripts passed locally (the Summary check was rerun after correcting
its frame-sampling deadline). The composer menu, Context inspector and turn undo
checks also passed. The menu check covers a stationary pointer not overriding
keyboard selection when search results change. Cron recycling waits for pending
statistics reads, and multi-turn undo fixtures wait for actual turn completion.
Summary entrance checks still require intermediate frames and cubic easing,
but wait for a recorded settled frame rather than a fixed sleep. Fifteen CI
policy/runner tests and typecheck passed. Cloud macOS qualification and local
installer/real-account acceptance are not inferred from these Windows checks.

The three Status review regressions are covered by the real renderer/IPC
fixture: approval arrival, answer and expiry update the visible state without a
snapshot refresh; fresh collaboration diagnostics override contradictory launch
state and refresh after enter/exit Plan tools; Desktop FIFO and runtime queue
counts remain separate, preserving unknown versus zero and hiding message
contents. Drafts retain launch-only semantics. Typecheck, build, the complete
529-pass suite, Context inspector, themed/narrow Status fixture and real Summary
runtime acceptance passed again. The composer editing fixture now checks the
controlled value after each native typed character and reports actual value,
focus and selection on failure; its deletion/undo/redo coverage is unchanged.

## Usage III Local Overview (2026-10-18, Local Development)

The production main view now reads Desktop-owned session records through a
typed preload method, `usageOverview`. Neither the renderer nor the dashboard
receives session paths, message content, credentials or account identifiers.
Opening or refreshing statistics makes no model or cloud-statistics request.
The community client does not store statistics with an account in the cloud or
synchronize them across devices; website billing records are not included.

The Windows v0.1.5 runtime pin is unchanged. Its native `scanUsageOverview`
owns bounded inventory, parsing, incremental cache and usage-lineage dedup.
The Desktop adapter reads the matching complete private cache-v1 projection
for provider/model/hour dimensions, mirroring native origin resolution. Every
day must reconcile with the public native total. Missing, incompatible or
inconsistent detail falls back to native totals marked as unclassified instead
of fabricating a distribution. Unknown-source tokens appear only under All.
Reasoning/skill-activity coverage warnings do not imply missing Token data.
Cache hit rate is cache reads divided by complete input, including cache writes.

Conversation counts are unique main sessions, not daily counts added together.
Recorded child, branch, compaction and CLM tokens are included subject to the
native coverage limits. Estimates use only Desktop's persisted request-time
billing sidecars, deduplicate copied response identities, and keep Plan Credit,
domestic API currency and overseas API currency separate. Missing history
remains unavailable; the current login never reprices historical requests.

Typecheck and production build passed. The serialized unit/protocol suite passed
528 tests with 13 platform skips; all 15 CI policy/runner checks passed. Native
fresh/cache tests cover branch-origin deduplication, children, CLM and unknown
maintenance. Isolated-profile Electron acceptance covers actual session-file
and billing-sidecar data through IPC, source filtering, cache-write accounting,
chart cards, main-window navigation, retained drafts, Settings/Cron transitions,
390px layout and unchanged session-file contents. These checks do not establish
official billing accuracy or cloud-history coverage.

The real-data Windows x64 package is
`D:\Desktop For Step Code\Desktop\release\usage-real-local-20261018-preview`.
Its 151483161-byte installer has SHA-256
`0a983042b41c8fbdf142c472ae4dc51fe67a73112697fb04bed05b46f9e4166c`;
update metadata matches. Packaged real-data and chart-card acceptance passed,
as did 23 palette/accent cascade checks. The build reuses the previously
verified staged v0.1.5 runtime unchanged and refreshes only the Desktop admin
adapters; all 1203 staged upstream files were hash-compared with the prior
package. This is a local unsigned package, not a published release.

### Date Ranges and Token Display Units (2026-10-18)

Trend filtering supports inclusive local-calendar start/end dates and an exact
range total that follows the selected provider source. The shared single-button
unit control cycles exact/K/M/B without changing persisted usage or billing.
Context-panel totals crossfade between units over 180ms with cubic easing;
reduced motion removes the effect. Missing totals remain unavailable.

Typecheck and production build passed. The serialized suite passed 533 tests
with 13 platform skips (546 total). Packaged real-data, chart-card/date-range,
context-panel/unit/crossfade and 23 palette/accent checks passed. Installer
metadata, current build assets and all 1213 staged runtime files were checked.
The unchanged v0.1.5 runtime uses Node 24.16.0; no sample page is packaged.
The local unsigned Windows x64 package is
`D:\Desktop For Step Code\Desktop\release\usage-range-units-20261018-preview`.
The 151481525-byte installer has SHA-256
`b5abaea2f4da9be3b25154af66045e679d58e623e638de5db7d38211a016225f`.
This does not publish a Release or establish real-provider billing accuracy.

### Usage Review Follow-Up (2026-10-18)

The selected UI language now reaches the overview, daily analysis, custom date
picker, chart data cards and token-unit control, including loading, error,
empty and partial-coverage copy and accessibility labels. Dates, months,
weekdays and numeric formatting follow the selected locale; stored date keys,
model identities and billing totals are unchanged.

The Usage RPC now has an explicit 60-second timeout around the native scan,
cache projection and response transport. The native scan retains its 28-second
deadline; the global RPC default remains 30 seconds. A regression guard checks
the separate deadlines and bounded post-scan headroom.

Typecheck, production build and all 15 CI policy/runner tests passed. The
serialized unit/protocol suite passed 535 tests with 13 platform skips.
Native fresh/cache acceptance and isolated-profile Electron chart acceptance
passed, including persisted English preferences, date validation, chart cards,
source filters, display units and narrow layouts. Browser fixture checks also
covered English empty/loading/retry/partial states. No new installer was built
and the user's running packaged application was not changed.

## Cron With Latest Main Preview (2026-10-18)

Local package source `891fbc4` integrates main `28cfd9e`, including Usage II and
the Windows v0.1.5 runtime. The runtime is pinned to
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494` with the two Cron patches checked by the
Windows manifest; Node is `v24.16.0`. Both patch application from pristine source
and pre/post source hashes passed. The macOS baseline remains unchanged.

Frozen-lockfile installation, typecheck and production build passed. The complete
serialized unit/protocol suite passed 522 cases with 13 platform skips and no
failures; all 15 CI policy/runner cases passed. The native Cron suite passed ten
cases. Source Electron Cron management and project-trust suites passed, as did
the v0.1.5 native/RPC/UI `then_run` regression.

The Windows x64 preview is in
`D:\Desktop For Step Code\Desktop\release\cron-main-v015-20261018-preview`.
Installer `Desktop.for.Step.Code.Setup.0.5.1.exe` is 157557943 bytes with SHA-256
`d2057800d47615fbc61643e6e17f92bacaca725345ebc5874af52213ee067b4e`.
Update metadata matches the installer. The package audit compared 1229 runtime
files with the staged source, verified the Node hash, native terminal backend,
runtime adapter and asar package version. Packaged Cron management (four groups)
and project trust (three groups) passed using isolated local profiles and zero
model calls for management.
The packaged general Electron startup/RPC acceptance also passed. The normal
desktop shortcut was backed up inside the preview directory and read back after
being retargeted to its verified `win-unpacked` executable with empty arguments.

This is a local unsigned preview, not a new public release. Actual-account Cron
execution, user-visible billing, installer upgrade behavior, sleep/reboot
recovery and the remaining Desktop Beta features are not qualified by these
tests. Existing user processes and historical packages are not stopped or removed.

## Cron Host Lifecycle And Explicit Trust (2026-10-18, Local Development)

Issue #134 started with a Desktop-only scheduling observer on the previous
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8` pin. The Windows preview now integrates
main `28cfd9e` and its v0.1.5 pin `b5dbed938d9ae589397cf522dcf2ff89ecf4c494`;
the same two Cron patches are hash-checked by the Windows manifest.
The separate Cron patch preserves native storage, project sharing, delivery,
jitter and expiry. Main-process snapshots contain scheduling metadata only.
Resident hosts with jobs or unavailable state are excluded from idle/count
recycling. Native consumption, deletion and expiry release that protection.
Account/configuration replacement and explicit host-stopping operations reject
scheduled work rather than silently discarding session jobs or changing billing.
Ordinary idle chat and compaction are not blocked just by scheduled jobs.

Frozen-lockfile installation, typecheck, runtime staging and the production
Desktop build passed. The serialized unit/protocol suite passed 487 tests with
13 platform-specific skips and no failures. All 13 CI policy/runner tests passed.
The integration patches reverse-check against the isolated pinned source.

The new `verify-cron-runtime.mjs` is registered in the Windows runtime CI group.
Ten real staged JSONL RPC/session-pool cases passed: native management without
model calls or trust bypass, temporary and durable
host retention followed by one-shot delivery/release, native deletion,
explicit saved-session reopen, seven-day expiry, storage-lock failure/recovery,
untrusted durable-create rejection despite Full Access, and explicit native
trust save with restart-gated durable creation. These use isolated
profiles, controlled child clocks and a loopback-only deterministic model.
Unchanged snapshots do not flood RPC, and scheduler JSON never reaches renderer
events. Electron concurrency, account-routing and permission-tier regressions
also passed with their isolated fixtures.

The explicit `/trust` entry uses the existing approval drawer with persistent
scope wording, cancel and review-later actions. Only a confirmed request calls
the native ProjectTrustStore in the Desktop profile. It does not invoke a model,
enable Full Access, hot-load project resources or implicitly restart hosts.
Its new Windows CI acceptance exercises the actual Electron composer, IPC and
admin process, including native trust persistence and zero model calls.
Dark/light, minimum-width and expanded screenshots were inspected. Unit tests
also reject changed directory junctions and stale runtime approvals; expired,
cancelled and disconnected approvals do not save a trust decision.
The entry intentionally exposes only the native trust-current-folder subset,
not parent-folder, session-only or revocation choices.

The basic management UI now uses the narrow preload bridge and native tools,
not a separate scheduler. `verify-cron-management.mjs` is registered in Windows
runtime CI; its four real Electron cases cover no implicit host creation, native
durable creation without chat mutation, detail/delete/cancel, and read-only
offline discovery after relaunch. Management invokes no model. Dark/light and
narrow screenshots were inspected. Eight management unit cases cover bounded
projection, project deduplication, offline records, mutation locks and no retries
after ambiguous failures. The current serialized unit/protocol suite passes
495 tests with 13 platform skips. All five patches apply together to pristine
pinned source. The layout-only fixture remains a mock preview, separate from
these real-bridge checks.

No installer or public release was produced. No real account, user task or
trust store was changed. This does not establish sleep/reboot recovery, original
chat ownership, crash exactly-once delivery or real billing. Pause/edit,
auto-recovery and a persistent execution ledger remain unimplemented; the
overall TODO stays unchecked pending packaged acceptance.
See [Cron scope and remaining phases](CRON.md).

## Integrated Windows Preview with Usage II (2026-10-18)

Windows preview source `2066af57c83367248c004ced01e625fcc0cced9a` merges
main `d91a9e09494cf86bba7f33e01bf3860100145ce8`, including PR #135 Usage II,
into this upstream-v0.1.5 branch. Frozen-lockfile installation, typecheck,
production build and runtime staging passed. The integrated Desktop tests
passed 496 cases with thirteen platform skips; thirteen CI policy/runner tests
also passed.

Output is `D:\Desktop For Step Code\Desktop\release\upstream-v015-main-20261018-preview`.
The NSIS x64 installer remains local version 0.5.1, not a newly published release.
Installer size is 158,101,485 bytes; SHA-256 is
`8be69fac72462d60906097a2a1af88a09edf3c685c3a43ea408c28a6353e4de4`.
Authenticode reports NotSigned. SHA256SUMS and update metadata were verified.
The package/staging audit checked 1,324 files, including the full runtime,
Node, Desktop bundles, terminal native backend and file-opening helpers.
The asar root contains only dist, node_modules and package.json.

Eleven packaged Electron checks passed: general startup/RPC, then_run,
Workflow UI, real Workflow RPC recovery, account settings, allowance, context
panel with Usage II estimates, permission tiers, terminal, Plan review and
message ordering. These use isolated profiles and deterministic providers,
not paid-model or installation/upgrade qualification.

The additional message-order check reproduced the prior cloud timeout:
the new runtime had already reached revision 12 while the fixture injected
revision 10, which was correctly rejected as stale. The fixture now captures
current session state and derives its synthetic revisions from that baseline;
all overlap, legitimate duplicate delta, stale snapshot and history reset
assertions remain intact and passed twice against this same package. Only
the acceptance script changed after packaging, not application code.

The normal desktop shortcut now points to this verified unpacked executable,
with empty arguments and its matching working directory. The prior shortcut
was backed up under ignored test-results. Existing user processes were not
stopped, and prior packages were inventoried without deletion. The new output
totals approximately 720.3 MiB. PR CI needs a fresh run on the integrated
branch; prior cloud failures are not reclassified as passed by these local
checks. No public release, real-account acceptance or macOS qualification
is claimed.

## Windows then_run Approval and Verification (2026-10-18)

Fused `write_file` / `edit_file` approvals reuse the existing drawer. The
multiline upstream reason is accepted only for recognized file-tool reasons,
and the exact current tool call supplies the redacted verification command.
The command appears before file content, including in the compact drawer;
approval authorizes both operations. English/light/narrow layouts were
visually checked, alongside expansion and denial.

Structured `details.thenRun` drives verification failure, timeout and incomplete
labels without changing a successful file mutation into a runtime error.
Failed checks stay outside successful compact tool groups. An interrupted
fused operation without a structured outcome is shown as incomplete, not as
proof that the file write failed or succeeded. Reload preserves those labels.

The pinned-runtime Electron/RPC fixture passed approval before either operation,
denial preventing both, routine automatic approval, dangerous-command gating,
acknowledged Full Access, unchanged-content verification, edit failure skipping
verification, nonzero exit, cancellation and history reload. Its separate native
probe passed explicit Git Bash, initial-workspace cwd for nested files, stderr,
exit codes, output caps/full logs without rerunning the command, and a missing
explicit shell path without fallback. Timeout parity uses a 250 ms injected
host context for both tools; it does not change the product's default timeout.

The stronger gated cancellation probe exposed a Windows/MSYS parent-chain gap:
`taskkill /T` alone left a nested Bash alive after stop returned. The Windows
shell path now captures this live Git Bash invocation's MSYS descendants before
terminating the exact Windows PIDs and waits for cleanup to exit. Discovery uses
the selected Git installation and trusted Windows PowerShell; failures retain
ordinary Windows-tree cleanup rather than guessing unrelated ownership. Tests
cover missing roots and malformed tables. Real gated checks verify no late
write after stop and that a simultaneous independent shell still completes.
This is not containment of arbitrary deliberately escaped processes.

Desktop typecheck/build passed, with 480 unit/protocol tests passing and eight
platform skips. Six focused upstream test files passed 112 tests with four
platform skips; the full upstream repository check and thirteen CI
policy/runner tests passed. The guarded Windows patch clean-index replay passed
all baseline, patch and patched-source hashes. The new acceptance and focused
process-tree tests are registered in Windows CI; cloud execution is separate.
Existing permission-drawer, permission-tier, session-concurrency,
interface-preferences and Windows-command Electron regressions also passed
against the final staged runtime.

Screenshots are `Desktop/test-results/then-run-{approval,approval-light-en-narrow,results}.png`.
All fixture profiles, workspaces and command logs stay in the ignored D: test
directory. No installer, shortcut change, paid-model run or macOS qualification
is included.

## Workflow Failure Information (2026-10-18)

The Desktop projection now accepts structured node errors, rate-limit retry
progress/counts, exhaustion, callback failures and cache-hit totals. Final
failure lists merge into compatible run/start snapshots instead of replacing
successful nodes; sparse failed nodes retain known labels and tasks.
Authoritative completion totals do not depend on a failures-only node list.
Callbacks remain separate from agent counts. Terminal and idle history clear
active retry indicators, and successful finals clear stale callback failures.

Error fields use bounded allowlists and existing credential redaction. Callback
source labels reject filesystem paths and executable bodies. Projection limits
remain 1,000 nodes, with at most 100 callback records and 4,000 characters per
error message. State/history tests cover missing progress files, duplicate
persisted events, identity mismatch, malformed fields, truncation and redaction.

Electron UI acceptance passed active retries, recovery, exhaustion, separate
collapsed callback details, node error details, cache reuse, reload, Chinese and
English, light/dark themes and narrow layouts. Screenshots were visually checked.
Real Electron/RPC acceptance with the pinned runtime and local HTTP/SSE fixture
passed structured HTTP 400 errors across reload, real HTTP 429 recovery with one
recorded retry, callback failure persistence without fake agents, selective
resume and prior stop/crash recovery cases.

No installer, paid-model run, cloud CI or macOS qualification is claimed.
This completes failure-information mapping for the reviewed v0.1.5 Workflow
contract; ordinary Subagent execution and its existing transcript stay separate.
Desktop typecheck/build passed; the final serialized unit/protocol run passed
476 of 484 tests, with eight platform-specific skips and no failures. All
thirteen CI policy/runner tests passed. No new installer artifacts were produced.

## Workflow / Subagent Stability (2026-10-18)

Seven upstream Workflow/Subagent test files passed 140 tests. Four new
cross-tool cases saturate a two-slot admission pool with Workflow or ordinary
parallel subagents first, then verify bounded sharing and cancellation of the
queued tool without disturbing the admitted tool. Subagent runners must wait
for child exit. This pool belongs to one parent process, not all Desktop
session processes globally.

The five previously failing Workflow fixtures now run on Windows: directory
junctions exercise realpath escape checks without requiring file-symlink
privileges, and progress-write recovery asserts structured platform error
codes. No escape/recovery assertion is skipped. These test-only changes are
included in the guarded Windows patch and the Workflow suite is registered in
Windows CI; no macOS patch or production scheduling algorithm changed.

Real Electron/RPC acceptance passed stop/drain/resume, forced process exit and
explicit recovery, partial failure followed by history reload and selective
re-execution, HTTP 400 prose mentioning 429 without congestion classification,
and actual HTTP 429 retry/recovery. Resume expectations now follow upstream
content-addressed replay: unchanged calls that did not touch the environment
remain cached, while changed calls rerun. Upstream tests also cover writes
invalidating environment-dependent results. Separate real RPC/SSE session
concurrency acceptance passed targeted abort, approvals and recycling isolation.
The full upstream repository check and thirteen CI policy/runner tests passed.
This is local deterministic transport evidence, not cloud CI, real provider
load testing or package qualification. Failure-detail adaptation is verified
separately in the section above.

## Windows v0.1.5 Runtime Migration (2026-10-17)

Development Windows runtime now pins Step Code
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494`, using the reviewed patch manifest
in `patches/v015/`. Frozen macOS keeps `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`
and the original patch set. Both patch sets were replayed on clean checkouts;
Windows additionally checks all patched source hashes after application.

Frozen dependency installation, offline upstream build, Desktop typecheck,
production build, and runtime staging passed. Twelve focused upstream test
files passed 288 tests, covering Plan, shell discovery, Ultracode, command
parity, usage lifecycle and child shutdown. Desktop unit/protocol tests passed
470 of 478 cases, with eight platform-specific skips and no failures; all
13 CI policy/runner tests passed. Five additional upstream automatic CLM
test files passed 97 tests. The independent worker check
copied the built bundle out of the checkout and passed totals, cached scans
and cancellation under the staged Node runtime.

Isolated Electron/RPC acceptance passed Plan review and exact hash metadata,
expiry/reentry, clarification, unchanged-source branching and inline retry,
auth vault, CN/Global Plan/API routing, allowance, balance, summary, chain
success/failure/cancellation, Windows commands and permission tiers.
An eight-round independent RPC probe also passed after reproducing and fixing
an unhandled Windows temporary-directory cleanup rejection.

Review follow-up accepts the new Workflow `stopping` and `partial_failed`
states. Stopping stays active until child shutdown finishes and becomes unknown
in inactive history without a final result. Partial failure retains final time,
usage, summary counts and known node outcomes, including after history reload.
State/history regression tests and Electron Workflow UI acceptance passed;
screenshots cover the narrow stopping and reopened partial-failure views.

The initial wider Workflow run exposed five Windows fixture failures; the
2026-10-18 stability follow-up above resolves and rechecks that group.
The wider usage test file still has an unadapted symlink fixture outside this
specialty. The later failure-detail follow-up is recorded separately above.
No installer, native macOS run, cloud CI or real paid-model acceptance was
performed for this change.
The full upstream `pnpm run check` passed, including formatting, type checks
and repository guards. This does not mean the complete upstream test suite
passed; the remaining usage fixture limitation above is recorded separately.

## v0.5.1 Targeted Candidate (2026-10-17)

Usage PR #129 is merged. The release-preparation candidate was built from
clean commit `c26071a4c1d7587c31886e2cc9db673114fb45b1`, with version 0.5.1.
The fixed Step Code commit and Desktop patches are unchanged. Frozen-lockfile
installation, typecheck, 455 serialized unit/protocol tests, production build
and twelve CI policy/runner tests passed.

The NSIS candidate is in
`D:\Desktop For Step Code\Desktop\release\v0.5.1-candidate-20261017`.
Installer size is 151551418 bytes; SHA-256 is
`53f4a799fbe20c79c1eca36773ee0b5b9f11a8fe91172e9bf266264bd5193b13`.
Authenticode is NotSigned. All 98 Desktop files and 1,157 runtime files match
their staged sources, with additional adapter/helper/license checks.
Installer metadata size, version and SHA-512 match; source and metadata
evidence plus SHA256SUMS are retained alongside the package.

The same packaged executable passed six isolated acceptance scripts:
account routing, Plan allowance, API balance, auth vault, account settings
and app updates. Separate update-UI and native-download fixtures passed
confirmation/busy guards, parsing, streaming, hashing, invalid metadata,
cancellation and retry without executing any installer. These controlled
results do not establish official billing, real-account acceptance,
v0.5.0 installation migration or production in-app upgrade. Those remain
explicit release gates in the v0.5.1 preparation document.

The maintainer subsequently confirmed that real Plan/API switching works in
both directions and billing does not cross modes. This is recorded as manual
acceptance of account switching, not an independent billing audit or proof
of every region, quota-refresh action or installation migration. PR #130 at
`27122dd48af452c13ac3f1ee14f03316ca8d19ee` passed all three Windows groups
and the final CI gate in run `39025122001`; later documentation commits
have their own CI status.

After receiving the explicit v0.5.0-to-v0.5.1 overwrite-install and restart
checklist, the maintainer confirmed no issues. Installation migration with
account, settings and history retention is therefore recorded as manually
accepted. This does not establish the production in-app download/install
path or unspecified Windows-version coverage.

## Usage Account Allowance Bridge (2026-10-17)

The account page now queries the schema-1 personal Plan allowance endpoint
through a narrow preload IPC and a main-process service using the application's
already-loaded Desktop credentials. Renderer input cannot choose an endpoint
or supply a key. This does not change the upstream runtime pin.

The official plan name precedes quota meters. Coding windows and Token
subscription/top-up buckets follow the actual response family; a missing,
zero-total, unsupported or partial bucket never implies a zero or full balance.
Queries are bounded, cancellable, cached and identity-checked. Temporary
failures retain a labeled stale snapshot; authentication failures clear the
snapshot without deleting credentials. No background network polling runs.

Typecheck, production build, 447 tests and twelve CI policy/runner tests passed.
The eight focused allowance tests also cover timeout and late-response races.
Isolated Electron allowance acceptance passed using a migrated test vault and
controlled main-process HTTP responses, alongside account-settings and vault
regressions. Browser previews cover light/dark, narrow English and reduced
motion. Both new acceptance scripts are registered in the interface CI group.

The local preview installer at
`D:\Desktop For Step Code\Desktop\release\usage-account-20261017-preview`
passed packaged allowance and auth-vault acceptance with isolated fixtures.
All 98 packaged Desktop build files and 1,157 runtime files match staged
source hashes; installer metadata size and SHA-512 also match. Installer
SHA-256 is `4ee581df675fc7f4fa67a6c939ce332db0f92f4d8a2c01ead99ad463d93a485b`.
The ordinary desktop shortcut now targets this preview's unpacked executable;
the previous shortcut was backed up and running user applications were not
closed. The unsigned preview retains version 0.5.0 and is not a public release.

These are fixture results, not confirmation of the official backend's
availability or a real account's plan. Installer lifecycle and real-account
allowance acceptance remain unverified.

The PR #129 P1 follow-up refreshes expired OAuth credentials through the
upstream provider's refresh implementation in the management process before
querying allowance. Refreshed credentials are saved to the Desktop vault
before use; identity, cancellation and shared-settings guards prevent a late
refresh from replacing another account. The existing query timeout bounds
the refresh as well. Typecheck, build and 449 tests passed. Dedicated Electron
acceptance starts with an expired static upstream fixture credential and
verifies refresh, encrypted persistence and readability after restart. Unit
tests cover rotated credentials, single-flight refresh, failure, cancellation
and account changes. This follow-up has not been packaged and does not
establish real OAuth-server refresh acceptance.

The additional local-review P2 follow-up preserves official `allowed` and
bounded `reason` metadata independently of quota percentages. Restricted
accounts show a localized warning even when their remaining balance is
positive or another query notice is present. Server `observed_at_ms` now
drives reset/expiry boundary checks, including responses generated before
but received after a boundary. Such snapshots stay stale and cannot satisfy
the fresh cache. Twelve focused tests cover denial and all three boundary
types; typecheck, build and all 451 tests passed. Dedicated Electron
acceptance verifies the restricted warning and
stale display together with the existing OAuth/vault regressions.

### Local Official API Balance Preview (2026-10-17)

The local follow-up queries only the fixed CN/Global official accounts
endpoints with the selected Desktop platform credential. It projects available
balance and prepaid/postpaid account type, never derives remaining cash or
voucher amounts from lifetime totals, and does not invent a currency when the
response omits one. Custom-provider credentials are not sent to these endpoints.
Plan credential refresh remains specific to personal Plan profiles.

Typecheck, production build, all 455 tests (serialized), twelve CI policy/runner
tests and browser account acceptance passed. Default parallel tests stalled in
the existing terminal fixture; that owned test tree was stopped before the
successful serial run. Packaged API balance, Plan allowance and auth-vault
acceptance passed with isolated credentials and controlled HTTP responses.
Coverage includes regional endpoints, zero/negative prepaid balance, postpaid
balance, stale/error/auth states, cancellation and the official website link.

The local package is
`D:\Desktop For Step Code\Desktop\release\usage-plan-api-20261017-preview`.
All 98 Desktop build files and 1,157 runtime files match staged source hashes;
update metadata validation passed. Installer SHA-256 is
`5d67add82c0f67efcbabb6f08e7bb5492cd99897cdddaae4ce7973f0cc9ee1a1`.
Its source is base commit `40f048804d8a2acfba050e45710aabf5560dc5b2` plus
uncommitted API balance changes, not that commit alone. Runtime pin remains
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`.

The ordinary desktop shortcut targets the new unpacked executable; its
previous version was backed up in the package directory. Running user windows
and previous packages were preserved. No real-account balance request,
installer lifecycle test, API-change push, merge or public release is claimed.

### Account Billing-Route Regression (2026-10-17)

The follow-up synchronizes the management process's model-discovery endpoint
with the stored login profile before resolving draft-session options. The
previous package reproducibly queried the default Plan models endpoint while
signed into the platform API profile. This is evidence of a model-discovery
mismatch, not evidence of a wrongly billed chat request. Login/logout now
restart management with the applied credential snapshot as well as rebuilding
session workers.

The new interface-CI acceptance uses the real upstream remote-login polling
flow, Desktop vault/IPC and runtime with synthetic credentials and local HTTP
transport. It checks CN API -> CN Plan -> Global API -> Global Plan -> CN API,
including a persisted Step model whose old API base must be normalized. Each
phase verifies both model discovery and actual chat endpoint/credential pairs,
plus the matching allowance source. Plan model-detail metadata intentionally
uses the runtime's regional `/v1/models/...` path; this is not a chat request.
Running API work rejects a login change, pending authorization blocks prompts,
canceling authorization preserves the previous profile, and a denied Plan chat
never falls back to API billing. No real credentials or official billing
transactions were used.

Typecheck, build, 455 serialized tests and twelve CI policy/runner tests passed.
One earlier full run failed in the unrelated session-collaboration test file;
the complete rerun passed. Source and packaged routing, Plan allowance and
auth-vault acceptance passed; packaged API balance acceptance also passed.
The new local package is
`D:\Desktop For Step Code\Desktop\release\usage-account-routing-20261017-preview`.
All 98 Desktop build files and 1,157 runtime files match staged sources,
including the updated management helper; update metadata validation passed.
Installer SHA-256 is
`3c2866121f01442fbc663934211340e7810a33a7e92abafd717354d8afebaa3a`.
It remains version 0.5.0 with the same upstream pin and uncommitted local
changes. The normal shortcut was backed up and updated; running user windows
and old packages were preserved. This does not establish official backend
charging behavior, installer lifecycle acceptance or a public release.

## Accent Acknowledgement Race (2026-10-16)

Cloud run 38694832584 passed HEX input and then timed out comparing the canceled
preview with its baseline. The baseline previously waited only for the main
process snapshot to contain the saved accent, not for the renderer to install
that preference reply.

Appearance acceptance now holds the real preference reply after persistence.
It proves the snapshot already contains blue while the swatch and rendered
accent still show the old value. After releasing that reply it waits for the
selected swatch, settles color transitions and asserts the baseline equals the
final theme token before exercising preview/cancel and rapid reopen. The exact
restoration assertions remain intact; no product styling or timeout was changed.
Normal-speed and four-times CPU-throttled runs passed locally. Cloud success
still requires a new run on the updated commit.

## Accent Editor Rapid-Reopen Regression (2026-10-15)

Each explicit custom-color opening now mounts a fresh editor while preserving
the 220 ms exit animation. Canceling or toggling closed and reopening during
that exit restores the saved HEX and does not revive the discarded preview.
Both paths were reproduced against the earlier source before the fix.

Typecheck, production build, three theme tests and Appearance acceptance at
four-times CPU throttling passed. The acceptance proves the old editor is
still present during exit, then checks that reopening replaces it and restores
the saved value. The source change is not in the existing local preview package.

Cloud run 38692811276 failed while waiting for the Apply button after HEX
input. Normal input checks now wait for the editor's actual opening transition
to finish; a failure records the input value, validation and button states plus
a screenshot. Animation capture and pause use one page call to avoid losing
the transition between separate automation calls. Cloud success must still be
confirmed on the new commit, not inferred from local acceptance.

## Original Palettes and Link Accent Follow-Up (2026-10-15)

Source-only follow-up restores the original neutral light/dark palettes as
compact swatches immediately left of System. Transcript links, generic website
icons and both preview open actions now consume the shared accent instead of
hardcoded blue; external website contents and favicons remain unchanged.
The existing local preview package and desktop shortcut do not include this
follow-up.

Typecheck, production build and three theme unit tests passed. Isolated
Electron Appearance acceptance covers all eight explicit palettes, selection,
persistence and narrow layouts. Link acceptance verifies wine/gold,
original-dark/cyan and original-light/rose combinations against the root
accent token, including both preview actions. Bootstrap acceptance includes
both original palettes at the first frame. Screenshots are
`Desktop/test-results/theme-original-{light,dark}.png` and
`Desktop/test-results/message-links-accent-*.png`.

The earlier cloud interface job failed at an immediate enabled-state assertion
after HEX input. The assertion now waits for the rendered state before
checking; it is not removed or weakened. These local checks do not establish
cloud CI success or package acceptance for this follow-up.

## Six Themes Local Preview Package (2026-10-15)

The local unsigned 0.4.0 preview at
`Desktop/release/themes-accent-20261015/` contains theme source `0ee67fa`
rebased onto main `63fb179` (PR #124). Interface complexity settings, compact
process presentation and unified thinking remain present alongside the new
Appearance palette controls. The final theme circles are smaller, shifted
down/right and blended at 48 percent opacity; their centers remain inside
the tile while both outer edges clip.

Typecheck, production build, 37 focused tests and twelve CI policy/runner
tests passed. Source Electron checks passed for Appearance, interface
preferences, general Electron and theme bootstrap. The unpacked package
passed Appearance, interface preferences, desktop tray, real PowerShell
terminal and general Electron acceptance using isolated profiles. Appearance
acceptance covers all palettes, accents, restart and first-frame persistence,
intermediate cubic color frames, reduced motion, input focus containment and
the final circle geometry. These checks do not establish full-suite,
paid-model, installer-lifecycle or cloud CI success.

All 98 built Desktop files and 1159 staged runtime files matched the package.
Node hash, both Desktop helpers, terminal host, icon and keyless adapter were
verified. Runtime remains pinned to
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`; it was reused, not restaged.
Installer metadata size and SHA-512 matched. Installer SHA-256:
`8e899abd08537f18e3c3c52e5d4a4ccc6168c743a082f36076e74dc7f0a7eb8f`.
The package is `NotSigned`, and no public release was made.

The ordinary desktop shortcut was backed up and updated to the verified
unpacked executable, with empty arguments and matching working directory/icon.
The user's running previous preview was preserved. Package evidence is in
`Desktop/test-results/themes-package-resources.json`,
`Desktop/test-results/themes-shortcut.json` and the package's
`update-package-check.json` / `SHA256SUMS.txt`.
The new package totals about 703.47 MiB; all local release directories total
about 9.07 GiB. No existing packages were deleted.

## Compact Process and Unified Thinking Preview (2026-10-15)

The local unsigned 0.4.0 preview in
`Desktop/release/interface-process-20261015/` supersedes the older interface
packages below. It contains base `b5e98e3`, including current main `7b46a10`,
plus the working-tree process-group and unified-thinking changes. Exact source
hashes are recorded in the installer-adjacent `package-resource-check.json`.
No public Release, upstream pin, permission policy or personal profile changed.

Simple now combines consecutive thinking and ordinary tools into one process
row between prose segments. It shows current activity while running and actual
tool counts after completion; expansion retains all original records. Standard
uses consecutive-tool groups, while Detailed restores individual tools and
opens thinking only while that thought is active. Tools, prose or turn end
automatically fold that thought; subsequent manual reopening remains respected.
Errors, approval waits, missing results and dedicated Plan, question, Subagent,
Workflow and peer-delivery surfaces remain separate.

All thinking rows now use a Brain icon, the existing designed disclosure SVG,
elapsed time and the same live/settled label component as tools. Settled children
do not inherit a live group's shimmer. Previews remain single-line and clipped;
the underlying Markdown and original history are unchanged.

Final-source typecheck, production build and all 436 serial unit/protocol tests
passed. Shared settings browser acceptance and general Electron acceptance also
passed, including Standard's new grouping. General acceptance now explicitly
opens groups before inspecting tools and waits for thinking's closing animation.
The final packaged executable passed interface-preference and stream-motion
acceptance, including active thinking expansion, automatic folding on tool
arrival, manual reopening, long preview clipping, designed icons, independent
shimmer, existing-history reapplication, persistence, keyboard and reduced motion.
Plan review, structured questions and Workflow also passed during this iteration;
those runs preceded the final shared-label-only polish.

All 97 Desktop build files and 1157 runtime files match packaged resources.
Runtime pin remains `3ba89e0c`, with Node v24.15.0 and its verified manifest hash.
Installer size is 153346660 bytes; SHA-256 is
`fcb15cf1fbd0388a093614be23546c1ff9ffbc9d51378d54100ed4a3bb7d29a0`.
Update metadata matches installer size and SHA-512. Installer and application
remain NotSigned. These deterministic local results do not establish paid-model
acceptance, clean-machine installation or cloud CI for the unpushed changes.

The normal Desktop shortcut now targets this preview with no arguments;
its predecessor is backed up as
`Desktop/test-results/interface-shortcut-before-process-20261015.lnk`.
The running older app was preserved. Three local preview directories total
approximately 2079 MiB, including two earlier packages of about 693 MiB each.
No historical package was deleted without authorization. Screenshots include
`interface-thinking-unified.png`, `interface-compact-process-live.png` and
`interface-compact-process-dark.png` under `Desktop/test-results/`.

## Reapplication Preview Package (2026-10-15)

The unsigned local 0.4.0 preview at
`Desktop/release/interface-presets-reapply-20261015/` contains application
source `809f116`, including existing-history preset reapplication and main
`7b46a10` (PR #123 live context statistics). This supersedes the source-only
and older-package boundaries recorded below. Main integration conflicts were
resolved without changing the upstream runtime pin or user workspace.

After merging main, typecheck, production build and all 432 serial tests
passed, as did all 12 CI-policy/runner tests. The final unpacked executable
passed ten acceptance scripts: interface preferences, general Electron,
stream motion, permission approval, Subagent, Workflow, structured question
review, sidebar recovery, context panel and Windows commands. All 97 Desktop
build files and 1157 runtime files match staged resources; helpers, terminal
host, keyless adapter and Node hashes also match. Runtime retains pin
`3ba89e0c` and Node v24.15.0.

Installer `Desktop.for.Step.Code.Setup.0.4.0.exe` is 153376435 bytes, SHA-256
`c36528e581b8677ebb4f85e42d3ac6f6c300db5786ba691f9fbcf4b495b7f49b`.
Update metadata matches its size and SHA-512. Installer and unpacked app are
NotSigned. The normal desktop shortcut targets this package without arguments;
the prior shortcut is backed up as
`Desktop/test-results/interface-shortcut-before-reapply-20261015.lnk`.
The live older application was preserved. Both preview directories total
about 1386 MiB and were inventoried without deletion.

Package evidence is `Desktop/test-results/interface-package-resources.json`,
the packaged acceptance logs and installer-adjacent `update-package-check.json`.
These are local deterministic-fixture results, not paid-model or installer
lifecycle acceptance. No public version or Release asset was changed; cloud
CI is tracked independently on PR #124.

## PR #124 CI Follow-Up (2026-10-15)

The failing interface job used Playwright `check()` on a controlled switch
whose value changes only after asynchronous preference persistence. Acceptance
now clicks once and waits for both the checked and enabled states, then
asserts the persisted IPC value. A deterministic 150ms persistence delay
exercises this path locally; the complete interface regression passed twice.
No production preference behavior or assertion was disabled.

The runtime job assumed Git's internal `mingw64/bin/git.exe` layout.
Git for Windows 2.56 moved x64 binaries to `ucrt64`; the portable Bash fixture
now copies the installation marker from the actual supported prefix and fails
if none exists. All five native command scenarios passed locally on the
existing mingw64 installation, retaining real foreground/background execution,
exit-code, log-ownership and no-fallback assertions. Typecheck and production
build passed. These local results do not establish the rerun cloud result.

## Existing-History Preset Reapplication (2026-10-15)

Explicitly applying interface settings now resets existing thinking, ordinary
tool and grouped-tool disclosure to the selected defaults, even when the old
and new defaults match or the active preset is selected again. The main
conversation, saved-reading preview and settings preview share this behavior.
An ephemeral apply revision advances only after a successful preference write;
equivalent preferences arriving in ordinary runtime snapshots do not reset
manual disclosure. The revision is not persisted or sent to the model.

The renderer updates disclosure state in place rather than remounting the
transcript or reloading the page. Main-process runtime commands, original
history, permissions and models are unchanged. New Electron regressions cover
nine existing historical responses, same-preset reapplication, unchanged tool
defaults, retained prose/thinking/tool DOM identity, stream-safe manual
overrides, unchanged history and preserving an away-from-bottom reading view.
These regressions and the shared settings browser acceptance passed locally.
Typecheck, production build, general Electron and stream-motion acceptance
also passed. The first full run passed 423/424 but hit the previously recorded
terminal-count cleanup error and retained fixture processes; only that owned
test subtree was terminated. Isolated terminal acceptance then passed 5/5.
A subsequent complete serial run passed all 424 tests, with a 45-second
per-test safety bound and no disabled tests or changed terminal assertions.
Both full-run logs are retained under `Desktop/test-results/`.

This follow-up is source-only. The package and desktop shortcut described
below still contain `7c591f5` application source, not this reapplication change.
No installer was rebuilt and no live user process was interrupted.

## Interface complexity mapping (2026-10-15)

Settings now persist presentation-only Simple, Standard, Detailed and Custom
options in the Desktop profile. The main transcript and saved-reading preview
share thinking/tool disclosure preferences; the performance strip can be hidden
without stopping metric collection. All presets fold tool details. Simple also
groups adjacent ordinary tools; Standard is the fallback for absent or invalid
saved settings. Manual disclosure changes survive subsequent stream updates.

Tool groups preserve prose/thinking/image/turn boundaries and leave approvals,
failed or unreturned calls, Subagent, Workflow, Plan, structured questions and peer-delivery records
separate. Summaries count reported operations rather than inventing validation
results. Partial execution output is explicitly pending, not successful.
The Settings preview renders the production conversation and performance
components. Custom options can independently enable grouping or default
expansion. No runtime policy, model, prompt, upstream source or personal profile
is changed by these settings.

Typecheck, production build, all 408 serial unit/protocol tests and eight CI
runner tests passed locally. Browser acceptance checks shared-component preview,
reduced prose spacing, presets, custom toggles, keyboard interaction, persistence,
narrow English layout and reduced motion. Built-renderer Electron acceptance
covers live settings mapping, partial-to-final tool summaries, approval/error
visibility, manual disclosure overrides, custom group/tool expansion, invalid IPC
input rejection, restart persistence and reset. General Electron, stream-motion,
permission approval, Subagent and Workflow acceptance also passed locally.
Both new acceptance scripts are registered in the interface CI group.

These initial results are local isolated-fixture and protocol results, not cloud
CI, paid-model or installer-lifecycle acceptance. At this initial verification
stage no new package was built; see the subsequent packaged results below.
The TODO entries remain open pending user acceptance and PR merge.

### Combined Main Preview Package

The unsigned local 0.4.0 preview at
`Desktop/release/interface-presets-20261015/` includes fetched main `7e36e10`
and interface-complexity source `7c591f5`. This retains the merged structured
questionnaire Beta and project recovery/disclosure work. Tool grouping
explicitly excludes pending and answered `clarify_user` records, with regression
coverage. No upstream tracked source or pinned commit was changed.

After merging main, typecheck, production build, all 424 serial unit/protocol
tests and eight CI runner tests passed. The shared settings preview passed its
browser acceptance again. The runtime was freshly compiled and staged from
the matching isolated `step-code-v014` build source, with the current patch
hashes, pin `3ba89e0c` and Node v24.15.0. Beta bridge validation passed.
The first unit run overlapped runtime replacement and failed with missing
runtime files; it is superseded by the complete 424-test pass after staging.

All 97 Desktop build files and 1157 runtime files match the new package.
Desktop helpers, terminal host, keyless adapter and Node hash also match.
The update metadata matches the installer size and SHA-512. Installer:
`Desktop.for.Step.Code.Setup.0.4.0.exe`, 153375311 bytes, SHA-256
`79233236e8d97f58d661412a140b90319f16b281c9af89f9bdbdc98c24b2b0ed`.
Both installer and unpacked executable are NotSigned. This local preview
must not overwrite the published 0.4.0 installer.

Packaged interface-preference and general Electron acceptance passed, including
restart persistence, reset, IPC rejection, safe grouping, manual disclosure,
themes and 640px layout. The first general run timed out waiting for the
native resize; an isolated size probe and a complete rerun passed without
relaxing the assertion. Failure diagnostics now include renderer/native
geometry. Packaged stream-motion, permission approval and Subagent acceptance
also passed, followed by Workflow, real-RPC structured-question review and
sidebar project recovery/disclosure acceptance. All eight packaged checks
passed using isolated profiles and deterministic services.

The ordinary desktop shortcut now targets this package, with matching working
directory/icon and no demo arguments. Its previous contents were backed up and
the running sidebar-recovery preview was preserved. Exit that old client before
launching the updated shortcut. Evidence is under `Desktop/test-results/`,
including `interface-package-resources.json`, packaged regression logs,
`interface-shortcut.json`, four-mode screenshots, and the installer-adjacent
`update-package-check.json`.

Rebuildable artifacts were inventoried: the new package is about 693 MiB,
runtime 111 MiB, local dependencies 510 MiB, build output 8.5 MiB and terminal
runtime 63 MiB. No obsolete packages were deleted. Cloud CI, paid-model and
installer-lifecycle acceptance are not established by these local results.

## Six themes and independent accents (2026-10-15)

Appearance now offers Light, Paper, Dark, Blue, Wine and Jade, plus system
following. Each palette defines its own surfaces and text hierarchy. An
independent accent can be selected from presets or an inline color picker.
Picker edits preview immediately; cancel, Escape and leaving Appearance
restore the saved color. Applied preferences survive restart. Accent
normalization accepts only opaque three- or six-digit HEX, and rendered
accents are adjusted for text contrast without changing the saved value.
Success, failure and interrupted-state colors remain independent.

Main-process window backgrounds, preload/bootstrap first paint, renderer,
tray and terminal use the resolved palette. Scheme-prefixed tokens preserve
existing light/dark fixture switching. Transparent blends in settings and
approval surfaces use sRGB to avoid Chromium's neutral-hue OKLCH tint.

Typecheck, production build, three theme unit tests and twelve CI policy and
runner tests passed. Serial isolated-profile Electron acceptance passed for
appearance, theme bootstrap, settings dialog, desktop tray, terminal panel,
general Electron and context panel. Coverage includes all six palettes,
system changes, first-frame/restart persistence, accent validation,
preview/cancel/apply, independent semantic colors, Paper sidebar pixels,
typography and narrow layouts. Screenshots are in
`Desktop/test-results/theme-*.png`.

These are local UI and deterministic integration checks, not full-suite,
paid-model or installer lifecycle qualification. No installer, shortcut,
commit, PR or release was produced by this source-only change.

The visual follow-up adopts the six approved Chinese names and the Light and
Shadow / Between Mountains and Seas group names, with quieter concept-derived
palettes. The hue track uses a muted spectrum and a short rectangular thumb;
the saturation/value control retains accurate color selection. HEX inputs
shrink into the space remaining beside their swatch instead of overflowing
their flex row. Focus outlines are inset, with explicit wide/narrow acceptance
assertions for both the input and its entire outline. Typecheck, build, theme
unit tests and Appearance acceptance passed again after this follow-up.

Theme tiles now have a larger solid circle clipped by both right and bottom
edges, with its center inside the tile rather than on the corner, and with
the selection mark moved to the upper right. Shared color tokens transition
over 360ms with cubic easing; component geometry transitions are unchanged.
The first paint is immediate and reduced motion disables color interpolation.
Appearance acceptance samples an intermediate color frame and verifies cubic
timing, final colors and the reduced-motion path. Terminal color refresh also
listens for color-transition completion/cancellation, so its canvas does not
retain the pre-transition palette.

## Live context statistics refresh (2026-10-15)

The v0.4.0 runtime bridge refreshed statistics after maintenance or a full
snapshot, but not ordinary message completion. Long-running turns could keep
showing their initial context occupancy and session totals while per-run
metrics continued growing. Completed messages now request authoritative
runtime statistics without ending the turn or refreshing the whole history.
Turn completion also refreshes partial or final usage. Streaming deltas do not
request statistics. Automatic refresh requests are serialized per worker and
coalesce changes received during a pending read into a follow-up read. Each
actual request gets a new version so a slow full snapshot cannot overwrite a
newer follow-up. Existing identity guards discard retired-session responses.
Unknown occupancy remains unknown, and cumulative tokens never supply the
occupancy numerator.

The initial three message-refresh regressions and the slow-snapshot race
regression failed before their corresponding fixes and passed afterward.
Typecheck, production build and 79 focused tests passed. A real pinned-runtime
test uses an isolated localhost SSE model: a real read_file result reaches the
next model request while its response is held open, and Desktop publishes
increased occupancy equal to the runtime's working-context estimate before
agent_end. Existing CLM Plan/Goal, fallback and cancellation tests also passed.
Context-panel and context-maintenance Electron acceptance passed, including
live 2-to-18-percent updates in both surfaces and background-worker isolation.
These are deterministic local checks, not reproduction of the reporter's
original session or real-provider acceptance.

## Supplemental recovery review (2026-10-15)

Relocating a project from its selected draft now refreshes the session catalog
before returning the draft snapshot. Its existing histories immediately appear
in the destination group rather than disappearing until a later refresh.
Expanded inspectors disable only `.main-content`; project warnings remain
operable while the covered transcript/composer stay inert. The warning remains
inside main, above the inspector, without moving the fixed right rail.

The runtime CI failure on `3c87da2` was an immediate post-click disclosure
assertion. Disclosure now saves asynchronously; acceptance waits for the
matching committed UI state before retaining its original assertions.
The rapid-click sidebar regression also waits for the renderer after verifying
the main-process snapshot.

Typecheck, build and 64 focused unit tests passed. Serial Electron acceptance
passed for sidebar recovery/disclosure, main Electron, review, context,
browser, real PowerShell terminal, cross-session operations and fixed settings.
The sidebar case selects a draft before relocation and checks destination
history DOM before requesting a new snapshot; the expanded inspector case
checks warning focus, removal/cancel and directory-picker cancel/recovery.
No retries, disabled tests or relaxed assertions were added.

## Sidebar disclosure persistence (2026-10-15)

Project and independent-group disclosure now lives in Desktop preferences
instead of renderer-only state. Startup and reload restore the saved groups;
older profiles without a saved value retain the previous expanded default.
Disclosure writes are serialized so rapid clicks compose. Creating a session
explicitly expands its project, relocation carries its collapsed key, and
project removal clears only that project's key.

Typecheck, production build, 13 sidebar/workspace unit tests and the full
sidebar Electron acceptance passed locally. Acceptance covers mixed disclosure
states across renderer reload and a full app restart, independent-group state,
and rapid multi-group toggles. This follow-up is not repackaged; cloud CI must
validate its new head independently of the earlier green run.

## Sidebar review and CI follow-up (2026-10-15)

PR #122 review identified an unsafe path-wide relocation rule: recreating
the old directory could redirect new histories into the moved project.
Relocation now binds the existing session IDs to their destination. Reusing
the source path does not inherit another session's binding, repeated moves
update only affected bindings, and removal retains historical bindings.
Successful validation of the originally missing path clears its stored issue.

The initial cloud run `38662461552` failed on stale warning selectors in
the main Electron and navigation scripts. These now assert the application
banner and localized missing-directory message. Scripts using project add
buttons first hover their heading, matching the intentional disclosure.
The interface group also had an early native exit in the tray test without
a JavaScript failure; local tray acceptance passed three consecutive runs.
Tray readiness now requires an actual enabled composer element, and stage
diagnostics were added. No retry, timeout increase or skipped assertion was
introduced. Replacement cloud CI must independently validate these changes.

Typecheck, build, 56 workspace/runtime tests and 12 CI policy/runner tests
passed. Main Electron, navigation, review-panel and tray acceptance passed
locally. The new recreated-directory regression checks catalog grouping and
the actual runtime directory for both new and relocated histories.
Account, launch-mode and permission-tier acceptance also passed after updating
their alert selectors, including negative assertions that must detect the new
banner rather than silently overlooking it. Branching/concurrency failure
diagnostics use the same banner and modal selectors.
The earlier local installer and desktop shortcut remain on `3d4369c`; this
follow-up has not been repackaged, and the earlier full-suite terminal cleanup
failure was not retroactively marked passed.

## Sidebar project recovery preview (2026-10-15)

This unsigned local 0.4.0 preview is based on fetched main `f4c3d35` plus
the uncommitted sidebar/project recovery changes. It includes the merged
clarification Beta, performance matrix and composer select-all deletion fixes.
Project removal only unregisters the grouping; files, histories and running
workers remain. Relocation preserves project metadata and reopens original
history with the upstream session host's cwd override. A failed initial
directory validation clears only the bootstrap draft. The warning belongs
to the main viewport, sits above the summary overlay and does not displace
the right tool rail. Sidebar add controls reveal on hover/focus, and reorder
motion uses cubic easing with reduced-motion support.

Typecheck, production build and 67 focused tests passed. Source and packaged
sidebar acceptance passed for ordering, pins, missing-directory recovery,
original session identity/history, startup recovery, removal/cancel, modal
animation, warning layering/rail geometry, reload and reduced motion.
Packaged clarification, composer editing and real-RPC performance acceptance
also passed with isolated profiles and deterministic services. The Beta
questionnaire bridge validation passed against the patched build source.
This does not establish paid-model, cloud CI or installer-lifecycle readiness.
The earlier full-suite terminal process-tree cleanup failure remains unresolved;
the full suite was not rerun for this package.

The installer is under `Desktop/release/sidebar-project-recovery-20261015/`.
All 97 Desktop output and 1159 runtime files matched the package; helpers,
icon, pinned commit `3ba89e0c` and clarification patch metadata were verified.
Update metadata byte count and SHA-512 matched the 155073386-byte installer.
Installer SHA-256:
`ff01d816cacae9dfd71b647275dfdea97b828dc7a79a824629b4a55011722952`.
Both installer and application are `NotSigned`; this is not a replacement
for the public v0.4.0 release asset.

The ordinary desktop shortcut was backed up and verified to target the new
unpacked executable. No live user client was stopped; exit/relaunch is required
to use it. Package evidence is in `test-results/sidebar-project-package-resources.json`,
`test-results/sidebar-project-shortcut.json` and the release directory's
`update-package-check.json`. Rebuildable outputs were inventoried; older packages
were not deleted without separate approval.

## PR CI inventory integration (2026-10-15)

The latest PR CI failed in classification before Windows acceptance ran:
the merge preview added main's composer-editing acceptance, resulting in 51
assigned scripts while a test still expected 50. Main `1ca45ba` is now merged
into this branch. The count assertion derives from discovered scripts minus
the explicit local-only list; duplicate, missing and unassigned checks remain.
The failure reproduced locally before the change. All 12 CI policy/runner
tests and 60 runtime/revision/questionnaire tests passed afterward.
Replacement cloud CI must verify the integrated head independently.

## Question waiting-action treatment (2026-10-15)

The pending question status now reuses the permission-review treatment: tinted
surface, inset border and flowing highlight, rather than a separate text-only
gradient. It retains the circle-help icon and its place beside task controls;
Goal/Plan/Ultracode run and settled controls are unchanged.

Typecheck, build and source Electron/RPC question acceptance passed, including
computed animation/background assertions and reduced-motion disabling for both
the container and label. Dark/light screenshots are
`questions-approval-status-dark.png` and `questions-approval-status-light.png`.
This source follow-up has not been repackaged; replacement cloud CI is pending.

## Clarification completion revisions (2026-10-15)

PR #117 review found that synthetic question expiry and the original completion
shared a revision, causing the renderer to reject the tool result or agent end.
Expiry now reserves the next revision for the original event. Two regression
cases failed before the fix and passed afterward through `MessageRevision`,
covering matching tool completion and multiple pending questions at agent end.
The tool case also verifies the final error result reaches transcript state.

All 60 focused runtime/revision/questionnaire tests, typecheck, build and source
Electron/RPC question acceptance passed. The earlier commit's cloud CI passed;
replacement CI must independently verify this follow-up. The local installer
and desktop shortcut below remain on the earlier preview, not this fix.

## Question status placement correction (2026-10-15)

Source now renders the circle-help question control through `TurnStatusTrigger`
alongside Goal/Plan/Ultracode controls, outside `WorkingIndicator`. The matrix,
working label and elapsed clock retain their primary position. Typecheck,
build and source Electron/RPC question acceptance passed, including Plan and
question controls together, collapse/reopen and icon/placement assertions.
Screenshots include `questions-plan-status-dark.png`.
The corrected unsigned local 0.4.0 installer is now under
`Desktop/release/clarification-status-beta-20261015/`, based on merged main
`30c77f2` (PR #115) plus the clarification Beta changes. Packaged Electron/RPC
question and performance acceptance both passed. All 97 Desktop output files
and 1157 runtime files matched the package; the pinned commit and patch hashes
matched. Update metadata, byte count and SHA-512 matched. Installer SHA-256:
`1d12a0d1d3928dbdc9e154a18144c1ed167b3a65d3d25b5ad8d6967ddfd1d00c`.
Authenticode status is `NotSigned`. The ordinary desktop shortcut was backed
up and verified to target this unpacked executable. The user's live client
was preserved; explicit exit/relaunch is needed to pick up the new build.

The latest full serial suite passed 404 of 405 tests. The unchanged
`tests/terminal-sessions.test.ts` terminal-count case failed during `stopAll`
cleanup with "Could not terminate the terminal process tree". Only the nine
owned fixture children left by that test were stopped; no user client was
stopped. Focused acceptance does not make this an all-green full regression,
paid-model, cloud CI or installer-lifecycle claim.

Rebuildable output was inventoried: the new release directory is 726718658
bytes, local dependencies 531306491 bytes, runtime 116756025 bytes and terminal
runtime 64762142 bytes. Old packages were not deleted without approval.
Package evidence is in `test-results/clarification-package-resources.json`
and the release directory's `update-package-check.json`.

## Combined matrix and clarification preview (2026-10-15)

This preview supersedes the initial clarification-only package below. Its
baseline is merged main `30c77f2`, including PR #115's matrix working states,
flowing elapsed time and compact performance strip, plus the uncommitted
clarification Beta adaptation. At this earlier preview stage, the question
reopen control stayed inside `WorkingIndicator`; pending questions showed one waiting matrix,
retain elapsed time and never reintroduce the old pulse dot.

Typecheck, build, 74 focused tests and 12 CI routing tests passed. Matrix
browser acceptance passed. Packaged Electron/RPC acceptance passed for both
the question drawer and performance runtime, including waiting matrix,
thinking/prose transitions, TPS/usage, completion freeze and new-session reset.
These use isolated profiles and deterministic model services, not paid-model
or installer-lifecycle acceptance. The earlier terminal cleanup failure
remains unresolved; this is not an all-green full regression claim.

All 97 Desktop output files and 1157 runtime files matched the package. The
runtime pin and clarification patch remain unchanged. Installer metadata and
hashes matched; SHA-256:
`a1412d11bebb6196106b63a6cb40a307db2285e08a9b0ec654107d0a4c6b9d7f`.
The unsigned local installer is at
`Desktop/release/clarification-pulse-beta-20261015/`.
The ordinary desktop shortcut now targets its unpacked executable, with the
old shortcut backed up. The user's running clarification-only preview was
preserved and needs explicit exit/relaunch to pick up this combined build.

Evidence is under `Desktop/test-results/`, including question/matrix/runtime
screenshots and `clarification-package-resources.json`; update-package evidence
is alongside the installer. Rebuildable artifacts were inventoried; obsolete
packages were not deleted without approval. No public release or PR was made.

## Performance strip and matrix working states (2026-10-14)

PR #115 follow-up (2026-10-15): the runtime CI failure was an outdated
verify-electron assertion waiting for the removed "input" text field.
The general acceptance now checks all four metrics, icon ordering, single-chunk
unknown TPS, completed-value freeze, centered/contained narrow layout and
new-session usage reset instead of the removed extended-metric/ellipsis UI.
TPS excludes length-truncated responses while retaining their reported usage.
Six focused performance tests, typecheck, build, complete general Electron
acceptance (including reopened profiles) and real pinned RPC performance
acceptance passed locally. Replacement cloud CI is pending; the prior full-suite
terminal cleanup failure below remains a separate historical result.

The centered strip now contains total duration, estimated output TPS,
input/output tokens and cache-hit rate. TPS uses reported output tokens and
locally observed first-to-last nonempty output-delta timing for completed
responses; it is not server decode telemetry. Missing measurements stay unknown.
The five matrix states follow runtime events and authoritative approval/Plan
review state. Status text and total run time share a flowing brand gradient.
Reduced motion and forced-color fallback are covered. Light fills preserve the
original palette without outlines or shadows and are not 4.5:1 contrast-compliant.

Typecheck, production build, five performance tests, eight CI runner tests,
browser animation/palette/layout checks and built-renderer real pinned RPC
acceptance passed. The browser check starts an owned temporary Vite service
unless an explicit preview URL is supplied. Both new acceptance scripts are
registered in the interface/runtime CI groups; cloud results remain pending.

The latest full serial suite passed 397 of 398 tests: the terminal-count test
failed during stopAll cleanup with "Could not terminate the terminal process
tree"; its isolated retry also failed in cleanup. No terminal assertion or
production terminal behavior was changed. This is not an all-green full suite
or paid-model/installer-lifecycle acceptance.

The local unsigned 0.4.0 gradient preview matched 97 Desktop and 1157 runtime
files. It retains upstream pin 3ba89e0c and Node v24.15.0. Installer SHA-256:
`53465a5e06caed4f5db66e59b757b23323cc96422c5dfba5103afa7616b3a401`.
The ordinary desktop shortcut targets this preview. User-tier settings remain
outside this change, and no upstream source was modified.

## Structured clarification local package (2026-10-15)

The local 0.4.0 preview was packaged from latest main `b4f4625` plus the
uncommitted clarification Beta changes. It includes the letter-choice UI,
cubic selection feedback and heavier labels. The 68 focused tests, typecheck,
runtime staging guards and packaged Electron/RPC question acceptance passed.
The packaged acceptance uses an isolated profile and simulated model service;
it does not establish real-model or installer-lifecycle acceptance.

All 97 Desktop output files and 1157 staged runtime files matched the package.
The runtime remains pinned to `3ba89e0c` with `desktop-clarification-beta`.
Installer metadata, byte count and SHA-512 matched. Installer SHA-256:
`f336d9479d5f3485c781e0518e064c41d28f69b35ab6a8b1d23a97e34986d78a`.
The normal desktop shortcut now targets this unpacked preview; its previous
shortcut was backed up. The user's running client was not stopped.

The unsigned local installer is under
`Desktop/release/clarification-beta-20261015/`, not a replacement public release.
Package evidence is in `Desktop/test-results/clarification-package-resources.json`
and `Desktop/release/clarification-beta-20261015/update-package-check.json`.
The earlier terminal cleanup regression below remains unresolved. No Issue,
commit, PR, cloud CI success or public release is claimed. Rebuildable artifacts
were inventoried and retained for current preview/testing; no cleanup was
performed without approval.

## Structured clarification Beta (2026-10-14)

The opt-in Desktop main-worker compatibility patch connects the existing
`clarify_user` tool to a whole-question-group drawer. The tool contract,
permissions, native TUI and unflagged child RPC behavior remain unchanged.
The UI and transport are explicitly Beta; unattended expiry, automatic
decisions and restart-persistent pending questions are not implemented.
See `UPSTREAM_QUESTIONNAIRE_BETA.md` for the integration boundary and future
upstream proposal.

Typecheck, production build, staging source guards and diff checks passed.
The isolated bridge harness passed opt-in/off behavior, full-group answer
validation, trusted option-label reconstruction, cancellation/abort signals,
and the existing TUI fallback. The real Electron/RPC fixture passed question
visibility, single-choice auto-advance, previous/next navigation, freeform
draft retention across collapse and session navigation, rejected forged
answers, submission failure/retry, final explicit submission, Plan clarification
before separate proposal approval, cancellation, task abort and Ask-tier
permission approval. Existing Plan and permission-drawer acceptance passed.
CI routing tests passed; the new acceptance is assigned to the sessions group.

The full serial unit/protocol suite reported 399 passed and one failed out of
400. The unchanged terminal-count fixture failed when terminating concurrent
terminal host process trees; a standalone retry reproduced the same cleanup
failure. Only owned isolated test hosts were stopped to complete cleanup.
This run is not an all-green regression result. No cloud CI, real-model,
installer or unattended long-duration acceptance is claimed.

Screenshots are under `Desktop/test-results/questions-*.png`. At this initial
source-validation stage no installer was generated, no shortcut was changed,
and no upstream issue was created; see the later local package record above.

## Transparent Logo startup preview (2026-10-14)

A separate sandboxed, click-through, unfocusable transparent window displays
the existing Logo before the main shell is ready. It has no desktop bridge,
background panel, text or taskbar entry. Shell readiness and renderer failure
paths reveal the main window; the splash is destroyed on handoff and quit.
A ten-second hide safeguard bounds its topmost visibility. Reduced motion
disables the Logo entrance animation.

Build, typecheck and the 395 serial unit/protocol tests passed locally.
Source and packaged startup acceptance passed for geometry, bridge isolation,
shell handoff/disposal, transparent page pixels and reduced motion. A real
Windows cold-start desktop capture reproduced the earlier opaque square.
Disabling the thick frame and making the short-lived window topmost removed
the square on this host. The packaged desktop capture temporarily delayed only
the shell handoff to allow capture; normal handoff was verified separately.
This is local native-compositing evidence, not a guarantee for every GPU or
Windows configuration.

The fixed preview is based on main `feba5b4`, retains version `0.4.0` and
upstream pin `3ba89e0c`. All 97 Desktop and 1157 runtime files matched the
package; update metadata matched the installer. Installer SHA-256:
`669714b6c09d194463f412f089fc77d8219174d387bec991167201310186d17b`.
The desktop shortcut points to the fixed unpacked preview. The user confirmed
the visual experience; their running client was not stopped. This unsigned
local preview is not a published release or installer-lifecycle acceptance.
The startup script is registered in the interface CI group; cloud results
remain pending until the PR checks finish.

## In-app updater development (2026-10-14)

Source adds a pinned-release NSIS update driver, SHA-512 verification before
download/install, isolated bounded update metadata requests, cancellable full
downloads, explicit restart confirmation, runtime/approval/queue/terminal
installation guards, and owned-cache cleanup after a successful new-version
startup. Existing manual-download behavior remains for unpacked/development
clients and releases without `latest.yml`.

The final serial unit/protocol run passed 391 tests (including 15 updater
tests); typecheck, production build, existing update-check Electron acceptance
and the new update UI fixture passed locally. The UI fixture uses the real
component with simulated transfer states, not a real downloaded installer.
Screenshots are in `Desktop/test-results/updater-*.png`.

The focused updater/update-check tests total 30 passed, including cache-preflight
and network-policy regressions. The real NSIS download driver also passed isolated Electron
acceptance for streamed downloads, metadata mismatch, corrupt SHA-512 payload,
cancellation and retry. This fixture substitutes the network transport target
with a local service; it does not execute an installer or validate the public
GitHub network/signature path. Twelve CI-policy/runner tests passed.
The NSIS build produced `latest.yml`; the package checker verified its version,
asset name, byte count and SHA-512 against the installer. The local preview
retains source version 0.4.0 and must not replace the published v0.4.0 asset.
The freshly packaged unpacked executable also passed the existing update-check
Electron acceptance with an isolated profile. This verifies packaged startup,
IPC, UI, preference/relaunch behavior and the manual fallback; it does not
establish installed-client self-update or installer lifecycle acceptance.

This is not release readiness. Before publishing: verify an installed old
version upgrading to a new candidate in the cloud desktop, login/history/
settings retention, task and approval blocking, cancelled confirmation,
interrupted downloads and retries, reinstall/relaunch, installation failure
recovery, and post-success cache cleanup. Current preview installers remain
unsigned; hash verification is not publisher authentication. No automatic
rollback is claimed. No live account or original worktree was modified.

## v0.4.0 publication (2026-10-14)

Published as a GitHub Pre-release at 09:15 Australia/Perth. The public tag
`v0.4.0` resolves to merged main `af1ea3a7b0f485a598fe9050e25d9b557f532c74`.
The final installer was freshly built from that commit, not renamed from RC2.
It is 152695099 bytes, SHA-256
`1036fb426cc9351133ba88a798a0706b2a14cd202e44acd9cfbaafde146281f4`.
Both installer and unpacked application are `NotSigned`.
All 94 Desktop and 1157 runtime files matched; helpers, Node hash, notices and
six ProseMirror versions/licenses passed. The upstream pin remains `3ba89e0c`
and Node v24.15.0.

The final unpacked executable passed all 44 Windows checks and seven
supplementary checks with isolated profiles and deterministic services.
The normal desktop shortcut now targets the final unpacked executable;
the previous shortcut was backed up and the user's running RC1 was preserved.
These results do not establish a new paid-model or installer-lifecycle test.

The public installer was downloaded and hashed as a stream, without retaining
a duplicate installer. Its hash and length matched the build and the public
`SHA256SUMS.txt`, which names `Desktop.for.Step.Code.Setup.0.4.0.exe`.
Update-feed run `38494702647` succeeded. The public raw manifest advertises
preview `0.4.0`, stable `null`. The actual client update logic, supplied with
this captured public manifest, reports available for `0.3.0` and `0.4.0-rc.2`,
current for `0.4.0`, and no release on the stable channel. This is isolated
update-state verification, not observation of the user's live notification.
Evidence is under `Desktop/test-results/`: `final-040-package-resources.json`,
`final-040-acceptance.json`, `final-040-shortcut.json`,
`published-040-download.json`, `published-040-feed.json` and
`published-040-client-check.json`. Historical failures and pending granular
cloud/lifecycle records remain below; they were not retroactively marked passed.

## v0.4.0 candidate confirmation (2026-10-14)

The maintainer reported no apparent problems with RC2 and authorized continuing
release preparation. Source version is now `0.4.0`; the delivered installer and
desktop shortcut remain RC2. This confirmation is not a per-item cloud
real-model or installer-lifecycle result. Those gates remain pending.
The final installer must be rebuilt from frozen merged main; RC2 must not be
renamed or represented as the final artifact.
Typecheck, production build and all 376 serial unit/protocol tests passed
again with the final source version; `git diff --check` passed.

## v0.4.0-rc.2 packaged acceptance (2026-10-13)

Replacement candidate application source is frozen at
`2c431fc97bac6978aa5095709dda5e259096adc0`, including the persistent shared
Plan/Goal/Ultracode footer triggers. Typecheck/build and fresh staging passed;
the upstream pin remains `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8` with
Node v24.15.0. This supersedes the source-only package status below.

Installer: `Desktop for Step Code Setup 0.4.0-rc.2.exe`, 152695170 bytes.
SHA-256: `8d12cec4ee8796bfd953e84ba42a88968250aebc8d6fe9054aa570dae2797dd6`.
Installer and unpacked application are both `NotSigned`. All 94 Desktop
build files and 1157 runtime files match their sources; resource helpers,
Node hash, runtime notices and six ProseMirror versions/licenses passed.
The asar roots remain only `dist`, `node_modules` and `package.json`.

All 44 Windows checks passed against the new unpacked executable: interface
16, sessions 14, runtime 14. Seven supplementary checks passed: chat quotes,
Context, Review/Diff, turn undo, feedback, Summary board and turn changes.
StepPage's seven launches passed without the earlier native driver exit;
this does not establish that its historical cause is fixed. Fixtures and
local deterministic services use isolated profiles, not real paid accounts.

The first report driver stopped after the successful 44 checks because it
looked for the old supplementary records at the wrong JSON property. The driver
was corrected, resources/hash rechecked, and exact candidate identity plus all
three complete script inventories/success records validated before running the
seven previously unexecuted supplementary checks. No product assertion was
weakened or test skipped.

Evidence: `Desktop/test-results/rc2-package-resources.json`,
`rc2-acceptance.json`, current screenshots and `rc2-shortcut.json`.
The normal desktop shortcut was backed up and points to RC2, with matching
working directory and empty arguments verified by readback. The currently
running RC1 application was not interrupted; its package remains preserved.
No tag, GitHub Release, upload or final installer was created. Cloud real-model
and installer-lifecycle acceptance remain pending.

## Persistent turn status follow-up (2026-10-13)

Source now shares `TurnStatusTrigger` across Plan, Goal and Ultracode footer
entries. The old Plan-only hover visibility rule was removed; ordinary response
actions still appear on hover/focus. Typecheck, production build, 376 serial
unit/protocol tests and Plan-review, launch-mode and workflow Electron acceptance
passed with isolated profiles. Combined real UI component fixtures verify all
three persistent triggers at dark/light 1360px and dark 640px without overlap;
existing detail, keyboard, workflow outcome and history checks remain enabled.
Screenshots: `Desktop/test-results/turn-status-unified-{theme}-{width}.png`.
This is source acceptance only: the frozen rc.1 installer and desktop shortcut
have not been rebuilt or changed and do not contain this follow-up.

An isolated local HTTP capture of the pinned provider also confirmed a thinking
capability risk. A reasoning model without `thinkingLevelMap` exposes
`off/minimal/low/medium/high`, but selecting `off` omits `reasoning_effort` and
does not send a thinking-disable field. With explicit `off` metadata it sends
`reasoning_effort: "off"`; with only `low/medium/high` metadata an unsupported
`off` request clamps to `low`. Evidence:
`Desktop/test-results/investigate-thinking-off.mjs`. These synthetic transport
cases do not establish the real Step 5 endpoint's metadata, accepted parameters
or the cause of the user's live request. No account, credential, paid request
or upstream source change was involved.

The same four local HTTP cases were repeated using the actual v0.3.0 packaged
Node, provider adapter and supported-level enumeration, not rebuilt old source
(`investigate-thinking-off.mjs --release-030`). Its installer SHA-256 matches the
retained release checksum:
`85974def08be515c12b026eee22082df64c48ac77e03a837adbe88b22f2b2fbb`.
The old runtime manifest pins `f7392089e67d80232b73c87f894dec8100c6c20a`.
All four enumeration/request results match the current runtime. Desktop's
`ModelEffortPicker`, `model-selection` and `auth-vault` have no diff from v0.3.0;
the management helper's only change is permission-preset resolution. This
establishes unchanged behavior for these controlled cases, not a successful
live-account metadata query or proof that the service honors `off`. The existing
user application, profile, installer and shortcut were not replaced.

## v0.4.0-rc.1 packaged acceptance (2026-10-13)

Candidate application source is frozen at
`b67ed5e896936f2a2de674862990b41cb248265d`, based on merged main `cd47b0a`.
The isolated runtime was freshly staged from pinned upstream
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8` with Node v24.15.0.
The original shared junction was preserved outside the repository; its target
and running user applications were not changed.

Installer: `Desktop for Step Code Setup 0.4.0-rc.1.exe`, 152694872 bytes.
SHA-256: `6e59798c15dda333e4450431a3b03643d357e3efdf4b8b1e6101e45195337d17`.
The installer and unpacked application both report Authenticode `NotSigned`.
Package checks match all 94 Desktop build files and 1157 runtime files,
including current Desktop helpers, terminal/file-opening helpers, Node hash,
runtime notices and six ProseMirror package versions/licenses. The asar roots
contain only `dist`, `node_modules` and `package.json`.
Frozen-lockfile installation, typecheck, production build and 376 serial
unit/protocol tests passed before packaging.

All 44 Windows checks passed against the candidate unpacked executable:
interface 16, sessions 14, runtime 14. Seven additional packaged checks passed:
chat quotes, Context, Review/Diff, turn undo, message feedback, Summary board
and turn changes. Test profiles and local deterministic services are isolated.
These results do not establish paid-model semantic quality or installer lifecycle.

At 150% Windows scaling, test-only geometry corrections preserve the existing
five-row menu assertion/tolerance and compare picker/trigger widths numerically
within 0.001px, rather than comparing differently serialized CSS/layout strings.
The first full attempt passed 43 checks but its StepPage test driver exited
with native code `3221226505` during launch 3. An isolated seven-launch retry
passed, then the complete 14-check runtime group passed. The first attempt is
retained; the native-exit root cause is unconfirmed, and no corresponding
Application event was retrieved. Only the identified orphan test process tree
was terminated before retry.

Evidence is under `Desktop/test-results/`: `rc-package-resources.json`,
`rc-acceptance-first-attempt.json`, `rc-acceptance.json`, screenshots and
`rc-shortcut.json`. The normal desktop shortcut was backed up and updated to
the candidate executable, with matching working directory and empty arguments;
other desktop shortcuts were left unchanged. The installer hash was rechecked
after all tests. Test-only corrections and documentation do not change the
frozen application build or binary.

This supersedes the preparation-only status immediately below. No new tag,
GitHub Release, upload or final 0.4.0 installer has been created. Disposable
cloud-machine upgrade/restart/uninstall/reinstall and real-model Plan, Goal,
Ultracode and CLM checks remain required before final release preparation.

## v0.4.0 release preparation (2026-10-13)

PR #108 merged into main `cd47b0a88cac447b353e3038f649c6b1f03f0fed`.
Its exact final head `7a35a77c263f5fb635c698fd246b4da1c562248f` passed
cloud run `38389960338`: interface in 5m06s, sessions in 5m21s, runtime in
7m26s and the final CI gate. All 376 unit/protocol tests and the 44 Windows
acceptance checks passed; cloud logs confirm all five Windows command profiles.
The P2 controlled-draft review was fixed and its thread resolved before merge.
This supersedes pending merge/cloud notes for #108 below, not historical
installer or real-model acceptance boundaries.

An additional local runtime-group rerun stopped at the workflow history-menu
geometry assertion: all 16 rows were 33px tall, but measured content height was
166px rather than 165px. A standalone rerun reproduced that local difference;
the same head passed this check in cloud CI. No assertion was weakened and
no unrelated menu behavior changed. Candidate acceptance must inspect display
scaling/geometry rather than counting that local group as passed. The earlier
native exit `3221226505` did not recur in the successful cloud run; its root
cause is still unconfirmed.

Published `v0.3.0` remains the previous community preview. Release scope and
draft prose for proposed `v0.4.0` are recorded under `docs/releases/`.
No application version bump, new installer, checksum, shortcut update, tag
or GitHub release is part of this documentation preparation. Real-model smoke,
packaged acceptance and disposable-machine upgrade/restart/uninstall/reinstall
remain required. The shared runtime junction was inspected and preserved;
future packaging must stage current Desktop helpers independently.

## Next Windows release readiness (2026-10-13)

PR #107 merged as main `969efee30253c9ef62f23f5ac6bb51a862076f55`.
Its exact reviewed head `294cd883c60ee9f51711d0aa16834541fb16b4fd`
passed cloud run `38376159467`: sessions in 5m42s, interface in 6m41s,
runtime in 7m44s, and the final CI gate. The complete protocol suite passed
368 tests. Cloud logs explicitly confirm Goal launch acceptance, model-switch
acceptance and all five Windows command profiles passed. The PATH review
finding was fixed and its review thread resolved before merge.

This supersedes earlier pending-cloud-CI notes for PR #107, not the boundaries
of those historical tests. The earlier native crash did not recur in this run;
its underlying cause is not claimed fixed. Source and deterministic-runtime
acceptance do not establish paid-model summarization quality or installer
lifecycle readiness.

No new release version, frozen installer, package checksum, desktop shortcut
update or cloud-machine installation has been produced after this merge.
The next release still requires a frozen main candidate, packaged acceptance,
real-model smoke (including CLM requirement retention), and disposable-machine
upgrade/restart/uninstall/reinstall checks. Older local 0.3.0 previews do not
contain every subsequent source fix and are not the next release candidate.
Task-list retention through CLM/native compaction now has the local regression
evidence below; its changes remain unmerged.
Host-restricted symlink coverage and exploratory upstream Unix-path test
failures remain recorded below, not silently treated as passed.

Composer links are explicitly included in this release's finishing scope, with
source-only implementation below. User-tier frontend capabilities retain P0
priority but are deferred to the following release.
No unmerged Linux work is included in this Windows readiness record.

## Composer links and task-list retention (2026-10-13, source only)

The composer displays HTTP(S) links in place in the editable text, with a web
icon and the existing web-link colors, rather than adding a separate reference
row. A plain-text ProseMirror schema preserves whitespace, line breaks and raw
Markdown; link/command icons are view-only decorations, not prompt or clipboard
bytes. The existing Markdown/GFM parser identifies links, excluding code,
images, credential-bearing URLs and non-web schemes. Recognition never sends
the draft or automatically fetches webpage metadata. Hover/focus of the icon
reuses the existing preview; activating it toggles the built-in browser without
submitting the message. Text remains selectable and editable at raw offsets.

The pinned upstream already persists `step-tasks` independently of editable
conversation bodies and injects a fresh bounded, read-only `step-tasks-state`
snapshot into actor requests. No upstream source change is needed here.
Seven upstream context/task-state tests passed. Extended Desktop real-RPC
tests verify task IDs, states, owners, blockers and plan identity through CLM,
native failure fallback, cancellation/recovery, explicit native compaction and
runtime restart, alongside the existing Plan/Goal coverage. Earlier branches
do not inherit later task snapshots; request-local metadata neither accumulates
in conversation history nor enters editable CLM bodies. The Desktop Summary
projection continues to show the same task list.

Local type checking, production build, all 375 serial unit/protocol tests,
12 CI policy/inventory tests and all 44 Windows acceptance checks passed.
The initial sessions-group attempt inherited an older shared Desktop helper
and failed the persisted Goal identity assertion. That group was rerun in a
separate application directory with the identical renderer build and current
Desktop helpers; all 14 session checks then passed. The shared runtime and
running user applications were not changed.

Composer acceptance verifies untouched draft/transport bytes, deferred preview,
keyboard opening without sending, same-link browser toggle, narrow wrapping and
bounded vertical scrolling, selection replacement across links, undo/redo,
plain-text paste/copy, and CDP-driven IME composition both beside and inside a
URL. The existing command discovery and model controls still pass. Additional
message-feedback and chat-quote checks verify scrolling, failure restoration,
and real native prose dragging from a focused editor back to quote insertion.
Programmatic quote fixtures blur the editor before creating a prose selection,
matching the native drag behavior. Focus/selection assertions remain intact.
Screenshots are `Desktop/test-results/composer-inline-links-{light,dark,narrow}.png`
and `Desktop/test-results/composer-links-preview-dark.png`.
These are isolated fixtures and deterministic-model evidence, not paid-model
semantic retention, cloud CI or packaged release acceptance. The user approved
the inline screenshot design on 2026-10-13; installer experience remains pending.
This follow-up is being submitted for source review. No package, shortcut update,
version bump or public release is included; its cloud CI remains to be verified.

## PR #108 review and CI follow-up (2026-10-13)

The P2 review identified controlled draft synchronization incorrectly emitting
the user-edit callback. Prop-originated editor transactions now carry explicit
metadata and do not update App draft state. User edits continue to emit changes.
The redundant asynchronous composition-end callback was removed so it cannot
bypass this transaction boundary; actual IME acceptance still passes.
A unit regression distinguishes both transaction sources; real Electron
navigation acceptance previews another cached draft, rejects navigation and its
recovery snapshot, then verifies the original draft survives both the immediate
failure and a later navigation/cache round trip.

The original head passed cloud interface and sessions checks, but run
`38387265685` exited natively with `3221226505` during the default Windows
command profile, without a JavaScript exception or assertion failure. The
command fixture now reports launch, environment, session readiness, submission,
execution and cleanup stages, plus Electron exits. All five Windows command
profiles and the extended navigation acceptance passed locally. This is not a
confirmed native-crash root-cause fix; replacement-head cloud CI must complete
before reporting the failed check recovered. No assertion, profile or check was
removed, no shared runtime was changed, and no installer was produced.
The follow-up passed type checking, production build, all 376 serial
unit/protocol tests, composer acceptance and `git diff --check` locally.

## Windows command integration acceptance (2026-10-13)

Based on main `8b35512` (including merged PR #105), the new
`Desktop/scripts/verify-windows-commands.mjs` exercises the staged, pinned
Step Code runtime through actual Electron preload/IPC/RPC and a local
deterministic HTTP model. No upstream source, personal profile or running
user application is changed.

The five isolated profiles verify default native Git Bash discovery without
Git on PATH,
non-default Git discovery through a cmd-only PATH, explicit `shellPath` in
Desktop-owned `step-runtime/config.toml`, rejection of a missing explicit
path without fallback, and a clear error when no native Bash is discoverable.
The non-default fixture copies actual Git Bash executables and DLLs to a path
with spaces, masks standard install locations, and asserts the actual native
Bash path. It is a shell fixture, not a complete portable Git installation.
Windows architecture environment entries are omitted in these profiles so
CreateProcess does not restore the default ProgramFiles locations.

Successful profiles cover explicit cwd with spaces, stdout/stderr, MSYS
utilities on the non-login shell PATH, and exit-code 7 failure propagation.
Background commands return a PID, isolated absolute log path and Windows
process-tree stop advice before a fixture-owned release file allows completion.
The log captures both streams and delayed output,
and the actual `read_file` tool returns it to the actor. Any tool confirmation
is clicked in the isolated application; this is not evidence of unattended
permission bypass. Background probes are finite and finish before shutdown.

The initial complete five-profile acceptance passed twice locally. The report is
`Desktop/test-results/windows-commands.json`. The new check is registered in
the full Windows runtime CI group with a five-minute timeout; all 43 previous
checks remain, bringing the inventory to 44.

PR #107's P2 review correctly identified that the initial default-location
profile could also discover Git on the host PATH. All profiles now restrict
PATH to Windows system directories, with only the path-install profile adding
the copied Git cmd directory; the default profile retains standard-location
variables and cannot fall back to PATH Git. The corrected five-profile
acceptance and all 12 CI policy/inventory/executor tests passed locally.

The pinned upstream shell-discovery, run-command-timeout and tool-profile
suites passed 73 tests with one skipped. An additional exploratory
`step-shell-path.test.ts` run failed five Unix-profile migration cases because
their simulated Unix inputs contain Windows backslashes and trigger the safe
path rejection. The combined exploratory run was 74 passed, five failed and
two skipped. Those upstream tests and assertions were not changed.

Desktop production build, typecheck and all 365 serial unit/protocol tests
passed. All 12 CI policy/inventory/executor tests passed.

PR #107's corrected PATH head `840e7c2` passed the cloud interface and
runtime groups, including the five Windows command profiles. Sessions first
exited natively during model-switch acceptance (`3221226505`, no JavaScript
stack); a single failed-job rerun instead exposed a Goal completion mapping
failure. Upstream generates the live custom message timestamp and persisted
custom entry timestamp independently. A one-millisecond difference prevented
Desktop from assigning the custom input's history entry ID, hiding the Goal
completion footer despite the completed runtime state.

Desktop Goal inputs now carry a unique persisted metadata ID. Mapping requires
this ID, exact content and custom type on the active history branch; it does
not guess by text or clock tolerance. Legacy inputs without an ID retain exact
timestamp matching. Regressions cover independent timestamps, runtime reload,
later identical tasks, ambiguous IDs, foreign branches and the real input
producer. All 368 serial unit/protocol tests, typecheck, production build and
12 CI tests passed. Local acceptance uses an isolated Desktop extension
staging directory: the shared runtime junction initially loaded the previous
extension, which the added persistent-ID assertion detected. Those earlier
passes do not validate this repair. With the current extension, real Goal
launch acceptance passed twice consecutively, including the persistent-ID
assertion; model-switch acceptance also passed. The native crash remains
unexplained; local passes do not establish its cloud resolution.

This is source/staged-runtime acceptance, not fresh Windows installation,
real paid-model, packaged installer or release qualification. Remote CI and a
latest-source package still need verification before release.

## CLM inline references preview (2026-10-13)

PR #105's first cloud run passed interface and sessions, but runtime acceptance
read a snapshot immediately after forced-crash relaunch before renderer
navigation settled (`Execution context was destroyed`). Workflow snapshot
polling now waits for the preload bridge and composer DOM before reading.
All original crash, unknown-state, cache reuse and explicit resume assertions
remain intact. The corrected workflow-runtime acceptance passed three
consecutive local runs. Replacement cloud run `38353668743` for `5517a43`
passed all three Windows groups and the final gate.

The subsequent Codex P2 fix reuses `visibleInputBlocks` when extracting the
first user title, before truncating to 200 characters. The regression first
failed on the raw manual-CLM envelope, then passed with the compact command.
It covers string/multi-block input, unchanged canonical content, role
selection, ordinary text, Ultracode compatibility and title length.
Build, typecheck and the final full serial run passed all 365 tests. One earlier
run reported attachment-utils test-file startup failure; its isolated four-test
run and full rerun passed without attachment-code changes.
The next cloud run encountered a separate permission-fixture send race
(no user messages were dispatched after selecting Approve for Me). Its send
helper now waits for the enabled send action after filling the input; all
permission assertions remain intact. Three consecutive local runs passed.
That run also reported native exit `3221226505` in Ultracode restore without
a JavaScript stack; its local rerun passed. Restore phase diagnostics were
added without retries or weakened assertions; the native cause is not claimed
to be diagnosed.

The subsequent source-only anchor correction keeps the recognized icon at the
textarea's original text start rather than extending it into the left gutter.
First-line indentation reserves its extra width and restores on ordinary text.
Build, typecheck and composer acceptance passed, including an explicit anchor
position regression, IME, selection, model controls and narrow layout.
Screenshot: `Desktop/test-results/composer-command-reference.png`.
This correction is not included in the preview package recorded below.
The PR is based on main `0bb0272`, retaining the merged parallel Windows CI.
Both maintenance acceptance scripts are registered in its sessions group with
five-minute limits; all 12 CI policy/inventory tests passed. Manual-template
fixture readers restore LF after Git CRLF checkout; production recognition
remains strict and unchanged.

Command references now use an icon and accented name in the composer and sent
user text. The native textarea remains authoritative for selection, IME,
clipboard and transport; the visual prefix hides while selecting or editing
inside it. Command icon proportions and spacing follow the text size, including
the textarea's configured font. The strict known `/clm` status notification is
localized without internal paths; unrelated or incomplete notices remain
literal. This adds presentation only, not a CLM summary checklist.

Build and typecheck passed, as did all 364 serial tests. The local package
`Desktop/release/clm-command-reference-20261013/` passed packaged composer
discovery/command-marker/status, hidden-message history replay, maintenance
statistics/isolation and real CLM cancellation with explicit queued recovery.
Packaged manifest, Node, Step bundle, both runtime helpers, keyless-fetch and
terminal host match staging. Installer SHA256:
`9cfeccbfc055ac3f8ad7a2dfb6eed6c18801c331626a65c1c971eafa872dd1f3`.
Output before the checksum file totals 750,545,277 bytes. The desktop shortcut
targets this unpacked executable with no arguments and its own icon.
Five generated package directories were inventoried; none were deleted.
Existing user windows and canonical session files were preserved. This remains
a local 0.3.0 preview, not a public release, successful real-model manual CLM
reduction claim, installer lifecycle test, commit, push or PR.

## Manual CLM command presentation (2026-10-13)

The pinned runtime implements `/clm-compact` by submitting a generated ordinary
user message containing its mirror path, read-only index and edit recipe.
It does not provide a distinct message type or provenance flag. Desktop now
projects an exact known template to `/clm-compact` plus additional guidance
through its existing visible-input path. Matching validates the JSON-quoted
mirror path, matching index metadata and complete pinned recipe; ordinary,
partial and mismatched templates remain unchanged. This is a presentation
recognizer, not an authoritative origin signal. Model requests and canonical
JSONL history are untouched; assistant and tool messages remain literal.

Unit coverage verifies command restoration, no history mutation, multi-block
input and literal fallback. Electron hidden-message acceptance verifies live
delivery, history replay and preservation of raw fixture content. Evidence:
`Desktop/test-results/manual-clm-compact-replay.png`.
The user's requested session was inspected read-only without interrupting it.
Its generated manual command matches the projection, and the final answer
correctly recalled the fixed project requirements. However, the manual attempt
produced no persisted CLM checkpoint: its initial index had zero editable
plain-text bodies and prior assistant messages contained immutable thinking
blocks. The actor explicitly declined edits. This establishes retained
requirements in an unchanged conversation, not successful manual reduction.
The actor also performed diagnostic reads, so this is not a tools-free
maintenance sample. The clickable command reference/right-rail raw preview
was discussed as a later refinement and has not been implemented.

Build, typecheck and the final full serial run passed all 362 tests. An earlier
run failed at startup of the existing custom-provider test file; its isolated
13-test rerun and the subsequent full run passed without provider-code changes.
The new local preview is `Desktop/release/clm-manual-input-20261013/`.
Packaged acceptance passed hidden/manual-message live and replay presentation,
composer CLM discovery and model-layer interactions, and real CLM cancellation
with explicit queued recovery. Packaged Node, Step bundle, manifest, both
runtime helpers, keyless-fetch adapter and terminal host match staged/current
resources. The desktop shortcut now targets this preview with no arguments and
its own icon. Installer SHA256:
`980bdc6996be6593bc2f822c47b5d3c70670653be6e7613eb3ca50e007153388`.
Output totals 750,541,375 bytes. Four package directories were inventoried and
preserved without deletion. Existing user processes and session files were not
changed. No installer lifecycle, successful real-model manual reduction,
commit, push or public release is claimed.

## CLM discovery on PR #103 component (2026-10-13)

With user approval, the isolated CLM worktree was fast-forwarded to PR #103
head `d26f53a73ca43a4e4d2a5e9cc9cc6444d7373199`, retaining local CLM changes.
This is local integration of an unmerged PR, not a merge of that PR on GitHub.
The new composer menu exposes `/clm` and `/clm-compact` with localized labels
and existing menu styling. The pinned runtime handles these core commands but
omits them from `get_commands`; Desktop supplements the successful catalog
response and gives core names precedence without duplicate entries.
Selection fills the input only and does not dispatch a prompt.

Build, typecheck and all 360 serial Desktop tests passed. Composer-menu Electron
acceptance passed filtering, keyboard selection, no automatic dispatch, IME,
attachment references, cancellation, model picker and narrow layout.
Screenshot: `Desktop/test-results/composer-clm-dark.png`.
Context-maintenance presentation and real CLM cancellation/explicit queue
recovery acceptance also passed. The active-Goal RPC fixture now observes the
automatic continuation on session restore rather than racing it with an
additional ordinary prompt; CLM retention, completion and restart assertions
remain in place.

No upstream sources or another agent's branch were edited. No package, shortcut
update, commit, push or PR merge was performed for this component follow-up.
The shortcut still targets the PR #102 experience build recorded below.
These local-fixture results do not establish cloud CI or real-model acceptance.

The user subsequently requested packaging. The combined preview at
`Desktop/release/clm-composer-pr103-20261013/` passed packaged composer discovery,
real CLM UI cancellation/queued recovery, context-maintenance statistics and
Ultracode restart acceptance. Packaged Node, Step bundle, manifest, both runtime
helpers, keyless-fetch adapter and terminal host match current staged resources.
The ordinary desktop shortcut now targets its unpacked executable, with empty
arguments and its own icon. Existing running user windows were not stopped.
Installer SHA256:
`15e1ff806f2297324737e41ffdc0799e2372ec9868338537b242a77ecb8ad6b7`.
The output totals 750,537,788 bytes; this worktree's two package directories
were inventoried and preserved without cleanup. No installer lifecycle or
real-model acceptance, commit, push, PR merge or public release was performed.

The subsequent source-only overlap fix puts the model/effort popover above
composer discovery and limits discovery keyboard handling to its textarea.
The new regression failed against the previous build because all three
overlap hit-test points reached discovery instead of the model panel.
After the fix, composer acceptance verifies overlapping pointer hits, thinking
slider keys, secondary model-list access and foreground-only Escape in dark,
light and narrow layouts. Build, typecheck and command projection tests passed.
Screenshots are `Desktop/test-results/composer-model-layer-{dark,light}-1300.png`
and `Desktop/test-results/composer-model-layer-dark-840.png`.
This follow-up is not included in the package above and is reserved for the
next CLM PR; the other agent's PR and the desktop shortcut were not changed.

The user then requested a new combined package. The preview at
`Desktop/release/clm-menu-layer-20261013/` includes CLM discovery and the overlap
fix. Packaged composer acceptance passed both CLM entries, no dispatch on
selection, overlap pointer hits, slider keys, model-list access and Escape
scoping across dark/light/narrow layouts. Packaged real CLM cancellation/queued
recovery and context-maintenance statistics acceptance also passed.
Packaged Node, Step bundle, manifest, both runtime helpers, keyless-fetch
adapter and terminal host match staged/current resources.
The ordinary desktop shortcut targets this preview with empty arguments and
its own icon. Existing user windows and all three local package directories
were preserved. Output totals 750,537,772 bytes. Installer SHA256:
`4cd777f0a934a76097d5046f3a13f14803f9d55f3716c459114aa0d99e55b241`.
No installer lifecycle, real-model acceptance, commit, push or PR merge was
performed; this is a local experience build, not a public release.

## Combined CLM / PR #102 package (2026-10-13)

The CLM worktree was fast-forwarded to merged main `76ee986` (PR #102,
reviewed head `c94dc68`) and local CLM changes were reapplied. The only merge
conflict was additive verification documentation; both records were retained.
The local 0.3.0 preview is `Desktop/release/clm-latest-pr102-20261013/`.
It includes the latest merged Ultracode recovery work and the uncommitted CLM
statistics/cancellation changes described below. Typecheck/build and all 358
serial Desktop tests passed after integration.

Packaging first failed while dependencies were shared via a junction. A
worktree-local frozen-lockfile pnpm installation succeeded, and NSIS packaging
then succeeded without dependency version changes. Packaged acceptance passed
real CLM UI cancellation/queued recovery, context presentation, Ultracode
restart/one-turn consent, and workflow parallel/chain/history/stop-resume/cache/
changed-script/forced-crash recovery. These checks use local HTTP model fixtures.
Packaged Node, Step bundle, manifest and both runtime helpers match the staged
v0.1.4 resources (`3ba89e0`). No upstream source was edited for this package.

The ordinary desktop shortcut targets this package's unpacked executable with
empty arguments and its own icon. Existing user applications were not stopped.
Installer SHA256:
`095cb2996d2763ec2dfa5eabcdfda46f7b59b5c799e86588551f6e621ff904cb`.
Package output totals 750,566,814 bytes. Old packages were not deleted.
No installer lifecycle test, real-model semantic retention acceptance, new PR or
public release was performed; this is a local experience build.

## PR #102 review lifecycle follow-up (2026-10-13)

Workflow binding metadata now follows session lifecycle: clone/fork copies only
workflow calls present in the new transcript and immediately rehydrates the new
worker; normal quit flushes pending writes after runtime shutdown; individual
and bulk archived deletion removes the matching binding file. Unit regression
covers retained/excluded calls, flushed writes readable by a new store, deletion
with a pending write and preservation of the source when removing a branch.
The real-runtime fixture verifies cloned interrupted history immediately retains
aborted status. Build, typecheck, nine focused tests, workflow recovery, session
branching and tray quit acceptances passed locally. Replacement cloud CI remains
required; no new package or merge was performed.

## Bound workflow interruption history (2026-10-13)

Real-model session acceptance confirmed identical original/resumed script hashes,
two cached steps and a completed third step. The original run's progress was
aborted while the parent tool error returned empty details. Desktop now persists
a session/call-to-run binding from structured runtime progress events under
userData. History hydration uses that binding and the matching startedAt to read
only bounded progress inside the workspace. Bound terminal progress supplies the
presentation status without rewriting the tool result or journal. No error-text,
script-name or timestamp-only matching is used; historical runs without a binding
are not retrospectively guessed.

Regressions cover persisted bindings after store restart, session/call isolation,
aborted versus failed state, mismatched startedAt and immutable original results.
The real-runtime stop/replay/crash fixture also checks that the aborted workflow
is hydrated as aborted despite empty error details. This follow-up is source-only
and is not included in the earlier local package documented below.

## Ultracode recovery local package (2026-10-13)

The isolated worktree was fast-forwarded to main `9422c94` before building
`Desktop/release/ultracode-recovery-20261013/`. This local 0.3.0 preview includes
the recovery presentation fix below. Frozen dependency installation and build
passed. Its unpacked executable passed workflow stop/replay/changed-script/crash
recovery, Ultracode restart/one-turn consent and workflow UI acceptance.
Packaged Node, Step bundle, manifest and both Desktop runtime helpers match the
staged v0.1.4 resources. The normal desktop shortcut now targets this package
with empty arguments. Existing user processes were left running.

Installer SHA256: `efd7be3207c229ec8c127512d605e3649129ecc24745a67c37756e0e7b68c310`.
Package output totals 750,504,202 bytes. No old packages were deleted. This build
does not include another agent's unmerged context-maintenance work. No installer
lifecycle, real-model acceptance, external review, PR or public release was performed.

## Workflow interruption and replay follow-up (2026-10-13)

The real-runtime fixture now aborts a sequential workflow during its second
child, resumes its journal and verifies actual provider request counts. The
completed first child is cached, the aborted second child runs again, and the
third child executes once. Changing the second call preserves the first cached
result but reruns both the changed call and its successor. Cached agent status
is also verified in the hydrated Desktop snapshot.

Forced termination of the fixture-owned Electron process tree reproduced a
presentation defect: the parent transcript has a workflow call without a final
tool result, while the on-disk progress still says running. Desktop inferred a
running orchestration after reopening an idle session. The presentation projection
now marks unresolved workflows and queued/running agents as unknown outside an
active turn. A new turn cannot reactivate unresolved workflows from older turns.
The transcript block and right-panel projection use the same rule. Stored history,
upstream sources and compaction/queued-message implementation are unchanged.

The forced-crash acceptance checks pending/unknown icons in both the transcript
and orchestration panel, then explicitly resumes the persisted run. Request counts
prove the committed prefix is reused and the remaining children execute. Child
sessions remain excluded from the main catalog. Screenshot:
`Desktop/test-results/workflow-crash-restored-unknown.png`.

Build, typecheck, all 343 serial tests, workflow presentation acceptance and the
extended real-runtime recovery acceptance passed locally. Tests use disposable
profiles and a local HTTP model fixture; only the fixture PID tree is terminated.
Recovery is explicitly invoked through `resumeFromRunId`, not automatic background
execution after startup. Real-model orchestration acceptance, replacement cloud CI,
packaging and release qualification remain outstanding.

## Ultracode / Subagent v0.1.4专项验收（2026-10-12）

Based on merged main `1cbbc11`, with staged upstream baseline
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`. No upstream runtime or
compaction/queued-message implementation was changed. Existing runtime resources
were copied into the isolated worktree; acceptance uses disposable profiles and
local HTTP model fixtures, without accessing the user's live sessions.

The real workflow acceptance now closes and relaunches Electron, opens the parent
session and compares all three persisted agent records against the settled
snapshot. It also verifies no new provider requests, no standing consent grant
and no child sessions in the conversation catalog. Readiness waits distinguish
the initial proposed-session screen from a connected worker and allow asynchronous
workflow history hydration to finish before comparing records.

The Ultracode restart acceptance now covers one-turn input, cleared launch state
after settlement, an ordinary follow-up without a new opt-in reminder, and restart
without restoring expired one-turn consent. The historical reminder remains in
its original turn; its presence is not a fresh authorization. Existing checks
cover persisted session on/off, one standing reminder and new sessions opted out.

Build, typecheck and 19 focused workflow/subagent tests passed. Real-runtime
workflow restart acceptance passed twice with its final assertions; the extended
Ultracode restart acceptance also passed.
Real-runtime chain acceptance passed success, failure and cancellation, including
previous-result handoff and skipped successors. Background-subagent acceptance
passed cross-turn updates, reload, failure, interruption and follow-up. Workflow
UI acceptance passed final history, failure/interruption/cache/budget states,
panel interaction, light/narrow layout and session isolation. `git diff --check`
passed. No product defect requiring an implementation change was reproduced.

This evidence does not establish abrupt-process-crash recovery, explicit
`resumeFromRunId` cache replay and changed-script invalidation, or real-model
orchestration quality. No installer, shortcut change, PR or release qualification
is included. The full Ultracode P0 remains open pending those remaining checks.

## CLM v0.1.4 adaptation (2026-10-12)

The final Electron follow-up identified and fixed a renderer-only cancellation
gap: the composer disabled Stop while maintaining context, and its stop handler
required ordinary streaming. Stop now accepts the existing composer busy state
and invokes the existing IPC abort path during maintenance. No upstream changes
are needed. The previous presentation assertion is updated to require enabled
Stop rather than preserving the inaccessible cancellation behavior.

New real Electron acceptance seeds isolated long history and holds an actual CLM
HTTP request, sends a draft through the composer into the Desktop queue, then
clicks Stop. It checks maintenance ends, no CLM checkpoint or native compaction
is committed during cancellation, and the undelivered draft remains paused.
Explicit queue recovery uses the public preload/IPC bridge with CLM still enabled.
The cancelled attempt enters upstream cooldown; native threshold compaction
remains available and occurs once during recovery. The actor receives fixture
summary evidence and the queued user message is persisted once. Native compaction
may retain recent canonical text; replacement of that text is not asserted.
This is real UI/IPC/runtime lifecycle evidence with a deterministic model, not
proof of semantic summarization quality. The check runs under the full Windows CI
path with a five-minute step limit and bounded process/server cleanup.
After the Stop fix, final build/typecheck, real Electron CLM cancellation,
context-maintenance presentation, Ultracode restart acceptance, diff whitespace
validation and all three CI policy tests passed. The preceding 356-test full
suite remains the unit/protocol result; the final change is the renderer stop
guard, covered by these final Electron checks.

2026-10-13 follow-up adds three real staged-runtime RPC tests using a local
deterministic HTTP model. They seed editable long history, trigger automatic CLM
without an explicit projection setting, assert an accepted edit and no native
fallback, and inspect actual actor payloads for the projected evidence and
protected user requirement. Canonical JSONL history remains intact. Maintenance
and actor usage (including Goal completion review) each contribute once.
All three passed: Plan survives maintenance/restart and submits a proposal for
approval before exiting planning; paused Goal survives restart; active Goal
completes and restores as complete. A Desktop fork before the old user message
does not inherit the later Goal or CLM checkpoint, and reopening the source
still uses its original accepted projection. These tests run in the normal
Desktop protocol suite and do not modify upstream source or personal profiles.
Two subsequent staged-runtime recovery tests also passed. An invalid offered ID
is rejected with maxRequests=1, triggers exactly one successful native compaction,
persists one compaction entry and continues the actor and queued follow-up.
A held maintenance stream is cancelled via abort after the Desktop queue is paused;
maintenance ends without fallback or an accepted working-context checkpoint.
The undelivered draft stays paused and is delivered exactly once after explicit
recovery. Recovery uses /clm off to avoid re-entering the deliberately held
maintenance fixture; it does not prove a second CLM attempt after cancellation.
These tests use actual SessionRuntimes, PendingMessages and the staged RPC child,
not the Electron IPC command handler or injected maintenance events.
Final typecheck, diff whitespace validation and the full serial Desktop suite
passed with all 356 tests, including all five real-CLM scenarios.

Based on merged PR #101, maintenance completion now requests authoritative
`get_session_stats` totals without reloading messages or ending the running turn.
The renderer updates both the context ring and inspector. Desktop does not add
maintenance usage itself: the pinned runtime already includes it in totals.
Request ordering prevents older snapshots from overwriting newer statistics;
disconnected workers, replaced transports and changed session identities discard
late results. Read failures preserve the last known totals. Late provider usage
that arrives after maintenance completion is still picked up by the next ordinary
snapshot refresh; this change does not introduce continuous usage polling.

Local validation: typecheck/build, all 350 Desktop unit/protocol tests, the new
Electron context-maintenance presentation acceptance, and real-RPC send-queue
acceptance passed. Presentation injection verifies maintenance labels, occupancy
updates and background-session isolation; it does not cause real CLM maintenance.
Nine new transport tests cover usage refresh, duplicate completion, fallback
ordering, stale snapshots, disconnect, replacement, session change and read errors.
After adding the final asynchronous history-decoration guard, typecheck and all
77 focused maintenance/runtime/queue tests passed, as did the three CI policy tests.

Read-only testing against the pinned upstream checkout ran six suites covering
automatic CLM, completion, live context, task-context snapshots, maintenance
controller and defaults: 83 passed, one Python-dependent test skipped. Three
additional suites (Plan extension, Goal abort regression, bounded context reads)
returned 22 passed and one failed. The failing test creates a file symlink;
an isolated OS probe also returns EPERM on this host. No upstream source or test
was changed to bypass that restriction.

P0 remains open. These are deterministic local tests, not real-model acceptance
of semantic retention. Remaining acceptance includes real long-context retention,
task-list
retention through maintenance, and the symlink case on a capable Windows host.
No installer, shortcut update, PR, cloud CI result or release qualification is
included. Runtime and dependencies are reused through local junctions; generated
build/terminal output is retained for acceptance and no old packages were deleted.

## PR #101 Queue and CI Follow-Up

The `79d6f79` Windows run finished earlier checks in approximately ten minutes,
then model-switch acceptance asserted before the new-session draft was ready.
Its failure cleanup remained blocked until the next push cancelled the run.
The fixture now polls IPC snapshots for draft readiness before the unchanged
assertion, closes provider connections before Electron, and bounds cleanup to
15 seconds. The CI step also has a five-minute limit. Model-switch acceptance
passed locally and exited normally; full replacement cloud CI remains required.

Local review identified that the pinned runtime emits `compaction_start/end`,
not the legacy `auto_compaction_start/end` names. Desktop now handles the native
events in worker busy-state projection, snapshot publication, queue completion
and renderer maintenance presentation, while retaining legacy compatibility.
Transport regressions cover native success, failure, cancellation and CLM
fallback, including duplicate completion and paused-queue guards. All 342
Desktop tests, typecheck, build and Ultracode restart/presentation acceptance
passed locally; replacement
cloud CI is required before treating this source follow-up as validated remotely.

The second P1 fix treats context maintenance as a queued-send condition in both
the main-process prompt router and the composer. Maintenance beginning during
asynchronous attachment validation is rechecked before dispatch. Steering is
rejected while maintenance is active, preserving the queued receipt for later
delivery. Empty input cannot issue an ineffective stop during maintenance.
Focused queue tests, typecheck/build, maintenance presentation and real send-queue
acceptance passed locally. The presentation fixture checks Queue message and the
disabled stop state separately from the transport-driven queue lifecycle tests.
This fix remains source-only pending its replacement cloud CI.

The P1 review fix routes `auto_clm_end` and `auto_compaction_end`, as well as
`agent_end`, through the existing pending-message completion path. Maintenance
ends after the busy flag is cleared, allowing blocked follow-ups to drain without
an unrelated user action. Existing pause, failure, interruption, reservation and
receipt guards remain in place. Transport-driven regression tests exercise both
blocked completion attempts, maintenance completion, duplicate events and
explicitly paused queues.

The Windows CI failure at the concurrent-session fixture's dialog-count assertion
is addressed by awaiting the destination composer draft and the outgoing approval
drawer's removal before asserting zero dialogs. The assertions still require a
background request to remain invisible and reappear when its owning session opens.
Source typecheck/build, all 336 tests, two consecutive concurrency acceptances
and send-queue acceptance passed locally. This follow-up is not in the preview
installer above; cloud CI must validate the replacement commit independently.

## Step-Code v0.1.4 baseline integration

2026-10-12 source upgrade from merged PR #100 (`af40f5b`): the runtime is
pinned to upstream commit `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`.
This is a commit baseline containing the announced v0.1.4 changes, not a
verified upstream release tag. Both Desktop patch files apply unchanged;
existing source and patched-source hash guards still pass. Frozen dependency
installation, upstream build and runtime staging passed with Node v24.15.0.
The optional `cpu-features` native build failed locally without preventing
installation or the runtime build.

Desktop now consumes native Ultracode standing-status notifications, including
restoration after runtime restart, and automatic CLM maintenance events. CLM
uses the existing compaction busy guard and a visible context-maintenance pulse;
it does not enable orchestration or mark old conversations as new model output.
The launch fixture checks that ordinary follow-up turns do not repeat capability
guidance or inherit single-turn orchestration consent. Goal completion approval
waits for the specific fixture request and verifies its removal after a real
approval-button click, avoiding an early exit on a transient completion snapshot.

Source typecheck/build and all 332 Desktop tests passed. General Electron,
permission tiers, real chain/workflow runtime, session concurrency, Plan review,
Goal/launch and Ultracode restart acceptance passed using isolated profiles and
local deterministic providers. A separate injected-event presentation check
verifies that CLM maintenance appears while the model is not streaming and clears
on completion; actual CLM lifecycle behavior is covered by upstream tests.
CI policy tests passed, and full Windows CI includes Plan, shell, Ultracode,
focused automatic CLM suites and the restart acceptance with independent exits.

The focused nine upstream files passed 185 tests. Broader exploratory upstream
runs were not fully green: one 19-file run passed 492 and failed five; an
additional six-file CLM run passed 59, failed one and skipped one. The six
failures comprise two Windows escaped-path guidance assertions, three symlink
permission cases and one Git quoted-path assertion. These failures have not
been hidden or fixed by weakening upstream tests. They remain limitations of
this host's broader upstream validation.

This upgrade does not establish paid-model CLM behavior across every combination
of Plan, Goal, steering and branching, installer lifecycle acceptance or release
readiness. Initial source verification did not package or publish the upgrade.
Existing application processes, packages, the personal upstream
checkout and the previous staged upstream build were preserved.

2026-10-12 packaging follow-up: `Desktop/release/upstream-v014-preview/`
contains a local `0.3.0` preview installer and unpacked application. Packaged
general Electron, Goal/launch, Ultracode restart (including CLM presentation)
and Plan review acceptance all passed with isolated profiles. Packaged manifest,
Node, Step Code bundle, both Desktop helpers and terminal host match staged
resources. The ordinary desktop shortcut now targets this preview with no demo
arguments; running application processes were not stopped. Installer SHA-256 is
`2d34a0121563d6bdfeee7d3a3c1c9b9afbc25819dafce1ae65ab40094f6e1af9`.
The new directory totals about 715.73 MiB and was inventoried without deleting
previous packages. This is not an installer execution or public release check.

## Desktop Plan integration

2026-10-12 PR preparation: the final source passed typecheck/build, all 331
Desktop tests, 133 tests across the pinned runtime's four Plan test files,
general Electron, Goal/launch and Plan review acceptance. Both runtime Plan
tests and dedicated Plan Electron acceptance are included in full Windows CI,
with independent exit-code checks. Latest local refinement navigation and
execution-disclosure anchoring remain source-only; no new installer was built
for this PR preparation and no cloud-CI success is inferred from local results.

2026-10-12 execution-disclosure anchoring follow-up: the status trigger stays in
the existing pulse/footer flex line while only its disclosure occupies the next
line. Running details align below the trigger; settled details retain right-edge
alignment. Hidden footer visibility applies to the trigger rather than a layout
wrapper. Source typecheck/build and Plan Electron acceptance passed with relative
anchor-position assertions for opening/closing, narrow containment, hover-hidden
footer and the refinement/recovery regressions. Screenshots are
`plan-execution-running-anchored.png` and `plan-execution-completed-anchored.png`
under `Desktop/test-results/`. A first acceptance attempt timed out starting the
next Plan turn; explicitly awaiting the armed state before sending passed the
rerun. This frontend follow-up is not in the existing installer.

2026-10-12 local refinement navigation follow-up: opening the feedback editor no
longer answers the native review request. Back to review preserves the pending
approval and draft without resuming the model or ending the turn. Only submission
advances the native select/input handshake. Source typecheck/build and Plan Electron
acceptance passed, including back-to-approval, draft retention, defer/reopen and
actual refinement submission. This follow-up is not in the package below.

2026-10-12 execution-status follow-up: successful native Plan approval adds an
inline approval note, an active execution pulse and a hover-hidden settled footer.
Each disclosure renders the approved Markdown snapshot, not a later file version.
Ordinary new turns clear ownership; steered messages retain it. Failed/interrupted
execution has separate labels. A normal execution-turn end is not independent
verification that every Plan requirement was fulfilled.

Typecheck/build and 331 Desktop tests passed. The package at
`Desktop/release/plan-execution-status-20261012` passed Plan and general Electron
acceptance with isolated profiles and a deterministic provider. Coverage includes
single approval-note rendering, snapshot immutability, running light/dark/narrow
layouts, disclosure bounds, hover-hidden footer, next-turn isolation and the prior
stale-snapshot/expiry/fresh-review regressions. The ordinary desktop shortcut
targets this build without interrupting the running application. Installer SHA256:
`7055f155acae790dbde3aa384e512eb9166bca6d91c6a2ba4dafdd9f656198dc`.
No new paid-model acceptance, installer lifecycle test or PR is claimed. Fourteen
release directories total approximately 9.5 GiB; they were inventoried, not deleted.

2026-10-12 review-loss follow-up: the real notes session ended review after exactly
120 seconds. The previous motion package contained a stale two-minute compiled
runtime even though source advertised four minutes. Staging now recompiles the
coding agent before bundling; source hashes are not treated as compiled provenance.
Expiry/cancellation wording no longer falsely attributes expiry to the user.

A deterministic delayed pre-request snapshot reproduces drawer disappearance in
the previous packaged renderer (`--legacy-repro` fails the drawer-preservation
assertion). UI request/expiry events now advance the renderer revision watermark.
This confirms the race exists, not that it uniquely explains the user's incident.
Ended reviews retain a history-derived reentry while Plan remains enabled. A click
sends a visible request to resubmit the current proposal, requiring new runtime
approval rather than reviving expired authorization.

Typecheck/build, 327 Desktop tests, 80 upstream Plan-extension tests, general
Electron and permission-drawer acceptance passed. Real-runtime Plan acceptance
with the user's complete Chinese proposal and acknowledged Full Access passed:
delayed snapshots, approval/refinement, ordinary follow-up reentry, reload/restart,
changed-proposal rejection and accelerated main-process expiry. This is isolated
deterministic-provider evidence, not a new paid-model acceptance.

The replacement `Desktop/release/plan-review-recovery-20261012` passed packaged
Plan acceptance (complete Chinese proposal plus acknowledged Full Access) and
general Electron acceptance. All staged bundle chunks, entry, native Plan
implementation, manifest, Node and Desktop helpers match the package. Installer
SHA256: `433c4f16e540cfe79a2de829a38727c803ebca585d1ff13f0105776cca03eaab`.
The ordinary desktop shortcut now targets this replacement; the running user
application was preserved. No paid-model retest, installer execution or PR.

Motion/coverage follow-up: dragging now changes the drawer height continuously,
then settles to the chosen size with the existing approval easing. The review
entry reuses permission-review flow/breathing animations. The drawer covers the
composer and runtime metrics through its exit animation; feedback focus retains
the normal border without an accent outline or shadow. Typecheck, build and Plan
Electron acceptance passed, including continuous drag, animated entry, full
underlay coverage and feedback focus-style assertions. This source follow-up
is packaged in `plan-drawer-motion-20261012`. Packaged Plan and general Electron
acceptance passed, and runtime file hashes match staging. The ordinary desktop
shortcut points to this build. Installer SHA256:
`a8e304ead8b1063055d43f887ec65b661b9a0c14f344e590ce4f5a9ee7da007b`.

Drawer follow-up: source typecheck/build, all 96 upstream Plan/review tests,
Plan Electron acceptance and existing permission-approval Electron acceptance
passed. The Plan fixture verifies non-modal composer anchoring, rendered Markdown,
two sizes, defer/reopen without runtime continuation, narrow bounds and the prior
approval/refinement/cancellation/restart boundaries. Review/feedback waits are
four minutes each in source; the compiled-package freshness issue above was found
later. The follow-up package `Desktop/release/plan-drawer-20261012`
passed packaged Plan and general Electron acceptance. Packaged runtime hashes
match staging. The ordinary desktop shortcut points to its unpacked executable.
Installer SHA256: `10f6734d5cb4a50f49ee3689a57ae7d735bd62dc33b374a1e73fc3b5ada2ab67`.

Plan remains on the `7d86143586f7b5d0458ffd5e4b90642d7c22459b` baseline.
The guarded Desktop integration patch enables model-visible, ephemeral Plan
context on every model call and a blocking main-worker RPC review. Ordinary RPC
children do not receive the opt-in flag. Proposal approval is checked against
the current history leaf, path and full contents before editing tools are restored.
Commands retain upstream permissions; Plan is not a read-only sandbox.

Local validation: Desktop typecheck/build and 325 serial tests passed. The pinned
runtime's Plan/review tests passed 96/96, including pending approval, cancellation,
changed proposals, changed history, abort and refinement feedback. Electron Plan
acceptance uses the real runtime with a deterministic local SSE model: an ordinary
file write is blocked during Plan; the proposal can be written; review prevents
model continuation until approved; approval resumes execution; refinement returns
feedback; cancellation terminates without repeated review. Stale responses and
changed-file approvals are rejected. Renderer reload and application restart
retain Plan without restoring an approval, and the resumed request receives Plan
context. Dark/light/narrow captures are in `Desktop/test-results/plan-review-*.png`.

Existing launch modes, permission tiers and general Electron acceptance passed.
Upstream child environment and chain-result tests passed; the broader workflow
runtime suite had one Windows EPERM failure creating a symlink (31/32 combined
tests passed), which was not bypassed. The guarded patch was reconstructed from
clean pinned sources and matched the prepared Plan files after LF normalization.

This is local deterministic acceptance, not a paid-model, cloud CI or installer
acceptance claim. No public PR was created.

The local preview `Desktop/release/plan-review-20261012` contains the Plan
integration and the PR #99 permission-cancellation fix. Packaged Plan Electron
acceptance passed, including application restart and review cancellation. Runtime
manifest, Node, Step bundle and management/session helpers match staging by SHA256.
Installer SHA256: `41f1fc8cbfa3b5eacedd7ccc54d5205f198f6ef2b356614ef2330b6b32c1df8f`.

## Permission Tiers

The PR #99 P2 follow-up reproduces an error banner after deliberately cancelling Full Access. The main process now distinguishes explicit native cancel-option/Escape responses from expiry or an unexpected activation failure. Cancellation returns a separate IPC result; draft first-send restores its input, quotes and attachments and stops without calling the model or reporting an error. Other activation failures remain errors. Unit coverage distinguishes grants, cancellation, unrelated dialogs, expiry and late responses; actual RPC/Electron acceptance checks draft cancellation, both existing-session cancel paths, unchanged permissions, preserved input and no error banner. Typecheck, build, all 324 serial tests, permission-tier and new-session acceptance passed locally. This source-only follow-up does not update the prior installer or shortcut; the original head's cloud CI passed, and the replacement head requires its own CI result.

The 2026-10-12 source pins upstream `7d86143586f7b5d0458ffd5e4b90642d7c22459b`, the merge of PR #235, before the later default-model change. The existing guarded Desktop patch applies unchanged. A separate build checkout and staged Windows Node v24.15.0 runtime were used; the user's upstream checkout and personal Step Code profile were not modified.

The composer exposes Ask, Approve for Me and Full Access, independently of thinking levels and task launch controls. Full Access uses upstream risk acknowledgment, with localized labels that preserve exact native response values, cancel-first focus, Escape cancellation and a maximum two-minute expiry. Draft first-send waits for consent before calling the model; cancel restores the input. Session-only grants are not replayed during worker reconstruction or inherited by clones. Remembered grants are restored by upstream. Retired read-only, bypass and autopilot settings resolve to Ask in both management and actual workers. Explicit native tool deny/confirm overrides and Desktop's separate cross-session approval remain enforced.

Typecheck, production build and all 323 serial unit/protocol tests passed. Dedicated `verify-permission-tiers.mjs` acceptance uses actual pinned JSONL RPC with an isolated localhost provider: three-entry menu, no eager draft worker/history, first-send confirmation/cancellation, routine file write, hazardous-command denial in Approve for Me and execution in Full Access, clone isolation, session-only versus remembered relaunch behavior, renderer reload, Chinese/English and light/dark/narrow layouts. Its command-removal probe only removes a freshly created empty directory within the isolated fixture profile. Native tests additionally verify explicit deny/confirm overrides; mock-clock tests verify expiry and rejection of late responses.

General Electron, launch controls, new-session drafts, branching, turn undo, chain/workflow runtime, summary, permission approval, session concurrency, custom-provider and cross-session regressions passed locally. Branching was rerun after the final permission-lifecycle changes. Screenshots are `Desktop/test-results/permission-tiers-{menu-dark,risk-dark,risk-narrow,risk-light-en}.png`. This is source/local-fixture evidence, not paid-model, installer lifecycle or cloud CI acceptance. No installer, desktop shortcut update, commit, push or PR was produced in this turn.

The subsequent user-approved package is `Desktop/release/permission-tiers-20261012/`, still version 0.3.0 for local preview. Packaged permission-tier, general Electron and Goal/Plan/Ultracode launch acceptance passed against its unpacked executable. The package is based on merged main `b242667` plus this permission adaptation; unrelated unmerged workspace changes are not included. Its manifest, Node, Step bundle, management helper and session adapter match staging. Installer SHA256 is `d3cddac637599a586020f08e2d2b4130fcd9cd8e76c2f38ff8c43e44ed1fdd79`; `SHA256SUMS.txt` accompanies it. Authenticode status is `NotSigned`. The ordinary desktop shortcut targets this package with empty arguments; existing user windows remain on their previous executable until reopened.

Before adding the checksum file, this output totaled 729,084,241 bytes. Eight older outputs in this worktree were inventoried and retained without deletion; the user's live composer preview is in another worktree and was preserved. The separate upstream build is approximately 321 MB and staging approximately 125 MB. No paid-model, cloud-machine or installer lifecycle acceptance, upstream permission-policy edit or public release was performed. GitHub CI must still be checked on the submitted PR head.

## Goal Launch Controls

The 2026-10-12 source-only PR #98 follow-up scopes completion notifications to a transport-local run generation and records the notified generation. Delayed Goal callbacks cannot notify for an earlier run after a later run has started or finished, nor after worker disposal, disconnection or transport replacement. A regression reproduced two completion events from two successful iterations sharing a pending launch read before the fix. The corrected test covers all four terminal attention states, newer running/failed runs, process exit and replacement; successive ordinary runs still notify individually. Typecheck, build, 109 focused tests, actual pinned Goal RPC/SSE acceptance and general Electron acceptance passed locally. The package and desktop shortcut are unchanged; cloud CI remains a separate verification.

The PR #98 review follow-up reconciles both enabled and disabled draft launch choices when an empty resident worker is reused, without requiring unsupported mode commands for ordinary fresh drafts. Shared visible user-message classification includes Desktop Goal inputs in navigation, review turn numbers/timestamps, workflow and live-diff boundaries, context user counts/filtering and user arrival presentation. Internal continuation messages remain excluded from user boundaries. Background Goal completion/intervention notifications now recognize complete, blocked, usage-limited and budget-limited states after the authoritative asynchronous refresh, with no replay from history or duplicate end events.

Source typecheck/build and 107 focused tests passed, together with launch, workflow, Context/navigation and general Electron acceptance. Launch acceptance reuses the actual empty worker after arming Plan/Goal plus Ultracode and verifies that a new ordinary draft clears those choices without creating messages. The initial cloud CI failure at the post-send Plan composer assertion was a snapshot/render ordering race: the assertion now waits for the consumed badge to leave the composer and the settled pulse to appear, without relaxing the final assertion. These follow-ups are source-only; the prior local package and shortcut are unchanged. Replacement cloud CI results must be checked separately.

The replacement CI passed that Plan transition check but exposed a short-path alias in the new reuse fixture: Windows supplied `RUNNER~1` through Temp, while workspace connection canonicalized it to the long user path. The fixture now resolves its workspace with `realpath` before registering or reusing it, preserving the same-worker and disabled-mode assertions. Source launch acceptance passed after this fixture correction.

The completed-Goal isolation fix derives a completion owner from the upstream active history branch, without editing upstream data or runtime code. Visible Desktop Goal inputs receive exact saved entry IDs. Completed Goal controls remain on their owning response footer, never on a later task's pulse or footer; completed Goal Ultracode intent no longer becomes current-turn status. First completion ownership survives later completed-state edits. Missing/ambiguous owners fail closed instead of using the newest reply. Dedicated unit and actual pinned RPC/SSE acceptance cover completion followed by a normal running task, unchanged native complete state, absent inherited Ultracode status, preservation of the original footer and renderer reload.

The isolation package is `Desktop/release/launch-goal-isolation-20261011/`, local version 0.3.0. Typecheck/build and 17 focused Goal/history tests passed, as did source launch, workflow and general Electron acceptance. Packaged workflow and general Electron acceptance passed. Packaged launch acceptance timed out twice waiting for the completion marker after resume, then passed when rerun separately; failure-state diagnostics were added without weakening assertions. This does not establish that the intermittent timeout is resolved.

The full serial suite is not green: the existing terminal-count test fails during process-tree cleanup and leaves its runner waiting. A force-exit diagnostic reported 308/312 passes, including three Windows libuv file-runner aborts; those three files passed all 10 tests when rerun normally. Neither terminal implementation nor its tests were changed. This is focused regression evidence, not full release qualification.

Packaged manifest, Node, Step bundle and both helpers match staging; no runtime restaging occurred. Installer SHA256 is `53cc0b1f0202da76f47735e8554024801de6d3d6bfca14330a13b1464a4ba3d3`; the output totals 723,932,049 bytes. The ordinary desktop shortcut now targets the isolation package's unpacked executable with empty arguments. Existing user windows and older packages remain untouched. No paid-model or installer lifecycle test, upstream checkout edit, commit, push, PR or public release was performed.

The footer alignment correction places retained Goal and Ultracode controls in the final response's existing footer row rather than adding a separate row below it. Left-side copy/branch/timing controls retain hover/focus visibility; right-side status stays visible. Expanded Goal details remain open when pausing moves the entry from pulse to footer. No-renderable-response cases retain a standalone management fallback. Source workflow acceptance checks same-row vertical alignment, non-overlap, default hidden versus persistent visibility, hover reveal and light/dark/narrow layouts; existing timing and general Electron regression acceptance passed.

The corrected package is `Desktop/release/launch-footer-20261011/`, still local version 0.3.0. Typecheck/build, all 307 serial tests and source/packaged launch and workflow acceptance passed; packaged general Electron acceptance passed as well. The launch fixture verifies pause management survives reanchoring and Goal/footer geometry after entrance settles. Packaged runtime manifest, Node, Step bundle and both helpers match staging. Installer SHA256 is `5703536b6c676d970ef151f1590467630bc0746a46370f45faf57c59624624d3`. The ordinary desktop shortcut targets this unpacked executable with empty arguments. Output totals 723,925,372 bytes; six older previews were inventoried without deletion. The user's running `launch-pulse` window remains untouched. No upstream checkout edit, paid-model or installer lifecycle test, commit, push, PR or public release is included.

The Ultracode follow-up retains the current turn's workflow summary at the transcript right edge after the parent task ends. It uses the existing status symbols for reported completion, failure, interruption and budget exhaustion. Missing final state is explicitly unknown without a running summary icon. The same summary opens/closes the matching Orchestration inspector, does not arm the composer, and is removed for an unrelated new turn. Typecheck/build, all 307 serial tests and source launch/workflow/general Electron acceptance passed. These are isolated runtime/fixture checks, not new paid-model acceptance.

The updated local preview is `Desktop/release/launch-settled-20261011/`, version 0.3.0, including both the right-aligned Goal disclosure and Ultracode summary. Packaged launch, workflow and general Electron acceptance passed. Workflow coverage includes standalone summary positioning, reopen/close, all reported terminal outcomes, missing-final-state presentation, light/dark/narrow screenshots and unrelated-turn isolation. Packaged runtime manifest, Node, Step bundle and both helpers match staging. Installer SHA256 is `e56ef732e80c052cbd4884b4a76aec815daba20ae3873c6efb5c47693cd248a6`. The normal desktop shortcut targets this unpacked executable with empty arguments. The directory totals 723,923,947 bytes; five earlier outputs were inventoried and retained without deletion, including the live user's preceding `launch-pulse` build. No user process was stopped, upstream checkout changed, installer lifecycle tested, commit/push/PR made or public release published.

The subsequent source-only alignment adjustment keeps active status beside the working pulse and moves idle status to the transcript's right edge. Idle details unfold downward, right-aligned, without depending on hover-hidden assistant footer controls. Typecheck/build and source launch/workflow acceptance passed, including right-edge geometry in light/dark/narrow layouts and absence of an idle running dot. Geometry is sampled atomically to avoid mixing separate frames during layout transitions. This adjustment is not included in the previously packaged `launch-pulse-20261011` preview.

The subsequent pulse-layout follow-up separates pending composer choices from actual task state. Submission consumes pending choices; Goal management moves beside the working pulse. Its secondary surface unfolds downward inline, aligned to the trigger, with sampled intermediate entrance/exit heights and reduced-motion handling. Workflow progress retains its separate entry and existing Orchestration inspector. Paused and completed Goals retain a quiet access point.

Ultracode selections use the native per-turn `ultracode:` input convention rather than enabling standing session authorization. Only the exact Desktop two-newline prefix is removed from user-message presentation; original input and attachments remain in runtime history. FIFO entries capture their own opt-in, including edits and steering, without passing consent to later entries. Goal-plus-Ultracode retains opt-in in the native objective throughout that Goal, while presenting the original objective. Explicit standing slash commands remain supported and separately scoped.

Source typecheck/build, launch, workflow, real RPC/SSE concurrency and approval acceptance passed for this follow-up. Launch acceptance verifies actual pinned runtime Goal commands and a deterministic localhost provider, single-task consent, queue steering, original message presentation, and no inherited opt-in on the next task. These checks do not establish paid-model behavior or installer lifecycle acceptance. The separately maintained upstream checkout remains untouched.

All 307 serial tests and source general Electron/new-session acceptance passed. The local preview at `Desktop/release/launch-pulse-20261011/` passed packaged launch, workflow and general Electron acceptance. Packaged manifest, Node, Step bundle and both runtime helpers match staging. Installer SHA256 is `ea9ba6bf909cb2626b56d1d1a3035bb78ca08a59a6a0c73a6ea0c68e0c7babbc`. The ordinary desktop shortcut targets its unpacked executable with empty arguments. Its directory totals 723,922,526 bytes; four older outputs were inventoried without deletion. Existing user windows were preserved. Version remains 0.3.0 for local preview only; no commit, push, PR, public release or installer lifecycle test was performed.

The 2026-10-11 local preview adds optional Plan, Goal and Ultracode controls above the existing permission presets. There is no Normal mode. Draft selections create neither a runtime nor a session before sending. Plan and active Goal are mutually exclusive; enabling Plan pauses rather than clears an existing Goal, and leaving Plan never implicitly resumes it. Ultracode is independent. An adjacent compact status control opens anchored Goal management, including objective editing, pause/resume, clearing and token budget.

Controls use native runtime commands and active-branch Goal history; Desktop does not add a scheduler or modify the upstream checkout. Goal input and attachments are preserved through a Desktop-owned adapter command before native Goal continuation. Counters represent persisted upstream measurements. Active connected Goals keep their workers resident and suppress premature per-turn completion notices.

Typecheck, production build and all 304 serial tests passed. Dedicated isolated-profile acceptance uses the actual pinned RPC with a deterministic localhost SSE provider, verifying draft arming, image input, Goal start/pause/edit/budget/resume/completion/clear, Plan preservation, reload persistence, keyboard controls and light/dark/narrow layouts. Existing new-session and permission-approval acceptance also passed. These fixtures do not establish paid-model behavior, clean-machine installation or cloud CI success.

Runtime staging retains the already verified bundle pinned to `f7392089e67d80232b73c87f894dec8100c6c20a` with Node v24.15.0; the updated Desktop session adapter is copied into staging. The separately maintained upstream checkout is not changed or restaged from its newer HEAD.

General Electron, workflow and real RPC/SSE session-concurrency regression acceptance passed. The local package at `Desktop/release/goal-launch-20261011/` remains version 0.3.0 and is not a public release. Packaged general Electron acceptance passed; after replacing the Goal symbol with the library's flag-and-target icon, typecheck/build and source/packaged Goal acceptance passed again. Packaged manifest, Node, Step bundle and session adapter match staging. Installer SHA256 is `306421aba7561ce8f046a2ecbf9f65f541daa510511fbcf38afc1cbb9aa71963`.

The ordinary desktop shortcut targets this package's unpacked executable with empty arguments. The new directory totals 723,904,996 bytes; two previous local previews were inventoried and retained without deletion. Existing user windows were preserved and continue using their previous executable until reopened. No installer execution, paid-model acceptance, commit, push or PR was performed.

The initial preview's Ultracode confirmation parser recognized legacy Ultraloop notifications only. The pinned runtime uses Ultracode wording, so enabling succeeded upstream but falsely failed Desktop confirmation. The follow-up accepts both names and suppresses redundant informational notices without hiding warnings/errors. Unit fixtures now use the pinned runtime wording; real RPC acceptance additionally toggles Ultracode on/off in an existing session and checks both state and the absence of false error banners. The earlier draft-only Ultracode check did not cover this path.

The corrected local preview is `Desktop/release/goal-launch-ultracode-fix-20261011/`, installer SHA256 `b552bd11401b292acc423ce108ecc1d3aade94c617df0b983562b01b5d2baa06`. Typecheck/build, all 304 serial tests and source/packaged launch acceptance passed. Runtime hashes remain identical to staging. The normal desktop shortcut targets this corrected preview with empty arguments; the 723,905,400-byte output and three older previews were inventoried without deletion, and live user processes were preserved.

## Approval Bottom Drawer

The 2026-10-11 local preview uses a bottom-flush approval drawer covering the composer and performance footer, with no bottom border or gap. It defaults to a 240px compact view and expands to half the conversation viewport. Dragging follows the pointer and release snaps to either size; grip clicks and keyboard controls also select a size. Actions stay fixed while content scrolls. Enter/exit use 160ms/140ms cubic transitions, size snapping uses 180ms, and additional details fade in over 160ms. Reduced motion disables these transitions. The content scrollbar has a thumb only, with transparent track and no arrow buttons.

Approval presentation recovers only matching runtime/tool-call arguments, keeps credential redaction, and separates command, target, file edits and question previews from permission policy. Questions use normal prose with inline code; approve/reject answer previews use the same 16px green CircleCheck/red CircleX symbols as subagent status, without completion animation or status tooltips. Neutral answers are not classified as approval or denial. These are previews, not interactive answers. The question approval action is labelled Allow question and does not select an answer. Compact mode retains the actual operation, target and risk warnings; expanded mode adds answer descriptions, Agent explanation and parameter/approval disclosures. Optional preceding prose is not a safety verdict. Deferring preserves drafts and does not deny the operation. Permission grants and the upstream runtime are unchanged.

Deferring or pulling the drawer down temporarily turns the existing composer permission trigger into Review approval. After the 180ms entry, a background highlight flows across it every 4.8s; its tinted background, inset outline and solid accent text breathe on a 3.4s cycle without blinking, scaling or shifting layout. Hover preserves the moving background. Reduced motion disables both continuing and entry animation, leaving a static accent frame. Clicking or keyboard activation reopens the current request rather than opening the permission menu or changing the preset. Resolving the request restores the permission picker. The upper Review notice remains available. Drafts are preserved and the trigger remains available even when permission switching is unsupported.

The subsequent source-only polish colors the upper notice's leading triangle yellow, matching the interrupted subagent indicator in light and dark themes. The text and banner background stay unchanged. This expresses waiting for confirmation, not failure or a high-risk verdict. Dedicated acceptance checks both theme colors and reopening from the notice/composer context. This polish is not included in the existing local installer or desktop shortcut.

Typecheck, production build, all 289 serial tests, source approval acceptance and real RPC/SSE session-concurrency acceptance passed. The packaged executable passed approval, general Electron and real RPC/SSE session-concurrency acceptance with isolated profiles. Approval fixtures cover dark/light, English/Chinese, narrow layouts, grip dragging and snapping, keyboard size selection, compact/detail visibility, flush-bottom geometry, long content, defer/deny/approve and reduced motion. They also verify composer reopening after both defer and downward dismissal, keyboard reopening, restored permission controls, preserved draft and a visible review trigger at 360px width. Motion acceptance samples background position, inset outline and label color at two times after entry, verifies continuing infinite animations and unchanged dimensions, preserves the gradient on hover, and checks static reduced-motion rendering even on hover. Screenshots are `Desktop/test-results/permission-approval-*.png`, including question compact/expanded close-ups and deferred-entry views. These checks do not establish paid-model or installer lifecycle acceptance.

The primary workspace package is `Desktop/release/approval-review-motion-20261011/`, approximately 690.27 MiB. Installer SHA256 is `6AC0AE61289A11626167ED55602385D79A725DE85BF8D120EB28179C19163DF5`. Packaged manifest, Node, Step Code bundle and both Desktop runtime helpers match staged resources. Runtime remains pinned to `f7392089e67d80232b73c87f894dec8100c6c20a`, Node v24.15.0. The ordinary desktop shortcut targets this normal-mode preview, which predates the yellow-notice polish. The preceding entry preview remains in use by the user's running application. Five release directories total about 3.37 GiB and were inventoried without deletion. No public release or installer lifecycle qualification is included.

## Ultracode workflow presentation (2026-10-11)

The final source follow-up caps the workflow history menu at five fixed 33px rows, with internal scrolling for additional records and natural shrinkage for shorter lists. Other AppMenu consumers retain their existing layout. The 16-record Electron fixture measures the five-row content viewport after the opening transition, verifies scrolling, keyboard selection and focus restoration. Typecheck/build and workflow/approval acceptance were rerun. This five-row adjustment is source-only; the previously linked local installer retains its 320px menu.

The follow-up preview synchronizes to main `2203ecc`, including approval drawer PR #95 (`3a27a74`). Workflow history now occupies one 44px selector row, reusing AppMenu and DisclosureChevron. Sixteen-history fixture coverage checks a maximum 320px internally scrolling menu, keyboard selection, Escape focus return and preserving selection when new invocations arrive. The normal Chinese working pulse is now "正在阶跃"; pending approvals retain the separate awaiting-decision wording. Typecheck/build, all 294 serial tests, workflow and approval source/packaged acceptance and source real RPC/SSE concurrency acceptance passed. The updated local package is `Desktop/release/workflow-approval-latest-20261011/`, installer SHA256 `fbb037806c338493279a1a073913c4db5de9f85292ead26a317fc6630928537c`. Packaged runtime resources match staging, and the normal desktop shortcut targets this package with empty arguments. Its directory totals 723,843,571 bytes. The preceding 723,823,822-byte preview was inventoried and retained without deletion; running user applications were not stopped. No new real-model/cloud or installer lifecycle acceptance is claimed.

The workflow tool has a compact conversation entry and a clickable progress summary beside the working pulse. Both open the existing Subagent inspector in its Orchestration view; selecting an agent switches to Agent details. Returning to Orchestration preserves the overview scroll position. Clicking the same orchestration trigger closes it. The fixed Subagent rail button remains available after scrolling and after completion. Runtime-supplied phases are grouped; missing phases do not produce inferred dependency edges. The inspector can select earlier workflow invocations from the current conversation.

Presentation projects schema-versioned workflow progress fields and redacts credential-like task text. Final tool results retain the latest compatible per-agent snapshot through duplicate message lifecycle events. Missing final agent states become unknown rather than remaining active or assuming success. Reopening history reads only a bounded `progress.json` under the session workspace's validated workflow run directory in the main process; scripts and result-provided paths are not executed or followed. Missing files retain the workflow summary. Agent details expose task/state/timing/token metadata; this interface does not supply a complete agent transcript.

Typecheck, production build, 287 serial unit/protocol tests, workflow Electron acceptance, existing Subagent status acceptance and real RPC/SSE session-concurrency acceptance passed. A subsequent focused test covers terminal workflow results without final per-agent progress. Workflow fixture acceptance checks pulse/rail entry, same-anchor close, overview/agent navigation, final replacement, subsequent parent tools, history reload, light/narrow layouts and session isolation. The user's supplied completed workflow `wf_af9b15ceda8240f7` was read without mutation: all eight completed agents were recovered. This is presentation/history evidence, not a new paid-model or cloud-machine run. Screenshots are under `Desktop/test-results/workflow-*.png`.

The local preview package is `Desktop/release/workflow-inspector-20261011/`, still version 0.3.0 and not a published release. Packaged workflow and existing Subagent status acceptance passed; the packaged runtime manifest, Step bundle, Desktop helpers and terminal host hashes match staged resources. Installer SHA256: `0234cd50598fdc2d697c4ce080083ce690e6256c803db3577e07156a3da82d46`. The normal desktop shortcut points to this package with empty arguments. The package directory totals 723,823,822 bytes; only this candidate was retained in this worktree. Existing applications and prior packages elsewhere were left intact. Clean-machine installation and a new real-model workflow run remain unverified.

## Fixed Settings Window

The 2026-10-10 settings change is based on main `5778d3f`. All eight categories use one viewport-bounded shell; providers and archived sessions no longer resize it. The full titlebar sits behind a five-pixel blurred backdrop with a 12% black tint, never an ink-based white veil in dark mode. The form remains opaque. Navigation and content scroll independently, category changes retain navigation focus, and a matching 220ms exit keeps the background blocked until unmount. Reopening cancels pending dismissal and reduced motion dismisses immediately.

Typecheck, production build, all 279 serial unit/protocol tests, source custom-provider/settings-dialog/model-effort acceptance, and packaged custom-provider/settings-dialog/general Electron acceptance passed. The dedicated settings fixture is part of PR CI and covers stable geometry, provider editing, titlebar layering, dark/light tint equivalence, inert controls during exit, reopening, retained draft, Chinese/English, reduced motion, and no horizontal overflow at 800/640/480-pixel window widths. Screenshots are `Desktop/test-results/settings-fixed-*.png`. Provider checks use local fixtures, not paid services. Packaged main/preload and staged runtime resources match the current build.

Installer: `Desktop/release/settings-latest-main-20261010/Desktop for Step Code Setup 0.2.0.exe` in the primary workspace. SHA256: `BC655D2385DB33D807A301ABEB744C91EE01B70C07D491644BBBD41D7E651068`. Output totals 718,655,378 bytes. The ordinary desktop shortcut now targets this normal-mode package with empty arguments. Previous packages and running user applications remain untouched. The pinned upstream runtime baseline is unchanged; no upstream checkout edit, public release or installer lifecycle retest is included.

## Custom Provider Thinking Discovery

Cloud run `38028135174` passed staging, typecheck, unit tests, build and the preceding Electron fixtures, then failed the file-preview keyboard-focus assertion at line 212. That fixture pressed ArrowDown as soon as the menu became visible, before the AppMenu requestAnimationFrame focus was guaranteed to run. It now waits for real menu focus and asserts the next enabled item receives focus after ArrowDown; the original membership assertion remains. Two consecutive local file-preview runs passed. Product menu behavior and all CI gates are unchanged; a replacement cloud run must establish the final result.

The PR #86 P2 follow-up clears withdrawn upstream thinking controls and cached declarations during model refresh, including explicit `reasoning: false` responses, while preserving manual and legacy overrides independently of the new declaration. Model-selection events now decorate their emitted runtime state just like full snapshots, so applying an unknown-control model does not replace service-default presentation with a raw `off` state. New regression tests reproduced both defects before the fixes. The discovery tests cover absent, false and changed declarations plus runtime projection; the Electron fixture captures both selection/application events without a snapshot refresh and checks the service-default picker across all three protocols. Typecheck, build, all 278 serial tests, custom-provider Electron acceptance and model-switch acceptance passed locally. Replacement cloud CI is verified separately.

The 2026-10-10 Desktop-only change discovers explicit `thinking_levels`, `supported_reasoning_efforts`, and nested `effort.supported_levels` declarations from a custom provider's model list. A nested `effort.default_level` is retained only when it belongs to the declared levels. Display names accept `display_name` or `name`. Refreshing an existing model updates declarations without duplicating the model or replacing its custom name or manual thinking override. No model-name inference or official-provider registry is included.

The original compact model editor keeps thinking status beside the collapsed capabilities summary. Thinking control provenance is independent of general model metadata: upstream declarations and manual/unverified configurations remain distinct. Unknown controls use the service default, expose no selectable effort levels, and send no invented thinking parameters. Manual controls support explicit UI-level to request-value mappings. Anthropic adaptive thinking requires explicit confirmation; budget-based controls are not implemented. Changing API format clears incompatible controls. Legacy explicit level lists remain manual/unverified.

This branch is based on main `549a6df` and preserves its endpoint-scoped no-auth adapter and next-turn model selection. No upstream checkout or runtime implementation was edited. Validation used the staged upstream `39ec6e0adeca09d50c8897023ea4e471371634cd` baseline. Typecheck, build, all 276 serial unit/protocol tests, custom-provider Electron acceptance, model-effort acceptance and model-switch acceptance passed locally.

The extended custom-provider acceptance uses temporary profiles, local HTTP fixtures, real Electron IPC and real RPC requests. It checks discovery defaults, metadata refresh, unknown controls and mapped values across all three protocols, explicit Anthropic adaptive configuration, and the existing authenticated/keyless generation and tool-call assertions. Screenshots include `Desktop/test-results/provider-thinking-declared.png`, `provider-thinking-unknown.png`, and `provider-thinking-manual.png`. This is fixture acceptance, not a successful live DeepSeek account query or paid-provider capability certification. Earlier primary-workspace preview packages are not the installer for this latest-main integration; no new installer or public release is part of this PR.
## Right Panel Grip Preview

The PR #85 P1 follow-up separates local artifact reactivation from explicit browser refresh. Reactivation selects the existing tab without navigation; the refresh handler renews the local-page grant and requests a reload of that same tab. Source typecheck/build and the extended file-preview acceptance passed, verifying edited HTML, a newly added local JavaScript asset, reset page state after refresh, retained tab identity, and unchanged state preservation on reactivation. The previously delivered installer predates this follow-up.

The 2026-10-10 preview adds artifact/web-reference toggle behavior and a shared boundary grip using the existing width presets. Source typecheck, build, 272 serial unit/protocol tests, and file-preview, browser, terminal and context Electron acceptance passed. Extended fixtures cover multi-preset pointer dragging, deliberate drag-to-close, keyboard and anchored menu selection, native browser/menu layering, preservation of the existing terminal ID and local HTML page state, repeated artifact/web-reference toggles, and refresh remaining a command. Screenshots include `Desktop/test-results/panel-handle-standard.png` and `panel-handle-fullscreen.png`. Fixtures use isolated profiles, not real account histories. No upstream runtime changes or public release are included.

General source Electron acceptance and packaged file-preview/browser acceptance also passed. The local installer is `Desktop/release/right-panel-handle-20261010/Desktop for Step Code Setup 0.2.0.exe` in the primary workspace, SHA256 `D6D1763AF621CFC385E119CCA023D73360E232930A8E2C6463A6CA13706F2B5F`. The normal desktop shortcut targets this package's unpacked executable. Packaged Node, Step bundle, manifest and Desktop helper hashes match the staged resources. Output totals 718,670,088 bytes. Existing applications and older packages were left untouched. Installer lifecycle and paid-provider acceptance were not repeated.

## Deferred Model Selection

Cloud run `38013712253` passed staging, tests, build and the preceding Electron fixtures, then the permission-approval script exited without an assertion trace or its screenshots. The exact exit cause is not established. Its isolated profile now uses a canonical path and it logs stages, errors and unexpected Electron exits; a test-only quit-dialog response is installed before fixtures. All original approval assertions remain. Three consecutive local approval runs passed; replacement CI is required to confirm cloud status.

The PR #84 review follow-up routes busy peer-session sends through the existing Desktop FIFO queue, so its before-prompt hook applies a pending model at the next fresh task boundary instead of letting the upstream follow-up queue bypass it. Copied sessions and reply/user-point branches inherit independent copies of confirmed model-change observations, with visible timestamps retaining path filtering; pending transitions are not copied. Typecheck, build and 272 serial tests passed, including FIFO/model preparation and sidecar-copy isolation. Real RPC/SSE model-switch acceptance verifies whole-session copies and reply branches retain visible notes after reload. The cross-session fixture additionally checks the queued peer request uses the selected model. This follow-up does not replace the local preview package; cloud checks are reported separately.

The 2026-10-10 Desktop-only change keeps model and thinking controls available during a task. A per-worker selection is applied before a fresh prompt, including Desktop FIFO dispatch, but never during an active task or steering. Returning to the original configuration cancels the pending selection. Idle selections still apply immediately. Pending choices survive renderer reload and navigation while the worker remains resident; pending workers are not recycled. Unapplied choices are not persisted across application shutdown.

Confirmed model switches are client-owned sidecar observations anchored to the authoritative user message timestamp. They are not Step messages, tool calls, copied assistant prose, or model context. The expected prompt is matched by hash so internal user-role reminders cannot consume the record; sidecars do not store prompt text. Before consumption, repeated idle changes collapse into one transition, or no record if the original model is restored. Completed records survive history reload and application restart. Branches render only observations anchored to the visible path. Initial draft configuration is not a switch: records require previous visible assistant history.

`verify-model-switch.mjs` uses a fresh profile, local streaming HTTP fixtures and actual RPC. It verifies the enabled picker, pending status, thinking selection, cancellation, renderer reload, navigation, old-model steering, new-model FIFO dispatch, one client record, light/dark/narrow layouts and absence of the notice from upstream JSONL and request context. Tests also cover rejected switches, retry, effort-only changes, upstream busy guards, sidecar reopening and capability maps. Typecheck, build and all 270 serial tests passed locally. Model-picker, send-queue, general Electron, navigation, concurrency, custom-provider and hidden-message acceptances passed. This does not establish real-provider acceptance or cloud CI status.

The supplier focus-gutter acceptance exposed a fractional-DPI measurement error: `clientHeight` rounded a 539.33px viewport to 539px, falsely rejecting a fully visible 4px focus outline by 0.33px. Its measurement now uses fractional bounding edges while subtracting scrollbar extents, retaining the containment assertions and adding failure geometry diagnostics. No provider UI or assertion tolerance was changed.

The final local 0.2.0 preview at `Desktop/release/model-switch-preview-20261010/` passed packaged model-switch acceptance, including full application restart, and general Electron acceptance. Installer SHA-256 is `6ae1dd82e0659ca524e4f9b7e7c48aa8449daf77a3716a559e903c28277f6d4e`; the installer is 152155165 bytes and the preview directory totals about 685.3 MiB. Packaged manifest, Node, Step Code bundle and both Desktop helpers match staged resources. Runtime remains pinned to `39ec6e0adeca09d50c8897023ea4e471371634cd`, without upstream edits. The ordinary desktop shortcut targets this preview; the user's running old application and other packages were preserved. No installer lifecycle test, paid-provider acceptance, commit, push or public release was performed.

The subsequent source-only pending-layout fix reproduces a defect in that preview: the pending notice became a third grid child, squeezing model information into the 88px fader column and pushing the fader 138px below the popover. The notice now lives inside the positioned model heading, preserving the two-column grid. A new geometry assertion fails against the shipped preview and passes against the repaired source; typecheck, build, model-switch and model-effort acceptances passed. This fix has not yet replaced the package or shortcut above.

The subsequent local package at `Desktop/release/model-switch-layout-fix-20261010/` includes the pending-layout fix and passed packaged model-switch geometry/behavior and general Electron acceptance. Installer SHA-256 is `d0063f6766f8749109643f52a4aabd664dda76a9ae6a811c69cd533324d69584`; the installer is 152155237 bytes and the directory totals about 685.3 MiB. Manifest, Node, Step Code bundle and both Desktop helpers match the staged runtime. The normal desktop shortcut now targets this corrected package. The running previous package and historical build directories remain untouched; no installer lifecycle or paid-provider acceptance was performed.

## Hidden Runtime Messages

The 2026-10-10 Desktop-only fix honors the upstream `display: false` marker when grouping conversation turns and projecting response content, including copied text and the shared subagent transcript renderer. Original message arrays, source indices, entry IDs and background-lane lifecycle records remain intact. Explicitly visible extension notices and legacy messages without the marker retain their existing presentation. This addresses the `ultraloop-discovery` capability notice shown before the assistant's reply; it does not redact arbitrary prose generated by the model.

`verify-hidden-messages.mjs` uses a temporary Electron profile and injected IPC records, not a paid model request. It checks live start/update/end events, absence of empty hidden-only responses, visible extension notices, copied text, child transcript filtering, hidden lane completion events and history reload. The dedicated Electron check, background-subagent acceptance, message-order acceptance, typecheck and production build passed locally. The fixture is included in CI. No upstream runtime edits, personal-history mutations, package replacement or PR publication are part of this change.

General Electron acceptance and the full serial test rerun passed (261 tests). The first full run failed and remained alive at the unchanged terminal count-limit test; only that verified test process tree was terminated before rerunning, without editing terminal code or interrupting the user's application.

The PR #83 P2 follow-up excludes hidden messages from the child transcript-presence check. The Electron fixture verifies a failed child with only its user task and hidden discovery record shows the localized empty state, both live and after reload. Cloud run `38005007240` passed this fixture but exited at artifact acceptance without an assertion trace or artifact screenshots. That acceptance now canonicalizes its temporary profile, avoids invisible quit confirmation in its isolated window, and logs stages and unexpected process exits; all original assertions remain. Three consecutive local artifact checks passed. The initial cloud exit's root cause is not established; replacement CI must be checked separately.

## Chained Subagent Runtime Upgrade

The PR #81 review follow-up preserves queued steps when a background lane reports `running`; the active step still inherits lane lifecycle, and previously settled records remain unchanged. Projection regression checks cover initial background dispatch and partial per-step results. Concurrency and cross-session HTTP fixtures locate their explicit task/peer messages instead of the upstream discovery reminder. Typecheck, build, presentation tests and both real-RPC acceptance scripts passed locally; replacement cloud CI is checked separately.

The 2026-10-10 source integration pins Step Code to `39ec6e0adeca09d50c8897023ea4e471371634cd`, the merge of upstream PR #227 addressing Issue #220. The existing Desktop integration patch is rebased without changing its credential, RPC or bundle behavior. The patch applier succeeds against a fresh checkout of that exact commit; runtime staging and CI assert the same baseline. The original user-owned upstream checkout, staged runtime and running application remain untouched.

Desktop accepts `queued` and `skipped` result records. Planned chain steps after the first start as pending rather than falsely running; settled completed/failed/skipped records survive projection. Skipped uses a neutral circle-minus icon and the shared application tooltip explaining that the chain stopped before this step executed.

`verify-chain-runtime.mjs` uses a temporary Desktop profile, a local HTTP model fixture, real Electron IPC, the staged RPC worker and actual subagent children. It verifies three-step output propagation, final-step content delivered to the parent, middle-step failure with a skipped third step, and cancellation during the second step with completed/aborted/skipped results and no residual streaming state. It is included in CI. The upstream chain-result suite passed eight tests. This is real-runtime fixture acceptance, not paid-model or real-account acceptance.

Typecheck, all 259 serial unit/protocol tests and production build passed. General Electron, auth-vault, account settings, custom providers (three protocols with and without authentication and real tool invocation), Summary, background subagents and send-queue acceptance passed against the upgraded runtime. Provider and queue fixtures locate the actual user task rather than treating the new upstream Ultracode system reminder as a user request; their execution and FIFO assertions remain intact.

The local `chain-runtime-preview-20261010` package passed general Electron and all three chain-runtime scenarios. Packaged manifest, Node, Step bundle and Desktop helpers match staging. Installer SHA256 is `dff0a769a06760b69ca34b1abfe4df652c2e8c38b263605ec6e9202ec3b5bdef`; the ordinary desktop shortcut targets this preview. A user-run Step model session also completed a three-step planner chain: saved records confirm full previous-output substitution at both boundaries, final-step text returned to the parent, zero child exit codes and settled records without pending replies. Real-model failure/cancellation and installer lifecycle remain unverified. No public release or upstream feature reimplementation is included.

## Status Icons and Secondary Descriptions

The 2026-10-09 Desktop-only follow-up separates semantic status colors from the brand accent: completion uses green, failure uses red, and interruption uses a yellow warning triangle. Subagent rows and the right-side transcript share the existing shrink/hold/grow/draw animation. Task-plan projection accepts explicitly reported `failed` records without inferring task failure from individual tool errors; the current pinned upstream does not yet emit that task-plan state.

Status icons have an application-rendered secondary tooltip with a localized title and explanation. It supports pointer entry into the description, keyboard focus on the existing row control or standalone icon, Escape dismissal, scroll/resize dismissal, viewport bounds, entry/exit motion and reduced motion. Provider diagnostics supply their own safe outcome description. No upstream runtime upgrade is included.

The local `status-tooltip-preview-20261009` package passed packaged status acceptance and the isolated replay demo. Installer SHA256 is `11323b6415407ad5c999450843ff5d947e11cfca0d4f015e74ac4f11d75462b8`. The demo is a development script (`node scripts/run-status-demo.mjs <packaged-executable>`), requires the development Playwright dependency, and intercepts IPC in a fresh temporary profile; it never sends a paid model request or changes normal session history. This is local preview evidence, not a public release or clean-machine acceptance claim.

For the current first-release gates and candidate status, see [RELEASE.md](RELEASE.md). This document preserves historical feature evidence; different preview packages and source-only checks do not collectively qualify one final installer.

## Session Navigation and Browser Close

The PR #79 review follow-up removes a disconnected resident worker before preparing its saved history again. Dedicated navigation acceptance terminates only Step RPC children owned by its isolated Electron main process (excluding the management helper), observes the actual exit event, switches away and reopens the history, and verifies a new runtime identity with the old worker removed. The CI Summary fixture now waits for confirmed navigation and explicitly opens Summary, matching the navigation rule that closes the prior right panel. Typecheck, build, navigation recovery and real-runtime Summary acceptance passed locally; replacement cloud CI is verified separately.

The 2026-10-09 Desktop-only fix prepares cold histories without activating them, serializes navigation and commits only the latest requested target. The selected sidebar row and window title update immediately; they are not completion signals. Recently viewed transcripts can appear from a detached, inert cache bounded to six sessions and an estimated 12 MiB of serialized UTF-16 data. Runtime controls and approvals are never restored from that cache. Catalog changes and background message/tool events invalidate cached readings. Drafts, quotes, attachments and stable message-relative reading anchors survive navigation and idle-worker recycling; pointer, wheel and keyboard interaction cancel pending reading restoration, including the external scrollbar.

The delayed sidebar loading ring has a fixed 12px square instead of inheriting title-span flex growth. Browser close keeps the shared cubic layout-reservation transition while hiding the opaque native webpage immediately. Replacement by another right panel still releases the outgoing reservation immediately. Browser acceptance samples intermediate Standard/Wide close widths and checks the final restored reservation.

An isolated PR worktree based on main `14b1ca2` retains the merged supplier/no-auth adapter. Typecheck, production build, 257 serial unit/protocol tests, general Electron, dedicated session navigation, browser, concurrent-session, archived-session, branching, sidebar ordering, new-session and cross-session acceptance passed locally. General/archived/concurrency checks wait for the confirmed transcript and enabled composer rather than just the optimistic title. The image-menu check completes Playwright's image scrolling before opening its scroll-dismissed menu. These changes preserve existing assertions and runtime operation guards. One full-suite attempt had a provider test-process failure; that file passed separately and the subsequent complete serial run passed all 257 tests. Sidebar acceptance also exited during its restart launch on one attempt without a reported assertion; its standalone rerun passed unchanged.

The previously delivered local preview at `Desktop/release/session-spinner-fix-preview-20261009/` passed packaged navigation/spinner and browser checks. Its installer SHA256 is `2508607f322f8de8653f72a9fc9f4e3273da1aa7c8256fd319c32ede55f1b16e`; the normal desktop shortcut remains unchanged during PR preparation. That preview predates the isolated latest-main integration and final acceptance refinements, so it is not evidence for every PR change. No upstream checkout/runtime edits, real-profile mutation, paid-provider request, installer lifecycle qualification or new public release is part of this fix. Cloud CI is separate from these local results.

## Account Settings Split

### Thinking Levels After Authentication

The 2026-10-10 source-only fix refreshes the proposed session's model options after login/logout, retaining its identity, selected project, permission choice and unsent composer text without creating an agent or history. Explicitly selected models are resolved from the refreshed catalog rather than retaining the previous model object's stale capability fields. Supported manual effort choices survive; unsupported choices fall back to an available level. The renderer installs a fresh snapshot after every successful login, including independent mode, instead of conditionally restarting a project worker.

Account acceptance starts with a fixture Step Plan credential and an empty capability state, makes a local Step catalog available, and completes the actual API-key login path. It checks the new levels in the snapshot and visible fader, keyboard selection, retained draft, no eager session creation, refreshed metadata for a selected model and signed-out catalog removal. Native quit confirmation is intercepted only in this isolated fixture. Screenshot: `Desktop/test-results/account-thinking-after-login.png`. Typecheck, production build, 258 serial unit/protocol tests and account, general Electron, new-session and auth-vault acceptance passed. This validates the shared Desktop authentication/proposal path, not a real Step Plan browser OAuth exchange or live model discovery; TODO remains open until packaged real-account acceptance. No upstream checkout/runtime changes or paid-model requests were made.

The subsequent local normal-mode package at `Desktop/release/plan-thinking-fix-preview-20261010/` passed packaged account-settings, new-session, auth-vault and general Electron acceptance with isolated profiles. The package uses a private copy of the previously staged runtime and the current Desktop helpers. A dependency-free application staging manifest packages the already bundled `dist` output, avoiding dependency collection through the worktree's shared `node_modules` junction; native terminal and runtime resources retain the existing packaging configuration. Packaged Node, Step bundle, manifest, both helpers, terminal host and keyless adapter match staging. Installer SHA256 is `c395f86915961473b77f6dc2aea645ec05ab31e9275e8a9dc9c8bff111a4c47e`; the output directory totals 686,699,579 bytes. The ordinary desktop shortcut targets its unpacked executable with no demo arguments. The user's existing application and profile were preserved, and older outputs were inventoried without deletion.

This preview remains version 0.2.0, not a public release. Real-account acceptance remains pending: on an independent proposed-session page, log out and log in through Step Plan without opening a project or sending a message, verify visible/selectable thinking levels, then relaunch and check again. Local fixture success does not establish real OAuth/model discovery or installer lifecycle acceptance.

On 2026-10-10 the user confirmed the packaged real Step Plan test passed and accepted this P0 as resolved. This supersedes the pending real-account status above, but does not establish installer lifecycle acceptance. That tested preview uses upstream `519e4de4`; PR #81's planned `39ec6e0a` runtime update was still open at confirmation, so integration and regression on that newer baseline remain separate work before this fix PR is opened.

After PR #81 merged, the fix was rebased onto main `17aed88` and its private staged runtime updated from the verified `chain-runtime-preview-20261010` resources, with manifest and resource hashes checked. The upstream baseline is now `39ec6e0adeca09d50c8897023ea4e471371634cd`. Typecheck, build and all 259 serial unit/protocol tests passed, as did source and packaged account-settings, new-session, auth-vault, general Electron and real-chain-runtime acceptance. Chain acceptance verifies output propagation, failure/skipped steps and cancellation against local HTTP fixtures, not a paid provider.

The combined normal-mode preview is `Desktop/release/plan-thinking-main-preview-20261010/`, and the ordinary desktop shortcut now targets its unpacked executable without demo arguments. Installer SHA256 is `f72944ada229570ef1094edb3689c12652b61682c3e2c8136dc9cc75639bb6b4`; its output directory totals 692,407,525 bytes. Packaged Node, Step bundle, manifest, Desktop helpers, terminal host and keyless adapter match staging. This supersedes the older package for local use. The existing running application, user profile and upstream checkout remain untouched; 31 release directories were inventoried without deletion. The earlier user real-account confirmation applies to the older runtime preview, while this combined package has separate isolated regression evidence. Cloud CI and installer lifecycle qualification are not inferred from these local results.

The PR #82 P2 follow-up preserves the application flag for the refreshed selected model's effective thinking level. A removed manual effort no longer leaves the proposal displaying a fallback that is never applied to the created worker. Models without a thinking level keep the flag false. The account fixture now selects a non-default local model, removes its manual `high` level during authentication refresh, and verifies the proposal fallback (`low`), created RPC worker and first actual HTTP request all agree. Before the fix, the created worker reproduced `xhigh` instead of the displayed `low`. The successful request/reply uses a local custom provider and explicit reply-content polling, not an upstream startup reminder as a completion signal.

Typecheck, build, account, new-session and general Electron acceptance and all 259 serial unit/protocol tests passed locally after this follow-up. The first full-suite attempt failed terminal process-tree cleanup and left its test child open; only that verified test child was stopped, the unchanged terminal file passed standalone, and the subsequent complete serial suite passed. No terminal assertions or implementation were changed. This follow-up is source-only and is not included in the combined preview above; replacement cloud CI is tracked separately.

### Custom Providers Follow-Up

The PR #78 review follow-up adds a Desktop-owned no-auth request adapter without modifying the upstream checkout or staged Step bundle. Enabled keyless providers retain an internal endpoint-specific sentinel only to satisfy the SDK's credential requirement; the adapter removes its Authorization/x-api-key headers before network transmission, matching both origin and base-path boundary and leaving real credentials and other destinations untouched. It retains the runtime's replacement Undici transport, response streaming, timeout/proxy setup and cancellation. The helper is preloaded only when an enabled keyless provider exists, uses a quoted forward-slash path for Windows, and is copied outside app.asar so the standalone Node runtime can load it. Saved keys remain encrypted and are restored when keyless mode is disabled.

Typecheck, production build and 249 serial unit/protocol tests passed. New tests cover scoped header removal, ordinary credentials, Request bodies/cancellation, transport replacement and real Node children loading from spaced paths. The supplier fixture rejects any authentication header in keyless mode and verifies discovery, diagnostics and successful runtime streaming for all three protocols, followed by restoration of the saved credential. Crash-log migration acceptance now waits for an enabled composer and initialized proposed session rather than the animated heading, retaining vault byte-equality, plaintext removal and genuine conflict-log assertions. Supplier and crash-log acceptance passed locally; replacement CI remains separately tracked on the PR. The ordinary desktop shortcut and existing installer were not updated by this review follow-up.

The final 2026-10-09 local preview is `Desktop/release/provider-gradient-preview-20261009/`, superseding the earlier package and source-only statuses below. The upper-left provider silhouette fades from brighter upper-left to transparent lower-right in both themes. Installer SHA256 is `86475d5f0955aec1c96d06e704d5a14be2706f305387fe125b6490534b56501f`; the ordinary desktop shortcut targets this package. Typecheck, production build, 245 serial unit/protocol tests, model-fader/brand acceptance and packaged supplier, subagent-status and general Electron acceptance passed. Packaged Node, Step bundle, manifest, Desktop helpers and terminal host match staging; the admin helper also matches source. The preview remains version 0.2.0 and is not a new public release. Older packages were inventoried and retained, and the running user application was not stopped.

This iteration retains the existing Step account integration and adds custom protocol configuration only. Other vendors' official presets and vendor-specific compatibility adaptations are deferred. Discovery consumes explicit metadata rather than guessing from model names, and a successful connection diagnostic does not establish streaming, reasoning, multimodal or tool compatibility with a commercial provider. No upstream Step checkout changes, paid-provider requests or installer lifecycle acceptance were performed.

The source-only provider-mark/focus follow-up adds a subdued upper-left brand mark inside the existing model heading, preserving the centered model/effort text and existing parameter flip. Canonical Step providers use the existing five-square StepFun asset; other providers use a neutral Sparkles mark, never brand inference from model names or custom endpoints. The account and model panels share the same Step mark. Supplier editor scroll content now reserves 4px focus-ring gutters, including expanded model details, and scroll padding/margins keep focused inputs clear of the viewport bottom. Typecheck/build, model-fader/mark, supplier/focus and account Electron checks passed with isolated fixtures. Focus assertions cover all four sides for Base URL, model ID and context capacity. Screenshots are `model-provider-{step,custom}-{dark,light}.png` and `provider-focus-{url,model,capacity}.png`. No replacement installer or shortcut update was made for this follow-up.

The connection diagnostic adds a right-aligned Test Connection action beside Save. It sends one short non-streaming text request using the current unsaved endpoint/protocol/key and a selected configured model, without saving configuration, invoking agent tools, starting a conversation or modifying history. The result expands/collapses in place with cubic easing, shows elapsed time and HTTP status, supports cancellation and an application-rendered model menu, and includes optional details and a copyable allowlisted diagnostic summary. Closing settings cancels an active test. HTTP 200 alone is not success: the selected protocol must return structured assistant text; Responses also requires completed status.

Diagnostics reuse the Subagent/plan status component at the same fixed 18px slot and 16px artwork. Running-to-success retains the 660ms cubic shrink/hold/grow/check sequence and brand color. Running-to-failure now uses the same sequence with a red circle and two sequential cross strokes. Static failed history does not animate; interrupted transitions are cancelled and reduced motion switches immediately. The isolated status fixture checks the failure contraction/hold and both intermediate drawing strokes. Both supplier/diagnostic and status fixtures passed against the packaged executable.

The preview package is `Desktop/release/provider-diagnostic-preview-20261009/`; installer SHA256 is `2e3d191c623011a76284b7f26c765069064169f48c48b5a4a38997d802f6efd7`. The normal desktop shortcut points to its unpacked executable. This local test build remains version 0.2.0, is not a published release or PR, and uses the previously staged Step bundle. Generated artifacts were inventoried (approximately 748 MB including installer and unpacked application); older packages were retained pending explicit cleanup authorization. Installer lifecycle and commercial-provider acceptance were not performed.

The Electron main process owns requests, resolves encrypted saved keys when the input is blank, prevents concurrent tests, rejects redirects, enforces a 30-second deadline and bounds response bodies at 1 MiB. Provider response text, error bodies, headers and keys are not rendered or copied. Custom URL path segments are omitted from the diagnostic endpoint. Distinct results cover authentication, not found, rate limits, other HTTP errors, invalid/empty replies, timeout, cancellation, network and invalid configuration. This tests only basic non-streaming connectivity; streaming, tool use, image input, reasoning support and vendor-specific compatibility are not validated by a passing diagnostic.

Typecheck, production build and all 245 serial unit/protocol tests passed. The isolated supplier Electron fixture covers unsaved diagnostics without persistence/history changes, all three protocols, authentication failure, cancellation, redacted presentation, dark and 640px layouts. Screenshots are `provider-diagnostic-{dark,narrow}.png`. No paid-provider request or personal-profile change was made.

The 2026-10-09 model-parameter preview package is `Desktop/release/model-parameters-preview-20261009/`. Its installer SHA256 is `3ea437a93fbf29ad815eb5b37139788db3aa0e3a0f9109f5331231d46686953c`; the normal desktop shortcut targets its unpacked executable. The lower composer slot previews modality icons and compact context capacity, then flips into parameter details and back using cubic transitions. Source fader acceptance and packaged custom-provider acceptance passed, including explicit capability import, unavailable audio, restricted effort levels and actual reasoning parameter transmission. The packaged Desktop admin adapter hash matches source and staging. This supersedes the preceding source-only status for the parameter follow-up; installer lifecycle and commercial-provider acceptance remain untested. Previous packages were retained, not deleted.

The model-parameter follow-up imports only explicit upstream modality lists, boolean reasoning support, declared effort lists and bounded token limits. Known metadata aliases include `architecture.input_modalities`, `context_length` and `supported_reasoning_efforts`; model names never establish capabilities. Missing fields retain configurable defaults. Audio/video/file declarations and image output are informational only: the existing runtime accepts text/image input and text output. Per-model supported effort checkboxes project a `thinkingLevelMap`, with unsupported levels set to null. The composer parameter entry replaces the reserved lower slot and opens an anchored, fixed-size parameter view with cubic transitions and reduced-motion support. The Desktop-owned admin DTO also exposes runtime input and capacity; no upstream Step source or bundle is changed.

Typecheck, production build, all 244 unit/protocol tests, fader/parameter Electron acceptance and custom-provider Electron acceptance passed. The provider fixture imports text/image/audio declarations, verifies audio is unavailable, restricts levels to off/low/high, rejects xhigh and confirms the actual Chat Completions request carries `reasoning_effort: high`. Screenshots include `model-effort-parameters-{dark,light}.png` and `custom-model-parameters.png`. This follow-up is source-only and is not included in the preceding custom-provider preview installer. It does not establish commercial-provider reasoning compatibility or capability enforcement for every model.

Model discovery adds an explicit GET to the configured base URL's `/models` endpoint in the main process. It supports bearer authentication for both OpenAI formats and `x-api-key`/`anthropic-version` for Anthropic, including unsaved keys and encrypted saved keys. Redirects are rejected; requests have a 15-second timeout and a 2 MiB response limit. Only model IDs and display names are imported; capabilities and capacity remain user-confirmed defaults. The first response page is supported; provider-specific pagination and nonstandard discovery endpoints are not implemented. Discovery is read-only until the user selects models and saves the provider. Six focused provider tests passed, including literal credentials, duplicate/invalid entries, failed responses and redirects. The Electron fixture now obtains its initial model through discovery and selection before exercising actual runtime generation. This is local fixture validation, not commercial-provider acceptance.

The 2026-10-09 Desktop-only implementation replaces the provider placeholder with a supplier list and editor. It supports custom Chat Completions, Responses and Anthropic Messages endpoints, explicit save, enable/disable, removal confirmation and manually declared models. Model names, reasoning/image support and token limits are configurable; this does not discover or verify capabilities automatically. Pricing is not configured in this first iteration: sessions containing custom-model replies show unknown estimated fees, not upstream zero-rate estimates as if usage were free. Advanced model fields are collapsed by default, the protocol menu uses the existing application-rendered menu and DisclosureChevron, and the editor scrolls independently with a visible save footer.

Provider definitions and keys are stored in the desktop encrypted vault. Only a non-secret model projection is written to Desktop-owned `models.json`; unrelated provider entries are preserved. Saved keys are never returned to the renderer. Desktop metadata is removed from child credentials, and custom keys are escaped so upstream command/environment syntax cannot reinterpret literal key text. Step account login/logout retains custom-provider state. Provider edits require all sessions to be idle, with no pending queue; workers are reloaded after saving rather than changing an in-flight request. The current conversation and permission selection are preserved. Vault state is authoritative and the model projection is regenerated on launch; uninstalling the credential vault also removes these saved provider definitions.

Source checks include typecheck, production build and 242 unit/protocol tests. The dedicated isolated Electron fixture verifies configuration, rejected saves, encrypted persistence, rename/relaunch, no-Step-login generation, three local HTTP wire protocols, a real runtime task-list tool call through Chat Completions, mutation blocking during a streamed reply, disable/removal and light/dark/640px layouts. Its keys and services are fixtures, not commercial-provider acceptance. Account, auth-vault and general Electron regression checks also passed. No upstream checkout/runtime changes, real-user profile mutation, paid-provider requests, installer or PR are part of this implementation. Screenshots are `Desktop/test-results/custom-providers-*.png`.

The 2026-10-07 change separates Account and Providers in Settings. Account uses the supplied StepFun platform mark and four channel tiles for mainland/international Plan and API Key. Providers uses the same 17px, 2px outline icon convention as the other navigation entries and a noninteractive custom-provider placeholder. The management adapter exposes credential validity and an actual stored UID only when it matches the active account identity; the upstream profile fallback is not displayed as a user ID. Credential contents do not cross this settings DTO. Display name, avatar, plan tier, allowance and API balance are not supplied by current runtime interfaces and remain unavailable rather than inferred.

Source and packaged account-settings and auth-vault Electron acceptance passed using isolated fixture profiles. Checks cover UID projection, channel/key reset, API login/logout, encrypted persistence, themes, 640px layout, English and reduced motion. The preview package is `Desktop/release/account-settings-preview/`; its installer SHA256 is `a83f02d4c1e81112a1121aae73c3080be860278a01d8be95a62de960cdb5255a`. The normal desktop shortcut targets its unpacked executable. The package includes local work present at packaging time; the PR contains only the account change. Fake keys do not establish real-account authorization. Installer lifecycle and paid-model acceptance were not performed.

The isolated PR checkout based on main `64cfadb` passed typecheck, build, account-settings and general Electron acceptance, plus 202 tests excluding `terminal-sessions.test.ts`. The unchanged terminal count-limit test failed and left fixture hosts alive both during the full run and its isolated rerun; those test process trees were stopped explicitly. The remaining four terminal tests printed passing results. This is an unresolved local baseline-test limitation, not a full-suite pass.

The PR #68 review fix guards settings initialization with selection and request revisions. A late response can refresh account information but cannot overwrite a channel selected during that request; older settings requests cannot replace newer responses. Typecheck, build and account-settings acceptance passed after the fix. The added deterministic IPC fixture holds a saved mainland account response, selects international API, enters a fixture key, releases the response, and verifies both retained selection/key and the intercepted international login parameters. No real authorization is sent. The existing preview package predates this fix.

This file combines historical feature checks with the current release gates. Named `Desktop/release-*` directories below identify local outputs used for those checks; they are not required retained artifacts or current download locations. Current packaging writes to `Desktop/release/`.

## Permission Approval Presentation

The 2026-10-07 Desktop-only change localizes known upstream tool approvals using deterministic presentation rules, not model translation. It distinguishes incomplete shell analysis from a matched high-risk rule and ordinary policy confirmation. Full inputs are recovered only by the exact tool call ID/name within the matching runtime; unavailable inputs remain explicitly labelled as potentially truncated summaries. Unknown extension dialogs keep their existing presentation, and original approval text remains expandable.

Approval, denial and review-later retain their existing RPC behavior. This does not change permission policies, grant additional authority, add approval timeouts or solve unattended workflow waits. Related upstream discussion: https://github.com/stepfun-ai/Step-Code/issues/221.

On an isolated worktree based on `26ec686`, typecheck, all 204 unit/protocol tests, production build, general Electron acceptance and `scripts/verify-permission-approval.mjs` passed. The dedicated fixture covers Chinese/English, exact commands and other parameters, summary fallback, original details, defer without responding, approval/denial payloads, high-risk and unknown-extension dialogs, and 360/640/1280-pixel window bounds. Screenshots are `Desktop/test-results/permission-approval-*.png`; the narrow Chinese screenshot was visually inspected. CI now runs this fixture.

This is source and isolated-fixture acceptance only. No installer, replacement package, paid-model run, personal-session mutation, live-process interruption or upstream source change was performed.

## Conversation Elapsed Labels

The 2026-10-06 source change adds per-thinking-block elapsed labels and a permanent total before the completed response time. Timing is observed in the Electron main process: thinking ends at its end event, prose/tool-call transition, message completion or runtime exit; the run total spans agent start to completion/exit, including tools and waits. Steering does not reset it. These are observed Desktop intervals, not provider-internal compute measurements.

Completed observations are stored separately under userData `conversation-timing/`, keyed by session identity and assistant timestamps. They survive history refresh, renderer reload and cold reopening without changing upstream history or model context. Old messages without recorded intervals omit the labels. Permanent session deletion removes its timing sidecar. Concurrent workers have independent clocks; unexpected exit and orderly disposal freeze unfinished intervals.

Typecheck, all 185 tests and build passed. Timing unit checks cover formatting, separate thinking segments, steering, concurrent workers, exit, sidecar restoration/deletion and full-snapshot events. A real staged RPC/local SSE fixture verifies thinking timing through authoritative message replacement and history refresh. `verify-conversation-timing.mjs` verifies live ticking/freeze, recorded-history reload, permanent footer visibility and dark/light/narrow layouts. General Electron and frame-sampled stream-motion acceptance passed; screenshots are `Desktop/test-results/conversation-elapsed-{dark,light,narrow}.png`. No package, shortcut update, paid-model execution or installer acceptance is claimed.

## Subagent Status Motion

The 2026-10-07 source preview replaces the task row's running/completed text with a rotating ring and a circle-check icon. A fixed 18px slot contains 16px Lucide artwork, close to the adjacent 14px tool icon; completed circles use the same primary rose color as the composer action button. Long task descriptions cannot squeeze the status into multiple lines. Failure retains explicit text and an alert circle; accessible row names still include all statuses.

Only a mounted running-to-completed transition plays the 660ms completion sequence: cubic contraction (180ms), contracted hold (70ms), cubic regrowth (210ms), then a normalized SVG check-path draw (200ms). Historical completed tasks do not replay; reduced motion stops rotation and switches directly. Clicking the same task again closes its right panel with the existing animation, while clicking a different task switches records.

`Desktop/scripts/verify-subagent-status.mjs` uses isolated fixture records with the real renderer to verify rotation, intermediate contraction/hold/draw frames, stable row geometry, history, dark/light themes, narrow width, reduced motion, failure and click-toggle. Screenshots are under `Desktop/test-results/subagent-status-*.png`. This preview does not establish real-model subagent execution, and has not been packaged.

## Background Subagent Lifecycle

The 2026-10-07 Desktop-only fix projects background-lane status from structured `custom` / `agent-notification` messages onto the original dispatch using `details.agentId`. Valid completion, failure, interruption, progress, restart and needs-input events are replayed in message order; known-lane `agent_send` result snapshots also update status for follow-ups. Identities are registered before replay to tolerate a fast child notifying before the dispatch result arrives. Ordinary prose, unknown lane IDs and mismatched event/status pairs cannot change task state.

Conversation rows and the open Subagent panel share this projection across turn boundaries and restored snapshots. Panel selection now includes tool call ID and task index, preventing identical task descriptions from selecting a different dispatch. Background interruption is labelled Stopped rather than Failed. Neither original messages nor model context are rewritten; lifecycle notifications without child activity do not fabricate process records. The upstream checkout and staged runtime were not edited or restaged; the staged bundle hash matches the current packaged runtime.

Type checking, production build and all 193 tests passed. The first full run exited an existing session-collaboration test file without detailed failure output; its isolated rerun and a subsequent full rerun passed. `verify-background-subagents.mjs` passed cross-turn live completion, open-panel synchronization, identical-task isolation, reload without animation replay, failure, interruption and follow-up checks. Subagent status/motion, elapsed-time and general Electron acceptance also passed. A read-only replay of the reported session's active history resolved its affected lane as completed. Screenshot evidence is `Desktop/test-results/background-subagent-completed.png`; fixture UI acceptance does not establish new paid-model execution.

This fix is source-only. No package, shortcut update, user-session mutation or live-process interruption was performed.

PR CI now runs the dedicated conversation-timing, subagent-status and background-subagent Electron checks after general Electron acceptance.

The pre-PR validation reran type checking, build and all four Electron checks successfully. A full unit run alongside Electron checks hit an existing terminal-fixture process-tree termination failure and left fixture children alive; only children of that test runner were stopped. A subsequent independent serial run passed all 193 tests. No terminal product code was changed.

## Pending Send Preview

The 2026-10-06 queue preview uses the real staged RPC runtime with an isolated local SSE provider. `Desktop/scripts/verify-send-queue.mjs` verifies FIFO delivery, explicit steering without aborting the active response, long-message previews, quote-preserving edits, withdrawal, stop-and-retain behavior, worker switching, renderer reload, IME/repeated-key guards, cubic diff relocation, light/dark and narrow layouts. Queue and live-change components have distinct sibling keys to prevent stale queue controls after switching. Queue popovers hide native browser content while open.

Undelivered drafts remain in the Desktop main process so per-item actions are version checked rather than implemented through unsafe upstream clear/requeue. Queues retain image/file payloads internally, expose only message text and attachment counts, and cap at 20 messages / 32 MiB per worker. Stop/failure pauses delivery. Settings, branching, recycling and quit guards account for retained queues. Drafts are not persisted across full application exit.

The bundled `resources/queue-demo/start-queue-demo.ps1` starts a separate isolated profile with a local provider and a seeded walkthrough. Each response lasts about 40 seconds and invokes a real edit tool only against that profile's `demo.txt`. This permits hands-on queue, steer, edit, withdraw and diff-motion testing without a paid model or personal credentials. Fixture acceptance is not real-model or installer-lifecycle acceptance.

Typecheck, all 173 unit/protocol tests, production build, source queue/message-order/concurrency/general Electron checks passed. The unpacked preview at `Desktop/release/send-queue-preview/` passed queue, general Electron, native browser and real PowerShell terminal acceptance. The bundled demo launcher was separately started with packaged Node, confirmed to create an isolated profile and launch the packaged app, and its local provider completed a full response. Test processes were then stopped. Packaged Node, Step bundle, admin/session helpers and terminal host match staged resources byte for byte.

Both the normal desktop shortcut and a separate queue-demo shortcut target this preview. The user's running older application was not terminated. Installer SHA-256 is `2b7ece30f4b3246beffa68fbba2a75b368b9910d05bf72f9e3f2acb679abcedd`; the new directory totals about 697.44 MiB. The two older package directories were inventoried and left unchanged without new deletion approval. No paid-model acceptance, installer lifecycle, upstream source edit, commit, push or PR was performed.

The subsequent launcher correction fixes `windowsHide: true` on the Electron child: a hidden helper is appropriate, but hiding the actual GUI left running demos with no visible window. The source launcher and unpacked preview resource now use `windowsHide: false` for Electron. The actual desktop `.lnk` was invoked through Windows Script Host and confirmed to produce a nonzero native main-window handle. Six hidden demo launch trees were identified by their exact packaged Node path and launcher argument and stopped; ordinary application processes were not targeted. The visible replacement demo was left open for the user. This resource-only correction has not been rebuilt into the NSIS installer.

The next preview, `Desktop/release/send-queue-fifo-preview/`, includes that launcher fix in the installer and changes empty-composer Enter to steer the oldest undelivered message. Selection occurs in the main-process `queue_steer_first` handler, so an in-flight enqueue acknowledgement cannot accidentally prioritize a newer draft over existing items. Per-item steering still permits an explicit out-of-order choice. The hint and bundled walkthrough now describe oldest-first ordering. Typecheck, all 173 tests, build and source/packaged queue acceptance passed with assertions that the edited first draft is consumed before the second. Both desktop shortcuts target this preview; existing windows were left untouched. Runtime/terminal hashes match staged resources. Installer SHA-256 is `f81b93799ce71b76ac62cd297ad0ebb177b9a3b610b7bb7927c65736d1604843`; the preview totals about 697.44 MiB. All four package directories were inventoried without deletion.

The subsequent source-only refinement retains sent-but-unconsumed steering messages after RPC acknowledgement. They leave the editable queue chip immediately and render as ordinary user/quote bubbles beneath ongoing output, with a pulsing waiting receipt. Only the matching upstream user-message event removes that receipt; later assistant output belongs below the authoritative message. Acknowledged pending messages are not blindly retried or inserted into model history by the renderer. Stopped/disconnected sessions show static waiting/unconfirmed status. The docked live-diff popover now right-aligns to its trigger and follows animated relocation toward or away from the center.

Typecheck, all 174 tests, production build, source queue acceptance, message-order regression, concurrent-session, general Electron and native browser acceptance passed. Dedicated checks hold the local response open, verify that the sent bubble is visible before the model receives its text, retain it across reload and session switching without leaking it into another conversation, confirm one authoritative user bubble after consumption, and measure docked diff-panel/trigger edge alignment. The live-diff popover also participates in native-browser blocking while open. Screenshots are `Desktop/test-results/queue-awaiting-dark.png`, `queue-consumed-dark.png` and `queue-diff-anchored-dark.png`. This refinement was initially source-only.

The subsequent 2026-10-06 package at `Desktop/release/send-queue-live-preview/` includes the waiting receipts and docked diff anchoring. Its unpacked executable passed queue, general Electron and native browser acceptance with isolated profiles. Packaged Node, Step bundle, admin/session helpers and terminal host match staged resources byte for byte; the runtime baseline is unchanged. The ordinary desktop shortcut now targets this executable with no demo arguments, retaining the normal application's existing account and history. The separate queue-demo shortcut is unchanged. Installer SHA-256 is `47dbc03b3c014212558d5918d7e82dcaf742e92bfe0a5eac9d6d7355c9b83f5f`; the new directory totals about 697.45 MiB. All five package directories were inventoried without deletion. No paid-model test, installer execution or public release was performed.

The next source-only presentation refinement adds a persistent-on-screen italic "Steered" footer to consumed user messages sent into an active response (Chinese: "已插队引导"). Waiting receipts remain unchanged; ordinary FIFO delivery and idle sends do not gain this marker. Desktop matches delivery to the pending payload and records the authoritative user timestamp per resident worker, without modifying upstream history or model input. Markers survive renderer reload and worker switching, but are not persisted beyond worker disposal or application exit; older history is not inferred retroactively. Typecheck, 175 tests, production build and queue acceptance passed. Evidence is `Desktop/test-results/queue-steered-marker-dark.png`. This refinement has not been packaged.

The subsequent 2026-10-06 normal-profile package at `Desktop/release/send-queue-marker-preview/` includes the marker aligned with the user bubble's right edge, with hover actions to its left. Packaged queue acceptance verifies this alignment, steering-only labels and renderer reload; general Electron acceptance also passed. Runtime and terminal resources match the staged files byte for byte. The ordinary desktop shortcut now targets this package with empty arguments, preserving the existing profile; the demo shortcut is unchanged. Installer SHA-256 is `c667624342bde7e64f326b5d07c3e827be881250eaf774ad92028556ee975154`. The package totals about 697.45 MiB; six package directories were inventoried without deletion. Marker persistence limitations above still apply. No paid-model test, installer execution or public release was performed.

### PR #63 Review and CI Follow-Up

The consumed user event now reaches the renderer before the queue notification advances its revision. Queue acceptance inspects the actual renderer event stream, not just a later snapshot, to reject delivery that would already be stale. Stopping waits for upstream abort and queue cancellation before restoring unconsumed receipts as versioned editable drafts. Dead workers restore receipts locally; neither path retries automatically. A paused receipt also offers explicit recovery after the session becomes idle, requiring successful upstream queue cancellation before releasing the draft. New sends and steers cannot race an in-flight stop.

The CI browser fixture now waits for completed navigation, Playwright attachment of the native page, the editable input and the loaded image. Previously the native title event could arrive before the automation target was available; this change retains the isolation and real-page assertions rather than weakening them. Typecheck, 179 tests, production build, queue, message-order, native-browser, concurrent-session, cross-session and general Electron acceptance passed locally. The queue fixture stops an accepted steer before consumption, checks no silent replay, edits and removes its recovered draft and verifies settings are unblocked. GitHub Windows integration passed for commit `21031ba` in run `37466831400`. These source fixes have not been repackaged.

The subsequent child-exit regression found an unhandled stdin `EPIPE` when a snapshot read raced real RPC process termination. The transport now owns stdin stream errors, rejects pending requests, reports disconnection and stops the affected child instead of crashing Electron. Typecheck, 180 tests, production build and extended queue acceptance passed. The Windows queue fixture verifies its isolated application's PID/profile before terminating only its own Step RPC children, then withdraws restored drafts through the real UI without replay. A deterministic pipe-error unit test also verifies late released-child errors cannot disconnect another transport.

## Embedded User Browser

PR #58's intermittent branching failure displayed a repeated in-flight reply, rather than a missing response. The 2026-10-05 follow-up reproduces overlapping snapshot/delta delivery deterministically with `scripts/verify-message-order.mjs`: the old renderer appends `Alpha` twice when a snapshot already includes the delayed delta. Desktop now tags snapshots and worker events with a per-worker runtime revision, rejects message events already represented by an installed snapshot, and ignores refresh snapshots older than accepted live messages. Explicit retry history replacements advance the revision too. Legitimately repeated text in a newer delta remains intact. The deterministic Electron fixture also covers a delayed stale refresh and late deltas after history replacement, and is included in Windows CI. Typecheck, all 156 tests, production build, message ordering, real-runtime branching, concurrent-session and general Electron acceptance passed locally. No upstream runtime changes or new packaged preview were made for this fix.

The 2026-10-05 PR follow-up shares the native Standard/Wide/Fullscreen width menu with the terminal. Terminal wide mode changes actual PTY columns and fullscreen restore retains the preceding width. Standard browser docking now reserves the full 620-pixel native surface; acceptance checks that it does not overlap the composer. Collapse hides the opaque WebContentsView at the beginning of the shell's cubic fade, rather than leaving a fully visible webpage over the returning conversation. The closing track releases its layout reservation in one reflow. Browser, real PowerShell terminal and general Electron acceptance passed against the updated source build, along with typecheck, production build and all 151 tests on an isolated rerun with a 60-second test timeout. The previously packaged preview predates this final native-hide and standard-width correction.

The 2026-10-05 source preview adds a user-operated browser to the shared right rail. Each tab uses a sandboxed WebContentsView with context isolation and no Desktop preload or Node integration. Tabs use the separate persistent `desktop-browser` partition. Website cookies/storage persist in this profile; tabs do not restore across application restarts. Collapse, conversation changes and renderer reload retain the native tabs. Explicit tab close and application shutdown close their WebContents. Production uses Chromium's normal background throttling; isolated no-focus acceptance disables it only for that test profile.

The UI provides URL entry, back/forward, reload/stop, twelve global tabs, popup links as new tabs, explicit opening in the system browser and 50-200% zoom. It follows the shared cubic right-panel expansion and supports main-view fullscreen/restore and bounded narrow-window overlays. Native bounds follow the animated page viewport rather than covering the browser header, rail or footer. Settings, renderer approvals/previews/context menus, titlebar menus and the narrow sidebar hide the native page while they are in front. HTTP/HTTPS and the internal blank page are allowed; file/executable/custom schemes and credential-bearing addresses are rejected. Website permissions default to denial and downloads use Electron's native save-dialog options. No Agent control, MCP registration, remote-debugging endpoint or new browser dependency is added.

`Desktop/scripts/verify-browser-panel.mjs` uses an isolated Electron profile and a local HTTP fixture. It exercises real page input, images, scrolling, navigation history, zoom, popup tabs, native Ctrl+L address focus, renderer reload, cookie-partition isolation, microphone denial, invalid commands/geometry/addresses, failed loads and retry, tab limits, and full WebContents release including empty tabs. It checks light/dark chrome, native bounds at 640 pixels, intermediate cubic expansion frames, reduced motion and settings/titlebar-menu layering. Playwright captures the React shell and native web page separately; `browser-shell-*` and `browser-web-*` retain both original images, and `browser-composite-*` combines these actual captures at measured native bounds for inspection.

Typecheck, 151 unit/protocol tests, production build, browser acceptance, general Electron acceptance and real PowerShell terminal acceptance passed locally. The fixture is not evidence of compatibility with every website. Real-account OAuth popup flows, actual downloads/save dialogs, camera hardware, remote-site login, installer lifecycle and packaged-browser acceptance have not been exercised. No new package or shortcut change was made; upstream Step Code and the staged runtime remain unchanged.

The subsequent 2026-10-05 package at `Desktop/release/browser-preview/` passed browser, general Electron and real PowerShell acceptance using its unpacked executable through `DESKTOP_VERIFY_EXE`. A repeated unit-test run stalled in the terminal fixtures while packaging was concurrent; only that owned test process tree was terminated. An isolated rerun with a 60-second test timeout passed all 151 tests in about 16 seconds. The desktop shortcut was updated to this package without closing the user's running older terminal preview.

Packaged Node, Step Code bundle, admin/session helpers and terminal host hashes match the staged/build resources. Runtime remains at `519e4de4ed2162d3667be1821cb92ada6b884e5a`, with Node v24.15.0 matching its manifest hash. Installer SHA-256 is `828b676b53badec2674fcf391a48b3701d2d4d5e478a281b118448481c700a9e`; its size is 153,649,232 bytes, and the package directory totals 726,208,356 bytes. Existing preview directories were inventoried without deletion. Installer lifecycle, real-account login and actual download/save-dialog acceptance remain unverified. No upstream edit, Agent browser control, commit, push or PR was performed.

### Browser Width Preview

The subsequent 2026-10-05 preview adds Standard, Wide and Fullscreen choices only to the browser header. Wide uses approximately 60% of the available main view, preserving at least 480 pixels for the docked conversation. Standard retains its previous width. Narrow overlays converge Standard and Wide; fullscreen restore returns to the previously selected non-fullscreen width. The selection survives panel switching within the renderer lifetime but is not persisted across reload/relaunch. All widths use the existing cubic transition and measured native viewport synchronization. The native page is temporarily hidden while the native width picker is open; Escape dismisses that picker without also closing the browser panel.

Typecheck, all 151 unit/protocol tests, production build, source and packaged browser acceptance, and packaged general Electron acceptance passed. Browser acceptance checks header-control alignment, intermediate wide/fullscreen frames, stable native viewport bounds, conversation availability in Wide, fullscreen restore, switching away and back, narrow-width convergence, picker layering and Escape. Screenshots include `Desktop/test-results/browser-composite-wide.png`, `browser-composite-narrow-wide.png` and `browser-width-picker.png`, along with the existing standard/fullscreen/theme captures.

The package is `Desktop/release/browser-width-preview/`; the desktop shortcut targets its unpacked executable without terminating the user's running earlier browser preview. Installer SHA-256 is `177efea42e6bfb0e93b44626a6093ba68a894f85499f1a8a049d514099f5651b`, installer size is 153,649,374 bytes, and the package directory totals 726,210,203 bytes. Node, Step bundle, admin/session helpers and terminal host hashes match staged/build resources; the runtime baseline remains unchanged. Thirty local preview directories were inventoried without deletion. No installer lifecycle, remote-account login, paid-model acceptance, upstream edit, commit, push or PR was performed.

The subsequent source-only width-control correction reuses `DisclosureChevron`, incorporates the layout icon into the same button, and narrows the Chinese trigger to 84 pixels while retaining 126 pixels for English. It replaces the HTML picker with a typed Electron native-menu operation like the Review panel's menu. The page is no longer hidden during width-menu interaction, avoiding an empty dark viewport. Browser acceptance substitutes only native-menu selection/cancellation, inspects the real menu's radio items, and continuously checks that the real WebContentsView remains visible while the selection promise is pending. It also verifies retained page input, unchanged width on cancellation, invalid menu requests, icon-hit-area activation and existing width transitions. The screenshot `browser-composite-menu-open.png` combines the real shell/page captures during this held-menu fixture; it does not depict the actual OS popup. Header screenshots are `browser-header-{light,dark,wide,narrow}.png`. No replacement package or shortcut update was made for this correction.

The 2026-10-05 follow-up package at `Desktop/release/browser-menu-preview/` includes the compact SVG/menu correction. Typecheck and production build passed again, and the unpacked executable passed browser and general Electron acceptance with isolated profiles. Native-menu selection/cancellation remains substituted as described above; this is not an OS-popup visual acceptance claim. The desktop shortcut now targets this package; the running older width preview was not closed or overwritten.

Installer SHA-256 is `4603df3d9761e668941d28a19b81b3d2f8637485250de1453011491d23c916b2`, its size is 153,650,388 bytes, and the package directory totals 726,215,424 bytes. Packaged Node, Step bundle, admin/session helpers and terminal host hashes match the staged/build resources. Runtime stays at `519e4de4ed2162d3667be1821cb92ada6b884e5a` with Node v24.15.0. Thirty-one local preview directories total about 19.60 GiB; none was deleted. Installer lifecycle, real-account login and paid-model acceptance were not added, and no commit, push or PR was performed.

## Embedded Windows Terminal

The source preview adds a user-operated PowerShell terminal to the shared right rail. xterm.js 6.0.0 and FitAddon 0.11.0 render the terminal; node-pty 1.1.0 runs in a separate helper under the already-staged Node runtime, outside Electron and ASAR. The renderer receives only typed terminal metadata/output and narrow input/resize/clipboard operations, without Node or filesystem access. Desktop credentials and runtime/environment overrides are not forwarded. Terminal output is not added to model messages or Agent tool events.

Tabs are grouped by initial working directory, limited to eight per directory and 24 globally. Hiding the panel and changing conversations leave them alive; exited tabs retain output. Explicit close and application exit terminate the owned process tree. Creation during shutdown is rejected, and pending startup/close operations settle during teardown. Terminals do not persist across application restarts. Main retains a bounded approximately 512 KiB raw-output replay per terminal; renderer reload restores that bounded history, not an exact unlimited screen snapshot. The helper pauses output consumption above 256 KiB of unacknowledged data and resumes below 64 KiB. Renderer output writes do not cause React rerenders.

`Desktop/scripts/verify-terminal-panel.mjs` runs an isolated real Electron/PowerShell profile. It covers Chinese text, actual keyboard commands, clipboard paste and selected-text copy through a stubbed OS clipboard, Ctrl+C interruption, real PTY resizing during fullscreen/restore, multiple tabs, hidden-panel output and 3500-line output beyond the backpressure threshold. Reload restores existing tabs; switching to an independent directory creates separate terminals and returning to the project retains its tabs. It verifies explicit close kills a shell-launched test child, natural exit retains code 3, closing the last tab does not auto-create another, and titlebar application exit ends a background independent terminal. Main-process guards reject unknown terminal IDs, invalid dimensions and oversized input. The fixture verifies renderer Node isolation and removal of a Desktop-prefixed secret from the shell environment.

Screenshots are `Desktop/test-results/terminal-panel-{light,dark,expanded,narrow}.png`. Checks include light/dark themes, a 640-pixel window without horizontal document overflow, cubic transition timing/intermediate expansion widths and closing opacity, reduced motion, and shell Escape not restoring or closing the panel. Typecheck, all 144 unit/protocol tests, production build, terminal acceptance, general Electron acceptance, Context and Review acceptance passed locally. Focused terminal tests also cover environment filtering, bounded replay, invalid IDs/acknowledgements, directory limits, pending-start cancellation and shutdown creation rejection.

The 2026-10-05 package at `Desktop/release/terminal-preview/` passed the same real terminal acceptance and general Electron acceptance using its unpacked executable. Packaged native-PTY loading, real PowerShell, output backpressure, renderer reload, process-tree cleanup, fullscreen resizing and isolated directory tabs were exercised. The dependency resource has its own copy root because electron-builder excludes a root `node_modules` directory even from an explicit resource filter. The desktop shortcut now targets this package; the user's running older application was left untouched.

Packaged Node, Step Code bundle and both Desktop helpers match the staged runtime, and the helpers match current source. The terminal helper also matches its build output. Runtime retains baseline `519e4de4ed2162d3667be1821cb92ada6b884e5a` and Node v24.15.0; Node matches its manifest hash. Installer SHA-256 is `e91426aeda4252d2f62b1fb17d3743fe31826f21ba4ba5a04aad71d81588d577`. Installer and unpacked application are about 146.52 and 545.82 MiB respectively. The rebuildable helper/dependency directory is about 63 MiB; 28 preview directories total about 17.57 GiB and were inventoried without deletion.

PowerShell 7 was exercised; the configured Windows PowerShell fallback was not separately exercised. No installer execution, WSL support, paid-model call, upstream Step-Code change, commit, PR or public-release qualification was performed.

### PR #57 Review And CI Follow-Up

The source-only follow-up replaces environment-name denylisting with an explicit case-insensitive allowlist. Regression fixtures include `SSH_PRIVATE_KEY`, `GITHUB_PAT`, `DOCKER_AUTH_CONFIG`, proxy variables and an unclassified custom variable, while retaining system paths and user directories. Real PowerShell acceptance injects isolated synthetic credentials and verifies that their variable names are absent from its environment and their values do not enter replay output. This does not sandbox the shell's normal current-user filesystem access.

Terminal closure checks the taskkill outcome and waits for host exit before removing the tab, replay and registry entry. Unsuccessful termination and reported success without actual host exit both retain ownership and reject closure; a later confirmed retry removes the entry. Concurrent closes share the same operation. Shutdown waits for outstanding attempts, propagates failures and allows retry; the application does not quit silently after a failed terminal stop. Unit fixtures cover these failure/retry paths, while real terminal acceptance covers ordinary process-tree termination and application exit.

The failed CI step reported `Unknown workspace` when returning from an independent terminal to a project whose saved path had been canonicalized. Workspace selection now checks remembered directories with the existing `samePath` helper and connects through the remembered path rather than raw string equality. Real terminal acceptance explicitly uses uppercase, alternate separators and a trailing dot, and rejects an existing but unregistered directory.

Typecheck, all 147 unit/protocol tests, production build, source real-terminal acceptance and general Electron acceptance passed after these changes. The previous terminal package and desktop shortcut have not been replaced by this source-only follow-up.

## Conversation Presentation

### Hanging Summary Board

The 2026-10-03 source preview separates Summary from the full-height conversation-navigation sidebar. A content-height board hangs from the upper-right with an open region beneath it. The board region is 344 CSS pixels wide; the reading column retains its normal 920/1000-pixel cap. Summary remains an empty placeholder; no new summary data or agent capabilities are implemented.

Automatic visibility requires at least 1120 CSS pixels after subtracting the actual reserved left-sidebar track and the 44-pixel right rail. With the left sidebar visible, 1440-pixel and 1920-pixel windows show it; a 1280-pixel window hides it, and hiding the left sidebar restores enough room. Manual close stays closed across resizing during this app lifetime. Manual opening without enough room uses a bounded top-right overlay instead of shrinking the transcript. Automatic and manual openings use a 320ms ease-out quadratic approximation, sliding 10 pixels left and 12 pixels down from the upper-right while fading in. Acceptance samples the initial, intermediate and final animation states. Close, backdrop and Escape return focus to the rail; reduced motion disables the entrance.

The follow-up fixes the narrow dismiss surface inheriting ordinary button hover colors, which could obscure the entire app. Summary's dismiss surface now remains transparent in normal, hover and active states. A persistent zero-to-344-pixel docking track animates both opening and closing with the same quadratic curve, moving the transcript and composer together instead of instantly inserting/removing a layout column. Their maximum widths also transition together. Frame checks cover automatic/manual opening and closing, and narrow/intermediate 640/900/1280/1360-pixel windows retain all available conversation width without a leftover docking column. Reduced motion disables both board and layout animation.

The subsequent gutter-aware layout correction uses existing right-side reading-column whitespace before reserving additional width. The dock reservation is bounded between zero and 344 pixels, derived from the viewport, sidebar track and normal reading width. With enough whitespace, opening/closing Summary leaves both transcript and composer unchanged; when more room is needed, only the necessary reservation uses the existing quadratic transition. The scrollbar and turn ruler now follow the reading-column edge, outside the board. Acceptance checks 1920-pixel windows with the sidebar visible/hidden and a 1706-pixel sidebar-hidden window: the latter reserves 54 pixels and moves the reading center 27 pixels instead of 172. It also verifies non-overlap, preserved 1000-pixel wide reading width and initial/intermediate/final partial-reservation frames. Screenshots are under `Desktop/test-results/summary-board-gutter-*.png`. Resize checks await the actual layout transitions rather than assuming a wall-clock delay is enough.

Type checking, all 111 unit tests, production build, `verify-electron.mjs`, `verify-summary-board.mjs`, `verify-stream-motion.mjs` and `verify-chat-quotes.mjs` passed. Isolated-profile screenshots cover light/dark, wide, narrow auto-hidden and narrow manually-open states under `Desktop/test-results/summary-board-*.png`. The layout fixture checks useful board/reading widths, transcript/composer alignment, leftward displacement, focus, resize policy and non-overlap. These checks do not establish summary content, real-model or installer-lifecycle acceptance.

The packaged preview is `Desktop/release/hanging-summary-preview/`, rebuilt in place with the gutter-aware correction, narrow-hover fix and main-view motion, using the previously staged pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime. Runtime auxiliary-file hashes match current Desktop source. Packaged `verify-summary-board.mjs` and `verify-electron.mjs` passed using the current fixtures and isolated profiles; the desktop shortcut targets this unpacked executable. The installer and unpacked app total about 681 MiB; installer SHA-256 is `9b50e75d2adeee151255001254e5f0b7955201ccbeeb22df1c2bfaef507bc390`. The installer was not run and other historical packages were not deleted.

The subsequent source-only native-resize correction distinguishes window geometry changes from manual Summary toggles. On native resize, Summary docking and the reading width settle before paint; the visible conversation shell, composer and scrollbar move using transform-only 320ms quadratic easing. Manual toggles retain their existing transition. Interrupted corrections cancel and restart from their current visual positions; reduced motion skips correction animations. Unchanged Markdown now has a memoized rendering boundary with a stable image-preview callback, preventing layout state changes from reparsing saved history while retaining new-text reveals and current language/copy/image behavior.

`scripts/verify-summary-resize.mjs` uses an isolated real Electron profile with 60 user/assistant turns, paragraphs, tables and code. It maximizes the native window and clicks the actual Restore titlebar button three times, sampling continuous animation frames and Chromium performance counters. Before the correction, the restored reading width continued changing through 13-32 distinct widths, with 33-65 layouts and 50-107ms cumulative layout time per pass. After both fixes, the same fixture recorded one restored reading width, 7-11 layouts and 20-21ms cumulative layout time. In the final traced run the maximum frame interval was 50-58ms rather than the earlier 175-188ms baseline, and no renderer long task was recorded during the three sampled restores. The intermediate trace before Markdown memoization identified approximately 150ms resize callbacks even after repeated rewrapping had been removed. These are local measurements with instrumentation, not an FPS guarantee; initial long-document reflow remains nonzero.

Continuous-frame assertions check transcript/composer alignment and absence of backward position jumps. Additional checks cover a rapid maximize/restore reversal, history reading not being pulled to the bottom, reduced motion and renderer errors. Browser scroll anchoring may adjust the numeric history scroll offset during width changes; exact offset preservation is not claimed. Type checking, 111 unit tests, production build, Summary layout, stream motion, quote interaction and general Electron acceptance passed. Evidence is under `Desktop/test-results/summary-resize-{baseline,fixed}.json`, `summary-resize-trace.json` and `summary-resize-restored.png`. The source pass initially left the previous packaged preview unchanged. No upstream runtime, paid-model or installer-lifecycle acceptance was added. Existing packages were retained; this follow-up generated about 2.5 MiB of rebuilt `dist/` files and about 11.5 MiB of resize evidence before packaging.

The 2026-10-04 package rebuild updates `Desktop/release/hanging-summary-preview/` in place with both native-resize and Markdown-rendering corrections. No running preview process was present before rebuilding, and the existing desktop shortcut still targets the updated unpacked executable. Packaged `verify-summary-resize.mjs`, `verify-summary-board.mjs` and `verify-electron.mjs` passed with isolated profiles. The packaged 60-turn resize pass recorded one restored reading width, 7-10 layouts, 16-21ms cumulative layout time and 46-63ms maximum frame intervals, with no sampled renderer long tasks. The latest `summary-resize-fixed.json` and restored screenshot are from this packaged pass; the trace remains from the preceding source pass. The bundled runtime manifest remains at `519e4de4ed2162d3667be1821cb92ada6b884e5a`, and bundled admin/session-helper SHA-256 hashes match source. Installer SHA-256 is `544b437f9902e782c4afcb40a5c5941268aa9e6ab5dee291c93dc2da9ae0491b`; installer and unpacked app total about 681 MiB. No historical package was deleted, no installer lifecycle test was performed and no real-model acceptance was added.

The subsequent source-only overlay-input fix removes the full-view transparent dismiss button for Summary. Narrow Summary is nonmodal: only the board intercepts input, while the conversation remains available for native wheel scrolling, selection and composer editing. Close, the Summary rail toggle and Escape remain available; clicking the conversation does not dismiss Summary. The conversation-navigation panel retains its original narrow-screen dismiss surface. Type checking, 111 unit tests, production build, Summary acceptance and long-history native-resize regression passed. Summary acceptance now uses scrollable prose and real wheel/click/input interactions at 640/900/1280/1360 CSS pixels, verifies the board remains open, and checks that conversation-navigation dismissal still works. The latest resize JSON/screenshot have been refreshed by this source pass; the earlier package measurements above remain the recorded packaged result. This input fix is not yet in the desktop shortcut's preview package. No new large package was generated or old package deleted.

### Compact Session Notices

The 2026-10-03 preview uses content-sized notices centered over the main conversation view, just below the window bar. Copy and branch actions share the same cubic entrance. Archive offers View and Undo; successful Undo restores the sidebar entry, replaces the same bubble with a neutral success surface and a green check, smoothly reduces its width without repeating the entrance, and expires after three seconds unless hovered or keyboard-focused. MCP warnings retain their original error text and View MCP link in the same notice surface; a shorter error summary is not implemented.

The subsequent source-only follow-up removes native secondary confirmations from single and bulk archived-history deletion. Both actions delete directly; main-process archive-membership, current/active-session, operation-lock and managed-file checks remain, with authorization revalidated immediately before deletion. The archived-session fixture now fails if either action opens a native dialog and continues to verify unknown/duplicate/non-archived/current-session rejection, history persistence and project-file survival. The packaged preview below predates this follow-up.

Type checking, 111 unit tests and the production build passed. Packaged Electron, archived-session and real-RPC branching acceptance passed with isolated profiles. Notice checks cover main-view centering with sidebar and right-panel changes, narrow layouts, reduced motion, in-place undo, action removal, expiry and light/dark screenshots. These fixtures do not establish paid-model or installer-lifecycle acceptance.

The local package is `Desktop/release/compact-notices-preview/`, with the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime staged from the separate prepared checkout. The desktop shortcut targets its unpacked executable. The package totals about 681 MiB including the installer and unpacked app; installer SHA-256 is `e79251904476c039a9a34e14609a57e7256cacd4a0d629afc2d8321479f1e7b3`. The installer was not run, no release was published, and historical packages were not deleted.

The 2026-10-01 PR-scoped source, rebased onto main after PRs #30 and #31 and excluding the separate composer send/stop-button work, passed type checking, all 42 tests, the production build and background Electron acceptance. Narration and tool summaries remain visible in source order. Acceptance verifies localized action labels, details-only raw commands, pending-only left-to-right shimmer, independent sibling completion, upright/red failures, reduced-motion handling and missing-result states. Screenshots are under `Desktop/test-results/tool-summary-*.png` and `transcript-tool-*.png`. The earlier 2026-09-30 packaged preview also passed acceptance, but was built before this main-branch sync.

Fixtures cover user turn anchors, tool-ID pairing with out-of-order results, failed and missing results, retained intermediate narration, thinking and images, copy of all response prose excluding thinking/tool payloads, hover/focus controls without layout shifts, draft-preserving edit-to-composer, nested disclosure and visible narration/tool summaries after runtime disconnect. Light/dark and narrow-window screenshots are local evidence under `Desktop/test-results/transcript-*.png`; math and image-preview regression checks remain included.

Clipboard text writes are replaced by an in-page fixture, not performed against the user's clipboard. Editing restores a message copy to the composer; it is not runtime history editing. Branch remains disabled. This renderer change has no new real-model or installer lifecycle acceptance.

Thinking folds when the first subsequent nonempty text delta arrives, while the response and pending tools remain active. Empty text-start events do not fold it; a manual reopen survives later deltas. `Desktop/test-results/thinking-folded-on-prose.png` captures that verified streaming state. Layout acceptance waits for finite transitions rather than looping tool animations.

## Concurrent Sessions

### Archived Sessions and Turn Dates

The 2026-10-03 source change moves archived history out of the sidebar into Settings > Archived. The view groups project and independent sessions, combines search with project filtering, opens history without restoring it, and restores sessions to their existing sidebar groups. Single and all-archive permanent deletion use a main-process native confirmation with Cancel as the default. IPC accepts only known archived IDs, rejects the currently viewed session and active workers, locks resident targets while awaiting confirmation, and revalidates archive membership after confirmation. Deletion validates real paths within the Desktop session store and unlinks individual regular JSONL files, never project files or directories.

Type checking, 109 unit tests, the production build, source Electron acceptance, sidebar ordering and `verify-archived-sessions.mjs` passed. The archive fixture checks grouping, search, filtering, read without restore, restore, cancelled/single/bulk deletion, unknown/duplicate/non-archived/current-session rejection, rejection of a prompt during confirmation, revocation by restore during confirmation, project-file survival and persisted history after reload/relaunch. Unit tests reject outside-profile paths and directory-link escapes. Native confirmations are substituted in the isolated acceptance process; no real user history is deleted.

The right navigation panel keeps each user turn's original timestamp visible below its preview, aligned right, in local month/day and 24-hour time. Missing and invalid timestamps remain absent rather than borrowing the current time. Screenshots cover light/dark, narrow layouts, title truncation and bilingual dates under `Desktop/test-results/archives-settings-*.png` and `navigation-turn-dates-*.png`. This is source-only acceptance: no new package, installer run or paid-model acceptance was performed, and the desktop shortcut is unchanged.

### Sidebar Ordering and Project Pins

The 2026-10-03 sidebar change defaults sessions to a persisted manual order, with a General setting for recently updated first. Switching modes preserves the manual order. Projects always retain a manual order; reopening an existing directory does not promote it. Both session and project rows support primary-button long-press dragging, insertion indicators, edge scrolling, Escape cancellation and keyboard reordering. Session moves stay inside their group. Pinned and ordinary projects retain separate orders, and pin/unpin remains an explicit project-context-menu action.

The section order is fixed: independent sessions, pinned projects, ordinary projects. Archived sessions now live in Settings, as described above. The pinned section has no add-project action; individual project rows retain their new-session controls. Preferences are persisted under the isolated Desktop profile and validated in the main process; the renderer cannot authorize new workspace paths by submitting an order.

The source passed type checking, 106 unit tests, production build, Electron acceptance and local real-RPC concurrency, branching and cross-session regressions. `verify-sidebar-order.mjs` checks manual drags without navigation/collapse, Escape and cross-group rejection, pin/unpin, persisted order after renderer reload and app relaunch, both sorting modes, always-manual projects, narrow windows and reduced motion. Screenshots use isolated fixture sessions under `Desktop/test-results/sidebar-order-*.png`. These checks do not establish paid-model or installer-lifecycle acceptance.

The local preview at `Desktop/release/sidebar-order-preview/` was packaged on 2026-10-03 with the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime from the separate prepared checkout. The unpacked executable passed Electron, sidebar ordering and real-RPC concurrency acceptance with isolated profiles. The desktop shortcut now targets this unpacked executable; the installer was not run. The installer is about 144 MiB and the unpacked application about 537 MiB; installer SHA-256 is `43f6ffe93b681a810d236a08b1a8d53edc6a15704dcf84f5f5d2a4697b1fef75`. Existing preview packages were not deleted, and no installer-lifecycle or new real-account model acceptance was performed.

### Empty Session Creation

The 2026-10-03 Issue #44 change reuses a connected, idle, message-free worker in the same canonical workspace when requesting a new session. Startup requests in the same directory are coalesced. Ordinary snapshot reads are awaited before rechecking eligibility. Workers with submissions, streaming, compaction, queued messages, approvals, non-snapshot operations, mutations, failure or interruption are not reused. Loading saved history and explicit clone/fork operations still create their own workers. Different workspace directories remain independent.

Type checking, 100 unit tests, production build, Electron acceptance, local real-RPC/SSE concurrency, branching and cross-session tool regressions passed against the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime. Electron acceptance clicks the project's new-session button five times and verifies unchanged runtime/session identity, sidebar row count and composer draft. The concurrency fixture checks repeated new-session commands and reuse after returning from a different project. Unit coverage also checks concurrent startup, failure cleanup and retry, busy-state exclusions, saved-session restoration and separate directories.

The PR #45 review follow-up first reproduced duplicate creation during delayed snapshot reads in unit tests, and reproduced the CI `Unknown workspace` failure locally with a directory junction. Snapshot operations now have tracked promises; new-session requests wait for those reads and reevaluate history, activity and worker membership without ignoring other operations. Tests cover multiple reads and opens, state changes while waiting, removal, and failed-read cleanup. The concurrency fixture enters through a directory alias and returns using the canonical workspace path supplied by the main process, matching renderer navigation rather than reusing an obsolete fixture path string.

This is a creation-path fix, not a new recycling policy. Previously accumulated empty sessions are not automatically removed; existing switching, idle retention and background concurrency rules are unchanged. Independent-session creation still allocates a distinct working directory. These checks use isolated profiles and a deterministic local provider, not a paid model or installer lifecycle acceptance. No new package was produced for this change.

The shared-directory follow-up on 2026-10-01 removes the generic send confirmation and appends collaboration rules to session workers through `--append-system-prompt`. Type checking, 66 tests, production build, Electron and local real-RPC/SSE concurrency acceptance passed. The packaged preview at `Desktop/release/session-collaboration-preview/` passed Electron and concurrency acceptance too. The concurrency fixture starts two tasks in one directory without native warnings and observes the added system guidance in requests for both workers, while the base prompt remains and user text is unchanged. Existing approval and deferred-approval cases still pass. The fixture proves rule delivery and nonblocking sends, not that a real model will always preserve edits or split Git commits correctly. No file lock, change-ownership registry or cross-session task-context synchronization is implemented.

The 2026-10-01 unread-indicator correction passed type checking, 65 tests, production build, concurrency and Electron acceptance. The packaged preview at `Desktop/release/session-unread-preview/` passed both acceptance scripts too. Dots have no tooltip and titles retain only their original nine-pixel inner padding. Blue is created by successful background completion only; foreground completion and historical success remain dotless. Acceptance enters the unread session, checks that its dot clears and stays cleared after leaving, and exercises cached navigation without losing live output or drafts. Session-ID unread flags survive worker recycling within the current app lifetime, but are not persisted across app relaunch. Source fixture timings were 3-4ms per resident switch IPC and 28ms to the target title/draft paint; packaged timings were 3-4ms IPC and 30ms paint. These are local small-history measurements, not a general latency guarantee. Cold historical navigation still requires worker startup.

The gutter-aligned session indicators and completion sound passed type checking, 63 unit tests, production build, local real-RPC concurrency acceptance and stream-motion regression on 2026-10-01. The packaged preview at `Desktop/release/session-status-preview/` passed concurrency and Electron acceptance. Acceptance verifies running/complete/interrupted sidebar states, dot centers aligned beneath the group icon outside the selected row, no animation after completion or stop, no completion playback on manual abort, exactly one playback request per successful foreground/background run, decoding the bundled WAV and actual muted media playback. Event-triggered playback is intercepted to avoid audible test noise; this is not a speaker or subjective loudness check. Unit fixtures cover duplicate end events, history reads, truncation, errors and process exit. The completion-state screenshot is `Desktop/test-results/concurrent-completion-status.png`; `Desktop/test-results/session-status-gutter.png` isolates the corrected placement.

The 2026-10-01 source passed type checking, all 61 tests, the production build and `verify-session-concurrency.mjs`. The packaged preview at `Desktop/release/session-concurrency-preview/` passed the same concurrency acceptance plus `verify-electron.mjs`, `verify-chat-quotes.mjs`, `verify-auth-vault.mjs`, `verify-stream-motion.mjs` and `verify-message-feedback.mjs`. The concurrency acceptance uses separate real staged Step Code RPC processes against an isolated local SSE provider, not injected agent events or a paid model. It verifies two simultaneous streams, navigation with live text retained, targeted abort, per-worker permission changes while a sibling runs, background tool approval without a foreground modal, deferred approval and actual `write_file` execution, shared-directory cancel/confirm, statistics, and draft/history restoration after idle-worker recycling. Light/dark and narrow-window screenshots are under `Desktop/test-results/concurrent-*.png`.

The main process owns one worker per resident session; every worker event and renderer command carries a runtime identity. A failed worker retains its visible transcript and does not disconnect siblings. Unit tests cover scoped crashes, stale events/commands, request timeouts, recycling exemptions and committed-history queries that must not erase live text. These crash and timeout cases are unit fixtures, not real-process crash acceptance.

Running, compacting, submitting and approval-waiting workers are not recycled. The viewed worker and unsaved empty workers are retained; up to two recently used persisted idle background workers stay warm, and persisted workers idle for five minutes become eligible for recycling. Drafts, quotes, attachments, reading positions and run metrics belong to session identities, independently of worker lifetimes. Selection temporarily suspends bottom-following so a window reflow cannot move selected prose out of view.

Process isolation does not isolate project files. Same-directory sends now proceed without a generic warning; the earlier preview's confirmation gate was removed by the shared-directory follow-up above. No worktree or filesystem isolation is created. Login/logout and shared MCP changes still require all sessions to be idle. Exit confirmation covers background tasks too. Upstream Step Code and the credential boundary are unchanged. This work has no new real-account, clean-machine or installer-lifecycle acceptance.

## Local Runtime Baseline Alignment

On 2026-10-03, the pinned upstream `519e4de4ed2162d3667be1821cb92ada6b884e5a` was built with the checked Desktop integration patch in a separate checkout at `D:/Desktop Runtime Builds/Step-Code-519e4de`, then staged into `Desktop/runtime/`. Its manifest confirms that commit and Node v24.15.0. The original `Step-Code/` checkout remains at `7dd66cb` with its three pre-existing modifications unchanged; their file hashes were compared before and after staging.

The staging script accepts an explicit upstream path or `DESKTOP_STEP_CODE_SOURCE`, and rejects the wrong commit before overwriting runtime files. A Windows fixture verifies default, environment and argument selection, including argument precedence and retention of an existing runtime manifest on failure. Type checking, all 96 tests, production build, Electron, concurrency, branching, cross-session tools, isolated auth-vault and StepPage registration acceptance passed with the newly staged runtime.

The prepared checkout is retained as a reusable build source (about 305 MiB logical size); the staged runtime is about 122 MiB. No historical packages were deleted and no new installer or preview package was produced. The desktop shortcut still launches the old preview package, not this newly staged development runtime. These checks do not qualify a public release or real-model quality.

## Credential Migration Comparison

PR #30 already handles empty legacy credential stores. This change builds on that recovery logic and compares nonempty credentials structurally: identical values with different object key order no longer falsely conflict. Different nonempty credentials still block startup and remain untouched.

On 2026-10-01, the post-sync source passed type checking, all 42 tests, the production build and `verify-electron.mjs`, `verify-auth-vault.mjs`, `verify-crash-log.mjs`, `verify-steppage-registration.mjs` and `verify-theme-bootstrap.mjs`. The vault unit test and real DPAPI migration acceptance cover reordered equivalent credentials, unchanged encrypted bytes and rejection of real conflicts. These checks use isolated fixture profiles, not the user's account.

## Mathematical Notation

The 2026-09-30 source build passed type checking, 28 tests and background Electron acceptance. The local preview at `Desktop/release/math-preview/` was also packaged and passed the same acceptance against its unpacked executable. Fixtures cover inline and display math, same-line double-dollar notation, fractions, roots, sums, integrals, limits, matrices, cases, preserved code and prices, incomplete stream completion, malformed and oversized formulas, and disabled untrusted commands. Electron screenshots cover light/dark themes and a narrow window; the acceptance checks local font loading, thinking-block math, centered display formulas, horizontal scrolling confined to the formula with both ends accessible, and continued rendering after an invalid formula.

These are isolated renderer/protocol checks, not new real-model or installer lifecycle acceptance. Installation, upgrade and uninstall gates were not rerun for this frontend change. Screenshots are local evidence under `Desktop/test-results/math-*.png`. The first implementation supports dollar delimiters, not `\(...\)` or `\[...\]`; it is not a full LaTeX document compiler.

## Composer Attachments and Image Preview

The 2026-09-30 local preview was packaged at `Desktop/release/attachments-anchored-preview/`. Type checking, 22 tests, the production build and packaged Electron acceptance passed. Isolated fixtures cover file import through preload, document drop, synthetic clipboard image paste, image panning and Ctrl+wheel zoom, anchored expansion, close-during-drag reset, keyboard/focus return, reduced motion, localized image menus and adding transcript images back to the composer.

Image action acceptance substitutes clipboard writes, save dialogs and Explorer launch to avoid touching the user's clipboard or opening foreground windows. It validates the clipboard image payload and saved/cache bytes; it is not unattended OS clipboard round-trip or real-model acceptance. Other documents are local path references for agent tools, not native Word/PPT parsing. No installer, upgrade or uninstall gate was rerun for this frontend change.

Explorer image copies now live in userData `cache/image-previews/`, separate from the application data root. Acceptance verifies lazy directory creation, repeated reveals reusing the same format-specific cache file, and no image cache write to the data root. Existing root-level copies from earlier preview builds are not automatically deleted.

## Desktop Credential Storage

Step login previously wrote the access credential into readable `step-runtime/auth.json`. The desktop now loads that file once, stores a Windows `safeStorage` encrypted snapshot as `auth.dpapi`, then removes the plaintext file. The staged Step runtime uses a desktop-only in-memory auth backend; the renderer never receives the credential. If Windows encryption is unavailable, the ciphertext cannot be unlocked, or a nonempty legacy auth file exists, startup fails closed rather than falling back to plaintext. Normal uninstall removes the desktop Step credential files; upgrades retain them, and the app is configured to retain its user data. This does not encrypt MCP secrets in `config.toml` or protect against processes running as the same Windows user.

The isolated fixture test covers ordinary upstream plaintext persistence and desktop child-process memory storage. `scripts/verify-auth-vault.mjs` covers Electron migration, login, logout and relaunch with fixture credentials; that script uses no real Step account. The disposable Windows VM candidate-install acceptance is recorded in `docs/acceptance/issue-5/README.md`; a separate real-account model pass is recorded below. Neither establishes every public-release gate.
The VM acceptance confirmed that normal uninstall removed the three desktop credential files and retained a test session. It did not create an independent workspace, so workspace survival was not verified. The migration used two builds both labeled `0.1.0`, so it is build-to-build migration evidence rather than a formal version upgrade. An empty `%LOCALAPPDATA%\\Programs\\Desktop for Step Code` directory after uninstall is harmless residue, not a credential-cleanup failure; no custom recursive removal is planned.

## Independent Home

Recorded local build: `Desktop/release-home/`. Startup and the global new-session button create an independent session with a unique working folder under Electron userData `workspaces/independent/`. Project buttons create project sessions. Independent history stays independent on restore and runtime restart; restoring history does not add a project. The composer exposes the working folder and an optional project picker. Acceptance covers first-run and repeat launch, fresh empty drafts, independent history restoration, project selection and existing UI regressions; all five protocol tests pass. These checks use temporary profiles and fixture histories, not paid-model acceptance.

## Themed Select Menus

Recorded local build: `Desktop/release-select/`. All six selects (model, thinking, login profile, theme, language and MCP transport) use Chromium customizable select rendering with application colors, rounded menus and checked indicators. Electron 44 supports `appearance: base-select`; menu placement remains in the browser top layer with built-in keyboard behavior. Acceptance checks cover light/dark menu screenshots, keyboard open/Escape, bottom-edge option geometry and existing settings workflows. Model menu screenshots use an isolated profile without live credentials.

## Startup Workspace (Historical, Superseded by Independent Home)

Recorded local build: `Desktop/release-startup/`. Startup connects the last selected workspace (or the first remembered workspace) and explicitly starts a fresh session. The first renderer snapshot waits for initialization so model and message state arrive together. No remembered workspace retains the project picker; connection failures retain the picker and report an error. Typecheck, five protocol tests and Electron acceptance passed, including an empty startup session and enabled composer without selecting history. Model availability remains controlled by upstream account/configuration; isolated acceptance does not verify a paid model.

## Workspace Session Tree

Recorded local build: `Desktop/release-tree/`. Sidebar history is grouped under remembered working directories, with an independent-session section for history whose directory is not remembered. Project entries are never created from session history alone. Collapse controls and per-directory new sessions remain; the separate session list and search are removed. Acceptance includes an isolated unassigned session and verifies it does not create a project entry. Fixtures do not establish real-model acceptance; empty sessions still follow upstream deferred persistence.

## Product Icon

Recorded local build: `Desktop/release-brand/`. The canonical SVG matches the supplied StepCode.svg byte-for-byte. The empty state uses it; the duplicate sidebar brand header was removed, and the titlebar identity was later replaced by a sidebar toggle. Multi-resolution Windows icons are generated from that SVG and included in the executable, window, installer and uninstaller. The desktop shortcut had an explicit ICO path during that acceptance. Typecheck, production build and packaged Electron acceptance passed; screenshots and the icon extracted from the EXE were visually checked. This does not add any real-model acceptance evidence.

## Custom Window Chrome

Recorded local build: `Desktop/release-window/`. Windows uses a frameless Electron window with a theme-aware 46px titlebar, native draggable region and explicit minimize/maximize/restore/close controls. The close control delegates to the existing task-aware close flow. The titlebar project icon has since been replaced by a sidebar toggle, and File, Edit, View and Help menus were added alongside it (see Native Menus and Sidebar Motion). Reference implementation inspected: local Oh-DSH `src/main.ts` and `src/client.ts`. Electron checks cover minimize, maximize and restore plus existing layout/streaming regressions. Native drag, edge resize and Windows snap interactions still need manual acceptance.

## Layout Refinement

Recorded local layout build: `Desktop/release-layout/`. Sidebar spacing is consolidated, transcript and composer share a layout column, short user messages are content-sized, and composer height grows with input. No runtime behavior or assets were changed. Type checking, build, Electron workflow/streaming regression, and wide/narrow layout checks passed. Layout screenshots use explicitly injected test messages in an isolated profile, not a live model conversation.

## Streaming White-Screen Fix

The renderer incorrectly expected cumulative `message` snapshots on RPC `message_update` events. Upstream emits `assistantMessageEvent` deltas instead. The renderer now accumulates text/thinking/tool-start events and uses `message_end` as the final authoritative snapshot. An error boundary provides a reload action instead of a blank screen.

Regression checks include unit coverage and actual Electron renderer delivery of text and tool-start wire events without a `message` field. The updated executable and installer for that check were in `Desktop/release-fixed/`. Those builds did not persist renderer crash logs; startup and runtime crash logging was added later. This diagnosis was established from the protocol implementation and regression tests, not a recovered crash log.

## Install, Upgrade and Uninstall Residue

`scripts/verify-residue.mjs` snapshots the machine, installs, launches once, uninstalls, snapshots again, and reports what survived; an `upgrade` variant installs v1, launches it so it produces real userData, installs v2 over it, launches again, then uninstalls.

Verified on a development host, not a clean machine: install and uninstall both complete with exit 0; the install directory loses every file (an empty root directory remains, which is NSIS behaviour); both shortcuts, the registry uninstall entry and the registry app key are removed; userData is retained as `deleteAppDataOnUninstall: false` intends and holds no credentials because no login was performed. Across v1 → v2 the userData file set is unchanged (0 missing, 0 emptied, 0 modified) and the install directory matches a fresh v2 install rather than v1 + v2, with one registry uninstall entry rather than two. `~/.stepcode` was compared per-file across the whole window: 248 files, no add, no remove, no change.

The verdict is checked in both directions. In the installed state the rows fail as they should; deleting `userData\preferences.json` before the over-install makes the userData rows fail and names the file. Launch is observed through process liveness rather than a fixed sleep. Note that v2 recreates a deleted `preferences.json` on first run, so survival is judged on the pre-launch snapshot as well.

## Responsive Sidebar

PR #7. The sidebar auto-collapses on narrow windows. Typecheck, five protocol tests, production build and Electron acceptance passed with isolated fixtures; no paid-model execution was used.

## Performance Bar

PR #8. Run timing, tool count, token usage and cache metrics appear beneath the composer, plus session totals from Step Code's existing stats RPC. Typecheck, 7 tests, production build and Electron acceptance passed with isolated fixture data. No paid-model execution was used.

## Native Menus and Sidebar Motion

PR #13. The titlebar project icon is replaced by a sidebar toggle alongside File, Edit, View and Help menus wired to existing actions, the window bar is 46px, and sidebar collapse, expansion and responsive threshold changes animate with cubic easing while respecting reduced-motion preferences. Typecheck, nine tests, production build and Electron acceptance passed.

## Real-Account Acceptance

The feature-level integration checks above use isolated fixture profiles; the development-host residue check and the disposable-VM candidate-install pass are separate, as described in their sections. This section records a further pass against a real Step Plan account outside that VM, run by driving a packaged build through Playwright with sign-in completed manually in a browser. It was not unattended CI.

Browser authorization completed and the account reported `step_plan · valid`. A pre-existing legacy `auth.json` was migrated to `auth.dpapi` and removed on first launch; no plaintext `auth.json` persisted.

One coding task completed end to end on the `step-5-preview` model using the desktop's tool-approval flow. The desktop's token total matched the runtime's `get_session_stats`, including cached tokens.

## Startup and Runtime Crash Log

The main process installs handlers for `uncaughtException`, `unhandledRejection`, `render-process-gone` and `child-process-gone`, and records a startup phase at runtime staged, vault loaded, admin started, rpc started and window created. Each failure writes one file into `%APPDATA%\Desktop for Step Code\logs\` named `crash-<timestamp>-<id>.log`, holding the app version, whether the build is packaged, the phase at failure, the error and its stack, and the userData and logs paths; the write goes through a temp file and rename and stays silent when it fails, because a crash handler that can crash is worse than none. The ready-path failure keeps its existing dialog-and-quit behaviour and only gains a file written first, so no startup outcome changes.

`RpcProcess` now attaches the child exit code and a redacted stderr tail to both the runtime-exit error and its event, so an unexpected Step Code runtime exit is recorded with them; lines that look like credentials or environment values are dropped before anything reaches disk, since upstream stderr can echo them.

Acceptance uses a real failure rather than a mock: `scripts/verify-crash-log.mjs` migrates a fixture credential into `auth.dpapi`, then writes a conflicting plaintext `auth.json` so `vault.load()` refuses to start, and asserts that the crash log names that error and the phase while never echoing credential values. It runs in the Windows integration check after `verify-electron.mjs`.

## Passed Locally

- TypeScript checks and production renderer/main/preload build.
- JSONL byte-boundary decoding, including split Chinese characters and CRLF.
- Isolated child environment: provider key and legacy auth path overrides are not inherited.
- Staged Step Code RPC handshake, message/model queries, and management process startup.
- MCP config round trip with secret values omitted from management responses.
- Real Step Code runtime against a local deterministic SSE fixture: streaming, completed message, persisted session discovery, rename, new session and restored history. This is a protocol test, not a real model quality test.
- The local SSE fixture also requests an actual upstream `write_file` call: Step Code emits its permission confirmation, the test client approves, and the temporary file content is verified.
- Electron source launch and packaged executable: isolated user directory, account settings, workspace connection, rename, MCP save, theme switching, narrow window, no renderer Node access, no renderer exceptions.
- Windows x64 NSIS installer generated.
- Native File, Edit, View and Help menus, and animated sidebar transitions.
- Real Step Plan sign-in, encrypted credential with no plaintext `auth.json` at any point, one real coding task with tool approvals, and token agreement between the desktop's accumulation and `get_session_stats`.

Screenshots and ephemeral test output are in `Desktop/test-results/` (ignored by Git).

## Cross-Session Tools Preview

Recorded local builds: initial `Desktop/release/cross-session-preview/win-unpacked/`, then `Desktop/release/session-reference-preview/win-unpacked/` with sidebar reference copying. Desktop supplies three extension tools for listing resident sessions, reading another resident session's recent prose, and delivering one user-approved message. The Electron main process owns the loopback broker and per-worker bearer tokens; renderer access and upstream source changes are not required.

Typecheck, 74 unit tests and the production build passed after adding session references. Source concurrency, Electron, theme-bootstrap and isolated auth-vault checks passed for the initial preview, along with packaged Electron acceptance. The reference preview passed source and unpacked `scripts/verify-cross-session.mjs` against real Step Code RPC workers and a deterministic local SSE fixture. Cross-session coverage includes tool registration, reads without navigation or unread-state changes, source-scoped deferred approval, cancellation, idle delivery, busy-session queueing, read-only rejection, peer provenance, aborted confirmation cleanup, narrow layout and English confirmation. Reference coverage includes Chinese/English context-menu labels, copying a background session without navigation or unread changes, and passing the copied reference directly to read/send tools. Clipboard writes are intercepted in the isolated test process so acceptance does not replace the user's real clipboard.

Reads include only bounded user/assistant prose from resident sessions, not reasoning or tool payloads. Recycled history must first be opened in Desktop. Each send requires separate approval even in bypass mode; approval grants delivery, not authority to obey peer instructions or continue an automatic conversation. These tools do not lock files or guarantee conflict-free shared-workspace edits.

Screenshots are in `Desktop/test-results/cross-session-{read,approval,narrow,english}.png` and `Desktop/test-results/session-reference-menu.png`. Session references are identifiers for these tools, not registered Windows deep links in this preview. This pass did not use a paid model or a real account and did not test installer lifecycle. Fixture success establishes the transport and approval behavior, not autonomous collaboration quality.

## Session Branching Preview

The 2026-10-03 source follow-up connects sidebar Branch to a main-process `cloneSession` action. Management uses the upstream `SessionManager.forkFrom` API to copy saved history before a worker restores it; cold originals therefore remain byte-for-byte unchanged even when the runtime would otherwise append a thinking-level entry. New workers verify the copied session identity and preserve effective permissions. Resident sources are idle-checked and locked, while other tasks continue. Failed worker preparation removes its owned copy, not the original.

Type checking, 111 unit tests, the production build, general Electron acceptance and real-RPC concurrency acceptance passed. The extended source branching acceptance verifies cold copies with a latest user message and metadata leaf, retained images and source bytes, original parent linkage, draft preservation, unknown IDs, busy-target menu/API rejection, resident permission inheritance and branching another idle session while the viewed task continues running. Existing latest-reply clone, inline editing and explicit fork regressions remain included. Archive acceptance also passed with the updated runtime adapter. Screenshots include `Desktop/test-results/branch-sidebar-menu.png` and `branch-sidebar-created.png`. This follow-up was not packaged.

The subsequent 2026-10-03 preview at `Desktop/release/archive-branch-preview/` packages this follow-up together with archive management and turn dates, using the staged `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime. The unpacked executable passed general Electron, session branching and archived-session acceptance with isolated profiles. The bundled admin adapter matches the source SHA-256. The desktop shortcut now targets this preview. Its installer is about 144 MiB and the unpacked application about 537 MiB; installer SHA-256 is `c80fde9ce7c4ddfc8ae6007ce5e35ec86e1cd7a0d55b9a6da1518a07343799c7`. No installer lifecycle or new paid-model acceptance was performed. Older packages were inventoried and retained, not deleted.

The corrected 2026-10-02 preview at `Desktop/release/session-edit-preview/win-unpacked/` passed type checking, 89 unit tests, production build, source and packaged Electron acceptance, and source and packaged `scripts/verify-session-branching.mjs`. Source concurrency and cross-session tool regressions also passed.

The latest saved Agent reply clones the full current history into a new conversation. The latest saved user message's pencil opens an inline editor with Cancel and Send; opening or cancelling does not change history. Sending navigates before that question and resubmits the edited text with the original images in the same session and worker. Earlier user messages cannot be edited. Stable active-history entry IDs identify branch and edit points; stale, ambiguous, forged and busy-source requests are rejected. Explicit branches use a separate worker, retain the original worker and conversation, and inherit permissions. Editing preserves the ordinary composer draft and permissions; a rejected submission that appended no user turn restores the original saved history. Neither operation rolls back workspace files or isolates the working directory.

Acceptance covers duplicate questions, first-question retry without old context, unchanged clone source history, inline focus/cancel/send, same-session and worker identity, background runs remaining active, read-only permission inheritance, distinct branch names, persisted edited history after worker restart, images, ordinary draft preservation, narrow/dark layouts and English controls. Evidence is in `Desktop/test-results/branch-{latest-reply,edit-inline,edit-dark-narrow,reopened-dark-narrow}.png`. These checks use real staged Step Code RPC with an isolated deterministic local SSE fixture, not a paid model or installer lifecycle acceptance.

The inline editor reuses the quote preview's compact 4px trackless scrollbar; checks cover hidden native scrollbars, keyboard limits and wheel scrolling. The quote interaction regression also passed. Submission recovery is covered by transport unit tests, while edited-draft retention across temporary history removal and restoration uses an injected IPC failure fixture; neither establishes recovery from every possible runtime or provider failure.

## Context Inspector Design Preview

The 2026-10-04 source preview adds Context as the second right-rail action, between Summary and conversation navigation. It reads existing snapshot messages, session statistics and runtime state through the typed preload bridge; no new upstream or IPC capability is added. The panel shares Summary's gutter-first docking and remains nonmodal in narrow windows. Summary's automatic opening rule is unchanged.

Context occupancy and cost are labelled estimates, not exact provider-request size or billed cost. Cumulative session usage is separate from the latest assistant response. Optional reasoning usage is shown as a subset of output; unknown values remain unknown. Message-category counts describe messages, not per-role token proportions. Expandable JSON is a bounded, whitelisted display projection with image bytes and named credential fields omitted and common credential strings redacted; it is not the final provider request or a complete arbitrary-text secret detector.

Type checking, 114 unit tests, production build, Context presentation acceptance, Summary regression and general Electron acceptance passed. The Context check uses an isolated deterministic snapshot fixture, not a paid model or the user's real session statistics. It covers role filtering, JSON disclosure/copy with clipboard interception, missing statistics, light/dark themes, 900/640-pixel nonmodal layouts, keyboard dismissal/focus and reduced motion. Screenshots include `Desktop/test-results/context-panel-light.png`, `context-panel-detail-dark.png`, `context-panel-narrow.png` and `context-panel-small.png`.

This preview was not packaged. The desktop shortcut still launches the previously recorded hanging-summary package; neither the source-only overlay-input fix nor Context is included there. No installer lifecycle or new real-model acceptance was performed.

The capacity-color follow-up applies a fixed 0-100% scale to occupancy text and filled ticks only: subdued green below 40%, neutral from 40-60%, then increasingly saturated red up to 100%. Light and dark surfaces use separate lightness values; zero and unknown remain neutral. The final tick is fractionally filled, and over-capacity values retain their real text while meter fill and color stop at 100%. Cumulative tokens, cost and role colors remain unchanged. Type checking, 115 unit tests, production build and Context presentation acceptance passed, including 7.1/50/80/95/0% in both themes and unknown-state restoration. Capacity screenshots are `Desktop/test-results/context-capacity-{light,dark}-{7.1,50,80,95}.png`. This follow-up is also source-only.

The subsequent 2026-10-04 package at `Desktop/release/context-inspector-preview/` includes this inspector, capacity colors and the previously source-only Summary overlay-input fix. Its unpacked executable passed Context presentation, general Electron and Summary board acceptance with isolated profiles. The bundled runtime manifest remains at `519e4de4ed2162d3667be1821cb92ada6b884e5a` with Node v24.15.0; staged admin/session helpers match current source hashes. The desktop shortcut now targets this preview. Installer SHA-256 is `ba7ebf5de9685a142fb71719253134aec4491e84fe286e53cc1d2d7c930cb910`; installer and unpacked app total about 681 MiB. Earlier source-only statements describe their respective checkpoints and are superseded by this package. Historical preview packages were inventoried and retained, not deleted. The installer was not run, and no new paid-model acceptance or public release qualification was performed.

The subsequent source-only visual-unification pass makes native scrollbars 4px, trackless and arrow-free across the app, preserving native wheel/keyboard/drag behavior and existing hidden-native/custom scroll surfaces. The main conversation thumb now also uses the quote's 4px width. Context and conversation navigation share the `right-panel-enter` animation with 260ms cubic ease-out (`.22, 1, .36, 1`); Summary's existing quadratic board/layout animation is unchanged. Navigation keeps its header stationary while its list scrolls. Type checking, 115 unit tests, production build, Context presentation, general Electron and quote interaction acceptance passed. The Context fixture additionally checks native scrollbar styles on the panel and JSON, identical Context/navigation motion, a 36-turn navigation list with real wheel input, and reduced-motion suppression. Updated screenshots include `context-panel-detail-dark.png` and `right-panel-navigation-trackless.png`. This follow-up is not in the desktop shortcut's package.

The subsequent 2026-10-04 package at `Desktop/release/right-panel-polish-preview/` includes that visual-unification pass. Packaged Context presentation (including navigation motion and scrollbar styles), Summary board and general Electron acceptance passed with isolated profiles. The bundled runtime remains the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` baseline with Node v24.15.0; staged admin/session helper hashes match source. The desktop shortcut now targets this unpacked executable, superseding the previous source-only package status. Installer SHA-256 is `d9045a895832df108c1634bc49251bd10a57fff937979609d97afa7d2634a1df`; installer plus unpacked app total about 681 MiB. The 22 preview directories total about 13.56 GiB and were inventoried without deletion. The installer was not run, the user's app was not automatically launched, and no paid-model or installer-lifecycle acceptance was added.

The subsequent source-only navigation-anchor fix removes the outgoing Summary/Context docking reservation immediately when conversation navigation or file details replaces it. Previously navigation mounted before that still-closing flex track, placing it roughly 306 CSS pixels away from the rail in the docked fixture before it slid back. The replacement panel now owns its width without inheriting that displacement; navigation retains its cubic entrance and ordinary Summary opening/closing remains quadratic. The extended Context acceptance samples every animation frame for Context-to-navigation, Summary-to-navigation and an interrupted Context opening, requiring the reserve to be zero and the navigation edge to remain within its own 8px entrance of the rail. Evidence is `Desktop/test-results/right-panel-switch-frames.json` and `right-panel-navigation-anchor-fixed.png`. Type checking, 115 unit tests, production build, Context, Summary and general Electron acceptance passed. This fix is not yet included in the desktop shortcut's package.

## Per-Turn Changes Design Preview

The 2026-10-04 source-only preview appends an unframed change ledger after each completed response's content and before its copy/branch/time footer. Active responses do not show the ledger or parse their patches on each text delta. Every historical response retains its own tool records. A three-file initial list expands to all recorded files; opening a row reveals a local read-only unified diff with old/new line numbers, syntax highlighting, excerpt copying, trackless scrollbars and reduced-motion support. Repeated edits to one file remain selectable operations, and aggregate counts are explicitly per-edit totals, not a synthesized net workspace diff.

The renderer consumes successful paired tool-call/result messages through the existing bridge. The pinned runtime's edit tool persists a standard patch in `ToolResultMessage.details.patch`; no upstream checkout, runtime staging, filesystem access or new IPC handler was added. Parsing uses `diff` 8.0.2 and highlighting uses the existing transitive version of `highlight.js`, now declared directly at 11.11.2. Invalid, multi-file or oversized patches are excluded. Known file-mutation calls without a usable patch mark the visible ledger as partial. Unstructured Shell modifications and whole-file writes without before-images are not captured, so complete turn-wide attribution is not claimed. No Git repository view, undo, checkout or filesystem write is implemented by this preview.

Type checking, 121 unit tests, production build and general Electron acceptance passed. `scripts/verify-turn-changes.mjs` uses isolated tool-result fixtures and a live renderer `agent_end` event, not paid-model editing. It checks end-only appearance and placement, reopening history, four-file previews, repeated-operation selection, excerpt copy with clipboard interception, highlighting, partial records, Chinese/English controls, 640-pixel containment and native horizontal-keyboard scrolling, scrollbar styling and reduced motion. Screenshots are `Desktop/test-results/turn-changes-light.png`, `turn-changes-summary-detail.png`, `turn-changes-preview-detail.png`, `turn-changes-dark-detail.png` and `turn-changes-narrow.png`.

This preview was not packaged; the desktop shortcut remains at the previously recorded right-panel-polish package. The screenshots are presentation examples, not proof of comprehensive real-world file-change capture. No new large package or public release was produced.

## Recorded-Change Undo Preview

The 2026-10-04 follow-up places Undo immediately to the left of the turn's aggregate +/- counts. File rows and the additional-files control no longer have disclosure arrows; whole-row clicks and keyboard activation still reveal previews. Undo opens a focus-trapped, cubic-animated confirmation dialog, with a red confirmation button in both themes and a neutral transcript entry. Cancel and Escape preserve files and return focus; successful undo changes the entry to Undone while retaining the original diff and conversation history.

Electron captures eligible completed turns from its own worker messages at `agent_end`, not from renderer-supplied paths or patches. A bounded Desktop-owned recovery record under `userData/turn-undo` stores reconstructed pre-edit UTF-8 file content and hashes of the captured post-edit versions. Reverse patches require exact recorded positions without fuzzy relocation. Old histories without captured records cannot create a baseline by requesting undo. Typed IPC accepts only resident runtime identity, the exact edit-ID list and a short-lived single-use confirmation token. Read-only sessions cannot prepare or execute undo. The main process checks for running same-directory workers, temporarily excludes new Desktop mutations and peer deliveries, checks all files before writing, and rechecks each open file's version and identity immediately before its write. Paths outside the workspace, `.git` internals, symlinks/junctions, hardlinks, binary files and oversized records are rejected.

This is recorded-edit undo, not a filesystem transaction or a whole-turn rollback. Shell/external operations and writes without usable patches remain outside its scope. A changed file blocks the batch before its first write when detected during preflight. External programs do not participate in Desktop's mutation exclusion: a race during writing or an I/O failure can leave a partially restored batch. The durable recovery record is marked failed before writes and retained for inspection; it is not automatically rolled back over potentially newer edits. Complete cross-process atomicity, comprehensive capture and automatic recovery are not claimed.

Settings > General includes Create changes and undo example. Each invocation creates a separate demo workspace and real saved session under Desktop's independent-workspace root, with no model request or credential/profile migration. It includes a two-edit file that can actually be restored, plus a previous turn deliberately followed by another file change so its undo is blocked. Recreating the example does not reset or overwrite earlier demos or project files.

Type checking, 128 unit tests, production build, source and packaged general Electron/Context/Summary/change-ledger acceptance passed. Source and packaged `scripts/verify-turn-undo.mjs` additionally cover a real upstream edit over deterministic local SSE and its `agent_end` capture, actual file restoration, confirmation cancellation/Escape/focus, a file changed after confirmation, repeated-edit reversal, unchanged history, persistence after reload, repeatable demo sessions, forged identity/token rejection, read-only rejection, exclusion of a running cloned same-workspace peer, Chinese/English, light/dark and 640px layout. This uses isolated profiles and a local provider fixture, not a paid model or the user's real files. Screenshots include `turn-undo-demo-light.png`, `turn-undo-confirm-{light,dark,narrow}.png` and `turn-undo-completed.png`.

The package at `Desktop/release/turn-changes-undo-preview/` includes this follow-up, the previously source-only ledger and navigation-anchor fix. The desktop shortcut targets its unpacked executable. Installer SHA-256 is `fe3beb8ede23085373c16134b9dca3ad69df09e05ae087203e2350e77038d2a8`; installer plus unpacked app total about 682 MiB. The staged and packaged runtime retain the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` baseline and Node v24.15.0; the Node hash matches its manifest and both Desktop helper hashes match source. Full staging was blocked by the in-use Node executable; only the changed management helper was synchronized, without stopping the user's workers or modifying the upstream checkout. The 23 preview directories total about 14.23 GiB and were inventoried without deletion. The installer was not run, the user's app was not automatically launched, and no new paid-model, installer-lifecycle or public-release qualification was performed.

### Live File List And Navigation Exit Follow-Up

The subsequent 2026-10-04 source-only follow-up puts the running turn's recorded file count and accumulated +/- totals at the center of the existing composer auxiliary strip, alongside quotes on the left and return-to-bottom on the right. Its anchored, cubic-animated native popover lists filenames and per-file counts only. It contains no code preview, undo, file-disclosure actions or link to a new right-side diff panel. Completion removes the live control without changing strip height; the existing completed-turn ledger and its inline previews take over. A cached parser reuses completed tool results across prose deltas; counts retain the ledger's recorded-patch scope and do not claim a net repository diff.

File rows now inset their ordinal and totals by 10px (8px in narrow windows). Conversation navigation retains its right-rail anchor while entering and exiting with 260ms cubic transitions, remains inert during exit and unmounts afterwards; rapid reopen cancels removal and reduced motion skips the exit delay. Summary's approved quadratic motion is unchanged.

The production example entry, preload method and management seed handler were removed. Undo acceptance now creates test-only sessions through real RPC tools in isolated temporary workspaces. No automatic deletion migration was added. Previously generated examples in the real user profile have not been deleted because the user is still running the older preview that owns them.

Type checking, 129 unit tests, production build, source general Electron, Context/navigation, Summary, quote interaction, change-ledger/live-list and real-RPC undo acceptance passed. Navigation checks sample intermediate exit opacity and shrinking dock reservation, interrupted reopen and reduced-motion removal. Live-list checks cover centered same-row alignment with a quote and return button, 640px containment, no diff controls, and actual successful upstream edits before a held stream completes. Evidence includes `turn-changes-live-fixture.png`, `turn-changes-live-list-light.png`, `turn-changes-live-narrow.png`, `turn-changes-live-light.png` and `navigation-close-frames.json` in `Desktop/test-results/`.

This follow-up has not been packaged; the desktop shortcut remains on the previous undo preview. The staged admin helper matches source after removing its demo seed handler, and the pinned runtime baseline is unchanged. No new paid-model, installer-lifecycle or public-release acceptance was performed.

The subsequent source-only motion follow-up replaces the live popover's entry-only animation with 200ms cubic transitions in both directions. Discrete display/overlay transitions retain the native top layer during exit; positioning is preserved, closing content is inert, and interrupted reopen reverses smoothly. The centered chip also fades away on completion without changing auxiliary-strip height. Reduced-motion preferences remove both transitions and the chip's exit delay.

Live aggregate and per-file +/- counts use MIT-licensed `@number-flow/react` 0.6.2, pinned in the lockfile, with 220ms cubic rolling: additions upward, removals downward, including digit carry and interrupted rapid updates. Initial history renders without replaying old count updates. The component keeps current values available through its accessible name and respects reduced-motion preferences; it changes presentation only, not recorded patch counts or RPC data. Completed-turn previews and the deferred right-side diff feature remain unchanged.

Source motion acceptance samples actual native popover exit frames, anchored position, rapid reopen, completion opacity and stable strip height. It inspects the rolling component's actual digit animations for both directions, carry, repeated updates settling to the latest counts and no animation under reduced motion. Evidence is `live-popover-close-frames.json`, `live-summary-completion-frames.json` and `live-diff-counts-updated.png`. This motion follow-up has not been packaged.

The subsequent 2026-10-04 package at `Desktop/release/live-turn-motion-preview/` includes the live file list and enter/exit/count animations, navigation exit, row insets and removal of the production demo entry. Its unpacked executable passed general Electron, Context/navigation, Summary, change-ledger/live-motion and real-RPC undo acceptance with isolated profiles. Type checking and production build also passed; the previously recorded 129-unit-test pass remains current for these source changes. The desktop shortcut now targets this preview, superseding the preceding source-only package status. The running older application was not stopped; close it before using the updated shortcut.

The staged and packaged runtime remain at `519e4de4ed2162d3667be1821cb92ada6b884e5a` with Node v24.15.0. The upstream bundle matches the pinned built checkout, the Node binary matches its manifest hash and both packaged Desktop helpers match source. Full restaging was unnecessary. The new rolling dependencies' license notices are copied by the build script and were verified inside `app.asar`. Installer SHA-256 is `23e2a8b4ffd57289c99ff5bcb8a99bff6257745949a7382cd79d71dd20ea3cd5`; installer and unpacked application are about 144.29 and 537.23 MiB respectively. The 24 preview directories total about 14.90 GiB and were inventoried without deletion. Older real-profile example data remains untouched while its previous application is running. No installer execution, new paid-model acceptance or public-release qualification was performed.

## Right-Side Diff Preview

The 2026-10-04 source-only preview adds a +/- Changes entry to the right rail. Its source selector separates the last completed turn's recorded tool patches from a read-only Git branch comparison. The turn view excludes an active response and does not substitute an older changed turn when the latest completed response has no recorded edits. The branch view compares the selected base's merge base with HEAD against the current files, including committed, staged, unstaged and untracked changes. Branch mode is disabled outside Git, when Git is unavailable, and before the first commit.

Repository access stays in narrow main-process IPC handlers bound to resident runtime identities. Bounded Git subprocesses use no shell, disable external diff/textconv and optional locks, and remove inherited Git environment overrides. File previews reject forged paths and unsafe links; binary, oversized and known credential files have explicit restricted previews. Recognizable inline secrets are redacted, but exhaustive arbitrary-secret detection is not claimed. Submodules are excluded, renames appear as delete/add, and the displayed list is capped at 200 files. This panel has no staging, checkout, commit or repository undo controls.

The panel and file disclosures use cubic enter/exit motion with reduced-motion handling and trackless scrollbars. Summary's existing motion is unchanged. Type checking, 138 unit tests, production build and dedicated review acceptance passed. The latter uses a temporary real Git repository and actual upstream edit-tool calls through a local deterministic RPC/SSE fixture, not a paid model or the user's profile. It verifies differing turn/branch scopes, base changes, unchanged Git index/status, IPC guards, light/dark and narrow layouts, intermediate close frames and non-Git disabling. Screenshots are `Desktop/test-results/review-{last-turn-light,last-turn-detail,branch-light,branch-detail,branch-dark,branch-narrow,no-git}.png`.

No package, shortcut change, public release or new paid-model acceptance was produced.

The subsequent 2026-10-04 preview package at `Desktop/release/right-diff-preview/` includes the diff panel and the custom 14px rounded-stroke disclosure SVG. Source type checking, 138 unit tests and production build passed. The unpacked executable passed dedicated diff, general Electron, Context and Summary acceptance with isolated profiles and deterministic local fixtures. The desktop shortcut now targets this package; the user's older running application was not stopped. Close the old application before launching the updated shortcut.

The packaged runtime is byte-identical to the previously staged runtime, retaining manifest baseline `519e4de4ed2162d3667be1821cb92ada6b884e5a` and Node v24.15.0. Its Node hash matches the manifest and both packaged Desktop helpers match source. The current sibling upstream build has a different bundle hash and was deliberately not restaged; this package does not claim to update upstream. Installer SHA-256 is `28b2a992a70b751798202a3460a06a270765b2a82e330d9c65eb1b5380331e4d`. The new directory totals about 681.78 MiB; 25 preview directories total about 15.56 GiB and were inventoried without deletion. No installer execution, paid-model test or public-release qualification was performed.

The subsequent source-only follow-up replaces the review source/base HTML selects with Electron native radio menus while retaining the custom disclosure SVG on their buttons. The main process owns menu construction, validates the source selection, resident identity and coordinates, and derives base choices from Git rather than renderer-supplied labels. Branch remains selectable outside Git and after a failed Git query; the panel shows separate non-Git, no-commit and unavailable states without automatically switching back to Last turn. Invalid comparisons show neither a base selector nor misleading zero-change totals. Refresh preserves the selected source.

Type checking, 138 unit tests, production build, general Electron and dedicated review acceptance passed. Native menu construction, radio checks, selection and cancellation are exercised via main-process popup hooks; actual Windows menu rendering and OS-level pointer input are not established by these automated screenshots. The non-Git empty-state screenshot is `Desktop/test-results/review-no-git.png`. This follow-up has not been packaged; the desktop shortcut still targets the preceding preview.

The subsequent source-only navigation refinement shares the `right-panel-header` primitive across Context, Changes and Conversation navigation. Navigation uses Context's 344px neutral full-height surface, divided rows, 52px header and 26px action buttons rather than the older 300px sidebar-style panel. It consumes the existing right gutter before reserving layout space, overlays without an input-blocking backdrop in smaller windows, and preserves original per-turn timestamps, trackless scrolling and cubic enter/exit. Summary's hanging treatment and motion are unchanged.

Type checking, production build, general Electron, Context/navigation and dedicated diff acceptance passed after this refinement. Context/navigation checks compare the actual surface/header geometry, verify visible transcript wheel input and composer focus while navigation remains open at 640px, and sample close, rapid reopen and reduced-motion behavior. Screenshots are `Desktop/test-results/navigation-unified-{dark,light,narrow}.png` and `navigation-unified-detail-{dark,light}.png`; their conversations are isolated presentation fixtures. No new package or shortcut change was made.

The subsequent 2026-10-04 package at `Desktop/release/right-panel-unified-preview/` includes the native review menus, selectable non-Git branch state and navigation/header visual unification. Type checking, 138 unit tests and production build passed. Its unpacked executable passed general Electron, Context/navigation, diff and Summary acceptance. The Summary regression script was updated to dismiss navigation with its header action rather than the removed modal backdrop. Menu radio construction, selection and cancellation still use main-process test hooks, not OS-level pointer automation.

The desktop shortcut now targets this package; the prior running application was left untouched. Runtime bundle and helper hashes are identical to the previous staged package, and Node matches its manifest hash. Installer SHA-256 is `a73f6b5ffdba8bf3d15792b1bff06e07dfabd63679bffe667418f80b4d72f0ab`. The new preview directory totals about 681.79 MiB; 26 preview directories total about 16.23 GiB and were inventoried without deletion. No installer execution, real-profile migration, paid-model test, commit, PR or public release was performed.

## Release Boundary

### Links, Deliveries and File Preview

The 2026-10-07 preview adds icon-bearing web links with hover-only dashed underlines and bounded metadata cards, delivery references collected from the current turn, and built-in opening of web links and local HTML. An independent read-only File Preview panel supports Markdown rendered/source modes, highlighted text, wrap, copy, refresh and a native file chooser. Standard/Wide width is persisted; fullscreen restores that underlying width.

The split opening control uses application-rendered anchored menus. Selecting an application opens once and updates the primary button's icon/name. Successful explicit choices persist per extension across reload and application restart without changing Windows associations. Unavailable associations fall back to the internal destination; the native other-application picker remains a one-time action. The deferred new-session model/thinking selector and sidebar hover/focus scrollbar were also corrected.

Source and packaged checks passed for links, deliveries, File Preview and general Electron behavior. File Preview tests exercise real file IPC, association enumeration and preference persistence, but intercept third-party application launches. HTML checks cover moving nonblank content, declared local assets, denied neighboring files, blocked external network, tab reuse and renderer isolation. Screenshots cover light/dark, narrow, wide and fullscreen layouts. These checks do not establish paid-model behavior, third-party editor compatibility or installer lifecycle acceptance. The Step Code upstream checkout and pinned runtime baseline are unchanged.

### Proposed Session and Greetings

The 2026-10-07 new-session page holds an in-memory proposal. Opening New inherits the viewed project, and the searchable picker offers remembered projects, a native directory chooser and independent mode. Leaving before the first send creates neither a worker nor a persisted conversation or independent folder. Model, permission and thinking selections are available before creation.

The Chinese heading starts with `让梦想阶跃星辰`, then types and deletes local-time, weekend and common greetings, with a low-frequency developer motto `踽踽而行 步履不停`. Text centers independently of the cursor. Composing holds the current complete phrase; reduced motion displays static text. English retains its smaller existing corpus; expanded English copy is deferred. Project choices show at least five rows where window space permits.

Assistant message footers, including copy, branch, total elapsed time and timestamp, appear on hover or keyboard focus with an opacity transition. Touch devices retain visible controls. Elapsed-time data is unchanged.

Dedicated isolated-profile acceptance covers proposal cancellation, project inheritance, native-directory selection through a test hook, first-send protection, greeting replacement and composing pause, light/dark/narrow layouts and reduced motion. Timing acceptance checks default hidden and hover-visible timestamps alongside ticking and frozen history. These fixtures do not establish paid-model or installer lifecycle acceptance. The staged runtime is reused without upstream checkout changes.

Type checking, 207 tests, production build and general Electron acceptance passed on the latest main baseline. The package at `Desktop/release/new-session-pr-preview/` passed dedicated new-session and timing acceptance. The ordinary desktop shortcut targets its unpacked executable. Installer SHA-256 is `909b8bd1229919df5d2f52578e54e1f3ef31ffb74db9b8a959019dac83517e3c`; its directory totals about 704.02 MiB. Running user windows and old packages were preserved.

### Runtime Summary Board

The 2026-10-07 Summary board replaces placeholder content with repository changes, the current session's active-branch task plan, actual MCP connection states and available Skills count. Repository information is hidden outside Git; its change link opens the branch comparison. MCP indicators are read-only. Skills have a count only. The original hanging-board layout and quadratic motion remain unchanged; internal disclosures use cubic enter/exit transitions and reduced-motion handling.

The pinned Desktop runtime integration adds a read-only `get_desktop_summary` RPC inside the live bundle. It reads the latest active-branch `step-tasks` record, the live MCP registry (including globally disabled servers) and the resource loader's Skills catalog. Desktop validates session identity and projects bounded presentation fields without exposing MCP configuration or credentials. Checklist completion reuses the subagent status motion, holds the completed row through its check animation, then folds it into the completed group. Historical completion does not replay that animation.

Type checking, 197 tests, production build, general Electron, dedicated Diff, Summary layout and real-runtime Summary acceptance passed. The latter uses an isolated profile, a temporary Git repository, disabled/failed MCP fixtures, one local Skill and a deterministic local provider that calls the real `task_update` tool. It verifies completion motion, branch-mode navigation, light/dark and narrow layouts, and clearing state after switching sessions. Screenshots are `Desktop/test-results/summary-runtime-{dark,completed,light,narrow}.png`. These checks do not establish paid-model behavior or installer lifecycle acceptance.

The local package at `Desktop/release/summary-board-preview/` passed packaged general Electron and real-runtime Summary acceptance. Packaged Node, Step Code bundle, manifest, both Desktop helpers and terminal host match staged/current resources. Runtime remains pinned to `519e4de4ed2162d3667be1821cb92ada6b884e5a`, Node v24.15.0, with the new Summary RPC integration patch. The normal desktop shortcut targets this package without demo arguments; the existing running application was preserved. Installer SHA-256 is `3fb50f4ffaefa2439eac27fc2d3f4ff68c267756b1b77b1074e5ffc1b0b3a355`. The new directory totals about 702.30 MiB; nine release directories total about 6.13 GiB and were inventoried without deletion. No installer execution, paid-model acceptance, commit, push or PR was performed.

The source-only follow-up adds 240ms cubic height/opacity entrance transitions for tasks created after the initial Summary snapshot. Existing tasks do not replay entrance when opening a session or reopening the board. Reduced motion disables the transitions. The real-runtime fixture calls `task_create` and samples intermediate height/opacity and final geometry alongside the existing completion checks. This follow-up is not yet included in the package above.

The subsequent package at `Desktop/release/summary-task-motion-preview/` includes that entrance follow-up and passed packaged real-runtime Summary acceptance, including intermediate cubic entrance frames, completion folding, no history replay and reduced motion. Packaged runtime files match the staged runtime; no runtime restaging was needed. The ordinary desktop shortcut now targets this package without demo arguments. Installer SHA-256 is `59a5825ab2b1a9220c286cf98a57e526ed437117d11078192a9836f27582d8a9`. Its directory totals about 702.30 MiB; ten release directories were inventoried without deletion. Existing running windows were preserved. No installer execution or paid-model acceptance was performed.

The PR #65 review follow-up consumes Summary-to-branch navigation after handling it, so a later direct Changes-rail opening retains its Last-turn default. It also recognizes any known non-completed task becoming completed, including a pending task whose intermediate running snapshot was missed. The task's status icon stays mounted across pending/running/completed states, preserving completion animation before folding. The real-runtime fixture verifies direct pending-to-completed animation frames, manual source selection, close/unmount/reopen via the rail and a second Summary navigation. These fixes are source-only and do not update the package above.

### Conversation Timing and Subagent Status Package

The subsequent 2026-10-07 source-only fix reconciles tool-result message start/update/end events by tool call ID with the existing execution-result slot. Upstream sends both execution completion and persisted message events; previously the second delivery temporarily rendered a duplicate chain until the final history refresh. Different call IDs remain separate even when results and assistant messages interleave.

Type checking, 187 tests, production build, subagent-status, conversation-timing and general Electron acceptance passed. The subagent fixture sends execution completion, message start and message end while the response is still streaming and verifies exactly three lanes without an agent-end refresh. Evidence is `Desktop/test-results/subagent-chain-completed-no-duplicates.png`. The existing package and shortcut have not been updated with this fix.

The follow-up package at `Desktop/release/conversation-status-dedupe-preview/` contains that tool-result reconciliation. Its unpacked executable passed subagent-status, conversation-timing and general Electron acceptance with isolated profiles; the fixture confirmed exactly three lanes across execution completion and subsequent message start/end events. The ordinary desktop shortcut now targets this package, including its own icon resource. The previous application under `conversation-status-preview` was left running. Runtime and helper hashes match the previously staged resources; no runtime restaging was performed. Installer SHA-256 is `017a5f8ff2a40d4139827f4959dd6e6d0648ca22a58eaef35c63973680670288`. No installer execution or paid-model acceptance was performed.

The 2026-10-07 local package at `Desktop/release/conversation-status-preview/` includes thinking-segment elapsed time, permanent response total time, subagent panel click-toggle, and compact rose-accent completion icons with shrink/hold/grow/check-draw motion. Source type checking, production build and 185 tests passed; the full test run used concurrency 1 because default parallel execution intermittently stalled in existing terminal tests.

The unpacked executable passed conversation-timing, subagent-status and general Electron acceptance using isolated profiles. These verify ticking/freeze, history/reload, themes/narrow layouts, status motion, reduced motion, click-toggle, real RPC startup and renderer isolation. Presentation fixtures do not establish paid-model or real subagent execution acceptance.

The ordinary desktop shortcut now targets this package. The running `send-queue-marker-preview` application was preserved; close that old window before launching the updated shortcut. Packaged manifest, Node, Step Code bundle and terminal host match staged resources; both Desktop helpers also match current source. Runtime remains at `519e4de4ed2162d3667be1821cb92ada6b884e5a`, Node v24.15.0, without restaging the separately maintained upstream checkout.

Installer SHA-256 is `7eacc82608a4e84eecc3040cda7d8e31a73f35c42ab040725a7162a8a891ccb1`. The package directory totals approximately 697.48 MiB; seven release directories total approximately 4.76 GiB and were inventoried without deletion. No installer execution, paid-model acceptance, commit, PR or public release was performed.

### PR #56 Review Follow-Up

The source-only review fix expands shared Diff redaction to common compound cloud credential assignments, including AWS access keys/session tokens and Azure client secrets/account keys in snake-case and camel-case. Both added and removed rows use the same redactor; ordinary fields remain unchanged. This remains bounded recognizable-credential redaction, not exhaustive arbitrary-secret detection.

Repository refresh failure clears the stored comparison, removing old files, totals, base metadata and open previews. File-preview requests clear their previous patch before loading and on failure. Dedicated Diff acceptance covers a previously opened file disappearing, recovery after restoring it, a selected temporary Git base disappearing, removal of stale UI and successful refresh after restoring the base. Unit coverage verifies cloud credentials in both sides of real Git patches. Type checking, 139 unit tests, production build, dedicated Diff acceptance and general Electron acceptance passed. This follow-up is not included in the desktop shortcut's existing fullscreen preview package.

### Main-View Inspector Expansion

The 2026-10-04 source-only follow-up adds a shared expand/restore header control to Context and Changes. The inspector expands leftward across the main view, retaining the sidebar, window bar and right rail. Both directions use cubic width transitions; reduced motion and native window resizing skip them. Content stays mounted, including selected source, message filters, JSON disclosures and diff previews. Covered transcript/composer controls are inert; Escape restores before closing. Switching tools clears expansion. Conversation navigation has no fullscreen control and now uses full-width row hit areas.

Type checking, 138 unit tests, production build, general Electron acceptance, Summary regression, Context/navigation and dedicated diff acceptance passed. Inspector checks use isolated fixtures, including sampled intermediate expand/restore frames, rail/sidebar anchoring, scroll preservation at tested positions, Escape focus return, dark/light themes, 640px containment, reduced motion and tool switching. The diff fixture also exercises real temporary Git state and upstream edit calls over a deterministic local provider. Its turn-preview keys no longer change when asynchronous Git metadata arrives. Screenshots include `Desktop/test-results/context-expanded-{light,dark,narrow}.png`, `diff-expanded-{light,dark,narrow}.png` and `navigation-full-row-hover.png`. These are fixture presentation evidence, not paid-model or real-profile acceptance.

This follow-up has not been packaged; the desktop shortcut still targets `Desktop/release/right-panel-unified-preview/`. Summary's special hanging-board motion and the staged runtime are unchanged. No installer execution or public-release qualification is claimed.

The subsequent 2026-10-04 package at `Desktop/release/right-panel-fullscreen-preview/` includes inspector expansion and full-width navigation hit targets. Type checking and production build passed; its unpacked executable passed Context/navigation, dedicated diff, general Electron and Summary acceptance with isolated profiles. The desktop shortcut now targets this package, superseding the source-only status above. The user's running application was left untouched.

Packaged Node, Step Code bundle and both Desktop helpers are byte-identical to the staged runtime; the helpers also match current source. Runtime retains baseline `519e4de4ed2162d3667be1821cb92ada6b884e5a` and Node v24.15.0. Installer SHA-256 is `e43b83e00e51ef281579cc9fe43ddaf812f64bcb749134ed3187f4c7409375da`. The preview totals about 681.79 MiB; 27 preview directories total about 16.89 GiB and were inventoried without deletion. No installer execution, paid-model acceptance, commit, PR or public release was performed.

### Deferred Approval Scroll-Hit Regression

The 2026-10-04 PR #53 CI follow-up fixes a real pointer-hit overlap: the full-height transcript scroll handle could cover the deferred-approval notice's Review button. The notice now owns a background and a layer above that handle, preserving the approved full-height scrollbar geometry. Cross-session acceptance checks pointer hits across the Review button and reopens the actual approval through ordinary clicks at 1320, 700 and 1600 pixels. Type checking, 129 unit tests, the production build, cross-session acceptance and general Electron acceptance passed locally after the fix. The regression uses isolated profiles and the local RPC/SSE fixture, not a paid model.

### Quote Presentation Polish

The 2026-10-02 local preview at `Desktop/release/quote-presentation-preview/win-unpacked/` passed type checking, 77 unit tests, production build, source and packaged Electron acceptance, quote interaction acceptance and the dedicated effort-picker fixture. Sent user messages unwrap only the exact Desktop quote-prompt format into framed excerpts plus the current reply; malformed or ordinary Markdown falls back unchanged. The model payload, message history, editing and full-message copy remain unchanged. Tests cover both languages, multiple and quote-only excerpts, nested Markdown, code fences, marker-like text and reply whitespace. Screenshots cover light/dark and narrow transcript layouts; clipboard writes are intercepted in the isolated process.

Effort labels now use the existing dark-theme palette in both themes. The light thumb is white with a softer shadow; dark styling is unchanged. The effort fixture verifies computed colors and white thumb fill alongside drag, wheel, keyboard and reduced-motion behavior. Evidence is in `Desktop/test-results/sent-quotes-{light,dark,narrow}.png` and `Desktop/test-results/model-effort-light.png`. No paid-model, installer lifecycle or public-release qualification was added.

The local preview can be tried now. The Issue #5 candidate install, build-to-build credential migration and normal uninstall passed in a disposable Windows VM; independent-workspace survival was not tested. Broader public-release qualification remains incomplete, so do not describe this as fully release-qualified. No release was published.

## POSIX runtime shutdown and HTML asset transport (2026-10-17)

RPC stop now disconnects requests immediately, joins concurrent stop calls and
prevents restart until shutdown completes. POSIX shutdown waits for process exit,
with a 2-second SIGTERM grace period and SIGKILL fallback; failure to exit after
the further 2 seconds is reported instead of allowing a replacement to overlap.
Late output/errors from the stopped child cannot affect its replacement.
Windows retains its existing taskkill tree termination path.

Local HTML transport converts only native directory separators to URL separators
and percent-encodes entry names by segment. POSIX literal backslashes therefore
remain distinct from nested paths, including manifest refresh/revocation.
Workspace boundaries, sensitive-asset exclusions, CSP and renderer isolation remain.

Typecheck, build and 457 unit/protocol tests passed (one existing Windows-only
skip). New process tests cover delayed cleanup, concurrent stops, restart guards,
SIGTERM-resistant children, late errors and actual Step runtime exit/restart.
Source and packaged file-preview acceptance verifies distinct script execution
in the isolated browser and checks that session restart leaves no old RPC child;
full undo acceptance also passes. All 1,258 packaged resources matched.

## Follow-up file identity and archived project review (2026-10-17)

Turn-change grouping, live readers, output paths, delivery inference and archived
project names now use explicit platform-aware identities. Windows retains case
and separator aliases; POSIX preserves case and literal backslashes. Main-process
turn lookup and undo capture use the same platform as the renderer. File-kind and
Markdown-reference case-insensitivity remain independent of filesystem identity.

Typecheck, build and 453 unit/protocol tests passed (one existing Windows-only
skip). Regression tests reproduce distinct literal-backslash/nested files and
verify both restore exactly, reject legacy collapsed undo records, retain case-
distinct delivery outputs and check archived project grouping/custom names under
macOS, Linux and Windows rules. Source and packaged Electron artifact, archive
and full undo acceptance cover this change; macOS CI includes archive acceptance
alongside the prior terminal/undo checks. Package verification checks all resources.

## macOS undo ownership and terminal scope review (2026-10-17)

Undo records and canonical file-path checks now use the shared platform-aware
workspace key: case is preserved on macOS/POSIX and folded only on Windows.
A prepared undo ticket cannot authorize a record owned by another root, including
a case-only root mismatch. Terminal renderer scopes and the native session store
use the same key, including preservation of literal POSIX backslashes.

Typecheck, production build and 446 unit/protocol tests passed (one existing
Windows-only skip). Added undo regressions reject root mismatches and relocated
confirmation tickets without modifying either workspace. Source and packaged
Electron terminal-scope fixtures restore both projects' controllers, verify
separate tabs/selection, and record input routed to the selected project only;
Windows fixtures retain case/separator aliases. Full undo Electron acceptance
passed in source and packaged apps, including real local fixture RPC edits,
confirmation, conflicts, persistence and same-workspace running-peer exclusion.
All 1,258 packaged resources matched. CI now runs undo and terminal-scope
acceptance on macOS source/package and terminal scopes in Windows interface CI.
The undo fixture canonicalizes its temporary profile to handle macOS /var aliases.

## macOS continuous sidebar animation (2026-10-17)

The titlebar sidebar surface now translates at the sidebar's full width using
its existing 280ms curve, instead of shrinking its background with the button
track and switching color immediately. Window controls keep their independent
positions. Inactive-window dimming applies only to the sidebar button so the
upper and lower sidebar surfaces remain the same color.

Window acceptance samples both opening and closing transitions frame by frame,
comparing the upper/lower right edges (within 1 DIP) and background colors.
Reduced-motion settings disable both surface transitions together. Source and
packaged window acceptance and package resource verification cover this change;
the earlier full-suite archive-notification timeout remains recorded below.

## macOS compact fullscreen toolbar (2026-10-17)

Window-state replies and events now include native fullscreen state. macOS uses
a 40px toolbar in fullscreen, removes the traffic-light inset, and places the
sidebar toggle 12px from the left edge in both expanded and collapsed states. Leaving fullscreen restores
the existing 52px toolbar and native control clearance. Windows styling is unchanged.

Typecheck, production build and 444 unit/protocol tests passed (one existing
Windows-only skip). Source and packaged window-toolbar acceptance passed for
expanded/collapsed fullscreen layout and restoration; 1,258 packaged resources
matched. The layout assertions simulate the state event for runners without
Spaces; native entry/exit was also exercised in the installed application.
The full source/package acceptance reached these new checks successfully but
then timed out at the pre-existing archive-feedback toast expiry assertion.
No release-readiness claim is made from this focused result.

## Desktop local-preview delivery (2026-10-17)

Session workers now append truthful Desktop presentation guidance alongside the
existing collaboration policy: work in the selected workspace, return clean
preview/file links, distinguish the built-in UI from available automation tools,
and do not guess internal endpoints or deploy without a user request.

Turn outputs now recognize loopback HTTP(S) previews in Markdown, prose and
standalone URL code blocks, including older responses with adjacent Markdown
emphasis. These cards open through the existing built-in browser and copy URLs;
they do not fetch/probe on discovery and never enter the artifact filesystem API.
External file boundaries, executable restrictions and missing-file filtering stay
in force. This does not add an agent GUI-control tool or repair misplaced files.

Local typecheck, production build and 444 unit/protocol tests passed (one existing
Windows-only skip). Artifact acceptance covers cards, URL-only history, browser
open dispatch, link copying, themes, narrow layouts and existing file boundaries.
A read-only regression against the reported local history recognized both of its
preview delivery responses; no user history or project files were rewritten.

## macOS Codex P2 follow-up (2026-10-17)

The native View menu no longer installs shell Reload/Force Reload accelerators;
Command-R inside web content still belongs to that browser tab. StepPage managed
command detection accepts both node.exe and extensionless runtime/node/node.
Workspace identity is shared between main, renderer and workspace mutations:
Windows folds case, macOS preserves it. Earlier Mac preview metadata migrates
only when its registered owner is unambiguous. macOS update settings explicitly
explain manual Releases downloads and omit unsupported check/channel controls.

Local typecheck, production build and 442 unit/protocol tests passed (one existing
Windows-only skip). StepPage startup acceptance covers missing and user-owned
configuration, idempotence and stale managed path refresh; macOS update acceptance
checks the supported Releases action and absence of inert controls. General
Electron acceptance adds native shortcut/draft preservation coverage. Native CI
now runs StepPage and macOS update checks against source and packaged apps.

## macOS rail corner and startup placement (2026-10-17)

The right tool rail retains its existing width and inspector priority, with a
10px upper-left corner and a thin top border at the titlebar junction. On macOS,
the separate startup window now uses explicit screen coordinates centered on
the display containing the pointer, instead of native window centering.
Windows placement remains unchanged.

Typecheck, production build, source and installed-package startup acceptance
passed. Startup coverage checks both axes against the native display bounds
(within 1 DIP), transparent pixels, reduced motion, isolated bridge-free splash,
main-window handoff and disposal. Installed-package general Electron acceptance
passed, and package resource verification matched 1,258 files. An initial source
general acceptance run timed out in the existing archive-feedback toast expiry
fixture; the subsequent installed-package run passed that fixture and the full
suite without application changes.

## macOS native window controls (2026-10-17)

The v0.5.0 macOS preview now uses Electron's native hiddenInset titlebar and
system traffic lights instead of the renderer's Windows controls. The sidebar
header shares the sidebar color, reserves the native buttons, and keeps its
collapse toggle usable when hidden. Application commands are grouped in an
upper-right ellipsis menu; the native application/Edit/View/Window menus remain.

Typecheck, production build, source and installed-package Electron acceptance
passed, including menu actions/Escape, sidebar collapse, native button position,
minimize/restore, light/dark themes, long-title containment at 640px and renderer
isolation. Package verification again matched 1,258 files. Native UI inspection confirmed
the actual system controls, green-button full-screen entry, Command-Control-F
exit and sidebar collapse/restore on the installed app. These checks do not
establish Windows regression or public-release qualification.

## macOS Apple Silicon Release v0.5.0 Port (2026-10-16)

This branch freezes the published v0.5.0 Release at
`6fedd4d1883e4d1beaf6f4599134695e13a9ba50`, as requested by the owner.
Later Windows main/PR changes and the separately maintained Linux branch were
not merged. Step Code stays pinned to `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`
with the existing release patch guards.

On this Mac mini (Apple Silicon, macOS 26.4), typecheck and the production
build passed. The final unit/protocol run passed 439 tests, with one existing
Windows-specific test skipped (440 total). This includes real local-fixture
Step RPC, auth isolation, CLM and context tests. Native zsh PTY testing covers
Unicode output in a directory containing spaces, resize, host shutdown and
cleanup. It passes against both staged development and packaged resources.

Source and packaged Electron acceptance passed: real runtime connection,
isolated settings and sessions, rename, MCP configuration, themes, narrow
layouts, proposed sessions and no renderer Node access. Platform acceptance
uses Command for macOS image zoom and native path containment instead of
Windows path separators. Source and packaged safeStorage acceptance passed
legacy plaintext migration, ciphertext checks, logout, fixture-key login and
relaunch recovery through macOS Keychain. All credentials were isolated,
nonfunctional fixture values; no personal profile or paid model was used.

The local unsigned app is `Desktop/release/mac-arm64/Desktop for Step Code.app`.
Package verification compared 1,258 built/staged files, including all runtime
files and the native PTY host/addon/helper, and checked version, architecture,
Node SHA-256 and executable permissions. Evidence is in ignored
`Desktop/test-results/macos-package-resources.json` and local acceptance logs.

This establishes a native local preview, not notarization, public release,
Intel Mac support, real account/model quality, external MCP publication or
Windows regression acceptance. See `MACOS.md` and `PLATFORM_HANDOFF.md`.


## macOS v0.5.1 account follow-up (2026-10-17)

At the owner's request, the macOS track follows Windows Release v0.5.1
(15f0fa77ee1562d3297e226071d49c00c762d891). Its integration base is PR #128's
squash merge 5b521cdd630c353e32542a16b1fb3ac990458912, which already contains
that Release and the macOS changes. No later Windows/Linux work or Step Code
source changes are imported. The runtime stays pinned to
3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8. The published v0.5.0-macos.1 tag
and package are unchanged.

Typecheck, production build and 473 serialized unit/protocol tests passed
(one existing Windows-only skip), plus twelve CI policy/runner tests
(one Windows cancellation skip). Source account settings, allowance, balance,
routing, encrypted-vault and browser presentation acceptance passed. Routing
uses actual Desktop login/IPC and the pinned runtime with local transport to
check CN API -> CN Plan -> Global API -> Global Plan -> CN API, model discovery
and chat endpoints/credentials, running-task login guards, authorization
cancellation and absence of API fallback after Plan rejection. No real
credentials or paid model requests are used.

The unsigned 0.5.1 ARM64 package passed startup, macOS update state, full Electron,
vault, account settings, Plan allowance, API balance, routing, StepPage, browser,
file preview, delivery, terminal-scope, full undo and archive acceptance, plus
the native zsh terminal test. All 1,258 built/staged files matched its resources,
including executable Node and PTY helpers; the resource report now derives its
baseline from the Desktop version instead of hardcoding v0.5.0. Both themes,
narrow English layouts, stale/error/cancellation states and encrypted credential
refresh/restart are covered by the account fixtures. macOS CI now runs the new
account checks in source and packaged apps.

The prior local archive-notification expiry timeout was a test-clock sequencing
problem: adding an observation before the clock jump let the notice expire
without product changes. The acceptance now confirms hover/focus do not pause
the replacement notice and runs 3,100 ms of the clock normally, allowing the
asynchronous replacement effect to install its timer. The original hidden-state
assertion remains; both source and packaged full Electron acceptance passed.
Notification product code and its timeout are unchanged.

These results do not establish real Plan/API balances, official billing,
external MCP compatibility or public Release readiness. Cloud CI results are
recorded separately on the PR; this follow-up is not a newly published Release.


## macOS 0.5.1 parity follow-up (2026-10-17)

This iteration remains on Windows Release v0.5.1 and the merged PR #131 tree,
with the pinned Step Code runtime unchanged. The code/platform audit found two
explicit desktop gaps: update controls/installation and file application discovery/
selection. Both now have native macOS implementations while Windows NSIS behavior
and renderer isolation are retained. See MACOS.md and UPDATES.md for the release
asset contract and intentional platform differences.

Typecheck and production build passed. The serialized unit/protocol suite passed
480 tests, with the existing Windows-only path-casing check skipped (481 total).
The CI policy/runner suite passed twelve tests with its Windows cancellation check
skipped. Source update discovery/UI, transfer UI, file opening, native AppKit
application discovery and installer fixtures passed. ARM64 package verification
matched 1,262 built/staged resources and checked the release marker, bundled native
application helper and detached update helper.

The native updater fixture exercises real ZIP transport/hash checks, bounded
extraction, framework links, current-process exit, detached-helper readiness,
same-volume application replacement, retained Gatekeeper quarantine, old-bundle
retention until acknowledgement and failure recovery tests. Its OS launch boundary
is a disposable fixture: it does not establish Developer ID trust, notarization,
Gatekeeper approval, a real public-GitHub download, or real installed-app upgrade
acceptance. Do not describe these fixtures as a signed or unattended update system.
The old 0.5.0 package still requires a manual first upgrade.

The packaged candidate passed seventeen Electron/native checks: update discovery,
transfer UI, updater fixture, startup, general Electron/runtime, encrypted vault,
account settings, Plan allowance, API balance, account routing, StepPage registration,
browser, file preview/application choices, artifacts, terminal scope, turn undo and
archived sessions. The updater fixture also extracted and replaced a full packaged
application in a disposable directory; only its final OS launch was substituted.
Cleanup waits for helper completion, is transaction-bound and is tested separately.
Cloud Windows/macOS checks remain a PR gate; this entry does not publish a Release.

A deployment-target audit found the local Swift compiler defaulted to macOS 26.
The AppKit helper now explicitly targets ARM64 macOS 13.5, matching the bundled
Node minimum; package metadata and Mach-O inspection enforce that floor. This
checks binary compatibility metadata, not execution on every older macOS release.

Windows CI's legacy NSIS transport fixture returned an integrity failure without
observing the expected corrupt-payload request. The fixture now canonicalizes its
temporary root, clears transport cache between cases and serves no-store responses;
all outcome/request-count/hook-cleanup assertions remain. Failure diagnostics are
bounded and printed before assertions. Local replay explicitly selects the library's
Windows provider on macOS and passes parsing, corruption, cancellation and retry;
Windows CI remains required to confirm actual Windows behavior.


### macOS updater P2 follow-up (2026-10-17)

Startup failure now restores the backup when the replacement bundle is absent;
other inspection/restore failures retain a recovery-required result and backup.
Regression cases cover deleted/moved replacements, foreign replacement identity
and a parent path that becomes a file. Successful acknowledgement waits for helper
completion, then removes only the transaction's recorded ZIP; unrelated downloads
remain. Typecheck, production build and 481 local tests passed (one Windows-only
check skipped). The native updater fixture passed download, verification,
replacement, acknowledgement and completed-ZIP cleanup. OS launch remains a fixture;
this does not establish real Gatekeeper approval or a public downloaded upgrade.

## PR #136 Windows CI timeout follow-up (2026-10-18)

Run 39056427912 passed the Windows interface and sessions groups, while its runtime
job was cancelled with a 45-minute maximum-execution annotation. GitHub did not
provide usable runtime job logs or an uploaded timing report, so the hanging
script and underlying cause remain unconfirmed. The separate macOS run passed.

Every Windows acceptance script now has a five-minute default deadline, retaining
per-script overrides. Timeout cleanup targets only the owned process tree and uses
the Windows system taskkill executable. The timing report records the active
script, start time and deadline before launch, then clears it after completion.

The CI policy/runner suite passed all 14 tests, including real timeout/cancellation
and Windows descendant cleanup. A full local runtime-group replay passed all 17
checks with a two-minute default deadline (existing explicit overrides retained).
This did not reproduce the cloud hang and is not proof that its cause is fixed;
the next cloud run remains the integration gate. No application package changed.

### Follow-up after run 39087994487

The bounded runner produced usable diagnostics. The runtime group reached the
custom-provider estimate tooltip assertion and failed after its 30-second wait,
rather than consuming the job limit. That fixture now waits for finite context
panel animations and scroll delivery before hovering, and captures a failure
screenshot. The assertion and production tooltip behavior remain unchanged.

The sessions job hit ENOTEMPTY during upstream Workflow fixture removal. Direct
agent calls queue telemetry writes after their awaited result; the fixture now
flushes its tracked journals before deleting their directories. The integration
patch and its manifest hashes were updated together; no upstream production source
changed. The interface job's collaboration-test child exited with native Windows
code 3221226505, without a failing assertion. It did not reproduce locally with
the same Node version. Windows protocol tests now run one file at a time to bound
process pressure; this is mitigation, not a confirmed native-crash diagnosis.

Local checks passed: all 114 Workflow tests, 496 Desktop tests with 13 platform
skips (509 total), all 14 CI policy/runner tests and the full custom-provider
Electron fixture. The patch reverses cleanly against the reviewed Workflow test
source. These results remain local evidence until the new cloud run passes.

### Windows Node TCP-connect follow-up

Run 39088928068 passed interface acceptance and the separate macOS run, but
failed on a CLM Plan completion wait and a cross-session tool with no returned
tool result. The full local runtime group passed all 17 checks; the isolated CLM
Plan test also passed twelve repetitions on Node 24.15.0. Those local passes did
not explain or dismiss the cloud failures.

Node's upstream issue nodejs/node#63620 documents silent Windows HTTP/TCP-connect
crashes in 24.15.0, with the same native exit code seen in the collaboration
test. A maintainer confirms the fix in nodejs/node#62561, shipped in 24.16.0.
This matches the observed native failure class; it does not prove that every
earlier timeout shared that cause. Windows CI and newly staged Windows runtime
now use 24.16.0. Staging rejects Windows Node 24.x releases below 24.16; macOS
and historical release records remain unchanged.

The official Windows x64 archive was verified against its published SHA256
EDACA9BD58EC8E92037DAC4E877D52F6B8F430B81C18B57E264B4E2FB111CD56.
Fresh runtime staging passed with Node 24.16.0. All 15 CI policy/runner/version
tests and 14 focused CLM/collaboration/staging tests passed on that host. CLM
completion waits now expose fixture assertion failures and native child exit
codes immediately instead of hiding them behind a generic timeout; fallback
diagnostics contain only event types, counts and activity flags.

The Node 24.16.0 local suite passed 496 Desktop tests with 13 platform skips,
and cross-session Electron acceptance passed. A local Workflow recovery replay
also exposed a fixture race: the final tool result can arrive before its
asynchronous orchestration projection contains the nodes. The changed-script
recovery check now waits for all three projected nodes before asserting their
exact cached/completed/cached states. The targeted Workflow acceptance passed;
the full runtime replay and cloud checks remain the final gates.

Both local acceptance groups passed on Node 24.16.0: runtime 17/17 and interface
28/28. Workflow recovery also passed three additional consecutive repetitions.
Cloud runtime and sessions passed, as did native macOS packaged acceptance.

Cloud interface setup exposed a separate dependency incompatibility: Playwright
1.58.2 downloaded Chrome to 100% and then stalled for almost ten minutes. This
matches microsoft/playwright#41000, whose fix shipped in Playwright 1.60.
The test-only dependency is now pinned to 1.60.0, retaining the Windows Node
TCP-connect fix. Browser installation has its own five-minute deadline so setup
cannot consume the full job limit. The post-upgrade cloud run is still required.
With Playwright 1.60.0, a clean Chromium/FFmpeg/headless-shell installation into
the isolated D: test cache completed on Node 24.16.0; Desktop typecheck passed.

The subsequent cloud run passed interface, sessions and macOS acceptance, but
runtime exposed a then_run descendant-cancellation failure. Its Windows shell
cleanup silently discarded CIM discovery after three seconds. A cold-query
regression reproduces missing MSYS descendants with that budget; giving only
the CIM query a ten-second deadline passes the same test while retaining the
three-second ps lookup and the existing ownership checks. This reproduces a
matching failure route, not proof of the failed runner's exact CIM duration.
All 38 shell tests passed (three Linux-only skips); patched-source hashes and
reverse patch application were checked before fresh runtime staging. The
Electron fixture now records bounded cancellation elapsed time for cloud
diagnostics, retaining its no-late-write and unrelated-shell-survival checks.

The following macOS run exposed a fixture ordering issue before its reload-key
assertions: fill/clear followed immediately by typing produced two copies of the
draft. The fixture now waits for ProseMirror's model value after both fill and
clear, rather than treating DOM mutation completion as an editor commit. Composer
editing acceptance repeats that sequence three times; native reload-shortcut and
draft-retention assertions remain unchanged and still require macOS cloud proof.

## Application-Themed Quit Confirmation

Source integration replaces the ordinary native quit warning with the approved
application-themed modal. The main process publishes a versioned request through
the narrow preload bridge and includes it in snapshots. Replies must match the
current request and contain a boolean; changed task counts require another review.
Renderer reload retains a pending decision, cancellation leaves workers and
terminals intact, and confirmed exit uses the existing orderly cleanup and flush.
Cron counts distinguish temporary and durable storage, deduplicate shared durable
records, ignore disconnected stale hosts and disclose unavailable state.

Local checks passed: Desktop typecheck/build; 74 focused quit, Cron and runtime
tests; 32 browser theme/scenario/viewport/language combinations with keyboard,
reduced-motion and simulated failure coverage; real Electron tray cancellation
and confirmed shutdown with a continuous local stream and owned terminal; isolated
real Cron creation, counts, reload, cancellation, stale/malformed reply rejection
and persistent-record retention after exit; all eight Cron management cases; and
Ultracode restart/restore acceptance. No real account or model was used.
General Electron acceptance, including new and reopened profile proposals, also
passed. A separate real renderer crash verifies that a pending themed decision
is cancelled and native fallback can both cancel and confirm orderly exit.
Normal operation never invokes that fallback. All 15 CI policy/runner tests pass.
The dedicated native quit and Cron transcript checks are registered in Windows
acceptance; visual-only matrices are explicitly local checks.
This is source acceptance, not validation of a new installer or cloud CI.
The existing preview installer and desktop shortcut have not been rebuilt here.

### Account Allowance CI Shutdown Follow-Up

PR #145 run `39721715313` timed out in `verify-account-allowance.mjs` after
300 seconds. The unmodified fixture reproduces locally: all account assertions
reach the success log, but final shutdown remains blocked until a 40-second
diagnostic watchdog terminates only that isolated test process tree.
The fixture still answered only the old native message box.
Both shutdown points now use the existing application quit-review helper,
preserving orderly cleanup and credential/rule flushes rather than force-exiting.
All original business assertions remain. Locator waits are bounded to 15 seconds,
and phase logs plus a failure screenshot identify any future stalled assertion.

Three consecutive source runs and one run against the existing
`cron-quit-20261022-preview` package passed locally, as did all 15 CI policy/runner
tests. This follow-up changes only acceptance code and documentation; it does not
change the packaged application. Replacement cloud CI remains required.

### Theme Bootstrap CI Shutdown Follow-Up

Run `39725588859` passed account allowance, balance and routing, then failed
`verify-theme-bootstrap.mjs` at `first frame wine: Electron close timed out`.
That fixture also mocked only the native dialog; startup can still require the
application-owned review when teardown begins. Its bounded, orderly close now
uses `closeDesktopFixture`, without changing first-frame or system-race assertions.

Real Electron regression cases retain a durable Cron across shutdown and restart,
covering both an already-pending review and a review raised by fixture teardown.
Replacing the helper with the former `app.close()` reproduces the 15-second
timeout; both cases pass with the helper. All 15 CI policy/runner tests pass.
The complete 31-script Windows interface acceptance group also passed locally,
including the theme bootstrap startup race and final performance matrix check.
This local run preceded synchronization with main's StepPage and fader changes;
replacement cloud CI must validate the combined tree.

## Windows Offline Session Migration

The Desktop adaptation of Step-Code PR #291 retains the existing Windows runtime
pin and ports the shared import service through a separately hashed source patch.
Settings exposes explicit Codex/Claude discovery, reviewed snapshots, destination
mapping, batch jobs and cancellation. The importer owns a separate credential-free
child; copies and journals remain in the Desktop profile.

Local source verification on 2026-10-22 passed: typecheck, production build,
610 Desktop unit tests (13 skips), 90 upstream import/context/compaction/usage
tests, 15 CI policy/runner tests, the dedicated native import acceptance and
general Electron acceptance. The native migration case covers both formats,
archive opt-in and child exclusion, source append after review, duplicate
protection, stubbed directory-selection IPC, real transcript navigation, a native
continuation through a local fake provider and journal/copy retention on relaunch.
Historical tools are inert evidence, not current Plan/Workflow or filesystem
receipts; their display IDs cannot collide with native tool calls.

Native light/dark and narrow-window screenshots were checked. The separate mock
browser fixture also received Chinese/light and English/dark 375px layout checks.
See `docs/SESSION_IMPORT.md` for commands, bounds and evidence details.
No new installer, real personal-source migration, paid-provider request, remote
CI or macOS import acceptance is implied.

## Task Progress Completion Motion

The summary task progress now uses the existing yellow-to-purple palette while
unfinished, including the interval between checklist completion and the final
round completion event. Only a matching live `desktop_task_completed` event can
start the impact, right-to-left green sweep and square dust. The existing sound
and visual subscribers share that event delivery; task counts, reopening the
panel and restored sessions do not play another sound. Original row completion
and folding animations remain unchanged. Incomplete lists never fill falsely.

Local source checks passed: typecheck/build, completion sound tests, browser
motion acceptance, existing summary disclosure acceptance, real Electron motion
acceptance with a local streaming provider, and summary runtime acceptance.
Motion acceptance covers scope isolation, reduced motion, narrow layout, impact,
dust cleanup, waiting for the round to end and reopening without replay.
Media playback is intercepted in automated acceptance to count trigger timing;
actual speaker latency is not measured. No real account or paid model is used.
The full unit run encountered an unchanged Windows terminal-count teardown
failure; this is not recorded as a fully green unit suite.
Rerunning the other unit files completed with 609 passing and 13 skipped tests;
all 15 CI policy/runner tests also passed.

### Delayed Final Task Snapshot

PR #147 review identified a race between live round completion and asynchronous
summary refresh. A held-summary fixture reproduces the missing animation before
the fix. The mounted progress component now retains its matching completion
until the task snapshot confirms a full list. Only visuals are deferred; the
original event still plays the sound once. A new round, scope change or unmount
discards the buffer, and events received while hidden or with reduced motion
cannot start a delayed impact.

The regression verifies the delayed snapshot, no duplicate sound, cancellation
on a new round and unmount, plus the existing scope and motion matrix.
Typecheck, build, completion-sound tests and real Electron progress acceptance
passed. This follow-up does not rebuild the existing local preview installer.

### Task History Across Turns

Completed tasks from earlier turns now leave current progress and appear in a
collapsed entry above the current list. Incomplete/failed work carries over.
The bounded main-process projection includes original task timestamps and
explicit archived plans, without metadata or configuration. Renderer projection
reconstructs history from persisted records rather than mounted state, with a
conservative successful-tool-result fallback for legacy tasks lacking timestamps.

Focused projection tests, typecheck/build, browser progress and disclosure
acceptance, and real Electron progress/summary-runtime checks passed locally.
Coverage includes independent current counts, partial-plan wording, history
anchor stability, original archived statuses, narrow dark/reduced-motion and
English layouts, panel reopen, and renderer reload against the real staged
runtime with a local streaming fixture provider. The existing completion sound,
impact/sweep/dust and delayed-final-snapshot regressions remain covered.
The refreshed Electron acceptance uses the existing orderly quit-review helper
after reload. Entrance-frame assertions compare with final measured row height
rather than requiring a particular early-frame pixel threshold.
After integrating main through model-preference fix #148, the remaining unit
files passed with 632 passing and 13 skipped tests; all 15 CI policy/runner
tests passed. The staged Desktop admin adapter was refreshed from the merged
source; the upstream runtime pin is unchanged. The
unchanged Windows terminal-session teardown file noted above remains excluded.
The rebuilt unsigned Windows preview at
`Desktop/release/task-history-20261022-preview` passed packaged task-progress
acceptance (including next-turn retirement and renderer reload) and general
Electron acceptance with isolated profiles and a local fixture provider.
No real-account/model acceptance or fresh cloud-CI success is claimed.

### Model Discovery Registration Refresh Race

Runs `39787315956` (Windows sessions) and `39787315934` (macOS ARM64)
failed the same discovered-model catalog test after credential replacement.
Provider registration schedules an asynchronous offline refresh. If that pass
reaches the runtime after explicit discovery starts, it can cancel the network
pass and replace its catalog with an empty offline snapshot.

Desktop's per-request management runtime now serializes those refreshes, without
changing the upstream pin, authentication routing or credential-scoped cache
rules. A test-only preload delays registration refresh while the loopback
provider holds its response; the new regression fails before the fix and passes
after it. Normal and delayed cases retain account/endpoint isolation, failed and
cancelled login, cached capability and recovery assertions.

Locally, 76 related tests and typecheck passed, followed by 25 repetitions of
both discovery cases (50 cases total). Real Electron model-switch acceptance
passed, including persistent selection, missing-model protection and explicit
recovery. This follow-up does not rebuild or retarget the existing preview
package. Replacement cloud CI must validate both native platforms.

## Cron Recovery And Management Beta (2026-10-24)

Windows retains the fixed runtime pin
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494`. The additional hashed Desktop
patch enables per-task pause/resume and editing without replacing native
locking, jitter or original expiry. Paused durable rows use opt-in Beta schema
2; schema-1 readers preserve but do not schedule them. Explicit resume restores
schema 1. See `CRON.md` for shared-project and downgrade boundaries.

Local source verification passed: typecheck, production build, the complete
serial Desktop unit suite (699 tests: 686 passed, 13 platform skips), 15 CI
policy/runner tests, 14 native JSONL RPC Cron cases and 11 real Electron Cron
management cases. The final patch was also applied to a clean checkout of the pinned
upstream commit through the actual patch applier, including preimage and
resulting-source hash validation and whitespace checks.

Native cases cover pause/edit identity and deadline preservation, stale-update
rejection, lock-failure rollback, expiry without delivery, schema-1 reader
preservation and suppression of another host's buffered missed notice after a
shared pause. Execution journal completion requires current assistant output
and successful authoritative round completion, not merely a trigger or an older
assistant result.

Electron cases use isolated profiles, projects, trust and a local fixture
provider. They cover pause/edit/relaunch/resume, manual recovery review,
explicit automatic authorization, actual application relaunch and termination
of only the isolated idle scheduling child. Recovery retains the reviewed
conversation in Ask, retires the disconnected entry and reuses the same single
runtime when the original chat is opened. Revocation survives relaunch.
Management and recovery before the next due time made zero model calls.
The host shortcut opens only the current live runtime, including an archived
host without unarchiving it. Offline/stale requests are rejected without a
history-loading or runtime-start fallback, and the recovered-host shortcut
still leaves exactly one runtime. Ordinary latest-target session navigation,
reading positions, draft retention and failure recovery also pass their
dedicated real Electron acceptance.
Dark/light, narrow, edit, history and recovery screenshots were checked;
reduced-motion checks retain the shared controls' interaction semantics.
The updated browser preview passed with the existing installed Edge: online
host navigation, offline disablement, keyboard tooltip/activation, light/dark,
four widths down to 390px, reduced motion and no page errors. This preview uses
sample data, not the real Desktop profile.
The eight Cron transcript checks and the dedicated quit-confirmation acceptance
also passed, including persistence, reload/cancel/replay and crashed-renderer
fallback.

Automatic recovery remains default off, bounded to the reviewed task/account/
model snapshot and at most seven days. Due work, changed configuration,
unconfirmed execution, missing sessions and uncertain release block it without
automatic retries, catch-up, a new conversation or account/model fallback.
Journals are bounded and never turn acknowledged unknown results into success.
These are Desktop Beta extensions, not upstream-native ownership or exactly-once
execution. No installer, real-account/billing, OS sleep/reboot, external-CLI
coordination, macOS Beta or replacement cloud-CI acceptance is claimed.

### Local Review Follow-Up (2026-10-24)

The local review reproduced four regressions before fixes: automatic gate
release after initialization crossed a trigger, revival of an old grant after
pause/resume or edit/revert, unresolved execution falling out of bounded
history, and one corrupt authorization preventing later projects from recovery.
Automatic release now carries a runtime-enforced deadline; Desktop requires its
new Windows-only capability. Management persists grant invalidation before
updating tasks, history atomically retains an unresolved-rotation latch, and
authorization failures are isolated and reported per project.

The 45 focused recovery/history/management tests passed, including legacy
journal migration, malformed-latch rejection and failed-invalidation/changed-host
guards. Typecheck, production build, 15 CI policy/runner tests, clean pinned
patch replay with source hashes, 14 real native RPC cases, 12 Electron management
cases and session-navigation acceptance passed. The real pause/resume buttons
keep the previous automatic grant blocked without a model call.
The serial suite excluding `terminal-sessions.test.ts`
passed 687 tests with 13 platform skips (700 total), using Node 24.16.0.
The unchanged terminal test was run separately: four cases passed and
`terminal count is bounded per directory and failures do not cross directories`
failed at process-tree termination. It is not claimed as passing or repaired
by these Cron changes.

The existing preview installer predates these review fixes. No new installer,
real-account/billing, OS sleep/reboot or fresh cloud-CI success is claimed.

### Queue, View Replacement And Latest Main Follow-Up (2026-10-24)

The next review found unsent queues lost during replacement of a disconnected
Cron host, a viewed chat left on the retired runtime identity, and cancelled
edit values retained on reopening. A focused cancel/reopen regression failed
before the fix. Recovery now refuses both manual and automatic replacement
while the same conversation retains pending messages. The disconnected queue
remains editable and withdrawable, without migration or automatic sending.
Successful viewed-host replacement emits an explicit identity event; the
renderer validates the original and replacement identities before installing
the authoritative snapshot, retaining the composer and reading state. Activation
precedes asynchronous retirement, and late events cannot override navigation.
Each edit opening remounts fields from the current saved task, preserving the
shared disclosure animation.

Main's shared sidebar is retained without a parallel implementation: equal-width
New chat and Plugins buttons, then adjacent Schedules and Search icons. The
preview uses the same component and tests equal primary widths, schedule
navigation, the online-host shortcut and offline guard in both themes, four
widths down to 390px and reduced motion, with no page errors.

After main integration, Node 24.16.0 serial units passed 720 tests with 13
platform skips (733 total), excluding the independently failing
`terminal-sessions.test.ts` described above. Typecheck, production build,
49 focused Cron/staging tests, 15 CI policy/runner tests, clean pinned patch
replay with all source hashes, 14 native Cron RPC cases and the real Electron
session-navigation, session-move and capability-management acceptance passed.
The final 14-case Electron Cron-management acceptance also passed, including
viewed-host reconnection with the same draft, background recovery without taking
over a new draft, stale replacement events, queue preservation/edit/withdrawal
with no automatic sends, and cancel/reopen of both editable fields.
These use isolated profiles and deterministic local providers, not real
accounts or billing. The existing preview package is not updated by this work.

### Update Installer Fixture Shutdown

Windows interface run `39995014128` reached the update installer's successful
UI assertions, then timed out while closing its Electron fixture. The shared
orderly-close helper now installs the existing Windows pipe-release guard, and
the update-installer acceptance uses that helper. Pipes are released only after
the launcher exits with code zero and every application window closes; normal
quit review and state flushing remain in use. Shutdown errors still propagate,
and guard listeners are removed on both success and failure.

The new helper integration regression failed before this change and passed
after it. All eight shutdown tests and typecheck passed locally, as did three
consecutive update-installer runs and update-settings Electron acceptance.
Plugin-management, session-move and then-run Electron acceptance also passed,
including their orderly shutdown and persisted-history checks.
The full local interface group could not run because this machine lacks the
matching Playwright Chromium headless binary. Cloud CI must validate the full
group; no fresh package or cloud success is claimed by these local checks.
