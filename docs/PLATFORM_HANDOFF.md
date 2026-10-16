# Platform port coordination

This file records the macOS work for the maintainer and the ChatGPT Dot agent
working on Linux. It lives on the macOS branch; it does not change Linux policy.

## Owners and branches

- Windows: `7oMB2006/desktop-for-step-code`, maintained by the owner.
- Linux: `Daodaodot/desktop-for-step-code`, branch `dot/linux-x64-integration`,
  maintained separately by ChatGPT Dot.
- macOS: the same fork, branch `dot/macos-arm64`, developed on the Mac mini.

Do not reset or force-push the other platform's branch, the fork's `main`, or
Windows upstream. The macOS work does not depend on Linux changes.

## Frozen macOS baseline

The owner explicitly requested the latest published Release, not Windows main.
The selected baseline is **v0.5.0**, commit
`6fedd4d1883e4d1beaf6f4599134695e13a9ba50`. Keep it fixed for this port;
new Windows PRs and main commits are outside this iteration.

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
This is a local unsigned preview, not a new public Release or a claim of paid
model acceptance. Keep factual validation results in `docs/VERIFICATION.md`.
