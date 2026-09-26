<p align="center">
  <img src="assets/readme/StepCode.svg" width="88" alt="Step Code logo">
</p>
<br>
<p align="center">
  <img src="assets/readme/desktop-for-step-code-banner.png" width="480" alt="Desktop for Step Code">
</p>
<hr>
<p align="center">Let ideas reach the stars.</p>
<p align="center">Windows x64 · Electron · React · TypeScript · MIT</p>
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center">
  <img src="assets/readme/home-zh.png" width="360" alt="Desktop for Step Code home screen in Chinese">
</p>

A Windows desktop client for Step Code. It provides desktop workspaces, conversations, and session management; Step Code powers agent execution.

### Why This Project

The original idea was to explore a community-built desktop client for Step Code while no official Step Code desktop app has been released. Given my love for StepFun, I also look forward to its official release.

### Features

- Streaming conversations, model and thinking-level selection
- Independent sessions and project workspaces, with session history and renaming
- Image attachments, tool-call confirmations, and recoverable session deletion
- Step account sign-in, MCP configuration, and resource discovery
- Chinese and English UI, with light and dark themes

The app keeps its data in a dedicated directory (`%APPDATA%\Desktop for Step Code`) instead of reusing a personal Step Code CLI profile. Agent execution stays with Step Code; this project does not add another harness.
Step login credentials are encrypted for the current Windows user in `step-runtime/auth.dpapi`. Existing desktop `auth.json` data is migrated on startup, and the plaintext file is removed after the encrypted copy is saved. Uninstall removes the desktop Step credential files while keeping sessions, settings and independent workspace files; signing out removes the Step credential as well. This protects against casual offline reading of the file, not software running with access to the same Windows account. Other configured MCP secrets are outside this credential migration.

### Download and Run

This repository currently provides source code. There is no public installer on GitHub Releases yet. The installer and release timing will be decided after release acceptance; locally generated installers are not included in this repository.

Running from source requires Windows x64 and the development dependencies below. On first launch, sign in under Account Settings with your own Step Plan account or Step Platform API key, then open a local project. Git/Bash, project-specific CLI tools, and MCP server dependencies must be installed on the host separately.

### Build from Source

Requirements: Windows x64, Git, Node.js 24.15.0 (or a compatible Node.js version `>=22.19`), and Corepack. Before building, fetch the pinned Step Code upstream revision in the repository root and apply the Windows/Desktop integration patch maintained here.

Run these commands in PowerShell from the repository root:

```powershell
git clone https://github.com/stepfun-ai/Step-Code.git Step-Code
git -C Step-Code checkout 7dd66cb9f11a40ba19285b620084b362892cadea
git -C Step-Code apply ../patches/step-code-desktop.patch

Push-Location Step-Code
corepack pnpm install --frozen-lockfile
corepack pnpm build
Pop-Location

Push-Location Desktop
corepack pnpm install --frozen-lockfile
node node_modules/electron/install.js
corepack pnpm stage:runtime
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
node scripts/verify-electron.mjs
corepack pnpm dev
```

To produce a Windows x64 installer:

```powershell
corepack pnpm package
node scripts/checksums.mjs
```

### Project Status

This is a community preview and has not completed full public-release acceptance. Step Plan browser login was verified by running `step login` with the pinned Step Code runtime in a non-official build. Paid-model tasks and real tool-approval flows still need verification. Installation, upgrade and uninstall now have automated residue verification (`Desktop/scripts/verify-residue.mjs`), including a per-file check that `~/.stepcode` is untouched; clean-machine first install and 125% scaling are still open. MCP status currently reflects whether configuration is enabled, not whether a connection is healthy; some advanced extension UI is also not yet covered.

### License

Desktop for Step Code is licensed under MIT. Step Code and its Pi upstream components retain their respective licenses and notices.
