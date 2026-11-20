# Step Code v0.1.8 集成

状态：三条线已合入同一个候选。常规构建、CI 与正式安装仍使用 v0.1.7。
下方 Windows 成品包验收使用 Desktop 基线 `f1c6892`，不代表已切换默认运行时。

## 源码与补丁

当前 Desktop 钉点仍为 `29eb460780489801ce8afc8bffc1a2efae7cbded`。
候选 `5309624e5deff3d8fee031f0853fe7e07bc68801` 包含 v0.1.8 更新说明中的主要改动。
它是本轮审查的源码候选，不是已核实的发布标签或 CLI 二进制来源证明。

共用基线选项 `DESKTOP_RUNTIME_BASELINE=v018` 让 staging、Remote adapter 与
包校验引用同一份 `patches/v018/manifest.json`。Windows 已在全新 detached
检出重放该清单的 70 个前像、88 个后像；补丁 blob 为
`815d252274220fe549064fe25e9618af2f46f746`。原 v017 清单和补丁未改。
Cron 与进程两份独立补丁保留作审查输入，已整合进共用补丁，不能再叠加。
Darwin 的进程树实现也在共用补丁内；平台能力已接线，未在 macOS 真机验证。

## 长会话与轨迹

新配置默认用原生摘要和 85% 压缩线；v017 仍显示 90%。显式 CLM、
显式 90%、全局／按模型阈值和 token 上限不随切换重写。模型长时间不输出时，
使用原生流空闲超时和重试，Desktop 不额外发起重试。

截断或报错的 `agent_end` 可能仍进入原生摘要恢复，即使 `willRetry=false`。
Desktop 等待 `agent_settled`，中间压缩结束不提前结算或放行队列。
候选真实 RPC 通过短请求对照、长中文近满请求、超大末条工具结果、超时重试及取消。
已完成工具不重跑，未完成的 Responses 调用不执行；工具和回合轨迹写入会话文件，
不进入模型输入。本轮不新增轨迹界面。

## Cron Beta

支持 Cron 表达式、固定小时数、指定时间单次。持久任务只归原会话；
未能核实归属的旧任务和旧暂停记录保留为只读。旧项目级自动恢复授权
保留但不启用；不猜测绑定、不补跑，需要继续用的旧任务请显式重建。
原生与旧 Beta 都可能使用 `schemaVersion: 2`，不按版本号猜测来源或恢复状态。

显式恢复只允许原会话，主进程和原生都检查版本与截止时间；恢复使用 Ask。
启动尚未取得执行准入时，不消费到期任务；启动中到点的任务仍可在就绪后执行。
恢复在截止前获准的单次任务，也不会因首个调度 tick 较晚被标为错过。
空白会话首次创建持久任务时先保存 owner；临时任务保持内存态，不写持久清单。
未信任项目只允许管理本会话的临时任务，不读写持久清单或开放恢复。
不承诺跨应用进程或设备精确一次。详见 [Cron 验收](CRON.md)。

## 后台命令与子代理

桌面按会话读取后台命令计数：有命令运行或无法确认状态时，不自动回收宿主。
后台命令不占用会话的发送、排队和通知状态。需要更换宿主时先检查；
删除会话和退出仍沿用主动清理。启用新能力后，供应商设置要等相关会话空闲、
后台命令已停止才可保存，避免待应用状态挡住停止命令所需的消息。

Windows 真实 RPC 使用 `SessionRuntimes` 和 Windows Job Object 启动同目录
A/B 会话。切换、回收和 fork 保留原来的 Git Bash 进程树，fork 不继承命令
或改动源历史；定向移除 A 后只有 A 的进程退出，重开不会复活。
原生的 `bash_list` / `bash_kill` 以会话为范围，`/ps` / `/subagents` 是 CLI
入口，不等于新增 Desktop 界面。并发默认 8 是原生子代理配置，不是 Desktop
应用全局上限。定向测试也覆盖 Windows 清理失败和子代理退出排空。

## Windows 验收

- 干净重放、冻结依赖离线构建、上游与 Desktop 类型检查和生产构建通过。
  上游定向测试 254 通过、6 跳过；已知的 Windows POSIX 路径断言另外记录，
  未放宽它或宣称上游全量通过。
- 同一份 staged runtime 的 10 个真实 RPC／原生存储用例全部通过，
  包含压缩默认与显式配置、长会话、真实进程树及 Cron 归属。
- 未安装的 Windows 包已校验 114 个 Desktop 产物、30 个运行时辅助文件、
  Node 和运行时入口。安装器 SHA-256：
  `8b0450d3dc3b10330f59d54ede954abc674969ae29a9f4fd682c775d419b7009`。
- 同一个解包 exe 的六项 Electron 验收均以 0 退出，只启动隔离配置：
  Cron 升级、后台命令进程树、后台子代理控制、角色模型路由、CLM 取消与队列恢复、
  设置对话框。Cron 旧记录和旧授权均原样保留；切换保留两棵实际进程树，
  删除 A 只停止 A，正常退出再停止 B。Electron 与六个被测进程均无残留。
  没有运行安装器，未触及正式安装或用户数据。

复跑时先用 `scripts/apply-step-code-desktop-patch.mjs <干净源码> patches/v018/step-code-desktop.patch`
重放，再按上游锁文件安装及离线编译。从 `Desktop/` 向 `scripts/stage-runtime.mjs` 传入
干净源码和新的独立输出路径（推荐 `…/runtime`），并设置 `DESKTOP_RUNTIME_BASELINE=v018`。
打 Windows 验收包另设 `DESKTOP_VERIFY_RUNTIME` 指向该 runtime；对成品测试设置
`DESKTOP_VERIFY_EXE` 指向解包 exe，不能默默回落到默认 v017。

| 验收入口（`Desktop/`） | 候选参数 |
| --- | --- |
| `tests/long-session-runtime.test.ts` | `DESKTOP_LONG_SESSION_ENTRY` 指向 `step/dist/bundle/step.js` |
| `tests/compaction-settings-runtime.test.ts` | `DESKTOP_COMPACTION_RUNTIME`，`DESKTOP_COMPACTION_EXPECTED_DEFAULT=0.85` |
| `tests/background-command-runtime.test.ts` | `DFSC_TEST_BACKGROUND_COMMAND_ENTRY` 指向同一入口 |
| `tests/cron-owner-runtime.test.ts` / `tests/cron-legacy-native-store.test.ts` | `DFSC_CRON_OWNER_RUNTIME` / `DFSC_CRON_CANDIDATE_SOURCE` |
| `scripts/verify-cron-v018-upgrade.mjs` / `scripts/verify-v018-process-electron.mjs` | `DESKTOP_VERIFY_EXE` |
| `scripts/verify-background-agent-controls.mjs` / `scripts/verify-subagent-role-models.mjs` | `DESKTOP_VERIFY_EXE` |
| `scripts/verify-clm-cancellation.mjs` / `scripts/verify-settings-dialog.mjs` | `DESKTOP_VERIFY_EXE` |

**换钉前**：用 Mac mini 验证 Darwin 原生进程树、退出及包内组合路径；对同一候选
完成真实账户／模型、既有数据升级与安装生命周期验收。v018 的两项专用 Electron
脚本目前登记为显式候选本地验收；切换默认钉点时要把 CI 的旧项目级 Cron 验收
迁移到会话归属契约。常规 CI 通过并不等于已用 v0.1.8 候选通过 CI。
