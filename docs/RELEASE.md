# 首版发布准备

状态：整理中，尚未发布。核对日期：2026-10-07。

## 定位与候选基线

建议首版定位为 **Windows x64 社区预览版**，而不是稳定版承诺。暂定应用版本 `0.1.0`、tag `v0.1.0`，GitHub Release 勾选 Pre-release；版本和发布操作仍需维护者确认。若需要先公开候选测试，可另定 `0.1.0-rc.1`，并同步应用版本、tag 与说明，不使用同一个 tag 覆盖不同包。

准备工作从 `f3d83c3`（PR #70 合并后的 main）开始。该提交只是本次整理基线，不是已经验收的最终发布提交。文档和必要修复合并后，应重新记录最终 commit，再从该提交构建唯一候选包。

PR #70 的 Windows integration 已通过：
https://github.com/7oMB2006/desktop-for-step-code/actions/runs/37619401736/job/112789625500

这不等于最终 main 安装器通过验收。现有工作流仅由 pull_request 触发，没有 main/tag 发布构建；发布前需要在精确候选提交上执行检查并保存记录。

## 首版范围

纳入已经合并的 Desktop 能力，不为首版继续扩张功能：

- Step Plan / API Key 登录、独立 Desktop 凭据存储、模型和思考等级选择、工具审批。
- 项目和独立会话、拟创建会话、排序与拖动、项目置顶、归档、恢复和永久删除。
- 并发会话、队列与插队引导、会话分支、文本引用、跨会话链接及协作工具。
- 流式正文、思考耗时、子代理状态、摘要板、上下文检查、会话导航。
- 单轮记录改动预览与有限撤销、Git 工作目录及分支差异查看。
- 用户操作的 PowerShell 终端、内置浏览器、只读文件预览、网页和产物引用、文件打开偏好。
- 中英文界面、明暗主题和减少动态效果；新建会话英文语录的扩充延后。

中文新建会话保留首句“让梦想阶跃星辰”及低频开发者座右铭“踽踽而行 步履不停”，不在发布整理中替换既定语料。

执行、权限和模型行为仍由固定 Step Code 运行时提供。Desktop 的并发与协作功能不提供文件锁或事务隔离。

## 必须通过的发布门槛

以下未勾选项均未在本轮获得最终候选证据，不因历史验收或用户日常使用自动通过。

| 状态 | 门槛 | 通过条件 |
| --- | --- | --- |
| 已核对 | 准备基线 | 最新 main 已包含 PR #70；保留旧脏工作区，不从中直接发包 |
| 待完成 | 版本及候选冻结 | 确认版本，记录完整 commit SHA；候选源码无未提交修改 |
| 待完成 | 源码验收 | frozen-lockfile 安装、typecheck、全部 unit/protocol tests、build、PR CI 中全部 Electron 检查通过 |
| 待完成 | 补充交互回归 | Context、Diff、撤销、引用、流式滚动等未单独列入当前 CI 的专用检查通过；关键明暗/窄窗截图人工确认 |
| 待完成 | 候选安装器 | 从冻结提交生成 NSIS x64 包；打包失败不得用旧 exe 或只用 unpacked 目录替代 |
| 待完成 | 包内资源 | 核对 runtime manifest、Node、Step bundle、Desktop helpers、terminal host 及文件打开辅助资源；无账户、个人会话、fixture profile 或意外构建目录 |
| 待完成 | 许可证及签名 | 检查安装包实际携带的上游/第三方许可证与版权声明；检查 Authenticode 状态，如未签名则明确说明可能出现 SmartScreen 提示 |
| 待完成 | 打包版回归 | 使用该候选包的独立测试 profile 验证登录存储、并发/队列、摘要/子代理、浏览器/终端、链接/文件预览和通用 Electron 行为 |
| 待完成 | 真实模型烟测 | 在最终候选上使用自己的真实账户完成任务、审批、历史恢复；核对至少一项真实工具改动与产物打开，不把 fixture 说成真实模型 |
| 待完成 | 安装生命周期 | 一次性 Windows 环境完成下述流程，记录缺失或失败，不在日用机执行破坏性安装测试 |
| 待完成 | 文档与校验值 | README 下载状态、已知限制、候选安装器 SHA-256 与 Release 文案一致；实际上传后再次下载核验 |

详细历史证据保留在 [VERIFICATION.md](VERIFICATION.md)。其多次 source-only / preview package 记录不可拼接为同一个最终安装器的通过记录。

## 安装生命周期

在一次性 Windows VM / 专用测试用户中：

1. 全新安装，确认无需 Desktop 开发依赖即可启动。主机仍需自行提供任务所需 Git/Bash、项目工具和 MCP 服务。
2. 登录，创建项目会话和独立会话；保存测试文件，关闭并重新启动，检查凭据及历史恢复。
3. 从选定的旧预览安装器覆盖升级到候选包，核对会话、设置、文件及凭据保留。旧包也标为 `0.1.0` 时，只能记录为 build-to-build 迁移，不宣称正式跨版本升级。
4. 正常卸载，确认 Step 凭据 `auth.dpapi`、`auth.json`、`legacy-auth.json` 被移除；会话、设置、独立工作区和外部项目文件保留。
5. 重新安装，检查保留数据能读取、账户需重新登录；排查卸载残留进程及注册项。

**不要在日用主机运行 `verify-residue.mjs verify/upgrade`。** 该脚本涉及固定安装目录及清理操作；必须先在一次性环境核对其路径和行为。凭据清理仅指 Desktop Step 凭据，不包括任意 MCP 配置中的秘密，也不表示删除全部个人数据。

## 构建与证据记录

当前 main 的 `pnpm package` 会 build、stage runtime，再调用 electron-builder。不能假设旧工作区的 `scripts/package.mjs` 已合并，也不能跳过固定 runtime 校验复用未知来源的 dist。

运行时预期：Step Code `519e4de4ed2162d3667be1821cb92ada6b884e5a`，Node `v24.15.0`，应用仓库维护的 Desktop 集成补丁。独立 `Step-Code/` checkout 与 staged runtime 分开管理；此次整理不修改该 checkout。

候选证据记录应包含：

```text
应用版本 / tag：待确认
候选 Desktop commit：待冻结
构建日期及 Windows 环境：待记录
Step Code commit / patches / Node：待包内核对
安装器文件名 / 字节数 / SHA-256：待生成
Authenticode 状态：待检查
源码与打包版检查结果：待记录
真实账户烟测：待记录，不保存凭据
安装 / 迁移 / 卸载 / 重装：待记录
未验收项与已知限制：待最终复核
发布授权：尚未获得
```

构建完成后只生成该候选的 `SHA256SUMS.txt`，避免把 release 目录中旧 exe 一起当成首版附件。大型产物先盘点精确路径、占用及进程；删除旧包另行获得授权。

## 发布步骤

1. 完成门槛并把证据摘要写回 VERIFICATION；未通过的关键项阻止发布。
2. 确认 [首版说明草稿](releases/v0.1.0-draft.zh-CN.md) 与实际候选能力、版本和限制一致。
3. 维护者明确授权后，创建指向冻结提交的 tag 和 GitHub Pre-release，上传 NSIS 安装器与 SHA256SUMS；发布前不要在 README 声称已有下载。
4. 读取已发布元数据、下载附件并核验哈希，确认链接后再更新 README 下载入口。
5. 仅保留当前候选与必要证据；历史包清理不与发布授权混同。

## 2026-10-07 本地候选记录

这份记录用于发布准备，不表示发布门槛全部通过。候选应用代码来自 `f3d83c30ecdc82df46542c773e1ef9c8f44319f3`；之后仅修正补充 Diff 验收脚本的旧新建会话假设，未修改候选应用代码。发布文档尚未合并，最终 tag 提交仍待冻结。

- 本地日用工作区已备份并 fast-forward 到 main；备份 ref 为 `refs/backups/pre-release-workspace-2026-10-07`。原来的独立 Step-Code 开发 checkout 保留。
- 从独立 worktree 的 pinned Step Code 应用仓库补丁，frozen-lockfile 安装、构建并重新 staging 成功。上游构建联网生成模型目录，tracked 差异只有 `.manifest.json` 生成时间戳，结构哈希未变；不宣称构建逐字节可复现。
- Desktop typecheck、220 项 unit/protocol tests 和 production build 通过。构建仍提示 renderer 大 chunk，不作为已经优化的性能承诺。
- NSIS 安装器：`Desktop/release/v0.1.0-candidate/Desktop for Step Code Setup 0.1.0.exe`，`156676788` bytes。
- SHA-256：`6d20c9c911e7832c0f1af6feeee15a9a51d0152f738e31d4ae7177552bcb1db0`；同目录包含仅记录该安装器的 `SHA256SUMS.txt`。
- 安装器 Authenticode 为 `NotSigned`。electron-builder 的 signing 日志不代表实际具有签名证书。
- 包内 manifest、Node、Step entry bundle、两份 Desktop helpers、terminal host 和文件打开辅助脚本与 staged/build 资源哈希一致。app.asar 根目录仅有 `node_modules`、`dist`、`package.json`，无旧 release/test-results 或源码工作目录。
- 包含 Desktop/Step MIT、Step NOTICE/THIRD_PARTY_NOTICES、Node LICENSE、Electron/Chromium 许可与依赖许可文件；这不是对所有第三方材料的法律审计。
- 候选安装器与 unpacked 合计约 712 MiB。旧包尚未删除，日用中的 `file-opening-persistent-preview` 进程未中断。
- 源码完整 Electron 检查、打包版回归、真实账户烟测和一次性 Windows 安装生命周期的最终结果尚待补齐。未创建 tag、GitHub Release 或上传附件。
