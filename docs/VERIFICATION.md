# Verification

## Ultra CI 的计时验收交互边界（2026-11-12）

`84e45b7` 的 Windows 全组及 `CI result` 通过，macOS 候选构建/协议、
sessions 源码与包内组通过。macOS runtime 源码组在
`verify-conversation-timing.mjs:90` 失败：悬停后时间戳透明度实际为
`0`，严格期望 `1`。原云端没有记录 DOM 悬停及读取预览状态，不能据此
断言具体根因；此前两处夹具与这个脚本也没有调用关系。

计时夹具特意延迟真实 runtime 以验证历史先显示，但原本在完成悬停
断言后才等待 runtime 就绪。保留历史计时断言在前，将原有的 60 秒
交互就绪检查移到首次悬停之前，避免交互落在待替换的历史预览上。
`settleLayout`、精确 `0/1` 透明度、计时数值、重载、主题、窄屏及
实时冻结断言均保留，不修改产品或共享动画函数；失败补充预览、忙态、
文档焦点及实际 DOM 悬停状态。

执行原脚本真实交互片段的浏览器回归确认：忙态或预览任一未结束时
不能开始悬停，永久就绪失败保留原异常且不触发悬停。完整 motion
回归 20/20 通过，继续覆盖动画层等待及持久透明度错误负控；两轮完整
原生计时验收通过。日志为 `Desktop/test-results/ultra-ci-timing-*.log`，
云端失败原文为 `ultra-ci-84e45b7-macos-runtime-failure.log`。
本机未复现原始 macOS 悬停失败，新 head 仍须单独完成两端云端验收；
不将旧 head 的 Windows 通过当作新 head 全绿，不绕过或合并 PR。

## Ultra CI 的 Remote 断开就绪与 ARM64 排队（2026-11-12）

首轮夹具加固 `ffca523` 的 Windows interface、sessions 组通过，runtime
组在 `verify-remote-access.mjs:573` 立即比较断开状态时失败：
期望 `idle`、实际 `connected`。该脚本未调用命令派发夹具，本轮没有
修改 Remote 产品实现；完整构建、类型检查、协议及上游回归仍通过。

在隔离原生 IPC 中，仅为这一次 UI 断开请求增加 250ms 延迟后，旧即时
断言复现相同失败；不加延迟的原脚本本机通过。保留有界延迟作为回归场景，
点击后复用原脚本已有的 30 秒状态等待，必须实际达到 `idle` 且已保存
标记为 false。原来的严格状态、加密凭据文件删除、子进程退出、拒绝
未授权操作断言均保留，不重复发送断开、不改变产品时序或 CI 门禁。
修正后 Remote 相关测试 101/101 通过，两轮完整原生 Remote 验收通过，
包括真实隔离退出重启恢复。证据为
`Desktop/test-results/ultra-ci-remote-{original,delayed-negative,delayed-fixed-*}.log`
和 `ultra-ci-remote-regressions-fixed.log`。

同一 head 的 macOS run `43213891480` 候选构建/协议通过，但三个验收
组排队 15 分钟后全部取消：runner 名称为空、steps 为空，GitHub 注释为
“The job was not acquired by Runner of type hosted even after multiple attempts”，
并提示 macOS ARM64 容量受限。这不是脚本执行失败，也不是验收通过；
先前命令派发问题的 macOS 结果仍未确认。新 head 的两端云端结果须
另行检查，不用旧 head 或本地通过替代，不绕过或合并 PR。

## Ultra 合并候选的命令派发夹具加固（2026-11-12）

PR #236 的 `4ecc342` 在 macOS run `43205867019` 中，仅 interface
源码验收的 `verify-command-dispatch.mjs` 失败：响应式 `/todos` 场景在
`prepareDispatchInput` 等待输入不变、ARIA 关闭和补全菜单卸载时超时。
Windows 全组及 macOS 构建、协议、sessions/runtime 源码与包内组通过；
macOS 最终汇总失败由 interface 失败导致。该夹具来自同步的主线
`f96733b`，不是 Ultra 对 Todo 业务的修改。

本机原脚本通过；真实编辑器/菜单探针正常和模拟未激活窗口各运行
40 次也未复现。因此不能断言原云端根因，以下是夹具的定向加固：
填入文本后等待 ProseMirror 值、React 空值标记及输入焦点就绪，
再等待匹配补全；Escape 发送给已聚焦输入，不通过 locator 隐式重聚焦。
超时输出阶段、预期/实际文本、焦点、补全、主题、语言和视口。
保留原异常、五秒期限、文本不变及菜单关闭/卸载条件，不重试失败，
不修改产品、Todo 断言或 CI 路由/门禁。

新增契约测试先在旧夹具上失败，修正后四份定向测试 28/28 通过；
Desktop 类型检查、三次独立完整命令派发原生验收和完整输入框菜单
原生验收通过。日志为 `Desktop/test-results/ultra-ci-*-fixed*.log`，
原失败片段保留于 `ultra-ci-macos-command-failure.log`。这些 Windows
本地结果不能代替新 head 的 macOS 源码与包内云端验收，推送时仍待确认。
本轮仅修改测试夹具、回归测试和本记录，未重新打包、绕过检查或合并 PR。
现有 dist 约 12.7 MiB、验收证据约 5.2 MiB；未新增大型包或删除产物。

## Ultra 同步主线与冲突解决（2026-11-12）

PR #236 正常合入主线 `ed7c6e4`，唯一文本冲突是本文件顶部并列
新增的验收记录。双方新增内容和原有历史逐字核对保留，仅补齐节间空行；
其余文件保持 Git 自动合并结果，没有额外手改生产代码、运行时锁定或
CI 门禁。运行时管理适配层 `admin.mjs` 与 staged 副本的 SHA-256 一致。

- 文档 pin/patch 契约、3 项文档检查测试、合并新增行冲突标记检查及
  差异空白检查通过；Desktop 类型检查、生产构建和 45 项相关测试通过。
- 重新运行模型选择器原生验收：Ultra 独立档位、紫色斜体流光、明暗
  主题、390px 窄屏、推条共享进度及无障碍回退通过，三张截图已实看。
- 重新运行完整供应商原生验收：发现、选择、首轮与工具续轮、刷新、
  重启后显式打开原会话、手动映射及三种协议实际发送 Ultra 均通过。
  仅使用隔离 profile 和受控本机 HTTP 端点，不证明真实供应商验收。

本轮构建及两份原生验收日志为 `Desktop/test-results/ultra-main-sync-*.log`。
旧提交 `5f11fe2` 的全量本地测试和 Windows/macOS 云 CI 结果仅属于原组合；
本轮未手动重跑完整协议或全套云 CI，新 head 的自动 CI 结果以 PR 为准。
未绕过检查、合并 PR、打包或修改现用 profile/快捷方式。
已盘点独立源码约 316.9 MiB、重放目录 17.5 MiB、staged runtime
124.1 MiB、Desktop dist 12.7 MiB 和验收证据 4.8 MiB，未经授权未删除。

## Ultra 思考档位适配（2026-11-11）

基于主线 `cb8852c`，保持运行时锁定在
`29eb460780489801ce8afc8bffc1a2efae7cbded`，新增独立的 `ultra` 档位。
上游显式声明或手动配置后才提供，排序在 `max` 之上；不与 `max`
互换，不启用 UltraCode 或自动委派，也不保证每次请求消耗更多 Token。
未声明模型、未知思考控制和 Anthropic 非 adaptive 配置保留既有行为。
上下文容量发现逻辑未更改，不补猜上游没有返回的元数据。

- 发现、保存、手动发送值映射、管理进程草稿选项、待应用选择、运行时
  类型与配置校验均已适配；混有未来未知字符串时保留已识别的声明，
  保存配置仍严格拒绝未知档位。
- 原生 Electron 供应商验收通过：从真实界面选择 Ultra、首轮及工具
  续轮发包、供应商刷新、退出重启后显式打开原会话、手动添加 Ultra，
  以及三种协议的精确字段。分别核对 `reasoning_effort`、
  `reasoning.effort` 和显式 adaptive 下的 `output_config.effort`。
  继续覆盖有密钥/无需密钥、真实工具、隔离保存、忙时延迟应用和禁用。
- 完整模型选择器验收通过：紫色最高档、斜体流光、明暗对比度、
  390px 窄屏、减少动态效果及高对比度回退。保留当前主线收藏、
  键盘/IME、待应用选择与推条共享进度动画；Ultra 全程推条采样最大
  填充/滑块偏差小于 0.01px。三张 Ultra 截图已实看。
- 类型检查、最终生产构建通过。根目录 67 项中 66 通过、1 项既有平台
  跳过；五份相关测试共 45 项通过，上游四份测试共 293 项通过。
  上游全量类型检查、离线构建和干净源码完整补丁重放通过；
  staging 的 72/72 份源码哈希匹配，Node 为 24.16.0。
- 修正管理适配层后的完整协议最终重跑 234/234 文件通过，
  `complete:true`；2,366 项中 2,352 通过、14 项既有跳过，无失败或取消。
  最终逐文件证据位于 `Desktop/test-results/protocol-ultra-final/`。

证据保留于独立工作树的 `Desktop/test-results/ultra-*.log`、
`model-effort-ultra-*.png`，以及独立运行时构建目录
`D:\Desktop Runtime Builds\ultra-effort-20261111`。
初轮发包失败暴露管理进程仍只列到 max，已补齐并新增原生回归；
随后重启断言误读空白草稿，已改为实际打开原会话验证。失败记录均保留，
供应商最终通过记录为 `ultra-custom-providers-r5.log`。

本轮仅使用本机受控 HTTP 端点，不代表真实供应商、真实账户或 macOS
验收；预算型接口沿用 high 的既有预算回退，不虚构 Ultra 数字预算。
未打包、修改现用 profile/快捷方式、合并或发布。已盘点独立源码、
重放目录、staged runtime、Desktop dist 和验收证据，未经授权未删除。

## Remote 主线冲突同步（2026-11-11）

听写修复 `884663f` 推送后，#223 因 `main ed018f1` 新增验收记录而
无法生成可测试的合并树，尚未启动新 CI。本轮仅为实际冲突同步主线，
保留双方记录，同时审查干净合入的 Remote 资源操作、Cron 与连接复核改动，
未将文档冲突当成纯文档同步。

主线新增的真实 main 测试夹具没有背景同步钩子，在合并树中复现 6 项
`syncCustomBackground is not defined`。补齐计数钩子，验证安装/更新/删除
会协调背景，保留产品 `finally` 同步及全部 Remote/资源占用拒绝断言。
354 项 Remote、运行时、背景、能力门与首次引导定向回归全部通过，
类型检查和合并后的生产构建通过。`884663f` 的原生听写证据只属于其旧树；
合并候选的完整协议、原生回归和 Windows/macOS 云端结果另行确认。

## 听写背压输入与真实包启动修正（2026-11-11，本地）

#223 的 `7d5f301` 在 Windows 三组、macOS 候选构建及 sessions/runtime
通过，但 macOS interface 的 package 步骤在听写背压等待失败。
诊断只有 201,600 个有声采样，即 12.6 秒有效 PCM；现有队列要约
384,000 个采样才能触发该断言。35 秒墙钟不足以证明输入前提成立，
也不能据此断定队列损坏或云端负载就是根因。

- 新增确定性回归，从真实 `SpeechInput` AST 提取队列和清理方法，
  使用真实分段/WAV 编码，覆盖首段在途、四段等待、第六段停止、
  串行完成、清空队列、释放音轨和晚到结果不覆盖草稿。
- 原生验收只将背压场景改为 capture 端口上的受控 PCM：先见证原生
  有声输入，首段确实到达挂起的回环 HTTP 后再推进队列；前五段
  音轨仍存活，第六段停止、收回权限且只上传一次。其他连续转写和
  Finish 场景保留原生麦克风、生产 Worklet、分段、IPC 和 provider。
  原生与注入计数分离，不将此项称为 24 秒实时采集验收。
- 增加 AudioContext 状态/时钟、首末消息时间和最大间隔诊断，
  不修改产品采集约束、队列阈值、超时或自动重试策略。
- 发现原脚本完全忽略 `DESKTOP_VERIFY_EXE`，名为包轮的听写实际
  仍加载源码。本轮包分支启动指定 EXE，不传源码 entry，并核对
  `isPackaged`、执行路径、资源目录和已加载的主模块来源。
  另有实际启动表达式回归覆盖 Windows/macOS 路径和禁止源码回落。
- 无账户凭据启动、初始模型走回环、关闭自动更新；安装隔离 transport
  后只重启本夹具 admin，再通过回环 OAuth 登录。重启前退出账户，
  重启后在重新登录前验证听写同意和设置；切回账户路线应清除独立 key。
  renderer 的 OS 沙箱、context isolation 和禁用 Node 断言保持不变。

41 项听写定向回归、类型检查、语法及 diff 检查通过。Windows 源码与
指定 EXE 原生验收串行通过，各 7 次 ASR 请求全部经回环；两轮原生连续
采集各 64,000 个有声样本且注入为零，背压各精确注入 384,000 个样本。
指定 EXE 验证使用 `test-results/speech-ci-package-fixture` 下的本地目录
装载夹具，Electron 文件硬链接、运行时只读 junction；它验证包启动分支，
不是可分发安装包，也不替代 macOS 云端真实候选包验收。

证据位于 `D:\Desktop For Step Code\output\custom-background-finish-20261111\speech-ci`。
本轮仅改验收与测试，不改产品、不新增交付包、不改快捷方式或个人档案。
云端采样落后的具体原因仍未确证；新提交需要自身的 Windows/macOS CI，
不得沿用 `7d5f301` 的绿项声称修复完成。

## 自定义背景收尾与主线整合（2026-11-11，本地）

#223 已合入 `main 310c679`，本记录对应合并树 `afe3288` 之上的材质、
首次引导退出及验收修复。保留主题作者指南、示例和协议的主线版本；
唯一文档冲突保留双方历史，未恢复旧版作者稿。

- 对话区、输入框、左右栏独立透明度与界面毛玻璃覆盖整个主视图，
  包括输入区周围、底部状态区和摘要下方留白。前景不淡化或模糊，
  Stellar 自有材质不覆盖；终端背景关闭后恢复主题实底。
- 首次引导接入退出确认、重载恢复及错误提示；退出失败记录实际阶段。
  新增 helper 覆盖离线授权失败、待完成会话的确认/取消/重载，以及停机失败重试。
  停机失败注入兼容 Windows 与 POSIX，但本轮原生执行平台仅为 Windows。
- 类型检查和生产构建通过。完整协议 232 文件、2259 项：
  2244 通过、15 项既有平台/权限跳过、0 失败。随后只改轻构建入口和对应断言，
  `runtime-staging.test.ts` 的 8 项单独复验通过，未重复整套协议。
- CI 策略/执行器 67 项：66 通过、1 项 POSIX-only 跳过；文档契约通过。
  设置浏览器 13 组、组件渲染 7 组及真实 main/MiniChat 交界像素矩阵通过；
  主题背景浏览器 10 组、非空 canvas 像素检查通过。
- 最终 r2 轻构建重新通过隔离原生背景 13 组与主题组合验收，
  包括 PNG/JPEG、Stellar 互斥、主窗/MiniChat 边界像素、重启及卸载重装。
  未仅凭 r1/r2 的主进程哈希相同沿用最终渲染证据。
- 完整首次引导（含三组退出）、正常主界面退出、PowerShell 终端验收通过。
  从正确的 `Desktop/` 源码目录执行完整 MiniChat 与听写验收通过，
  包括双窗共享输入、审批、发送、重开，以及录音取消、背压和持久化。
  所有模型/听写请求均使用回环夹具，不代表真实账户或物理麦克风验收。
- MiniChat 首次完整运行在置顶原生状态断言失败。最小诊断和随后保留全部
  原断言的完整调用轨迹运行均通过，按钮、IPC 与 OS 状态一致。
  未改产品置顶逻辑、放宽断言或延长超时，根因仍未确认，不能声称已修复。

首次轻构建被补丁指纹门禁拒绝，旧运行时未被覆盖；后续只读复用
`29eb460`、Node 24.16 及全部 53 项补丁指纹匹配的运行时。
轻构建 helper 补齐 `runtime-compile-cache.mjs` 和 `tray-menu.html`，
避免隔离首次引导缺少托盘页面。MiniChat 的早期 ENOENT 来自错误执行目录，
不是产品路径错误；听写未运行的阶段不计为通过。失败和中断证据均保留。

最终隔离轻构建为
`Desktop/release/custom-background-finish-20261111-verification-r2`；
自有文件约 8.53 MiB，另有只读 junction，不是可独立安装的交付包。
主证据位于 `D:\Desktop For Step Code\output\custom-background-finish-20261111`，
浏览器证据位于 `output\playwright\custom-background-finish-20261111`。
未删除历史产物、改快捷方式、个人档案或运行时版本。新提交仍需自己的
Windows/macOS 云端验收，`33bd0dd` 的旧绿灯不作为本轮通过证据。

## 首次引导退出反馈修复（2026-11-10，本地）

用户反馈独立体验包在首次引导页无法从托盘退出。本轮仅结束核对过
可执行路径的该体验包进程树，保留档案，未触及日常客户端或快捷方式。
普通新档案及离线授权失败本身均能正常退出，不能据截图断言网络失败
就是退出卡住的根因。

- 确认并复现一个退出死等分支：首次引导中的会话操作未完成时，
  主进程等待退出确认，但 FirstRunShell 未订阅或呈现该确认。
  新增验收在原体验包上确认真实 transition review 存在，却等不到确认框。
- 首次引导现在接入现有退出确认和错误通知，支持取消、确认及页面重载恢复；
  订阅后重读退出状态并按 revision 合并，避免挂载期间漏掉请求。
- 主进程退出失败时记录 `quit-failure` 及失败阶段，非终端失败不再误报
  为终端无法结束。不通过跳过安全停机或强制退出应用来掩盖失败。
- `verify-first-run.mjs --exit-only` 提供三组隔离原生验收：
  离线授权失败后的隐藏/托盘退出、会话操作期间的确认/重载/取消/退出、
  注入停机失败后的可见提示/诊断记录/重试退出。
  默认首次引导验收也运行这三组，清理时自动确认不参与功能通过判定。

证据位于 `D:\Desktop For Step Code\output\first-run-exit-20261110`，
隔离轻构建为 `Desktop\release\first-run-exit-20261110-verification`。
修复候选三组通过，原包在退出确认缺失处失败。用户现场没有留下退出
失败日志，因此本轮复现不能证明已还原其全部触发条件。完整首次引导、
普通主界面退出回归及修正版包的结果以对应原生验收记录为准。
未据此宣称全套云 CI、真实账户授权、安装器安装或发布通过。

## 自定义背景主视图连续材质修复（2026-11-10）

用户体验上一版后指出消息区底边、输入区周围、底部状态区和摘要下方留白
存在材质断层。上一轮组件夹具及 CSS 属性断言没有覆盖真实窗口的这些交界，
不能据其通过认为主视图已完整适配。

- 将对话材质从消息滚动容器提升到整个 main，同时覆盖摘要预留轨道。
  主窗口与 MiniChat 复用真实布局，不硬编码标题栏高度或侧栏坐标。
- 输入框与摘要卡片保留额外遮色调节，不重复模糊已有阅读材质。
  100% 输入框/摘要透明度移除自身遮色，底下仍是主视图材质。
  不改变布局、前景文字、代码底色、主题所有权或背景生命周期。
- 渲染验收新增真实 main.tsx 离线桥夹具，包含实际消息、输入框及摘要，
  检查明暗、侧栏隐藏、摘要关闭、760px 窄屏、MiniChat、透明端点、
  明亮锐利测试图与实际壁纸。交界像素与连续整面参考材质比较，
  按截图实际像素比例采样；注入旧实现时必须检出至少三处缺口。
- 类型检查、原背景渲染七组和主题背景组合十组回归通过。
  隔离 Electron 背景十三组通过，新增真实主窗/MiniChat 边界像素检查，
  保留导入、重启、主题互斥、卸载/重装、共享只读和草稿保留断言。
- 原生首轮在主题切换后因设置页等待定位不准确而失败，保留失败证据；
  改为等待当前可见设置区域的导入控件后通过，未扩大超时或修改产品行为。

证据位于 `D:\Desktop For Step Code\output\playwright` 下的
`custom-background-continuity-20261110-verified`、
`custom-background-continuity-20261110-theme-regression` 及
`custom-background-continuity-20261110-native-final`。
隔离轻构建为 `Desktop\release\custom-background-continuity-20261110-verification`。
本记录对应 `33bd0dd` 上的未提交本地修改，不代表云 CI、真实账户/模型、
安装器安装或发布通过。体验包完整性及包内原生验收另留交付记录。

## 自定义背景分区材质（2026-11-10，本地源代码）

在 `33bd0dd` 之上的未提交改动中，补齐对话区、输入框、左栏、右栏的
独立透明度（0% 实底、100% 透明）及界面毛玻璃。只改变底层材质平面，
不使用整块 UI 的 opacity/filter，不更改代码、菜单和审批对话框底色。
移除消息阅读列实底和输入框上方的旧渐变遮罩；终端支持透明背景并能恢复实底。
仅在已解码的个人图片实际生效且 UI 为 `standard-v1` 时启用，
Stellar 皮肤仍由主题管理。旧存档补默认值，不丢失已有图片调节。

本地验收：

- Desktop 类型检查通过；背景存储、真实主进程处理器、插件和主题组合五文件
  共 91 项，89 通过，2 项 Windows 文件符号链接权限条件跳过。
- 设置浏览器矩阵 13 组、真实消息/输入/摘要组件渲染矩阵 7 组、
  原主题背景组合回归 10 组通过。覆盖明暗/390px 窄屏、四边焦点、
  分区端点及独立调节、布局/文字颜色不变、代码/确认框实底、
  固定定位控件坐标、图片失效/主题切换/卸载的材质清理。
- 隔离真实 Electron 主进程/预加载/渲染验收 13 组通过，包含 PNG/JPEG
  导入、实际侧栏/摘要/输入区材质、关闭/重启、MiniChat 共享且只读、
  删除及插件卸载/重装。使用离线模型配置，没有真实账户或付费模型请求。
- 原生 PowerShell 终端完整定向验收通过，新增 xterm 背景透明/恢复断言，
  保留原有输入输出、剪贴板、停靠、尺寸、背压、作用域和进程回收断言。
- 几何验收等待实际入场动画结束后再测量；设置夹具等待初始化，
  不通过延长超时或关闭动画放宽断言。首次并行 Vite 冷启动的空白失败
  保留截图，其原因未确证，最终单独运行通过。

证据：`D:\Desktop For Step Code\output\custom-background-surfaces-20261110`，
原生背景成功记录位于 `native-background-settled`。
隔离轻构建为 `Desktop\release\custom-background-surfaces-20261110-verification`，
自有文件约 8 MB，运行时为只读复用 junction，不是可独立交付的安装包。
未删除历史产物、更新体验包/快捷方式、修改用户档案、推送或重跑云 CI；
原 PR 的旧 head 云结果不作为本轮改动的通过证据。

## 导航验收进程归属修复（2026-11-10）

`6f41e91` 的 Windows sessions 云验收在第二个冷启动拦截处失败。
本地隔离复现确认：插件目录查询的 `capability-admin.mjs --mode rpc`
占用了旧夹具的第二个拦截名额；真正的第二个会话进程未被挂起。
不是双冷启动断言失败，也不是自定义背景修改了会话行为。

- 夹具现在只匹配当前 source/package 运行时的确切 `step/dist/bundle/step.js`
  入口，管理进程不占名额。保留双启动、账户锁、草稿隔离和回收的原断言及超时。
- 新增 source/package 回归在修复前均失败，修复后均通过；相关导航及运行时
  三文件共 115 项通过，类型检查通过。
- 在 `6f41e91` 的隔离构建上运行修复后的完整原生导航验收通过，正常退出。
  本次只改夹具与回归测试，未改变产品、依赖或构建输入，因此未重建应用或
  重跑本地完整矩阵。新提交仍须独立云验收，不能沿用旧 head 的云结果。

证据追加在 `output\custom-background-main-sync-20261110` 的
`navigation-baseline`、`navigation-entry-probe` 和 `navigation-fixed` 子目录。

## 自定义背景同步组合协议主线（2026-11-10）

#222 已合并为 `5beaa5d`，本次将 #223 的 `c0c9627` 同步到该主线，
包含 #231 CI、通用插件宿主与插件工作区，未改变运行时 pin。
合并保留图片背景的独立操作门、被动读取、关闭前等待与卸载归属核对，
同时保留主线插件目录变更通知、宿主设置及插件窗口权限。

- 定向协议回归 9 文件、143 项：141 通过，2 项既有 Windows 文件符号链接
  权限跳过；目录 junction 拒绝测试实际运行。最后修改的主进程边界文件单独
  复验 16 项通过，真实市场 2 项另用当前补丁运行时复验通过。
- 首次定向回归在关闭顺序夹具失败：新增插件宿主服务未被旧夹具模拟。
  已补齐 `pluginHosts` / `pluginWindows`，保留原关闭顺序断言，另覆盖插件
  变更成功与失败时的目录通知，以及插件窗口拒绝全部个人背景读取和修改。
- 类型检查与隔离生产构建通过；CI 策略、清单和执行器 67 项：
  66 通过，1 项既有 POSIX-only 跳过。
- 编辑面板浏览器 12 项、渲染浏览器 6 项通过，含明暗／390px 窄屏四侧焦点、
  4 组非空色彩像素、视差暂停／减少动态、场景互斥及失败回退。使用本机 Chrome。
- 完整隔离 Electron 背景验收 12 项通过：真实市场安装、PNG/JPEG 原生解码、
  参数持久化、封闭主题保留场景、重启、MiniChat 只读、确认删除和卸载／重装。
  无页面错误，默认关闭流程正常结束，未使用强制退出测试选项。

工作区旧 runtime 的补丁指纹不匹配新增宿主协议，未用于本次 Electron 验收，
也未覆盖。新隔离构建只读复用 `plugin-host-contracts` 工作区的 Node 24.16
及完整匹配当前 manifest 的 runtime，构建脚本核对 pin 和全部补丁源指纹。
初始定向矩阵的真实市场测试曾使用旧 runtime，上述两项已在新隔离运行时复验，
其余定向测试不依赖该 runtime。未重复本地完整云端矩阵。

证据位于 `D:\Desktop For Step Code\output\custom-background-main-sync-20261110`
及 `output\playwright\custom-background-main-sync-20261110`。隔离构建位于
`Desktop\release\custom-background-main-sync-20261110`，这些目录均在共享 D: 仓库。
本记录仅确认本地范围；新候选仍需新的 Windows/macOS 云端验收。
未生成安装包、发布、替换日常客户端／快捷方式，未修改个人档案或 Remote 绑定。

## 自定义背景 Review 与 CI 修复（2026-11-09）

- 基础 PR #222 的原生插件夹具漏拷贝 `theme-composition.mjs`，
  已在 `082e773` 补齐，并合入插件分支；未修改产品权限或测试断言。
- PR #223 的 P2 已复现并修复：图片先写独占临时文件并同步，再原子发布。
  再次导入可修复旧版本中断留下的普通文件；仍拒绝目录、链接和被替换的条目。
  修复已被元数据引用的图片后，即使元数据提交失败，也不会误删该图片。
- 存储、实际 main、插件权限和操作门回归共 89 项：88 通过，
  1 项因本机文件符号链接权限跳过；目录 junction 拒绝测试实际运行。
  新增空文件、截断文件、超限残留、重启后重选、删除后重选及提交失败回滚覆盖。
- 类型检查、隔离生产构建通过。本机原生插件完整重跑在最后一项清理时
  报 `Runtime process-tree termination failed (1)`，并留下测试进程；
  单项重跑以及带 `--test-force-exit` 的诊断重跑分别为 1/1 和 9/9。
  后者不是默认退出流程验收，未据此宣称关闭行为通过。
- `custom-background-20261109-review-r4` 的隔离 Electron 完成七项导入、
  解码、编辑和主题兼容检查，页面错误为空，但在正常关闭时超时，完整验收失败。
  证据保存在 `output/custom-background-20261109/review-r4/failure.json`。
  已按本轮精确进程路径清理残留，没有修改终止策略或放宽关闭断言。
- 新构建约 7.5 MiB，另有只读运行时链接；未生成安装包、删除历史构建、
  切换快捷方式或触碰个人档案。新提交的云端 CI 仍需独立确认。

## Custom Background MVP (2026-11-09)

The optional host-adapter package now opens a real local PNG/JPEG editor.
The host owns import, normalized private storage, bounded revisions and renderer
lifecycle. Themes still decide whether image replacement is accepted. Existing
integrated Stellar themes remain closed; incompatible themes retain the saved
personal image without running its renderer.

The first version supports fit, position, zoom, brightness, background blur,
weak mouse parallax, disable/restore, reset and confirmed deletion. UI material
and panel opacity are unchanged. Video, HTML, arbitrary CSS/JavaScript and WebP
are not supported. The existing opaque welcome/conversation surfaces deliberately
remain opaque, so personal media is most visible in the surrounding workspace.

Local verification:

- Store, gate and actual-main boundary suites: 77 passes and one Windows
  file-symlink privilege skip. Directory-junction and directory-replacement
  rejection cases run. The boundary suite includes cached passive reads during
  import, pre/post installation proof, shutdown during a pending picker proof,
  storage-failure startup fallback and failed-uninstall reconciliation.
- Theme/image/adapter/library/policy suites: 79 passes and one Windows
  file-symlink privilege skip. Additional foundation/worker suites: 40 passes.
- Runtime-backed theme, Remote ownership, idle-race, diagnostics and real
  marketplace suites: 132 passes.
- Production settings browser verifier: 12 cases. Production background
  renderer: six cases and four desktop/mobile bitmap checks, with no page or
  console errors. The existing foundation browser matrix also passes ten cases.
  Desktop and 390-pixel light/dark screenshots were inspected for overlap,
  horizontal overflow and four-sided focus clipping.
- Final isolated Electron build `custom-background-20261109-verification-r3`:
  12 lifecycle checks pass, with no page errors or remaining test Electron
  processes. This includes real recorded marketplace installation, native
  PNG/JPEG normalization, cancel/invalid input retention, all adjustments,
  theme compatibility, orderly restart, MiniChat read-only propagation,
  uninstall/reinstall activation safety and confirmed removal. Concurrent
  state polling during PNG import does not interrupt the write.
- Typecheck, production build, verifier inventory and whitespace checks pass.

The combined CI-policy/runner local suite has 20 passes and one failure:
the existing Windows descendant-cancellation test receives `taskkill` error
"call cancelled" on this host. Its four exact fixture processes were identified
by PID, parent and command line and stopped with PowerShell. No runner source
or cancellation assertion was weakened.

Foundation PR #222 cloud review reports no findings, but its Windows protocol
jobs and macOS ARM64 preparation fail because the isolated native-plugin fixture
does not copy the new `theme-composition.mjs` dependency. Both platforms report
the same nine native-plugin startup failures. After owner approval, the fixture
copy list includes the missing dependency in `082e773`. Replacement cloud CI is
running; it is not yet a green result. This is separate from the local product
acceptance above.

Final native evidence is in
`D:\Desktop For Step Code\output\custom-background-20261109\electron-final`.
Browser evidence is under
`D:\Desktop For Step Code\output\playwright\custom-background-settings` and
`custom-background-rendering`. Earlier failed fixture attempts remain separate
from `electron-final/results.json`.

Three isolated builds contain approximately 7.4-7.5 MiB of owned files each,
plus three immutable runtime-directory links per build. No installer was
produced and no historical package was deleted. The owner's checkout, running
client, profile, Remote binding and shortcut remain unchanged. This evidence
does not establish native macOS, installer, real-model or release acceptance.

## 主线同步与 Hermes 全新安装验收（2026-11-11）

将通用本机接入与插件连接引导合入当前分支，并正常合并主线
`ed018f1f478af2c6ec3424ee320012523dd78ff1`。保留 Remote、
MiniChat、语音、插件宿主授权等已合入功能，不升级运行时锁定版本。
本条是该集成源码的本机验收，下面较早的真实 Plan 记录保留原有构建边界。

- 类型检查、最终生产构建和空白检查通过。根目录测试在系统健康恢复后
  串行完整重跑：67 项，66 通过、1 项既有平台跳过，无失败。
- 完整协议最终重跑 234/234 文件成功，`complete:true`；
  2,362 项用例中 2,348 通过、14 项跳过，无失败或取消。
  新日志位于 `Desktop/test-results/protocol-main-sync-final/summary.json`
  和 `hermes-main-sync-protocol-final.log`，未覆盖首次失败记录。
- 浏览器验收：外部接入 6 组、插件工作区 24 组、市场信息 21 组。
  包含中英文、明暗主题、窄屏、完整焦点、迟到响应及关闭边界。
- 原生通用接入 9 组通过，使用真正的 Python companion、loopback
  模型和原生 Ask 会话，覆盖队列、幂等、本机拒绝/允许审批、停止归属及
  重启回执。Remote 正常退出重启及插件 surfaces 17 组通过；
  宿主独立设置、授权和撤销回归分别通过。
- 最终构建的语音 21 组及 MiniChat 回归通过，包含正常退出、
  重新启动、真实 PTY、原生审批、主小窗交接与草稿保留。
  语音使用合成麦克风及 loopback ASR，不证明物理麦克风或真实账户。
- 全新隔离 DFSC profile 经真实插件中心安装 companion 仓库中的
  Hermes x DFSC 资源 0.3.0，7 组通过。核对作者、适配维护者、
  semver 范围、四项依赖、无伪造下载量、原始 256px 头像和 17px
  明暗直角图标、顶栏状态面板、四步准备及四页指南。
  明暗和 640px 窄屏截图已实看，零模型请求、零页面错误、
  退出码 0、零剩余窗口；最终进程扫描无残留。
- companion 70 项中 69 通过、1 项既有平台跳过；资源测试 9 项通过。
  独立仓库版本保持资源 0.3.0、companion 0.2.0。

全新安装暴露并修复了市场依赖弹层缺陷：长搜索框失焦后的自身水平滚动
会触发全局 scroll 捕获，误关刚打开的弹层。关闭条件现只匹配包含按钮
锚点的滚动目标；搜索框自身滚动不关闭，真正列表滚动仍关闭。
浏览器新增回归在旧代码失败、修后通过，同时保留 Escape、焦点离开、
外部点击和卸载关闭断言。原生 r6 无预先 focus/settle workaround，
记录到直接点击约 15ms 后真实 INPUT scroll，弹层仍保持展开。
r1-r4 原失败及 r5 含临时焦点处理的证据均保留，不将 r5 冒充最终修复。

主线同步后的首轮协议回归发现 `remote-management` 的源码抽取夹具
未提供新增 `externallyOwned` 依赖；现抽取真实生产函数并注入可控归属集合，
保留全部旧断言，新增准备中/保留中的设置阻断及 Remote 禁止派工/代答断言。
另修复 CI 取消测试的 Windows 事件竞态：OS PID 消失可能早于 Node
ChildProcess 的 exit 事件，夹具通过诊断通道匹配实际子进程并有界等待 exit，
不修改生产终止逻辑、原时限或禁止终止已退出 PID 的断言。

首轮语音在功能完成后退出失败，原始异常为系统 taskkill 返回 1，
同机 Win32_Process 查询也失败。只清理本轮精确核实的孤立 fixture 后，
独立 taskkill/进程查询探针恢复，随后原样根目录测试、语音及 MiniChat
完整重跑通过；没有重启系统服务、放宽断言或把首轮失败计为通过。

主要证据位于 `D:\DFSC-Preview-QA\hermes-real-setup-20261111`：
`fresh-install-main-sync-r6/verification.json`、`market-scroll-fixed/`、
`main-sync-browser-external/`、`main-sync-browser-workspace/` 和
`main-sync-native/`。前五类原生回归在市场弹层修复前的集成构建完成，
全新安装、语音及 MiniChat 使用最终构建。类型、构建、根目录测试及
逐文件协议日志保存在当前工作区 `Desktop/test-results/`，旧失败日志未覆盖。
运行时从独立源码重新构建并 staging，53/53 patched source hash 匹配，
使用 Windows 要求的 Node 24.16.0；没有更改共享依赖或该独立源码文件。

本轮仅使用受控模型端点，没有再次调用真实账户。此前真实 Plan
工程闭环不冒充本轮集成构建的真实模型再验。全新 profile 安装也不等于
干净机器、公开市场、真实聊天渠道、macOS 或发行安装包验收。
没有新建发行包、修改现用应用/profile/快捷方式、合并或发布市场；
社区市场的来源锁定 SHA 未更新。推送和云 CI 在对应 PR 单独记录。
本轮构建产物约 12.6 MiB，原生证据约 125 MiB，另保留全新安装与失败基线；
均已盘点，未经授权未删除既有包或证据。

## Hermes 最小工程委托闭环（2026-11-11）

沿用独立 Windows 预览包、独立 `userData` 和唯一授权的测试项目，
完成一次真实 `step/step-5-preview` 工程任务及同进程结果回读。
原有 DFSC profile 和主桌面快捷方式未修改，没有新建发行安装包。

- 首次文本验收退出码 1 的原因已有原始会话和日志证据：
  三轮工具发现、三次业务调用用完脚本指定的六轮额度，
  Hermes 记录 `max_iterations_reached(6/6)`，不是未提交任务的证明。
  原失败记录保留。本次新工程任务使用独立幂等 key、12 轮上限与临时
  120 秒预算，正常在第 7 轮回答，CLI 及协议退出码均为 0。
- 上次旧任务回读没有摘要，是因为 DFSC 已退出并重新启动。
  摘要仅当前宿主进程保存的契约不变，不新增回答持久化或任意会话历史读取。
  companion 增补搜索元数据、`task.create.id` 参数说明及缺少摘要时的处理指引。
  搜索仍可能需要补充查询，不声称一次搜索即可发现工具。
- Hermes 仅创建并提交一个新任务。DFSC 保持 Ask，原生确认消息的完整
  Call ID 与同一 runtime 的唯一工具调用绑定，批准前严格核对完整命令、
  工作目录和执行参数。审批由本机 QA 通过原生 preload 执行，不是把
  人工审批能力开放给 Hermes，也不是一次真人手动审批验收。
- 原生会话只有一次 `run_command` 调用，工具结果与调用 ID 对应且无错误。
  命令以独占创建方式生成 `README.md`；独立核对项目仅有该文件，
  内容逐字为 `Hermes x DFSC engineering acceptance` 加换行。
  最终原生摘要为 `README.md 已创建。`，`resultAvailable:true`，未截断。
- DFSC 保持同一进程时，原 Hermes 会话仅执行一次 `task.get`，
  实际工具返回和 Hermes 最终回答都包含上述原生摘要，退出码均为 0。
  任务仍只新增一项，原提交记录未改变，没有重建或重派。
- 无真实模型的原生 Electron 9 组验收通过，包含本机拒绝审批后命令标记
  文件不存在、原生拒绝工具结果、同 key 不重派，以及 completed 任务重启后
  保留回执但没有摘要、不重新挂接原生历史。工具被拒绝后模型可以正常解释
  拒绝，因此没有把该轮 `completed` 误称为工具执行成功。
- 类型检查通过；完整协议回归 1,920 项中 1,907 通过、13 项既有跳过，
  无失败。初轮 18 项失败均因四份 VM/Function 夹具未注入新增的外部委托
  守卫依赖，已补齐并新增三项外部占用拒绝断言，没有移除产品守卫或放宽
  原有断言。companion 70 项中 69 通过、1 项既有跳过，资源测试 9 项通过。
- 临时预算已恢复，网关在归属和空闲核对后正常退出，DFSC 退出码 0、
  零剩余窗口。最后仅重新打开保存会话并经真实侧栏导航截图，
  未提交新提示、未再次调用模型；截图已实看。

证据位于 `D:\DFSC-Preview-QA\hermes-real-setup-20261111\engineering`：
`verification.json` 记录真实派工、精确审批和同进程结果回读，
`capture-verification.json` 与 `*-visible.png` 记录真实界面复核。
最初直接调用会话 IPC 后的两张截图未完成渲染器导航，不用作可见状态证据。
受控 Electron 最终证据位于相邻的 `engineering-fixture-r2`；
首轮 `engineering-fixture` 的能力字段投影断言失败保留，不计为通过。
相邻的 `protocol-followup.log` 保留全量失败基线，
`protocol-followup-final.log` 记录修复后的全量通过。

本轮证明最小文件写入、原生本机审批和结果回读，不代表复杂工程、
真实聊天渠道、无人值守、云端 CI、macOS 或公开市场安装验收。
未提交、推送、合并或发布。

## Hermes 通用连接真实 Plan 验收（2026-11-11）

使用本轮源码生成的独立 Windows 预览包和全新 `userData`，
仅授权空白测试工程。原有 DFSC 凭据、会话和主桌面快捷方式未修改；
原 profile 的凭据解锁失败仍是独立未解决问题，不计入本次通过项。

- 新 profile 经原生凭据导入、`AuthVault` 首启迁移和再次启动验证；
  临时 `auth.json` 已删除，账户识别为中国区 Step Plan。
- 原生 main/preload 配对仅含测试目录。Hermes companion 实际安装并由
  原生插件加载器注册，真实 capabilities 握手通过；底层工具目录仅含
  `dfsc_engineering`，模型入口的 Tool Search 重组另行核对。
- Hermes 通过既有中国区 Plan 路由创建并提交唯一任务。DFSC 保存的
  原生会话包含逐字匹配的测试输入和 `DFSC 连接成功`，实际回复模型为
  `step/step-5-preview`、权限为 Ask，无工具调用，空白工程未改变。
- 首次 Hermes CLI 退出码为 1，不算一次干净完成的聊天。随后核对原任务
  和原生会话，在同一 Hermes 会话中仅执行一次 `task.get`，退出码 0；
  任务仍只有一项，提交记录未改变，没有重建或重派。
- 实际 Hermes x DFSC 前端资源已装入独立 profile。原生目录绑定、
  顶栏锚定状态面板及已完成任务展示通过，中文页面截图已实看。
- companion 安装暴露了 `--hermes-source` 导入整个 CLI bootstrap 后
  重启丢失脚本导入路径的问题；改为只激活原生依赖环境，新增独立进程
  安装回归。companion 测试 68 项：67 通过、1 项既有跳过。
- 临时 120 秒预算已精确恢复；本次网关经 PID、出生时间、实例身份及
  空闲状态核验后正常退出。DFSC 验收进程退出码 0，窗口全部关闭。

证据位于 `D:\DFSC-Preview-QA\hermes-real-setup-20261111\real-chain`：
`verification.json` 保留首次聊天失败，`final-verification.json` 记录原生
回复和后续只读查询，`capture-verification.json` 记录真实界面截图验收。
这是本机最小文本委托验证，不是工程工具审批、文件修改、飞书、
多渠道、公开市场、云端 CI、macOS 或发布验收。未提交、推送或发布。

## Hermes 顶栏轻量状态入口（2026-11-09）

按交互修正，声明 `agent-bridge-v1` 的插件顶栏按钮先展开原处锚定的
原生状态小面板，不直接切换主视图，不改变当前聊天、草稿或阅读位置。
小面板展示本次只读诊断、身份、首批最多 5 项任务与检查时间；
打开或手动刷新才读取，不推断实时在线、空闲、companion 加载或可派工状态。
再次点击、Escape、显式关闭和外部点击均可收起；键盘关闭恢复原入口，
外部点击保留目标控件焦点。完整工作台是显式次级入口，选择/更换/忘记
profile、授权目录详情和安装指南继续放在完整页。未声明连接的插件行为不变。

本地验证：

- 类型检查、生产构建、`git diff --check` 通过。
- 完整协议回归 1,817 项：1,804 通过、13 项既有平台跳过，无失败。
- 浏览器 20 组通过：新增直接及溢出入口、开关/关闭/焦点、显式完整页、
  5 项边界、关闭后的迟到响应、窄/矮窗口、明暗/中英文、完整焦点轮廓、
  打开时缩放、换包/卸载及设置阻断时移除旧面板。
- 生产 Electron 16 组通过：真实主进程/预加载桥/渲染器与隔离 Bridge，
  实际 Hermes 0.3.0 资源和已确认图标；状态查询不改变主导航、草稿或阅读位置，
  显式进入完整连接页，保留身份/目录过滤、脱敏及更新失效回归。
- 中文模式使用「智能体状态」及中文提示，新增实际 Hermes 中文明暗截图与
  标题、刷新、工作台、任务阶段和检查时间的本地化断言；英文模式保留。
- 原生流程零模型请求、零页面错误，退出码 0，夹具窗口全部关闭。
- Hermes 随包说明同步小面板与完整页的层级，资源测试 6 项通过；
  不改 companion 运行逻辑、元数据协议或已确认图标。

证据位于 `D:\DFSC-Preview-QA\hermes-status-20261109`：
`browser-final/` 和 `electron-final/verification.json`。
中文文案复验位于 `browser-zh/` 与 `electron-zh/verification.json`，
`electron-zh/hermes-status-zh-*-detail.png` 为带原始顶栏图标的中文局部截图。
原生初轮在更新返回后立刻点击，使用了尚未刷新的旧入口声明；
脚本现等待渲染器出现更新版本再验证新行为。浏览器几何断言也等待
实际布局/动画与缩放后的定位完成，未放宽内容、数量或隔离断言。
初轮失败证据保留，不作为通过证据。

仅修改开发源码及隔离验收证据；无安装包、真实 profile、账号、飞书或工程任务，
不改变当前运行应用和桌面快捷方式。云端 CI 与公开安装包兼容仍需独立核验。

## 插件只读 Agent Bridge 连接主视图（2026-11-09）

在已合入的通用工作区之上，新增固定 `agent-bridge-v1` 协议适配。
仅限来源记录有效的已安装主视图插件；包不能声明任意方法、URL 或文件路径。
用户主动通过原生目录选择器选取本机 profile 后，主进程只检查
`config.yaml` 文件标记、读取 companion 配置与对应身份的 `model.json`。
令牌不进入渲染器，不读取 YAML 内容、`human.json`、`.env` 或个人默认 profile。

只调用 `system.capabilities` 和首批 `task.list`，核验身份、真实目录交集后
最多返回 20 项摘要，不返回对话、日志或工具输出。单次读取有绝对超时和体积上限。
缺少前置组件、配对、身份不符和连接失败分别显示诊断，不伪装可派工。
忘记选择仅删除宿主绑定；安装实例或包内容变化使绑定及在途旧请求失效。
MiniChat 和独立插件窗口继续拒绝这些接口。

本地最终源码验收：

- 类型检查、生产构建和空白检查通过。
- 完整协议回归 1,817 项：1,804 项通过、13 项既有平台跳过，无失败。
- 浏览器 16 组通过，覆盖诊断、重试、忘记选择、取消选择保留原状态、
  隐藏页面的过期响应、中英文、明暗主题、窄窗口、完整焦点轮廓和任务排版。
- 最终生产 Electron 13 组通过。使用真实主进程、预加载桥、渲染器、
  安装来源与本机 Git 市场；目录选择器返回值由夹具控制，
  其余连接读取走临时 profile 与受控回环 TCP JSONL 服务。
  覆盖身份与目录过滤、脱敏、无目录状态、更新期间的引用失效、
  卸载拒绝旧引用、忘记选择保留配对文件，以及原有草稿与工作区隔离。
- 同一原生流程安装并打开实际 Hermes 0.3.0 源码资源包。
  详情头像的原始 256px 字节、顶栏 17px 明暗直角图标分别核验，
  不把两类资源当作同一图片。实际 Hermes 连接页可显示隔离夹具的任务摘要。
  原生流程记录零模型请求、零页面错误、退出码 0，所有夹具窗口已关闭。

证据位于 `D:\DFSC-Preview-QA\hermes-connection-20261109`：
`protocol-final.log`、`build-final.log`、`browser-final/` 与
`electron-final-source/verification.json`。初轮失败证据保留：
验收脚本曾误把包头像与顶栏图标等同，并假设所有入口均在直接按钮区；
已分别核验资源和溢出菜单状态，未放宽隔离或内容断言。

这是只读客户端接入，不是 Agent Bridge 服务迁入或完整 Hermes 派工前端。
当前桌面主线仍不内置配套服务，连接核验不证明 companion 已加载或可派工。
不声称公开安装包兼容、云端宿主 CI、原生 macOS、真实账号、飞书或过夜工程验收。
未改变主人的运行应用、真实 profile、凭据、快捷方式或上游运行时。
本轮只重建开发 `dist` 并生成隔离验收证据，未制作安装包；未删除旧包或历史证据。

## Remote 治理同步当前主线（2026-11-11）

Remote 管理候选从旧基线同步到 `310c679`。唯一文本冲突是本文件
并列新增的记录，双方完整保留；生产代码自动合并后，测试夹具补齐
主线新增的听写对象，继续执行实际 main IPC，不跳过新的共享门控。
独立只读复审未发现新的 P1/P2 阻断。

同步后核心、扩展及运行时三组定向测试共 772 项，769 通过、
3 项既有平台跳过、零失败；包含听写 IPC 与编译缓存恢复回归。
类型检查、生产构建、验收脚本语法及差异空白检查通过。
本地普通 runtime 只补入主线新增的 `runtime-compile-cache.mjs`，
其余暂存输入、依赖锁文件和 runtime pin 与原基线一致；未修改上游 checkout
或通过依赖 junction 覆盖共享文件。

Windows 源码管理原生验收 18 项通过，`cleanupConfirmed: true`，
两次模型请求均为 loopback，零 renderer 错误。证据为
`Desktop/test-results/remote-management-main-sync-native/results.json`。
这不是包内、真实飞书、真实账户或 macOS 验收。
未修改的 StepPage 原生验收也通过：Cron 待命准备不替换宿主和任务，
重启仍拒绝，实际 MCP 连接 13 个工具，禁用重启后为 0，
修复和再启动均保留禁用；日志为
`Desktop/test-results/remote-management-main-sync-steppage-native.log`。

CI 策略本机运行不是全绿：67 项中 65 通过、1 跳过，另有
`Windows cancellation never targets an exited leader with inherited pipes`
未收到预期的 leader-exit 分支。Node 24.15、24.16 以及单例隔离均复现，
相关脚本与 `origin/main` 相同，本轮不修改或放宽该退出断言，
也不据此宣称已确认环境根因或修复。日志保留在
`remote-management-main-sync-ci-policy*.log` 与
`remote-management-main-sync-ci-exit-isolated.log`。

以上只记录本地结果。此次交付范围为独立 PR 与新 head 的 Windows/macOS
云端检查，云端结果另行核对；未生成体验安装包、合并、发布插件、
修改主快捷方式或日用 profile。

## 主题作者指南同步听写主线（2026-11-11）

PR #232 同步已合入 #229 的主线 `be4f865`。唯一冲突是本文件顶部
并列新增的验收记录，双方内容完整保留；未手改主线功能代码、主题组合
协议、runtime pin 或 CI 门禁。此前 `26cbdaa` 的 Windows 与 macOS
全绿仅属于旧组合，不代替本次合并提交的云端验收。

Node 24.16.0 下串行运行 12 个定向协议文件，共 115 项：
114 通过、1 项 Windows 文件符号链接权限跳过，覆盖独立 v2 起步包、
实际市场管理器发现/安装/卸载、主题组合与图片边界、实际 main IPC、
主题权限及新增听写的服务/分段/IPC。CI 策略、清单、执行器及汇总
回归 67 项，66 通过、1 项平台跳过；类型检查、生产构建和文档
pin/patch 指令检查通过。协议日志和 TAP 保存在
`Desktop/test-results/theme-authoring-main-sync-20261111/protocol/`。

依赖清单和锁文件与已验证版本一致，本地仅只读复用既有测试 runtime，
没有在共享目录暂存新补丁。完整协议、原生源码和包内验收由新 head
云端重新运行；以上不代表其通过，也不是原生麦克风或真实账户验收。
本轮未生成本地安装包、改动快捷方式或日用档案、合并 PR 或发布。

## 独立主题作者交付候选（2026-11-11）

基于主线 `a72e550f3954ea6d957b7f8506f8ef8106b3fa08` 的干净工作区，
只增加中文作者指南、独立 v2 起步包、文档入口与示例回归。
不带入 #223 的个人图片编辑器、分区材质、首次引导退出修复或星辰资源修改。
指南明确区分已合入的组合协议与 #223 候选适配，不把插槽声明当作编辑器交付。

- 四个专项测试文件共 34 项：33 通过、1 项 Windows 文件符号链接权限跳过。
  包含真实插件管理器发现、安装及卸载原样示例，开放/关闭插槽和图片边界检查。
- Desktop 类型检查、文档 pin/patch 指令检查与差异空白检查通过。
- Markdown AST 检查两仓库 12 个作者路径文档的 44 个本地相对链接，全部存在；
  不是远程链接、排版或完整标题锚点验收。
- 示例在社区主题专项检查中零 error、零 warning。
  PNG 由随示例提供的生成器重新生成，不复制用户图片或星辰素材。

本地依赖复用前核对 `package.json` 与 `pnpm-lock.yaml` 一致；
真实管理器测试使用已准备的隔离测试 runtime，没有升级 runtime pin。
不重复在本机运行与本次作者数据无关的全套客户端验收。
新增可执行示例和测试依照现有策略仍进入云端完整集成路径，不改门禁或取消检查。
本条本地结果不代表新 PR 的云端、macOS/Linux、打包或发布通过。

前一轮在 `33bd0dd` 加未提交背景/退出候选上，使用既有 Windows 体验包完成
默认图片、原生 PNG 解码、个人替换、单背景/UI 保留、跟随主题、窄屏、
重启及卸载回退验收，证据位于 `output/playwright/theme-authoring-20261110/`。
该记录只证明那个体验包与示例的组合，不是本次干净主线重新构建的原生证据。
此次未打新包、更新快捷方式、修改日用档案、合并 PR 或发布。

## 原生听写改向主线与冲突处理（2026-11-11）

PR #220 已合入主线后，将 #229 的目标从旧父分支改为 `main`，
同步当前主线 `a72e550`。两处文本冲突分别为主窗口侧栏验收和本文件：
保留双方验收记录；侧栏沿用真实响应式起点和中间帧断言，同时保留
主线的布局等待。保留主线主题组合、会话性能和 CI 执行器改动，
不调整已确认的听写交互、音频路径、账户路由或 runtime pin。

本地类型检查、生产构建和脚本语法检查通过；11 个定向协议文件
125 项全部通过，包含语音、实际 main IPC、账户凭据、BVR、
插件宿主和主题权限边界。动画 helper 浏览器回归 18 项通过。
Node 24.16.0 下串行 CI 策略、清单、执行器和汇总回归 67 项，
66 通过、1 项平台跳过。先前 Node 24.15.0 并行运行有一项
Windows 退出事件断言失败，同文件串行复跑通过；未修改断言，
不将复跑结果写成已确认其根因或修复。

定向协议通过有界执行器保留逐文件日志、TAP 和标注范围的汇总，
位于 `D:\DFSC-Preview-QA\native-speech-ci-fix-20261109\main-sync-20261111`。
本机共享 runtime 没有主线新加的 compile-cache 扩展，保持只读不覆盖；
完整协议和原生矩阵由云端重新暂存并验收。旧目标下 `07f0558` 的
Windows、macOS 和 SDK 全绿不能代替此主线组合的新结果。
本轮不证明真实账户权益、计费、物理麦克风或用户安装验收；
未打安装包、修改快捷方式、重启用户应用或清理历史产物。

## 原生听写几何基准等待（2026-11-11）

head `034aa2a` 的 Windows 三组及汇总、两平台 SDK 通过。
macOS 首轮三个验收任务因 hosted ARM64 runner 分配失败而取消，
没有执行测试；仅重跑失败任务，复用同一候选，不重新构建。
第二轮 runtime、sessions 源码/包内及原生终端通过，interface
完整源码组通过。语音原生收音已恢复：首段 65,600 个采样均有声，
音频 utility sandboxed=false，renderer OS 沙箱仍开启；
侧栏取样在源码和包内均为 224、208.141、112、0px。

interface 包内轮在语音后段布局断言失败：基准 x=350.75，
随后 x=352，y/width/height 不变。该基准紧接窄窗恢复宽窗，
原脚本未等待祖先布局过渡结束；状态行自身的等待不覆盖这段
几何变化。本轮仅在取基准前复用整页 `settleLayout`，涵盖
祖先伪元素 flex track，保留原 0.5px 阈值、超时和全部功能断言。
新增真实浏览器回归：有限伪元素 flex-basis 动画未结束时，
等待不得返回子元素基准；结束后子元素应处于最终位置。
不修改产品代码、CSS、听写交互或音频通路。

本地完整语音验收连续两轮通过（约 46 秒、45 秒），每轮 7 次请求
均走 loopback，首段 64,000 个采样均有声；35 项语音回归通过。
CI 策略、运行器及动画 helper 共 47 项，46 通过、1 平台跳过，
包括新增的有限 flex track 等待回归。语法和 diff 检查通过；
新 head 的云端结果仍需独立确认。证据保存在
`D:\DFSC-Preview-QA\native-speech-ci-fix-20261109`。

## 原生听写夹具开关覆盖与侧栏动画取样（2026-11-10）

head `21165d7` 的 Windows 三组及 CI 汇总、两平台 SDK 和 macOS
ARM64 候选、sessions 源码及包内验收通过。macOS interface 的
原生诊断明确报告 WAV 读取失败并提示关闭沙箱，324,800 个采样
全部为零；上一轮命令行参数未生效，
不将 `AudioServiceSandbox` 已写入参数等同于实际关闭。

固定版本 Playwright 的 Electron loader 会重写 `disable-features`，
覆盖传入参数。本轮在隔离夹具入口、加载产品代码前合并该列表，
只关闭合成 WAV 所用音频 utility 的沙箱，保留其他 Playwright 开关。
启动时检查未使用 `--no-sandbox`、音频开关确实存在；音频开始后
实查该 utility 的 sandboxed 为 false，每次启动均实查 renderer
OS 沙箱为 true，并保留 sandbox/contextIsolation/nodeIntegration
及实际有声 PCM 断言。原生读取错误会立即中止等待并保留脱敏诊断。
未修改产品约束、权限、采集、worklet、分段、IPC 或 provider。

macOS runtime 的侧栏动画验收原本在 native resize 往返后固定等待
65 ms，读取时动画已结束。本轮复用 `sampleMotion`，在 compact
类提交时捕获真实 pseudo-element flex-basis 过渡，验证 280 ms、
原 cubic easing、起点/终点及两个中间帧，不添加动画或放宽期限。
窄窗媒体查询可能先把宽度从 244px 切到 224px，断言以实际过渡
起点为准。本地观察为 224、208.141、112、0px。

本地完整语音及主窗口验收通过，分别约 45 秒、75 秒；CI 策略、
运行器与动画 helper 测试共 46 项，45 通过、1 平台跳过；
语音服务、分段及实际 main IPC 定向回归 35 项全部通过。
回执、日志和失败尝试保存在
`D:\DFSC-Preview-QA\native-speech-ci-fix-20261109`。
新 head 的 macOS 源码及包内验收仍需云端独立确认。
未改已确认的听写 UI、账户路由或 runtime pin，未打新包、
变更日用快捷方式、重启用户应用、调用真实账户或删除产物。

## 原生听写的 macOS 音频夹具与父分支同步（2026-11-10）

head `122542a` 的 Windows 三组和最终汇总、两平台 SDK、macOS
候选及 runtime、sessions 两组通过。macOS interface 仍在首次连续
听写失败：323,200 个采样全部为零，最大 RMS 为 0；音轨的三个
处理开关确实关闭，没有 ASR 请求或 renderer/transport 错误。
上一轮关闭处理的修订未解决 macOS 问题，不将其记录为根因修复。

Chromium 的 WAV 假麦克风在音频服务中读文件，读失败会返回空数据。
本轮只在 macOS 测试启动参数禁用 `AudioServiceSandbox`，不使用
`--no-sandbox`，不改产品音频约束、权限或上传路径。每次启动实查
renderer 的 sandbox/contextIsolation 均为 true、nodeIntegration
为 false；补入有界、去除 profile 路径的原生 WAV 读取错误诊断。
该参数是否解决云端静音仍须新 head 的 macOS 结果确认。

同步父 PR #220 至 `6bc08a9`，合并听写与插件窗口/通知/全局指令
的并列分支及浏览器遮挡条件，保留双方市场刷新检查，不改 runtime pin。
本地发现并修订三个夹具同步问题：语音重启用双语精确输入定位并确认
英文偏好持久化；市场窄窗操作绑定当前页面的 BrowserWindow，不按
窗口列表第一项猜测；插件页面返回后等待原阅读位置恢复，仍保留
小于 4px 的误差断言及原超时，并补入失败位置诊断。

合并后的类型检查、生产构建和完整协议套件通过：1994 项中
1981 项通过、13 项跳过、零失败；最终定向 54 项通过，CI 策略/
运行器另 30 项通过、1 项平台跳过。11 项相关原生/浏览器验收
通过，覆盖语音、任务模式、主窗口、设置、市场诊断、命令、浏览器、
全局指令、插件表面、通知和归档。语音 7 次请求全部走 loopback，
首段 64,000 个采样均有声、最大 RMS 约 0.1414，未发现原生读取错误。
失败尝试与最终回执均保存在
`D:\DFSC-Preview-QA\native-speech-ci-fix-20261109`。

只读盘点：dist 12.23 MiB、terminal-runtime 62.96 MiB、
test-results 95.90 MiB、本轮 CI 修订证据 139.99 MiB；
未删除产物、改动共享 junction、生成安装包、切换快捷方式或重启日用
应用。这不是新 head 云端全绿、真实账户/计费、物理麦克风或安装验收。

## 原生听写 CI 回归修订（2026-11-09）

head `0024c96` 的 Windows 三组完整验收及 CI 汇总门禁、两平台 SDK、
macOS ARM64 候选以及 runtime、sessions 源码/包内验收通过。macOS interface
在首次连续听写等待文字时失败：诊断中原生 worklet 收到 323,200 个
采样，但有声采样为零，没有 ASR 请求、transport 断言或 renderer 错误。
这不是“已观察到 ASR HTTP 失败”，也不据此推断真实麦克风故障。

合成 WAV fixture 现通过原生 getUserMedia 显式关闭回声消除、降噪和
自动增益，返回原 MediaStream；不替换权限、采集、worklet、分段、
IPC 或 provider，不改变产品默认约束。新增音轨处理开关和真实 PCM
振幅断言，失败证据补入最大 RMS 与去除设备标识的音轨设置。
本地完整语音验收连续两轮通过，每轮 7 次请求均走 loopback；
首段 64,000 个采样均有声、最大 RMS 约 0.1414。语音服务/分段/
worklet/实际 main IPC 共 35 项回归通过。原 20 秒等待和全部功能断言
保留，新 head 的 macOS 结果仍需独立确认，不将本地成功写成已证明
macOS 原因或已完成其源码/包内验收。

head `34e26b1` 的 Windows runtime、sessions、两平台 SDK 和 macOS
ARM64 候选构建通过。Windows interface 已通过语音验收，随后在既有
市场诊断脚本轮询运行中的 Git checkout 文件时遇到 `ENOENT`。
两处磁盘内容检查改到真实 UI 操作完成之后执行，保留健康市场推进、
错误诊断、已安装插件不变及 Remote 连接/流式任务断言；不吞文件错误、
增加固定延时、放宽期限或修改产品代码。
本地完整诊断 Electron 验收通过，清理确认成功；诊断、Git 刷新、
Remote 保留和清理定向单测 127 项全部通过，脚本语法及 diff 检查通过。
新 head 的完整云端验收另行确认；此处不把 macOS 候选构建写成包内验收。

本地继续串行补跑诊断之后的 36 项 interface 验收，先通过 22 项，
归档脚本随后暴露“语言”子串同时匹配“识别语言”的严格定位错误。
改为设置对话框内完整语言标签后，归档及余下 13 项全部通过，
包括生产宿主授权、输入/终端/浏览器/文件预览、搜索、账户和主题。
未跳过失败项或改变双语、删除保护、重启持久化等原断言。
CI 策略和 Win/mac 运行器另 30 项通过、1 项平台跳过。
两段串行报告位于 `D:\DFSC-Preview-QA\native-speech-ci-fix-20261109`
内 `interface-tail.json`、
`interface-tail-2.json`；首次定位失败日志一并保留。

后续 head `8412642` 本地 300 项定向回归和六项相关 Electron 验收通过。
云端 Windows 完整协议套件也通过：1907 项中 1894 项通过、
13 项平台场景跳过，没有失败，runtime 和 sessions 两组完整验收通过。
interface 随后发现设置加载竞态：
脚本只等待始终存在的标题，账户渠道断言读到了“加载中”。
本轮改等已加载的识别服务控件；fixture 可控挂起真实 IPC 回执，
显式检查加载态后放行，再检查原渠道与完整设置流程。该语音验收
本地复跑通过，7 次请求仍全部走 loopback，不加固定延时或放宽断言。
新提交的云端完整结果仍须独立确认。

PR #229 的 `bcd518c` 在 Windows 和 macOS 验收中同样失败：
任务模式状态、通用设置语言定位，以及短录音错误场景。
本轮保留已确认的听写布局与动画，修复如下：

- 听写与任务状态在草稿页使用了相同 React key，实际会残留旧任务按钮。
  为听写 key 增加命名空间，仍随 owner 变化重挂载；真实 renderer
  回归检查模式切换、新建与刷新后始终只有一个任务状态和一个听写控件。
- 界面语言设置增加明确的中英无障碍名称，各语言切换脚本改为完整名称
  定位，并确认切换界面语言不会改变识别语言。工具栏严格顺序断言补入
  新增麦克风并检查其图标，不删除布局断言。
- 录音 fixture 使用循环有声 WAV，观察真实 AudioWorklet 消息中新增的
  有声采样后再点击结束，不再依赖固定 700 ms 等待。错误场景额外确认
  请求确实到达 ASR transport；未替换生产采集、分段、IPC 或 provider
  调用，也未修改静音丢弃规则、队列限制或现有验收超时。

修复提交 `1fdbc2b` 的类型检查、生产构建、183 项定向回归、
语音 Electron 验收和任务模式完整验收通过；7 次 ASR 请求均走
隔离 loopback。之后同步父 PR #220 的 `bb74201`，仅验证记录发生
文本冲突，双方历史记录均保留，不升级 runtime pin。合并后的
类型检查、构建及完整 `verify-electron.mjs` 通过。

本地另一次主窗口验收遇到进程树结束错误并在清理阶段超时；并行的
完整协议套件停在 `plugin-skeleton-native.test.ts`，核对进程归属后
终止，未计为通过。日志及失败截图保留在
`D:\DFSC-Preview-QA\native-speech-ci-fix-20261109`。
其余定向验收和新 head 云端结果需独立确认，不将旧 head 绿项、
合成麦克风或父分支的验收视作本轮真实服务、安装包或 macOS 验收。
未重启用户应用、修改共享 junction、操作日用安装或删除历史产物。

## 原生听写提交前检查（2026-11-09）

最终预览的收音波形跟随主题强调色，停止和错误保留原有语义色。
用户确认当前交互版本；不据此推断真实账户权益、计费或识别准确率。

- 最终源码类型检查和生产构建通过，保留既有 Vite 指令和 chunk 提示。
- 提交前补跑语音、main IPC、共享账户、BVR、插件宿主、凭据存储、
  输入区、引用、diff 和主题定向回归，183 项全部通过。
- 强调色改动后的 `verify-speech.mjs` 通过，7 次 ASR 请求全部拦截
  到 loopback；深浅主题、窄窗、引用/队列/diff 同屏与减少动画继续
  通过，最终截图已检查。回执和截图位于
  `D:\DFSC-Preview-QA\native-speech-context-20261109\accent-wave`。
- `git diff --check` 通过。没有重跑完整 Desktop 套件，不宣称物理
  麦克风、真实服务、安装包或 macOS 已验收。

PR #229 首轮 CI 在分类检查发现 `verify-speech.mjs` 漏登记，
尚未运行 Windows 验收。已将其加入共享 interface 组，不改断言、
期限或排除列表。对应 CI 策略测试本地 24 项全部通过；macOS
清单、策略和运行器测试 15 项通过、1 项平台场景跳过。
这些结果不代替补推后云端各验收任务的最终结果。

只读盘点：当前 `Desktop/dist` 12.10 MiB，`Desktop/terminal-runtime`
62.96 MiB，本次强调色验收证据和隔离 profile 共 14.14 MiB。
没有删除产物、修改共享 junction、重启预览或改动日用安装。

## 听写复用引用辅助行（2026-11-09）

本轮仅调整原生听写的 composer 交互，不改账户路由或 ASR 协议。
录音、完成及错误提示移至既有引用辅助行中间，不在输入框内增加
一行；与实时 diff 并存时等分空间，有队列时沿用原有靠右布局。
状态使用 240 ms cubic-out 展开/收起，减少动画偏好直接切换。
错误完整内容可悬停或键盘聚焦查看，取消后焦点回到麦克风。
修复听写期间非空草稿将运行中主按钮切为禁用队列发送的问题：
听写中仍保留 Agent Stop，结束后恢复普通发送/队列规则。

本轮 Windows 源码验证：

- 类型检查、生产构建通过；保留既有 Vite 指令及 chunk 提示。
- 语音、main IPC、草稿、引用、diff 和主按钮定向回归 83 项通过。
- `verify-send-queue.mjs` 通过真实 RPC 插队/FIFO、带引用编辑、
  撤回、中断、IME/重复键、diff 移位及窄窗验收。
- 最终 `verify-speech.mjs` 通过，7 次 ASR 请求均拦截到 loopback。
  保留连续分段、取消、归属切换、慢服务及凭据持久化等验证，
  新增原生 CSS 动画取样、输入框位置/尺寸不变、居中/等分、
  引用/队列/diff/回到底部同屏、亮暗窄窗、完整焦点轮廓及减少
  动画断言。截图已检查。

最终回执、布局数值和截图位于
`D:\DFSC-Preview-QA\native-speech-context-20261109\final`。
父目录保留日志及先前尝试：一次误将转写新增换行带来的正常增高
算作状态增高，已改为同一草稿前后比较；一次发现并修复主按钮问题；
一次模拟 history 的选段没有产生待发送引用，布局 fixture 改用真实
composer CAS 显式安装引用，不降低引用可见性断言。真实选段引用
交互仍由独立通过的队列验收覆盖，不修改产品引用逻辑。

只读盘点：`Desktop/dist` 12.10 MiB，`Desktop/terminal-runtime`
62.96 MiB，本轮语音日志/fixture/证据 69.85 MiB，队列 fixture
13.09 MiB。排除依赖/runtime 共享 junction，未删除产物或 profile。
未生成安装包、提交、推送、修改日用快捷方式或重启用户预览。
现有独立启动快捷方式指向最新构建；已运行的窗口需显式退出应用
后再打开。上述结果不代表完整套件、真实 ASR 权益/计费、物理
麦克风、识别准确率、安装包或 macOS 验收。

## 连续分段听写与输入交互（2026-11-09）

在同一原生语音工作树上，将停止后整段转写改为录音期间连续分段写入。
AudioWorklet 连续采集单声道 16 kHz PCM，按约 700 ms 停顿或最多
4 秒切段；各段不重叠，仍使用原有账户/模型和 HTTP ASR 通道。
这是近实时分段听写，不宣称双向 WebSocket 或逐字流式。
同意记录升级为版本 2，旧的停止后上传确认不能授权录音期间上传。
停止会处理剩余片段，取消保留已写入文字；状态行置于 composer
底部，不浮在正文上。主进程限制顺序、单段/累计时长及累计文字，
renderer 队列上限为四段，服务阻塞会停止而非继续发送或重试。

本轮 Windows 源码验证：

- 类型检查和最终生产构建通过，保留既有 Vite 指令与 chunk 提示。
- 语音分段、真实 worklet 算法、实际 main IPC、账户、BVR、通用宿主、
  composer 和导航定向回归 171 项全部通过。
- runtime/会话/模型/草稿协议回归 120 项：118 项通过，
  2 项 POSIX 专属场景跳过，没有失败。
- 最终真实源码 Electron 验收通过，7 次 ASR 请求全部拦截到隔离
  loopback，覆盖未点结束前出字、保留手动编辑、仅发送短片段、
  取消、真实会话归属切换、慢服务队列满后停止且不追加请求、
  独立模型、海外账户、加密凭据和确认持久化。首个无 worker 的
  听写阶段不启动 Agent、不发 prompt；导航 fixture 随后显式创建
  空闲会话以验证不同 owner，不将该 fixture 行为归因于听写。
- 亮暗色、窄窗长正文及设置焦点截图已检查；录音状态与编辑器、
  工具栏不重叠且位于 composer 内有实际布局断言。

成功回执和截图位于
`D:\DFSC-Preview-QA\native-speech-continuous-20261109\final`；
定向回归、协议、类型检查和构建日志位于其父目录。
前两次 Electron 尝试的失败证据保留：首次错误假设新建会话不复用
未提交草稿；修正为真实归属切换后，第二次遇到空编辑器 `innerText`
含换行。只修正 fixture 前置和空白判断，未改产品导航或降低归属断言。
不将失败尝试计为成功，也不沿用上一轮 188 项数字作当前回归结果。

只读盘点排除共享 junction：`Desktop/dist` 12.10 MiB，
`Desktop/terminal-runtime` 62.96 MiB，本轮三次 fixture 与日志截图
共 41.35 MiB。没有删除产物、生成安装包、提交、推送或创建 PR。
当前手动预览仍是旧进程，等待用户确认后再重启；没有操作日用安装
或个人 profile。本轮不证明完整 Desktop 套件、真实账户权益/计费、
物理麦克风、识别准确率或 macOS 已验收。

## 原生语音输入与共享 ASR（2026-11-09）

本轮基于 PR #220 的精确 head `3341e63d3313f548ac278849fd4490b726985dcf`，
在独立 `codex/native-speech` 工作树实现主窗语音输入和通用设置。
原生输入、通用插件宿主与旧 BVR 共用账户路由及 ASR 请求实现，
不合并各自的用户同意、授权回执和生命周期边界。没有改动上游
Step-Code 或固定 runtime pin。

本轮 Windows 源码验证：

- 类型检查和生产构建通过；构建保留既有 Vite 指令与 chunk 提示。
- 语音服务、实际 main IPC、账户、BVR、插件宿主、composer 和导航
  定向回归 188 项全部通过。
- runtime、会话、模型和草稿协议回归共 120 项：118 项通过，
  2 项 POSIX 专属场景跳过，没有失败。
- 真实源码 Electron 验收通过，运行实际 main、preload、renderer
  和已暂存 runtime，覆盖首次社区版告知、麦克风授权、草稿追加、
  不启动 Agent/不自动发送、取消、导航失效、错误脱敏、独立服务、
  密钥加密、登录退出保留、海外 API 路由及中英亮暗窄窗焦点。
  5 次 ASR 请求均在启动前拦截到隔离 loopback fixture，
  不访问真实账户或付费服务。
- 手动预览脚本通过 PowerShell 语法检查并实际启动，核对新进程与可见
  首次账号设置页；使用独立 D: profile，不复制账号或修改日用安装、
  快捷方式和个人 profile。真实登录留给用户完成。

证据位于 `D:\DFSC-Preview-QA\native-speech-20261109`，包含
`verification.json`、定向回归、协议、构建和 Electron 日志及截图。
不将以上结果描述为完整 Desktop 套件、真实账户 ASR 权益/计费、
物理麦克风、识别准确率、安装包或 macOS 验收通过。
本轮没有打包、提交、推送、创建/合并 PR 或清理历史产物。
只读盘点排除依赖/runtime junction：本工作树 `Desktop/dist`
12.09 MiB、`Desktop/terminal-runtime` 62.96 MiB，验收证据及五个
fixture profile 共 67.74 MiB，手动预览 profile 首次启动约 12.32 MiB。
当前预览使用构建产物；没有删除证据、profile 或共享 junction 目标。
## Remote 非重启管理门控（2026-11-10）

本分支将“Remote 已绑定”与“会话正在执行”分开：不重启的插件安装、更新、
卸载、开关、MCP/技能与插件配置管理可以保留空闲 Remote；默认门控、
登录/退出、provider 应用、历史修改和会话重启不因此放宽。
写入期间仍阻止远端新增输入和审批，不排队、不重放被拒收消息。
任务、审批、队列、Goal、后台工作、实际插件占用与 Cron 资源保护继续生效。

子代理先审计划，再复审实现。修复自动解绑清除标志后可能漏掉断连的竞态，
最终复核保留起始连接要求及 worker/RPC/session 身份。保留既有 StepPage
固定指纹准备的已知就绪 Cron 待命例外，未知/畸形状态和重启仍拒绝，
而不是通过修改旧原生验收预期来收紧已支持行为。

本轮五组定向测试 797 项通过、4 项平台跳过、零失败；类型检查、
生产构建和差异空白检查通过。Windows 源码 Electron 管理验收 18 项通过，
包括实际市场可执行命令插件更新/卸载及 receipt/撤销记录、MCP 保存/开关、
写入期间 Remote 拒收且不重放、忙碌保护、Windows 文件占用及确认清理。
未修改的 StepPage 原生验收通过，Cron 宿主/任务保持，MCP 握手为
13 个工具，停用并重启后为 0，重启保护及修复后的禁用仍在。

证据位于 `Desktop/test-results/remote-management-*`，管理最终结果为
`remote-management-native-final/results.json`，详细范围见
[治理计划](REMOTE-MANAGEMENT-PLAN.md)。前两次原生夹具的市场名称和
Git 换行问题已修正且保留失败记录，没有降低产品门禁或验收断言。

使用隔离 profile、离线 Remote channel 和 loopback 模型；未验证真实飞书、
付费账户、macOS、云端 CI 或安装包升级。StepPage 下载期间恰好 Cron 到期
未单独原生自动化，不能宣称管理写屏障暂停了 native Cron。
BVR 旧版配置/服务声明迁移仍是独立门禁，本轮不自动迁移。
未打包、提 PR、发布市场、更新快捷方式、重启日用应用或变更真实 profile。

## 主题组合对齐新 CI 主线（2026-11-10）

#222 的 `62f673f` 已完成 Windows run `42642599418` 与 macOS
run `42642599449` 的全部必需验收。随后为解决实际合并冲突并接入已合并的
#231，先完成重启前保存的 `0d70ee0` 合并，再同步主线 `b78af40`。
这不是仅修改文档：主线同时包含通知、MCP 账户隔离与插件宿主变更。

冲突处理同时保留 `themeImage` 的被动只读路径、宿主设置读写分类、
MiniChat 禁止插件管理/窗口操作、插件窗口拒绝主题读取，以及不输出完整
快照或输入原文的权限失败诊断。Windows 汇总保留动画与 Cron 浏览器回归
各自的阶段字段，公共检查凭据和新有界协议 runner 未被绕过。

本次稳定合并候选的本地验证：

- Node 24.16.0 下类型检查、生产构建及差异空白检查通过。
- CI 策略、清单、执行器和汇总回归 67 项：66 通过、1 项既有平台跳过。
- 八个定向协议文件共 86 项：85 通过、1 项文件符号链接权限跳过。
  范围为实际主进程 IPC、插件窗口隔离、夹具关闭、运行时打包契约、
  主题组合协议、资源与图片校验；不是完整协议清单。
- Cron/动画浏览器回归 23 项通过。主题组合浏览器 10 项行为、
  四组桌面/窄屏非空像素检查通过，四张截图已目视检查。

证据在 `D:\Desktop For Step Code\output\theme-composition-main-sync-20261110`，
定向协议通过新 runner 保留逐文件日志、独立 TAP 和明确标注范围的汇总。
本机共享 runtime 仍为此前的只读复用目录，没有在其上覆盖新补丁；
完整协议和新原生矩阵由云端重新构建、分组验收，不重复在本地跑全套。
以上结果不替代新 head 的云端、原生 macOS、真实账户或发布验收。

重启前的 `0d70ee0` 本地复验没有全绿：插件九组业务断言完成且零页面错误、
零推理请求，但关闭超时；完整协议在 completion-review 文件报失败后挂起。
未确认这两次失败的精确根因，不以重启后的进程消失或旧 head 绿灯算作修复。
原日志保留在 `output\theme-composition-main-sync-20261109`，不放宽关闭断言、
不加入自动重试。未合并 #222、未推进 #223，未打安装包、修改用户档案、
运行客户端、快捷方式或本机运行时版本；本地 AGENTS.md 改动不提交。

## 市场刷新诊断夹具的文件替换间隙（2026-11-10）

#218 Windows interface run `42703156585` 在
`verify-capability-diagnostics.mjs:390` 读健康市场的 manifest 时遇到
`ENOENT`，此前单市场失败诊断和 Remote 保留检查均已完成。
夹具直接轮询 Git 正在更新的文件，缺少文件暂时不存在这一等待状态。
两个在途 manifest 轮询现在仅将 `ENOENT` 当作尚未发布；仍须读到指定
新修订才通过，非法 JSON、权限和其他 I/O 错误继续立即失败。
保留原 60 秒期限、100ms 间隔、Remote 身份和流式任务断言。

受控回归真实移走旧文件，确认旧读法当场失败；在第一次空快照后发布新
文件，确认轮询只在新描述出现后完成。56 项定向回归、类型检查及生产
构建通过，完整 Windows 市场诊断 12 个场景通过且确认清理完成。
日志为 `Desktop/test-results/goal218-manifest-native-20261110.log`。
源码、包内与新 head 云端结果仍分别验收，不将该夹具修复当作任何
产品刷新错误的豁免。

## MiniChat 交接后的迟到保存保护（2026-11-10）

#216 macOS run `42687909764` 的源码场景通过，但包内 MiniChat 在
宿主发出交接事件后仍收到旧主窗的保存请求。渲染侧在收到事件后才暂停保存，
不能阻止此前已发出的 IPC；仅调整测试计数边界不足以保证阅读位置。

本轮在宿主提交交接时推进主窗阅读版本，快照和导航结果携带该版本，
保存必须提交已安装视图的版本。旧版本、未来版本和非法版本直接拒绝，
不更新缓存；MiniChat 自身的独立保存不受影响。相同会话的新版本也恢复
交接位置，迟到的旧快照不能倒退视图。保留渲染侧暂停保存和 4px 锚点检查。

原生回归在快照被挂起期间主动发送旧版本保存，验证实际拒绝和缓存不变，
不再把“尝试发送”和“成功写入”混为一谈；提交前的正常保存仍须接受，
随后由交接覆盖。新增实际宿主 handler / 渲染 installer 回归 5 项，
连同草稿、共享输入和阅读相关测试共 37 项通过；类型检查、生产构建和
完整 Windows MiniChat 原生验收通过。日志位于
`Desktop/test-results/goal220-mini-revision-*-20261110.log`。

这是阅读状态竞态修复，不改插件授权协议或 runtime pin；仍须新 head 的
Windows/macOS 源码和包内云端验收，不宣称已合并或完成最终 main 包交付。

## 通用宿主设置同步通知与市场信息（2026-11-10）

PR #220 沿 #215 → #216 → #217 → #218 同步 main `c87f96b`。
保留主线通知、插件作者/许可证/依赖展示与宿主来源设置，预览夹具同时
保留市场信息模式和宿主设置模式；不变更公开协议、SDK 来源 pin 或 runtime pin。

Windows 本地类型检查、生产构建及 294 项串行定向测试通过，
覆盖协议、broker、启动与设置、配置修订、管理和恢复、Remote 保留、
通知与严格退出。宿主设置浏览器矩阵和两组生产 Electron 验收通过，
包括不回读秘密、并发写入、拒绝/批准、取消和换号撤销。
日志位于 `Desktop/test-results/goal220-main-*-20261110.log`；
provider 只连接隔离 loopback，不使用真实账户或付费模型。

最新提交仍需各自 Windows/macOS 云端源码及包内验收。既有 `then_run`
云端退出超时根因尚未确认，补充诊断但未放宽断言或期限。
此记录不表示已合并、打包、更新 BVR/市场或切换日用应用。

## SDK 示例提交产物同步（2026-11-09）

`0a03b3f` 的 Windows SDK run `42613027311` 先通过 11 项测试，
随后在重建比对门禁失败：公开协议已修复，但已提交的自包含
`dist/server.mjs` 仍含旧媒体正则。本轮按原脚本重新生成，唯一代码差异
为同步该校验行；11 项示例测试复验通过，重复构建字节一致。
保留原 CI 比对、依赖锁定和全部断言，不把旧 head 的通过记作新 head 全绿。
BVR 仍固定到包含公开协议修复的 `0a03b3f`，此后续提交不改公开接口或来源。

## 大媒体校验与授权弹窗快照竞态（2026-11-09）

公开宿主客户端的 Base64 正则在 4 MiB 媒体上触发栈溢出。
改用既有解码后的规范重编码比对，继续严格检查字母表、补位及补位位；
不改协议、MIME、非空与大小限制。回归覆盖 4–23 MiB、三种补位长度、
非法 Base64、超限及真实 client/broker 的 ASR、视频转发。
BVR 同步相同客户端修复，独立记录其来源提交，不发布市场更新。

Desktop 自有确认请求的到达、取消/过期和回答此前不推进 runtime revision，
迟到快照可能隐藏仍待批准的弹窗，或恢复已失效请求。本轮统一推进修订，
增加三项顺序回归；完全访问仍须显式批准，不因重载自动授权。
生产 Electron 验收确认到达事件有版本、重载只恢复原请求一次，
批准前 provider 调用为零。

Windows 验证与交付：

- 五组定向回归 151/151 通过，类型检查及生产构建通过；
  源码授权链和 BVR 组合 Electron 验收通过。
- 已交付未签名、未发布的 Windows 修复候选，基于 Desktop `3341e63`
  和 BVR `09e04cf` 加当时未提交修复，并非最新 main 或之后提交的精确构建。
  安装包 SHA-256 为
  `2f4dc21e79d864933080b4b70a107b54e3a94fb6fb47bad9c53f9c2b9790b0f4`。
- 实包授权链通过；BVR 实包 8 个场景、6 次 loopback provider 请求通过，
  包括原生安装/启动、拒绝/批准、取消、换号、独立表单及旧修订拒绝。
  三份随包/已安装客户端与公开协议字节一致，并通过大媒体校验。
  用户已反馈候选体验无问题，不据此扩大为所有真实模型链路验收。
- 证据目录为
  `D:\Desktop For Step Code\Desktop\release\plugin-host-large-media-20261109-preview`，
  包含 `acceptance/package-integrity.json`、
  `acceptance/authorization-r2.log`、`acceptance/bvr-packaged-r3/verification.json`、
  `acceptance/media-client.json`、`source-receipt.json` 和 `handoff-summary.json`。

首次封装遗漏两个正常 staging 生成的 runtime helper，已按既有构建规则
补齐并重新打包、复验，未加产品绕过逻辑。一次较早的实包换号验收出现
fixture 路由/凭据/负载断言失败；仅补充不含秘密的断言行号诊断后，
完整复跑通过且断言未改。原失败证据保留，根因尚未确认；
用户此前的超时也不能全部归因于弹窗竞态。

本轮自动验收不使用真实账户或付费请求，未证明原生 ASR、安装器生命周期、
旧版升级或 macOS 原生行为。候选依赖本机 BVR junction，不是跨机便携交付。
主桌面快捷方式已备份、指向验收包并读回，保留启动参数；另有隔离 profile
的 BVR 预览入口。未重启用户应用、复制凭据、修改个人 profile 或删除旧包。
未合并 PR、发布插件/市场、升级 runtime pin 或改动 StepAudio。
以下旧轮次记录及旧 head 云端绿项仅作历史证据，新提交 CI 须独立确认。

## 宿主设置层同步主线保护（2026-11-09）

设置层合入启动层 `6c4b6ed`，延续主线 `6edeb18` 的细分管理门控、
Remote 保留、恢复隔离和 MiniChat 边界。宿主状态查询属于被动读取，
不会应用待处理的 provider 设置；模式保存进入共享管理门控。
恢复 journal 未完成或管理/运行时被隔离时，保存必须在撤销授权、
独立配置和模式指针写入前拒绝，不改动恢复证据。
宿主错误文案复用主线的中英双语诊断映射并保留诊断编号。

本轮 Windows 源码验证：

- 宿主协议、配置、代理、启动器、设置、管理策略、实际 main IPC、
  Remote、恢复及停止回归 249 项全部通过，包含 4 项真实固定 runtime/SDK 集成。
- SDK 自包含示例 11 项全部通过；CI 策略、准备和回执测试 49 项通过、
  1 项 POSIX 专属场景跳过；Desktop 类型检查和生产构建通过。
- 真实 Electron 设置验收通过，覆盖 receipt-backed IPC、显式来源、
  并发 writer、独立 SDK 启动及撤销。生产确认链另通过拒绝/批准、
  真实 MCP 待确认和在途取消、同次启动复用及账户替换。
  provider 请求只走隔离 loopback，不使用真实账户或付费模型。
- 设置浏览器矩阵通过：来源选择、秘密不回读、失败/冲突保留草稿、
  开关和迟到响应失效、host-only/旧宿主、亮暗窄窗完整焦点及减少动态。
  首次因缺少固定 Playwright headless shell 未启动浏览器，保留失败日志；
  使用已安装 Edge 的同一 verifier 通过，未改断言或重装依赖。
  成功日志为 `Desktop/test-results/plugin-host-settings-main-ui-edge-20261109.log`，
  设置与确认日志为 `plugin-host-settings-main-electron-20261109.log`、
  `plugin-host-settings-main-authorization-20261109.log`，
  定向回归日志为 `plugin-host-settings-main-regression-20261109.log`。
- 既有 Plugin Center 浏览器完整验收通过，继续覆盖更新、来源、标签、
  文档、BVR 与通用配置，日志为 `plugin-center-main-browser-20261109.log`。
- BVR 草稿 `09e04cf` 对本轮合并结果构建的真实源码 Electron 组合验收
  8 项通过，6 次 provider 请求全部隔离到 loopback，覆盖原生安装与启动、
  生产拒绝/批准、取消、换号、真实独立表单及旧修订拒绝。
  回执位于 `D:\DFSC-Preview-QA\bvr-native-host-main-20261109\verification.json`；
  执行时本分支处于未提交合并，回执的 `desktopCommit` 仍为 `fead991`，
  实际构建 SHA-256 为 `8f5ac3de0802fc75cd88706af36522edf062e7ca27292cb0fdaed3f1ed8d0c72`。
  不将该旧 HEAD 字段描述为本轮最终提交；原生 ASR 和实包升级未验收。

本轮没有重跑完整 Desktop 全量套件，不沿用旧全量数字作为当前提交结果。
#215 的 Windows 会话组仍在 MiniChat 返回阅读锚点检查超时；macOS runtime
组另在 `verify-permission-tiers.mjs` 达到 300 秒外层期限。均未确认根因，
未修改相关产品行为、断言或期限，不将本地通过当作云端全绿。
后续叠加 PR 的云端结果必须按各自新 head 单独确认，继续保持草稿。

可重建产物盘点排除 junction：本工作树 `Desktop/runtime` 124.19 MiB、
`Desktop/dist` 12.03 MiB、设置截图 0.43 MiB、生产确认截图 0.17 MiB。
没有生成安装包、删除旧包、改快捷方式、重启日用应用或修改个人 profile；
没有发布插件/市场更新、合并 PR、升级 pin 或改动 StepAudio。

## 宿主启动层同步管理保护（2026-11-09）

启动层合入本轮代理分支，保留主线 `6edeb18` 的管理租约、Remote、
恢复 journal 摘要校验、确认关闭及 MiniChat surface/诊断参数。
宿主授权仅在通过 guard 后的运行时修改前撤销；市场发现和已证明的
纯主题操作不撤销。隔离的管理或运行时状态不会恢复延后启动。
RPC 同时保留关闭 ACK 和安全错误详情，并丢弃未知或迟到的私有响应。

本轮 80 项代理、launcher、管理策略、实际 main IPC 和关闭回归全部通过，
含 3 项新增组合边界测试；类型检查和生产构建通过。全新固定源码重放、
构建及 staging 完成后，4 项真实原生 SDK 启动测试通过，覆盖实际 broker、
确认、账户撤销、全局覆盖、初始化错误隔离和 opt-in 关闭兼容性。

初次暂存虽通过源码后像检查，但 CLI 依赖 junction 解析到了旧 checkout，
使 3 项原生测试报私有命令不存在；该次失败日志保留，不计入通过。
仅在新建隔离目录重建 CLI 依赖链接、令 coding-agent 指向同一重放源码后
重新构建及复验；没有改动原 checkout 或重新安装依赖。重放目录：
`D:\Desktop Runtime Builds\plugin-host-stack-main-20261109\Step-Code`。
成功日志为 `Desktop/test-results/plugin-host-launch-main-native-isolated-20261109.log`
与 `plugin-host-stack-staging-isolated-20261109.log`。

修正依赖后的同一暂存运行时还通过 RPC/模型/会话回归 122 项中的
120 项（2 项 POSIX 跳过），以及默认 sandbox 下的真实 Electron
启动、设置、MCP、主题、窄窗口和重开验收。日志为
`plugin-host-launch-main-protocol-20261109.log` 与
`plugin-host-launch-main-electron-isolated-20261109.log`。

#215 新 head `21181d1` 的 Windows 会话组在
`verify-mini-chat-electron.mjs:524` 的阅读锚点返回检查超时，根因未确认。
不沿用旧 head 的绿项，也没有为此降低断言、增加超时或改动 MiniChat 产品逻辑。
本层仍为草稿；没有打包、市场发布、真实付费请求或日用 profile 变更。

## 宿主叠加 PR 的 CI 依赖准备（2026-11-08）

#218 的 `9d5f0a3` 与 #220 的 `9914784` 在依赖准备阶段仍失败，
尚未进入本轮授权验收。canvas 安装器没有取得预编译包，随后在 Windows
回退编译时找不到支持的 Visual Studio，在 macOS 缺少 pangocairo。
此前另有 Electron 下载 504；这些现象不能证明授权断言失败，也不能
仅凭安装器的 “No prebuilt binaries found” 判断官方资产不存在。

本轮只复用另一工作分支的公共 CI 修复（`585b359`、`32cd89a`、
`4a69dc9`），不引入 #219 的产品改动及其验收记录。预取固定版本的
官方 canvas 和 Electron 归档，Release 下载失败时只尝试同一官方资产
的 GitHub API；每个下载有有限期限及重试，校验 SHA-256 后才交给
原安装器。保留 frozen-lockfile、正常安装生命周期、测试及产物门禁，
不改 runtime pin、Node 24.16.0、依赖版本或镜像。

本地 CI 策略、Win/mac runner、产物回执、摘要和预取回归共 50 项：
49 通过，1 项 POSIX 专属场景在 Windows 跳过。已从官方 Release
metadata 独立核对两个平台的 canvas/Electron 资产 ID 和 SHA-256。
该结果不等于本轮云端新下载或 macOS 原生验收通过，须按新提交单独确认。
未安装依赖、构建安装包、触碰日用账户或快捷方式。

## Windows 短路径测试夹具冷启动（2026-11-10）

#217 Windows sessions run `42668131299` 在全量协议测试失败：
`windowsShortPath` 为读取一个目录的 8.3 别名启动 PowerShell/COM，
进程超过原有 10 秒期限且没有输出；尚未执行该组 Electron 验收。
改用原生 `cmd /u` 的 `%~sI` 展开，路径只通过环境传入，关闭延迟展开，
输出保留引号并按 UTF-16LE 解码；仍验证隔离根目录及别名的真实目标。
不延长超时、不修改产品目录保护、不删除短路径和 dangling link 断言。
新增中文、空格、shell 字符、junction、越界和不存在路径回归。
本地类型检查及 32 项安装器/短路径测试通过、零跳过；原有三项
短别名/dangling link 回归均实际执行。日志为
`Desktop/test-results/goal217-short-path-native-20261110.log`。新 head
云端仍待验证，不把该修正与此前 `then_run` 关闭事件超时混为同一问题。

## 草稿创建顺序竞态与浏览器失败证据（2026-11-09）

PR #218 macOS run `42507893917` 的权限验收在取消首次完全访问确认后，
未能把待发送文本恢复到可见输入框。主进程的创建回包可能先于
`desktop_draft_created` 发布事件到达：快照先选中新会话的另一条空 composer，
后到事件只迁移缓存，导致已恢复的正文不在当前输入框引用中。
创建回包带有 sessionId 时，先按现有 promote 路径认领，再安装快照；
不改 CAS、冲突处理或其他窗口的草稿。

原生回归暂扣真实提升事件，等创建回包后出现的风险对话框，再释放并确认
renderer 已消费，随后取消。旧产品在该对照下稳定失败：存储正文正确而
可见输入框为空；负对照退出另外触发了有界超时，原始失败日志保留。
修后完整 Windows 权限验收通过，包括取消不发模型请求、不产生消息、
保持 ask，以及高风险拒绝、单次/记忆授权、重载、中英和窄窗口检查。
两种回包/事件顺序、重复提升和新输入保留均有单元覆盖；composer/input/
MiniChat 草稿回归共 36 项通过，类型检查及生产构建通过。

PR #217 macOS run `42507834617` 的包内浏览器验收中，已报告标题的原生
网页在 Playwright 附着等待结束前消失。旧产物不足以确认销毁原因；
本轮只补充有界原生页面生命周期、视图/标签状态及失败截图、JSON，
保留原异常，不添加重试或降低断言。Windows 完整源码浏览器验收通过，
不等于证明 macOS 根因已修复。

本机源码验收沿用已暂存的最终组合 runtime：固定 pin 不变，包含 #218
启动层标记；不能据此宣称 #217 单独层已完成精确 staging 验收。
云端须以三个后续 PR 的新 head 分别确认。日志保存在
`Desktop/test-results/ci-permission-promotion-*` 与
`Desktop/test-results/ci-browser-lifecycle-20261109.log`。
未打包、发布、合并 PR、调整钉点、访问真实账户或改动日用应用。
## 指令分发的焦点与布局就绪验收（2026-11-10）

#217 macOS run `42703158432` 的源码界面组通过，包内组在重复
`/todos` 后的单次焦点/位置快照失败。旧断言没有输出哪一项不满足，
本机原验收通过，现有证据不足以断言 macOS 的具体调度根因。

共享夹具改为最多 5 秒等待原来的严格条件：标题必须获得真实焦点，
且上下边界完全位于摘要滚动区；不加像素容差，不改产品滚动或焦点逻辑。
超时仍失败并输出焦点、标题和滚动区坐标。保留不重挂载、历史/任务
展开状态、轮询不抢焦点和只读命令断言，从底座同步各层。

受控真实浏览器暂扣焦点，确认旧即时快照失败、等待实际就绪后通过；
永久失焦及越界负控均须超时。新增四项与 manifest 等待合计九项回归、
类型检查及完整 Windows 指令分发原生验收通过，日志为
`Desktop/test-results/goal215-command-reveal-20261110.log`。
该负控不证明原云端根因，新 head 的两个平台源码与包内验收仍须独立确认。

## 市场刷新诊断夹具的文件替换间隙（2026-11-10）

#218 Windows interface run `42703156585` 在 Git 刷新替换 manifest 的间隙
读取文件，因 `ENOENT` 立即失败。共享夹具只将该错误视为等待状态，
仍须读到指定新修订；非法 JSON、权限和其他 I/O 错误继续立即失败。
保留 60 秒期限、100ms 间隔及 Remote 断言，并从依赖底座同步所有层。

真实文件替换的旧读法负控、新逻辑回归、56 项定向测试及完整 Windows
诊断 12 项通过；证据为 #218 的
`Desktop/test-results/goal218-manifest-native-20261110.log`。
这是共享夹具回补，不是产品刷新失败的豁免，新 head 云端仍须独立确认。

## 将草稿提升修复补入依赖底座（2026-11-10）

#216 macOS run `42696240175` 在权限确认取消后等待正文恢复超时，
位置为 `verify-permission-tiers.mjs:108`；模型尚未调用、会话没有消息。
核对层间差异发现，此前 #217 的创建回包 / 提升事件顺序修复未补入
#215/#216。现将相同的 renderer promote、两种顺序单元回归及受控
原生事件延迟回归补入 #215，再沿依赖链同步；不改权限策略或等待期限。

旧云端没有 composer 缓存诊断，因此不把日志本身当作唯一根因证明；
受控回归及此前新旧对照见后续层的草稿竞态验收记录。
#215 本地类型检查、生产构建及草稿/阅读/退出 47 项回归通过；
完整原生权限档位验收通过，含受控顺序、取消恢复、危险操作拒绝、
单次/记忆授权、中英和窄窗口。日志为该工作区的
`Desktop/test-results/goal215-permission-backport-20261110.log`。
新 head 仍须各自完成 Windows/macOS 源码及包内 CI。

## Windows 验收控制器退出与原生进程分离（2026-11-10）

#217 Windows run `42696239500` 再次在 then_run 业务断言通过后关闭超时。
该次 Node inspector 为 61125，残留连接却是原生 Electron 的 Chromium
调试端口 61127；旧守卫只认 Node 端口，漏掉了 Playwright 的第二条连接。
夹具现在从本次隔离 profile 的 `DevToolsActivePort` 严格解析 Chromium
端口，分别捕获两个唯一 loopback 端点。释放条件仍为 launcher 正常退出、
所有页面关闭、真实主 PID 已不存在；含糊端点不处理，其他连接不触碰。

新增格式边界、双连接释放及歧义端点回归，23 项退出测试通过；类型检查、
生产构建及完整 Windows then_run / 原生命令 / 后代取消探针通过。
日志为 `Desktop/test-results/goal217-cdp-*-20261110.log`。
本次暂停 Chromium 接收的尝试未能稳定复现旧助手超时，不作新旧原生对照
成功的声明；本地通过不代替新 head 云端验收，内核端点保留来源仍未确认。

#216 Windows runtime run `42683351410` 的 then_run 业务断言通过后退出超时。
诊断确认启动器已正常退出、页面为零，实际 Electron 主 PID 已不在
进程清单中，但它的调试 TCP 端点仍未结束。仅释放启动器管道不够，
不能把 launcher 退出或 context.isClosed 当作控制器已完成关闭。

Windows 夹具在关闭前读取实际主 PID 和 inspector 端口，捕获唯一匹配的
loopback 客户端 socket。只有启动器 exit=0、所有页面关闭且实际主 PID
经 signal 0 核实不存在时，才释放该次启动的已失效调试连接；进程仍活着、
失败退出、端点不明或存在多个匹配时不处理。不杀进程、不触碰任意 socket，
不主动伪造 context close 事件，不改产品、30 秒期限或原退出断言。

受控真实 Electron 对照暂停该 inspector 的接收：旧夹具在正常进程退出后
仍于 30 秒失败，新夹具约 0.5 秒完成且实际 context close 事件到达。
31 项相关夹具测试和完整 Windows then_run（含原生命令/后代取消探针）通过。
对照证明已退出进程的控制连接可以阻塞退出；底层为何保留旧 TCP 端点仍未确认，
不将受控对照表述为对旧云端内核句柄来源的证明。新 head 云端须独立验收。

## 原生浏览器夹具的异步等待（2026-11-10）

#220 macOS run `42675772685` 的 interface 源码验收发现原生标签仍处于
初始空白状态、未发生导航。核对固定 Playwright 1.60.0 的实现后确认：
浏览器侧 `waitForFunction` 把异步谓词返回的 Promise 当作真值，不会持续
等待 IPC 结果成立。该夹具的十处异步查询因此可能过早结束。

改为 Node 侧逐次等待实际 browserList 结果，并在输入前确认选中标签已渲染，
Enter 定向发给地址输入框。保持原有 15 秒期限、真实页面加载、隔离、
原生层级、布局及清理断言。回归覆盖空列表、空白/加载中标签、异步谓词、
超时和 IPC 错误，并防止十处等待重新使用 Promise 真值。
本机固定 Playwright 实测异步谓词始终返回 false 时只执行一次便结束，
与源码实现一致。修正后的 Windows 完整原生浏览器验收、11 项相关回归及
类型检查通过；未修改浏览器产品实现。
这确认了夹具缺陷，但不把它宣称为旧 macOS 失败的唯一根因；
新 head 的 Windows/macOS 源码及包内验收仍须分别完成。

## MiniChat 交接回归的提交边界（2026-11-10）

#216 macOS sessions run `42667852733` 在包内 MiniChat 回归检测到一次旧视图
保存。原夹具从收到 `miniChatReturn` 调用就开始记录违规写入，包含宿主尚未
提交交接的位置保存；这类写入会被随后的小窗位置覆盖，不能等同于提交后回写。

夹具现在通过真实 `desktop_view_changed` 交接事件划定提交边界，仍暂停主窗
恢复快照并检查提交后的零写入及原有 4px 阅读锚点。额外受控暂停提交，主动
注入一条旧的 `follow: true, top: 0` 保存，确认它确实被之后的交接覆盖。
未修改产品逻辑、等待期限、锚点精度或删除断言。

Windows 完整原生 MiniChat 验收连续三次通过，日志为
`Desktop/test-results/goal215-mini-transfer-boundary-20261110.log`、
`goal215-mini-transfer-boundary-2-20261110.log` 和
`goal215-mini-transfer-boundary-3-20261110.log`。原 macOS 失败未含提交边界
诊断，不据此断言其唯一根因；新提交仍须重新通过 macOS 源码与包内门禁。
另已独立确认 GitHub Actions/Checks API 事件 `tp8cghg7tlc4`，不将调度前
内部错误当作产品测试失败，也不绕过未完成检查合并。

## 宿主依赖链同步通知与市场信息（2026-11-10）

PR #215 同步 main `c87f96b`。MiniChat 阅读位置交接统一使用一个
`pendingPresentationRestores` 计数器，保留同步安装快照、恢复布局及主线的
受控快照等待回归；通知和插件元数据采用主线实现，双方验收历史均保留。

Windows 本地类型检查、生产构建及通知、完成音、市场元数据、依赖声明、
退出助手共 49 项测试通过。完整 MiniChat Electron 与 `then_run` 源码验收
通过，后者包括真实上下文关闭事件、驱动和启动器结束及后续原生命令探针。
日志为 `Desktop/test-results/goal215-main-mini-20261110.log` 和
`goal215-then-run-debug-20261110.log`。

云端两次 `then_run` 退出超时尚未证明根因：业务断言完成、启动器成功退出，
但未观察到浏览器上下文关闭事件。本次补充失败时的 TCP 端点和端口进程
诊断，不输出环境、凭据或请求正文；没有放宽退出断言或 30 秒上限。
本地重跑通过不等同于该云端问题已经修复。新提交仍需 Windows/macOS
云端源码和包内验收；本节不声明合并、打包、真实模型或日用配置变更。

## 宿主依赖链同步主线底座（2026-11-09）

PR #215 同步 main `12d054e`，纳入已合并的插件工作区、全局指令和
MiniChat 最小化/交接同步。权限验收冲突同时保留主线的 RPC 就绪等待、
Node 侧快照轮询与隔离回归，以及本分支的失败阶段诊断和有界退出助手；
验证文档保留双方完整历史。未放宽权限策略、断言、精度或超时。

本地类型检查和生产构建通过；会话、全局指令、MiniChat、插件工作区与
主进程边界回归 176 项全部通过，原生 MCP 凭据隔离、staging 与 fixture
退出回归 26 项全部通过。CI 策略、执行器、准备及回执测试共 50 项，
49 通过、1 项既有 POSIX 平台跳过。未重跑全部协议测试。

经未修改的有界 CI runner 串行执行，真实 Windows 源码权限档位验收
通过（24.019 秒），完整 MiniChat 原生验收通过（85.592 秒），包括
最小化/恢复、原生交接、4px 阅读锚点、审批、流式输出和退出。
日志为 `Desktop/test-results/host-stack-main215-native-20261109.log`。
使用隔离档案与本地 provider fixture，保持默认 sandbox；不代表真实
付费模型、原生 macOS、旧安装升级或新提交的云端 CI 已验收。

固定 runtime pin、依赖和公开宿主 SDK 均未变；未打包、发布、合并 PR、
访问日用档案或改变快捷方式。旧 head 的绿项仅为历史结果，新提交须重新
跑云端检查；#215 继续保持草稿，不单独发布破坏性凭据隔离升级。

## MiniChat 交接保存竞态与权限验收诊断（2026-11-09）

PR #215 的 Windows sessions run `42500598172` 在 MiniChat 返回主窗后
阅读锚点断言超时。新增原生回归暂停主窗恢复快照，再触发真实失焦保存路径；
修前稳定检测到主窗旧的 `follow: true` 位置覆盖了小窗阅读位置。
交接期间暂停展示状态保存，快照安装、展开状态恢复及阅读布局在同一提交中
完成后才恢复保存。修后完整原生 MiniChat 验收通过，保留原有 4px 锚点断言。

macOS runtime run `42500598090` 的包内权限验收留下高风险审批请求，
随后退出挂起并被 300 秒外层超时终止。旧日志没有输出原始异常，不能据此
认定审批按钮或产品逻辑的根因。本轮先接入已有的有界退出助手，响应 typed
quit review，并在收尾之前记录原始异常与失败阶段；不放宽审批或危险命令
断言。Windows CI 同时收集子目录中的原生失败截图，避免漏掉 MiniChat 证据。
macOS 原始失败仍须以新云端结果诊断，不能用本机通过替代。

本地类型检查、生产构建、36 项阅读/滚动/退出回归、15 项 CI 策略和 runner
测试均通过；真实 Windows 源码 MiniChat 与权限档位完整验收串行通过。
失败对照与修后日志分别保存在 `Desktop/test-results/ci-mini-handoff-repro-*`
和 `ci-*-fixed-*`。未打包、升级钉点、访问日用档案或改变账户。

后续 macOS #217 run `42505882733` 的新增回归误收了交接之前、Remote
仍隐藏正文时的 `top: 0` 保存；失败诊断中主窗与小窗的实际锚点偏移均为
`-44.75px`，传入位置没有被覆盖。回归改为仅记录主窗恢复快照已挂起期间
的保存，且明确断言快照确实处于等待；不删除保存隔离断言或 4px 精度检查。

## MCP 隔离候选同步主线（2026-11-09）

PR #215 同步 main `6edeb18`，保留凭据隔离补丁、显式独立 Key
及双方完整验收历史。新主线中的管理 worker、恢复与 MiniChat 边界一并保留；
固定 runtime pin 不变，不将后续宿主协议、broker 或 BVR 迁移提前合入这一层。

旧 macOS run `42401622834` 的源码会话组通过，包内组在
`verify-send-queue.mjs:126` 点击“返回队列”时被演示页正文阻挡并超时。
本机在原 `0479c93` 源码上限制窗口最高 684px 后，同一整套队列验收通过。
这不是原生 macOS 复现，也不能证明根因已修复；没有改变队列实现、
断言或超时。新组合的本地检查与云端结果另行记录，不沿用旧 head 的绿项。

本轮类型检查、生产构建及 CI 策略/准备/回执回归通过：后者 50 项中
49 通过、一项 POSIX 跳过。11 个定向协议测试文件共 194 项，
192 通过、两项 POSIX 跳过、零失败；覆盖实际 OAuth/API Key MCP 隔离、
管理租约、实际 main IPC、Remote 保留、更新恢复与进程停止。
当前组合的真实 Windows 源码 Electron 启动/重开、八类 StepPage 注册场景，
以及最高 684px 窗口下完整队列验收均通过，保持默认 sandbox。

首轮管理回归使用了旧辅助文件，触发 `capability:management-uncertain`；
该轮已中止，保留失败日志，仅停止已核对归属的测试子进程，不计为通过。
原有 Step Code checkout 的后像不匹配 staging 门禁，未覆盖其既有改动。
另建同一钉点的干净源码，完整重放补丁并重新构建/暂存成功：
51 项后像、24 个能力标记及 Node 24.16.0 实际 SHA-256 均匹配。
日志在 `Desktop/test-results/mcp-credentials-main-*-20261109.log`；
成功复验使用 `*-ready-*`，原失败记录未覆盖。

新增隔离重放源码约 48.4 MiB，下载的原 macOS 诊断解压后约 131.9 MiB，
盘点排除依赖 junction；未生成安装包，未擅自删除验收资料。
云端检查仍须以新提交为准。#215 继续保持草稿，不单独发布破坏性隔离升级；
后续宿主层仍需同步新基线，再单独完成组合包、旧安装升级及真实账户验收。

## MCP 凭据默认隔离候选（2026-11-08）

候选基于 main `6995910`，是宿主能力计划 #212 的一个独立实施切片，
不是整个阶段 [Ⅰ] 或通用授权桥的完成声明。固定 runtime pin 仍为
`29eb460780489801ce8afc8bffc1a2efae7cbded`。新增补丁只关闭 stdio MCP
在环境白名单之后读取 Step 登录存储、自动补入 `STEPFUN_API_KEY` 的兜底，
保留服务显式配置的独立 Key，并使管理诊断遵守同一策略。

全新隔离 checkout 完整重放补丁链成功，全部 51 项共享后像匹配；
实际 staging 校验同一组源文件哈希，声明 24 个能力标记，其中包含
`desktop-mcp-credential-isolation`。Node 为 24.16.0，其实际 SHA-256 与
runtime manifest 匹配。隔离源码的离线构建、上游根目录 `check`、
Desktop 类型检查与生产构建通过，依赖锁文件和上游 pin 均未改动。
根目录检查没有改写本轮源文件或其他既有补丁的后像。

本地 Desktop 全量串行协议回归正常结束：1,480 项，1,467 通过、
13 项平台跳过、零失败、零取消，耗时 608.8 秒。随后针对最新管理诊断断言，
重跑实际 MCP、staging、runtime 与 BVR：共 43 项，41 通过、两项 POSIX
跳过、零失败。新增用例使用假 OAuth/API Key 和一次性配置，实际完成六种
服务声明的 MCP 握手，验证父进程及后代不获得宿主账户、显式独立 Key 保留、
账户文件不变、事件/摘要无凭据、模型请求为零；真实管理 worker 不再提示
通过 `/login` 补足插件环境。相同 native 用例在未修改的 runtime 上两项
均失败，检测到 `accountPresent` 和 `stepfunPresent`，未输出原始凭据。

上游 MCP 源码测试单独运行 15 项全部通过；相关 doctor 源码测试定向运行
两项通过。此前两文件合跑的候选结果为 39 通过、三项失败，未修改源码对照
为 38 通过、相同三项失败，分别涉及 Windows 路径、用户技能发现和 CRLF。
该合跑不是全绿，未修改或过滤这些无关测试来获得通过结果。
本机 Node 24.15.0 的 Vitest 启动遇到 `#module-evaluator` 导入错误，
改用已有的 24.16.0 可正常执行；没有为此更新依赖或修改测试框架。

真实 Windows 源码 Electron 默认启动验收通过，包括真实 RPC、MCP、
renderer 隔离、设置、窄窗口、新旧 profile 和关闭后重开；
StepPage 注册验收八类场景全部通过。没有使用 `--no-sandbox`、
修改产品沙箱设置或访问日用 profile。CI 策略与 runner 测试共 40 项，
39 通过、一项平台跳过。日志在本隔离工作树的 `Desktop/test-results/`
下，以 `mcp-credentials-` 开头；补丁重放目录也保留用于复核。

云 CI、原生 macOS、打包与真实账户调用仍是独立门槛。本轮未打包、
更换快捷方式、重启日用应用或调用真实模型，也未实现 SDK、授权界面、
通用 broker、BVR 迁移或首次安装风险确认。旧的 StepPage 准备进程和远程
MCP 环境引用仍需后续审查；本轮不是完整宿主环境隔离或本地代码沙箱。
依赖隐式 Step 登录的服务有兼容风险，不能将本草稿单独作为破坏性升级发布；
组合发布前必须完成通用授权入口、迁移和可操作的升级提示。

## 通知 PR 文档冲突解决与本地回归（2026-11-10）

同步主线 `0d70ee0`（MiniChat 最小化和插件市场信息），仅
`docs/VERIFICATION.md` 产生冲突；双方验收记录均保留，产品代码采用自动合并结果。
合并后的 Windows 本地类型检查、生产构建和 234 项相关测试全部通过。
完整 MiniChat Electron 验收、通知 7 组原生验收、插件市场信息 20 组浏览器
交互检查及提示条时序回归通过；原生测试使用隔离 profile 并正常退出。
新增回归日志位于 `Desktop/test-results/notifications/main-0d70ee0-*-local.log`。

此前 `afdedff` 的 Windows 和 macOS 云端检查已全部通过，对应运行
`42638705403`、`42638705546`。经维护者明确同意，本次同步提交使用
`[skip ci]` 避免再次执行云端全量验收，不修改 CI 规则。旧提交的全绿不代表
当前最终组合已通过云端或 macOS 重验；本次未打包、发布、安装或改动快捷方式。

## Desktop Notifications Mainline Integration (2026-11-09)

The approved notification preview is integrated on main baseline `9e493eda`,
without importing the old shared workspace's provider, speech or other edits.
Settings > General adds independent approval notifications (on), completion
notifications (off) and completion sound (off). Native notices stay silent;
muting completion audio retains the existing completion animation. See
[the behavior contract](NOTIFICATIONS.md).

Local Windows source evidence:

- Typecheck, production build and whitespace checks passed.
- Notification, completion audio/review, session-runtime and staging regressions
  passed 127 tests, including stale-notice removal after worker replacement.
- A serial broad regression excluding `terminal-sessions.test.ts` completed
  1,814 tests: 1,801 passed, 13 existing platform skips, no failures.
  The known local terminal process-tree cleanup problem was not retested or
  declared fixed. The final notification-save rollback and fixture follow-ups
  were covered by the focused rerun and actual Electron acceptance.
- Shared CI inventory/policy/runner checks passed 24 tests with one existing
  platform skip. The new verifier is assigned to the shared interface group;
  this is not a cloud CI result.
- The production-main/preload/renderer notification verifier passed seven
  groups with isolated profiles and a local HTTP model. It checks defaults,
  persistence/reload, strict booleans, actual filesystem save-failure rollback,
  Chinese/light and English/dark/narrow layouts, keyboard focus bounds,
  independent sound, main/MiniChat de-duplication and foreground suppression,
  timed-out-notice click routing, tray restoration and draft retention.
  A real runtime write approval opens its source drawer without approving or
  creating the requested file. No renderer errors were recorded; fixture
  shutdown confirmed launcher exit code zero and no remaining windows.
- Existing real Electron task-progress, session-concurrency and
  session-navigation acceptance passed, including completion sound/animation,
  targeted abort, scoped approvals, draft recovery, reduced motion and narrow
  layouts. The two sound fixtures explicitly opt in to the new default-off
  setting rather than weakening their audio assertions.

Build, focused/broad logs and the final notification acceptance JSON/screenshots
are under
`D:\Desktop For Step Code\Desktop\release\notifications-mainline-source-20261109`.
Light/dark settings and the scoped approval screenshots were visually inspected.
The source build reuses the existing `plugin-workspaces-runtime` through a
junction without restaging it: commit `29eb4607`, Windows/x64, all 47
patched-source hashes, Node v24.16.0/SHA-256, 20 helper files and two current
helper bundles were checked against this branch before reuse. No upstream
runtime pin or source was changed.

Notification show/close and OS focus are controlled in the deterministic
verifier. It establishes application routing and policy, not visible native
banners, physical notification-center clicks, installer registration or native
macOS behavior. The optional native-smoke mode was not run for this integration.
Windows Do Not Disturb and notification settings remain respected.
No installer, release, shortcut change, real-account inference or cloud CI
acceptance is claimed; the owner's running app, profile and prior packages
remain untouched.

## Notification CI Fixture Follow-up (2026-11-09)

The first PR #226 cloud run failed both Windows and macOS sessions jobs at
`verify-mini-chat-electron.mjs:477`: the existing one-sound assertion waited
30 seconds, but its isolated profile had not opted into the new default-off
completion sound. The two aggregate checks failed because those jobs failed.
The MiniChat fixture now explicitly sets `completionSound: true`, matching the
concurrency and task-progress fixtures. Product defaults, sound de-duplication
assertions, deadlines and CI coverage are unchanged.

The local Windows rerun passed the full MiniChat verifier (nine local fixture
model requests, zero renderer errors, orderly shutdown), all seven notification
verifier groups, 14 notification/audio unit tests, and 24 CI runner/policy tests
with one existing platform skip. Evidence is under
`Desktop/test-results/mini-chat-native/` and `Desktop/test-results/notifications/`.
`git diff --check` passed. These source checks do not establish a cloud rerun,
macOS native behavior or packaged acceptance.

The Windows cloud rerun on `5276154` passed the sound assertion but later timed
out at the provider-refresh completion assertion. Its recorded reply was
`Completed Keep provider-refresh draftMINI-PROVIDER-REFRESH.` rather than the
exact expected new prompt. The replacement step now follows the existing
composer-editing verifier's keyboard select-all, delete and typing sequence
instead of relying on `fill()`'s DOM selection. Before sending, it checks the
ProseMirror value, rendered text, controlled empty state and persisted draft.
The exact completion assertion remains, with added checks for exactly one
request and its exact user text. No product code or timeout was changed.

Three consecutive full MiniChat source reruns passed locally, each with nine
local fixture model requests and no renderer errors. The composer-editing
verifier, 35 notification/audio/editor/shared-draft unit tests, and 24 CI
runner/policy tests also passed, with one existing platform skip in the latter.
The failed cloud log is retained at
`Desktop/test-results/notifications/ci-5276154-windows-sessions.log`.
These local results do not establish the new commit's cloud or macOS outcome.

## MiniChat Return Presentation Race (2026-11-09)

PR #226 on `281da75` passed all Windows groups and the macOS interface/runtime
groups, but macOS source sessions timed out at the MiniChat return reading-anchor
assertion. A delayed main-window snapshot reproduces the same failure locally:
the mini window transfers `follow: false` at scroll top 180, then the revealed
main view saves its old `follow: true` bottom position before reading the
transferred snapshot. This is a product race, not a deadline or tolerance issue.

The renderer now suspends presentation persistence while a requested
presentation-restoring snapshot is pending, releasing the guard on success or
failure. The Electron verifier holds that snapshot at the real IPC boundary,
dispatches old-view scroll/blur events, drains the IPC queue and checks that no
old presentation was written before releasing it. The original exact reading
anchor check remains. No fixed sleep, longer deadline or wider tolerance was
added.

The controlled regression fails against the prior production renderer with
old main-window bottom-position writes, and the complete MiniChat verifier
passes with the repaired production renderer. Typecheck, the isolated renderer
production build, 56 related unit tests and 24 CI policy/runner tests passed
(one existing platform skip in the latter). Diagnostics are under
`Desktop/test-results/notifications/`, including the original macOS log and
artifact, the delayed-snapshot reproduction, and the controlled before/after
logs. These local Windows checks do not establish macOS or packaged acceptance.

## Replacement Notice Pause Ordering (2026-11-09)

The next run on `8103bcd` passed every Windows group, but macOS source runtime
timed out at `verify-electron.mjs:995` waiting for the restored-session success
toast to disappear. The artifact confirms a stuck replacement toast, not the
internal hook ordering. The local timer-instrumented full native run passed.

A controlled real-React/browser regression establishes a compatible race:
deliver mouse-leave between the replacement commit and its passive effect,
while `:hover` still reflects the preceding pointer position. The old passive
effect overwrites that newer leave event and never starts a dismiss timer.
The regression fails on the old component. Sampling hover/focus during the
synchronous layout effect instead preserves subsequent leave/blur events;
the regression then passes, including ordinary hover, keyboard-focus and
actually-hovered replacement pauses and their resumed deadlines.

The new verifier belongs to the shared interface inventory on both platforms.
It uses the actual component and React lifecycle, with the Playwright clock
advancing deadlines and no stubs for component state or timer registration.
Existing success durations, pause caps and the original native
10-second assertion are unchanged. The original cloud log/artifact and local
timer/before/after logs are retained under `Desktop/test-results/notifications/`.
The corrected component verifier passed three consecutive reruns. The complete
native Electron/proposed-home verifier passed with the new production renderer,
as did typecheck, the renderer build and 24 CI runner/policy tests (one existing
platform skip). This establishes the controlled race and local fix, not a
completed macOS rerun or proof of the original cloud process's internal timing.

On `4e427b2`, Windows passed the original native Electron/proposed-home verifier,
then the added component verifier could not launch: the runtime job does not
install Playwright Chromium. Its assignment is corrected to the interface
group, which already provisions browsers for component fixtures. No browser
download step, product change or assertion change is required for this correction.

## MiniChat 交接验收时序（2026-11-09）

PR #228 的 Windows sessions 在裸 `/workflows` 的目录与详情互斥断言失败。
连续打开同一条工作流或子代理记录时，主窗口已有的相同内容不能证明新一轮
交接完成。验收现在先等待原生 MiniChat 窗口实际隐藏，再检查目标内容；
关闭详情后等待面板卸载，才进行下一次交接。仍保留目录不能误开详情、
重复交接不切错记录和零模型请求等原有断言，不修改产品逻辑或放宽超时。

本地 Windows 类型检查、生产构建、43 项相关测试和完整 MiniChat Electron
验收通过，包含原生最小化恢复、流式输出、审批与关闭退出。日志为
`Desktop/test-results/pr228-ci-native-fixed.log`。这不替代修复提交的云端、
macOS 或打包验收；未打包、改快捷方式或操作用户配置。

## MiniChat Minimize (2026-11-09)

The shared MiniChat header now invokes the existing sender-scoped native
Minimize action. Typecheck, build, 38 focused unit tests and browser MiniChat
acceptance pass, including retained editor identity, draft, reading position,
disclosures and streaming. Light/dark and narrow screenshots were inspected.
Native Windows assertions confirm that only MiniChat minimizes, its entry
restores the same window/runtime, and streaming continues.

The full native verifier did not pass: its later runtime-restart step reports
`Runtime process-tree termination failed (1)`, followed by a shutdown timeout.
Host CIM process queries also fail. Only this fixture's verified processes were
stopped. No package, shortcut, cloud or macOS acceptance is claimed.

## Performance PR Integration (2026-11-09)

The owner-accepted performance implementation is committed as `58fd3b7`, with
product-source hashes checked against the accepted package's frozen receipt.
Documentation and explicit CI inventory registration are the only allowed
differences at that checkpoint. The subsequent selection-fixture correction
uses a visible custom focus outline and settled paint; exact text, computed
color and screenshot assertions remain in force. All 24 cases pass three
consecutive runs on the installed Playwright Chromium.

Before integrating main, typecheck and production build pass. The complete
serial protocol suite has 1,583 passes, 13 platform skips and zero failures;
motion-helper browser tests have 15 passes. The initial missing runtime,
shared-dependency mismatch and absent browser failures are retained in the
evidence directory, not counted as successful runs.

The branch then integrates main `9e493ed`, preserving its MiniChat, shared
composer, plugin workspace and capability safety changes. A native navigation
check caught expanded cold-preview disclosures closing on presentation
restoration. The shared hook now adopts actual preview choices but still
restores saved state for untouched previews; dedicated open, close and
untouched cases pass alongside remount and explicit-reset coverage. Native
session navigation and MiniChat checks pass with the integrated renderer.
Integrated typecheck and production build pass; the complete serial protocol
suite records 1,930 passes, 13 platform skips and zero failures. CI policy and
acceptance inventory tests record 40 passes and one platform skip.

The final local integration pass completes thirteen checks: native session
navigation, MiniChat, chat quotes, BTW, stream motion, summary resize,
conversation scrolling, viewport code highlighting, streaming Markdown,
selection inheritance, sidebar interaction, panel gestures and the complete
long-session interaction fixture. Typecheck and all seventeen shared-composer
tests pass again. The quote failure fixture now rejects through native
submission ownership so real receipt rollback restores input; the long-session
fixture supplies the current plugin catalog bridge. Neither correction changes
product behavior or removes assertions. Initial failed runs remain in the
evidence directory. Light/dark desktop and narrow highlighter captures are
produced; the dark narrow capture is inspected.

The first cloud Windows interface run completes every update-installer UI
assertion but times out during Electron shutdown. The fixture now waits for
the native first-run renderer and its startup snapshot before creating the
separate test window, uses bounded orderly shutdown, and reports acceptance
only after closure. No UI assertion or product behavior changes. Five normal
local runs and an instrumented five-second native-renderer load delay pass,
along with all 24 readiness/shutdown regressions and Desktop typecheck.
This addresses a fixture startup/shutdown race risk; the original cloud
timeout does not establish its exact cause. Replacement cloud checks remain
required.

The replacement Windows run confirms update UI acceptance, including orderly
shutdown, in 3.486 seconds. It then exposes an immediate capability-search
assertion reading the retained plugin view before the navigation effect applies
its filter. The fixture now awaits the exact expected filter without removing
the equality assertion. A local run also catches commands reading the retired
runtime after restart; all six restart checks now await a different runtime ID
in the connected state before inspecting commands or MCP state. The complete
native capability acceptance, 43 focused regressions and typecheck pass locally.
The latest full local protocol run records 1,931 passes and 13 platform skips
before the new restart-readiness regression is added. No product source changes,
model requests, skipped assertions or relaxed timeouts are introduced.

The next Windows sessions run exposes a MiniChat reading-handoff race. A
500 ms delayed main-window snapshot reproduces the failure locally: the mini
window transfers its historical anchor at scrollTop 180, but a main-window
scroll persistence event overwrites it with the old tail at scrollTop 6938.
The renderer now suspends presentation persistence during handoff reads and
until the restored position has been applied to layout. Four production-closure
regressions cover delayed reads, overlapping reads, failure recovery and ordinary
refreshes; all 62 focused layout/navigation/readiness/shutdown tests pass.
Typecheck and build pass; the complete serial protocol suite records 1,936 passes,
13 platform skips and zero failures. The delayed complete native MiniChat check
passes twice with its original 4 px anchor tolerance; native navigation and
conversation scrolling also pass. CI policy/runner tests record 30 passes and
one platform skip. The preceding cloud Windows interface and runtime groups
pass, confirming both earlier fixture repairs. Windows failure screenshot
collection now includes nested fixture directories so native MiniChat failures
retain their screenshots. Replacement cloud checks remain required.

Cloud Windows CI then passes all three groups. macOS sessions passes both its
source and packaged inventories, including the delayed MiniChat handoff.
macOS interface reaches file-preview acceptance but its native restart meets a
transient session-operation refusal immediately after renderer reload. The
fixture now waits only for that specific refused preflight, verifies that the
original runtime still exists after each refusal, and fails immediately on any
other error or changed identity. Its deadline and the old-RPC-process-exit
assertion are preserved. Four focused regressions cover refusal, identity,
deadline and the retained native assertion. The browser-refresh wait also uses
the existing awaited browser-state poller rather than an async browser predicate.
All 33 focused tests and typecheck pass; normal native file preview passes.
Temporarily enabling the native restart branch on Windows also passes, including
actual old-child exit; the platform condition is restored before commit.
This does not substitute for replacement macOS source/package checks.
The preceding macOS runtime job never receives a hosted runner and is cancelled
with explicit ARM64 capacity annotations; it executes no test.
The complete local serial protocol rerun then records 1,940 passes, 13 platform
skips and zero failures before integration with main `4308435`. This main update
adds global instructions and its lifecycle acceptance; both lines' TODO entries
and verification histories are retained. Integrated typecheck/build and CI
inventory/policy checks pass (40 passes, one platform skip). Native global
instructions, file preview, MiniChat and session navigation pass with isolated
profiles; MiniChat retains its historical anchor under the 500 ms snapshot delay.
The integrated complete serial protocol run records 1,949 passes, 13 platform
skips and zero failures (1,962 tests).
Replacement cloud Windows/macOS acceptance remains required.

The integrated Windows sessions group passes. Its runtime group reaches
workflow persistence, but the first planned application relaunch reports a
disconnected startup and times out. The original verifier passes locally, so
that startup failure's exact cause is not established. The verifier had used
`app.exit(0)` for a normal relaunch, bypassing orderly native cleanup. Planned
relaunch and final cleanup now use the existing bounded fixture close helper;
the separate forced-tree-crash recovery case and every workflow assertion remain.
A source regression pins both orderly close sites and the real forced crash.
Lifecycle failures now retain a screenshot and only allowlisted, sanitized
CrashLog fields, not child stderr or configuration contents. All 30 focused
readiness/shutdown regressions and typecheck pass; the complete native workflow
verifier passes three consecutive runs with the new orderly close. Replacement
cloud acceptance is still required.

Both Windows and macOS cloud workflows then pass on `533d65d`, including all
three Windows groups, all macOS source/package groups and both final gates.
Main advances during that run with MiniChat Minimize PR #228 (`12d054e`).
Its native minimize and handoff-readiness changes are retained alongside the
delayed presentation guard; only the verification history conflicts.
Those passing cloud runs remain evidence for `533d65d`, not the subsequent
integrated head. Integrated typecheck/build, 82 focused regressions and the
complete native and browser MiniChat verifiers pass. Native verification retains
the delayed historical anchor while also checking minimize/restore, streaming
and repeated workflow/subagent handoffs. Replacement cloud checks remain required
for this integrated head.

2026-11-10 复核确认 `85198e6` 的 Windows 和 macOS 云端门禁均已通过。
此时 main 已推进到 `5beaa5d`，再次产生七个冲突文件。集成保留新版
CI 调度、插件 Host 启动与环境隔离、通知入口、主题组合，以及已验收的
性能实现。MiniChat 同时保留 Host presentation revision 校验、前端交接保护、
布局恢复前禁止持久化和 500 ms 延迟快照原生回归；更新安装器同时保留
首屏就绪等待与正常退出码断言。

集成后的类型检查、生产构建和 52 项相关回归通过；CI 策略与调度回归
为 66 项通过、1 项平台跳过。运行时从与当前 manifest 全部 53 项源文件
哈希匹配的隔离源码重新暂存，钉点仍为 `29eb460`。完整协议测试、
原生窗口验收与新提交的云端门禁尚待完成，不能复用旧提交的绿灯。
本轮不打安装包、不改快捷方式，也不合并 PR 或操作用户配置。

本地六项原生验收随后通过：MiniChat、会话导航、更新安装器、文件预览、
通知和插件 Host 授权。首次完整协议回归在 `session-fixture.test.ts`
发现旧测试只接受 `finally` 第一层直接关闭调用，而新 main 将关闭及
退出码检查包在诊断 `try` 中。该测试改为执行真实清理块，检查确实等待
异步关闭、拒绝未退出或非零退出码，并保留关闭异常。46 项相关回归通过；
完整协议回归与修复后提交的云端门禁仍需重跑，前次失败日志保留。

`91b13d1` 的本地完整协议回归随后完成：224 个文件、2,129 项通过、
14 项平台跳过，零失败；同一提交的 Windows 三组与最终门禁均通过。
macOS run `42806256203` 的构建、协议测试通过，但两个验收组尚未取得
runner 就因 ARM64 容量不足取消；interface 组另在侧栏重定位验收中被
`Session operation in progress` 拒绝，不能将整轮归为基础设施失败。

侧栏验收现等待原 runtime 的拒绝前置检查收尾：只有目录对话框尚未打开、
计数有效且 runtime 身份未变时才重试；对话框后失败、其他错误、身份变化
和超时均保留失败，取消对话框也不会重试。不修改产品代码或延长原时限，
保留重定位、会话身份、历史、取消与缺失目录恢复断言。新增五项回归覆盖
这些边界，63 项相关回归和类型检查通过，完整 Windows 原生侧栏验收
连续两次通过。日志为 `ci-macos-sidebar-readiness-r{1,2}.log`，但不替代
修复后提交的 macOS 原生和打包版云端验收。

This source combination has its own verification logs under
`D:\Desktop Runtime Builds\performance-pr-20261109`. It does not replace the
fourteen-check package or owner-experience evidence below. No new installer,
shortcut change, owner application restart, package cleanup, runtime pin
upgrade, merge or release is performed. Cloud checks and macOS acceptance
are not inferred from these local Windows results.

## Performance Baseline Accepted (2026-11-09)

After the new Windows package handoff below, the owner confirms a noticeable
speed improvement and asks to adopt this round as the formal performance
baseline, leaving further optimization for later. Record the implemented
performance work, fourteen packaged checks and owner-experience acceptance as
complete; stop adding changes to this baseline.

The accepted artifact is `selection-style-20261109-preview`, from performance
branch `e419143` plus the frozen uncommitted changes. Executable and installer
hashes are rechecked against the existing receipts and still match. At that
acceptance checkpoint the source remained uncommitted; PR, cloud checks, merge
and release are not implied by the owner's acceptance. No version bump, retag,
install, restart or package cleanup
is performed. Deeper first-mount/layout work is a separate unscheduled TODO,
not a blocker for the accepted implementation.

The handoff's original receipts and timing limits remain historical evidence.
No exact production-history latency or universal speedup is inferred from the
owner's experience, and unrelated real-account/installer/macOS gates remain open.

## Native Selection Windows Preview (2026-11-09)

The new Windows x64 preview at
`D:\Desktop For Step Code\Desktop\release\selection-style-20261109-preview`
includes the native selection inheritance follow-up below and the preceding
cold-loading changes. It uses performance branch `e419143` plus its uncommitted
changes, not latest main. All 1,187 frozen source files and 1,538 packaged
build/resource files are verified; the measured renderer/Worker hashes match.
The v0.1.7 runtime pin remains `29eb460780489801ce8afc8bffc1a2efae7cbded`.
Executable and installer Authenticode status is `NotSigned`; the installer is
not executed.

All fourteen packaged checks pass with isolated profiles and the actual new
executable: heavy-history opening, bundled Worker parity/fallback/cancellation,
summary-resize, stream-motion, conversation-scroll, session-concurrency,
plan-review, terminal-panel, general Electron, session-navigation,
navigation-performance, native fulltext search, native BTW and chat quotes.
The packaged native-selection comparison preserves 12,514 selected characters,
206 sampled nodes and their computed colors when restoring the previous
conversation selection rules. The first attempt incorrectly included xterm's
unrelated accessibility selection rule; the driver now checks the six minified
conversation/composer/Stellar rules explicitly. Initial failure evidence is
retained. No product change or relaxed content assertion was needed.

The final single packaged Stellar sample retains all 360 articles, 2,160 full
code blocks, matching first/middle/last source and actual scroll height
1,586,835 pixels. Cold first/full-history DOM detection is 4061.3/4299.1 ms
and execution readiness is 4930.5 ms; resident full-DOM/readiness is
3488.5/3904.6 ms. Trusted input and wheel movement pass. Cold cumulative
script/style/layout is 1890.7/888.4/946.7 ms, with a 2712 ms longest task.
These overlapping counters are not disjoint wall-clock phases. This single
sample is not a matched median, compositor-confirmed paint or owner-history
acceptance; it does not replace the six source comparison runs below.
At that handoff checkpoint, owner acceptance was pending. It is now recorded
above; integration and deferred optimization have separate TODO entries.

Inspected captures include the heavy Stellar transcript, Worker navigation,
dark narrow session navigation/search and main/BTW quotes. All seventeen
successful packaged launches have exited without leaving fixture processes.
Receipts, hashes, initial/repeat logs and captures are in the package directory;
the frozen source and packaging drivers are under
`D:\Desktop Runtime Builds\selection-style-package-20261109`.

The primary desktop shortcut is backed up and updated to this package.
Readback verifies target, working directory and icon while preserving arguments,
hotkey, window style and description. At handoff the owner was still running the
preceding cold-loading package; it was not stopped or restarted. No old package is deleted,
and no installer lifecycle, cloud CI, macOS, real-account acceptance, commit or
push is included.

## Native Selection Style Follow-Up (2026-11-09)

This source verification preceded the new package handoff above. It replaces
descendant-universal native selection styles with highlight inheritance while
preserving the existing light/dark/Stellar colors and semantic code/table/error
overrides. No transcript nodes, source text, scroll heights, loading gates,
runtime pins, credentials or session data change.

Typecheck, production build and 194 focused unit tests pass. Eleven UI checks
also pass: native selection inheritance, conversation scroll, session navigation,
stream motion, summary resize, native fulltext search, annotations, BTW, viewport
syntax highlighting, long-session interaction and Stellar chrome. The new
selection check compares selected text, descendant computed colors and screenshot
bytes with the preceding rules in 24 cases across three themes and desktop/narrow
widths; every comparison is identical. Inspected captures include light desktop
and Stellar narrow native selections. Existing checks retain search location,
copy/quote, annotation ownership, actual scrolling, focus, reduced motion and
message/source identity assertions.

Six serial alternating-order Electron runs use isolated profiles and identical
180-turn / 1,440-message histories. All retain 360 articles, 2,160 complete code
blocks, matching first/middle/last code and real scroll height 1,586,835 pixels;
draft input, trusted wheel movement and normal fixture shutdown pass.
Cold full-history DOM detection medians are 3511.4 -> 2995.3 ms; cumulative style
898.8 -> 524.1 ms; longest task 2129 -> 1652 ms. Resident full-DOM detection is
2657.1 -> 2449.2 ms. This does not prove compositor paint, real-account behavior
or acceptance on the owner's 5-10-second history. Script cost does not improve
and multi-second blocking remains; the performance TODO stays open.

The measured renderer/Worker asset hashes remain unchanged through regression
checks. Evidence, immutable source/build snapshots, matched reports, screenshots,
verification logs and a final source receipt are under
`D:\Desktop Runtime Builds\selection-inheritance-20261109`.
Rejected 12/48-article progressive-mount experiments are isolated under
`D:\Desktop Runtime Builds\history-batching-20261109`, not in product source:
they improve input responsiveness but delay complete history.

To rerun the focused native selection comparison from `Desktop/`:

```powershell
$env:DESKTOP_BROWSER_CHANNEL = 'msedge'
node scripts/verify-selection-inheritance.mjs
```

At that source-only checkpoint, the existing package and shortcut were unchanged.
The later packaging and shortcut handoff are recorded above; install, commit,
push, cloud CI, macOS and owner-history acceptance remain separate.

## Cold-Loading Windows Preview (2026-11-09)

The Windows x64 acceptance package at
`D:\Desktop For Step Code\Desktop\release\cold-loading-20261109-preview`
contains the verified performance branch `e419143` plus its uncommitted
changes, including all cold-loading follow-ups below. It is not latest main.
The v0.1.7 runtime pin remains `29eb460780489801ce8afc8bffc1a2efae7cbded`.
The 1,186-file source snapshot, measured renderer/Worker assets and 1,538
packaged build/resource files are checked against their hashes. Runtime
patch metadata, Node, native terminal resources, installer SHA-256 and update
metadata are verified; the installer is unsigned and is not executed.

Fourteen packaged checks pass in isolated profiles: heavy-history opening,
bundled Worker parity/fallback/cancellation, summary-resize, stream-motion,
conversation-scroll, session-concurrency, plan-review, terminal-panel,
general Electron, session-navigation, navigation-performance, native fulltext
search, native BTW and chat quotes. Every launch records the actual packaged
executable and isolated profile. Screenshots include Stellar heavy history,
dark narrow navigation, search location and main/side quotes and annotations.

One packaged 180-turn, 1,440-message, 5,495,514-byte Stellar sample retains
360 articles, 2,160 complete code blocks, matching first/middle/last code
source and the actual 1,586,835-pixel scroll height. Cold first/last body
DOM detection is 3412.4/3606.9 ms; execution readiness is 3610.7 ms.
Resident last-body DOM detection/readiness is 2725.7/3054.5 ms. Trusted
draft input and wheel movement pass. Cold cumulative script/style/layout
measurements are 1291.7/818.8/786.1 ms; these are not disjoint wall-clock
phases and must not be added. Cold/resident longest tasks remain
2113/2699 ms. This single package sample is not a median, confirmed paint
or acceptance on the owner's 5-10-second history. The performance TODO
remains open.

Evidence is in the package's `source-receipt.json`, `package-integrity.json`,
`package-acceptance.json`, `packaged-heavy-opening.json`, screenshots and
`handoff-summary.json`; packaging drivers and the frozen source are under
`D:\Desktop Runtime Builds\cold-loading-package-20261109`.
The first build driver rejected a copied old-path assertion before packaging;
the corrected attempt passes. The initial acceptance supervisor omitted the
terminal verifier's successful native-quit completion because it observed
only `app.close()`. The driver now records both native controller closure
and launcher exit; the unchanged terminal check passes again. Initial logs
are retained and are not counted as successful aggregate runs.

Primary shortcut backup/readback is recorded separately in
`shortcut-handoff.json`; no owner application is closed or restarted.
No old package is deleted. This is not an installer lifecycle, cloud CI,
macOS, real-account or owner-history acceptance, and no commit or push is
included. Earlier source-only sections describe their historical boundary;
their cold-loading changes are now included in this new preview.

## Idle Custom Highlight Styles (2026-11-09)

This source-only follow-up activates each of the five search/annotation custom
highlight styles only while its named ranges are nonempty. The shared helper
keeps document attributes and `CSS.highlights` registrations synchronized,
preserves priority/combined main-and-BTW ranges and protects a replacement
registration from stale cleanup. Unmatched searches keep the existing location
fallback without registering an empty highlight. Colors, native selection,
Markdown, source text and real transcript geometry are unchanged.

Final isolated Windows checks pass:

- Typecheck, production build and 194 focused unit tests, including named
  highlight activation/cleanup, stale owners, empty ranges, priority and
  unsupported-API fallback, plus the previous Markdown/layout/quote/scroll
  checks and fulltext unit coverage.
- Nine Electron checks: bundled Worker parity/fallback/cancellation,
  conversation-scroll, turn-artifacts, session-navigation, stream-motion,
  summary-resize, session-concurrency, plan-review and native fulltext search.
- Five browser checks: annotations, BTW, viewport syntax highlighting,
  long-session interaction and Stellar chrome. Search checks verify actual
  highlight color and scope activation, no-match deactivation and dismissal.
  Annotation checks cover selection/marks/focus, final-range cleanup,
  Chinese/English and light/dark desktop/narrow layouts. BTW checks retain
  both owners' ranges and keep main styles active when the side panel closes.
  Existing selection/copy, source identity, navigation, motion, focus and
  reduced-motion assertions remain enabled.
- Six serial alternating-order matched runs exit normally, retaining every
  article/code block, identical sampled source and actual scroll height,
  trusted draft input and wheel movement. The final regression renderer and
  Worker asset hashes exactly match those used for measurement.
- Visual inspection includes Stellar heavy history, narrow light annotation
  entry, narrow dark search location and simultaneous main/BTW annotations.
  `git diff --check` passes.

Cold first-body DOM medians change 4021.2 to 3265.2 ms; last-answer DOM changes
4228.1 to 3462.4 ms, about 18%. Style calculation changes 1501.2 to 783.6 ms,
about 48%. Cold longest-task medians remain 2799/2089 ms, with maximum renderer
probe delays 3058.1/2255.9 ms. Resident readiness changes 4082.6 to 3133.4 ms,
but its longest-task median still reaches 2796 ms. Full ranges and limitations
are in `RENDERER_PERFORMANCE.md`. DOM/animation-frame observations do not
establish compositor-confirmed paint or usability on the owner's history;
the performance TODO remains open.

Failed setup/cleanup attempts are retained rather than counted as passes.
The first copied Worker verifier referenced an old receipt filename; its
input now comes from this run's isolated corpus. The initial stream-motion
check completed every content/animation assertion but timed out on direct
`app.close()`. That verifier now restores its original IPC handler after
simulating events and uses the existing orderly-close helper, including
launcher-exit confirmation. Its repeat passes without weakening assertions
or changing product quit behavior. The failed isolated process tree was
verified before stopping it. Two exploratory profiling runs also timed out
during cleanup; they are excluded from the six matched successes.

Evidence: `D:\Desktop Runtime Builds\cold-layout-20261109`, including raw
selector/CPU diagnostics, matched receipts/ranges, initial/final verification
logs, screenshots and source/build hashes. The artifact inventory excludes
runtime/dependency/baseline junctions. No artifact is deleted.
No package, shortcut update, installer execution, owner-app restart, commit
or push is included. The delivered twelfth-pass package is unchanged and
contains none of the cold-loading follow-ups. Full unit-suite, cloud CI,
macOS, active-highlight timing and real-account acceptance remain separate.

## Repeated Artifact Parsing And Scroll Metrics (2026-11-09)

This source-only follow-up starts from the preceding verified Worker candidate.
Output attachment inference skips a second Markdown parse only for sources
that definitely contain no supported artifact or local preview. Existing kind,
URL, Markdown, output-path, platform and access rules remain authoritative.
Encoded/escaped destinations, reference links, every supported extension and
normalized numeric/IPv6 loopback previews retain the original parsing path.

The scrollbar uses one captured metric set for geometry and ARIA percentage,
without rereading layout during React rendering. Identical measurements keep
their state identity. Initial measurement, scroll tracking and keyboard/pointer
controls are not delayed. A frame-scheduled initial-measurement experiment was
rejected because it relocated layout work without a clear cold-load benefit.

Final isolated Windows source checks pass:

- Typecheck, production build and 177 focused units, including artifact
  inference, scroll geometry/percentage, navigation, scrolling, layout,
  Markdown preparation/math/highlight/reveal, quotes, revisions and themes.
- Eight native Electron checks: bundled Worker parity/fallback/cancellation,
  conversation-scroll, turn-artifacts, session-navigation, stream-motion,
  summary-resize, session-concurrency and plan-review.
- The scroll acceptance now checks real thumb position and ARIA percentage
  against actual viewport geometry after reading/following scenarios, including
  hidden/tabindex state without overflow. Existing pointer, keyboard, wheel,
  marker, animated-disclosure, nested-output and reduced-motion gates remain.
- Four browser checks: full annotations fixture, viewport highlighting,
  long-session interaction and Stellar chrome. Existing selection/copy/quote,
  navigation, drag cleanup, focus and light/dark/narrow gates remain intact.
- Six successful serial alternating-order matched runs retain all 360 articles,
  2,160 complete code blocks, matching sampled source and actual scroll height,
  trusted draft input and post-open wheel movement.

Cold first-body DOM medians change 4632.1 to 4015.1 ms; last-answer DOM changes
4855.7 to 4220.6 ms. Renderer script changes 1793.4 to 1283.1 ms, but style and
layout do not improve. Maximum probe delay remains 3563.1/2980.3 ms.
Resident readiness changes 4533.2 to 4119.9 ms, with overlapping ranges.
These are local synthetic DOM observations, not compositor-confirmed paint,
owner-history timings or a guarantee of usable transcript latency. About three
seconds of continuous blocking remain; the performance TODO stays open.
Full phase/range details are in `RENDERER_PERFORMANCE.md`.

The first focused run exposed two exact-shape assertions that had not included
the new percentage field; their expected values now explicitly test it while
retaining the original geometry assertions. Initial failure logs are preserved.
One rejected scroll-scheduling exploratory run completed its content checks
but timed out during orderly shutdown after 60 seconds. Only its verified
isolated test process tree was stopped. It is not counted as passed and no
shutdown fix is claimed; all six matched runs and final native checks exit
successfully through their existing shutdown paths.

Evidence: `D:\Desktop Runtime Builds\cold-render-20261109`, including
`matched-receipts.json`, raw samples/ranges, initial/final verification logs,
screenshots and source/build hash receipts. The measured renderer/Worker
hashes match the final tested build; only TODO/performance/verification
documentation differs from the final source snapshot.
No package, shortcut change, installer execution, owner-app restart, artifact
deletion, commit or push is included. The delivered twelfth-pass package remains
unchanged and contains none of these cold-loading follow-ups. Full unit-suite,
cloud CI, macOS and real-account acceptance remain separate.

## Background Markdown Preparation (2026-11-09)

Eligible cold-history Markdown now uses bounded renderer-Worker preparation
in parallel with runtime startup, retaining the complete source, parser
positions and existing react-markdown transforms/components. The current-session
map is exact-text keyed. Cached readings skip preparation; cancellation, failure,
unsupported Workers and a five-second deadline retain the original synchronous
fallback. Execution readiness still requires the authoritative runtime snapshot.
The runtime pin, approvals, credentials and owner profile are unchanged.

Final source checks pass:

- Typecheck and production build; 156 focused units cover Markdown preparation,
  block reuse, math, highlight/reveal, quotes, viewport scheduling, message
  revisions, navigation/layout, render cache and theme behavior.
- The actual bundled Worker runs in isolated Electron, with exact MDAST parity
  for entities, GFM/references/footnotes and math. It terminates after success,
  falls back when Worker construction is blocked, and cannot install old history
  after a superseding navigation. Unit cases include parser nonmutation,
  bounded work, malformed replies, errors, timeout and cancellation.
- Seven native Electron regressions pass: session-navigation,
  conversation-scroll, stream-motion, summary-resize, session-concurrency,
  plan-review and the dedicated Worker check. Concurrency retains background
  streams, targeted abort, scoped approvals and drafts across worker recycling.
  Plan review retains expiry, stale-snapshot protection and fresh-review reentry.
- Four browser checks pass: the full annotations fixture, viewport highlighting,
  long-session interaction and Stellar chrome, retaining their light/dark/narrow,
  reduced-motion, focus, selection, copy/quote and historical-navigation gates.
- Three serial alternating-order measured runs per side use new isolated
  profiles, identical heavy histories and Stellar motion. Every heavy sample
  retains 360 articles, 2,160 complete code blocks, original source, draft text
  and actual trusted-wheel movement.

Cold last-answer DOM medians change 4161.2 to 4478.8 ms, slightly slower.
Execution-wait clearance is 4776.3/4482.0 ms; renderer script is
2401.9/1646.3 ms. The input request queued around 200 ms after clicking waits
4306.8/11.0 ms additionally, not 11 ms from clicking to a ready conversation.
Maximum renderer-probe delay remains 4170.1/3319.8 ms, and resident readiness
is unchanged at 4170.4/4171.9 ms. **Cold-body usability is not resolved.**
Complete mounting, transforms and layout still block for seconds. These local
synthetic results are not paint confirmation, owner-history timing or a universal
speed-up claim. Details are in `RENDERER_PERFORMANCE.md`.

Evidence: `D:\Desktop Runtime Builds\cold-mount-20261109`. The source manifest
and `handoff-summary.json` bind implementation/build hashes, per-check logs,
six matched receipts and a junction-excluding artifact inventory. Only the three
performance/TODO/verification documents differ from the tested source snapshot.
No new package, shortcut update, installer execution, owner-app restart, artifact
deletion, commit or push is included. The delivered twelfth-pass package contains
neither this Worker change nor the preceding cold-loading follow-up. Full unit
suite, cloud CI, macOS and real-account acceptance remain unconfirmed.

## Heavy-First Cold Loading Follow-Up (2026-11-09)

Owner feedback still reports 5-10 seconds or more before the first long
conversation feels usable. Earlier nonresident-heavy measurements opened a
short conversation first; they did not establish first-conversation latency
in a fresh application. This follow-up opens heavy, short, then resident heavy,
using isolated synthetic profiles without reading owner histories or settings.

Empty `QuoteAnnotations` overlays now skip viewport measurements, layout
observers and pointer hit tests. Nonempty annotations retain existing behavior.
Stellar activity colors are localized to the composer pseudo-element instead
of changing an inherited root variable across the complete transcript.
The same colors, indicators, theme motion, original text and real heights remain.

Three serial alternating-order native source Electron runs per side compare
the delivered twelfth-pass source and this follow-up with Stellar motion on:

| Median Phase | Twelfth Pass | Follow-Up |
| --- | ---: | ---: |
| First heavy: last answer detected in DOM | 4279.4 ms | 4144.1 ms |
| First heavy: execution-wait indicator cleared | 6263.5 ms | 4700.6 ms |
| First heavy: early input acknowledgement wait | 5796.7 ms | 4255.2 ms |
| First heavy: cumulative style calculation | 2795.1 ms | 1365.7 ms |
| Four post-load activity changes: style calculation | 4314.2 ms | 18.0 ms |

All samples retain the same 5,495,514-byte history, 360 articles and 2,160
complete code blocks, an editable draft and trusted-wheel movement. First-body
DOM detection remains 4081.4/3946.5 ms: cold loading is not resolved.
These DOM/input observations are not compositor-confirmed paint, owner-history
measurements or a general loading-time bound. Full Markdown/React mounting and
initial layout remain the next investigation, not a completed optimization.

Final local checks pass: typecheck, production build, 116 focused units,
the complete annotations browser fixture, Stellar chrome, viewport highlighting
and native Electron session navigation. The annotations fixture verifies zero
empty-layer viewport reads and cleanup after the final annotation, retaining
editing, hover, highlighting and copy/quote checks. Two stale verifier assumptions
were corrected: a removed CSS Highlight counts as empty, and the settings button
uses its current `.sidebar-settings` selector. Neither change relaxes UI behavior.

Evidence: `D:\Desktop Runtime Builds\cold-navigation-20261109`, including six
matched receipts, `matched-summary.json`, `verification.json` and per-check logs.
The source-only follow-up is not in the delivered twelfth-pass package.
No new package, shortcut update, owner-app restart, artifact deletion, commit
or push is included. Full-suite, cloud, macOS and real-account acceptance remain
unconfirmed; the performance TODO stays open.

## Viewport-First Code Highlighting (2026-11-09)

The twelfth local performance pass displays complete fenced-code source first
and adds syntax tokens near the viewport using the same shared highlighter.
It keeps every message, original code, real height and existing copy control.
No Worker, row virtualization, parser replacement, runtime pin/startup change or
execution/approval-gate relaxation is included. Search/annotation Range objects
are retained; native selection and pointer dragging postpone token insertion.

Local verification on the final source:

- Typecheck and production build pass. 189 focused unit tests pass across
  navigation, scroll/layout, presentation/render-cache, timing, artifacts,
  patches, Markdown/math/highlight/reveal, questions and viewport scheduling.
  The full unit suite is not run.
- Five isolated source Electron checks pass: session-navigation,
  conversation-scroll, stream-motion, summary-resize and turn-artifacts.
  The shared disclosure-summary browser fixture also passes.
- Four actual-production-component browser checks pass in Edge 157.0.4341.42:
  viewport-highlight, long-session-interaction, sidebar-interaction and
  streaming-markdown. Existing light/dark/narrow, reduced-motion, streamed reveal,
  authoritative replacement and navigation tests remain active.
- The new coloring fixture retains 360 articles and 180 complete code blocks;
  just one block is initially colored using one shared observer. Offscreen copy
  works before coloring. The same code node retains its source and exact
  820 x 136.3125 px block geometry after coloring. Native selection remains intact
  until Quote is used; the saved CSS Highlight Range still selects `chosen` on
  connected nodes afterward. Stale queued source cannot overwrite a new answer.
- Fourteen browser cases compare exact token markup for complete/partial code,
  unknown/text languages and escaped Unicode/HTML-like text. Unit cases also
  exercise additional grammars and explicit highlight opt-outs. The streaming
  structural comparison unwraps only code-token spans and the diagnostic
  attribute, since coloring is intentionally viewport-dependent; exact token
  parity is checked separately, not discarded.
- All verify scripts remain explicitly inventoried. The new visual/stress fixture
  is local-only alongside the existing long-session fixtures; deterministic
  highlighting/scheduler tests are in the normal unit suite. Four root CI policy
  suites report 30 passed, one platform-specific skip and no failures. They run
  from the hash-matched Git worktree: an initial snapshot-only attempt cannot
  satisfy their Git-identity precondition because the snapshot has no `.git`.
- Six serial alternating-order real source Electron measurements pass, using the
  same 5,495,514-byte heavy histories, runtime and dependencies as the eleventh
  pass. Every heavy sample retains 360 articles and 2,160 code blocks, code-source
  samples, an editable draft and actual post-open trusted-wheel movement.

Cold last-answer DOM medians change from 6186.1 to 3948.8 ms, renderer script
from 3729.0 to 2492.2 ms, and early input wait from 6057.1 to 3712.1 ms.
Initial descendants change from 204480 to 103007 because only 47 of the original
101520 syntax-token spans are initially needed; source text and rows are not
removed. The following-frame opportunity is 6816.0/4352.0 ms, not confirmed paint.
Resident DOM medians are 5818.9/3456.4 ms. See `RENDERER_PERFORMANCE.md` for
ranges, post-open wheel results and limitations. Multi-second waits remain;
these code-heavy local results do not establish the owner's real-history latency
or a universal five-second upper bound.

Evidence root: `D:\Desktop Runtime Builds\viewport-highlight-20261109`.
`verified-build-*`, `verified-correctness-*`, `verified-matched-*`, source
manifests, `matched-summary.json` and the new browser receipt retain the results.
`final-receipt.json` binds the final source hashes, changed-file allowlist,
policy results and a junction-excluding artifact inventory.

At the source-only checkpoint, no owner history/profile/account or live
application was changed, and the runtime junction was not restaged. Packaging
and shortcut handoff were not part of that checkpoint; the subsequent Windows
delivery is recorded below. The performance TODO remains open.

### Windows Preview Package

The owner requested a combined acceptance package on 2026-11-09. Output:
`D:\Desktop For Step Code\Desktop\release\performance-twelve-20261109-preview`.
It contains the twelve local performance passes, including the previously
unpackaged tenth/eleventh passes, from branch
`codex/long-session-interaction-performance`, base `e419143435dcbc8e1519085a1c60e7054e24144d`
plus the recorded uncommitted changes. This is not a latest-main or release build.
Desktop remains 0.6.0; runtime remains v0.1.7
`29eb460780489801ce8afc8bffc1a2efae7cbded`.

- `DFSC.Performance.Twelve.e419143.Setup.0.6.0.exe` is 149,044,975 bytes.
  `SHA256SUMS.txt`, `package-integrity.json` and `source-receipt.json` record its
  hash, all 1,178 source input hashes, runtime patch/Node hashes and metadata.
  All 1,537 checked construction/runtime resources match; no junction ships.
  Windows reports the installer as unsigned; no installer is executed.
- Ten packaged checks pass using isolated test profiles: summary-resize,
  stream-motion, conversation-scroll, session-concurrency, plan-review,
  terminal-panel, electron, session-navigation, session-navigation-performance
  and the heavy-history opening profiler. The latter retains all 360 articles
  and 2,160 code blocks, limits initial token coloring, retains the typed draft
  and verifies trusted-wheel movement. It is not a new matched speed-up claim.
- The existing primary `Desktop for Step Code.lnk` is backed up under
  `shortcut-backup`, then its target, working directory and icon are updated and
  read back. Arguments, hotkey, window style and description are preserved.
  The ninth-pass owner process remains running; updating the shortcut does not
  switch an existing single-instance app. The owner must explicitly quit it to
  try the new build. No owner profile/account/configuration is changed.
- `package-acceptance.json`, `packaged-heavy-opening.json`, screenshots,
  `acceptance-evidence`, `shortcut-handoff.json` and `handoff-summary.json` retain
  the evidence. Post-build edits are limited to these verification/performance
  notes and TODO; implementation bytes remain bound to the frozen build snapshot.
  Large artifacts are inventoried without traversing dependency/runtime
  junctions; no old package or other artifact is deleted.

Real-account/model acceptance, the owner's real-history experience, installer
upgrade/lifecycle, macOS and cloud CI remain unconfirmed. No commit, push or PR
is included in this package request.

## Tool-Heavy Opening Stalls (2026-11-09)

The eleventh local performance pass batches the main transcript's child layout
notifications and memoizes unchanged `TurnArtifacts` candidate parsing. It does
not upgrade runtime v0.1.7 `29eb460780489801ce8afc8bffc1a2efae7cbded`, hide or
virtualize transcript rows, alter Markdown/highlight/URL policy, or relax
authoritative execution, approval and preview gates. Parent layout effects and
resize observers remain immediate; explicit scrolling and unmount cancel pending
child notifications.

Local verification:

- Typecheck and production build pass. 173 focused unit tests pass across
  navigation, layout/scroll, presentation/render-cache, timing, artifacts,
  patches, Markdown/highlight/reveal and questions. The full unit suite is not run.
- Five isolated source Electron checks pass: session-navigation,
  conversation-scroll, stream-motion, summary-resize and turn-artifacts.
  Existing exact DOM/selection/caret handoff, stale-target, runtime recycling,
  authoritative changed-answer, action/approval and error gates remain in force.
- The production actual-App long-session and sidebar browser checks pass in Edge,
  alongside the shared disclosure-summary fixture. The long-session check adds
  a 50-turn tool/thinking/patch history, retaining 100 articles and 50 highlighted
  blocks. It isolates mounting from width animations, asserts fewer than 30
  viewport writes, preserves an editable but non-executable navigation draft,
  verifies trusted wheel scrolling, and exercises normal-motion tool/thinking
  expansion/collapse afterward. Existing streaming, selection/quote,
  search/navigation, light/dark/narrow, reduced-motion and timestamp gates remain.
- Artifact regressions change only the write path while retaining the same final
  prose, then change the prose's explicit file link. Old candidates disappear and
  the current candidates appear; native runtime-specific file actions also pass.
- Six serial alternating-order real source Electron measurements use identical
  short/heavy/heavy histories in fresh local test profiles, with no model calls.
  Heavy histories contain 180 turns, 1,440 messages, 540 tool calls/results and
  2,160 highlighted blocks. Both sides retain all 360 articles/204,480 descendant
  elements at real heights, and every sample verifies the typed draft and an
  actual post-open trusted-wheel scroll.

Cold cumulative script medians change from 4810.9 to 3715.9 ms, resident from
8641.7 to 3331.5 ms; viewport writes decrease from about 1086 to 6. These are
not usability-completion times. Cold last-answer DOM detection changes only
6391.7 to 6280.8 ms. The following-frame opportunities are 7735.0/6930.7 ms cold
and 11326.0/6659.0 ms resident; early input still waits 5928.2/6747.7 ms in the
candidate. A frame opportunity is not compositor-confirmed paint. See
`RENDERER_PERFORMANCE.md` for ranges, phase definitions and diagnostic limits.
**The owner's occasional five-second usable-body delay remains open.** A heavier
synthetic reproduction now exists; first complete-history Markdown mounting and
browser style/layout remain substantial, and the owner's actual corpus is not read.

Evidence root: `D:\Desktop Runtime Builds\transcript-usability-20261109`.
`matched-summary.json`, six `matched-{baseline,candidate}-{1,2,3}.json` receipts,
source manifests, `verified-build-*` and `verified-correctness-*` logs record the
results. The new mount-counter test initially included legitimate summary-width
transition writes; it now isolates mounting, without changing the production
width behavior or raising the assertion limit. The verifier also uses the
project's contenteditable composer value and standard grouped-tool selectors.
Earlier failed/exploratory logs are not acceptance. Final input hashes and a
junction-excluding artifact inventory are in `final-receipt.json`.

No owner profile/history/account or live app is changed. Snapshot dependency and
runtime junctions are not restaged. No package, shortcut update, owner-app restart,
artifact deletion, commit, push, PR, cloud CI or native macOS acceptance is included.
The delivered ninth-pass package is unchanged and the performance TODO stays open.

## Long-History Opening Handoff (2026-11-09)

The tenth local performance pass changes only renderer handoff hierarchy and
conversation timestamp formatter sharing. It preserves the ninth-pass runtime
v0.1.7 `29eb460780489801ce8afc8bffc1a2efae7cbded`, full transcript DOM,
authoritative content replacement, read-only preview boundaries and send gates.

Local results:

- Typecheck and production build pass; 156 focused unit tests pass across session
  navigation, presentation/cache, layout, scroll, Markdown, reveal and questions.
  The full suite is not rerun.
- Four isolated source Electron acceptance checks pass: session-navigation,
  conversation-scroll, stream-motion and summary-resize.
- The expanded native navigation gate retains the exact prose, paragraph,
  highlighted code and text-range nodes through a deliberately held cold handoff.
  It preserves an expanded thinking disclosure and composer focus/caret, replaces
  an existing answer changed on disk and appends newer authoritative messages once.
  Existing stale-target, recycling, approval/action and failure gates also pass.
- Actual-App production browser long-session and sidebar acceptance pass in Edge.
  The new gates check a selected transcript paragraph across handoff, inert preview
  questions and restored live questions; 360 correct timestamps with bounded
  formatter construction in English/New York and Chinese/Shanghai, changed OS zone
  on the next render, and hidden invalid timestamps. Existing light/dark/narrow,
  reduced-motion, streaming, drag, selection/quote and search/navigation gates pass.
- Six serial real source Electron profiler runs pass, three per side in alternating
  order, using 3/180/180-turn local histories and real isolated pinned RPC, without
  model requests. The full 360-article/180-highlighted-block long histories stay
  mounted and visible. All candidate opens retain the first prose node.

Cold long first-readable/ready medians change from 463.0/1167.1 ms to
443.9/811.0 ms; resident long medians change from 380.2/798.2 ms to
370.9/466.5 ms. Initial readability gains are small; the larger reduction is in
handoff work. See `RENDERER_PERFORMANCE.md` for phase definitions and limitations.
The owner's reported occasional five-second delay concerns usable transcript
reading/scrolling/actions, not just runtime readiness. These synthetic histories
do not reproduce it, so this pass does not claim that symptom is fixed.

Evidence root:
`D:\Desktop Runtime Builds\session-opening-performance-20261108`.
`matched-summary.json`, six `matched-{baseline,candidate}-{1,2,3}.json` receipts,
`verified-build-*`, `verified-units-*`, `verified-native-*` and
`verified-browser-final-*` logs retain the successful results. Browser reports and
screenshots live in the candidate's `Desktop/test-results/long-session-interaction/`.
The first new browser assertion incorrectly selected the retained hidden search
preview; scoping it to `#conversation-scroll` fixed the verifier without weakening
the identity/selection gate. Failed diagnostic logs are not acceptance.
All 1,174 final source inputs match the tested candidate; `final-receipt.json`
records hashes and a junction-excluding artifact inventory (about 87.7/99.5 MiB
for baseline/candidate). The four local CI-policy tests and whitespace checks pass.

These tests use independent temporary profiles, never the owner's account,
conversations or workspace files. Source snapshots share dependencies/runtime
read-only through junctions; no runtime restaging or upstream modification occurs.
No new package, shortcut change, owner-app restart, deletion, commit/push/PR,
cloud, native macOS or real-account acceptance occurs in this pass. The delivered
ninth-pass package is unchanged; the performance TODO stays open.

## Runtime Compile Cache (2026-11-08)

The ninth local performance pass starts from the eighth-pass source, preserving
runtime v0.1.7 `29eb460780489801ce8afc8bffc1a2efae7cbded`. Main enables
Node's module compile cache only at a Desktop-owned profile path. Generic
isolated environments strip inherited cache paths and portability overrides
while retaining the explicit disable switch. A staged Desktop-only extension
flushes once during native session initialization, before a forced Windows
process-tree stop can discard the generated bytecode. No upstream source,
runtime entry, transport shutdown, permission/approval semantics, worker
ownership, authoritative readiness or task-send gates change.

Three serial alternating-order Electron pairs use independent fresh profiles,
the same source dependencies and unchanged staged upstream modules. Each run
opens three cold histories, returns to a resident session and rapidly requests
three new targets. Cache-established cold readiness has a median of
979.1/866.2 ms, with ranges 911.5-1009.6/815.2-907.0 ms, approximately 11.5%
lower. The process-ready portion changes from 844.2 to 725.0 ms; restoration
is essentially unchanged at 50.2/49.5 ms. First cold readiness with an empty
cache is 1045.0/1068.9 ms, not an improvement. Resident readiness is
28.3/26.7 ms; rapid-latest readiness is 1040.0/921.0 ms. Earlier readable history
and editable navigation drafts remain separate from permission to send.

An additional uninstrumented direct-runtime experiment runs three fresh
profiles per side and two forced-stop restarts per profile. First-use medians
are 757.3/814.8 ms and cache-established medians are 732.5/625.2 ms.
Diagnostic CPU profiles separately attribute 150.7/23.2 ms to source-module
compilation. Instrumented samples are not mixed into production medians.
Each measured App cache is about 2.36 MiB; no first-install, whole-app startup,
cross-version reuse or cross-platform speed claim is made. Remaining Git
environment reads stay fresh rather than being cached.

Final local checks:

- 179 focused tests pass, with two POSIX-only lifecycle cases skipped on
  Windows and no failures. Coverage includes cache persistence while alive and
  after forced stop, corrupt-cache fallback before/after a source change,
  unusable cache destinations, explicit disable, actual upstream restoration
  of changed saved messages, staging, environment isolation, lifecycle races,
  latest-target navigation, permissions, Plan review, Cron recovery, completion
  review, auth-vault and keyless transport. The full suite is not rerun.
- Typecheck and both baseline/candidate production builds pass.
- Six real source Electron navigation-profiler runs pass against real isolated
  RPC, three per side, with individual command-name and startup-phase receipts.
- Candidate session-concurrency, session-branching, session-navigation,
  Plan-review and general Electron acceptance pass. They cover scoped approvals,
  targeted abort, current drafts/caret, actual restoration, latest-target
  commits, failure recovery, source-history preservation, reviewed Plan
  snapshots, stale approval rejection, reduced motion and renderer isolation.
- An early exploratory diagnostic-preload run reached its probe-only 15-second
  deadline. Later direct comparisons and native acceptance complete with the
  existing production readiness limit unchanged. That probe timeout is not
  claimed to be diagnosed or fixed by compilation caching.

Evidence root:
`D:\Desktop Runtime Builds\runtime-startup-performance-20261108`.
`summary.json`, `matched-runs.json`, `direct-runs.json`, `probe.json` and the
separate CPU profiles retain results; `snapshot.mjs`, `compare-process.mjs`,
`run-native.mjs`, `summarize.mjs` and `final-checks.mjs` reproduce the local
experiment. `candidate-focused-final.log`, `candidate-typecheck-final.log`,
the two build logs and `candidate-acceptance-*.log` retain acceptance.
The candidate has a private Desktop runtime overlay, reusing unchanged
upstream/node/remote directories via junctions; staging never writes through
those junctions. Final source hashes and a junction-excluding artifact inventory
are recorded separately. No package, shortcut change, owner-app restart,
Git commit/push/PR, cloud, native macOS or real-account acceptance is performed.
The performance TODO remains open for those separate boundaries.

## Sidebar Render Isolation (2026-11-08)

The eighth local renderer pass starts from the seventh-pass source and retains
the v0.1.7 runtime pin. It extracts the existing sidebar tree without changing
its DOM vocabulary or CSS, memoizes the tree/rows and narrow preference/activity
inputs, preserves unchanged session identities and uses current committed action
delegates. It keeps complete session lists and transcript DOM, actual heights,
immediate streaming, existing motion, selection/copy/quotes and navigation.

Three serial alternating-order production pairs use identical final fixtures,
dependencies and Edge `157.0.4341.42`, 1440 x 900, with 180 completed turns and
60 paragraph updates at nominal 40 ms. Script-time medians change from
735.8 to 503.9 ms with 180 sidebar sessions and 1572.4 to 522.3 ms with 1,000,
approximately 32% and 67% lower. Layout does not materially improve; style time
is slightly higher with 180 and about 18% higher with 1,000. At 1,000 sessions,
sampled frames over 32 ms change from a median of 26 to two; final catalog
refreshes and long frames remain. The diagnostic title-render gate fails on the
baseline and passes on the candidate; diagnostic timings are not mixed with
uninstrumented production measurements. Neither version loses sidebar rows or
mutates their DOM in the measured stream. Unrelated host activity is uncontrolled.

Separate frontend navigation samples use explicit 35/220 ms fixture delays;
they do not prove faster backend startup. The real source Electron profiler
uses eight short local histories and actual isolated RPC, without model calls.
In the candidate's three cold samples, history is readable in 15.5-37.3 ms
while authoritative readiness takes 798.7-849.7 ms. Recorded process readiness
accounts for 674.6-720.8 ms and session restoration for 38.3-40.6 ms.
A resident return is readable in 12.1 ms and ready in 22.6 ms. Editable isolated
navigation drafts are distinct from task-send readiness. Both source snapshots
pass this profiler; their single native pair is attribution, not a repeated
runtime speed-up benchmark. See [Renderer Performance](RENDERER_PERFORMANCE.md)
for complete timing medians/ranges, reproduction and remaining costs.

Final-source local checks:

- 203 focused tests pass without skips/failures, including ten new sidebar
  state/markup cases and existing order/search/navigation, renderer, Markdown,
  layout, reading and streaming coverage. Typecheck and production build pass.
  The full unit suite is not rerun.
- The new actual-App sidebar verifier passes activity/unread transitions,
  drag locks, stable DOM through rename, current copy-reference/navigation
  actions, updated keyboard sibling order, rapid latest selection,
  light/dark 1440/760/390 px, keyboard focus and reduced motion.
  Desktop-dark and narrow-light screenshots are visually inspected.
- The untraced actual-App long-interaction verifier passes full mounted history,
  historical reading anchors, inspector/sidebar gestures, streamed resizing,
  selection/copy/quotes, search/navigation, providers and responsive gates.
- Eight real source Electron checks pass and exit: navigation profiling,
  sidebar order, sidebar search, session navigation, session move, sidebar
  scrollbar, stream motion and conversation scroll. They use isolated profiles,
  not the owner's app or real-account sessions.
- CI inventory/policy/platform-runner/summary tests report 39 passed and one
  platform skip. The four new renderer stress/visual verifiers are explicitly
  registered local-only; existing cloud acceptance assignments are unchanged.
  Source whitespace checks pass.

Evidence root:
`D:\Desktop Runtime Builds\sidebar-interaction-performance-20261108`.
`matched-summary.json`, `shared-harness.json`, gate logs and six
per-snapshot `Desktop/test-results/sidebar-interaction/matched-*.json` receipts
retain the comparison. `candidate-focused-final.log`,
`candidate-typecheck-final.log`, `candidate-sidebar-acceptance.log`,
`candidate-build-final.log`, `candidate-verify-*.log` and
`ci-policy-final.log` retain acceptance. Each source build also retains its
`Desktop/test-results/session-navigation-performance-eighth-*.json` RPC trace;
the actual-App long-history receipt is
`candidate/Desktop/test-results/long-session-interaction/eighth-final.json`.
The final manifest compares tested candidate inputs with current source.
No package, shortcut change, owner-app restart, deletion, Git commit/push/PR,
cloud, macOS or real-account acceptance is performed. The performance TODO
remains open for those separate acceptance boundaries.

## Shared Highlight Grammars (2026-11-08)

The seventh local renderer pass starts from the sixth-pass source and keeps the
v0.1.7 runtime pin. A lazily shared `rehype-highlight` transformer retains
language registration/compiled grammars across Markdown processors. Document
trees, source output and unfinished token state are not cached or shared.
The complete parser/highlighter, safe URL/math policies, existing components,
immediate streaming and progressive reveal remain unchanged.

Three serial alternating-order baseline/candidate pairs run identical production
fixtures and dependencies in Edge `157.0.4341.42`, 1440 x 900, with six corpora
and nominal 40 ms, 180-character updates. Growing-code script medians are
328.7/256.4 ms, single-paragraph 146.4/121.2 ms and mixed 460.7/344.9 ms.
Layout/style are essentially unchanged; this is not a parser rewrite, full-app
speed-up, response-latency or FPS claim. Separate Node pipeline diagnostics
identify repeated highlighter setup/grammar compilation; their totals are not
added to the browser savings. No compiler/other acceptance from this task runs
alongside profiling, but unrelated shared-host activity is uncontrolled.
See [Renderer Performance](RENDERER_PERFORMANCE.md) for medians, ranges and commands.

Final-source local checks:

- 162 focused tests pass with no skips or failures. Twelve new highlighter
  cases compare fresh upstream output across partial/complete multi-line tokens,
  nested/unknown/plain languages, code/math and alternating independent messages.
  The reuse regression fails before the change and passes afterward.
- Typecheck, production build and source whitespace checks pass. The full
  unit suite is not rerun.
- All six production-browser profiles pass immediate partial/final full-render
  parity, late definitions, footnotes, stable code/math DOM, native selection,
  code copy feedback, completion, light/dark 1440/760/390 px and reduced motion.
  Sample desktop-dark and narrow-light screenshots are visually inspected.
- The untraced actual-App long-session verifier passes historical-anchor,
  streamed-resize/tail, complete mounted history, selection/copy/quotes,
  search/navigation, cancellation, providers and responsive/visual checks.
- Six real source Electron verifiers pass and exit: stream motion, conversation
  scroll, BTW, file preview, Plan review and chat quotes. The Plan run uses an
  isolated loopback provider, not a real account. Shared Markdown surfaces
  retain their actual production components and existing interactions.

Evidence root:
`D:\Desktop Runtime Builds\streaming-tail-performance-20261108`.
`matched-summary.json`, six `pipeline-matched-*.json` files and each snapshot's
three `Desktop/test-results/streaming-markdown/matched-*.json` files retain the
comparison. `focused-final.log`, `typecheck-final.log`, `build-final.log` and
the seven `final-verify-*.log` files retain local acceptance.
The actual-App receipt is
`candidate/Desktop/test-results/long-session-interaction/seventh-final.json`.
`source-candidate-manifest.json` checks tested files against current source;
`artifact-inventory.json` excludes dependency/runtime junctions. Outputs are
isolated and no artifact is deleted. No new package, shortcut update, owner-app
restart, Git commit/push/PR, cloud, macOS or real-account acceptance is performed.

## Panel Gesture Style Isolation (2026-11-08)

The sixth local renderer pass builds on the fifth-pass source, retaining the
v0.1.7 pin and complete historical DOM. Drag cursor/selection styles stay on
the captured handle instead of changing the app root. The handle keyboard
outline now uses the actual theme primary token.

Full production acceptance also reproduces a 79 px paused-reading drift in
both the old and new CSS snapshots. Native layout scrolling sometimes precedes
its width ResizeObserver and was misclassified as manual scrolling. The
controller now reconciles a pending, actually changed viewport width against
the original anchor; stable-width unexpected scrolling and direct real-input
cancellations remain. Viewport geometry precedes anchor geometry/current
scroll-position reads. Native anchoring remains enabled. New regressions
demonstrate failures before the geometry-order and width-scroll fixes, then
pass after them. See [Renderer Performance](RENDERER_PERFORMANCE.md).

Final-source matched production comparisons use three serial alternating-order
pairs per harness, identical dependencies, Edge `157.0.4341.42`, 1440 x 900 and
180 completed turns, without tracing or injected CSS. This task runs no compiler
or other acceptance concurrently with profiling; unrelated shared-host activity
is not controlled.
Acquire style medians are 110.3/70.1 ms and maximum frame medians
174.9/104.1 ms. Release style medians are 159.3/83.4 ms and maximum frame
179.2/95.9 ms. Genuine final layout/script work does not improve. Another three
pairs check all three 60-paragraph streaming scenarios; while dragging, style
medians are 529.5/377.0 ms and maximum frame 187.5/145.9 ms. No universal
sub-100-ms, constant-FPS, non-drag or operating-system claim follows.

Final-source local checks:

- 150 focused tests pass, including all 21 layout-controller cases; no skips
  or failures. Typecheck and production build pass. The broad unit suite is
  not rerun.
- The actual-App gesture verifier passes captured pointer targets and resize
  cursor outside the handle, native selection prevention/retention, unchanged
  root styles, click and keyboard menus, focus outline, preset navigation,
  Escape, pointer cancellation and actual capture release. Light/dark,
  1440/760/390 px and reduced motion pass; settled screenshots are inspected.
- Two untraced actual-App long-interaction passes retain the paused anchor
  and tail through live deltas, completion, release and full reflow. Existing
  save races, current JSON/providers, selection/copy/quotes, search/turn
  navigation, settings layering, DOM identity and visual gates also pass.
  The final shared-Text production verifier passes its semantic/visual matrix.
- Final source Electron stream motion, conversation scrolling, native summary
  resize and BTW verifiers pass and exit normally. The summary verifier also
  exercises a captured handle drag over other content in a real Electron
  window, retaining the resize cursor and selection/root-style boundaries.

Evidence root:
`D:\Desktop Runtime Builds\panel-gesture-isolation-20261108`.
Final timing summaries are `gesture-final-matched-summary.json` and
`streaming-final-matched-summary.json`; individual receipts use the
`final-matched-{baseline|candidate}-{1|2|3}` prefix. Earlier CSS-only timing
and failed old-source anchor runs remain separately labeled.
`focused-final.log`, `typecheck-final.log`, `build-final.log` and the seven
`final-verify-*.log` files record the final acceptance. App receipts are
`candidate/Desktop/test-results/long-session-interaction/sixth-scroll-race-fixed.json`
and `sixth-final.json`; gesture and shared-Text receipts use `sixth-final`
under their respective `test-results` directories.

Optional scroll-accessor diagnostics are disabled in final acceptance:
instrumentation that adds position reads can mask browser event ordering.
`source-candidate-manifest.json` checks the final source against the tested
snapshot, and `artifact-inventory.json` inventories physical outputs without
following dependency/runtime junctions. No output is deleted. This remains
local, uncommitted branch work. The final actual-App preview uses port 5218;
older previews are unchanged. No package is built, shortcut changed, application
restarted, or Git commit/push/PR performed. Cloud, macOS and real-account
acceptance are not performed.

## Streaming Drag Protection (2026-11-08)

The fifth local renderer pass builds on the fourth-pass source, retaining the
v0.1.7 runtime pin. It coordinates automatic tail scrolling with the existing
measured-width controller, distinguishes real indexed-article membership changes
from working-indicator removal, and preserves the gesture anchor through final
reflow without using a scroll position read before the final geometry. It does
not throttle live output, hide or virtualize history, or disable native anchoring.

Three serial matched production pairs use Edge `157.0.4341.42`, 1440 x 900,
identical harness/dependencies, 180 initial turns and 60 additional paragraphs.
Every run retains all 362 articles and 60 paragraphs. Flowing-response drag
layout medians are 890.0/147.4 ms, with ranges 876.2-1029.9/131.9-178.7 ms.
Frames over 32 ms are 64/17 and p95 frame intervals 66.7/25.0 ms. Style/script
medians do not improve, non-drag medians are somewhat higher in these samples,
and maximum frame medians remain 208.3/225.0 ms. There is no universal-speed,
constant-FPS, non-drag or Windows/macOS causal claim. See
[Renderer Performance](RENDERER_PERFORMANCE.md) for complete results and limits.

The final source passes 154 focused tests, including 18 controller tests,
typecheck and production build. New unit cases cover clamped live tail
corrections versus real uncoordinated scrolling; live content and indicator
removal; indexed article insertion/replacement/reordering; settlement anchors;
and geometry reads that themselves cause native scroll anchoring. The full
actual-App production verifier holds drags across deltas and completion while
reading history and following the tail, checks protection survives, verifies
all paragraphs, checks the paused article/offset and actual tail, and requires
all widths to clear afterward. Existing save races, text selection/copy/quotes,
current context JSON, search focus, deferred navigation, session replacement,
usage/question providers, settings closing/layering, light/dark 1440/760/390,
asset and reduced-motion gates pass. Desktop/light and narrow/dark screenshots
are visually inspected.

The shared-Text production verifier passes complete-render equivalence,
definitions/footnotes, code/math identity, selection, copy feedback, completion,
reduced motion and its visual matrix. Four final source Electron verifiers
pass and exit normally: stream motion, conversation scrolling, native summary
resizing and side-question behavior. The broad unit suite is not rerun for this
pass. These results do not establish macOS, cloud, packaged or real-account
acceptance, or the cause of earlier intermittent native shutdown hangs.

Evidence and isolated snapshots:
`D:\Desktop Runtime Builds\streaming-drag-performance-20261108`.
Matched reports live under each snapshot's
`Desktop/test-results/streaming-interaction/`; the root `matched-summary.json`
records medians/ranges and protection lifetime. Diagnostic reports separately
identify the premature scroll-triggered release. Final logs are
`focused-final.log`, `typecheck-final.log`, `build-final.log`,
`verify-final.log`, `verify-markdown.log` and `final-verify-*.log`.
Actual-App receipts are
`candidate/Desktop/test-results/long-session-interaction/fifth-final.json`
and `fifth-geometry.json`; shared-Text evidence is
`candidate/Desktop/test-results/streaming-markdown/fifth-final.json`.
`source-candidate-manifest.json` compares source hashes with the tested snapshot;
`artifact-inventory.json` inventories physical files without following shared
dependency/runtime junctions. No artifacts are deleted. The final actual-App
preview uses port 5217; earlier previews remain untouched. No package is
produced, shortcut changed, installed application restarted, commit/push or PR
performed. Shared junctions and a source snapshot are not an acceptance package.

## Streaming Update Isolation (2026-11-08)

The fourth local renderer pass builds on the third-pass source, without a
runtime pin change. It replaces the settings ancestor `:has()` selector with
explicit open/closing state, stabilizes the user-turn projection within a
runtime/session/draft, and memoizes usage/question provider values. This does
not isolate the entire App or replace the state store, throttle streaming,
virtualize history or hide changed content.

Three serial matched production comparisons use Edge `157.0.4341.42`,
1440 x 900, identical harness/dependencies, 180 initial turns and exactly
60 streamed paragraphs. Every run retains all 362 articles and 60 paragraphs.
Streaming-only median style time changes from 1466.4 to 248.2 ms and script
time from 1197.6 to 803.1 ms. With context open those medians are
1473.1/289.3 ms and 1217.4/869.7 ms. Historical turn queries are
11,041/181 in every scenario and repeat. Dragging still has expensive layout:
the median is 886.8/921.6 ms; no layout improvement or constant-FPS claim is
made. See [Renderer Performance](RENDERER_PERFORMANCE.md) for ranges, diagnostic
limits, methodology and reproduction.

The final source passes 140 focused tests, typecheck and production build.
The actual-App production verifier passes the existing reading/resize,
selection/copy/quotes, current expanded JSON, delayed-save races, cancellation,
search focus, navigation, assets and reduced-motion gates. Additional checks
require no repeated turn-node queries during settled assistant-only deltas,
reacquisition and correct navigation in another session with identical turn
previews, saved command-icon usage updates, question reopening/expiry/replacement,
and settings window-bar layering throughout open/closing/closed states in
light/dark 1440/760/390 layouts and reduced motion. Final desktop/light and
narrow/dark screenshots are visually inspected.

The final shared-Text production verifier passes complete-render DOM equivalence,
late/nested/duplicate definitions, footnotes, code/math identity, copy feedback,
selection, completion, reduced motion and the visual matrix. Its timings are
not another matched comparison. Four final source Electron verifiers pass and
exit normally: stream motion, conversation scrolling, native summary resizing
and independent side-question rendering/quoting/copying/cancellation/history
boundaries. This does not establish the cause or a fix for earlier intermittent
native shutdown hangs. The broad unit suite is not rerun for this fourth pass;
earlier broad-run counts below must not be described as final fourth-pass results.

Evidence and isolated snapshots:
`D:\Desktop Runtime Builds\streaming-isolation-20261108`.
Matched JSON receipts live in each snapshot's
`Desktop/test-results/streaming-interaction/`; their medians/ranges are in
`matched-final-summary.json` at the evidence root. Final logs include
`focused-final.log`, `build-final.log`, `streaming-markdown-final.log` and
`final-verify-*.log`. The actual-App receipt is
`candidate/Desktop/test-results/long-session-interaction/isolation-regression.json`;
the shared-Text receipt is
`candidate/Desktop/test-results/streaming-markdown/isolation-final.json`.
Diagnostics include larger invalidation traces, not just final benchmark JSON;
`artifact-inventory.json` inventories about 896 MiB excluding shared junctions,
mostly the three baseline diagnostic traces. No cleanup is performed without
authorization. `source-candidate-manifest.json` verifies all 1,164 source files
against the tested snapshot. The actual-App preview is served on port 5216.
Shared dependency/runtime junctions are not independent packages. No package is
produced, shortcut changed, installed application restarted, artifact deleted,
commit/push or PR performed. macOS, cloud, packaged and real-account acceptance
remain separate.

## Streaming Markdown Block Reuse (2026-11-08)

The third local performance pass retains complete-source Markdown parsing and
reuses unchanged top-level rendering blocks. It does not split on blank lines,
throttle output, upgrade the runtime or replace the shared message components.
Global reference definitions include nested lists/quotes with first-definition
precedence; footnotes retain the original complete-document renderer. Non-append
replacement invalidates caches. The existing large-message pagination boundary
and new-text-only fade remain unchanged. See
[Renderer Performance](RENDERER_PERFORMANCE.md) for architecture and limitations.

The final serial production comparison uses Edge `157.0.4341.42`, 1440 x 900,
identical dependencies and six fixed-prefix scenarios. The 16,194-character
mixed reply, across 91 updates including completion, records script time of
2218.1/570.3 ms, layout of 409.8/36.7 ms and style of 1008.2/126.9 ms.
Its p95 synchronous update work changes from 43.1 to 10.2 ms; sampled frames over
32 ms change from 58 to zero. These are local single-run observations, not an
FPS, operating-system or universal performance guarantee. One growing paragraph
has about 8% extra script cost; a growing code block still requires whole-block
highlighting despite a smaller observed reduction.

The final candidate passes 112 focused tests, typecheck and production build.
Forty-two block tests compare complete/partial Markdown, nested and duplicate
definitions, footnotes, code/math/currency, commands, unsafe HTML/URLs, cache
invalidation, tree nonmutation and UTF-16 reveal offsets. The other focused tests
cover existing math/reveal, commands, render-cache, layout, navigation, scrolling
and full-text contracts. The production browser verifier additionally checks
normal-render DOM parity, nested/late definitions, first-definition precedence,
footnotes, code copy, retained code/math nodes, selection and copy feedback
through stream completion, reduced motion and light/dark 1440/760/390 layouts.
Final light/desktop and dark/narrow screenshots are visually inspected.

The broad serial run immediately before the final nested-reference correction
reports 1,512 tests: 1,499 passed, thirteen platform skips, zero failures or
cancellations, 526.2 seconds. Its receipt is `broad-before-reference-fix.log`.
The final correction adds eight cases and is verified by the 112-test focused
run and final browser/native checks, not another full final-source run. Do not
report a complete 1,520-test pass. An earlier incomplete snapshot omitted root
plugin/theme examples and historical patch/document inputs; its failures are
not counted as acceptance, and no product tests are weakened to repair it.

The final actual-app production fixture passes inspector/sidebar/save races,
selection/copy/quotes, paused reading, streaming during width changes, updated
expanded context, cancellation, full-text focus, distant navigation during
transitions, assets, reduced motion and the light/dark/narrow matrix without
renderer exceptions. Four final source Electron checks exit normally:
`verify-stream-motion.mjs`, `verify-conversation-scroll.mjs`,
`verify-summary-resize.mjs` and `verify-btw-electron.mjs`. These cover the real
fade/fold/tail behavior, scroll/resize and independent side-question quoting,
copying, cancellation and history boundaries. This does not claim a root-cause
fix for the previous pass's intermittent shutdown hang.

Evidence and source snapshots live under
`D:\Desktop Runtime Builds\streaming-markdown-performance-20261108`; matched
receipts are `matched-final-baseline.json` and `matched-final-candidate.json`
under each snapshot's `Desktop/test-results/streaming-markdown/`. Final tests
and build logs are alongside them; the actual-app receipt is
`test-results/long-session-interaction/streaming-regression.json`.
Physical QA files occupy about 114 MiB excluding shared dependency/runtime
junctions. No installer is produced or executed, old package deleted, shortcut
changed, installed application restarted, commit pushed or PR created.
macOS, cloud, packaged and real-account acceptance remain separate.

## Measured-Width History Reflow (2026-11-08)

The second local performance pass builds on the first-pass renderer changes,
not a new runtime pin. `conversation-layout.ts` temporarily retains measured
widths for distant mounted history during inspector dragging and actual
transcript-width transitions. Nearby, live, last-two and focused articles stay
responsive. Existing selections bypass it; all widths are released together
with an anchored reading/tail correction. History/session changes and user
input release it; overlapping/canceled transitions and disposal clean up.
Search, quote and turn navigation use final settled geometry and obsolete
deferred navigation is canceled.

The final production fixture/verifier runs serially against the first-pass
snapshot and candidate on Windows Edge `157.0.4341.42`, 1440 x 900, 180 turns.
Cumulative drag layout changes from 758.0 to 117.2 ms, including settlement;
style time is 282.2/290.2 ms and script time 23.8/28.5 ms. This does not mean
all rendering is 85% faster: acquisition/release long tasks remain, and streamed
resize still has substantial style/script work. Sidebar spare-space animations
do not acquire widths; no additional sidebar improvement is claimed.

All 360 original article nodes remain mounted and visible. The reading test
changes transcript width from 780 to 452 px while preserving article 81 with
a 0.25 px offset difference. The final verifier passes temporary-width cleanup,
selected text/copy/quotes, different final reading width, rapid reversals,
streaming, latest expanded JSON, drag cancellation, full-text focus, distant
navigation during a real width transition, light/dark 1440/760/390 layouts,
assets, reduced motion and absence of renderer errors. The first-pass snapshot
misses the new mid-animation navigation target; that is reported as a baseline
failure, not candidate acceptance.

The full serial suite reports 1,478 tests: 1,465 passed, thirteen platform
skips, zero failures/cancellations, 533.0 seconds. Final lifecycle cleanup is
also covered by 78 passing focused tests, including thirteen controller tests.
Final typecheck and production build pass. A candidate Electron scroll run
exits normally. Its final repeat passes every functional assertion and writes
its receipt, but hangs in `app.close()`; only the verified isolated test tree
is forcibly cleaned up. That repeat is not counted as orderly shutdown
acceptance, and no shutdown root-cause fix is claimed.
The final source Electron native-window-resize check exits normally: all three
Restore cycles have one settled transcript width, retain composer alignment and
paused history, honor reduced motion and report no renderer exceptions.

Evidence and isolated snapshots are under
`D:\Desktop Runtime Builds\long-session-layout-20261108`; production receipts
are `matched-first-pass.json` and `matched-layout-final.json` beneath each
snapshot's `Desktop/test-results/long-session-interaction/`.
See [Renderer Performance](RENDERER_PERFORMANCE.md) for the method and tradeoffs.
The candidate and comparison occupy about 114 MiB excluding shared dependency
and unchanged runtime junctions. The new fixture preview is intentionally served
on port 5214. No package, installer execution, shortcut change, app restart,
commit, push or PR is part of this pass. macOS, cloud, packaged and real-account
acceptance remain separate.

## Long-Session Interaction Performance (2026-11-07)

The performance branch starts at main `e419143`. A production browser fixture
mounts the actual app with short/180-turn history, 180 sidebar sessions and
delayed preference writes. Unchanged history and file actions remain reusable;
navigation geometry is logarithmically bounded; inspector drag writes are
frame-coalesced; context rows/formatters are reused; workspace disclosure is
optimistic with serialized saves and latest-intent rollback.

Matched Windows Edge traces reduce inspector-open script time from 264.2 to
36.1 ms, drag geometry reads from 7200 to 360 and drag layout from 1454.8 to
862.7 ms. Delayed-save disclosure DOM feedback changes from 482.8 to 9.7 ms,
before persistence completes. These observations do not establish stable FPS.
Long-history live reflow and streaming resize still produce long tasks.
Transcript estimated-height containment was rejected after a distant-navigation
regression; the final transcript retains its complete DOM and real heights.
Method, results and remaining scope are in [Renderer Performance](RENDERER_PERFORMANCE.md).

Local full serial tests exit normally: 1,465 tests, 1,452 passed, thirteen
platform skips, zero failures/cancellations. Final typecheck, production build
and thirty focused render-cache/navigation/scroll/Markdown/reveal tests pass.
The final production fixture passes delayed-save/race/rollback, historical
copy/quote/highlighting, paused reading, streaming and current expanded JSON,
drag cancellation, full-text open/focus, distant turn navigation, asset loading,
light/dark 1440/760/390 layouts and reduced motion, without renderer exceptions.
Existing source Electron conversation-scroll and native-window-resize checks
also pass after the final transcript containment removal.

Evidence lives under
`D:\Desktop Runtime Builds\long-session-performance-20261107`.
The first broad attempt lacked a prepared runtime and failed; it is not counted
as acceptance. The successful native snapshot reuses the unchanged v0.1.7
`29eb460` Node/Step/Remote dependency directories read-only and builds/copies
current Desktop-owned adapters into its own runtime directory. No upstream
checkout, shared runtime, installed app, shortcut, installer or profile is
modified. macOS, cloud, packaged and real-account acceptance remain separate;
no PR, push or package is created by this local performance pass.
The QA inventory is about 214 MiB of physical files, excluding shared junction
targets: baseline/source snapshots, current build/terminal outputs and receipts.
No old package is deleted. The candidate production fixture is served locally
on port 5213; its background preview is intentional, not an unfinished verifier.

## 全局指令 PR 验收脚本修复（2026-11-09）

PR #224 的 Windows/macOS sessions 验收严格比较路径时，把临时目录的
别名当作预期值：Windows 短路径与长路径、macOS `/var` 与 `/private/var`
表示同一个目录。验收现在先对新建的隔离 profile 调用 `realpath`，
仍严格比较界面、IPC 和复制结果的完整路径，不修改产品路径选择。
本机用目录 junction 复现了旧脚本的失败，修复后在同一别名环境通过。

Windows runtime 验收在权限菜单点击返回、原生权限 RPC 尚未完成时提交了
任务，被现有 `Session operation in progress` 保护拒绝。发送助手现在同时
等待权限按钮恢复和原有 Send 就绪条件。受控回归保持真实风险确认未回答，
明确验证 Send 虽已启用、权限事务仍未完成时助手必须阻塞；旧条件在此失败。
快照等待复用 Node 侧的已解析值轮询，关闭复用现有有界 fixture 关闭助手。
没有修改产品权限策略、worker 并发保护、原有断言或通过超时。

提交 `4f1f01b` 的 Windows sessions/runtime 全组通过；interface 在已有插件
验收的卸载关闭步骤失败：原生窗口已关闭，但该页面的 `evaluate` 回包随之
中断。脚本现在并行等待真实 close 事件和关闭 RPC，仅接受页面销毁对应的
Playwright 错误，其他错误仍抛出，并保留主窗口存活断言。

本地 Windows 验证结果：

- 源码全局指令验收在 junction 临时目录下通过；权限验收连续三次通过。
- 同一目录别名环境下，两项脚本也通过现有免安装包
  `global-instructions-20261109-preview-r2`（产品提交 `4d28ad5`）。
  均经现有串行 CI runner 执行，仅限定这两项，不声称全组已执行。
- 类型检查通过；CI 清单、执行器、策略和汇总测试 41 项中 40 项通过、
  1 项既有 POSIX 平台跳过；fixture 关闭回归 16 项全部通过。
- 插件完整源码验收连续两次通过八组检查，均确认零推理请求、零渲染器错误、
  启动器退出码 0 和零剩余窗口。额外的现有 Windows 包执行通过八组业务断言，
  但最后退出整个 fixture 超时 30 秒，结果仍记为失败，不算包验收通过。
  后续未发现该 r2 包的残留进程；未据此修改产品或放宽退出判定。

日志为 `Desktop/test-results/pr224-ci-targeted-source.log` 和
`Desktop/test-results/pr224-ci-targeted-package.log`，插件追加执行日志为
`Desktop/test-results/pr224-ci-plugin-close.log`，详细结果在对应
`pr224-plugin-close-{source-1,source-2,package}/verification.json`。
以上是隔离 profile、
本地 HTTP/SSE fixture 验证，不替代新提交的云端 CI、原生 macOS 或付费模型
验收。未重新打包，也未改用户应用、快捷方式、个人配置或共享 runtime。

## Global Instructions File Transparency (2026-11-09)

The settings editor now displays the actual native context file selected by
the main process, including an existing override or fallback, and provides a
copy-path action through the existing clipboard bridge. A missing profile shows
the future `AGENTS.md` path without creating the file. Read, unchanged-save,
changed-save and clear responses retain that same trusted path; no arbitrary
filesystem API is added.

Status copy distinguishes a missing file, a loaded local file and a completed
file save. It does not claim that a resident conversation has loaded the saved
instructions. The lifecycle note explicitly requires a new conversation or a
manual runtime restart; saving still does not interrupt or hot-update existing
workers.

Local typecheck/build passed. The focused store, runtime, session ownership,
MiniChat catalog and plugin-window policy run passed 123 of 125 tests, with two
existing POSIX-only skips and no failures. The production Electron verifier
passed through an isolated local HTTP/SSE provider, inspecting actual system
requests before and after saving, new sessions, manual restart and cold restore.
It additionally checks actual/default/override paths, exact clipboard payloads,
copy failure without draft loss, override-only saves, light/dark/640px English
layout and four-sided editor/copy-button focus visibility. Clipboard writes are
stubbed only in the fixture's main process, leaving the user's clipboard intact.
The light and narrow dark screenshots were inspected.

Evidence is in `Desktop/test-results/global-instructions-results.json` and the
matching light, dark-narrow, conflict and override-path screenshots. This is
local Windows source acceptance, not paid-model obedience, native macOS,
current cloud CI, package acceptance or a public release.

## Cron 管理页读写协调（2026-11-09）

`6a50595` 的 Windows 三组及最终汇总通过；macOS runtime 在源码 Cron
验收中，点击恢复后等待“暂停任务 Beta”超时。截图显示任务仍暂停，自动恢复
授权已失效。旧日志没有操作拒绝原因，不能仅凭超时确定云端根因。

受控浏览器测试挂载真实 `CronManager`，保持事件触发的列表读取未完成，
稳定复现了管理页仍发送修改、被宿主读取锁拒绝的竞争；也确认写入尚未完成时
事件会再次启动读取。这两项在修复前失败。管理页现在等待自己的读取结束后
只发送一次写入，写入期间合并刷新，确认或失败后再读取列表。并行快照先失败
时也等待列表读取结束；此边界单独先复现失败，再验证修复通过。

后端忙碌锁、任务 revision、自动恢复授权失效规则与原生断言不变；
不自动重试不确定的写入，不将等待期间的新任务版本套到旧操作上。
关闭管理页会取消仍在等待读取的写入。失败现场增加仅含固定界面状态的诊断，
不输出任务原文、完整快照、凭据或环境变量。

六项协调回归与原有十七项动画／搜索回归共二十三项通过，已接入两平台 CI。
CI 执行器、策略及 Windows 汇总回归四十二项：四十一项通过、
一项既有平台跳过；Windows 汇总能单独标记浏览器协调测试失败。
类型检查与工作树生产构建通过。完整原生 Cron 十四场景在普通高度和限制
684px 内容高度下均通过，搜索原生验收通过；这是本地隔离 Windows 源码验收，
不是完整 CI 分组、原生 macOS、付费模型、安装包或发布验收。
Node 24.16 完整协议测试 1,855 项：1,841 项通过、14 项条件跳过、零失败。

证据在共享 D: 的 `output/theme-composition-main-sync-20261109`：
`cron-manager-before-serialization.log`、`cron-manager-snapshot-before-drain.log`、
`browser-cron-serialization-final.log`、`ci-cron-serialization-final.log` 及
`native-cron-serialization*.log`。新提交仍须等待云端完整验收；
未合并 PR、生成安装包、改变运行时或用户配置，#223 保持草稿且未同步。

## 主题组合与全局指令主线同步（2026-11-09）

- 合入主线 `4308435`（PR #224 全局指令）。仅验收文档有文本冲突，
  保留主线原有记录及主题分支的完整记录；自动合并的 IPC、preload、
  设置界面、权限验收和 CI 清单已复查。
  `themeImage`、`pluginWindowOpen` 的只读路径及 MiniChat／插件窗口边界保留。
- 类型检查和工作树生产构建通过。Node 24.16 完整协议测试 1,855 项：
  1,841 通过、14 项条件跳过、0 失败。
  CI 执行器／策略测试 40 项：39 通过、1 项既有平台跳过。
- 经现有串行 CI runner 定向执行搜索、全局指令、权限、插件窗口及 Remote
  五项源码原生验收，全部通过；这不是执行完整 CI 分组。
  插件检查八组，零推理请求、零页面错误、退出码 0、窗口归零；
  Remote 包含真实退出／重启恢复。
- 主题组合浏览器十项行为及四组桌面／窄屏像素检查通过；
  四组主题截图及全局指令明暗／窄屏截图已检查。
  新日志位于共享 D: 证据目录中的 `*-main4308435*` 文件。
- 新提交仍需云端 Windows/macOS 完整验收。
  未合并 PR、打包、改动个人档案、运行客户端、快捷方式或运行时版本；
  自定义背景 PR #223 仍保持草稿且未同步。

## 会话搜索焦点验收的动画等待（2026-11-09）

- `47008c4` 的 Windows 三组及汇总通过；macOS 候选构建、会话组和运行时组
  通过，但界面组包内验收在搜索焦点检查失败：
  `outline: '2px'` 和无横向溢出通过，`contained` 为 false。
  原脚本在边界断言之后才等待侧栏动画，测量可能发生在侧栏仍滑入视口时。
- 受控浏览器回归执行原验收脚本的几何检查，使用真实侧栏和搜索框 CSS，
  将入口动画停在视口之外，修复前稳定复现同一个失败。
  验收现在等待原生内容尺寸同步和实际动画完成后再测量；四侧完整焦点环、
  2px 宽度和无溢出断言不变，没有改产品样式、动画、时限或自动重试。
  回归还人为制造动画完成后仍然裁切的情况，确认原断言继续拒绝真实裁切。
- 动画辅助器浏览器回归 17 项通过，类型检查通过。
  CI 执行器／策略回归 36 项：35 通过、1 项既有平台跳过。
  隔离 Electron 的会话搜索验收连续 3 次通过明暗、宽窄窗口、键盘焦点、
  搜索排序、临时展开、输入法 Escape、草稿／运行时隔离和结果导航。
  四组截图已检查；窄窗口实际采用原生最小内容宽度，不假定外框请求尺寸等于视口。
  本次提交仍需新的 Windows/macOS 云端 CI，旧 head 的通过项不能替代它。

## Remote 重启验收的页面导航等待（2026-11-09）

- `5707525` 的 Windows attempt 2 在 Remote 重启后读取状态时失败：
  `firstWindow()` 返回后正式页面仍在导航，`page.evaluate()` 的执行上下文被销毁。
  共享测试启动器现在等待实际 `renderer/index.html` 加载完成才返回；
  保留原有启动时限、状态轮询及恢复断言，导航失败仍会关闭隔离应用并报错。
- 源码／包内启动等待与导航失败清理共 3 项回归，修复前全部失败、修复后通过。
  连同会话夹具和关闭门禁共 26 项通过，类型检查通过。
  本机 Node 24.16 的完整原生 Remote 验收通过真实退出／重启恢复、队列撤回、
  图片授权、Plan 审批及断开后不重连。日志位于共享 D: 证据目录
  `output/theme-composition-main-sync-20261109/remote-after-navigation-fix.log`。
- 同一旧 head 的 Windows attempt 1 在更新界面及 `then_run` 功能断言完成后
  关闭超时；原样重跑已越过这些检查。本机 12 次隔离关闭、更新界面及完整
  `then_run` 复测均通过，未修改关闭策略、时限或断言，关闭间歇失败根因仍未确认。
  该旧 head 的 macOS 全部候选构建、源码／包内验收及最终汇总通过，
  不代表本次验收修复提交的云端结果。
- 本机 Node 24.15 的完整复测在既有 `terminal-sessions.test.ts` 的进程树
  清理中失败并留下夹具进程；已核对 PID、父进程及精确夹具路径后停止，
  未修改终端逻辑或降低断言。该次失败日志独立保留，不能算作完整测试通过。

## 主题组合与主线插件工作区同步（2026-11-09）

- 同步主线 `9e493ed`，合并只读 IPC 白名单中的 `themeImage` 与
  `pluginWindowOpen`，保留双方的测试和验收记录。
  MiniChat 仍拒绝打开插件窗口；插件窗口仍拒绝主题场景、海报和图片读取，
  不扩大独立窗口的权限。
- 类型检查及 D: 隔离生产构建通过。完整协议测试 1,843 项：
  1,829 通过、14 项平台／资源条件跳过、0 失败。
  CI 清单、策略与执行器测试 31 项：30 通过、1 项既有平台跳过。
- 主题组合浏览器检查 10 项、桌面／窄屏非空与色彩像素检查 4 组通过；
  插件工作区 14 组和实际渲染器注入 bridge 验收 11 组通过。
  检查了桌面、390px 窄屏及四侧焦点截图。
  插件浏览器验收复用已安装 headless shell 1243，非默认预期版本；
  主题组合浏览器验收使用本机 Chrome，不替代云端同版本验收。
- 隔离 Electron 主题验收通过 PNG/JPEG 原生解码、主题切换、UI 保留、
  动效偏好、重启及缺包回退。真实本地 Git 市场的插件主／侧／独立窗口
  验收通过 8 组，0 推理请求、0 页面错误，启动器退出码 0、窗口归零。
- 证据在 `output/theme-composition-main-sync-20261109`，浏览器证据在
  `output/playwright/theme-composition-main-sync-20261109`，均位于共享 D: 目录。
  新提交仍需云端 Windows/macOS 完整 CI；旧 head 的绿灯不代表同步后通过。
  未合并 PR、生成安装包、修改运行时版本、个人档案、客户端或快捷方式。

## 主题组合 CI 后续焦点检查（2026-11-09）

`082e773` 的 Windows runtime 组已通过协议测试，随后在
`verify-cron-management.mjs` 的矮窗口原始坐标点击后，报告文本框未聚焦。
测试现在等待前一个输入框的原生聚焦滚动和人工滚动各自跨过两帧，
再确认文本框确实部分裁切、点击点确实命中它，然后点击并保留原来的
完整四侧焦点边框断言。没有自动重试点击、再次聚焦或改变产品焦点行为。
本机隔离 Electron 在 684px 高度完成四组明暗／宽窄焦点矩阵并生成截图。
这不代表完整 Cron、默认进程关闭或替换提交的云端 CI 已通过。

后续完整 Cron 本机重跑通过 14 项。`f17f93b` 的云端窄窗口检查又证明
684px 下文本框可能自然完整容纳，因此不能假定人工滚动必然制造裁切。
保留原有 684px 明暗／宽窄检查，并增加 540px 两组专门验证真实部分裁切
后的原生聚焦及鼠标点击；命中检查和完整四侧边框断言继续保留。
扩展后的六组窗口矩阵与完整 Cron management 隔离验收再次通过 14 项。

## Theme Composition Foundation (2026-11-09)

The version 2 source contract separates host-owned UI adapters from default
backgrounds and declares opt-in image replacement. Version 1 remains a closed
Stellar composition; the published Stellar package is unchanged. This phase
supports packaged static PNG/JPEG backgrounds and an internal replacement slot,
not the personal image-import/editor plugin. WebP was excluded after a native
Electron probe returned an empty image for both buffer and data-URL decoding.
No HTML, JavaScript, custom CSS or arbitrary engine execution is introduced.

Local typecheck and the isolated production build pass. The 11 focused
contract, loader, image, theme, worker, race and IPC test files report 103 passes
and one Windows file-symlink privilege skip, with no failures. A real directory
junction rejection test still runs. The final runtime-backed Remote and
marketplace suites pass all 76 cases; CI inventory/policy tests pass all 15.
The authoring Schema accepts seven valid examples and rejects 14 invalid ones.

The new browser verifier passes ten behavior cases, including closed v1,
scene replacement/disposal/restoration with retained UI and layout, stale async
loads, same-ID resource updates, static-theme controls, reduced motion and
cleanup. Desktop and 390-pixel canvas/image checks are nonblank and chromatic;
1440, 760 and 390-pixel screenshots were inspected. The isolated Electron
verifier passes actual PNG/JPEG decoding, first-frame selection, theme switching,
Stellar UI with image/solid backgrounds, motion preference persistence, invalid
ID rejection, restart and missing-pack fallback, without renderer errors.

The unchanged legacy composition verifier had one initial reduced-motion
pixel-equality failure. An independent full rerun and two instrumented final
motion workflows passed. Both instrumented screenshot pairs were pixel-identical
and background draw counts remained fixed. No deterministic defect or cause for
the initial failure has been established; it remains an intermittent observation.

Machine-local evidence is under
`D:\Desktop For Step Code\output\theme-composition-20261109`
(`electron-final/results.json`, `runtime-regressions.log` and
`legacy-review/diagnostic`) and
`D:\Desktop For Step Code\output\playwright\theme-composition-contract`.
The two isolated verification builds under the shared D: release directory
each contain about 7.37 MiB of owned files and link three immutable runtime
directories. No installer was produced and no existing artifact was deleted.
The owner's checkout, running package, profile, Remote binding and shortcuts
are unchanged. These checks do not establish cloud CI, native macOS, installer,
real-model or release acceptance.

## 通用插件市场信息（2026-11-09）

通用市场卡片与详情页新增作者、DFSC 语义化版本要求、必需/可选外部准备项，
并将作者与适配维护者分开。缺省依赖声明不等于无需依赖；没有可信下载统计时
显示「暂无统计」，不使用作者自报数字或 GitHub Star 替代。
发现页候选的版本、作者、要求和文档保持同一来源，已安装版本另行标注；
配置和工作区入口仍绑定实际安装副本。此轮不是 Hermes 业务适配，
没有新增依赖检测、安装脚本、执行权限或统计遥测。

本地已确认：

- 类型检查、生产构建和 `git diff --check` 通过。
- 元数据、包投影、工作区声明、文档与展示的 7 个定向测试文件共 54 项全部通过，
  使用 Node 24.16.0 串行运行，没有跳过。
- 元数据浏览器验收 17 组通过，包括中英文、明暗主题、1440/900/390px、
  长作者/依赖换行、真实键盘焦点四边可见、安全链接和候选/安装副本分离。
  完整插件中心浏览器验收通过；新增检查由既有 CI 验收入口调用。
- 实际主渲染器注入桥接的 11 组验收通过；CI 清单、运行器和策略测试共 31 项，
  30 项通过、1 项既有平台跳过。
- 生产 Electron 主进程、preload、渲染器与真实本地 Git 市场的 9 组验收通过，
  其中 8 项元数据断言覆盖四个通用资源插件的市场/安装投影、真实客户端
  `0.6.0` 版本、必需/可选/空数组/未声明、作者缺省与未知下载统计。
  原有主视图、侧栏、独立窗口、配置引用、更新和卸载断言保留并通过。
  渲染错误与模型请求均为 0，退出码 0，确认剩余窗口 0；截图已目视检查。

同日按反馈完成徽标组件复验：作者署名仅保留人形图标与名称，
DFSC 版本和外部依赖摘要改为可复用的非交互徽标，版本徽标由卡片与详情共用。
声明来源与未检测本机环境的边界保留在提示、无障碍标签和详情中。
类型检查、生产构建、7 个定向文件的 58/58 项测试通过；
中英文、明暗主题和 1440/900/390px 的 17 组元数据检查、
完整插件中心浏览器验收及上述生产 Electron 9 组验收均重新通过。
本次没有重跑全量协议测试，原有全量失败仍保留如下。
复验证据位于同一证据目录的 `chip-polish\`：
`plugin-focused.log`、`browser\market-info\verification.json` 和
`electron\verification.json`。该目录共 20.63 MiB，未生成安装包或删除产物。

### 紧凑信息与依赖展开

同日参考市场信息层级调整：符合声明的版本仅显示 DFSC 与版本范围，
不再常驻绿色「版本符合」，不符合或无效声明仍明确警示。
外部依赖摘要改为独立按钮，就地打开锚定弹层；弹层与详情共用必需/可选
清单、安全链接和「作者声明，未检测本机环境」边界，不新增检测或安装行为。
卡片不再显示缺失下载量的占位，详情仍明确显示「暂无统计」。

- 类型检查、生产构建及 Node 24.16.0 下 7 个定向文件的 58/58 项测试通过。
- 完整插件中心浏览器验收与 19 组元数据检查通过，覆盖中英文、
  明暗主题、1440/900/390px、弹层上下翻转与边界、卡片布局不跳动、
  必需/可选清单、安全链接、四边焦点、Escape 焦点返回、再次点击、
  外部点击、焦点离开、关闭按钮、实际滚动及保留挂载时的停用清理。
- 生产 Electron 9 组、8 项元数据断言再次通过，版本为 `0.6.0`；
  渲染错误与模型请求均为 0，退出码 0、剩余窗口 0，确认干净退出。
  更新和卸载仍经过真实本地 Git 市场；卸载清理包含已展开的依赖弹层。
- 验收脚本等待原生弹层与触发器状态同步；直接后端卸载的用例使用既有
  「检查插件更新」路径刷新目录后核对移除，没有增加产品自动同步或放宽断言。

复验证据在 `D:\DFSC-Preview-QA\plugin-market-info-20261109\compact-revision`：
`plugin-focused.log`、`browser\market-info\verification.json`、
`electron-final\verification.json` 及截图。首次原生验收的失败证据保留在
`electron\`，最终通过结果以 `electron-final\` 为准。截图已目视检查。
该目录共 36.97 MiB；当前 dist 为 11.96 MiB，runtime 与 terminal-runtime
大小未变。本次没有重跑全量协议测试，也未生成安装包或删除产物。

随后完成统一标签视觉复验：版本与依赖使用相同高度、内边距、圆角和轻底色，
移除版本内部的分隔线、独立底色与等宽代码样式。警告仅保留一个前置图标，
整枚轻红提示并保留可见结论；依赖入口保留展开箭头和完整键盘焦点。
类型检查、生产构建、7 个定向文件的 58/58 项测试、完整插件中心浏览器验收
与 19 组元数据检查通过。中英文、明暗主题、1440/900/390px 矩阵新增
内部无分段边框/底色/内边距及两种标签尺寸一致的断言，截图已目视检查。
此轮未重跑原生 Electron 或全量协议验收，不将之前的原生结果计作本轮复验。
证据位于同一根目录的 `unified-chips\`，包括 `plugin-focused.log`、
`browser\market-info\verification.json` 与截图，共 7.20 MiB。
runtime、terminal-runtime 和 dist 大小未变；预览服务器保留，未生成安装包或删除产物。

**全量协议回归没有全绿。** 最初因新工作区未准备 runtime 而失败；
准备独立普通文件 runtime 后，使用本机 Node 24.15.0 的全量尝试挂在
`terminal-sessions`，仅核对并停止该次运行的进程。使用项目要求的 Node 24.16.0，
该文件单独运行 6/6 通过；随后有界全量重跑共 1821 项，
1807 通过、1 失败、13 项显式平台跳过。唯一失败为未修改的
`terminal-sessions.test.ts:84`：重试终止时报告
`Terminal did not exit after termination`。未放宽测试或修改终端逻辑，
独立运行通过不能替代全量结果，失败原因未在此轮确立。

证据位于 `D:\DFSC-Preview-QA\plugin-market-info-20261109`：
`browser-final\market-info\verification.json`、`electron\verification.json`、
`protocol.log`、`protocol-runtime.log`、`protocol-runtime-node2416.log`、
`plugin-focused.log` 和 `terminal-sessions-node2416.log`。
验收结束后未发现本轮测试进程遗留，
本地预览服务器有意保留。当前可重建产物为独立 runtime 124.07 MiB、
terminal-runtime 62.96 MiB、dist 11.95 MiB；未生成安装包或擅自删除产物。
未提交、推送、发布、替换快捷方式，也未修改日常客户端、个人档案、
共享依赖或上游 checkout。本地结果不代表云端 Windows/macOS 或发布验收。

### 独立 PR 提交前复验

在主分支 `430843520acb182acb2cd01df185a6941169e0ec` 上完成整合，
保留上游的全局指令验收与插件窗口关闭时序修复。完整安装要求现在仅位于
「使用说明」标签页；配置齿轮直接进入配置，不被长声明挤下。
浏览器回归实际点击配置齿轮，再切回使用说明核对完整清单的位置。

先前全量运行的终端失败没有被单文件通过掩盖。检查发现两条故障注入测试的
真实重试固定使用 3 秒，绕过了生产已有的 Windows 10 秒终止预算。
这两处改用生产默认值，保留 50 毫秒故障注入、真实退出确认、ownership
保留和关闭去重断言；未修改生产终端逻辑。Node 24.16.0 下单文件 6/6 通过，
其中实际退出确认用例整体耗时约 5.8 秒。

本次已完成：

- 类型检查、生产构建和差异空白检查通过。
- 完整插件中心浏览器验收通过；元数据检查增加至 20 组，覆盖配置直达、
  候选/安装副本分离、统一标签、原生依赖弹层及关闭清理。
  中英文、明暗主题与 1440/900/390px 矩阵通过，窄屏详情与浅色弹层截图已目视检查。
- 完整生产 Electron 验收通过 9 组及 8 项元数据断言，使用真实本地 Git 市场、
  隔离 profile 和客户端版本 `0.6.0`，未加载 Hermes 包。
  渲染错误和推理请求均为 0，启动器退出码 0，剩余窗口 0，确认干净退出。
- CI 分类、清单、运行器、预构建及汇总测试共 50 项：49 项通过、
  1 项既有平台跳过，无失败。
- Node 24.16.0 下完整串行协议测试共 1834 项：1821 项通过、13 项显式平台跳过、
  0 失败，退出码 0，约 628 秒。两条终端真实重试及既有慢清理回归均通过。
  此结果取代前述失败运行作为当前提交的全量结果，原失败证据仍保留。

证据位于 `D:\DFSC-Preview-QA\plugin-market-info-20261109\pr-closeout`：
`typecheck.log`、`build.log`、`terminal-focused.log`、`protocol-full.log`、
`ci-policy.log`、`browser\market-info\verification.json`、
`electron\verification.json` 与对应截图，共 21.32 MiB。
测试父子进程及本轮原生/终端 fixture 均已退出，未发现遗留。

可重建产物盘点：当前工作区 `Desktop/runtime` 124.07 MiB、
`Desktop/terminal-runtime` 62.96 MiB、`Desktop/dist` 11.97 MiB，均为普通目录，
不是 junction。预览服务器有意保留，未生成安装包、删除产物、替换快捷方式、
重启日常客户端或修改个人配置。以上是本机 Windows 源码与隔离 fixture 验证，
不替代新 PR 的云端 CI、原生 macOS、真实账户或发布验收。

## 插件工作区验收就绪时序修复（2026-11-09）

PR #221 的 macOS 界面验收在 `verify-plugin-workspace.mjs:27` 失败：
按钮数预期为 4，实际为 0。测试页面在顶层等待图标 fetch 和 FileReader，
完成后才挂载 React；`page.goto()` 返回不代表这一步已完成。
本地拦住图标响应可稳定重现：导航已完成时按钮数为 0，
放行并等待插件按钮区挂载后为 4。

验收脚本新增这一受控慢加载回归，首次打开和单插件页面均等待按钮区可见，
损坏图标的回退断言也等待实际 SVG 出现。按钮数量、布局、隔离和错误检查
保持不变，未增加固定休眠、放宽断言或修改产品代码。

本地工作区验收 14 组、实际渲染器界面验收 11 组及类型检查通过；
CI 清单、执行器和策略测试共 31 项，30 项通过、1 项既有平台跳过；
`git diff --check` 通过。证据截图位于
`D:\DFSC-Preview-QA\plugin-ci-readiness-20261109`。
本机使用现有 Chromium headless shell 1243，未下载浏览器；
这不替代修复提交的云端 macOS 和打包验收。

## Generic Plugin Workspace Interaction Closeout (2026-11-09)

This closes the generic data-only workspace interaction layer, not a Hermes
business frontend or an arbitrary third-party frontend SDK. Main-view shortcuts
now toggle their visible workspace. Opening transfers keyboard focus into the
selected tab, or restores a still-visible enabled control when reopening.
Side panels and native windows expose correctly named Close actions instead of
claiming to return to the workspace. Native window launchers are not announced
as pressed main-view toggles. Conversation drafts and reading state are retained.

Local evidence on the updated source:

- Typecheck, production build and whitespace checks passed.
- The complete protocol rerun passed 1,794 of 1,807 tests, with 13 platform
  skips and no failures. The first attempt had one Windows `UNKNOWN: read`
  failure in `plugin-configuration.test.ts`; its isolated eight-test rerun and
  the subsequent complete run passed without source changes to that module.
  The initial failure remains recorded; its underlying cause is not established.
- Component-browser and actual-shell injected-bridge verifiers passed.
  Light/dark, desktop/narrow and reduced-motion layouts were inspected, and
  keyboard tab focus outlines were measured on all four sides inside the
  clipping tab scroller. Reopening preserves the selected page, scroll and
  page-local focus; returning restores direct or overflow entry focus.
- The isolated native window verifier passed seven groups. The full production
  Electron verifier passed eight groups with a real local Git marketplace and
  four generic fixture plugins, not a Hermes package. It covers install,
  main/side/window routing, toggle/close/focus behavior, keyboard overflow entry,
  exact installed configuration routing, update/uninstall reference invalidation,
  denied unrelated IPC, native close/reopen independence and draft retention.
  It recorded zero inference requests, no renderer errors, exit code zero and
  zero remaining windows. Production light/dark main and narrow side screenshots
  were inspected.

Evidence is under
`D:\DFSC-Preview-QA\plugin-generic-closeout-20261109`, with final production
results in `electron-final\verification.json`, complete test results in
`protocol-recheck.log` and the first failure in `protocol.log`. The separate
native manager result is
`D:\DFSC-Preview-QA\plugin-windows-H0lTuE\verification.json`.

The prior PR head's Windows checks passed, but its macOS sessions acceptance
timed out in `verify-mini-chat-electron.mjs:675`. Those historical results do not
establish cloud acceptance of this new source. No native macOS, installed-client
upgrade, installer, release or Hermes/Feishu business-flow acceptance is claimed.
The owner's running application, personal profile, credentials, shortcut and
upstream runtime checkout were not changed.

## Global Instructions (2026-11-09)

Settings > Global instructions edits native global context in the Desktop-owned
`step-runtime/agent/` directory, normally `AGENTS.md`. Reads and saves follow
native context-file precedence, preserve existing fallback files, validate UTF-8
and size, reject linked files/directories, serialize app writes, and compare an
opaque revision before atomic replacement. Conflicts retain the local editor
draft. The default is empty; Clear requires Save. These plaintext instructions
are model-visible preferences, not credential storage or permission enforcement.

Saving does not interrupt or hot-reload resident conversations. Newly started
runtime processes load the current native global context, including restarted
and cold-restored histories; resident navigation retains its existing context.
Changed saves exclude older empty workers from new-session reuse. Product,
Desktop collaboration and project rules remain present, and user messages and
permissions are unchanged. No new enforced instruction hierarchy or
model-obedience guarantee is claimed.

The implementation was isolated from the old shared release worktree, adapted
to main `6edeb18`, then rebased onto the plugin-workspace merge `9e493ed`.
The editor state is retained above the keyed settings content,
preserving the single content container, existing category transitions and
unsaved text across tabs. The dedicated acceptance is registered in the shared
Windows/macOS CI session inventory; only local Windows execution is claimed.

On the initial `6edeb18` base, typecheck, production build and 104 focused
store/runtime tests passed. The full serial unit/protocol run completed 1,797 tests: 1,784 passed, 13
platform-specific tests skipped and none failed. CI inventory/runner regression
completed 25 tests: 24 passed and one POSIX-only test skipped. Electron checks
passed for global instructions, proposed new sessions, settings-dialog layout
(including the new category), concurrent sessions and account settings.
The build retains existing bundler warnings.

After rebasing onto `9e493ed`, typecheck/build, 123 focused store/runtime/IPC/plugin
tests and the same CI runner regression passed again. The five Electron checks
above were repeated against the rebuilt source. The complete unit/protocol suite
was not repeated after that rebase; its 1,797-test result belongs to the prior
base and does not cover the newly merged plugin-workspace tests.

The isolated Electron acceptance uses the existing staged v0.1.7 Step runtime
and a local HTTP/SSE provider. It inspects actual system requests for global,
project, product and Desktop rules and unchanged user text. It covers old empty
workers, unchanged running sessions, cross-project/new independent sessions,
restart with preserved identity, clearing, strict IPC validation, external-edit
conflicts, full app relaunch with cold history restoration, keyboard focus and
light/dark/640px English layout. Four-sided focus indicators are checked against
clipping ancestors. Screenshots and results are in
`Desktop/test-results/global-instructions-{light,conflict,dark-narrow-en}.png`
and `global-instructions-results.json`.

This is source-only local fixture acceptance, not paid-model instruction-following
acceptance, native macOS execution, installer validation or a public release.
Upstream source, personal CLI profiles, the user's application/shortcuts and
existing packages were not changed. No installer was generated or deleted.

Artifact inventory: this isolated worktree's `Desktop/dist` totals 12,511,607
bytes (about 11.93 MiB). The six instruction acceptance profiles created during
PR preparation total about 53.87 MiB. Small screenshot/JSON/log evidence and test
profiles were retained; existing packages were neither duplicated nor deleted.
## 管理 worker 异常退出后的应用关闭回归（2026-11-08）

PR #219 的 P2 已复现：管理 worker 缺少有效 shutdown 确认时，
即便进程已经退出，后续 `CapabilityService.stop()` 仍会失败，
导致 `before-quit` 无法执行 `app.quit()`。

仅在服务关闭路径接受 `RpcManagementStopError.exitConfirmed === true`，
释放已退出 worker 的所有权；不改严格的 `stopManagement()` 确认规则，
不清除管理写入隔离或 runtime 保护。仍存活、退出未确认或仅伪造同名字段
的错误继续阻止关闭，并保留所有权以便重试。

退出、管理策略、Remote 保持、主题证明、诊断与运行时门禁共
9 个测试文件的 203 项回归全部通过，类型检查及空白检查通过。
真实隔离 Node 子进程覆盖意外退出、错误确认 ID、无确认、非零退出，
以及错误确认后仍存活、随后实际退出再重试的场景。
这是本地源码证据，不代表新提交的云端 CI、打包客户端或真实账号验收；
未改作者运行包、档案、Remote 绑定和快捷方式。

## CI Electron Download Preparation (2026-11-08)

On `32cd89a`, both platforms passed canvas preparation and normal upstream
installation. macOS's candidate job passed all upstream tests, typecheck,
protocol tests, packaging and resource checks. This is not a complete macOS
acceptance: its separate runtime acceptance job failed while freshly
downloading Electron with HTTP 504. Windows sessions stopped at the same
Electron download; the other Windows groups passed protocol tests and started
their Electron acceptance.

The next CI-only correction prepares the unchanged Electron 44.4.5 official
archive through the same finite Release/API downloader. It reads the installed
package's checksums and uses the actual `@electron/get` cache implementation,
then keeps the original installer and its checksum validation enabled.
No dependency version, mirror, product behavior or acceptance gate changes.

The combined local CI/preparation regressions pass 49 tests with one existing
POSIX-only skip. YAML parsing and whitespace checks pass. An initial local
fresh-download probe encountered unauthenticated API rate limiting. After the
observed reset, a new official API download into an isolated Windows cache
matched the published package checksum. The real `@electron/get` validates and
returns that cache entry without another downloader call. This does not
establish fresh cloud download, archive extraction or app acceptance. Evidence is in
`Desktop/test-results/host-closeout-electron-prebuild.log`,
`Desktop/test-results/host-closeout-electron-cache-smoke.log` and
`Desktop/test-results/host-closeout-ci-prebuild-regression.log`.
Both platforms must still complete acceptance on the newly pushed head.

## CI Official Canvas Prebuild Preparation (2026-11-08)

The repaired #219 head's two cloud attempts stopped before protocol tests:
the installer did not obtain `canvas@3.2.3` prebuilts, then native fallback
failed on Windows Visual Studio discovery and missing macOS `pangocairo`.
The matching official Windows x64 and macOS ARM64 assets exist. The
install site does not establish the underlying reason for their failed
retrieval, and this is not evidence of a global GitHub outage.

Both CI setups now prepare the same official archive with finite HTTPS
download deadlines, two retries per endpoint and the official asset's pinned SHA-256.
The `585b359` cloud attempt explicitly confirmed repeated Release HTTP 504
on macOS. A fallback uses the same fixed official GitHub API asset ID and
digest, not a mirror; both API assets were independently downloaded locally
and matched the original digests.
The original frozen-lockfile install and its normal native installation
lifecycle use the supported local-prebuild directory. A corrupt cache,
failed download or mismatched checksum fails preparation. Dependencies,
runtime pins, mirrors and acceptance requirements are unchanged; Windows
diagnostics name this preparation stage.

Local policy, runner, receipt, diagnostic and preparation regressions pass
47 tests with one existing POSIX-only skip. Both official archives were
downloaded and their SHA-256 values verified. A separate Windows fixture
using the actual `prebuild-install@7.1.3` installed from this archive without
an HTTP request, loaded `canvas@3.2.3`, rendered the exact expected RGBA pixel
and encoded a PNG. Evidence is in
`Desktop/test-results/host-closeout-ci-prebuild-regression.log` and
`Desktop/test-results/host-closeout-canvas-smoke-20261108.log`.

This establishes local preparation and Windows native loading only, not
fresh cloud installation, macOS execution, full protocol or package acceptance.
Those must pass on the new pushed commit. The owner's application, shortcut,
real configuration and Remote binding are untouched; no installer is built.

## Capability Management MiniChat Main Synchronization (2026-11-08)

Main advanced to `35e2322` with #211 while the temporary-path repair was being
pushed. PR #219 then conflicted and no repaired-head Actions run was scheduled.
The merge retains main's MiniChat sender allowlist, renderer-generation checks,
navigation guard and one-shot composer submission, together with this branch's
management leases, passive-read boundaries, retained runtime barriers and
sanitized diagnostics. Surface selection remains the third `handle` argument;
the optional capability phase marker is the fourth.

The 112 focused worker, library, actual-main IPC, MiniChat draft/session and
composer regressions pass. New actual-source IPC cases cover rejected MiniChat
management, rejected subframes, passive theme reads, surface/marker forwarding,
one submission per receipt, renderer reload and shared-settings navigation
guards. Typecheck and another isolated production build pass. No runtime pin,
running package, real profile, Remote binding or shortcut is changed.

An additional local full protocol attempt is not a pass: native background
fixtures encountered `Runtime process-tree termination failed (1)` and remained
open. A single-case probe confirmed the same Windows cleanup failure; only
verified test-owned descendants were stopped, and the broad run was aborted.
Evidence is in `Desktop/test-results/host-closeout-native-background-probe.log`
and `Desktop/test-results/host-closeout-protocol-repaired.log`. The failure is
kept separate from the now-passing temporary-path regression. Cloud full-suite
and packaged acceptance must still complete on this integrated head.

## Capability Worker Temporary-Path CI Repair (2026-11-08)

PR #219's first Windows run `42461106594` and macOS run `42461106591`
failed the same 15 new VM harness scenarios before packaged acceptance.
The fixture used an uncanonicalized temporary profile, which existing linked
path guards correctly rejected. A differently cased Windows temporary path
reproduced the same `capability:invalid-path` failure locally.

Only the test harness changes: canonicalize its owned temporary profile and
parent cleanup boundary, preserve the platform's `TMPDIR`, and exercise reads,
initialization, theme replacement and cleanup through a real temporary-directory
alias. The new regression fails before the correction and passes afterwards.
All 28 worker/library tests pass, including rejection of aliased product file
access, and all 16 worker tests pass with differently cased Windows temporary
paths. Typecheck passes. No product path guard, runtime source, assertion or CI
workflow is weakened or skipped. Cloud Windows/macOS acceptance still requires
a successful run on the repaired head; these local results do not establish it.

## Capability Management Main Synchronization (2026-11-08)

The closeout combines the local capability-management and Remote cleanup
repairs with main `20774ca`, retaining #213 crash-log redaction and #214 linked
path guards. Both branches' earlier evidence remains below; those dated
entries are historical observations, not statements that supersede this
combined verification.

The combined source `71f4c74` passes typecheck, an isolated production build,
691 focused capability/plugin/Remote/path/log regressions, and 148 additional
runtime ownership, background, Cron, side-question, provider and quit tests.
The separate native RPC suite passes 11 tests with two POSIX-only skips,
including confirmed process exit/restart and streamed-session restoration.
CI policy, inventory and runner self-tests pass 39 cases with one platform
skip. A new regression preserves correlated Git metadata through main's
crash-log redaction without publishing the original failure payload.

The isolated Electron verifier passes all 12 scenarios with no renderer
errors and confirmed owned-process cleanup. Single and partial Git failures
retain their real exit code and elapsed time; a healthy market advances and
an explicit refresh after source restoration succeeds. Native/Remote worker
identity and the binding survive theme/market maintenance, including while a
peer streams; executable-plugin removal is still refused. Desktop and narrow
screenshots are inspected.

Evidence is in `Desktop/test-results/host-closeout-focused.log`,
`Desktop/test-results/host-closeout-runtime-guards.log`, and
`Desktop/test-results/host-closeout-electron-20261108/results.json`.
Native RPC evidence is `Desktop/test-results/host-closeout-rpc.log`.
The isolated build has about 7.6 MB of its own files and links immutable
runtime directories; no shared runtime is restaged. The owner's running r2
package, real profile, Remote binding and shortcut are not switched or
modified. No new distributable, cloud CI, native macOS, real-account or release
acceptance is established by these local checks. The original occasional
market-refresh failure and Windows process-tree termination failure remain
unresolved as root-cause claims.

## Marketplace Refresh Failure Evidence (2026-11-08)

The owner's earlier `marketplace-update` diagnostic `6ad7692a50bd` identifies
the mutation phase but predates structured Git diagnostics. Its underlying
cause remains unknown. Later terminal, worker-environment and actual-app
refreshes succeeded; that does not establish whether the original failure
was connectivity, locking, permissions or another transient condition.

Git discovery refresh now retains fixed failure categories for network, DNS,
proxy, certificate, authentication, unavailable source, missing Git, cache
permissions, locks, non-fast-forward/local-change conflicts, timeouts,
cancellation and output limits. Unknown output stays generic. The Desktop
worker executes the existing `git -C <cache> pull --ff-only --quiet` command
with its 120-second deadline and bounded output. It neither retries
automatically nor changes proxy settings, credentials or the runtime pin.
Callback completion alone cannot release a cancelled child: actual process
close is required, including when the abort callback arrives first.

Only allowlisted metadata crosses the worker/main diagnostic boundary:
operation, integer elapsed milliseconds, actual Git exit code, permitted
signal and permitted system code. Raw subprocess output is used locally for
classification, not sent to the renderer or capability logger. Main rewraps
errors without losing these validated fields. Existing crash-log application
paths and stack metadata are unchanged; this is not a claim that every field
in the existing crash format is anonymous.

Single-market failures retain a localized message and correlated diagnostic
ID. Check-all continues refreshing healthy sources, logs each failed source
separately and replaces its internal failure payload with a localized warning
and diagnostic ID. Installed plugin packages are not updated by either
discovery operation. Remote/runtime ownership, journal protections and
management-worker shutdown barriers remain in force.

Typecheck and the isolated production build pass. The final serial focused
suite passes 439 tests with two POSIX skips (441 total), covering native
market/plugin management, Remote ownership, staged-copy races, process
shutdown, classification, privacy and RPC/main transport. It includes real
missing-Git, child exit/timeout/cancel, local Git fast-forward, dirty-worktree
preservation and held-index-lock cases. The exact main IPC rewrap has a
regression for validated metadata retention and rejection of extra fields.
The final log is `Desktop/test-results/marketplace-refresh-focused.log`.
CI policy, inventory and platform-runner self-tests pass 39 cases with one
native-platform skip; this is local CI-tooling verification, not a cloud run.

The source Electron verifier passes all 12 scenarios with no renderer errors
and confirmed exit of every owned fixture process. A deliberately unavailable
local Git source produces localized diagnostics for both single refresh and
check-all; their logged exit code matches the independently observed Git
status, not an assumed 128. The healthy source advances, installed theme bytes
remain unchanged, and an explicit refresh succeeds after restoring the source.
The native and Remote child objects, PIDs, session/model/permission identity
and single binding remain intact through failures and subsequent streaming
management operations. Unrelated executable removal is still refused.
Desktop and narrow screenshots are inspected. Evidence is
`Desktop/test-results/marketplace-refresh-source/results.json`.

Verification uses an isolated source build, temporary profiles, local Git
repositories, a loopback model and synthetic Remote transport. The running
owner package and real profile are not switched or rewritten. These source
changes are not yet in the owner's running r2 package; no new package,
shortcut update, push, cloud CI, native macOS or real-account acceptance is
claimed.

## Independent Capability Management Phase 1 (2026-11-08)

This section supersedes the source-policy and temporary host-blocker statements
in the earlier 2026-11-08 entries below. Controlled Windows child-process probes
can terminate successfully, but packaged acceptance also observed an intermittent
process-tree termination failure recorded below. No host service was changed.

The host selects an exhaustive trusted action policy. Marketplace discovery
maintenance and independently proven data-only theme install/update/remove use
a management lease without acquiring the global runtime settings lock or
requiring idle sessions. Executable plugins, runtime settings and unknown
capabilities retain conservative idle, Remote and resource-usage checks.
Renderer hints never authorize an exception. The native worker revalidates the
complete package; updates require proof for both installed and candidate copies.
Builtin-market initialization no longer creates or flushes runtime configuration.

Catalog, document and configuration reads do not initialize or recover storage,
nor trigger pending provider application. Recovery is separately guarded for
the actual journal owner, rechecks idle after asynchronous resource observation
and binds writes to the exact journal digest. Market discovery does not refresh
theme packs or persist appearance fallback. Management-worker shutdown requires
both a matching acknowledgment and observed clean exit; unconfirmed cleanup
quarantines further management operations. An uncertain executable writer or
unfinished admitted runtime recovery also retains the runtime barrier for the
rest of this process, including when its worker has exited normally. Recovery
failure is not permission to retry blindly or continue runtime input.

Typecheck and the isolated production build pass. The final focused run passes
164 policy, gate, asynchronous-race, worker-proof, lifecycle, finalization,
read-only, document, snapshot, usage, error and staging tests. The separate native
capability-management and Remote-preservation run passes 91 tests, including
Windows directory locks, busy-state matrices and a proven theme update retaining
worker/RPC/session and installation identity. Earlier broader session, background,
Goal, side-question, Remote and settings regressions also pass.

Source Electron acceptance passes all nine scenarios, with no renderer errors
and confirmed cleanup of every owned fixture process. It installs a theme and
reads its guide with Remote bound, refreshes both discovery paths without
updating the installed package, then performs UI market refresh/removal and
theme removal/reinstallation while the original peer streams. Executable
plugin removal remains disabled and the backend independently refuses it.
Windows directory locks report a bounded diagnostic and permit retry after
release. The original native/Remote child objects, PIDs, native generation,
session, model, permission and single binding remain unchanged, and Remote
subsequently submits a new loopback task. Desktop and narrow screenshots are
checked; the report is
`Desktop/test-results/capability-phase1-source/results.json`.

The fixture uses a temporary profile, a local Git market, a loopback provider
and synthetic Remote transport; it cannot establish real-account Feishu
permissions or cloud-platform behavior.

The unsigned, unpublished Windows directory package
`Desktop/release/capability-management-phase1-20261108-preview-r2/` now contains
these changes. Its 107 bundled files pass build-time verification; all 1,427
resource files and the executable pass hash verification again after acceptance.
The actual packaged executable passes the same nine scenarios with no renderer
errors and confirmed fixture cleanup. Packaged terminal acceptance also passes
real PowerShell/ConPTY, Chinese paths, environment isolation, light/dark/narrow
screenshots, motion and owned child-process cleanup. The package contains
`source-receipt.json`, `SHA256SUMS.txt` and `acceptance/summary.json`.

The predecessor package's first attempt completed all nine functional scenarios,
but failed cleanup when `taskkill` for its synthetic Remote helper exited with
code 1. Its failed report is preserved, and identity-checked retry followed by
orderly fixture exit was confirmed. Investigation exposed a separate ownership
defect: Remote discarded its helper reference before stop confirmation. Remote
now revokes authorization immediately but retains cleanup ownership after a
failed stop, retries that same transport, and blocks replacement pairing/resume
until cleanup and disconnect persistence finish. Failure publishes
`error/transport` without restoring the binding, keeping the existing runtime
status page's disconnect retry reachable. In-flight stop calls are joined.
The final Remote/quit regression run passes 309 tests, including deterministic
stop rejection, repeated failure, concurrent shutdown, late input/approval and
delayed persistence cases. Another focused management run passes 137 tests.
This does not claim to fix Windows' intermittent process-tree termination
failure. The final r2 packaged run completes cleanup on its first attempt.

No installer, shortcut change, real-profile mutation or owner-application
restart was performed. This independent repair package does not include
MiniChat PR #211. Cloud CI, native macOS, installer and real-account Remote
acceptance remain unestablished.

## Remote-Preserving Theme Installation (2026-11-08, Pending Native Acceptance)

Owner diagnostic `3ac953dbd02a` is `plugin-install`, refused as
`remote-attached` at `idle-check` by the refresh preview. It is not a repeated
market-refresh failure, nor evidence of a filesystem error.

The source now classifies an issued, recorded available-package reference
using the same bounded data-only theme proof as removal. The source and
fingerprint are frozen before the guard; the management worker rechecks the
staged copy before writing receipts or publishing the installation. Missing
references, unknown/executable declarations and pending recovery fail closed.
An interrupted update appearing after the guard is refused without catalog
recovery. Existing all-session idle checks are retained.

The plugin detail reader is unmounted during its own mutations and reloaded
afterward. A failed mutation also refreshes the catalog without clearing its
diagnostic, since a management failure may invalidate document references.
The owner's screenshot alone does not establish the document failure's cause.

Typecheck, the isolated production build and 42 focused classification,
diagnostics, usage and synthetic-filesystem snapshot regressions pass. The
native staged-copy snapshot test also exercises runtime-preserving pure-theme
installation and refusal of executable, non-theme and replaced candidates.
Native process regressions currently cannot complete: the host's
`taskkill.exe /PID <controlled-child> /T /F` returns exit 1 with an operation
canceled error even for a synthetic child. Tests fail during management-worker
termination, not a confirmed theme classification assertion. Only identified
task-owned test processes are stopped; the owner's running app, real profile,
Remote binding, shortcuts and host services remain untouched. This source
change is not yet packaged or accepted for handoff.

## Remote-Preserving Market Refresh (2026-11-08)

The next owner diagnostic is `marketplace-update`, refused as `remote-attached`
at `idle-check` by the preceding removal-only preview. Market refresh was
omitted from that preview; this is not evidence of a filesystem failure.

The Remote-preserving classification now includes explicit market add,
refresh, removal and check-all-updates actions. None installs a candidate or
restarts a session. The existing all-session idle and shared-settings guards
remain. Pending, unreadable or ambiguous plugin-update recovery state denies
the exception; the native worker also refuses recovery that appears after
the guard, before changing any installation. Renderer-supplied flags do not
authorize executable plugin mutations.

Typecheck, 98 distinct focused tests, production build and source Electron
acceptance pass. The isolated
native fixture uses an offline Git market, binds Remote, verifies both explicit
refresh and check-all advance the discovery copy without changing the installed
theme, then retains the existing removal, file-lock, busy-session and subsequent
Remote-input coverage. Renderer errors are empty. The owner's current app,
profile and shortcut are untouched. These additions are not yet repackaged
or integrated into the separately running MiniChat preview; the earlier
portable package must not be presented as containing this refresh correction.

Subsequently, the unsigned, unpublished independent Windows directory package
`Desktop/release/remote-market-refresh-20261108-preview/` is built from this
repair checkout. Its 107 bundled files and 1,427 resource files pass integrity
checks. The same verifier passes against the actual packaged executable with
`app.isPackaged === true`, including both Remote-bound market refresh paths,
the removal checks and subsequent Remote submission through the same worker.
Renderer errors are empty. Acceptance uses a temporary profile, an offline Git
market and a loopback provider, not a real account. This package does not
include MiniChat PR #211. No shortcut is changed, no owner application is
restarted, and no real profile or Remote binding is modified. Cloud CI, native
macOS, installer and real-account Remote acceptance remain unestablished.

## Remote-Preserving Theme Removal (2026-11-07)

The owner's diagnostic build identifies both failed actions (`plugin-remove`
and `marketplace-remove`) as `remote-attached` at `idle-check`, before resource
checks or filesystem mutation. This establishes the current refusal's cause;
the earlier controlled Windows directory lock was not its diagnosis.

Capability mutations now retain Remote only when removing a marketplace
discovery copy or a uniquely identified, data-only `stellar-v1` theme. The theme
proof reads bounded, link-free files, rejects executable, nonempty resource and
unknown declarations, and freezes the package fingerprint. The management
worker revalidates that fingerprint before revocation or deletion. The guard
and mutation share the capability-service queue and the existing main-process
shared-settings lock; incoming Remote submissions cannot start during it.
No runtime is restarted or detached. Host-stopping operations cannot opt out
of Remote ownership, and ordinary plugin changes remain protected.

Task, queue, approval, background, side-question, Goal and MCP-observation
guards remain in force. Focused regressions cover those negative cases,
ambiguous installations, links, stale files and renderer-supplied flags.
Typecheck, production build and portable package integrity checks pass.
The actual packaged Electron verifier binds an isolated offline Remote,
refuses unrelated resource changes and busy-session deletion, exercises real
Windows file-lock failures and retries, removes both resources without
dropping the binding, then receives a new Remote input through the same worker
and a loopback model. Renderer errors are empty.

The unsigned, unpublished replacement is
`Desktop/release/plugin-removal-remote-fix-20261107/`; evidence and source
receipt accompany it. The owner's application, binding, profile and shortcut
are untouched. Real-account Remote, current cloud CI and macOS acceptance are
not established by these local results.

## Plugin Removal Failure Diagnostics (2026-11-07)

Capability mutations retain the existing trusted-sender, shared-settings,
all-session idle and plugin-resource guards. Failures now expose allowlisted
blocker or filesystem codes and a diagnostic ID instead of collapsing every
refusal into the same generic message. Correlated local logs contain a fresh
sanitized error, the allowlisted action, operation phase and code; original
errors, plugin inputs, source URLs, credentials and session content are not
forwarded to the logger. Existing crash-log metadata is unchanged.

Local Windows verification passes typecheck, an isolated production build and
172 distinct focused tests covering diagnostics, native capability management,
session ownership, plugin configuration, races, marketplace themes and runtime
staging. The staged runtime includes the new failure classifier. No upstream
runtime pin or patch manifest changes.

The production Electron verifier uses a temporary profile and a loopback
provider. A task in another session disables both removal buttons; direct IPC
removal requests are still refused and correlate with local diagnostics.
Windows child processes holding plugin or marketplace directories reproduce
filesystem failures through the real management worker and UI. Both operations
succeed after releasing the holder, and removing a marketplace preserves its
installed theme. Desktop and settled narrow-window screenshots, text bounds,
diagnostic correlation and zero renderer errors pass. The verifier is assigned
to the shared interface CI group.

Evidence is under `Desktop/test-results/native-build/Desktop/test-results/`
`capability-diagnostics/` in the isolated repair checkout. The full suite,
current cloud CI, native macOS and installer acceptance are not established.
The owner's live profile and running preview are unchanged. Its earlier removal
failure remains unexplained: controlled reproduction of a directory lock does
not identify the cause in that profile. The running build needs a separately
authorized update before it can produce these diagnostics.

An unsigned, unpublished Windows portable diagnostic preview is subsequently
built from `e419143435dc` plus the uncommitted repair changes. Its 107 bundled
files and 1,427 resource files pass package integrity checks against the
isolated source build. The fixed upstream runtime and reviewed manifest are
reused, and Desktop management adapters are synchronized with this checkout.
The same diagnostics verifier passes against the actual packaged executable
with `app.isPackaged === true`, a temporary profile and a loopback provider.
Package evidence is in `acceptance/capability-diagnostics/` beside its source
receipt. This is not a full release or proof of the owner's earlier failure.
The packaged native PowerShell terminal verifier also exits successfully,
including its light/dark/narrow and motion checks. CI policy and inventory
regressions pass 39 cases with one native-platform skip.
The running application, primary shortcut and real profile are not switched
or modified. Manual launch without the test override uses the normal profile;
the temporary-profile guarantee applies only to automated acceptance.
## PR #211 First-Run IPC Polling (2026-11-08)

Head `95997df` passes the Windows runtime and sessions groups, but macOS
interface job `128660255985` still reads the first session before it exists.
The event ordering predicate alone was insufficient: Playwright 1.60 browser
polling treats its async callback's Promise as truthy and resolves even when
the eventual predicate result is false. The awaited event condition therefore
was not actually being polled.

First-run acceptance now waits for the completed run with a synchronous browser
predicate and uses the existing `waitForSessionFixtureSnapshot` Node poller for
resolved IPC state, both before reading the saved reply and when restoring Ask
permissions. No sleep, file-read retry, weakened history assertion or expanded
timeout is added. A TypeScript-AST regression rejects async browser pollers in
this verifier and requires awaited snapshot polls. The existing helper tests
cover false async results, delayed snapshots, timeout and IPC failure.

All 35 focused shutdown/onboarding/polling tests pass. The immediately preceding
full suite on Node 24.16.0 with `CI=true` reports 1,511 passes and 19 platform or
resource skips, with zero failures; the added AST guard has separate evidence.
The corrected first-run verifier passes three consecutive native Windows runs
through `runGroup` / `executeScript`, with the same Node version and `CI=true`
(81.19, 79.51 and 74.83 seconds). Each includes durable reply, exact restored
session identity, permissions and the remaining onboarding scenarios.
Replacement cloud checks remain required for the final commit.

## PR #211 Windows Shutdown Wait Cycle (2026-11-08)

The first lifecycle repair did not resolve Windows run `42454598542`.
Running the verifier directly passes locally, but running the same verifier
through `runGroup`/`executeScript`, with CI's Node 24.16.0 and `CI=true`,
reproduces the 30-second shutdown timeout. The launcher exits 0 and no owned
application processes or windows remain, while every inherited launcher pipe
stays open and the actual browser-context close event has not arrived.
`context.isClosed()` is true here because closure has started, not completed.

Requiring context closure before releasing exited-launcher pipes creates a wait
cycle. Pipe release now requires successful launcher exit and closed windows,
and remains deferred until page/exit event delivery finishes. Separately,
`closeDesktopFixtureAndWait` explicitly awaits the real context close event
alongside driver completion and process exit. A successful exit or an already
closing context cannot substitute for that event. Driver errors, missing close
events and the unchanged 30-second deadline still fail.

The same launcher also reproduces a first-run read before the session file
exists, despite the earlier runtime-only settled checkpoint. The fixture now
tracks `agent_start`, the expected reply's `message_end`, and a subsequent
`agent_settled` for that runtime. A prior idle event or a streamed message whose
temporary stop reason is already `stop` cannot satisfy completion. The saved
header/reply and exact session identity after relaunch remain mandatory.

The new inherited-pipe/context wait-cycle regression fails with the previous
helper and passes with this repair. All 28 shutdown/onboarding tests and
typecheck pass. Four native `then_run` checks through the actual CI launcher
pass, including RPC/UI, orderly controller/context/process closure and
subsequent native shell probes. First-run native acceptance through that
launcher also passes with the ordered completion checkpoint.
Cloud verification for the final head remains required. Diagnostic logging
contains only fixture PIDs, process names/parent IDs and pipe lifecycle state,
not command lines, credentials or environment values. No production behavior,
runtime pin, package, shortcut or running user application changes.

## PR #211 Acceptance Lifecycle Repair (2026-11-08)

Merged head `35f4b73` failed macOS source `verify-first-run.mjs` at history
restoration and Windows `verify-then-run.mjs` during controller shutdown after
all functional assertions passed. Windows reported launcher exit 0, a closed
context and zero windows, but the driver close did not settle within 30 seconds.

The fixture pipe guard now defers disposal until the close event has finished
dispatching, then rechecks the successful launcher exit, actual context close
event and all closed windows. The original implementation fails the new
remaining-close-listener regression; the repaired implementation passes it.
Cancellation of a scheduled release also has a regression. Driver errors and
stalls remain failures, and neither the 30-second bound nor CI inventory changes.

First-run acceptance now observes the matching runtime's `agent_settled`,
checks the saved JSONL header and completed reply, and waits for both controller
closure and successful launcher exit before reusing the profile. Relaunch must
still list exactly one session with the original identity. These checkpoints
distinguish incomplete persistence from shutdown or discovery failure instead
of relying only on visible text and a streaming flag.

Local typecheck, all 27 shutdown/onboarding unit tests, source first-run native
acceptance and source `then_run` RPC/UI plus native command probes pass.
The unmodified native verifiers also passed locally, so those local results
alone do not establish the cause or resolution of every intermittent cloud
failure. Replacement Windows/macOS cloud checks remain required. No production
behavior, runtime pin, package, shortcut or running user application changes.

## PR #211 Main Synchronization (2026-11-08)

Merge main `20774ca` after #214's linked-path guards and fixture cleanup.
The only conflict is concurrent top-level additions to this document; retain
both complete histories. Mechanical section checks preserve all 260 sections
from the previous MiniChat head and all 255 sections from main without altering
their text. Runtime pin and MiniChat behavior are unchanged by this resolution.

Typecheck, production build and whitespace checks pass. The focused suite
reports 70 tests: 56 pass and 14 capability-worker failures at Windows process
termination. An isolated catalog retry has the same termination failure.
CI policy/inventory tests report 14 pass and one Windows process-tree cleanup
failure. These are failed local runs, not acceptance passes: native `taskkill`
against an exact owned fixture also exits 1 with `Unspecified error`, and
independent WMI process queries fail with the same diagnostic. Only verified
test-owned leftover processes are stopped to drain the failed test runners;
no product/test workaround or Windows service change is made.

Previous head `bb6e088` passed both full Windows and macOS cloud gates; those
results do not establish this merged candidate's status. New-head cloud and
native acceptance remain separate. No package, installer, shortcut change,
runtime restaging or user-application restart is part of this conflict fix.

## MiniChat Project Picker (2026-11-08, Local)

The titlebar conversation picker now uses an anchored native popover with
project groups, cross-project search and a separate independent-session group.
Current-project expansion, counts, duplicate project paths and project-specific
Plus actions use existing catalog/typed IPC. Search and disclosure state are
local to MiniChat; archives, session order and pinned project order are retained.
Retargeting an unsubmitted draft preserves its identity, input and options.
Popover dismissal only handles its own `toggle` event, not nested project
`details` events. Browser regressions collapse both current and other projects,
then select another project's session using mouse and keyboard in light/dark,
narrow/short and reduced-motion layouts. Native Electron repeats current-project
mouse collapse, another-project keyboard collapse and cross-project selection.

Shared text tooltips now use a manual native popover, keeping project Plus
hints above the picker without changing focus or intercepting clicks. Layer
acceptance compares decoded screenshot pixels with/without the tooltip over
the actual parent popover. Browser coverage includes light/dark, narrow/short
windows, hover/keyboard focus, duplicate-project paths, Esc, programmatic parent
closure, trigger removal and successful Plus clicks. Native checks repeat the
paint probe for hover and a keyboard-focused long temporary-project path.
Intrinsic width remains stable when switching from short to multiline hints;
focus-driven scrolling settles before tooltip placement. The shared Context
inspector regression also exercises ordinary multiline hover/focus hints.

Local typecheck, production build, 32 focused unit tests and the complete browser
and native MiniChat acceptance pass. The native fixture registers three actual
temporary projects (two named `web-app`) and independent history, selects a
same-title session by its project, creates a draft in an exact project, retargets
it to independent, and verifies the main worker and sidebar preferences remain
unchanged without invoking the model. Browser acceptance adds searchable long
lists, temporary expansion/restoration, empty results, keyboard/IME, outside/Esc
dismissal, light/dark/English, narrow/short windows and complete search focus
gutters. Screenshots are under `Desktop/test-results/mini-chat-preview/` and
`Desktop/test-results/mini-chat-native/`. These are local source receipts, not
packaged, cloud-CI, native macOS or real-account acceptance.

## MiniChat Navigation Geometry (2026-11-08, Local)

The native verifier reproduces the old scroll handle extending over the composer.
The fixed MiniChat keeps its scroll handle and turn ruler at the full-width
transcript's right edge, reserves space for text and bounds the session switcher
without consuming the header's drag region.
Native acceptance covers 360-, 900- and 1600-pixel windows, light/dark appearance,
wheel input over prose/markers/handle, handle dragging, exact turn location and
session-menu placement. Existing native MiniChat and main-conversation scroll
acceptance pass, alongside typecheck, build and 14 focused unit tests.
The browser fixture now includes the actual shared navigation components; its
complete acceptance passes using installed Chrome because the matching Playwright
headless-shell revision is unavailable. These are local source receipts, not a
new package, cloud-CI result or macOS acceptance.

## MiniChat Review And CI Follow-up (2026-11-07)

HTTP(S) message links in MiniChat now transfer its conversation, reading state
and pending draft to main before opening the existing native browser. MiniChat
does not gain browser listing/layout IPC. Reopening the same link explicitly
reveals the panel instead of toggling it closed. The real-runtime verifier uses
a loopback page and checks main navigation away from Remote, exact selected
session, retained input, native view visibility, repeated opening and no model
request caused by the handoff.

Specific workflow cards transfer their tool-call identity and reveal that run's
overview, including historical runs and repeated clicks. Bare `/workflows` still
opens the read-only saved catalog. Native verification checks both paths after
main navigates to another conversation. Its simultaneous-send check gates the
real draft-consumption IPC until both clicks arrive, preventing an automation
click from accidentally hitting a button that has already changed to Stop.

Returning from MiniChat also restores an expanded bottom terminal to its dock
before revealing requested content. Native workflow, `/todos` and web-link
handoffs verify the requested panel is visible, the conversation is not inert,
and the existing terminal process remains running.
Repeated file and individual subagent handoffs also explicitly reveal their
selected content; they do not inherit the main-window click-to-collapse behavior.
Native verification opens the same real Markdown file and subagent record twice.
MiniChat can read validated installed theme scenes and posters, but cannot mutate
plugins. Native acceptance copies the repository's Stellar pack into its isolated
profile, verifies both loaders, a ready scene or decoded poster, and rejected
uninstalled themes and plugin changes.
Side-question commands use the same availability and length checks in both
windows before clearing shared input. Native checks retain rejected new-session
and oversized questions, then exercise a valid main-window side-question handoff.
Provider refresh updates each distinct main/MiniChat draft and rebinds shared
identities after restoring options. Unit cases cover shared, MiniChat-only and
separate drafts; native acceptance deletes a selected loopback provider while
only MiniChat holds a draft and checks replacement models, input, task options
and successful first submission after an explicit model-picker selection,
without moving the main conversation or silently changing the billing route.
Project relocation refuses drafts held only by MiniChat until they return to
main, retaining their project, input and launch options. Unit cases cover an
independently selected main conversation or draft; native acceptance verifies
the actual IPC rejection without opening a folder dialog.
Cron authorization replacement retries transient file-sharing errors a bounded
number of times without deleting the previous file. Injected filesystem tests
cover successful retry, exhausted locks and non-retryable errors; failures still
surface and cannot start a host.

Windows startup now uses the same native `normal` topmost level as MiniChat;
source startup acceptance verifies the actual OS topmost state and disposal.

The old CI assertions now distinguish a restored nonempty draft (which pauses
the greeting) from an empty draft's per-character animation, hold both RPC and
event preference acknowledgements, and allow the macOS MiniChat button while
still rejecting Windows-style window controls. No script is excluded and no
runtime pin, product animation or preference synchronization is disabled.
The draft-clear check waits for the actual editor state and main-owned value
before reload, using editor keyboard transactions rather than DOM-only clearing;
the animation sample includes a complete greeting cycle.
Command dispatch retains mouse submission coverage, using Enter while overlay
inspectors may cover the send button on constrained native displays.
First-run acceptance waits for an idle runtime and committed assistant response
before relaunch, rather than an obsolete stop-button selector; its local provider
deliberately separates visible text from the final completion frame.
MiniChat resolves its temporary profile and session workspace before checking
fixture-only file writes, preserving containment across platform path aliases.
Fixture shutdown releases inherited launcher pipes only after the browser context
has delivered its close event, all pages have closed and the launcher exited
successfully. A merely closing context is insufficient; controller errors and
shutdown timeouts remain failures.
The browser-only MiniChat reading scenario holds its simulated completion until
the verifier releases it, so close/reopen-during-streaming assertions do not
depend on the machine finishing UI actions inside a short response timer.

Local typecheck, production build, browser MiniChat, native MiniChat,
new-session and appearance checks pass. All 28 draft/composer/greeting tests
pass; the 21 CI-runner tests have 20 passes and one platform skip. The complete
unit suite after main synchronization finished with 1,469 passes, 19 platform
skips and zero failures (1,488 tests). Workflow handoff and startup follow-ups
have additional native checks; that complete run predates those final edits.
These receipts do not substitute for current-head cloud, native macOS,
packaged or real-account acceptance.

## MiniChat Main Synchronization (2026-11-07, Local Candidate)

The candidate integrates main `e419143`, retaining Remote, Stellar presentation,
plugin recovery and both Remote/MiniChat runtime retention guards. Explicit
MiniChat Return now reveals the main conversation even when Remote, settings or
another full-page tool was open. Native acceptance covers Remote-to-conversation
Return and retains the message reading anchor.

Typecheck, production build, native MiniChat and command-dispatch acceptance pass
after synchronization. The shared CI inventory now includes the self-contained
MiniChat preview and native MiniChat verification. Native verification honors
`DESKTOP_VERIFY_EXE`, so packaged CI launches the candidate executable rather
than silently retesting source. The 27 Windows/macOS CI-policy tests have
26 passes and one platform skip; this is not native macOS acceptance.

The first integrated complete unit run finished 1,488 tests: 1,460 passes,
19 platform skips and nine failures. Eight were the extracted draft-setup
fixture missing main's newly added `capabilityService.recover` dependency; one
used the old locally staged admin adapter without compaction-settings RPC.
After updating that fixture and the worktree-local generated adapters, the
25 draft/composer tests and native compaction-settings test all pass. The full
integrated suite has not been rerun after those repairs; the earlier 1,136-test
complete pass below belongs to the pre-synchronization candidate. Cloud CI,
packaged/native macOS and real-account acceptance remain pending.
The synchronized browser-preview rerun could not launch because the local
Playwright headless-shell revision was absent. Its download did not complete
and was stopped; the pre-synchronization browser pass is not a new receipt.

## Native MiniChat (2026-11-07, Local Candidate)

The titlebar entry now opens one native, frameless Electron window with real
resize, drag and OS pinning. It loads the same application, conversation,
composer, tool cards, queue and approval components. Navigation and transient
editor UI remain independent; the selected session has one runtime, including
simultaneous cold opens from both windows. Closing only hides the view.
Reopening resumes its selection; explicit Return transfers selection,
message-anchored reading position and disclosure choices to main. Larger tools
and settings hand off to the main window instead of duplicating their surfaces.

Main owns revision-checked draft text, references/annotations and attachments.
Two-window sends consume a draft once. Genuine concurrent edits retain the
local version for an explicit conflict choice; failed delivery restores sent
input alongside newer input, even after renderer reload. Text-only updates
omit unchanged image payloads. Draft creation promotes both views to the same
session without losing pending input or selected task options. Unsubmitted
takes belong to the issuing renderer and are restored on reload/crash; already
submitted receipts remain main-owned and cannot be restored twice. First-send
setup locks changes to that shared draft's project/options, while independent
navigation remains possible. Failure cleanup rechecks selection after removal.

Runtime work and approvals are not owned by the window. Hide/reload cannot
approve, cancel or restart them. Pending decisions still use the current
runtime request, and completion sound is delivered only by the primary
renderer. MiniChat-selected workers are not reused/recycled behind the view;
viewed-session deletion is guarded and runtime replacement reconciles the
mini selection. Account changes that retire its transport retain readable
history and input but do not label a missing transport connected or successful.
That conversation requires an explicit reopen before further execution.

The mini renderer remains sandboxed with context isolation and no Node access.
Its IPC surface is allowlisted; account/configuration changes and unrelated
browser/terminal layout operations stay in main. Window geometry/pin is saved
under Desktop userData, clamped to display bounds; conversation drafts and
reading/disclosure memory survive window hide/reload, not application exit.
Editor caret/undo remains local to each editor. Windows pinning uses native
topmost placement without taskbar-relative repositioning; default floating
placement lost topmost status in the local minimal-window probe.

`scripts/verify-mini-chat-electron.mjs` uses an isolated profile and a loopback
model provider with the pinned real runtime. It covers coalesced startup,
independent navigation, shared drafts/references/options, once-only send/sound,
stream/stop, real write-file approval, hide/reopen/reload, anchor transfer,
restart, deletion guards, first-message promotion, OS pin state and a focused
380x400 English/light layout. Native screenshots and the result receipt are in
`Desktop/test-results/mini-chat-native/`. This does not establish cloud,
macOS native, packaged/installer or real-account acceptance.

Local verification passed typecheck, production build and `git diff --check`.
The complete test suite ran with concurrency 2: 1,136 tests, 1,123 passed,
13 platform skips and no failures. Native MiniChat, session navigation,
composer editing/menu, command dispatch and task-progress Electron checks
passed, as did the browser MiniChat and disclosure/summary regressions.
The initial high-concurrency suite hit an unrelated terminal cleanup timeout;
its unchanged six-test terminal suite and the bounded complete rerun passed.
Local review added eleven regressions for rejected concurrent writes,
abandoned/claimed submissions and draft setup/promotion/failure interleavings.

## MiniChat Frontend Preview (2026-11-07)

`Desktop/tests/fixtures/mini-chat.html` previews the titlebar entry immediately
before Minimize and a compact conversation window. `WindowBar` uses an
optional action; the native candidate now wires that action in the normal app.
The reusable frame uses existing tokens, icons and the native shared menu.
Conversation bodies, tool/thinking disclosures, timestamps, selection actions,
quotes, composer, permission and model/effort pickers are the real components.

The isolated fixture uses synthetic sessions and replies, with no model,
profile or filesystem access. Browser-local dragging, resizing and pin state
do not establish native-window or OS always-on-top support. Switching the mini
selection leaves the main selection alone; return explicitly selects the mini
conversation in the main surface, retaining its draft and pending quotes.
The isolated preview itself does not change the runtime pin, preload or main;
native integration is recorded separately above.

Reading continuity reuses `session-reading` message anchors. Each surface/session
keeps its own reading position and opt-in disclosure memory; return explicitly
transfers the mini position and disclosure choices even when main already shows
that conversation. Closing/reopening resumes the mini selection. Thinking,
tool/group and nested input/output choices survive remounting without retaining
mounted transcripts. Disclosure memory is bounded to 512 entries per surface/session;
records without stable message/call identity are not matched by array position.
Streaming and settlement do not pull an older reader to the tail, while readers
at the tail continue following. Position memory is browser-session-local, not
cross-launch persistence or native-window geometry support.

The main conversation and preview now share `ScrollToBottomButton` and its
existing composer-context-row style. It appears while reading older content,
resumes following the moving tail on activation, restores editor focus and
honors reduced motion. Wheel, keyboard and touch intents reuse the main
conversation's scroll policy; an upward gesture pauses even near the bottom.
Stopping a simulated response does not reset reading position.

The local-review fixes preserve manual disclosure choices when a live message
first receives its saved entry ID, including without opt-in memory. Different
known identities and explicit settings resets still invalidate old choices.
Preview retry-editing refuses to overwrite pending text or reference-only
drafts. Quote and annotation removal uses the latest shared state; clearing one
kind preserves the other. Whole-message Markdown references locate their saved
source identity rather than trying to match rendered text to Markdown offsets.
Composer menus have instance-specific option/ARIA IDs and only the focused
editor discovers a synchronized draft token. Moving between the add-reference
button and editor retains explicit reference keyboard navigation.

Typecheck, production build and `scripts/verify-mini-chat-preview.mjs` pass.
Browser verification covers entry placement/no-drag behavior, session switching,
draft/reference handoff, simulated streaming, menu and quote interaction,
dragging, focus restoration, reduced motion, light/dark and Chinese/English at
1440, 760, 440 and 390px. Four-sided composer focus gutters and picker widths
are checked. Low-height 900x400 light/dark and 390x400 dark cases cover eight-line
drafts plus a quote, visible Send/Stop and header, real send/stop clicks and
drag-then-resize recovery. The editor height follows the mini frame's available
block size; normal-window dimensions remain unchanged.
`?stress=reading` exercises long transcripts, independent disclosure
choices, same-session main handoff, per-session scroll restoration, close/reopen
during streaming, no duplicate requests, return-to-bottom with keyboard focus,
gesture-aware pause/resume, stopped-response reading position and tail following.
The button is checked in light/dark, narrow, English and reduced-motion layouts.
The shared `verify-disclosure-summary.mjs` regression and 61 focused navigation,
presentation, scrolling, grouping, command and quote unit tests also pass.
The rebuilt isolated Electron composer-menu verifier passes, including reference
selection at the attachment limit after focus returns to the editor.
`verify-project-instructions-preview.mjs` also passes against the main application
at 1280/390/320px in Chinese/English, light/dark and the Wine palette.
Screenshots are in `Desktop/test-results/mini-chat-preview/`.
An additional real-RPC timing test was attempted but failed at Windows runtime
cleanup with `Runtime process-tree termination failed (1)` and was interrupted
after its test server remained open. It is not counted as passing runtime acceptance.
This is a design preview, not native Electron, installer, cloud or account
acceptance. The existing `/todos` work remains a separate implementation.

### MiniChat State Ownership

The native candidate implements this contract within the local acceptance
boundary above; the synthetic preview independently exercises presentation.

| State | Ownership and restoration |
| --- | --- |
| Messages, thinking/execution/compaction, stopped/failed/completed results | One authoritative runtime per session, observed by both windows. Reopen reads the current snapshot; a disconnected or missing runtime is not inferred to be successful or still running. |
| Pending tool/Plan approvals | Keep the real request and reviewed version. Closing a view neither approves nor cancels; a decision is validated once against the current request. |
| Draft text, quotes/annotations, attachments | Main-owned session draft, not a second independent task. Revision-checked writes and once-only submission receipts protect newer input and recover rejected delivery. |
| Selected conversation, scroll/follow, expanded details | Per window/session presentation memory. Explicit return transfers the reading state; casual background updates do not steal it. Saves during navigation cannot attribute a target preview to the previous session. |
| Window bounds/pin and editor caret/undo | Native geometry/pin preferences survive application restart. Caret/undo belong to each editor; opaque editor history is not copied between windows. Browser preview pinning is only a simulation. |
| Menus, hover, selection toolbar, copied checkmark | Transient UI closes when its view closes; pending quoted text/annotations remain draft data. |
| Completion motion/sound/notifications | Event-owned and deduplicated per real run. Remounting or restoring historical UI must not replay completion signals. |

## Desktop Task-plan Shortcut (2026-11-07, Local Candidate)

Based on main `7fdfc76` (merged PR #208), standalone `/todos` now opens the
existing Summary board and reveals its task heading. The request is scoped to
the current worker, session and draft, then consumed once. Repeating it on an
open board retains task/history disclosures and the mounted progress animation;
ordinary polling cannot steal the composer's focus. No runtime pin, IPC or
canonical task/history storage is changed.

Typecheck and the production build pass. All 44 focused tests pass, covering
command recognition/catalog deduplication, source icons, composer behavior,
native slash handlers and task/agent history projection. Parameters, prose,
code, attachments and quotes do not acquire the new local shortcut.

The rebuilt isolated Electron command-dispatch verifier passes a real fresh
draft with no worker/session creation, then controlled summary data for empty
plans, folded history, current counts, repeated focus/scroll, retained manual
disclosures and failed-read retries. Four Chinese/English, light/dark and
desktop/narrow combinations include reduced-motion checks and complete focus
outline bounds. Screenshots under `Desktop/test-results/todos/` were inspected.
The expanded verifier uses keyboard submission in narrow overlays, where the
existing Summary surface can cover the main composer's send button.

The pinned real-runtime task-progress verifier passes through `/todos` both
before and during a task. It confirms no shortcut message in native history,
no queued input or premature sound/settlement, and the existing completion
impact, green sweep, sound, next-turn retirement and renderer-reload behavior.
All model responses are from an isolated deterministic loopback provider.
The existing Electron composer-menu verifier also passes filtering, icons,
selection, IME, cancellation, quotes, model controls and narrow layouts.

No acceptance installer, shortcut update, installed-app change, public release
or paid-model test is part of this work. Cloud/native macOS and packaged
acceptance remain separate; the complete Desktop suite was not rerun for this
renderer-only shortcut. Excluding junction targets, current QA inputs occupy
10.13 MiB in `dist`, 62.96 MiB in `terminal-runtime`, 0.10 MiB in the runtime
facade and 2.60 MiB in `test-results`; no historical package is deleted.

## Artifact Fixture Link Cleanup (2026-11-07, separate local candidate)

Main synchronization note (2026-11-08): this branch now merges main `6995910`,
which landed the CrashLog redaction as #213; the sections below keep each
candidate's own verification history. The complete-run receipt in this section
describes the pre-merge combination on `e419143`; CI reruns on the merged
combination and its receipt covers exactly that.

This test-only candidate starts at main `e419143`. It does not contain the local
CrashLog patch or change product artifact access, runtime, dependencies or owner
MiniChat work. Product assertions remain intact. The original full-run failure
left a dangling Windows junction at a test-owned workspace/escape path: parent
Dirent classified it as a link, PowerShell identified the junction and its deleted
target, while lstat/realpath reported ENOENT. The original residue is preserved.

Fresh diagnostic fixtures execute the actual artifactFile helper from candidate
and unmodified main. All access assertions pass. Controlled target-first removal
then reproduces ENOTEMPTY with the same residue in both trees; explicit link-entry
removal before recursive fixture cleanup succeeds while preserving live target
marker files. This confirms a dangling-junction cleanup mechanism, not the
original trigger ordering or proof that every original assertion had passed.
A finally cleanup error could mask an earlier failure.

The mapped-workspace test now records only successfully created links and removes
escape before the workspace alias. Windows uses rmdir for junction entries;
POSIX uses non-recursive rm for symlinks. Only ENOENT is tolerated. No retry,
blanket catch, timeout increase, failure filter or relaxed access assertion is
introduced. The fixture helper is not a general-purpose deletion/security API.

The original recursive-only behavior fails the dangling-link regression. Current
checks cover live target preservation, non-link error visibility, the actual
two-link topology after moving its target away, and interruption after only one
alias was created. The latter retains the exact primary error after successful
cleanup. All 21 artifact/cleanup/StepPage focused tests pass and typecheck passes;
a bounded independent review finds no blocking issue.

The separate candidate's complete serial run executes 175 files: 167 pass and
eight fail. Its five cleanup regressions and nine original artifact tests pass.
The remaining failures are capabilities (180-second file timeout), compaction
linked-root rejection, native execution-outcomes (`null` versus exit 7), plugin
Git-marketplace update, project-trust cleanup, theme linked-plugin cleanup,
turn-undo linked classification and workflow-catalog cleanup. Their signatures
match the preceding unmodified-main observations; their causes are not resolved
by this patch. All results and nonzero suite exit are retained, without filtering.
Runtime and dependencies are identity-checked against the validated latest-main
tree; no concurrent installation or staging occurs during this run.

The theme-packs failure is then traced to its own cleanup ordering, not product
access: an exact fixed-input run fails identically on the candidate and the
unmodified control, the preserved residue is a junction whose target the test
itself deletes first, and the fixture's recursive rm then fails on the dangling
entry. The linked test now removes its link entry before deleting the target,
tracking only successful creation; Windows rmdir and POSIX non-recursive rm
semantics come from the shared fixture helper. Product refresh/lstat assertions
are unchanged.

The same evidence pattern resolves the remaining non-environment failures. The
capabilities file's 180-second timeout stalled in fixture cleanup on its own
junctions (a step probe shows all product operations finishing in six seconds);
both junction sites now remove their link entries and the file completes. The
DFSC icon read, the linked-skills rejection, the turn-undo classification and
the compaction linked-root guard all share one machine-level lstat blindness
(probe: Dirent classifies the junction, lstatSync does not). Product path
classification is strengthened additively with the parent-Dirent signal in
`capability-settings.mjs` (`plainPath`, `rejectLinks`), `turn-undo.ts`
(`guardedPath`) and `compaction-configuration.ts` (`checkProfile`, with a new
linked `config.toml` test). Only rejections are added; no assertion is relaxed
and no allowlist is introduced. The staged runtime's verbatim copy of
capability-settings.mjs is refreshed to match the staging recipe before the
focused run; that copy step is recorded here and is not a release artifact.

Two failures are machine environment boundaries with direct probes: every msys
process spawned from node crashes with `NtCreateDirectoryObject(msys-2.0S5):
0xC0000022` (consistent with the local security software), so node-spawned
`git clone` and `bash` cannot run on this machine. This explains and retains
the Git-marketplace failures (capabilities, plugin-skeleton-native) and the
native `then_run` `exitCode: null`. The upstream's detailed git warning is
discarded by the service layer when converting to `marketplace-failed`; that
diagnosability gap is documented, not changed.

Focused suites (artifact/cleanup/theme/workflow/trust/capabilities/steppage)
pass 61 of 62; the single failure is the msys Git marketplace boundary.
Typecheck and production build pass.

A bounded independent review of the three product files and six test files
finds no blocking item: all prior lstat checks are retained, rejection sets
only grow, no legitimate alias (casing, 8.3) can newly be rejected, error
types and ENOENT tolerances are preserved, no owner assertion was weakened,
and the Dirent walks handle single-component and nested paths correctly. Its
one actionable residual gap is closed with evidence: `marketplace-add` did
not classify the marketplace source root itself, so a junctioned source was
read before failing later; a new test first fails with the read-through
signature (`capability:marketplace-failed`), then passes with the upfront
`capability:invalid-path` rejection after `plainPath` classifies the root.
The staged runtime copies are refreshed with the staging recipe's exact steps
verbatim for capability-settings.mjs and the same esbuild step for
compaction-configuration.mjs; a direct probe of the staged compiled module
rejects a linked root with `compaction:profile`. These are test-environment
refreshes, not release artifacts.

The final complete serial run executes 175 files; its counts come from actual
output only. The suite exit is nonzero; no full-green claim is made. No native
POSIX/macOS, package, installer, real-account or release acceptance is claimed.
No commit, push, PR, merge, old-tree cleanup or personal-profile operation is
performed.

## Windows CI Workflow Failure Forensics (2026-11-08)

The first CI run of this branch failed once in the Windows runtime group at
`verify-workflow-runtime.mjs`: the child-B model stream failed client-side
before reaching the fixture (the fixture's `childHeld` flag is set the moment
a child-B request arrives, so the failure means the request never arrived),
FINAL then asserted with a null output, and the one-slot wait timed out. The
same commit passes the identical verifier on macOS source and package
acceptance, the same Windows group passes for #211 and #213 on the same base,
and the verifier plus workflow runtime are untouched by this diff. Local
verification on this machine required restoring the shared node_modules'
missing Electron 44.4.5 binary (a local install artifact that had triggered
a binary download) and an assertion-preserving external `--no-sandbox` copy,
because the unmodified executable's default-sandbox launch exits on this
machine. With those local-only provisions the verifier passes end to end:
parallel/chain, restart, stop/drain/resume, content-addressed replay,
forced-crash recovery, partial failure with selective retry, structured
errors and real HTTP 429 recovery, with both child requests served.

The evidence supports a single runner-environment or timing failure, not a
regression from this branch: no assertion is relaxed, no deadline is extended
and the verifier is unchanged. This documentation update retriggers CI.

The preceding CrashLog result (175 files, 166 pass/nine fail) remains intact.
These equal file counts are different inventories: this separate tree adds
artifact-cleanup.test.ts and does not contain the uncommitted crash-log.test.ts.
No native POSIX/macOS, package, installer, real-account or release acceptance is
claimed. No commit, push, PR, merge, old-tree cleanup or personal-profile operation
is performed. Exact receipts are retained in the local artifact-cleanup evidence.

## CrashLog Latest-Main Synchronization (2026-11-07, local candidate)

The previous CrashLog candidate starts at `a8533cf`. This combination starts at
main `e419143`, after #210 themes, #194 Remote and #209 explicit plugin updates.
The full main diff leaves the CrashLog writer and existing startup verifier
unchanged. The implementation and disk regressions are carried forward without
rewriting owner code; this document preserves all owner verification histories.
The standalone acceptance entry remains `verify-crash-log.mjs`. Its imported
helper is named `crash-record-fixture.mjs`, matching other non-entry helpers rather
than creating an unregistered `verify-*.mjs` entry.

The log boundary redacts structured sensitive fields before traversal, including
decoded authentication containers. Text filters cover labelled credentials,
authentication headers and HTTP(S) URL authentication data, including userinfo
or quoted values cut off before their terminator. Accessors, custom serializers
and Proxy traps are not invoked. Projection limits remain 256 nodes per detail,
eight levels, 64 top-level fields and 16,000 characters per text input. Own-key
enumeration precedes the field cap; this is not constant-memory enumeration of
arbitrarily large objects. Final output, including its marker, is at most 64 KiB
UTF-8 without splitting a multibyte character. Arbitrary unlabelled secrets,
every encoding/authentication convention and replaced built-in APIs are outside
this guarantee.

Ordinary error descriptions, credential-conflict explanations, exit codes and
safe frames remain useful. A synchronous trusted V8 formatter avoids the global
`Error.prepareStackTrace` callback and restores its exact descriptor. Reading a
native lazy stack may cache diagnostic frames on the Error; message and details
stay unchanged. Immutable formatters and untrusted stack accessors fail closed.
UUID temporary writes, rename, never-throwing record and exit semantics remain.

Historical verification at `a8533cf`: original eight actual disk tests produced
six failures and two passes; the final implementation passed 18 disk cases and
57 focused projection/staging tests, typecheck and production build. Exact
staging verified pin `29eb460`, 47 postimages, 23 capability IDs and Node 24.16.0
SHA-256. Real Windows Electron main disk and production startup-conflict
acceptance passed with an external local `--no-sandbox` copy. The unmodified
executable's default-sandbox launch exited before inspector initialization.
No checked-in script or product sandbox setting changed. Those receipts do not
prove this later main combination.

The historical bounded all-file run executed 156 files: 150 passed, six failed.
An unmodified same-base control reproduced compaction linked-root rejection,
native `then_run` null versus exit 7 (same staged runtime), project-trust junction
cleanup, turn-undo linked classification and workflow-catalog cleanup. The
capabilities timeout control lacked its default runtime, so was not equivalent;
the timeout cause remains unknown. The complete result was not green and none
of these failures is labelled flaky or silently filtered.

Current-combination focused checks pass 184 cases (including 18 actual disk
cases and the new Remote session/queue boundaries), typecheck and production
build. CI policy/inventory/runner checks pass 39 cases with one platform skip.
The current staging recipe rebuilds from pin `29eb460` with all 47 postimages,
23 capability IDs and Node 24.16.0 hash verified; Remote/Lark notices, SDK license
and plugin-update/configuration adapters are present. The underlying pin is not
changed. Real Windows source Electron disk, vault migration and startup conflict
acceptance pass against this tree's rebuilt `dist/main.cjs`, using the already
installed executable of the exact locked Electron 44.4.5. Only the external local
acceptance copy adds `--no-sandbox`; no product/checked-in setting changes.

Locked normal dependency installation completes successfully: 508 packages,
postinstall scripts enabled, frozen lockfile unchanged. Initial installs used a
different local pnpm store and missed the 72.5 MB app-builder archive; the existing
store had that package but denied new writes. Sixteen existing content-addressed
cache entries were copied to the writable store only after SHA-512 and size
verification. The final offline normal install exits zero. Earlier timed-out and
`--ignore-scripts` diagnostics are not counted as successful installation. The
first all-file run was contaminated by a diagnostic rebuilding node_modules
while a test loaded tsx; it is retained but not a stable-input complete receipt.
A fresh complete run uses stable dependencies and executes all 175 files:
166 pass, nine fail. The unmodified `e419143` control
has identity-checked access to the exact same dependencies and staged runtime;
it reproduces the capabilities 180-second file timeout, compaction linked-root
failure, native `then_run` null-versus-7 assertion, project-trust cleanup, turn-
undo classification and workflow-catalog cleanup. Separate control checks also
reproduce the new native plugin Git-marketplace failure and theme linked-plugin
cleanup failure; session-fixture passes, unlike its dependency-disrupted earlier
result. These observations do not establish the causes or safety of those
failures, and no unrelated owner implementation is changed. The ninth failure,
turn-artifacts mapped-workspace link cleanup, reports ENOTEMPTY in the candidate
complete run but passes one exact focused run on each unchanged tree. A later
local-only investigation preserves the original dangling escape junction and
uses fresh fixtures to separate access assertions from cleanup. Controlled
removal of its target reproduces the same ENOTEMPTY/residue in both trees;
explicit link-entry removal before recursive cleanup succeeds and preserves live
target markers. This establishes a dangling-junction cleanup mechanism, not the
original trigger order or proof that every original assertion had passed.
A separate `test/artifact-junction-cleanup` tree contains only test cleanup and
three regression cases; its artifact/cleanup/StepPage checks pass 19 cases and
typecheck. It is not merged into this CrashLog candidate. The original nine
full-run failures and non-green result remain intact. Investigation evidence is
in the local `artifact-cleanup-investigation.md`; no native POSIX/macOS,
packaged/installer, default-sandbox or real-account acceptance is claimed.
This work contains no commit, push, PR, version change, installer, shortcut
change or old-tree cleanup.

## PR #194 Compaction Settings Main Synchronization (2026-11-07)

Head `b735139` passes Windows run `42351838942` and macOS run `42351839100`,
including both aggregate gates. Downloaded receipts validate the exact Windows
inventories (47/19/31), both macOS inventories (48/20/30 per mode), native
terminal success, merge commit `1b56f42014c3a213a570c60288d1fabc2669e6d7`
and candidate SHA-256
`b626b387d41bd36f6d5dfacaf9d7d1ab7d9f5f821f5cfccab1134d63df25311c`.
The full local serial suite exits normally: 1,412 tests, 1,399 passed, thirteen
platform skips, zero failures/cancellations, 382.4 seconds.

Main then advances to `59953ca` (merged PR #207 compaction settings), producing
another verification-document conflict. Both histories and implementations are
retained. The narrow compaction bridge, management adapter, global configuration
semantics and new interface verifier remain unchanged alongside Remote.
The runtime pin and patch manifests are unchanged. The newer combination
requires its own local and cloud checks; the preceding green runs do not prove
it. No Windows installer, shortcut, installed profile or release is replaced.

The synchronized combination passes typecheck, isolated production build and
all 314 focused Remote, compaction, polling and staging cases. CI policy,
inventory, runner and summary tests pass 39 cases with one platform skip.
Real Windows source Electron Remote, settings-dialog, turn-undo and background
reply acceptance pass; the production compaction settings browser matrix passes
using installed Edge. The isolated runtime retains the unchanged v0.1.7 bundle
and gains the current admin entry and bundled compaction configuration adapter,
matching the new staging recipe without touching shared outputs or upstream.
Evidence is under `test-results/ci-fix-main207-*` in the reused snapshot.
Full serial and replacement cloud results remain pending at this receipt.

## PR #194 New-Session Reload Polling (2026-11-07)

After main #208 synchronization, the full local serial suite exits normally:
1,410 tests, 1,397 passed, thirteen platform skips, zero failures, 390.4 seconds.
Cloud macOS run `42350348035` then exposes a new-session verifier race: its
post-reload predicate reads `.disabled` before `.new-chat` has mounted. The
failure screenshot shows the app subsequently rendered, not a renderer crash.

All seven new-session readiness waits now share a predicate requiring an
existing, enabled button and, when requested, the matching theme. Two browser
predicate regressions reproduce the null dereference before the fix and pass
afterward; all six fixture tests and typecheck pass. Full source Electron
new-session acceptance passes at normal and constrained native window heights.
No product code, runtime pin, timeout or
acceptance inventory changes. Evidence is under `test-results/ci-fix-new-session-*`
in the reused isolated snapshot. Replacement current-head cloud results remain
a separate gate; the accepted Beta package and shortcut are unchanged.

## PR #194 Post-CI Main Synchronization (2026-11-07)

Head `ae5103b` passes current-head Windows run `42346309477` and macOS run
`42346309483`, including both aggregate gates. Downloaded reports validate the
exact Windows inventories (47/19/31), both macOS inventories (48/20/30 per
mode), native terminal success, common merge commit `f053898` and candidate
SHA-256 `415e5ede1960dd879a5c010944a4644f4d8d6353708eecf427d0e60a91d91fba`.
These are not receipts for a later source combination.

Main subsequently advances to `7fdfc76` (PR #208 startup/shutdown ownership).
This synchronization preserves its guards and diagnostics alongside Remote.
Only this verification document conflicts; both histories are retained.
The runtime pin, integration manifests, renderer bridge and Remote behavior
are not separately changed. Current-combination local and cloud results
remain separate gates; the accepted `e5918c2` package is not replaced.

After synchronization, typecheck and isolated production build pass. All 204
focused lifecycle/Remote cases finish: 202 passed, two platform skips, zero
failures. Source Electron Remote, Plan and completion-review acceptance pass
again, including actual Remote quit/relaunch recovery. Evidence is under the
same isolated snapshot's `test-results/ci-fix-main208-*`; the full serial suite
and replacement current-head cloud checks remain pending at this receipt.

## PR #194 CI Path Aliases And Recovery Integration (2026-11-07)

The three Windows groups and macOS preparation all failed the same image
workspace-alias test at `e5918c2`, not separate build or renderer failures.
An absolute image path can retain an aliased temporary parent while the
selected workspace resolves to its physical parent. Remote now authorizes the
canonical file against the canonical workspace before reading/uploading it.
Outside, missing-outside and escaping-symlink paths retain the explicit error;
the open-file identity, mutation, revocation and transfer-budget checks remain.
A new parent-alias fixture fails before the fix and passes afterward.

Main `ff2f3b02` is merged without rewriting either branch. Both sides' tests
and verification history are retained. The shared task-outcome helper preserves
main's incomplete-answer classification. Remote retains the original reply,
reaction, image grant and compact tool history across native recovery, until
authoritative completion or interrupted settlement; pending completion review
does not prematurely settle that reply. Recovery regression cases cover
success, exhaustion, cancellation and the subsequent review boundary.
The v0.1.7 runtime pin and patch manifests are unchanged.

Local checks pass: typecheck, isolated production build, 418 focused tests,
nineteen policy/summary checks, and twenty runner/inventory checks with one
platform skip. Actual source Electron Remote acceptance passes questions,
Plan, image delivery, queues, routing and quit/relaunch recovery. A concurrent
local supplement stalled during process cleanup and was stopped only within
its identified verifier process trees; the affected timing and runner cases
then passed independently. The stopped invocation is not counted as a pass.

Evidence is in the reused isolated snapshot
`D:\Desktop Runtime Builds\remote-pr194-main-sync-20261107\Desktop\test-results`
under `ci-fix-*`. Full-suite, replacement cloud/macOS and updated packaged
acceptance remain separate gates. The already delivered `e5918c2` package and
desktop shortcut are not silently replaced by this CI repair.

The complete local suite subsequently exits normally: 1,390 tests, 1,376
passed, fourteen platform skips, zero failures, 419.1 seconds. Source Electron
Plan review, completion review and general window/RPC/isolation acceptance also
pass. The execution-outcome visual matrix passes all twenty-four cases using
installed Edge; the local bundled Chromium is unavailable.

Replacement cloud runs pass the image tests and expose two later fixture
assumptions. The Windows Remote restart fixture creates an empty project under
an aliased temporary parent, which the unchanged canonical-project guard
correctly rejects. Canonicalize its profile before creating projects. A local
junction-parent invocation reproduces the same restart failure before this
change, then passes the full source Remote fixture after it, including actual
quit/relaunch recovery. On macOS, the step-column hit probe can run outside the scrolled
viewport; reveal the actual navigation and await shared layout settlement
before measuring it. The fixture explicitly visits its footer first and keeps
all width, padding, marker alignment and hit-target assertions. No product
authorization guard or CI inventory is relaxed. Replacement cloud results
remain a separate gate.

## PR #194 Main And v0.1.7 Synchronization (2026-11-07)

Merge main `4318d6e` into the Remote Beta without rewriting either branch.
The integration uses main's v0.1.7 pin `29eb460` and unchanged patch manifests;
Remote does not introduce a separate runtime upgrade. All thirteen conflicting
paths retain both sides' capabilities, typed bridges, queue protections and
verification history. The merged TODO keeps Remote pending and main's plugin
completion rather than restoring the obsolete plugin-in-progress entry.

The Remote adapter builder now reads the same v017 manifest as staging, and
the staging regression covers that selector. Workers retain both native Plan
review flags and the permission-gated Remote image extension. The Remote
native fixture reads the latest collaboration-mode announcement and the actual
user image input, not a later native mode announcement. Settings verifiers use
the explicit settings control. Remote and the retained plugin center are
mutually exclusive without discarding the local conversation draft.

Three red/green regressions cover completion-review integration: intermediate
end events keep the original reaction and image scope, continuation updates
the same reply card, and failed/cancelled review settles it as interrupted.
Malformed and foreign-session review events cannot end the reply. Successful
completion still requires the existing authoritative task-completed event.

Current local checks pass:

- Typecheck, all 418 focused Remote/queue/session/review/project tests, six
  runtime-staging tests and the seven cross-session broker tests.
- CI inventory, policy and runner checks: thirty passed, one platform skip.
- Isolated production build and Remote adapter bundling against the unchanged
  v0.1.7 upstream adapter and SDK 1.76.0. The reused runtime matches all 47
  manifest postimages and the staged Node executable's SHA-256.
- Real Windows source Electron Remote, settings-dialog, Plan-review and
  completion-review verifiers. Remote covers native question answers, Plan
  refinements/approval, images, queues, exact recall, disconnect/relaunch
  recovery and two-way plugin navigation. Light/dark and narrow Remote
  screenshots were inspected.
- All 1,045 tracked inputs match the isolated verification snapshot by SHA-256
  before this receipt-only documentation addition.

Evidence is under
`D:\Desktop Runtime Builds\remote-pr194-main-sync-20261107\Desktop\test-results`.
The first isolated assembly lacked the new generated project-instructions
extension; after building that extension, the next run exposed the old image
fixture selecting a mode announcement. The fixture was corrected to assert
the actual user image bytes, and the final Remote run passes without weaker
assertions. These failures remain recorded in their original logs.

The rebuildable isolated runtime, dist, terminal runtime and evidence total
approximately 200 MiB. No installer is generated; the running application,
shortcut, shared outputs and personal upstream checkout remain unchanged.
Cloud CI, native macOS, packaged and real Feishu-account acceptance remain
separate gates. No merge of the PR or release is performed.

## Remote Questions, Plan And Markdown (2026-11-07)

Remote now distinguishes permission to ask from the subsequent structured
answer form. Known questions retain their original IDs and opaque option
values; custom answers are limited to 1,000 characters. Plan review preserves
approval, refinement and continued planning as separate decisions. Full pending
request/tool-call identity, first-response ownership and expiry are rechecked;
unknown, stale, malformed or oversized actionable content remains local.

Assistant replies use JSON 2.0 Markdown components rather than legacy
`div.text.lark_md`, with native tables, inline/fenced code and a separate
plain-text source footer. Model-supplied platform tags, embedded images and
unsafe links do not acquire platform behavior. The helper bundles its Markdown
parser for offline loading; the upstream pin and adapter remain unchanged.

Local checks passed:

- Typecheck, `git diff --check` and all 192 focused Remote tests.
- Complete unit coverage in two explicit groups: the three background-runtime
  cases and the remaining 1,169 tests. Total: 1,158 passed, fourteen skipped,
  zero failed. Logs are `background-runtime-question-markdown-rerun.log` and
  `full-tests-question-markdown-final-shard.log` in the reused isolated snapshot.
- Isolated production build, adapter staging and offline helper imports.
- Source Electron acceptance through the actual patched runtime: permission to
  ask, grouped selected/custom answers, Plan refinement and explicit approval,
  alongside existing Remote, image, queue and quit/relaunch recovery checks.
- Edge chat-simulation acceptance: shared outgoing card documents, question
  forms, Plan decisions, Markdown tables/code, light/dark 320-1440px layouts,
  focus and reduced motion, with no external requests. Generated screenshots
  were inspected.

The source workspace's shared runtime has an older BTW patch hash and still
fails its newer tool-rejection test; it was not overwritten. The isolated
runtime matches the current manifest and passes that test. A later
single-invocation suite stalled after three passing background-runtime cases
because its child processes remained alive. Only that verifier's process tree
was stopped; both explicit groups then exited normally without force-exit flags
or weakened assertions. A pristine single-invocation full run is not claimed.

The existing isolated artifacts total approximately 218 MiB across runtime,
dist, terminal runtime and acceptance evidence. No artifact was deleted.
No installer, installed application, shortcut, shared output, upstream pin,
commit or remote PR was changed. Real Feishu rendering/callbacks, packaged,
macOS and current-head cloud acceptance remain separate gates.

## Remote Overview Readability (2026-11-06)

The `/tasks` payload now has a bounded structured presentation shared by the
helper and chat simulation, rather than a generic bilingual plain-text notice.
It follows the Desktop language, separates the input target from attention and
in-progress groups, retains complete rows and exact saved-handle commands, and
uses a concise empty state. Session names/status remain literal, never Markdown
or approval actions; malformed, oversized and action-bearing overview payloads
are rejected at the helper boundary. Omitted rows are explicitly counted.

Typecheck, 374 focused Remote/media/queue/session tests, the isolated production
build, source Electron Remote acceptance and Edge simulation acceptance pass.
Empty/populated light/dark cards and 320-1440px layouts were inspected. Logs
are `Desktop/test-results/remote-overview-focused.log` and the isolated
snapshot's `test-results/remote-overview-{build,native,preview}.log`;
card screenshots are under its `test-results/remote-chat-preview/`.

This narrowly scoped follow-up does not rerun or relabel the full-suite result
below, does not build an installer or push, and does not establish actual
Feishu rendering, packaged/macOS or cloud acceptance.

## Remote Reliable Interaction And Images (2026-11-06)

The PR #194 follow-up implements the approved Remote [IV] scope: selection
failure barriers, distinct queue receipts, exact queued-only recall, visible
approval expiry and exact-request refresh, `/tasks`, `/sharing`, `/detach`,
typed attention states, explicit tail truncation, and separate socket/restart
recovery notices without offline replay. Tool activity is coalesced into one
category/count line on the original reply card, never raw arguments, results
or thinking.

Images require a separate saved opt-in and an image-capable model. Native
input and the ordinary permission-gated `desktop_send_image` tool use bounded
transfers through the main-owned broker/helper. SDK 1.76.0 contract tests cover
the actual image upload `{image_key}` response, cancellable HTTP deadlines,
run/grant revocation, shared memory reservations and no automatic resend after
uncertain delivery. Optional captions follow only confirmed image delivery.
No Markdown/path auto-export or arbitrary file download is introduced.

Independent review findings were fixed and regression-tested: late selection
cannot undo a local detach, failed legacy selection cannot fall back to the
previous target, image delivery cannot outlive its captured grant/run, queued
preparation cannot issue a prompt after abort/recovery/clear, and a remote
detach followed by explicit selection preserves ordered routing.

Current local checks passed:

- Typecheck and 370 focused Remote, media, queue, broker and session tests,
  with no failures or skips.
- All 21 CI policy, inventory and runner tests.
- Production build in the reused isolated snapshot
  `D:\Desktop Runtime Builds\remote-reactions-pr194-20261106`.
- Source Electron acceptance through the actual staged runtime: image bytes
  reach the model input; `desktop_send_image` requests ordinary permission and
  receives a native-image delivery acknowledgement; captions follow it.
  Queue counts, exact recall, failed selection, detach preserving local work,
  encrypted image grants and actual quit/relaunch are also covered.
- Edge chat-simulation acceptance through the production manager core:
  tasks/recall, compact structured tool activity, image opt-in, decoded fixture
  PNGs, light/dark 320-1440px layouts, focus and reduced motion, without external
  requests. The production image checkbox and forwarding list were checked in
  narrow light/dark Electron layouts. Screenshots were inspected.
- SHA-256 comparison found no differences across all 40 changed Desktop
  source files in the accepted snapshot; all five staged helper/extension
  files match their source.

The final serial suite ran 1,153 tests: 1,138 passed, fourteen skipped and one
failed in 246.8 seconds. The unchanged `tests/btw-runtime.test.ts:143` still
expects `error` for an unsupported side-question tool, but the staged runtime
returns `done`. An independent rerun reproduces it. This pre-existing failure
is not weakened or counted as a pass; the full suite is not green.
Logs are `Desktop/test-results/remote-beta-focused.log`,
`remote-beta-final-unit.log` and `remote-beta-btw-baseline.log`. Build/native/UI
logs and screenshots are retained in the isolated snapshot's `test-results/`.

No installer, installed app, shared runtime/dist, upstream pin or upstream
checkout was changed. No commit, push, real Feishu authorization, current-head
cloud CI, packaged/macOS acceptance or release readiness is claimed. Actual
Feishu image scopes, recall/reconnect events and platform rendering remain
explicit manual gates in `docs/REMOTE.md`. The isolated reusable artifacts are
approximately 213 MiB including runtime, terminal runtime, dist and evidence;
no historical package or other artifact was deleted.

## Remote Review Hardening (2026-11-06)

The editable chat simulation now runs the production Remote manager core with
synthetic host/channel boundaries instead of a second command/routing reducer.
Session handles are saved with the encrypted connection, retained across
recovery and never recycled for removed conversations. Newly allocated handles
are not advertised or accepted until saved; injected failures cover ordinary
writes, initial binding, delayed saves, worker exit and same-process reconnect.
Existing confirmed mappings survive failed writes and later storage recovery.

Known projects are independent of visible sessions, allowing an authorized
empty project to survive restart and create its first conversation. Project
filters use separate pagination snapshots; subsequent pages do not reorder
with the live catalog. Current-target headers, renamed sessions, duplicate
project names and navigation hints remain explicit. Maximum-size legal lists
fit the 5,000-character system-card budget without clipping the header or rows.

Current local checks passed:

- Typecheck and all 222 focused Remote, queue and session-runtime tests.
- All 15 CI policy, inventory and runner tests.
- Production build in the reused isolated snapshot
  `D:\Desktop Runtime Builds\remote-reactions-pr194-20261106`.
- Source Electron Remote acceptance, including actual quit/relaunch,
  stable-handle recovery, empty-project scope and first-session creation,
  selection without inference, local draft/focus preservation, approvals,
  receipts, targeted stop and explicit disconnect.
- Edge simulation acceptance across light/dark 320/390/700/1440px layouts,
  focus, reduced motion, real-core slash routing, pairing-to-chat continuity,
  independent parallel sessions, FIFO, pending-input rejection and stale
  approval invalidation, with no external requests. Desktop/narrow project-tree
  screenshots under `Desktop/test-results/remote-chat-preview/` were inspected.
- `git diff --check`.

The final serial suite ran 1,011 tests: 996 passed, fourteen skipped and one
failed in 229.8 seconds. The unchanged `tests/btw-runtime.test.ts:143` expects
unsupported side-question tool output to terminate as `error`, but the staged
runtime returns `done`; an independent rerun also reproduces it. That test
imports the unchanged runtime transport, not Remote. The full suite is not
green; this unrelated gap is retained, not weakened or relabeled as a pass.
The full log is `Desktop/test-results/remote-review-hardening-unit.log`.

No installer, shared runtime/dist, installed application, shortcut, upstream
pin or upstream checkout changed. No commit, push, real Feishu authorization,
current-head cloud CI, packaged acceptance or release readiness is claimed.
The existing loopback preview remains available.

## Remote Project And Session Tree (2026-11-06)

The private-chat session list and editable simulation now share a bounded
project-to-session text formatter. Project headings use the Desktop display
name where available, retain distinct `p` handles and show total session counts;
their child `s` handles and current marker remain stable through grouping and
pagination. Display metadata does not change the exact authorized workspace
paths or imply recursive access. The preview adds a three-project scenario and
keeps newly created sessions under their selected project.

Local type checking and all 63 focused formatter, simulation, command and
manager tests pass. The Edge browser verifier passes cross-project selection
and creation, grouped lists in light/dark 320/390/700/1440px layouts, and its
existing reply, reaction, approval, pairing, interruption, focus and reduced
motion cases with no external requests. Desktop and narrow tree screenshots
were inspected under `Desktop/test-results/remote-chat-preview/`.
`git diff --check` passes. This follow-up does not claim a new production build,
native Electron, real Feishu rendering, cloud-CI or packaged acceptance run.
The loopback preview was restarted; no installed app or shared runtime changed.

## PR #194 Beta Main Synchronization (2026-11-06)

The Remote Beta changes are committed as `bb13f67`. Main `7c349b7` is merged
without rewriting history. The main-process conflict retains both Remote queue
receipts/recovery and the subagent runtime redaction capability gate. Both
verification histories and the current TODO ownership/acceptance boundaries
are retained. The upstream pin and patch manifest are unchanged from main.

Post-merge type checking passes, along with all 201 focused Remote command,
store, channel, manager, chat simulation, pending-queue, session-runtime,
background-control and BTW tests. CI policy/inventory/runner checks pass
39 tests with one native-platform skip; `git diff --check` passes.
The full-suite, production-build and source Electron receipts below predate
this main synchronization. They are not relabeled as a new combined-runtime
or packaged acceptance run. Current-head cloud CI, real Feishu acceptance and
a newly requested package remain separate gates. No package, installed app,
desktop shortcut or shared runtime is changed in this PR update.

## Local Feishu Chat Simulation (2026-11-06)

The editable chat fixture adds a Feishu-like host shell with normal, empty,
interrupted, approval and pairing scenarios, original-message reactions,
same-card updates, playback controls and an old-layout comparison.
`remote-card.mjs` is extracted unchanged from the helper's outgoing card
construction and staged alongside it. Production and preview share that
document builder; Feishu's actual typography, Markdown subset and reaction
assets are not reproduced or certified by the HTML approximation.

Local checks passed: typecheck; all 101 focused queue, Remote command/channel/
manager and simulation tests; 15 CI inventory/policy/runner tests; and source
Electron Remote acceptance after rebuilding only the isolated Remote adapter.
The staged helper loads the extracted module and retains actual quit/relaunch
recovery and explicit-disconnect checks. The browser fixture passed new/old
comparison, reaction removal, single-card updates, slash help/listing,
single-use approvals, partial interruption, pending-confirmation pairing,
light/dark 320/390/700/1440px layouts, full textarea focus gutters, reduced
motion and menu Escape focus return. No external browser requests occurred.

The local preview serves this worktree read-only on loopback with a separate
cache under `Desktop/test-results/remote-chat-preview/`; screenshots are in the
same ignored directory. No installer, installed app, shortcut, real Feishu
connection, paid-model request or current-head cloud result is included.
The complete-suite receipt below predates this fixture follow-up; this section
claims focused and native regression checks, not a new full-suite run.

## Remote Message Feedback And Reply Presentation (2026-11-06)

Accepted model input now receives a processing reaction on the original
private-chat message instead of a Received card. Main tracks the exact pending
queue ID, so finishing one input does not clear a later queued input. Removal,
dispatch failure, interruption, worker disposal and orderly disconnect release
the corresponding indicators. A slow reaction POST is removed by its exact
returned ID if completion or unbind arrived first. Reaction failures remain
best-effort delivery failures and never retry model work.

A matched pairing code receives an acknowledgment reaction, with a literal
pending-confirmation fallback if reactions fail. This does not authorize chat
access before local confirmation. Working cards no longer expose an automatic
Stop button; `/stop` and `/stop s1` retain the original-run guard. Bare `/session`
and `/help` are covered as local commands without inference.

Normal replies update one Markdown card with a small plain-text session source,
without Working or Completed headings. Explicit reply status drives presentation
rather than matching title strings. Empty working/final replies remain distinct;
interruption retains partial text and an explicit footer. Approval and system
cards retain literal text, meaningful headings and their existing token gates.

Final Windows source verification passed:

- Typecheck and production build.
- All 170 focused Remote, pending-queue and session-runtime tests.
- Complete serial suite: 940 tests, 926 passed, fourteen platform skips, zero
  failures and clean automatic exit in 233.9 seconds.
- CI policy/inventory/runner tests: 39 passed and one native-platform skip.
  The first policy invocation in the non-Git verification snapshot could not
  read HEAD; the same unchanged tests passed from the actual Git checkout.
- Real source Electron Remote acceptance with the staged SDK/helper offline
  smoke, isolated fake transport and loopback provider. It covers input reactions,
  slash help/listing, cold/new session routing without inference, local draft
  preservation, original-session stopping, approvals and actual quit/relaunch
  recovery with no old task replay or reconnect after explicit disconnect.
- Source/snapshot and staged helper hash checks, plus `git diff --check`.

Build/runtime output is isolated under
`D:/Desktop Runtime Builds/remote-reactions-pr194-20261106/`: approximately
10 MiB dist, 123 MiB runtime and 63 MiB terminal runtime. Narrow acceptance
evidence remains alongside the logs; no old outputs were deleted. No shared
runtime, existing package, installed app or desktop shortcut was replaced.
The upstream pin remains `81e79bc4b699148d6823fedde9b5e70d9a80255f`.
Real Feishu reaction permissions, Markdown appearance, authorization, callbacks
and SDK reconnection remain manual gates. No installer, paid-model, native
macOS, current-head cloud-CI, commit, push or release acceptance is claimed.

## Remote Recovery And Step Hit Areas (2026-11-05)

Desktop now keeps a separate `safeStorage`-encrypted Remote snapshot under
`userData/remote/connection.dpapi`. Only the bot credentials/identity, confirmed
private chat, exact project grants and current session ID are persisted. Normal
quit/update preserves it; explicit Disconnect deletes it; Unbind removes chat
access but keeps the bot. Recovery validates the bot and canonical known
projects, creates a fresh binding and opens only the saved target in Ask without
inference, local navigation or task replay. Missing sessions are not replaced;
invalid projects lose chat access. Tokens, runs, queues, callback readiness,
cards and attached runtime identities are not restored.

The three setup steps now have equal-width hit targets, symmetric padding and
vertically centered markers. Hover, the active underline and the unweakened
shared focus outline follow the same bounds without changing layout.

Local Windows checks passed:

- Typecheck and production build in an isolated source snapshot.
- Complete serial suite: 927 tests, 913 passed, fourteen platform skips, zero
  failures and clean automatic exit in 326.9 seconds.
- CI policy/inventory/runner tests: 39 passed and one native-platform skip.
- Real Electron Remote acceptance, including actual quit/relaunch against the
  same isolated profile, encrypted bytes, current-session recovery, no automatic
  inference, stale approval/Stop rejection and no reconnect after explicit
  disconnect. Startup interception is confined to the source test launcher;
  the product has no fake-transport switch. The packaged verifier retains its
  normal entry point and does not claim source-only restart coverage.
- Production desktop/narrow hit-target geometry, first-step hover and full
  focus gutters in light/dark, Chinese/English, plus reduced motion.
- The existing browser Remote preview acceptance passed with Microsoft Edge.

The build and current screenshots are isolated under
`D:/Desktop Runtime Builds/remote-persistence-pr194-20261105/`.
No installed app, shared runtime, shortcut or existing installer was replaced.
These deterministic source tests do not establish real Feishu authorization,
platform credential renewal, native macOS, packaged recovery, cloud CI or
release acceptance. The user must pair once in the first persistence-enabled
build; credentials already lost by the older memory-only build cannot be
recovered.

## Remote Multi-session Beta (2026-11-05)

The Desktop follow-up separates the authorized private chat, explicitly granted
projects and current remote session. Its shared command set provides help,
paged session lists, selection, creation, project/current/status inspection,
targeted stop and disconnect. Unknown slash commands never become model input.
The fixed upstream pin, adapter sources and SDK remain unchanged; upstream
contributions are outside this Beta implementation.

Final local Windows source checks pass:

- Typecheck and production build.
- Clean complete serial suite: 910 tests, 896 passed, fourteen platform skips
  and no failures; automatic exit in 240.3 seconds. The final repeat adds
  `--test-timeout=180000` to bound each test file, without relaxing assertions.
- All 120 focused Remote command, manager, channel and session-runtime tests.
- All 15 CI policy, acceptance inventory and runner tests.
- The registered `verify-remote-access.mjs` acceptance with isolated profiles,
  a fake channel transport and loopback model provider: explicit project grants,
  help/history listing, cold selection and headless creation without inference,
  local focus/draft preservation, denied out-of-scope selection, exact-request
  approval, old-session task stopping, deduplication, disconnect and helper exit.
- Production light/dark narrow layouts, shared select and checkbox focus gutters,
  and reduced motion. Five current screenshots remain under
  `Desktop/test-results/remote-access/`.

Regression coverage includes ordered input across blocked submissions and local
selection, session handles surviving catalog reordering, read-only cold status,
revocation during preparation, worker exit without losing chat authorization,
independent concurrent Stop capabilities and existing resident-task observation
without transcript backfill. Project grants are bounded to twenty and runtime
attachments to eight; active targets cannot be evicted and an over-capacity
operation is rejected before preparing or creating another runtime.

An added native equivalent-path fixture first reproduced a cold-session failure:
canonical preparation changed the workspace spelling and lost the original
grant match. Preparation now validates the real directory before startup but
retains the exact granted spelling. The same fixture passes through cold
selection, new-session creation and the first later model request. Redirected
canonical targets remain rejected rather than extending the grant.

One intermediate full-suite repeat reported 896 passes and fourteen platform
skips, but stalled after the runtime tests while twelve fixture-owned RPC
children remained alive. A system process query also failed during diagnosis.
Only descendants of the verified test runner were inspected and terminated;
the later explicit `taskkill` retries succeeded. This manually assisted run is
not counted as a clean termination receipt, and the original cause of those
unsuccessful stop attempts was not captured. A read-only process-audit helper
remains in `Desktop/test-results/remote-beta-process-audit.ps1`.
The subsequent complete serial repeat above exits without manual cleanup;
this does not establish that the earlier intermittent OS cleanup cause was
repaired.

The staged SDK/helper check is an offline loading and gate smoke test; helper
changes are covered by source unit tests. This does not establish a newly staged
or packaged helper. No real Feishu authorization, external user-content delivery,
platform callback/reconnect, paid-model, installer, native macOS or current-head
cloud-CI acceptance is claimed. No new package or desktop shortcut was created,
and the previously delivered `db523d1` preview does not contain this Beta.
Only the current Desktop dist and narrow source-acceptance evidence were rebuilt;
the user's app, existing preview server and older packages were left alone.

## PR #194 First-run Main Synchronization (2026-11-05)

Main advanced to `d0a1009` (PR #192 production first-run onboarding) while the
Remote preview was being verified. The follow-up merge preserves Remote and
first-run bridge methods and contracts, both verification records, the
independent bootstrap and all acceptance registrations. The runtime pin and
patch manifest are unchanged. Validation and a refreshed combined package
remain pending; the earlier `1b28642` preview is not relabeled as this build.

## PR #194 Native Sidebar Drag Target (2026-11-05)

At `1b28642`, all three Windows cloud groups pass, as do macOS source/package
sessions and runtime. macOS interface still fails on the second pinned-project
drag: the new insertion-marker check catches the missing target before release.

The checksum-verified native failure screenshot places the drag preview over
the independent group instead of the intended pinned project. The scroll tree
is at its upper limit and the target project has moved below the stationary
pointer. The helper's `Locator.hover` aims only 8px inside a whole project,
which can fall inside the tree's intentional 32px edge-autoscroll zone after
scrolling a drag source into view. Autoscroll then moves the target out from
under the pointer. Layout settling alone does not prevent this interaction.

The verifier now moves the real pointer in steps to a visible point within
the intended before/after half, at least 40px inside the scroll viewport.
It still requires the insertion marker and the exact final order; no timeout,
product behavior or acceptance inventory is relaxed. Pointer, hit-target and
scroll diagnostics supplement the existing failure screenshot.
The complete local source verifier passes at its normal size and with a
1024-by-684 content viewport. A smaller scrolled Windows fixture reproduces
the old helper's pinned-project insertion-marker timeout; matching the macOS
viewport alone does not reproduce that failure on Windows.
The new helper also passes the complete fixture with the project-drag phase
at 1024 by 600 and pinned targets deliberately scrolled toward the upper edge.

The unsigned Windows preview built from `1b28642` passes package-content hashes
and actual executable Remote, sidebar, BTW, general Electron, settings, updates
and native PowerShell terminal acceptance. The complete combined serial suite
passes 865 of 879 tests with 14 platform skips. Its backed-up desktop shortcut
now targets the new preview without terminating the user's old app.
Real Feishu authorization, callback/reconnect behavior and installer upgrade
remain manual gates. Replacement cloud acceptance for this verifier follow-up
is still required.

## PR #194 Stop Capability And Main Integration (2026-11-05)

The first Remote head passed all three Windows groups and macOS sessions/runtime
source/package acceptance. macOS interface failed in `verify-sidebar-order.mjs`
while waiting for two pinned projects to reorder. Its final gate correctly
remained failed.

Streaming Working-card revisions now retain their current run-scoped, single-use
Stop capability. A delayed or failed card update no longer invalidates the
button that is still displayed. Completion, the next run, unbinding and expiry
still revoke the old capability. Four added regression cases cover in-flight
updates, failed delivery, failed final delivery and run/binding invalidation.
All 101 focused Remote/helper/session-runtime tests pass.

Latest main was merged without dropping either Remote or BTW runtime ownership,
preload methods, typed contracts or CI registrations. BTW-only events remain
outside Remote projection. Typecheck and production build pass. The sidebar
verifier now uses shared rendered-layout settling and requires the intended
workspace insertion marker before releasing the pointer. Final order assertions
and deadlines are unchanged; failure screenshots and geometry are retained.
The complete Windows source sidebar acceptance passes after this change.

Replacement cloud checks and the new Windows preview package are still pending.
No real Feishu authorization, external user-content delivery, real callback or
paid-model acceptance is established here.

## StepPage Storage Boundary (2026-11-07, local candidate)

This candidate starts from main `4318d6e` after the v0.1.7 pin migration. The
open Remote/Linux branches do not touch the StepPage preparer or unit tests. It
does not modify the new pin, patches or Plan integration.

A real Windows junction reproduces the storage guard failure: its directory entry
is a link and realpath resolves outside the owned root, while lstat reports an
ordinary directory. The old preparer therefore downloads a deterministic,
hash-pinned local ESM fixture into the outside target, executes its version probe,
calls apply and reports ready/installed. All bytes and markers stay under a new
isolated test directory; no official artifact, account, model or personal profile
is used.

Formal tests fail on the old implementation because redirected storage is not
rejected before download/apply/outside creation. The fix checks owned directory
entries plus canonical parent identity before mkdir and again afterwards. Bundles
must remain within the owned StepPage root before hashing, reuse or probing; the
newly written temporary is rechecked and rehashed before execution. Dangling
storage cannot recreate its target. The walk stops at the StepPage root's direct
parent so macOS system links such as `/var` and `/tmp` are not rejected. Test
cleanup removes only each created link entry with a platform-appropriate API.
The check/use interval remains; this does not claim to eliminate adversarial
concurrent replacement or every reparse type.

On pre-v0.1.7 main, typecheck/build, seven formal StepPage tests, 22 focused tests
and the real Electron preparation/MCP/Cron-host/tampered-bundle matrix pass after
the review corrections. The complete bounded suite executes 148 files: 143 pass
and five fail; the former StepPage linked-storage failure passes. Those results
are historical input only after main moved.

On this v0.1.7 candidate the exact locked dependencies are installed offline from
the local pnpm store after removing only this tree's dependency junctions, whose
final targets were verified before removal. The v0.1.7 runtime rebuilds offline
and stages from clean pin `29eb460` with Node 24.16.0 into a physical directory:
20 patch files, 47 source postimages and 23 runtime capability IDs match the
current manifest. The earlier 20-file staging attempt that reused a dependency
junction failed at the CLI typecheck and is retained only as evidence that mixed
dependencies do not build; none of its results are used. The application build
and the focused StepPage/error/plugin suite pass 22 tests. The real Electron
verifier passes official fixed-integrity download, actual MCP handshake, protected
Cron host, tampered-bundle rejection/no execution, repair and relaunch disable
retention and Desktop-owned HOME. CI runner/inventory/receipt tests pass 30 cases
with one platform skip. Complete bounded per-file verification executes 151 files:
147 pass and four fail. Capabilities exceeds the 180-second file deadline;
project-trust junction cleanup, linked-undo classification and workflow-catalog
junction cleanup fail with their previously observed signatures. The former
StepPage and template-input failures pass on this baseline. Full local acceptance
is not green, and this does not establish the causes or safety of the remaining
failures.

A bounded independent review identified and then rechecked three issues before
the final result: the path walk originally extended through unowned macOS system
ancestors, POSIX link cleanup incorrectly used rmdir, and the downloaded temporary
was probed before a final storage/hash recheck. No native macOS source/package
acceptance or real-account validation is claimed. This local candidate contains
no commit, push, PR, installer, shortcut, release or version change.

## PR #205 First CI Failure Forensics and Acceptance Robustness (2026-11-07)

Head `0871aa5`'s first CI run keeps every StepPage gate green: macOS source and
packaged `verify-steppage-registration`, all StepPage unit tests inside the
Windows protocol run, interface and sessions groups on both platforms. Two
failures occur in background scenarios this PR does not touch.

Windows runtime protocol tests fail one case: the background-runtime retry
scenario times out waiting for all eight capacity slots, with `slots=7`,
`failures=0` and the parent turn settled — one of eight concurrently spawned
cold children did not complete its first model request inside the 25-second
fixture budget. The same head passes this scenario locally five times and it
passed in earlier CI runs.

macOS packaged runtime fails `verify-background-agent-replies.mjs:196`: the
failure screenshot in the diagnostics artifact shows the multiline draft still
present and selection-highlighted with an enabled send button — Playwright
`fill('')` selected the draft but its delete step did not reach the ProseMirror
commit on the slow packaged launch. The same script's source run passed on the
same head minutes earlier, and the verifier passes locally on Windows with the
#201 selection setters. #201's composer diff only adds selection accessors and
does not change disabled/value semantics.

Both are timing-sensitive acceptance mechanics, not introduced by this PR. No
evidence supports a flake label, an automatic rerun, or attributing them to the
StepPage change, so no assertion is weakened or removed. The fixes are test-only:

- The replies verifier clears the draft through the editor's real input path
  (select-all and Delete keys, ProseMirror's actual key handling) and then
  asserts the original invariant through a bounded 30-second condition wait: an
  empty draft must never be sendable. A genuinely uncleared editor or an enabled
  send button still fails the test. The failure screenshot remains.
- The background-runtime wait helper accepts an explicit deadline. Only the two
  waits that depend on concurrently cold-starting children (eight slots, and the
  respawned retry child) use a 45-second mechanics budget with an explanatory
  comment, and the timeout message carries the actual budget. The default 25
  seconds and every capacity, dedup, identity and retry assertion are unchanged.

Main moved while this branch was out (`59953ca`, adding #206/#207/#208). The
merge adopts main's equivalent reply-clearing fix (`b1fe638`), which supersedes
this branch's interim replies change with the same keyboard-clearing approach
plus stronger assertions (a nonempty draft remains sendable, and clearing never
submits a follow-up); the background-runtime spawn budget from this branch is
retained, since main's helper still carries the original 25-second deadline for
those waits. The runtime pin is unchanged (`29eb460`, 20 patches, 47
postimages), so the staged physical runtime remains valid for the merged tree.

Local verification on the v0.1.7 physical runtime: the background-runtime suite
passes seven of seven and typecheck passes; the replies verifier passes end to
end with the keyboard clearing. The CI-side timing distribution (runner load
during child startup) is still not fully located; if a failure recurs beyond the
new budget, the diagnosis continues into the runtime child startup path with the
recorded phases. No product code, pin, patch or acceptance inventory changes in
this follow-up.

## PR #205 Plugin-Center Subpixel Assertion (2026-11-07)

The second CI run's Windows interface group fails only
`verify-plugin-center.mjs` at the icon height assertion: the wrapper box
measures 72.00001525878906 instead of exactly 72. `getBoundingClientRect()`
values are layout-rounded on some runners, and the same function already
compares the media measurements with a `.1` tolerance; only the wrapper
assertions used strict equality. The script's last change predates this branch
(owner PR #204), and the first CI run of head `0871aa5` passed this exact
Windows interface group, so the failure is runner rendering variance, not this
branch's change. The fix aligns the wrapper width/height assertions with the
existing `.1` tolerance and a comment; the `flexBasis` computed-style string
stays exact, and the logo-must-not-shrink invariant is unchanged. Local
verification on the merged mirror with the host Edge browser passes the full
plugin-center acceptance (cold-cache lookups, installation sources, localized
tags, keyword search, late StepPage preparation preserving navigation and the
BVR draft). This is a test-only robustness change; no product code is modified.

## PR #207 macOS Undo Acceptance

Head `b1fe638` passes all Windows gates, but macOS run `42347395061` fails
source sessions acceptance at the same-workspace running-peer undo assertion.
The fixture's async browser predicates returned Promises instead of polling
their resolved conditions, allowing undo to reach the RPC idle check before
the busy peer was reflected in Desktop state.

The fixture now reuses the Node-side IPC snapshot poll for settled edit
captures and peer readiness. It verifies distinct runtime/session identities,
the same workspace, an idle source and a running peer before retaining the
strict workspace-busy rejection and unchanged file assertion. No production
guard, error expectation, deadline or CI inventory is relaxed.

The focused undo, runtime and polling suite passes 86 tests with three platform
skips. Three Windows Electron undo replays pass, including the busy-peer guard
and light/dark/narrow/English confirmation cases. New-head cloud and native
macOS source/package acceptance remain required.

### Runtime Stability Main Synchronization

PR #207 also integrates main `7fdfc76` (merged PR #208). Only this verification
document conflicted; both complete records are retained and the incoming
startup/shutdown implementation and tests are unchanged.

After synchronization, typecheck, production build and the focused runtime,
background, undo, polling, composer and compaction suites pass: 158 passed,
five platform skips and zero failures. Rebuilt Windows Electron undo,
background-reply, settings-dialog and Plan-review acceptance also pass.
These local source results do not establish new-head cloud, native macOS,
packaged or real-account acceptance. The prepared runtime is not restaged.

## PR #207 macOS Packaged Reply Acceptance

Head `ba58e70` passes the Windows gates and macOS source runtime checks, but
macOS run `42344506919` fails packaged runtime acceptance at the background-reply
empty-draft assertion. The fixture used `fill('')` and immediately read the send
button before confirming the controlled ProseMirror draft had cleared.

The fixture now uses the editor's native select-all/Backspace transactions,
waits for both model value and controlled empty state, and retains the disabled
send assertion. It also checks that the nonempty draft was sendable and clearing
it makes no follow-up request. The initial parent-idle poll now awaits the
resolved IPC snapshot rather than a browser-side Promise. No production code,
assertion requirement, deadline or CI inventory is removed or relaxed.

All 31 focused background-agent, composer and snapshot-polling tests pass.
Three Windows Electron reply replays and the composer-editing acceptance pass.
Fresh macOS source/package and current-head cloud results remain required;
the local Windows checks do not establish that the failing platform passed.

## Compaction Settings Main Synchronization (2026-11-07)

PR #207 integrates main `ff2f3b02`, including #206's execution-outcome and
incomplete-response handling. Only TODO and verification records conflicted.
Both implementation states and all complete verification sections from both
parents are preserved. The incoming execution implementation is unchanged;
compaction settings retain the explicit policy-migration retry fix.

Typecheck, production build and all 169 focused configuration, execution,
recovery, queue, timing and session tests pass. CI policy, inventory, runner
and summary tests pass 39 cases with one platform skip. Browser acceptance
passes the compaction settings matrix and all 24 execution-outcome cases.
Real Windows Electron settings-dialog and then_run acceptance also pass,
using isolated profiles and deterministic loopback providers.

The existing prepared runtime is not restaged. These local checks do not
establish new-head cloud CI, native macOS, packaged or real-account acceptance.
No installer, installed-profile change or historical-package deletion occurs.

## Context Maintenance Settings (2026-11-07, Local Implementation)

Settings > General now edits the Desktop-owned global compaction thresholds
through a narrow typed bridge and an isolated management-process adapter.
The default ratio is 90%, bounded to 50-95%. Advanced settings expose one
global token ceiling and per-model ratios keyed by `provider/id`; the pinned
runtime does not support a separate token ceiling per model. Configured ratios
remain distinct from effective thresholds and trusted project overrides.

Writes use the pinned upstream TOML parser, lock and atomic update function.
A revision checked inside that lock prevents stale threshold overwrites without
rejecting unrelated MCP edits. Reset removes only this editor's three threshold
fields. CLM/projection, enabled state, explicit reserves, permissions, credentials
and unknown options remain untouched. Legacy policy migration is explicit;
invalid TOML and linked Desktop roots fail closed. No raw document, private path
or credential is projected to the renderer.

Nine focused tests pass, including two real pinned management processes,
persisted TOML consumed by the native settings manager, stale writers,
provider-qualified model identities, trusted project overrides, reset isolation,
invalid configuration and linked-profile rejection. Typecheck and production
build pass. Browser acceptance uses the production component and checks
auto-save, keyboard focus retention, model inheritance, defaults, failed reads
and writes, conflicts, legacy policy, light/dark, Chinese/English, narrow windows,
four-sided focus clearance and reduced motion. The new verifier is registered
in the shared interface CI inventory.

PR #207's save retry retains explicit legacy-to-ratio migration intent until
the operation succeeds, settings are reloaded successfully, or another edit
replaces it. Browser regression first reproduced the no-op retry, then passed
for valid and invalid legacy thresholds, ordinary saves and reload without
implicit migration. Typecheck, all nine focused tests, production build and
the real Windows Electron settings-dialog acceptance pass again.

The full serial Desktop suite passes 1068 cases with 14 platform skips,
zero failures/cancellations, across 1082 cases in about 398 seconds.
CI policy/inventory/runner/summary checks pass 39 cases with one platform skip.

The existing Windows Electron settings-dialog acceptance also saves and reads
the real configuration through preload, resets it and confirms the current
draft/runtime/messages are unchanged. Existing settings navigation, themes,
narrow windows and draft retention still pass. Tests use temporary profiles,
without paid models or real account credentials.

Runtime verification uses the existing prepared v0.1.7 bundle at pin `29eb460`
through read-only runtime references, with current management helpers built into
this worktree's physical runtime root. The source pin and upstream patches are
unchanged; this is not a fresh complete source-staging or packaged acceptance.
There is no threshold hot-update RPC at this pin. Saving never reloads or
restarts resident workers, including reused empty workers; new runtime starts
and explicit manual restarts read the saved global values. Installer,
installed-profile changes and cloud acceptance are outside these local receipts.
The local artifact audit, excluding junction targets, records about 10.1 MiB
in `Desktop/dist`, 0.13 MiB in the physical runtime adapter root, 63.0 MiB
in the terminal runtime and under 1 MiB of Electron screenshots. These are current
development/verification inputs; no historical package is produced or deleted.
## Upstream v0.1.7 Runtime Stability (2026-11-07, Local Candidate)

This candidate starts from main `4318d6e` (merged PR #203) and retains the
`29eb460780489801ce8afc8bffc1a2efae7cbded` runtime pin. It does not implement
the parallel command-result presentation or automatic-compaction settings.

Startup now checks worker and transport ownership after asynchronous RPC,
snapshot and model restoration, including reuse of an empty worker. Closing
during startup cannot reactivate the removed session. An optional main-only
diagnostic hook distinguishes launch, process, session, snapshot and model
phases. The native background fixture preserves these observations before
cleanup, including on timeout. Diagnostics contain only a runtime UUID, validated
PID and timing/status fields, never paths, prompts, errors or environment values.

Windows shutdown no longer silently accepts an unsuccessful process-tree
termination helper or falls back to stopping only the parent. Helper success
must be followed by observing the captured child's exit. Exit code 128 is
accepted only when that exact child exits, covering the natural-exit race.
A failed shutdown retains a disconnected cleanup handle for explicit later
cleanup, both for single-worker removal and stop-all; it does not retry,
reactivate the worker or prevent peers from stopping. POSIX termination
semantics remain unchanged. Failure-injection and startup/close-interleaving
tests reproduce the defects before the fixes and pass afterwards.

The pinned native RPC fixture also covers a held background child completing
during Plan review: its result remains available without another parent model
turn or a premature completion notification. Cancelling the review keeps Plan
mode and does not release the background wake-up. Closing/reopening the session
restores Plan without restoring an approval or starting a request; an ordinary
follow-up remains a question in Plan, not an approval.

Typecheck and production build pass. The final serial Desktop suite completes
1089 cases: 1076 passed, 13 platform skips, zero failures or cancellations,
in 383.3 seconds. CI policy, inventory, runner, summary and motion-helper
tests pass 54 cases with one platform skip; 22 upstream Plan approval,
barrier and storage tests also pass. The rebuilt isolated real Electron Plan
verifier passes approval snapshots, drag dismissal, refinement, cancellation,
stale proposals, restart, expiry and fresh review. All nine native hosts
recorded by the background fixture have exited after the suite.

Final receipts are under this worktree's `Desktop/test-results/`:
`v017-regressions-suite-verified.log`,
`v017-regressions-build-verified.log`,
`v017-regressions-ci-policy-verified.log` and
`v017-regressions-plan-electron-verified.log`.

The first Electron attempt fails before a model call because the borrowed
runtime lacks main's Desktop-owned `project-instructions.mjs` extension.
The corrected local acceptance directory copies current Desktop adapters and
builds that extension, while linking the unchanged upstream bundle and Node
read-only. No shared runtime is restaged. This QA setup correction is not a
product fix or evidence about the historical macOS failure.

Excluding junction targets, this worktree owns 10.12 MiB of application build
output, 62.96 MiB of terminal runtime, 0.10 MiB of Desktop runtime adapters and
about 1 MiB of verification logs/screenshots. These remain current QA inputs
and evidence, not historical installers; no existing package is removed.

The earlier macOS background-runtime timeout still has no established root
cause; its successful rerun and the new diagnostics do not establish a fix.
Fresh cloud/native macOS execution, packaged/installer acceptance and real
account/model checks remain pending. All local native/GUI checks use isolated
temporary profiles and deterministic loopback models. No installed application,
shortcut, renderer contract, public release or version is changed.

### Main Synchronization Before PR

This branch now integrates main `ff2f3b02` (merged PR #206). Only this document
conflicted; both verification records are preserved. Incoming incomplete-turn
recovery and result presentation remain unchanged alongside the startup and
shutdown guards.

After synchronization, typecheck, production build and all 201 focused cases
complete: 199 passed, two platform skips, zero failures or cancellations.
The rebuilt Electron Plan verifier passes again; CI policy, inventory, runner,
summary and motion-helper tests pass 54 cases with one platform skip. Receipts
are `Desktop/test-results/v017-regressions-main-sync-{build,tests,plan,policy}.log`.
The complete 1089-case suite above predates this synchronization; it is not a
current-combination full-suite or cloud/native macOS acceptance claim.

### Local Review Follow-up

Local review reproduced a combined failure: incomplete-response recovery leaves
run ownership active during startup, then restoration and process termination
both fail. The startup catch retained its disconnected cleanup handle without
clearing that activity, blocking account and provider idle guards. Startup
cleanup now shares the failed-stop normalization used by removal and stop-all,
while preserving both worker and transport ownership checks.

Four new regressions cover snapshot/model restoration plus failed termination,
late recovery events, pending approval/timer cleanup, explicit later cleanup,
and replacement worker/transport ownership. Both combined-failure cases fail
before the fix; all four pass afterwards. Final-source typecheck, production
build and the rebuilt isolated Electron Plan verifier pass again. No runtime
restaging, installed application change or acceptance package is involved.

The complete current-combination serial Desktop suite now finishes 1108 cases:
1095 passed, 13 platform skips, zero failures or cancellations, in 423.9 seconds.
Receipts are `Desktop/test-results/v017-startup-cleanup-{suite,build,plan}.log`.
Current-head cloud/native macOS, packaged and real-account acceptance remain
separate from these local checks.

## Upstream v0.1.7 Result Presentation (2026-11-07, Local Candidate)

This stage leaves the runtime pin and patch manifests unchanged. Existing
tool cards now distinguish command exit failure, timeout, signal termination,
cancellation and unknown outcomes from invocation errors. Final applied diffs
survive failed or cancelled follow-up validation; pending or imported records
do not become applied changes. Native incomplete-response recovery retains
run ownership until settlement, without premature completion notifications,
queue delivery or timing finalization. Desktop does not add another retry.

The initial implementation passes the complete serial Desktop suite:
1086 cases, 1072 passed, 14 platform skips, zero failures or cancellations.
After the final cancellation-precedence and recovery-race corrections,
all 182 focused tests pass. These include two actual pinned-runtime tests:
applied edits with failed/cancelled validation, and native empty-response
recovery through a deterministic loopback provider, including exhaustion
and cancellation. The complete suite was not rerun after those narrow fixes.

Final-source Windows typechecking and production build pass. The new browser
verifier passes 24 theme/language/preset/viewport combinations plus recovery
and reduced-motion checks, using the actual transcript and diff components.
Light desktop and dark narrow screenshots were inspected. Existing Electron
then_run, completion-review, conversation-timing and general acceptance all
pass against the same isolated current-source build. CI runner and platform
policy tests pass 30 cases with one platform skip.

QA uses physical directories under
`D:/Desktop Runtime Builds/execution-outcomes-20261107/`, avoiding writes
through the workspace's shared runtime, dist and test-results junctions.
The v017 runtime includes the current project-instructions helper; an earlier
QA copy lacked it and was corrected before the final Electron run. Existing
then_run assertions were updated to require the structured exit/cancellation
facts, including after reload, without removing diff or permission checks.
Final receipts are in `acceptance/results.json` and the adjacent logs.

Current-head cloud CI, native macOS, packaged application, installer upgrades
and real-account/model acceptance remain unconfirmed. No commit, push, PR,
package, installed-app change or historical-package deletion is part of
this local implementation.

## Explicit Plugin Updates (2026-11-07)

The plugin-update branch adds explicit Git marketplace refresh and same-source
installed-package upgrades. It does not change the Step Code source pin.
Local native acceptance uses an isolated profile and the existing staged
v0.1.7 runtime (`29eb460780489801ce8afc8bffc1a2efae7cbded`), with management
helpers copied from this checkout, not the daily installation.

The 55 focused tests pass: native Git refresh (without implicit installation),
strict newer-version selection, staged replacement, icon change, installation
instance and source retention, byte-identical private settings and secrets,
service override preservation, stale-reference rejection, schema/service
compatibility guards, source-generation changes and existing plugin regressions.
The snapshot-race suite also injects locked-directory/binding/receipt writes and
replays six journal checkpoints, refusing foreign instances and changed packages.
Committed updates stay installed if temporary-file cleanup is blocked.

The production PluginCenter browser verifier covers the approved compact update
button, simulated failure/retry/restart, the native bridge adapter without fake
percentages, duplicate clicks, delayed catalog publication, localization,
light/dark themes, narrow layouts and visible focus outlines. The main/preload
bundle and production renderer build into a separate verification output.

The full capability Electron verifier passes against the isolated build and
profile using real upstream management APIs. Clicking update replaces version
1.0.0 with 1.1.0 and its icon, retaining the installation instance and exact MCP
configuration bytes. An active MCP connection blocks a later replacement through
the real IPC handler. The existing capability, configuration and navigation
regressions also pass.

These are local checks, not cloud CI, native macOS, public-market BVR upgrade,
paid-model acceptance, packaging or replacement of the owner's installed app.

## Upstream v0.1.7 Local Migration (2026-11-06)

The `codex/upstream-v017` worktree, based on main `1979ee7`, migrates the
development source pin to `29eb460780489801ce8afc8bffc1a2efae7cbded`.
This is the reviewed source associated with the announcement, not a verified
official release tag or binary/source equivalence. The previous two overlays
are already present in this source; the new manifest applies neither again.
Historical v015/v016 patch sets and release records remain unchanged.

All 19 shared Desktop patches and both Darwin patches are migrated, with one
final compatibility-test/formatting patch. The production applier replays
20 shared patches from a clean target and matches all 47 Windows postimages.
The Darwin source replay matches all 48 combined postimages, then reverses
cleanly. An intentionally incorrect postimage in a QA-only manifest fails
and fully rolls back. This source replay is not native macOS acceptance.

The existing Plan drawer now uses native pending-proposal state and mode
announcements. Main workers opt into both Desktop review and native review
surface flags; there is no structured `plan_review` UI RPC at this pin.
The compatibility adapter persists the pending hash before waiting and checks
the active branch leaf, Plan state, proposal path and complete content hash
before approval. Cancellation, expiry and stale decisions never approve.
A native test preserves the pending decision across ordinary questions and
session restoration; explicit `/plan off` clears it. Approvals identify the
user as decision owner. The removed model-facing entry tool stays removed.
Command execution still uses normal permissions, not a read-only sandbox.

Upstream tests cover 51 files in three runs: 1011 cases, 1005 passed, six
skipped and zero failures. The skips are three Linux process cases, two
real-model compaction cases and the removed-host-cwd fd regression because
fd is unavailable. That last scenario was not executed locally. Upstream
typechecking, scoped formatting checks, the offline build and final runtime
staging pass with Node 24.16.0. Staged pin, all source hashes and the current
manifest are checked again after staging.

The complete serial Desktop suite exits normally: 1030 cases, 1016 passed,
14 platform skips, zero failures or cancellations, about 360 seconds.
After final helper/documentation pin corrections, all seven focused staging
and slash-runtime tests pass, including a new manifest-selector guard.
Desktop typechecking and the production build pass. CI runner, inventory,
summary and macOS candidate-policy tests pass 35 cases with one platform skip.
The standalone bundle verifies usage totals/cache/cancellation and the actual
SQLite index worker, not JSONL fallback. The separate plugin verification
build helper also builds successfully against the current manifest.

Ten isolated Electron verifiers pass: Plan review, clarification, permission
approval, completion review, BTW, background-history liveness, background
replies, summary runtime, full-text search and Workflow. Plan acceptance
retains drag dismissal, drafts, refinement, approval snapshots, stale decisions,
restart and expiry checks. The narrow Plan screenshot was inspected.
These use temporary profiles and deterministic loopback models, not paid
models or real account credentials.

Builds and tests use physical directories under
`D:/Desktop Runtime Builds/upstream-v017-20261106/`, not writes through the
workspace's shared runtime/dist/test-results junctions. Receipts include
`replay-result.json`, `upstream-*-results.json`, `desktop-full-final.log`
and `acceptance/results.json`. Excluding symlinks/junction targets, the new
source tree contains about 320 MiB of logical file bytes, the application
mirror 205 MiB, clean replay and old-source trees about 17 MiB each, and the
separate verification output 6 MiB. These remain current QA inputs/evidence;
no installer is produced and no existing package is deleted.

Current-head cloud CI, native macOS builds/execution, packaged acceptance,
installer upgrades and real-account/model checks remain unconfirmed.
No commit, push, PR, installed-app change, public release or version bump is
part of this local implementation. See [integration boundaries](UPSTREAM_V017.md).

### PR #203 Command Outcome Acceptance Follow-up

The first cloud run builds the ARM64 candidate successfully, but Windows
command acceptance still expects a nonzero exit to be an invocation error,
and macOS native `then_run` acceptance still expects deadlines to throw.
The current source intentionally returns command facts in `details.execution`
instead. Acceptance now checks nonzero exit codes and structured timeout
status separately from invocation failure. A deadline may retain the native
executor's exit code; it is not forced to null.

Both corrected Windows verifiers pass against the local packaged candidate.
They retain missing-shell/no-fallback checks, timeout diagnostics, applied
file receipts, output truncation/no-rerun checks, descendant cancellation and
concurrent-shell isolation. The `then_run` RPC/UI checks also pass, including
permission denial and history reload. These are isolated fixture checks,
not real-account acceptance. Fresh current-head cloud checks and the final
committed-head package remain pending; PR #203 is not merged.

## Project Rules Latest Main Synchronization (2026-11-06)

This branch now integrates main `12c1317`, including #202's update-cache and
launch diagnostics and #204's plugin classification. Only this document
conflicted; every original verification section from both parents is retained.
The incoming cache, plugin and diagnostic implementations remain unchanged.

Typecheck, production build and 93 focused project-rules, fixture, questionnaire,
Goal, plugin and update-cache tests pass. Real Windows Electron project-rules
and Question drawer acceptance also pass using isolated loopback profiles and
the existing shared runtime, without restaging it. The earlier `5fca71d` cloud
checks were green; they do not establish cloud acceptance for this new merge.

## Project Rules CI Snapshot Polling (2026-11-06)

The first macOS candidate passed source runtime acceptance but its packaged
`/init` check asserted zero provider requests before dispatch completed.
Playwright's browser-side poll checks the Promise returned by an async predicate,
not its resolved boolean. The fixture now polls resolved IPC snapshots in Node
for response completion, streaming start and idle settlement. Request-count,
read-only tool and file-preservation assertions remain unchanged.

All 17 focused project-rules and fixture tests pass, including delayed snapshots,
async false predicates, bounded timeout and IPC error propagation. Typecheck and
the real Windows Electron `/init` fixture pass with three loopback model requests.
The existing shared runtime was not restaged; these local results do not replace
current-main macOS source/package acceptance in cloud CI.

## Project Rules Main Synchronization (2026-11-06)

This branch integrates main `e9102aa`. Conflict resolution retains main's
completion-review reservation/rollback, canonical template-input provenance and
the full plugin/runtime acceptance inventory alongside the project-rules changes.
Bare `/init` preserves a preselected completion review for the next ordinary
task; the actual IPC-handler regression verifies both submissions and consent.

After synchronization, typecheck, production build and all 144 focused
project-rules, review, command, queue, session, search and input-projection tests
pass. CI policy/inventory/runner checks pass 39 cases with one platform skip.
The actual-application installed-Edge preview passes its light/dark/Burgundy,
Chinese/English and 1280/390/320px matrix without page or console errors.

The full-suite and native Electron receipts below predate this synchronization.
The existing shared local runtime lacks the full current-main patch set; it was
not overwritten or represented as a fresh main-runtime acceptance. Complete
native source/package checks remain for the PR's cloud CI. No installer, merge,
release, profile change or historical-artifact deletion is performed.

## Question Drawer Drag Dismissal (2026-11-06, Local Candidate)

The Question drawer now follows the merged Plan drawer's downward gesture:
release more than 90px down at the compact-height boundary to defer the question.
This calls Answer later, never cancel or submit. Short drags retain size snapping;
cancelled gestures and lost pointer capture reset dragging without deferring.
Reopening retains the current question page, selected options and freeform draft.

Windows typecheck, production build and six focused questionnaire/Plan tests pass.
The actual Electron question acceptance passes with the isolated loopback provider,
including compact/expanded dismissal, short-drag snapback, cancelled/lost gestures,
the unchanged pending request and provider-call count, focus/composer restoration,
retained answers, narrow light-theme reduced motion and the existing submit/retry,
Plan gating, cancel and abort flows. The reopened narrow view is recorded in
`Desktop/test-results/questions-drag-reopened-narrow-light.png`.
No installer, cloud CI or native macOS acceptance is claimed.

## Project AI Working Rules (2026-11-06, Local Candidate)

Bare `/init` now detects the selected project's `AGENTS.md` and presents accurate
Chinese create/check descriptions through the existing command menu. Drafts can
discover the entry without starting a model or session; no selected folder asks
for one. The typed IPC exposes only the detected mode for the exact draft or
session owner. Failed reads are not treated as missing files.

The main process rechecks the file at dispatch and returns read failures through
IPC. Its idle check owns the mutation lock before awaiting runtime state; bare
`/init` is rejected at queue enqueue, edit and dispatch boundaries. A
Desktop-owned extension restricts tools only after model/auth preflight, through
`before_agent_start`. Create mode permits project reads and one bounded,
exclusive `AGENTS.md` creation tool. Check mode allows read tools only; write,
shell, delegation and unknown mutating tools are blocked even if a provider
returns a forbidden tool call. Ordinary tools restore at `agent_settled`, not an
intermediate `agent_end` during retry or compaction. Applying suggested updates
is a separate, explicitly approved ordinary task. The upstream pin and overlays
are unchanged.

Local Windows typecheck and production build pass. The complete serial Desktop
suite after the review fixes collects 910 tests: 896 pass, 14 platform skips and
zero failures in 265.8 seconds. Its log is
`Desktop/test-results/project-instructions/fixes-serial-tests.log`.

The real pinned-runtime test creates a file through the native tool path without
a permission override, blocks a misbehaving review provider's overwrite, retains
the file and restores ordinary tools for the next turn. Real Electron acceptance
passes using the actual preload, IPC and staged extension with a loopback
provider: draft discovery, ownership rejection, execution-time re-detection,
zero-model status queries, preserved Goal selection, rejected queued `/init`
replacement, visible errors with restored drafts, and successful retry after
fixing an unreadable rule file. Native regressions exercise an actual provider
503 retry and confirm the read-only guard survives it. Model/auth preflight
failures do not arm the guard. Main-handler regressions cover the async idle
race, lock/counter recovery and retry. The actual handler rejects bare `/init`
queue edits while preserving image/file-attached queue edits.

Internal instructions move into the current run's system prompt. Native
`message_end` replacement leaves only `/init` in agent state and authoritative
JSONL, including new SQLite search results. Legacy search confirms exact
envelopes from bounded canonical histories before projecting `/init`; internal
template-only hits are removed without rewriting JSONL or hiding ordinary prose
that merely resembles a template fragment. When a source cannot be confirmed,
the match retains its navigation identity with an unavailable excerpt rather
than disappearing or exposing unconfirmed template text. Each query has a
24 MiB source-read budget and retains the shared 12 MiB per-file bound.
Regressions cover large, missing, out-of-profile and mismatched sources, shared
budget exhaustion and source caching. Stale-index regressions also cover
removed entries, same-ID content replacement and obsolete session excerpts;
ordinary excerpts must match the current source before crossing IPC.
Both native SQLite and degraded JSONL fallback regressions pass.

CI policy, inventory, runner and summary tests pass under staged Node 24.16.0
with serial execution: 39 passes and one platform skip. The initial concurrent
system-Node run failed two process-tree termination checks and retained
test-owned children; only those verified children were stopped before rerunning.
This rerun does not establish a general fix for the initial termination failure.

The revised browser preview loads the actual `src/main.tsx` application inside
an independent viewport, with no preview CSS overriding application components.
The outer scenario controls are separate; only the data/IPC boundary is simulated.
The menu retains its original 34px single-line rows, right-aligned descriptions
and full native title tooltips, including grouped commands and skills.
The composer, attachments entry, permission/model/effort controls, context meter,
animated send/stop icon, transcript and performance footer are production UI.
The brand assets resolve from the public root rather than the fixture directory.

Installed-Edge acceptance passes 1280/390/320-pixel layouts in Original Light,
Original Dark and Burgundy, both languages, all four project states, multiline
drafts, IME/keyboard handling, inline command icons, simulated create-to-review
transition, read/selection failures retaining the draft, toolbar interactions,
full focus extents against clipping ancestors and reduced motion, without page
or console errors. Actual-app previewing also exposed React restoring a focused
editor through its getter-only selection properties. Both caret properties now
support canonical ProseMirror selection writes without changing the draft;
the browser regression covers range, collapse and backward-selection updates.
The latest typecheck/build, complete serial suite, actual-application browser
matrix and native Electron project-instructions, composer and fulltext-search
verifiers pass. The actual search component retains all unconfirmed matches and
their open/location controls in light/dark and narrow layouts without console
errors. Screenshots and logs are in
`Desktop/test-results/project-instructions/`.

The existing staged runtime (117.03 MiB), rebuilt Desktop output (9.79 MiB) and
focused evidence (1.46 MiB) remain needed for local inspection. No installer or
historical package was created or deleted. These checks do not prove real-model
project-rule quality, native macOS, cloud CI, installer or release acceptance.
The installed app and personal Step Code profile were not modified.

## PR #202 Packaged Goal-Clear Failure Diagnostics (2026-11-06)

PR head `2749ee5` passes all Windows groups and macOS candidate preparation,
interface and runtime source/package groups. macOS sessions job `127849966760`
passes its source inventory and packaged session-move, then fails at
`verify-launch-modes.mjs:279`: after the Clear goal click, the trigger remains
for the original 30-second wait. The failure snapshot still contains the complete
Goal; it does not record the click target, action error or clear-command receipt.
The final receipt gate correctly rejects that candidate.

The unchanged local launch workflow passes against the exact staged runtime.
Additional isolated runs extend the disclosure animation, use narrow geometry
and delay pointer release while recording click/IPC outcomes. Those runs also
pass with a real clear receipt. They do not reproduce or identify the native
macOS failure; no production Goal change, retry or timeout increase is justified
by this evidence. Early generated probes that did not match CRLF source are not
counted as instrumentation; later probes assert the actual hook was installed.

The verifier now observes only the clear command at its existing IPC handler,
forwarding the same request/result or original rejection without dispatching an
extra action. Bounded target-only pointer records, finite clear receipts and
allowlisted UI/runtime fields distinguish no-click, rejected/unconfirmed command
and stale display. Raw messages, Goal objectives, request payloads, provider
configuration and environment values are not printed. Main/page observations
are bounded in the test process, so a never-settling read cannot hide the first
failure; cleanup restores only the observer's own IPC wrapper and listeners.
All original UI clicks, Goal ownership/no-inherited-consent assertions and test
limits remain unchanged.

Five tests execute the actual callback bodies in separate main/renderer contexts:
exact forwarding, rejection preservation/redaction, ownership-safe restoration,
non-settling timeout and unavailable reads. Two real Electron fault probes execute
the verifier's actual catch path with a non-settling or rejected snapshot; both
retain the original failure and bounded timeout/unavailable evidence. The actual observer also
captures one resolved IPC receipt and a clear click in the successful real UI
path; the Goal and trigger disappear. Typecheck, production build, full local
launch acceptance and 116 focused Goal/runtime/cache/diagnostic tests pass.
Complete per-file verification executes 148 files: 142 pass and the same six
local files fail (capabilities timeout, project-trust, StepPage, template-input
runtime, undo and workflow-catalog); no failure is filtered or marked passed.
CI runner/inventory/receipt checks pass 30 tests with one platform skip.
Local Electron still uses an assertion-preserving
no-sandbox entry; this is not native macOS package acceptance. The original
macOS Clear goal root cause remains unconfirmed. New current-head source/package
CI evidence is required; a subsequent green run must not be called a diagnosed
flake or a confirmed product fix.

## Update Cache Junction Boundary Investigation (2026-11-06, local candidate)

This candidate starts from main `e9102aa`, including #195, #198 and #200 and the
owner's v0.1.7 TODOs. Final synchronization advances to `1979ee7`, which changes
only TODO completion records; the verified application/runtime inputs are unchanged.
The newly open owner #201 does not touch the update-cache module. This candidate
does not upgrade the runtime pin or duplicate that migration. Update-cache and
installer files are unchanged by those merges. This is routine maintenance of
the existing update-cache boundary, not a version bump or release-readiness claim.

Real Windows junctions created by both Node and the native directory tool carry
reparse tag `0xa0000003`. On this host, their targets have a `Global` substitute
prefix: `lstat().isSymbolicLink()` returns false and `readlink()` rejects with
EINVAL, while parent directory entries identify them as links and asynchronous
`realpath` resolves their targets. Consequently the previous lstat-only guard
accepts redirected cache paths. The isolated probe and actual tests establish
three distinct facts: preflight creates missing directories outside a redirected
root; startup cleanup removes an outside download-cache through a redirected
ancestor; file verification accepts an outside file if the redirected cache
itself is supplied as its trusted root. No actual installer is executed.

New tests verify the real fixture identity before exercising the production
helpers. On the old implementation they fail for external creation, missing
rejection and a deleted sentinel read directly through its outside path. The
narrow change inspects directory entries as well as lstat, checks existing
ancestors before recursive mkdir, rejects links during bounded cache traversal
and validates the file-verification root. Cleanup retains the existing behavior
for a redirected cache itself: preserve it without deleting its marker or target.
The check/use interval remains; this is not a claim to eliminate concurrent
adversarial path replacement or all Windows reparse-point behaviors.

Directory listings can omit short aliases or filesystem-normalized spellings.
The fallback validates canonical parent ownership and an ordinary target entry,
then rejects sibling links to the same target. Only lstat ENOENT is tolerated
while checking a missing root; a failed sibling target lookup cannot skip the
rest of the guard. Actual Windows 8.3 aliases pass normal prepare/hash/cleanup,
while a same-parent junction short alias is rejected before creation. A dangling
sibling does not block the ordinary alias or admit the redirect. Three formal
Windows tests now exercise ordinary short aliases and same-parent/outside short
redirects beside dangling links. Their helper restricts the input to the isolated
fixture and confirms canonical target identity before using the returned alias.
The same formal tests are run against the unmodified `e9102aa` cache module:
the ordinary path passes and both redirects fail because outside directories are
created. All three pass with the candidate and actually execute on this volume;
volumes without distinct short aliases report explicit skips, not coverage.
An earlier short-path edit was blocked by the local security hook. It was not
written through another tool; the constrained helper and tests described here
are separately accepted Write/Edit candidates, not a claim to have disabled or
cleared that earlier scanner finding.

Typecheck and production build pass. The latest focused update/cache/driver suite
passes 46 tests with five native-macOS-only skips (51 total). The real NSIS
fixture passes normal download, metadata refusal, corrupt hash refusal,
cancellation and retry, including removal of network hooks; it does not execute
an installer. Only its local assertion-preserving copy uses --no-sandbox because
normal Electron startup fails on this Windows host. Production and CI launch
settings are unchanged. macOS case/Unicode normalization is covered by the
canonical fallback design but has not been executed on native macOS here.

For combination validation, all 19 current shared patches replay from clean pin
`81e79bc4`; the complete runtime builds and stages with Node 24.16.0. All 45
source postimages and ten copied helper files match current inputs. The first
full-suite attempt is stopped after discovering that the mirror had no runtime;
its partial results do not establish acceptance. The replacement per-file serial
run executes all 147 files: 141 pass and six fail. After adding the three formal
short-alias tests, a second complete per-file run has the same 141/6 file result;
the final focused run requires a distinct short alias for the last directory
component and executes all three cases without skipping. Capabilities exceeds the
180-second outer deadline; the other failures are project-trust junction unlink,
StepPage linked-storage classification, template-input persisted metadata, linked
undo classification and workflow-catalog junction cleanup. An independent exact
`e9102aa` baseline with the same staged runtime reproduces those five files and
the three old update-cache failures (54 tests: 43 pass, eight fail, three skips).
The candidate removes the old update-cache failures; neither this comparison nor
the verified source hashes establish the causes of the remaining failures.
The capabilities timeout remains unlocated. Full local acceptance is not green.

All 31 CI runner/inventory/receipt tests execute from the real Git worktree:
30 pass and one platform skip. A bounded independent review checks the local
cache guard, missing-root handling and short-alias fallback; the identified
ENOENT catch-scope and dangling-sibling issues are corrected and rechecked.
A follow-up bounded review of the constrained short-path helper and formal tests
finds no blocking issues; dangling junction entries are asserted preserved as
well as their moved targets. The isolated helper has finite subprocess/output
bounds and validates canonical identity before returning a short alias.
No native macOS candidate or new cloud checks execute for this uncommitted
change. No commit, push, PR, installer, release, shortcut or personal-profile
change is part of this local candidate.

## Plugin Center Background History Main Synchronization (2026-11-06)

PR #195 now integrates main `af52f41`, including #198's background-history
liveness and #200's Plan drawer drag dismissal. Four conflicts preserve the
real SummaryMcp controls alongside runtime-owned background presentation,
both progress-regression histories and both verification records. Failure
diagnostics retain bounded snapshot/summary reads, distinguish navigation from
run activity and rethrow the original acceptance error even if evidence fails.
Four fault-injection cases execute the actual catch block, including
never-settling snapshot/summary reads and a rejected RPC.

Typecheck and the isolated production build pass. The complete serial Desktop
suite exits normally: 1029 total, 1015 passed, 14 platform skips, zero failures
or cancellations, about 335 seconds. CI policy/inventory/runner tests pass 39
cases with one platform skip. All 773 tracked Desktop inputs match the new
physical mirror `D:/DFSC-Preview-QA/plugin-conflict-sync-20261106-final/`.
The complete test log is `plugin-conflict-sync-20261106-full-unit.log` under
the same QA root.

Three production browser verifiers pass: PluginCenter, input/MCP and task
progress. Seven isolated Electron verifiers pass: background-history liveness,
summary runtime, task progress, background replies, Plan review, completion
review and capability management. Desktop/narrow summary and progress screenshots
are inspected. These use temporary profiles and loopback providers, not paid
models. Vite's cache is isolated in the QA mirror.

The runtime patch chain, overlays, pin and staging inputs are unchanged.
The previously isolated runtime is reused only after its exact pin, all 45
source postimages and all ten staged helper files match current inputs.
No runtime rebuild, installer, shortcut change, daily-profile mutation,
application restart, artifact deletion, PR merge or release is included.
Fresh cloud checks must validate the new head; previous green checks do not.
The new mirror occupies about 102.5 MiB excluding its two junction targets.
No application or runtime process remains under this QA path; nothing is deleted.

## Plugin Center Completion Review Main Synchronization (2026-11-06)

The authorized PR #195 synchronization now includes main `5c3fd21` and #199's
one-shot completion review. The three merge conflicts preserve both staging
capability sets, both TODO entries and both verification histories. The
task-progress mount-race fix in `8994a1b` is retained. No runtime pin upgrade,
test timeout increase, assertion removal or acceptance inventory exclusion is
part of this merge.

The production patch applier replays all 19 shared patches from clean pin
`81e79bc4`. All 45 Windows postimages match. Applying the Darwin additions
matches all 46 combined postimages; those additions are reversed before the
Windows build. This is source verification, not native macOS acceptance.
The fresh physical application mirror
`D:/DFSC-Preview-QA/plugin-review-sync-20261106-final/` and upstream checkout
`plugin-review-sync-20261106-upstream/` rebuild and stage with Node 24.16.0,
without writing through the workspace's shared dependency/runtime junctions.

Typecheck, production application/runtime builds and 199 targeted upstream
tests pass. CI policy/inventory/runner tests pass 39 cases with one platform
skip; they run in the Git checkout because the physical source mirror has
no Git metadata. The complete serial Desktop suite exits normally and
unassisted: 1003 total, 989 passed, 14 platform skips, zero failures or
cancellations, about 366 seconds. The log is
`D:/DFSC-Preview-QA/plugin-review-sync-20261106-full-unit.log`.

Three production-component browser verifiers pass: PluginCenter, input/MCP
and task-progress motion. Eight isolated Electron verifiers pass: completion
review, update-installer UI, capabilities, background follow-ups, BTW, quotes,
task progress and first-run lifecycle. Desktop and narrow screenshots are
reviewed. These use isolated profiles and loopback fixtures, not paid models.
The previous macOS packaged updater fixture's early exit was not reproduced
on Windows; its cause remains unconfirmed and current-head native cloud
results are recorded separately in PR #195.

Excluding junction targets, the new application mirror occupies about
206 MiB and its upstream checkout 52 MiB. The downloaded prior macOS interface
diagnostics occupy about 44 MiB. These are inventoried, not deleted.
No new installer, shortcut change, daily-profile mutation, application restart,
merge, release or public marketplace submission is included. The previously
delivered `8df1683` Windows package remains unchanged.

## Plugin Center Main Synchronization (2026-11-06)

The owner authorized synchronizing current main into PR #195 after the metadata
fix commit `8df1683`. The merge captures main `33abd6c`, including #196's
answer-only BTW/quote boundaries and #197's manual background follow-ups.
Five conflicts retain both lines' work: staging advertises template-input,
subagent-redaction and background-reply; the ordered patch manifest keeps all
18 shared patches; the task-progress fixture combines scenario-aware routing
with bounded failure evidence; both verification histories remain intact.
The plugin TODO is consolidated without changing other lines' completion claims.

A clean pinned checkout replays the production patch applier successfully.
All 44 Windows postimages match; the two Darwin additions apply and match all
45 combined postimages, then are reversed before the Windows build. This is
source verification, not native macOS acceptance. Pin `81e79bc4` is unchanged.
An independent physical QA mirror builds the production main/preload/renderer
and stages the rebuilt runtime with Node 24.16.0, without writing through the
workspace's shared runtime or dependency junctions. A missing local dependency
cache link initially interrupted the QA build; restoring that link in the new
QA checkout permits the complete offline build. No product fix is claimed for it.

Typecheck and all 36 targeted upstream tests pass. CI policy/inventory/runner
tests pass 39 cases with one platform skip. The full Desktop test suite exits
normally and unassisted: 980 total, 966 passed, 14 platform skips, zero failures
or cancellations, about 308 seconds. Its log is
`D:/DFSC-Preview-QA/plugin-main-sync-20261106-full-unit.log`.
Both production PluginCenter and input/MCP browser verifiers pass. Six isolated
Electron verifiers pass: first-run lifecycle, capability management, background
follow-ups, BTW, chat quotes and task-progress sound/impact/sweep/history.
They use local fixture providers, not real-account or paid-model requests.

The isolated mirror is `D:/DFSC-Preview-QA/plugin-main-sync-20261106-final/`;
the clean replay/build checkout is `plugin-main-sync-20261106-upstream/`
under the same QA root. Excluding junction targets, they occupy about 203 MiB
and 52 MiB; the two browser evidence directories total about 2.8 MiB.
Artifacts are inventoried, not deleted. Current-head cloud checks are recorded
separately in PR #195. No installer, shortcut change, daily-profile mutation,
application restart, PR merge, release or marketplace submission is part of
this synchronization; the previously delivered local package remains unchanged.

### Task Progress Mount Race (2026-11-06)

Cloud macOS runtime acceptance on `9824b73` captured a full task bar without a
phase while the final response was held. Retiring earlier completed tasks can
change the bar's key and mount it with every remaining task already completed
during an active round. That initial state did not enter either layout-effect
branch. A deterministic production-component browser regression fails on the
old code with a missing phase, then passes after initializing the non-animating
bar to `running` while busy or `complete` while idle. Mounting still emits no
completion sound or impact; the live completion event remains authoritative.

Typecheck, the isolated production build, 20 focused completion/summary tests,
the complete browser motion verifier and real Electron progress/history
acceptance pass locally. The regression retains delayed snapshots, scope
isolation, reduced motion and no-replay assertions. No timeout, inventory,
runtime pin, installed package or shortcut is changed. Current-head cloud
results are recorded in PR #195 rather than inferred from this local pass.

## Plugin Metadata Windows Package (2026-11-06)

The owner requested a fresh Windows package after the metadata fixes and
reported no significant remaining issue during local use. The package is
`D:/Desktop For Step Code/Desktop/release/plugin-center-20261106-metadata-fix-preview/`;
its installer SHA-256 is
`40217bc7db3ecb947a2284332591b96ef5bf15b9c778d5ce2b3ec9183d514b6a`.
It includes the fixes later committed as `8df1683` on base `07e6abf`, with all 760 captured
Desktop source files checked against the workspace. Pin `81e79bc4` and the
complete patched-source manifest are unchanged.

The packaged executable passed the same 16 Chinese/English, light/dark and
responsive native cases described below, using a new credential-free profile.
Cold-cache stars, four legacy marketplace matches, configuration restrictions,
sticky-header screenshot equality and renderer isolation passed. GitHub
responses were deterministic test values, not live counts; no paid model was
called. The fixture exited normally. File integrity also checked the renderer,
main/preload, runtime helpers, terminal resources and local BVR companion.
Receipts and screenshots are in the package's `acceptance/` directory.

After verification, the existing primary desktop shortcut was backed up and
redirected to this package's `win-unpacked` executable. Target, working directory
and icon were read back; arguments, hotkey and window style were preserved.
The daily profile was not changed, the installer was not run, and the owner's
old application was not stopped or restarted. The package is local, unpublished
and unsigned; it does not establish current cloud CI, native macOS, production
upgrade or real-account/billing acceptance. No older package was deleted.

## Plugin Metadata And Legacy Sources (2026-11-06, Local Source)

Installed cards no longer label every missing receipt as a local installation.
Recorded receipts retain their marketplace, including removed sources. Legacy
packages expose byte-identical full-package marketplace matches as display-only
candidates; modified or unmatched copies remain unconfirmed, and conflicting
installed IDs stay restricted. Matching never creates a receipt or authorizes
generic configuration.

Opening Plugin Center starts bounded, asynchronous public GitHub metadata
lookups. Cold caches keep a loading affordance, failed counts remain unavailable
rather than zero, and fetched snapshots survive navigation, language changes
and capability refreshes. Author-provided Chinese/English descriptions and
same-package documents follow the application language; three exact legacy
descriptions have compatibility translations. Arbitrary author prose is not
automatically translated. Sticky detail tabs cover the full scrolling gutter
without clipping or hiding form focus indicators.

Typecheck, isolated production build and 31 focused tests passed, including six
real pinned-runtime cases. Source regression covers multiple matching markets,
modified package content, recorded sources, duplicate IDs and configuration
authorization boundaries. The production-component browser verifier passed
cold/held/failed repository responses, locale switching, refresh persistence,
existing configuration flows, focus gutters and light/dark responsive layouts.
The broader pre-push regression then passed all 62 plugin tests, including
configuration, snapshot/settings races and the native runtime cases. Typecheck
passed again; CI policy/inventory/runner tests passed 39 cases with one
platform-specific skip and no failures.

Real Electron acceptance reproduced four pre-receipt installations in a fresh,
credential-free profile: BVR matched `bvr-local-preview`, Hermes matched
`dfsc-community`, and Playwright/StepPage matched `builtin`. All retained unknown
configuration provenance. Chinese/English, light/dark and four widths from
1440px to 390px passed, with equal sticky-header screenshot bands at two scroll
positions. Two deterministic public-metadata responses exercised the actual
preload/main-process path and cache, not live GitHub counts. Renderer isolation
passed and the fixture exited normally.

Evidence is under `D:/DFSC-Preview-QA/plugin-center-fixes-20261106-browser/` and
`D:/DFSC-Preview-QA/plugin-center-fixes-20261106-native-run4/`; the isolated source
build is `D:/DFSC-Preview-QA/plugin-center-fixes-20261106-app/`. These checks do
not rebuild the earlier preview package or change the daily profile, shortcut,
runtime pin, PR, marketplace contents or release.

## Plugin Center Latest Main Follow-Up (2026-11-05)

PR #195 integrates main `495d974`, including PR #193's subagent redaction,
without changing pin `81e79bc4` or either upstream overlay. The combined manifest
retains both template-input provenance and subagent redaction, with the
template-aware AgentSession postimage. Independent read-only review found no
additional merge defect in the four manual conflict resolutions or the
auto-merged main-process configuration guards.

A fresh pinned checkout replays all 17 shared patches and validates all 43
postimages. A separate physical QA mirror builds the production application and
stages the newly compiled runtime with Node 24.16.0; no build writes through the
workspace runtime/node_modules junctions. Typecheck, 62 focused staging,
background, conversation, subagent and shutdown tests pass. CI inventory,
policy and runner tests pass 39 checks with one platform skip. Both production
PluginCenter/input-MCP browser verifiers pass using the installed Edge.

The merged build passes real isolated Electron first-run lifecycle, capability
management, background controls, chained-runtime notification safety, BTW and
subagent status acceptance. Capability management initially failed at uninstall;
the unchanged full verifier passes on rerun. The initial serial unit run left
owned background-runtime processes alive after its assertions; those processes
were manually terminated, so that run is not counted as a clean full-suite
pass. No product fix for either transient observation is claimed. A separate,
unassisted serial rerun and fresh Windows/macOS cloud results are tracked in
PR #195 rather than inferred from the previous head's green checks.

The live production-component preview remains available on loopback port 5297
with a mocked bridge. It does not exercise the daily app, real credentials or
billing. New generated artifacts are isolated below
`D:/DFSC-Preview-QA/plugin-main-sync-20261105-*`: the physical application/runtime
mirror is about 201.6 MiB, clean replay 17 MiB and browser evidence 2.3 MiB,
excluding linked dependency targets. These were inventoried, not deleted.
No installer, shortcut change, daily-profile replacement, PR merge, release or
marketplace submission is included in this synchronization.

## Plugin Center PR Integration (2026-11-05)

The plugin-center/authoring branch initially integrates main `3158d8d`, retaining
full-text search, BTW, background controls and model selection. A fresh pinned upstream
checkout applies the complete hashed patch chain, including background/BTW and
template-input, without changing pin `81e79bc4`. It builds and stages with Node
24.16.0 in an isolated QA directory; shared runtime/node_modules junctions and
the owner's daily profile, shortcut and existing manual window are untouched.

Two independent reviewers reproduced five P2 defects, now fixed with
failing-first regressions:

- Match native ID normalization before duplicate detection.
- Bound the complete serialized UTF-8 configuration snapshot, including its
  newline, before writing; reject oversized input without changing the committed
  revision or secrets. Exact-boundary, multibyte and escaped input are covered.
- Complete uninstall identity/source/race preflight before revocation, then
  revoke only the selected installation. Rejected preflight preserves the saved
  configuration; failed native deletion remains revoked and incomplete.
- Refresh StepPage's catalog without asynchronously taking over another plugin's
  configuration or discarding its unsaved draft.
- Invalidate named MCP reads when the editor target, settings category or
  settings lifecycle changes. Late success/failure cannot replace newer drafts,
  including animated close and reduced motion.

Pre-onboarding source verification passes typecheck, production build, the five
real background/BTW/template RPC cases, 39 CI policy/runner checks with one
platform skip, both production PluginCenter/input-MCP browser verifiers and
isolated Electron capability-management acceptance. The standalone text plugin
passes 13 tests; both draft-07 schemas and five example manifests validate.
The complete serial Desktop rerun passes 930 tests: 916 passed, 14 platform
skips, no failures/cancellations. It uses the isolated Node/runtime, an explicit
production TSX config and physical test fixtures so runtime probes import the
same new bundle as the managed process, not the shared older runtime. The final
log is `plugin-skeleton-pr-20261105-full-unit-final.log`.
Merged full-text Electron acceptance also passes native IPC, read-only anchors,
filters, cancellation/races, focus return, draft/runtime/JSONL isolation and
theme/narrow checks.

The initial Windows/macOS cloud protocol runs exposed aliased temporary roots
(Windows short names and macOS `/var` versus `/private/var`). Test fixtures now
canonicalize their newly created, owned roots before deriving child paths.
Production canonical-root, ancestor and junction/race guards are unchanged.
A local aliased-TEMP reproduction fails before the fixture fix and passes all
49 focused tests afterwards, including a regression that still rejects aliased
plugin reads and private writes. Isolated capability-management and all eight
StepPage registration Electron cases also pass under the aliased temporary
directory. A complete aliased-TEMP serial rerun then passes 931 tests: 917 passed,
14 platform skips, no failures/cancellations. Its log is
`plugin-skeleton-pr-20261105-full-unit-alias.log`. These follow-up results precede
the subsequent first-run integration merge; they are not a cloud-CI verdict.

Main subsequently advances to `d0a1009` with first-run onboarding. The merge
preserves both typed bridges, the fresh Bootstrap/App handoff, the two plugin
configuration mutation guards and `finishFirstRun` serialization. Independent
read-only review finds no further integration defect. Post-merge typecheck,
production build, 21 focused tests, real first-run lifecycle and all eight
StepPage registration cases pass under aliased TEMP. First-run acceptance now
also asserts that Plan authorization blocks both plugin configuration saves.
The seeded plugin-management profile explicitly checks existing-profile bypass.
The post-merge isolated build is
`D:/DFSC-Preview-QA/plugin-skeleton-pr-20261105-onboarding-app/`.
The complete post-merge aliased-TEMP rerun passes 943 tests: 929 passed, 14
platform skips, no failures/cancellations
(`plugin-skeleton-pr-20261105-full-unit-merged.log`).

The second cloud run passes both platforms' protocol suites. Native acceptance
then identifies two legacy fixture mismatches: the full Electron script still
uses aliased temporary roots, and the fixed-settings script expects Plugins to
remain inside the settings modal. Only the Electron, settings-dialog and summary
runtime fixtures require further root canonicalization; independent review
confirms this bounded allowlist. The aliased-TEMP Electron failure is reproduced
before the fix and the complete script passes afterwards, including its fresh
profile branch. Settings acceptance now explicitly checks PluginCenter
navigation, retained draft/runtime/messages and the restored settings bounds.
Summary acceptance waits for a configurable real MCP switch and rejects read
errors. All three native scripts pass locally; cloud results remain separate.

The pre-onboarding production build is
`D:/DFSC-Preview-QA/plugin-skeleton-pr-20261105-app/`.
Actual isolated Electron acceptance repeats native discovery, install,
documentation, configuration, MCP initialization/tool calls, explicit restart,
service disable and uninstall/revocation for the independent text plugin.
BVR's independent main/ASR configuration and native MCP initialization also pass.
Browser/native checks include light/dark, narrow layouts, visible focus,
draft preservation and reduced motion. No real model or paid-account request
is made. Evidence/logs use the `plugin-skeleton-pr-20261105-*` QA paths.

This is source/PR validation, not an installer, native macOS or cloud-CI verdict.
No merge, release, public plugin repository, community registry/lock update or
market submission is included. Rebuildable QA artifacts are inventoried without
following junctions; deletion remains subject to owner authorization.
The inventory excludes linked targets: the current app is about 6.1 MiB, its
isolated runtime/toolchain/test mirror 207.7 MiB and clean upstream build 52 MiB.
Browser, text-plugin and BVR evidence use about 29.6 MiB combined. The older
6 MiB pre-integration source build is not current acceptance and is retained
pending authorized cleanup.

## Independent Text Workbench Example (2026-11-05, Local Only)

`examples/community/text-workbench/` is an independent source directory and local
market, separate from the two host-maintained starters and BVR. It uses only
public native/presentation/settings files and the unchanged MIT starter consumer.
Two offline MCP tools format supplied lines and report text counts; heading,
list style, maximum entries, exact deduplication and ordering affect real output.
The package includes a command, skill, author documentation, original PNG icon,
license, local SHA-256 inventory, tests and unpublished submission notes.
It has no host account access, remote dependency installation or frontend script.

Thirteen independent Node tests and both draft-07 schemas pass. A real isolated
Electron run against
`D:/DFSC-Preview-QA/text-workbench-20261105-build2/main.cjs` passes native discovery,
installation, form save, installed document navigation, changelog, native MCP
connection, command/skill loading, installed stdio calls, stale-revision refusal,
explicit service disable/restart and uninstall with binding revocation.
Light/dark and 1440/640/390px checks pass. No model or paid-account request was made.
Evidence and generated `verification.json` are under
`D:/DFSC-Preview-QA/text-workbench-20261105-run9/`; selected original screenshots
are copied into the independent source's `screenshots/` directory.

The rehearsal found a generic host defect: Discover entries used the marketplace
package reference for installed-plugin configuration. PluginCenter now retains
marketplace documents but resolves settings from the installed package reference.
There is no `text-workbench` name check or other plugin-specific host exception.
The existing production-component browser acceptance now includes this regression
using the configuration starter; it passes, along with typecheck, production build
and `git diff --check`. The full 868-test suite below was not rerun for this small
renderer-only fix. Its earlier result is not presented as a new full-suite run.

The new build stages current helpers without writing through the runtime or
node_modules links. It retains the existing pin and validated patched source set.
No installer, daily shortcut, production profile, commit, push, public repository,
community registry/lock or submission was changed. Local file hashes are not a
published Git SHA. Public sync/submission, production availability, native macOS
and real-account acceptance remain separate steps.

Generated workbench QA directories were inventoried without following junctions:
about 132 MiB total, including the final roughly 6 MiB build and 14 MiB acceptance.
Earlier failed harness runs remain pending owner-authorized cleanup; no prior
package or unrelated checkout was deleted.

## Plugin Skeleton Stages I-V (2026-11-04, Local Branch)

The branch implements the optional presentation and declarative configuration
protocols described in `PLUGIN_AUTHORING.md`, with draft-07 JSON Schemas under
`plugin-schemas/`. Native plugin identity remains authoritative. Desktop owns
persistent source/installation records and opaque snapshot references; legacy
unconfirmed installations and duplicate native IDs cannot acquire a configuration
or secret binding. Interrupted publication and failed uninstall retain incomplete
records rather than claiming a complete installation.

Documents come from the selected installed or marketplace snapshot, on demand,
with bounded local PNG/JPEG/WebP, relative Markdown navigation and anchors.
Remote images, HTML and third-party frontend execution remain disabled. GitHub
Stars are cache-only during catalog reads; explicit refresh uses the main-process
fixed GitHub API route, bounded concurrency/payload/deadline, persistent cache
and failure cooldown. A real opt-in query from the Electron BVR page returned
18 Stars at `2026-11-04T11:27:14.023Z`; this is a dated observation, not a live value.

The six-field-type configuration form uses a native picker, explicit secret
keep/replace/delete intentions and optimistic revisions. The `json-file-v1`
consumer validates the installation, package/schema hashes and committed snapshot
content. Initialization fixes the revision; later changes/revocation require an
explicit restart. The sentinel prevents automatic Step account injection.
The native `format_note` example applies saved prefix/case/length settings in a
real MCP round trip against a local provider fixture, without a paid account.
BVR retains its separately authorized host bridge; it is not a generic privilege.

Independent review identified five P2 defects during implementation: mixed
installation snapshots, unbound configuration payloads, mid-read revocation,
parent-directory read races and a private-write junction race. All have fixes
and negative regressions. Review confirmed no remaining P1/P2. Private writes
verify the actual opened handle and ancestor identities before secrets, and
truncate uncommitted content through that handle on failure. Final small fixes
also prevent a close failure from skipping cleanup and make the filesystem
substitute genuinely open the external target in the race test. This protocol
is not an OS sandbox for untrusted native code.

The final current-source verification build is
`D:/DFSC-Preview-QA/plugin-skeleton-20261104/build-6/`.
It validates the existing pin and complete patched-source manifest before linking
the cached runtime, stages current management helpers in the isolated output,
and builds the production main/preload/renderer. The runtime and node_modules
junction targets were not written through. Pin `81e79bc4` is unchanged.
An earlier shared-runtime test input lacked the already-existing template-input
overlay; the isolated build selects the matching cached runtime instead of
weakening that regression or changing the pin.

The final full serial run against build-6 collected 868 tests: 854 passed,
14 platform skips, zero failures (`desktop-tests-build6.log`). Typecheck,
focused race/configuration/library/Star checks and the
CI-inventory policy tests pass (34 policy tests, 33 passed, one platform skip).
An additional seven-case library run passes, including the subsequently added
missing/corrupt/oversized/image-count/aggregate-size regression.
The final combined library/native run passes all 11 cases, including two
simultaneous install requests producing exactly one installation.
Both JSON Schema documents and all three presentation examples plus the
configuration example validate with AJV 6.15.0. No new validator dependency was
added to the product.

The final production-component browser acceptance uses installed Edge and mock bridge
data, covering light/dark, 390/640/900/1440px, draft retention, stale save review,
secret clearing, local navigation, native-picker calls, reduced motion and
unclipped focus, including a six-layout generic-control focus matrix.
Actual isolated Electron acceptance against build-6 additionally installs the
resource and configuration starters, reads and decodes their local documentation
image, saves a secret without readback, consumes `Electron HELLO` and explicitly
restarts into the connected native MCP. BVR's real installed package document,
tutorial, independent settings and native MCP initialization also pass without
a model request. Evidence is under `Desktop/test-results/plugin-center-live/`,
`Desktop/test-results/plugin-skeleton-electron.png`, and the QA root's
`bvr-electron-build6/` and `resource-starter-final/`.

The resource starter includes an actual isolated Electron capabilities screenshot.
The configuration starter is a host-maintained local tool, not the independent
third-party rehearsal. BVR adds only `dfsc.plugin.json` and `docs/DFSC.md` in its
separate checkout. The separate community checkout adds authoring guidance and
a sync regression proving presentation/settings/docs/images/consumer resources
are copied and hash-locked; 22 tests collected, 21 passed, one Windows symlink
permission skip. No registry entry, lock, public market resource or submission
was changed. Stage VI waits for the owner's skeleton freeze.

No installer was produced, no shortcut/profile was changed, and nothing was
committed, pushed, submitted or published. Existing installed preview packages
do not contain this skeleton merely because this local build passes. No cloud
CI, native macOS, real-account billing, power-loss recovery or production-profile
migration is claimed. The final build owns about 6 MiB excluding its two shared
runtime links; BVR acceptance directories are about 13 MiB each. Older QA outputs
were inventoried and retained because deletion was not authorized.

## Template Input And MCP Preview Package (2026-11-04)

A new local unsigned Windows x64 0.6.0 package is under
`D:/Desktop For Step Code/Desktop/release/plugin-input-mcp-20261104-preview/`.
It contains this branch's plugin/BVR changes and both template-input and Summary
MCP fixes, not the separate BTW feature line or a public release.

The packaging script accepts an explicit patched upstream checkout, validates
its pin and every patched-source hash, and restages only inside a new isolated
build directory. The packaged runtime retains pin `81e79bc4` and Node v24.16.0;
its manifest includes `desktop-template-input` and agent-session hash
`7da82915cba850bc91614be564d545c1196f4538`. The shared runtime junction was not
modified. File integrity passes for 693 source files, 101 archived Desktop files,
1,331 runtime files, 27 terminal files, ten extra-resource files, twelve BVR files
and eleven local-market files. Installer SHA-256:
`de49047a9a70e2e271034cff898700c2f0a97e959d431905c823c5fb7323e8fa`.
The installer size and SHA-512 match `latest.yml`; Authenticode is NotSigned.

The actual shipped executable passes general Electron acceptance and real BVR
configuration/MCP initialization using isolated profiles. All 18 focused
template/capability tests pass against its shipped runtime, including original
input, model expansion, steering and saved-history reopen. The production
transcript/Summary browser checks also pass. No paid or real-account request was
made. Evidence is in the package's `acceptance/` directory.

The primary desktop shortcut now points to this executable, without a profile
override. Its previous BTW-preview link and before/after receipt are preserved
in `acceptance/`; the daily profile was not changed or restarted. The package
(about 651 MiB) and isolated build (about 207 MiB) are retained for this acceptance.
No old packages were deleted, no installer was run, and no cloud CI or release
publication is claimed.

## Template Input And Summary MCP Fixes (2026-11-04, Local Branch)

The transcript now uses versioned runtime expansion provenance for slash-template
inputs, not template wording. An additional reviewed overlay records the original
input in user-message metadata while retaining expanded model content. The pin
and upstream overlays are unchanged. Unmarked older history is left untouched.
Pending-message and model-selection receipts acknowledge the original queued
input, including steering, rather than the expanded prompt body.

Summary MCP switches now use the existing persistent capability mutation.
Saving does not close a live connection: the panel shows Restart pending and an
explicit current-session restart action. Runtime-owned connection counts remain
unchanged until that restart; active work and scheduled-host guards remain intact.
The two distinct BVR service names are not combined or automatically removed.

Typecheck, 82 focused BVR/capability/message/queue/summary/native-RPC tests and
the complete serial Desktop suite pass (836 collected, 822 passed, 14 platform
skips, zero failures).
The native test uses a separately built pinned runtime with local provider
fixtures and covers template/skill expansion, original-input receipts, steering,
follow-up, saved history and reopen. Provider requests contain the expanded body
but no presentation metadata. The complete Desktop overlay chain reapplies in
the isolated source checkout and every patched-source hash matches the manifest.
Production-component browser acceptance passes on installed Edge in light/dark
themes at 1440, 640 and 390 pixels, including copy/edit/reload, exact service
targeting, external settings refresh, busy states, failed saves, rejected restarts,
visible switch thumbs, unclipped keyboard focus and reduced motion.

Browser evidence is under `Desktop/test-results/plugin-input-mcp/`. The runtime
build is under `D:/Desktop Runtime Builds/bvr-input-origin-20261104/`. The shared
runtime junction, daily application package, credentials and user configuration
were not changed. No real-account model request, installer, cloud CI or native
macOS acceptance is claimed.

## Plugin Center Preview Package And Authoring Starter (2026-11-03)

A fresh local unsigned Windows x64 0.6.0 package is under
`D:/Desktop For Step Code/Desktop/release/plugin-center-20261103-preview/`.
It contains the current uncommitted plugin-center/BVR integration, not a release
or an import of another feature line. The isolated build snapshots current
Desktop sources, copies the cached runtime without modifying its shared junction,
and updates only the copied Desktop runtime helpers. The upstream pin is unchanged.

Package integrity checks match 681 source files, 101 archived Desktop files,
1,331 runtime files, 27 terminal files, ten extra-resource files, twelve BVR
source files and eleven local-market files. Extra resources are verified at
their actual resource paths, not assumed to remain duplicated in app.asar.
Installer SHA-256:
`8d7a0688a06224eaced2f11f16e6fb8928ed7af713af7e963007412ae7887d4e`.
The updater size/SHA-512 metadata matches; Authenticode is NotSigned.

The shipped executable passes general Electron acceptance with isolated first-run
and reopened profiles, real RPC, settings, rename, MCP, themes, narrow layout and
renderer isolation. Its BVR-specific acceptance installs the real resource,
saves separately redacted main/ASR connections, initializes the real BVR MCP,
and switches to Follow DFSC. No model request is made. An initial run reached
the final state but timed out taking a background screenshot; the final run
uses the existing nonfocused compositor flags and passes without removing tests.

A new `manual-preview-profile` contains the matching local BVR resource and
runtime source snapshot, without copied credentials. The shipped executable
opens its real configuration/capability pages, renders its icon, passes the
local environment check and cleans the bridge descriptor on orderly quit.
These receipts and screenshots are in the output's `acceptance/` directory.
The local BVR dependency junction is not portable. Installing the DFSC installer
does not install that separate BVR runtime or copy the prepared preview profile.

The authoring guide and two-layer examples are in `docs/PLUGIN_AUTHORING.md`
and `examples/plugins/`. The minimal resource passes the community manifest
validator and native discovery/install/skill/prompt-loading/uninstall acceptance
against the shipped runtime. The host field template typechecks against the
Desktop dependencies/shared components, but is not a dynamically loaded plugin
frontend. Starter evidence is under
`D:/DFSC-Preview-QA/plugin-center-20261103/starter-native-final/`.
Desktop typecheck also passes. A final 36-case BVR/capability regression passes
against the shipped `resources/runtime`. An initial run accidentally selected
the old shared helper and failed its repository-metadata assertion; the explicit
runtime selection corrects the test input without modifying that shared runtime.
The desktop primary shortcut now targets the new executable with no profile
override; the separate `BVR Preview.lnk` uses only the prepared preview profile.
The previous primary shortcut and readback receipt are retained in `acceptance/`.
No installer execution, real billing, marketplace
publication, cloud CI, macOS acceptance or production-profile migration is claimed.

## Main-View Plugin Center (2026-11-03, Local Branch)

The plugin catalog and detail configuration now use the production main-view
component. Sidebar, Settings and local plugin commands share this entry.
Installed/discovery/marketplace management uses the existing native management
APIs. An exact-owner, atomic MCP-service switch preserves other overrides,
credentials and tool settings; it does not unload skills or commands. BVR has
two independent Step connection groups and Desktop-owned private configuration.
Other plugins retain technical MCP settings; no arbitrary plugin UI is executed.

Both repositories pass type checks and the isolated Desktop production build
passes. The serial Desktop suite collects 832 tests: 818 pass, 14 platform skips,
zero failures. A later 39-case focused BVR/capability/StepPage regression also
passes. BVR has 42 passing tests, including changed/deleted configuration,
separate ASR credentials and a configuration change between ASR and synthesis
blocking the second model request. The old independent child cannot adopt the
new setting without restart or continue sending new model requests with stale
credentials.

Production-component browser acceptance passes in light/dark themes at 1440,
640 and 390 pixels, with independent connection fields, native-picker bridge
calls, blank-key retention/redacted reads, navigation drafts, stale-save
preservation, reduced motion, four-sided focus visibility and no horizontal
overflow. The bridge is mocked in this browser fixture.

Real Electron capability management passes in an isolated profile, including
marketplace install/removal, live MCP/configuration distinctions, protected
plugin removal, explicit restart and refresh locking/failure recovery. Actual
BVR installation, saving two private connections and initializing the real MCP
child also pass. A real Step runtime separately discovers BVR, completes a tool
round trip and exercises native session consent against local provider fixtures.
No paid request or real-account credential is used.

The adapted StepPage native acceptance also passes: explicit main-view setup,
official download/integrity validation, 13-tool MCP handshake, disabled state
after relaunch, tampered-bundle quarantine/repair, and idle Cron-host/job
preservation. The protected Cron restart error remains visible across polling.
Fixture navigation waits for loaded entries and real sidebar inert state;
direct fixture-created hosts are synchronized before UI interaction. Shutdown
uses the shared orderly-close helper and its normal quit review, not forced
application exit.

Evidence is under `D:/DFSC-Preview-QA/plugin-center-20261103/`, including
`implementation-browser-final`, `implementation-build-4`,
`bvr-settings-electron-final`, `bvr-host-final`, `capabilities-final.log` and
`steppage-final.log`, plus `implementation-unit-tests-final.log`.
Verification builds link existing runtime
directories read-only; neither the shared staged runtime nor its pin was
modified. These are local source/build checks, not an installer, shortcut update,
marketplace publication, cloud-CI success or native macOS acceptance.
The subsequent package and shipped-executable checks are documented above.

## BVR Follow-Account Integration (2026-11-03, Local Branch)

The optional BVR bridge is based on main `fb4828b`; the upstream runtime pin
and overlays are unchanged. Both repositories pass type checks. Desktop's
serial suite collects 824 tests: 810 pass, 14 platform skips, zero failures.
The BVR suite has 37 passing tests, including legacy independent configuration,
hosted launch isolation and fixed research-context revisions.

ASR regressions cover all four paired regional Plan/API endpoints, the dedicated
ASR model, ASR-then-summary context pinning, session confirmation and Plan ASR
failure without direct API retry. These tests use fixture provider responses.

An isolated staged Step runtime discovers the real BVR plugin, launches its MCP
child and completes a video-tool round trip. The launcher's real parent PID binds
the request to that resident session; native session confirmation is exercised.
The runtime model and bridge provider responses are local fixtures. Separate
real-MCP acceptance covers Plan failure without API fallback, an explicit
overseas API account switch and logout rejection. Native marketplace discovery,
resource loading, install/remove/reinstall and independent-mode startup pass.
The community resource schema validator accepts the ten-file plugin package.

Actual Electron startup with the new main-process bundle passes in an isolated
profile: renderer state excludes the bridge capability, Node remains unavailable
in the renderer, missing opt-in rejects requests, and shutdown removes the
connection descriptor. The unchanged renderer/preloads come from the same main
baseline. Evidence is under `D:/Desktop Runtime Builds/bvr-follow-dfsc-20261103/`;
the ASR correction reruns are in `plan-asr-native-acceptance/` and
`plan-asr-correction/` within that directory.

A local unsigned Windows x64 preview was built at
`D:/Desktop For Step Code/Desktop/release/bvr-follow-dfsc-20261103-preview/`.
It remains version 0.6.0 and includes the uncommitted feature changes from both
repositories, recorded in `source-receipt.json`. Cached runtime reuse was
validated against the pin, upstream overlays, platform hashes, bundled Node
hash and eight current Desktop runtime helpers; it was not restaged through the
shared runtime junction. Packaging follows the existing isolated-app bundling
pattern without collecting shared development dependencies.

Package verification matches 105 Desktop bundle files, 1,331 runtime files,
27 terminal files and seven extra resources against their build inputs.
Installer SHA-256 is
`34bfa59db8a28ddf726dbc03aed33c856d8c959258ddae3fc05b2e8ca9a28558`;
the generated update metadata matches its size and SHA-512. Authenticode reports
`NotSigned`. The actual unpacked executable passes the BVR startup/isolation
smoke and general Electron acceptance, including settings, real RPC, rename,
MCP, themes, narrow layout and first/reopened home profiles. Native marketplace
discovery, installation, resource loading, real BVR MCP initialization/tool
declarations and uninstall/reinstall preservation also pass against its shipped
runtime, without a real provider request.

A separate `manual-preview-profile` is prepared with the local plugin installed
and following DFSC. The actual packaged app's IPC catalog and plugin UI confirm
the installed plugin, enabled MCP declaration, skill and rendered PNG icon.
Shutdown removes its host descriptor. `BVR Preview.lnk` in the output directory
uses only this isolated profile; the primary desktop shortcut is unchanged.
The resource ZIP has the market catalog and ten plugin files, without dependency
trees or credentials. The BVR source snapshot uses a local dependency junction
and is explicitly not portable. Integrity, screenshots and setup reports are
under the preview's `acceptance/` directory.

No real credentials, billed model requests, external videos, installer execution,
installed app replacement, cloud CI, marketplace publication or native macOS
acceptance are represented. Plan ASR retains the existing BVR dedicated-model
route on the selected Plan endpoint; real-account ASR availability and billing
have not been retested in this integration. Abort cannot undo a request already
accepted by a provider.
## PR #198 full-progress mount regression (2026-11-06)

Head `5bcd1b2` passes all three Windows groups. macOS candidate preparation,
interface and sessions groups pass, including source and packaged session-move.
The runtime source group passes; its packaged group fails at
`verify-task-progress-electron.mjs:127` after 30 seconds, with progress `1/1`
and no `data-phase`. The final receipt gate consequently rejects that candidate.
The older background complete scenario passes this run in 9.2 seconds through
acknowledgment, idle and cleanup; this does not establish the old timeout's cause.

The task-progress script is byte-identical to main `5c3fd214`. An actual production
component experiment deterministically reproduces the missing phase: replace a
running `2/1` component with a full `1/1` component while `busy` remains true.
Both initialization branches are skipped because the previous busy/scope refs
already equal mount-time props. SummaryBoard keys progress on the task IDs, so
changed task sets can remount a full progress bar. The exact cloud event ordering
is not captured, but this is a verified product defect matching the failing state,
not a reason to increase the timeout or retry the acceptance.

The narrow fix initializes an absent phase to running only while busy. Existing
settling/complete feedback, buffered completion, scope changes and idle full
snapshots remain unchanged. Formal motion regression cases exercise full initial
snapshots and task-set replacements, no premature sound, real completion and idle
reopen without replay. The new formal regression fails on the old component with
`null !== 'running'` and passes with the fix. The independent actual-component
experiment also changes from null to running; it does not copy the state machine.

The former diagnostic `busy` field read `.conversation[aria-busy]`, which is
navigation state, not foreground run state. It is now named `navigationBusy`.
Bounded DOM fields and a one-second snapshot observation separately report the
working indicator and native `isStreaming`/runtime status. Observation failure
never replaces the original exception. It is not valid to infer early model
termination from the older navigation field.

Local typecheck, production build and 127 focused summary/runtime/background/
review/helper tests pass. Formal motion acceptance and task-progress Electron,
history-liveness, background-replies and completion-review acceptances pass.
Ordinary Electron startup currently exits before the fixture on this Windows
host; only assertion-preserving isolated scripts use `--no-sandbox`. The motion
script uses an isolated Vite cache because the shared dependency cache rejects
unlink. Neither adjustment changes production/CI launch settings, assertions or
deadlines; these results are not native macOS packaged acceptance.

The first full serial attempt stalls inside capabilities tests and is stopped
without a final count or success claim. Per-file serial verification executes all
135 test files: 129 pass and six fail. Capabilities exceeds the 180-second outer
deadline; the other failures are project-trust junction unlink (EPERM), StepPage
linked-storage classification, linked undo, installer redirects (three assertions)
and workflow-catalog junction cleanup (ENOTEMPTY). An independent exact `5bcd1b2`
baseline reproduces the same seven failed assertions across the latter five files
(53 tests: 43 pass, seven fail, three skips). This establishes they are not newly
introduced by this task-progress change, not that their underlying causes are
resolved or safe. The capabilities timeout remains separately unlocated.

All 31 CI runner/inventory/receipt tests run from the actual Git worktree: 30 pass
and one platform skip. The mirror has no Git metadata and is not a valid location
for the receipt CLI's Git identity test. The bounded diagnostic observation is
also fault-tested with a never-settling read; it returns unavailable and rethrows
the original failure. All 843 candidate inputs match the validation mirror.
Local full verification is not green and is not compared as an exact test count
to the previous one-process run because capabilities did not finish. Replacement
current-head cloud gates remain required. Runtime pin, overlays, all 18 patches
and postimages are unchanged; no installer, release or personal profile is modified.

## PR #198 main integration and acceptance corrections (2026-11-06)

Main `5c3fd214` (#197 background replies and #199 completion review) is merged
without rewriting the published PR ancestry. Four conflicts retain both
background-observation invalidation and completion-review event/ownership
handling, both renderer imports, all verifier registrations and both dated
verification records. The reply capability, request deduplication, selected
session gate and one-shot review reservation remain intact. None of main's
18 runtime patches, its pinned commit, upstream overlays or postimages changes
in this Desktop state fix.

The latest old-head Windows sessions job `127410474542` fails in
`verify-session-move.mjs` with `page is not defined`: its module-level Cron
assertion helper referenced a page local to the test's try block. The previous
copied-function simulation did not exercise this scope and was insufficient
verification. The helper is now an actual imported module with an explicit page
parameter. Success throws outside the error-classification catch, so it cannot
be misaccepted as a Cron rejection. Only the exact preflight
`Session operation in progress` error is retried, at most five 500-ms waits;
other errors propagate unchanged. Eight tests call the real helper and cover
page selection, rejection, exhaustion, unexpected success and non-preflight
operation errors. The old implementation's missing binding is reproduced by
executing its actual extracted function, not a copied approximation.

Old-head macOS prepare job `127410346947` times out in the native background
complete scenario at 60 seconds. That failure has no execution-phase evidence,
so it is not attributed to graceful shutdown, runner capacity or a resolved
flake. The parameterized fixture now records allowlisted execution/cleanup
phases and bounded failure state before rethrowing its original error. Cleanup
releases every fixture gate and closes HTTP connections before awaiting the
runtime pool; server closure runs even when pool shutdown fails. Three local
complete-scenario runs pass, but this does not reproduce or prove resolution of
the native macOS timeout. The original per-test and CI deadlines remain intact.

Manual replies do not append parent `agent_send` tool results. To keep the new
observation cache from surviving those actions, the selected-session reply
handler invalidates display observations before and after the existing native
reply service, including unconfirmed delivery. Tests exercise the actual
BackgroundAgents service and preserve its receipt/error result. Invalidation
never modifies event-owned lane state, dispatches a second prompt or changes
reply deduplication. Completion-review busy/consent and completion-notification
guards are unchanged.

The combined 18-patch runtime replays from a clean pinned checkout and builds
offline. Node 24.16.0 staging matches all 45 shared postimages and advertises
both background-reply and completion-review capabilities. Both Darwin additions
also apply and match 46 combined postimages on Windows; this is not native macOS
acceptance. Desktop typecheck and production build pass. The focused combined
runtime/state/review suite passes 71 tests before the additional exact-operation
helper case; the final helper suite passes all eight cases. History-liveness,
background-replies, completion-review, background-controls and hidden-messages
Electron acceptances pass with isolated loopback providers.

Final combined local verification collects 939 serial Desktop tests: 924 pass,
14 platform skips and one pre-existing file-URL marketplace clone failure.
Typecheck and production build pass; 843 candidate inputs match the validation
mirror byte-for-byte. CI inventory/policy/runner checks pass 30 tests with one
platform skip. The complete native session-move script still stops earlier at a
missing command-generated file in this Windows environment; its original
file/command assertions are retained. Replacement current-head Windows/macOS
checks remain required, including the native completion scenario and complete
source/packaged session-move acceptance. No package, shortcut, personal profile
or original dirty worktree is changed.

## Background transcript state and live activity (2026-11-05, local uncommitted candidate)

The candidate starts from main `7c349b73`, including #196's BTW boundary update.
It does not import the open background-reply PR #197 or modify any of the 16
runtime patches, their pin, overlays, source postimages, or capability IDs.
The current patch chain is replayed from a fresh pinned checkout and built
completely offline. Node 24.16.0 staging matches all 43 Windows postimages.

Two isolated native RPC probes first demonstrate the defects: a retained lane
restarted by native `agent_send reply` has a real array-shaped running result
while the old transcript projection remains completed; after suspending an
active child and reopening its saved session, the native registry is empty and
the host idle while old history still reports running and blocks relocation.
The native lifecycle forbids progress after a terminal event in the same turn,
but a legal reply can reuse the lane ID for another turn. Therefore the fix does
not impose a permanent terminal-state lock or infer lifecycle from result prose.

Desktop now consumes validated, bounded array-shaped control results while
retaining the old object-shaped history. Current lane activity is projected
separately: native live status events remain the sole process-ownership source,
while registry observations are display-only and invalidate on transport,
session, generation or structured lifecycle changes. A stale observation cannot
release a newer running/settling owner. Only a validated current roster revises
the display; an unavailable registry means "not observed yet", so the
history-derived running status persists instead of being downgraded, and
unknown registry state still fails closed for relocation. Old unresolved
transcript status alone no longer owns the host. No child transcript is loaded
to invent a missing final outcome.

The five native RPC scenarios pass, including actual follow-up execution and
suspend/reopen. Pre-existing journal entries retain their exact bytes. Native
reopening appends resource-discovery records in this environment, so tests check
that bounded allowed initialization separately; subsequent lane observations
leave the reopened file unchanged. The dedicated Electron verifier passes
unknown chat/Agent/summary presentation, actual relocation with zero model
requests, unchanged historical running status, and refusal to relocate a real
running child. Existing subagent status, background controls, chain/safety and
BTW native Electron verifiers also pass against the rebuilt current-main
runtime. These remain loopback/source evidence, not native macOS, packaged,
real-account or release acceptance.

The first macOS cloud run of the previous head failed only the reopen test's
frozen-snapshot assertion: after a graceful posix shutdown the runtime records
the interrupted lane's terminal outcome, so the reopened history reads `failed`
instead of the frozen `running` that Windows keeps. Both are recorded facts, and
the test now accepts either while asserting the product invariants that matter:
the projected status is never running/queued after a known-empty roster, the
known-empty downgrade still applies to a frozen running snapshot, the journal
prefix is preserved, and no model call is made.

The next head's macOS run passed the source-mode sessions group in full,
including the complete session-move acceptance, but the packaged-candidate run
failed session-move with `Session operation in progress` where the Cron
ownership rejection was expected: the cron-host worker was still draining its
navigation/status reads when the move was attempted, so the transient-operation
guard fired before the Cron guard. This is a native acceptance timing race, not
a Cron-guard or relocation regression. All three Cron-rejection assertions now
retry only that transient operation race with a bounded wait and still require
the Cron rejection as the final outcome; an unexpected success or any other
error still fails the acceptance, and no product guard, deadline or assertion
is weakened.

The earlier existing session-move verifier fails before reaching this regression
on both the previous candidate and unchanged main (dialog-close timeout on one
run; a missing fixture-generated file on the control run). Those failures are
not called product regressions or proven flaky. Its final historical-only
blocking assertions are updated to the demonstrated current-registry contract,
with existing active-task, queue, approval, Cron and directory checks retained.
Complete current-input results and remaining verification failures are
recorded below; no deadline or assertion is relaxed for an environmental
failure. The final review identified disconnected source-host
compatibility: an explicitly disconnected source skips querying its dead
transport after the normal task/queue checks, while the prepared destination
always verifies its live registry. This distinction has a red/green regression.
Structured notifications and subagent control results also invalidate prior
display observations; the cache does not own or release a process.

First cloud execution of the previous head exposed a display-semantics
regression: the projection downgraded history-derived running/queued records to
unknown whenever the current roster was unavailable, but the native lifecycle
and the existing background acceptance both require that stale/unavailable
current state keeps the history-derived status until a validated roster says
otherwise (a mocked main process never observes, so the downgrade became
permanent). `verify-background-subagents.mjs` and `verify-hidden-messages.mjs`
timed out waiting for `running` after reload on Windows sessions/runtime. The
fix restricts the downgrade to a validated known roster, with the reversed unit
assertion added first. Movement still fails closed on unavailable registries;
this is display-only. Both scripts were reproduced locally against the same
mirror and re-run after the fix.

Final local candidate verification: typecheck and production build pass; the
complete serial Desktop suite collects 894 tests, with 879 passes, 14 platform
skips and one file-URL Git marketplace clone failure. It remains the same local
marketplace failure recorded during #193, not a passing full-suite result.
The complete session-move acceptance again stops earlier at its missing
fixture-generated `moved-cwd.txt`, before reaching the changed historical-lane
assertions. An original-flow diagnostic confirms that the `run_command` was
issued once, returned `isError: true`, and reported Bash
`NtCreateDirectoryObject(...): 0xC0000022` with exit code `3221225794`.
The missing file is a consequence of that native initialization failure, not
successful command execution or a demonstrated relocation regression. The
original command/file assertions are retained; no runtime failure is converted
into success. The focused native RPC and new liveness Electron verifiers pass.
CI inventory/policy/runner checks pass 30 tests with one platform skip. All
831 candidate inputs match the isolated validation mirror byte-for-byte.
Independent bounded read-only reviews find no confirmed blocker after the
message-invalidation and disconnected-source regressions are added; they do not
replace cloud execution. The original 16 patch manifest and all 43 staged
source postimages remain unchanged. No commit, push, PR, package, shortcut or
personal-profile change is made by this local verification.

## PR #199 Main Integration (2026-11-06)

Merge main `33abd6c` (PR #197) into the completion-review candidate without
rewriting either branch. Both background follow-up and completion-review
capabilities remain registered. Their RPC patches share an insertion point;
the review patch now targets the background-reply postimage, with updated patch
and combined RPC source hashes. Neither the pin nor upstream overlays change.
The production applier succeeds from a clean pinned checkout with all 18 shared
patches and 45 postimages. Darwin additions also replay with matching hashes;
this source check is not native macOS execution.

The combined runtime is rebuilt/restaged. Upstream workspace type checking and
89 focused subagent/RPC tests pass, as do Desktop type checking and production
build. Complete serial Desktop regression collects 913 tests: 899 pass,
14 platform skips, zero failures in 180.5 seconds. Evidence is
`Desktop/test-results/completion-review/merged-serial-tests.log`. All four staging
tests pass independently, as do 34 CI policy/runner/summary tests (33 passes,
one platform skip).

Real Windows Electron review, background-replies, background-controls and
launch-mode verifiers all pass against this combined runtime with isolated
loopback providers. Coverage retains one-shot preflight reservation/rollback,
completion deduplication, queued and continued child work, lost-receipt
deduplication, parent/peer independence and non-inherited task-mode consent.
These local results do not establish current-head cloud, native macOS,
installer or real-account acceptance.

No installer is generated or installed, and no package is deleted. The reused
isolated source (0.04 GiB), new replay (0.02 GiB), staged runtime (0.11 GiB) and
reused Desktop build (0.01 GiB) remain needed for verification and evidence;
dependency junction targets are excluded from these sizes.

## PR #199 One-Shot Review Reservation (2026-11-06)

The main-process prompt handler now reserves the one-shot review choice before
its first attachment/preparation/RPC await. Concurrent follow-ups capture their
own unarmed payload. Enqueue/RPC acceptance commits the choice; rejection returns
it to the original session without changing queued snapshots or enabling review
on a replaced runtime/session or an incompatible task mode.

Typecheck, production build and 63 focused review/runtime/queue/launch/timing
tests pass locally. Native Windows Electron acceptance holds a real RPC
preflight through an isolated input extension. A second prompt queues while the
choice is reserved; after acceptance both ordinary tasks finish with exactly
two model requests and no inherited review. A malformed-input fault injected
after the same gate exercises native preflight rejection: the choice returns,
the separate queued follow-up remains recoverable, and no model request occurs.
The existing menu, provenance, ownership, completion, theme/narrow-layout and
reduced-motion assertions remain intact. Runtime patches, pin and installed
application are unchanged. Existing native launch-mode acceptance also passes,
including Goal image attachments, one-shot Ultracode and queue steering.
This focused result is not a new full-suite, cloud,
installer or real-account acceptance claim.

## PR #197 Confirmed Non-delivery Retry (2026-11-06)

The P2 review finding is reproduced against the previous staged runtime:
finish one child, occupy all eight running-lane slots, reject its follow-up,
free a slot, and retry the same request identity. The original cached rejection
still prevents delivery. Native capacity and final-settlement refusals now
explicitly return `not_sent`. Only that confirmed non-delivery clears the
attempt's promise; the request digest remains reserved. A subsequent manual
attempt can succeed, concurrent attempts share one promise, and success remains
deduplicated. Missing metadata, thrown failures and lost acknowledgments still
retain their uncertain/successful receipt. No automatic retry is added.

The new native capacity regression passes after rebuilding/restaging. All five
pinned-runtime scenarios and 29 background service/presentation tests pass.
Three new RPC receipt tests cover confirmed refusal, missing metadata and a
thrown result; a native lifecycle regression captures a refusal during the real
settlement handoff. All 84 selected upstream tests pass, as do the upstream
workspace type check, Desktop type check/build, four staging tests, and the
40 CI policy/runner/summary tests (39 passes, one platform skip). Both real
Electron background controls and replies verifiers pass, including delivery
once after a deliberately lost acknowledgment.

The complete serial Desktop run passes: 890 tests, 876 passes, 14 platform
skips, zero failures in 242.8 seconds. Its log is
`Desktop/test-results/background-replies/review-serial-tests.log`.
The unchanged pin and 17 shared patches replay with all 44 Windows postimages;
Darwin additions also replay with matching combined postimages. The new RPC
tests are explicitly registered in both upstream integration workflows.

An additional run of upstream `subagent-live-channel.test.ts` fails both cases
in its Windows temporary-directory cleanup (`EPERM`), including isolated reruns
with Node 24.15.0 and 24.16.0. This extra test is outside the existing integration
inventory; its cleanup cause is not fixed or claimed as passing here.
No installer is generated. The reused staged runtime (0.11 GiB) and Desktop
build (0.01 GiB) remain needed for verification; no historical package is
created or deleted. These are local results, not replacement cloud/native
macOS, real-account, installer or merge acceptance.

## Background Agent Follow-ups (2026-11-05, Local Candidate)

Based on main `7c349b7`, this candidate adds explicit single-agent
follow-ups through the existing background inspector and typed preload/IPC.
It reuses the shared composer and native `agent_send reply`, always without
interruption. Running children queue; settled retained children continue their
original transcript. Parallel/chain steps, missing/stale/disconnected records
and settling lanes cannot send. These child tasks may execute tools and consume
model usage; they are not read-only BTW requests.

The source pin and two upstream overlays are unchanged. The new final patch
adds structured queued/started delivery receipts and request-digest
deduplication scoped to the live registry. Uncertain outcomes are retained,
never retried automatically or silently evicted; the bound is 512 receipts.
No durable exactly-once guarantee across app restarts is claimed. All 17 shared
patches replay cleanly and match all 43 Windows postimages. Both Darwin
additions also replay with matching combined postimages on Windows; this is
not native macOS execution.

The upstream workspace type check, complete offline build and 80 focused
subagent/lifecycle tests pass. Desktop type checking, production build,
29 focused background service/presentation tests, all four pinned-runtime
lifecycle/control/reply scenarios and four staging tests pass. The latest
CI inventory/runner/summary check collects 30 tests: 29 pass, one platform skip.
The real Electron controls and new replies verifiers pass with an isolated
loopback provider. Coverage includes queueing, retained child context,
continuation, lost-acknowledgment manual retry delivering once, independent
parent/peer execution, per-lane drafts, delayed receipts and reload.

Browser checks cover 1400/390/320-pixel light/dark layouts, English/Chinese,
IME, multiline/Enter, length bounds and reduced motion. Long live output
exposed a real focus-scroll defect: revealing only the editor caret could
leave the send button and composite focus ring clipped. The form now reveals
itself on focus and on focused layout changes. Both browser and native
Electron checks verify the complete four-pixel focus gutter.

The initial complete serial Desktop run collects 889 tests: 873 pass,
14 platform skips and two failures. Both fail during StepPage fixture cleanup
with `EBUSY` while removing their isolated project directories; their runtime
children remain alive. Those exact test-owned process trees were terminated
to let the failed run exit. An unchanged isolated rerun passes both tests
with one platform skip. A replacement unchanged complete serial run passes:
889 tests, 875 passes, 14 platform skips, zero failures in 325.5 seconds.
That successful rerun does not establish a fix for the original
process-cleanup cause.

The new Electron reply verifier selects explicit fixture scenarios rather than
assuming the last user-shaped message is the task. Its startup failure also
closes the loopback service, and orderly shutdown waits for both controller and
launcher exit with the existing 30-second bound. A deliberately missing
executable exits with the expected failure code rather than leaving the server
alive. The normal final verifier rerun also passes and exits cleanly.

Evidence is under `Desktop/test-results/background-replies/`; the isolated
runtime build is `D:\Desktop Runtime Builds\background-follow-up-20261105`.
The rebuildable isolated workspace is about 0.34 GiB, the staged runtime
0.11 GiB and the Desktop build 0.01 GiB. They remain needed for candidate
verification; no installer or historical package was generated or removed.
No installer, installed application, shortcut or personal Step Code checkout
was changed. These local results do not establish real-account, cloud or
native macOS acceptance, nor PR approval or merge readiness.

## PR #196 Native CI Synchronization (2026-11-05)

Run `41975811560` fails macOS source capability acceptance immediately after
reload while its search button is still disabled, and task-progress acceptance
times out before the full-but-running checkpoint. Capability acceptance now
waits for the existing enabled control before retaining its original assertion.
The task fixture routes by the explicit user scenario and acknowledged tool
result instead of global request ordinal; it asserts exactly one task update,
one held post-tool answer and one next-turn request. Its failure path captures
phase/count/stream state without logging provider payloads. No production
behavior, animation assertion, deadline or CI inventory is relaxed.

Main `495d974` is merged without rewriting history. Both native BTW stream
isolation checks and unsupported-tool scenarios are retained, alongside both
runtime capabilities and all subagent redaction postimages. The complete
combined patch set applies on a new pinned checkout, builds offline and stages
with Node 24.16.0. The upstream pin and overlays are unchanged. Replacement
Windows and native macOS source/package checks remain required; this local
record is not a cloud success, package, real-account or release claim.

At `2bce3bf`, Windows runtime and sessions pass. The replacement macOS runtime
job `127198503188` stops earlier at the project-trust drawer, before reaching
task-progress acceptance. Its menu-selection fixture now requires the exact
inserted `/trust ` value, editable composer and closed command menu before
Enter. This retains the real menu/composer/IPC flow and all approval/save/
no-model assertions. Failure diagnostics capture a screenshot and safe control/
request state so a remaining failure cannot be mistaken for this timing gap.
The original failed job has no such diagnostic, so the exact missing stage
is not claimed as reproduced locally. Native cloud acceptance remains pending.

## BTW Message Actions And Tool Boundary (2026-11-05)

Follow-up to merged main `3158d8d` (PR #190). Side questions now reuse
the shared user timestamp/copy footer without an unsupported edit action.
Inside BTW, the existing selection toolbar offers Quote, Annotate and Copy
without recursive side questions. Source identity, composer focus and
annotation ranges remain isolated from the main transcript; closing BTW
removes only its own floating markers/highlights.

The upstream pin and applied upstream commits are unchanged. A fresh
isolated checkout replayed the complete reviewed patch set, then rebuilt
and staged the runtime with Node v24.16.0. The side-only reminder is also
applied at system level. Structured tool invocations and bare leading
tool-protocol text produce an allowlisted unsupported-tools error, never
execute tools, and do not enter side followup history. Fenced and quoted
protocol examples remain ordinary answers. This is conservative detection,
not a claim to recognize every malformed provider response.

Typecheck, production build and all 849 serial tests pass: 835 passed,
14 platform skips, no failures. The focused staging/native runtime tests
also pass after the final patch metadata/hash update. Native runtime tests
use only an isolated loopback provider and verify tool rejection, legitimate
examples, followup isolation, no retry/tool loop and main/side cancellation.
The BTW browser acceptance covers shared message actions, side-local
selection/annotations, independent main/side highlights, hidden-panel
cleanup, source navigation, focus and light/dark 1600/1100/390/320 layouts
plus reduced motion. The native BTW and main chat-quote acceptances pass,
including real clipboard operations, stable entry identity after index
changes, independently retained drafts/references and no main JSONL writes.

The serial test log and BTW screenshots are in
`Desktop/test-results/btw/`; the patch replay/build workspace is
`D:\Desktop Runtime Builds\btw-boundaries-20261105\isolated`.
No installer, installed application, desktop shortcut, real-account request,
cloud check or native macOS acceptance was changed or claimed by this pass.

## PR #193 main synchronization and acceptance corrections (2026-11-05)

Merged main `d0a1009b` (#190 BTW and #192 production first-run) into the original
PR ancestry without rewriting its five commits. Four conflicts retain both
capabilities, both added source entries, both verification records and all patch
hashes. The 16 shared patches apply in the original 14-patch order followed by
BTW and subagent redaction. The combined Windows replay tree is
`7cb4ae24e5e8cf0655a0e5057a81b9cc15f6129a`; all 43 source postimages match.
Node 24.16.0 staging advertises both `desktop-btw` and
`desktop-subagent-redaction`. The two Darwin additions apply and match all
44 combined postimages on Windows; this is not native macOS execution.
The upstream workspace check and complete offline build pass.

The first runtime test command named a nonexistent roster file and actually
ran five suites, not six: 107 tests passed. A corrected six-file run executes
111 tests, with 110 passes and one source-CLI invocation timeout. The same
invocation still times out when isolated with Node 24.16.0 and the allowed D:
fixture directory; an earlier isolated attempt was blocked by EPERM in the
system temporary directory. These failures are retained, not skipped or
converted into a six-suite success claim. The display/output boundary tests
pass; source CLI launch requires replacement cloud evidence.

The BTW Electron verifier originally classified requests using the final
message only. Two unchanged runs fail the main-stream isolation assertion.
An original-flow diagnostic shows RUN-MAIN before a trailing working-context
reminder; the fixture misclassifies that request and ends it itself. It now
selects the latest explicit user scenario, waits for the actual held provider
request, and checks that side cancellation neither destroys nor ends the main
stream. Two consecutive complete native Electron BTW runs pass. No product
BTW behavior, cancellation assertion or outer deadline changes.

The then_run verifier could leave its Playwright close promise unawaited when
launcher exit won the shutdown race. Its new bounded close helper requires both
controller closure and process exit within the existing 30 seconds. Successful
exit, closed context and zero windows are always required; close rejection and
timeout remain failures. Twelve lifecycle unit tests pass, including delayed
controller closure, exit ordering, close failure and stalled close. A real local
then_run attempt fails earlier in Bash initialization with `0xC0000142`, then
completes both controller and launcher shutdown. The requested full native
three-run verification was therefore not completed. This fixes a demonstrated
lifecycle gap, but the exact CI-held pipe has not been captured and the original
cloud hang is not yet proven resolved. Failure diagnostics expose resource
kinds and closure state, never environment or credential values. No forced
successful exit or increased CI timeout is introduced.

Desktop type checking, production build and 76 focused security/BTW/first-run
checks pass. The three subagent security Electron verifiers pass, as do
production first-run, chat quotes, message order, capability management and
general Electron acceptance. The production BTW component verifier passes with
installed Edge; the initial default-browser attempt failed because local
Playwright Chromium was not installed. CI policy checks pass 30 tests with one
platform skip. The final serial Desktop suite collects 876 tests: 861 pass,
14 platform skips and one file-URL Git marketplace clone failure, matching the
previously recorded local marketplace failure. The complete suite is not green;
no failure is skipped or hidden. Replacement current-head Windows/macOS checks
remain required. None of these local fixtures proves installed
package, live account, paid-model or release readiness. No package, shortcut,
original dirty worktree or personal Step Code checkout was changed.

## PR #193 sensitive input-key correction (2026-11-05)

The original PR head `4620846` recursively filtered string values but did not
inspect object keys. Its statement that sensitive object keys were covered was
incorrect: `{api_key: "synthetic-key-only-value"}` remained unchanged and visible.
A new test first fails against that implementation, then passes after values
beneath sensitive keys are replaced in the display copy. Coverage includes both
trusted subagent tools, top-level and nested keys, encoded keys, arrays, normal
text preservation, unchanged authoritative history and clean-call reference
identity. This corrects a missing implementation, not a newly discovered runtime
patch requirement. The runtime safety patch itself is unchanged.

The original serial Desktop result below remains evidence for the old
`5d35c814` baseline only. Windows run `41858346184` attempt 2 passed, but attempt
3 at the same PR head again printed both then_run success messages and hung
until its 300-second outer deadline. One passing rerun did not establish a
runner-only cause. The repeated exit hang remains under investigation; neither
forced successful exit nor extended acceptance deadlines are used.

## Desktop subagent output boundary on background controls main (2026-11-04, local uncommitted candidate)

The candidate is rebased on main `5d35c814`, after the native Background view
and first-run preview. It preserves the owner-reviewed
`step-code-desktop-background-agents.patch` byte-for-byte and adds a separate
final `step-code-desktop-subagent-redaction.patch`. The source pin, two upstream
overlays, preceding 14 Desktop patches, Darwin additions, scheduler policy and
runtime authority are unchanged. Staging advertises
`desktop-subagent-redaction` in addition to the existing lifecycle/control
capabilities.

Test-first migration on the owner baseline found nine remaining runtime safety
failures and seven historical display/copy failures; three projection cases
were already green and were not reimplemented. The native control view also
failed an encoded-free-text projection test, and a real running background
child exposed an oversized credential value after the live accumulator clipped
away its key prefix. The migrated candidate filters Desktop-facing copies before
their first bound, tracks whether live text/tool fields start mid-line and drops
that unknown first fragment while preserving later complete lines. Child
transcripts, runner records, chain `{previous}` inputs, lane identities, stop
arguments and raw answer hashes remain unchanged. Ordinary CLI behavior is
covered by explicit controls.

Focused runtime coverage passes 112 tests across six files after whole-workspace
type checking. Temporarily disabling the outbound policy restores the original
tool/notification/retention failures; replacing the partial-line projection
with ordinary line filtering makes all three activeText/tool-argument/tool-output
tail tests fail. Cancelled child dialog titles are filtered before their first
200-character bound. Runtime and Desktop display helpers preserve CRLF and useful
text; encoded and deeply encoded credential labels fail closed with bounded
decoding.

The 15-patch manifest applies from a fresh `81e79bc4b` checkout. The owner tree
and reviewed safety tree are captured as Git trees; fresh replay equals the
safety tree byte-for-byte. Existing 14 patch hashes, existing source preimages,
the upstream overlay and Darwin platform declarations are unchanged. A
synthetic preimage failure unwinds all applied patches and preserves only the
injected pre-existing edit. The final offline monorepo build succeeds. Staging
with Windows Node v24.16.0 records every required patched source hash and the
new capability.

Three real Electron/loopback acceptances pass against the staged replay. The
chain verifier retains foreground success/failure/cancellation and drives a real
detached child whose parent turn ends before release; parent-visible notification,
authoritative message/detail, chat render and copy output keep ordinary markers
without the synthetic secret, while notification-looking user prose remains
unchanged. The production Agent inspector verifies safe task labels without
rewriting authoritative task identity. The native Background controls verifier
drives two real lanes, including a running oversized sensitive first line; list
RPC and rendered details expose the safe tail without the clipped credential
fragment, then retain targeted stop, peer completion, reload and session-isolation
assertions.

The runtime manifest advertises `desktop-subagent-redaction`. Main-process
Background list/stop fails closed before any RPC call when that capability is
absent; a control-only runtime therefore cannot silently bypass the early-tail
boundary. Trusted `subagent` and `agent_send` call arguments use safe display
copies for credential-bearing strings, while clean calls retain the original
object reference and authoritative history stays unchanged. Sensitive object
keys were not filtered in the original PR head; the correction is recorded above.
The guard is
covered both ways: a real staged control-capable runtime passes its control
scenario, while a service without the redaction capability rejects list and
stop before any RPC call.

Desktop type checking, the focused runtime/staging/display suites and 30 CI
policy/runner tests pass (one platform skip). The complete serial Desktop suite
collects 847 tests: 832 pass, 14 platform skips and one failure. The failure is
the unchanged file-URL Git marketplace clone/update test. An isolated direct
call reproduces Git Bash `sh.exe` failing to create its MSYS named object with
`NtCreateDirectoryObject ... 0xC0000022` before reading the fixture repository;
the marketplace implementation is outside this change. The failure remains
visible and no timeout, assertion or CI inventory is weakened.

Limitations: this is local uncommitted source/fixture evidence, not cloud CI,
installed-package, native macOS, real-account, paid-model or release-readiness
evidence. Existing raw journals/retained files are not rewritten; an old fragment
whose credential label was already lost cannot be reconstructed. A separate
model review was unavailable due to provider rate limits. Background reply,
snapshot generation and offline historical-liveness work remains separate; this
security patch does not complete TODO Background subagents [I] or [II].

## Production First-run Integration (2026-11-04)

The accepted preview is now connected to the real Electron startup path.
The main process owns a versioned, atomically saved `userData/first-run.json`
marker, initialized before startup writes runtime files. A fresh profile remains
pending across interrupted setup, reload and restart. Completion or explicit
skip persists; retained-data upgrades/reinstalls do not replay the flow. Legacy
preferences, runtime configuration, credentials, model configuration or session
history bypass setup without reading credentials for detection. An unreadable or
future marker is preserved and bypasses optional onboarding rather than blocking
access to the application. Clearing the entire Desktop profile is a fresh start.

The renderer bootstrap mounts onboarding separately from the normal workspace
and preserves the workspace's original snapshot initialization order. Restoring
an existing runtime before a reload must not leave command/permission controls
unavailable; the native acceptance explicitly reloads and changes permissions in
a saved session without sending another model request.
It reuses actual account login/cancellation, provider configuration/discovery,
native project selection, and model/thinking/permission selectors through the
typed preload. Completion hands off a session draft without starting a runtime,
writing conversation history or sending inference. Full Access does not bypass
the existing native risk confirmation on first execution. The preview remains
an independent simulation and shares the production stylesheet.

Local Windows source verification passes:

- Typecheck and production build.
- Serial Desktop suite: 848 tests, 834 passed and 14 platform skips.
- CI inventory/policy/runner tests: 30 passed and one platform skip.
- `verify-first-run.mjs`, registered in the interface CI group: fresh/interrupted,
  skipped/completed and legacy/future-marker lifecycles; real provider discovery,
  encrypted persistence, native directory selection/cancellation, draft model and
  permission handoff, and the first explicit loopback model request.
- The same native acceptance exercises official regional API login, rejected
  credentials, browser Plan authorization/cancellation with a loopback transport,
  no-subscription responses, shared-operation guards and Full Access cancellation
  without a submitted task. Native system theme changes, light/dark brand assets,
  390px English focus gutters and reduced motion are covered.
- The standalone preview regression matrix passes with an installed Edge browser.
- Adjacent native startup, first-frame/system theme, new-session draft, account
  routing/settings, custom-provider protocols and full permission-tier acceptance
  pass, including session-only versus remembered Full Access consent.
- Existing desktop, message-order, permission-approval and StepPage registration
  acceptance explicitly checks fresh-profile onboarding and skips through its real
  UI before continuing the original assertions. Desktop and StepPage relaunches
  also verify that existing profiles bypass setup. The StepPage fixture explicitly
  identifies its four fresh-profile launches instead of seeding configuration to
  hide onboarding; its registration, disable, migration and idempotence checks
  remain unchanged. Product behavior, deadlines and acceptance gates are unchanged.

All profiles and endpoints in native acceptance are isolated fixtures, including
the official API/Plan transport. These checks do not establish live account sign-in,
paid-model behavior, actual installer over-install, native macOS acceptance or
release readiness. The new PR's cloud results remain separate evidence.

## PR #190 Capability Removal Synchronization (2026-11-05)

Windows interface run `41869558982`, job `126712778842`, fails in
`verify-capabilities.mjs` waiting for the second plugin-removal confirmation.
The saved screenshot shows expanded plugin details without a confirmation
or visible error. The same commit's Windows sessions and runtime groups pass.

The original script passes locally at normal speed and 6x CPU throttling,
so the missing-confirmation timeout itself was not reproduced. A temporary
in-memory diagnostic records both uninstall clicks during the native
240-ms disclosure animation, at approximately 175 and 167 ms. The acceptance
now waits for the shared `settleLayout` helper after opening the exact plugin
disclosure and scopes confirmation to that plugin's named group. A failure
records pending/confirmation/disclosure state without an additional locator
wait. No product code, timeout, animation or safety assertion is changed.

The updated complete capability acceptance passes at normal speed and 6x
CPU throttling. Both throttled uninstall clicks now occur with no remaining
disclosure animation. Typecheck and syntax/whitespace checks pass, as do all
15 motion-helper tests and 39 CI policy/runner tests (one platform skip).
The before/after diagnostic logs and probe are ignored local evidence under
`Desktop/test-results/ci190-capabilities-*`; the original cloud screenshots
are in `Desktop/test-results/ci190-capabilities-41869558982`.

The same head's macOS run `41869558871` did not acquire a hosted ARM64 runner.
GitHub reports capacity constraints and no preparation steps executed; the
dependent gate correctly failed. This is neither a macOS product failure
nor a passing native acceptance receipt. Replacement current-head cloud
execution remains required. No package or shortcut was changed.

## PR #190 First-run Main Synchronization (2026-11-05)

Merged main `5d35c81` (PR #189 first-run preview) into the BTW branch.
Only this verification log conflicted; both features' existing records are
retained. The acceptance inventory keeps the first-run design fixture
explicitly local-only and preserves both BTW CI scripts. No product behavior,
runtime pin, package version or acceptance assertion was changed to resolve
the conflict.

Typecheck, production build and all 44 focused BTW, quote, composer, command
and runtime-staging tests pass. CI inventory/runner/policy checks pass
39 tests with one platform skip. `verify-first-run-preview.mjs`,
`verify-btw.mjs`, `verify-btw-electron.mjs`, `verify-appearance.mjs` and
`verify-plan-review.mjs` pass serially against the combined source.
New preview and BTW screenshots are under
`Desktop/test-results/btw-main-merge-20261105`.

These are local Windows checks with isolated profiles and loopback fixtures,
not fresh cloud CI, native macOS, installer or real-account acceptance.
The existing Desktop dist was rebuilt in place (105 files, 9.70 MiB);
no new package, shortcut change or generated-output deletion was performed.
The PR remains unmerged.

## PR #190 Main Conflict Resolution (2026-11-04)

Merged main `a59efb9` (PR #188 background-agent controls) into the BTW
branch without replacing either feature's runtime fields, preload contracts,
acceptance registration or TODO records. The manifest applies the background
controls patch before the BTW patch and pins newly calculated combined
`rpc-mode.ts` / `rpc-types.ts` hashes; neither upstream pin nor app version
changes.

Replayed all 15 shared patches from the fixed upstream checkout in an isolated
clone. The official Windows applier passed every pre-image, patch and result
guard. The macOS additions also applied and matched every combined source
hash; this is patch verification on Windows, not native macOS acceptance.
The combined upstream workspace built offline, and runtime staging with
Node 24.16.0 matched all manifest sources and advertised both RPC features.

An initial test run used the old staged runtime and rejected
`desktop_subagents` as unknown. After rebuilding and restaging the combined
runtime, the complete serial Desktop suite passed: 847 tests, 833 passed,
14 platform skips, no failures. Typecheck, Desktop production build and
`git diff --check` passed. CI inventory/runner/policy checks passed
39 tests with one platform skip. `verify-btw.mjs`,
`verify-btw-electron.mjs`, `verify-background-agent-controls.mjs` and
`verify-workflow.mjs` passed serially against the combined source build.
Logs and BTW UI evidence are under
`Desktop/test-results/btw-main-merge-20261104`.

No installer, desktop shortcut or running installed application was changed.
Current-head Windows/macOS cloud checks remain separate from these local
results; the PR is not merged by this work.

## PR #190 Native Impact Sampling And Undo Diagnostics (2026-11-04)

At `6fb080c`, Windows run `41697711483` passes every group and the final
gate. macOS run `41697711461` passes preparation, all source groups and
the complete interface source/package group. Its packaged runtime group
misses the task impact's brief peak in natural rAF samples. The fixture now
captures the actual product-created WAAPI effect with the existing helper,
seeks its real transforms, then resumes playback. The original amplitude
threshold remains; duration and zero-offset endpoints are also asserted.
A MutationObserver supplements rAF for transient phase/particle evidence.

The packaged sessions group times out in `verify-turn-undo.mjs`. Artifact
ZIP timestamps place the last new screenshot after successful real undo,
before the second-session/peer checks; the source script passes. Its old
failure path can await app shutdown while an outstanding fixture task
requires quit confirmation, suppressing the original error until the outer
deadline. The script now uses the shared orderly fixture shutdown, releases
its HTTP connections, and logs each phase and any original failure first.
The test also waits for the renderer's existing ready control around reloads
and asserts the exact restored runtime/session before submitting edits.
No product code, assertion, outer deadline or CI gate is removed or relaxed.

Both scripts pass once against source and twice consecutively against the
delivered Windows preview. Impact samples are `0, -2, 1.4, -0.7, 0.3, 0`
pixels over the actual 360-ms effect. Evidence is
`ci190-task-impact-sampling.log` and `ci190-turn-undo-readiness.log` under
`D:\Desktop Runtime Builds\btw-20261103\evidence`. CI policy tests pass
39 checks with one platform skip; all 15 motion-helper browser regressions
pass with the matching staged Chromium. The original macOS undo hang is not
reproduced locally; fresh cloud execution remains required. These are
acceptance-only changes and do not change the delivered package bytes.

## PR #190 Reference Geometry Sampling (2026-11-04)

macOS interface job `126118971520`, run `41693089514`, passes its source
group but fails the packaged `verify-btw.mjs` reference-position assertion.
The first input rectangle is sampled during the sidebar's final transform
frame: x is `633.0022583007812` before opening references and `633` after;
the width differs by less than `0.0001` pixels.

The fixture now reuses the shared `settleLayout` helper for opening the
sidebar and before both input-rectangle samples. It waits for fonts, finite
animations on the element and its ancestors, and rendered layout frames.
The exact rectangle equality assertion is unchanged: no rounding, positional
tolerance, fixed wait extension or product motion change was added.

Two consecutive complete runs of `verify-btw.mjs` pass in Edge, including
reference handoff, exact geometry, streaming, focus, themes, responsive
layouts and reduced motion. Evidence is `ci190-btw-stable-layout.log` and
its adjacent screenshot directory under
`D:\Desktop Runtime Builds\btw-20261103\evidence`. This remains an
acceptance-only change; the delivered Windows preview's application bytes
are unchanged. Fresh cloud acceptance remains pending.

## PR #190 Model Switch Reload Readiness (2026-11-04)

macOS packaged sessions job `126102093019`, run `41682022854` attempt 2,
passes its source group but fails at `verify-model-switch.mjs:221` on
`branchSession` with `Session operation in progress`. After reloading a
clone, the history event can paint the switch notice while the renderer's
initial snapshot read still holds the runtime operation guard. The fixture
already waits for the enabled new-chat control after its first history
restore, but omitted that readiness condition at the next two reloads.

Both reloads now wait for the existing ready control before branching or
creating a draft. Additional snapshot assertions verify the exact restored
runtime and session identities. All clone, branch, model-history, favorites,
default-selection and unavailable-model recovery checks remain enabled;
production guards, timeouts and CI policy are unchanged.

One source run and two consecutive runs of the delivered Windows preview
pass. Evidence is `ci190-model-switch-readiness.log` under
`D:\Desktop Runtime Builds\btw-20261103\evidence`. The CI runner and policy
suite reports 39 passes and one platform skip. This follow-up changes
acceptance code and this record only, so the delivered `bfa74b4` application's
production sources and package bytes remain unchanged. A fresh cloud run
is still required.

## PR #190 Task Progress Fixture Handshake (2026-11-04)

After the shared rail fix, all Windows groups and the macOS source runtime
group pass. macOS packaged runtime job `126064844339` then times out at the
task-progress fixture's full-but-still-running state. Its mock response ends
on a fixed 2.4-second timer, so a slower native render can miss that state.

The mock now holds the first post-tool answer until the test observes both
the full task count and an actually full running progress-bar frame, then
explicitly releases the final model chunk. Existing sound, impact, particles,
completion, no-replay, next-turn retirement, history and reload assertions
remain unchanged; no timeout or CI gate is relaxed. The fixture also closes
its own HTTP connections on failure.

One source run and two consecutive runs of the existing Windows preview
package pass. Evidence is `ci190-task-progress-handshake.log` under
`D:\Desktop Runtime Builds\btw-20261103\evidence`. This follow-up changes
only acceptance code and this record; the delivered `bfa74b4` application's
production sources and package bytes are unchanged. The replacement cloud
run remains a separate pending gate.

## BTW PR #190 Shared Rail Acceptance (2026-11-04)

The initial Windows runtime job `126043981644` and macOS runtime job
`126047868400` fail at the same `verify-electron.mjs` exact rail-label
assertion. The production rail has the intended new side-question entry
between Context and Changes, but the shared acceptance still expects the
previous eight entries.

The shared acceptance now requires all nine entries in order, one native
side-question icon and one `btw-panel` trigger. The existing tooltip placement
and visibility checks now also cover the new entry; no assertion, timeout or
CI gate was removed. The complete source `verify-electron.mjs` passes on
Windows with its real staged runtime and isolated fixture profile.
Replacement cloud and packaged-executable runs remain separate pending gates.

## BTW PR Main Synchronization (2026-11-04)

The feature commit `cd2cafb` is synchronized with main `2febc93` at merge
`664de94`, preserving PR #187's model favorites and launch acceptance fix.
Only TODO and verification prose required conflict resolution; both lines'
receipts are retained. The runtime pin, version and existing preview package
remain unchanged.

Typecheck and production build pass. The merged serial Desktop suite reports
834 tests: 820 passed, 14 platform skips, zero failures. Its receipt is
`D:\Desktop Runtime Builds\btw-20261103\evidence\btw-main-sync-20261104-unit.log`.
The CI inventory/runner/policy suite passes 39 tests with one platform skip.
`verify-btw.mjs` passes against the shared production components, including
main/side composer style equality, quotes, IME, streaming, responsive layouts,
complete focus clearance and reduced motion. Fresh dark desktop and light
320-pixel screenshots were reviewed.

Source `verify-btw-electron.mjs`, `verify-composer-editing.mjs`,
`verify-chat-quotes.mjs`, `verify-model-effort.mjs` and
`verify-model-switch.mjs` pass serially. Native tests use isolated profiles
and loopback providers. This covers the new side/main editor combination,
reference handoff and the merged favorite/model-selection behavior, not paid
account billing. Browser and native BTW screenshots total about 1 MiB under
the same evidence root with the `btw-main-sync-20261104-` prefix.
The rebuilt Desktop dist is 9.65 MiB; no new package was assembled and no
existing generated output was deleted.

The latest presentation is still source-only. Cloud CI, native macOS,
rebuilt-installer and real-account acceptance remain separate, unclaimed
gates. Per-answer BTW usage is not integrated into Usage totals or estimates.

## BTW Presentation Refresh (2026-11-03)

Source-only refresh after the selected-reference preview package below.
The existing `btw-quotes-20261103-preview` executable and desktop shortcut
do **not** include this newer presentation. No installer, version, runtime
pin, remote branch or release was updated in this pass.

Pending references now reuse the compact quote-count entry and anchored
popover. After a follow-up correction, the side editor reuses the actual
`ComposerInput`, `.composer`/`.composer-tools` styles and
`ComposerActionIcon`, not a separate textarea with similar styling.
The shared composite field has content-driven growth/shrinkage and a
complete four-sided focus gutter.
There are no persistent notes below the editor. Responses reuse the main
conversation's body typography, live responding indicator and shared
copy/elapsed/timestamp footer. Cancelled, failed and length-limited outcomes
remain explicit; elapsed time is a local observation, not provider telemetry.

Typecheck and production build pass. The preceding serial Desktop suite reports
828 tests: 814 passed, 14 skipped, no failures. The focused native BTW,
quote and command set passes all 29 tests, including terminal timing and
late-event guards. The full-suite receipt is
`D:\Desktop Runtime Builds\btw-20261103\evidence\btw-composer-refresh-unit.log`.

`verify-btw.mjs` passes in Edge at 1600/1100/390/320 pixels, light/dark,
including multiline growth and single-line shrinkage, reference preservation,
quote popover positioning, complete composite-field focus, shared response
footer and reduced motion. Escape dismisses the open quote popover before
the parent panel, including when focus remains on its trigger.
`verify-btw-electron.mjs` and the existing `verify-chat-quotes.mjs` also
pass through the real source renderer/preload/main/native path.

Chinese finished-answer screenshots with the footer exposed were reviewed
at desktop and narrow widths; the focused 320-pixel reduced-motion state
and shared reference popover were also checked. Browser evidence is under
`D:\Desktop Runtime Builds\btw-20261103\evidence\btw-composer-refresh`;
native evidence is in the adjacent `btw-composer-refresh-electron` directory.

The shared-composer follow-up passes typecheck/build and all 38 focused BTW,
composer, quote and command tests. The updated fixture compares main/side
computed editor, shell, toolbar and action-button styles. It also checks
Shift+Enter, select-all deletion, IME Enter, oversized-draft retention and
request rejection, plus the existing isolation, focus and responsive coverage.
Source `verify-btw-electron.mjs`, `verify-composer-editing.mjs` and
`verify-chat-quotes.mjs` pass serially. The main editor's native editing,
selection deletion, undo/redo and busy-state behavior remain intact.
Main and side focus indicators match with complete clearance in light/dark
at 1600/1100/390/320 pixels; Chinese screenshots were reviewed. Follow-up
evidence is in `btw-shared-composer` and `btw-shared-composer-electron` under
the same evidence root. No new full-suite or packaged-executable run is
claimed for this follow-up.

Cloud CI, native macOS, real-account billing and acceptance of a rebuilt
installer remain separate, unclaimed gates. No generated output was deleted.

## BTW References Windows Preview Package (2026-11-03)

Unsigned local Windows x64 preview, still version `0.6.0`:
`D:\Desktop For Step Code\Desktop\release\btw-quotes-20261103-preview`.
This rebuild includes the selected-reference integration described below.
It packages the uncommitted `codex/btw` worktree based on `7debda7`, not the
newer main branch, a merged feature or a public release.

Desktop typecheck/build and a fresh native runtime rebuild/stage pass.
The focused native BTW, quote, command and staging set passes all 32 tests
after staging. The unchanged complete source-suite receipt remains below.
All 105 Desktop build files, 1336 runtime files and 26 terminal-module files
match the packaged resources. The runtime still pins
`81e79bc4b699148d6823fedde9b5e70d9a80255f`, its two existing overlays,
Node `v24.16.0` and the reviewed `desktop-btw` compatibility patch.
The package contains no extra application dependencies in asar.
Installer metadata and SHA-512 validation pass. Installer SHA-256:
`fa20e435769ddbaca0e5d838aa539dd232177d55b2f74d21a0804acd84a1ac15`.
Actual Authenticode status is `NotSigned`.

The new packaged executable passes `verify-btw-electron.mjs`,
`verify-chat-quotes.mjs`, `verify-command-dispatch.mjs` and
`verify-terminal-panel.mjs` serially with isolated profiles and a loopback
provider. Native drag selection, explicit reference submission, received
Markdown/code fences, independent main draft/references, source navigation,
no automatic request, no reference reattachment and unchanged main JSONL
are verified through the packaged renderer/preload/main/native path.
Existing main-task concurrency, cancellation, model/session isolation,
640-pixel layout and terminal motion checks remain enabled.
Packaged BTW screenshots are under
`D:\Desktop Runtime Builds\btw-20261103\evidence\btw-quotes-package`;
the quoted and narrow screenshots were visually reviewed.

The primary desktop shortcut now targets this preview's unpacked executable;
its previous contents are backed up in the package's
`acceptance\previous-desktop-shortcut.lnk`. The old preview process was left
running and its files were not removed. Exit that instance from the tray
before using the updated shortcut. User acceptance, cloud CI, native macOS,
installation lifecycle and real-account billing are separate, unclaimed gates.

Post-build artifact inventory: the new preview output is 638.1 MiB; its
assembly copy is 9.6 MiB under the same D-drive build root. Staged runtime,
Desktop dist and terminal runtime are 117.0, 9.6 and 63.0 MiB respectively;
the shared evidence tree is 161.1 MiB. The old preview is still in use.
No generated output or earlier package was deleted without authorization.

## BTW Selected References (2026-11-03)

Initial source-only addition after the older Windows preview package below.
The old `btw-20261103-preview` installer does **not** contain this integration.
The later rebuilt package and shortcut update are recorded above; the source
pass itself did not update an installer, runtime pin, version, remote branch
or public release.

Typecheck and production build pass. The serial Desktop suite reports 827
tests: 813 passed, 14 skipped, no failures. The focused BTW/quote/command set
also passes all 27 tests, including Markdown serialization, deduplication,
8,000-character combined-prompt bounds and formatted-reference history budgets.

`verify-btw.mjs` passes in Edge with the real message, selection toolbar and
quote components: selection-to-BTW handoff, no auto-send, independent main/side
drafts and references, deduplication/removal, close/reopen retention, session
clearing, verified source identity and explicit missing-source behavior.
Oversized submissions preserve draft/references without calling the provider.
Light/dark and 320/390/1100/1600-pixel checks include toolbar bounds,
four-sided reference-control/textarea focus extent, rich text and reduced
motion. Pending-reference screenshots were visually reviewed.

`verify-btw-electron.mjs` passes the actual renderer/preload/main/native path,
including native mouse-drag selection followed by Ask in side. The loopback
provider receives the expected selected Markdown and code fences, while the
main draft/references and saved JSONL remain unchanged. Selection alone makes
no model request; later questions do not reattach earlier pending references.
The existing concurrency, cancellation, applied-model, session and layout
checks remain enabled and pass.

`verify-chat-quotes.mjs` passes its existing native-drag and complete quote
regressions. It now waits for authoritative navigation completion before
selecting, rather than dragging across the temporary preview's replacement.
The same early-drag failure was reproduced against the previous package.
`verify-quote-annotations-fixture.mjs` also passes Chinese/English,
light/dark, desktop/narrow, highlight, edit and send checks. The local
annotation run used installed Edge through a launch wrapper because the
script's default Playwright Chromium is not installed; assertions are unchanged.

New browser/native evidence is under
`D:\Desktop Runtime Builds\btw-20261103\evidence\btw-quotes` and
`D:\Desktop Runtime Builds\btw-20261103\evidence\btw-quotes-electron`.
The full test receipt is `evidence\btw-quotes-unit.log` in the same build root.
Cloud CI, native macOS and real-account billing remain separate, unclaimed
gates. The later rebuilt installer's focused checks are recorded above.

## BTW Windows Preview Package (2026-11-03)

Unsigned local Windows x64 preview, version unchanged at `0.6.0`:
`D:\Desktop For Step Code\Desktop\release\btw-20261103-preview`.
This packages the uncommitted `codex/btw` worktree based on `7debda7`;
it is not a public release or a claim that the feature has merged.
Desktop and the native runtime were rebuilt before packaging. The runtime
keeps pin `81e79bc4b699148d6823fedde9b5e70d9a80255f`, its two overlays
and Node `v24.16.0`, with the reviewed `desktop-btw` compatibility patch.

All 105 Desktop build files, 1336 runtime files and 26 packaged terminal-module
files match their build/staged sources. The packaged Node matches its manifest
hash; Desktop helpers, file-opening resources, adapters, icons and queue helpers
also match. The asar roots contain only `dist` and `package.json`.
Installer metadata and SHA-512 validation pass. Installer SHA-256:
`04592a891372d77b3cedf30ca84c11e4c27d9953d72a4a17bc8541989bdd1009`.
Actual Authenticode status is `NotSigned`.

The packaged executable passes `verify-btw-electron.mjs`,
`verify-command-dispatch.mjs` and `verify-terminal-panel.mjs` serially with
isolated profiles. BTW acceptance includes real IPC/native streaming, applied
model changes, main-task concurrency, cancellation, tool/session switching,
temporary-history isolation and the 640-pixel layout. These use a loopback
provider, not a paid account. Screenshots are under
`D:\Desktop Runtime Builds\btw-20261103\evidence\btw-package`.
Cloud CI, native macOS, real-account billing and installation lifecycle
acceptance remain unclaimed. User acceptance is pending.

## BTW Local Integration (2026-11-03)

The dedicated `codex/btw` worktree is based on main `7debda7`.
The v016 source pin and two existing upstream overlays are unchanged.
Clean shared patch replay and all reviewed postimages pass; replaying the
Darwin additions with the applier's LF normalization also matches every
Darwin-specific postimage. This is not native macOS execution.

Windows staged runtime build, Desktop typecheck/build, and the full local
824-test suite pass: 810 passed, 14 platform skips, zero failures.
The new deterministic native RPC coverage verifies applied model/auth routing,
streaming, temporary followups, clear, provider failure, session/scope isolation,
main-task concurrency and cancellation without main JSONL writes.
The native RPC rerun also confirms that stopping the main task leaves an
independent side request active until it is explicitly cancelled.
Main-process tests cover ownership, cancellation ambiguity, allowlisting,
runtime/configuration protection, quit review and bounded history.

`verify-btw.mjs` passes with the actual component in Edge: streaming, copy,
clear, cancellation, close/reopen, slash entry, preserved main drafts, late
results, light/dark, 320/390/1100/1600-pixel layouts, four-sided focus extent and
reduced motion. The right-rail migration additionally verifies a single rail-only
entry, standard/wide/fullscreen modes, docked space reservation, the shared side
handle, Escape restore before close, narrow headers and clear-focus restoration.
Code blocks and wide tables reuse the main-message Markdown
styles; narrow tables scroll horizontally rather than squeezing their headers.
`verify-btw-electron.mjs` passes the real renderer/preload/main/native route,
including side cancellation while the main model response remains running,
unchanged main queue/launch/draft state and no saved side-question content.
The right-rail rerun also verifies tool switching during streaming cancels only
the side request while retaining temporary records, with fullscreen Escape
restoring the sidebar before dismissal. After applying a model change, the
header shows that model and the next request uses its ID rather than a previous
answer's model. Leaving during streaming and returning releases the old request,
discards old followup history, accepts a fresh question and never replays a slash.
The supported 640-pixel desktop layout fits the window and composer toolbar;
leaving and returning clears temporary answers without replaying an old slash.
Existing command-dispatch and composer-menu Electron regressions also pass.
The final focused ownership/native/command/staging rerun passes all 18 tests;
typecheck and the production build also pass.
Both new scripts are registered in the shared acceptance inventory; its
40 policy/runner/receipt tests pass with one platform skip.

Rebuildable runtime, build outputs and screenshots are under
`D:\Desktop Runtime Builds\btw-20261103`. The source-only pass did not produce
an installer; the later Windows preview package is recorded above.
These are isolated loopback model tests, not real Plan/API-account billing
acceptance. Cloud CI, native macOS and real-account acceptance are
not claimed. BTW usage is displayed per answer but is not yet part of local
Usage totals, cost estimates or main-task performance.

## PR #189 macOS packaged interaction synchronization (2026-11-04)

The punctuation-only head `192c2f6` passed every Windows group and all three
macOS source groups. macOS packaged acceptance failed in two unchanged scripts:
`verify-appearance.mjs` immediately cancelled a rapidly reopened accent editor,
and `verify-plan-review.mjs` sampled a native drag's intermediate height.
These results do not establish a punctuation regression or a runner outage.

The accent verifier now uses the existing `settleLayout` helper before ordinary
pointer actions, including after its intentional mid-exit reopen. The native
closing-transition, retained-instance, fresh-instance and saved-value assertions
are unchanged. Cancellation must visibly close the disclosure and remove the
editor. The Plan verifier settles the drawer before measuring its drag origin,
waits for pointer-down state, and verifies rendered 10/20/35px displacements
before releasing the pointer. Its original intermediate-height assertion,
approval safety, stale-snapshot, expiry and restart checks remain intact.
Both verifiers retain failure diagnostics without changing product code,
deadlines, CI inventories or gates.

Local Windows source acceptance passes for both updated scripts, including
appearance at 6x CPU throttling. Typecheck and 30 CI policy/runner tests pass
with one platform skip. These results do not substitute for native macOS or
packaged acceptance; replacement cloud checks are pending.

## First-run onboarding preview (2026-11-04)

`Desktop/tests/fixtures/first-run.html` is an isolated design preview, not a
production first-launch entry point. It reuses the existing menus, permission
and model selectors, new-session component, product icon and light/dark PNG
wordmarks. Three steps cover account selection, workspace scope and configuration
review. The optional brand introduction can be skipped or replayed and respects
reduced motion; the final workspace has a separate entrance transition.

Account authorization and message sending are simulated in page memory. There
is no Desktop bridge, provider request, credential persistence or personal CLI
profile access. Plan does not silently fall back to API billing. The folder
button uses the browser's read-only directory chooser when supported; only the
directory name is used, no file contents are read, and no absolute path is
invented. Manual paths and sample folders remain available. Full Access requires
confirmation and changes preview state only.

From `Desktop/`, run `node scripts/verify-first-run-preview.mjs`. The script starts
and closes its own ephemeral Vite server by default. `DESKTOP_PREVIEW_URL` selects
an existing server, `PLAYWRIGHT_CHANNEL` optionally selects an installed browser,
and `FIRST_RUN_PREVIEW_OUTPUT` overrides the ignored `test-results/first-run`
screenshot directory. Coverage includes billing labels, authorization cancellation,
no-plan/network states, folder selection/cancellation/unavailability, editable
paths, permission propagation/risk cancellation, animation sampling/skip/replay,
reduced motion, light/dark assets, keyboard focus and narrow English layouts.
External requests are blocked and must remain absent. This does not establish
real sign-in, native Electron directory dialogs, persistence, upgrade behavior,
first-run detection, model acceptance or release readiness.

## Desktop-hosted Feishu Remote MVP (2026-11-05)

The Remote design preview is now wired into the real Desktop main process and
typed preload bridge. Scope and manual acceptance are in [REMOTE.md](REMOTE.md).
This is a Desktop-hosted, single-private-chat/single-session channel, not the
planned independent Web service. This work changed neither the upstream pin nor
the upstream sources.
The staged adapter reuses the unchanged pinned `lark-adapter` and locked SDK
1.76.0, with the helper and dependency license notices included in runtime
resources. No new Desktop dependency or lockfile change is required.

Typecheck, production build and the 97 focused manager/helper/session-runtime
tests pass. The final complete serial suite finishes with 864 tests: 850 pass,
14 platform skips and zero failures (`Desktop/test-results/remote-unit-suite.log`).
The expanded source Electron Remote acceptance passes using an
isolated profile, loopback model provider and injected fake channel helper;
the real staged SDK exports, upstream inbound gate and helper protocol are also
smoke-tested without authorization or network calls. It covers explicit binding,
cross-session routing, duplicate rejection, slash-command rejection, real native
permission confirmations and first-response-wins, callback probes, stopping,
unbind/disconnect, actual helper exit and draft preservation. Light/dark
420px screenshots and ancestor-clipping checks verify the production session
selector's complete focus outline; reduced motion is checked separately.
Actionable approvals contain the exact recovered, redacted tool parameters;
unrecoverable or oversized details remain local. Changed displayed parameters
invalidate an existing card. Length-truncated responses finish Interrupted,
not Working or Completed.

The sidebar Settings locator was migrated to its stable `.sidebar-settings`
class after the footer became icon-only. Existing update-indicator assertions
remain intact. General Electron, fixed Settings dialog and application-update
acceptance pass, as do all 15 CI policy/inventory/runner tests. The fixture
preview verifier also passed after sharing the production stylesheet/icon.
These are local Windows source results, not a cloud CI result.

Rebuildable output inventory: `Desktop/dist` is approximately 9.8 MiB and the
staged `Desktop/runtime/remote` adapter/notices approximately 6.0 MiB.
Remote production and preview screenshots total approximately 1.9 MiB. No new
installer was created and no existing packages or unrelated artifacts were
deleted.

Real Feishu authorization, platform callback configuration, actual SDK
reconnection, paid-model behavior, installer contents/native execution, macOS
acceptance and cloud CI have not been exercised. No credentials or user
conversation content were sent to a real bot, and no installer, commit, push,
PR or release is included in this goal.

## PR #187 launch acceptance synchronization (2026-11-03)

The favorites head `5ea2f60` passed all Windows checks and the macOS build,
interface and runtime groups. macOS sessions failed in
`verify-launch-modes.mjs`: after queuing one-shot Ultracode, the main-process
snapshot had already consumed its armed selection while React still rendered
the previous composer trigger. The following immediate DOM count asserted
before that render committed.

The acceptance now waits for that trigger to leave the composer before its
existing zero-count assertion. Queued-message identity, consumed armed state,
absence of an active-task pulse before dispatch, and the later dispatched pulse
checks remain intact. No production code, timeout, CI inventory or gate changes.

The unchanged Windows baseline passes. After the synchronization fix, two
consecutive source Electron launch acceptances pass against the real staged
runtime and isolated loopback provider. All 34 focused launch-state and
pending-message unit tests pass, as does the script syntax check. Replacement
cloud checks remain pending; these local results do not claim native macOS,
packaged acceptance or release readiness.

## Model favorites (2026-11-03)

The owner changed the PR #187 direction from automatic recent usage to explicit
starred favorites after reviewing its Desktop value. The branch remains
`codex/recent-models`, based on main `7debda7`. No secondary management surface
is included: the production picker retains its existing fixed dimensions,
search, thinking controls and panel motion.

An independent star button toggles each provider/model identity. Saved favorites
precede other available models in stable order without duplicates; no empty
favorite section is reserved. Search matches names, IDs and providers in one list
and retains independent star controls. Unavailable favorites stay saved but hidden.
Current catalog metadata controls labels and capabilities. Explicit favorites
are stored through the existing typed preferences bridge; no new IPC capability,
renderer Node access or personal CLI configuration is introduced. Earlier recent
history is removed, never converted into favorites, and all automatic collection
hooks are retired.

Favorite operations never select a model, change effort, arm a pending choice,
change the default or create an inference request. Saving failure remains
unstarred with a retryable inline error; a failed preference write restores the
previous in-memory favorite list. Up/Down and Home/End retain the current control
column; Left/Right move between model and star buttons. Reordering restores star
focus only if the user has not moved it elsewhere. Search and dismiss handlers
retain synthetic IME-composition guards.

Typecheck, the focused 19 unit tests and production build pass. The complete
CI-equivalent serial suite finishes with 823 tests: 809 pass, 14 platform skips
and no failures. An earlier default-parallel attempt stalled during process
cleanup and its verified test process tree was stopped; no test or timeout was
weakened for the serial rerun. `verify-model-switch.mjs`
passes against the real staged runtime and a loopback provider: explicit stars,
retired-history migration, no inference or selection side effects, invalid
mutation rejection, favorites during execution, persistent defaults, full restart,
steering/FIFO dispatch and missing-model protection. The updated
`verify-model-effort.mjs` passes star/search independence, deduplication,
unfavorite, save failure/retry, keyboard focus, IME guards, provider identity,
availability, existing sampled motion, light/dark narrow-window, English,
reduced motion, compact density and long-list focus checks. The model rows are
32px high, preserving the fixed panel while avoiding a redundant scrollbar for
the three-model fixture. General `verify-electron.mjs` acceptance also passes
after updating its model-list locator to the labeled multi-action group; its
visibility and layout assertions remain intact.

The compact-header follow-up merges the back arrow and search into one row,
returning about one model row to the list without resizing the popover. Keyboard
return restores focus to the model heading; both controls retain unclipped focus
indicators. Typecheck, build, expanded model-effort and general Electron
acceptance were rerun and pass, including narrow light/dark screenshots and
English labels. The full serial suite and runtime switching checks above predate
this layout-only follow-up. The interactive preview now has 24 illustrative
models across providers, including duplicate names and long labels; this is
fixture data, not a declaration of live provider availability.

The production-component fixture is `tests/fixtures/favorite-models.html`;
the earlier `recent-models.html` URL remains an alias. Fixture favorites use
separate browser-local sample storage, not Desktop account data. The replacement
is approved for the existing PR #187 after owner preview review; its title and
description are being updated from recent usage to favorites. No package or
shortcut update is included. Cloud CI for the replacement remains pending; no
native macOS execution, paid-model acceptance or public release is claimed.

## Full-text search PR review and CI repair (2026-11-02)

The first PR #185 run failed on Windows and macOS at the same
`verify-capabilities.mjs` assertion: the newly disclosed full-text entry adds
height beneath the anchored search field, while the old assertion expected no
list displacement. Acceptance now checks exact disclosure-height displacement,
unchanged trigger/x/width/bottom bounds, no overlap, full collapse restoration,
inert hidden controls and reduced motion. The runner and final CI gate are not
weakened or bypassed.

Both P2 review findings are addressed in the readonly and authoritative views:
choose the matching text block within an entry, and reveal the matching page of
large text before marking and scrolling. Inner paginated text also scrolls to
the keyword, including a match crossing the normal page boundary. Explicit
repeat location reopens the matching page without a new runtime; snapshots
retain manual paging. Message-only locations without visible query text have
an explicit fallback instead of claiming keyword location.

Local Windows typecheck/build and all 817 serial unit tests complete: 803 pass,
14 platform skips, zero failures (`fulltext-review-unit-suite.log`).
`verify-capabilities.mjs` and expanded `verify-fulltext-search.mjs` pass. The
latter uses actual indexed second-block/third-page/boundary-spanning hits,
checks visible highlight ranges in both scroll containers, repeat location,
runtime identity and unchanged JSONL after normal restoration metadata has
settled. The pre-navigation readonly immutability assertions remain unchanged.
The no-visible-keyword UI uses explicit IPC fault injection.

Replacement cloud checks remain pending. This repair has not been repackaged;
the previously accepted local installer is the preceding feature build.

## Search location handoff preview (2026-11-02)

The search result's explicit Open and locate action now transfers saved entry
identity and query to the authoritative conversation. A persistent location band
supports return to results and repeat location without a new runtime. The shared
DOM marker prefers exact response prose and scrolls to the first rendered
keyword range, including a match near the end of a multi-screen answer.
Snapshot-driven highlighting does not reset focus or repeat scrolling.
Missing current-context targets and conversation-level matches remain explicit.

Typecheck, production build and 40 focused search/navigation/scroll unit tests
pass. Source Electron session-navigation and quick-search regressions pass.
The expanded fulltext acceptance passes against the packaged executable,
including native indexed search, readonly preview, actual conversation
location/focus, repeat location, same-session runtime identity, result return,
missing-entry and degraded fallbacks, real light/dark palettes, narrow windows
and reduced motion. The actual-component browser fixture exposes the same
handoff with sample data.

Unsigned Windows x64 preview:
`D:\Desktop For Step Code\Desktop\release\fulltext-search-location-20261102-preview`.
All 105 build files and 1333 runtime files match the current build/staged source;
keyless adapter, terminal host and icon also match. Installer update metadata
and SHA-512 pass. Installer SHA-256:
`1c1bf83e14db58f1e87970f2a81626eba0963cc9b650efb48b6c6af97f9fd967`.
The owner accepted the local Windows preview on 2026-11-02. No cloud CI,
native macOS or clean-machine installation acceptance is claimed. The preceding
preview is left intact while the owner is running it.

## Desktop full-text search I / II (2026-11-02)

Branch `codex/fulltext-search` starts from main `fb4828b`. Search uses the
staged v016 pin plus the two overlay commits listed below, through the actual
management-process service and SQLite worker, not direct renderer database
access. The adapter and worker are included in the staging/resource paths.

Local Windows typecheck and build pass. The serial Desktop suite collects
814 tests: 800 pass, 14 platform skips, zero failures
(`Desktop/test-results/fulltext-unit-suite.log`). Focused tests also exercise
real SQLite queries, imported records, appends/deletions, explicit roots and
actual JSONL degradation after deliberately making the database path unusable.
CI policy/inventory/runner and Windows summary tests pass: 33 pass and one
platform skip.

`verify-fulltext-search.mjs` passes against source Electron with an isolated
profile and offline fixture model. It covers body-only native matches, entry
anchors/highlights, archive/project/time scope, old-branch fallback, draft and
runtime identity, unchanged JSONL, result scroll/focus restoration, cancellation
and stale replies, failed navigation, English/Chinese, light/dark and 620px
windows. Error, partial-index, cap and delayed-reply UI states use IPC fault
injection; those are not claims of reproducing every upstream failure. An
already-open browser hides during search; no agent or model call is needed for
search or reading. `verify-session-search.mjs` also passes, preserving the
existing quick metadata filter, grouping, ordering, collapse and draft behavior.

The actual-component browser fixture passes 1440px/390px screenshots, message
anchors/highlights, no horizontal overflow and reduced-motion interaction.
It remains explicitly sample data, not real-account or filesystem acceptance.

Scope and bounds are recorded in [Session search](SESSION_SEARCH.md). Project
and archive filters apply after the native bounded batch; short terms use the
native recent-session window, and degraded hits cannot promise message
locations. Both TODO entries remain unchecked pending cloud CI; the owner has
accepted the local Windows preview.

The unsigned Windows x64 preview installer is available under
`D:\Desktop For Step Code\Desktop\release\fulltext-search-20261102-preview`.
The packaged executable passes `verify-fulltext-search.mjs` with an isolated
profile, including the actual packaged SQLite worker. All 105 Desktop build
files and 1333 runtime files match the local build/staged source; the keyless
adapter, terminal host and icon also match. Installer update metadata and
SHA-512 validation pass. Installer SHA-256:
`c72785abd6041b8c1f09765acd5083db6e48929f3884d051fba584c975ca8c0e`.
The package uses the existing dependency-free staging pattern to avoid the
Electron Builder hoisted-dependency collector failure. This is a local preview,
not a new version or published release. No new cloud CI result, native macOS
execution, real-account or release readiness is claimed.

## Upstream overlay pin: subagent outcomes and session records (2026-11-01)

The v016 baseline carries two upstream commits installed by the applier before
the desktop patches, declared under `upstream.commits` in the manifest:
`7487124e7b27c604535fc8439ccd0d0b81c5c299` (session record of facts,
upstream PR stepfun-ai/Step-Code#318) and
`90a57820c81c6e78e4a3ea5be3f66694ac038611` (preserve subagent outcomes, upstream
PR stepfun-ai/Step-Code#324). They land as uncommitted worktree edits, so the
staging guard still checks HEAD against the pin while `sources` and
`patchedSources` describe the combined state. Upstream PR
stepfun-ai/Step-Code#323 is deliberately skipped: it removes the
`enter_plan_mode` tool the Desktop plan-review bridge is built on, and the two
carried commits do not depend on it. See the [overlay notes](UPSTREAM_V016.md).

Patch rebase evidence: all 13 desktop patches were rebased onto the combined
state. 29 of 34 patched sources remain byte-identical to the previous v016
result; the 5 changed files are exactly the upstream-colliding sources
(lane-lifecycle, rpc-adapter, index, rpc-mode, step-subagent-events test). A
fresh pin checkout replayed by the updated applier is byte-identical to the
reviewed composition, and a tampered preimage rolls every applied patch back in
reverse, leaving the checkout as it was found.

Upstream suite control: the composed tree with desktop patches and the previous
v016 state ran the full upstream coding-agent suite on the same Windows machine.
The deterministic failures are identical to upstream main `90a57820` itself on
this machine (three json-mode-durability tests plus the oversized-output and
rpc live-channel tests); every other per-run difference flipped in isolated
reruns, so the composition adds no new deterministic failure.

Desktop local: typecheck passes. The serial Desktop suite is 807 collected:
793 pass, 14 platform skips, zero failures, including real-runtime background
lane, session worker and slash-handler tests against a locally staged overlay
runtime. The spawn-args assertions pin `--include-live-events`, and a slash
assertion requires `message_update` streaming frames with that flag set.
CI policy/runner/diagnostic tests pass with one platform skip (24 pass,
1 skip).

Staging: staged locally from the composed checkout with Node v24.16.0; the
runtime manifest records the pin plus both upstream commits. Staging now skips
rewriting an identical bundled node binary and prefers the distribution's own
LICENSE before the remote fetch, which keeps restaging idempotent under file
locking and works without access to the license host.

Non-claims: the Electron acceptance scripts did not run on this machine.
Behavior-monitoring software denies file writes by node-family processes under
the repository path and denies Electron processes writes generally, so the
local suite covers the staged runtime through the node test runner only. No
installer, packaged app, real-account or real-model run, native macOS
acceptance or cloud CI result is claimed by this entry; the Windows three-group
run on the PR head remains the required gate for the full acceptance inventory.

## v0.1.6 CI base synchronization (2026-10-31)

PR #170's original Windows interface, sessions and runtime groups passed.
Its macOS run `40284635861` failed `verify-workflow.mjs` at the intermediate
disclosure-height assertion. The latest main includes the shared fixture fix:
explicit motion preference and synchronous sampling of the real CSS effect
before hidden-window frame delivery can skip its intermediate states.
The v0.1.6 branch incorporates that fix without changing product animation,
runtime source identity or acceptance assertions. Replacement current-head
cloud results remain required; the October 26 evidence below is historical.

After synchronizing main, local Windows typecheck/build, real Electron
Workflow UI, command dispatch and the standalone worker probe pass. The serial
Desktop suite has 807 tests: 793 pass, 14 platform skips, zero failures
(`Desktop/test-results/upstream-v016-merge-main-20261031.log`). All 15 browser
motion-helper tests pass; the restored-playback endpoint now awaits the real
animation's `finished` receipt instead of assuming the action's 300ms delay
also completed rendering. Existing intermediate and final geometry assertions
are unchanged. CI policy/runner/diagnostic tests pass with one Mac-only skip.
The updated patch applier also passes a clean Windows source/hash replay.

Replacement head `0dd76ce` passed all Windows groups and the final gate
(`41183029529`). macOS `41183029175` passed the complete source inventory,
including Workflow motion, then failed the packaged Launch modes footer
alignment assertion. That check polled transient alignment before separately
measuring a trigger that can be reparented with a fresh entrance animation.
The fixture now awaits real footer animation completion before the final
atomic geometry read and includes both rectangles in failure diagnostics.
The same 1px center tolerance and non-overlap assertion remain unchanged.
Local real Goal/RPC acceptance passes both normal motion and a 1000ms entrance
control. A persistent 2px trigger offset still fails the original alignment
guard. Replacement package CI is still required.

The next Windows runtime job on `94735be` failed only in the capability
fixture teardown: `rm` reported `EBUSY` for its isolated Desktop directory
after management workers stopped. Cleanup now uses five bounded filesystem
retries at a 100ms base delay; it still rejects if removal cannot finish.
All 12 capability tests pass locally. A native Windows control holding a
temporary working directory reproduces immediate `EBUSY` and verifies that
the same bounded removal succeeds after the owning process exits.

## v0.1.6 development integration (2026-10-26)

The isolated `codex/upstream-v016` worktree stages source baseline
`81e79bc4b699148d6823fedde9b5e70d9a80255f` with `patches/v016`.
This is the announcement source baseline, not a verified official release tag
or a binary/source identity claim. See [integration boundaries](UPSTREAM_V016.md).

Final Windows local verification:

- Desktop typecheck and production build pass. The serial protocol suite has
  799 tests: 785 pass, 14 platform skips, zero failures. The final log is
  `Desktop/test-results/upstream-v016-protocol-handoff.log`.
- The patched upstream full check passes; 32 regression files have 668 passing
  tests and three skips. Coverage includes Plan/cache, CLM, compaction retry,
  permissions, Cron, Workflow, session import and background lane notifications.
- Real pinned RPC with an isolated local HTTP model fixture verifies that a
  delegated lane survives parent idleness and navigation, wakes its original
  session, and completes once without stealing navigation. Suspension clears
  live ownership without reporting false completion. Unit regressions cover
  the pre-`agent_start` parent handoff and cancellation via `agent_settled`.
- Final staging and the standalone copied-bundle worker probe pass: usage
  totals/cache/cancellation and a ready SQLite session index with search.
- Final Electron/native `then_run` acceptance passes approval/denial,
  cancellation, history reload, working-directory, timeout, output limit and
  descendant cleanup checks. Its temporary profile resolves directory
  junctions before comparing workspace identity.
- Earlier local Electron Workflow runtime, Plan review and CLM cancellation
  checks passed before the final parent-handoff change; they were not all
  rerun afterward. CI runner policy tests passed.
- Clean Windows patch replay and all pre/post source hashes pass. Darwin patch
  selection/replay and hashes also pass on Windows; this is not native macOS
  execution.

Remaining gates: replacement Windows/macOS cloud checks, native macOS runtime
acceptance, an installed package and real-account acceptance. No installer,
release or implementation push is represented by these local results. Build
artifacts and isolated test profiles are on D:, and the user's installed app
and shortcut are unchanged. TODO completion boxes remain open pending gates.

## Workflow catalog drawer (2026-10-26, development branch)

The bare `/workflows` command now opens a read-only Desktop drawer. The main
process reads bounded native workflow records and isolated Desktop definitions;
it does not execute scripts, mutate records, or send a model request. Parameters
retain the existing upstream dispatch. The runtime pin is unchanged.

Local Windows checks: TypeScript and production build passed; unit/protocol
tests reported 786 passed, 14 skipped, zero failures. CI inventory/policy tests
reported 19 passed. `verify-command-dispatch.mjs` checks the real listing IPC
against an isolated Desktop profile and rejects a wrong session identity before
switching to mocked IPC for UI routing and page-exit checks.

`verify-workflow-catalog.mjs` uses the production React component with fixture
data in local Edge: five-second expiry and reopen, hover/focus/disclosure
pauses, focus restoration, short/long drag, error recovery, stale response
isolation, reduced motion, and light/dark layouts at 1100/390/320px passed.
The test is assigned to the shared interface CI inventory. Browser fixture
success is not cloud CI, macOS execution, installer or real-account acceptance.
No package or release is claimed by this section.

## Single-slot workflow persistence fixture (2026-10-25)

`2bb6c27` Windows run `40118772782` passed all 83 acceptance checks and the
final gate. Mac `40118772757` passed its first 75 source checks, then failed
the Workflow runtime child-transcript assertion. The existing 10-second file
poll was working; extending it would not resolve the fixture's waiting cycle.

The frozen runtime's default workflow concurrency is CPU-bounded and can be
one slot. Its session manager first creates a JSONL file after a complete
assistant message. The fixture held CHILD-A's first response while requiring
a child transcript to exist; in a single slot CHILD-B cannot start and neither
child can create that first record. The fixture now completes A before holding
B. It still inspects a real persisted child while the workflow is active,
rejects opening/switching to child history and checks every original parallel,
chain, restart, crash, cache, partial-failure and HTTP429 contract.

A supported explicit maxConcurrency=1 control reproduces the old failure with
only A requested and no child files. The corrected source and actual `d6fa5da`
package both pass single-slot and default-slot controls (four passes). The
single-slot result confirms native limit=1/cap=1. No runtime, pin, environment
isolation, timeout or assertion is changed. Static review of the remaining
runtime fixtures found no second held-first-child/await-second-child cycle.
The fixture logs only allowlisted numeric native concurrency fields and fixture
request/file counts before the disk assertion, including on a failed scan.
Mac's complete serial order now starts with runtime, then interface and sessions,
so resource-dependent checks report earlier. All 84 scripts and deadlines remain
identical in both source and package modes; Windows order is unchanged. Existing
CI policy/runner checks pass (18 passed, one Windows-only skip).
The accepted application remains the clean `d6fa5da` build; replacement full
Mac cloud source and package results are still required before merging.

## Complete constrained-display reproduction (2026-10-25)

The ignored local launch wrapper caps native fixture windows to 684px without
changing product code or disabling animations. The full 84-item source
inventory completed successfully after correcting two display-dependent test
premises; both original failed attempts remain in its JSON/log.

Permission Approval's fixed upward gesture was 46px including the grip offset.
At the real 684px viewport its observed drawer range is only 240px →316px,
so that gesture correctly crosses the expansion midpoint. The small-drag
compact-snap test now chooses a displacement from the observed compact/expanded
range. Normal 900px windows retain the same 46px gesture (240→424); short
windows use 19px (240→316). The existing compact-state, large expansion,
keyboard resizing, bounds, defer and response assertions remain unchanged.

Workflow's fifth agent is below the short overview viewport. Playwright must
scroll it into view to click it; the old test compared the restored scroll
against a position captured before that necessary scroll. It now explicitly
reveals the same target, records that actual position and retains the exact
return-to-overview scroll assertion. No product behavior or control is changed.

Each corrected script passes normal source, the actual `d6fa5da` package and
the package capped to 684px (six targeted passes). The full capped source
report has 84 successes, complete=true, and preserves its two pre-fix failures.
Windows `9ae63c0` run `40116856737` also passed all three groups and the final
gate; final Mac cloud source/package results must still come from a head
containing these last two fixture corrections. The accepted application source
and runtime remain unchanged from `d6fa5da`.

## Hidden-window layout synchronization (2026-10-25)

Head `97cb4c1` passed Windows interface 40/40, sessions 18/18, runtime 25/25
and its final gate (`40115080022`). Mac `40115080007` failed earlier at the
composer-menu geometry check: gap `1.8370361328125` instead of the existing
6px ±1 contract, with both horizontal edges aligned. The fixture's 220ms
wall-clock sleep did not establish completion of the 160ms CSS entrance in
the unfocused native window.

`settleLayout` waits for fonts, rendered frames and real finite animations on
the measured element/subtree and its ancestors. Infinite activity indicators
are excluded; replaced animations handle only their AbortError cancellation.
No animation is disabled, no timeout is enlarged and no geometry assertion or
tolerance is changed. The composer, settings, question/permission drawers,
workflow, artifacts, browser and file-preview checks use it where their
contract requires a completed layout. Deliberate intermediate-frame, exit,
cancellation and elapsed-time guards remain. The basic Electron and Subagent
animation fixtures receive the existing Plan/browser Chromium flags to keep
their hidden renderer sampling active. The shared session fixture also requires
its composer element to exist before calling it enabled.

Composer source and the actual `d6fa5da` package pass. Extending the real CSS
entrance to 1000ms produces an initial 1px gap; the helper waits 1056.64ms and
the unchanged final measurement is exactly 6px with both edges aligned.
A final static 3px translation still fails the original geometry assertion
in 1.49 seconds. The five drawer/settings/workflow/artifact scripts and four
background-sampling/browser/file scripts each pass source and actual-package
checks (18 targeted runs), preserving all original assertions. A separate
ignored launch wrapper caps native windows at 684px for a full local inventory
reproduction; its result must be recorded separately from normal-size passes.

This follow-up changes fixture scripts and documentation only. The user-tested
application remains the clean `d6fa5da` build; its runtime pin and binary are
unchanged. Complete replacement Mac source/package cloud checks remain required.

## Plan anchor reference follow-up (2026-10-25)

The `d6fa5da` Windows workflow `40113230323` completed successfully across
interface, sessions, runtime and the final gate; Cron management and transcript
replay both passed. Mac run `40113230356` stopped earlier in Plan with a now
visible exact difference: running trigger x `144.640625 → 144.6875`, y `0 → 0`.
It did not wrap. The old x reference included the preceding working indicator,
whose live elapsed text can legitimately change width independently of expansion.
Running anchors now measure the exact gap from that adjacent indicator's right
edge, while y stays relative to the row top. The fixture also requires adjacency
and vertical overlap. Settled anchors still use the footer row. All comparisons
remain exact; no coordinate tolerance or clock freeze is introduced.

Normal source and the actual `d6fa5da` package pass the updated Plan check.
A controlled 1px increase in the preceding indicator moves the raw button x by
1px while the measured gap stays exactly `{x:8,y:0}` and passes. A 1px translation
of the button itself still fails with `{x:9,y:0}` and exits in 4.90 seconds.
This follow-up changes only acceptance code and documentation, not the renderer
or runtime. Full replacement cloud results are still required.

The independent local `d6fa5da` package completed the 84-item package-configured
inventory and the native zsh/PTY test. The inventory includes source component
fixtures, so it is not described as 84 direct binary checks. ZIP contents,
1,521 files and 14 links, and executable bits match the tested app; its update
metadata matches the 179,215,438-byte ZIP with SHA-256
`a522717b961ac181c6223c92585d616c2f4b36e0e1472d362785c2d7494f0984`.
The Desktop shortcut points at that independent test candidate. Existing Release
Draft assets still identify the earlier accepted `549bb39` RC.

## Cron focus and replay CI follow-up (2026-10-25)

Run `40110441887` passed the repaired project picker and Plan checks, then
failed Cron management focus geometry at a 684px viewport. A partially visible
textarea can receive native focus with its caret visible while its bottom and
outline remain outside the scroller. This was reproduced locally with the
unchanged renderer: its focused outline extended to about 708px in a 684px
viewport. Cron editor controls now scroll their complete box into view on focus;
the scroller and controls reserve 4px for the existing shared outline. No focus
indicator is removed or weakened. Acceptance covers normal and 684px heights,
dark/wide and light/narrow layouts, and both programmatic/keyboard and mouse
focus from a partially scrolled multiline field. The shared geometry helper can
observe an already focused field without refocusing it, retaining every outline,
clipping-ancestor and viewport assertion. Local Cron management's 14 cases pass,
including an additional 540px height reproduction. Typecheck/build and the full
unit/protocol suite pass (790 passed, one Windows-only skip).

Windows run `40110441868` passed interface and sessions but repeated the Cron
transcript timeout after reload. A controlled 12-second navigation IPC delay
reproduces it: the readable cold preview contains both Cron records while main
still has no selected runtime/session; reloading discards that pending navigation.
The fixture now waits for authoritative handoff and strictly checks connected
status, runtime ID and the expected session ID before reload. All original eight
Cron checks and the 60-second limit remain. Normal source, accepted `549bb39`
package and the controlled delay pass. This is a test precondition correction,
not a runtime or Cron message change.

The focus correction changes the renderer, so final Mac packaging and renewed
acceptance are required. Existing Draft assets remain the earlier accepted RC;
neither local fixture results nor the earlier partial cloud runs establish full
cloud success or final source/tag alignment.

## Replacement CI diagnostics follow-up (2026-10-25)

Commit `5ee398d` passed the original project-picker failure in hosted Mac CI
`40107639737`. Source acceptance then failed during the running Plan disclosure
anchor check. The fixture's held provider response and obsolete native-dialog
teardown hid the original assertion behind a 300-second runner timeout.
Plan now prints its original error and before/after coordinates, waits for
actual finite disclosure animations and resulting layout rather than a fixed
sleep, and uses the standard orderly fixture quit review. Its exact coordinate
assertions and all Plan approval/cancellation/reentry contracts remain intact.
A deliberate one-pixel anchor error still fails and reports the original
assertion, then exits in about five seconds instead of hanging. Six local
pre-change 684px repetitions did not reproduce the hosted position failure;
its precise coordinate difference is therefore not claimed as established.
Updated source and 684px packaged Plan acceptance both pass locally.

Windows run `40107639738` passed interface and sessions, but runtime timed out
waiting for the first Cron transcript element in the unchanged saved-history
fixture. Its cause remains unconfirmed. That fixture now preserves the original
error, a bounded state projection and a failure screenshot and uses the same
orderly close helper; its assertions and timeout are unchanged. All eight checks
pass locally against the accepted package. These are test-only follow-ups;
neither the approved RC nor application/runtime sources have been rebuilt.
Fresh complete cloud checks are required; neither failed run is recorded green.

## Mac project-picker CI follow-up and second review (2026-10-24)

Mac run `40101170389` passed upstream tests, build/staging, types and protocol
checks, then failed `verify-new-session.mjs:74`. Its actual renderer was only
684px high despite the fixture requesting 960px. Local reproduction against the
accepted `549bb39` app produced the same failure: six projects were present, but
the bounded picker list was 74px high rather than five rows. The menu stayed
above the composer and its remaining projects were scrollable.

Only acceptance code changes. Measured space determines when the five-complete-
row contract applies; a constrained window must still show a complete row,
scroll all six projects fully into view, select the last project without a
worker/history write, and retain the existing search, proposal, draft, keyboard,
first-send and relaunch assertions. Native bounds can be capped explicitly for
regression reproduction. Geometry and a failure screenshot are retained.

Full local new-session acceptance passed against source at native 1440x960
(190px list, five-row contract enforced) and against the unchanged accepted
package capped to 1440x684 (74px list, all projects reachable). No application
CSS, Electron code, runtime pin or candidate ZIP changed. Replacement Mac CI
must complete both source and package-configured inventories before a green
cloud result is claimed.

The Windows review was checked against current draft asset IDs/digests, the
merged checksum file and a fresh download of its build evidence. Windows RC
source is `9b69eada5666934bdd15f7afbe02a3b31cb91f49`; Mac RC source remains
`549bb39f118c992292afa43e9203b606ac983906`. The draft target is still `0fc0f1e`;
changing that target cannot reattribute either existing binary to final main.
See [Mac second review](releases/v0.6.0-macos-second-review.zh-CN.md) for hashes
and the remaining merge/tag/build-source gates. Draft/Pre-release is retained;
this follow-up neither merges nor publishes anything.

## Authorized PR #164 frontend follow-up (2026-10-24)

The owner explicitly authorized only shared frontend fix
`1038461e7d4ffbb65bf7a39858c5bda1a066ece2` after the PR #163 feature freeze.
Question status labels, icons, the Beta badge and pending-answer entry retain
their intrinsic single-line width; only the long question preview can shrink
and ellipsize. The exact CSS, component fixture, layout acceptance and inventory
entry are ported. The Windows handoff document with an obsolete Mac pin is not
imported. Later `9b69ead` TODO documentation and the Workflow top drawer are
outside this update.

Fresh typecheck/build passed, as did the complete serialized Desktop unit and
protocol suite (790 passed, one Windows-only skip) and all 18 CI policy/runner
checks (one Windows-only skip). The upstream layout acceptance passed all 12
theme/language/width combinations. An expanded actual-component source fixture
passed 16 combinations across seven question states, including 320px width,
full status/Beta text bounds, ellipsis, disclosure/actions and reduced motion.
The rebuilt package receives independent native layout and real-RPC question
acceptance; those results and archive provenance are retained with its BUILD-INFO.

The Mac runtime pin remains `b5dbed938d9ae589397cf522dcf2ff89ecf4c494`, with
the existing v0.1.5/Darwin patches and Node v24.15.0. The staged runtime is
retained and checked by complete file hashes; this frontend change requires a
new renderer build and clean candidate, not reuse of the prior ZIP. Prior
candidate checks below describe their original commits. Fresh targeted visual,
question-flow and package/resource evidence accompanies the rebuilt candidate.
The added layout check uses the source Vite/component fixture even when invoked
from the package-configured inventory; it is not a packaged-renderer test.

## macOS 0.6.0 local candidate acceptance (2026-10-24, user testing pending)

The owner authorized the feature freeze at Windows PR #163 merge
`324e71d1800de020c035cdce598374a6037ba4ca`, superseding the 0.5.1-only scope.
This is a local test-candidate preparation, not publication or real-account
acceptance. The release/draft handoff and manual checklist are recorded in
[0.6.0 Mac preparation](releases/v0.6.0-macos-preparation.zh-CN.md).

Mac now stages Step Code `b5dbed938d9ae589397cf522dcf2ff89ecf4c494`, the complete
v0.1.5 Desktop integration with strict shared/platform hashes, and a Darwin-only
process-tree patch. The original dirty `Step-Code/` checkout was preserved;
builds use a separate source directory. Node is v24.15.0 on ARM64 macOS 26.4.
Offline upstream build, clean patch reapplication and staged usage worker passed.
The complete 27-suite upstream run passed 619 tests with three Linux-only skips,
including real detached-child cancellation with an unrelated process retained.
A hosted three-CPU Mac exposed a unit fixture assuming two runnable slots. A
separate hash-pinned Darwin test patch fixes the test topology and cleanup, while
asserting the production three-core cap remains one. Forced-three-core full-suite
replay passes; shared Windows patches and source hashes are unchanged.

Desktop frozen-lockfile install, typecheck and production build passed. The
full serialized unit/protocol run after product fixes passed 790 tests with one
Windows-only skip, including the final clean `6f042ca` candidate run. The Darwin
CI-test manifest update also passed all four staging guards. CI policy/runner
checks passed 18 tests with one Windows-only cancellation skip.

Product audit enabled Mac Cron recovery/editing/scope and offline session import,
removed the obsolete Mac runtime export gaps, corrected platform workspace keys,
and retained all trust/account/idle/review guards. Actual Mac CLM/status and
capability management fixtures passed. StepPage now uses Desktop-owned bundle
and home paths: missing bundle and enabled-only declarations do not fall back to
personal PATH/HOME or implicit installer. A real runtime sentinel test verifies
that personal executable discovery never runs, followed by successful explicit
preparation against a disposable MCP fixture. Explicit custom configuration and
disabled state remain intact. No real service login or publishing was performed.

Mac acceptance now reuses the shared serial feature inventory (83 checks), excluding
only the Windows native command suite and adding native updater/turn-undo checks.
All 83 source checks passed after the initial sweep and targeted repairs; the
initial failures and rerun results are retained in test-results, with the exact
final inventory in macos-source-final.json. Initial failures exposed stale fixture
assumptions as well as a real wheel-routing gap over sibling conversation markers
and scroll handles; the latter has a product fix and bounded delta/zoom tests.
Native test sizing uses actual window bounds and retains all sub-100px scroll
assertions. Zsh paste requires explicit Enter, preserving bracketed-paste safety.
The official StepPage 1.0.0 bundle matched its pinned SHA-256 and passed a real
13-tool handshake, disable/reconnect, settings-button preparation, isolated HOME,
corrupt-file rejection/repair and Cron-host coexistence checks without login, tool
calls or publishing in the source application.

The first 8669326 packaged candidate exposed a real tray-label clipping defect
that source checks had missed. Tray sizing now measures intrinsic DOM layout
with actual typography/letter spacing, waits for fonts and includes root chrome
without measuring entrance transforms. Native source regression passed both
languages and increased spacing, including strict no-clipping/compactness checks.
The candidate was rebuilt from clean commit `6f042ca`; the rejected package and its
failed report are retained locally. A cloud appearance check also exposed a
fixture measuring its baseline during entrance animation; it now awaits actual
animation completion while retaining exact geometry comparisons.

The `6f042ca` application passed all 83 packaged checks in one serial run, with
no failures. Its 1,335 packaged application/runtime/native files matched staged
inputs, including executable permissions, ARM64 architecture and deployment
targets. The official StepPage bundle also passed packaged fixed-hash validation
and the real 13 -> 0 -> 13 tool registration/disable/restore handshake. The extra
packaged StepPage settings/download preparation check initially timed out before
UI setup. Native sampling traced this to a Security.framework Keychain prompt:
the fixture had replaced macOS's outer HOME with a synthetic directory. The
macOS fixture now retains the OS HOME, while Desktop userData, runtime and
StepPage homes remain isolated; Windows fixture behavior is unchanged. The
complete packaged preparation check then passed official download/UI entry,
13-tool handshake, Cron-host preservation/protected restart, light/narrow views,
disable/relaunch, corrupt-bundle rejection and repair without re-enabling it.
The initial failures, native sample and successful retest are retained.

Windows CI `40094837661` passed for `6f042ca`. Mac CI `40094837652` passed its
upstream tests, build/staging, types and protocol checks, then failed the source
scroll fixture because the clamped native display left a 254px scroll range.
Cloud package checks were consequently skipped. The fixture now tries bounded
shorter content while preserving the failed-command disclosure and every strict
scroll assertion. Two local packaged checks with maximum native height 684
passed, measuring 58px/58px/49px in dark/wide, light/wide and light/narrow views.
Replacement hosted CI remains required before release readiness is claimed.

The earlier `41f8b26` handoff changed only tests and evidence after `6f042ca`.
That packaging retained the staged application/runtime payload, recorded the clean packaging
commit and compares it against the fully tested candidate. Archive hashes,
payload comparison, ZIP round-trip and per-script evidence are stored with the
local candidate's `BUILD-INFO-macos-arm64.md` and verification attachments.

Unsigned/unnotarized installation, real account/model calls, production in-app
upgrade, external services and execution on the minimum supported macOS remain
separate user acceptance gates. Local fixture outcomes cannot satisfy them.

## Automatic Continuation Provenance (2026-10-24)

Windows automatic continuation now retains structured system provenance through
the normal input and `before_agent_start` hooks, model validation, live events and
saved JSONL. Provider input remains the original instruction. Desktop renders it
as a noninteractive timeline event in the original response, not a human message
or copied assistant prose. It records an attempted continuation, not successful
recovery. Its accent semibold label and the model-switch label are both upright.
Unmarked old history and manually authored identical text are not reclassified.

Clean Windows patch replay and all pre/post-image hashes passed. The upstream
build and 97 continuation/permission/prompt tests passed. Desktop typecheck,
production build, 772 tests (13 platform skips), and 15 CI policy/runner tests
passed. The real-component browser fixture passed 24 theme/language/preset/width
cases plus stop, failure, reload, hidden-message and reduced-motion checks.
Isolated-profile Electron acceptance passed persisted history, renderer reload,
same-text user identity and original-response grouping after the authoritative
navigation handoff. Existing model-switch Electron acceptance also passed,
including its computed nonitalic label style and light/dark/narrow layouts.
No installer, paid-provider call, macOS runtime or cloud-CI acceptance is claimed.

## CLM Readability And Inspector Widths (2026-10-24)

CLM contents use read-only Markdown, and saved diffs offer selectable before/after
excerpts with the raw diff collapsed underneath. Structural context headers stay
out of readable excerpts; missing prior contents, identities and revision numbers
are not reconstructed. Context (including Status and CLM) and Changes now share
standard, wide and fullscreen controls, including the existing drag handle.

Typecheck, production build and 15 focused CLM/context tests passed. The real
component fixture passed history, readable/raw diff, content selection, busy
guards, manual confirmation, light/dark themes and 1100/390/320-pixel layouts.
The local unsigned D: preview passed packaged Context and Changes acceptance,
including all three widths, scroll preservation and fullscreen restore, plus
command dispatch and general isolated-profile Electron/relaunch acceptance.
The subsequent serial Node 24.16.0 suite passed 748 tests with 13 platform skips
and no failures.

All 105 Desktop build files, 1,246 staged runtime files and 27 packaged terminal
files match their source hashes. The runtime remains pinned to
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494`; all 28 patched-source hashes match
the branch manifest. Six tests against that packaged runtime passed branch-only
read access, Plan/Goal preservation, invalid-edit fallback and cancellation with
explicit recovery. Profiles and model responses are isolated local fixtures.
This is not paid-provider, installer install/upgrade or cloud-CI acceptance.

The first replacement cloud runs failed in the shared browser fixture on both
Windows and macOS: it still asserted that Context had no width selector. This
was reproduced locally before changing the fixture. It now checks Context's
independent standard default, all three Context widths, hidden inactive native
pages and preservation of the browser's wide mode without stale fullscreen state.
Source and packaged browser acceptance, typecheck and all 15 CI policy/runner
tests pass locally. No application code, runtime pin or workflow gate changes
are included in this fixture repair; replacement cloud checks remain required.

## Sidebar Session Search (2026-10-24)

The former placeholder now filters existing non-archived session metadata in
the renderer. Title, first prompt, project aliases and paths are searchable;
full transcript contents are not scanned. Empty queries preserve the original
catalog. Matching collapsed groups open temporarily without preference writes,
and filtered views cannot rewrite manual ordering.

Typecheck, production build and 15 focused search/order tests passed, including
empty-title localization and a 10,000-session metadata catalog. Isolated-profile
source Electron search acceptance passed real catalog filtering, pinned ordering,
archived exclusion, independent sessions, IME Escape, empty results, restored
collapse state, unchanged draft/runtime identity and explicit result navigation.
Light/dark, narrow layouts and complete composite-field focus bounds are covered.
The existing source Electron session-navigation, sidebar-order/disclosure and full
capability-management regressions passed separately. The initially stale local runtime was restaged
from a separate pinned checkout with the current Desktop patches; all patched
source hashes and management adapters were checked against this branch before
rerunning acceptance. No installed user profile was used. No installer,
paid-model run or complete-suite acceptance is claimed.

## Shared Elapsed Duration Display (2026-10-24)

The running matrix indicator, completed-turn label and performance strip now share
whole-second duration formatting with minute/hour rollover and spaces between
unit groups. Chinese live labels use `4小时 0分 21秒`; compact labels use
`4h 0m 21s`. This changes presentation only, not timing sources or billing.
Typecheck, the production renderer build and 15 focused timing/performance tests
passed, including real isolated RPC timing. Browser acceptance covers the actual
components in light/dark, Chinese/English and 390-pixel layouts, minute/hour
boundaries and 24-hour runs, plus the existing motion and accessibility checks.
Isolated-profile Electron acceptance with the current source renderer passed
history/reload, light/dark/narrow, live ticking and completion freeze checks.
No installer, paid-model run or full-suite acceptance is claimed.

## Transcript Scroll Intent (2026-10-24)

Reproduced upward wheel input being undone by disclosure reflows or subsequent
message events. A single-turn transcript with only 62 pixels of scroll range
could never leave the former 100-pixel near-bottom following threshold.

Explicit upward gestures now pause following before layout correction.
Keyboard scrolling, the separate scroll handle and turn navigation share that
intent. Downward scrolling resumes only at the bottom; explicit return also
follows a moving tail during smooth scrolling. Ordinary disclosure collapse
back to a fitting transcript still permits automatic following unless the
reader explicitly paused it. The return control remains available for short
histories and while reading nested command output.

Typecheck, production renderer compilation, 23 focused scroll/navigation/cache
tests and 15 CI policy/runner tests passed. Isolated-profile source Electron
acceptance covers single/multiple turns, animated failed-command expansion,
small wheel gestures over the body/ruler/handle, keyboard/drag navigation,
sub-100-pixel ranges, content growing from no overflow, explicit/automatic
resumption, nested output and light/dark/narrow/reduced-motion views. The new
check is registered in the Windows interface CI group. Existing stream-motion,
session-navigation/reading handoff and context-panel acceptance also passed.
The local main/preload bundles and management/history adapters were refreshed
for navigation acceptance; this does not update the installed application.
No installer, paid-model or complete-suite acceptance is claimed.

## Capability Form And Sidebar Follow-Up (2026-10-24)

The Skill creation form reproduced horizontal clipping of its outer focus outline
at the capability scroll container. That container now reserves focus gutters and
scroll padding/margins without replacing the shared focus treatment. AGENTS.md
and DESIGN.md require complete four-sided focus indicators for future forms.
Source Electron acceptance checks Name, Description and Instructions against
clipping ancestors in light/dark and wide/narrow layouts, with focused screenshots.
It also verifies that the Schedules icon toggles back to the original draft without
creating a runtime, and that the sidebar's top fade applies only after scrolling,
clears at scroll origin and does not obscure keyboard-visible focus.
Typecheck, production build and the complete capability Electron acceptance passed.
This follow-up has not been repackaged; no installer or paid-model acceptance is
claimed.

Main `c6d0121` integration retains both capability mutation locking and
session-move guards, plus both plugin exports and the session-scoped Cron patch.
Clean Windows patch replay and all patched-source hashes passed; typecheck,
production build and 99 focused integration tests passed. The prepared local
CLI dependency link initially resolved a different checkout's compiled agent.
An isolated CLI dependency overlay now resolves this checkout's agent without
changing shared dependencies; runtime staging was repeated before acceptance.
Source Electron session-move acceptance passed, including unrelated Cron hosts,
relaunch, scoped restart and cold background-work guards. Capability management
and general Electron acceptance also passed against the restaged runtime.
This does not update the previous preview installer.

## Reading-First Session Navigation (2026-10-24)

### Editable Recovery Follow-Up

The follow-up supersedes the inert preview/composer behavior described below.
Cold reading now permits copying and historical disclosures, while the selected
session owns an immediately editable text draft. Enter, attachment imports and
runtime controls remain gated. Authoritative handoff preserves the editor
instance, focus and caret; overtaken and failed targets retain separate drafts.
Readiness fixtures now wait for the composer navigation gate, not just an
editable textbox.

Windows retains up to four recyclable idle workers while free system memory is
at least 3 GiB, otherwise two. Other platforms keep two. Five-minute expiry and
all active task, Goal, Cron, pending-operation and navigation reservations remain
unchanged. This does not prewarm unvisited agents and is not a hard cap on
protected workers. Periodic and post-navigation recycling re-evaluate the budget.

Runtime snapshots include numeric startup durations for process readiness,
session restoration, snapshot loading and model confirmation. They carry no
paths, prompts or credentials. Resident reuse retains the original startup
sample, rather than reporting it as a new startup.

The local offline benchmark in
`Desktop/test-results/session-navigation-performance-current.json` measured:

| Scenario | Readable | Editable | Execution Ready |
| --- | ---: | ---: | ---: |
| Cold 0 | 49ms | 9ms | 792ms |
| Cold 1 | 20ms | 8ms | 754ms |
| Cold 2 | 16ms | 7ms | 758ms |
| Resident | 12ms | 12ms | 28ms |
| Three rapid selections | 99ms | 89ms | 816ms |

Process readiness still accounts for 627-663ms in the cold samples. These
changes remove local interaction blocking and improve residency, not upstream
initialization itself. They do not establish real-account/MCP latency.

Typecheck, build, 77 targeted unit tests and real Electron navigation acceptance
passed, including paused startup, copy/disclosure actions, unsent Enter, caret
handoff, rapid target drafts, failure recovery, identity and billing guards.

The serial TypeScript unit suite passed with `terminal-sessions.test.ts` excluded
because of its previously observed Windows process-tree failure; terminal
acceptance is not claimed here. The 15 CI policy/runner tests also passed.
The complete local Windows `sessions` acceptance group passed all 18 scripts
(`Desktop/test-results/ci-sessions.json`), covering launch consent, cancellation,
concurrency, navigation, branching, ordering, queues, model selection, peer
sessions, imports, movement and large-history continuation. The large-history
fixture opened a 61,761,405-byte source in 2,134ms and continued in 976ms without
paid model requests.

The local Windows `runtime` group also passed all 24 scripts after the timing
fixture was made to delay initial readiness by 1.6 seconds and await navigation
handoff before reloading. This reproduced the cloud reload race before the wait
was added. After synchronizing main, build, typecheck, timing and sidebar-search
acceptance passed again. The search fixture likewise reproduced a premature
session-ID assertion before awaiting the navigation gate; its cleanup now uses
the shared orderly fixture shutdown instead of hanging on quit review.

The unsigned Windows preview was built at
`D:\Desktop For Step Code\Desktop\release\session-navigation-interactive-20261024-preview`.
Its runtime reuses the preceding accepted preview, with all 1,224 staged files
verified identical and runtime pin, patched-source hashes and Node executable
checked. No upstream source was restaged or modified. Fresh renderer/main builds
are included. Packaged navigation and general Electron acceptance passed using
isolated profiles and offline fixtures. Installer metadata matches `latest.yml`;
the 147,260,007-byte installer's SHA256 is
`486c87cb45ae7ad6bd9acf8e584b23ffd414ac90bb4f1e92c15f7d6a7bb4238e`.
The desktop shortcut points to this preview. The running older preview and
other workstreams' packages were preserved.

These checks do not establish personal-account behavior, installer upgrade
lifecycle, macOS acceptance or replacement cloud CI results.

An isolated Windows Electron profile with eight native sessions, three rounds
each and an offline localhost model fixture measured the following milliseconds
on the same machine. Baseline is main `3d38532`; reports are
`Desktop/test-results/session-navigation-performance-{baseline,optimized-final}.json`.
No paid model requests or personal profile data were used.

| Scenario | Baseline Readable | New Readable | Baseline Ready | New Ready |
| --- | ---: | ---: | ---: | ---: |
| Cold 0 | 713 | 43 | 713 | 751 |
| Cold 1 | 673 | 16 | 673 | 745 |
| Cold 2 | 681 | 14 | 681 | 761 |
| Resident | 11 | 11 | 26 | 26 |
| Three rapid selections | 1384 | 93 | 1384 | 842 |

The first RPC response took about 588-606ms after spawning; the subsequent
`switch_session` took about 32ms. Removing that switch alone would not address
the dominant startup cost. Direct `--session` startup was investigated but not
enabled: upstream restores the header cwd, whereas moved sessions require
Desktop's cwd override. No upstream sources, runtime pin or recovery/trust
semantics were changed.

Cold transcript reading now uses the already-running management process, bounded
to 12 MiB of input and a 24 MiB serialized response. It uses upstream in-memory
migration, active-branch and compaction projection, followed by the existing
Desktop imported-history, entry-ID, timing and workflow projections. It never
opens a SessionManager, repairs a newline or rewrites history. Larger,
changing, unavailable or future-format files fall back to ordinary startup.
Only a catalogued Desktop session ID crosses the typed preload boundary; no
renderer-provided path or executable runtime state is accepted.

Previews contain transcript data and a content version, not permissions, model
activation or pending actions. They remain inert and cannot enable sending.
Navigation sequence and session identity guard their delivery. Authoritative
runtime snapshots replace, never append to, previews and retain the existing
live revision checks. The first cold preview now saves its reading anchor even
without a prior composer draft.

Cold preparation has two slots and only one latest queued target. Connected
resident snapshots bypass those slots without starting another runtime; slow
resident reads neither consume cold slots nor override a later selection.
A 60ms cancellable
window coalesces cold selections before spawning, accounting for the small
single-selection ready-time increase above. Already-started overtaken workers
finish without activation or force termination. Idle recycling runs after each
preparation settles and periodically even while obsolete startups remain.
Queued and in-flight navigation targets are reserved, and reservations are
rechecked after awaiting another disposal. Existing running-task, Goal and
Cron protection and idle-retention limits remain. After the latest
runtime commits, session commands can proceed while obsolete preparation
finishes, but account and shared-settings mutations remain locked.

Comparative timing is a registered local-only check, not a hardware-dependent
cloud timing budget. The regular CI navigation acceptance checks cold read-only
delivery, newer-history handoff, drafts and anchors, superseded startup, late
preview rejection, optional-preview failure and disconnected recovery.
Initial typecheck and production build passed. The initial serial protocol suite passed
735 tests with 13 platform skips; all 11 Windows CI-policy tests passed. Real
Electron navigation, session-move, account-routing and the 14-case Cron management
acceptance passed. The first full protocol run failed and hung in the unchanged
terminal-count fixture's process-tree cleanup; its five isolated tests and a
subsequent complete serial run passed. No terminal product code was changed.
The isolated staged runtime is 175.9 MiB on D:, shared dependencies are reused,
and no preview installer was created or previous package deleted.
These synthetic results do not reproduce or quantify the user's several-second
delay with their actual model discovery, MCP services and personal history.
No installer, first-install acceptance, paid-model acceptance or cloud CI is
claimed by this source-only change.

### Navigation Review Follow-Up

Four added regressions failed against the pre-fix implementation. After the
resident bypass and independent recycling fix, all 82 focused history,
navigation and runtime tests and all 15 CI policy/runner tests passed.
The expanded real Electron navigation acceptance passed two held cold startups
followed by a resident switch, repeated navigation with an obsolete startup
still held, bounded connected workers, late-startup isolation and the account
mutation lock. The existing preview, authoritative handoff, draft, anchor,
failure-recovery and dark/narrow/reduced-motion checks also passed.
Session-move and account-routing Electron acceptance passed again, including
domestic/global API and Plan identity, login cancellation, running-task guards
and denied Plan requests never falling back to API. All 14 Cron management
Electron cases also passed against the updated main process.

A fresh fixture timing run is recorded in
`Desktop/test-results/session-navigation-performance-review-fixed.json`.
Cold history was readable in 14-43ms and executable in 775-829ms; the resident
case measured 11ms/27ms, and the three-selection latest target measured
94ms/794ms. As above, this is synthetic local timing, not actual-account/MCP
acceptance or evidence that single cold startup became faster.

The new complete serial run executed 752 tests: 738 passed, 13 platform skips,
and one failure in the unchanged terminal-count fixture's process-tree cleanup.
Its isolated rerun passed four tests and reproduced that same cleanup failure.
Only fixture-host children verified under those test runners were stopped so
the runners could finish; no user terminals or terminal product code changed.
This follow-up therefore does not claim a fully green unit suite or release
readiness.

## Plugin, MCP And Skills Management (2026-10-23)

Management follows the upstream Web/Desktop MVP user-scope APIs, isolated under
Desktop-owned storage. The renderer receives bounded, redacted data through typed
IPC. Configuration changes do not silently reload sessions or stop Cron hosts.

The final serial Node 24.16.0 suite passed 686 tests with 13 platform skips and no
failures. Typecheck, production build, CI policy tests and upstream barrel lint
passed. Clean Windows patch replay and the macOS index patch/hash check passed;
the latter is not native macOS acceptance.

After final runtime staging, real isolated-profile Electron acceptance passed
local marketplace/plugin operations, Skill lifecycle and runtime command reload,
MCP configuration versus live connection state, explicit restart, command routing,
theme and narrow-window rendering. Uninstalling a plugin used by a resident MCP
is blocked before deleting files; disabling and restarting permits removal.
Standalone usage-worker acceptance also passed against the final bundle.

Plugin details, StepPage preparation and session commands now share
DisclosureChevron and useAnimatedDisclosure rather than default markers or a
separate CSS disclosure. Electron acceptance verifies both 240ms cubic directions,
inert collapsed bodies, keyboard activation and reduced-motion settling.
Typecheck and production build passed again after this alignment.

The DFSC Beta icon extension reads only bounded plugin-local PNG files from the
optional `step.plugin.json` icon field. All 12 management tests passed, including
install preservation, invalid/link/oversized paths and built-in placeholder
selection. Real Electron acceptance passed discovery/installed PNG decoding,
corrupt-image fallback and the existing management/disclosure regressions.
Typecheck and production build passed; this is not an upstream schema extension.

The shared SidebarTaskActions now presents equal-width New chat and Plugins
buttons above right-aligned, adjacent Schedules and Search icons. The plugin entry
opens Discover without sending a model prompt. Search expands leftward from its
fixed right-hand trigger using cubic easing; it remains a labeled, read-only
placeholder, not a working session filter. Electron acceptance checks navigation,
equal primary widths, paired icons, containment, the six-pixel inter-row gap, fixed trigger/list geometry, focus return
on Escape, inert hidden controls and reduced-motion behavior. Typecheck and
production build passed; screenshots include the real sidebar and expanded search.

These checks use deterministic local resources, not paid model requests or real
third-party login/publishing. No installer, first-install acceptance or cloud CI
result is established by this run. See `docs/CAPABILITIES.md` for scope.

Mainline integration retains session migration, quote annotations and shared
command presentation. Fresh Windows patch replay and runtime staging passed with
the combined import/plugin exports and source hashes. Migration, command dispatch
and composer-menu Electron regressions also passed against the combined source.
## API Balance Fixture Shutdown (2026-10-24)

After integrating main `985f372`, cloud run `39985959681` passes Windows
sessions/runtime but times out in `verify-account-balance.mjs`. Local repetition
with Node 24.16.0 reproduces a successful balance scenario followed by an
unanswered native quit review: `transitioning` is true while task, Goal and
Cron counts are zero. The direct Playwright close waits for that review.

The balance fixture now uses the existing orderly-shutdown helper, answers
updated review requests, logs each phase and applies a 30-second shutdown
deadline. It retains every balance assertion and checks successful launcher
exit and closed windows; it does not force application exit. A regression
checks existing and changed review requests. Five consecutive packaged balance
runs (both regions), the six shutdown regressions and real quit/Cron acceptance
pass locally. These are fixture-only changes; the replacement head still
requires cloud verification.

## Single-Conversation Project Movement (2026-10-23)

Saved top-level conversations can move from independent history into a registered
project, or between registered projects. A sidebar long-press drop opens a
destination-preselected confirmation; the session context menu opens the same
dialog with a project picker. Updated sorting still permits cross-project drops
without enabling manual same-group ordering. Cancel does not change association
or history. Project removal, whole-project relocation and same-group reordering
remain separate actions.

Movement preserves the session ID and native history file, storing the future
cwd in Desktop's existing per-session redirect metadata. The host prepares a
new cwd-bound transport and verifies its identity and `ask` permission tier
before saving the association. A failed preparation retains the original
association and source worker. Active movement retains the viewed conversation;
background movement preserves the viewed chat or draft. Existing project files,
changes and terminals are not transferred, and historical path references are
not rewritten. Full Access and project trust are not carried from the source.
Reopening or explicitly restarting redirected history starts gated.

Running, compacting, approval-waiting, queued-message, active-Goal and
structured running/queued background-agent workers cannot move. Live Cron hosts
are retained; only saved jobs actually associated with the moved session block
movement. Unrelated or unbound jobs in either project remain there and do not
block a cold conversation. Unreadable schedule/association state fails closed
with distinct host, associated-job and verification messages. This first version
does not offer an independent destination or filesystem movement.

Moved Windows transports use an optional session-scoped view of the original
shared Cron store, including after restart or provider refresh. Foreign/unbound
jobs are not adopted, dispatched, advanced or deleted by that transport. It can
still create and execute its own jobs; shared mutations preserve other records
and enforce the project-wide limit. This requires the additional reviewed
`desktop-session-cron-scope` runtime patch; the upstream commit is unchanged.
The frozen macOS runtime does not gain this patch.

The prepared runtime's loaded messages are also checked before saving the
redirect, so cold histories cannot bypass the background-agent guard. Regression
cases for both `running` and `queued` records reproduced the missing rejection
before the fix and pass afterward, preserving redirects, the viewed draft and
resident runtime count on rejection.

Source Electron acceptance uses an isolated Desktop profile and localhost
provider, never personal CLI credentials or a paid model. It covers cancellation,
dragging with updated sorting, menu confirmation, light/dark/narrow layouts,
Full Access reset, identical session/history identity, a real relative-path tool
write in the new cwd, busy/approval/queued-message/missing-directory rejection,
background movement, app relaunch, explicit runtime restart, unrelated live
destination hosts, unrelated cold-source tasks, new scoped-task creation/deletion
and related Cron guards. The unrelated original host remains registered and its
saved task bytes stay unchanged. Existing sidebar-order acceptance also
passes. The browser fixture uses the real dialog and drag hook but mocked
association updates; it is not runtime or installer evidence. No new installer,
cloud CI result or official-provider continuation is claimed here.

Typecheck and production build pass. The serial unit/protocol run passed 660
tests with 13 platform/dependency skips; the 15 CI policy/inventory tests also
passed. An initial concurrent full-suite run hit the existing terminal-count
fixture's process-tree cleanup timeout; that fixture passed independently and
in the subsequent serial full run. Terminal cleanup code was not changed.

The Cron-scope follow-up reproduced the former destination-wide rejection before
the fix. Its 49 upstream Cron tests, 98 focused Desktop tests and 15 CI policy
tests pass. The final serial Desktop suite passes 663 tests with 13 skips and no
failures. All patch pre/post-images match a replay from the pristine pinned Git
index. Source Electron movement, Cron management (8 cases) and real Cron RPC
(12 cases) acceptance pass with a separately rebuilt/staged Node 24.16.0 runtime.
This follow-up has not replaced the icon-corrected local installer.

The subsequent unsigned D: Windows preview includes the Cron-scope follow-up.
Packaged Electron movement, general app and Cron management acceptance pass,
alongside all 12 real Cron RPC cases pointed at the packaged runtime. Packaged
account routing passes CN/Global API and Plan switching, login cancellation,
busy-session protection and no fallback from denied Plan to API. The same source
routing acceptance also passed eight consecutive isolated runs. The executable
retains the matrix icon; all 105 built Desktop files and 1257 staged runtime files
match their packaged hashes. The desktop shortcut is backed up and updated;
the running old preview is left untouched. These are local fixture results,
not user, paid-provider, first-install or Release acceptance.

Cloud run `39951495926` passes the interface, sessions and macOS jobs. Its runtime
job completed every `then_run` functional assertion before hanging during teardown
and hitting the five-minute outer limit; the old log does not identify the
specific cleanup await. The fixture replaces forced `app.exit()` with the
existing orderly-shutdown helper and logs shutdown boundaries. Assertions and
deadlines remain unchanged. Three consecutive packaged `then_run` runs pass and
complete orderly shutdown, and all 15 CI runner/policy tests pass. The replacement
head still requires cloud verification.

Run `39953993378` again passes interface, sessions and macOS, but exposes the
same runtime teardown hang. Using CI's Node 24.16.0 locally reproduces a successful
launcher `exit` without ChildProcess `close`: Playwright waits for every inherited
pipe, including its additional stdio handles, before completing application
closure. The exact process retaining those handles is not identified.

The `then_run` fixture still requests orderly application shutdown. A narrowly
installed guard releases its controller-owned pipes only after successful
launcher exit and every application page has closed. It cannot turn a live or
failed process into success. The fixture also observes both application and
browser-context closure instead of depending solely on the controller's final
close-RPC reply; it explicitly checks successful exit, a closed context and no
remaining windows. Five regression tests cover both event orders,
nonzero exit, multiple windows and listener disposal. Native shell probes now run
asynchronously after Electron has closed, rather than blocking the browser
controller. Functional assertions and the outer five-minute deadline remain
unchanged; a separate 30-second shutdown deadline localizes future failures.
The complete serial unit/protocol suite passes 668 tests with 13 skips and no
failures, and typecheck passes. With CI's Node version and `CI=true`, five
consecutive source runs and five packaged runs complete every RPC/UI assertion,
orderly shutdown and native command probe. All 15 CI policy/runner tests pass.
These test-only changes do not alter the preview's bundled Desktop/runtime files;
the replacement head still requires cloud verification.

## Command Presentation And Dispatch (2026-10-23)

The command menu, composer and sent user messages now share semantic icons.
Inline commands after prose and newlines are marked without rewriting the
prompt; code, paths, links and unknown tokens stay ordinary text. Markdown
formatting and skill/template source icons are preserved.

Standalone Usage commands open the existing overview or Account settings, bare
Cron opens its existing manager, and Compact uses the dedicated RPC rather than
an ordinary prompt. Compact failure retains the draft; busy sessions do not
queue it as prose. Parameterized Cron commands retain upstream handling.
Prose mentions, attachments and quotes are not consumed as Desktop actions.

Focused parser/catalog/Markdown/trust/status tests, typecheck and production
build passed. Source Electron discovery and editing acceptance passed across
light, dark and narrow layouts. Dedicated dispatch acceptance covers Usage,
Cron, Compact success/failure and the running-session guard. It also protects
against reusing the decoration array consumed by ProseMirror during loading-only
renders.

The real pinned bundle passed read-only task, workflow, CLM, Cron, Goal and
Ultracode checks, Plan toggling, cancelled plugin/feedback dialogs and loopback
Init dispatch. No real model, account balance query, feedback upload or plugin
installation was used in those runtime checks. See [COMMANDS.md](COMMANDS.md)
for the full inventory and deferred mappings. No new installer or packaged
acceptance is claimed by this source verification.

## Migration CI Paths And Unavailable Projects (2026-10-23)

Windows sessions run `39900979276` reached the new grouping assertion with a
`RUNNER~1` temporary-path alias. The client correctly stores native real paths;
the fixture now canonicalizes its isolated profile before constructing and
comparing workspace paths, rather than weakening the grouping assertions.

A separate regression reproduced a saved copy whose original project directory
was deleted before duplicate-import grouping repair. The previous build returned
ENOENT from import-history queries and failed to finish orderly fixture shutdown.
Registration now skips unavailable saved directories without creating replacements
or rewriting the copy. The extended source Electron migration acceptance passes,
including subsequent journal reads and orderly shutdown. Cloud checks remain
required for the replacement head.

## Import Confirmation And Project Grouping (2026-10-23)

Import now confirms directory counts and an optional, default-on sidebar project
registration before starting. Cancel preserves selection and creates no copies
or projects. The host only registers saved imported/skipped results and reads
their bounded native headers, not foreign source text or entire transcripts.
Duplicate copies keep their saved cwd even if a later selection changes it.

Typecheck, production build and 17 focused import/history tests passed.
Source Electron acceptance passed confirmation cancellation, default grouping,
unchecked independent placement, existing project matches, relaunch persistence,
bulk import and explicit duplicate-copy grouping repair. The local fake-provider
continuation and large-text browser responsiveness checks also passed.
The browser fixture is available on port 5194; the prior port 5193 serves a
different checkout. This follow-up was source-only when first verified. CI repair
has since resumed, integrating main's model-refresh race fix without changing the
macOS runtime pin. Replacement cloud checks must validate the combined tree.

## Imported Large-History Responsiveness (2026-10-23)

A real imported conversation exposed two unbounded paths missed by the small
migration fixtures: the RPC decoder repeatedly rescanned the accumulated history,
and multi-megabyte historical text was eagerly parsed as Markdown. A synthetic
56 MiB frame reproduced a roughly 51-second main-thread stall. Fragment-based
decoding reduces that local test to roughly 0.23 seconds while retaining
per-record limits and split UTF-8 handling.

Oversized prose and tool inputs/results now use a bounded, plain-text section
viewer with full-content copying. Closed thinking bodies mount on first opening,
and transcript images use lazy decoding/loading. Imported active-path messages
already carry entry IDs, avoiding redundant full-content identity serialization.
No saved messages, images or model context were removed or rewritten.

`verify-import-performance.mjs` covers a three-million-character historical
payload, deferred thinking and section navigation. `verify-import-large-electron.mjs`
imports a synthetic 62 MB source, opens its actual native copy, expands and pages
the historical tool result, then continues via an isolated local provider. The
source Electron run opened in about 2.8 seconds and completed local continuation
in about 1.9 seconds. These are local observations, not production latency
guarantees. Official-provider prefill with image-heavy history remains separate;
no paid model or private conversation was used in these acceptance requests.
The unsigned D: preview also passed packaged migration and general Electron
acceptance; its synthetic large-history open/continuation measured about
2.6/2.1 seconds. Distribution and staged runtime hashes match the package.

## Summary Turn Alignment And CI Replay (2026-10-22)

The Summary activity dot now follows live conversation execution immediately;
it does not wait for the summary poll or rewrite canonical task progress.
Visible native Cron notices, including missed notices, start a Summary turn
just as they do in the transcript. Historical agents remain inspectable there;
registered queued/running background agents carry forward until settlement.
Late results retain their original dispatch ownership.

Fourteen Summary state tests and the browser regression cover these cases,
including repeated Cron, hidden/non-Cron notices, saved replay, Workflow records
and history expansion without repopulating Summary. The related 49-test run,
typecheck and production build passed.

CI replay now opens lazily mounted tool details before reading their status,
expands historical agent disclosures before inspecting their rows, waits for
the connected page before evaluating the bridge, and arms terminal width-frame
sampling before triggering transitions. The existing assertions are retained.
Local source Electron, hidden-message, clarification and real PowerShell terminal
acceptance passed. The local shared node-pty input was incomplete; generated
terminal resources were repaired from the version 1.1.0 npm archive after
verifying its SHA-512 against the lockfile, without changing shared dependencies.
Cloud and packaged acceptance are tracked separately from these source results.
Background-agent acceptance now addresses each original dispatch independently
of row order and opens settled history before inspecting it. Source and packaged
runs passed completion, failure, restart, interruption, follow-up and reload
checks with identical task descriptions.

## Transcript And Summary Follow-Up (2026-10-21)

The compact transcript now exposes singleton thinking/tool records through their
own disclosure, without another group header or indentation. Stable keyed members
retain manual expansion and output controls when siblings arrive; keyboard focus
moves to the remaining member when its group header disappears. Existing
approval/failure and dedicated-interaction boundaries are unchanged.

Thinking and ordinary tools share the native-details animation hook: 240ms cubic
height/opacity transitions in both directions, inert closed content and lazy
tool-output mounting. Disclosure arrows follow labels/timing before previews.
Thinking completion still folds the active thought, while settled history can
be reopened. Presets, custom defaults and historical reapplication are retained.

Summary adds activity and compact header counts, canonical task progress, and
structured Subagent/Workflow records opening existing read-only inspectors.
Parent streaming and successful dispatches do not imply running/completed tasks.
Unknown legacy records and failed refreshes remain unknown. Repository overview,
theme tokens, panel geometry and existing task completion animations remain.
The activity indicator settles to green only for nonempty, fully successful
task/agent records. Empty, pending, failed, stopped, skipped, unknown and stale
states are covered separately; checklist counts and the official MCP mark retain
the compact header and theme colors.
The agent list now keeps only the latest visible user/Goal turn and registered
live background work carried across turns. Earlier transcript agent calls fold
into one disclosure per response, retain inspector navigation and never
repopulate Summary when expanded. Ten focused state tests cover turn changes,
hidden reminders, late results, background completion and Workflow ownership.
The browser regression also checks history folding, lazy mounting and navigation.

Typecheck and production build passed. The final serialized suite passed 564
tests with 13 platform skips; all 15 CI-policy/runner tests passed.
Electron interface-preference, Summary runtime and Summary layout acceptance
passed, including real pinned task RPC, completion animations, session isolation,
repository navigation and nonmodal layout. The reused Windows runtime's
patched-source hashes match the current manifest; no runtime source was changed.

The new `verify-disclosure-summary.mjs` is registered in interface CI. Local
Playwright validation used installed Edge through its explicit channel override;
CI defaults to its installed Chromium. It passed singleton identity/focus,
member-local controls, keyboard and rapid toggles, intermediate closing frames,
canonical progress, agent-record navigation, zh/en, light/dark, 320/390px and
reduced-motion checks. Screenshots under `Desktop/test-results/` were inspected.
The first Summary/full-suite replay used an older staged runtime and failed the
existing Status-field assertion; replaying against the manifest-matching staged
runtime passed without modifying that assertion. No new installer, real-model
acceptance or cloud result is claimed; the running user package is unchanged.

## Model Selection Persistence (2026-10-22)

Explicit picker choices now persist only provider, model ID and display name in
Desktop's own preferences. New drafts and reused empty runtimes honor that choice;
passively reopening a conversation does not rewrite it. Existing conversations
restore the active branch's last model-change entry, with assistant metadata only
as a legacy fallback. Runtime configuration refresh no longer selects models[0]
when the previous model is absent. Missing selections remain named on new drafts
and creation/restoration fails explicitly rather than sending on another model.
Confirmed Cron recovery retains its separately reviewed model contract.

The management process also retains its last successful official discovery
catalog in memory, scoped by credential, endpoint and model configuration.
Unavailable discovery must not hide Step merely because custom models remain.
No built-in model list is fabricated; the cache does not survive process restart.
Failed or cancelled sign-in leaves the unchanged account's discovered catalog
intact; invalidation follows successful credential replacement. The discovery
fixture returns an explicit 503 during outages instead of abruptly destroying
pooled sockets across its recovery boundary.

Typecheck, build and 119 focused tests passed. Real Electron model-switch
acceptance covers orderly application restart, on-disk default identity,
independent old-session selection, cloning/branching, missing-model rejection
without a generation request, and explicit alternative selection. These are
isolated local fixtures, not live official-account or packaged acceptance.
The elapsed-time Electron fixture now configures its recorded model explicitly,
so missing-model protection is retained rather than bypassed. Its history,
reload, dark/light/narrow, ticking and freezing checks passed locally.
The review-fix replay passed typecheck, build, model-switch and account-routing
Electron checks. The full local protocol run reported 628 passes, 13 platform
skips and one existing terminal-host cleanup timeout (nine concurrent hosts,
three-second tree termination). Its unchanged terminal code is outside this
model fix; this run is not claimed as an all-green suite.
Follow-up provider-save coverage exposed a separate missing-model boundary:
disabling/removing the active provider must save successfully without selecting
an alternative. Explicit provider application now suspends only the affected
model-unavailable worker and retries that same identity on later configuration
application; unrelated transport/application errors still fail closed.
The focused suite now passes 120 tests, including disable/re-enable identity
recovery and rejection of unrelated refresh failures.
Real Electron custom-provider acceptance passed all three wire protocols,
keyed/keyless operation, deferred application, disable/re-enable with unchanged
session/model identity and no generation, removal and restart. The remaining
runtime checks after elapsed-time acceptance also passed locally, including
commands, then_run, workflow, Summary, Usage, background agents and StepPage.

## Cron Transcript Source Disclosure (2026-10-20)

Follow-up: source disclosure alone did not split response entries. The first
preview below still merged preceding assistant content with Cron output, losing
its independent footer. That package is not evidence of correct turn boundaries.
The fixture now puts both replies in the same production message list, rather
than mocking the preceding reply outside the renderer. Regression checks cover
separate settled footers, the previous footer during active Cron, repeated Cron,
reload, and Plan/Goal/workflow ownership. No scheduler behavior is changed.
The corrected source passed typecheck, production build, 113 related unit tests
(three additional platform-specific skips), 24 browser combinations and native
Electron saved-history replay. Both prior and Cron footers survive reload;
the prior footer also survives active Cron. Separate 8s/4s timings, file changes
and delivered output paths are covered. Light/dark separate-footer screenshots
are under `output/playwright/cron-turn-boundary-20261020` on D:.
The corrected Windows x64 preview is
`Desktop/release/cron-turn-boundary-20261020-preview` on D:. Its packaged
saved-history replay passed eight checks, Cron management passed eight cases,
project trust passed three cases and general Electron acceptance passed.
All 105 dist and 1,232 runtime files match the inputs byte for byte.
Installer/update metadata matches; installer SHA-256 is
`6c8f94a0904690477bc1bac4b4e5786f396e2f186de2b4082afaf556753d9a0f`.
The unsigned local preview remains version 0.5.1, not a public release.
The desktop shortcut was backed up, updated and read back. The running earlier
preview was not stopped; it still predates the boundary fix.

Visible `role=custom`, `customType=step-cron` records now render as a dedicated
source disclosure in the shared conversation renderer, including saved reading
and nested transcripts. Ordinary user/assistant text containing `[cron]` is not
reclassified. Normal deliveries and upstream `details.kind=missed` notices have
distinct labels; the latter preserve their original batched notice. Hidden
records stay hidden. All interface presets keep the source outside process/tool
groups. Copy projection and original message storage remain unchanged.

Details expose only supplied instruction, message timestamp, cron expression and
task ID. Ordinary upstream deliveries do not supply a planned fire time, so the
UI does not infer one. No scheduler, account route or task recovery changes.

Typecheck and production build passed. Five new projection tests and the related
conversation, grouping, event, navigation, interface, workflow, Plan and subagent
tests passed (81 total). `node scripts/verify-cron-transcript.mjs` passed 24
theme/preset/language/viewport combinations, pointer and keyboard disclosure,
snapshot-state retention, missed notices, reduced motion, forged-prefix/hidden
record checks and active/reloaded rendering without page errors. Screenshots
were inspected after replacing the static mock with the production renderer.

The follow-up local Windows x64 preview is
`Desktop/release/cron-transcript-20261020-preview` on D:. It includes current
main `61908a9` plus the local transcript changes. Packaged Electron acceptance
passed six native saved-Cron-message replay checks, eight Cron management cases,
three project-trust cases and the general Electron suite. All 105 dist and 1,232
runtime files match the build inputs byte for byte. Installer/update metadata
and SHA-256 were checked; the installer is unsigned and remains version 0.5.1,
not a public release. The desktop shortcut was backed up and updated with readback.

This is not paid-model or installer-upgrade acceptance. Existing user tasks,
accounts and the running old application were not modified or stopped. Cleanup
of five inactive preview directories was requested but blocked by local policy;
those directories remain. The active old package and v0.5.1 release archive
were preserved.

## StepPage Review Guards (2026-10-22)

The new StepPage setup controls and main/admin preparation path now run only on
Windows. Other platforms keep their pre-change legacy registration behavior.
Non-Windows native registration acceptance checks hidden controls and rejected
setup requests in addition to its original cases; it was not run on this
Windows host.

Startup disables matching Desktop-managed MCP declarations when an installed
file fails verification, without executing it, using it as a valid candidate,
or modifying unrelated custom transports. Repair does not silently re-enable
the service. Typecheck/build, 582 serialized tests (thirteen platform skips),
fifteen local CI policy/runner tests and eleven Windows Electron registration
launches passed. Extended real Electron preparation acceptance verified
corruption, protected relaunch, zero tools/no execution marker, and successful
repair with disable preserved. These checks used isolated profiles, not real
credentials or publishing. No review-follow-up package was generated.

## StepPage Preparation With Scheduled Cron (2026-10-21)

Preparation now uses a non-stopping idle check: a waiting Cron host is allowed,
but active tasks, queued messages, active Goals and mutations are still rejected.
Actual restarts and account changes keep their existing Cron protection.
StepPage restart rejection reaches localized feedback and survives readiness
polling instead of being swallowed or erased.

Typecheck/build, 580 serialized tests (thirteen platform skips) and fifteen local
CI policy/runner tests passed. Source and packaged Electron acceptance created
a scheduled job before explicit installation, verified that its host and job
were unchanged, checked persistent protected-restart feedback, and connected a
new independent session to thirteen StepPage tools. Disabled preparation,
restart/relaunch and general packaged Electron acceptance also passed.

The unsigned local preview is `steppage-cron-20261021-preview` in the shared D:
release directory (version 0.5.1, main `61908a9` plus local StepPage changes).
Installer SHA-256:
`1f5b5a24b71d94dffd0a94f528583b80bcb4a2ef7e21a07865aea14a78f67a3a`.
The audit matched 105 built files and 1,242 runtime files; update metadata matches
installer size/SHA-512. The desktop shortcut was updated with its previous value
backed up. No running user instance was stopped or personal profile altered.
Real login, publishing, installer execution and cloud CI are not established.
The same packaged executable passed eight registration groups (eleven launches)
and eight Cron management acceptance cases.

## StepPage Windows Explicit Preparation (2026-10-21)

Settings > Resources now offers StepPage installation/preparation and retry;
MCP settings link to that entry. The main process downloads only on explicit
action, verifies the pinned official artifact, checks syntax/version using
packaged Node, and installs atomically into Desktop-owned storage with a separate
StepPage HOME. No personal credentials are read/copied. Custom transports and
explicit disable are preserved. Failure categories are safe projections, and
preparation never automatically restarts a session or enables a disabled server.

Typecheck/build passed; the serialized suite passed 577 cases with thirteen
platform skips. The real Electron
preparation acceptance used a disposable fresh profile and the Settings button
to download from the official CDN. Exactly one service connected with thirteen
tools; disabling then preparing/restarting yielded zero tools, and application
relaunch retained disable and installed state. No model prompt, MCP tool call,
real login or webpage publishing was performed. This does not establish
installer execution, upgrade lifecycle or cloud CI results. Details and the
fail-closed mutable-CDN pin policy are in [StepPage](STEPPAGE.md).

The follow-up was packaged as unsigned Windows x64 preview
`steppage-prepare-20261021-preview` under the shared D: release directory, still
version 0.5.1 and based on main `61908a9` plus uncommitted StepPage changes.
Packaged explicit-download/13-tool/disable/relaunch acceptance, eight
registration groups (eleven launches) and general Electron acceptance passed.
The audit matched 105 built files and 1,242 runtime files, and verified installer
size/SHA-512 against update metadata. Installer SHA-256:
`b16a3a5c0bf9c8204e248c4d1d2626a321548fa1ba49e3a1af20daa6782bc95b`.
The primary desktop shortcut was updated with its prior version backed up.
No running user instance was stopped; real login and publishing remain untested.

## StepPage Identity And MCP Disable Compatibility (2026-10-20)

Desktop now reconciles the legacy `steppage` declaration to the upstream
`steppage__steppage` identity inside the existing admin settings lock. Complete
declarations survive migration. Managed-path repair preserves explicit disable,
and ownership checks require the known one-bundle launch shape rather than just
a matching runtime Node suffix. No upstream source or personal profile changed.

Typecheck/build passed, with 570 serialized unit/protocol tests passing and
thirteen platform skips. Eight Electron registration groups passed across eleven
launches; fifteen CI-policy/runner checks passed. Deterministic real-runtime
coverage includes plugin suppression, relocation, restart, missing/invalid bundle
failure and later recovery. The optional official-bundle check connected exactly
one server with thirteen tools, then disabled/restarted with zero and
re-enabled/restarted with thirteen.

Windows automatic first installation, real authentication, online publishing,
cloud CI and installer acceptance are not established by these checks. See
[StepPage compatibility](STEPPAGE.md) for the tested artifact, reproduction and
remaining issue #112 boundaries.

The Windows x64 local preview `steppage-mcp-20261020-preview` was then built
from main `61908a9` plus this uncommitted StepPage snapshot in a separate D:
worktree, excluding the parallel fader changes. Typecheck/build and the serialized
suite passed again (570 passed, thirteen skipped). All eight registration groups,
the general Electron acceptance and the official-bundle 13/0/13 check passed
against the packaged runtime. The audit matched 105 Desktop files and 1,242 runtime
files, including the new adapter, and verified the installer/update metadata.
The unsigned installer remains version 0.5.1, with SHA-256
`dd89f499fe4ec670ee616c286d1442abe7528f70fb85581cc3fbefe53b442440`.
The package lives under `D:\Desktop For Step Code\Desktop\release\steppage-mcp-20261020-preview`.
The primary desktop shortcut targets its unpacked executable; the previous
shortcut is backed up with the package. The running user application was not
stopped. This does not establish NSIS upgrade or real login/publishing acceptance.

## Cron Resume Rejection Follow-Up (2026-10-19)

An explicit negative RPC response now has a distinct error type. If the recovery
resume command is rejected before opening its gate, Desktop removes the gated
host so it cannot falsely occupy the project and prevent another reviewed
recovery. Successful resume keeps the host. Timeout and transport failures remain
uncertain: Desktop keeps the potentially activated host and never retries.

Focused recovery/transport tests passed 23 cases with three platform skips,
including a real JSONL child distinguishing negative replies from timeout and
disconnect. The full serialized suite passed 558 tests with thirteen platform
skips. Typecheck, production build and all eight Electron Cron management
acceptance groups passed. This correction has not been packaged.

## Cron Creation Persistence Follow-Up (2026-10-19)

Creation now defaults to durable storage and preserves that choice when selecting
a host. Recurrence remains independent. An untrusted host blocks durable submit
and explains explicit `/trust` approval and a manual restart; it never selects
temporary storage as a fallback. Temporary creation and details disclose loss on
host exit or application update.

The appended Desktop system policy asks models to prefer explicit durable jobs
for ongoing/cross-restart requests, stop on trust failure rather than downgrade,
and treat existence checks as read-only rather than permission to recreate.
This is model guidance, not deterministic enforcement of natural-language intent.
No upstream scheduler, schema, trust defaults or temporary-job recovery changed.

Typecheck, production build and 86 focused session/Cron/trust tests passed.
The complete serialized suite passed 555 tests with 13 platform skips.
Real Electron management acceptance passed eight groups, retaining the native
create/delete, exit/relaunch, offline discovery and explicit recovery sequence.
The new group checks untrusted submission blocking, storage choice preservation,
no task creation/fallback and no model calls; creation also checks single versus
recurring independence. Light/dark and narrow screenshots were inspected.
This follow-up has not been packaged; the existing preview shortcut is unchanged.

## Cron Recovery Latest Main Integration (2026-10-19)

PR #140 integrates main `2eff623`, preserving Usage III and Status. All six
Windows patches applied together to a new pinned-source checkout; every manifest
post-image hash matched. The recovery patch import context and combined RPC hash
were updated for Status, without changing the frozen macOS runtime baseline.
Node v24.16.0 staging, frozen-lockfile installation, typecheck and production build
passed. The serialized suite passed 555 tests with 13 platform skips; all 15
CI-policy tests and all 12 native Cron RPC cases passed. Full Windows Electron
acceptance and composer-editing acceptance passed.

macOS run 39127296032 failed waiting for `fill('')` to clear the controlled
ProseMirror editor; its screenshot still showed the previous draft. The startup
fixture now clears via native select-all and Backspace editor transactions, and
checks both editor value and controlled empty state before typing again. This
sequence also runs on Windows and passed locally. The macOS cloud rerun remains
required; this Windows replay does not establish the original platform's result.

Run 39147045392 passed that startup check and the file-preview fixture, then
exposed an undo-fixture ordering dependency. It modifies a file externally after
the turn ends, but expected an already-mounted status component to notice without
a file-watch event. The fixture now explicitly reloads before testing that
conflict, as its later external-edit scenario already does. Production undo and
its conflict checks are unchanged.

## Cron Manual Recovery Beta (2026-10-18, Local Development)

Issue #138 adds Desktop-side associations and explicit Windows project recovery
on top of merged #137. The upstream task schema, scheduler and expiry remain
unchanged. All six Windows patches applied together to a pristine pinned checkout
and passed pre/post-image checks. Runtime staging with Node v24.16.0, typecheck
and the production Desktop build passed.

The native RPC suite passed twelve cases, including ordinary due delivery and
startup missed notices blocked while recovery is gated, released only by explicit
RPC, rejected repeated release, and Ask without rewriting shared permission
defaults. Both management-created and live native tool-created associations were
verified independently of the upstream task file.

The real Electron management suite passed seven groups: baseline management,
read-only offline discovery, association persistence, review/cancel with no host
or model, changed-task consent rejection and token consumption, then one-host
recovery into the selected saved session with Ask and unchanged defaults. All
management/review operations made zero model calls. Dark/light/narrow screenshots,
cubic disclosure transitions and reduced-motion behavior were checked.

The serialized unit/protocol suite passed 534 cases with 13 platform skips.
After adding the post-start loaded-task guard, the focused recovery, management
and staging subset passed 24 cases. All 15 CI policy/runner tests passed locally.
The post-start guard allows native time advancement/removal but rejects new or
changed instructions before release.

No installer, shortcut update or public release was produced in this phase.
No real account, user task, trust store or active user application was changed.
These local deterministic tests do not qualify real billing, installer upgrade,
sleep/reboot execution, automatic startup recovery or crash exactly-once delivery.

## Status With Latest Main Preview (2026-10-19)

Windows preview source `4a1d7a9` integrates latest fetched main `ad39000`
(Usage III, PR #141) with Status PR #139 and its three review fixes.
Both Status diagnostics/tabs and Usage display-unit controls are retained.
Frozen-lockfile installation, typecheck, production build and runtime staging
passed. The complete serialized suite passed 542 tests with thirteen platform
skips and no failures.

The local unsigned x64 package is
`D:\Desktop For Step Code\Desktop\release\status-main-20261019-preview`.
It retains version 0.5.1; this is not a new public release. The runtime remains
pinned to `b5dbed938d9ae589397cf522dcf2ff89ecf4c494` with Node 24.16.0 and the
verified Windows patch set. Package audit matched all 105 Desktop build files
and 1215 runtime files, plus the native terminal backend and runtime adapter.
Installer SHA-256 is
`62c7e79fdb76193c413d1b10d692adfcca2010f0dcf1bbc9653f17f618a86e6c`;
its update metadata matches. Resource/source identities and checksums are
recorded beside the installer.

Seven packaged Electron acceptance scripts passed: general startup/RPC,
Context/Status inspector (including live approval, actual Plan mode and separate
queues), real runtime Summary, native Usage overview, Usage chart interactions,
composer menu and composer editing. Tests use isolated profiles and local
fixtures, not the user's live account or billing. Screenshots/logs are retained
under the preview's `acceptance` directory.

The ordinary Desktop shortcut was backed up in the preview and retargeted to
its verified unpacked executable, with empty arguments and matching working
directory/icon. Other shortcuts, running user processes and old packages were
preserved. Existing running windows remain on the previous executable until
the user exits and relaunches. Real-account acceptance, installer lifecycle
and cloud CI for this new integration are not inferred from these local tests.

## Desktop Session Status (2026-10-18)

The Status/Context inspector and standalone local `/status` command passed
typecheck, production build and the complete serialized Desktop protocol suite
(503 passed, thirteen platform skips). The account projection tests cover all
four official login profiles, missing credentials, unknown profiles and a
strict field allowlist; no account service is involved.

`verify-context-panel.mjs` passed with an isolated Electron profile and IPC
fixture. Added assertions cover Status opening during a running task without
prompt submission or account requests, next-turn model separation, tab keyboard
navigation and draft viewing without worker creation. Existing Context checks
remain in place. `verify-session-status-view.mjs` passed for light/dark,
1100/375px viewports, English, reduced motion, draft, offline, custom provider
and API views, default-collapsed details and diagnostic failure states.
Screenshots are under `Desktop/test-results/session-status-*`.

The real pinned-runtime status test and `verify-summary-runtime.mjs` passed,
including the Electron main/preload/RPC path. Checks cover actual Plan mode,
project trust, loaded instruction paths, sanitized endpoint, runtime-reported
version/source and manifest-provided commit/Node identity. Opening Status makes
no model request, changes no session messages and exposes no instruction content
or credentials. The source build reports 0.1.0 with a fallback source; the UI
labels that source default separately from the actual pinned commit instead of
claiming an official v0.1.5 runtime version. Full upstream `pnpm run check`
passed without formatter changes.

These are deterministic local checks, not real-account or packaged acceptance.
No installer or public release was produced for this change.

After integrating main `f23df66` (Cron PR #137), typecheck, production build and
the complete serialized Desktop suite passed again: 529 passed, thirteen platform
skips, zero failures. The merged command catalog retains both local Status and
project trust entries. All five Windows patches apply in sequence to a pristine
pinned index, with every resulting normalized source hash matching the manifest.
The first integration check reused the staged Status runtime. After staging the
integrated Cron/Status runtime with Node 24.16.0, all twenty runtime-group
acceptance scripts passed locally (the Summary check was rerun after correcting
its frame-sampling deadline). The composer menu, Context inspector and turn undo
checks also passed. The menu check covers a stationary pointer not overriding
keyboard selection when search results change. Cron recycling waits for pending
statistics reads, and multi-turn undo fixtures wait for actual turn completion.
Summary entrance checks still require intermediate frames and cubic easing,
but wait for a recorded settled frame rather than a fixed sleep. Fifteen CI
policy/runner tests and typecheck passed. Cloud macOS qualification and local
installer/real-account acceptance are not inferred from these Windows checks.

The three Status review regressions are covered by the real renderer/IPC
fixture: approval arrival, answer and expiry update the visible state without a
snapshot refresh; fresh collaboration diagnostics override contradictory launch
state and refresh after enter/exit Plan tools; Desktop FIFO and runtime queue
counts remain separate, preserving unknown versus zero and hiding message
contents. Drafts retain launch-only semantics. Typecheck, build, the complete
529-pass suite, Context inspector, themed/narrow Status fixture and real Summary
runtime acceptance passed again. The composer editing fixture now checks the
controlled value after each native typed character and reports actual value,
focus and selection on failure; its deletion/undo/redo coverage is unchanged.

## Usage III Local Overview (2026-10-18, Local Development)

The production main view now reads Desktop-owned session records through a
typed preload method, `usageOverview`. Neither the renderer nor the dashboard
receives session paths, message content, credentials or account identifiers.
Opening or refreshing statistics makes no model or cloud-statistics request.
The community client does not store statistics with an account in the cloud or
synchronize them across devices; website billing records are not included.

The Windows v0.1.5 runtime pin is unchanged. Its native `scanUsageOverview`
owns bounded inventory, parsing, incremental cache and usage-lineage dedup.
The Desktop adapter reads the matching complete private cache-v1 projection
for provider/model/hour dimensions, mirroring native origin resolution. Every
day must reconcile with the public native total. Missing, incompatible or
inconsistent detail falls back to native totals marked as unclassified instead
of fabricating a distribution. Unknown-source tokens appear only under All.
Reasoning/skill-activity coverage warnings do not imply missing Token data.
Cache hit rate is cache reads divided by complete input, including cache writes.

Conversation counts are unique main sessions, not daily counts added together.
Recorded child, branch, compaction and CLM tokens are included subject to the
native coverage limits. Estimates use only Desktop's persisted request-time
billing sidecars, deduplicate copied response identities, and keep Plan Credit,
domestic API currency and overseas API currency separate. Missing history
remains unavailable; the current login never reprices historical requests.

Typecheck and production build passed. The serialized unit/protocol suite passed
528 tests with 13 platform skips; all 15 CI policy/runner checks passed. Native
fresh/cache tests cover branch-origin deduplication, children, CLM and unknown
maintenance. Isolated-profile Electron acceptance covers actual session-file
and billing-sidecar data through IPC, source filtering, cache-write accounting,
chart cards, main-window navigation, retained drafts, Settings/Cron transitions,
390px layout and unchanged session-file contents. These checks do not establish
official billing accuracy or cloud-history coverage.

The real-data Windows x64 package is
`D:\Desktop For Step Code\Desktop\release\usage-real-local-20261018-preview`.
Its 151483161-byte installer has SHA-256
`0a983042b41c8fbdf142c472ae4dc51fe67a73112697fb04bed05b46f9e4166c`;
update metadata matches. Packaged real-data and chart-card acceptance passed,
as did 23 palette/accent cascade checks. The build reuses the previously
verified staged v0.1.5 runtime unchanged and refreshes only the Desktop admin
adapters; all 1203 staged upstream files were hash-compared with the prior
package. This is a local unsigned package, not a published release.

### Date Ranges and Token Display Units (2026-10-18)

Trend filtering supports inclusive local-calendar start/end dates and an exact
range total that follows the selected provider source. The shared single-button
unit control cycles exact/K/M/B without changing persisted usage or billing.
Context-panel totals crossfade between units over 180ms with cubic easing;
reduced motion removes the effect. Missing totals remain unavailable.

Typecheck and production build passed. The serialized suite passed 533 tests
with 13 platform skips (546 total). Packaged real-data, chart-card/date-range,
context-panel/unit/crossfade and 23 palette/accent checks passed. Installer
metadata, current build assets and all 1213 staged runtime files were checked.
The unchanged v0.1.5 runtime uses Node 24.16.0; no sample page is packaged.
The local unsigned Windows x64 package is
`D:\Desktop For Step Code\Desktop\release\usage-range-units-20261018-preview`.
The 151481525-byte installer has SHA-256
`b5abaea2f4da9be3b25154af66045e679d58e623e638de5db7d38211a016225f`.
This does not publish a Release or establish real-provider billing accuracy.

### Usage Review Follow-Up (2026-10-18)

The selected UI language now reaches the overview, daily analysis, custom date
picker, chart data cards and token-unit control, including loading, error,
empty and partial-coverage copy and accessibility labels. Dates, months,
weekdays and numeric formatting follow the selected locale; stored date keys,
model identities and billing totals are unchanged.

The Usage RPC now has an explicit 60-second timeout around the native scan,
cache projection and response transport. The native scan retains its 28-second
deadline; the global RPC default remains 30 seconds. A regression guard checks
the separate deadlines and bounded post-scan headroom.

Typecheck, production build and all 15 CI policy/runner tests passed. The
serialized unit/protocol suite passed 535 tests with 13 platform skips.
Native fresh/cache acceptance and isolated-profile Electron chart acceptance
passed, including persisted English preferences, date validation, chart cards,
source filters, display units and narrow layouts. Browser fixture checks also
covered English empty/loading/retry/partial states. No new installer was built
and the user's running packaged application was not changed.

## Cron With Latest Main Preview (2026-10-18)

Local package source `891fbc4` integrates main `28cfd9e`, including Usage II and
the Windows v0.1.5 runtime. The runtime is pinned to
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494` with the two Cron patches checked by the
Windows manifest; Node is `v24.16.0`. Both patch application from pristine source
and pre/post source hashes passed. The macOS baseline remains unchanged.

Frozen-lockfile installation, typecheck and production build passed. The complete
serialized unit/protocol suite passed 522 cases with 13 platform skips and no
failures; all 15 CI policy/runner cases passed. The native Cron suite passed ten
cases. Source Electron Cron management and project-trust suites passed, as did
the v0.1.5 native/RPC/UI `then_run` regression.

The Windows x64 preview is in
`D:\Desktop For Step Code\Desktop\release\cron-main-v015-20261018-preview`.
Installer `Desktop.for.Step.Code.Setup.0.5.1.exe` is 157557943 bytes with SHA-256
`d2057800d47615fbc61643e6e17f92bacaca725345ebc5874af52213ee067b4e`.
Update metadata matches the installer. The package audit compared 1229 runtime
files with the staged source, verified the Node hash, native terminal backend,
runtime adapter and asar package version. Packaged Cron management (four groups)
and project trust (three groups) passed using isolated local profiles and zero
model calls for management.
The packaged general Electron startup/RPC acceptance also passed. The normal
desktop shortcut was backed up inside the preview directory and read back after
being retargeted to its verified `win-unpacked` executable with empty arguments.

This is a local unsigned preview, not a new public release. Actual-account Cron
execution, user-visible billing, installer upgrade behavior, sleep/reboot
recovery and the remaining Desktop Beta features are not qualified by these
tests. Existing user processes and historical packages are not stopped or removed.

## Cron Host Lifecycle And Explicit Trust (2026-10-18, Local Development)

Issue #134 started with a Desktop-only scheduling observer on the previous
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8` pin. The Windows preview now integrates
main `28cfd9e` and its v0.1.5 pin `b5dbed938d9ae589397cf522dcf2ff89ecf4c494`;
the same two Cron patches are hash-checked by the Windows manifest.
The separate Cron patch preserves native storage, project sharing, delivery,
jitter and expiry. Main-process snapshots contain scheduling metadata only.
Resident hosts with jobs or unavailable state are excluded from idle/count
recycling. Native consumption, deletion and expiry release that protection.
Account/configuration replacement and explicit host-stopping operations reject
scheduled work rather than silently discarding session jobs or changing billing.
Ordinary idle chat and compaction are not blocked just by scheduled jobs.

Frozen-lockfile installation, typecheck, runtime staging and the production
Desktop build passed. The serialized unit/protocol suite passed 487 tests with
13 platform-specific skips and no failures. All 13 CI policy/runner tests passed.
The integration patches reverse-check against the isolated pinned source.

The new `verify-cron-runtime.mjs` is registered in the Windows runtime CI group.
Ten real staged JSONL RPC/session-pool cases passed: native management without
model calls or trust bypass, temporary and durable
host retention followed by one-shot delivery/release, native deletion,
explicit saved-session reopen, seven-day expiry, storage-lock failure/recovery,
untrusted durable-create rejection despite Full Access, and explicit native
trust save with restart-gated durable creation. These use isolated
profiles, controlled child clocks and a loopback-only deterministic model.
Unchanged snapshots do not flood RPC, and scheduler JSON never reaches renderer
events. Electron concurrency, account-routing and permission-tier regressions
also passed with their isolated fixtures.

The explicit `/trust` entry uses the existing approval drawer with persistent
scope wording, cancel and review-later actions. Only a confirmed request calls
the native ProjectTrustStore in the Desktop profile. It does not invoke a model,
enable Full Access, hot-load project resources or implicitly restart hosts.
Its new Windows CI acceptance exercises the actual Electron composer, IPC and
admin process, including native trust persistence and zero model calls.
Dark/light, minimum-width and expanded screenshots were inspected. Unit tests
also reject changed directory junctions and stale runtime approvals; expired,
cancelled and disconnected approvals do not save a trust decision.
The entry intentionally exposes only the native trust-current-folder subset,
not parent-folder, session-only or revocation choices.

The basic management UI now uses the narrow preload bridge and native tools,
not a separate scheduler. `verify-cron-management.mjs` is registered in Windows
runtime CI; its four real Electron cases cover no implicit host creation, native
durable creation without chat mutation, detail/delete/cancel, and read-only
offline discovery after relaunch. Management invokes no model. Dark/light and
narrow screenshots were inspected. Eight management unit cases cover bounded
projection, project deduplication, offline records, mutation locks and no retries
after ambiguous failures. The current serialized unit/protocol suite passes
495 tests with 13 platform skips. All five patches apply together to pristine
pinned source. The layout-only fixture remains a mock preview, separate from
these real-bridge checks.

No installer or public release was produced. No real account, user task or
trust store was changed. This does not establish sleep/reboot recovery, original
chat ownership, crash exactly-once delivery or real billing. Pause/edit,
auto-recovery and a persistent execution ledger remain unimplemented; the
overall TODO stays unchecked pending packaged acceptance.
See [Cron scope and remaining phases](CRON.md).

## Integrated Windows Preview with Usage II (2026-10-18)

Windows preview source `2066af57c83367248c004ced01e625fcc0cced9a` merges
main `d91a9e09494cf86bba7f33e01bf3860100145ce8`, including PR #135 Usage II,
into this upstream-v0.1.5 branch. Frozen-lockfile installation, typecheck,
production build and runtime staging passed. The integrated Desktop tests
passed 496 cases with thirteen platform skips; thirteen CI policy/runner tests
also passed.

Output is `D:\Desktop For Step Code\Desktop\release\upstream-v015-main-20261018-preview`.
The NSIS x64 installer remains local version 0.5.1, not a newly published release.
Installer size is 158,101,485 bytes; SHA-256 is
`8be69fac72462d60906097a2a1af88a09edf3c685c3a43ea408c28a6353e4de4`.
Authenticode reports NotSigned. SHA256SUMS and update metadata were verified.
The package/staging audit checked 1,324 files, including the full runtime,
Node, Desktop bundles, terminal native backend and file-opening helpers.
The asar root contains only dist, node_modules and package.json.

Eleven packaged Electron checks passed: general startup/RPC, then_run,
Workflow UI, real Workflow RPC recovery, account settings, allowance, context
panel with Usage II estimates, permission tiers, terminal, Plan review and
message ordering. These use isolated profiles and deterministic providers,
not paid-model or installation/upgrade qualification.

The additional message-order check reproduced the prior cloud timeout:
the new runtime had already reached revision 12 while the fixture injected
revision 10, which was correctly rejected as stale. The fixture now captures
current session state and derives its synthetic revisions from that baseline;
all overlap, legitimate duplicate delta, stale snapshot and history reset
assertions remain intact and passed twice against this same package. Only
the acceptance script changed after packaging, not application code.

The normal desktop shortcut now points to this verified unpacked executable,
with empty arguments and its matching working directory. The prior shortcut
was backed up under ignored test-results. Existing user processes were not
stopped, and prior packages were inventoried without deletion. The new output
totals approximately 720.3 MiB. PR CI needs a fresh run on the integrated
branch; prior cloud failures are not reclassified as passed by these local
checks. No public release, real-account acceptance or macOS qualification
is claimed.

## Windows then_run Approval and Verification (2026-10-18)

Fused `write_file` / `edit_file` approvals reuse the existing drawer. The
multiline upstream reason is accepted only for recognized file-tool reasons,
and the exact current tool call supplies the redacted verification command.
The command appears before file content, including in the compact drawer;
approval authorizes both operations. English/light/narrow layouts were
visually checked, alongside expansion and denial.

Structured `details.thenRun` drives verification failure, timeout and incomplete
labels without changing a successful file mutation into a runtime error.
Failed checks stay outside successful compact tool groups. An interrupted
fused operation without a structured outcome is shown as incomplete, not as
proof that the file write failed or succeeded. Reload preserves those labels.

The pinned-runtime Electron/RPC fixture passed approval before either operation,
denial preventing both, routine automatic approval, dangerous-command gating,
acknowledged Full Access, unchanged-content verification, edit failure skipping
verification, nonzero exit, cancellation and history reload. Its separate native
probe passed explicit Git Bash, initial-workspace cwd for nested files, stderr,
exit codes, output caps/full logs without rerunning the command, and a missing
explicit shell path without fallback. Timeout parity uses a 250 ms injected
host context for both tools; it does not change the product's default timeout.

The stronger gated cancellation probe exposed a Windows/MSYS parent-chain gap:
`taskkill /T` alone left a nested Bash alive after stop returned. The Windows
shell path now captures this live Git Bash invocation's MSYS descendants before
terminating the exact Windows PIDs and waits for cleanup to exit. Discovery uses
the selected Git installation and trusted Windows PowerShell; failures retain
ordinary Windows-tree cleanup rather than guessing unrelated ownership. Tests
cover missing roots and malformed tables. Real gated checks verify no late
write after stop and that a simultaneous independent shell still completes.
This is not containment of arbitrary deliberately escaped processes.

Desktop typecheck/build passed, with 480 unit/protocol tests passing and eight
platform skips. Six focused upstream test files passed 112 tests with four
platform skips; the full upstream repository check and thirteen CI
policy/runner tests passed. The guarded Windows patch clean-index replay passed
all baseline, patch and patched-source hashes. The new acceptance and focused
process-tree tests are registered in Windows CI; cloud execution is separate.
Existing permission-drawer, permission-tier, session-concurrency,
interface-preferences and Windows-command Electron regressions also passed
against the final staged runtime.

Screenshots are `Desktop/test-results/then-run-{approval,approval-light-en-narrow,results}.png`.
All fixture profiles, workspaces and command logs stay in the ignored D: test
directory. No installer, shortcut change, paid-model run or macOS qualification
is included.

## Workflow Failure Information (2026-10-18)

The Desktop projection now accepts structured node errors, rate-limit retry
progress/counts, exhaustion, callback failures and cache-hit totals. Final
failure lists merge into compatible run/start snapshots instead of replacing
successful nodes; sparse failed nodes retain known labels and tasks.
Authoritative completion totals do not depend on a failures-only node list.
Callbacks remain separate from agent counts. Terminal and idle history clear
active retry indicators, and successful finals clear stale callback failures.

Error fields use bounded allowlists and existing credential redaction. Callback
source labels reject filesystem paths and executable bodies. Projection limits
remain 1,000 nodes, with at most 100 callback records and 4,000 characters per
error message. State/history tests cover missing progress files, duplicate
persisted events, identity mismatch, malformed fields, truncation and redaction.

Electron UI acceptance passed active retries, recovery, exhaustion, separate
collapsed callback details, node error details, cache reuse, reload, Chinese and
English, light/dark themes and narrow layouts. Screenshots were visually checked.
Real Electron/RPC acceptance with the pinned runtime and local HTTP/SSE fixture
passed structured HTTP 400 errors across reload, real HTTP 429 recovery with one
recorded retry, callback failure persistence without fake agents, selective
resume and prior stop/crash recovery cases.

No installer, paid-model run, cloud CI or macOS qualification is claimed.
This completes failure-information mapping for the reviewed v0.1.5 Workflow
contract; ordinary Subagent execution and its existing transcript stay separate.
Desktop typecheck/build passed; the final serialized unit/protocol run passed
476 of 484 tests, with eight platform-specific skips and no failures. All
thirteen CI policy/runner tests passed. No new installer artifacts were produced.

## Workflow / Subagent Stability (2026-10-18)

Seven upstream Workflow/Subagent test files passed 140 tests. Four new
cross-tool cases saturate a two-slot admission pool with Workflow or ordinary
parallel subagents first, then verify bounded sharing and cancellation of the
queued tool without disturbing the admitted tool. Subagent runners must wait
for child exit. This pool belongs to one parent process, not all Desktop
session processes globally.

The five previously failing Workflow fixtures now run on Windows: directory
junctions exercise realpath escape checks without requiring file-symlink
privileges, and progress-write recovery asserts structured platform error
codes. No escape/recovery assertion is skipped. These test-only changes are
included in the guarded Windows patch and the Workflow suite is registered in
Windows CI; no macOS patch or production scheduling algorithm changed.

Real Electron/RPC acceptance passed stop/drain/resume, forced process exit and
explicit recovery, partial failure followed by history reload and selective
re-execution, HTTP 400 prose mentioning 429 without congestion classification,
and actual HTTP 429 retry/recovery. Resume expectations now follow upstream
content-addressed replay: unchanged calls that did not touch the environment
remain cached, while changed calls rerun. Upstream tests also cover writes
invalidating environment-dependent results. Separate real RPC/SSE session
concurrency acceptance passed targeted abort, approvals and recycling isolation.
The full upstream repository check and thirteen CI policy/runner tests passed.
This is local deterministic transport evidence, not cloud CI, real provider
load testing or package qualification. Failure-detail adaptation is verified
separately in the section above.

## Windows v0.1.5 Runtime Migration (2026-10-17)

Development Windows runtime now pins Step Code
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494`, using the reviewed patch manifest
in `patches/v015/`. Frozen macOS keeps `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`
and the original patch set. Both patch sets were replayed on clean checkouts;
Windows additionally checks all patched source hashes after application.

Frozen dependency installation, offline upstream build, Desktop typecheck,
production build, and runtime staging passed. Twelve focused upstream test
files passed 288 tests, covering Plan, shell discovery, Ultracode, command
parity, usage lifecycle and child shutdown. Desktop unit/protocol tests passed
470 of 478 cases, with eight platform-specific skips and no failures; all
13 CI policy/runner tests passed. Five additional upstream automatic CLM
test files passed 97 tests. The independent worker check
copied the built bundle out of the checkout and passed totals, cached scans
and cancellation under the staged Node runtime.

Isolated Electron/RPC acceptance passed Plan review and exact hash metadata,
expiry/reentry, clarification, unchanged-source branching and inline retry,
auth vault, CN/Global Plan/API routing, allowance, balance, summary, chain
success/failure/cancellation, Windows commands and permission tiers.
An eight-round independent RPC probe also passed after reproducing and fixing
an unhandled Windows temporary-directory cleanup rejection.

Review follow-up accepts the new Workflow `stopping` and `partial_failed`
states. Stopping stays active until child shutdown finishes and becomes unknown
in inactive history without a final result. Partial failure retains final time,
usage, summary counts and known node outcomes, including after history reload.
State/history regression tests and Electron Workflow UI acceptance passed;
screenshots cover the narrow stopping and reopened partial-failure views.

The initial wider Workflow run exposed five Windows fixture failures; the
2026-10-18 stability follow-up above resolves and rechecks that group.
The wider usage test file still has an unadapted symlink fixture outside this
specialty. The later failure-detail follow-up is recorded separately above.
No installer, native macOS run, cloud CI or real paid-model acceptance was
performed for this change.
The full upstream `pnpm run check` passed, including formatting, type checks
and repository guards. This does not mean the complete upstream test suite
passed; the remaining usage fixture limitation above is recorded separately.

## v0.5.1 Targeted Candidate (2026-10-17)

Usage PR #129 is merged. The release-preparation candidate was built from
clean commit `c26071a4c1d7587c31886e2cc9db673114fb45b1`, with version 0.5.1.
The fixed Step Code commit and Desktop patches are unchanged. Frozen-lockfile
installation, typecheck, 455 serialized unit/protocol tests, production build
and twelve CI policy/runner tests passed.

The NSIS candidate is in
`D:\Desktop For Step Code\Desktop\release\v0.5.1-candidate-20261017`.
Installer size is 151551418 bytes; SHA-256 is
`53f4a799fbe20c79c1eca36773ee0b5b9f11a8fe91172e9bf266264bd5193b13`.
Authenticode is NotSigned. All 98 Desktop files and 1,157 runtime files match
their staged sources, with additional adapter/helper/license checks.
Installer metadata size, version and SHA-512 match; source and metadata
evidence plus SHA256SUMS are retained alongside the package.

The same packaged executable passed six isolated acceptance scripts:
account routing, Plan allowance, API balance, auth vault, account settings
and app updates. Separate update-UI and native-download fixtures passed
confirmation/busy guards, parsing, streaming, hashing, invalid metadata,
cancellation and retry without executing any installer. These controlled
results do not establish official billing, real-account acceptance,
v0.5.0 installation migration or production in-app upgrade. Those remain
explicit release gates in the v0.5.1 preparation document.

The maintainer subsequently confirmed that real Plan/API switching works in
both directions and billing does not cross modes. This is recorded as manual
acceptance of account switching, not an independent billing audit or proof
of every region, quota-refresh action or installation migration. PR #130 at
`27122dd48af452c13ac3f1ee14f03316ca8d19ee` passed all three Windows groups
and the final CI gate in run `39025122001`; later documentation commits
have their own CI status.

After receiving the explicit v0.5.0-to-v0.5.1 overwrite-install and restart
checklist, the maintainer confirmed no issues. Installation migration with
account, settings and history retention is therefore recorded as manually
accepted. This does not establish the production in-app download/install
path or unspecified Windows-version coverage.

## Usage Account Allowance Bridge (2026-10-17)

The account page now queries the schema-1 personal Plan allowance endpoint
through a narrow preload IPC and a main-process service using the application's
already-loaded Desktop credentials. Renderer input cannot choose an endpoint
or supply a key. This does not change the upstream runtime pin.

The official plan name precedes quota meters. Coding windows and Token
subscription/top-up buckets follow the actual response family; a missing,
zero-total, unsupported or partial bucket never implies a zero or full balance.
Queries are bounded, cancellable, cached and identity-checked. Temporary
failures retain a labeled stale snapshot; authentication failures clear the
snapshot without deleting credentials. No background network polling runs.

Typecheck, production build, 447 tests and twelve CI policy/runner tests passed.
The eight focused allowance tests also cover timeout and late-response races.
Isolated Electron allowance acceptance passed using a migrated test vault and
controlled main-process HTTP responses, alongside account-settings and vault
regressions. Browser previews cover light/dark, narrow English and reduced
motion. Both new acceptance scripts are registered in the interface CI group.

The local preview installer at
`D:\Desktop For Step Code\Desktop\release\usage-account-20261017-preview`
passed packaged allowance and auth-vault acceptance with isolated fixtures.
All 98 packaged Desktop build files and 1,157 runtime files match staged
source hashes; installer metadata size and SHA-512 also match. Installer
SHA-256 is `4ee581df675fc7f4fa67a6c939ce332db0f92f4d8a2c01ead99ad463d93a485b`.
The ordinary desktop shortcut now targets this preview's unpacked executable;
the previous shortcut was backed up and running user applications were not
closed. The unsigned preview retains version 0.5.0 and is not a public release.

These are fixture results, not confirmation of the official backend's
availability or a real account's plan. Installer lifecycle and real-account
allowance acceptance remain unverified.

The PR #129 P1 follow-up refreshes expired OAuth credentials through the
upstream provider's refresh implementation in the management process before
querying allowance. Refreshed credentials are saved to the Desktop vault
before use; identity, cancellation and shared-settings guards prevent a late
refresh from replacing another account. The existing query timeout bounds
the refresh as well. Typecheck, build and 449 tests passed. Dedicated Electron
acceptance starts with an expired static upstream fixture credential and
verifies refresh, encrypted persistence and readability after restart. Unit
tests cover rotated credentials, single-flight refresh, failure, cancellation
and account changes. This follow-up has not been packaged and does not
establish real OAuth-server refresh acceptance.

The additional local-review P2 follow-up preserves official `allowed` and
bounded `reason` metadata independently of quota percentages. Restricted
accounts show a localized warning even when their remaining balance is
positive or another query notice is present. Server `observed_at_ms` now
drives reset/expiry boundary checks, including responses generated before
but received after a boundary. Such snapshots stay stale and cannot satisfy
the fresh cache. Twelve focused tests cover denial and all three boundary
types; typecheck, build and all 451 tests passed. Dedicated Electron
acceptance verifies the restricted warning and
stale display together with the existing OAuth/vault regressions.

### Local Official API Balance Preview (2026-10-17)

The local follow-up queries only the fixed CN/Global official accounts
endpoints with the selected Desktop platform credential. It projects available
balance and prepaid/postpaid account type, never derives remaining cash or
voucher amounts from lifetime totals, and does not invent a currency when the
response omits one. Custom-provider credentials are not sent to these endpoints.
Plan credential refresh remains specific to personal Plan profiles.

Typecheck, production build, all 455 tests (serialized), twelve CI policy/runner
tests and browser account acceptance passed. Default parallel tests stalled in
the existing terminal fixture; that owned test tree was stopped before the
successful serial run. Packaged API balance, Plan allowance and auth-vault
acceptance passed with isolated credentials and controlled HTTP responses.
Coverage includes regional endpoints, zero/negative prepaid balance, postpaid
balance, stale/error/auth states, cancellation and the official website link.

The local package is
`D:\Desktop For Step Code\Desktop\release\usage-plan-api-20261017-preview`.
All 98 Desktop build files and 1,157 runtime files match staged source hashes;
update metadata validation passed. Installer SHA-256 is
`5d67add82c0f67efcbabb6f08e7bb5492cd99897cdddaae4ce7973f0cc9ee1a1`.
Its source is base commit `40f048804d8a2acfba050e45710aabf5560dc5b2` plus
uncommitted API balance changes, not that commit alone. Runtime pin remains
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`.

The ordinary desktop shortcut targets the new unpacked executable; its
previous version was backed up in the package directory. Running user windows
and previous packages were preserved. No real-account balance request,
installer lifecycle test, API-change push, merge or public release is claimed.

### Account Billing-Route Regression (2026-10-17)

The follow-up synchronizes the management process's model-discovery endpoint
with the stored login profile before resolving draft-session options. The
previous package reproducibly queried the default Plan models endpoint while
signed into the platform API profile. This is evidence of a model-discovery
mismatch, not evidence of a wrongly billed chat request. Login/logout now
restart management with the applied credential snapshot as well as rebuilding
session workers.

The new interface-CI acceptance uses the real upstream remote-login polling
flow, Desktop vault/IPC and runtime with synthetic credentials and local HTTP
transport. It checks CN API -> CN Plan -> Global API -> Global Plan -> CN API,
including a persisted Step model whose old API base must be normalized. Each
phase verifies both model discovery and actual chat endpoint/credential pairs,
plus the matching allowance source. Plan model-detail metadata intentionally
uses the runtime's regional `/v1/models/...` path; this is not a chat request.
Running API work rejects a login change, pending authorization blocks prompts,
canceling authorization preserves the previous profile, and a denied Plan chat
never falls back to API billing. No real credentials or official billing
transactions were used.

Typecheck, build, 455 serialized tests and twelve CI policy/runner tests passed.
One earlier full run failed in the unrelated session-collaboration test file;
the complete rerun passed. Source and packaged routing, Plan allowance and
auth-vault acceptance passed; packaged API balance acceptance also passed.
The new local package is
`D:\Desktop For Step Code\Desktop\release\usage-account-routing-20261017-preview`.
All 98 Desktop build files and 1,157 runtime files match staged sources,
including the updated management helper; update metadata validation passed.
Installer SHA-256 is
`3c2866121f01442fbc663934211340e7810a33a7e92abafd717354d8afebaa3a`.
It remains version 0.5.0 with the same upstream pin and uncommitted local
changes. The normal shortcut was backed up and updated; running user windows
and old packages were preserved. This does not establish official backend
charging behavior, installer lifecycle acceptance or a public release.

## Accent Acknowledgement Race (2026-10-16)

Cloud run 38694832584 passed HEX input and then timed out comparing the canceled
preview with its baseline. The baseline previously waited only for the main
process snapshot to contain the saved accent, not for the renderer to install
that preference reply.

Appearance acceptance now holds the real preference reply after persistence.
It proves the snapshot already contains blue while the swatch and rendered
accent still show the old value. After releasing that reply it waits for the
selected swatch, settles color transitions and asserts the baseline equals the
final theme token before exercising preview/cancel and rapid reopen. The exact
restoration assertions remain intact; no product styling or timeout was changed.
Normal-speed and four-times CPU-throttled runs passed locally. Cloud success
still requires a new run on the updated commit.

## Accent Editor Rapid-Reopen Regression (2026-10-15)

Each explicit custom-color opening now mounts a fresh editor while preserving
the 220 ms exit animation. Canceling or toggling closed and reopening during
that exit restores the saved HEX and does not revive the discarded preview.
Both paths were reproduced against the earlier source before the fix.

Typecheck, production build, three theme tests and Appearance acceptance at
four-times CPU throttling passed. The acceptance proves the old editor is
still present during exit, then checks that reopening replaces it and restores
the saved value. The source change is not in the existing local preview package.

Cloud run 38692811276 failed while waiting for the Apply button after HEX
input. Normal input checks now wait for the editor's actual opening transition
to finish; a failure records the input value, validation and button states plus
a screenshot. Animation capture and pause use one page call to avoid losing
the transition between separate automation calls. Cloud success must still be
confirmed on the new commit, not inferred from local acceptance.

## Original Palettes and Link Accent Follow-Up (2026-10-15)

Source-only follow-up restores the original neutral light/dark palettes as
compact swatches immediately left of System. Transcript links, generic website
icons and both preview open actions now consume the shared accent instead of
hardcoded blue; external website contents and favicons remain unchanged.
The existing local preview package and desktop shortcut do not include this
follow-up.

Typecheck, production build and three theme unit tests passed. Isolated
Electron Appearance acceptance covers all eight explicit palettes, selection,
persistence and narrow layouts. Link acceptance verifies wine/gold,
original-dark/cyan and original-light/rose combinations against the root
accent token, including both preview actions. Bootstrap acceptance includes
both original palettes at the first frame. Screenshots are
`Desktop/test-results/theme-original-{light,dark}.png` and
`Desktop/test-results/message-links-accent-*.png`.

The earlier cloud interface job failed at an immediate enabled-state assertion
after HEX input. The assertion now waits for the rendered state before
checking; it is not removed or weakened. These local checks do not establish
cloud CI success or package acceptance for this follow-up.

## Six Themes Local Preview Package (2026-10-15)

The local unsigned 0.4.0 preview at
`Desktop/release/themes-accent-20261015/` contains theme source `0ee67fa`
rebased onto main `63fb179` (PR #124). Interface complexity settings, compact
process presentation and unified thinking remain present alongside the new
Appearance palette controls. The final theme circles are smaller, shifted
down/right and blended at 48 percent opacity; their centers remain inside
the tile while both outer edges clip.

Typecheck, production build, 37 focused tests and twelve CI policy/runner
tests passed. Source Electron checks passed for Appearance, interface
preferences, general Electron and theme bootstrap. The unpacked package
passed Appearance, interface preferences, desktop tray, real PowerShell
terminal and general Electron acceptance using isolated profiles. Appearance
acceptance covers all palettes, accents, restart and first-frame persistence,
intermediate cubic color frames, reduced motion, input focus containment and
the final circle geometry. These checks do not establish full-suite,
paid-model, installer-lifecycle or cloud CI success.

All 98 built Desktop files and 1159 staged runtime files matched the package.
Node hash, both Desktop helpers, terminal host, icon and keyless adapter were
verified. Runtime remains pinned to
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`; it was reused, not restaged.
Installer metadata size and SHA-512 matched. Installer SHA-256:
`8e899abd08537f18e3c3c52e5d4a4ccc6168c743a082f36076e74dc7f0a7eb8f`.
The package is `NotSigned`, and no public release was made.

The ordinary desktop shortcut was backed up and updated to the verified
unpacked executable, with empty arguments and matching working directory/icon.
The user's running previous preview was preserved. Package evidence is in
`Desktop/test-results/themes-package-resources.json`,
`Desktop/test-results/themes-shortcut.json` and the package's
`update-package-check.json` / `SHA256SUMS.txt`.
The new package totals about 703.47 MiB; all local release directories total
about 9.07 GiB. No existing packages were deleted.

## Compact Process and Unified Thinking Preview (2026-10-15)

The local unsigned 0.4.0 preview in
`Desktop/release/interface-process-20261015/` supersedes the older interface
packages below. It contains base `b5e98e3`, including current main `7b46a10`,
plus the working-tree process-group and unified-thinking changes. Exact source
hashes are recorded in the installer-adjacent `package-resource-check.json`.
No public Release, upstream pin, permission policy or personal profile changed.

Simple now combines consecutive thinking and ordinary tools into one process
row between prose segments. It shows current activity while running and actual
tool counts after completion; expansion retains all original records. Standard
uses consecutive-tool groups, while Detailed restores individual tools and
opens thinking only while that thought is active. Tools, prose or turn end
automatically fold that thought; subsequent manual reopening remains respected.
Errors, approval waits, missing results and dedicated Plan, question, Subagent,
Workflow and peer-delivery surfaces remain separate.

All thinking rows now use a Brain icon, the existing designed disclosure SVG,
elapsed time and the same live/settled label component as tools. Settled children
do not inherit a live group's shimmer. Previews remain single-line and clipped;
the underlying Markdown and original history are unchanged.

Final-source typecheck, production build and all 436 serial unit/protocol tests
passed. Shared settings browser acceptance and general Electron acceptance also
passed, including Standard's new grouping. General acceptance now explicitly
opens groups before inspecting tools and waits for thinking's closing animation.
The final packaged executable passed interface-preference and stream-motion
acceptance, including active thinking expansion, automatic folding on tool
arrival, manual reopening, long preview clipping, designed icons, independent
shimmer, existing-history reapplication, persistence, keyboard and reduced motion.
Plan review, structured questions and Workflow also passed during this iteration;
those runs preceded the final shared-label-only polish.

All 97 Desktop build files and 1157 runtime files match packaged resources.
Runtime pin remains `3ba89e0c`, with Node v24.15.0 and its verified manifest hash.
Installer size is 153346660 bytes; SHA-256 is
`fcb15cf1fbd0388a093614be23546c1ff9ffbc9d51378d54100ed4a3bb7d29a0`.
Update metadata matches installer size and SHA-512. Installer and application
remain NotSigned. These deterministic local results do not establish paid-model
acceptance, clean-machine installation or cloud CI for the unpushed changes.

The normal Desktop shortcut now targets this preview with no arguments;
its predecessor is backed up as
`Desktop/test-results/interface-shortcut-before-process-20261015.lnk`.
The running older app was preserved. Three local preview directories total
approximately 2079 MiB, including two earlier packages of about 693 MiB each.
No historical package was deleted without authorization. Screenshots include
`interface-thinking-unified.png`, `interface-compact-process-live.png` and
`interface-compact-process-dark.png` under `Desktop/test-results/`.

## Reapplication Preview Package (2026-10-15)

The unsigned local 0.4.0 preview at
`Desktop/release/interface-presets-reapply-20261015/` contains application
source `809f116`, including existing-history preset reapplication and main
`7b46a10` (PR #123 live context statistics). This supersedes the source-only
and older-package boundaries recorded below. Main integration conflicts were
resolved without changing the upstream runtime pin or user workspace.

After merging main, typecheck, production build and all 432 serial tests
passed, as did all 12 CI-policy/runner tests. The final unpacked executable
passed ten acceptance scripts: interface preferences, general Electron,
stream motion, permission approval, Subagent, Workflow, structured question
review, sidebar recovery, context panel and Windows commands. All 97 Desktop
build files and 1157 runtime files match staged resources; helpers, terminal
host, keyless adapter and Node hashes also match. Runtime retains pin
`3ba89e0c` and Node v24.15.0.

Installer `Desktop.for.Step.Code.Setup.0.4.0.exe` is 153376435 bytes, SHA-256
`c36528e581b8677ebb4f85e42d3ac6f6c300db5786ba691f9fbcf4b495b7f49b`.
Update metadata matches its size and SHA-512. Installer and unpacked app are
NotSigned. The normal desktop shortcut targets this package without arguments;
the prior shortcut is backed up as
`Desktop/test-results/interface-shortcut-before-reapply-20261015.lnk`.
The live older application was preserved. Both preview directories total
about 1386 MiB and were inventoried without deletion.

Package evidence is `Desktop/test-results/interface-package-resources.json`,
the packaged acceptance logs and installer-adjacent `update-package-check.json`.
These are local deterministic-fixture results, not paid-model or installer
lifecycle acceptance. No public version or Release asset was changed; cloud
CI is tracked independently on PR #124.

## PR #124 CI Follow-Up (2026-10-15)

The failing interface job used Playwright `check()` on a controlled switch
whose value changes only after asynchronous preference persistence. Acceptance
now clicks once and waits for both the checked and enabled states, then
asserts the persisted IPC value. A deterministic 150ms persistence delay
exercises this path locally; the complete interface regression passed twice.
No production preference behavior or assertion was disabled.

The runtime job assumed Git's internal `mingw64/bin/git.exe` layout.
Git for Windows 2.56 moved x64 binaries to `ucrt64`; the portable Bash fixture
now copies the installation marker from the actual supported prefix and fails
if none exists. All five native command scenarios passed locally on the
existing mingw64 installation, retaining real foreground/background execution,
exit-code, log-ownership and no-fallback assertions. Typecheck and production
build passed. These local results do not establish the rerun cloud result.

## Existing-History Preset Reapplication (2026-10-15)

Explicitly applying interface settings now resets existing thinking, ordinary
tool and grouped-tool disclosure to the selected defaults, even when the old
and new defaults match or the active preset is selected again. The main
conversation, saved-reading preview and settings preview share this behavior.
An ephemeral apply revision advances only after a successful preference write;
equivalent preferences arriving in ordinary runtime snapshots do not reset
manual disclosure. The revision is not persisted or sent to the model.

The renderer updates disclosure state in place rather than remounting the
transcript or reloading the page. Main-process runtime commands, original
history, permissions and models are unchanged. New Electron regressions cover
nine existing historical responses, same-preset reapplication, unchanged tool
defaults, retained prose/thinking/tool DOM identity, stream-safe manual
overrides, unchanged history and preserving an away-from-bottom reading view.
These regressions and the shared settings browser acceptance passed locally.
Typecheck, production build, general Electron and stream-motion acceptance
also passed. The first full run passed 423/424 but hit the previously recorded
terminal-count cleanup error and retained fixture processes; only that owned
test subtree was terminated. Isolated terminal acceptance then passed 5/5.
A subsequent complete serial run passed all 424 tests, with a 45-second
per-test safety bound and no disabled tests or changed terminal assertions.
Both full-run logs are retained under `Desktop/test-results/`.

This follow-up is source-only. The package and desktop shortcut described
below still contain `7c591f5` application source, not this reapplication change.
No installer was rebuilt and no live user process was interrupted.

## Interface complexity mapping (2026-10-15)

Settings now persist presentation-only Simple, Standard, Detailed and Custom
options in the Desktop profile. The main transcript and saved-reading preview
share thinking/tool disclosure preferences; the performance strip can be hidden
without stopping metric collection. All presets fold tool details. Simple also
groups adjacent ordinary tools; Standard is the fallback for absent or invalid
saved settings. Manual disclosure changes survive subsequent stream updates.

Tool groups preserve prose/thinking/image/turn boundaries and leave approvals,
failed or unreturned calls, Subagent, Workflow, Plan, structured questions and peer-delivery records
separate. Summaries count reported operations rather than inventing validation
results. Partial execution output is explicitly pending, not successful.
The Settings preview renders the production conversation and performance
components. Custom options can independently enable grouping or default
expansion. No runtime policy, model, prompt, upstream source or personal profile
is changed by these settings.

Typecheck, production build, all 408 serial unit/protocol tests and eight CI
runner tests passed locally. Browser acceptance checks shared-component preview,
reduced prose spacing, presets, custom toggles, keyboard interaction, persistence,
narrow English layout and reduced motion. Built-renderer Electron acceptance
covers live settings mapping, partial-to-final tool summaries, approval/error
visibility, manual disclosure overrides, custom group/tool expansion, invalid IPC
input rejection, restart persistence and reset. General Electron, stream-motion,
permission approval, Subagent and Workflow acceptance also passed locally.
Both new acceptance scripts are registered in the interface CI group.

These initial results are local isolated-fixture and protocol results, not cloud
CI, paid-model or installer-lifecycle acceptance. At this initial verification
stage no new package was built; see the subsequent packaged results below.
The TODO entries remain open pending user acceptance and PR merge.

### Combined Main Preview Package

The unsigned local 0.4.0 preview at
`Desktop/release/interface-presets-20261015/` includes fetched main `7e36e10`
and interface-complexity source `7c591f5`. This retains the merged structured
questionnaire Beta and project recovery/disclosure work. Tool grouping
explicitly excludes pending and answered `clarify_user` records, with regression
coverage. No upstream tracked source or pinned commit was changed.

After merging main, typecheck, production build, all 424 serial unit/protocol
tests and eight CI runner tests passed. The shared settings preview passed its
browser acceptance again. The runtime was freshly compiled and staged from
the matching isolated `step-code-v014` build source, with the current patch
hashes, pin `3ba89e0c` and Node v24.15.0. Beta bridge validation passed.
The first unit run overlapped runtime replacement and failed with missing
runtime files; it is superseded by the complete 424-test pass after staging.

All 97 Desktop build files and 1157 runtime files match the new package.
Desktop helpers, terminal host, keyless adapter and Node hash also match.
The update metadata matches the installer size and SHA-512. Installer:
`Desktop.for.Step.Code.Setup.0.4.0.exe`, 153375311 bytes, SHA-256
`79233236e8d97f58d661412a140b90319f16b281c9af89f9bdbdc98c24b2b0ed`.
Both installer and unpacked executable are NotSigned. This local preview
must not overwrite the published 0.4.0 installer.

Packaged interface-preference and general Electron acceptance passed, including
restart persistence, reset, IPC rejection, safe grouping, manual disclosure,
themes and 640px layout. The first general run timed out waiting for the
native resize; an isolated size probe and a complete rerun passed without
relaxing the assertion. Failure diagnostics now include renderer/native
geometry. Packaged stream-motion, permission approval and Subagent acceptance
also passed, followed by Workflow, real-RPC structured-question review and
sidebar project recovery/disclosure acceptance. All eight packaged checks
passed using isolated profiles and deterministic services.

The ordinary desktop shortcut now targets this package, with matching working
directory/icon and no demo arguments. Its previous contents were backed up and
the running sidebar-recovery preview was preserved. Exit that old client before
launching the updated shortcut. Evidence is under `Desktop/test-results/`,
including `interface-package-resources.json`, packaged regression logs,
`interface-shortcut.json`, four-mode screenshots, and the installer-adjacent
`update-package-check.json`.

Rebuildable artifacts were inventoried: the new package is about 693 MiB,
runtime 111 MiB, local dependencies 510 MiB, build output 8.5 MiB and terminal
runtime 63 MiB. No obsolete packages were deleted. Cloud CI, paid-model and
installer-lifecycle acceptance are not established by these local results.

## Six themes and independent accents (2026-10-15)

Appearance now offers Light, Paper, Dark, Blue, Wine and Jade, plus system
following. Each palette defines its own surfaces and text hierarchy. An
independent accent can be selected from presets or an inline color picker.
Picker edits preview immediately; cancel, Escape and leaving Appearance
restore the saved color. Applied preferences survive restart. Accent
normalization accepts only opaque three- or six-digit HEX, and rendered
accents are adjusted for text contrast without changing the saved value.
Success, failure and interrupted-state colors remain independent.

Main-process window backgrounds, preload/bootstrap first paint, renderer,
tray and terminal use the resolved palette. Scheme-prefixed tokens preserve
existing light/dark fixture switching. Transparent blends in settings and
approval surfaces use sRGB to avoid Chromium's neutral-hue OKLCH tint.

Typecheck, production build, three theme unit tests and twelve CI policy and
runner tests passed. Serial isolated-profile Electron acceptance passed for
appearance, theme bootstrap, settings dialog, desktop tray, terminal panel,
general Electron and context panel. Coverage includes all six palettes,
system changes, first-frame/restart persistence, accent validation,
preview/cancel/apply, independent semantic colors, Paper sidebar pixels,
typography and narrow layouts. Screenshots are in
`Desktop/test-results/theme-*.png`.

These are local UI and deterministic integration checks, not full-suite,
paid-model or installer lifecycle qualification. No installer, shortcut,
commit, PR or release was produced by this source-only change.

The visual follow-up adopts the six approved Chinese names and the Light and
Shadow / Between Mountains and Seas group names, with quieter concept-derived
palettes. The hue track uses a muted spectrum and a short rectangular thumb;
the saturation/value control retains accurate color selection. HEX inputs
shrink into the space remaining beside their swatch instead of overflowing
their flex row. Focus outlines are inset, with explicit wide/narrow acceptance
assertions for both the input and its entire outline. Typecheck, build, theme
unit tests and Appearance acceptance passed again after this follow-up.

Theme tiles now have a larger solid circle clipped by both right and bottom
edges, with its center inside the tile rather than on the corner, and with
the selection mark moved to the upper right. Shared color tokens transition
over 360ms with cubic easing; component geometry transitions are unchanged.
The first paint is immediate and reduced motion disables color interpolation.
Appearance acceptance samples an intermediate color frame and verifies cubic
timing, final colors and the reduced-motion path. Terminal color refresh also
listens for color-transition completion/cancellation, so its canvas does not
retain the pre-transition palette.

## Live context statistics refresh (2026-10-15)

The v0.4.0 runtime bridge refreshed statistics after maintenance or a full
snapshot, but not ordinary message completion. Long-running turns could keep
showing their initial context occupancy and session totals while per-run
metrics continued growing. Completed messages now request authoritative
runtime statistics without ending the turn or refreshing the whole history.
Turn completion also refreshes partial or final usage. Streaming deltas do not
request statistics. Automatic refresh requests are serialized per worker and
coalesce changes received during a pending read into a follow-up read. Each
actual request gets a new version so a slow full snapshot cannot overwrite a
newer follow-up. Existing identity guards discard retired-session responses.
Unknown occupancy remains unknown, and cumulative tokens never supply the
occupancy numerator.

The initial three message-refresh regressions and the slow-snapshot race
regression failed before their corresponding fixes and passed afterward.
Typecheck, production build and 79 focused tests passed. A real pinned-runtime
test uses an isolated localhost SSE model: a real read_file result reaches the
next model request while its response is held open, and Desktop publishes
increased occupancy equal to the runtime's working-context estimate before
agent_end. Existing CLM Plan/Goal, fallback and cancellation tests also passed.
Context-panel and context-maintenance Electron acceptance passed, including
live 2-to-18-percent updates in both surfaces and background-worker isolation.
These are deterministic local checks, not reproduction of the reporter's
original session or real-provider acceptance.

## Supplemental recovery review (2026-10-15)

Relocating a project from its selected draft now refreshes the session catalog
before returning the draft snapshot. Its existing histories immediately appear
in the destination group rather than disappearing until a later refresh.
Expanded inspectors disable only `.main-content`; project warnings remain
operable while the covered transcript/composer stay inert. The warning remains
inside main, above the inspector, without moving the fixed right rail.

The runtime CI failure on `3c87da2` was an immediate post-click disclosure
assertion. Disclosure now saves asynchronously; acceptance waits for the
matching committed UI state before retaining its original assertions.
The rapid-click sidebar regression also waits for the renderer after verifying
the main-process snapshot.

Typecheck, build and 64 focused unit tests passed. Serial Electron acceptance
passed for sidebar recovery/disclosure, main Electron, review, context,
browser, real PowerShell terminal, cross-session operations and fixed settings.
The sidebar case selects a draft before relocation and checks destination
history DOM before requesting a new snapshot; the expanded inspector case
checks warning focus, removal/cancel and directory-picker cancel/recovery.
No retries, disabled tests or relaxed assertions were added.

## Sidebar disclosure persistence (2026-10-15)

Project and independent-group disclosure now lives in Desktop preferences
instead of renderer-only state. Startup and reload restore the saved groups;
older profiles without a saved value retain the previous expanded default.
Disclosure writes are serialized so rapid clicks compose. Creating a session
explicitly expands its project, relocation carries its collapsed key, and
project removal clears only that project's key.

Typecheck, production build, 13 sidebar/workspace unit tests and the full
sidebar Electron acceptance passed locally. Acceptance covers mixed disclosure
states across renderer reload and a full app restart, independent-group state,
and rapid multi-group toggles. This follow-up is not repackaged; cloud CI must
validate its new head independently of the earlier green run.

## Sidebar review and CI follow-up (2026-10-15)

PR #122 review identified an unsafe path-wide relocation rule: recreating
the old directory could redirect new histories into the moved project.
Relocation now binds the existing session IDs to their destination. Reusing
the source path does not inherit another session's binding, repeated moves
update only affected bindings, and removal retains historical bindings.
Successful validation of the originally missing path clears its stored issue.

The initial cloud run `38662461552` failed on stale warning selectors in
the main Electron and navigation scripts. These now assert the application
banner and localized missing-directory message. Scripts using project add
buttons first hover their heading, matching the intentional disclosure.
The interface group also had an early native exit in the tray test without
a JavaScript failure; local tray acceptance passed three consecutive runs.
Tray readiness now requires an actual enabled composer element, and stage
diagnostics were added. No retry, timeout increase or skipped assertion was
introduced. Replacement cloud CI must independently validate these changes.

Typecheck, build, 56 workspace/runtime tests and 12 CI policy/runner tests
passed. Main Electron, navigation, review-panel and tray acceptance passed
locally. The new recreated-directory regression checks catalog grouping and
the actual runtime directory for both new and relocated histories.
Account, launch-mode and permission-tier acceptance also passed after updating
their alert selectors, including negative assertions that must detect the new
banner rather than silently overlooking it. Branching/concurrency failure
diagnostics use the same banner and modal selectors.
The earlier local installer and desktop shortcut remain on `3d4369c`; this
follow-up has not been repackaged, and the earlier full-suite terminal cleanup
failure was not retroactively marked passed.

## Sidebar project recovery preview (2026-10-15)

This unsigned local 0.4.0 preview is based on fetched main `f4c3d35` plus
the uncommitted sidebar/project recovery changes. It includes the merged
clarification Beta, performance matrix and composer select-all deletion fixes.
Project removal only unregisters the grouping; files, histories and running
workers remain. Relocation preserves project metadata and reopens original
history with the upstream session host's cwd override. A failed initial
directory validation clears only the bootstrap draft. The warning belongs
to the main viewport, sits above the summary overlay and does not displace
the right tool rail. Sidebar add controls reveal on hover/focus, and reorder
motion uses cubic easing with reduced-motion support.

Typecheck, production build and 67 focused tests passed. Source and packaged
sidebar acceptance passed for ordering, pins, missing-directory recovery,
original session identity/history, startup recovery, removal/cancel, modal
animation, warning layering/rail geometry, reload and reduced motion.
Packaged clarification, composer editing and real-RPC performance acceptance
also passed with isolated profiles and deterministic services. The Beta
questionnaire bridge validation passed against the patched build source.
This does not establish paid-model, cloud CI or installer-lifecycle readiness.
The earlier full-suite terminal process-tree cleanup failure remains unresolved;
the full suite was not rerun for this package.

The installer is under `Desktop/release/sidebar-project-recovery-20261015/`.
All 97 Desktop output and 1159 runtime files matched the package; helpers,
icon, pinned commit `3ba89e0c` and clarification patch metadata were verified.
Update metadata byte count and SHA-512 matched the 155073386-byte installer.
Installer SHA-256:
`ff01d816cacae9dfd71b647275dfdea97b828dc7a79a824629b4a55011722952`.
Both installer and application are `NotSigned`; this is not a replacement
for the public v0.4.0 release asset.

The ordinary desktop shortcut was backed up and verified to target the new
unpacked executable. No live user client was stopped; exit/relaunch is required
to use it. Package evidence is in `test-results/sidebar-project-package-resources.json`,
`test-results/sidebar-project-shortcut.json` and the release directory's
`update-package-check.json`. Rebuildable outputs were inventoried; older packages
were not deleted without separate approval.

## PR CI inventory integration (2026-10-15)

The latest PR CI failed in classification before Windows acceptance ran:
the merge preview added main's composer-editing acceptance, resulting in 51
assigned scripts while a test still expected 50. Main `1ca45ba` is now merged
into this branch. The count assertion derives from discovered scripts minus
the explicit local-only list; duplicate, missing and unassigned checks remain.
The failure reproduced locally before the change. All 12 CI policy/runner
tests and 60 runtime/revision/questionnaire tests passed afterward.
Replacement cloud CI must verify the integrated head independently.

## Question waiting-action treatment (2026-10-15)

The pending question status now reuses the permission-review treatment: tinted
surface, inset border and flowing highlight, rather than a separate text-only
gradient. It retains the circle-help icon and its place beside task controls;
Goal/Plan/Ultracode run and settled controls are unchanged.

Typecheck, build and source Electron/RPC question acceptance passed, including
computed animation/background assertions and reduced-motion disabling for both
the container and label. Dark/light screenshots are
`questions-approval-status-dark.png` and `questions-approval-status-light.png`.
This source follow-up has not been repackaged; replacement cloud CI is pending.

## Clarification completion revisions (2026-10-15)

PR #117 review found that synthetic question expiry and the original completion
shared a revision, causing the renderer to reject the tool result or agent end.
Expiry now reserves the next revision for the original event. Two regression
cases failed before the fix and passed afterward through `MessageRevision`,
covering matching tool completion and multiple pending questions at agent end.
The tool case also verifies the final error result reaches transcript state.

All 60 focused runtime/revision/questionnaire tests, typecheck, build and source
Electron/RPC question acceptance passed. The earlier commit's cloud CI passed;
replacement CI must independently verify this follow-up. The local installer
and desktop shortcut below remain on the earlier preview, not this fix.

## Question status placement correction (2026-10-15)

Source now renders the circle-help question control through `TurnStatusTrigger`
alongside Goal/Plan/Ultracode controls, outside `WorkingIndicator`. The matrix,
working label and elapsed clock retain their primary position. Typecheck,
build and source Electron/RPC question acceptance passed, including Plan and
question controls together, collapse/reopen and icon/placement assertions.
Screenshots include `questions-plan-status-dark.png`.
The corrected unsigned local 0.4.0 installer is now under
`Desktop/release/clarification-status-beta-20261015/`, based on merged main
`30c77f2` (PR #115) plus the clarification Beta changes. Packaged Electron/RPC
question and performance acceptance both passed. All 97 Desktop output files
and 1157 runtime files matched the package; the pinned commit and patch hashes
matched. Update metadata, byte count and SHA-512 matched. Installer SHA-256:
`1d12a0d1d3928dbdc9e154a18144c1ed167b3a65d3d25b5ad8d6967ddfd1d00c`.
Authenticode status is `NotSigned`. The ordinary desktop shortcut was backed
up and verified to target this unpacked executable. The user's live client
was preserved; explicit exit/relaunch is needed to pick up the new build.

The latest full serial suite passed 404 of 405 tests. The unchanged
`tests/terminal-sessions.test.ts` terminal-count case failed during `stopAll`
cleanup with "Could not terminate the terminal process tree". Only the nine
owned fixture children left by that test were stopped; no user client was
stopped. Focused acceptance does not make this an all-green full regression,
paid-model, cloud CI or installer-lifecycle claim.

Rebuildable output was inventoried: the new release directory is 726718658
bytes, local dependencies 531306491 bytes, runtime 116756025 bytes and terminal
runtime 64762142 bytes. Old packages were not deleted without approval.
Package evidence is in `test-results/clarification-package-resources.json`
and the release directory's `update-package-check.json`.

## Combined matrix and clarification preview (2026-10-15)

This preview supersedes the initial clarification-only package below. Its
baseline is merged main `30c77f2`, including PR #115's matrix working states,
flowing elapsed time and compact performance strip, plus the uncommitted
clarification Beta adaptation. At this earlier preview stage, the question
reopen control stayed inside `WorkingIndicator`; pending questions showed one waiting matrix,
retain elapsed time and never reintroduce the old pulse dot.

Typecheck, build, 74 focused tests and 12 CI routing tests passed. Matrix
browser acceptance passed. Packaged Electron/RPC acceptance passed for both
the question drawer and performance runtime, including waiting matrix,
thinking/prose transitions, TPS/usage, completion freeze and new-session reset.
These use isolated profiles and deterministic model services, not paid-model
or installer-lifecycle acceptance. The earlier terminal cleanup failure
remains unresolved; this is not an all-green full regression claim.

All 97 Desktop output files and 1157 runtime files matched the package. The
runtime pin and clarification patch remain unchanged. Installer metadata and
hashes matched; SHA-256:
`a1412d11bebb6196106b63a6cb40a307db2285e08a9b0ec654107d0a4c6b9d7f`.
The unsigned local installer is at
`Desktop/release/clarification-pulse-beta-20261015/`.
The ordinary desktop shortcut now targets its unpacked executable, with the
old shortcut backed up. The user's running clarification-only preview was
preserved and needs explicit exit/relaunch to pick up this combined build.

Evidence is under `Desktop/test-results/`, including question/matrix/runtime
screenshots and `clarification-package-resources.json`; update-package evidence
is alongside the installer. Rebuildable artifacts were inventoried; obsolete
packages were not deleted without approval. No public release or PR was made.

## Performance strip and matrix working states (2026-10-14)

PR #115 follow-up (2026-10-15): the runtime CI failure was an outdated
verify-electron assertion waiting for the removed "input" text field.
The general acceptance now checks all four metrics, icon ordering, single-chunk
unknown TPS, completed-value freeze, centered/contained narrow layout and
new-session usage reset instead of the removed extended-metric/ellipsis UI.
TPS excludes length-truncated responses while retaining their reported usage.
Six focused performance tests, typecheck, build, complete general Electron
acceptance (including reopened profiles) and real pinned RPC performance
acceptance passed locally. Replacement cloud CI is pending; the prior full-suite
terminal cleanup failure below remains a separate historical result.

The centered strip now contains total duration, estimated output TPS,
input/output tokens and cache-hit rate. TPS uses reported output tokens and
locally observed first-to-last nonempty output-delta timing for completed
responses; it is not server decode telemetry. Missing measurements stay unknown.
The five matrix states follow runtime events and authoritative approval/Plan
review state. Status text and total run time share a flowing brand gradient.
Reduced motion and forced-color fallback are covered. Light fills preserve the
original palette without outlines or shadows and are not 4.5:1 contrast-compliant.

Typecheck, production build, five performance tests, eight CI runner tests,
browser animation/palette/layout checks and built-renderer real pinned RPC
acceptance passed. The browser check starts an owned temporary Vite service
unless an explicit preview URL is supplied. Both new acceptance scripts are
registered in the interface/runtime CI groups; cloud results remain pending.

The latest full serial suite passed 397 of 398 tests: the terminal-count test
failed during stopAll cleanup with "Could not terminate the terminal process
tree"; its isolated retry also failed in cleanup. No terminal assertion or
production terminal behavior was changed. This is not an all-green full suite
or paid-model/installer-lifecycle acceptance.

The local unsigned 0.4.0 gradient preview matched 97 Desktop and 1157 runtime
files. It retains upstream pin 3ba89e0c and Node v24.15.0. Installer SHA-256:
`53465a5e06caed4f5db66e59b757b23323cc96422c5dfba5103afa7616b3a401`.
The ordinary desktop shortcut targets this preview. User-tier settings remain
outside this change, and no upstream source was modified.

## Structured clarification local package (2026-10-15)

The local 0.4.0 preview was packaged from latest main `b4f4625` plus the
uncommitted clarification Beta changes. It includes the letter-choice UI,
cubic selection feedback and heavier labels. The 68 focused tests, typecheck,
runtime staging guards and packaged Electron/RPC question acceptance passed.
The packaged acceptance uses an isolated profile and simulated model service;
it does not establish real-model or installer-lifecycle acceptance.

All 97 Desktop output files and 1157 staged runtime files matched the package.
The runtime remains pinned to `3ba89e0c` with `desktop-clarification-beta`.
Installer metadata, byte count and SHA-512 matched. Installer SHA-256:
`f336d9479d5f3485c781e0518e064c41d28f69b35ab6a8b1d23a97e34986d78a`.
The normal desktop shortcut now targets this unpacked preview; its previous
shortcut was backed up. The user's running client was not stopped.

The unsigned local installer is under
`Desktop/release/clarification-beta-20261015/`, not a replacement public release.
Package evidence is in `Desktop/test-results/clarification-package-resources.json`
and `Desktop/release/clarification-beta-20261015/update-package-check.json`.
The earlier terminal cleanup regression below remains unresolved. No Issue,
commit, PR, cloud CI success or public release is claimed. Rebuildable artifacts
were inventoried and retained for current preview/testing; no cleanup was
performed without approval.

## Structured clarification Beta (2026-10-14)

The opt-in Desktop main-worker compatibility patch connects the existing
`clarify_user` tool to a whole-question-group drawer. The tool contract,
permissions, native TUI and unflagged child RPC behavior remain unchanged.
The UI and transport are explicitly Beta; unattended expiry, automatic
decisions and restart-persistent pending questions are not implemented.
See `UPSTREAM_QUESTIONNAIRE_BETA.md` for the integration boundary and future
upstream proposal.

Typecheck, production build, staging source guards and diff checks passed.
The isolated bridge harness passed opt-in/off behavior, full-group answer
validation, trusted option-label reconstruction, cancellation/abort signals,
and the existing TUI fallback. The real Electron/RPC fixture passed question
visibility, single-choice auto-advance, previous/next navigation, freeform
draft retention across collapse and session navigation, rejected forged
answers, submission failure/retry, final explicit submission, Plan clarification
before separate proposal approval, cancellation, task abort and Ask-tier
permission approval. Existing Plan and permission-drawer acceptance passed.
CI routing tests passed; the new acceptance is assigned to the sessions group.

The full serial unit/protocol suite reported 399 passed and one failed out of
400. The unchanged terminal-count fixture failed when terminating concurrent
terminal host process trees; a standalone retry reproduced the same cleanup
failure. Only owned isolated test hosts were stopped to complete cleanup.
This run is not an all-green regression result. No cloud CI, real-model,
installer or unattended long-duration acceptance is claimed.

Screenshots are under `Desktop/test-results/questions-*.png`. At this initial
source-validation stage no installer was generated, no shortcut was changed,
and no upstream issue was created; see the later local package record above.

## Transparent Logo startup preview (2026-10-14)

A separate sandboxed, click-through, unfocusable transparent window displays
the existing Logo before the main shell is ready. It has no desktop bridge,
background panel, text or taskbar entry. Shell readiness and renderer failure
paths reveal the main window; the splash is destroyed on handoff and quit.
A ten-second hide safeguard bounds its topmost visibility. Reduced motion
disables the Logo entrance animation.

Build, typecheck and the 395 serial unit/protocol tests passed locally.
Source and packaged startup acceptance passed for geometry, bridge isolation,
shell handoff/disposal, transparent page pixels and reduced motion. A real
Windows cold-start desktop capture reproduced the earlier opaque square.
Disabling the thick frame and making the short-lived window topmost removed
the square on this host. The packaged desktop capture temporarily delayed only
the shell handoff to allow capture; normal handoff was verified separately.
This is local native-compositing evidence, not a guarantee for every GPU or
Windows configuration.

The fixed preview is based on main `feba5b4`, retains version `0.4.0` and
upstream pin `3ba89e0c`. All 97 Desktop and 1157 runtime files matched the
package; update metadata matched the installer. Installer SHA-256:
`669714b6c09d194463f412f089fc77d8219174d387bec991167201310186d17b`.
The desktop shortcut points to the fixed unpacked preview. The user confirmed
the visual experience; their running client was not stopped. This unsigned
local preview is not a published release or installer-lifecycle acceptance.
The startup script is registered in the interface CI group; cloud results
remain pending until the PR checks finish.

## In-app updater development (2026-10-14)

Source adds a pinned-release NSIS update driver, SHA-512 verification before
download/install, isolated bounded update metadata requests, cancellable full
downloads, explicit restart confirmation, runtime/approval/queue/terminal
installation guards, and owned-cache cleanup after a successful new-version
startup. Existing manual-download behavior remains for unpacked/development
clients and releases without `latest.yml`.

The final serial unit/protocol run passed 391 tests (including 15 updater
tests); typecheck, production build, existing update-check Electron acceptance
and the new update UI fixture passed locally. The UI fixture uses the real
component with simulated transfer states, not a real downloaded installer.
Screenshots are in `Desktop/test-results/updater-*.png`.

The focused updater/update-check tests total 30 passed, including cache-preflight
and network-policy regressions. The real NSIS download driver also passed isolated Electron
acceptance for streamed downloads, metadata mismatch, corrupt SHA-512 payload,
cancellation and retry. This fixture substitutes the network transport target
with a local service; it does not execute an installer or validate the public
GitHub network/signature path. Twelve CI-policy/runner tests passed.
The NSIS build produced `latest.yml`; the package checker verified its version,
asset name, byte count and SHA-512 against the installer. The local preview
retains source version 0.4.0 and must not replace the published v0.4.0 asset.
The freshly packaged unpacked executable also passed the existing update-check
Electron acceptance with an isolated profile. This verifies packaged startup,
IPC, UI, preference/relaunch behavior and the manual fallback; it does not
establish installed-client self-update or installer lifecycle acceptance.

This is not release readiness. Before publishing: verify an installed old
version upgrading to a new candidate in the cloud desktop, login/history/
settings retention, task and approval blocking, cancelled confirmation,
interrupted downloads and retries, reinstall/relaunch, installation failure
recovery, and post-success cache cleanup. Current preview installers remain
unsigned; hash verification is not publisher authentication. No automatic
rollback is claimed. No live account or original worktree was modified.

## v0.4.0 publication (2026-10-14)

Published as a GitHub Pre-release at 09:15 Australia/Perth. The public tag
`v0.4.0` resolves to merged main `af1ea3a7b0f485a598fe9050e25d9b557f532c74`.
The final installer was freshly built from that commit, not renamed from RC2.
It is 152695099 bytes, SHA-256
`1036fb426cc9351133ba88a798a0706b2a14cd202e44acd9cfbaafde146281f4`.
Both installer and unpacked application are `NotSigned`.
All 94 Desktop and 1157 runtime files matched; helpers, Node hash, notices and
six ProseMirror versions/licenses passed. The upstream pin remains `3ba89e0c`
and Node v24.15.0.

The final unpacked executable passed all 44 Windows checks and seven
supplementary checks with isolated profiles and deterministic services.
The normal desktop shortcut now targets the final unpacked executable;
the previous shortcut was backed up and the user's running RC1 was preserved.
These results do not establish a new paid-model or installer-lifecycle test.

The public installer was downloaded and hashed as a stream, without retaining
a duplicate installer. Its hash and length matched the build and the public
`SHA256SUMS.txt`, which names `Desktop.for.Step.Code.Setup.0.4.0.exe`.
Update-feed run `38494702647` succeeded. The public raw manifest advertises
preview `0.4.0`, stable `null`. The actual client update logic, supplied with
this captured public manifest, reports available for `0.3.0` and `0.4.0-rc.2`,
current for `0.4.0`, and no release on the stable channel. This is isolated
update-state verification, not observation of the user's live notification.
Evidence is under `Desktop/test-results/`: `final-040-package-resources.json`,
`final-040-acceptance.json`, `final-040-shortcut.json`,
`published-040-download.json`, `published-040-feed.json` and
`published-040-client-check.json`. Historical failures and pending granular
cloud/lifecycle records remain below; they were not retroactively marked passed.

## v0.4.0 candidate confirmation (2026-10-14)

The maintainer reported no apparent problems with RC2 and authorized continuing
release preparation. Source version is now `0.4.0`; the delivered installer and
desktop shortcut remain RC2. This confirmation is not a per-item cloud
real-model or installer-lifecycle result. Those gates remain pending.
The final installer must be rebuilt from frozen merged main; RC2 must not be
renamed or represented as the final artifact.
Typecheck, production build and all 376 serial unit/protocol tests passed
again with the final source version; `git diff --check` passed.

## v0.4.0-rc.2 packaged acceptance (2026-10-13)

Replacement candidate application source is frozen at
`2c431fc97bac6978aa5095709dda5e259096adc0`, including the persistent shared
Plan/Goal/Ultracode footer triggers. Typecheck/build and fresh staging passed;
the upstream pin remains `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8` with
Node v24.15.0. This supersedes the source-only package status below.

Installer: `Desktop for Step Code Setup 0.4.0-rc.2.exe`, 152695170 bytes.
SHA-256: `8d12cec4ee8796bfd953e84ba42a88968250aebc8d6fe9054aa570dae2797dd6`.
Installer and unpacked application are both `NotSigned`. All 94 Desktop
build files and 1157 runtime files match their sources; resource helpers,
Node hash, runtime notices and six ProseMirror versions/licenses passed.
The asar roots remain only `dist`, `node_modules` and `package.json`.

All 44 Windows checks passed against the new unpacked executable: interface
16, sessions 14, runtime 14. Seven supplementary checks passed: chat quotes,
Context, Review/Diff, turn undo, feedback, Summary board and turn changes.
StepPage's seven launches passed without the earlier native driver exit;
this does not establish that its historical cause is fixed. Fixtures and
local deterministic services use isolated profiles, not real paid accounts.

The first report driver stopped after the successful 44 checks because it
looked for the old supplementary records at the wrong JSON property. The driver
was corrected, resources/hash rechecked, and exact candidate identity plus all
three complete script inventories/success records validated before running the
seven previously unexecuted supplementary checks. No product assertion was
weakened or test skipped.

Evidence: `Desktop/test-results/rc2-package-resources.json`,
`rc2-acceptance.json`, current screenshots and `rc2-shortcut.json`.
The normal desktop shortcut was backed up and points to RC2, with matching
working directory and empty arguments verified by readback. The currently
running RC1 application was not interrupted; its package remains preserved.
No tag, GitHub Release, upload or final installer was created. Cloud real-model
and installer-lifecycle acceptance remain pending.

## Persistent turn status follow-up (2026-10-13)

Source now shares `TurnStatusTrigger` across Plan, Goal and Ultracode footer
entries. The old Plan-only hover visibility rule was removed; ordinary response
actions still appear on hover/focus. Typecheck, production build, 376 serial
unit/protocol tests and Plan-review, launch-mode and workflow Electron acceptance
passed with isolated profiles. Combined real UI component fixtures verify all
three persistent triggers at dark/light 1360px and dark 640px without overlap;
existing detail, keyboard, workflow outcome and history checks remain enabled.
Screenshots: `Desktop/test-results/turn-status-unified-{theme}-{width}.png`.
This is source acceptance only: the frozen rc.1 installer and desktop shortcut
have not been rebuilt or changed and do not contain this follow-up.

An isolated local HTTP capture of the pinned provider also confirmed a thinking
capability risk. A reasoning model without `thinkingLevelMap` exposes
`off/minimal/low/medium/high`, but selecting `off` omits `reasoning_effort` and
does not send a thinking-disable field. With explicit `off` metadata it sends
`reasoning_effort: "off"`; with only `low/medium/high` metadata an unsupported
`off` request clamps to `low`. Evidence:
`Desktop/test-results/investigate-thinking-off.mjs`. These synthetic transport
cases do not establish the real Step 5 endpoint's metadata, accepted parameters
or the cause of the user's live request. No account, credential, paid request
or upstream source change was involved.

The same four local HTTP cases were repeated using the actual v0.3.0 packaged
Node, provider adapter and supported-level enumeration, not rebuilt old source
(`investigate-thinking-off.mjs --release-030`). Its installer SHA-256 matches the
retained release checksum:
`85974def08be515c12b026eee22082df64c48ac77e03a837adbe88b22f2b2fbb`.
The old runtime manifest pins `f7392089e67d80232b73c87f894dec8100c6c20a`.
All four enumeration/request results match the current runtime. Desktop's
`ModelEffortPicker`, `model-selection` and `auth-vault` have no diff from v0.3.0;
the management helper's only change is permission-preset resolution. This
establishes unchanged behavior for these controlled cases, not a successful
live-account metadata query or proof that the service honors `off`. The existing
user application, profile, installer and shortcut were not replaced.

## v0.4.0-rc.1 packaged acceptance (2026-10-13)

Candidate application source is frozen at
`b67ed5e896936f2a2de674862990b41cb248265d`, based on merged main `cd47b0a`.
The isolated runtime was freshly staged from pinned upstream
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8` with Node v24.15.0.
The original shared junction was preserved outside the repository; its target
and running user applications were not changed.

Installer: `Desktop for Step Code Setup 0.4.0-rc.1.exe`, 152694872 bytes.
SHA-256: `6e59798c15dda333e4450431a3b03643d357e3efdf4b8b1e6101e45195337d17`.
The installer and unpacked application both report Authenticode `NotSigned`.
Package checks match all 94 Desktop build files and 1157 runtime files,
including current Desktop helpers, terminal/file-opening helpers, Node hash,
runtime notices and six ProseMirror package versions/licenses. The asar roots
contain only `dist`, `node_modules` and `package.json`.
Frozen-lockfile installation, typecheck, production build and 376 serial
unit/protocol tests passed before packaging.

All 44 Windows checks passed against the candidate unpacked executable:
interface 16, sessions 14, runtime 14. Seven additional packaged checks passed:
chat quotes, Context, Review/Diff, turn undo, message feedback, Summary board
and turn changes. Test profiles and local deterministic services are isolated.
These results do not establish paid-model semantic quality or installer lifecycle.

At 150% Windows scaling, test-only geometry corrections preserve the existing
five-row menu assertion/tolerance and compare picker/trigger widths numerically
within 0.001px, rather than comparing differently serialized CSS/layout strings.
The first full attempt passed 43 checks but its StepPage test driver exited
with native code `3221226505` during launch 3. An isolated seven-launch retry
passed, then the complete 14-check runtime group passed. The first attempt is
retained; the native-exit root cause is unconfirmed, and no corresponding
Application event was retrieved. Only the identified orphan test process tree
was terminated before retry.

Evidence is under `Desktop/test-results/`: `rc-package-resources.json`,
`rc-acceptance-first-attempt.json`, `rc-acceptance.json`, screenshots and
`rc-shortcut.json`. The normal desktop shortcut was backed up and updated to
the candidate executable, with matching working directory and empty arguments;
other desktop shortcuts were left unchanged. The installer hash was rechecked
after all tests. Test-only corrections and documentation do not change the
frozen application build or binary.

This supersedes the preparation-only status immediately below. No new tag,
GitHub Release, upload or final 0.4.0 installer has been created. Disposable
cloud-machine upgrade/restart/uninstall/reinstall and real-model Plan, Goal,
Ultracode and CLM checks remain required before final release preparation.

## v0.4.0 release preparation (2026-10-13)

PR #108 merged into main `cd47b0a88cac447b353e3038f649c6b1f03f0fed`.
Its exact final head `7a35a77c263f5fb635c698fd246b4da1c562248f` passed
cloud run `38389960338`: interface in 5m06s, sessions in 5m21s, runtime in
7m26s and the final CI gate. All 376 unit/protocol tests and the 44 Windows
acceptance checks passed; cloud logs confirm all five Windows command profiles.
The P2 controlled-draft review was fixed and its thread resolved before merge.
This supersedes pending merge/cloud notes for #108 below, not historical
installer or real-model acceptance boundaries.

An additional local runtime-group rerun stopped at the workflow history-menu
geometry assertion: all 16 rows were 33px tall, but measured content height was
166px rather than 165px. A standalone rerun reproduced that local difference;
the same head passed this check in cloud CI. No assertion was weakened and
no unrelated menu behavior changed. Candidate acceptance must inspect display
scaling/geometry rather than counting that local group as passed. The earlier
native exit `3221226505` did not recur in the successful cloud run; its root
cause is still unconfirmed.

Published `v0.3.0` remains the previous community preview. Release scope and
draft prose for proposed `v0.4.0` are recorded under `docs/releases/`.
No application version bump, new installer, checksum, shortcut update, tag
or GitHub release is part of this documentation preparation. Real-model smoke,
packaged acceptance and disposable-machine upgrade/restart/uninstall/reinstall
remain required. The shared runtime junction was inspected and preserved;
future packaging must stage current Desktop helpers independently.

## Next Windows release readiness (2026-10-13)

PR #107 merged as main `969efee30253c9ef62f23f5ac6bb51a862076f55`.
Its exact reviewed head `294cd883c60ee9f51711d0aa16834541fb16b4fd`
passed cloud run `38376159467`: sessions in 5m42s, interface in 6m41s,
runtime in 7m44s, and the final CI gate. The complete protocol suite passed
368 tests. Cloud logs explicitly confirm Goal launch acceptance, model-switch
acceptance and all five Windows command profiles passed. The PATH review
finding was fixed and its review thread resolved before merge.

This supersedes earlier pending-cloud-CI notes for PR #107, not the boundaries
of those historical tests. The earlier native crash did not recur in this run;
its underlying cause is not claimed fixed. Source and deterministic-runtime
acceptance do not establish paid-model summarization quality or installer
lifecycle readiness.

No new release version, frozen installer, package checksum, desktop shortcut
update or cloud-machine installation has been produced after this merge.
The next release still requires a frozen main candidate, packaged acceptance,
real-model smoke (including CLM requirement retention), and disposable-machine
upgrade/restart/uninstall/reinstall checks. Older local 0.3.0 previews do not
contain every subsequent source fix and are not the next release candidate.
Task-list retention through CLM/native compaction now has the local regression
evidence below; its changes remain unmerged.
Host-restricted symlink coverage and exploratory upstream Unix-path test
failures remain recorded below, not silently treated as passed.

Composer links are explicitly included in this release's finishing scope, with
source-only implementation below. User-tier frontend capabilities retain P0
priority but are deferred to the following release.
No unmerged Linux work is included in this Windows readiness record.

## Composer links and task-list retention (2026-10-13, source only)

The composer displays HTTP(S) links in place in the editable text, with a web
icon and the existing web-link colors, rather than adding a separate reference
row. A plain-text ProseMirror schema preserves whitespace, line breaks and raw
Markdown; link/command icons are view-only decorations, not prompt or clipboard
bytes. The existing Markdown/GFM parser identifies links, excluding code,
images, credential-bearing URLs and non-web schemes. Recognition never sends
the draft or automatically fetches webpage metadata. Hover/focus of the icon
reuses the existing preview; activating it toggles the built-in browser without
submitting the message. Text remains selectable and editable at raw offsets.

The pinned upstream already persists `step-tasks` independently of editable
conversation bodies and injects a fresh bounded, read-only `step-tasks-state`
snapshot into actor requests. No upstream source change is needed here.
Seven upstream context/task-state tests passed. Extended Desktop real-RPC
tests verify task IDs, states, owners, blockers and plan identity through CLM,
native failure fallback, cancellation/recovery, explicit native compaction and
runtime restart, alongside the existing Plan/Goal coverage. Earlier branches
do not inherit later task snapshots; request-local metadata neither accumulates
in conversation history nor enters editable CLM bodies. The Desktop Summary
projection continues to show the same task list.

Local type checking, production build, all 375 serial unit/protocol tests,
12 CI policy/inventory tests and all 44 Windows acceptance checks passed.
The initial sessions-group attempt inherited an older shared Desktop helper
and failed the persisted Goal identity assertion. That group was rerun in a
separate application directory with the identical renderer build and current
Desktop helpers; all 14 session checks then passed. The shared runtime and
running user applications were not changed.

Composer acceptance verifies untouched draft/transport bytes, deferred preview,
keyboard opening without sending, same-link browser toggle, narrow wrapping and
bounded vertical scrolling, selection replacement across links, undo/redo,
plain-text paste/copy, and CDP-driven IME composition both beside and inside a
URL. The existing command discovery and model controls still pass. Additional
message-feedback and chat-quote checks verify scrolling, failure restoration,
and real native prose dragging from a focused editor back to quote insertion.
Programmatic quote fixtures blur the editor before creating a prose selection,
matching the native drag behavior. Focus/selection assertions remain intact.
Screenshots are `Desktop/test-results/composer-inline-links-{light,dark,narrow}.png`
and `Desktop/test-results/composer-links-preview-dark.png`.
These are isolated fixtures and deterministic-model evidence, not paid-model
semantic retention, cloud CI or packaged release acceptance. The user approved
the inline screenshot design on 2026-10-13; installer experience remains pending.
This follow-up is being submitted for source review. No package, shortcut update,
version bump or public release is included; its cloud CI remains to be verified.

## PR #108 review and CI follow-up (2026-10-13)

The P2 review identified controlled draft synchronization incorrectly emitting
the user-edit callback. Prop-originated editor transactions now carry explicit
metadata and do not update App draft state. User edits continue to emit changes.
The redundant asynchronous composition-end callback was removed so it cannot
bypass this transaction boundary; actual IME acceptance still passes.
A unit regression distinguishes both transaction sources; real Electron
navigation acceptance previews another cached draft, rejects navigation and its
recovery snapshot, then verifies the original draft survives both the immediate
failure and a later navigation/cache round trip.

The original head passed cloud interface and sessions checks, but run
`38387265685` exited natively with `3221226505` during the default Windows
command profile, without a JavaScript exception or assertion failure. The
command fixture now reports launch, environment, session readiness, submission,
execution and cleanup stages, plus Electron exits. All five Windows command
profiles and the extended navigation acceptance passed locally. This is not a
confirmed native-crash root-cause fix; replacement-head cloud CI must complete
before reporting the failed check recovered. No assertion, profile or check was
removed, no shared runtime was changed, and no installer was produced.
The follow-up passed type checking, production build, all 376 serial
unit/protocol tests, composer acceptance and `git diff --check` locally.

## Windows command integration acceptance (2026-10-13)

Based on main `8b35512` (including merged PR #105), the new
`Desktop/scripts/verify-windows-commands.mjs` exercises the staged, pinned
Step Code runtime through actual Electron preload/IPC/RPC and a local
deterministic HTTP model. No upstream source, personal profile or running
user application is changed.

The five isolated profiles verify default native Git Bash discovery without
Git on PATH,
non-default Git discovery through a cmd-only PATH, explicit `shellPath` in
Desktop-owned `step-runtime/config.toml`, rejection of a missing explicit
path without fallback, and a clear error when no native Bash is discoverable.
The non-default fixture copies actual Git Bash executables and DLLs to a path
with spaces, masks standard install locations, and asserts the actual native
Bash path. It is a shell fixture, not a complete portable Git installation.
Windows architecture environment entries are omitted in these profiles so
CreateProcess does not restore the default ProgramFiles locations.

Successful profiles cover explicit cwd with spaces, stdout/stderr, MSYS
utilities on the non-login shell PATH, and exit-code 7 failure propagation.
Background commands return a PID, isolated absolute log path and Windows
process-tree stop advice before a fixture-owned release file allows completion.
The log captures both streams and delayed output,
and the actual `read_file` tool returns it to the actor. Any tool confirmation
is clicked in the isolated application; this is not evidence of unattended
permission bypass. Background probes are finite and finish before shutdown.

The initial complete five-profile acceptance passed twice locally. The report is
`Desktop/test-results/windows-commands.json`. The new check is registered in
the full Windows runtime CI group with a five-minute timeout; all 43 previous
checks remain, bringing the inventory to 44.

PR #107's P2 review correctly identified that the initial default-location
profile could also discover Git on the host PATH. All profiles now restrict
PATH to Windows system directories, with only the path-install profile adding
the copied Git cmd directory; the default profile retains standard-location
variables and cannot fall back to PATH Git. The corrected five-profile
acceptance and all 12 CI policy/inventory/executor tests passed locally.

The pinned upstream shell-discovery, run-command-timeout and tool-profile
suites passed 73 tests with one skipped. An additional exploratory
`step-shell-path.test.ts` run failed five Unix-profile migration cases because
their simulated Unix inputs contain Windows backslashes and trigger the safe
path rejection. The combined exploratory run was 74 passed, five failed and
two skipped. Those upstream tests and assertions were not changed.

Desktop production build, typecheck and all 365 serial unit/protocol tests
passed. All 12 CI policy/inventory/executor tests passed.

PR #107's corrected PATH head `840e7c2` passed the cloud interface and
runtime groups, including the five Windows command profiles. Sessions first
exited natively during model-switch acceptance (`3221226505`, no JavaScript
stack); a single failed-job rerun instead exposed a Goal completion mapping
failure. Upstream generates the live custom message timestamp and persisted
custom entry timestamp independently. A one-millisecond difference prevented
Desktop from assigning the custom input's history entry ID, hiding the Goal
completion footer despite the completed runtime state.

Desktop Goal inputs now carry a unique persisted metadata ID. Mapping requires
this ID, exact content and custom type on the active history branch; it does
not guess by text or clock tolerance. Legacy inputs without an ID retain exact
timestamp matching. Regressions cover independent timestamps, runtime reload,
later identical tasks, ambiguous IDs, foreign branches and the real input
producer. All 368 serial unit/protocol tests, typecheck, production build and
12 CI tests passed. Local acceptance uses an isolated Desktop extension
staging directory: the shared runtime junction initially loaded the previous
extension, which the added persistent-ID assertion detected. Those earlier
passes do not validate this repair. With the current extension, real Goal
launch acceptance passed twice consecutively, including the persistent-ID
assertion; model-switch acceptance also passed. The native crash remains
unexplained; local passes do not establish its cloud resolution.

This is source/staged-runtime acceptance, not fresh Windows installation,
real paid-model, packaged installer or release qualification. Remote CI and a
latest-source package still need verification before release.

## CLM inline references preview (2026-10-13)

PR #105's first cloud run passed interface and sessions, but runtime acceptance
read a snapshot immediately after forced-crash relaunch before renderer
navigation settled (`Execution context was destroyed`). Workflow snapshot
polling now waits for the preload bridge and composer DOM before reading.
All original crash, unknown-state, cache reuse and explicit resume assertions
remain intact. The corrected workflow-runtime acceptance passed three
consecutive local runs. Replacement cloud run `38353668743` for `5517a43`
passed all three Windows groups and the final gate.

The subsequent Codex P2 fix reuses `visibleInputBlocks` when extracting the
first user title, before truncating to 200 characters. The regression first
failed on the raw manual-CLM envelope, then passed with the compact command.
It covers string/multi-block input, unchanged canonical content, role
selection, ordinary text, Ultracode compatibility and title length.
Build, typecheck and the final full serial run passed all 365 tests. One earlier
run reported attachment-utils test-file startup failure; its isolated four-test
run and full rerun passed without attachment-code changes.
The next cloud run encountered a separate permission-fixture send race
(no user messages were dispatched after selecting Approve for Me). Its send
helper now waits for the enabled send action after filling the input; all
permission assertions remain intact. Three consecutive local runs passed.
That run also reported native exit `3221226505` in Ultracode restore without
a JavaScript stack; its local rerun passed. Restore phase diagnostics were
added without retries or weakened assertions; the native cause is not claimed
to be diagnosed.

The subsequent source-only anchor correction keeps the recognized icon at the
textarea's original text start rather than extending it into the left gutter.
First-line indentation reserves its extra width and restores on ordinary text.
Build, typecheck and composer acceptance passed, including an explicit anchor
position regression, IME, selection, model controls and narrow layout.
Screenshot: `Desktop/test-results/composer-command-reference.png`.
This correction is not included in the preview package recorded below.
The PR is based on main `0bb0272`, retaining the merged parallel Windows CI.
Both maintenance acceptance scripts are registered in its sessions group with
five-minute limits; all 12 CI policy/inventory tests passed. Manual-template
fixture readers restore LF after Git CRLF checkout; production recognition
remains strict and unchanged.

Command references now use an icon and accented name in the composer and sent
user text. The native textarea remains authoritative for selection, IME,
clipboard and transport; the visual prefix hides while selecting or editing
inside it. Command icon proportions and spacing follow the text size, including
the textarea's configured font. The strict known `/clm` status notification is
localized without internal paths; unrelated or incomplete notices remain
literal. This adds presentation only, not a CLM summary checklist.

Build and typecheck passed, as did all 364 serial tests. The local package
`Desktop/release/clm-command-reference-20261013/` passed packaged composer
discovery/command-marker/status, hidden-message history replay, maintenance
statistics/isolation and real CLM cancellation with explicit queued recovery.
Packaged manifest, Node, Step bundle, both runtime helpers, keyless-fetch and
terminal host match staging. Installer SHA256:
`9cfeccbfc055ac3f8ad7a2dfb6eed6c18801c331626a65c1c971eafa872dd1f3`.
Output before the checksum file totals 750,545,277 bytes. The desktop shortcut
targets this unpacked executable with no arguments and its own icon.
Five generated package directories were inventoried; none were deleted.
Existing user windows and canonical session files were preserved. This remains
a local 0.3.0 preview, not a public release, successful real-model manual CLM
reduction claim, installer lifecycle test, commit, push or PR.

## Manual CLM command presentation (2026-10-13)

The pinned runtime implements `/clm-compact` by submitting a generated ordinary
user message containing its mirror path, read-only index and edit recipe.
It does not provide a distinct message type or provenance flag. Desktop now
projects an exact known template to `/clm-compact` plus additional guidance
through its existing visible-input path. Matching validates the JSON-quoted
mirror path, matching index metadata and complete pinned recipe; ordinary,
partial and mismatched templates remain unchanged. This is a presentation
recognizer, not an authoritative origin signal. Model requests and canonical
JSONL history are untouched; assistant and tool messages remain literal.

Unit coverage verifies command restoration, no history mutation, multi-block
input and literal fallback. Electron hidden-message acceptance verifies live
delivery, history replay and preservation of raw fixture content. Evidence:
`Desktop/test-results/manual-clm-compact-replay.png`.
The user's requested session was inspected read-only without interrupting it.
Its generated manual command matches the projection, and the final answer
correctly recalled the fixed project requirements. However, the manual attempt
produced no persisted CLM checkpoint: its initial index had zero editable
plain-text bodies and prior assistant messages contained immutable thinking
blocks. The actor explicitly declined edits. This establishes retained
requirements in an unchanged conversation, not successful manual reduction.
The actor also performed diagnostic reads, so this is not a tools-free
maintenance sample. The clickable command reference/right-rail raw preview
was discussed as a later refinement and has not been implemented.

Build, typecheck and the final full serial run passed all 362 tests. An earlier
run failed at startup of the existing custom-provider test file; its isolated
13-test rerun and the subsequent full run passed without provider-code changes.
The new local preview is `Desktop/release/clm-manual-input-20261013/`.
Packaged acceptance passed hidden/manual-message live and replay presentation,
composer CLM discovery and model-layer interactions, and real CLM cancellation
with explicit queued recovery. Packaged Node, Step bundle, manifest, both
runtime helpers, keyless-fetch adapter and terminal host match staged/current
resources. The desktop shortcut now targets this preview with no arguments and
its own icon. Installer SHA256:
`980bdc6996be6593bc2f822c47b5d3c70670653be6e7613eb3ca50e007153388`.
Output totals 750,541,375 bytes. Four package directories were inventoried and
preserved without deletion. Existing user processes and session files were not
changed. No installer lifecycle, successful real-model manual reduction,
commit, push or public release is claimed.

## CLM discovery on PR #103 component (2026-10-13)

With user approval, the isolated CLM worktree was fast-forwarded to PR #103
head `d26f53a73ca43a4e4d2a5e9cc9cc6444d7373199`, retaining local CLM changes.
This is local integration of an unmerged PR, not a merge of that PR on GitHub.
The new composer menu exposes `/clm` and `/clm-compact` with localized labels
and existing menu styling. The pinned runtime handles these core commands but
omits them from `get_commands`; Desktop supplements the successful catalog
response and gives core names precedence without duplicate entries.
Selection fills the input only and does not dispatch a prompt.

Build, typecheck and all 360 serial Desktop tests passed. Composer-menu Electron
acceptance passed filtering, keyboard selection, no automatic dispatch, IME,
attachment references, cancellation, model picker and narrow layout.
Screenshot: `Desktop/test-results/composer-clm-dark.png`.
Context-maintenance presentation and real CLM cancellation/explicit queue
recovery acceptance also passed. The active-Goal RPC fixture now observes the
automatic continuation on session restore rather than racing it with an
additional ordinary prompt; CLM retention, completion and restart assertions
remain in place.

No upstream sources or another agent's branch were edited. No package, shortcut
update, commit, push or PR merge was performed for this component follow-up.
The shortcut still targets the PR #102 experience build recorded below.
These local-fixture results do not establish cloud CI or real-model acceptance.

The user subsequently requested packaging. The combined preview at
`Desktop/release/clm-composer-pr103-20261013/` passed packaged composer discovery,
real CLM UI cancellation/queued recovery, context-maintenance statistics and
Ultracode restart acceptance. Packaged Node, Step bundle, manifest, both runtime
helpers, keyless-fetch adapter and terminal host match current staged resources.
The ordinary desktop shortcut now targets its unpacked executable, with empty
arguments and its own icon. Existing running user windows were not stopped.
Installer SHA256:
`15e1ff806f2297324737e41ffdc0799e2372ec9868338537b242a77ecb8ad6b7`.
The output totals 750,537,788 bytes; this worktree's two package directories
were inventoried and preserved without cleanup. No installer lifecycle or
real-model acceptance, commit, push, PR merge or public release was performed.

The subsequent source-only overlap fix puts the model/effort popover above
composer discovery and limits discovery keyboard handling to its textarea.
The new regression failed against the previous build because all three
overlap hit-test points reached discovery instead of the model panel.
After the fix, composer acceptance verifies overlapping pointer hits, thinking
slider keys, secondary model-list access and foreground-only Escape in dark,
light and narrow layouts. Build, typecheck and command projection tests passed.
Screenshots are `Desktop/test-results/composer-model-layer-{dark,light}-1300.png`
and `Desktop/test-results/composer-model-layer-dark-840.png`.
This follow-up is not included in the package above and is reserved for the
next CLM PR; the other agent's PR and the desktop shortcut were not changed.

The user then requested a new combined package. The preview at
`Desktop/release/clm-menu-layer-20261013/` includes CLM discovery and the overlap
fix. Packaged composer acceptance passed both CLM entries, no dispatch on
selection, overlap pointer hits, slider keys, model-list access and Escape
scoping across dark/light/narrow layouts. Packaged real CLM cancellation/queued
recovery and context-maintenance statistics acceptance also passed.
Packaged Node, Step bundle, manifest, both runtime helpers, keyless-fetch
adapter and terminal host match staged/current resources.
The ordinary desktop shortcut targets this preview with empty arguments and
its own icon. Existing user windows and all three local package directories
were preserved. Output totals 750,537,772 bytes. Installer SHA256:
`4cd777f0a934a76097d5046f3a13f14803f9d55f3716c459114aa0d99e55b241`.
No installer lifecycle, real-model acceptance, commit, push or PR merge was
performed; this is a local experience build, not a public release.

## Combined CLM / PR #102 package (2026-10-13)

The CLM worktree was fast-forwarded to merged main `76ee986` (PR #102,
reviewed head `c94dc68`) and local CLM changes were reapplied. The only merge
conflict was additive verification documentation; both records were retained.
The local 0.3.0 preview is `Desktop/release/clm-latest-pr102-20261013/`.
It includes the latest merged Ultracode recovery work and the uncommitted CLM
statistics/cancellation changes described below. Typecheck/build and all 358
serial Desktop tests passed after integration.

Packaging first failed while dependencies were shared via a junction. A
worktree-local frozen-lockfile pnpm installation succeeded, and NSIS packaging
then succeeded without dependency version changes. Packaged acceptance passed
real CLM UI cancellation/queued recovery, context presentation, Ultracode
restart/one-turn consent, and workflow parallel/chain/history/stop-resume/cache/
changed-script/forced-crash recovery. These checks use local HTTP model fixtures.
Packaged Node, Step bundle, manifest and both runtime helpers match the staged
v0.1.4 resources (`3ba89e0`). No upstream source was edited for this package.

The ordinary desktop shortcut targets this package's unpacked executable with
empty arguments and its own icon. Existing user applications were not stopped.
Installer SHA256:
`095cb2996d2763ec2dfa5eabcdfda46f7b59b5c799e86588551f6e621ff904cb`.
Package output totals 750,566,814 bytes. Old packages were not deleted.
No installer lifecycle test, real-model semantic retention acceptance, new PR or
public release was performed; this is a local experience build.

## PR #102 review lifecycle follow-up (2026-10-13)

Workflow binding metadata now follows session lifecycle: clone/fork copies only
workflow calls present in the new transcript and immediately rehydrates the new
worker; normal quit flushes pending writes after runtime shutdown; individual
and bulk archived deletion removes the matching binding file. Unit regression
covers retained/excluded calls, flushed writes readable by a new store, deletion
with a pending write and preservation of the source when removing a branch.
The real-runtime fixture verifies cloned interrupted history immediately retains
aborted status. Build, typecheck, nine focused tests, workflow recovery, session
branching and tray quit acceptances passed locally. Replacement cloud CI remains
required; no new package or merge was performed.

## Bound workflow interruption history (2026-10-13)

Real-model session acceptance confirmed identical original/resumed script hashes,
two cached steps and a completed third step. The original run's progress was
aborted while the parent tool error returned empty details. Desktop now persists
a session/call-to-run binding from structured runtime progress events under
userData. History hydration uses that binding and the matching startedAt to read
only bounded progress inside the workspace. Bound terminal progress supplies the
presentation status without rewriting the tool result or journal. No error-text,
script-name or timestamp-only matching is used; historical runs without a binding
are not retrospectively guessed.

Regressions cover persisted bindings after store restart, session/call isolation,
aborted versus failed state, mismatched startedAt and immutable original results.
The real-runtime stop/replay/crash fixture also checks that the aborted workflow
is hydrated as aborted despite empty error details. This follow-up is source-only
and is not included in the earlier local package documented below.

## Ultracode recovery local package (2026-10-13)

The isolated worktree was fast-forwarded to main `9422c94` before building
`Desktop/release/ultracode-recovery-20261013/`. This local 0.3.0 preview includes
the recovery presentation fix below. Frozen dependency installation and build
passed. Its unpacked executable passed workflow stop/replay/changed-script/crash
recovery, Ultracode restart/one-turn consent and workflow UI acceptance.
Packaged Node, Step bundle, manifest and both Desktop runtime helpers match the
staged v0.1.4 resources. The normal desktop shortcut now targets this package
with empty arguments. Existing user processes were left running.

Installer SHA256: `efd7be3207c229ec8c127512d605e3649129ecc24745a67c37756e0e7b68c310`.
Package output totals 750,504,202 bytes. No old packages were deleted. This build
does not include another agent's unmerged context-maintenance work. No installer
lifecycle, real-model acceptance, external review, PR or public release was performed.

## Workflow interruption and replay follow-up (2026-10-13)

The real-runtime fixture now aborts a sequential workflow during its second
child, resumes its journal and verifies actual provider request counts. The
completed first child is cached, the aborted second child runs again, and the
third child executes once. Changing the second call preserves the first cached
result but reruns both the changed call and its successor. Cached agent status
is also verified in the hydrated Desktop snapshot.

Forced termination of the fixture-owned Electron process tree reproduced a
presentation defect: the parent transcript has a workflow call without a final
tool result, while the on-disk progress still says running. Desktop inferred a
running orchestration after reopening an idle session. The presentation projection
now marks unresolved workflows and queued/running agents as unknown outside an
active turn. A new turn cannot reactivate unresolved workflows from older turns.
The transcript block and right-panel projection use the same rule. Stored history,
upstream sources and compaction/queued-message implementation are unchanged.

The forced-crash acceptance checks pending/unknown icons in both the transcript
and orchestration panel, then explicitly resumes the persisted run. Request counts
prove the committed prefix is reused and the remaining children execute. Child
sessions remain excluded from the main catalog. Screenshot:
`Desktop/test-results/workflow-crash-restored-unknown.png`.

Build, typecheck, all 343 serial tests, workflow presentation acceptance and the
extended real-runtime recovery acceptance passed locally. Tests use disposable
profiles and a local HTTP model fixture; only the fixture PID tree is terminated.
Recovery is explicitly invoked through `resumeFromRunId`, not automatic background
execution after startup. Real-model orchestration acceptance, replacement cloud CI,
packaging and release qualification remain outstanding.

## Ultracode / Subagent v0.1.4专项验收（2026-10-12）

Based on merged main `1cbbc11`, with staged upstream baseline
`3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`. No upstream runtime or
compaction/queued-message implementation was changed. Existing runtime resources
were copied into the isolated worktree; acceptance uses disposable profiles and
local HTTP model fixtures, without accessing the user's live sessions.

The real workflow acceptance now closes and relaunches Electron, opens the parent
session and compares all three persisted agent records against the settled
snapshot. It also verifies no new provider requests, no standing consent grant
and no child sessions in the conversation catalog. Readiness waits distinguish
the initial proposed-session screen from a connected worker and allow asynchronous
workflow history hydration to finish before comparing records.

The Ultracode restart acceptance now covers one-turn input, cleared launch state
after settlement, an ordinary follow-up without a new opt-in reminder, and restart
without restoring expired one-turn consent. The historical reminder remains in
its original turn; its presence is not a fresh authorization. Existing checks
cover persisted session on/off, one standing reminder and new sessions opted out.

Build, typecheck and 19 focused workflow/subagent tests passed. Real-runtime
workflow restart acceptance passed twice with its final assertions; the extended
Ultracode restart acceptance also passed.
Real-runtime chain acceptance passed success, failure and cancellation, including
previous-result handoff and skipped successors. Background-subagent acceptance
passed cross-turn updates, reload, failure, interruption and follow-up. Workflow
UI acceptance passed final history, failure/interruption/cache/budget states,
panel interaction, light/narrow layout and session isolation. `git diff --check`
passed. No product defect requiring an implementation change was reproduced.

This evidence does not establish abrupt-process-crash recovery, explicit
`resumeFromRunId` cache replay and changed-script invalidation, or real-model
orchestration quality. No installer, shortcut change, PR or release qualification
is included. The full Ultracode P0 remains open pending those remaining checks.

## CLM v0.1.4 adaptation (2026-10-12)

The final Electron follow-up identified and fixed a renderer-only cancellation
gap: the composer disabled Stop while maintaining context, and its stop handler
required ordinary streaming. Stop now accepts the existing composer busy state
and invokes the existing IPC abort path during maintenance. No upstream changes
are needed. The previous presentation assertion is updated to require enabled
Stop rather than preserving the inaccessible cancellation behavior.

New real Electron acceptance seeds isolated long history and holds an actual CLM
HTTP request, sends a draft through the composer into the Desktop queue, then
clicks Stop. It checks maintenance ends, no CLM checkpoint or native compaction
is committed during cancellation, and the undelivered draft remains paused.
Explicit queue recovery uses the public preload/IPC bridge with CLM still enabled.
The cancelled attempt enters upstream cooldown; native threshold compaction
remains available and occurs once during recovery. The actor receives fixture
summary evidence and the queued user message is persisted once. Native compaction
may retain recent canonical text; replacement of that text is not asserted.
This is real UI/IPC/runtime lifecycle evidence with a deterministic model, not
proof of semantic summarization quality. The check runs under the full Windows CI
path with a five-minute step limit and bounded process/server cleanup.
After the Stop fix, final build/typecheck, real Electron CLM cancellation,
context-maintenance presentation, Ultracode restart acceptance, diff whitespace
validation and all three CI policy tests passed. The preceding 356-test full
suite remains the unit/protocol result; the final change is the renderer stop
guard, covered by these final Electron checks.

2026-10-13 follow-up adds three real staged-runtime RPC tests using a local
deterministic HTTP model. They seed editable long history, trigger automatic CLM
without an explicit projection setting, assert an accepted edit and no native
fallback, and inspect actual actor payloads for the projected evidence and
protected user requirement. Canonical JSONL history remains intact. Maintenance
and actor usage (including Goal completion review) each contribute once.
All three passed: Plan survives maintenance/restart and submits a proposal for
approval before exiting planning; paused Goal survives restart; active Goal
completes and restores as complete. A Desktop fork before the old user message
does not inherit the later Goal or CLM checkpoint, and reopening the source
still uses its original accepted projection. These tests run in the normal
Desktop protocol suite and do not modify upstream source or personal profiles.
Two subsequent staged-runtime recovery tests also passed. An invalid offered ID
is rejected with maxRequests=1, triggers exactly one successful native compaction,
persists one compaction entry and continues the actor and queued follow-up.
A held maintenance stream is cancelled via abort after the Desktop queue is paused;
maintenance ends without fallback or an accepted working-context checkpoint.
The undelivered draft stays paused and is delivered exactly once after explicit
recovery. Recovery uses /clm off to avoid re-entering the deliberately held
maintenance fixture; it does not prove a second CLM attempt after cancellation.
These tests use actual SessionRuntimes, PendingMessages and the staged RPC child,
not the Electron IPC command handler or injected maintenance events.
Final typecheck, diff whitespace validation and the full serial Desktop suite
passed with all 356 tests, including all five real-CLM scenarios.

Based on merged PR #101, maintenance completion now requests authoritative
`get_session_stats` totals without reloading messages or ending the running turn.
The renderer updates both the context ring and inspector. Desktop does not add
maintenance usage itself: the pinned runtime already includes it in totals.
Request ordering prevents older snapshots from overwriting newer statistics;
disconnected workers, replaced transports and changed session identities discard
late results. Read failures preserve the last known totals. Late provider usage
that arrives after maintenance completion is still picked up by the next ordinary
snapshot refresh; this change does not introduce continuous usage polling.

Local validation: typecheck/build, all 350 Desktop unit/protocol tests, the new
Electron context-maintenance presentation acceptance, and real-RPC send-queue
acceptance passed. Presentation injection verifies maintenance labels, occupancy
updates and background-session isolation; it does not cause real CLM maintenance.
Nine new transport tests cover usage refresh, duplicate completion, fallback
ordering, stale snapshots, disconnect, replacement, session change and read errors.
After adding the final asynchronous history-decoration guard, typecheck and all
77 focused maintenance/runtime/queue tests passed, as did the three CI policy tests.

Read-only testing against the pinned upstream checkout ran six suites covering
automatic CLM, completion, live context, task-context snapshots, maintenance
controller and defaults: 83 passed, one Python-dependent test skipped. Three
additional suites (Plan extension, Goal abort regression, bounded context reads)
returned 22 passed and one failed. The failing test creates a file symlink;
an isolated OS probe also returns EPERM on this host. No upstream source or test
was changed to bypass that restriction.

P0 remains open. These are deterministic local tests, not real-model acceptance
of semantic retention. Remaining acceptance includes real long-context retention,
task-list
retention through maintenance, and the symlink case on a capable Windows host.
No installer, shortcut update, PR, cloud CI result or release qualification is
included. Runtime and dependencies are reused through local junctions; generated
build/terminal output is retained for acceptance and no old packages were deleted.

## PR #101 Queue and CI Follow-Up

The `79d6f79` Windows run finished earlier checks in approximately ten minutes,
then model-switch acceptance asserted before the new-session draft was ready.
Its failure cleanup remained blocked until the next push cancelled the run.
The fixture now polls IPC snapshots for draft readiness before the unchanged
assertion, closes provider connections before Electron, and bounds cleanup to
15 seconds. The CI step also has a five-minute limit. Model-switch acceptance
passed locally and exited normally; full replacement cloud CI remains required.

Local review identified that the pinned runtime emits `compaction_start/end`,
not the legacy `auto_compaction_start/end` names. Desktop now handles the native
events in worker busy-state projection, snapshot publication, queue completion
and renderer maintenance presentation, while retaining legacy compatibility.
Transport regressions cover native success, failure, cancellation and CLM
fallback, including duplicate completion and paused-queue guards. All 342
Desktop tests, typecheck, build and Ultracode restart/presentation acceptance
passed locally; replacement
cloud CI is required before treating this source follow-up as validated remotely.

The second P1 fix treats context maintenance as a queued-send condition in both
the main-process prompt router and the composer. Maintenance beginning during
asynchronous attachment validation is rechecked before dispatch. Steering is
rejected while maintenance is active, preserving the queued receipt for later
delivery. Empty input cannot issue an ineffective stop during maintenance.
Focused queue tests, typecheck/build, maintenance presentation and real send-queue
acceptance passed locally. The presentation fixture checks Queue message and the
disabled stop state separately from the transport-driven queue lifecycle tests.
This fix remains source-only pending its replacement cloud CI.

The P1 review fix routes `auto_clm_end` and `auto_compaction_end`, as well as
`agent_end`, through the existing pending-message completion path. Maintenance
ends after the busy flag is cleared, allowing blocked follow-ups to drain without
an unrelated user action. Existing pause, failure, interruption, reservation and
receipt guards remain in place. Transport-driven regression tests exercise both
blocked completion attempts, maintenance completion, duplicate events and
explicitly paused queues.

The Windows CI failure at the concurrent-session fixture's dialog-count assertion
is addressed by awaiting the destination composer draft and the outgoing approval
drawer's removal before asserting zero dialogs. The assertions still require a
background request to remain invisible and reappear when its owning session opens.
Source typecheck/build, all 336 tests, two consecutive concurrency acceptances
and send-queue acceptance passed locally. This follow-up is not in the preview
installer above; cloud CI must validate the replacement commit independently.

## Step-Code v0.1.4 baseline integration

2026-10-12 source upgrade from merged PR #100 (`af40f5b`): the runtime is
pinned to upstream commit `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`.
This is a commit baseline containing the announced v0.1.4 changes, not a
verified upstream release tag. Both Desktop patch files apply unchanged;
existing source and patched-source hash guards still pass. Frozen dependency
installation, upstream build and runtime staging passed with Node v24.15.0.
The optional `cpu-features` native build failed locally without preventing
installation or the runtime build.

Desktop now consumes native Ultracode standing-status notifications, including
restoration after runtime restart, and automatic CLM maintenance events. CLM
uses the existing compaction busy guard and a visible context-maintenance pulse;
it does not enable orchestration or mark old conversations as new model output.
The launch fixture checks that ordinary follow-up turns do not repeat capability
guidance or inherit single-turn orchestration consent. Goal completion approval
waits for the specific fixture request and verifies its removal after a real
approval-button click, avoiding an early exit on a transient completion snapshot.

Source typecheck/build and all 332 Desktop tests passed. General Electron,
permission tiers, real chain/workflow runtime, session concurrency, Plan review,
Goal/launch and Ultracode restart acceptance passed using isolated profiles and
local deterministic providers. A separate injected-event presentation check
verifies that CLM maintenance appears while the model is not streaming and clears
on completion; actual CLM lifecycle behavior is covered by upstream tests.
CI policy tests passed, and full Windows CI includes Plan, shell, Ultracode,
focused automatic CLM suites and the restart acceptance with independent exits.

The focused nine upstream files passed 185 tests. Broader exploratory upstream
runs were not fully green: one 19-file run passed 492 and failed five; an
additional six-file CLM run passed 59, failed one and skipped one. The six
failures comprise two Windows escaped-path guidance assertions, three symlink
permission cases and one Git quoted-path assertion. These failures have not
been hidden or fixed by weakening upstream tests. They remain limitations of
this host's broader upstream validation.

This upgrade does not establish paid-model CLM behavior across every combination
of Plan, Goal, steering and branching, installer lifecycle acceptance or release
readiness. Initial source verification did not package or publish the upgrade.
Existing application processes, packages, the personal upstream
checkout and the previous staged upstream build were preserved.

2026-10-12 packaging follow-up: `Desktop/release/upstream-v014-preview/`
contains a local `0.3.0` preview installer and unpacked application. Packaged
general Electron, Goal/launch, Ultracode restart (including CLM presentation)
and Plan review acceptance all passed with isolated profiles. Packaged manifest,
Node, Step Code bundle, both Desktop helpers and terminal host match staged
resources. The ordinary desktop shortcut now targets this preview with no demo
arguments; running application processes were not stopped. Installer SHA-256 is
`2d34a0121563d6bdfeee7d3a3c1c9b9afbc25819dafce1ae65ab40094f6e1af9`.
The new directory totals about 715.73 MiB and was inventoried without deleting
previous packages. This is not an installer execution or public release check.

## Desktop Plan integration

2026-10-12 PR preparation: the final source passed typecheck/build, all 331
Desktop tests, 133 tests across the pinned runtime's four Plan test files,
general Electron, Goal/launch and Plan review acceptance. Both runtime Plan
tests and dedicated Plan Electron acceptance are included in full Windows CI,
with independent exit-code checks. Latest local refinement navigation and
execution-disclosure anchoring remain source-only; no new installer was built
for this PR preparation and no cloud-CI success is inferred from local results.

2026-10-12 execution-disclosure anchoring follow-up: the status trigger stays in
the existing pulse/footer flex line while only its disclosure occupies the next
line. Running details align below the trigger; settled details retain right-edge
alignment. Hidden footer visibility applies to the trigger rather than a layout
wrapper. Source typecheck/build and Plan Electron acceptance passed with relative
anchor-position assertions for opening/closing, narrow containment, hover-hidden
footer and the refinement/recovery regressions. Screenshots are
`plan-execution-running-anchored.png` and `plan-execution-completed-anchored.png`
under `Desktop/test-results/`. A first acceptance attempt timed out starting the
next Plan turn; explicitly awaiting the armed state before sending passed the
rerun. This frontend follow-up is not in the existing installer.

2026-10-12 local refinement navigation follow-up: opening the feedback editor no
longer answers the native review request. Back to review preserves the pending
approval and draft without resuming the model or ending the turn. Only submission
advances the native select/input handshake. Source typecheck/build and Plan Electron
acceptance passed, including back-to-approval, draft retention, defer/reopen and
actual refinement submission. This follow-up is not in the package below.

2026-10-12 execution-status follow-up: successful native Plan approval adds an
inline approval note, an active execution pulse and a hover-hidden settled footer.
Each disclosure renders the approved Markdown snapshot, not a later file version.
Ordinary new turns clear ownership; steered messages retain it. Failed/interrupted
execution has separate labels. A normal execution-turn end is not independent
verification that every Plan requirement was fulfilled.

Typecheck/build and 331 Desktop tests passed. The package at
`Desktop/release/plan-execution-status-20261012` passed Plan and general Electron
acceptance with isolated profiles and a deterministic provider. Coverage includes
single approval-note rendering, snapshot immutability, running light/dark/narrow
layouts, disclosure bounds, hover-hidden footer, next-turn isolation and the prior
stale-snapshot/expiry/fresh-review regressions. The ordinary desktop shortcut
targets this build without interrupting the running application. Installer SHA256:
`7055f155acae790dbde3aa384e512eb9166bca6d91c6a2ba4dafdd9f656198dc`.
No new paid-model acceptance, installer lifecycle test or PR is claimed. Fourteen
release directories total approximately 9.5 GiB; they were inventoried, not deleted.

2026-10-12 review-loss follow-up: the real notes session ended review after exactly
120 seconds. The previous motion package contained a stale two-minute compiled
runtime even though source advertised four minutes. Staging now recompiles the
coding agent before bundling; source hashes are not treated as compiled provenance.
Expiry/cancellation wording no longer falsely attributes expiry to the user.

A deterministic delayed pre-request snapshot reproduces drawer disappearance in
the previous packaged renderer (`--legacy-repro` fails the drawer-preservation
assertion). UI request/expiry events now advance the renderer revision watermark.
This confirms the race exists, not that it uniquely explains the user's incident.
Ended reviews retain a history-derived reentry while Plan remains enabled. A click
sends a visible request to resubmit the current proposal, requiring new runtime
approval rather than reviving expired authorization.

Typecheck/build, 327 Desktop tests, 80 upstream Plan-extension tests, general
Electron and permission-drawer acceptance passed. Real-runtime Plan acceptance
with the user's complete Chinese proposal and acknowledged Full Access passed:
delayed snapshots, approval/refinement, ordinary follow-up reentry, reload/restart,
changed-proposal rejection and accelerated main-process expiry. This is isolated
deterministic-provider evidence, not a new paid-model acceptance.

The replacement `Desktop/release/plan-review-recovery-20261012` passed packaged
Plan acceptance (complete Chinese proposal plus acknowledged Full Access) and
general Electron acceptance. All staged bundle chunks, entry, native Plan
implementation, manifest, Node and Desktop helpers match the package. Installer
SHA256: `433c4f16e540cfe79a2de829a38727c803ebca585d1ff13f0105776cca03eaab`.
The ordinary desktop shortcut now targets this replacement; the running user
application was preserved. No paid-model retest, installer execution or PR.

Motion/coverage follow-up: dragging now changes the drawer height continuously,
then settles to the chosen size with the existing approval easing. The review
entry reuses permission-review flow/breathing animations. The drawer covers the
composer and runtime metrics through its exit animation; feedback focus retains
the normal border without an accent outline or shadow. Typecheck, build and Plan
Electron acceptance passed, including continuous drag, animated entry, full
underlay coverage and feedback focus-style assertions. This source follow-up
is packaged in `plan-drawer-motion-20261012`. Packaged Plan and general Electron
acceptance passed, and runtime file hashes match staging. The ordinary desktop
shortcut points to this build. Installer SHA256:
`a8e304ead8b1063055d43f887ec65b661b9a0c14f344e590ce4f5a9ee7da007b`.

Drawer follow-up: source typecheck/build, all 96 upstream Plan/review tests,
Plan Electron acceptance and existing permission-approval Electron acceptance
passed. The Plan fixture verifies non-modal composer anchoring, rendered Markdown,
two sizes, defer/reopen without runtime continuation, narrow bounds and the prior
approval/refinement/cancellation/restart boundaries. Review/feedback waits are
four minutes each in source; the compiled-package freshness issue above was found
later. The follow-up package `Desktop/release/plan-drawer-20261012`
passed packaged Plan and general Electron acceptance. Packaged runtime hashes
match staging. The ordinary desktop shortcut points to its unpacked executable.
Installer SHA256: `10f6734d5cb4a50f49ee3689a57ae7d735bd62dc33b374a1e73fc3b5ada2ab67`.

Plan remains on the `7d86143586f7b5d0458ffd5e4b90642d7c22459b` baseline.
The guarded Desktop integration patch enables model-visible, ephemeral Plan
context on every model call and a blocking main-worker RPC review. Ordinary RPC
children do not receive the opt-in flag. Proposal approval is checked against
the current history leaf, path and full contents before editing tools are restored.
Commands retain upstream permissions; Plan is not a read-only sandbox.

Local validation: Desktop typecheck/build and 325 serial tests passed. The pinned
runtime's Plan/review tests passed 96/96, including pending approval, cancellation,
changed proposals, changed history, abort and refinement feedback. Electron Plan
acceptance uses the real runtime with a deterministic local SSE model: an ordinary
file write is blocked during Plan; the proposal can be written; review prevents
model continuation until approved; approval resumes execution; refinement returns
feedback; cancellation terminates without repeated review. Stale responses and
changed-file approvals are rejected. Renderer reload and application restart
retain Plan without restoring an approval, and the resumed request receives Plan
context. Dark/light/narrow captures are in `Desktop/test-results/plan-review-*.png`.

Existing launch modes, permission tiers and general Electron acceptance passed.
Upstream child environment and chain-result tests passed; the broader workflow
runtime suite had one Windows EPERM failure creating a symlink (31/32 combined
tests passed), which was not bypassed. The guarded patch was reconstructed from
clean pinned sources and matched the prepared Plan files after LF normalization.

This is local deterministic acceptance, not a paid-model, cloud CI or installer
acceptance claim. No public PR was created.

The local preview `Desktop/release/plan-review-20261012` contains the Plan
integration and the PR #99 permission-cancellation fix. Packaged Plan Electron
acceptance passed, including application restart and review cancellation. Runtime
manifest, Node, Step bundle and management/session helpers match staging by SHA256.
Installer SHA256: `41f1fc8cbfa3b5eacedd7ccc54d5205f198f6ef2b356614ef2330b6b32c1df8f`.

## Permission Tiers

The PR #99 P2 follow-up reproduces an error banner after deliberately cancelling Full Access. The main process now distinguishes explicit native cancel-option/Escape responses from expiry or an unexpected activation failure. Cancellation returns a separate IPC result; draft first-send restores its input, quotes and attachments and stops without calling the model or reporting an error. Other activation failures remain errors. Unit coverage distinguishes grants, cancellation, unrelated dialogs, expiry and late responses; actual RPC/Electron acceptance checks draft cancellation, both existing-session cancel paths, unchanged permissions, preserved input and no error banner. Typecheck, build, all 324 serial tests, permission-tier and new-session acceptance passed locally. This source-only follow-up does not update the prior installer or shortcut; the original head's cloud CI passed, and the replacement head requires its own CI result.

The 2026-10-12 source pins upstream `7d86143586f7b5d0458ffd5e4b90642d7c22459b`, the merge of PR #235, before the later default-model change. The existing guarded Desktop patch applies unchanged. A separate build checkout and staged Windows Node v24.15.0 runtime were used; the user's upstream checkout and personal Step Code profile were not modified.

The composer exposes Ask, Approve for Me and Full Access, independently of thinking levels and task launch controls. Full Access uses upstream risk acknowledgment, with localized labels that preserve exact native response values, cancel-first focus, Escape cancellation and a maximum two-minute expiry. Draft first-send waits for consent before calling the model; cancel restores the input. Session-only grants are not replayed during worker reconstruction or inherited by clones. Remembered grants are restored by upstream. Retired read-only, bypass and autopilot settings resolve to Ask in both management and actual workers. Explicit native tool deny/confirm overrides and Desktop's separate cross-session approval remain enforced.

Typecheck, production build and all 323 serial unit/protocol tests passed. Dedicated `verify-permission-tiers.mjs` acceptance uses actual pinned JSONL RPC with an isolated localhost provider: three-entry menu, no eager draft worker/history, first-send confirmation/cancellation, routine file write, hazardous-command denial in Approve for Me and execution in Full Access, clone isolation, session-only versus remembered relaunch behavior, renderer reload, Chinese/English and light/dark/narrow layouts. Its command-removal probe only removes a freshly created empty directory within the isolated fixture profile. Native tests additionally verify explicit deny/confirm overrides; mock-clock tests verify expiry and rejection of late responses.

General Electron, launch controls, new-session drafts, branching, turn undo, chain/workflow runtime, summary, permission approval, session concurrency, custom-provider and cross-session regressions passed locally. Branching was rerun after the final permission-lifecycle changes. Screenshots are `Desktop/test-results/permission-tiers-{menu-dark,risk-dark,risk-narrow,risk-light-en}.png`. This is source/local-fixture evidence, not paid-model, installer lifecycle or cloud CI acceptance. No installer, desktop shortcut update, commit, push or PR was produced in this turn.

The subsequent user-approved package is `Desktop/release/permission-tiers-20261012/`, still version 0.3.0 for local preview. Packaged permission-tier, general Electron and Goal/Plan/Ultracode launch acceptance passed against its unpacked executable. The package is based on merged main `b242667` plus this permission adaptation; unrelated unmerged workspace changes are not included. Its manifest, Node, Step bundle, management helper and session adapter match staging. Installer SHA256 is `d3cddac637599a586020f08e2d2b4130fcd9cd8e76c2f38ff8c43e44ed1fdd79`; `SHA256SUMS.txt` accompanies it. Authenticode status is `NotSigned`. The ordinary desktop shortcut targets this package with empty arguments; existing user windows remain on their previous executable until reopened.

Before adding the checksum file, this output totaled 729,084,241 bytes. Eight older outputs in this worktree were inventoried and retained without deletion; the user's live composer preview is in another worktree and was preserved. The separate upstream build is approximately 321 MB and staging approximately 125 MB. No paid-model, cloud-machine or installer lifecycle acceptance, upstream permission-policy edit or public release was performed. GitHub CI must still be checked on the submitted PR head.

## Goal Launch Controls

The 2026-10-12 source-only PR #98 follow-up scopes completion notifications to a transport-local run generation and records the notified generation. Delayed Goal callbacks cannot notify for an earlier run after a later run has started or finished, nor after worker disposal, disconnection or transport replacement. A regression reproduced two completion events from two successful iterations sharing a pending launch read before the fix. The corrected test covers all four terminal attention states, newer running/failed runs, process exit and replacement; successive ordinary runs still notify individually. Typecheck, build, 109 focused tests, actual pinned Goal RPC/SSE acceptance and general Electron acceptance passed locally. The package and desktop shortcut are unchanged; cloud CI remains a separate verification.

The PR #98 review follow-up reconciles both enabled and disabled draft launch choices when an empty resident worker is reused, without requiring unsupported mode commands for ordinary fresh drafts. Shared visible user-message classification includes Desktop Goal inputs in navigation, review turn numbers/timestamps, workflow and live-diff boundaries, context user counts/filtering and user arrival presentation. Internal continuation messages remain excluded from user boundaries. Background Goal completion/intervention notifications now recognize complete, blocked, usage-limited and budget-limited states after the authoritative asynchronous refresh, with no replay from history or duplicate end events.

Source typecheck/build and 107 focused tests passed, together with launch, workflow, Context/navigation and general Electron acceptance. Launch acceptance reuses the actual empty worker after arming Plan/Goal plus Ultracode and verifies that a new ordinary draft clears those choices without creating messages. The initial cloud CI failure at the post-send Plan composer assertion was a snapshot/render ordering race: the assertion now waits for the consumed badge to leave the composer and the settled pulse to appear, without relaxing the final assertion. These follow-ups are source-only; the prior local package and shortcut are unchanged. Replacement cloud CI results must be checked separately.

The replacement CI passed that Plan transition check but exposed a short-path alias in the new reuse fixture: Windows supplied `RUNNER~1` through Temp, while workspace connection canonicalized it to the long user path. The fixture now resolves its workspace with `realpath` before registering or reusing it, preserving the same-worker and disabled-mode assertions. Source launch acceptance passed after this fixture correction.

The completed-Goal isolation fix derives a completion owner from the upstream active history branch, without editing upstream data or runtime code. Visible Desktop Goal inputs receive exact saved entry IDs. Completed Goal controls remain on their owning response footer, never on a later task's pulse or footer; completed Goal Ultracode intent no longer becomes current-turn status. First completion ownership survives later completed-state edits. Missing/ambiguous owners fail closed instead of using the newest reply. Dedicated unit and actual pinned RPC/SSE acceptance cover completion followed by a normal running task, unchanged native complete state, absent inherited Ultracode status, preservation of the original footer and renderer reload.

The isolation package is `Desktop/release/launch-goal-isolation-20261011/`, local version 0.3.0. Typecheck/build and 17 focused Goal/history tests passed, as did source launch, workflow and general Electron acceptance. Packaged workflow and general Electron acceptance passed. Packaged launch acceptance timed out twice waiting for the completion marker after resume, then passed when rerun separately; failure-state diagnostics were added without weakening assertions. This does not establish that the intermittent timeout is resolved.

The full serial suite is not green: the existing terminal-count test fails during process-tree cleanup and leaves its runner waiting. A force-exit diagnostic reported 308/312 passes, including three Windows libuv file-runner aborts; those three files passed all 10 tests when rerun normally. Neither terminal implementation nor its tests were changed. This is focused regression evidence, not full release qualification.

Packaged manifest, Node, Step bundle and both helpers match staging; no runtime restaging occurred. Installer SHA256 is `53cc0b1f0202da76f47735e8554024801de6d3d6bfca14330a13b1464a4ba3d3`; the output totals 723,932,049 bytes. The ordinary desktop shortcut now targets the isolation package's unpacked executable with empty arguments. Existing user windows and older packages remain untouched. No paid-model or installer lifecycle test, upstream checkout edit, commit, push, PR or public release was performed.

The footer alignment correction places retained Goal and Ultracode controls in the final response's existing footer row rather than adding a separate row below it. Left-side copy/branch/timing controls retain hover/focus visibility; right-side status stays visible. Expanded Goal details remain open when pausing moves the entry from pulse to footer. No-renderable-response cases retain a standalone management fallback. Source workflow acceptance checks same-row vertical alignment, non-overlap, default hidden versus persistent visibility, hover reveal and light/dark/narrow layouts; existing timing and general Electron regression acceptance passed.

The corrected package is `Desktop/release/launch-footer-20261011/`, still local version 0.3.0. Typecheck/build, all 307 serial tests and source/packaged launch and workflow acceptance passed; packaged general Electron acceptance passed as well. The launch fixture verifies pause management survives reanchoring and Goal/footer geometry after entrance settles. Packaged runtime manifest, Node, Step bundle and both helpers match staging. Installer SHA256 is `5703536b6c676d970ef151f1590467630bc0746a46370f45faf57c59624624d3`. The ordinary desktop shortcut targets this unpacked executable with empty arguments. Output totals 723,925,372 bytes; six older previews were inventoried without deletion. The user's running `launch-pulse` window remains untouched. No upstream checkout edit, paid-model or installer lifecycle test, commit, push, PR or public release is included.

The Ultracode follow-up retains the current turn's workflow summary at the transcript right edge after the parent task ends. It uses the existing status symbols for reported completion, failure, interruption and budget exhaustion. Missing final state is explicitly unknown without a running summary icon. The same summary opens/closes the matching Orchestration inspector, does not arm the composer, and is removed for an unrelated new turn. Typecheck/build, all 307 serial tests and source launch/workflow/general Electron acceptance passed. These are isolated runtime/fixture checks, not new paid-model acceptance.

The updated local preview is `Desktop/release/launch-settled-20261011/`, version 0.3.0, including both the right-aligned Goal disclosure and Ultracode summary. Packaged launch, workflow and general Electron acceptance passed. Workflow coverage includes standalone summary positioning, reopen/close, all reported terminal outcomes, missing-final-state presentation, light/dark/narrow screenshots and unrelated-turn isolation. Packaged runtime manifest, Node, Step bundle and both helpers match staging. Installer SHA256 is `e56ef732e80c052cbd4884b4a76aec815daba20ae3873c6efb5c47693cd248a6`. The normal desktop shortcut targets this unpacked executable with empty arguments. The directory totals 723,923,947 bytes; five earlier outputs were inventoried and retained without deletion, including the live user's preceding `launch-pulse` build. No user process was stopped, upstream checkout changed, installer lifecycle tested, commit/push/PR made or public release published.

The subsequent source-only alignment adjustment keeps active status beside the working pulse and moves idle status to the transcript's right edge. Idle details unfold downward, right-aligned, without depending on hover-hidden assistant footer controls. Typecheck/build and source launch/workflow acceptance passed, including right-edge geometry in light/dark/narrow layouts and absence of an idle running dot. Geometry is sampled atomically to avoid mixing separate frames during layout transitions. This adjustment is not included in the previously packaged `launch-pulse-20261011` preview.

The subsequent pulse-layout follow-up separates pending composer choices from actual task state. Submission consumes pending choices; Goal management moves beside the working pulse. Its secondary surface unfolds downward inline, aligned to the trigger, with sampled intermediate entrance/exit heights and reduced-motion handling. Workflow progress retains its separate entry and existing Orchestration inspector. Paused and completed Goals retain a quiet access point.

Ultracode selections use the native per-turn `ultracode:` input convention rather than enabling standing session authorization. Only the exact Desktop two-newline prefix is removed from user-message presentation; original input and attachments remain in runtime history. FIFO entries capture their own opt-in, including edits and steering, without passing consent to later entries. Goal-plus-Ultracode retains opt-in in the native objective throughout that Goal, while presenting the original objective. Explicit standing slash commands remain supported and separately scoped.

Source typecheck/build, launch, workflow, real RPC/SSE concurrency and approval acceptance passed for this follow-up. Launch acceptance verifies actual pinned runtime Goal commands and a deterministic localhost provider, single-task consent, queue steering, original message presentation, and no inherited opt-in on the next task. These checks do not establish paid-model behavior or installer lifecycle acceptance. The separately maintained upstream checkout remains untouched.

All 307 serial tests and source general Electron/new-session acceptance passed. The local preview at `Desktop/release/launch-pulse-20261011/` passed packaged launch, workflow and general Electron acceptance. Packaged manifest, Node, Step bundle and both runtime helpers match staging. Installer SHA256 is `ea9ba6bf909cb2626b56d1d1a3035bb78ca08a59a6a0c73a6ea0c68e0c7babbc`. The ordinary desktop shortcut targets its unpacked executable with empty arguments. Its directory totals 723,922,526 bytes; four older outputs were inventoried without deletion. Existing user windows were preserved. Version remains 0.3.0 for local preview only; no commit, push, PR, public release or installer lifecycle test was performed.

The 2026-10-11 local preview adds optional Plan, Goal and Ultracode controls above the existing permission presets. There is no Normal mode. Draft selections create neither a runtime nor a session before sending. Plan and active Goal are mutually exclusive; enabling Plan pauses rather than clears an existing Goal, and leaving Plan never implicitly resumes it. Ultracode is independent. An adjacent compact status control opens anchored Goal management, including objective editing, pause/resume, clearing and token budget.

Controls use native runtime commands and active-branch Goal history; Desktop does not add a scheduler or modify the upstream checkout. Goal input and attachments are preserved through a Desktop-owned adapter command before native Goal continuation. Counters represent persisted upstream measurements. Active connected Goals keep their workers resident and suppress premature per-turn completion notices.

Typecheck, production build and all 304 serial tests passed. Dedicated isolated-profile acceptance uses the actual pinned RPC with a deterministic localhost SSE provider, verifying draft arming, image input, Goal start/pause/edit/budget/resume/completion/clear, Plan preservation, reload persistence, keyboard controls and light/dark/narrow layouts. Existing new-session and permission-approval acceptance also passed. These fixtures do not establish paid-model behavior, clean-machine installation or cloud CI success.

Runtime staging retains the already verified bundle pinned to `f7392089e67d80232b73c87f894dec8100c6c20a` with Node v24.15.0; the updated Desktop session adapter is copied into staging. The separately maintained upstream checkout is not changed or restaged from its newer HEAD.

General Electron, workflow and real RPC/SSE session-concurrency regression acceptance passed. The local package at `Desktop/release/goal-launch-20261011/` remains version 0.3.0 and is not a public release. Packaged general Electron acceptance passed; after replacing the Goal symbol with the library's flag-and-target icon, typecheck/build and source/packaged Goal acceptance passed again. Packaged manifest, Node, Step bundle and session adapter match staging. Installer SHA256 is `306421aba7561ce8f046a2ecbf9f65f541daa510511fbcf38afc1cbb9aa71963`.

The ordinary desktop shortcut targets this package's unpacked executable with empty arguments. The new directory totals 723,904,996 bytes; two previous local previews were inventoried and retained without deletion. Existing user windows were preserved and continue using their previous executable until reopened. No installer execution, paid-model acceptance, commit, push or PR was performed.

The initial preview's Ultracode confirmation parser recognized legacy Ultraloop notifications only. The pinned runtime uses Ultracode wording, so enabling succeeded upstream but falsely failed Desktop confirmation. The follow-up accepts both names and suppresses redundant informational notices without hiding warnings/errors. Unit fixtures now use the pinned runtime wording; real RPC acceptance additionally toggles Ultracode on/off in an existing session and checks both state and the absence of false error banners. The earlier draft-only Ultracode check did not cover this path.

The corrected local preview is `Desktop/release/goal-launch-ultracode-fix-20261011/`, installer SHA256 `b552bd11401b292acc423ce108ecc1d3aade94c617df0b983562b01b5d2baa06`. Typecheck/build, all 304 serial tests and source/packaged launch acceptance passed. Runtime hashes remain identical to staging. The normal desktop shortcut targets this corrected preview with empty arguments; the 723,905,400-byte output and three older previews were inventoried without deletion, and live user processes were preserved.

## Approval Bottom Drawer

The 2026-10-11 local preview uses a bottom-flush approval drawer covering the composer and performance footer, with no bottom border or gap. It defaults to a 240px compact view and expands to half the conversation viewport. Dragging follows the pointer and release snaps to either size; grip clicks and keyboard controls also select a size. Actions stay fixed while content scrolls. Enter/exit use 160ms/140ms cubic transitions, size snapping uses 180ms, and additional details fade in over 160ms. Reduced motion disables these transitions. The content scrollbar has a thumb only, with transparent track and no arrow buttons.

Approval presentation recovers only matching runtime/tool-call arguments, keeps credential redaction, and separates command, target, file edits and question previews from permission policy. Questions use normal prose with inline code; approve/reject answer previews use the same 16px green CircleCheck/red CircleX symbols as subagent status, without completion animation or status tooltips. Neutral answers are not classified as approval or denial. These are previews, not interactive answers. The question approval action is labelled Allow question and does not select an answer. Compact mode retains the actual operation, target and risk warnings; expanded mode adds answer descriptions, Agent explanation and parameter/approval disclosures. Optional preceding prose is not a safety verdict. Deferring preserves drafts and does not deny the operation. Permission grants and the upstream runtime are unchanged.

Deferring or pulling the drawer down temporarily turns the existing composer permission trigger into Review approval. After the 180ms entry, a background highlight flows across it every 4.8s; its tinted background, inset outline and solid accent text breathe on a 3.4s cycle without blinking, scaling or shifting layout. Hover preserves the moving background. Reduced motion disables both continuing and entry animation, leaving a static accent frame. Clicking or keyboard activation reopens the current request rather than opening the permission menu or changing the preset. Resolving the request restores the permission picker. The upper Review notice remains available. Drafts are preserved and the trigger remains available even when permission switching is unsupported.

The subsequent source-only polish colors the upper notice's leading triangle yellow, matching the interrupted subagent indicator in light and dark themes. The text and banner background stay unchanged. This expresses waiting for confirmation, not failure or a high-risk verdict. Dedicated acceptance checks both theme colors and reopening from the notice/composer context. This polish is not included in the existing local installer or desktop shortcut.

Typecheck, production build, all 289 serial tests, source approval acceptance and real RPC/SSE session-concurrency acceptance passed. The packaged executable passed approval, general Electron and real RPC/SSE session-concurrency acceptance with isolated profiles. Approval fixtures cover dark/light, English/Chinese, narrow layouts, grip dragging and snapping, keyboard size selection, compact/detail visibility, flush-bottom geometry, long content, defer/deny/approve and reduced motion. They also verify composer reopening after both defer and downward dismissal, keyboard reopening, restored permission controls, preserved draft and a visible review trigger at 360px width. Motion acceptance samples background position, inset outline and label color at two times after entry, verifies continuing infinite animations and unchanged dimensions, preserves the gradient on hover, and checks static reduced-motion rendering even on hover. Screenshots are `Desktop/test-results/permission-approval-*.png`, including question compact/expanded close-ups and deferred-entry views. These checks do not establish paid-model or installer lifecycle acceptance.

The primary workspace package is `Desktop/release/approval-review-motion-20261011/`, approximately 690.27 MiB. Installer SHA256 is `6AC0AE61289A11626167ED55602385D79A725DE85BF8D120EB28179C19163DF5`. Packaged manifest, Node, Step Code bundle and both Desktop runtime helpers match staged resources. Runtime remains pinned to `f7392089e67d80232b73c87f894dec8100c6c20a`, Node v24.15.0. The ordinary desktop shortcut targets this normal-mode preview, which predates the yellow-notice polish. The preceding entry preview remains in use by the user's running application. Five release directories total about 3.37 GiB and were inventoried without deletion. No public release or installer lifecycle qualification is included.

## Ultracode workflow presentation (2026-10-11)

The final source follow-up caps the workflow history menu at five fixed 33px rows, with internal scrolling for additional records and natural shrinkage for shorter lists. Other AppMenu consumers retain their existing layout. The 16-record Electron fixture measures the five-row content viewport after the opening transition, verifies scrolling, keyboard selection and focus restoration. Typecheck/build and workflow/approval acceptance were rerun. This five-row adjustment is source-only; the previously linked local installer retains its 320px menu.

The follow-up preview synchronizes to main `2203ecc`, including approval drawer PR #95 (`3a27a74`). Workflow history now occupies one 44px selector row, reusing AppMenu and DisclosureChevron. Sixteen-history fixture coverage checks a maximum 320px internally scrolling menu, keyboard selection, Escape focus return and preserving selection when new invocations arrive. The normal Chinese working pulse is now "正在阶跃"; pending approvals retain the separate awaiting-decision wording. Typecheck/build, all 294 serial tests, workflow and approval source/packaged acceptance and source real RPC/SSE concurrency acceptance passed. The updated local package is `Desktop/release/workflow-approval-latest-20261011/`, installer SHA256 `fbb037806c338493279a1a073913c4db5de9f85292ead26a317fc6630928537c`. Packaged runtime resources match staging, and the normal desktop shortcut targets this package with empty arguments. Its directory totals 723,843,571 bytes. The preceding 723,823,822-byte preview was inventoried and retained without deletion; running user applications were not stopped. No new real-model/cloud or installer lifecycle acceptance is claimed.

The workflow tool has a compact conversation entry and a clickable progress summary beside the working pulse. Both open the existing Subagent inspector in its Orchestration view; selecting an agent switches to Agent details. Returning to Orchestration preserves the overview scroll position. Clicking the same orchestration trigger closes it. The fixed Subagent rail button remains available after scrolling and after completion. Runtime-supplied phases are grouped; missing phases do not produce inferred dependency edges. The inspector can select earlier workflow invocations from the current conversation.

Presentation projects schema-versioned workflow progress fields and redacts credential-like task text. Final tool results retain the latest compatible per-agent snapshot through duplicate message lifecycle events. Missing final agent states become unknown rather than remaining active or assuming success. Reopening history reads only a bounded `progress.json` under the session workspace's validated workflow run directory in the main process; scripts and result-provided paths are not executed or followed. Missing files retain the workflow summary. Agent details expose task/state/timing/token metadata; this interface does not supply a complete agent transcript.

Typecheck, production build, 287 serial unit/protocol tests, workflow Electron acceptance, existing Subagent status acceptance and real RPC/SSE session-concurrency acceptance passed. A subsequent focused test covers terminal workflow results without final per-agent progress. Workflow fixture acceptance checks pulse/rail entry, same-anchor close, overview/agent navigation, final replacement, subsequent parent tools, history reload, light/narrow layouts and session isolation. The user's supplied completed workflow `wf_af9b15ceda8240f7` was read without mutation: all eight completed agents were recovered. This is presentation/history evidence, not a new paid-model or cloud-machine run. Screenshots are under `Desktop/test-results/workflow-*.png`.

The local preview package is `Desktop/release/workflow-inspector-20261011/`, still version 0.3.0 and not a published release. Packaged workflow and existing Subagent status acceptance passed; the packaged runtime manifest, Step bundle, Desktop helpers and terminal host hashes match staged resources. Installer SHA256: `0234cd50598fdc2d697c4ce080083ce690e6256c803db3577e07156a3da82d46`. The normal desktop shortcut points to this package with empty arguments. The package directory totals 723,823,822 bytes; only this candidate was retained in this worktree. Existing applications and prior packages elsewhere were left intact. Clean-machine installation and a new real-model workflow run remain unverified.

## Fixed Settings Window

The 2026-10-10 settings change is based on main `5778d3f`. All eight categories use one viewport-bounded shell; providers and archived sessions no longer resize it. The full titlebar sits behind a five-pixel blurred backdrop with a 12% black tint, never an ink-based white veil in dark mode. The form remains opaque. Navigation and content scroll independently, category changes retain navigation focus, and a matching 220ms exit keeps the background blocked until unmount. Reopening cancels pending dismissal and reduced motion dismisses immediately.

Typecheck, production build, all 279 serial unit/protocol tests, source custom-provider/settings-dialog/model-effort acceptance, and packaged custom-provider/settings-dialog/general Electron acceptance passed. The dedicated settings fixture is part of PR CI and covers stable geometry, provider editing, titlebar layering, dark/light tint equivalence, inert controls during exit, reopening, retained draft, Chinese/English, reduced motion, and no horizontal overflow at 800/640/480-pixel window widths. Screenshots are `Desktop/test-results/settings-fixed-*.png`. Provider checks use local fixtures, not paid services. Packaged main/preload and staged runtime resources match the current build.

Installer: `Desktop/release/settings-latest-main-20261010/Desktop for Step Code Setup 0.2.0.exe` in the primary workspace. SHA256: `BC655D2385DB33D807A301ABEB744C91EE01B70C07D491644BBBD41D7E651068`. Output totals 718,655,378 bytes. The ordinary desktop shortcut now targets this normal-mode package with empty arguments. Previous packages and running user applications remain untouched. The pinned upstream runtime baseline is unchanged; no upstream checkout edit, public release or installer lifecycle retest is included.

## Custom Provider Thinking Discovery

Cloud run `38028135174` passed staging, typecheck, unit tests, build and the preceding Electron fixtures, then failed the file-preview keyboard-focus assertion at line 212. That fixture pressed ArrowDown as soon as the menu became visible, before the AppMenu requestAnimationFrame focus was guaranteed to run. It now waits for real menu focus and asserts the next enabled item receives focus after ArrowDown; the original membership assertion remains. Two consecutive local file-preview runs passed. Product menu behavior and all CI gates are unchanged; a replacement cloud run must establish the final result.

The PR #86 P2 follow-up clears withdrawn upstream thinking controls and cached declarations during model refresh, including explicit `reasoning: false` responses, while preserving manual and legacy overrides independently of the new declaration. Model-selection events now decorate their emitted runtime state just like full snapshots, so applying an unknown-control model does not replace service-default presentation with a raw `off` state. New regression tests reproduced both defects before the fixes. The discovery tests cover absent, false and changed declarations plus runtime projection; the Electron fixture captures both selection/application events without a snapshot refresh and checks the service-default picker across all three protocols. Typecheck, build, all 278 serial tests, custom-provider Electron acceptance and model-switch acceptance passed locally. Replacement cloud CI is verified separately.

The 2026-10-10 Desktop-only change discovers explicit `thinking_levels`, `supported_reasoning_efforts`, and nested `effort.supported_levels` declarations from a custom provider's model list. A nested `effort.default_level` is retained only when it belongs to the declared levels. Display names accept `display_name` or `name`. Refreshing an existing model updates declarations without duplicating the model or replacing its custom name or manual thinking override. No model-name inference or official-provider registry is included.

The original compact model editor keeps thinking status beside the collapsed capabilities summary. Thinking control provenance is independent of general model metadata: upstream declarations and manual/unverified configurations remain distinct. Unknown controls use the service default, expose no selectable effort levels, and send no invented thinking parameters. Manual controls support explicit UI-level to request-value mappings. Anthropic adaptive thinking requires explicit confirmation; budget-based controls are not implemented. Changing API format clears incompatible controls. Legacy explicit level lists remain manual/unverified.

This branch is based on main `549a6df` and preserves its endpoint-scoped no-auth adapter and next-turn model selection. No upstream checkout or runtime implementation was edited. Validation used the staged upstream `39ec6e0adeca09d50c8897023ea4e471371634cd` baseline. Typecheck, build, all 276 serial unit/protocol tests, custom-provider Electron acceptance, model-effort acceptance and model-switch acceptance passed locally.

The extended custom-provider acceptance uses temporary profiles, local HTTP fixtures, real Electron IPC and real RPC requests. It checks discovery defaults, metadata refresh, unknown controls and mapped values across all three protocols, explicit Anthropic adaptive configuration, and the existing authenticated/keyless generation and tool-call assertions. Screenshots include `Desktop/test-results/provider-thinking-declared.png`, `provider-thinking-unknown.png`, and `provider-thinking-manual.png`. This is fixture acceptance, not a successful live DeepSeek account query or paid-provider capability certification. Earlier primary-workspace preview packages are not the installer for this latest-main integration; no new installer or public release is part of this PR.
## Right Panel Grip Preview

The PR #85 P1 follow-up separates local artifact reactivation from explicit browser refresh. Reactivation selects the existing tab without navigation; the refresh handler renews the local-page grant and requests a reload of that same tab. Source typecheck/build and the extended file-preview acceptance passed, verifying edited HTML, a newly added local JavaScript asset, reset page state after refresh, retained tab identity, and unchanged state preservation on reactivation. The previously delivered installer predates this follow-up.

The 2026-10-10 preview adds artifact/web-reference toggle behavior and a shared boundary grip using the existing width presets. Source typecheck, build, 272 serial unit/protocol tests, and file-preview, browser, terminal and context Electron acceptance passed. Extended fixtures cover multi-preset pointer dragging, deliberate drag-to-close, keyboard and anchored menu selection, native browser/menu layering, preservation of the existing terminal ID and local HTML page state, repeated artifact/web-reference toggles, and refresh remaining a command. Screenshots include `Desktop/test-results/panel-handle-standard.png` and `panel-handle-fullscreen.png`. Fixtures use isolated profiles, not real account histories. No upstream runtime changes or public release are included.

General source Electron acceptance and packaged file-preview/browser acceptance also passed. The local installer is `Desktop/release/right-panel-handle-20261010/Desktop for Step Code Setup 0.2.0.exe` in the primary workspace, SHA256 `D6D1763AF621CFC385E119CCA023D73360E232930A8E2C6463A6CA13706F2B5F`. The normal desktop shortcut targets this package's unpacked executable. Packaged Node, Step bundle, manifest and Desktop helper hashes match the staged resources. Output totals 718,670,088 bytes. Existing applications and older packages were left untouched. Installer lifecycle and paid-provider acceptance were not repeated.

## Deferred Model Selection

Cloud run `38013712253` passed staging, tests, build and the preceding Electron fixtures, then the permission-approval script exited without an assertion trace or its screenshots. The exact exit cause is not established. Its isolated profile now uses a canonical path and it logs stages, errors and unexpected Electron exits; a test-only quit-dialog response is installed before fixtures. All original approval assertions remain. Three consecutive local approval runs passed; replacement CI is required to confirm cloud status.

The PR #84 review follow-up routes busy peer-session sends through the existing Desktop FIFO queue, so its before-prompt hook applies a pending model at the next fresh task boundary instead of letting the upstream follow-up queue bypass it. Copied sessions and reply/user-point branches inherit independent copies of confirmed model-change observations, with visible timestamps retaining path filtering; pending transitions are not copied. Typecheck, build and 272 serial tests passed, including FIFO/model preparation and sidecar-copy isolation. Real RPC/SSE model-switch acceptance verifies whole-session copies and reply branches retain visible notes after reload. The cross-session fixture additionally checks the queued peer request uses the selected model. This follow-up does not replace the local preview package; cloud checks are reported separately.

The 2026-10-10 Desktop-only change keeps model and thinking controls available during a task. A per-worker selection is applied before a fresh prompt, including Desktop FIFO dispatch, but never during an active task or steering. Returning to the original configuration cancels the pending selection. Idle selections still apply immediately. Pending choices survive renderer reload and navigation while the worker remains resident; pending workers are not recycled. Unapplied choices are not persisted across application shutdown.

Confirmed model switches are client-owned sidecar observations anchored to the authoritative user message timestamp. They are not Step messages, tool calls, copied assistant prose, or model context. The expected prompt is matched by hash so internal user-role reminders cannot consume the record; sidecars do not store prompt text. Before consumption, repeated idle changes collapse into one transition, or no record if the original model is restored. Completed records survive history reload and application restart. Branches render only observations anchored to the visible path. Initial draft configuration is not a switch: records require previous visible assistant history.

`verify-model-switch.mjs` uses a fresh profile, local streaming HTTP fixtures and actual RPC. It verifies the enabled picker, pending status, thinking selection, cancellation, renderer reload, navigation, old-model steering, new-model FIFO dispatch, one client record, light/dark/narrow layouts and absence of the notice from upstream JSONL and request context. Tests also cover rejected switches, retry, effort-only changes, upstream busy guards, sidecar reopening and capability maps. Typecheck, build and all 270 serial tests passed locally. Model-picker, send-queue, general Electron, navigation, concurrency, custom-provider and hidden-message acceptances passed. This does not establish real-provider acceptance or cloud CI status.

The supplier focus-gutter acceptance exposed a fractional-DPI measurement error: `clientHeight` rounded a 539.33px viewport to 539px, falsely rejecting a fully visible 4px focus outline by 0.33px. Its measurement now uses fractional bounding edges while subtracting scrollbar extents, retaining the containment assertions and adding failure geometry diagnostics. No provider UI or assertion tolerance was changed.

The final local 0.2.0 preview at `Desktop/release/model-switch-preview-20261010/` passed packaged model-switch acceptance, including full application restart, and general Electron acceptance. Installer SHA-256 is `6ae1dd82e0659ca524e4f9b7e7c48aa8449daf77a3716a559e903c28277f6d4e`; the installer is 152155165 bytes and the preview directory totals about 685.3 MiB. Packaged manifest, Node, Step Code bundle and both Desktop helpers match staged resources. Runtime remains pinned to `39ec6e0adeca09d50c8897023ea4e471371634cd`, without upstream edits. The ordinary desktop shortcut targets this preview; the user's running old application and other packages were preserved. No installer lifecycle test, paid-provider acceptance, commit, push or public release was performed.

The subsequent source-only pending-layout fix reproduces a defect in that preview: the pending notice became a third grid child, squeezing model information into the 88px fader column and pushing the fader 138px below the popover. The notice now lives inside the positioned model heading, preserving the two-column grid. A new geometry assertion fails against the shipped preview and passes against the repaired source; typecheck, build, model-switch and model-effort acceptances passed. This fix has not yet replaced the package or shortcut above.

The subsequent local package at `Desktop/release/model-switch-layout-fix-20261010/` includes the pending-layout fix and passed packaged model-switch geometry/behavior and general Electron acceptance. Installer SHA-256 is `d0063f6766f8749109643f52a4aabd664dda76a9ae6a811c69cd533324d69584`; the installer is 152155237 bytes and the directory totals about 685.3 MiB. Manifest, Node, Step Code bundle and both Desktop helpers match the staged runtime. The normal desktop shortcut now targets this corrected package. The running previous package and historical build directories remain untouched; no installer lifecycle or paid-provider acceptance was performed.

## Hidden Runtime Messages

The 2026-10-10 Desktop-only fix honors the upstream `display: false` marker when grouping conversation turns and projecting response content, including copied text and the shared subagent transcript renderer. Original message arrays, source indices, entry IDs and background-lane lifecycle records remain intact. Explicitly visible extension notices and legacy messages without the marker retain their existing presentation. This addresses the `ultraloop-discovery` capability notice shown before the assistant's reply; it does not redact arbitrary prose generated by the model.

`verify-hidden-messages.mjs` uses a temporary Electron profile and injected IPC records, not a paid model request. It checks live start/update/end events, absence of empty hidden-only responses, visible extension notices, copied text, child transcript filtering, hidden lane completion events and history reload. The dedicated Electron check, background-subagent acceptance, message-order acceptance, typecheck and production build passed locally. The fixture is included in CI. No upstream runtime edits, personal-history mutations, package replacement or PR publication are part of this change.

General Electron acceptance and the full serial test rerun passed (261 tests). The first full run failed and remained alive at the unchanged terminal count-limit test; only that verified test process tree was terminated before rerunning, without editing terminal code or interrupting the user's application.

The PR #83 P2 follow-up excludes hidden messages from the child transcript-presence check. The Electron fixture verifies a failed child with only its user task and hidden discovery record shows the localized empty state, both live and after reload. Cloud run `38005007240` passed this fixture but exited at artifact acceptance without an assertion trace or artifact screenshots. That acceptance now canonicalizes its temporary profile, avoids invisible quit confirmation in its isolated window, and logs stages and unexpected process exits; all original assertions remain. Three consecutive local artifact checks passed. The initial cloud exit's root cause is not established; replacement CI must be checked separately.

## Chained Subagent Runtime Upgrade

The PR #81 review follow-up preserves queued steps when a background lane reports `running`; the active step still inherits lane lifecycle, and previously settled records remain unchanged. Projection regression checks cover initial background dispatch and partial per-step results. Concurrency and cross-session HTTP fixtures locate their explicit task/peer messages instead of the upstream discovery reminder. Typecheck, build, presentation tests and both real-RPC acceptance scripts passed locally; replacement cloud CI is checked separately.

The 2026-10-10 source integration pins Step Code to `39ec6e0adeca09d50c8897023ea4e471371634cd`, the merge of upstream PR #227 addressing Issue #220. The existing Desktop integration patch is rebased without changing its credential, RPC or bundle behavior. The patch applier succeeds against a fresh checkout of that exact commit; runtime staging and CI assert the same baseline. The original user-owned upstream checkout, staged runtime and running application remain untouched.

Desktop accepts `queued` and `skipped` result records. Planned chain steps after the first start as pending rather than falsely running; settled completed/failed/skipped records survive projection. Skipped uses a neutral circle-minus icon and the shared application tooltip explaining that the chain stopped before this step executed.

`verify-chain-runtime.mjs` uses a temporary Desktop profile, a local HTTP model fixture, real Electron IPC, the staged RPC worker and actual subagent children. It verifies three-step output propagation, final-step content delivered to the parent, middle-step failure with a skipped third step, and cancellation during the second step with completed/aborted/skipped results and no residual streaming state. It is included in CI. The upstream chain-result suite passed eight tests. This is real-runtime fixture acceptance, not paid-model or real-account acceptance.

Typecheck, all 259 serial unit/protocol tests and production build passed. General Electron, auth-vault, account settings, custom providers (three protocols with and without authentication and real tool invocation), Summary, background subagents and send-queue acceptance passed against the upgraded runtime. Provider and queue fixtures locate the actual user task rather than treating the new upstream Ultracode system reminder as a user request; their execution and FIFO assertions remain intact.

The local `chain-runtime-preview-20261010` package passed general Electron and all three chain-runtime scenarios. Packaged manifest, Node, Step bundle and Desktop helpers match staging. Installer SHA256 is `dff0a769a06760b69ca34b1abfe4df652c2e8c38b263605ec6e9202ec3b5bdef`; the ordinary desktop shortcut targets this preview. A user-run Step model session also completed a three-step planner chain: saved records confirm full previous-output substitution at both boundaries, final-step text returned to the parent, zero child exit codes and settled records without pending replies. Real-model failure/cancellation and installer lifecycle remain unverified. No public release or upstream feature reimplementation is included.

## Status Icons and Secondary Descriptions

The 2026-10-09 Desktop-only follow-up separates semantic status colors from the brand accent: completion uses green, failure uses red, and interruption uses a yellow warning triangle. Subagent rows and the right-side transcript share the existing shrink/hold/grow/draw animation. Task-plan projection accepts explicitly reported `failed` records without inferring task failure from individual tool errors; the current pinned upstream does not yet emit that task-plan state.

Status icons have an application-rendered secondary tooltip with a localized title and explanation. It supports pointer entry into the description, keyboard focus on the existing row control or standalone icon, Escape dismissal, scroll/resize dismissal, viewport bounds, entry/exit motion and reduced motion. Provider diagnostics supply their own safe outcome description. No upstream runtime upgrade is included.

The local `status-tooltip-preview-20261009` package passed packaged status acceptance and the isolated replay demo. Installer SHA256 is `11323b6415407ad5c999450843ff5d947e11cfca0d4f015e74ac4f11d75462b8`. The demo is a development script (`node scripts/run-status-demo.mjs <packaged-executable>`), requires the development Playwright dependency, and intercepts IPC in a fresh temporary profile; it never sends a paid model request or changes normal session history. This is local preview evidence, not a public release or clean-machine acceptance claim.

For the current first-release gates and candidate status, see [RELEASE.md](RELEASE.md). This document preserves historical feature evidence; different preview packages and source-only checks do not collectively qualify one final installer.

## Session Navigation and Browser Close

The PR #79 review follow-up removes a disconnected resident worker before preparing its saved history again. Dedicated navigation acceptance terminates only Step RPC children owned by its isolated Electron main process (excluding the management helper), observes the actual exit event, switches away and reopens the history, and verifies a new runtime identity with the old worker removed. The CI Summary fixture now waits for confirmed navigation and explicitly opens Summary, matching the navigation rule that closes the prior right panel. Typecheck, build, navigation recovery and real-runtime Summary acceptance passed locally; replacement cloud CI is verified separately.

The 2026-10-09 Desktop-only fix prepares cold histories without activating them, serializes navigation and commits only the latest requested target. The selected sidebar row and window title update immediately; they are not completion signals. Recently viewed transcripts can appear from a detached, inert cache bounded to six sessions and an estimated 12 MiB of serialized UTF-16 data. Runtime controls and approvals are never restored from that cache. Catalog changes and background message/tool events invalidate cached readings. Drafts, quotes, attachments and stable message-relative reading anchors survive navigation and idle-worker recycling; pointer, wheel and keyboard interaction cancel pending reading restoration, including the external scrollbar.

The delayed sidebar loading ring has a fixed 12px square instead of inheriting title-span flex growth. Browser close keeps the shared cubic layout-reservation transition while hiding the opaque native webpage immediately. Replacement by another right panel still releases the outgoing reservation immediately. Browser acceptance samples intermediate Standard/Wide close widths and checks the final restored reservation.

An isolated PR worktree based on main `14b1ca2` retains the merged supplier/no-auth adapter. Typecheck, production build, 257 serial unit/protocol tests, general Electron, dedicated session navigation, browser, concurrent-session, archived-session, branching, sidebar ordering, new-session and cross-session acceptance passed locally. General/archived/concurrency checks wait for the confirmed transcript and enabled composer rather than just the optimistic title. The image-menu check completes Playwright's image scrolling before opening its scroll-dismissed menu. These changes preserve existing assertions and runtime operation guards. One full-suite attempt had a provider test-process failure; that file passed separately and the subsequent complete serial run passed all 257 tests. Sidebar acceptance also exited during its restart launch on one attempt without a reported assertion; its standalone rerun passed unchanged.

The previously delivered local preview at `Desktop/release/session-spinner-fix-preview-20261009/` passed packaged navigation/spinner and browser checks. Its installer SHA256 is `2508607f322f8de8653f72a9fc9f4e3273da1aa7c8256fd319c32ede55f1b16e`; the normal desktop shortcut remains unchanged during PR preparation. That preview predates the isolated latest-main integration and final acceptance refinements, so it is not evidence for every PR change. No upstream checkout/runtime edits, real-profile mutation, paid-provider request, installer lifecycle qualification or new public release is part of this fix. Cloud CI is separate from these local results.

## Account Settings Split

### Thinking Levels After Authentication

The 2026-10-10 source-only fix refreshes the proposed session's model options after login/logout, retaining its identity, selected project, permission choice and unsent composer text without creating an agent or history. Explicitly selected models are resolved from the refreshed catalog rather than retaining the previous model object's stale capability fields. Supported manual effort choices survive; unsupported choices fall back to an available level. The renderer installs a fresh snapshot after every successful login, including independent mode, instead of conditionally restarting a project worker.

Account acceptance starts with a fixture Step Plan credential and an empty capability state, makes a local Step catalog available, and completes the actual API-key login path. It checks the new levels in the snapshot and visible fader, keyboard selection, retained draft, no eager session creation, refreshed metadata for a selected model and signed-out catalog removal. Native quit confirmation is intercepted only in this isolated fixture. Screenshot: `Desktop/test-results/account-thinking-after-login.png`. Typecheck, production build, 258 serial unit/protocol tests and account, general Electron, new-session and auth-vault acceptance passed. This validates the shared Desktop authentication/proposal path, not a real Step Plan browser OAuth exchange or live model discovery; TODO remains open until packaged real-account acceptance. No upstream checkout/runtime changes or paid-model requests were made.

The subsequent local normal-mode package at `Desktop/release/plan-thinking-fix-preview-20261010/` passed packaged account-settings, new-session, auth-vault and general Electron acceptance with isolated profiles. The package uses a private copy of the previously staged runtime and the current Desktop helpers. A dependency-free application staging manifest packages the already bundled `dist` output, avoiding dependency collection through the worktree's shared `node_modules` junction; native terminal and runtime resources retain the existing packaging configuration. Packaged Node, Step bundle, manifest, both helpers, terminal host and keyless adapter match staging. Installer SHA256 is `c395f86915961473b77f6dc2aea645ec05ab31e9275e8a9dc9c8bff111a4c47e`; the output directory totals 686,699,579 bytes. The ordinary desktop shortcut targets its unpacked executable with no demo arguments. The user's existing application and profile were preserved, and older outputs were inventoried without deletion.

This preview remains version 0.2.0, not a public release. Real-account acceptance remains pending: on an independent proposed-session page, log out and log in through Step Plan without opening a project or sending a message, verify visible/selectable thinking levels, then relaunch and check again. Local fixture success does not establish real OAuth/model discovery or installer lifecycle acceptance.

On 2026-10-10 the user confirmed the packaged real Step Plan test passed and accepted this P0 as resolved. This supersedes the pending real-account status above, but does not establish installer lifecycle acceptance. That tested preview uses upstream `519e4de4`; PR #81's planned `39ec6e0a` runtime update was still open at confirmation, so integration and regression on that newer baseline remain separate work before this fix PR is opened.

After PR #81 merged, the fix was rebased onto main `17aed88` and its private staged runtime updated from the verified `chain-runtime-preview-20261010` resources, with manifest and resource hashes checked. The upstream baseline is now `39ec6e0adeca09d50c8897023ea4e471371634cd`. Typecheck, build and all 259 serial unit/protocol tests passed, as did source and packaged account-settings, new-session, auth-vault, general Electron and real-chain-runtime acceptance. Chain acceptance verifies output propagation, failure/skipped steps and cancellation against local HTTP fixtures, not a paid provider.

The combined normal-mode preview is `Desktop/release/plan-thinking-main-preview-20261010/`, and the ordinary desktop shortcut now targets its unpacked executable without demo arguments. Installer SHA256 is `f72944ada229570ef1094edb3689c12652b61682c3e2c8136dc9cc75639bb6b4`; its output directory totals 692,407,525 bytes. Packaged Node, Step bundle, manifest, Desktop helpers, terminal host and keyless adapter match staging. This supersedes the older package for local use. The existing running application, user profile and upstream checkout remain untouched; 31 release directories were inventoried without deletion. The earlier user real-account confirmation applies to the older runtime preview, while this combined package has separate isolated regression evidence. Cloud CI and installer lifecycle qualification are not inferred from these local results.

The PR #82 P2 follow-up preserves the application flag for the refreshed selected model's effective thinking level. A removed manual effort no longer leaves the proposal displaying a fallback that is never applied to the created worker. Models without a thinking level keep the flag false. The account fixture now selects a non-default local model, removes its manual `high` level during authentication refresh, and verifies the proposal fallback (`low`), created RPC worker and first actual HTTP request all agree. Before the fix, the created worker reproduced `xhigh` instead of the displayed `low`. The successful request/reply uses a local custom provider and explicit reply-content polling, not an upstream startup reminder as a completion signal.

Typecheck, build, account, new-session and general Electron acceptance and all 259 serial unit/protocol tests passed locally after this follow-up. The first full-suite attempt failed terminal process-tree cleanup and left its test child open; only that verified test child was stopped, the unchanged terminal file passed standalone, and the subsequent complete serial suite passed. No terminal assertions or implementation were changed. This follow-up is source-only and is not included in the combined preview above; replacement cloud CI is tracked separately.

### Custom Providers Follow-Up

The PR #78 review follow-up adds a Desktop-owned no-auth request adapter without modifying the upstream checkout or staged Step bundle. Enabled keyless providers retain an internal endpoint-specific sentinel only to satisfy the SDK's credential requirement; the adapter removes its Authorization/x-api-key headers before network transmission, matching both origin and base-path boundary and leaving real credentials and other destinations untouched. It retains the runtime's replacement Undici transport, response streaming, timeout/proxy setup and cancellation. The helper is preloaded only when an enabled keyless provider exists, uses a quoted forward-slash path for Windows, and is copied outside app.asar so the standalone Node runtime can load it. Saved keys remain encrypted and are restored when keyless mode is disabled.

Typecheck, production build and 249 serial unit/protocol tests passed. New tests cover scoped header removal, ordinary credentials, Request bodies/cancellation, transport replacement and real Node children loading from spaced paths. The supplier fixture rejects any authentication header in keyless mode and verifies discovery, diagnostics and successful runtime streaming for all three protocols, followed by restoration of the saved credential. Crash-log migration acceptance now waits for an enabled composer and initialized proposed session rather than the animated heading, retaining vault byte-equality, plaintext removal and genuine conflict-log assertions. Supplier and crash-log acceptance passed locally; replacement CI remains separately tracked on the PR. The ordinary desktop shortcut and existing installer were not updated by this review follow-up.

The final 2026-10-09 local preview is `Desktop/release/provider-gradient-preview-20261009/`, superseding the earlier package and source-only statuses below. The upper-left provider silhouette fades from brighter upper-left to transparent lower-right in both themes. Installer SHA256 is `86475d5f0955aec1c96d06e704d5a14be2706f305387fe125b6490534b56501f`; the ordinary desktop shortcut targets this package. Typecheck, production build, 245 serial unit/protocol tests, model-fader/brand acceptance and packaged supplier, subagent-status and general Electron acceptance passed. Packaged Node, Step bundle, manifest, Desktop helpers and terminal host match staging; the admin helper also matches source. The preview remains version 0.2.0 and is not a new public release. Older packages were inventoried and retained, and the running user application was not stopped.

This iteration retains the existing Step account integration and adds custom protocol configuration only. Other vendors' official presets and vendor-specific compatibility adaptations are deferred. Discovery consumes explicit metadata rather than guessing from model names, and a successful connection diagnostic does not establish streaming, reasoning, multimodal or tool compatibility with a commercial provider. No upstream Step checkout changes, paid-provider requests or installer lifecycle acceptance were performed.

The source-only provider-mark/focus follow-up adds a subdued upper-left brand mark inside the existing model heading, preserving the centered model/effort text and existing parameter flip. Canonical Step providers use the existing five-square StepFun asset; other providers use a neutral Sparkles mark, never brand inference from model names or custom endpoints. The account and model panels share the same Step mark. Supplier editor scroll content now reserves 4px focus-ring gutters, including expanded model details, and scroll padding/margins keep focused inputs clear of the viewport bottom. Typecheck/build, model-fader/mark, supplier/focus and account Electron checks passed with isolated fixtures. Focus assertions cover all four sides for Base URL, model ID and context capacity. Screenshots are `model-provider-{step,custom}-{dark,light}.png` and `provider-focus-{url,model,capacity}.png`. No replacement installer or shortcut update was made for this follow-up.

The connection diagnostic adds a right-aligned Test Connection action beside Save. It sends one short non-streaming text request using the current unsaved endpoint/protocol/key and a selected configured model, without saving configuration, invoking agent tools, starting a conversation or modifying history. The result expands/collapses in place with cubic easing, shows elapsed time and HTTP status, supports cancellation and an application-rendered model menu, and includes optional details and a copyable allowlisted diagnostic summary. Closing settings cancels an active test. HTTP 200 alone is not success: the selected protocol must return structured assistant text; Responses also requires completed status.

Diagnostics reuse the Subagent/plan status component at the same fixed 18px slot and 16px artwork. Running-to-success retains the 660ms cubic shrink/hold/grow/check sequence and brand color. Running-to-failure now uses the same sequence with a red circle and two sequential cross strokes. Static failed history does not animate; interrupted transitions are cancelled and reduced motion switches immediately. The isolated status fixture checks the failure contraction/hold and both intermediate drawing strokes. Both supplier/diagnostic and status fixtures passed against the packaged executable.

The preview package is `Desktop/release/provider-diagnostic-preview-20261009/`; installer SHA256 is `2e3d191c623011a76284b7f26c765069064169f48c48b5a4a38997d802f6efd7`. The normal desktop shortcut points to its unpacked executable. This local test build remains version 0.2.0, is not a published release or PR, and uses the previously staged Step bundle. Generated artifacts were inventoried (approximately 748 MB including installer and unpacked application); older packages were retained pending explicit cleanup authorization. Installer lifecycle and commercial-provider acceptance were not performed.

The Electron main process owns requests, resolves encrypted saved keys when the input is blank, prevents concurrent tests, rejects redirects, enforces a 30-second deadline and bounds response bodies at 1 MiB. Provider response text, error bodies, headers and keys are not rendered or copied. Custom URL path segments are omitted from the diagnostic endpoint. Distinct results cover authentication, not found, rate limits, other HTTP errors, invalid/empty replies, timeout, cancellation, network and invalid configuration. This tests only basic non-streaming connectivity; streaming, tool use, image input, reasoning support and vendor-specific compatibility are not validated by a passing diagnostic.

Typecheck, production build and all 245 serial unit/protocol tests passed. The isolated supplier Electron fixture covers unsaved diagnostics without persistence/history changes, all three protocols, authentication failure, cancellation, redacted presentation, dark and 640px layouts. Screenshots are `provider-diagnostic-{dark,narrow}.png`. No paid-provider request or personal-profile change was made.

The 2026-10-09 model-parameter preview package is `Desktop/release/model-parameters-preview-20261009/`. Its installer SHA256 is `3ea437a93fbf29ad815eb5b37139788db3aa0e3a0f9109f5331231d46686953c`; the normal desktop shortcut targets its unpacked executable. The lower composer slot previews modality icons and compact context capacity, then flips into parameter details and back using cubic transitions. Source fader acceptance and packaged custom-provider acceptance passed, including explicit capability import, unavailable audio, restricted effort levels and actual reasoning parameter transmission. The packaged Desktop admin adapter hash matches source and staging. This supersedes the preceding source-only status for the parameter follow-up; installer lifecycle and commercial-provider acceptance remain untested. Previous packages were retained, not deleted.

The model-parameter follow-up imports only explicit upstream modality lists, boolean reasoning support, declared effort lists and bounded token limits. Known metadata aliases include `architecture.input_modalities`, `context_length` and `supported_reasoning_efforts`; model names never establish capabilities. Missing fields retain configurable defaults. Audio/video/file declarations and image output are informational only: the existing runtime accepts text/image input and text output. Per-model supported effort checkboxes project a `thinkingLevelMap`, with unsupported levels set to null. The composer parameter entry replaces the reserved lower slot and opens an anchored, fixed-size parameter view with cubic transitions and reduced-motion support. The Desktop-owned admin DTO also exposes runtime input and capacity; no upstream Step source or bundle is changed.

Typecheck, production build, all 244 unit/protocol tests, fader/parameter Electron acceptance and custom-provider Electron acceptance passed. The provider fixture imports text/image/audio declarations, verifies audio is unavailable, restricts levels to off/low/high, rejects xhigh and confirms the actual Chat Completions request carries `reasoning_effort: high`. Screenshots include `model-effort-parameters-{dark,light}.png` and `custom-model-parameters.png`. This follow-up is source-only and is not included in the preceding custom-provider preview installer. It does not establish commercial-provider reasoning compatibility or capability enforcement for every model.

Model discovery adds an explicit GET to the configured base URL's `/models` endpoint in the main process. It supports bearer authentication for both OpenAI formats and `x-api-key`/`anthropic-version` for Anthropic, including unsaved keys and encrypted saved keys. Redirects are rejected; requests have a 15-second timeout and a 2 MiB response limit. Only model IDs and display names are imported; capabilities and capacity remain user-confirmed defaults. The first response page is supported; provider-specific pagination and nonstandard discovery endpoints are not implemented. Discovery is read-only until the user selects models and saves the provider. Six focused provider tests passed, including literal credentials, duplicate/invalid entries, failed responses and redirects. The Electron fixture now obtains its initial model through discovery and selection before exercising actual runtime generation. This is local fixture validation, not commercial-provider acceptance.

The 2026-10-09 Desktop-only implementation replaces the provider placeholder with a supplier list and editor. It supports custom Chat Completions, Responses and Anthropic Messages endpoints, explicit save, enable/disable, removal confirmation and manually declared models. Model names, reasoning/image support and token limits are configurable; this does not discover or verify capabilities automatically. Pricing is not configured in this first iteration: sessions containing custom-model replies show unknown estimated fees, not upstream zero-rate estimates as if usage were free. Advanced model fields are collapsed by default, the protocol menu uses the existing application-rendered menu and DisclosureChevron, and the editor scrolls independently with a visible save footer.

Provider definitions and keys are stored in the desktop encrypted vault. Only a non-secret model projection is written to Desktop-owned `models.json`; unrelated provider entries are preserved. Saved keys are never returned to the renderer. Desktop metadata is removed from child credentials, and custom keys are escaped so upstream command/environment syntax cannot reinterpret literal key text. Step account login/logout retains custom-provider state. Provider edits require all sessions to be idle, with no pending queue; workers are reloaded after saving rather than changing an in-flight request. The current conversation and permission selection are preserved. Vault state is authoritative and the model projection is regenerated on launch; uninstalling the credential vault also removes these saved provider definitions.

Source checks include typecheck, production build and 242 unit/protocol tests. The dedicated isolated Electron fixture verifies configuration, rejected saves, encrypted persistence, rename/relaunch, no-Step-login generation, three local HTTP wire protocols, a real runtime task-list tool call through Chat Completions, mutation blocking during a streamed reply, disable/removal and light/dark/640px layouts. Its keys and services are fixtures, not commercial-provider acceptance. Account, auth-vault and general Electron regression checks also passed. No upstream checkout/runtime changes, real-user profile mutation, paid-provider requests, installer or PR are part of this implementation. Screenshots are `Desktop/test-results/custom-providers-*.png`.

The 2026-10-07 change separates Account and Providers in Settings. Account uses the supplied StepFun platform mark and four channel tiles for mainland/international Plan and API Key. Providers uses the same 17px, 2px outline icon convention as the other navigation entries and a noninteractive custom-provider placeholder. The management adapter exposes credential validity and an actual stored UID only when it matches the active account identity; the upstream profile fallback is not displayed as a user ID. Credential contents do not cross this settings DTO. Display name, avatar, plan tier, allowance and API balance are not supplied by current runtime interfaces and remain unavailable rather than inferred.

Source and packaged account-settings and auth-vault Electron acceptance passed using isolated fixture profiles. Checks cover UID projection, channel/key reset, API login/logout, encrypted persistence, themes, 640px layout, English and reduced motion. The preview package is `Desktop/release/account-settings-preview/`; its installer SHA256 is `a83f02d4c1e81112a1121aae73c3080be860278a01d8be95a62de960cdb5255a`. The normal desktop shortcut targets its unpacked executable. The package includes local work present at packaging time; the PR contains only the account change. Fake keys do not establish real-account authorization. Installer lifecycle and paid-model acceptance were not performed.

The isolated PR checkout based on main `64cfadb` passed typecheck, build, account-settings and general Electron acceptance, plus 202 tests excluding `terminal-sessions.test.ts`. The unchanged terminal count-limit test failed and left fixture hosts alive both during the full run and its isolated rerun; those test process trees were stopped explicitly. The remaining four terminal tests printed passing results. This is an unresolved local baseline-test limitation, not a full-suite pass.

The PR #68 review fix guards settings initialization with selection and request revisions. A late response can refresh account information but cannot overwrite a channel selected during that request; older settings requests cannot replace newer responses. Typecheck, build and account-settings acceptance passed after the fix. The added deterministic IPC fixture holds a saved mainland account response, selects international API, enters a fixture key, releases the response, and verifies both retained selection/key and the intercepted international login parameters. No real authorization is sent. The existing preview package predates this fix.

This file combines historical feature checks with the current release gates. Named `Desktop/release-*` directories below identify local outputs used for those checks; they are not required retained artifacts or current download locations. Current packaging writes to `Desktop/release/`.

## Permission Approval Presentation

The 2026-10-07 Desktop-only change localizes known upstream tool approvals using deterministic presentation rules, not model translation. It distinguishes incomplete shell analysis from a matched high-risk rule and ordinary policy confirmation. Full inputs are recovered only by the exact tool call ID/name within the matching runtime; unavailable inputs remain explicitly labelled as potentially truncated summaries. Unknown extension dialogs keep their existing presentation, and original approval text remains expandable.

Approval, denial and review-later retain their existing RPC behavior. This does not change permission policies, grant additional authority, add approval timeouts or solve unattended workflow waits. Related upstream discussion: https://github.com/stepfun-ai/Step-Code/issues/221.

On an isolated worktree based on `26ec686`, typecheck, all 204 unit/protocol tests, production build, general Electron acceptance and `scripts/verify-permission-approval.mjs` passed. The dedicated fixture covers Chinese/English, exact commands and other parameters, summary fallback, original details, defer without responding, approval/denial payloads, high-risk and unknown-extension dialogs, and 360/640/1280-pixel window bounds. Screenshots are `Desktop/test-results/permission-approval-*.png`; the narrow Chinese screenshot was visually inspected. CI now runs this fixture.

This is source and isolated-fixture acceptance only. No installer, replacement package, paid-model run, personal-session mutation, live-process interruption or upstream source change was performed.

## Conversation Elapsed Labels

The 2026-10-06 source change adds per-thinking-block elapsed labels and a permanent total before the completed response time. Timing is observed in the Electron main process: thinking ends at its end event, prose/tool-call transition, message completion or runtime exit; the run total spans agent start to completion/exit, including tools and waits. Steering does not reset it. These are observed Desktop intervals, not provider-internal compute measurements.

Completed observations are stored separately under userData `conversation-timing/`, keyed by session identity and assistant timestamps. They survive history refresh, renderer reload and cold reopening without changing upstream history or model context. Old messages without recorded intervals omit the labels. Permanent session deletion removes its timing sidecar. Concurrent workers have independent clocks; unexpected exit and orderly disposal freeze unfinished intervals.

Typecheck, all 185 tests and build passed. Timing unit checks cover formatting, separate thinking segments, steering, concurrent workers, exit, sidecar restoration/deletion and full-snapshot events. A real staged RPC/local SSE fixture verifies thinking timing through authoritative message replacement and history refresh. `verify-conversation-timing.mjs` verifies live ticking/freeze, recorded-history reload, permanent footer visibility and dark/light/narrow layouts. General Electron and frame-sampled stream-motion acceptance passed; screenshots are `Desktop/test-results/conversation-elapsed-{dark,light,narrow}.png`. No package, shortcut update, paid-model execution or installer acceptance is claimed.

## Subagent Status Motion

The 2026-10-07 source preview replaces the task row's running/completed text with a rotating ring and a circle-check icon. A fixed 18px slot contains 16px Lucide artwork, close to the adjacent 14px tool icon; completed circles use the same primary rose color as the composer action button. Long task descriptions cannot squeeze the status into multiple lines. Failure retains explicit text and an alert circle; accessible row names still include all statuses.

Only a mounted running-to-completed transition plays the 660ms completion sequence: cubic contraction (180ms), contracted hold (70ms), cubic regrowth (210ms), then a normalized SVG check-path draw (200ms). Historical completed tasks do not replay; reduced motion stops rotation and switches directly. Clicking the same task again closes its right panel with the existing animation, while clicking a different task switches records.

`Desktop/scripts/verify-subagent-status.mjs` uses isolated fixture records with the real renderer to verify rotation, intermediate contraction/hold/draw frames, stable row geometry, history, dark/light themes, narrow width, reduced motion, failure and click-toggle. Screenshots are under `Desktop/test-results/subagent-status-*.png`. This preview does not establish real-model subagent execution, and has not been packaged.

## Background Subagent Lifecycle

The 2026-10-07 Desktop-only fix projects background-lane status from structured `custom` / `agent-notification` messages onto the original dispatch using `details.agentId`. Valid completion, failure, interruption, progress, restart and needs-input events are replayed in message order; known-lane `agent_send` result snapshots also update status for follow-ups. Identities are registered before replay to tolerate a fast child notifying before the dispatch result arrives. Ordinary prose, unknown lane IDs and mismatched event/status pairs cannot change task state.

Conversation rows and the open Subagent panel share this projection across turn boundaries and restored snapshots. Panel selection now includes tool call ID and task index, preventing identical task descriptions from selecting a different dispatch. Background interruption is labelled Stopped rather than Failed. Neither original messages nor model context are rewritten; lifecycle notifications without child activity do not fabricate process records. The upstream checkout and staged runtime were not edited or restaged; the staged bundle hash matches the current packaged runtime.

Type checking, production build and all 193 tests passed. The first full run exited an existing session-collaboration test file without detailed failure output; its isolated rerun and a subsequent full rerun passed. `verify-background-subagents.mjs` passed cross-turn live completion, open-panel synchronization, identical-task isolation, reload without animation replay, failure, interruption and follow-up checks. Subagent status/motion, elapsed-time and general Electron acceptance also passed. A read-only replay of the reported session's active history resolved its affected lane as completed. Screenshot evidence is `Desktop/test-results/background-subagent-completed.png`; fixture UI acceptance does not establish new paid-model execution.

This fix is source-only. No package, shortcut update, user-session mutation or live-process interruption was performed.

PR CI now runs the dedicated conversation-timing, subagent-status and background-subagent Electron checks after general Electron acceptance.

The pre-PR validation reran type checking, build and all four Electron checks successfully. A full unit run alongside Electron checks hit an existing terminal-fixture process-tree termination failure and left fixture children alive; only children of that test runner were stopped. A subsequent independent serial run passed all 193 tests. No terminal product code was changed.

## Pending Send Preview

The 2026-10-06 queue preview uses the real staged RPC runtime with an isolated local SSE provider. `Desktop/scripts/verify-send-queue.mjs` verifies FIFO delivery, explicit steering without aborting the active response, long-message previews, quote-preserving edits, withdrawal, stop-and-retain behavior, worker switching, renderer reload, IME/repeated-key guards, cubic diff relocation, light/dark and narrow layouts. Queue and live-change components have distinct sibling keys to prevent stale queue controls after switching. Queue popovers hide native browser content while open.

Undelivered drafts remain in the Desktop main process so per-item actions are version checked rather than implemented through unsafe upstream clear/requeue. Queues retain image/file payloads internally, expose only message text and attachment counts, and cap at 20 messages / 32 MiB per worker. Stop/failure pauses delivery. Settings, branching, recycling and quit guards account for retained queues. Drafts are not persisted across full application exit.

The bundled `resources/queue-demo/start-queue-demo.ps1` starts a separate isolated profile with a local provider and a seeded walkthrough. Each response lasts about 40 seconds and invokes a real edit tool only against that profile's `demo.txt`. This permits hands-on queue, steer, edit, withdraw and diff-motion testing without a paid model or personal credentials. Fixture acceptance is not real-model or installer-lifecycle acceptance.

Typecheck, all 173 unit/protocol tests, production build, source queue/message-order/concurrency/general Electron checks passed. The unpacked preview at `Desktop/release/send-queue-preview/` passed queue, general Electron, native browser and real PowerShell terminal acceptance. The bundled demo launcher was separately started with packaged Node, confirmed to create an isolated profile and launch the packaged app, and its local provider completed a full response. Test processes were then stopped. Packaged Node, Step bundle, admin/session helpers and terminal host match staged resources byte for byte.

Both the normal desktop shortcut and a separate queue-demo shortcut target this preview. The user's running older application was not terminated. Installer SHA-256 is `2b7ece30f4b3246beffa68fbba2a75b368b9910d05bf72f9e3f2acb679abcedd`; the new directory totals about 697.44 MiB. The two older package directories were inventoried and left unchanged without new deletion approval. No paid-model acceptance, installer lifecycle, upstream source edit, commit, push or PR was performed.

The subsequent launcher correction fixes `windowsHide: true` on the Electron child: a hidden helper is appropriate, but hiding the actual GUI left running demos with no visible window. The source launcher and unpacked preview resource now use `windowsHide: false` for Electron. The actual desktop `.lnk` was invoked through Windows Script Host and confirmed to produce a nonzero native main-window handle. Six hidden demo launch trees were identified by their exact packaged Node path and launcher argument and stopped; ordinary application processes were not targeted. The visible replacement demo was left open for the user. This resource-only correction has not been rebuilt into the NSIS installer.

The next preview, `Desktop/release/send-queue-fifo-preview/`, includes that launcher fix in the installer and changes empty-composer Enter to steer the oldest undelivered message. Selection occurs in the main-process `queue_steer_first` handler, so an in-flight enqueue acknowledgement cannot accidentally prioritize a newer draft over existing items. Per-item steering still permits an explicit out-of-order choice. The hint and bundled walkthrough now describe oldest-first ordering. Typecheck, all 173 tests, build and source/packaged queue acceptance passed with assertions that the edited first draft is consumed before the second. Both desktop shortcuts target this preview; existing windows were left untouched. Runtime/terminal hashes match staged resources. Installer SHA-256 is `f81b93799ce71b76ac62cd297ad0ebb177b9a3b610b7bb7927c65736d1604843`; the preview totals about 697.44 MiB. All four package directories were inventoried without deletion.

The subsequent source-only refinement retains sent-but-unconsumed steering messages after RPC acknowledgement. They leave the editable queue chip immediately and render as ordinary user/quote bubbles beneath ongoing output, with a pulsing waiting receipt. Only the matching upstream user-message event removes that receipt; later assistant output belongs below the authoritative message. Acknowledged pending messages are not blindly retried or inserted into model history by the renderer. Stopped/disconnected sessions show static waiting/unconfirmed status. The docked live-diff popover now right-aligns to its trigger and follows animated relocation toward or away from the center.

Typecheck, all 174 tests, production build, source queue acceptance, message-order regression, concurrent-session, general Electron and native browser acceptance passed. Dedicated checks hold the local response open, verify that the sent bubble is visible before the model receives its text, retain it across reload and session switching without leaking it into another conversation, confirm one authoritative user bubble after consumption, and measure docked diff-panel/trigger edge alignment. The live-diff popover also participates in native-browser blocking while open. Screenshots are `Desktop/test-results/queue-awaiting-dark.png`, `queue-consumed-dark.png` and `queue-diff-anchored-dark.png`. This refinement was initially source-only.

The subsequent 2026-10-06 package at `Desktop/release/send-queue-live-preview/` includes the waiting receipts and docked diff anchoring. Its unpacked executable passed queue, general Electron and native browser acceptance with isolated profiles. Packaged Node, Step bundle, admin/session helpers and terminal host match staged resources byte for byte; the runtime baseline is unchanged. The ordinary desktop shortcut now targets this executable with no demo arguments, retaining the normal application's existing account and history. The separate queue-demo shortcut is unchanged. Installer SHA-256 is `47dbc03b3c014212558d5918d7e82dcaf742e92bfe0a5eac9d6d7355c9b83f5f`; the new directory totals about 697.45 MiB. All five package directories were inventoried without deletion. No paid-model test, installer execution or public release was performed.

The next source-only presentation refinement adds a persistent-on-screen italic "Steered" footer to consumed user messages sent into an active response (Chinese: "已插队引导"). Waiting receipts remain unchanged; ordinary FIFO delivery and idle sends do not gain this marker. Desktop matches delivery to the pending payload and records the authoritative user timestamp per resident worker, without modifying upstream history or model input. Markers survive renderer reload and worker switching, but are not persisted beyond worker disposal or application exit; older history is not inferred retroactively. Typecheck, 175 tests, production build and queue acceptance passed. Evidence is `Desktop/test-results/queue-steered-marker-dark.png`. This refinement has not been packaged.

The subsequent 2026-10-06 normal-profile package at `Desktop/release/send-queue-marker-preview/` includes the marker aligned with the user bubble's right edge, with hover actions to its left. Packaged queue acceptance verifies this alignment, steering-only labels and renderer reload; general Electron acceptance also passed. Runtime and terminal resources match the staged files byte for byte. The ordinary desktop shortcut now targets this package with empty arguments, preserving the existing profile; the demo shortcut is unchanged. Installer SHA-256 is `c667624342bde7e64f326b5d07c3e827be881250eaf774ad92028556ee975154`. The package totals about 697.45 MiB; six package directories were inventoried without deletion. Marker persistence limitations above still apply. No paid-model test, installer execution or public release was performed.

### PR #63 Review and CI Follow-Up

The consumed user event now reaches the renderer before the queue notification advances its revision. Queue acceptance inspects the actual renderer event stream, not just a later snapshot, to reject delivery that would already be stale. Stopping waits for upstream abort and queue cancellation before restoring unconsumed receipts as versioned editable drafts. Dead workers restore receipts locally; neither path retries automatically. A paused receipt also offers explicit recovery after the session becomes idle, requiring successful upstream queue cancellation before releasing the draft. New sends and steers cannot race an in-flight stop.

The CI browser fixture now waits for completed navigation, Playwright attachment of the native page, the editable input and the loaded image. Previously the native title event could arrive before the automation target was available; this change retains the isolation and real-page assertions rather than weakening them. Typecheck, 179 tests, production build, queue, message-order, native-browser, concurrent-session, cross-session and general Electron acceptance passed locally. The queue fixture stops an accepted steer before consumption, checks no silent replay, edits and removes its recovered draft and verifies settings are unblocked. GitHub Windows integration passed for commit `21031ba` in run `37466831400`. These source fixes have not been repackaged.

The subsequent child-exit regression found an unhandled stdin `EPIPE` when a snapshot read raced real RPC process termination. The transport now owns stdin stream errors, rejects pending requests, reports disconnection and stops the affected child instead of crashing Electron. Typecheck, 180 tests, production build and extended queue acceptance passed. The Windows queue fixture verifies its isolated application's PID/profile before terminating only its own Step RPC children, then withdraws restored drafts through the real UI without replay. A deterministic pipe-error unit test also verifies late released-child errors cannot disconnect another transport.

## Embedded User Browser

PR #58's intermittent branching failure displayed a repeated in-flight reply, rather than a missing response. The 2026-10-05 follow-up reproduces overlapping snapshot/delta delivery deterministically with `scripts/verify-message-order.mjs`: the old renderer appends `Alpha` twice when a snapshot already includes the delayed delta. Desktop now tags snapshots and worker events with a per-worker runtime revision, rejects message events already represented by an installed snapshot, and ignores refresh snapshots older than accepted live messages. Explicit retry history replacements advance the revision too. Legitimately repeated text in a newer delta remains intact. The deterministic Electron fixture also covers a delayed stale refresh and late deltas after history replacement, and is included in Windows CI. Typecheck, all 156 tests, production build, message ordering, real-runtime branching, concurrent-session and general Electron acceptance passed locally. No upstream runtime changes or new packaged preview were made for this fix.

The 2026-10-05 PR follow-up shares the native Standard/Wide/Fullscreen width menu with the terminal. Terminal wide mode changes actual PTY columns and fullscreen restore retains the preceding width. Standard browser docking now reserves the full 620-pixel native surface; acceptance checks that it does not overlap the composer. Collapse hides the opaque WebContentsView at the beginning of the shell's cubic fade, rather than leaving a fully visible webpage over the returning conversation. The closing track releases its layout reservation in one reflow. Browser, real PowerShell terminal and general Electron acceptance passed against the updated source build, along with typecheck, production build and all 151 tests on an isolated rerun with a 60-second test timeout. The previously packaged preview predates this final native-hide and standard-width correction.

The 2026-10-05 source preview adds a user-operated browser to the shared right rail. Each tab uses a sandboxed WebContentsView with context isolation and no Desktop preload or Node integration. Tabs use the separate persistent `desktop-browser` partition. Website cookies/storage persist in this profile; tabs do not restore across application restarts. Collapse, conversation changes and renderer reload retain the native tabs. Explicit tab close and application shutdown close their WebContents. Production uses Chromium's normal background throttling; isolated no-focus acceptance disables it only for that test profile.

The UI provides URL entry, back/forward, reload/stop, twelve global tabs, popup links as new tabs, explicit opening in the system browser and 50-200% zoom. It follows the shared cubic right-panel expansion and supports main-view fullscreen/restore and bounded narrow-window overlays. Native bounds follow the animated page viewport rather than covering the browser header, rail or footer. Settings, renderer approvals/previews/context menus, titlebar menus and the narrow sidebar hide the native page while they are in front. HTTP/HTTPS and the internal blank page are allowed; file/executable/custom schemes and credential-bearing addresses are rejected. Website permissions default to denial and downloads use Electron's native save-dialog options. No Agent control, MCP registration, remote-debugging endpoint or new browser dependency is added.

`Desktop/scripts/verify-browser-panel.mjs` uses an isolated Electron profile and a local HTTP fixture. It exercises real page input, images, scrolling, navigation history, zoom, popup tabs, native Ctrl+L address focus, renderer reload, cookie-partition isolation, microphone denial, invalid commands/geometry/addresses, failed loads and retry, tab limits, and full WebContents release including empty tabs. It checks light/dark chrome, native bounds at 640 pixels, intermediate cubic expansion frames, reduced motion and settings/titlebar-menu layering. Playwright captures the React shell and native web page separately; `browser-shell-*` and `browser-web-*` retain both original images, and `browser-composite-*` combines these actual captures at measured native bounds for inspection.

Typecheck, 151 unit/protocol tests, production build, browser acceptance, general Electron acceptance and real PowerShell terminal acceptance passed locally. The fixture is not evidence of compatibility with every website. Real-account OAuth popup flows, actual downloads/save dialogs, camera hardware, remote-site login, installer lifecycle and packaged-browser acceptance have not been exercised. No new package or shortcut change was made; upstream Step Code and the staged runtime remain unchanged.

The subsequent 2026-10-05 package at `Desktop/release/browser-preview/` passed browser, general Electron and real PowerShell acceptance using its unpacked executable through `DESKTOP_VERIFY_EXE`. A repeated unit-test run stalled in the terminal fixtures while packaging was concurrent; only that owned test process tree was terminated. An isolated rerun with a 60-second test timeout passed all 151 tests in about 16 seconds. The desktop shortcut was updated to this package without closing the user's running older terminal preview.

Packaged Node, Step Code bundle, admin/session helpers and terminal host hashes match the staged/build resources. Runtime remains at `519e4de4ed2162d3667be1821cb92ada6b884e5a`, with Node v24.15.0 matching its manifest hash. Installer SHA-256 is `828b676b53badec2674fcf391a48b3701d2d4d5e478a281b118448481c700a9e`; its size is 153,649,232 bytes, and the package directory totals 726,208,356 bytes. Existing preview directories were inventoried without deletion. Installer lifecycle, real-account login and actual download/save-dialog acceptance remain unverified. No upstream edit, Agent browser control, commit, push or PR was performed.

### Browser Width Preview

The subsequent 2026-10-05 preview adds Standard, Wide and Fullscreen choices only to the browser header. Wide uses approximately 60% of the available main view, preserving at least 480 pixels for the docked conversation. Standard retains its previous width. Narrow overlays converge Standard and Wide; fullscreen restore returns to the previously selected non-fullscreen width. The selection survives panel switching within the renderer lifetime but is not persisted across reload/relaunch. All widths use the existing cubic transition and measured native viewport synchronization. The native page is temporarily hidden while the native width picker is open; Escape dismisses that picker without also closing the browser panel.

Typecheck, all 151 unit/protocol tests, production build, source and packaged browser acceptance, and packaged general Electron acceptance passed. Browser acceptance checks header-control alignment, intermediate wide/fullscreen frames, stable native viewport bounds, conversation availability in Wide, fullscreen restore, switching away and back, narrow-width convergence, picker layering and Escape. Screenshots include `Desktop/test-results/browser-composite-wide.png`, `browser-composite-narrow-wide.png` and `browser-width-picker.png`, along with the existing standard/fullscreen/theme captures.

The package is `Desktop/release/browser-width-preview/`; the desktop shortcut targets its unpacked executable without terminating the user's running earlier browser preview. Installer SHA-256 is `177efea42e6bfb0e93b44626a6093ba68a894f85499f1a8a049d514099f5651b`, installer size is 153,649,374 bytes, and the package directory totals 726,210,203 bytes. Node, Step bundle, admin/session helpers and terminal host hashes match staged/build resources; the runtime baseline remains unchanged. Thirty local preview directories were inventoried without deletion. No installer lifecycle, remote-account login, paid-model acceptance, upstream edit, commit, push or PR was performed.

The subsequent source-only width-control correction reuses `DisclosureChevron`, incorporates the layout icon into the same button, and narrows the Chinese trigger to 84 pixels while retaining 126 pixels for English. It replaces the HTML picker with a typed Electron native-menu operation like the Review panel's menu. The page is no longer hidden during width-menu interaction, avoiding an empty dark viewport. Browser acceptance substitutes only native-menu selection/cancellation, inspects the real menu's radio items, and continuously checks that the real WebContentsView remains visible while the selection promise is pending. It also verifies retained page input, unchanged width on cancellation, invalid menu requests, icon-hit-area activation and existing width transitions. The screenshot `browser-composite-menu-open.png` combines the real shell/page captures during this held-menu fixture; it does not depict the actual OS popup. Header screenshots are `browser-header-{light,dark,wide,narrow}.png`. No replacement package or shortcut update was made for this correction.

The 2026-10-05 follow-up package at `Desktop/release/browser-menu-preview/` includes the compact SVG/menu correction. Typecheck and production build passed again, and the unpacked executable passed browser and general Electron acceptance with isolated profiles. Native-menu selection/cancellation remains substituted as described above; this is not an OS-popup visual acceptance claim. The desktop shortcut now targets this package; the running older width preview was not closed or overwritten.

Installer SHA-256 is `4603df3d9761e668941d28a19b81b3d2f8637485250de1453011491d23c916b2`, its size is 153,650,388 bytes, and the package directory totals 726,215,424 bytes. Packaged Node, Step bundle, admin/session helpers and terminal host hashes match the staged/build resources. Runtime stays at `519e4de4ed2162d3667be1821cb92ada6b884e5a` with Node v24.15.0. Thirty-one local preview directories total about 19.60 GiB; none was deleted. Installer lifecycle, real-account login and paid-model acceptance were not added, and no commit, push or PR was performed.

## Embedded Windows Terminal

The source preview adds a user-operated PowerShell terminal to the shared right rail. xterm.js 6.0.0 and FitAddon 0.11.0 render the terminal; node-pty 1.1.0 runs in a separate helper under the already-staged Node runtime, outside Electron and ASAR. The renderer receives only typed terminal metadata/output and narrow input/resize/clipboard operations, without Node or filesystem access. Desktop credentials and runtime/environment overrides are not forwarded. Terminal output is not added to model messages or Agent tool events.

Tabs are grouped by initial working directory, limited to eight per directory and 24 globally. Hiding the panel and changing conversations leave them alive; exited tabs retain output. Explicit close and application exit terminate the owned process tree. Creation during shutdown is rejected, and pending startup/close operations settle during teardown. Terminals do not persist across application restarts. Main retains a bounded approximately 512 KiB raw-output replay per terminal; renderer reload restores that bounded history, not an exact unlimited screen snapshot. The helper pauses output consumption above 256 KiB of unacknowledged data and resumes below 64 KiB. Renderer output writes do not cause React rerenders.

`Desktop/scripts/verify-terminal-panel.mjs` runs an isolated real Electron/PowerShell profile. It covers Chinese text, actual keyboard commands, clipboard paste and selected-text copy through a stubbed OS clipboard, Ctrl+C interruption, real PTY resizing during fullscreen/restore, multiple tabs, hidden-panel output and 3500-line output beyond the backpressure threshold. Reload restores existing tabs; switching to an independent directory creates separate terminals and returning to the project retains its tabs. It verifies explicit close kills a shell-launched test child, natural exit retains code 3, closing the last tab does not auto-create another, and titlebar application exit ends a background independent terminal. Main-process guards reject unknown terminal IDs, invalid dimensions and oversized input. The fixture verifies renderer Node isolation and removal of a Desktop-prefixed secret from the shell environment.

Screenshots are `Desktop/test-results/terminal-panel-{light,dark,expanded,narrow}.png`. Checks include light/dark themes, a 640-pixel window without horizontal document overflow, cubic transition timing/intermediate expansion widths and closing opacity, reduced motion, and shell Escape not restoring or closing the panel. Typecheck, all 144 unit/protocol tests, production build, terminal acceptance, general Electron acceptance, Context and Review acceptance passed locally. Focused terminal tests also cover environment filtering, bounded replay, invalid IDs/acknowledgements, directory limits, pending-start cancellation and shutdown creation rejection.

The 2026-10-05 package at `Desktop/release/terminal-preview/` passed the same real terminal acceptance and general Electron acceptance using its unpacked executable. Packaged native-PTY loading, real PowerShell, output backpressure, renderer reload, process-tree cleanup, fullscreen resizing and isolated directory tabs were exercised. The dependency resource has its own copy root because electron-builder excludes a root `node_modules` directory even from an explicit resource filter. The desktop shortcut now targets this package; the user's running older application was left untouched.

Packaged Node, Step Code bundle and both Desktop helpers match the staged runtime, and the helpers match current source. The terminal helper also matches its build output. Runtime retains baseline `519e4de4ed2162d3667be1821cb92ada6b884e5a` and Node v24.15.0; Node matches its manifest hash. Installer SHA-256 is `e91426aeda4252d2f62b1fb17d3743fe31826f21ba4ba5a04aad71d81588d577`. Installer and unpacked application are about 146.52 and 545.82 MiB respectively. The rebuildable helper/dependency directory is about 63 MiB; 28 preview directories total about 17.57 GiB and were inventoried without deletion.

PowerShell 7 was exercised; the configured Windows PowerShell fallback was not separately exercised. No installer execution, WSL support, paid-model call, upstream Step-Code change, commit, PR or public-release qualification was performed.

### PR #57 Review And CI Follow-Up

The source-only follow-up replaces environment-name denylisting with an explicit case-insensitive allowlist. Regression fixtures include `SSH_PRIVATE_KEY`, `GITHUB_PAT`, `DOCKER_AUTH_CONFIG`, proxy variables and an unclassified custom variable, while retaining system paths and user directories. Real PowerShell acceptance injects isolated synthetic credentials and verifies that their variable names are absent from its environment and their values do not enter replay output. This does not sandbox the shell's normal current-user filesystem access.

Terminal closure checks the taskkill outcome and waits for host exit before removing the tab, replay and registry entry. Unsuccessful termination and reported success without actual host exit both retain ownership and reject closure; a later confirmed retry removes the entry. Concurrent closes share the same operation. Shutdown waits for outstanding attempts, propagates failures and allows retry; the application does not quit silently after a failed terminal stop. Unit fixtures cover these failure/retry paths, while real terminal acceptance covers ordinary process-tree termination and application exit.

The failed CI step reported `Unknown workspace` when returning from an independent terminal to a project whose saved path had been canonicalized. Workspace selection now checks remembered directories with the existing `samePath` helper and connects through the remembered path rather than raw string equality. Real terminal acceptance explicitly uses uppercase, alternate separators and a trailing dot, and rejects an existing but unregistered directory.

Typecheck, all 147 unit/protocol tests, production build, source real-terminal acceptance and general Electron acceptance passed after these changes. The previous terminal package and desktop shortcut have not been replaced by this source-only follow-up.

## Conversation Presentation

### Hanging Summary Board

The 2026-10-03 source preview separates Summary from the full-height conversation-navigation sidebar. A content-height board hangs from the upper-right with an open region beneath it. The board region is 344 CSS pixels wide; the reading column retains its normal 920/1000-pixel cap. Summary remains an empty placeholder; no new summary data or agent capabilities are implemented.

Automatic visibility requires at least 1120 CSS pixels after subtracting the actual reserved left-sidebar track and the 44-pixel right rail. With the left sidebar visible, 1440-pixel and 1920-pixel windows show it; a 1280-pixel window hides it, and hiding the left sidebar restores enough room. Manual close stays closed across resizing during this app lifetime. Manual opening without enough room uses a bounded top-right overlay instead of shrinking the transcript. Automatic and manual openings use a 320ms ease-out quadratic approximation, sliding 10 pixels left and 12 pixels down from the upper-right while fading in. Acceptance samples the initial, intermediate and final animation states. Close, backdrop and Escape return focus to the rail; reduced motion disables the entrance.

The follow-up fixes the narrow dismiss surface inheriting ordinary button hover colors, which could obscure the entire app. Summary's dismiss surface now remains transparent in normal, hover and active states. A persistent zero-to-344-pixel docking track animates both opening and closing with the same quadratic curve, moving the transcript and composer together instead of instantly inserting/removing a layout column. Their maximum widths also transition together. Frame checks cover automatic/manual opening and closing, and narrow/intermediate 640/900/1280/1360-pixel windows retain all available conversation width without a leftover docking column. Reduced motion disables both board and layout animation.

The subsequent gutter-aware layout correction uses existing right-side reading-column whitespace before reserving additional width. The dock reservation is bounded between zero and 344 pixels, derived from the viewport, sidebar track and normal reading width. With enough whitespace, opening/closing Summary leaves both transcript and composer unchanged; when more room is needed, only the necessary reservation uses the existing quadratic transition. The scrollbar and turn ruler now follow the reading-column edge, outside the board. Acceptance checks 1920-pixel windows with the sidebar visible/hidden and a 1706-pixel sidebar-hidden window: the latter reserves 54 pixels and moves the reading center 27 pixels instead of 172. It also verifies non-overlap, preserved 1000-pixel wide reading width and initial/intermediate/final partial-reservation frames. Screenshots are under `Desktop/test-results/summary-board-gutter-*.png`. Resize checks await the actual layout transitions rather than assuming a wall-clock delay is enough.

Type checking, all 111 unit tests, production build, `verify-electron.mjs`, `verify-summary-board.mjs`, `verify-stream-motion.mjs` and `verify-chat-quotes.mjs` passed. Isolated-profile screenshots cover light/dark, wide, narrow auto-hidden and narrow manually-open states under `Desktop/test-results/summary-board-*.png`. The layout fixture checks useful board/reading widths, transcript/composer alignment, leftward displacement, focus, resize policy and non-overlap. These checks do not establish summary content, real-model or installer-lifecycle acceptance.

The packaged preview is `Desktop/release/hanging-summary-preview/`, rebuilt in place with the gutter-aware correction, narrow-hover fix and main-view motion, using the previously staged pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime. Runtime auxiliary-file hashes match current Desktop source. Packaged `verify-summary-board.mjs` and `verify-electron.mjs` passed using the current fixtures and isolated profiles; the desktop shortcut targets this unpacked executable. The installer and unpacked app total about 681 MiB; installer SHA-256 is `9b50e75d2adeee151255001254e5f0b7955201ccbeeb22df1c2bfaef507bc390`. The installer was not run and other historical packages were not deleted.

The subsequent source-only native-resize correction distinguishes window geometry changes from manual Summary toggles. On native resize, Summary docking and the reading width settle before paint; the visible conversation shell, composer and scrollbar move using transform-only 320ms quadratic easing. Manual toggles retain their existing transition. Interrupted corrections cancel and restart from their current visual positions; reduced motion skips correction animations. Unchanged Markdown now has a memoized rendering boundary with a stable image-preview callback, preventing layout state changes from reparsing saved history while retaining new-text reveals and current language/copy/image behavior.

`scripts/verify-summary-resize.mjs` uses an isolated real Electron profile with 60 user/assistant turns, paragraphs, tables and code. It maximizes the native window and clicks the actual Restore titlebar button three times, sampling continuous animation frames and Chromium performance counters. Before the correction, the restored reading width continued changing through 13-32 distinct widths, with 33-65 layouts and 50-107ms cumulative layout time per pass. After both fixes, the same fixture recorded one restored reading width, 7-11 layouts and 20-21ms cumulative layout time. In the final traced run the maximum frame interval was 50-58ms rather than the earlier 175-188ms baseline, and no renderer long task was recorded during the three sampled restores. The intermediate trace before Markdown memoization identified approximately 150ms resize callbacks even after repeated rewrapping had been removed. These are local measurements with instrumentation, not an FPS guarantee; initial long-document reflow remains nonzero.

Continuous-frame assertions check transcript/composer alignment and absence of backward position jumps. Additional checks cover a rapid maximize/restore reversal, history reading not being pulled to the bottom, reduced motion and renderer errors. Browser scroll anchoring may adjust the numeric history scroll offset during width changes; exact offset preservation is not claimed. Type checking, 111 unit tests, production build, Summary layout, stream motion, quote interaction and general Electron acceptance passed. Evidence is under `Desktop/test-results/summary-resize-{baseline,fixed}.json`, `summary-resize-trace.json` and `summary-resize-restored.png`. The source pass initially left the previous packaged preview unchanged. No upstream runtime, paid-model or installer-lifecycle acceptance was added. Existing packages were retained; this follow-up generated about 2.5 MiB of rebuilt `dist/` files and about 11.5 MiB of resize evidence before packaging.

The 2026-10-04 package rebuild updates `Desktop/release/hanging-summary-preview/` in place with both native-resize and Markdown-rendering corrections. No running preview process was present before rebuilding, and the existing desktop shortcut still targets the updated unpacked executable. Packaged `verify-summary-resize.mjs`, `verify-summary-board.mjs` and `verify-electron.mjs` passed with isolated profiles. The packaged 60-turn resize pass recorded one restored reading width, 7-10 layouts, 16-21ms cumulative layout time and 46-63ms maximum frame intervals, with no sampled renderer long tasks. The latest `summary-resize-fixed.json` and restored screenshot are from this packaged pass; the trace remains from the preceding source pass. The bundled runtime manifest remains at `519e4de4ed2162d3667be1821cb92ada6b884e5a`, and bundled admin/session-helper SHA-256 hashes match source. Installer SHA-256 is `544b437f9902e782c4afcb40a5c5941268aa9e6ab5dee291c93dc2da9ae0491b`; installer and unpacked app total about 681 MiB. No historical package was deleted, no installer lifecycle test was performed and no real-model acceptance was added.

The subsequent source-only overlay-input fix removes the full-view transparent dismiss button for Summary. Narrow Summary is nonmodal: only the board intercepts input, while the conversation remains available for native wheel scrolling, selection and composer editing. Close, the Summary rail toggle and Escape remain available; clicking the conversation does not dismiss Summary. The conversation-navigation panel retains its original narrow-screen dismiss surface. Type checking, 111 unit tests, production build, Summary acceptance and long-history native-resize regression passed. Summary acceptance now uses scrollable prose and real wheel/click/input interactions at 640/900/1280/1360 CSS pixels, verifies the board remains open, and checks that conversation-navigation dismissal still works. The latest resize JSON/screenshot have been refreshed by this source pass; the earlier package measurements above remain the recorded packaged result. This input fix is not yet in the desktop shortcut's preview package. No new large package was generated or old package deleted.

### Compact Session Notices

The 2026-10-03 preview uses content-sized notices centered over the main conversation view, just below the window bar. Copy and branch actions share the same cubic entrance. Archive offers View and Undo; successful Undo restores the sidebar entry, replaces the same bubble with a neutral success surface and a green check, smoothly reduces its width without repeating the entrance, and expires after three seconds unless hovered or keyboard-focused. MCP warnings retain their original error text and View MCP link in the same notice surface; a shorter error summary is not implemented.

The subsequent source-only follow-up removes native secondary confirmations from single and bulk archived-history deletion. Both actions delete directly; main-process archive-membership, current/active-session, operation-lock and managed-file checks remain, with authorization revalidated immediately before deletion. The archived-session fixture now fails if either action opens a native dialog and continues to verify unknown/duplicate/non-archived/current-session rejection, history persistence and project-file survival. The packaged preview below predates this follow-up.

Type checking, 111 unit tests and the production build passed. Packaged Electron, archived-session and real-RPC branching acceptance passed with isolated profiles. Notice checks cover main-view centering with sidebar and right-panel changes, narrow layouts, reduced motion, in-place undo, action removal, expiry and light/dark screenshots. These fixtures do not establish paid-model or installer-lifecycle acceptance.

The local package is `Desktop/release/compact-notices-preview/`, with the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime staged from the separate prepared checkout. The desktop shortcut targets its unpacked executable. The package totals about 681 MiB including the installer and unpacked app; installer SHA-256 is `e79251904476c039a9a34e14609a57e7256cacd4a0d629afc2d8321479f1e7b3`. The installer was not run, no release was published, and historical packages were not deleted.

The 2026-10-01 PR-scoped source, rebased onto main after PRs #30 and #31 and excluding the separate composer send/stop-button work, passed type checking, all 42 tests, the production build and background Electron acceptance. Narration and tool summaries remain visible in source order. Acceptance verifies localized action labels, details-only raw commands, pending-only left-to-right shimmer, independent sibling completion, upright/red failures, reduced-motion handling and missing-result states. Screenshots are under `Desktop/test-results/tool-summary-*.png` and `transcript-tool-*.png`. The earlier 2026-09-30 packaged preview also passed acceptance, but was built before this main-branch sync.

Fixtures cover user turn anchors, tool-ID pairing with out-of-order results, failed and missing results, retained intermediate narration, thinking and images, copy of all response prose excluding thinking/tool payloads, hover/focus controls without layout shifts, draft-preserving edit-to-composer, nested disclosure and visible narration/tool summaries after runtime disconnect. Light/dark and narrow-window screenshots are local evidence under `Desktop/test-results/transcript-*.png`; math and image-preview regression checks remain included.

Clipboard text writes are replaced by an in-page fixture, not performed against the user's clipboard. Editing restores a message copy to the composer; it is not runtime history editing. Branch remains disabled. This renderer change has no new real-model or installer lifecycle acceptance.

Thinking folds when the first subsequent nonempty text delta arrives, while the response and pending tools remain active. Empty text-start events do not fold it; a manual reopen survives later deltas. `Desktop/test-results/thinking-folded-on-prose.png` captures that verified streaming state. Layout acceptance waits for finite transitions rather than looping tool animations.

## Concurrent Sessions

### Archived Sessions and Turn Dates

The 2026-10-03 source change moves archived history out of the sidebar into Settings > Archived. The view groups project and independent sessions, combines search with project filtering, opens history without restoring it, and restores sessions to their existing sidebar groups. Single and all-archive permanent deletion use a main-process native confirmation with Cancel as the default. IPC accepts only known archived IDs, rejects the currently viewed session and active workers, locks resident targets while awaiting confirmation, and revalidates archive membership after confirmation. Deletion validates real paths within the Desktop session store and unlinks individual regular JSONL files, never project files or directories.

Type checking, 109 unit tests, the production build, source Electron acceptance, sidebar ordering and `verify-archived-sessions.mjs` passed. The archive fixture checks grouping, search, filtering, read without restore, restore, cancelled/single/bulk deletion, unknown/duplicate/non-archived/current-session rejection, rejection of a prompt during confirmation, revocation by restore during confirmation, project-file survival and persisted history after reload/relaunch. Unit tests reject outside-profile paths and directory-link escapes. Native confirmations are substituted in the isolated acceptance process; no real user history is deleted.

The right navigation panel keeps each user turn's original timestamp visible below its preview, aligned right, in local month/day and 24-hour time. Missing and invalid timestamps remain absent rather than borrowing the current time. Screenshots cover light/dark, narrow layouts, title truncation and bilingual dates under `Desktop/test-results/archives-settings-*.png` and `navigation-turn-dates-*.png`. This is source-only acceptance: no new package, installer run or paid-model acceptance was performed, and the desktop shortcut is unchanged.

### Sidebar Ordering and Project Pins

The 2026-10-03 sidebar change defaults sessions to a persisted manual order, with a General setting for recently updated first. Switching modes preserves the manual order. Projects always retain a manual order; reopening an existing directory does not promote it. Both session and project rows support primary-button long-press dragging, insertion indicators, edge scrolling, Escape cancellation and keyboard reordering. Session moves stay inside their group. Pinned and ordinary projects retain separate orders, and pin/unpin remains an explicit project-context-menu action.

The section order is fixed: independent sessions, pinned projects, ordinary projects. Archived sessions now live in Settings, as described above. The pinned section has no add-project action; individual project rows retain their new-session controls. Preferences are persisted under the isolated Desktop profile and validated in the main process; the renderer cannot authorize new workspace paths by submitting an order.

The source passed type checking, 106 unit tests, production build, Electron acceptance and local real-RPC concurrency, branching and cross-session regressions. `verify-sidebar-order.mjs` checks manual drags without navigation/collapse, Escape and cross-group rejection, pin/unpin, persisted order after renderer reload and app relaunch, both sorting modes, always-manual projects, narrow windows and reduced motion. Screenshots use isolated fixture sessions under `Desktop/test-results/sidebar-order-*.png`. These checks do not establish paid-model or installer-lifecycle acceptance.

The local preview at `Desktop/release/sidebar-order-preview/` was packaged on 2026-10-03 with the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime from the separate prepared checkout. The unpacked executable passed Electron, sidebar ordering and real-RPC concurrency acceptance with isolated profiles. The desktop shortcut now targets this unpacked executable; the installer was not run. The installer is about 144 MiB and the unpacked application about 537 MiB; installer SHA-256 is `43f6ffe93b681a810d236a08b1a8d53edc6a15704dcf84f5f5d2a4697b1fef75`. Existing preview packages were not deleted, and no installer-lifecycle or new real-account model acceptance was performed.

### Empty Session Creation

The 2026-10-03 Issue #44 change reuses a connected, idle, message-free worker in the same canonical workspace when requesting a new session. Startup requests in the same directory are coalesced. Ordinary snapshot reads are awaited before rechecking eligibility. Workers with submissions, streaming, compaction, queued messages, approvals, non-snapshot operations, mutations, failure or interruption are not reused. Loading saved history and explicit clone/fork operations still create their own workers. Different workspace directories remain independent.

Type checking, 100 unit tests, production build, Electron acceptance, local real-RPC/SSE concurrency, branching and cross-session tool regressions passed against the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime. Electron acceptance clicks the project's new-session button five times and verifies unchanged runtime/session identity, sidebar row count and composer draft. The concurrency fixture checks repeated new-session commands and reuse after returning from a different project. Unit coverage also checks concurrent startup, failure cleanup and retry, busy-state exclusions, saved-session restoration and separate directories.

The PR #45 review follow-up first reproduced duplicate creation during delayed snapshot reads in unit tests, and reproduced the CI `Unknown workspace` failure locally with a directory junction. Snapshot operations now have tracked promises; new-session requests wait for those reads and reevaluate history, activity and worker membership without ignoring other operations. Tests cover multiple reads and opens, state changes while waiting, removal, and failed-read cleanup. The concurrency fixture enters through a directory alias and returns using the canonical workspace path supplied by the main process, matching renderer navigation rather than reusing an obsolete fixture path string.

This is a creation-path fix, not a new recycling policy. Previously accumulated empty sessions are not automatically removed; existing switching, idle retention and background concurrency rules are unchanged. Independent-session creation still allocates a distinct working directory. These checks use isolated profiles and a deterministic local provider, not a paid model or installer lifecycle acceptance. No new package was produced for this change.

The shared-directory follow-up on 2026-10-01 removes the generic send confirmation and appends collaboration rules to session workers through `--append-system-prompt`. Type checking, 66 tests, production build, Electron and local real-RPC/SSE concurrency acceptance passed. The packaged preview at `Desktop/release/session-collaboration-preview/` passed Electron and concurrency acceptance too. The concurrency fixture starts two tasks in one directory without native warnings and observes the added system guidance in requests for both workers, while the base prompt remains and user text is unchanged. Existing approval and deferred-approval cases still pass. The fixture proves rule delivery and nonblocking sends, not that a real model will always preserve edits or split Git commits correctly. No file lock, change-ownership registry or cross-session task-context synchronization is implemented.

The 2026-10-01 unread-indicator correction passed type checking, 65 tests, production build, concurrency and Electron acceptance. The packaged preview at `Desktop/release/session-unread-preview/` passed both acceptance scripts too. Dots have no tooltip and titles retain only their original nine-pixel inner padding. Blue is created by successful background completion only; foreground completion and historical success remain dotless. Acceptance enters the unread session, checks that its dot clears and stays cleared after leaving, and exercises cached navigation without losing live output or drafts. Session-ID unread flags survive worker recycling within the current app lifetime, but are not persisted across app relaunch. Source fixture timings were 3-4ms per resident switch IPC and 28ms to the target title/draft paint; packaged timings were 3-4ms IPC and 30ms paint. These are local small-history measurements, not a general latency guarantee. Cold historical navigation still requires worker startup.

The gutter-aligned session indicators and completion sound passed type checking, 63 unit tests, production build, local real-RPC concurrency acceptance and stream-motion regression on 2026-10-01. The packaged preview at `Desktop/release/session-status-preview/` passed concurrency and Electron acceptance. Acceptance verifies running/complete/interrupted sidebar states, dot centers aligned beneath the group icon outside the selected row, no animation after completion or stop, no completion playback on manual abort, exactly one playback request per successful foreground/background run, decoding the bundled WAV and actual muted media playback. Event-triggered playback is intercepted to avoid audible test noise; this is not a speaker or subjective loudness check. Unit fixtures cover duplicate end events, history reads, truncation, errors and process exit. The completion-state screenshot is `Desktop/test-results/concurrent-completion-status.png`; `Desktop/test-results/session-status-gutter.png` isolates the corrected placement.

The 2026-10-01 source passed type checking, all 61 tests, the production build and `verify-session-concurrency.mjs`. The packaged preview at `Desktop/release/session-concurrency-preview/` passed the same concurrency acceptance plus `verify-electron.mjs`, `verify-chat-quotes.mjs`, `verify-auth-vault.mjs`, `verify-stream-motion.mjs` and `verify-message-feedback.mjs`. The concurrency acceptance uses separate real staged Step Code RPC processes against an isolated local SSE provider, not injected agent events or a paid model. It verifies two simultaneous streams, navigation with live text retained, targeted abort, per-worker permission changes while a sibling runs, background tool approval without a foreground modal, deferred approval and actual `write_file` execution, shared-directory cancel/confirm, statistics, and draft/history restoration after idle-worker recycling. Light/dark and narrow-window screenshots are under `Desktop/test-results/concurrent-*.png`.

The main process owns one worker per resident session; every worker event and renderer command carries a runtime identity. A failed worker retains its visible transcript and does not disconnect siblings. Unit tests cover scoped crashes, stale events/commands, request timeouts, recycling exemptions and committed-history queries that must not erase live text. These crash and timeout cases are unit fixtures, not real-process crash acceptance.

Running, compacting, submitting and approval-waiting workers are not recycled. The viewed worker and unsaved empty workers are retained; up to two recently used persisted idle background workers stay warm, and persisted workers idle for five minutes become eligible for recycling. Drafts, quotes, attachments, reading positions and run metrics belong to session identities, independently of worker lifetimes. Selection temporarily suspends bottom-following so a window reflow cannot move selected prose out of view.

Process isolation does not isolate project files. Same-directory sends now proceed without a generic warning; the earlier preview's confirmation gate was removed by the shared-directory follow-up above. No worktree or filesystem isolation is created. Login/logout and shared MCP changes still require all sessions to be idle. Exit confirmation covers background tasks too. Upstream Step Code and the credential boundary are unchanged. This work has no new real-account, clean-machine or installer-lifecycle acceptance.

## Local Runtime Baseline Alignment

On 2026-10-03, the pinned upstream `519e4de4ed2162d3667be1821cb92ada6b884e5a` was built with the checked Desktop integration patch in a separate checkout at `D:/Desktop Runtime Builds/Step-Code-519e4de`, then staged into `Desktop/runtime/`. Its manifest confirms that commit and Node v24.15.0. The original `Step-Code/` checkout remains at `7dd66cb` with its three pre-existing modifications unchanged; their file hashes were compared before and after staging.

The staging script accepts an explicit upstream path or `DESKTOP_STEP_CODE_SOURCE`, and rejects the wrong commit before overwriting runtime files. A Windows fixture verifies default, environment and argument selection, including argument precedence and retention of an existing runtime manifest on failure. Type checking, all 96 tests, production build, Electron, concurrency, branching, cross-session tools, isolated auth-vault and StepPage registration acceptance passed with the newly staged runtime.

The prepared checkout is retained as a reusable build source (about 305 MiB logical size); the staged runtime is about 122 MiB. No historical packages were deleted and no new installer or preview package was produced. The desktop shortcut still launches the old preview package, not this newly staged development runtime. These checks do not qualify a public release or real-model quality.

## Credential Migration Comparison

PR #30 already handles empty legacy credential stores. This change builds on that recovery logic and compares nonempty credentials structurally: identical values with different object key order no longer falsely conflict. Different nonempty credentials still block startup and remain untouched.

On 2026-10-01, the post-sync source passed type checking, all 42 tests, the production build and `verify-electron.mjs`, `verify-auth-vault.mjs`, `verify-crash-log.mjs`, `verify-steppage-registration.mjs` and `verify-theme-bootstrap.mjs`. The vault unit test and real DPAPI migration acceptance cover reordered equivalent credentials, unchanged encrypted bytes and rejection of real conflicts. These checks use isolated fixture profiles, not the user's account.

## Mathematical Notation

The 2026-09-30 source build passed type checking, 28 tests and background Electron acceptance. The local preview at `Desktop/release/math-preview/` was also packaged and passed the same acceptance against its unpacked executable. Fixtures cover inline and display math, same-line double-dollar notation, fractions, roots, sums, integrals, limits, matrices, cases, preserved code and prices, incomplete stream completion, malformed and oversized formulas, and disabled untrusted commands. Electron screenshots cover light/dark themes and a narrow window; the acceptance checks local font loading, thinking-block math, centered display formulas, horizontal scrolling confined to the formula with both ends accessible, and continued rendering after an invalid formula.

These are isolated renderer/protocol checks, not new real-model or installer lifecycle acceptance. Installation, upgrade and uninstall gates were not rerun for this frontend change. Screenshots are local evidence under `Desktop/test-results/math-*.png`. The first implementation supports dollar delimiters, not `\(...\)` or `\[...\]`; it is not a full LaTeX document compiler.

## Composer Attachments and Image Preview

The 2026-09-30 local preview was packaged at `Desktop/release/attachments-anchored-preview/`. Type checking, 22 tests, the production build and packaged Electron acceptance passed. Isolated fixtures cover file import through preload, document drop, synthetic clipboard image paste, image panning and Ctrl+wheel zoom, anchored expansion, close-during-drag reset, keyboard/focus return, reduced motion, localized image menus and adding transcript images back to the composer.

Image action acceptance substitutes clipboard writes, save dialogs and Explorer launch to avoid touching the user's clipboard or opening foreground windows. It validates the clipboard image payload and saved/cache bytes; it is not unattended OS clipboard round-trip or real-model acceptance. Other documents are local path references for agent tools, not native Word/PPT parsing. No installer, upgrade or uninstall gate was rerun for this frontend change.

Explorer image copies now live in userData `cache/image-previews/`, separate from the application data root. Acceptance verifies lazy directory creation, repeated reveals reusing the same format-specific cache file, and no image cache write to the data root. Existing root-level copies from earlier preview builds are not automatically deleted.

## Desktop Credential Storage

Step login previously wrote the access credential into readable `step-runtime/auth.json`. The desktop now loads that file once, stores a Windows `safeStorage` encrypted snapshot as `auth.dpapi`, then removes the plaintext file. The staged Step runtime uses a desktop-only in-memory auth backend; the renderer never receives the credential. If Windows encryption is unavailable, the ciphertext cannot be unlocked, or a nonempty legacy auth file exists, startup fails closed rather than falling back to plaintext. Normal uninstall removes the desktop Step credential files; upgrades retain them, and the app is configured to retain its user data. This does not encrypt MCP secrets in `config.toml` or protect against processes running as the same Windows user.

The isolated fixture test covers ordinary upstream plaintext persistence and desktop child-process memory storage. `scripts/verify-auth-vault.mjs` covers Electron migration, login, logout and relaunch with fixture credentials; that script uses no real Step account. The disposable Windows VM candidate-install acceptance is recorded in `docs/acceptance/issue-5/README.md`; a separate real-account model pass is recorded below. Neither establishes every public-release gate.
The VM acceptance confirmed that normal uninstall removed the three desktop credential files and retained a test session. It did not create an independent workspace, so workspace survival was not verified. The migration used two builds both labeled `0.1.0`, so it is build-to-build migration evidence rather than a formal version upgrade. An empty `%LOCALAPPDATA%\\Programs\\Desktop for Step Code` directory after uninstall is harmless residue, not a credential-cleanup failure; no custom recursive removal is planned.

## Independent Home

Recorded local build: `Desktop/release-home/`. Startup and the global new-session button create an independent session with a unique working folder under Electron userData `workspaces/independent/`. Project buttons create project sessions. Independent history stays independent on restore and runtime restart; restoring history does not add a project. The composer exposes the working folder and an optional project picker. Acceptance covers first-run and repeat launch, fresh empty drafts, independent history restoration, project selection and existing UI regressions; all five protocol tests pass. These checks use temporary profiles and fixture histories, not paid-model acceptance.

## Themed Select Menus

Recorded local build: `Desktop/release-select/`. All six selects (model, thinking, login profile, theme, language and MCP transport) use Chromium customizable select rendering with application colors, rounded menus and checked indicators. Electron 44 supports `appearance: base-select`; menu placement remains in the browser top layer with built-in keyboard behavior. Acceptance checks cover light/dark menu screenshots, keyboard open/Escape, bottom-edge option geometry and existing settings workflows. Model menu screenshots use an isolated profile without live credentials.

## Startup Workspace (Historical, Superseded by Independent Home)

Recorded local build: `Desktop/release-startup/`. Startup connects the last selected workspace (or the first remembered workspace) and explicitly starts a fresh session. The first renderer snapshot waits for initialization so model and message state arrive together. No remembered workspace retains the project picker; connection failures retain the picker and report an error. Typecheck, five protocol tests and Electron acceptance passed, including an empty startup session and enabled composer without selecting history. Model availability remains controlled by upstream account/configuration; isolated acceptance does not verify a paid model.

## Workspace Session Tree

Recorded local build: `Desktop/release-tree/`. Sidebar history is grouped under remembered working directories, with an independent-session section for history whose directory is not remembered. Project entries are never created from session history alone. Collapse controls and per-directory new sessions remain; the separate session list and search are removed. Acceptance includes an isolated unassigned session and verifies it does not create a project entry. Fixtures do not establish real-model acceptance; empty sessions still follow upstream deferred persistence.

## Product Icon

Recorded local build: `Desktop/release-brand/`. The canonical SVG matches the supplied StepCode.svg byte-for-byte. The empty state uses it; the duplicate sidebar brand header was removed, and the titlebar identity was later replaced by a sidebar toggle. Multi-resolution Windows icons are generated from that SVG and included in the executable, window, installer and uninstaller. The desktop shortcut had an explicit ICO path during that acceptance. Typecheck, production build and packaged Electron acceptance passed; screenshots and the icon extracted from the EXE were visually checked. This does not add any real-model acceptance evidence.

## Custom Window Chrome

Recorded local build: `Desktop/release-window/`. Windows uses a frameless Electron window with a theme-aware 46px titlebar, native draggable region and explicit minimize/maximize/restore/close controls. The close control delegates to the existing task-aware close flow. The titlebar project icon has since been replaced by a sidebar toggle, and File, Edit, View and Help menus were added alongside it (see Native Menus and Sidebar Motion). Reference implementation inspected: local Oh-DSH `src/main.ts` and `src/client.ts`. Electron checks cover minimize, maximize and restore plus existing layout/streaming regressions. Native drag, edge resize and Windows snap interactions still need manual acceptance.

## Layout Refinement

Recorded local layout build: `Desktop/release-layout/`. Sidebar spacing is consolidated, transcript and composer share a layout column, short user messages are content-sized, and composer height grows with input. No runtime behavior or assets were changed. Type checking, build, Electron workflow/streaming regression, and wide/narrow layout checks passed. Layout screenshots use explicitly injected test messages in an isolated profile, not a live model conversation.

## Streaming White-Screen Fix

The renderer incorrectly expected cumulative `message` snapshots on RPC `message_update` events. Upstream emits `assistantMessageEvent` deltas instead. The renderer now accumulates text/thinking/tool-start events and uses `message_end` as the final authoritative snapshot. An error boundary provides a reload action instead of a blank screen.

Regression checks include unit coverage and actual Electron renderer delivery of text and tool-start wire events without a `message` field. The updated executable and installer for that check were in `Desktop/release-fixed/`. Those builds did not persist renderer crash logs; startup and runtime crash logging was added later. This diagnosis was established from the protocol implementation and regression tests, not a recovered crash log.

## Install, Upgrade and Uninstall Residue

`scripts/verify-residue.mjs` snapshots the machine, installs, launches once, uninstalls, snapshots again, and reports what survived; an `upgrade` variant installs v1, launches it so it produces real userData, installs v2 over it, launches again, then uninstalls.

Verified on a development host, not a clean machine: install and uninstall both complete with exit 0; the install directory loses every file (an empty root directory remains, which is NSIS behaviour); both shortcuts, the registry uninstall entry and the registry app key are removed; userData is retained as `deleteAppDataOnUninstall: false` intends and holds no credentials because no login was performed. Across v1 → v2 the userData file set is unchanged (0 missing, 0 emptied, 0 modified) and the install directory matches a fresh v2 install rather than v1 + v2, with one registry uninstall entry rather than two. `~/.stepcode` was compared per-file across the whole window: 248 files, no add, no remove, no change.

The verdict is checked in both directions. In the installed state the rows fail as they should; deleting `userData\preferences.json` before the over-install makes the userData rows fail and names the file. Launch is observed through process liveness rather than a fixed sleep. Note that v2 recreates a deleted `preferences.json` on first run, so survival is judged on the pre-launch snapshot as well.

## Responsive Sidebar

PR #7. The sidebar auto-collapses on narrow windows. Typecheck, five protocol tests, production build and Electron acceptance passed with isolated fixtures; no paid-model execution was used.

## Performance Bar

PR #8. Run timing, tool count, token usage and cache metrics appear beneath the composer, plus session totals from Step Code's existing stats RPC. Typecheck, 7 tests, production build and Electron acceptance passed with isolated fixture data. No paid-model execution was used.

## Native Menus and Sidebar Motion

PR #13. The titlebar project icon is replaced by a sidebar toggle alongside File, Edit, View and Help menus wired to existing actions, the window bar is 46px, and sidebar collapse, expansion and responsive threshold changes animate with cubic easing while respecting reduced-motion preferences. Typecheck, nine tests, production build and Electron acceptance passed.

## Real-Account Acceptance

The feature-level integration checks above use isolated fixture profiles; the development-host residue check and the disposable-VM candidate-install pass are separate, as described in their sections. This section records a further pass against a real Step Plan account outside that VM, run by driving a packaged build through Playwright with sign-in completed manually in a browser. It was not unattended CI.

Browser authorization completed and the account reported `step_plan · valid`. A pre-existing legacy `auth.json` was migrated to `auth.dpapi` and removed on first launch; no plaintext `auth.json` persisted.

One coding task completed end to end on the `step-5-preview` model using the desktop's tool-approval flow. The desktop's token total matched the runtime's `get_session_stats`, including cached tokens.

## Startup and Runtime Crash Log

The main process installs handlers for `uncaughtException`, `unhandledRejection`, `render-process-gone` and `child-process-gone`, and records a startup phase at runtime staged, vault loaded, admin started, rpc started and window created. Each failure writes one file into `%APPDATA%\Desktop for Step Code\logs\` named `crash-<timestamp>-<id>.log`, holding the app version, whether the build is packaged, the phase at failure, the error and its stack, and the userData and logs paths; the write goes through a temp file and rename and stays silent when it fails, because a crash handler that can crash is worse than none. The ready-path failure keeps its existing dialog-and-quit behaviour and only gains a file written first, so no startup outcome changes.

`RpcProcess` now attaches the child exit code and a redacted stderr tail to both the runtime-exit error and its event, so an unexpected Step Code runtime exit is recorded with them; lines that look like credentials or environment values are dropped before anything reaches disk, since upstream stderr can echo them.

Acceptance uses a real failure rather than a mock: `scripts/verify-crash-log.mjs` migrates a fixture credential into `auth.dpapi`, then writes a conflicting plaintext `auth.json` so `vault.load()` refuses to start, and asserts that the crash log names that error and the phase while never echoing credential values. It runs in the Windows integration check after `verify-electron.mjs`.

## Passed Locally

- TypeScript checks and production renderer/main/preload build.
- JSONL byte-boundary decoding, including split Chinese characters and CRLF.
- Isolated child environment: provider key and legacy auth path overrides are not inherited.
- Staged Step Code RPC handshake, message/model queries, and management process startup.
- MCP config round trip with secret values omitted from management responses.
- Real Step Code runtime against a local deterministic SSE fixture: streaming, completed message, persisted session discovery, rename, new session and restored history. This is a protocol test, not a real model quality test.
- The local SSE fixture also requests an actual upstream `write_file` call: Step Code emits its permission confirmation, the test client approves, and the temporary file content is verified.
- Electron source launch and packaged executable: isolated user directory, account settings, workspace connection, rename, MCP save, theme switching, narrow window, no renderer Node access, no renderer exceptions.
- Windows x64 NSIS installer generated.
- Native File, Edit, View and Help menus, and animated sidebar transitions.
- Real Step Plan sign-in, encrypted credential with no plaintext `auth.json` at any point, one real coding task with tool approvals, and token agreement between the desktop's accumulation and `get_session_stats`.

Screenshots and ephemeral test output are in `Desktop/test-results/` (ignored by Git).

## Cross-Session Tools Preview

Recorded local builds: initial `Desktop/release/cross-session-preview/win-unpacked/`, then `Desktop/release/session-reference-preview/win-unpacked/` with sidebar reference copying. Desktop supplies three extension tools for listing resident sessions, reading another resident session's recent prose, and delivering one user-approved message. The Electron main process owns the loopback broker and per-worker bearer tokens; renderer access and upstream source changes are not required.

Typecheck, 74 unit tests and the production build passed after adding session references. Source concurrency, Electron, theme-bootstrap and isolated auth-vault checks passed for the initial preview, along with packaged Electron acceptance. The reference preview passed source and unpacked `scripts/verify-cross-session.mjs` against real Step Code RPC workers and a deterministic local SSE fixture. Cross-session coverage includes tool registration, reads without navigation or unread-state changes, source-scoped deferred approval, cancellation, idle delivery, busy-session queueing, read-only rejection, peer provenance, aborted confirmation cleanup, narrow layout and English confirmation. Reference coverage includes Chinese/English context-menu labels, copying a background session without navigation or unread changes, and passing the copied reference directly to read/send tools. Clipboard writes are intercepted in the isolated test process so acceptance does not replace the user's real clipboard.

Reads include only bounded user/assistant prose from resident sessions, not reasoning or tool payloads. Recycled history must first be opened in Desktop. Each send requires separate approval even in bypass mode; approval grants delivery, not authority to obey peer instructions or continue an automatic conversation. These tools do not lock files or guarantee conflict-free shared-workspace edits.

Screenshots are in `Desktop/test-results/cross-session-{read,approval,narrow,english}.png` and `Desktop/test-results/session-reference-menu.png`. Session references are identifiers for these tools, not registered Windows deep links in this preview. This pass did not use a paid model or a real account and did not test installer lifecycle. Fixture success establishes the transport and approval behavior, not autonomous collaboration quality.

## Session Branching Preview

The 2026-10-03 source follow-up connects sidebar Branch to a main-process `cloneSession` action. Management uses the upstream `SessionManager.forkFrom` API to copy saved history before a worker restores it; cold originals therefore remain byte-for-byte unchanged even when the runtime would otherwise append a thinking-level entry. New workers verify the copied session identity and preserve effective permissions. Resident sources are idle-checked and locked, while other tasks continue. Failed worker preparation removes its owned copy, not the original.

Type checking, 111 unit tests, the production build, general Electron acceptance and real-RPC concurrency acceptance passed. The extended source branching acceptance verifies cold copies with a latest user message and metadata leaf, retained images and source bytes, original parent linkage, draft preservation, unknown IDs, busy-target menu/API rejection, resident permission inheritance and branching another idle session while the viewed task continues running. Existing latest-reply clone, inline editing and explicit fork regressions remain included. Archive acceptance also passed with the updated runtime adapter. Screenshots include `Desktop/test-results/branch-sidebar-menu.png` and `branch-sidebar-created.png`. This follow-up was not packaged.

The subsequent 2026-10-03 preview at `Desktop/release/archive-branch-preview/` packages this follow-up together with archive management and turn dates, using the staged `519e4de4ed2162d3667be1821cb92ada6b884e5a` runtime. The unpacked executable passed general Electron, session branching and archived-session acceptance with isolated profiles. The bundled admin adapter matches the source SHA-256. The desktop shortcut now targets this preview. Its installer is about 144 MiB and the unpacked application about 537 MiB; installer SHA-256 is `c80fde9ce7c4ddfc8ae6007ce5e35ec86e1cd7a0d55b9a6da1518a07343799c7`. No installer lifecycle or new paid-model acceptance was performed. Older packages were inventoried and retained, not deleted.

The corrected 2026-10-02 preview at `Desktop/release/session-edit-preview/win-unpacked/` passed type checking, 89 unit tests, production build, source and packaged Electron acceptance, and source and packaged `scripts/verify-session-branching.mjs`. Source concurrency and cross-session tool regressions also passed.

The latest saved Agent reply clones the full current history into a new conversation. The latest saved user message's pencil opens an inline editor with Cancel and Send; opening or cancelling does not change history. Sending navigates before that question and resubmits the edited text with the original images in the same session and worker. Earlier user messages cannot be edited. Stable active-history entry IDs identify branch and edit points; stale, ambiguous, forged and busy-source requests are rejected. Explicit branches use a separate worker, retain the original worker and conversation, and inherit permissions. Editing preserves the ordinary composer draft and permissions; a rejected submission that appended no user turn restores the original saved history. Neither operation rolls back workspace files or isolates the working directory.

Acceptance covers duplicate questions, first-question retry without old context, unchanged clone source history, inline focus/cancel/send, same-session and worker identity, background runs remaining active, read-only permission inheritance, distinct branch names, persisted edited history after worker restart, images, ordinary draft preservation, narrow/dark layouts and English controls. Evidence is in `Desktop/test-results/branch-{latest-reply,edit-inline,edit-dark-narrow,reopened-dark-narrow}.png`. These checks use real staged Step Code RPC with an isolated deterministic local SSE fixture, not a paid model or installer lifecycle acceptance.

The inline editor reuses the quote preview's compact 4px trackless scrollbar; checks cover hidden native scrollbars, keyboard limits and wheel scrolling. The quote interaction regression also passed. Submission recovery is covered by transport unit tests, while edited-draft retention across temporary history removal and restoration uses an injected IPC failure fixture; neither establishes recovery from every possible runtime or provider failure.

## Context Inspector Design Preview

The 2026-10-04 source preview adds Context as the second right-rail action, between Summary and conversation navigation. It reads existing snapshot messages, session statistics and runtime state through the typed preload bridge; no new upstream or IPC capability is added. The panel shares Summary's gutter-first docking and remains nonmodal in narrow windows. Summary's automatic opening rule is unchanged.

Context occupancy and cost are labelled estimates, not exact provider-request size or billed cost. Cumulative session usage is separate from the latest assistant response. Optional reasoning usage is shown as a subset of output; unknown values remain unknown. Message-category counts describe messages, not per-role token proportions. Expandable JSON is a bounded, whitelisted display projection with image bytes and named credential fields omitted and common credential strings redacted; it is not the final provider request or a complete arbitrary-text secret detector.

Type checking, 114 unit tests, production build, Context presentation acceptance, Summary regression and general Electron acceptance passed. The Context check uses an isolated deterministic snapshot fixture, not a paid model or the user's real session statistics. It covers role filtering, JSON disclosure/copy with clipboard interception, missing statistics, light/dark themes, 900/640-pixel nonmodal layouts, keyboard dismissal/focus and reduced motion. Screenshots include `Desktop/test-results/context-panel-light.png`, `context-panel-detail-dark.png`, `context-panel-narrow.png` and `context-panel-small.png`.

This preview was not packaged. The desktop shortcut still launches the previously recorded hanging-summary package; neither the source-only overlay-input fix nor Context is included there. No installer lifecycle or new real-model acceptance was performed.

The capacity-color follow-up applies a fixed 0-100% scale to occupancy text and filled ticks only: subdued green below 40%, neutral from 40-60%, then increasingly saturated red up to 100%. Light and dark surfaces use separate lightness values; zero and unknown remain neutral. The final tick is fractionally filled, and over-capacity values retain their real text while meter fill and color stop at 100%. Cumulative tokens, cost and role colors remain unchanged. Type checking, 115 unit tests, production build and Context presentation acceptance passed, including 7.1/50/80/95/0% in both themes and unknown-state restoration. Capacity screenshots are `Desktop/test-results/context-capacity-{light,dark}-{7.1,50,80,95}.png`. This follow-up is also source-only.

The subsequent 2026-10-04 package at `Desktop/release/context-inspector-preview/` includes this inspector, capacity colors and the previously source-only Summary overlay-input fix. Its unpacked executable passed Context presentation, general Electron and Summary board acceptance with isolated profiles. The bundled runtime manifest remains at `519e4de4ed2162d3667be1821cb92ada6b884e5a` with Node v24.15.0; staged admin/session helpers match current source hashes. The desktop shortcut now targets this preview. Installer SHA-256 is `ba7ebf5de9685a142fb71719253134aec4491e84fe286e53cc1d2d7c930cb910`; installer and unpacked app total about 681 MiB. Earlier source-only statements describe their respective checkpoints and are superseded by this package. Historical preview packages were inventoried and retained, not deleted. The installer was not run, and no new paid-model acceptance or public release qualification was performed.

The subsequent source-only visual-unification pass makes native scrollbars 4px, trackless and arrow-free across the app, preserving native wheel/keyboard/drag behavior and existing hidden-native/custom scroll surfaces. The main conversation thumb now also uses the quote's 4px width. Context and conversation navigation share the `right-panel-enter` animation with 260ms cubic ease-out (`.22, 1, .36, 1`); Summary's existing quadratic board/layout animation is unchanged. Navigation keeps its header stationary while its list scrolls. Type checking, 115 unit tests, production build, Context presentation, general Electron and quote interaction acceptance passed. The Context fixture additionally checks native scrollbar styles on the panel and JSON, identical Context/navigation motion, a 36-turn navigation list with real wheel input, and reduced-motion suppression. Updated screenshots include `context-panel-detail-dark.png` and `right-panel-navigation-trackless.png`. This follow-up is not in the desktop shortcut's package.

The subsequent 2026-10-04 package at `Desktop/release/right-panel-polish-preview/` includes that visual-unification pass. Packaged Context presentation (including navigation motion and scrollbar styles), Summary board and general Electron acceptance passed with isolated profiles. The bundled runtime remains the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` baseline with Node v24.15.0; staged admin/session helper hashes match source. The desktop shortcut now targets this unpacked executable, superseding the previous source-only package status. Installer SHA-256 is `d9045a895832df108c1634bc49251bd10a57fff937979609d97afa7d2634a1df`; installer plus unpacked app total about 681 MiB. The 22 preview directories total about 13.56 GiB and were inventoried without deletion. The installer was not run, the user's app was not automatically launched, and no paid-model or installer-lifecycle acceptance was added.

The subsequent source-only navigation-anchor fix removes the outgoing Summary/Context docking reservation immediately when conversation navigation or file details replaces it. Previously navigation mounted before that still-closing flex track, placing it roughly 306 CSS pixels away from the rail in the docked fixture before it slid back. The replacement panel now owns its width without inheriting that displacement; navigation retains its cubic entrance and ordinary Summary opening/closing remains quadratic. The extended Context acceptance samples every animation frame for Context-to-navigation, Summary-to-navigation and an interrupted Context opening, requiring the reserve to be zero and the navigation edge to remain within its own 8px entrance of the rail. Evidence is `Desktop/test-results/right-panel-switch-frames.json` and `right-panel-navigation-anchor-fixed.png`. Type checking, 115 unit tests, production build, Context, Summary and general Electron acceptance passed. This fix is not yet included in the desktop shortcut's package.

## Per-Turn Changes Design Preview

The 2026-10-04 source-only preview appends an unframed change ledger after each completed response's content and before its copy/branch/time footer. Active responses do not show the ledger or parse their patches on each text delta. Every historical response retains its own tool records. A three-file initial list expands to all recorded files; opening a row reveals a local read-only unified diff with old/new line numbers, syntax highlighting, excerpt copying, trackless scrollbars and reduced-motion support. Repeated edits to one file remain selectable operations, and aggregate counts are explicitly per-edit totals, not a synthesized net workspace diff.

The renderer consumes successful paired tool-call/result messages through the existing bridge. The pinned runtime's edit tool persists a standard patch in `ToolResultMessage.details.patch`; no upstream checkout, runtime staging, filesystem access or new IPC handler was added. Parsing uses `diff` 8.0.2 and highlighting uses the existing transitive version of `highlight.js`, now declared directly at 11.11.2. Invalid, multi-file or oversized patches are excluded. Known file-mutation calls without a usable patch mark the visible ledger as partial. Unstructured Shell modifications and whole-file writes without before-images are not captured, so complete turn-wide attribution is not claimed. No Git repository view, undo, checkout or filesystem write is implemented by this preview.

Type checking, 121 unit tests, production build and general Electron acceptance passed. `scripts/verify-turn-changes.mjs` uses isolated tool-result fixtures and a live renderer `agent_end` event, not paid-model editing. It checks end-only appearance and placement, reopening history, four-file previews, repeated-operation selection, excerpt copy with clipboard interception, highlighting, partial records, Chinese/English controls, 640-pixel containment and native horizontal-keyboard scrolling, scrollbar styling and reduced motion. Screenshots are `Desktop/test-results/turn-changes-light.png`, `turn-changes-summary-detail.png`, `turn-changes-preview-detail.png`, `turn-changes-dark-detail.png` and `turn-changes-narrow.png`.

This preview was not packaged; the desktop shortcut remains at the previously recorded right-panel-polish package. The screenshots are presentation examples, not proof of comprehensive real-world file-change capture. No new large package or public release was produced.

## Recorded-Change Undo Preview

The 2026-10-04 follow-up places Undo immediately to the left of the turn's aggregate +/- counts. File rows and the additional-files control no longer have disclosure arrows; whole-row clicks and keyboard activation still reveal previews. Undo opens a focus-trapped, cubic-animated confirmation dialog, with a red confirmation button in both themes and a neutral transcript entry. Cancel and Escape preserve files and return focus; successful undo changes the entry to Undone while retaining the original diff and conversation history.

Electron captures eligible completed turns from its own worker messages at `agent_end`, not from renderer-supplied paths or patches. A bounded Desktop-owned recovery record under `userData/turn-undo` stores reconstructed pre-edit UTF-8 file content and hashes of the captured post-edit versions. Reverse patches require exact recorded positions without fuzzy relocation. Old histories without captured records cannot create a baseline by requesting undo. Typed IPC accepts only resident runtime identity, the exact edit-ID list and a short-lived single-use confirmation token. Read-only sessions cannot prepare or execute undo. The main process checks for running same-directory workers, temporarily excludes new Desktop mutations and peer deliveries, checks all files before writing, and rechecks each open file's version and identity immediately before its write. Paths outside the workspace, `.git` internals, symlinks/junctions, hardlinks, binary files and oversized records are rejected.

This is recorded-edit undo, not a filesystem transaction or a whole-turn rollback. Shell/external operations and writes without usable patches remain outside its scope. A changed file blocks the batch before its first write when detected during preflight. External programs do not participate in Desktop's mutation exclusion: a race during writing or an I/O failure can leave a partially restored batch. The durable recovery record is marked failed before writes and retained for inspection; it is not automatically rolled back over potentially newer edits. Complete cross-process atomicity, comprehensive capture and automatic recovery are not claimed.

Settings > General includes Create changes and undo example. Each invocation creates a separate demo workspace and real saved session under Desktop's independent-workspace root, with no model request or credential/profile migration. It includes a two-edit file that can actually be restored, plus a previous turn deliberately followed by another file change so its undo is blocked. Recreating the example does not reset or overwrite earlier demos or project files.

Type checking, 128 unit tests, production build, source and packaged general Electron/Context/Summary/change-ledger acceptance passed. Source and packaged `scripts/verify-turn-undo.mjs` additionally cover a real upstream edit over deterministic local SSE and its `agent_end` capture, actual file restoration, confirmation cancellation/Escape/focus, a file changed after confirmation, repeated-edit reversal, unchanged history, persistence after reload, repeatable demo sessions, forged identity/token rejection, read-only rejection, exclusion of a running cloned same-workspace peer, Chinese/English, light/dark and 640px layout. This uses isolated profiles and a local provider fixture, not a paid model or the user's real files. Screenshots include `turn-undo-demo-light.png`, `turn-undo-confirm-{light,dark,narrow}.png` and `turn-undo-completed.png`.

The package at `Desktop/release/turn-changes-undo-preview/` includes this follow-up, the previously source-only ledger and navigation-anchor fix. The desktop shortcut targets its unpacked executable. Installer SHA-256 is `fe3beb8ede23085373c16134b9dca3ad69df09e05ae087203e2350e77038d2a8`; installer plus unpacked app total about 682 MiB. The staged and packaged runtime retain the pinned `519e4de4ed2162d3667be1821cb92ada6b884e5a` baseline and Node v24.15.0; the Node hash matches its manifest and both Desktop helper hashes match source. Full staging was blocked by the in-use Node executable; only the changed management helper was synchronized, without stopping the user's workers or modifying the upstream checkout. The 23 preview directories total about 14.23 GiB and were inventoried without deletion. The installer was not run, the user's app was not automatically launched, and no new paid-model, installer-lifecycle or public-release qualification was performed.

### Live File List And Navigation Exit Follow-Up

The subsequent 2026-10-04 source-only follow-up puts the running turn's recorded file count and accumulated +/- totals at the center of the existing composer auxiliary strip, alongside quotes on the left and return-to-bottom on the right. Its anchored, cubic-animated native popover lists filenames and per-file counts only. It contains no code preview, undo, file-disclosure actions or link to a new right-side diff panel. Completion removes the live control without changing strip height; the existing completed-turn ledger and its inline previews take over. A cached parser reuses completed tool results across prose deltas; counts retain the ledger's recorded-patch scope and do not claim a net repository diff.

File rows now inset their ordinal and totals by 10px (8px in narrow windows). Conversation navigation retains its right-rail anchor while entering and exiting with 260ms cubic transitions, remains inert during exit and unmounts afterwards; rapid reopen cancels removal and reduced motion skips the exit delay. Summary's approved quadratic motion is unchanged.

The production example entry, preload method and management seed handler were removed. Undo acceptance now creates test-only sessions through real RPC tools in isolated temporary workspaces. No automatic deletion migration was added. Previously generated examples in the real user profile have not been deleted because the user is still running the older preview that owns them.

Type checking, 129 unit tests, production build, source general Electron, Context/navigation, Summary, quote interaction, change-ledger/live-list and real-RPC undo acceptance passed. Navigation checks sample intermediate exit opacity and shrinking dock reservation, interrupted reopen and reduced-motion removal. Live-list checks cover centered same-row alignment with a quote and return button, 640px containment, no diff controls, and actual successful upstream edits before a held stream completes. Evidence includes `turn-changes-live-fixture.png`, `turn-changes-live-list-light.png`, `turn-changes-live-narrow.png`, `turn-changes-live-light.png` and `navigation-close-frames.json` in `Desktop/test-results/`.

This follow-up has not been packaged; the desktop shortcut remains on the previous undo preview. The staged admin helper matches source after removing its demo seed handler, and the pinned runtime baseline is unchanged. No new paid-model, installer-lifecycle or public-release acceptance was performed.

The subsequent source-only motion follow-up replaces the live popover's entry-only animation with 200ms cubic transitions in both directions. Discrete display/overlay transitions retain the native top layer during exit; positioning is preserved, closing content is inert, and interrupted reopen reverses smoothly. The centered chip also fades away on completion without changing auxiliary-strip height. Reduced-motion preferences remove both transitions and the chip's exit delay.

Live aggregate and per-file +/- counts use MIT-licensed `@number-flow/react` 0.6.2, pinned in the lockfile, with 220ms cubic rolling: additions upward, removals downward, including digit carry and interrupted rapid updates. Initial history renders without replaying old count updates. The component keeps current values available through its accessible name and respects reduced-motion preferences; it changes presentation only, not recorded patch counts or RPC data. Completed-turn previews and the deferred right-side diff feature remain unchanged.

Source motion acceptance samples actual native popover exit frames, anchored position, rapid reopen, completion opacity and stable strip height. It inspects the rolling component's actual digit animations for both directions, carry, repeated updates settling to the latest counts and no animation under reduced motion. Evidence is `live-popover-close-frames.json`, `live-summary-completion-frames.json` and `live-diff-counts-updated.png`. This motion follow-up has not been packaged.

The subsequent 2026-10-04 package at `Desktop/release/live-turn-motion-preview/` includes the live file list and enter/exit/count animations, navigation exit, row insets and removal of the production demo entry. Its unpacked executable passed general Electron, Context/navigation, Summary, change-ledger/live-motion and real-RPC undo acceptance with isolated profiles. Type checking and production build also passed; the previously recorded 129-unit-test pass remains current for these source changes. The desktop shortcut now targets this preview, superseding the preceding source-only package status. The running older application was not stopped; close it before using the updated shortcut.

The staged and packaged runtime remain at `519e4de4ed2162d3667be1821cb92ada6b884e5a` with Node v24.15.0. The upstream bundle matches the pinned built checkout, the Node binary matches its manifest hash and both packaged Desktop helpers match source. Full restaging was unnecessary. The new rolling dependencies' license notices are copied by the build script and were verified inside `app.asar`. Installer SHA-256 is `23e2a8b4ffd57289c99ff5bcb8a99bff6257745949a7382cd79d71dd20ea3cd5`; installer and unpacked application are about 144.29 and 537.23 MiB respectively. The 24 preview directories total about 14.90 GiB and were inventoried without deletion. Older real-profile example data remains untouched while its previous application is running. No installer execution, new paid-model acceptance or public-release qualification was performed.

## Right-Side Diff Preview

The 2026-10-04 source-only preview adds a +/- Changes entry to the right rail. Its source selector separates the last completed turn's recorded tool patches from a read-only Git branch comparison. The turn view excludes an active response and does not substitute an older changed turn when the latest completed response has no recorded edits. The branch view compares the selected base's merge base with HEAD against the current files, including committed, staged, unstaged and untracked changes. Branch mode is disabled outside Git, when Git is unavailable, and before the first commit.

Repository access stays in narrow main-process IPC handlers bound to resident runtime identities. Bounded Git subprocesses use no shell, disable external diff/textconv and optional locks, and remove inherited Git environment overrides. File previews reject forged paths and unsafe links; binary, oversized and known credential files have explicit restricted previews. Recognizable inline secrets are redacted, but exhaustive arbitrary-secret detection is not claimed. Submodules are excluded, renames appear as delete/add, and the displayed list is capped at 200 files. This panel has no staging, checkout, commit or repository undo controls.

The panel and file disclosures use cubic enter/exit motion with reduced-motion handling and trackless scrollbars. Summary's existing motion is unchanged. Type checking, 138 unit tests, production build and dedicated review acceptance passed. The latter uses a temporary real Git repository and actual upstream edit-tool calls through a local deterministic RPC/SSE fixture, not a paid model or the user's profile. It verifies differing turn/branch scopes, base changes, unchanged Git index/status, IPC guards, light/dark and narrow layouts, intermediate close frames and non-Git disabling. Screenshots are `Desktop/test-results/review-{last-turn-light,last-turn-detail,branch-light,branch-detail,branch-dark,branch-narrow,no-git}.png`.

No package, shortcut change, public release or new paid-model acceptance was produced.

The subsequent 2026-10-04 preview package at `Desktop/release/right-diff-preview/` includes the diff panel and the custom 14px rounded-stroke disclosure SVG. Source type checking, 138 unit tests and production build passed. The unpacked executable passed dedicated diff, general Electron, Context and Summary acceptance with isolated profiles and deterministic local fixtures. The desktop shortcut now targets this package; the user's older running application was not stopped. Close the old application before launching the updated shortcut.

The packaged runtime is byte-identical to the previously staged runtime, retaining manifest baseline `519e4de4ed2162d3667be1821cb92ada6b884e5a` and Node v24.15.0. Its Node hash matches the manifest and both packaged Desktop helpers match source. The current sibling upstream build has a different bundle hash and was deliberately not restaged; this package does not claim to update upstream. Installer SHA-256 is `28b2a992a70b751798202a3460a06a270765b2a82e330d9c65eb1b5380331e4d`. The new directory totals about 681.78 MiB; 25 preview directories total about 15.56 GiB and were inventoried without deletion. No installer execution, paid-model test or public-release qualification was performed.

The subsequent source-only follow-up replaces the review source/base HTML selects with Electron native radio menus while retaining the custom disclosure SVG on their buttons. The main process owns menu construction, validates the source selection, resident identity and coordinates, and derives base choices from Git rather than renderer-supplied labels. Branch remains selectable outside Git and after a failed Git query; the panel shows separate non-Git, no-commit and unavailable states without automatically switching back to Last turn. Invalid comparisons show neither a base selector nor misleading zero-change totals. Refresh preserves the selected source.

Type checking, 138 unit tests, production build, general Electron and dedicated review acceptance passed. Native menu construction, radio checks, selection and cancellation are exercised via main-process popup hooks; actual Windows menu rendering and OS-level pointer input are not established by these automated screenshots. The non-Git empty-state screenshot is `Desktop/test-results/review-no-git.png`. This follow-up has not been packaged; the desktop shortcut still targets the preceding preview.

The subsequent source-only navigation refinement shares the `right-panel-header` primitive across Context, Changes and Conversation navigation. Navigation uses Context's 344px neutral full-height surface, divided rows, 52px header and 26px action buttons rather than the older 300px sidebar-style panel. It consumes the existing right gutter before reserving layout space, overlays without an input-blocking backdrop in smaller windows, and preserves original per-turn timestamps, trackless scrolling and cubic enter/exit. Summary's hanging treatment and motion are unchanged.

Type checking, production build, general Electron, Context/navigation and dedicated diff acceptance passed after this refinement. Context/navigation checks compare the actual surface/header geometry, verify visible transcript wheel input and composer focus while navigation remains open at 640px, and sample close, rapid reopen and reduced-motion behavior. Screenshots are `Desktop/test-results/navigation-unified-{dark,light,narrow}.png` and `navigation-unified-detail-{dark,light}.png`; their conversations are isolated presentation fixtures. No new package or shortcut change was made.

The subsequent 2026-10-04 package at `Desktop/release/right-panel-unified-preview/` includes the native review menus, selectable non-Git branch state and navigation/header visual unification. Type checking, 138 unit tests and production build passed. Its unpacked executable passed general Electron, Context/navigation, diff and Summary acceptance. The Summary regression script was updated to dismiss navigation with its header action rather than the removed modal backdrop. Menu radio construction, selection and cancellation still use main-process test hooks, not OS-level pointer automation.

The desktop shortcut now targets this package; the prior running application was left untouched. Runtime bundle and helper hashes are identical to the previous staged package, and Node matches its manifest hash. Installer SHA-256 is `a73f6b5ffdba8bf3d15792b1bff06e07dfabd63679bffe667418f80b4d72f0ab`. The new preview directory totals about 681.79 MiB; 26 preview directories total about 16.23 GiB and were inventoried without deletion. No installer execution, real-profile migration, paid-model test, commit, PR or public release was performed.

## Release Boundary

### Links, Deliveries and File Preview

The 2026-10-07 preview adds icon-bearing web links with hover-only dashed underlines and bounded metadata cards, delivery references collected from the current turn, and built-in opening of web links and local HTML. An independent read-only File Preview panel supports Markdown rendered/source modes, highlighted text, wrap, copy, refresh and a native file chooser. Standard/Wide width is persisted; fullscreen restores that underlying width.

The split opening control uses application-rendered anchored menus. Selecting an application opens once and updates the primary button's icon/name. Successful explicit choices persist per extension across reload and application restart without changing Windows associations. Unavailable associations fall back to the internal destination; the native other-application picker remains a one-time action. The deferred new-session model/thinking selector and sidebar hover/focus scrollbar were also corrected.

Source and packaged checks passed for links, deliveries, File Preview and general Electron behavior. File Preview tests exercise real file IPC, association enumeration and preference persistence, but intercept third-party application launches. HTML checks cover moving nonblank content, declared local assets, denied neighboring files, blocked external network, tab reuse and renderer isolation. Screenshots cover light/dark, narrow, wide and fullscreen layouts. These checks do not establish paid-model behavior, third-party editor compatibility or installer lifecycle acceptance. The Step Code upstream checkout and pinned runtime baseline are unchanged.

### Proposed Session and Greetings

The 2026-10-07 new-session page holds an in-memory proposal. Opening New inherits the viewed project, and the searchable picker offers remembered projects, a native directory chooser and independent mode. Leaving before the first send creates neither a worker nor a persisted conversation or independent folder. Model, permission and thinking selections are available before creation.

The Chinese heading starts with `让梦想阶跃星辰`, then types and deletes local-time, weekend and common greetings, with a low-frequency developer motto `踽踽而行 步履不停`. Text centers independently of the cursor. Composing holds the current complete phrase; reduced motion displays static text. English retains its smaller existing corpus; expanded English copy is deferred. Project choices show at least five rows where window space permits.

Assistant message footers, including copy, branch, total elapsed time and timestamp, appear on hover or keyboard focus with an opacity transition. Touch devices retain visible controls. Elapsed-time data is unchanged.

Dedicated isolated-profile acceptance covers proposal cancellation, project inheritance, native-directory selection through a test hook, first-send protection, greeting replacement and composing pause, light/dark/narrow layouts and reduced motion. Timing acceptance checks default hidden and hover-visible timestamps alongside ticking and frozen history. These fixtures do not establish paid-model or installer lifecycle acceptance. The staged runtime is reused without upstream checkout changes.

Type checking, 207 tests, production build and general Electron acceptance passed on the latest main baseline. The package at `Desktop/release/new-session-pr-preview/` passed dedicated new-session and timing acceptance. The ordinary desktop shortcut targets its unpacked executable. Installer SHA-256 is `909b8bd1229919df5d2f52578e54e1f3ef31ffb74db9b8a959019dac83517e3c`; its directory totals about 704.02 MiB. Running user windows and old packages were preserved.

### Runtime Summary Board

The 2026-10-07 Summary board replaces placeholder content with repository changes, the current session's active-branch task plan, actual MCP connection states and available Skills count. Repository information is hidden outside Git; its change link opens the branch comparison. MCP indicators are read-only. Skills have a count only. The original hanging-board layout and quadratic motion remain unchanged; internal disclosures use cubic enter/exit transitions and reduced-motion handling.

The pinned Desktop runtime integration adds a read-only `get_desktop_summary` RPC inside the live bundle. It reads the latest active-branch `step-tasks` record, the live MCP registry (including globally disabled servers) and the resource loader's Skills catalog. Desktop validates session identity and projects bounded presentation fields without exposing MCP configuration or credentials. Checklist completion reuses the subagent status motion, holds the completed row through its check animation, then folds it into the completed group. Historical completion does not replay that animation.

Type checking, 197 tests, production build, general Electron, dedicated Diff, Summary layout and real-runtime Summary acceptance passed. The latter uses an isolated profile, a temporary Git repository, disabled/failed MCP fixtures, one local Skill and a deterministic local provider that calls the real `task_update` tool. It verifies completion motion, branch-mode navigation, light/dark and narrow layouts, and clearing state after switching sessions. Screenshots are `Desktop/test-results/summary-runtime-{dark,completed,light,narrow}.png`. These checks do not establish paid-model behavior or installer lifecycle acceptance.

The local package at `Desktop/release/summary-board-preview/` passed packaged general Electron and real-runtime Summary acceptance. Packaged Node, Step Code bundle, manifest, both Desktop helpers and terminal host match staged/current resources. Runtime remains pinned to `519e4de4ed2162d3667be1821cb92ada6b884e5a`, Node v24.15.0, with the new Summary RPC integration patch. The normal desktop shortcut targets this package without demo arguments; the existing running application was preserved. Installer SHA-256 is `3fb50f4ffaefa2439eac27fc2d3f4ff68c267756b1b77b1074e5ffc1b0b3a355`. The new directory totals about 702.30 MiB; nine release directories total about 6.13 GiB and were inventoried without deletion. No installer execution, paid-model acceptance, commit, push or PR was performed.

The source-only follow-up adds 240ms cubic height/opacity entrance transitions for tasks created after the initial Summary snapshot. Existing tasks do not replay entrance when opening a session or reopening the board. Reduced motion disables the transitions. The real-runtime fixture calls `task_create` and samples intermediate height/opacity and final geometry alongside the existing completion checks. This follow-up is not yet included in the package above.

The subsequent package at `Desktop/release/summary-task-motion-preview/` includes that entrance follow-up and passed packaged real-runtime Summary acceptance, including intermediate cubic entrance frames, completion folding, no history replay and reduced motion. Packaged runtime files match the staged runtime; no runtime restaging was needed. The ordinary desktop shortcut now targets this package without demo arguments. Installer SHA-256 is `59a5825ab2b1a9220c286cf98a57e526ed437117d11078192a9836f27582d8a9`. Its directory totals about 702.30 MiB; ten release directories were inventoried without deletion. Existing running windows were preserved. No installer execution or paid-model acceptance was performed.

The PR #65 review follow-up consumes Summary-to-branch navigation after handling it, so a later direct Changes-rail opening retains its Last-turn default. It also recognizes any known non-completed task becoming completed, including a pending task whose intermediate running snapshot was missed. The task's status icon stays mounted across pending/running/completed states, preserving completion animation before folding. The real-runtime fixture verifies direct pending-to-completed animation frames, manual source selection, close/unmount/reopen via the rail and a second Summary navigation. These fixes are source-only and do not update the package above.

### Conversation Timing and Subagent Status Package

The subsequent 2026-10-07 source-only fix reconciles tool-result message start/update/end events by tool call ID with the existing execution-result slot. Upstream sends both execution completion and persisted message events; previously the second delivery temporarily rendered a duplicate chain until the final history refresh. Different call IDs remain separate even when results and assistant messages interleave.

Type checking, 187 tests, production build, subagent-status, conversation-timing and general Electron acceptance passed. The subagent fixture sends execution completion, message start and message end while the response is still streaming and verifies exactly three lanes without an agent-end refresh. Evidence is `Desktop/test-results/subagent-chain-completed-no-duplicates.png`. The existing package and shortcut have not been updated with this fix.

The follow-up package at `Desktop/release/conversation-status-dedupe-preview/` contains that tool-result reconciliation. Its unpacked executable passed subagent-status, conversation-timing and general Electron acceptance with isolated profiles; the fixture confirmed exactly three lanes across execution completion and subsequent message start/end events. The ordinary desktop shortcut now targets this package, including its own icon resource. The previous application under `conversation-status-preview` was left running. Runtime and helper hashes match the previously staged resources; no runtime restaging was performed. Installer SHA-256 is `017a5f8ff2a40d4139827f4959dd6e6d0648ca22a58eaef35c63973680670288`. No installer execution or paid-model acceptance was performed.

The 2026-10-07 local package at `Desktop/release/conversation-status-preview/` includes thinking-segment elapsed time, permanent response total time, subagent panel click-toggle, and compact rose-accent completion icons with shrink/hold/grow/check-draw motion. Source type checking, production build and 185 tests passed; the full test run used concurrency 1 because default parallel execution intermittently stalled in existing terminal tests.

The unpacked executable passed conversation-timing, subagent-status and general Electron acceptance using isolated profiles. These verify ticking/freeze, history/reload, themes/narrow layouts, status motion, reduced motion, click-toggle, real RPC startup and renderer isolation. Presentation fixtures do not establish paid-model or real subagent execution acceptance.

The ordinary desktop shortcut now targets this package. The running `send-queue-marker-preview` application was preserved; close that old window before launching the updated shortcut. Packaged manifest, Node, Step Code bundle and terminal host match staged resources; both Desktop helpers also match current source. Runtime remains at `519e4de4ed2162d3667be1821cb92ada6b884e5a`, Node v24.15.0, without restaging the separately maintained upstream checkout.

Installer SHA-256 is `7eacc82608a4e84eecc3040cda7d8e31a73f35c42ab040725a7162a8a891ccb1`. The package directory totals approximately 697.48 MiB; seven release directories total approximately 4.76 GiB and were inventoried without deletion. No installer execution, paid-model acceptance, commit, PR or public release was performed.

### PR #56 Review Follow-Up

The source-only review fix expands shared Diff redaction to common compound cloud credential assignments, including AWS access keys/session tokens and Azure client secrets/account keys in snake-case and camel-case. Both added and removed rows use the same redactor; ordinary fields remain unchanged. This remains bounded recognizable-credential redaction, not exhaustive arbitrary-secret detection.

Repository refresh failure clears the stored comparison, removing old files, totals, base metadata and open previews. File-preview requests clear their previous patch before loading and on failure. Dedicated Diff acceptance covers a previously opened file disappearing, recovery after restoring it, a selected temporary Git base disappearing, removal of stale UI and successful refresh after restoring the base. Unit coverage verifies cloud credentials in both sides of real Git patches. Type checking, 139 unit tests, production build, dedicated Diff acceptance and general Electron acceptance passed. This follow-up is not included in the desktop shortcut's existing fullscreen preview package.

### Main-View Inspector Expansion

The 2026-10-04 source-only follow-up adds a shared expand/restore header control to Context and Changes. The inspector expands leftward across the main view, retaining the sidebar, window bar and right rail. Both directions use cubic width transitions; reduced motion and native window resizing skip them. Content stays mounted, including selected source, message filters, JSON disclosures and diff previews. Covered transcript/composer controls are inert; Escape restores before closing. Switching tools clears expansion. Conversation navigation has no fullscreen control and now uses full-width row hit areas.

Type checking, 138 unit tests, production build, general Electron acceptance, Summary regression, Context/navigation and dedicated diff acceptance passed. Inspector checks use isolated fixtures, including sampled intermediate expand/restore frames, rail/sidebar anchoring, scroll preservation at tested positions, Escape focus return, dark/light themes, 640px containment, reduced motion and tool switching. The diff fixture also exercises real temporary Git state and upstream edit calls over a deterministic local provider. Its turn-preview keys no longer change when asynchronous Git metadata arrives. Screenshots include `Desktop/test-results/context-expanded-{light,dark,narrow}.png`, `diff-expanded-{light,dark,narrow}.png` and `navigation-full-row-hover.png`. These are fixture presentation evidence, not paid-model or real-profile acceptance.

This follow-up has not been packaged; the desktop shortcut still targets `Desktop/release/right-panel-unified-preview/`. Summary's special hanging-board motion and the staged runtime are unchanged. No installer execution or public-release qualification is claimed.

The subsequent 2026-10-04 package at `Desktop/release/right-panel-fullscreen-preview/` includes inspector expansion and full-width navigation hit targets. Type checking and production build passed; its unpacked executable passed Context/navigation, dedicated diff, general Electron and Summary acceptance with isolated profiles. The desktop shortcut now targets this package, superseding the source-only status above. The user's running application was left untouched.

Packaged Node, Step Code bundle and both Desktop helpers are byte-identical to the staged runtime; the helpers also match current source. Runtime retains baseline `519e4de4ed2162d3667be1821cb92ada6b884e5a` and Node v24.15.0. Installer SHA-256 is `e43b83e00e51ef281579cc9fe43ddaf812f64bcb749134ed3187f4c7409375da`. The preview totals about 681.79 MiB; 27 preview directories total about 16.89 GiB and were inventoried without deletion. No installer execution, paid-model acceptance, commit, PR or public release was performed.

### Deferred Approval Scroll-Hit Regression

The 2026-10-04 PR #53 CI follow-up fixes a real pointer-hit overlap: the full-height transcript scroll handle could cover the deferred-approval notice's Review button. The notice now owns a background and a layer above that handle, preserving the approved full-height scrollbar geometry. Cross-session acceptance checks pointer hits across the Review button and reopens the actual approval through ordinary clicks at 1320, 700 and 1600 pixels. Type checking, 129 unit tests, the production build, cross-session acceptance and general Electron acceptance passed locally after the fix. The regression uses isolated profiles and the local RPC/SSE fixture, not a paid model.

### Quote Presentation Polish

The 2026-10-02 local preview at `Desktop/release/quote-presentation-preview/win-unpacked/` passed type checking, 77 unit tests, production build, source and packaged Electron acceptance, quote interaction acceptance and the dedicated effort-picker fixture. Sent user messages unwrap only the exact Desktop quote-prompt format into framed excerpts plus the current reply; malformed or ordinary Markdown falls back unchanged. The model payload, message history, editing and full-message copy remain unchanged. Tests cover both languages, multiple and quote-only excerpts, nested Markdown, code fences, marker-like text and reply whitespace. Screenshots cover light/dark and narrow transcript layouts; clipboard writes are intercepted in the isolated process.

Effort labels now use the existing dark-theme palette in both themes. The light thumb is white with a softer shadow; dark styling is unchanged. The effort fixture verifies computed colors and white thumb fill alongside drag, wheel, keyboard and reduced-motion behavior. Evidence is in `Desktop/test-results/sent-quotes-{light,dark,narrow}.png` and `Desktop/test-results/model-effort-light.png`. No paid-model, installer lifecycle or public-release qualification was added.

The local preview can be tried now. The Issue #5 candidate install, build-to-build credential migration and normal uninstall passed in a disposable Windows VM; independent-workspace survival was not tested. Broader public-release qualification remains incomplete, so do not describe this as fully release-qualified. No release was published.

## POSIX runtime shutdown and HTML asset transport (2026-10-17)

RPC stop now disconnects requests immediately, joins concurrent stop calls and
prevents restart until shutdown completes. POSIX shutdown waits for process exit,
with a 2-second SIGTERM grace period and SIGKILL fallback; failure to exit after
the further 2 seconds is reported instead of allowing a replacement to overlap.
Late output/errors from the stopped child cannot affect its replacement.
Windows retains its existing taskkill tree termination path.

Local HTML transport converts only native directory separators to URL separators
and percent-encodes entry names by segment. POSIX literal backslashes therefore
remain distinct from nested paths, including manifest refresh/revocation.
Workspace boundaries, sensitive-asset exclusions, CSP and renderer isolation remain.

Typecheck, build and 457 unit/protocol tests passed (one existing Windows-only
skip). New process tests cover delayed cleanup, concurrent stops, restart guards,
SIGTERM-resistant children, late errors and actual Step runtime exit/restart.
Source and packaged file-preview acceptance verifies distinct script execution
in the isolated browser and checks that session restart leaves no old RPC child;
full undo acceptance also passes. All 1,258 packaged resources matched.

## Follow-up file identity and archived project review (2026-10-17)

Turn-change grouping, live readers, output paths, delivery inference and archived
project names now use explicit platform-aware identities. Windows retains case
and separator aliases; POSIX preserves case and literal backslashes. Main-process
turn lookup and undo capture use the same platform as the renderer. File-kind and
Markdown-reference case-insensitivity remain independent of filesystem identity.

Typecheck, build and 453 unit/protocol tests passed (one existing Windows-only
skip). Regression tests reproduce distinct literal-backslash/nested files and
verify both restore exactly, reject legacy collapsed undo records, retain case-
distinct delivery outputs and check archived project grouping/custom names under
macOS, Linux and Windows rules. Source and packaged Electron artifact, archive
and full undo acceptance cover this change; macOS CI includes archive acceptance
alongside the prior terminal/undo checks. Package verification checks all resources.

## macOS undo ownership and terminal scope review (2026-10-17)

Undo records and canonical file-path checks now use the shared platform-aware
workspace key: case is preserved on macOS/POSIX and folded only on Windows.
A prepared undo ticket cannot authorize a record owned by another root, including
a case-only root mismatch. Terminal renderer scopes and the native session store
use the same key, including preservation of literal POSIX backslashes.

Typecheck, production build and 446 unit/protocol tests passed (one existing
Windows-only skip). Added undo regressions reject root mismatches and relocated
confirmation tickets without modifying either workspace. Source and packaged
Electron terminal-scope fixtures restore both projects' controllers, verify
separate tabs/selection, and record input routed to the selected project only;
Windows fixtures retain case/separator aliases. Full undo Electron acceptance
passed in source and packaged apps, including real local fixture RPC edits,
confirmation, conflicts, persistence and same-workspace running-peer exclusion.
All 1,258 packaged resources matched. CI now runs undo and terminal-scope
acceptance on macOS source/package and terminal scopes in Windows interface CI.
The undo fixture canonicalizes its temporary profile to handle macOS /var aliases.

## macOS continuous sidebar animation (2026-10-17)

The titlebar sidebar surface now translates at the sidebar's full width using
its existing 280ms curve, instead of shrinking its background with the button
track and switching color immediately. Window controls keep their independent
positions. Inactive-window dimming applies only to the sidebar button so the
upper and lower sidebar surfaces remain the same color.

Window acceptance samples both opening and closing transitions frame by frame,
comparing the upper/lower right edges (within 1 DIP) and background colors.
Reduced-motion settings disable both surface transitions together. Source and
packaged window acceptance and package resource verification cover this change;
the earlier full-suite archive-notification timeout remains recorded below.

## macOS compact fullscreen toolbar (2026-10-17)

Window-state replies and events now include native fullscreen state. macOS uses
a 40px toolbar in fullscreen, removes the traffic-light inset, and places the
sidebar toggle 12px from the left edge in both expanded and collapsed states. Leaving fullscreen restores
the existing 52px toolbar and native control clearance. Windows styling is unchanged.

Typecheck, production build and 444 unit/protocol tests passed (one existing
Windows-only skip). Source and packaged window-toolbar acceptance passed for
expanded/collapsed fullscreen layout and restoration; 1,258 packaged resources
matched. The layout assertions simulate the state event for runners without
Spaces; native entry/exit was also exercised in the installed application.
The full source/package acceptance reached these new checks successfully but
then timed out at the pre-existing archive-feedback toast expiry assertion.
No release-readiness claim is made from this focused result.

## Desktop local-preview delivery (2026-10-17)

Session workers now append truthful Desktop presentation guidance alongside the
existing collaboration policy: work in the selected workspace, return clean
preview/file links, distinguish the built-in UI from available automation tools,
and do not guess internal endpoints or deploy without a user request.

Turn outputs now recognize loopback HTTP(S) previews in Markdown, prose and
standalone URL code blocks, including older responses with adjacent Markdown
emphasis. These cards open through the existing built-in browser and copy URLs;
they do not fetch/probe on discovery and never enter the artifact filesystem API.
External file boundaries, executable restrictions and missing-file filtering stay
in force. This does not add an agent GUI-control tool or repair misplaced files.

Local typecheck, production build and 444 unit/protocol tests passed (one existing
Windows-only skip). Artifact acceptance covers cards, URL-only history, browser
open dispatch, link copying, themes, narrow layouts and existing file boundaries.
A read-only regression against the reported local history recognized both of its
preview delivery responses; no user history or project files were rewritten.

## macOS Codex P2 follow-up (2026-10-17)

The native View menu no longer installs shell Reload/Force Reload accelerators;
Command-R inside web content still belongs to that browser tab. StepPage managed
command detection accepts both node.exe and extensionless runtime/node/node.
Workspace identity is shared between main, renderer and workspace mutations:
Windows folds case, macOS preserves it. Earlier Mac preview metadata migrates
only when its registered owner is unambiguous. macOS update settings explicitly
explain manual Releases downloads and omit unsupported check/channel controls.

Local typecheck, production build and 442 unit/protocol tests passed (one existing
Windows-only skip). StepPage startup acceptance covers missing and user-owned
configuration, idempotence and stale managed path refresh; macOS update acceptance
checks the supported Releases action and absence of inert controls. General
Electron acceptance adds native shortcut/draft preservation coverage. Native CI
now runs StepPage and macOS update checks against source and packaged apps.

## macOS rail corner and startup placement (2026-10-17)

The right tool rail retains its existing width and inspector priority, with a
10px upper-left corner and a thin top border at the titlebar junction. On macOS,
the separate startup window now uses explicit screen coordinates centered on
the display containing the pointer, instead of native window centering.
Windows placement remains unchanged.

Typecheck, production build, source and installed-package startup acceptance
passed. Startup coverage checks both axes against the native display bounds
(within 1 DIP), transparent pixels, reduced motion, isolated bridge-free splash,
main-window handoff and disposal. Installed-package general Electron acceptance
passed, and package resource verification matched 1,258 files. An initial source
general acceptance run timed out in the existing archive-feedback toast expiry
fixture; the subsequent installed-package run passed that fixture and the full
suite without application changes.

## macOS native window controls (2026-10-17)

The v0.5.0 macOS preview now uses Electron's native hiddenInset titlebar and
system traffic lights instead of the renderer's Windows controls. The sidebar
header shares the sidebar color, reserves the native buttons, and keeps its
collapse toggle usable when hidden. Application commands are grouped in an
upper-right ellipsis menu; the native application/Edit/View/Window menus remain.

Typecheck, production build, source and installed-package Electron acceptance
passed, including menu actions/Escape, sidebar collapse, native button position,
minimize/restore, light/dark themes, long-title containment at 640px and renderer
isolation. Package verification again matched 1,258 files. Native UI inspection confirmed
the actual system controls, green-button full-screen entry, Command-Control-F
exit and sidebar collapse/restore on the installed app. These checks do not
establish Windows regression or public-release qualification.

## macOS Apple Silicon Release v0.5.0 Port (2026-10-16)

This branch freezes the published v0.5.0 Release at
`6fedd4d1883e4d1beaf6f4599134695e13a9ba50`, as requested by the owner.
Later Windows main/PR changes and the separately maintained Linux branch were
not merged. Step Code stays pinned to `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`
with the existing release patch guards.

On this Mac mini (Apple Silicon, macOS 26.4), typecheck and the production
build passed. The final unit/protocol run passed 439 tests, with one existing
Windows-specific test skipped (440 total). This includes real local-fixture
Step RPC, auth isolation, CLM and context tests. Native zsh PTY testing covers
Unicode output in a directory containing spaces, resize, host shutdown and
cleanup. It passes against both staged development and packaged resources.

Source and packaged Electron acceptance passed: real runtime connection,
isolated settings and sessions, rename, MCP configuration, themes, narrow
layouts, proposed sessions and no renderer Node access. Platform acceptance
uses Command for macOS image zoom and native path containment instead of
Windows path separators. Source and packaged safeStorage acceptance passed
legacy plaintext migration, ciphertext checks, logout, fixture-key login and
relaunch recovery through macOS Keychain. All credentials were isolated,
nonfunctional fixture values; no personal profile or paid model was used.

The local unsigned app is `Desktop/release/mac-arm64/Desktop for Step Code.app`.
Package verification compared 1,258 built/staged files, including all runtime
files and the native PTY host/addon/helper, and checked version, architecture,
Node SHA-256 and executable permissions. Evidence is in ignored
`Desktop/test-results/macos-package-resources.json` and local acceptance logs.

This establishes a native local preview, not notarization, public release,
Intel Mac support, real account/model quality, external MCP publication or
Windows regression acceptance. See `MACOS.md` and `PLATFORM_HANDOFF.md`.


## macOS v0.5.1 account follow-up (2026-10-17)

At the owner's request, the macOS track follows Windows Release v0.5.1
(15f0fa77ee1562d3297e226071d49c00c762d891). Its integration base is PR #128's
squash merge 5b521cdd630c353e32542a16b1fb3ac990458912, which already contains
that Release and the macOS changes. No later Windows/Linux work or Step Code
source changes are imported. The runtime stays pinned to
3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8. The published v0.5.0-macos.1 tag
and package are unchanged.

Typecheck, production build and 473 serialized unit/protocol tests passed
(one existing Windows-only skip), plus twelve CI policy/runner tests
(one Windows cancellation skip). Source account settings, allowance, balance,
routing, encrypted-vault and browser presentation acceptance passed. Routing
uses actual Desktop login/IPC and the pinned runtime with local transport to
check CN API -> CN Plan -> Global API -> Global Plan -> CN API, model discovery
and chat endpoints/credentials, running-task login guards, authorization
cancellation and absence of API fallback after Plan rejection. No real
credentials or paid model requests are used.

The unsigned 0.5.1 ARM64 package passed startup, macOS update state, full Electron,
vault, account settings, Plan allowance, API balance, routing, StepPage, browser,
file preview, delivery, terminal-scope, full undo and archive acceptance, plus
the native zsh terminal test. All 1,258 built/staged files matched its resources,
including executable Node and PTY helpers; the resource report now derives its
baseline from the Desktop version instead of hardcoding v0.5.0. Both themes,
narrow English layouts, stale/error/cancellation states and encrypted credential
refresh/restart are covered by the account fixtures. macOS CI now runs the new
account checks in source and packaged apps.

The prior local archive-notification expiry timeout was a test-clock sequencing
problem: adding an observation before the clock jump let the notice expire
without product changes. The acceptance now confirms hover/focus do not pause
the replacement notice and runs 3,100 ms of the clock normally, allowing the
asynchronous replacement effect to install its timer. The original hidden-state
assertion remains; both source and packaged full Electron acceptance passed.
Notification product code and its timeout are unchanged.

These results do not establish real Plan/API balances, official billing,
external MCP compatibility or public Release readiness. Cloud CI results are
recorded separately on the PR; this follow-up is not a newly published Release.


## macOS 0.5.1 parity follow-up (2026-10-17)

This iteration remains on Windows Release v0.5.1 and the merged PR #131 tree,
with the pinned Step Code runtime unchanged. The code/platform audit found two
explicit desktop gaps: update controls/installation and file application discovery/
selection. Both now have native macOS implementations while Windows NSIS behavior
and renderer isolation are retained. See MACOS.md and UPDATES.md for the release
asset contract and intentional platform differences.

Typecheck and production build passed. The serialized unit/protocol suite passed
480 tests, with the existing Windows-only path-casing check skipped (481 total).
The CI policy/runner suite passed twelve tests with its Windows cancellation check
skipped. Source update discovery/UI, transfer UI, file opening, native AppKit
application discovery and installer fixtures passed. ARM64 package verification
matched 1,262 built/staged resources and checked the release marker, bundled native
application helper and detached update helper.

The native updater fixture exercises real ZIP transport/hash checks, bounded
extraction, framework links, current-process exit, detached-helper readiness,
same-volume application replacement, retained Gatekeeper quarantine, old-bundle
retention until acknowledgement and failure recovery tests. Its OS launch boundary
is a disposable fixture: it does not establish Developer ID trust, notarization,
Gatekeeper approval, a real public-GitHub download, or real installed-app upgrade
acceptance. Do not describe these fixtures as a signed or unattended update system.
The old 0.5.0 package still requires a manual first upgrade.

The packaged candidate passed seventeen Electron/native checks: update discovery,
transfer UI, updater fixture, startup, general Electron/runtime, encrypted vault,
account settings, Plan allowance, API balance, account routing, StepPage registration,
browser, file preview/application choices, artifacts, terminal scope, turn undo and
archived sessions. The updater fixture also extracted and replaced a full packaged
application in a disposable directory; only its final OS launch was substituted.
Cleanup waits for helper completion, is transaction-bound and is tested separately.
Cloud Windows/macOS checks remain a PR gate; this entry does not publish a Release.

A deployment-target audit found the local Swift compiler defaulted to macOS 26.
The AppKit helper now explicitly targets ARM64 macOS 13.5, matching the bundled
Node minimum; package metadata and Mach-O inspection enforce that floor. This
checks binary compatibility metadata, not execution on every older macOS release.

Windows CI's legacy NSIS transport fixture returned an integrity failure without
observing the expected corrupt-payload request. The fixture now canonicalizes its
temporary root, clears transport cache between cases and serves no-store responses;
all outcome/request-count/hook-cleanup assertions remain. Failure diagnostics are
bounded and printed before assertions. Local replay explicitly selects the library's
Windows provider on macOS and passes parsing, corruption, cancellation and retry;
Windows CI remains required to confirm actual Windows behavior.


### macOS updater P2 follow-up (2026-10-17)

Startup failure now restores the backup when the replacement bundle is absent;
other inspection/restore failures retain a recovery-required result and backup.
Regression cases cover deleted/moved replacements, foreign replacement identity
and a parent path that becomes a file. Successful acknowledgement waits for helper
completion, then removes only the transaction's recorded ZIP; unrelated downloads
remain. Typecheck, production build and 481 local tests passed (one Windows-only
check skipped). The native updater fixture passed download, verification,
replacement, acknowledgement and completed-ZIP cleanup. OS launch remains a fixture;
this does not establish real Gatekeeper approval or a public downloaded upgrade.

## PR #136 Windows CI timeout follow-up (2026-10-18)

Run 39056427912 passed the Windows interface and sessions groups, while its runtime
job was cancelled with a 45-minute maximum-execution annotation. GitHub did not
provide usable runtime job logs or an uploaded timing report, so the hanging
script and underlying cause remain unconfirmed. The separate macOS run passed.

Every Windows acceptance script now has a five-minute default deadline, retaining
per-script overrides. Timeout cleanup targets only the owned process tree and uses
the Windows system taskkill executable. The timing report records the active
script, start time and deadline before launch, then clears it after completion.

The CI policy/runner suite passed all 14 tests, including real timeout/cancellation
and Windows descendant cleanup. A full local runtime-group replay passed all 17
checks with a two-minute default deadline (existing explicit overrides retained).
This did not reproduce the cloud hang and is not proof that its cause is fixed;
the next cloud run remains the integration gate. No application package changed.

### Follow-up after run 39087994487

The bounded runner produced usable diagnostics. The runtime group reached the
custom-provider estimate tooltip assertion and failed after its 30-second wait,
rather than consuming the job limit. That fixture now waits for finite context
panel animations and scroll delivery before hovering, and captures a failure
screenshot. The assertion and production tooltip behavior remain unchanged.

The sessions job hit ENOTEMPTY during upstream Workflow fixture removal. Direct
agent calls queue telemetry writes after their awaited result; the fixture now
flushes its tracked journals before deleting their directories. The integration
patch and its manifest hashes were updated together; no upstream production source
changed. The interface job's collaboration-test child exited with native Windows
code 3221226505, without a failing assertion. It did not reproduce locally with
the same Node version. Windows protocol tests now run one file at a time to bound
process pressure; this is mitigation, not a confirmed native-crash diagnosis.

Local checks passed: all 114 Workflow tests, 496 Desktop tests with 13 platform
skips (509 total), all 14 CI policy/runner tests and the full custom-provider
Electron fixture. The patch reverses cleanly against the reviewed Workflow test
source. These results remain local evidence until the new cloud run passes.

### Windows Node TCP-connect follow-up

Run 39088928068 passed interface acceptance and the separate macOS run, but
failed on a CLM Plan completion wait and a cross-session tool with no returned
tool result. The full local runtime group passed all 17 checks; the isolated CLM
Plan test also passed twelve repetitions on Node 24.15.0. Those local passes did
not explain or dismiss the cloud failures.

Node's upstream issue nodejs/node#63620 documents silent Windows HTTP/TCP-connect
crashes in 24.15.0, with the same native exit code seen in the collaboration
test. A maintainer confirms the fix in nodejs/node#62561, shipped in 24.16.0.
This matches the observed native failure class; it does not prove that every
earlier timeout shared that cause. Windows CI and newly staged Windows runtime
now use 24.16.0. Staging rejects Windows Node 24.x releases below 24.16; macOS
and historical release records remain unchanged.

The official Windows x64 archive was verified against its published SHA256
EDACA9BD58EC8E92037DAC4E877D52F6B8F430B81C18B57E264B4E2FB111CD56.
Fresh runtime staging passed with Node 24.16.0. All 15 CI policy/runner/version
tests and 14 focused CLM/collaboration/staging tests passed on that host. CLM
completion waits now expose fixture assertion failures and native child exit
codes immediately instead of hiding them behind a generic timeout; fallback
diagnostics contain only event types, counts and activity flags.

The Node 24.16.0 local suite passed 496 Desktop tests with 13 platform skips,
and cross-session Electron acceptance passed. A local Workflow recovery replay
also exposed a fixture race: the final tool result can arrive before its
asynchronous orchestration projection contains the nodes. The changed-script
recovery check now waits for all three projected nodes before asserting their
exact cached/completed/cached states. The targeted Workflow acceptance passed;
the full runtime replay and cloud checks remain the final gates.

Both local acceptance groups passed on Node 24.16.0: runtime 17/17 and interface
28/28. Workflow recovery also passed three additional consecutive repetitions.
Cloud runtime and sessions passed, as did native macOS packaged acceptance.

Cloud interface setup exposed a separate dependency incompatibility: Playwright
1.58.2 downloaded Chrome to 100% and then stalled for almost ten minutes. This
matches microsoft/playwright#41000, whose fix shipped in Playwright 1.60.
The test-only dependency is now pinned to 1.60.0, retaining the Windows Node
TCP-connect fix. Browser installation has its own five-minute deadline so setup
cannot consume the full job limit. The post-upgrade cloud run is still required.
With Playwright 1.60.0, a clean Chromium/FFmpeg/headless-shell installation into
the isolated D: test cache completed on Node 24.16.0; Desktop typecheck passed.

The subsequent cloud run passed interface, sessions and macOS acceptance, but
runtime exposed a then_run descendant-cancellation failure. Its Windows shell
cleanup silently discarded CIM discovery after three seconds. A cold-query
regression reproduces missing MSYS descendants with that budget; giving only
the CIM query a ten-second deadline passes the same test while retaining the
three-second ps lookup and the existing ownership checks. This reproduces a
matching failure route, not proof of the failed runner's exact CIM duration.
All 38 shell tests passed (three Linux-only skips); patched-source hashes and
reverse patch application were checked before fresh runtime staging. The
Electron fixture now records bounded cancellation elapsed time for cloud
diagnostics, retaining its no-late-write and unrelated-shell-survival checks.

The following macOS run exposed a fixture ordering issue before its reload-key
assertions: fill/clear followed immediately by typing produced two copies of the
draft. The fixture now waits for ProseMirror's model value after both fill and
clear, rather than treating DOM mutation completion as an editor commit. Composer
editing acceptance repeats that sequence three times; native reload-shortcut and
draft-retention assertions remain unchanged and still require macOS cloud proof.

## Application-Themed Quit Confirmation

Source integration replaces the ordinary native quit warning with the approved
application-themed modal. The main process publishes a versioned request through
the narrow preload bridge and includes it in snapshots. Replies must match the
current request and contain a boolean; changed task counts require another review.
Renderer reload retains a pending decision, cancellation leaves workers and
terminals intact, and confirmed exit uses the existing orderly cleanup and flush.
Cron counts distinguish temporary and durable storage, deduplicate shared durable
records, ignore disconnected stale hosts and disclose unavailable state.

Local checks passed: Desktop typecheck/build; 74 focused quit, Cron and runtime
tests; 32 browser theme/scenario/viewport/language combinations with keyboard,
reduced-motion and simulated failure coverage; real Electron tray cancellation
and confirmed shutdown with a continuous local stream and owned terminal; isolated
real Cron creation, counts, reload, cancellation, stale/malformed reply rejection
and persistent-record retention after exit; all eight Cron management cases; and
Ultracode restart/restore acceptance. No real account or model was used.
General Electron acceptance, including new and reopened profile proposals, also
passed. A separate real renderer crash verifies that a pending themed decision
is cancelled and native fallback can both cancel and confirm orderly exit.
Normal operation never invokes that fallback. All 15 CI policy/runner tests pass.
The dedicated native quit and Cron transcript checks are registered in Windows
acceptance; visual-only matrices are explicitly local checks.
This is source acceptance, not validation of a new installer or cloud CI.
The existing preview installer and desktop shortcut have not been rebuilt here.

### Account Allowance CI Shutdown Follow-Up

PR #145 run `39721715313` timed out in `verify-account-allowance.mjs` after
300 seconds. The unmodified fixture reproduces locally: all account assertions
reach the success log, but final shutdown remains blocked until a 40-second
diagnostic watchdog terminates only that isolated test process tree.
The fixture still answered only the old native message box.
Both shutdown points now use the existing application quit-review helper,
preserving orderly cleanup and credential/rule flushes rather than force-exiting.
All original business assertions remain. Locator waits are bounded to 15 seconds,
and phase logs plus a failure screenshot identify any future stalled assertion.

Three consecutive source runs and one run against the existing
`cron-quit-20261022-preview` package passed locally, as did all 15 CI policy/runner
tests. This follow-up changes only acceptance code and documentation; it does not
change the packaged application. Replacement cloud CI remains required.

### Theme Bootstrap CI Shutdown Follow-Up

Run `39725588859` passed account allowance, balance and routing, then failed
`verify-theme-bootstrap.mjs` at `first frame wine: Electron close timed out`.
That fixture also mocked only the native dialog; startup can still require the
application-owned review when teardown begins. Its bounded, orderly close now
uses `closeDesktopFixture`, without changing first-frame or system-race assertions.

Real Electron regression cases retain a durable Cron across shutdown and restart,
covering both an already-pending review and a review raised by fixture teardown.
Replacing the helper with the former `app.close()` reproduces the 15-second
timeout; both cases pass with the helper. All 15 CI policy/runner tests pass.
The complete 31-script Windows interface acceptance group also passed locally,
including the theme bootstrap startup race and final performance matrix check.
This local run preceded synchronization with main's StepPage and fader changes;
replacement cloud CI must validate the combined tree.

## Windows Offline Session Migration

The Desktop adaptation of Step-Code PR #291 retains the existing Windows runtime
pin and ports the shared import service through a separately hashed source patch.
Settings exposes explicit Codex/Claude discovery, reviewed snapshots, destination
mapping, batch jobs and cancellation. The importer owns a separate credential-free
child; copies and journals remain in the Desktop profile.

Local source verification on 2026-10-22 passed: typecheck, production build,
610 Desktop unit tests (13 skips), 90 upstream import/context/compaction/usage
tests, 15 CI policy/runner tests, the dedicated native import acceptance and
general Electron acceptance. The native migration case covers both formats,
archive opt-in and child exclusion, source append after review, duplicate
protection, stubbed directory-selection IPC, real transcript navigation, a native
continuation through a local fake provider and journal/copy retention on relaunch.
Historical tools are inert evidence, not current Plan/Workflow or filesystem
receipts; their display IDs cannot collide with native tool calls.

Native light/dark and narrow-window screenshots were checked. The separate mock
browser fixture also received Chinese/light and English/dark 375px layout checks.
See `docs/SESSION_IMPORT.md` for commands, bounds and evidence details.
No new installer, real personal-source migration, paid-provider request, remote
CI or macOS import acceptance is implied.

## Task Progress Completion Motion

The summary task progress now uses the existing yellow-to-purple palette while
unfinished, including the interval between checklist completion and the final
round completion event. Only a matching live `desktop_task_completed` event can
start the impact, right-to-left green sweep and square dust. The existing sound
and visual subscribers share that event delivery; task counts, reopening the
panel and restored sessions do not play another sound. Original row completion
and folding animations remain unchanged. Incomplete lists never fill falsely.

Local source checks passed: typecheck/build, completion sound tests, browser
motion acceptance, existing summary disclosure acceptance, real Electron motion
acceptance with a local streaming provider, and summary runtime acceptance.
Motion acceptance covers scope isolation, reduced motion, narrow layout, impact,
dust cleanup, waiting for the round to end and reopening without replay.
Media playback is intercepted in automated acceptance to count trigger timing;
actual speaker latency is not measured. No real account or paid model is used.
The full unit run encountered an unchanged Windows terminal-count teardown
failure; this is not recorded as a fully green unit suite.
Rerunning the other unit files completed with 609 passing and 13 skipped tests;
all 15 CI policy/runner tests also passed.

### Delayed Final Task Snapshot

PR #147 review identified a race between live round completion and asynchronous
summary refresh. A held-summary fixture reproduces the missing animation before
the fix. The mounted progress component now retains its matching completion
until the task snapshot confirms a full list. Only visuals are deferred; the
original event still plays the sound once. A new round, scope change or unmount
discards the buffer, and events received while hidden or with reduced motion
cannot start a delayed impact.

The regression verifies the delayed snapshot, no duplicate sound, cancellation
on a new round and unmount, plus the existing scope and motion matrix.
Typecheck, build, completion-sound tests and real Electron progress acceptance
passed. This follow-up does not rebuild the existing local preview installer.

### Task History Across Turns

Completed tasks from earlier turns now leave current progress and appear in a
collapsed entry above the current list. Incomplete/failed work carries over.
The bounded main-process projection includes original task timestamps and
explicit archived plans, without metadata or configuration. Renderer projection
reconstructs history from persisted records rather than mounted state, with a
conservative successful-tool-result fallback for legacy tasks lacking timestamps.

Focused projection tests, typecheck/build, browser progress and disclosure
acceptance, and real Electron progress/summary-runtime checks passed locally.
Coverage includes independent current counts, partial-plan wording, history
anchor stability, original archived statuses, narrow dark/reduced-motion and
English layouts, panel reopen, and renderer reload against the real staged
runtime with a local streaming fixture provider. The existing completion sound,
impact/sweep/dust and delayed-final-snapshot regressions remain covered.
The refreshed Electron acceptance uses the existing orderly quit-review helper
after reload. Entrance-frame assertions compare with final measured row height
rather than requiring a particular early-frame pixel threshold.
After integrating main through model-preference fix #148, the remaining unit
files passed with 632 passing and 13 skipped tests; all 15 CI policy/runner
tests passed. The staged Desktop admin adapter was refreshed from the merged
source; the upstream runtime pin is unchanged. The
unchanged Windows terminal-session teardown file noted above remains excluded.
The rebuilt unsigned Windows preview at
`Desktop/release/task-history-20261022-preview` passed packaged task-progress
acceptance (including next-turn retirement and renderer reload) and general
Electron acceptance with isolated profiles and a local fixture provider.
No real-account/model acceptance or fresh cloud-CI success is claimed.

### Model Discovery Registration Refresh Race

Runs `39787315956` (Windows sessions) and `39787315934` (macOS ARM64)
failed the same discovered-model catalog test after credential replacement.
Provider registration schedules an asynchronous offline refresh. If that pass
reaches the runtime after explicit discovery starts, it can cancel the network
pass and replace its catalog with an empty offline snapshot.

Desktop's per-request management runtime now serializes those refreshes, without
changing the upstream pin, authentication routing or credential-scoped cache
rules. A test-only preload delays registration refresh while the loopback
provider holds its response; the new regression fails before the fix and passes
after it. Normal and delayed cases retain account/endpoint isolation, failed and
cancelled login, cached capability and recovery assertions.

Locally, 76 related tests and typecheck passed, followed by 25 repetitions of
both discovery cases (50 cases total). Real Electron model-switch acceptance
passed, including persistent selection, missing-model protection and explicit
recovery. This follow-up does not rebuild or retarget the existing preview
package. Replacement cloud CI must validate both native platforms.

## Cron Recovery And Management Beta (2026-10-24)

Windows retains the fixed runtime pin
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494`. The additional hashed Desktop
patch enables per-task pause/resume and editing without replacing native
locking, jitter or original expiry. Paused durable rows use opt-in Beta schema
2; schema-1 readers preserve but do not schedule them. Explicit resume restores
schema 1. See `CRON.md` for shared-project and downgrade boundaries.

Local source verification passed: typecheck, production build, the complete
serial Desktop unit suite (699 tests: 686 passed, 13 platform skips), 15 CI
policy/runner tests, 14 native JSONL RPC Cron cases and 11 real Electron Cron
management cases. The final patch was also applied to a clean checkout of the pinned
upstream commit through the actual patch applier, including preimage and
resulting-source hash validation and whitespace checks.

Native cases cover pause/edit identity and deadline preservation, stale-update
rejection, lock-failure rollback, expiry without delivery, schema-1 reader
preservation and suppression of another host's buffered missed notice after a
shared pause. Execution journal completion requires current assistant output
and successful authoritative round completion, not merely a trigger or an older
assistant result.

Electron cases use isolated profiles, projects, trust and a local fixture
provider. They cover pause/edit/relaunch/resume, manual recovery review,
explicit automatic authorization, actual application relaunch and termination
of only the isolated idle scheduling child. Recovery retains the reviewed
conversation in Ask, retires the disconnected entry and reuses the same single
runtime when the original chat is opened. Revocation survives relaunch.
Management and recovery before the next due time made zero model calls.
The host shortcut opens only the current live runtime, including an archived
host without unarchiving it. Offline/stale requests are rejected without a
history-loading or runtime-start fallback, and the recovered-host shortcut
still leaves exactly one runtime. Ordinary latest-target session navigation,
reading positions, draft retention and failure recovery also pass their
dedicated real Electron acceptance.
Dark/light, narrow, edit, history and recovery screenshots were checked;
reduced-motion checks retain the shared controls' interaction semantics.
The updated browser preview passed with the existing installed Edge: online
host navigation, offline disablement, keyboard tooltip/activation, light/dark,
four widths down to 390px, reduced motion and no page errors. This preview uses
sample data, not the real Desktop profile.
The eight Cron transcript checks and the dedicated quit-confirmation acceptance
also passed, including persistence, reload/cancel/replay and crashed-renderer
fallback.

Automatic recovery remains default off, bounded to the reviewed task/account/
model snapshot and at most seven days. Due work, changed configuration,
unconfirmed execution, missing sessions and uncertain release block it without
automatic retries, catch-up, a new conversation or account/model fallback.
Journals are bounded and never turn acknowledged unknown results into success.
These are Desktop Beta extensions, not upstream-native ownership or exactly-once
execution. No installer, real-account/billing, OS sleep/reboot, external-CLI
coordination, macOS Beta or replacement cloud-CI acceptance is claimed.

### Local Review Follow-Up (2026-10-24)

The local review reproduced four regressions before fixes: automatic gate
release after initialization crossed a trigger, revival of an old grant after
pause/resume or edit/revert, unresolved execution falling out of bounded
history, and one corrupt authorization preventing later projects from recovery.
Automatic release now carries a runtime-enforced deadline; Desktop requires its
new Windows-only capability. Management persists grant invalidation before
updating tasks, history atomically retains an unresolved-rotation latch, and
authorization failures are isolated and reported per project.

The 45 focused recovery/history/management tests passed, including legacy
journal migration, malformed-latch rejection and failed-invalidation/changed-host
guards. Typecheck, production build, 15 CI policy/runner tests, clean pinned
patch replay with source hashes, 14 real native RPC cases, 12 Electron management
cases and session-navigation acceptance passed. The real pause/resume buttons
keep the previous automatic grant blocked without a model call.
The serial suite excluding `terminal-sessions.test.ts`
passed 687 tests with 13 platform skips (700 total), using Node 24.16.0.
The unchanged terminal test was run separately: four cases passed and
`terminal count is bounded per directory and failures do not cross directories`
failed at process-tree termination. It is not claimed as passing or repaired
by these Cron changes.

The existing preview installer predates these review fixes. No new installer,
real-account/billing, OS sleep/reboot or fresh cloud-CI success is claimed.

### Queue, View Replacement And Latest Main Follow-Up (2026-10-24)

The next review found unsent queues lost during replacement of a disconnected
Cron host, a viewed chat left on the retired runtime identity, and cancelled
edit values retained on reopening. A focused cancel/reopen regression failed
before the fix. Recovery now refuses both manual and automatic replacement
while the same conversation retains pending messages. The disconnected queue
remains editable and withdrawable, without migration or automatic sending.
Successful viewed-host replacement emits an explicit identity event; the
renderer validates the original and replacement identities before installing
the authoritative snapshot, retaining the composer and reading state. Activation
precedes asynchronous retirement, and late events cannot override navigation.
Each edit opening remounts fields from the current saved task, preserving the
shared disclosure animation.

Main's shared sidebar is retained without a parallel implementation: equal-width
New chat and Plugins buttons, then adjacent Schedules and Search icons. The
preview uses the same component and tests equal primary widths, schedule
navigation, the online-host shortcut and offline guard in both themes, four
widths down to 390px and reduced motion, with no page errors.

After main integration, Node 24.16.0 serial units passed 720 tests with 13
platform skips (733 total), excluding the independently failing
`terminal-sessions.test.ts` described above. Typecheck, production build,
49 focused Cron/staging tests, 15 CI policy/runner tests, clean pinned patch
replay with all source hashes, 14 native Cron RPC cases and the real Electron
session-navigation, session-move and capability-management acceptance passed.
The final 14-case Electron Cron-management acceptance also passed, including
viewed-host reconnection with the same draft, background recovery without taking
over a new draft, stale replacement events, queue preservation/edit/withdrawal
with no automatic sends, and cancel/reopen of both editable fields.
These use isolated profiles and deterministic local providers, not real
accounts or billing. The existing preview package is not updated by this work.

### Update Installer Fixture Shutdown

Windows interface run `39995014128` reached the update installer's successful
UI assertions, then timed out while closing its Electron fixture. The shared
orderly-close helper now installs the existing Windows pipe-release guard, and
the update-installer acceptance uses that helper. Pipes are released only after
the launcher exits with code zero and every application window closes; normal
quit review and state flushing remain in use. Shutdown errors still propagate,
and guard listeners are removed on both success and failure.

The new helper integration regression failed before this change and passed
after it. All eight shutdown tests and typecheck passed locally, as did three
consecutive update-installer runs and update-settings Electron acceptance.
Plugin-management, session-move and then-run Electron acceptance also passed,
including their orderly shutdown and persisted-history checks.
The full local interface group could not run because this machine lacks the
matching Playwright Chromium headless binary. Cloud CI must validate the full
group; no fresh package or cloud success is claimed by these local checks.

## Background Agent Controls (2026-11-03)

The Subagents inspector adds a Background tab over the native lane registry.
A narrow current-session `desktop_subagents` list/stop RPC calls the registered
`agent_send` tool without prompts, model requests or conversation writes.
The v0.1.6 pin and the two existing upstream overlays are unchanged. The new
hashed Desktop patch reuses native ownership and settlement; it does not add
reply support or infer running work from saved messages.

Local Windows source verification passed:

- Typecheck and production build.
- Complete serial Desktop suite: 830 tests, 816 passed and 14 platform skips.
- Focused control/lifecycle/staging suite: 89 passed, including three real
  pinned-runtime cases for background completion, suspension and targeted stop.
- CI inventory, policy and runner tests: 30 passed and one platform skip.
- Real Electron background controls, background notification records,
  subagent status animation and Workflow acceptance.
- Clean pinned patch replay with pre/post-image hashes and source whitespace
  validation.

The native cases verify read-only queries with no model calls or JSONL changes,
session/action/lane rejection, targeted stop while the parent remains active,
independent peer completion, credential filtering and native settlement.
Electron uses isolated profiles and a loopback model through the actual preload,
IPC and RPC. It covers confirmation/cancel, stale records with disabled stopping,
unconfirmed stop without retry, pending-stop deduplication, parent/peer
continuity, reload and actual session navigation with a delayed outgoing query.
Old query results do not enter the newly selected session. Light/dark narrow
focus gutters and reduced-motion disclosures also pass.

The browser preview reuses the production inspector, with explicit sample data
and failure/empty/disconnected/slow scenarios. Desktop and 390px layouts were
checked; the temporary viewport override was reset. Large build/runtime
artifacts remain isolated under the three `output/background-agent-*-20261103`
directories on D:, without changing the installed app or desktop shortcut.
No installer, cloud CI, native macOS or real-account acceptance is claimed.

### Role Views And Sibling Detail Navigation

The role-specific output presentation is shared by production and preview;
only sample records remain in the fixture directory. Native role names stay
visible, unknown roles retain a generic layout, and model/token metrics are
default-collapsed. No structured findings or verification verdicts are inferred
from output text. Parallel and chained steps retain their native ordinal.

The header detail action is outside the task disclosure and its inert body,
so a collapsed task can open details without expanding. Multi-step tasks use
the shared anchored menu to select by lane ID and native step index, including
same-role agents. Returning restores expansion, list scroll and trigger focus.
A missing step is never replaced with another agent.

After connecting this production presentation, typecheck, build and the real
Electron control acceptance passed again. The browser checks passed single and
parallel collapsed entry points, missing steps, return state, five roles, the
original layout comparison, loading/error/empty states, reduced motion, 390px
light/dark and 320px English layouts with four-sided focus gutters. This is
Windows source/preview verification, not installer, macOS or account acceptance.

### Latest Main Integration

Rebased onto main `2febc93`, preserving PR #187's model favorites and search.
The complete serial Desktop suite passed with 836 tests: 822 passed and 14
platform skips, including all three real pinned-runtime background cases.
CI inventory/policy/runner checks passed 39 tests with one platform skip.
Typecheck, production build, real Electron background controls and Workflow
acceptance passed again after integration. These local results do not replace
the new PR's cloud CI, native macOS or installer acceptance.

## Completion Self-Review (2026-11-05)

The existing task-options menu adds a default-off, one-shot completion
self-review for the next ordinary main task. A hashed Desktop RPC patch reuses
the native same-session feedback without enabling CLI-only flags, upgrading the
pin, requiring a Git commit or creating an independent reviewer.
Plan, Goal, Ultracode, Cron, BTW and child-agent automatic tasks are excluded.
Queued tasks retain their own choice; rejected direct submissions do not
consume it. Cancellation, errors, terminating denials and approval handoff
block automatic continuation. New input skips a still-pending review but queues
behind an already-started review.

Local Windows source verification uses isolated profiles and loopback model
providers through the real typed preload, IPC and pinned RPC. Native tests cover
default-off behavior, exactly one extra prompt with a real tool continuation,
the same model/credential route, exact once-only token totals, persisted
structured provenance, queued input, cancellation and mutation guards.
Fault injection covers each history-write phase: a failed store still emits one
failed terminal event and releases task ownership, without a completion claim.
Error, cancellation and handoff reasons cannot be masked by an earlier input
skip or a later successful response.

Electron verifies the production menu, one-shot consumption, automatic input
without a fake human bubble, uninterrupted ownership across both native runs,
one final completion event and light/dark/narrow/reduced-motion presentation.
An ended review cannot label a later Plan. The existing launch-mode Electron
acceptance also passes for Plan, Goal, Ultracode, draft options and queue steering.
The original completion sound uses that final event; total task timing spans
both runs. Review endings remain neutral, not "verification passed."
The 24 focused controller/RPC, projection, queue and timing tests pass.
The final complete serial Desktop suite passes 896 tests: 882 passed and 14
platform skips, with no failures. The local log is
`Desktop/test-results/completion-review/desktop-suite-final.log`.
Desktop typecheck and production build, runtime build/typecheck using
`tsconfig.build.json`, and clean patch replay with all 44 postimage hashes pass.
CI policy, inventory and platform runners pass 30 tests with one platform skip;
the new native verifier is assigned to the shared sessions group.

The active staged runtime and replay evidence are isolated under
`D:\Desktop Runtime Builds\completion-review-20261105`; the installed application
and existing installer are unchanged. This is local source acceptance, not
real-account/billing, native macOS, current cloud CI or installer acceptance.
See [the implementation contract](COMPLETION_REVIEW.md).

## 插件宿主协议候选与 SDK 示例 (2026-11-08)

本轮实现未接入生产的声明解析、主进程模式提交参考、窄 host client，
以及使用官方 MCP SDK 的自包含作者示例。没有修改 runtime pin，
没有接入启动器、通用 broker、确认 UI、提供商接口或真实账户。
候选说明见 [插件宿主模型协议](PLUGIN_HOST_CONTRACT.md)。

本地 Windows 源码验证通过：

- 56 项插件相关测试全部通过，其中 14 项为新增候选协议测试。
  覆盖无独立 Key 跟随、独立配置修订、过期与撤销、并发保存、
  孤立快照、损坏或带多余字段的指针/快照、安装身份及 junction 越界。
- SDK 示例冻结依赖安装通过，5 项测试全部通过。
  可安装快照复制到不含 `node_modules` 的新目录后，由官方 MCP client
  完成真实 stdio 握手和工具调用；缺少宿主时明确不可用，不回退环境 Key。
  离线授权前拒绝、授权后结果、撤销及原生后代环境删除均已验证。
- 连续两次作者构建生成相同 bundle 和许可证 SHA-256；
  发布物包含 8 份实际打包依赖的许可证记录。
- Desktop 类型检查、生产构建通过；CI 策略和平台 runner 测试
  39 项通过、1 项平台跳过。新增 Windows/macOS 示例工作流 YAML 已解析。

模拟宿主的 provider 调用数始终为零；音频 MIME 测试不证明真实语音可用。
本轮未运行完整 Desktop/Electron 验收，未生成安装包、更新桌面快捷方式，
也未修改用户账户或日用 profile。本地检查不替代新 PR 的云端 CI、
原生 macOS 验收、市场固定 SHA 同步或真实模型/计费验收。

### 协议层同步当前主线 (2026-11-09)

候选协议分支合入凭据隔离分支 `21181d1`，继承主线 `6edeb18`
的管理进程、Remote、恢复保护和 MiniChat 边界；没有改写既有协议或
升级 runtime pin。合并后 22 项协议与独立配置测试、5 项官方 SDK
自包含示例测试通过。此处只记录协议层的本地回归，不沿用旧提交的
云端通过状态，也不表示后续 broker、启动器、设置页已完成组合验收。

### 协议层同步新主线底座（2026-11-10）

合入凭据隔离分支 `c177dc9`，继承 main `12d054e` 的插件工作区、
全局指令与 MiniChat 更新。仅验证文档发生冲突，双方历史完整保留；
协议、公开 SDK、固定 runtime pin 和依赖均未修改。类型检查、32 项
协议/独立配置/工作区元数据回归及 5 项官方 SDK 自包含示例测试通过。
新 head 的云端检查另行确认，不将后续层或旧提交的通过结果计入本层。

## 插件宿主代理服务与实际 SDK 子进程 (2026-11-08)

本轮在协议候选上增加独立的主进程 `PluginHostBroker` 和 Step adapter，
没有将它们接入生产 `main.ts`、启动器、preload 或 renderer。
服务说明见 [插件宿主模型代理服务](PLUGIN_HOST_BROKER.md)。
BVR 仅提取并共用原有官方账户路由选择器，仍使用旧桥。

本地 Windows 源码验证通过：

- 75 项插件相关测试全部通过，其中 19 项 broker 测试覆盖逐能力确认、
  独立模式不读宿主账户、真实账户/模型修订检查、异步读取期间 runtime 变更、
  Origin/Host/路由拒绝、并发上限、跨租约取消隔离、撤销/过期、
  排队/确认/provider 截止时间、输入输出上限及进行中关闭。
- 官方 SDK 示例 7 项测试全部通过；新增 2 项使用真正 SDK 子进程、
  无依赖安装副本、实际 broker/Step adapter 和隔离 fetch，
  验证固定 Plan 路由、明确同意/拒绝、撤销及不回显账户 Key 或租约 token。
- 连续两次作者构建的 bundle 和第三方许可证 SHA-256 相同；
  SDK 安装快照仍是自包含单文件和 8 份依赖许可证记录。
- Desktop 类型检查、生产构建通过；CI 策略和平台 runner 测试
  39 项通过、1 项平台跳过；SDK 工作流 YAML 结构已解析检查。

所有账户、模型响应和消费者核验均为测试 fixture；没有发送真实付费请求。
本轮没有正式消费者发现/启动身份验证、管理队列或生命周期主动失效接线、
生产确认 UI、TTS 适配和真实账户权益验收，不宣称完整计划 [Ⅱ]/[Ⅲ] 已完成。
未运行完整 Desktop/Electron 验收，未生成安装包、修改桌面入口或用户 profile；
本地检查不替代新 PR 的云端 CI、原生 macOS 或市场发布验收。

### 代理层同步当前主线 (2026-11-09)

代理分支合入本轮协议层同步，类型声明同时保留完整安装凭据类型和
主线的纯主题包指纹函数。合并后 41 项协议、代理与独立配置测试、
7 项官方 SDK 测试及 Desktop 类型检查通过。没有接入生产启动器，
没有真实模型请求或安装包交付；新提交仍需独立云端验收。

### 代理层同步新主线底座（2026-11-10）

合入协议分支 `b970008`，继承 main `12d054e`；仅合并验证记录冲突，
保留原有草稿提升、权限等待和 MiniChat 修复。类型检查及 145 项协议、
代理、配置、会话和全局指令测试通过，官方 SDK 示例共 7 项通过。
未改变账户路由、租约边界、公开 SDK、固定 runtime pin 或依赖，
未接入生产启动器、调用真实模型或生成安装包；新云端检查另行确认。

## 插件宿主原生启动绑定与生命周期 (2026-11-08)

本轮基于代理服务候选 `6203e1b`，接通生产主进程的能力门控启动链，
没有增加用户模式选择界面或升级 pin。运行时仍固定
`29eb460780489801ce8afc8bffc1a2efae7cbded`。
只有声明了宿主消费者、安装 receipt/包指纹/模式有效、真实原生记录唯一，
并且会话和实际模型恢复完毕时才签发；上下文只注入这一次 stdio 启动。
没有模式或存在全局覆盖、来源冲突时保持延后，不默认继承账户授权。

账户持久化、实际模型应用、transport 退出、插件/配置管理和全局 MCP 保存
均主动撤销。供应商、登录及额度凭据刷新事务结束后只恢复等待中的新启动；
中途门控再次关闭可以继续等待，已签发后失败或撤销的记录不透明重签。
原生关闭等待进行中的延后启动；单个失败只释放自己的租约。
私有 RPC 未进入 preload/renderer allowlist，超时迟到和未匹配响应直接丢弃，
hosted 初始化/目录失败不回显原始 launch 上下文。

本地 Windows 源码验收：

- Desktop 全量串行回归 1,530 项：1,517 通过、13 项平台跳过，
  零失败、零取消，耗时 974.2 秒。日志：
  `Desktop/test-results/plugin-host-launch-full-20261108.log`。
- launcher 与原生 SDK 集成 12 项全部通过，使用真实固定 runtime、原生发现、
  私有 RPC、安装 receipt、管理目录及自包含 SDK 子进程。
  测试专用 MCP proxy 调用同一子进程工具，provider 为隔离 fixture；
  验证门控释放、逐能力确认、实际 broker 调用、账户撤销、全局覆盖、
  初始化错误回显隔离及关闭 opt-in 的兼容行为，不向模型发送 prompt。
- 原生 `desktop-plugin-host.test.ts` 和 `src/step/mcp.test.ts` 共 22 项通过，
  包括来源/策略/声明变化、重复启动、session 变化和关闭交错。
  五份改动原生文件 Biome 检查、原生根目录及 coding-agent 构建配置的
  `tsgo --noEmit`、`check-no-secret-leak` 通过；没有声称执行完整根 `check`。
- Desktop 类型检查、最终生产构建通过。最终构建上的真实 Electron
  基础启动及模型切换验收通过，使用隔离 profile 和假模型返回；
  覆盖真实 RPC、renderer 无 Node 权限、设置、窄窗口、重载、
  会话独立模型、队列换模及缺失模型保护。日志：
  `plugin-host-launch-electron-20261108.log`、`plugin-host-launch-models-20261108.log`。
- CI 策略、清单及 runner 40 项：39 通过、1 项平台跳过。
  Windows/macOS 工作流已纳入原生 22 项回归，YAML 解析通过。
- 隔离源码和全新补丁重放后像匹配：共享 53 项、Darwin 组合 54 项；
  所有补丁哈希、staging 源码哈希和 Node 24.16.0 SHA-256 匹配，
  staged manifest 含 25 个能力标记。Darwin 补丁重放不是原生 macOS 执行。

调试中曾以假 Key 命中上游接口并收到 401；最终集成不再走该模型驱动路径。
没有使用个人账户或验证付费权益，不能将调试过程描述为全程无外连。
现有 Step provider 路由单独由 broker/SDK 隔离测试覆盖，原生集成的假 provider
不证明真实 Step 权益。生产 IPC 中连续设置事务、多消费者交错及付费确认
尚缺完整端到端覆盖；基础 Electron 验收不能替代这一点。

模式/授权设置界面、未来模式写入的管理队列接入、真实账户权益、
TTS、BVR 旧桥迁移、Cron 恢复自动接线、实包和跨仓库发布仍未交付。
本轮未打包、修改快捷方式、重启日用应用或更改用户 profile。
新 PR 的云端 CI 与原生 macOS 结果分别确认，不把本地通过写成云端通过。

可重建产物已盘点，未删除：本工作树 `Desktop/runtime` 约 124 MiB、
`Desktop/dist` 约 12 MiB，隔离源码的 coding-agent/CLI dist 合计约 29 MiB；
`D:\Desktop Runtime Builds\plugin-host-launch-20261108` 下保留源码、
新补丁重放目录及必要验收证据。没有生成或囤积新的安装包。

## 插件宿主通用设置与授权观察 (2026-11-08)

基于原生启动候选 `a65a0a5` 增加插件中心通用模式设置，
并以 `f0ff40b` 将 macOS 构建 Node 对齐示例要求的 24.16.0。
不升级 Step Code pin，不修改 BVR 旧桥、插件发布物或用户 profile。
有效宿主声明的已记录消费者可选择跟随；兼容的独立 schema 复用现有字段。
默认未选择，不把保存、安装、服务开关或 Full Access 当作付费授权。

模式写入复用管理队列和共享 IPC 门控。独立配置与模式指针不是同一原子提交，
第二步或回读失败必须报告结果未确认，旧启动失效，草稿保留。
主进程只投影实际会话的连接、模型、地区、Plan/API 和逐能力授权快照，
不向 renderer 提供 worker 选择、私有 RPC、receipt、路径或租约。
状态观察不因临时设置门控永久撤销健康租约，也不签发或续租。
保存失败、管理操作、重启和会话切换清除旧观察；迟到响应不恢复旧授权。

本地 Windows 源码验收通过：

- 宿主协议/设置/代理/launcher/实际原生 runtime、配置与资源 76 项；
  其中 4 项实际固定 runtime/SDK 集成，provider 为隔离 fixture。
- 插件设置/快照竞态、文档与展示 36 项；自包含 SDK 示例另 7 项。
- CI 策略、清单和 Windows/macOS runner 31 项：30 通过、1 项平台跳过。
- 类型检查、最终生产构建、`git diff --check`。
- 新通用设置浏览器验收：未选择、跟随无需 Key、独立秘密不回读、
  保存失败及提交后回读失败、revision 冲突、草稿保留、开关失效、
  跨会话迟到响应、读失败不循环、host-only/不支持宿主、亮暗窄窗、
  完整焦点边界及减少动态效果。使用实际 React 组件和模拟桥。
- 既有生产 Plugin Center 浏览器验收通过，覆盖抽出的共用配置字段。
- 真实 Electron 宿主设置验收：receipt-backed typed IPC、读/保存不创建 worker、
  并发 writer 门控、独立 SDK 原生启动、切跟随后撤销且不自动重启。
- 基础 Electron 完整运行含末尾 profile 重开检查通过，日志
  `Desktop/test-results/plugin-host-settings-core-20261108.log`；
  此前一次只打印主体通过后以 1 退出，不能视为通过，也未宣称查明该次根因。
  首次启动生产验收另已通过，包含新保存 IPC 的共享设置门控，日志
  `Desktop/test-results/plugin-host-settings-first-run-20261108.log`。
  宿主设置日志为 `Desktop/test-results/plugin-host-settings-electron-20261108.log`，
  浏览器截图位于 `Desktop/test-results/plugin-host-settings-ui/`。

云端边界：#218 初次 macOS 失败源于 24.15.0 与 SDK 的最低 24.16.0 不匹配；
修正后两项 SDK 原生启动通过。重跑记录 `42461995514` 首次尝试仍因
`background-runtime.test.ts` 的 complete 场景在 process 阶段 60 秒超时取消：
1,530 项中 1,522 通过、7 跳过、1 取消。已保留证据并对同提交重跑，
不把重跑成功当作该偶发原生启动问题的根因修复；云端结果单独确认。

本轮没有真实账户或付费请求、完整生产付费确认、安装器/实包体验，
不证明 TTS、Cron 自动接线、BVR 迁移、市场同步或组合发布完成。
预览只模拟状态，不能据此宣称模型权益可用。未生成安装包或更新快捷方式。
可重建产物盘点：本工作树 `Desktop/runtime` 124.17 MiB、`Desktop/dist`
11.82 MiB、新界面截图 0.42 MiB；均保留，未删除旧包或修改其他预览服务。

## 插件宿主生产确认链路隔离验收（2026-11-08）

`verify-plugin-host-authorization-electron.mjs` 已加入共享 interface 验收清单。
它将实际 SDK 插件安装到新建的隔离 profile，保留原生发现、主进程 broker、
Step provider、typed IPC 和生产 renderer，不注入确认结果或私有 renderer RPC。
主进程与原生子进程的官方模型网络请求在保存测试账户前即改接 loopback，
其余外部模型地址拒绝；测试不读取个人 profile 或真实账户凭据。
StepPage bundle 固定为隔离目录内不存在的路径，并断言没有额外启用的
StepPage server，避免 Windows 启动回退发现个人安装。

本地 Node.js 24.16.0 / Windows 源码 Electron 验收通过：

- 来源保存、启动、可用性查询不发送模型请求；
- 生产确认展示插件、能力、模型、API 渠道、地区及费用边界；
- 拒绝后返回 `DENIED`，没有 provider 调用或授权；
- 实际 MCP `notifications/cancelled` 撤下未批准弹窗，不授予权限；
- 点击批准后才收到 loopback 模型请求，同次启动同能力复用授权；
- 在途取消实际中断 provider HTTP 请求，不声称撤销已发生费用；
- 经生产登录入口换到另一地区账户，旧启动及授权失效，新账户重新确认；
- 测试专用原生代理保留旧假租约，换号后重放旧 `/context` 和 `/invoke`，
  均返回 `STALE_CONTEXT`，不新增确认或 provider 请求；租约不经过 renderer；
- renderer 保持 Node 隔离，公开快照和界面不含凭据、启动密钥或租约。

SDK 示例修正了未转发 MCP 取消信号的问题，两个工具的上下文查询和
模型调用均传递 `extra.signal`。新增四项真实 MCP 取消回归，旧 bundle 上
四项均失败，重建后完整 11 项通过，取消回归连续三轮通过。
截图保存在 `Desktop/test-results/plugin-host-authorization/`，已检查生产确认图。

设置页 verifier 的模式选择与密钥清空改为等待实际 DOM 状态，
原断言保留，不通过固定睡眠或放宽断言处理 React 更新竞态。
修复后浏览器矩阵通过。CI 策略及 Win/mac runner 共 31 项：
30 项通过，1 项仅 macOS 的进程组场景在 Windows 跳过。

云端仍单独验收：`d458e77` 的 Windows run `42467361509` 和 macOS run
`42467361479` 在依赖安装阶段遇到 GitHub 发布资源 504，
涉及 Electron、Node 与 canvas 预编译下载；并非本轮授权断言失败，
也不能据本地通过宣称云端已绿。保留所有结果与产物上传门禁。
早先 #218 的八槽位重试准备超时尚无已证实根因，诊断增强不算根因修复。

本轮没有真实账户/付费请求、安装包、市场同步、BVR/StepAudio 迁移、
合并或发布；未切换快捷方式，也未清理旧包。

### 信任命令与更新器验收竞态修正 (2026-11-09)

本轮针对 #218 Windows 更新器退出超时和 #220 macOS 包内信任审批失败。
macOS 失败截图实际包含 `Session operation in progress`，不是已经证实的
菜单或 Enter 故障。受控延迟普通快照读取后，旧代码稳定无法产生审批；
修正后普通快照不再阻止信任命令，审批、原生空闲检查、真正操作互斥、
transport/目录复查、取消不写入和不调用模型的边界不变。

更新器断言通过后卡在收尾；本地旧验收的诊断显示收尾时仅有测试窗口，
真实主窗口尚未创建。现在先等待真实主窗口及 typed 退出桥就绪再运行
UI 验收，正常收尾同时等待 controller、进程退出与 context close，
沿用 30 秒有界等待，不强杀、不延长外层 300 秒期限。云端原始卡点
没有更细的退出现场，因此不将这一启动竞态描述为已排除其他可能。

#218 本地 130 项定向测试全部通过，包含快照在命令前/审批中交错、
非快照操作保留拒绝、退出控制器和会话池回归；Desktop 类型检查及
生产构建通过。真实源码 Electron 信任完整流程、命令菜单和两次
更新器正常收尾验收串行通过，profile 与模型均为隔离 fixture。
本轮未重跑全量测试，未在本机执行原生 macOS 或生成安装包；
#220 合并后组合复验及新 head 云端状态需分别确认。

#220 合入 #218 `29c4132` 后，139/139 定向回归、类型检查和生产构建通过；
真实源码 Electron 更新器正常退出、完整信任流程、宿主模式设置和
生产授权确认链串行通过。授权验收仅向 loopback fixture 发送请求，
没有真实账户或付费模型。新 head 云端结果仍需独立确认。

### 文件预览原生改窗同步与诊断 (2026-11-09)

#220 `3900439` 的 macOS run `42575933065` 在包内文件预览验收失败：
点击 HTML 链接后，30 秒内浏览器仍为 revision 0、空标签列表。
同轮源码文件预览及包内宿主设置、授权确认均通过；现有产物没有失败时
点击或 IPC 现场，不能据此认定宿主授权或本地页面服务故障。

该脚本从窄窗恢复后立即点击链接，未同步 renderer 视口和布局。
现改为等待实际原生 content size 对应的 renderer 视口，再等待有限动画完成；
保留真实链接点击、30 秒浏览器等待以及所有隔离、资源、动画与刷新断言。
失败时分别保留 source/package 截图及 JSON，记录最近的指针/点击/改窗事件、
实际 fileOpen 调用结果、错误提示、标签和原生视图。不记录环境或账户数据。
这是一处已确认缺失的验收同步点，不将其宣称为已复现的云端故障根因。

本机 Windows 原脚本及修改后脚本均通过；修改后完整文件预览与原生浏览器
验收串行通过，使用隔离 profile 和本地页面，未用真实账户或付费模型。
文件/浏览器/产物单测及 CI 策略、Win/mac runner 合计 42 项：
40 通过、2 项平台跳过；脚本语法及 diff 检查通过。
仅改验收和本文，不改产品、运行时 pin、CI 清单或期限，不生成安装包，
不更新快捷方式、不重启日用应用。新 head 的 macOS 源码及包内结果另行确认。

### 启动层同步新主线底座（2026-11-10）

合入代理分支 `5ef63a6`，继承 main `12d054e`。主进程冲突同时保留
原生宿主消费者挂载与全局指令空会话复用钩子，退出边界测试同时保留
宿主启动器和插件窗口桩；验证记录保留双方历史。未改变启动签发、
账户撤销、隔离、权限或固定 runtime pin。

类型检查及 160 项启动器、真实原生 runtime、会话、全局指令、
实际主进程 IPC/退出、能力门控和插件窗口策略测试全部通过。
组合 Electron 与新 head 云端验收另行确认；未打包、访问日用档案、
调用真实模型或合并发布。

### 设置层主线同步与 BVR 组合复验（2026-11-10）

#220 合入启动层 `18158ea`，继承 main `12d054e`。冲突保留通用宿主设置、
插件窗口的只读 IPC 白名单、`pluginSaveHostSettings` 的共享变更门控，
以及宿主设置 UI、设置 Electron、授权 Electron、插件工作区、真实外壳、
生产插件三种展示面的全部六项 CI 验收；设计与验证历史均保留。
未升级 runtime pin、依赖、包版本或公开协议。

本机 Windows / Node.js 24.16.0 的组合验证：

- Desktop 类型检查与生产构建通过；284/284 项定向测试通过，覆盖宿主、
  原生启动、凭据隔离、独立配置、主进程边界、全局指令与退出助手。
- SDK 示例 11/11、BVR 53/53 项测试通过；CI 策略、runner、回执测试
  49 通过、1 项 POSIX 场景跳过。未重跑完整 Desktop 单元测试。
- 两仓库的六份公开客户端/配置读取源码与固定提交
  `0a03b3f80b497cad3d55531171ace8c7cb381bb3` 的 Git blob 字节一致。
- 串行真实源码验收中的宿主设置 UI、设置 Electron、授权 Electron、
  插件三种展示面和全局指令通过。插件展示面为八组实际生产链路，
  无模型请求、退出码零、无剩余窗口；MiniChat 独立完整复验通过。
- BVR 通过生产市场安装、真实原生 MCP 启动和生产确认界面的八项验收：
  拒绝、批准与复用、provider 失败、待确认/在途取消、换号、独立配置、
  无宿主账户启动和旧修订拒绝。六次 provider 请求均为 loopback fixture，
  不访问个人 profile 或真实账户，不调用付费模型。

BVR 报告在 `Desktop/test-results/bvr-main-sync-20261110/verification.json`。
验收在合并提交前执行，报告的 `desktopCommit` 因此仍为父提交 `bb74201`；
实际运行的是已解决冲突的组合构建，`dist/main.cjs` SHA-256 为
`fd8b8eef4d12302b864fd373f014cacf96ccd984951511165422e0ac34162db4`，
BVR 为 `dcd4c5111289aca90f2d9f6e3aa3b123260bc402`。不把该报告称为
合并提交的干净 checkout 构建或安装包验收。

保留未决退出失败：首轮组合原生验收与权限单独复测均在 30 秒有界退出
超时，首轮因此没有执行随后 MiniChat。临时安全事件诊断复测通过，
再以未修改脚本串行复测权限和 `then_run` 均通过；后者包含真实原生
命令取消及子进程树断言。没有强杀、延长时限、放宽 controller/launcher/
context close 断言，亦没有把复跑通过当作已证明根因修复。

#215 当前 `c177dc9` 的云端 run `42650285812` 另在 `then_run` 退出失败：
业务断言通过、launcher exit 0、零窗口，但未观察到 context close。
该日志的 `context.isClosed()` 为真也不能替代实际关闭事件；本机安装的
Playwright 1.60.0 在进入 closing 时即可返回真。云端权限验收本身通过，
不将其与本机权限退出卡住认定为同一根因。保留原始失败与后续成功日志；
这些未决项、ARM64 排队及新组合云端检查仍阻止宣称整组全绿。

本轮没有重新打包、改快捷方式、重启日用应用、修改真实账户或配置、
市场同步、合并或发布；StepAudio 不在范围内。

## Plugin Desktop Workspaces (2026-11-09, Local Source Verification)

This source change adds an optional `dfsc.plugin.json.desktop` contract for one
host-rendered workspace per recorded installed plugin. `main-view`,
`side-panel` and `window` select a host surface, not arbitrary plugin frontend
execution. Pages remain bounded, same-package Markdown behind opaque package
references. Optional light/dark raster icons are signature-checked, bounded to
128 KiB and 512px, and require native validation before projected data URLs.
No package-name exception, new account permission, model request, dependency
installation or released-client capability is implied.

Completed local source evidence:

- Metadata, library and plugin-window policy tests passed 24/24, with no failures
  or skips. These cover bounds, raw page-ID validation, provenance, packaged
  document existence and limits, linked-path rejection, stale references,
  native image validation/fallback, schema consistency and the resource-starter's
  actual package files. Invalid icon declarations reject the workspace;
  valid declarations with missing or undecodable files retain the pages.
- The integrated focused host run passed 29 tests, including execution of the
  actual plugin-window IPC handler extracted from production `main.ts` with
  mocked services. It checks owner/frame scoping, stale-reference revalidation,
  configuration-only navigation, denied conversation operations and independent
  window controls. This is not a full Electron application launch.
- `scripts/verify-plugin-workspace.mjs` passed 13 browser check groups against
  component fixtures; `scripts/verify-plugin-shell.mjs` passed 10 groups against
  the actual `main.tsx` shell with an injected bridge. They cover independent
  titlebar grouping, MiniChat order, icon fallback, retry, keyboard/focus and
  overflow behavior, page/history/scroll retention, actual ProseMirror draft
  preservation, side-panel replacement/Escape, theme/preferences refresh,
  package-reference remounting and stale-response/unavailable cleanup.
  Light/dark desktop and 390px narrow screenshots were manually inspected.
  Evidence is under `Desktop/test-results/plugin-workspace/` and
  `Desktop/test-results/plugin-shell/`. Injected bridges do not establish real
  preload or production IPC acceptance.
- `scripts/verify-plugin-windows.mjs` passed seven isolated native Electron
  groups using production `PluginWindows`, production preload and production
  method policy, but fixture state/documents rather than the full application.
  It checks sandboxing, own-ref access, denied operations, exact projected
  broadcast payloads, a dedicated configuration action, blocked navigation and
  popups, credential-free HTTPS through a mocked opener, stale replacement,
  maximize/state events, minimize/close independence, the eight-window bound,
  released slots and failed-load cleanup. Latest evidence:
  `D:\DFSC-Preview-QA\plugin-windows-et3Wq4\verification.json`.
- The complete Desktop suite completed 1,807 tests: 1,794 passed, 13 platform skips,
  no failures. Desktop typecheck and production build passed. The initial
  attempt without a staged runtime failed with missing-file errors and is not
  counted as passing evidence. CI policy/inventory verification passed 24
  tests locally; this does not claim a cloud CI run. `git diff --check` passed.
- `scripts/verify-plugin-surfaces-electron.mjs` passed eight groups through the
  full production Desktop main, preload, renderer, capability service and
  staged runtime, with an isolated profile and real local Git marketplace.
  Actual install immediately exposes shortcuts; all three surfaces open;
  main draft/transcript position and plugin tab/scroll survive; configuration
  targets the exact installed plugin; the side panel yields to official tools
  and restores focus; and the optional actual Hermes package displays all four
  onboarding tabs and its decoded icon in light/dark/narrow screenshots.
  The supplied 256px Hermes avatar's exact image bytes and decoded dimensions
  are verified in marketplace catalog/detail, direct/overflow shortcuts and
  workspace headers; the corresponding screenshots were manually inspected.
  Production native IPC rejects conversation/model/mutation and foreign/private
  document access. Actual marketplace refresh, update and uninstall invalidate
  old references, clear stale native content and preserve the selected runtime;
  stale plugin windows can still close independently. The run recorded zero
  inference requests, no renderer errors, exit code zero and zero remaining
  windows. Evidence:
  `D:\DFSC-Preview-QA\plugin-surfaces-electron-20261109-020304\verification.json`.

The application fixture uses an isolated runtime at
`D:\Desktop For Step Code\Desktop\release\plugin-workspaces-runtime`, reached by
this worktree's `Desktop/runtime` junction. Its reused bundle came from the
existing `capability-management-phase1-20261108-preview-r2` package. Before
reuse, its Windows/x64 commit and exact set of 47 patched-source hashes matched
the current integration manifest, and the Node v24.16.0 binary matched its
recorded SHA-256. The copied node/step/remote files were hash-checked, 20 current
host helper files were copied and three helper bundles rebuilt. No shared
runtime or upstream checkout was changed, and no upstream rebuild is claimed.

The resource-starter's prior installation screenshot predates this feature.
It is not evidence for the new titlebar group, side panel or native plugin
window. No installer, public release, cloud CI, native macOS, real-account or
Hermes/Feishu business-flow acceptance is claimed by this local source record.
No live-model inference or active-model-task continuity was exercised.

## Hermes x DFSC First-Run Guidance (2026-11-10, Local Source Verification)

The Agent Bridge connection page now separates four preparation checkpoints:
profile marker, companion configuration, read-only pairing/identity, and
visible authorized directories. Package-declared setup, first-task and
troubleshooting page IDs provide bounded navigation without additional IPC,
document access, installation, pairing, authorization or task mutation.
The titlebar remains the existing compact status popover.

Completed local evidence:

- Desktop typecheck and production build passed. The build retained existing
  chunk-size and module-directive warnings. The focused metadata, preparation,
  library, requirements and market-metadata run passed 58 tests, with no skips.
- The final generic workspace browser run passed 24 check groups, including all
  preparation states, missing roots, failed/loading evidence reset, declared
  guide navigation, light/dark/narrow focus bounds, and forgetting a profile.
  Held forget results do not steal guide or conversation focus after navigation;
  reopening reads the updated unselected state. No page errors were recorded.
- The Hermes preview passed 25 groups against the real packaged guides and
  production components with simulated state. It covers first installation,
  missing configuration, unavailable/mismatched connections, visible roots,
  first-task navigation and preserved drafts. Desktop/narrow light and dark
  screenshots were inspected. These fixtures do not establish a real service.
- The final production Electron run passed 17 groups through the real main,
  preload, renderer, capability service and staged runtime using an isolated
  profile, local Git marketplace and controlled loopback Bridge. The actual
  Hermes package displays its new brand, four guide pages and approved icons.
  The run recorded zero inference requests, zero renderer errors, launcher
  exit code zero and zero remaining fixture windows after orderly shutdown.
- The initial Electron attempt failed because uninstall changed the number of
  shortcuts and the verifier still expected an overflow anchor. The verifier
  now asserts focus against the actual direct or overflow entry. That failed
  attempt also timed out during shutdown and required removal of its verified
  isolated fixture process tree; it is not passing evidence. The separate final
  run completed without forced process cleanup.
- The complete serial Desktop run finished 1,860 tests: 1,846 passed, one failed
  and 13 platform skips. The original background Plan fixture failed during
  Windows process-tree termination; its verified leftover fixture was stopped
  so the suite could finish. An unchanged, isolated rerun of that exact Plan
  case passed. This does not turn the complete run into an all-green result.
  The test, runtime implementation and staged runtime were not changed to
  accommodate that failure.
- The companion source is unchanged. Its 49 tests completed with 48 passing and
  one platform skip when run with `python -X utf8`; the initial default-codepage
  invocation failed on a GBK read of UTF-8 fixture data. The resource package's
  eight tests and both repositories' `git diff --check` passed. Confirmed icon
  bytes and companion implementation have no diff.

Evidence is under `D:\DFSC-Preview-QA\hermes-first-run-20261110`:
`focused-tests.log`, `full-tests.log`, `background-plan-rerun.log`,
`browser-final/browser-run.log`, `preview/verification.json`, and
`electron-final/verification.json`. The earlier failed Electron record remains
in `electron/verification.json`. The fixture-only preview server is intentionally
kept available for UI review. No installer was produced, existing package
deleted, desktop shortcut redirected, or owner application restarted.
The current `Desktop/dist` is approximately 12 MiB; the existing runtime junction
still points to the isolated `plugin-workspaces-runtime` staging directory.

The Hermes resource continues to use version 0.3.0 and companion 0.2.0.
New engineering grants in that companion still require a verified Feishu owner;
resource installation and read-only viewing do not. Matching the declared DFSC
version range does not prove that an older build implements the new protocol.
No real Hermes/model/Feishu workflow, clean-machine installation, native macOS,
current cloud CI, public marketplace update or release is accepted by this record.

## Generic Local External Delegation (2026-11-10, Local Source Verification)

The reviewed plan is `docs/EXTERNAL_CONNECTORS_PLAN.md`; operator and protocol
details are in `docs/EXTERNAL_CONNECTORS.md`. Ordinary DFSC source now supplies
the default-off `dfsc-external-v1` loopback entry, managed under
Remote access -> Channels -> External agents. This is not a release record.
Hermes companion has a new explicitly selected adapter, independent of its
unchanged-default legacy mode. This supersedes the preceding record's statement
that companion implementation was unchanged, not that earlier record's results.

Completed evidence on the final implementation:

- The 18-file serial unit regression passed 576/576 tests, with no failures or
  skips. It covers the connector core/policy/gateway, plugin connection and
  preparation, native queue/runtime, Remote stores/managers/channels/media,
  desktop Remote and capability removal. The core has 32 tests; the gateway has
  19, including real sockets, directory replacement while a read is queued,
  bounded outstanding handlers, revocation and persistence failures.
  This is a targeted regression, not a claim that the entire Desktop suite ran.
- Desktop typecheck and production build passed. Existing theme-bootstrap,
  module-directive and chunk-size warnings remain.
- Companion tests completed 67 cases: 66 passed and one Unix-only case skipped.
  Resource tests passed 9/9. Both used `python -X utf8 -B`; neither used real
  account credentials, messages or engineering tasks. Versions and approved
  icon bytes were not changed.
- The browser verifier passed six groups with production components and an
  injected bridge: pairing, explicit scopes, nonsecret path copy, revoke,
  empty project list, held failed authorization, keyboard focus restoration
  and shared focus bounds. It covers 1360px/390px, Chinese/English,
  light/dark and reduced motion. Screenshots were manually inspected.
- The final isolated Electron verifier passed seven groups through the actual
  main, typed preload, renderer, staged runtime and Python companion CLI.
  Local UI pairing creates an independent native Ask session without changing
  the selected draft or its unsent text. Identical submissions run only once,
  conflicting keys fail, frozen summaries exclude later local conversations,
  and an old stop cannot stop a later local turn. External approval and policy
  changes fail; local approval works. External stop, local takeover of a
  waiting task, relocation/BTW guards, restart without replay, credential
  revocation and disable all pass. Seven inference requests reached only the
  controlled local model endpoint. There were no renderer errors, launcher
  exit code was zero, and zero fixture windows remained after orderly exit.
- The existing `scripts/verify-remote-access.mjs` passed its complete native
  acceptance, including image delivery, questions, Plan approval, queued input,
  deduplication, encrypted grants, local drafts, focus, narrow layouts and
  quit/relaunch recovery. Its English Feishu selector was made channel-specific
  because the new external channel also has a Manage button; assertions and
  production Feishu behavior were not weakened.
- Independent architecture, security and Hermes reviews completed. They led to
  fixes for listener startup readiness, local abort ownership release, project
  relocation and BTW protection, final directory identity revalidation, and
  failed-operation focus restoration. Both repositories' `git diff --check`
  passed.

Earlier attempts are not counted as passing evidence: the initial browser run
found the focus-restoration bug, which was fixed; native harness attempts used
an asynchronous switch as a synchronous checkbox, read `app.process()` after
Playwright disposal, or used `inputValue()` on the contenteditable composer.
Those verifier errors were corrected, followed by separate successful runs.
The initial Remote rerun failed only at the now-ambiguous English selector;
the complete rerun passed.

Final connector evidence is under
`D:\DFSC-Preview-QA\external-connectors-20261110`:
`browser-final/verification.json` and `electron-current/verification.json`.
Earlier failed records and the preceding successful native run are retained
separately. Remote screenshots are in `Desktop/test-results/remote-access/`.
The current `Desktop/dist` is approximately 12.2 MiB. No installer or new
runtime package was created, existing packages deleted, primary shortcut
redirected, owner application restarted, or real profile/configuration edited.
The existing fixture preview server remains available; no native fixture
process is intentionally retained.

This interface assumes a trusted single-user machine. It is not a filesystem
sandbox or a mutually authenticated cross-user transport; Windows ACLs,
mapped-network-drive detection and token rotation are not accepted by these
tests. The descriptor contains a plaintext bearer in the isolated userData,
never in renderer IPC. Actual Hermes gateway loading, real models/Feishu,
clean-machine installation, macOS, cloud CI, public marketplace publication,
release packaging and user engineering acceptance remain unverified.
