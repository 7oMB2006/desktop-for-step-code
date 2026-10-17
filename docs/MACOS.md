# macOS Apple Silicon preview

This track follows **Desktop for Step Code v0.5.1** (Windows release commit
`15f0fa77ee1562d3297e226071d49c00c762d891`) at the owner's request, preserving
the macOS changes merged in PR #128 (`5b521cdd630c353e32542a16b1fb3ac990458912`).
Later Windows main/PR work is outside this iteration. The first macOS preview
remains available as `v0.5.0-macos.1`; this branch prepares its 0.5.1 successor.
Linux is maintained separately; see [PLATFORM_HANDOFF.md](PLATFORM_HANDOFF.md).

## v0.5.1 account features

Account settings show Step Plan subscription/allowance or official API balance
according to the authenticated profile and region. Model discovery and runtime
requests follow that same applied identity. Selecting a sign-in method does not
switch the account until login completes; cancellation retains the prior account,
and a denied Plan request never falls back to pay-as-you-go API requests.

The Step Code runtime pin and patch guards are unchanged. macOS CI checks account
settings, Plan allowance, API balance and billing routes against both source and
packaged apps with isolated fixture credentials and local transports. Browser
presentation checks cover both themes, narrow English layouts and reduced motion.
These checks do not establish real-account balances or official billing outcomes.

## Build natively

Use an Apple Silicon Mac running macOS 13.5 or newer, Git, Xcode Command Line Tools, Node.js 24.15.0 and
Corepack. The fixed upstream pin and patch guards are retained.

From the repository root:

```sh
git clone https://github.com/stepfun-ai/Step-Code.git Step-Code
git -C Step-Code checkout 3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8
node scripts/apply-step-code-desktop-patch.mjs Step-Code patches/step-code-desktop.patch
(cd Step-Code && corepack pnpm install --frozen-lockfile && corepack pnpm build:offline)
cd Desktop
corepack pnpm install --frozen-lockfile
node node_modules/electron/install.js
corepack pnpm exec playwright install chromium ffmpeg
corepack pnpm stage:runtime
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
node scripts/verify-electron.mjs
node scripts/verify-auth-vault.mjs
node scripts/verify-account-settings.mjs
node scripts/verify-usage-account.mjs
node scripts/verify-account-allowance.mjs
node scripts/verify-account-balance.mjs
node scripts/verify-account-routing.mjs
corepack pnpm package:mac
node scripts/verify-macos-package.mjs
```

If downloads require a local proxy, supply `HTTP_PROXY`, `HTTPS_PROXY`,
`NODE_USE_ENV_PROXY=1` and `ELECTRON_GET_USE_PROXY=1` in that build shell.
Do not commit proxy credentials or change another developer's global settings.

The unsigned local application is
`Desktop/release/mac-arm64/Desktop for Step Code.app`. Packaging uses a temporary
staging project because electron-builder 26 cannot collect this repository's
hoisted pnpm dependency paths correctly. esbuild/Vite already bundle application
dependencies; the native PTY host is copied separately with its native addon and
executable helper. The package script verifies runtime platform and architecture.

## Try the app

Open the `.app` from Finder, or use `corepack pnpm dev` from `Desktop/`.
The packaged app carries its own Node and Step Code runtime. The integrated
terminal uses `/bin/zsh`; clipboard and image zoom use Command on macOS.
The window uses native macOS traffic lights in the upper left (red: close,
yellow: minimize, green: system full screen/window management). Its titlebar
shares the sidebar background, with the sidebar toggle at the sidebar edge.
The right tool rail keeps its priority above inspectors and uses a small 10px
upper-left corner at the titlebar junction. The startup logo is positioned at
the geometric center of the display containing the pointer on macOS, avoiding
the system window-centering offset.
Application commands are grouped under the upper-right ellipsis; standard
macOS menus and Command shortcuts remain available. Empty titlebar areas drag
the window, and sidebar collapse keeps the native controls unobstructed.
Closing the window leaves the app in the menu bar. Click its menu-bar icon or
Dock icon to restore it; use Quit or Command-Q to exit.

App-owned data is stored under
`~/Library/Application Support/Desktop for Step Code/`. It does not reuse a
personal Step Code CLI profile. Credentials use Electron safeStorage and macOS
Keychain; the encrypted file retains its historical `auth.dpapi` filename.

This build is unsigned and not notarized. Updates now share the Windows check,
channel, progress, cancel/retry and confirmed-restart UI, with a separate ARM64
catalog and installer. The downloaded ZIP is pinned to the official Release,
checked for exact length/SHA-512, and extracted with bounded paths and framework
symlinks. The current bundle is retained until the replacement starts and its
main process acknowledges the matching release; failed startup attempts recovery.
Preflight finishes before runtime shutdown. User data remains outside the app.

Unsigned updates can still trigger Gatekeeper confirmation. The installer adds
quarantine and uses LaunchServices; it never removes quarantine or bypasses system
security. Move the app into a writable Applications folder first. Read-only disk
images, App Translocation and unwritable installation folders require manual
installation. The existing 0.5.0 preview has no updater, so its first upgrade to
0.5.1 is manual. No Developer ID signature, notarization or Intel build is supplied.

File opening now lists LaunchServices applications, remembers explicit choices
per extension and offers the native application picker. A one-time picker does
not change the remembered application or the system file association. Executable
file restrictions and renderer isolation remain in place.

Real Step account login, paid model calls and external MCP services are separate
acceptance tasks; local fixtures do not establish those outcomes.


## Prepare a macOS Release

Package with `DESKTOP_MACOS_RELEASE_VERSION=0.5.1-macos.1` (the default is the
Desktop version plus `-macos.1`). Subsequent previews of the same base version
must increment that suffix, otherwise installed clients cannot detect an update.
A shared stable release can use `DESKTOP_MACOS_RELEASE_VERSION=0.6.0` when its
Desktop base version is 0.6.0. Packaging embeds the exact source commit and dirty
state; release preparation refuses an uncommitted or mismatched package.

After all required verification passes on the clean release commit, run
`node scripts/prepare-macos-release.mjs`. It writes an immutable candidate folder
under `Desktop/release/v<VERSION>/` with the ARM64 ZIP, `mac-update.json`,
`SHA256SUMS.txt`, `COMMIT.txt` and `runtime-manifest.json`. Review build evidence
and add release notes/BUILD-INFO before uploading. Publish `mac-update.json`
**as a Release asset**, along with the ZIP; its SHA-512 and exact size bind the
update to that archive. The update-feed publishing workflow retains schema 1's
Windows channels and adds `platforms.darwin` for macOS. Mac-only preview tags are
excluded from Windows discovery. A newer Windows-only release is not a Mac update.

Within the frozen Windows 0.5.1 scope, the remaining intentional differences are
native shell (zsh), shortcuts/menu/window behavior, bundle/ZIP packaging, ARM64
architecture and unsigned installation confirmation. Account/allowance/balance,
providers, sessions, approvals, collaboration, browser, artifacts, files, changes,
undo, terminal, tray and update controls share the feature implementation. This
inventory is a code/platform audit, not a claim of real-model acceptance.

The native AppKit helper is explicitly compiled for `arm64-apple-macosx13.5`;
package metadata and Mach-O deployment targets are checked. This avoids inheriting
the builder Mac's macOS 26 deployment target. Node 24.15.0 also requires 13.5.
The deployment target does not replace physical testing on older macOS versions.
