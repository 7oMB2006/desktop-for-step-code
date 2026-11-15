# 上下文侧栏性能诊断

日期：2026-11-14。基线：`54945d54eeaf2aa7a83a5e61d331d9b90dec891e`。
下文先保留首次诊断；2026-11-15 已在 `main 036ae94` 接回并复验，见文末新主线复验。

## 范围与结论

用户报告：长会话打开并收起上下文侧栏后，整机与鼠标短暂卡顿数秒。
本轮确认并优化了侧栏的同步挂载与消息预览开销，**没有复现或确认数秒级整机停顿的根因**。
以下结果不是安装包、真实账户、macOS 或发布验收。

- 原侧栏每次挂载全部消息；行级 memo 和 `content-visibility` 不限制 React/DOM 数量。
  最终改为连续滚动虚拟列表，不提供手动分页，也不改变主聊天区。
  原始消息数据仍在快照中，只有组件和 DOM 按可见范围挂载，编号没有删除或改写。
- 原预览先对全文执行空白正则替换再截取。现在按需生成最多 160 个 UTF-16
  码元，输入最多扫描 8192 个码元；病态长空白用 `...` 表示未扫描尾部，
  不拆分合法代理对。消息 JSON 的生成与脱敏逻辑不变。
- 使用 `@tanstack/react-virtual@3.14.26`，每侧预渲染 6 行，由 ResizeObserver
  测量实际高度；消息区以上的统计内容作为滚动偏移量，仍共用原来的侧栏滚动条。
  以消息 key 维持阅读锚点。展开项、焦点项和文本选择端点额外保留，避免操作对象卸载。
- Tab/Shift+Tab 按完整逻辑列表移动，必要时先挂载目标再聚焦；消息被删除后，
  焦点回到当前角色标签。角色筛选、JSON 脱敏与复制接口保持不变。

## OpenChamber 对照

2026-11-14 通过 GitHub API 固定检查了上游 main：
`7b8e5cb6eecba7adecef9a59715975e9d51ca8ca`，不是对某个已发布安装包的运行验收。

- `packages/ui/src/components/layout/ContextSidebarTab.tsx` 的原始消息区仍是
  `[...sessionMessages].reverse().map(...)` 全量渲染。`RawMessageRow` 有 memo，
  展开时才生成 JSON，统计计算有按消息对象缓存。没有显式分页或右栏行级虚拟化。
- `packages/ui/src/components/chat/MessageList.tsx` 的主聊天时间线使用
  `@legendapp/list/react`；历史与流式尾部共用一条虚拟列表，通过
  `maintainVisibleContentPosition` 维持阅读位置，并有按消息 ID 导航、选区保留等适配。
- 上游同时依赖 `@tanstack/react-virtual@3.14.26`。本项目上下文侧栏的行结构较简单，
  选用其 headless API 接入原滚动容器，没有移植上游整套聊天时间线、store 或样式。
- 继续检查 `packages/ui/src/sync/session-message-loader.ts` 可见，上游数据层另有
  游标分页、近期窗口与 `trimHistory`：冷打开从近期批次开始，旧记录按需补回，
  浏览历史时会持有记录，安全时才缩减客户端缓存。因此右栏 map 的是已加载记录，
  不必然是整个会话历史。本次不改变 DFSC 快照或 RPC 语义。
- 数据分页和渲染虚拟化是两层优化。不能把这次 DFSC 右栏改造描述为“旧历史数据不再加载”，
  也不能仅凭源码就声称 OpenChamber 已解决同样的整机卡顿。

## 对照方法

`Desktop/scripts/verify-context-performance.mjs` 使用实际已装 Electron 主程序及隔离 profile，
以合成快照代替模型服务。基线加载包内 renderer，优化组加载当前源码生产构建的 renderer。
每组单独启动进程，1920×1032，窗口透明、不接收原生鼠标事件，未操作用户原实例。

每组 3 次打开/收起，每个动作观察约 1.2 秒；均持续派发合成 pointermove。
合成数据为 1112 条消息：39 用户、484 助手、586 工具结果、3 摘要。
密集组每条助手消息都有 Markdown；另有先展开/收起 150 个思考与 150 个工具详情的组。
追踪只汇总对应 renderer 主线程、对应动作区间，不混合多个线程的累计时间。

背景配置与用户当前设置一致：图片 1672×941，亮度 59，内容透明度 70，
图片模糊和表面模糊均为 0；静态组关闭视差，视差组为 12。
没有读取、复制或修改真实会话与凭据。

## 实测

下表为三轮范围；首帧间隔从点击前的 timing mark 到下一次 rAF，
不是整个动画结束时间。帧间隔与主线程任务不是同一个指标。

| 样本 | 打开首帧：基线 → 连续虚拟列表 | 收起最大帧间隔：基线 → 连续虚拟列表 |
| --- | --- | --- |
| 密集消息、静态背景 | 87.1–104.8ms → 16.5–32.5ms | 57.5–59.7ms → 48.1–49.4ms |
| 密集消息、背景视差 | 82.2–101.7ms → 18.8–30.4ms | 47.0–49.7ms → 51.1–61.9ms |
| 已访问详情、背景视差 | 84.9–101.8ms → 19.2–29.9ms | 48.8–50.0ms → 48.2–48.8ms |

三组最终测试每次打开的消息行从 1112 降为 13；面板增加的 DOM 节点从 11367 降为 391，
约减少 96.6%。滚动过程中挂载量会随视口和保留项变化，不是固定 13 行。
视差组打开动作区间的主线程最大任务从 81–100ms 降为 30–55ms。
收起波动约 48–62ms，没有一致收益，视差组甚至比该次基线更慢。
没有证据把这轮改动表述为已修复整机数秒卡顿。

最终表格全部使用同一版本脚本重新启动独立进程测量。早期静态/视差基线没有单列
`firstFrameMs`，不能将其 `maxFrameMs` 混作首帧与新版比较；旧记录已从最终表格排除。

持续合成指针移动下，视差明显增加累计合成开销；这是负载放大项，不是原生鼠标卡顿证明。
早期分页实验另做 `blur(0px)` 强制改为 `none` 的诊断，累计 TaskDuration 为
5.398s / 5.413s，未见明显收益，所以没有修改背景产品代码。
追踪也没有发现能解释数秒停顿的大型收起 GC 或单次 Layout。

透明测试窗口、合成事件及有限 fixture 不能验证 Windows 原生输入、DWM/GPU 调度、
真实会话访问历史或事发时系统资源峰值。下一步若追查剩余故障，应在实际复现时
同步捕获 renderer trace 与系统 CPU、提交额度、硬缺页、GPU/DWM，而不是凭事后占用定因。

## 验收与证据

- TypeScript 检查、renderer 生产构建通过；保留既有构建告警。
- `context-inspector`、`context-ring`、`context-maintenance` 定向测试 27/27。
- `Desktop/scripts/verify-context-virtualization.mjs` 最终 20 组检查通过，验证全量连续滚动无遗漏、
  可见区域不断层、各角色筛选、键盘走过完整列表、JSON 展开/复制/脱敏、
  真实 IPC 快照追加与收缩、同条数窗口替换的锚点、空态、展开行实时测高、
  焦点与选区保留、全屏与还原，以及列表逻辑位置和总条数的 ARIA 信息，
  以及英文深色 1920/640 和中文浅色 390 宽度布局；最多同时挂载 31 行。
  横向溢出均为 0，页面异常为 0，截图已目视检查。
- 本机证据：`D:\Desktop For Step Code\output\context-performance-20261114`。
  最终同口径对照使用 `controlled-baseline-final-*` / `controlled-virtual-final-*`；
  零模糊反证使用 `diagnostic-no-backdrop-parallax`。
  `baseline` / `dense-baseline` 是早期探索记录，不用于独立进程的正式对照。
  最终功能证据为 `virtual-acceptance-final-r5/results.json` 及同目录截图。
  `virtual-acceptance-r1/r2` 记录初始化时父滚动容器 ref 尚未就绪导致的空列表，
  已修正测量时机，保留了连续遍历的非空断言。

早期 `controlled-optimized-*` 和 `pagination-acceptance-final-r3` 是已被替换的
80 条显式分页实验，不代表当前交互。它挂载 80 行，但改变了连续浏览方式，
用户指出后已移除，不能作为最终验收证据。

本轮只有隔离工作树中的源码、轻量 renderer 构建与验收证据。没有打新包、切换快捷方式、
重启日用程序、改日用 profile，或清理其他会话的历史产物。
renderer 产物约 4.96 MiB；整个实验目录约 216.8 MiB，包含历史对照及失败证据。
当前必需的是最终六组对照、`virtual-acceptance-final-r5` 和正在被本工作树链接使用的
`virtualizer-deps`。其他旧实验可以在获准后精确清理，本轮没有擅自删除。
复用已有 Electron 与依赖，另补充了两个虚拟列表新包，没有重装或替换共享依赖中的已有包。
自有测试 profile 通过共享 helper 在自有 Electron 关闭后清理，未删除历史包或正式档案。

## 新主线复验（2026-11-15）

优化分支 `fix/context-panel-performance` 已快进至
`036ae94e50b60251a540564a5ce3ae4991328e00`（PR #247），再恢复原有未提交优化。
主线没有修改本轮的三个 inspector 源文件或依赖清单，恢复无冲突。
恢复前的精确 allowlist 备份保留在 Git stash
`a624718a3efc19df340ea7d0504161455f473780`；此处记录恢复及验收时的检查点，
当时尚未创建交付提交。
未改变连续滚动、消息加载/RPC、主聊天区或插件启动语义。

本轮不沿用旧包作为基线。两套 renderer 均从这个新 `main` 构建，使用相同 Vite
选项和其余源码；基线仅在构建的 pre-load hook 中将 `ContextPanel.tsx`、
`context-inspector.ts`、`context-panel.css` 换成 `git show HEAD:<path>` 的内容。
两个实际 bundle 均核对了虚拟行标记，来源哈希与方法记在 `build-info.json`。
两组共用 `main-20261115-036ae94` 的 Electron/主进程，每个条件与版本独立启动隔离实例。
`DESKTOP_PERF_VARIANT=baseline|virtual` 显式区分预期，基线断言挂载 1112 行，
优化组断言不超过 50 行，不再把所有外部 renderer 都当成优化组。
静态组先基线，视差组先优化，访问详情组先基线；每组仍为三次开关，
不与构建或其他测试并发。其余 fixture、背景和 trace 方法与首次诊断相同。

| 样本 | 打开首帧：新 main 基线 → 优化 | 收起最大帧间隔：新 main 基线 → 优化 |
| --- | --- | --- |
| 密集消息、静态背景 | 84.7–112.4ms → 16.2–30.9ms | 47.4–49.9ms → 49.0–50.3ms |
| 密集消息、背景视差 | 88.5–104.0ms → 18.9–30.2ms | 50.0–53.8ms → 48.9–50.8ms |
| 已访问详情、背景视差 | 86.3–98.6ms → 18.9–30.8ms | 50.4–51.1ms → 49.2–51.4ms |

九次打开均从 1112 行降至 13 行；增加的 DOM 仍从 11367 降为 391，约减少 96.6%。
这说明新主线已修复插件启动后，右栏的独立渲染收益仍存在。
收起约 47–54ms，仍没有一致收益，也未验证原生鼠标或数秒级整机卡顿。
主入口 JS 原始体积为 2428906 → 2466440 字节，增加 37534 字节，约 36.7 KiB；
这是引入虚拟器和保留键盘、选区、锚点行为的成本，不声称 bundle 变小。
两份 TanStack Virtual 包的 MIT 许可文本相同，构建流程增加
`dist/licenses/tanstack-virtual.txt`。

- TypeScript 检查、两套 renderer 生产构建及原工作区完整 `scripts/build.mjs` 通过，
  保留原有构建告警。完整构建的 74 个前端资产与被测试的优化 renderer 逐字节一致，
  并核对了输出的 TanStack 许可证。
- 上下文、会话读取和启动边界定向测试 74/74。首次额外启动测试因本工作区
  缺 `runtime/manifest.json` 未执行到断言；随后只读链接新 main 包的 runtime 后通过。
  runtime pin 为 `29eb460780489801ce8afc8bffc1a2efae7cbded`，未重新 staging 或改写它。
- 最终连续列表 Electron 验收 22 组通过，最多挂载 31 行。保留首次 20 组覆盖，
  新增 Context/Status/CLM 来回切换、隐藏 CLM 不读取、仅虚拟列表关闭原生滚动锚定，
  以及正常/减少动态效果模式下四次关闭重开。无空白列表、横向溢出或 renderer 异常。
  英文深色 1920/640 与中文浅色 390 截图已检查。
- 证据：`D:\Desktop For Step Code\output\context-performance-20261115-main036ae94`。
  `comparison.json` 汇总全部六组，`static-*`、`parallax-*`、`warm-*` 留存原始 trace、
  CPU profile 和运行日志。最终功能证据为 `virtual-acceptance-final`，
  `virtual-acceptance` 是补充两组之前的成功记录。最终单测日志为 `unit-tests.tap`，
  完整构建日志为 `production-build-final.log`。

原共享依赖副本缺少 `semver/LICENSE`，首次完整构建在许可证复制阶段失败，
不代表 renderer 或主进程编译失败。另建 D 盘依赖入口层：其余包只读链接回原目录，
`semver@7.8.5` 的现有文件逐份复制，仅从同版本完整依赖副本补入 MIT 许可文本。
本工作树的 `node_modules` 入口改指该入口层，原 junction 保存在不参与打包的
`Desktop/test-results/shared-dependency-pointer`；没有补写或替换共享包。
它仍依赖旧证据目录下的 `virtualizer-deps`，不能将两个依赖目标当作废弃产物删除。
独立 `source-build` 目录曾完成试构建，但 worker 产物有差异，未用作最终验收；
最终在原工作区重跑完整构建，所有前端资产与实际受测版本完全一致。

盘点不跟随 junction：本轮 D 盘目录约 147.9 MiB，其中两套 renderer 各约 5 MiB，
非最终 `source-build` 约 74.6 MiB，当前依赖入口层约 106.7 KiB；
工作区 `dist` 约 13.1 MiB、`terminal-runtime` 约 61.4 MiB。
`artifact-inventory.json` 保留精确字节数和活跃依赖目标。未获授权，不删除历史或
上述试构建；后续清理必须单独指定路径，保留原始证据并避开活跃依赖及链接目标。

这是新主线上的源码整合及隔离呈现复验，不是优化安装包、真实账户、云端 CI、
整机卡顿或发布验收。截至上述本地验收检查点，尚未提交、推送或创建 PR；
后续提交和 PR 状态以 Git 及对应 PR 为准。本轮没有打新包、切换快捷方式、
重启用户应用或更改正式 profile。历史证据和仍被依赖链接使用的
`context-performance-20261114/virtualizer-deps` 没有删除。
