import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, FileDiff, Plus, Terminal, X } from 'lucide-react';
import { createPatch } from 'diff';
import { AppTooltip } from '../../src/AppTooltip';
import { TerminalPanel } from '../../src/TerminalPanel';
import { ReviewPanel } from '../../src/ReviewPanel';
import { ComposerInput } from '../../src/ComposerInput';
import { RightPanelHandle } from '../../src/RightPanelHandle';
import { normalizePanelPreferences, type PanelPreferences } from '../../src/panel-preferences';
import { parseToolPatch } from '../../src/turn-changes';
import { applyTheme, themes, type ThemeId } from '../../src/theme';
import type { DesktopBridge, Message, Preferences, TerminalEvent, TerminalSnapshot } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './terminal-diff-layout.css';

const storageKey = 'fixture:terminal-diff-layout';
let saved: Partial<PanelPreferences> = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); } catch {}
const initialPreferences = normalizePanelPreferences({ terminalDock: 'bottom', ...saved });
const params = new URLSearchParams(location.search);
const initialTheme = themes.find(theme => theme.id === params.get('theme'))?.id ?? 'paper';
const cwd = 'D:\\Projects\\step-workbench';
const before = `export async function loadStatus(client: Client) {
  const response = await client.get('/status');
  return response.data;
}

export function formatUsage(tokens: number) {
  return String(tokens);
}
`;
const after = `export async function loadStatus(client: Client) {
  const response = await client.get('/status', {
    timeout: 10_000,
  });
  return response.data ?? null;
}

export function formatUsage(tokens: number) {
  return new Intl.NumberFormat('zh-CN').format(tokens);
}
`;
const patch = createPatch('src/session-status.ts', before, after, '', '', { context: 3 });
const edit = parseToolPatch(patch, 'preview-edit')!;
const messages: Message[] = [
  { role: 'user', timestamp: Date.now() - 30000, content: '补上状态查询的超时，并让用量数字更好读。' },
  { role: 'assistant', timestamp: Date.now() - 20000, content: [{ type: 'toolCall', id: 'preview-edit', name: 'edit_file', arguments: { path: 'src/session-status.ts' } }] },
  { role: 'toolResult', timestamp: Date.now() - 10000, toolCallId: 'preview-edit', content: 'Updated', details: { patch } },
  { role: 'assistant', timestamp: Date.now() - 5000, content: '已补充查询超时和数字格式化，测试通过。' },
];
const listeners = new Set<(event: TerminalEvent) => void>();
const terminals: TerminalSnapshot[] = [{
  id: 'preview-terminal-1', cwd, title: 'PowerShell', status: 'running', cols: 100, rows: 15,
  chunks: [{ seq: 1, data: `\x1b[90mPowerShell · 预览\x1b[0m\r\nPS ${cwd}> corepack pnpm test\r\n\r\n\x1b[32m✓ session status\x1b[0m\r\n\x1b[32m✓ usage formatting\x1b[0m\r\n\r\nTests  19 passed\r\nPS ${cwd}> ` }],
}];
let nextTerminal = 1;
const append = (id: string, data: string) => {
  const terminal = terminals.find(item => item.id === id);
  if (!terminal) return;
  const seq = (terminal.chunks.at(-1)?.seq ?? 0) + 1;
  terminal.chunks.push({ seq, data });
  listeners.forEach(listener => listener({ type: 'data', id, seq, data }));
};
window.desktop = {
  platform: 'win32',
  preferences: async (patch: Partial<Preferences>) => {
    saved = normalizePanelPreferences({ ...initialPreferences, ...saved, ...patch });
    localStorage.setItem(storageKey, JSON.stringify(saved));
    return { theme: initialTheme, language: 'zh', workspaces: [cwd], ...saved };
  },
  terminalList: async () => structuredClone(terminals),
  terminalCreate: async () => {
    const terminal: TerminalSnapshot = { id: `preview-terminal-${++nextTerminal}`, cwd, title: `PowerShell ${nextTerminal}`,
      status: 'running', cols: 80, rows: 12, chunks: [{ seq: 1, data: `PowerShell · 预览\r\nPS ${cwd}> ` }] };
    terminals.push(terminal); return structuredClone(terminal);
  },
  terminalWrite: async (id: string, data: string) => {
    if (data.includes('\r')) append(id, `\r\n\x1b[90m预览未执行命令\x1b[0m\r\nPS ${cwd}> `);
    else if (data === '\x7f') append(id, '\b \b');
    else append(id, data);
  },
  terminalResize: async (id: string, cols: number, rows: number) => {
    const terminal = terminals.find(item => item.id === id);
    if (terminal) Object.assign(terminal, { cols, rows });
  },
  terminalAck: async () => {},
  terminalClose: async (id: string) => {
    const index = terminals.findIndex(item => item.id === id);
    if (index >= 0) terminals.splice(index, 1);
    listeners.forEach(listener => listener({ type: 'closed', id }));
  },
  onTerminalEvent: (listener: (event: TerminalEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  terminalPasteText: async () => '',
  copyText: async (text: string) => { await navigator.clipboard?.writeText(text); },
  rightPanelWidthMenu: async () => 'wide',
  repositoryDiff: async () => ({ state: 'ready', branch: 'feat/session-status', base: 'main', revision: '4ad87bf',
    added: edit.added, removed: edit.removed, files: [{ path: 'src/session-status.ts', status: 'M', added: edit.added, removed: edit.removed, binary: false }] }),
  repositoryFileDiff: async () => ({ path: 'src/session-status.ts', rows: edit.rows, added: edit.added, removed: edit.removed }),
  reviewMenu: async (_id: string | undefined, kind: string, value: string) => kind === 'source' ? value === 'turn' ? 'branch' : 'turn' : 'main',
} as unknown as DesktopBridge;

function Harness() {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [theme, setTheme] = useState<ThemeId>(initialTheme);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(true);
  const [expanded, setExpanded] = useState<'review' | 'terminal' | null>(null);
  const [width, setWidth] = useState<'standard' | 'wide'>('standard');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [narrow, setNarrow] = useState(innerWidth < 1050);
  const bottomHost = useRef<HTMLDivElement>(null);
  const rightHost = useRef<HTMLDivElement>(null);
  const bottom = preferences.terminalDock === 'bottom';
  const showingReview = reviewOpen && (bottom || !terminalOpen) && expanded !== 'terminal';
  useEffect(() => {
    const resize = () => setNarrow(innerWidth < 1050);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    applyTheme(theme, false);
    history.replaceState(null, '', `?theme=${theme}`);
  }, [theme]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.review-file-row')?.click());
    return () => cancelAnimationFrame(frame);
  }, []);
  const save = async (patch: Partial<PanelPreferences>) => {
    const next = await window.desktop!.preferences(patch);
    setPreferences(normalizePanelPreferences(next));
  };
  return <>
    <div className={`app panel-layout-preview sidebar-hidden${expanded ? ' inspector-expanded' : ''}${bottom && terminalOpen && !expanded ? ' has-bottom-terminal' : ''}`}>
      <header className="window-bar layout-preview-bar">
        <span>step-workbench</span><span className="layout-preview-divider">/</span><span>状态查询</span>
        <label>主题<select aria-label="主题" value={theme} onChange={event => setTheme(event.target.value as ThemeId)}>
          {themes.map(item => <option value={item.id} key={item.id}>{item.title[0]}</option>)}
        </select></label>
      </header>
      <main>
        <div className="main-content" inert={Boolean(expanded)}>
          <div className="conversation-shell"><div className="conversation">
            <div className="messages">
              <article className="message user"><div className="message-body"><p>补上状态查询的超时，并让用量数字更好读。</p></div></article>
              <article className="message assistant"><div className="message-body">
                <p>这两处已经处理好了：</p>
                <ul><li>状态查询增加 10 秒超时，空响应返回 <code>null</code>。</li><li>Token 用量使用本地化数字格式，较大的数值也能直接读清。</li></ul>
                <p>相关测试已通过。</p>
                <pre><code>Tests  19 passed{'\n'}Files   4 passed</code></pre>
              </div></article>
            </div>
          </div></div>
          <div className="composer-wrap">
            <div className="composer"><ComposerInput label="消息" language="zh" placeholder="继续这个任务…" value={draft} onChange={setDraft} onKeyDown={() => {}} disabled={false} onPaste={() => {}}/>
              <div className="composer-tools">
                <button className="icon-button" aria-label="添加附件" disabled><Plus size={17}/></button>
                <span className="layout-preview-permission">Ask</span><div className="spacer"/><span className="layout-preview-model">Step 3.5 Flash</span>
                <button className="icon-button composer-action-button" aria-label="发送" disabled={!draft} onClick={() => setDraft('')}><ArrowUp size={16}/></button>
              </div>
            </div>
            <div className="layout-preview-metrics">12.4s<span>38.2 tok/s</span><span>1.2k / 486</span><span>缓存命中 72%</span></div>
          </div>
          <div ref={bottomHost} className="terminal-bottom-slot"/>
        </div>
      </main>
      <ReviewPanel open={showingReview} replaced={terminalOpen && !bottom} overlay={narrow}
        runtimeId="layout-preview" messages={messages} busy={false} language="zh" expanded={expanded === 'review'}
        layout={preferences.diffLayout} onLayoutChange={diffLayout => void save({ diffLayout })}
        onToggleExpanded={() => setExpanded(value => value === 'review' ? null : 'review')}
        onClose={() => { setReviewOpen(false); setExpanded(null); }} onError={setError}/>
      <div ref={rightHost} className="terminal-right-slot"/>
      <TerminalPanel open={terminalOpen && (expanded !== 'review')} replaced={false} overlay={narrow}
        expanded={expanded === 'terminal'} onToggleExpanded={() => setExpanded(value => value === 'terminal' ? null : 'terminal')}
        runtimeId="layout-preview" cwd={cwd} language="zh" width={width} onWidthChange={setWidth}
        dock={preferences.terminalDock} onDockChange={terminalDock => { setExpanded(null); void save({ terminalDock }); }}
        height={preferences.terminalHeight} onHeightChange={terminalHeight => void save({ terminalHeight })}
        bottomHost={bottomHost} rightHost={rightHost}
        onClose={() => { setTerminalOpen(false); setExpanded(null); }} onError={setError}/>
      {showingReview && !expanded && <RightPanelHandle panel="review" value="standard" standard={500} wide={false} language="zh"
        onChange={value => setExpanded(value === 'fullscreen' ? 'review' : null)} onClose={() => setReviewOpen(false)} onBlocked={() => {}}/>}
      <nav className="right-tool-rail" aria-label="右侧工具">
        <button className="icon-button" aria-label="变更" data-tooltip="变更" data-tooltip-side="left" aria-pressed={showingReview}
          onClick={() => { setExpanded(null); if (!bottom) setTerminalOpen(false); setReviewOpen(value => !showingReview || !value); }}><FileDiff size={18}/></button>
        <button className="icon-button" aria-label="终端" data-tooltip="终端" data-tooltip-side="left" aria-pressed={terminalOpen}
          onClick={() => { setExpanded(null); setTerminalOpen(value => !value); }}><Terminal size={18}/></button>
      </nav>
    </div>
    {error && <div className="layout-preview-error" role="alert">{error}<button className="icon-button" aria-label="关闭" onClick={() => setError('')}><X size={14}/></button></div>}
    <AppTooltip/>
  </>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
