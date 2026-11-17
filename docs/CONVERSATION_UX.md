# 会话交互补齐

2026-11-17，基于 main `48c715f`。本轮只处理通用快捷键、附件显示映射、
MiniChat 自动续底和思考视窗，不包含插件、飞书竞态或安装包交付。

## 快捷键

| Windows / Linux | macOS | 动作 |
| --- | --- | --- |
| Ctrl+B | Cmd+B | 显示／隐藏侧栏 |
| Ctrl+N | Cmd+N | 按现有新建动作打开会话草稿 |
| Ctrl+O | Cmd+O | 打开项目目录选择 |
| Ctrl+, | Cmd+, | 打开设置 |
| Ctrl+J | Cmd+J | 显示／隐藏终端，沿用右侧／底部停靠设置 |
| Ctrl+Shift+F | Cmd+Shift+F | 打开已有全文搜索 |

复用已有界面与 IPC，不自动发送消息、不创建新的 Agent 能力。MiniChat
只接新会话和设置，其他主窗口专属动作不在小窗拦截。菜单显示快捷键，
侧栏按钮显示提示及无障碍键位。输入法、长按、额外修饰键、终端、
行内消息编辑器及模态界面不触发全局动作。主输入框是纯文本编辑器，
在捕获阶段接入，避免 ProseMirror 自带的原生格式保护吞掉 Mod+B。
不绑定通用 Escape 停止任务，不占用撤销、复制、粘贴或编辑器查找键。

### 参考核对

以下是本轮读取的资料，不代表测试或复刻了竞品的全部行为。

- OpenChamber：GitHub `openchamber/openchamber` 的
  `packages/ui/src/lib/shortcuts/config.ts`，读取于 2026-11-17。
  `new_chat=mod+n`、`toggle_sidebar=mod+b`、
  `toggle_terminal=mod+j`、`open_settings=mod+comma`。
  其 `mod+shift+f` 是上下文面板展开，不把它误写成全文搜索。
  来源：`https://github.com/openchamber/openchamber/blob/main/packages/ui/src/lib/shortcuts/config.ts`。
- ZCode：本地 `D:\ZCode\packages\shared\src\shortcutCommands.ts`。
  已核对侧栏 B、设置逗号、终端 J、新任务 N、工作区 O；
  只读本地快照，未核对安装版是否同版本。
- Codex：官方 Commands 页面 Windows 表读取于 2026-11-17。
  已核对侧栏 B、设置逗号、新聊天 N、文件夹 O；J 为底部面板，
  终端本身还有反引号键，因此不声称所有竞品的终端键完全相同。
  原路径：`https://developers.openai.com/codex/app/commands`，
  返回页面的 canonical 为 `https://learn.chatgpt.com/docs/reference/commands`。
- DSH：只读本地 `D:\dsh\packages\client` 快照，未找到可可靠引用的
  完整全局默认键位表，不据此断言没有快捷键。核对了
  `ui-conversation/src/client/chat/ReasoningRow.tsx` 和配套 CSS；
  这份快照与用户所指运行版本未建立一致性，不声称其思考视窗尺寸
  就是本轮采用的数值。

首批取现有功能和常见键位的交集。全文搜索使用 Ctrl+Shift+F 是
DFSC 的选择，不是竞品一致规范。命令面板、会话前后切换、模型循环、
自定义键位和全局唤出不在本轮范围。

## 附件映射

截图中的问题是 Desktop 为普通文件追加的路径说明被直接画进用户气泡，
不是已确认的文件内容外传。只在用户消息显示层识别完整、位于末尾的
中英文标准附件段：每行必须是合法 JSON 字符串、绝对路径和一致的文件名，
最多十项。不完整或未知格式保留原文，不用宽泛的字符串删除。

显示为文件图标和强调色文件名，长名省略，悬停或键盘聚焦可查看完整路径。
中文、英文历史和待接收回执共用此映射；普通正文、引用、命令和图片继续
沿用原组件。原始历史、模型输入、复制与编辑原文保持不变，文件依然是
工具可读取的路径引用，不宣称 Word/PPT 已被原生解析，也不是权限边界。

## 通用设置箭头补齐

正式通用页的“会话排序”和“语言”沿用现有 `appearance-select`
及 `DisclosureChevron`，隐藏默认实心三角形，展开时旋转同一个线框箭头。
保留原生 select 菜单、键盘操作、标签和偏好保存；没有另造下拉交互。
真实设置页回归检查箭头几何、默认指示符隐藏、展开旋转、键盘选择，
并保留深色展开和浅色窄窗聚焦截图。类型检查和构建通过，未新打包。

## 思考视窗

保留现有行内展开、自动收起、手动展开状态、三次方动画和减少动态效果。
内容使用 `min(280px, 40vh)` 的最大高度，短内容不强制占满；
长内容内部滚动，标题／折叠入口不随思考正文滚出。运行中的内部视窗
跟随新内容，上滚暂停；选中文本时不抢阅读位置。内部滚轮、触摸与
阅读按键不再修改外层会话的跟随意图。未截断或删除实际思考内容。

## MiniChat 续底

恢复窗口／历史时会保留 `readingRestore`。此前发送只打开 `follow`，
没有撤销旧阅读位置恢复，布局回调仍可能反复把视口恢复到旧处。
普通发送现在先清除此恢复状态。窗口恢复同步设置跟随意图，
避免新跟随状态还带着之前的 backward 意图。

同时按实际会话、阅读预览和待接收内容切换重新绑定布局观察器，
避免继续观察已替换的 transcript。用户主动上滚依然暂停，
点击回到底部恢复，不把所有滚动强制吸底。

## 验收

- 定向纯函数／展示／布局回归 83 项通过。
- 类型检查、生产构建通过，保留既有打包器警告。
- `verify-stream-motion.mjs` 功能断言通过附件映射、六组快捷键、
  模态／终端不抢键、思考限高／内部滚动／上滚后追加不抢位置、
  中间折叠帧／快速反转、主聊天尾部稳定、亮暗窄窗及减少动态效果。
  一轮后续退出超时，已核对测试实例身份并清理；最终再次完整运行通过，
  包括正常退出，不把此前失败轮次抹去。
- `verify-mini-chat-electron.mjs` 原生完整验收通过，新增恢复旧阅读位置后
  发送、连续四批长输出续底、上滚暂停与回到底部；其他小窗行为继续回归。
- 正确钉定 runtime 下 `verify-conversation-scroll.mjs` 完整通过，
  覆盖主聊天滚轮／按键／拖动、嵌套输出、恢复跟随、亮暗窄窗及减少动态效果。
- 全量测试 3017 项：2967 通过、35 失败、15 平台跳过，224544 ms。
  失败包括验证目录下 JSX 配置发现、主题路径校验和一项模型注册时序断言；
  明确 `--tsconfig` 并在源码目录使用 `DESKTOP_TEST_RUNTIME` 指向正确 runtime，
  对应 12 个测试文件共 61 项重跑全部通过。补齐验证目录示例路径后，
  插件原生 18 项全部通过。未取得单次全量零失败结果，不作全量全绿声明。

### 本机验证环境

工作树为 `C:\Users\7oMB\.codex\worktrees\conversation-shortcuts-ux\Desktop For Step Code`，
分支 `fix/conversation-shortcuts-ux`。原 `D:\Desktop For Step Code` 的既有改动未迁移或覆盖。
最初复用的另一工作树 runtime 与本轮 manifest 不完全匹配，初轮结果不作为精确
主线 runtime 验收。之后独立复制 runtime 至
`D:\DFSC Builds\conversation-ux-runtime-20261117`，79 项 patchedSourceHashes
全部匹配本轮清单，管理脚本使用本轮源码；正确 runtime 的启动测试 3/3 通过。

原生验收使用 `D:\DFSC Builds\conversation-ux-check-20261117\Desktop`
作为启动目录，源码／构建输出映射回本工作树，runtime 映射到上述独立副本。
**源码工作树原有 `Desktop/runtime` 联接仍指向最初复用的 runtime，
不可直接将该目录视为本轮已核验的启动环境。** 后续开发／打包前应重新准备并核对
runtime；本轮未修改共享 Step-Code 或其他工作树的 runtime。

可重建产物盘点：独立 runtime 约 124 MiB、终端依赖副本约 61 MiB，
另有前端构建输出、截图和测试日志；没有生成安装包。保留当前验收证据，
未擅自删除已有包或历史目录。

均使用独立测试 profile 和本地夹具，不使用真实付费模型或正式用户数据。
本轮提交供 PR 审查；未新打包、安装、切换日常快捷方式或合并。
