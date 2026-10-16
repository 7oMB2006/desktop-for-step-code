# macOS Apple Silicon preview

This port is based on **Desktop for Step Code v0.5.0** (release commit
`6fedd4d1883e4d1beaf6f4599134695e13a9ba50`), independently of subsequent
Windows PRs. Windows remains the published release target. Linux is maintained
on a separate branch; see [PLATFORM_HANDOFF.md](PLATFORM_HANDOFF.md).

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
corepack pnpm stage:runtime
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
node scripts/verify-electron.mjs
node scripts/verify-auth-vault.mjs
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
Closing the window leaves the app in the menu bar. Click its menu-bar icon or
Dock icon to restore it; use Quit or Command-Q to exit.

App-owned data is stored under
`~/Library/Application Support/Desktop for Step Code/`. It does not reuse a
personal Step Code CLI profile. Credentials use Electron safeStorage and macOS
Keychain; the encrypted file retains its historical `auth.dpapi` filename.

This build is unsigned and not notarized. Windows executable auto-updates are
disabled on macOS. Real Step account login, paid model calls, external MCP
services and an Intel Mac are separate acceptance tasks; fixture results do
not establish those outcomes.
