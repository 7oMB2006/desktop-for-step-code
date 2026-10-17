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

Use an Apple Silicon Mac, Git, Xcode Command Line Tools, Node.js 24.15.0 and
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

This build is unsigned and not notarized. Windows executable auto-updates are
disabled on macOS. The update settings explain this limitation and provide a
Releases link for manual downloads; Windows-only check/channel controls are hidden. Real Step account login, paid model calls, external MCP
services and an Intel Mac are separate acceptance tasks; fixture results do
not establish those outcomes.
