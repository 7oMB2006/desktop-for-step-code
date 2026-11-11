# Hermes x DFSC

资源版本 **0.3.0**。让 Hermes 理解委托、核对交付，让 DFSC 在授权目录执行工程，
保留同一项任务的原生会话、审批与人工接管。

## 这次安装得到什么

本地指南、帮助命令与工程证据规范。支持 `agent-bridge-v1` 及本轮引导的客户端
还提供连接工作台。DFSC `>=0.6.0` 是版本下限，不证明构建包含协议或 Bridge 服务。

顶栏图标先展开状态小面板，不切换当前聊天；再次点击、Escape 或点击外部收起。
点击「打开完整工作台」，选择目标 Hermes 身份目录（profile），再重新检查。
完整页按身份目录、companion 配置、Bridge 配对连接、授权目录显示证据及下一步。
小面板只显示本次核验身份和首批最多 5 项任务，不是实时在线状态。

## 还要准备什么

- 你自己的 Hermes Agent、模型和独立 profile。安装资源与只读检查无需飞书。
- 本项目维护的 Hermes x DFSC companion 0.2.0，单独安装、启用并重载目标 profile。
- 实际包含 DFSC Agent Bridge 协议 v1 的配套宿主，以及独立配对和明确目录授权。

当前 companion 0.2.0 发起新工程的人工授权与回调仍使用已配置飞书，
其他 Hermes 聊天入口不等于已支持派工。需要真实工程时，另按配套说明核对该通道。

companion 不是 Hermes 官方提供的桥。市场资源不包含 Hermes/Python 环境、
companion 安装器、宿主应用安装器、MCP 调度服务或可执行前端脚本。
配套代码及管理说明在 [项目仓库](https://github.com/7oMB2006/hermes-engineering-bridge)
的 `companion/`、`INSTALL.txt`；尚未取得配套宿主时，先向维护者确认受支持构建。

## 下一步

- [开始使用](docs/START.md)：安装得到什么，接下来做什么。
- [连接准备](docs/SETUP.md)：四项检查分别说明什么，缺项如何处理。
- [第一项任务](docs/FIRST_TASK.md)：由你发起空目录练习，核对真实交付。
- [排查问题](docs/TROUBLESHOOTING.md)：入口、连接、任务和移除。
- [更新记录](CHANGELOG.md)。

检查不会自动安装、配对、授权或派工；目录通过不证明 Hermes 正在运行，
配置通过不证明 companion 已加载，只读连接通过不证明可以派工。
`hermes-bridge-help` 只提供帮助，`hermes-engineering-evidence` 规范工程证据。
更新市场后还需更新已安装副本；资源更新后需重新选择 profile。
卸载资源不会停止工程，也不会撤销 companion 或宿主权限。
