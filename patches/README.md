# Upstream Integration

Repository: https://github.com/stepfun-ai/Step-Code

Development pinned commit: `81e79bc4b699148d6823fedde9b5e70d9a80255f`
(v0.1.6 announcement source baseline, not an official release tag). The public
0.1.6 manifest has no source SHA; binary/source identity is not asserted.
Its patches and reviewed pre/post-image hashes live in `patches/v016/`. Apply with:

```powershell
node scripts/apply-step-code-desktop-patch.mjs Step-Code patches/v016/step-code-desktop.patch
```

The v016 baseline additionally carries two upstream commits that the applier
installs before the desktop patches, declared under `upstream.commits` in the
manifest: `7487124e7b27c604535fc8439ccd0d0b81c5c299` (session record of facts,
upstream PR stepfun-ai/Step-Code#318) and `90a57820c81c6e78e4a3ea5be3f66694ac038611`
(preserve subagent outcomes and publish live lane state, upstream PR
stepfun-ai/Step-Code#324). They land as uncommitted worktree edits, so HEAD and
`manifest.commit` remain the reviewable pin while `sources` and
`patchedSources` already describe the combined state the desktop patches
expect. The overlay deliberately skips upstream PR stepfun-ai/Step-Code#323,
which removes the `enter_plan_mode` tool the Desktop plan-review bridge is
built on; it is not a dependency of the two carried commits. On the model
side the overlay fixes chain results and failure diagnostics reaching the
parent model. On the Desktop side it requires the `--include-live-events`
spawn flag (transient `message_update` and `tool_execution_update` frames are
no longer durable) and reads the bounded `activeText` tail per record, because
child transcripts no longer ride in `details.results`. Any failure during the
apply unwinds every installed patch in reverse and leaves the checkout as it
was found.

The 0.6.0 release baseline retains v0.1.5 and `patches/v015/`; both patch sets remain
replayable. The v016 set copies shared patches rather than modifying historical
patches. Its final compatibility patch supplies live RPC background-lane state,
keeps the host while final notifications settle, and updates the migrated code
to upstream's formatting and `.ts` import checks. Session import now uses native
`SessionFilePersistedEvent`; it does not replace the new session-index service.

Development Windows/macOS builds select the same v016 base.
The v016 bundle also supplies module-relative CommonJS filename globals so the
new Lark dependency can load under Node ESM. This does not add Desktop Lark UI.
See `docs/UPSTREAM_V016.md` for source identity, ownership and acceptance boundaries.
`manifest.json` additionally pins the Darwin process-tree patch and its resulting
sources under `platforms.darwin`; the applier selects this addition on macOS.
The older macOS 0.5.1 source `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`
and original root-level patches are retained for historical reproducibility.

The v0.1.5 Plan bridge preserves `planHash`, `planModeExited` and
`approvalSource` in reviewed results. RPC child external-approval handoffs
are not user approvals. Desktop main workers still wait for review, bind the
decision to the displayed snapshot and stop on cancellation or stale content.
The upstream usage activity worker must load from a copied runtime bundle,
without its original checkout or build directory.

`patches/v015/step-code-session-import.patch` backports the offline Codex/Claude
adapters and reviewed-snapshot service from Step-Code PR #291
(`6a0984573275d2398faa812bbf661a9dc5557e06`). It also supplies historical
context projection and usage exclusion, so source tools are evidence rather than
live execution protocol and source model selection is not resumed. The v0.1.5
port uses a local callback type because that baseline predates the source's
session-index notification interface; Desktop refreshes its catalog instead.
Source/preimage and resulting hashes are part of the shared manifest.
Windows and macOS both include this addition. See
`docs/SESSION_IMPORT.md` for boundaries and verification.

The shared manifest also applies the shared Cron observer and management patches,
then `step-code-desktop-cron-recovery.patch`. This **Beta** addition gates native
Cron delivery only when both `DESKTOP_CRON_STATE=1` and
`DESKTOP_CRON_RECOVERY=1` are explicitly supplied. The one-use
`desktop_cron_resume` RPC requires an idle trusted session. Desktop verifies
the selected session, account, model, Ask policy and loaded tasks before release.
The patch does not replace the scheduler, alter its shared task schema or bypass
expiry. Both platforms include and advertise this recovery capability. See `docs/CRON.md`.

The shared `step-code-desktop-cron-enhancements.patch` supplies
the guarded Desktop `update` action for per-task pause/resume and editing. It
retains native locking, identities, time offsets and original deadlines.
Paused durable tasks use Beta schema 2 with `desktopPausedAt`, opt-in only under
`DESKTOP_CRON_STATE=1`; schema-1 readers preserve but cannot schedule these rows.
Explicit resume returns them to schema 1 without replaying paused occurrences.
This changes compatibility of paused shared task records and must not be
described as part of the original observation-only patch or native upstream RPC.
Automatic recovery authorization and bounded execution/recovery journals remain
Desktop-owned, default off and separate from upstream storage. See `docs/CRON.md`
for consent, expiry, account checks, uncertainty and downgrade boundaries.

Both platforms also apply `step-code-desktop-cron-recovery-guard.patch` after the
enhancements patch. Automatic `desktop_cron_resume` carries a finite `before`
deadline checked synchronously inside the native scheduler before releasing
the gate. Crossing the reviewed trigger/expiry during initialization or loading
buffered missed work rejects automatic release. Manual reviewed release retains
its existing explicit path. Desktop requires the staged
`desktop-cron-recovery-guard` capability before automatic recovery on either platform.
`step-code-desktop-cron-scope.patch` adds an optional Desktop conversation view
over the existing shared Cron file. Only moved/restored Desktop transports supply
`DESKTOP_CRON_SCOPE_DIR`, pointing to Desktop-owned task associations. Such a
transport loads its own jobs, not foreign or unbound project tasks. Shared-file
transactions retain foreign and unknown records; newly created jobs remain
usable while their association is being persisted. The project-wide job limit
and identity-conflict checks still apply. The runtime manifest advertises
`desktop-session-cron-scope`; ordinary CLI scheduling remains unchanged.

The shared compatibility patch also keeps branch preparation read-only:
`STEPCODE_DESKTOP_BRANCH_SOURCE` suppresses startup usage discovery only for
that exact original file, while the newly forked session records normally.
The ordinary strict leaf check is unchanged. Whole-session copies compare
the copied source leaf before newly owned usage-lineage records.
Subagent temporary-directory cleanup is single-flight, retried and nonfatal;
a Windows `EPERM` during cleanup must not terminate the parent runtime.
The Windows patch also carries Workflow test-fixture portability and mixed
Workflow/parallel-subagent admission regressions; these do not change the
production scheduler.
Foreground shell cancellation also waits for Windows cleanup and snapshots the
selected Git Bash invocation's MSYS descendants, whose Windows parent chains
can be broken by fork/exec. Only that invocation's exact PIDs are targeted;
unavailable MSYS discovery retains the ordinary Windows-tree fallback.
The focused process-tree tests and gated real-command cancellation/isolation
acceptance cover this Windows-only addition. It does not change command
approval policy or timeout defaults.

The macOS-only `step-code-desktop-darwin-process-tree.patch` fills the matching
POSIX cancellation gap: `/bin/ps` snapshots the selected command's descendants
before terminating the process group, then verifies birth timestamps before
signalling detached descendants. It never selects processes by command name.
An unavailable process table retains ordinary process-group cleanup. Dedicated
ownership/PID-reuse tests and a real detached-child isolation test cover Darwin;
the shared Windows patch and resulting Windows source hashes are unchanged.

`step-code-desktop-darwin-test-portability.patch` pins the Workflow extension
fixture CPU topology, matching the neighboring runtime fixture. Hosted
three-core Macs correctly limit production Workflow concurrency to one; the
extension's two-running/one-queued assertions need a controlled test topology.
Cleanup drains runners admitted after a failed assertion so an unfinished test
cannot hold shared admission slots and cascade into later tests. The existing
scheduler test additionally checks that the real three-core cap remains one.
This addition changes tests only and preserves every live production limit.

Permissions, risk acknowledgment, legacy migration, bounded model-error continuation and default CLM remain upstream behavior. The original root-level integration patches remain unchanged for the historical macOS baseline. These are reproducible source commits, not GitHub release tags.

The shared `step-code-desktop-auto-resume.patch` adds structured provenance
to the existing automatic-continuation input. It keeps the normal input and
`before_agent_start` hooks, model validation and original provider instruction.
The idle extension input is persisted as a visible `step-auto-resume` custom
message, allowing Desktop to show a noninteractive timeline event instead of
claiming a human sent it. Retry policy and permission handling are unchanged;
unmarked existing history is not rewritten. Both platforms receive this fix.

The applier also installs `step-code-desktop-plan.patch`. Its explicit
`--desktop-plan-review` flag is supplied only to Desktop main workers. It adds
ephemeral Plan context before each model call and blocks proposal submission on
RPC review before restoring editing tools. Approval is checked against the
current history leaf, proposal path and full file contents. Cancellation or
expiry terminates the review turn while keeping Plan active. RPC child workers
do not receive this flag and retain the upstream auto-exit behavior. Plan is not
a read-only sandbox: command permissions remain unchanged.

`step-code-desktop.patch` contains the Windows build fix, desktop integration exports, and an opt-in in-memory auth backend. The build fix invokes npm through `process.execPath` and `npm_execpath`. The desktop backend activates only when the desktop client supplies an isolated auth path and credential payload; ordinary Step Code file storage is unchanged. The payload is removed from the child process environment during module initialization.

For current Windows/macOS builds, use the v015 command above on a clean checkout
of `b5dbed938d9ae589397cf522dcf2ff89ecf4c494`.

For reproducing the historical macOS 0.5.1 build only, use a clean checkout of
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8` and the original patch entry:

```powershell
node ../scripts/apply-step-code-desktop-patch.mjs . ../patches/step-code-desktop.patch
```

Do not apply again to the existing prepared checkout. Do not reset an upstream checkout with unrelated local changes. Rebuild upstream before staging the desktop runtime.

If the existing `Step-Code/` checkout must be preserved, build a separate checkout of the pinned commit with the integration patch applied, then stage it from `Desktop/`:

```powershell
corepack pnpm stage:runtime 'D:\path\to\prepared-step-code'
```

`DESKTOP_STEP_CODE_SOURCE` can supply the same source directory when using `pnpm package`. The explicit argument takes precedence, and the default remains `../Step-Code`. Staging refuses a different upstream commit before modifying the runtime. Updating the pinned baseline requires updating the staging check as well as CI and the integration patch applier.

Management operations use upstream SessionManager, configuration locking, skills discovery, and login/logout helpers in a separate process. Agent execution uses the upstream JSONL RPC entry.

The applier additionally installs `step-code-desktop-clarification.patch`, a
**Beta** opt-in `--desktop-clarification` bridge for `clarify_user` in main RPC
workers. It transports the unchanged question group and validated answers over
the existing cancellable input request. CLI/TUI and child RPC behavior remain
unchanged. No unattended timeout, automatic answer or durable pending-question
semantics are introduced. See `docs/UPSTREAM_QUESTIONNAIRE_BETA.md` for boundaries,
Plan integration and the follow-up upstream proposal.
Electron encrypts the desktop auth snapshot with platform `safeStorage` before writing it under userData. The runtime and management children receive the decrypted snapshot at launch and do not write `auth.json`. Any future upstream auth write path must be checked against this boundary before updating the pinned patch.
