# 连接准备

先在完整工作台的「连接」页选择目标 Hermes 身份目录（profile），再检查。
不知道目录在哪时，先从你启动 Hermes 时使用的 profile 确认，不猜默认身份，
不把模型 Key、令牌或消息渠道凭据发进聊天。

## 身份目录

选择包含 `config.yaml` 的本机 profile，不是 Hermes 源码、Python 环境或市场资源目录。
此项只验证目录和标记文件，不读取配置内容，不证明 Hermes 已安装完整或正在运行。

还没安装 Hermes 时，先按 [Hermes Agent 项目](https://github.com/NousResearch/hermes-agent)
准备自己的环境、模型和独立 profile，并确认它能正常回复普通消息。
安装资源与只读检查无需飞书。当前 companion 0.2.0 发起新工程所需的人工授权、
控制命令和回调仍使用已配置飞书；其他消息渠道的工程授权尚未适配。

## Companion 配置

Hermes x DFSC companion 是本项目维护的 Hermes 侧桥接插件，不是 Hermes 官方组件。
市场资源包不会把它装进你的 profile。

从 [Hermes x DFSC 项目](https://github.com/7oMB2006/hermes-engineering-bridge)
取得 `companion/`，由你或管理员阅读根目录 `INSTALL.txt` 和 `companion/README.md`。
使用 Hermes 自己的 Python 环境安装到刚才选择的 profile，保留安装器报告的备份。
该目录下应有 `dfsc-bridge/config.json`，其中明确指定身份和 `bridgeRoot`。

配置有效不证明 companion 已启用或加载。安装器不会重载网关；
仍需按 Hermes 的可信管理入口启用、重载目标 profile，并核对成功应答。
可以请 Agent 解释非秘密配置和步骤；配对及权限确认由你或管理员完成，
不要让工程会话搜索凭据或替你批准。

## Bridge 配对与连接

当前桌面主线不内置 Agent Bridge 服务。资源工作台也不能补装这个服务。
完整派工仍需实际包含 Bridge 协议 v1 的配套宿主。
本仓库不提供宿主应用安装器；尚未取得时，先联系项目维护者确认受支持构建，
不要把历史资源 ZIP 当作宿主安装包。

DFSC `>=0.6.0` 是版本下限，不证明同号安装包已包含连接协议或本轮引导。
取得配套宿主后，由你或管理员启用接入、核对身份、完成独立配对。
不复制其他智能体的 `model.json` / `human.json` 来跳过配对。

回到连接页重新检查。宿主仅使用所选身份的 `model.json` 进行固定只读查询，
页面不接收令牌。通过表示本次查询成功，不证明 companion 已加载或可以派工。

## 授权目录

第一次仅选择一个空的练习目录，由你在配套宿主可信入口明确授权。
连接页展示宿主授权与 companion 配置范围的实际交集，不增加任何权限。
没有可见目录时，核对两侧范围及目录是否存在，不要改成全盘授权来跳过问题。

完整页最多显示首批 50 条中符合身份和目录范围的 20 项任务。
空列表不证明全部历史没有任务，任务摘要不包含对话、工具输出或审批操作。

四项检查后，仍需核对目标 Hermes 已加载 companion 及当前支持的工程授权通道，再由你发起
[第一项任务](FIRST_TASK.md)。异常时看 [排查问题](TROUBLESHOOTING.md)。
「忘记此选择」不修改原 profile、配对文件或授权。
