export interface TrayMenuState {
  language: 'zh' | 'en';
  theme: 'light' | 'dark';
  colors?: ReturnType<typeof import('./theme').resolveTheme>;
  visible: boolean;
  origin: 'top right' | 'bottom right';
}
export interface TrayMenuBridge {
  state(): TrayMenuState;
  action(action: 'open' | 'quit' | 'dismiss'): void;
  onState(listener: (state: TrayMenuState) => void): () => void;
}
