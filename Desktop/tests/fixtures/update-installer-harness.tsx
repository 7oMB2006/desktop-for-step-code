import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppUpdates } from '../../src/AppUpdates';
import type { AppUpdateState, DesktopBridge, Preferences, UpdateTransfer } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';

declare global {
  interface Window { updateHarness: { set: (patch: Partial<UpdateTransfer>) => void; downloads: number; installs: number; blocked: boolean } }
}
function Harness() {
  const [state, setState] = useState<AppUpdateState>({ currentVersion: '0.4.0', channel: 'preview', status: 'available',
    updateAvailable: true, transfer: { supported: true, status: 'idle' },
    release: { version: '0.5.0', tag: 'v0.5.0', name: 'Desktop for Step Code v0.5.0', prerelease: true,
      notes: '## 更新\n\n- 应用内下载与确认安装', url: 'https://github.com/7oMB2006/desktop-for-step-code/releases/tag/v0.5.0',
      installer: { name: 'Desktop.for.Step.Code.Setup.0.5.0.exe', size: 160 * 1024 ** 2, url: 'https://github.com/7oMB2006/desktop-for-step-code/releases/download/v0.5.0/Desktop.for.Step.Code.Setup.0.5.0.exe', inApp: true } } });
  const [preferences, setPreferences] = useState<Preferences>({ language: 'zh', theme: 'dark', workspaces: [] });
  const update = (patch: Partial<UpdateTransfer>) => setState(previous => ({ ...previous, transfer: { ...previous.transfer!, ...patch } }));
  window.updateHarness ??= { set: update, downloads: 0, installs: 0, blocked: true };
  window.updateHarness.set = update;
  const bridge = {
    checkUpdates: async () => state,
    openUpdate: async () => {},
    downloadUpdate: async () => { window.updateHarness.downloads++; update({ status: 'downloading', version: '0.5.0', percent: 42, transferred: 67.2 * 1024 ** 2, total: 160 * 1024 ** 2, bytesPerSecond: 3.8 * 1024 ** 2, error: undefined }); },
    cancelUpdateDownload: async () => update({ status: 'cancelled' }),
    installUpdate: async () => {
      if (window.updateHarness.blocked) update({ status: 'ready', error: 'busy' });
      else { window.updateHarness.installs++; update({ status: 'installing', error: undefined }); }
    },
  } as unknown as DesktopBridge;
  return <main className="test-update-settings"><h3>版本更新</h3>
    <AppUpdates bridge={bridge} state={state} preferences={preferences} onPreferences={async patch => { setPreferences(previous => ({ ...previous, ...patch })); }}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
