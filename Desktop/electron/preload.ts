import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopBridge, DesktopTheme } from '../src/contracts';

// The main process owns the resolved theme. Asking synchronously here, while the
// preload runs before every page script, is what makes the first frame correct:
// the inline bootstrap in index.html reads window.desktopTheme.resolved before
// the React module executes. The renderer cannot resolve the system value
// itself, because prefers-color-scheme stays light in this packaged renderer.
let resolvedTheme: { theme: 'light' | 'dark'; systemDark: boolean } = { theme: 'light', systemDark: false };
try {
  const answer = ipcRenderer.sendSync('desktop:resolved-theme');
  if (answer?.theme === 'dark' || answer?.theme === 'light') resolvedTheme = { theme: answer.theme, systemDark: Boolean(answer.systemDark) };
} catch (error) {
  resolvedTheme = { theme: 'light', systemDark: false };
}

// Records the first data-theme write in document order. This observer is
// installed before any page script runs, so the value it captures is the inline
// bootstrap's write, never the React effect; readyState stays 'loading' then.
const firstFrame: { theme?: string; readyState: string } = { readyState: '' };
new MutationObserver(() => {
  if (firstFrame.theme) return;
  const value = document.documentElement?.getAttribute('data-theme');
  if (!value) return;
  firstFrame.theme = value;
  firstFrame.readyState = document.readyState;
}).observe(document, { attributes: true, attributeFilter: ['data-theme'], subtree: true });

const invoke = (method: string, ...args: unknown[]) => ipcRenderer.invoke('desktop', method, ...args);
const bridge: DesktopBridge = {
  windowControl: action => invoke('windowControl', action),
  systemTheme: () => ipcRenderer.invoke('desktop-system-theme'),
  newIndependentSession: () => invoke('newIndependentSession'), openSessionFolder: () => invoke('openSessionFolder'), openWorkspaceFolder: path => invoke('openWorkspaceFolder', path),
  snapshot: () => invoke('snapshot'), chooseWorkspace: () => invoke('chooseWorkspace'), workspace: path => invoke('workspace', path),
  command: (type, args) => invoke('command', type, args), sessions: () => invoke('sessions'), switchSession: id => invoke('switchSession', id),
  deleteSession: id => invoke('deleteSession', id), restart: () => invoke('restart'), settings: () => invoke('settings'),
  login: (profile, key) => invoke('login', profile, key), cancelLogin: () => invoke('cancelLogin'), logout: () => invoke('logout'),
  saveMcp: (name, config, secrets) => invoke('saveMcp', name, config, secrets), preferences: patch => invoke('preferences', patch),
  images: () => invoke('images'), diagnostics: () => invoke('diagnostics'),
  chooseAttachments: () => invoke('chooseAttachments'),
  importFile: file => {
    const path = webUtils.getPathForFile(file);
    if (!path) return Promise.reject(new Error('This file has no local path'));
    return invoke('importFile', path);
  },
  importClipboardImage: (data, mimeType, name) => invoke('importClipboardImage', data, mimeType, name),
  imageAction: (action, src, name) => invoke('imageAction', action, src, name),
  copyText: text => invoke('copyText', text),
  onEvent: callback => { const handler = (_: unknown, event: any) => callback(event); ipcRenderer.on('runtime-event', handler); return () => ipcRenderer.removeListener('runtime-event', handler); },
};
contextBridge.exposeInMainWorld('desktop', bridge);
const theme: DesktopTheme = {
  resolved: resolvedTheme.theme,
  systemDark: resolvedTheme.systemDark,
  firstFrame: () => ({ ...firstFrame }),
};
contextBridge.exposeInMainWorld('desktopTheme', theme);
