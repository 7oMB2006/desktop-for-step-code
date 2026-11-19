export type AppShortcut = 'sidebar' | 'new-session' | 'open-project' | 'settings' | 'search' | 'terminal';
export function appShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing' | 'keyCode' | 'defaultPrevented'>,
  platform?: string): AppShortcut | undefined {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.altKey) return;
  if (platform === 'darwin' ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 'f' ? 'search' : undefined;
  const actions: Partial<Record<string, AppShortcut>> = { b: 'sidebar', n: 'new-session', o: 'open-project', ',': 'settings', j: 'terminal' };
  return actions[key];
}
export function shortcutLabel(action: AppShortcut, platform?: string) {
  const key = { sidebar: 'B', 'new-session': 'N', 'open-project': 'O', settings: ',', search: 'Shift+F', terminal: 'J' }[action];
  return `${platform === 'darwin' ? 'Cmd' : 'Ctrl'}+${key}`;
}
