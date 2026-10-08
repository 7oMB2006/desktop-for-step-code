import { contextBridge, ipcRenderer } from 'electron';
import type { TrayMenuBridge, TrayMenuState } from '../src/tray-menu-contract';

const bridge: TrayMenuBridge = {
  state: () => ipcRenderer.sendSync('tray-menu:state'),
  action: action => ipcRenderer.send('tray-menu:action', action),
  onState: listener => {
    const receive = (_event: Electron.IpcRendererEvent, state: TrayMenuState) => listener(state);
    ipcRenderer.on('tray-menu:changed', receive);
    return () => ipcRenderer.removeListener('tray-menu:changed', receive);
  },
};
contextBridge.exposeInMainWorld('desktopTray', bridge);
