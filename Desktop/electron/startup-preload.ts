import { contextBridge, ipcRenderer } from 'electron';
import type { StartupCommand, StartupRecoveryState } from '../src/startup-recovery-contract';

// This window gets no desktop operations, filesystem access or diagnostic logs.
contextBridge.exposeInMainWorld('startupRecovery', {
  command: (command: StartupCommand) => {
    if (['ready', 'continue', 'retry', 'close'].includes(command)) ipcRenderer.send('startup:command', command);
  },
  subscribe: (listener: (state: StartupRecoveryState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: StartupRecoveryState) => listener(state);
    ipcRenderer.on('startup:state', handler);
    ipcRenderer.send('startup:command', 'ready');
    return () => ipcRenderer.removeListener('startup:state', handler);
  },
});
