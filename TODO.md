# 开发待办

当前优先级清单，不代表发布日期或实现方案承诺。具体范围在开始每项工作前确认。

## P0

- [x] 下一个 Release 前解决：登录 Step Plan 后，初始化时模型的思考档位不可见（显示“暂无可用档位”）。客户端刷新修复已实现，隔离登录回归和新包的真实 Step Plan 登录验收均通过（2026-10-10 用户确认）。[复现截图](docs/acceptance/plan-thinking-initialization.png)
- [ ] 前端体验优化（第二部分）：按小白、普通开发者、深度开发者提供不同前端能力与分组式体验。目标为第二版 Release，在第一部分之后开展。

- [ ] 任务运行中解放模型控件，允许运行期间调整模型。[复现截图](docs/acceptance/model-control-during-run.png)

## P1

- [ ] MCP 和 Skill
- [ ] Goal 模式优化
- [ ] 自动化任务
- [ ] 审批前端优化
- [ ] 更多第三方供应商专配 [Ⅰ]

- [ ] 产物原处交互返回。[复现截图](docs/acceptance/artifact-inline-return.png)

## P2

- [ ] MiniChat
- [ ] 流量统计，日常与月度消耗热力图，柱形图

## 已完成

- [x] 正文开头泄露：遵循上游隐藏消息标记，避免内部能力提示混入正文。[复现截图](docs/acceptance/assistant-opening-content-leak.png)
- [x] Subagent 失败态及优化
- [x] 第三方供应商适配
- [x] 客户端可以获取 GitHub 最新版本
- [x] 托盘与后台进程
- [x] 前端体验优化（第一部分）：字体、行间距与主体视觉。
