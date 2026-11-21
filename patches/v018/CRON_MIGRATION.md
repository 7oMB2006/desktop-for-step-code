# Cron migration integration contract

Candidate: `5309624e5deff3d8fee031f0853fe7e07bc68801`.
`step-code-desktop-cron-legacy-safety.patch` is an intermediate review delta.
The selected protections are in `step-code-desktop.patch`; do not apply both.
In this candidate Desktop keeps legacy jobs read-only and leaves old
automatic recovery grants inactive. It does not expose the conversion helper:
users who still need an old task must explicitly recreate it.

## Compatibility boundaries

1. Keep old and new workers from concurrently scheduling this project's file.
   Use the Desktop-owned profile and existing trust check; do not open the
   scheduler to enumerate or convert records.
2. A native owned task must match the canonical saved conversation. Unknown
   and unbound legacy rows are not activated; a prior Desktop pause marker
   remains parked even if the schema number matches a native record.
3. Creation of a durable task establishes the owner before writing to the
   native store. Revisions fence edits, deletion and explicit recovery.
4. Keep the v017 project-wide recovery grants readable but inactive for the
   session-owned runtime. Explicit recovery must use only the selected owner's
   reviewed tasks. Do not restore all tasks in a shared project into one worker.
5. Only then enable owned scheduling. Keep a trusted read-only disk inventory
   even with a live worker so foreign/offline, paused and unbound records remain
   visible. A native status of `completed` with `lastStatus: "missed"` is not
   evidence that a model ran or completed the task.

## Verification

Desktop native-source fixture: set `DFSC_CRON_CANDIDATE_SOURCE` to the prepared
checkout and run `pnpm exec tsx --test tests/cron-legacy-native-store.test.ts`
from `Desktop/`. The fixture exercises `CronFileStore` and `StepCronRuntime`,
not the packaged JSONL RPC, renderer, or a real account.

Upstream extension fixture: run `pnpm exec vitest --run test/step-cron.test.ts`
from `packages/coding-agent/` in the prepared checkout. It covers unclaimable
hybrid pause rows and first-open suppression of missed/expired legacy deliveries.
