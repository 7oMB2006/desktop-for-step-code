# 宿主配置字段骨架

`ConfigurationFields.tsx` 是字段层，不是可安装插件入口。
它使用项目实际的 `CapabilityDisclosure`、Lucide 和 `pc-*` 样式，
放在现有 `PluginCenter` 的配置页中，不复制导航、页签和保存底栏。

它只接收草稿、修改回调和原生路径选择回调，不访问全局 `window`、
Node、磁盘、账户凭据或网络。示例默认独立连接，未实现跟随 DFSC；
不能通过把 `mode` 改成字符串就获得 BVR 的授权桥。

## 宿主需要补的部分

1. 在 `Desktop/src/contracts.ts` 定义专用的读取、保存、检查和路径选择接口，
   并在 preload 和 main 中实现。不要新增任意插件方法名或任意文件路径写入 RPC。
2. 读取返回公开值、`revision`、`hasMainKey` / `hasAsrKey`，不返回保存的 Key。
   草稿中的新 Key 可写但不可从持久化读取；留空保留旧值，保存成功清空输入。
3. 保存校验插件身份、字段长度、URL/路径范围和配置 revision；主进程原子写入私密配置，
   不把真实凭据写入 manifest、市场资源或普通设置投影。
4. 表单容器持有 saved/draft/error/pending，报告 dirty/pending/ready 给宿主底栏；
   接口失败保留草稿，并发冲突不覆盖。宿主需在离开脏表单时确认。
5. 连接分别校验。主力和 ASR 不借用 Key/地址；不需要 ASR 的插件可移除整个 ASR 分组。
   检查环境不能调用付费模型，也不能把 Key、URL 凭据或环境变量写进错误。
6. 保存不自动重启会话。用户明确重启后加载配置；若配置影响计费，
   运行中的旧服务必须有 revision 检查，不能继续使用旧 Key 悄悄发送新请求。
   已被提供商接收的请求无法撤销计费。

字段组件没有自己的保存按钮，外层 `<form id={formId}>` 提交，底栏通过
`form={formId}` 关联。外层的异步实现以 `BvrConfigurationForm.tsx` 为参考，
不能用一个永远成功的模拟保存函数冒充接入。

最小公开接口形状可以是：

```ts
type PublicConfiguration = {
  revision: string;
  runtimeDirectory: string;
  main: { endpoint: string; model: string; hasKey: boolean };
  asr: { endpoint: string; model: string; hasKey: boolean };
  preferCaptions: boolean;
};
type SaveConfiguration = {
  revision: string;
  runtimeDirectory: string;
  main: { endpoint: string; model: string; newKey?: string };
  asr: { endpoint: string; model: string; newKey?: string };
  preferCaptions: boolean;
};
```

这不是现有通用 IPC 类型，只是新适配器的设计起点。
当前能运行的完整参考是 BVR 的 `bvrConfiguration` /
`bvrSaveConfiguration` / `bvrCheckEnvironment` / `bvrChoosePath` 四个窄接口。
