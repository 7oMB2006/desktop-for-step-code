import type { AppUpdateState } from './contracts';

export function updatePlatform(platform: string, source: AppUpdateState['source'], language: string) {
  const zh = language === 'zh';
  const windows = platform === 'win32';
  const label = windows ? 'Windows x64' : platform === 'linux' ? 'Linux x64'
    : platform === 'darwin' ? 'macOS' : zh ? '当前平台' : 'Current platform';
  const missingPackage = windows
    ? source === 'release-feed'
      ? zh ? '请在发布页核对 Windows x64 安装包。' : 'Check the releases page for a Windows x64 installer.'
      : zh ? '此版本暂未提供 Windows x64 安装包。' : 'This release has no Windows x64 installer yet.'
    : platform === 'linux'
      ? zh ? '当前更新源只提供 Windows 安装包；Linux 预览版请查看发布说明。'
        : 'The update feed currently provides Windows installers. For the Linux preview, view the release notes.'
      : zh ? '当前更新源尚不支持此平台的安装包，请查看发布说明。'
        : 'The update feed does not support installers for this platform. View the release notes.';
  return { label, supportsInstaller: windows, missingPackage };
}
