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
const taskId = '12345678-1234-1234-1234-123456789abc';
if (params.has('plugins')) state.plugins = [{ id: 'fixture-bridge',
  ref: '12345678-1234-1234-1234-123456789abc', name: 'Hermes x DFSC' }];
if (params.has('plugin-unavailable')) state.pluginDiscoveryUnavailable = true;
if (params.has('tasks')) state = { ...state, enabled: true, listening: true, connections: [{
  agentId: 'fixture-agent', displayName: 'Hermes x DFSC', roots: [workspace], configPath: 'C:\\Fixture\\config.json',
}], approvals: { tasks: [{ taskId, agentId: 'fixture-agent', title: 'Inspect a project and run its tests',
  cwd: workspace, phase: 'running', pending: 1 }], audit: [] } };
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
      ...(action.pluginRef ? { plugin: { id: 'fixture-bridge' } } : {}),
    }] };
    if (action.type === 'bind-plugin') state.connections = state.connections.map(connection =>
      connection.agentId === action.agentId ? { ...connection, plugin: { id: 'fixture-bridge' } } : connection);
    if (action.type === 'revoke') state = { ...state, connections: [] };
    if (action.type === 'delegate' && state.approvals) {
      state.approvals.tasks[0].delegation = { categories: action.categories, expiresAt: action.minutes ? Date.now() + action.minutes * 60000 : null };
      state.approvals.audit.unshift({ taskId, agentId: 'fixture-agent', at: Date.now(), action: 'grant',
        reason: 'Local user selected scope and duration', outcome: 'applied' });
    }
    if (action.type === 'undelegate' && state.approvals) {
      delete state.approvals.tasks[0].delegation;
      state.approvals.audit.unshift({ taskId, agentId: 'fixture-agent', at: Date.now(), action: 'revoke',
        reason: 'local-user', outcome: 'applied' });
    }
    if (action.type === 'policy' && state.approvals) {
      state.approvals.policies = [{ id: taskId, agentId: action.agentId, cwd: action.cwd, createdAt: Date.now(),
        expiresAt: action.days === null ? null : Date.now() + action.days * 86400000,
        permissionPreset: action.permissionPreset, categories: action.categories }];
    }
    if (action.type === 'unpolicy' && state.approvals) state.approvals.policies = [];
    return structuredClone(state);
  },
} as unknown as DesktopBridge;
createRoot(document.getElementById('root')!).render(<div style={{ display: 'flex', height: '100dvh', minWidth: 0 }}>
  <RemoteAccessPanel bridge={bridge} language={params.get('lang') === 'en' ? 'en' : 'zh'} onBack={() => {}}/>
</div>);
