<p align="center">
  <img src="assets/readme/StepCode.svg" width="88" alt="阶跃星辰标志">
</p>
<br>
<p align="center">
  <img src="assets/readme/desktop-for-step-code-banner.png" width="480" alt="Desktop for Step Code">
</p>
<hr>
<p align="center">让想法阶跃星辰。</p>
<p align="center">Windows x64 · Electron · React · TypeScript · MIT</p>
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center">
  <img src="assets/readme/home-zh.png" width="360" alt="Desktop for Step Code 简体中文独立会话首页">
</p>

一个面向 Windows 的 Step Code 桌面客户端。它提供桌面工作区、对话和会话管理，Agent 执行由 Step Code 提供。

### 项目初衷

项目最初的想法，是在 StepFun 官方尚未正式推出 Step Code Desktop 的窗口期，尝试开发一个社区版 Desktop；鉴于我对阶跃星辰的喜爱，我也期待 StepFun 早日发布官方版本！

### 功能

- 流式对话、模型与思考等级选择
- 独立会话和项目工作区，会话历史与重命名
- 图片附件、工具调用确认和可恢复的会话删除
- Step 账户登录、MCP 配置与资源发现
- 中英文界面和明暗主题

桌面端使用单独的应用数据目录（`%APPDATA%\Desktop for Step Code`），不复用个人 Step Code CLI 配置。项目沿用 Step Code 的 Agent 运行时，不额外加入新的 Harness 能力。

### 下载与运行

当前仓库提供源码，GitHub Releases 暂无公开安装包。安装包和发布时间将在完成发布验收后另行确定；本机生成的安装文件不包含在仓库中。

从源码运行需要 Windows x64 环境和下方列出的构建依赖。首次启动后，在账户设置中使用自己的 Step Plan 账户或 Step Platform API Key 登录，再打开本地项目。Git/Bash、项目专用命令行工具以及 MCP 服务端依赖需在主机上另行安装。

### 从源码构建

需要 Windows x64、Git、Node.js 24.15.0（或兼容的 Node.js `>=22.19`）和 Corepack。构建前需在仓库根目录获取固定版本的 Step Code 上游代码，并应用本仓库维护的 Windows/Desktop 集成补丁。

在仓库根目录的 PowerShell 中运行：

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

生成 Windows x64 安装程序：

```powershell
corepack pnpm package
node scripts/checksums.mjs
```

### 当前状态

这是社区预览版，尚未完成完整的公开发布验收。已在非官方构建中使用固定版本的 Step Code runtime 执行 `step login`，并成功完成 Step Plan 浏览器登录。付费模型任务与真实工具审批流程仍需验证。安装、升级与卸载现已具备自动化残留验证（`Desktop/scripts/verify-residue.mjs`），含对 `~/.stepcode` 的逐文件未改动校验；干净机器首次安装与 125% 缩放仍待验证。MCP 状态目前反映配置是否启用，不代表连接健康检查；部分高级扩展界面也尚未覆盖。

### 许可

Desktop for Step Code 源码采用 MIT 许可证。Step Code 及其 Pi 上游组件保留各自许可证和版权声明。
