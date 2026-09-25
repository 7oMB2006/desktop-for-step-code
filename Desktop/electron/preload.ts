import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/contracts';
const invoke = (method: string, ...args: unknown[]) => ipcRenderer.invoke('desktop', method, ...args);
const bridge: DesktopBridge = {
  windowControl: action => invoke('windowControl', action),
  newIndependentSession: () => invoke('newIndependentSession'), openSessionFolder: () => invoke('openSessionFolder'),
  snapshot: () => invoke('snapshot'), chooseWorkspace: () => invoke('chooseWorkspace'), workspace: path => invoke('workspace', path),
  command: (type, args) => invoke('command', type, args), sessions: () => invoke('sessions'), switchSession: id => invoke('switchSession', id),
  deleteSession: id => invoke('deleteSession', id), restart: () => invoke('restart'), settings: () => invoke('settings'),
  login: (profile, key) => invoke('login', profile, key), cancelLogin: () => invoke('cancelLogin'), logout: () => invoke('logout'),
  saveMcp: (name, config, secrets) => invoke('saveMcp', name, config, secrets), preferences: patch => invoke('preferences', patch),
  images: () => invoke('images'), diagnostics: () => invoke('diagnostics'),
  onEvent: callback => { const handler = (_: unknown, event: any) => callback(event); ipcRenderer.on('runtime-event', handler); return () => ipcRenderer.removeListener('runtime-event', handler); },
};
contextBridge.exposeInMainWorld('desktop', bridge);
