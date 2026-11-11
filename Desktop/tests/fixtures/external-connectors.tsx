import { createRoot } from 'react-dom/client';
import { RemoteAccessPanel } from '../../src/RemoteAccessPanel';
import type { DesktopBridge } from '../../src/contracts';
import type { ExternalConnectorAction, ExternalConnectorState } from '../../src/external-connectors';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
let fail = false, release: (() => void) | undefined, hold = false;
const workspace = 'C:\\Projects\\practice';
let state: ExternalConnectorState = {
  enabled: false, listening: false, connections: [],
  projects: params.has('empty') ? [] : [{ workspace, name: 'Practice project' }],
};
declare global {
  interface Window {
    externalFixture: { failNext(): void; holdNext(): void; release(): void; copied: string };
  }
}
window.externalFixture = {
  failNext: () => { fail = true; }, holdNext: () => { hold = true; },
  release: () => release?.(), copied: '',
};
const bridge = {
  remoteState: async () => ({ revision: 1, status: 'idle', approvalReady: false, sessions: [], projects: [] }),
  onEvent: () => () => {},
  copyText: async (text: string) => { window.externalFixture.copied = text; },
  externalConnectorState: async () => structuredClone(state),
  externalConnectorAction: async (action: ExternalConnectorAction) => {
    if (hold) { hold = false; await new Promise<void>(accept => { release = accept; }); }
    if (fail) { fail = false; throw new Error('Controlled fixture failure'); }
    if (action.type === 'enable') state = { ...state, enabled: true, listening: true };
    if (action.type === 'disable') state = { ...state, enabled: false, listening: false };
    if (action.type === 'pair') state = { ...state, connections: [{
      agentId: 'fixture-agent', displayName: action.displayName, roots: action.roots,
      configPath: 'C:\\Users\\Fixture\\AppData\\Roaming\\Desktop for Step Code\\external-connectors\\agents\\fixture-agent\\config.json',
    }] };
    if (action.type === 'revoke') state = { ...state, connections: [] };
    return structuredClone(state);
  },
} as unknown as DesktopBridge;
createRoot(document.getElementById('root')!).render(<div style={{ display: 'flex', height: '100dvh', minWidth: 0 }}>
  <RemoteAccessPanel bridge={bridge} language={params.get('lang') === 'en' ? 'en' : 'zh'} onBack={() => {}}/>
</div>);
