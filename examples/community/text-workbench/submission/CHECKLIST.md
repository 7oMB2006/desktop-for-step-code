# 投稿准备清单

当前只是独立源码目录和本地市场，未建立公开仓库、未提交收录 PR。
示范身份为 DFSC example contributors，不冒充外部真人。

## 可直接参考

- `plugins/text-workbench/` 是实际提交给市场同步工具的资源目录。
- 身份、MCP、技能、指令、设置、文档、图标和 MIT 许可证均随包。
- `dfsc.plugin.json` 指向 `docs/GUIDE.md`；社区工具替换根 README 后，
  作者说明与相对导航仍不丢失。
- `source-lock.json` 是当前资源的本地 SHA-256 记录，不冒充 Git commit。
- `tests` 检查真实业务和配置边界；隔离验收与截图单独记录。

## 公开投稿时再填写

1. 创建或选定自己的真实公开仓库，推送源码并记录完整 40 位提交 SHA。
2. 选择唯一插件 ID；复制示例投稿时更换示例身份、指令和归属。
3. 在社区 `registry.json` 填入真实 repository、commit、
   `path: "plugins/text-workbench"`、`license: "MIT"`、
   `readme: "docs/plugins/text-workbench.md"`。
4. 用本目录 `marketplace-description.md` 准备社区说明，再运行维护者同步工具。
5. 不手填生成目录或伪造锁；让工具获取真实提交并生成市场条目和哈希。
6. 校验同步结果，使用隔离 DFSC profile 验证发现、安装、保存、工具、停用与卸载。
7. 创建社区收录 PR，分别注明公开提交、实际验收宿主和依赖。

本地验收通过不代表 PR 已提交、社区已合并或正式客户端已能发现。
公开建仓、投稿和上架需要项目所有者另外确认。
