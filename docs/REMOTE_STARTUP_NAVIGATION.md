# 飞书启动恢复与本地会话导航

## 排查结论

2026-11-14，针对 `54945d54eeaf2aa7a83a5e61d331d9b90dec891e` 对应运行包核查并复现：
进入主页后，飞书正在自动恢复上次选择的会话时，点击侧边栏会话会显示：

```text
Error invoking remote method 'desktop': Error: Workspace operation in progress
```

`remote method 'desktop'` 是 Electron IPC 的异常包装，不是模块归属。
但本场景中占用工作区锁的操作确实来自 Remote 的飞书恢复路径。

## 时序

1. 初始 `beginSession` 完成，主页可交互。
2. `startup.then` 启动 `remote.resume()`；连接恢复后的 `connected()` 根据保存的 `access.sessionId` 重新选择历史会话。
3. `prepareRemoteSession()` 设置 `transition = true`，在不改变本地选中会话的前提下冷启动 Remote 运行时。
4. 侧边栏 `navigateSession` 请求遇到 `transition && !sessionNavigation.busy`，直接拒绝。
5. 前端把 IPC 异常原文显示为错误横幅。

这是后台恢复和前台导航缺少等待协调，不是已经发生会话数据损坏的证据。
没有保存连接，或没有需要冷启动的已选 Remote 会话时，不一定触发这条路径。

## 修复边界

- 保留 `transition` 互斥，使用独立的完成信号标识 Remote 准备过程。
- 只有 `navigateSession` 在 IPC 入口等待初始启动和已经进行中的 Remote 准备；不等待飞书整个网络连接周期。
- 等待发生在现有共享设置、撤销和窗口世代检查之前，醒来后仍执行这些保护。
- 完成信号无论 Remote 准备成功或失败都会释放；Remote 的失败不替代本地导航结果。
- 连续点击仍沿用现有导航机制，仅最新目标可以提交；Remote 准备不激活本地主视图。
- 不移除删除、迁移等操作的互斥，不统一重试写操作，不修改连接凭据或恢复旧审批。

这是保守的串行协调修复。Remote 运行时较慢时，用户会在已有会话加载状态中等待；没有实现前台抢占或取消 Remote 冷启动。
它也不是对所有启动后台任务和所有工作区入口的通用调度重构。
反向时序（本地导航已经持锁时，Remote 才开始准备）仍沿用原有拒绝行为，不属于本次修复范围。

## 等待提示与来源

2026-11-14，等待说明已从独立预览接入源码，不使用全局 toast 或错误横幅。

- 主进程在 `prepareRemoteSession` 入口显式提供来源，并为每次准备生成独立 ID。
- 飞书自动恢复显示“正在恢复飞书会话”；普通飞书会话选择或创建显示“正在准备飞书会话”。
- 外部 Agent 创建任务也使用该准备入口，显示“正在准备外部 Agent 任务”，不冒充飞书恢复。
- 仅在本地导航实际等待该准备过程且超过 1 秒时，从侧栏 Remote 图标上方展开气泡。
- 气泡显示最后选择的本地会话。连续点击不复制气泡，也不重置同一次准备的关闭状态。
- 关闭或 Escape 只隐藏说明，不取消导航；等待期间悬停、键盘聚焦入口可重新查看。
- 完成后移除气泡，不追加成功 toast。设置、项目移除对话框和折叠侧栏隐藏提示。
- 等待事件只发给原请求窗口，以导航序号过滤旧事件；不广播给插件窗口，不包含凭据或错误详情。
- 外部接入启动时恢复监听与授权，不自动重放旧任务；Hermes 插件的只读状态查询不走会话准备锁。

因此类似等待不限于刚启动，但必须由真实阻塞来源决定文案，不能仅根据 Remote 的连接状态推断。

## 验证

从 `Desktop/` 执行：

```powershell
node --import tsx --test tests/remote-startup-navigation.test.ts tests/session-navigation.test.ts tests/remote-management.test.ts tests/remote-manager.test.ts tests/remote-store.test.ts tests/session-runtimes.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node scripts/verify-remote-startup-navigation.mjs
```

- 修复前，首轮 7 项回归测试中 5 项失败，暴露主窗口、MiniChat、连续点击、恢复失败释放及初始启动等待问题。
- 修复后，相关测试共 314 项通过，其中新增回归测试 9 项；类型检查、构建和 `git diff --check` 通过。
- 隔离 Electron 验证使用原构建主进程 bundle，成功复现相同错误横幅。
- 修复构建在 Remote 冷启动被刻意挂起时接受连续点击，不提前生成本地运行时；释放后打开最后点击的会话，Remote 仍保留自己的会话及独立运行时。
- 原构建和修复构建的无保存连接对照组均通过。

原构建复现可设置 `DESKTOP_VERIFY_MAIN` 指向原 `dist/main.cjs`，并设置 `DESKTOP_EXPECT_STARTUP_BUSY=1`。
无连接对照可设置 `DESKTOP_VERIFY_REMOTE_DISABLED=1`；证据目录可通过 `DESKTOP_VERIFY_OUTPUT` 指定。
运行脚本时，当前目录须有与待测构建兼容的 `runtime/`。

测试使用独立临时 profile、合成凭据、模拟飞书通道和真实会话运行时，不接触日常配置，也不发送真实飞书消息。
这不构成真实账号、真实飞书服务或真实网络延迟的验收。
截图和结果保留于本机 `D:\Desktop For Step Code\output\remote-startup-navigation-20261114\`。

本轮未打安装包、未替换快捷方式、未重启日常客户端。
可重建本地输出约为 `dist/` 12.89 MiB、`terminal-runtime/` 61.39 MiB；运行时和依赖通过目录链接复用现有目录，没有另存一套安装包。

### 提示接入后的补充验证

- 相关两组 Node 测试合计 417 项通过，包含恢复来源和普通飞书选择的区分、三种来源事件、失败释放、无阻塞以及输入校验。
- 浏览器 7 组通过：明暗、窄窗口、三种来源、快速准备和无 Remote 阻塞的慢导航。
  同时验证旧导航事件不会清除新目标的说明、关闭后切换目标不重弹、键盘/悬停重新查看、设置隐藏与侧栏收起。
- 隔离 Electron 的飞书自动恢复路径通过：真实 preload/IPC 显示恢复文案，释放后打开最后选择的本地会话，并保留独立 Remote 会话。
- 隔离 Electron 的外部 Agent 路径通过：通过真实 loopback gateway 配对、发起 `task.create`，
  冷启动被挂起时显示外部 Agent 文案，释放后外部任务创建和最后选择的本地导航均完成。
  没有运行真实 Hermes companion、模型任务或真实飞书账号。
- 类型检查、源码构建和 `git diff --check` 通过。

浏览器证据位于 `remote-navigation-integrated/`，Electron 证据位于 `integrated-feishu/`、
`integrated-external-agent/`，均在上述本机证据根目录内。
预览仍可通过 `node scripts/preview-remote-startup-toast.mjs` 启动，侧栏底部可切换准备来源；
预览复用正式组件，仅替换桥接数据，不证明真实账号验收或已安装客户端更新。
两个新增验收脚本已登记为本地检查：Electron 脚本需要源码 bundle 插桩以比较修复前后，
不支持包内入口；浏览器脚本需要另行启动 Vite 预览。确定性回归测试随常规协议测试执行。

### PR 前主线合流复验

同步 `main c1f8f01`，保留外部任务已有的 Ask / approve-for-me 授权档位，
将准备来源作为独立参数传递。新增回归验证外部任务来源和已授权档位可以同时保留，
不以等待提示覆盖或升级权限。

- 两组定向 Node 测试共 470 项通过，含上述新增回归及主线外部审批、插件风险确认和档案生命周期检查。
- CI 清单、路由与运行器检查 32 项通过、1 项平台跳过；类型检查、源码构建和差异空白检查通过。
- 新构建重新通过 7 组浏览器检查及飞书恢复、外部任务创建、未连接对照 3 组隔离 Electron 验证。
- 本次补验证据位于上述根目录的 `pr-main-sync/`；仍不代表真实账号、Hermes 模型任务或云端 CI 通过。
- 当前可重建输出为 `dist/` 13,626,438 字节、`terminal-runtime/` 64,376,748 字节，
  没有新增安装包或删除历史产物。
