import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardPaste, Copy, Eraser, Plus, X } from 'lucide-react';
import type { TerminalInfo, TerminalSnapshot } from './contracts';
import { RightPanelExpandButton } from './RightPanelExpandButton';
import '@xterm/xterm/css/xterm.css';
import './terminal-panel.css';

type Chunk = { seq: number; data: string };
type Controller = { terminal: Terminal; fit: FitAddon; element: HTMLDivElement; seq: number; info: TerminalInfo; hydrated: boolean; pending: Chunk[] };
const directoryKey = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function TerminalPanel({ open, replaced, overlay, expanded, runtimeId, cwd, language, onClose, onToggleExpanded, onError }: {
  open: boolean; replaced: boolean; overlay: boolean; expanded: boolean; runtimeId?: string; cwd?: string;
  language: 'zh' | 'en'; onClose: () => void; onToggleExpanded: () => void; onError: (error: string) => void;
}) {
  const controllers = useRef(new Map<string, Controller>());
  const loaded = useRef(new Set<string>());
  const loading = useRef(new Set<string>());
  const creating = useRef(new Set<string>());
  const closed = useRef(new Set<string>());
  const orphanChunks = useRef(new Map<string, Chunk[]>());
  const host = useRef<HTMLDivElement>(null);
  const [infos, setInfos] = useState<TerminalInfo[]>([]);
  const [active, setActive] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [present, setPresent] = useState(open);
  const latest = useRef({ language, onError });
  latest.current = { language, onError };
  const scope = directoryKey(cwd ?? '');
  const tabs = infos.filter(info => directoryKey(info.cwd) === scope);
  const selected = tabs.find(info => info.id === active[scope]) ?? tabs[0];
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  if (open && !present) setPresent(true);
  const report = () => latest.current.onError(latest.current.language === 'zh' ? '终端操作失败，请重试' : 'Terminal operation failed. Please retry.');
  const sync = () => setInfos([...controllers.current.values()].map(controller => controller.info));
  const theme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    const style = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return { background: color('--bg', '#ffffff'), foreground: color('--ink', '#202124'),
      cursor: color('--ink', '#202124'), selectionBackground: '#7186aa55',
      black: dark ? '#8d949e' : '#30343a', red: dark ? '#e97883' : '#b73f50', green: dark ? '#70bf95' : '#287751',
      yellow: dark ? '#d7b259' : '#8d661c', blue: dark ? '#88aceb' : '#3b64a8', magenta: dark ? '#c69ce0' : '#8752a5',
      cyan: dark ? '#69bfd0' : '#26788a', white: dark ? '#e4e7eb' : '#38424c',
      brightBlack: dark ? '#a5aab3' : '#65707a', brightRed: dark ? '#ee6f79' : '#bc3949',
      brightGreen: dark ? '#68bd94' : '#287751', brightYellow: dark ? '#dfba61' : '#96651b',
      brightBlue: dark ? '#99b9ee' : '#3b64a8', brightMagenta: dark ? '#cfa6e4' : '#8752a5',
      brightCyan: dark ? '#77c8d8' : '#26788a', brightWhite: dark ? '#fafbfc' : '#282e36' };
  };
  const copy = async (controller?: Controller) => {
    const text = controller?.terminal.getSelection();
    if (text) try { await window.desktop?.copyText(text); } catch { report(); }
  };
  const paste = async (controller?: Controller) => {
    if (!controller || controller.info.status !== 'running') return;
    try {
      const text = await window.desktop?.terminalPasteText();
      if (text !== undefined && controllers.current.get(controller.info.id) === controller) {
        controller.terminal.paste(text);
        controller.terminal.focus();
      }
    } catch { report(); }
  };
  const ensure = (info: TerminalInfo) => {
    let controller = controllers.current.get(info.id);
    if (controller) {
      controller.info = info;
      controller.terminal.options.cursorBlink = info.status === 'running';
      return controller;
    }
    const terminal = new Terminal({ fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: 13,
      lineHeight: 1.25, scrollback: 5000, screenReaderMode: true, theme: theme(), cursorBlink: info.status === 'running',
      cols: info.cols, rows: info.rows });
    terminal.options.linkHandler = { activate: () => {} };
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const element = document.createElement('div');
    element.className = 'terminal-view';
    element.dataset.terminalId = info.id;
    element.hidden = true;
    host.current?.append(element);
    terminal.open(element);
    terminal.textarea?.setAttribute('aria-label', 'PowerShell');
    terminal.parser.registerOscHandler(52, () => true);
    controller = { terminal, fit, element, seq: 0, info, hydrated: false, pending: orphanChunks.current.get(info.id) ?? [] };
    orphanChunks.current.delete(info.id);
    controllers.current.set(info.id, controller);
    terminal.onData(data => {
      if (controllers.current.get(info.id)?.info.status === 'running')
        void window.desktop?.terminalWrite(info.id, data).catch(report);
    });
    terminal.onResize(({ cols, rows }) => {
      if (controllers.current.has(info.id)) void window.desktop?.terminalResize(info.id, cols, rows).catch(report);
    });
    terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true;
      if (event.ctrlKey && !event.altKey && (event.key.toLowerCase() === 'c') &&
        (event.shiftKey || terminal.hasSelection())) {
        event.preventDefault(); void copy(controllers.current.get(info.id)); return false;
      }
      if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'v') {
        event.preventDefault(); void paste(controllers.current.get(info.id)); return false;
      }
      return true;
    });
    return controller;
  };
  const write = (controller: Controller, seq: number, data: string) => {
    if (seq <= controller.seq) return;
    controller.seq = seq;
    controller.terminal.write(data, () => {
      if (controllers.current.get(controller.info.id) === controller)
        void window.desktop?.terminalAck(controller.info.id, seq).catch(() => {});
    });
  };
  const replay = (snapshot: TerminalSnapshot) => {
    if (closed.current.has(snapshot.id)) return;
    const controller = controllers.current.get(snapshot.id) ?? ensure(snapshot);
    const chunks = [...snapshot.chunks, ...controller.pending].sort((a, b) => a.seq - b.seq);
    controller.hydrated = true;
    controller.pending = [];
    chunks.forEach(chunk => write(controller, chunk.seq, chunk.data));
    sync();
  };
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    const unsubscribe = bridge.onTerminalEvent(event => {
      if (event.type === 'state') {
        if (!closed.current.has(event.terminal.id)) { ensure(event.terminal); sync(); }
      }
      else if (event.type === 'data') {
        if (closed.current.has(event.id)) return;
        const controller = controllers.current.get(event.id);
        if (controller?.hydrated) write(controller, event.seq, event.data);
        else if (controller) controller.pending.push(event);
        else {
          const chunks = orphanChunks.current.get(event.id) ?? [];
          chunks.push(event); orphanChunks.current.set(event.id, chunks);
        }
      } else {
        closed.current.add(event.id); orphanChunks.current.delete(event.id);
        const controller = controllers.current.get(event.id);
        controller?.terminal.dispose(); controller?.element.remove();
        controllers.current.delete(event.id); sync();
      }
    });
    let live = true;
    void bridge.terminalList().then(snapshots => {
      if (!live) return;
      snapshots.forEach(replay);
    }).catch(() => {}); // Opening a directory retries a failed background restore.
    const observer = new MutationObserver(() => {
      controllers.current.forEach(controller => { controller.terminal.options.theme = theme(); });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => {
      live = false;
      unsubscribe(); observer.disconnect();
      controllers.current.forEach(controller => { controller.terminal.dispose(); controller.element.remove(); });
      controllers.current.clear();
    };
  }, []);
  const create = async (id: string, directory: string) => {
    if (!window.desktop || creating.current.has(directory)) return;
    creating.current.add(directory); setPending(true);
    try {
      const snapshot = await window.desktop.terminalCreate(id);
      replay(snapshot);
      setActive(value => ({ ...value, [directory]: snapshot.id }));
    } catch { report(); }
    finally { creating.current.delete(directory); setPending(creating.current.size > 0); }
  };
  useEffect(() => {
    if (!open || !runtimeId || !cwd || !window.desktop || loaded.current.has(scope) || loading.current.has(scope)) return;
    const bridge = window.desktop;
    const id = runtimeId;
    const directory = scope;
    loading.current.add(directory);
    void bridge.terminalList(id).then(async snapshots => {
      snapshots.forEach(replay);
      loaded.current.add(directory);
      if (!snapshots.length) await create(id, directory);
    }).catch(report).finally(() => loading.current.delete(directory));
  }, [open, runtimeId, scope]);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    controllers.current.forEach(controller => { controller.element.hidden = controller.info.id !== selected?.id; });
    const controller = selected && controllers.current.get(selected.id);
    if (!open || !controller) return;
    const fit = () => {
      if (controllers.current.get(controller.info.id) !== controller || element.clientWidth < 30 || element.clientHeight < 30) return;
      const size = controller.fit.proposeDimensions();
      if (size) controller.terminal.resize(Math.min(500, Math.max(2, size.cols)), Math.min(300, Math.max(1, size.rows)));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    return () => observer.disconnect();
  }, [open, selected?.id, infos.length, expanded]);
  useEffect(() => {
    if (open && selected) controllers.current.get(selected.id)?.terminal.focus();
  }, [open, selected?.id]);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
    return () => clearTimeout(timer);
  }, [open, present]);
  const controller = selected && controllers.current.get(selected.id);
  return <div className={`terminal-track${open ? ' is-open' : ''}${overlay ? ' is-overlay' : ''}${replaced ? ' is-replaced' : ''}`}>
    <aside id="terminal-panel" className={`terminal-panel right-inspector-surface${expanded ? ' is-expanded' : ''}${open ? '' : ' is-closing'}`}
      style={{ visibility: present && !replaced ? undefined : 'hidden' }} aria-label={t('终端', 'Terminal')} aria-hidden={!open} inert={!open}>
      <header className="right-panel-header"><h2>{t('终端', 'Terminal')}</h2>
        <RightPanelExpandButton expanded={expanded} language={language} onToggle={onToggleExpanded}/>
        <button className="icon-button" aria-label={t('关闭终端面板', 'Close terminal panel')} onClick={onClose}><X size={16}/></button>
      </header>
      <div className="terminal-tabs" role="tablist" aria-label={t('终端标签', 'Terminal tabs')}>
        {tabs.map(info => <div className={`terminal-tab${selected?.id === info.id ? ' is-active' : ''}`} key={info.id}>
          <button role="tab" aria-selected={selected?.id === info.id} aria-controls="terminal-output"
            onClick={() => setActive(value => ({ ...value, [scope]: info.id }))}>{info.title}</button>
          <button className="icon-button" aria-label={`${t('结束', 'End')} ${info.title}`} data-tooltip={t('结束终端', 'End terminal')}
            onClick={() => void window.desktop?.terminalClose(info.id).catch(report)}><X size={12}/></button>
        </div>)}
        <button className="icon-button" disabled={!runtimeId || pending || loading.current.has(scope) || tabs.length >= 8}
          aria-label={t('新建终端', 'New terminal')} data-tooltip={t('新建终端', 'New terminal')}
          onClick={() => runtimeId && void create(runtimeId, scope)}><Plus size={16}/></button>
      </div>
      <div className="terminal-toolbar">
        <span>PowerShell</span>
        <button className="icon-button" disabled={!selected} aria-label={t('复制所选文本', 'Copy selected text')}
          data-tooltip={t('复制所选文本', 'Copy selected text')} onClick={() => void copy(controller)}><Copy size={14}/></button>
        <button className="icon-button" disabled={selected?.status !== 'running'} aria-label={t('粘贴到终端', 'Paste into terminal')}
          data-tooltip={t('粘贴到终端', 'Paste into terminal')} onClick={() => void paste(controller)}><ClipboardPaste size={14}/></button>
        <button className="icon-button" disabled={!selected} aria-label={t('清空终端', 'Clear terminal')}
          data-tooltip={t('清空终端', 'Clear terminal')} onClick={() => { controller?.terminal.clear(); controller?.terminal.focus(); }}><Eraser size={14}/></button>
      </div>
      <div id="terminal-output" ref={host} className="terminal-output" role="tabpanel"/>
      {!tabs.length && <p className="terminal-empty">{runtimeId ? t('暂无终端', 'No terminal') : t('请先打开一个会话', 'Open a session first')}</p>}
      <footer className="terminal-footer"><span title={cwd}>{cwd}</span><span>{selected?.status === 'running' ? t('运行中', 'Running')
        : selected?.status === 'starting' ? t('启动中', 'Starting') : selected?.status === 'failed' ? t('启动失败', 'Failed to start')
        : selected?.status === 'exited' ? `${t('已退出', 'Exited')} · ${selected.exitCode ?? '--'}` : ''}</span></footer>
    </aside>
  </div>;
}
