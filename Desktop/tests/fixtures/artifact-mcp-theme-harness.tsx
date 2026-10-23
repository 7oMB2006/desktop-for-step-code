import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RotateCcw } from 'lucide-react';
import { ArtifactContext, TurnArtifacts } from '../../src/TurnArtifacts';
import { FileOpeningContext } from '../../src/FileOpening';
import { SummaryBoard } from '../../src/SummaryBoard';
import { applyTheme, normalizeAccent, themes } from '../../src/theme';
import type { ThemeId } from '../../src/theme';
import type { DesktopBridge, FileTarget, SessionSummary } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './artifact-mcp-theme.css';

const params = new URLSearchParams(location.search);
const initialTheme = themes.find(item => item.id === params.get('theme'))?.id ?? 'paper';
const summary: SessionSummary = {
  sessionId: 'theme-preview', tasks: [], skillCount: 3,
  mcp: [
    { name: 'steppage__steppage', status: 'connected', toolCount: 13 },
    { name: 'bilibili_video_research', status: 'connected', toolCount: 4 },
    { name: 'scrapling', status: 'connected', toolCount: 8 },
    { name: 'local-tools', status: 'disabled', toolCount: 0 },
  ],
};
window.desktop = {
  platform: 'win32',
  summary: async () => summary,
  repositoryDiff: async () => ({ state: 'not-repository', files: [] }),
  artifactFiles: async (_runtimeId: string, paths: string[]) => paths.map(path => ({ path, exists: true, canOpen: true, kind: 'document', size: 2048 })),
  artifactAction: async () => {},
  fileOpenOptions: async () => ({ choices: [{ id: 'internal', label: '文件预览' }], selected: 'internal' }),
} as unknown as DesktopBridge;

function Harness() {
  const [theme, setTheme] = useState<ThemeId>(initialTheme);
  const [accent, setAccent] = useState<string | undefined>(normalizeAccent(params.get('accent')));
  const [status, setStatus] = useState('');
  useEffect(() => {
    applyTheme(theme, false, accent);
    const query = new URLSearchParams({ theme });
    if (accent) query.set('accent', accent);
    history.replaceState(null, '', `?${query}`);
  }, [theme, accent]);
  const openFile = async (target?: FileTarget) => { setStatus(target && 'path' in target ? target.path : ''); };
  return <div className="surface-theme-preview">
    <header className="surface-theme-controls">
      <label>主题<select aria-label="主题" value={theme} onChange={event => setTheme(event.target.value as ThemeId)}>
        {themes.map(item => <option value={item.id} key={item.id}>{item.title[0]}</option>)}
      </select></label>
      <label>强调色<input type="color" aria-label="强调色" value={accent ?? themes.find(item => item.id === theme)!.accent} onChange={event => setAccent(event.target.value)}/></label>
      <button className="icon-button" aria-label="恢复主题强调色" title="恢复主题强调色" onClick={() => setAccent(undefined)}><RotateCcw size={16}/></button>
    </header>
    <div className="surface-theme-layout">
      <section className="surface-theme-conversation" aria-label="会话">
        <div className="surface-theme-user">整理工具演示记录，附上交付文件。</div>
        <article className="message assistant">
          <div className="message-body">
            <p>工具演示记录已整理完成，包含执行结果与验证说明。</p>
            <ul><li>常规工具与并行代理的结果已归档。</li><li>补充了错误记录及后续检查项。</li></ul>
          </div>
          <FileOpeningContext.Provider value={{ openFile, openWeb: async url => setStatus(url), onError: setStatus }}>
            <ArtifactContext.Provider value={{ runtimeId: 'theme-preview', onError: setStatus }}>
              <TurnArtifacts language="zh" text="" outputPaths={['tool-state-demo-round6.md', 'tool-state-demo.md']}/>
            </ArtifactContext.Provider>
          </FileOpeningContext.Provider>
          {status && <p className="surface-theme-status" role="status">{status}</p>}
        </article>
      </section>
      <aside className="summary-board" aria-label="摘要">
        <SummaryBoard runtimeId="theme-preview" sessionId="theme-preview" language="zh" messages={[]} onOpenChanges={() => {}}/>
      </aside>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
