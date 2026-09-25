# Desktop for Step Code

An independent community Windows desktop client for Step Code. Not affiliated with or endorsed by StepFun.

## Current Delivery

Windows x64 preview, built with Electron, React and TypeScript. The application bundles an isolated Node runtime and the pinned Step Code bundle. End users do not need Node, pnpm, or the source checkout.

Features include local workspaces, streaming conversation, model/thinking selection, session history and rename, recoverable session deletion, image attachments, extension confirmation dialogs, Step account sign-in, MCP configuration, resource discovery, light/dark themes and Chinese/English UI.

The agent runtime remains Step Code. This project does not add a scheduler, memory engine, autonomous continuation system, or alternative permissions policy.

## Try the Local Build

Installer: `Desktop/release/Desktop for Step Code Setup 0.1.0.exe`.

Unpacked application: `Desktop/release/win-unpacked/Desktop for Step Code.exe`.

Open account settings to sign in with your own Step Plan account or Step Platform API key. These are different billing profiles; select the appropriate account and region. Then open a local project. The app stores its profile under `%APPDATA%/Desktop for Step Code`, separately from personal CLI installations.

The installer is unsigned. Git/Bash and project-specific tools are not bundled. Step Code's Windows PowerShell tool is available through the upstream runtime; tasks using Git/Bash require those tools on the host. MCP commands may require their own runtimes and credentials.

## Development

Prerequisites: Windows x64, Node 24.15.0 or compatible Node >=22.19, Git, Corepack.

The adjacent `Step-Code/` directory is an independent upstream checkout, excluded from this repository. See `patches/README.md` for the pinned commit and required patches.

```powershell
Set-Location Step-Code
corepack pnpm install --frozen-lockfile
corepack pnpm build
Set-Location ../Desktop
corepack pnpm install --frozen-lockfile
node node_modules/electron/install.js
corepack pnpm stage:runtime
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
node scripts/verify-electron.mjs
corepack pnpm dev
```

Package with `corepack pnpm package`, then run `node scripts/checksums.mjs`. The staging script copies the current Node executable, so build on the target Windows x64 platform. The app does not auto-update its runtime independently.

## Verification and Limitations

See `docs/VERIFICATION.md`. This is a locally validated preview, not a claim of completed public release acceptance. Account authorization and paid model task execution require user sign-in. Clean-machine installation/upgrade/uninstallation still require a separate acceptance pass.

MCP status currently describes configuration enablement, not a verified health check. Runtime notifications report connection failures. Existing advanced MCP fields are preserved when editing supported fields; secret values are not read back into the UI. Extensions are surfaced through discovered commands; there is no extension marketplace.

## License and Attribution

Desktop source is MIT licensed. Step Code and its Pi ancestry retain their upstream license and notices. Runtime notices are included in the bundled runtime directory. OpenChamber inspired workspace/conversation organization; its branding and agent extensions are not copied. Electron, Node.js, React and other dependencies retain their respective licenses.
