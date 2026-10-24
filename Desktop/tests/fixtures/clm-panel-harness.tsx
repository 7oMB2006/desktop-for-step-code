import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createTwoFilesPatch } from 'diff';
import { ContextPanel } from '../../src/ContextPanel';
import type { DesktopBridge, Snapshot } from '../../src/contracts';
import type { ClmSnapshot } from '../../src/clm';
import type { RightPanelWidth } from '../../src/RightPanelWidthControl';
import { applyTheme } from '../../src/theme';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
applyTheme(params.get('theme') === 'dark' ? 'original-dark' : 'original-light', params.get('theme') === 'dark');
let enabled = true;
let calls = 0;
const revisions: ClmSnapshot['revisions'] = Array.from({ length: 24 }, (_, index) => ({
  entryId: `entry-${index}`, revision: index + 4, timestamp: new Date(2026, 9, 24, 10, index * 3).toISOString(), kind: 'edit',
}));
window.desktop = {
  clm: async (_runtime: string, entryId?: string) => {
    await new Promise(resolve => setTimeout(resolve, 30));
    const selected = revisions.find(item => item.entryId === entryId) ?? revisions.at(-1)!;
    const before = '[[CTX_TURN document=fixture index=1 role=notes id=account protected=false]]\n# 账户服务调查\n\naccount-service.ts 负责余额查询，auth.ts 负责登录。\n切换身份与响应做过一致性检查，需要按生效账户校验返回值。\n';
    const after = '[[CTX_TURN document=fixture index=1 role=notes id=account protected=false]]\n# 账户服务调查\n\n余额查询绑定生效账户；登录与查询入口分别为 auth.ts、account-service.ts。\n过期身份的响应必须丢弃，避免覆盖切换后的账户。\n';
    return {
      sessionId: 'fixture', leafId: 'leaf', enabled, revision: 27, tokens: 42600, total: revisions.length, revisions,
      selected: { entryId: selected.entryId, truncated: false, diffTruncated: false, diff: createTwoFilesPatch('LIVE_CONTEXT.md', 'LIVE_CONTEXT.md', before, after),
        blocks: [{ id: 'ctx-user', role: 'user', protected: true, text: '保留套餐查询要求；账户切换不得改变计费路径。', truncated: false },
          { id: 'ctx-assistant', role: 'assistant', protected: false, text: `修订 r${selected.revision}：已核对账户隔离。剩余测试包含超时与认证失效。`, truncated: false }] },
    };
  },
  clmAction: async (_runtime: string, _session: string, action: string) => {
    calls++;
    if (action !== 'compact') enabled = action === 'on';
    await new Promise(resolve => setTimeout(resolve, 120));
  },
  command: async () => {},
} as unknown as DesktopBridge;
function App() {
  const [view, setView] = useState<'context' | 'status' | 'clm'>('clm');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState<RightPanelWidth>('standard');
  const snapshot: Snapshot = { status: 'ready', runtimeId: 'fixture-runtime',
    state: { sessionId: 'fixture', isStreaming: busy }, messages: [], models: [], sessions: [],
    preferences: { language, theme: 'light', workspaces: [] } };
  return <div style={{ height: '100dvh', width: width === 'fullscreen' ? '100%' : width === 'wide' ? 680 : 380, maxWidth: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', gap: 12, padding: 8 }}>
      <button onClick={() => setBusy(value => !value)}>{busy ? '停止模拟任务' : '模拟任务运行'}</button>
      <button onClick={() => setRevision(value => value + 1)}>刷新验收</button><output aria-label="操作次数">{calls}</output>
    </div><ContextPanel snapshot={snapshot} view={view} onView={setView} runtimeRevision={revision}
      messages={[]} title="CLM" language={language} busy={busy} connected expanded={width === 'fullscreen'} onToggleExpanded={() => setWidth(width === 'fullscreen' ? 'standard' : 'fullscreen')} onClose={() => {}}
      width={width === 'fullscreen' ? 'standard' : width} onWidthChange={setWidth}
      onRefresh={async () => setRevision(value => value + 1)} onError={() => {}}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
