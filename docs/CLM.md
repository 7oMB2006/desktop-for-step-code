# CLM Inspector

The Context inspector defaults to Context. Its tabs are Context, Status, CLM.
A bare `/clm` opens CLM without submitting a prompt; parameterized commands and
`/clm-compact` retain their upstream handling.

## Data Boundary

The shared Windows/macOS 0.6.0 pinned v0.1.5 runtime adds the read-only `get_desktop_clm` RPC. It uses
`SessionManager.getBranch()`, not an archive-directory scan. Revisions are keyed
by entry ID, not the display revision number. Reset and regular-compaction
checkpoints are labeled separately. The panel shows five nodes at a time and
can browse the latest 2,000 branch records without deleting earlier history.

Contents are the saved checkpoint's contents, not a claim that the checkpoint
includes messages appended afterward. Diffs are the upstream saved unified
diff, not reconstructed prior message bodies. Token counts are shown only when
the runtime provides them; historical counts and automatic/manual provenance
are not inferred. Reset records need not contain contents or a diff.

Contents use a read-only Markdown presentation. Changes default to selectable
before/after excerpts parsed from the saved unified diff, with structural headers
omitted from the readable text. These are explicitly fragments, not full previous
checkpoints; no prior revision number is inferred. The complete returned diff
remains available in a collapsed raw view, including when readable parsing fails.
Context (including CLM and Status) and Changes share the standard, wide and
fullscreen width selector. Width changes preserve the mounted inspector.

Only the selected checkpoint's contents are returned. Limits are 200 blocks,
16,000 characters per block, 500,000 total body characters, and 128,000 diff
characters. Truncation is disclosed. The main process whitelists and redacts
presentation fields; credentials, mirror paths, archive paths and checkpoint
metadata do not cross preload. The renderer never reads files.

## Operations

Enabling/disabling changes the upstream session projection mode, not a separate
automatic-maintenance preference. Manual organization runs `/clm-compact`
through the runtime and can invoke the current model. It requires explicit
confirmation and supports the existing abort command. Reading history does not
call a model, rewind a branch or undo tools.

The main process checks account/workspace transitions, runtime identity,
busy/queued work, active Goals, pending model changes and native streaming state.
Operations are session-bound, serialized with the worker mutation lock, and
refresh their result from the runtime. Frontend request cleanup rejects obsolete
responses after selection/session changes. Tab switching preserves CLM browsing
state; closing the whole inspector currently remounts it on the latest revision.

The old Mac-only runtime did not include this inspector. macOS 0.6.0 now uses
the shared v0.1.5 implementation and native runtime tests. An unsupported runtime
still shows an unavailable inspector rather than synthetic revisions.

## Verification

- `pnpm typecheck`, `pnpm build`
- `pnpm exec tsx --test tests/clm-diff.test.ts tests/clm-inspector.test.ts tests/clm-inspector-runtime.test.ts tests/clm-runtime.test.ts tests/session-status.test.ts tests/session-status-runtime.test.ts tests/summary-runtime.test.ts tests/composer-commands.test.ts`
- `node scripts/verify-clm-panel.mjs` (real React component, simulated bridge)
- `node scripts/verify-command-dispatch.mjs` (source Electron/preload, isolated IPC fixture)
- `node scripts/verify-context-panel.mjs`, `node scripts/verify-review-panel.mjs`
  (isolated Electron, including width changes; `DESKTOP_VERIFY_EXE` targets a package)

Runtime tests exercise the staged native bundle with isolated profiles and
loopback model fixtures. They do not establish paid-model or packaged-installer
acceptance. The original visual-design fixture remains separate from the
production-component fixture at `tests/fixtures/clm-panel.html`.
