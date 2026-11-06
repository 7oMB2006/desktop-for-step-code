import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationMessages } from '../../src/ConversationMessages';
import { SummaryBoard } from '../../src/SummaryBoard';
import { selectInterfacePreset } from '../../src/interface-presets';
import { applyAppearance, defaultAppearance } from '../../src/appearance';
import { applyTheme } from '../../src/theme';
import type { DesktopBridge, Message, SessionSummary } from '../../src/contracts';
import type { CapabilityCatalog, CapabilityMutation } from '../../src/capabilities';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/appearance.css';
import '../../src/theme.css';
import './disclosure-summary.css';

applyTheme(new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark', false);
applyAppearance(defaultAppearance);
const input = '/bvr \u8fd9\u662f\u4ec0\u4e48';
const body = "Use the bilibili-video-research skill and this plugin's BVR MCP to address:\n\n\u8fd9\u662f\u4ec0\u4e48\n\nBVR_INTERNAL_TEMPLATE_SENTINEL";
const message: Message = { role: 'user', entryId: 'input', timestamp: Date.now(), content: body, desktopInput: { version: 1, text: input } };
const names = ['bilibili_video_research', 'bilibili-video-research__bvr'];
let servers: SessionSummary['mcp'] = names.map(name => ({ name, status: 'connected', toolCount: 3 }));
let catalog: CapabilityCatalog = { plugins: [], available: [], marketplaces: [], skills: [], warnings: [],
  mcp: names.map((name, index) => ({ name, source: index ? 'plugin' : 'user', enabled: true, configurable: true, transport: 'stdio' })) };
const calls: CapabilityMutation[] = [];
let failMutation = false;
let failRestart = false;
let restartCalls = 0;
let copied = '';
window.desktop = {
  copyText: async (text: string) => { copied = text; },
  summary: async () => ({ sessionId: 'fixture', tasks: [], mcp: servers, skillCount: 1 }),
  repositoryDiff: async () => ({ state: 'not-repository', files: [] }),
  capabilityCatalog: async () => structuredClone(catalog),
  capabilityMutate: async (input: CapabilityMutation) => {
    calls.push(input);
    await new Promise(resolve => setTimeout(resolve, 160));
    if (failMutation) throw new Error('capability:busy');
    if (input.action === 'mcp-toggle') catalog = { ...catalog, mcp: catalog.mcp.map(server => server.name === input.name ? { ...server, enabled: input.enabled } : server) };
    return { warnings: [] };
  },
} as unknown as DesktopBridge;

function Harness() {
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState('');
  const [messages, setMessages] = useState<Message[]>([message]);
  Object.assign(window, { pluginInputMcpFixture: {
    calls, input, body, busy: setBusy,
    failMutation: (value: boolean) => { failMutation = value; },
    failRestart: (value: boolean) => { failRestart = value; },
    theme: (value: 'light' | 'dark') => applyTheme(value, false),
    externalToggle: (name: string, enabled: boolean) => {
      catalog = { ...catalog, mcp: catalog.mcp.map(server => server.name === name ? { ...server, enabled } : server) };
      setRevision(value => value + 1);
    },
    restartCalls: () => restartCalls,
    copied: () => copied,
    reload: () => { setMessages(JSON.parse(JSON.stringify([message]))); setKey(value => value + 1); },
  } });
  return <div className="disclosure-fixture"><div className="disclosure-fixture-layout">
    <div className="messages">
      <ConversationMessages messages={messages} language="zh" busy={busy} canEdit={true}
        interfaceSettings={selectInterfacePreset('standard')} openImage={() => {}} edit={async (_id, text) => { setEdit(text); }}
        branch={() => {}} onOpenSubagent={() => {}} onError={setEdit}/>
      {edit && <output aria-label="edited-input">{edit}</output>}
    </div>
    <aside className="summary-board" aria-label="Summary">
      <SummaryBoard key={key} runtimeId="fixture" sessionId="fixture" language="zh" messages={messages} busy={busy}
        capabilityRevision={revision} onMcpChanged={async () => { setRevision(value => value + 1); }}
        onRestart={async () => {
          restartCalls++;
          if (failRestart) throw new Error('Scheduled host protected');
          servers = servers.map(server => ({ ...server, status: catalog.mcp.find(item => item.name === server.name)?.enabled ? 'connected' : 'disabled' }));
          setKey(value => value + 1);
        }} onOpenChanges={() => {}}/>
    </aside>
  </div></div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
