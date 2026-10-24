# 引用批注

## 调研与边界

本轮参考 OpenChamber 的选段评论交互，以及用户在当前对话中提供的
Codex 选段与批注一一对应的形式。不是复制另一个产品的完整批注系统。

OpenChamber 源码核对日期：2026-10-23，main 为
`6b86d926420747429b96461b7a7e5411fbe14531`。

- `packages/ui/src/components/chat/message/TextSelectionMenu.tsx`：
  选段工具栏可进入评论输入状态，输入时继续标识原选段。
- `packages/ui/src/components/chat/message/ChatQuoteMarkPopover.tsx`：
  选段关联评论可编辑、删除，并处理输入法组合及 Enter/Shift+Enter。
- 源码仓库：<https://github.com/openchamber/openchamber>

已查询 Codex 官方功能文档
<https://developers.openai.com/codex/app/features/>，没有据此确认聊天选段批注
的具体内部实现。当前实现不依赖 Codex 的私有协议，也不生成 Codex 专属指令。

## 本轮实现

- 原来的“引用”和复制不变，新增“批注”入口。
- 输入批注时原选段保留主题色高亮。Enter 添加，Shift+Enter 换行；
  中文输入法确认不提交。取消不添加引用。
- 待发送区分别展示“引用”和“批注”，独立计数、预览和清空。
  普通引用不显示批注输入框；批注保留关联原文，可独立编辑评论。
  清空编辑内容时仍保留在批注组，不自动转成普通引用。
- 待发送批注在原选段旁显示小号编号，选段保留淡色标识。点击编号在原处
  查看或编辑；删除批注同时移除该批注携带的原文，不影响独立添加的引用。
  批注独立编号，不受普通引用数量影响。原文范围必须匹配才显示，不对失效位置猜测。
  发送后清除待发送标记，批注随用户消息保留。图标使用 16px 的线性铅笔。
- 选段底色是主要入口，不再使用虚线下划线。鼠标停留 400ms 显示只读批注；
  移向浮层保留通道，离开后延迟关闭。点击原文或编号固定浮层，点击铅笔
  才进入编辑。底部引用预览的悬停及键盘焦点同步加强对应原文的高亮。
- 同类重复引用不产生重复条目；再次批注追加到同一条，超过长度上限明确报错。
  同一选段的普通引用与批注互不合并。
- 原文仍为参考内容，批注单独标识为用户意见。没有批注的旧消息格式不变。
- 已发送消息与队列预览都展示批注；队列编辑正文时保留批注。
- 会话草稿及发送失败恢复沿用现有引用机制。不涉及账户、凭据或运行时配置。

## 验证

`chat-quotes.test.ts` 覆盖中英文、旧格式、批注与分隔符的往返及失败恢复。
`verify-chat-quotes.mjs` 在 Electron 窗口验证真实引用组件与 outgoing prompt，
包含输入法、编辑、清空及发送失败恢复。其发送环节使用 IPC fixture，
不代表真实模型验收。

`quote-annotations.html` 使用实际引用与选区组件提供独立可操作预览；
`verify-quote-annotations-fixture.mjs` 覆盖浅深色、390/1000 像素视窗、
高亮、输入、修改与发送展示。预览页不会调用模型。

运行浏览器预览：

```powershell
corepack pnpm exec vite --host 127.0.0.1 --port 5195 --strictPort
```

页面：`/tests/fixtures/quote-annotations.html`，支持 `theme=dark`、`lang=en`。
