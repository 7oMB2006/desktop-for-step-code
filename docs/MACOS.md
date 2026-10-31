# macOS Apple Silicon preview

This branch prepares **Desktop for Step Code 0.6.0** on Apple Silicon. The
owner authorized the Windows feature freeze at PR #163 merge
`324e71d1800de020c035cdce598374a6037ba4ca` on 2026-10-24. Existing macOS native
behavior is retained; later Windows main and Linux changes are outside scope.
Step Code now shares the v0.1.5 pin `b5dbed938d9ae589397cf522dcf2ff89ecf4c494`
and complete reviewed integration patches with Windows, plus a Darwin process-tree
cleanup patch. Old preview tags and packages are unchanged.

See [0.6.0 candidate, audit and handoff](releases/v0.6.0-macos-preparation.zh-CN.md)
for feature coverage, the shared Release draft sequence and user acceptance.
This is local candidate preparation, not a published or real-account-accepted release.

## v0.5.1 account features

Account settings show Step Plan subscription/allowance or official API balance
according to the authenticated profile and region. Model discovery and runtime
requests follow that same applied identity. Selecting a sign-in method does not
switch the account until login completes; cancellation retains the prior account,
and a denied Plan request never falls back to pay-as-you-go API requests.

The v0.1.5 runtime and patch hashes are strictly checked during staging. macOS CI checks account
settings, Plan allowance, API balance and billing routes against both source and
packaged apps with isolated fixture credentials and local transports. Browser
presentation checks cover both themes, narrow English layouts and reduced motion.
These checks do not establish real-account balances or official billing outcomes.

## Build natively

The commands below target the development v0.1.6 announcement source baseline
`81e79bc4b699148d6823fedde9b5e70d9a80255f` and `patches/v016/`. The 0.6.0
freeze and acceptance records above remain historical. Darwin patch replay on
Windows is not a native macOS build or package acceptance.

Use an Apple Silicon Mac running macOS 13.5 or newer, Git, Xcode Command Line Tools, Node.js 24.15.0 and
Corepack. Use a dedicated checkout when the existing Step-Code directory has local changes.

From the repository root:

```sh
git clone https://github.com/stepfun-ai/Step-Code.git Step-Code
git -C Step-Code checkout 81e79bc4b699148d6823fedde9b5e70d9a80255f
node scripts/apply-step-code-desktop-patch.mjs Step-Code patches/v016/step-code-desktop.patch
(cd Step-Code && corepack pnpm install --frozen-lockfile && corepack pnpm build:offline)
cd Desktop
corepack pnpm install --frozen-lockfile
node node_modules/electron/install.js
corepack pnpm exec playwright install chromium ffmpeg
corepack pnpm stage:runtime
corepack pnpm typecheck
corepack pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts
corepack pnpm build
node ../scripts/ci-macos.mjs
DESKTOP_MACOS_RELEASE_VERSION=0.6.0 corepack pnpm package:mac
node scripts/verify-macos-package.mjs
DESKTOP_VERIFY_EXE="$PWD/release/mac-arm64/Desktop for Step Code.app/Contents/MacOS/Desktop for Step Code" DESKTOP_MACOS_RESOURCES="$PWD/release/mac-arm64/Desktop for Step Code.app/Contents/Resources" node ../scripts/ci-macos.mjs
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

Package with `DESKTOP_MACOS_RELEASE_VERSION=0.6.0` for the shared Release (the default is the
Desktop version). Mac-only previews can explicitly use `0.6.0-macos.1`. Subsequent previews of the same base version
must increment that suffix, otherwise installed clients cannot detect an update.
A shared stable release can use `DESKTOP_MACOS_RELEASE_VERSION=0.6.0` when its
Desktop base version is 0.6.0. Packaging embeds the exact source commit and dirty
state; release preparation refuses an uncommitted or mismatched package.

After all required verification passes on the clean release commit, run
`node scripts/prepare-macos-release.mjs`. It writes an immutable candidate folder
under `Desktop/release/v<VERSION>/` with the ARM64 ZIP, `mac-update.json`,
`SHA256SUMS-macos-arm64.txt`, `COMMIT-macos-arm64.txt` and `runtime-manifest-macos-arm64.json`. Review build evidence
and add release notes/BUILD-INFO before uploading. Publish `mac-update.json`
**as a Release asset**, along with the ZIP; its SHA-512 and exact size bind the
update to that archive. The update-feed publishing workflow retains schema 1's
Windows channels and adds `platforms.darwin` for macOS. Mac-only preview tags are
excluded from Windows discovery. A newer Windows-only release is not a Mac update.

Within the frozen Windows 0.6.0 scope, the remaining intentional differences are
native shell (zsh), shortcuts/menu/window behavior, bundle/ZIP packaging, ARM64
architecture and unsigned installation confirmation. Account/allowance/balance,
providers, sessions, approvals, collaboration, browser, artifacts, files, changes,
undo, terminal, tray and update controls share the feature implementation. This
inventory is a code/platform audit, not a claim of real-model acceptance.

The native AppKit helper is explicitly compiled for `arm64-apple-macosx13.5`;
package metadata and Mach-O deployment targets are checked. This avoids inheriting
the builder Mac's macOS 26 deployment target. Node 24.15.0 also requires 13.5.
The deployment target does not replace physical testing on older macOS versions.
