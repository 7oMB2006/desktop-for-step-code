# Platform port coordination

This file records the macOS work for the maintainer and the ChatGPT Dot agent
working on Linux. It lives on the macOS branch; it does not change Linux policy.

## Owners and branches

- Windows: `7oMB2006/desktop-for-step-code`, maintained by the owner.
- Linux: `Daodaodot/desktop-for-step-code`, branch `dot/linux-x64-integration`,
  maintained separately by ChatGPT Dot.
- macOS: the same fork, branch `codex/macos-0.5.1`, developed on the Mac mini.
  The original `dot/macos-arm64` remains the published v0.5.0-macos.1 source.

Do not reset or force-push the other platform's branch, the fork's `main`, or
Windows upstream. The macOS work does not depend on Linux changes.

## Frozen macOS baseline

After publishing v0.5.0-macos.1, the owner explicitly requested the Windows
**v0.5.1** Release, commit `15f0fa77ee1562d3297e226071d49c00c762d891`.
This iteration starts at `5b521cdd630c353e32542a16b1fb3ac990458912`, the PR #128
squash merge containing that Release and the macOS fixes. Later Windows PRs/main
and Linux work remain outside scope. The original macOS Release tag points to
`477ba3b24dbc2ae1443b665937a12345a3791ba4` and is not changed.

Step Code remains pinned to `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8` with
this release's existing Desktop integration patches and hash guards. The
untracked `Step-Code/` checkout and staged runtime must not be committed.

## Shared interfaces touched by macOS

- `DesktopBridge.platform`: an optional readonly platform string exposed by the
  sandboxed preload; no Node or filesystem access is added to the renderer.
- Runtime staging: choose `node` on macOS versus `node.exe` on Windows, handle
  the Unix Node distribution's npm layout, and record native platform/architecture
  in the runtime manifest. Preserve the source pin and patch verification.
- Terminal host and sessions: native zsh, POSIX shutdown and shell environment,
  case-sensitive terminal directory keys outside Windows, and executable permission
  for node-pty's macOS spawn helper.
- Main lifecycle: Dock activation restores the window, native application/Edit
  menus, PNG tray icons, and no automatic Windows installer checks on macOS.
- Existing `auth.dpapi` filename stays compatible; Electron safeStorage uses the
  native Keychain backend on macOS. Never add a plaintext credential fallback.
- Command-based clipboard/zoom actions on macOS; existing Windows keys stay intact.
- Tests use the platform's staged Node executable. Update-installer fixtures use
  canonical temporary paths because macOS has system `/var` symlinks; production
  cache integrity checks are unchanged.

Both agents touch some of these files. Compare behavior and individual hunks
before merging; do not copy the entire older platform file over newer code.
The Linux branch includes additional feature work that is outside this frozen
macOS release port.

## Delivery and validation

See [MACOS.md](MACOS.md) for native build and local preview instructions.
v0.5.0-macos.1 is published as an unsigned experimental Release. The current
0.5.1 work is a local candidate until separately released; neither fixture tests
nor publication establish paid-model acceptance. Keep factual validation results
in `docs/VERIFICATION.md`.

## v0.5.1 account integration

Windows v0.5.1's `AccountAllowanceService` is reused on macOS through the same
typed preload bridge. Main owns credentials and the fixed regional Plan/API
endpoints; the renderer receives display data only. Login/logout restarts the
management process with the applied credential snapshot, and model discovery
synchronizes that profile's endpoint. Keep the macOS awaited POSIX shutdown
guard when updating this flow: replacing management before exit would undermine
the identity boundary. No Step Code source/pin change is needed for this port.

The native macOS workflow now runs account settings, Plan allowance, API balance
and account routing in source and packaged apps, plus the browser display fixture.
These use synthetic identities and local/controlled transports, not real billing.


## Shared Desktop delivery follow-up

`workspace-policy.ts` now combines the existing shared-workspace policy with
Desktop capability/delivery instructions. `TurnArtifact.url` is optional and
identifies loopback web previews, dispatched to the existing built-in browser;
file candidates alone go through `artifactFiles`. Recognition does not perform
network requests or grant outside-workspace file access. No upstream pin or
Step Code checkout changes are needed. Preserve this distinction when porting
artifact UI or session startup changes across platform branches.


## File and archive identity follow-up

`normalizedFileKey(path, platform)` shares the workspace platform rules while
removing a leading `./` alias. Turn-change grouping/live readers and output-path/
artifact parsing receive an explicit platform from their main or preload caller;
the optional default remains Windows for existing pure-call compatibility. Never
fold POSIX case or treat a literal backslash as a directory separator. Undo's
main-process lookup uses the same platform as renderer diff grouping. Legacy
undo records with collapsed file lists are rejected rather than rewritten.
Archive project groups and custom-name lookup use `normalizedWorkspaceKey`.


## Runtime shutdown and preview transport follow-up

RpcProcess.stop now waits for POSIX child exit, with a bounded SIGTERM/SIGKILL
sequence and a shared in-flight stop promise. Requests disconnect immediately;
start is blocked while the old process is stopping. Preserve this ownership
guard when changing process lifecycle code. Windows retains taskkill tree cleanup.
LocalPagePreview URL keys convert the native separator only, preserving POSIX
literal backslashes as percent-encoded filename characters. Do not apply Windows
separator normalization to POSIX preview manifests.


### macOS 0.5.1 parity follow-up

The macOS updater uses `platforms.darwin` in the existing schema-1 update feed;
Windows `channels` and NSIS metadata remain compatible. macOS assets are an ARM64
ZIP plus `mac-update.json`; never point Windows clients at macOS-only tags.
Unsigned installation uses a confirmed, checked bundle replacement with startup
acknowledgement and recovery, while retaining Gatekeeper quarantine. Native file
application discovery/picking uses a bundled Swift AppKit helper. Linux is not
modified; do not infer Linux update support from the new macOS path.
