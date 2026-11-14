# Session Reading And Runtime Startup

Implementation record: 2026-11-14.

Source changes and local acceptance are complete in the isolated
`fix/session-startup-decoupling` worktree, originally based on
`c1f8f01a7db84ef616dd9ac30cb1116945e590ec`.
PR preparation rebased the implementation onto `main 2d0777b`; the additional
acceptance for that integration is recorded separately below.
Commit and PR delivery were authorized after local acceptance. No installer,
release, production-profile migration or shortcut update is included.

## Ownership

Reading and execution have independent lifecycles:

- Reading obtains an inert, read-only display projection. It does not select a
  runtime, accept a task, restore authority, start MCP or repair session files.
- Execution requires the authoritative session, restored model/permissions,
  discovered tool inventory and an explicit tool-readiness policy.
- A readable history is not evidence that execution is ready. Failed startup
  keeps the selected history and local draft visible.

The Electron main process owns both lifecycles. The renderer still has no Node
or filesystem access; preload exposes typed, narrowly scoped IPC.

## Read-Only History

`session-history.mjs` retains the small-history fast path. Larger histories use
`SessionHistoryReaders` and a separate `session-reading-worker` process importing
the native library entry, not CLI main or `SessionManager.open`.

The reader uses native parsing, in-memory migration and active-branch context.
Desktop decorations, imported messages, stable entry IDs and model changes are
included before enforcing the final response budget.

| Budget | Limit |
| --- | --- |
| Source bytes | 32 MiB |
| Final display JSON, UTF-8 | 24 MiB |
| Display messages / content blocks | 2,000 / 10,000 |
| Reader V8 old-space | 256 MiB |
| Concurrent reader processes | 1 |
| Queue / execution deadlines | 60 / 30 seconds |
| Changed-source retries | At most one within the same execution deadline |

These are rejection budgets, not a promise to display every file below 32 MiB.
The heap flag is not a total RSS limit. Existing full authoritative snapshots
remain outside this preview budget; pagination/virtualization is not implemented.

Requests are fenced by surface, webContents generation, selection revision and
session/source version. Consumers share a reader without sharing cancellation.
The last unsubscribe cancels it; another reader waits for confirmed process exit.
Reload/destruction withdraws the old generation. Queue order prevents rapid
navigation in one surface from starving the other.

Managed-root, file/session, branch and source-version checks remain authoritative.
Handle metadata and canonical-path rechecks reject replacement or mixed versions.
Moving a Desktop project may change display cwd without changing the original
JSONL header; this does not relax the managed-file/session checks.

## Desktop Startup Protocol

The staged runtime advertises `desktop-async-startup`; Desktop explicitly opts in
with `DFSC_ASYNC_STARTUP_V1=1`. Legacy RPC/print clients retain their previous
startup semantics. Unsupported runtimes retain independent reading with the
legacy execution path.

The Desktop-only sequence is:

```text
read history ------------------------------------------> readable

start runtime -> responsive core -> bind authoritative target
                                   |-> restore model/permissions
                                   |-> discover MCP -> connect regular tools
                                                       attach authorized hosts
identity + model/permissions + settled tool policy -----> accept execution
```

No MCP connections start for the temporary unbound session. Startup snapshots
and `desktop_startup_changed` events carry runtime, session, startup epoch,
configuration revision and catalog revision. Snapshot recovery does not depend
on interpreting warning prose.

Hosted attach waits for binding, model readiness and completed discovery, not
for its own tools to become ready. Authorization denial, unavailability and
launch failure report terminal native results rather than leaving pending items.
Existing broker leases, account/model/declaration validation and revocation stay
in force.

## Execution Policy

Main-process guards and native actual-execution preflight both apply. Native
checks precede user-message persistence, queueing and provider execution;
non-executing initialization management such as permission restoration remains
possible.

- Connecting tools, failed discovery and unconfirmed cleanup block execution.
- Settled optional failures require an explicit interactive confirmation for
  this exact submission, missing set, identity and tool catalog.
- Consent is single-use and cannot authorize changed content, another epoch or
  replayed submissions. It neither changes configuration nor grants tool trust.
- Remote, Cron and external tasks cannot silently omit unavailable tools.
- Uncertain cleanup remains latched across session epochs until runtime-process
  replacement. Late results cannot publish into a replacement attempt.
- Reconnect replaces the whole owned runtime under existing busy/background/
  approval/queue/exit guards. It is not single-service retry.
- Rejected first sends retain the draft and one-shot launch choice. Restoration
  is limited to definite `STARTUP_NOT_READY` rejection, with worker, transport,
  session and choice-revision fences; unknown timeouts are not retried.

The compact status band is outside the transcript and provides existing MCP
settings and protected runtime reconnect. Known startup refusals are localized,
including errors restored when revisiting a session.

## Model Labels During Navigation

The composer unmounts its real model/effort picker as soon as navigation starts.
A disabled, fixed-width placeholder replaces it until authoritative restoration
finishes. Neither the previous model/effort labels nor their popover remain in
the DOM or accessibility tree. The shared navigation status announces restoration;
the visual placeholder is not a duplicate live region.

Failure keeps the selected history and draft, so it also keeps an unavailable
model placeholder rather than reinstating the source conversation's labels.
The failure icon stops spinning. Reduced-motion mode also stops the loading
icon. Model persistence, pending next-turn choices, default preferences and
native restoration rules are unchanged; the presentation does not infer a
selection from the last assistant message.

## Native Integration

Runtime pin remains `29eb460780489801ce8afc8bffc1a2efae7cbded`.
`patches/v017/step-code-desktop-startup.patch` extends the existing Desktop patch
chain; manifest patch/source hashes and staging capability checks are updated.
The patch is applied to source and rebuilt, not edited into a generated bundle.

The complete v017 chain was replayed on a fresh pinned checkout and staged with
Node 24.16.0. Desktop child/isolated environments scrub startup-only flags.

## Local Verification

All integration acceptance uses disposable profiles, synthetic histories,
loopback provider/MCP fixtures and owned-process teardown. It does not use CU,
real accounts, production settings or the user's historical conversation.

| Check | Result |
| --- | --- |
| Desktop TypeScript / production build | Passed; existing Vite directive/chunk warnings remain |
| Complete serial Desktop protocol inventory, before model-label increment | 257/257 files; 2,703 passed, 15 skipped, zero failed/cancelled |
| CI policy, inventories and runners | 66 passed, one platform skip |
| Documentation contracts / whitespace checks | Passed |
| Complete native patch replay / staged provenance | 79 final source hashes match in both owned checkouts and staged manifest |
| Real native startup protocol | Passed, including no connections before bind, no writes/queue/provider before readiness, exact one-shot consent and cleanup latch across epochs |
| Electron startup / legacy reading | Passed against actual staged runtime and local MCP/provider |
| Electron host authorization / permission approval / session move | Passed |

The 15 protocol skips are POSIX/macOS-only checks and two unavailable Windows
file-symlink checks, not startup checks. Test totals above overlap with focused
regressions and must not be added together.

The serial suite ran while the final presentation-only localization change was
being completed. Its affected installer/localization tests ran afterward on the
final sources; final TypeScript, production build, startup and reading acceptance
also include that change. Host authorization, permission and move acceptance
preceded only the final cached-error localization adjustment.

Independent read-only implementation review identified and verified fixes for
retry attach under the mutation lock, one-shot launch-choice restoration,
and cached startup-error localization. No definite findings remained after
re-review. Passing review does not replace the execution evidence above.

### Controlled Measurements

Machine: AMD Ryzen 9 8945HX, 32 GiB RAM, Windows, Node 24.16.0.
The native test and Electron fixture sources differ slightly in header paths.

| Scenario | Observation |
| --- | --- |
| Synthetic JSONL source | 16,294,189 bytes in Electron; 16,294,180 in native reader test |
| Legacy never-responding MCP, 20 read selections | Median 608.44 ms; P95 656.06 ms to DOM readability |
| Desktop async mode, actual 70-second MCP | Readable at 664.73 ms; authoritative at 2,227.94 ms; tools connected at 72,112.11 ms |
| Missing optional executable | Cancellation preserves draft/history; one explicit confirmation produces exactly one provider request |
| Cold new draft, connecting MCP | No provider request or user-message persistence; input and armed Ultracode choice retained |
| Isolated native projection | 369,429 final JSON bytes; matches native active-branch semantics |
| Native reader memory observation | Heap 53,602,776 bytes; RSS 150,171,648 bytes at the measurement point |
| Immediate cancellation sample | 2.38 ms from abort to confirmed reader exit; source unchanged |
| Main-process observations across 20 selections | Maximum sampled heap 29,605,044 bytes; RSS 232,910,848 bytes |
| Renderer observations | Maximum sampled Tab working set 419,588 KiB; rounded JS heap reported 19,300,000 bytes |

The reading distribution uses one fresh disposable profile, with renderer
reloads between selections and the legacy runtime still waiting for MCP.
It is not 20 fresh OS/app launches; filesystem caches are not flushed.
Readability timing is a DOM-ready proxy, with separate screenshot inspection,
not a compositor/pixel-paint timestamp or an all-machines guarantee.

The source includes abandoned branches and compaction. Its complete native
active-context display is much smaller than the raw JSONL; this is not a claim
to render 15 MiB of visible transcript within the same time.
Memory values are observations rather than a continuous peak or total-app cap;
Chromium JS heap values may be rounded. Immediate cancellation is not a latency
guarantee for cancellation at an arbitrary point during parsing.

Actual legacy core timeout, failure-retained history/draft, no perpetual spinner,
corrected-config reconnect, async cleanup refusal/reconnect, optional exclusion,
light/dark, Chinese/English and narrow reduced-motion layouts passed.
Renderer page errors were empty. Original history prefixes were preserved;
authoritative restoration may legitimately append model/thinking metadata.

### Model-Label Increment

After the complete startup acceptance above, the additional model-label
presentation change passed:

- Full Desktop TypeScript and production build on the final product sources.
- Four focused test files: 57 passed, zero failed/skipped, including Chinese/
  English loading and failure markup plus unchanged model-selection contracts.
- Source Electron navigation against the staged native runtime: 38 exact model/
  effort restoration checks and 41 monitored navigation states, including two
  failures; zero stale pickers and zero renderer errors. Explicit saved choices
  intentionally differ from the last assistant's model in one fixture family.
- Held DeepSeek-fixture to Step-5-fixture and reverse navigation, three rapid
  targets with late prior results, open-popover removal, failure/retry and the
  existing cold-start/resident/draft/scroll regressions.
- Light/wide and dark/700-pixel/reduced-motion screenshot inspection; the
  placeholder text fits and does not overlap send. The placeholder uses the
  same dimensions for loading and failure.
- Existing model-switch Electron acceptance, including local provider dispatch,
  queue/steering, persistence, favorites, missing-model refusal and recovery.

The observer is reinstalled on every document generation and reports to Node,
so renderer reloads cannot silently erase its evidence. Independent read-only
review caught this test-probe gap; it was fixed before the final navigation run.
The old model-switch fixture also needed to wait for asynchronous tools to
settle before its unchanged whole-state equality assertion. Initial diagnostic
failures are retained separately; only the completed reviewed run passed.
Independent re-review found no remaining definite findings. Documentation and
CI policy tests also passed (eight tests), as did the final whitespace check.

The complete 257-file suite was not rerun for this renderer-only increment.
These focused results overlap earlier tests and are not added to the full-suite
total. No model persistence/restoration or native runtime source changed in
this increment.

### Main Integration Before PR

The implementation was rebased onto `main 2d0777b`, retaining PR #245's Remote
startup/navigation coordination and source-specific waiting hints. Selection
revisions still serve as the Remote request ID. Every navigation clears its
transient Remote wait; only successful navigation releases the selected reading.
The Remote source-extraction test received the reader-owner fixture bindings
needed by the integrated handler, without changing its original assertions.
Independent read-only rebase review found no definite issues.

On the rebased product sources (`c09c1b2`), the following passed:

- Full Desktop TypeScript and production build, with existing Vite warnings.
- Twenty-one focused protocol files: 520 passed, zero failed/skipped/cancelled.
  These cover Remote management/navigation, runtime startup and reading,
  execution boundaries, hosted tools, model selection and window handoff.
- Root CI policy, inventory, runner and documentation tests: 39 passed, one
  platform skip, zero failures.
- Source Electron navigation: 38 authoritative model/effort checks and 41
  monitored states, including two failures; zero stale pickers or page errors.
  Light/wide and dark/narrow loading screenshots were inspected again.
- Source Electron Remote startup/navigation in three modes: saved Feishu
  recovery, external Agent preparation and disconnected control. Latest local
  selection wins; independently owned sessions and correctly attributed hints
  remain intact.
- Source Electron actual 70-second MCP: readable at 599.00 ms, authoritative
  at 2,053.52 ms and tools connected at 72,023.86 ms. Pending-tool refusal,
  cleanup refusal, explicit optional exclusion, reconnect and retained cold
  draft/mode checks passed; one explicitly accepted provider request and zero
  renderer errors.

The original 257-file full suite and 20-selection reading distribution were
not rerun after this rebase. The measurements remain controlled fixture results,
not real-provider, cross-platform, installer or cloud acceptance. All five
Electron runners exited successfully; the final owned Node/Electron process
audit was empty. No production profile, shortcut or package was changed.

### Evidence And Artifacts

Primary local evidence:

```text
D:\DFSC Builds\session-startup-decoupling\evidence-20261114\
  desktop-build-final.log
  desktop-typecheck-final.log
  ci-policy-tests.log
  protocol-summary.json
  protocol-suite.log
  verify-session-startup\results.json
  verify-session-reading\session-reading-results.json
  model-labels\model-label-tests.log
  model-labels\desktop-typecheck-model-labels.log
  model-labels\desktop-build-model-labels.log
  model-labels\verify-session-navigation.log
  model-labels\navigation\session-navigation-results.json
  model-labels\verify-model-switch-reviewed.log
  pr-main-sync\build.log
  pr-main-sync\typecheck.log
  pr-main-sync\focused-protocol.log
  pr-main-sync\navigation\session-navigation-results.json
  pr-main-sync\remote-remote\results.json
  pr-main-sync\remote-external\results.json
  pr-main-sync\remote-disabled\results.json
  pr-main-sync\startup\results.json
```

Per-file protocol TAP/logs remain in `Desktop/test-results/protocol/`.
Earlier failed diagnostic logs/screenshots are not acceptance receipts; use the
completed final reports and zero-exit runner logs above.

Owned artifact inventory, approximate logical sizes after acceptance:

| Exact owned path | Size / purpose |
| --- | --- |
| `D:\DFSC Builds\session-startup-decoupling\step-source` | 320.29 MiB; reviewed native source/build checkout |
| `D:\DFSC Builds\session-startup-decoupling\patch-replay` | 17.36 MiB; fresh patch replay evidence checkout |
| `D:\DFSC Builds\session-startup-decoupling\runtime` | 124.32 MiB; current staged acceptance runtime |
| `D:\DFSC Builds\session-startup-decoupling\native-baseline.index` | 0.19 MiB; private baseline index, not the native Git index |
| `D:\DFSC Builds\session-startup-decoupling\evidence-20261114` | 2.54 MiB; reports/logs/screenshots, including 0.29 MiB for model labels and 0.87 MiB for main integration |
| Worktree `Desktop/dist` | 13.06 MiB; current production source build |
| Worktree `Desktop/test-results/protocol` | 1.05 MiB; complete per-file protocol evidence |

No installer was generated. Disposable profiles were closed and cleaned by
their registered lifecycle helper. After runners finished, no owned Node or
Electron process matched this worktree/runtime or the two startup/read fixtures.
No existing build/source directory was deleted.

`Desktop/runtime` links only to the owned staged runtime above.
`Desktop/node_modules` reuses an existing junction chain ending in
`C:\Users\7oMB\AppData\Local\Temp\dfsc-background-metadata-20261113\Desktop\node_modules`;
that shared installation was not modified or cleaned. Further removal of owned
source/build directories requires separate authorization and an exact-path
process/link/source recheck.

## PR 246 CI Follow-up

The first Windows and macOS runs at `3a96a7d` failed in first-run,
new-session and Cron management acceptance. These local-model fixtures had
implicitly depended on a machine-installed StepPage service. Clean runners
correctly reached unavailable-tool consent instead of submitting their model
request. The new-session runner then stalled in its old unbounded shutdown path.

Unrelated loopback fixtures now explicitly disable only the built-in StepPage
declaration. StepPage's own registration/preparation tests are unchanged.
The first-run fixture still starts with an empty profile: it disables the
unrelated MCP through the real settings API after onboarding detection.
The summary fixture retains its intentionally failed `local-search` service
and explicitly confirms its exclusion before the first provider request.

Successful-execution fixtures wait for authoritative tool discovery. Cold-draft
UI fixtures may make one explicit retry only after the exact startup refusal,
no persisted user turn, unchanged worker/session and fully ready tools.
Accepted execution, another error, failed tools or uncertain cleanup cannot
trigger that retry. New-session persistence polling now awaits resolved IPC
values, and its teardown awaits orderly shutdown while always closing HTTP.
No acceptance deadline was increased and no production tool gate was bypassed.

Further acceptance exposed a real Plan compatibility issue: replaying a draft's
Plan selection used the native `/plan` command before discovery completed.
The startup-management annotation now supports an argument predicate.
Only `/plan`, `/plan on` and `/plan off` qualify; planning a task or approving
a proposal still requires execution admission before the handler runs.
Nested Agent work remains independently gated. The runtime pin is unchanged.

Local evidence is under `evidence-20261114/ci-fix`: native management/Plan/prompt
regressions, focused Desktop protocol tests, typecheck, runtime staging and
individual zero-exit Electron runner logs. Earlier failed attempts in this
directory are diagnostics, not successful acceptance receipts.
The native regression selection passed 185 tests; the final eight-file Desktop
selection passed 230 tests and runtime-staging contracts passed another eight.
This follow-up did not rerun the entire Desktop protocol inventory locally.
The fresh `patch-replay-ci-fix` checkout verifies the Windows patch sequence and
macOS overlay source hashes; this is not a native macOS build or acceptance run.
Cloud CI must be checked again on the pushed revision before calling the PR green.

## Remaining Boundaries

This fixes startup coupling generically; it does not special-case Scrapling,
install its dependencies or reduce the underlying service/host initialization
time. Single-service retry, pending-tool bypass, unified large-history paging
and tool-directory freezing remain separate work.

Windows source/staged-runtime acceptance is not an installer test, a macOS/Linux
native test, cloud CI success, a real-provider test or a published update.
