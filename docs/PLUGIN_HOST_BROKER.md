# 插件宿主模型代理服务

状态：2026-11-08，计划 [Ⅲ] 的代理服务与原生启动绑定候选，**尚未发布**。
依赖 [宿主协议候选](PLUGIN_HOST_CONTRACT.md)，不升级 runtime pin。
生产 `main.ts` 已按 runtime 能力标记创建服务，核验原生发现记录后才签发上下文。
preload、renderer 没有新增私有 RPC 或签发接口。模式选择/配置界面尚未交付，
测试以主进程存储器显式提交模式；安装 SDK 示例不会自动授权，也不等于日用版可用。

## 组件与责任

| 组件 | 当前实现 | 尚未交付 |
| --- | --- | --- |
| `PluginHostBindingStore` | 安装 receipt、包指纹、模式及配置修订、实例数据目录 | 用户模式选择入口；未来写入也须进入管理队列 |
| `PluginHostBroker` / `PluginHostLauncher` | 主进程签发、原生记录绑定、管理队列、逐能力确认、主动撤销、取消及资源预算 | 更新后的授权状态展示、完整 Electron/实包验收 |
| `StepPluginHostProvider` | 实际会话模型、官方账户路由、窄提供商请求及结果规范化 | 真实账户权益验收、TTS、其他提供商 |
| SDK 示例 | 自包含 stdio 服务通过真实 broker 调用及拒绝测试 | 正式市场发布及用户安装验收 |

`step-model-account.ts` 从 BVR 原桥提取四条既有账户路由，BVR 继续使用原桥。
这次不是 BVR 迁移，不把旧 opt-in 或安装状态继承为新协议的付费授权。

## 主进程签发

服务在 `127.0.0.1` 随机端口监听。`issue(descriptor, worker)` 只能由持有服务实例的
主进程调用，HTTP 不提供申请租约或按 pluginId 查询租约的接口。

签发核对有效 receipt、安装路径、包与声明指纹、已提交模式和配置修订，
以及连接中的 runtime、RPC 对象和会话。每次跟随启动生成独立随机 bearer，
有效期不超过 30 分钟或当前账户到期时间，取较早者。
独立模式不读取宿主账户、不要求宿主登录，返回上下文不含 broker。
返回的上下文与内部租约分离，调用方不能通过修改对象改变服务内的授权。

构造器强制要求主进程提供 `validateConsumer(descriptor, binding, worker)`。
生产由 `PluginHostLauncher` 实现：经 `CapabilityService` 同一管理队列，
将有效安装 receipt、唯一目录、管理目录中的 stdio 消费者与实际原生记录独立比对，
重读声明和执行指纹，拒绝全局覆盖、冲突来源、失效 transport 或含糊身份。
不能凭插件自报 ID、PID、已启用状态或 Full Access 取得身份。

## 原生启动与门控

仅当 staged manifest 含 `desktop-plugin-host-launch` 时，主进程向会话 runtime
传入 `DFSC_RUNTIME_HOST_V1=1`。原生延后 `dfsc.host.json` 声明的消费者，
在真实 sessionManager 下保存一次性私有记录；其他 MCP 保持既有启动行为。
主进程通过私有 `desktop_plugin_host` RPC 查询、复核并启动该消费者。
没有有效模式、配置过期、声明损坏或来源冲突时保持延后，不默认跟随。

接线等到会话和实际模型恢复完成；供应商/登录事务期间仅记录等待中的新 transport，
事务门控释放后再核验。撤销会清理等待记录，不给旧连接自动重新签发租约。
上下文只注入这一次消费者启动的 `DFSC_LAUNCH_CONTEXT`，不写入全局环境。
继承的 `DFSC_HOST_*`、`DFSC_LAUNCH_*` 和原生启用标记在 runtime 环境边界被清除。
私有正常响应不进入事件，超时后迟到或无法匹配的响应同样丢弃；
hosted 初始化/目录错误规范化，不把原始错误中的上下文转发给界面。
关闭会话会等待进行中的延后启动完成清理。

## 确认与失效

上下文查询读取实际 `get_state` 和账户元数据，不调用模型、不申请付费确认。
首次调用某能力时，经既有 `pool.confirm` 等待明确同意，展示插件、模型、
地区、Plan/API 渠道、数据发送及费用提示。后台会话不能弹确认时直接拒绝。
生产调用已复用既有确认抽屉，但本轮没有新增模式设置或授权状态界面，
也未验收完整 Electron 中的付费确认流程。

确认按租约与能力分别记录；同能力并发请求共享一次确认。
拒绝后该租约不反复弹窗，也不自动换账户、模型或计费渠道。
单个调用取消不会取消另一个仍在等待的确认用户；最后一个等待者取消后结束确认。
确认后和返回结果前再次核对身份、账户、已应用模型及修订。

`invalidate(worker?)` 撤销指定 runtime 或全部租约，并中止已开始和排队的请求。
过期和 `close()` 同样中止。即使 provider 忽略取消，调用方和并发槽位也会按截止时间退出。
取消不保证已送达提供商的请求不产生费用。

主进程已将账户持久化（含切换/退出）、实际模型应用、会话重载/关闭、
runtime 重启、插件配置/管理操作和全局 MCP 保存接入主动失效钩子。
请求检查会拒绝旧身份，但不能替代这些钩子对进行中请求的立即撤销。
现有配置/更新操作与启动描述核验共用 `CapabilityService` 管理队列；
未来模式设置写入也必须进入同一队列，binding store 不是跨 writer 锁。
单个启动失败只释放自己的租约，不撤销健康的其他消费者。
租约过期或撤销后需要显式重启，不透明续租。Cron 恢复准备仍保持延后，
本轮不自动接线或补跑 Cron 插件。

## 路由和能力

账户秘密仅保留在主进程 provider 的私有映射中，不进入 context、结果或错误。
账户修订使用带进程随机盐的 HMAC，不输出原始 Key 的哈希。
读取实际 RPC 的已应用模型，不使用 Desktop 尚未应用的模型选择。

| 账户配置 | 固定提供商根路径 |
| --- | --- |
| `step_plan` | `https://api.stepfun.com/step_plan/v1` |
| `step_plan_oversea` | `https://api.stepfun.ai/step_plan/v1` |
| `platform_cn` | `https://api.stepfun.com/v1` |
| `platform_oversea` | `https://api.stepfun.ai/v1` |

| 能力 | 当前适配 |
| --- | --- |
| `model.text` | 当前会话官方 Step 模型，`/chat/completions` |
| `model.video` | 同一模型及渠道，仅已知视频模型或 runtime 明确声明 video 输入时开放 |
| `model.asr` | 专用 `stepaudio-2.5-asr`，同渠道 `/audio/asr/sse`；本适配器仅接受 WAV |
| `model.tts` | 明确返回 `CAPABILITY_UNAVAILABLE`，不猜测 OAuth 的 TTS 路由 |

候选 wire contract 允许的音频 MIME 比当前 Step 适配器更多，不能据此承诺都能调用。
`available` 表示存在受限适配路径，不是实时余额、套餐权益或成功调用保证。
非 Step 账户、过期账户和未知专用模型不自动回退。
没有重试、任意 URL、任意 header、输出路径、计费渠道切换或偷偷调用独立 Key。
`model.image` 仍未加入协议，未来须另补能力声明、请求/结果类型和 provider 验收。

## 请求预算

- 严格 JSON POST、精确 Host、单个 bearer；拒绝任何 Origin，包括空值。
- 仅 `/v1/context`、`/v1/invoke`、`/v1/cancel`，不接受查询参数或浏览器跨域入口。
- 每实例每会话并发 2、全局并发 8、队列 32；最多 64 个有效租约。
- 单租约至多 1024 个不重复 requestId；取消只作用于本租约。
- 排队 30 秒、确认 60 秒、provider 180 秒；租约到期独立生效。
- 请求 JSON 32 MiB；Step 原始响应读取上限 2 MiB；通用结果另按候选协议校验。
- 提供商错误与非预期异常规范化，不向插件转发原始响应体、账户资料或请求头。

## 验证边界

`Desktop/tests/plugin-host-broker.test.ts` 使用真实服务、安装 receipt 和模式存储，
提供商 fetch、账户及确认均为隔离 fixture。
`sdk-host-starter/test/broker.test.mjs` 使用真正官方 MCP client 启动自包含 SDK 子进程，
从无依赖的安装副本通过 HTTP 调用实际 broker 和 Step adapter，再由假 fetch 返回结果。
这些用例验证 Step adapter 的路由，但不代表真实账户权益可用。

`Desktop/tests/plugin-host-runtime.test.ts` 使用固定 pin 的实际 runtime、原生发现、
私有 RPC、安装 receipt、真实管理目录和 SDK 子进程，并通过测试专用 MCP proxy
触发同一子进程工具。它覆盖门控释放、确认、broker 调用、账户撤销、全局覆盖、
初始化错误回显隔离及关闭 opt-in 的兼容行为；provider 为隔离 fixture。
没有借此声称实际 Step 请求、真实权益或生产界面已验收。

模式/授权设置界面、完整 Electron/实包验收、真实账户/权益、TTS、
BVR 迁移和跨仓库发布仍是后续门槛，不能把计划 [Ⅲ] 标为完成。
