export interface BvrConfiguration {
  revision: string;
  configured: boolean;
  mode: 'dfsc' | 'independent';
  runtimeDirectory: string;
  apiBase: string;
  model: string;
  hasApiKey: boolean;
  asrApiBase: string;
  asrModel: string;
  hasAsrApiKey: boolean;
  cookieFile: string;
  proxy: string;
  downloadDirectory: string;
  preferCaptions: boolean;
  legacyProvider?: string;
}

export type BvrConfigurationInput = Pick<BvrConfiguration,
  'revision' | 'mode' | 'runtimeDirectory' | 'apiBase' | 'model' | 'asrApiBase'
  | 'asrModel' | 'cookieFile' | 'proxy' | 'downloadDirectory' | 'preferCaptions'> & {
  apiKey?: string;
  asrApiKey?: string;
};
export type BvrPathKind = 'runtime' | 'cookie' | 'download';
export interface BvrEnvironmentCheck { node: string; dependencies: boolean; independentConnections: boolean }

export function bvrSettingsError(error: unknown, language: string) {
  const code = /bvr:([a-z-]+)/u.exec(error instanceof Error ? error.message : String(error))?.[1];
  const messages: Record<string, [string, string]> = {
    'busy': ['其他设置操作尚未完成，请稍后重试。', 'Another settings operation is in progress. Try again shortly.'],
    'invalid-input': ['配置格式无效，请检查路径、地址与模型名称。', 'Check the paths, addresses and model names.'],
    'invalid-endpoint': ['请填写阶跃官方 API 或 Plan 的完整接口地址，两组连接分别设置。', 'Enter an official Step API or Plan endpoint for each connection.'],
    'missing-key': ['请分别填写主力模型和 ASR 的 API Key，不会互相借用。', 'Provide separate main-model and ASR keys. Neither connection inherits the other key.'],
    'stale': ['配置已被其他操作更改。请先刷新，再重新编辑。', 'The configuration changed elsewhere. Refresh before editing again.'],
    'storage': ['无法读取或保存 BVR 配置，请检查目录权限。', 'Could not read or save BVR configuration. Check directory permissions.'],
    'runtime': ['运行目录或依赖不完整，请选择已完成 npm ci 的 BVR 项目目录。', 'Choose a BVR checkout with npm ci completed.'],
    'runtime-upgrade': ['此 BVR 版本尚不支持独立 ASR 配置，请先更新 BVR 运行目录。', 'Update the BVR runtime to support separate ASR configuration.'],
    'legacy-provider': ['当前配置包含此表单尚不支持的供应商或连接设置，请在原配置中管理，未覆盖已有设置。', 'This configuration contains unsupported provider or connection settings. Manage the original configuration; nothing was overwritten.'],
    'not-installed': ['请先安装 Bilibili Video Research 插件。', 'Install the Bilibili Video Research plugin first.'],
  };
  return messages[code ?? '']?.[language === 'zh' ? 0 : 1]
    ?? (language === 'zh' ? '操作未完成，请稍后重试。' : 'The operation did not complete. Try again.');
}
