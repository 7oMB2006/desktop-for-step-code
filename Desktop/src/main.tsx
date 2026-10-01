import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, ArrowDown, Square, Plus, Folder, FolderOpen, MessageSquare, Settings as SettingsIcon, PanelLeft, X, Search, ChevronDown, ChevronRight, Terminal, Copy, Check, RotateCcw, Trash2, Pencil, Cpu, AlertCircle, TriangleAlert, Info, Download, Plug, BookOpen, LogOut, SunMoon, ExternalLink, FileCode2, Archive, GitBranch, MoreHorizontal, ListTree, Layers3, FileText, ZoomIn, ZoomOut } from 'lucide-react';
import type { Snapshot, Settings, Message, Content, UIRequest, McpServer, Session, ComposerAttachment } from './contracts';
import 'katex/dist/katex.min.css';
import './style.css';
import './layout.css';
import { applyMessageEvent } from './message-events';
import { WindowBar, type WindowMenu } from './WindowBar';
import { NoticeToast, type NoticeToastItem } from './NoticeToast';
import { PerformanceBar } from './PerformanceBar';
import { ModelEffortPicker } from './ModelEffortPicker';
import { PermissionPicker } from './PermissionPicker';
import { ContextRing } from './ContextRing';
import { ImageContextMenu, type ImageMenuTarget, type ImageMenuAction } from './ImageContextMenu';
import { AppTooltip } from './AppTooltip';
import { ConversationMarkers, conversationTurns, scrollToTurn } from './ConversationNavigation';
import { ConversationScrollThumb } from './ConversationScrollThumb';
import { updateRunMetrics, type RunMetrics } from './performance';
import { ConversationMessages } from './ConversationMessages';
import { messageBlocks, messageText } from './conversation-presentation';

const bridge = window.desktop;
// Seed the placeholder with the main-process-resolved theme so the first React
// write matches the bootstrap instead of flipping to a system guess before the
// real snapshot arrives.
const initial: Snapshot = { preferences: { theme: window.desktopTheme?.resolved ?? 'system', language: 'zh', workspaces: [] }, status: 'disconnected', messages: [], models: [], sessions: [] };
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;
const workspaceKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const sessionTitle = (session: Pick<Session, 'name' | 'firstMessage'> | undefined, fallback: string) => session?.name || session?.firstMessage || fallback;
const mcpFailureName = (message: string) => /^MCP server '([^']+)' could not start:/u.exec(message)?.[1];
function IconButton({ title, tooltip = true, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string; tooltip?: boolean }) { return <button type="button" className="icon-button" data-tooltip={tooltip ? title : undefined} aria-label={title} {...props}>{children}</button>; }
function App() {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<NoticeToastItem | null>(null);
  const [mcpFailures, setMcpFailures] = useState<Record<string, { message: string; count: number }>>({});
  const notifiedMcp = useRef(new Set<string>());
  const nextNoticeId = useRef(0);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const [preview, setPreview] = useState<{ name: string; src: string } | null>(null);
  const [imageMenu, setImageMenu] = useState<ImageMenuTarget | null>(null);
  const previewPanel = useRef<HTMLDivElement>(null);
  const previewClosing = useRef(false);
  const previewAnchorRect = useRef<DOMRect | null>(null);
  const previewAnimation = useRef<Animation | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);
  const previewTrigger = useRef<HTMLElement | null>(null);
  const previewViewport = useRef<HTMLDivElement>(null);
  const previewDrag = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const [busy, setBusy] = useState(false);
  const [runMetrics, setRunMetrics] = useState<RunMetrics | null>(null);
  const [clock, setClock] = useState(() => performance.now());
  const [loading, setLoading] = useState(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set());
  const [sidebar, setSidebar] = useState(true);
  const [compactSidebar, setCompactSidebar] = useState(() => window.innerWidth <= 760);
  const [compactSidebarOpen, setCompactSidebarOpen] = useState(false);
  const compactSidebarRef = useRef(compactSidebar);
  const [settings, setSettings] = useState<Settings | null>(null);
  // The renderer cannot read the Windows dark mode itself: prefers-color-scheme
  // stays light in this packaged renderer, so the main process owns it and
  // pushes changes here.
  const [systemDark, setSystemDark] = useState(() => window.desktopTheme?.systemDark ?? false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState('account');
  const [details, setDetails] = useState('');
  const [rightPanel, setRightPanel] = useState<'turns' | 'summary' | null>(null);
  const [requests, setRequests] = useState<UIRequest[]>([]);
  const [answer, setAnswer] = useState('');
  const [levels, setLevels] = useState<string[]>([]);
  const [commands, setCommands] = useState<{ name: string; description?: string; source?: string }[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ type: 'session' | 'workspace'; id: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ type: 'session' | 'workspace'; id: string; x: number; y: number } | null>(null);
  const [name, setName] = useState('');
  const [loginProfile, setLoginProfile] = useState('step_plan');
  const [key, setKey] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [mcpEdit, setMcpEdit] = useState<{ name: string; original?: string; config: McpServer; args: string; secrets: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const sidebarVisible = compactSidebar ? compactSidebarOpen : sidebar;
  const zh = data.preferences.language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const connected = data.status === 'connected';
  const current = data.sessions.find(s => s.id === data.state?.sessionId);
  const activeTitle = sessionTitle(current ?? (data.state?.sessionName ? { name: data.state.sessionName, firstMessage: '' } : undefined), t('新会话', 'New session'));
  const turns = useMemo(() => conversationTurns(data.messages, data.preferences.language), [data.messages, data.preferences.language]);
  const workspaceTitle = (path: string) => data.preferences.workspaceNames?.[workspaceKey(path)] || basename(path);
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => { try { setError(''); return await action(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } };
  const refresh = async () => { if (bridge) { const value = await bridge.snapshot(); setData(value); setBusy(Boolean(value.state?.isStreaming)); } };
  const applySnapshot = async (action: () => Promise<Snapshot | null>) => { setLoading(true); await run(async () => { const result = await action(); if (result) { setData(result); setRunMetrics(null); } setRequests([]); follow.current = true; setAwayFromBottom(false); }); setLoading(false); };
  const command = async (type: string, args?: Record<string, unknown>) => run(async () => { const result = await bridge!.command(type, args); if (!['prompt', 'abort', 'extension_ui_response'].includes(type)) await refresh(); return result; });
  useEffect(() => {
    void run(refresh).finally(() => setLoading(false));
    if (!bridge) return;
    const unsubscribe = bridge.onEvent(event => {
      if (['agent_start', 'turn_start', 'tool_execution_start', 'tool_execution_end', 'message_update', 'message_end', 'agent_end'].includes(event.type)) {
        const receivedAt = performance.now();
        if (event.type === 'agent_start') setClock(receivedAt);
        setRunMetrics(previous => updateRunMetrics(previous, event, receivedAt));
      }
      if (event.type === 'agent_start') setBusy(true);
      if (event.type === 'agent_end') { setBusy(false); void run(refresh); }
      if (event.type === 'desktop_exit') { setBusy(false); setRunMetrics(null); setNotice(null); setData(d => ({ ...d, status: 'disconnected', state: undefined, stats: undefined, permissionPreset: undefined })); setRequests([]); }
      if (event.type === 'desktop_permission') setData(d => ({ ...d, permissionPreset: event.preset }));
      if (event.type === 'desktop_status') {
        if (event.status === 'connecting') notifiedMcp.current.clear();
        setData(d => ({ ...d, status: event.status }));
      }
      if (event.type === 'desktop_error') setError(event.message);
      if (event.type === 'desktop_system_theme') setSystemDark(Boolean(event.dark));
      if (['message_start', 'message_update', 'message_end'].includes(event.type)) setData(d => ({ ...d, messages: applyMessageEvent(d.messages, event) }));
      if (event.type === 'extension_ui_request') {
        if (['select', 'input', 'editor', 'confirm'].includes(event.method)) setRequests(r => [...r.filter(v => v.id !== event.id), event as UIRequest]);
        if (event.method === 'notify' && event.message) {
          if (event.notifyType === 'info' && /^Permission mode: (Ask|Read Only|Bypass|Autopilot)$/.test(event.message)) return;
          if (event.notifyType === 'warning' || event.notifyType === 'info') {
            const mcpServer = event.notifyType === 'warning' ? mcpFailureName(event.message) : undefined;
            if (mcpServer) {
              setMcpFailures(previous => ({
                ...previous,
                [mcpServer]: { message: event.message, count: (previous[mcpServer]?.count ?? 0) + 1 },
              }));
            }
            if (!mcpServer || !notifiedMcp.current.has(mcpServer)) {
              if (mcpServer) notifiedMcp.current.add(mcpServer);
              setNotice({ id: ++nextNoticeId.current, message: event.message, type: event.notifyType, mcpServer });
            }
          }
          else setError(event.message);
        }
        if (event.method === 'set_editor_text') setDraft(event.text);
      }
    });
    // The preload snapshot can be stale by the time this runs: a system theme
    // change that landed before the subscription had no listener and was
    // dropped. Subscribe first, then re-read the authoritative value so the
    // dropped change is corrected here and later ones arrive as events.
    void (async () => {
      try { setSystemDark((await bridge.systemTheme()).systemDark); }
      catch (error) { /* keep the preload snapshot */ }
    })();
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!runMetrics || runMetrics.finishedAt !== undefined) return;
    const timer = setInterval(() => setClock(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [runMetrics?.startedAt, runMetrics?.finishedAt]);
  useEffect(() => {
    if (!connected) return;
    void run(async () => { setLevels((await bridge!.command('get_available_thinking_levels')).levels); setCommands((await bridge!.command('get_commands')).commands); });
  }, [connected, data.state?.model?.id]);
  useEffect(() => { if (follow.current) bottom.current?.scrollIntoView({ behavior: 'instant' }); }, [data.messages, busy]);
  useEffect(() => {
    const input = document.querySelector<HTMLTextAreaElement>('.composer > textarea');
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
  }, [draft]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const openImage = (src: string, name: string, anchor: HTMLElement) => {
    previewTrigger.current = anchor;
    previewAnchorRect.current = (anchor.querySelector('img') ?? anchor).getBoundingClientRect();
    previewClosing.current = false;
    previewDrag.current = null;
    setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }); setPreviewDragging(false);
    setPreview({ src, name });
  };
  const anchorTransform = () => {
    const panel = previewPanel.current;
    const anchor = previewTrigger.current;
    if (!panel) return 'none';
    const rect = anchor?.isConnected ? (anchor.querySelector('img') ?? anchor).getBoundingClientRect() : previewAnchorRect.current;
    if (!rect || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return 'scale(.96)';
    // Layout coordinates stay stable even while the panel is mid-animation.
    return `translate(${rect.left - panel.offsetLeft}px, ${rect.top - panel.offsetTop}px) scale(${rect.width / panel.offsetWidth}, ${rect.height / panel.offsetHeight})`;
  };
  const closePreview = () => {
    const panel = previewPanel.current;
    if (!panel || previewClosing.current) return;
    previewClosing.current = true;
    setImageMenu(null);
    previewDrag.current = null; setPreviewDragging(false);
    const from = getComputedStyle(panel).transform;
    previewAnimation.current?.cancel();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260;
    const animation = panel.animate([{ transform: from, opacity: 1 }, { transform: anchorTransform(), opacity: 0 }], { duration, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
    previewAnimation.current = animation;
    panel.parentElement?.getAnimations().forEach(value => value.cancel());
    panel.parentElement?.animate([{ backgroundColor: 'rgba(0,0,0,.8)' }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration, fill: 'forwards' });
    void animation.finished.then(() => setPreview(null)).catch(() => {});
  };
  useEffect(() => {
    if (!preview) return;
    const panel = previewPanel.current!;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280;
    previewAnimation.current = panel.animate([{ transform: anchorTransform(), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    panel.parentElement?.animate([{ backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: 'rgba(0,0,0,.8)' }], { duration });
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('.image-context')) return;
      if (event.key === 'Escape') { event.preventDefault(); closePreview(); }
      if (event.key === 'Tab') {
        const controls = [...document.querySelectorAll<HTMLButtonElement>('.attachment-preview-toolbar button:not(:disabled)')];
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    };
    document.querySelector<HTMLButtonElement>('.attachment-preview-toolbar button:last-child')?.focus();
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previewAnimation.current?.cancel(); previewDrag.current = null; setPreviewDragging(false); if (previewTrigger.current?.isConnected) previewTrigger.current.focus({ preventScroll: true }); };
  }, [preview]);
  useEffect(() => {
    const update = () => document.documentElement.dataset.theme = data.preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : data.preferences.theme;
    update(); document.documentElement.lang = zh ? 'zh-CN' : 'en';
  }, [data.preferences.theme, systemDark, zh]);
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 760 && !compactSidebarRef.current) {
        compactSidebarRef.current = true;
        setCompactSidebar(true);
        setCompactSidebarOpen(false);
      } else if (window.innerWidth >= 840 && compactSidebarRef.current) {
        compactSidebarRef.current = false;
        setCompactSidebar(false);
        setCompactSidebarOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => { setAnswer(requests[0]?.prefill ?? ''); }, [requests[0]?.id]);
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener('resize', dismiss); };
  }, [contextMenu]);
  useEffect(() => {
    if (!settingsOpen && !mcpEdit && !requests.length && !renaming) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
    const controls = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? [])];
    controls()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = controls(); if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [settingsOpen, Boolean(mcpEdit), requests[0]?.id, renaming, tab]);
  useEffect(() => {
    const r = requests[0]; if (!r?.timeout) return;
    const timer = setTimeout(() => { void respond({ cancelled: true }); }, r.timeout); return () => clearTimeout(timer);
  }, [requests[0]?.id]);
  const respond = async (value: Record<string, unknown>) => {
    const r = requests[0]; if (!r) return;
    await run(async () => { await bridge!.command('extension_ui_response', { id: r.id, ...value }); setRequests(q => q.filter(v => v.id !== r.id)); });
  };
  const openSettings = async () => { setSettingsOpen(true); await run(async () => setSettings(await bridge!.settings())); };
  const addAttachments = (added: ComposerAttachment[]) => {
    const previous = attachmentsRef.current;
    const next = [...previous, ...added];
    if (next.length > 10 || next.filter(item => item.kind === 'image').length > 5) throw new Error(t('最多添加 10 个附件，其中图片最多 5 张', 'Maximum 10 attachments, including 5 images'));
    attachmentsRef.current = next;
    setAttachments(next);
  };
  const importFiles = async (files: File[]) => run(async () => {
    if (!files.length) return;
    if (files.length + attachmentsRef.current.length > 10) throw new Error(t('最多添加 10 个附件', 'Maximum 10 attachments'));
    const added: ComposerAttachment[] = [];
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) throw new Error(t('文件不能超过 50 MiB', 'File exceeds 50 MiB'));
      try {
        added.push(await bridge!.importFile(file));
      } catch (error) {
        if (!file.type.startsWith('image/') || !String(error).includes('no local path')) throw error;
        if (file.size > 10 * 1024 * 1024) throw new Error(t('图片不能超过 10 MiB', 'Image exceeds 10 MiB'));
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        added.push(await bridge!.importClipboardImage(btoa(binary), file.type, file.name || 'clipboard.png'));
      }
    }
    addAttachments(added);
  });
  const send = async () => {
    if ((!draft.trim() && !attachments.length) || !connected || loading) return;
    const message = draft; const attached = attachments;
    setDraft(''); setAttachments([]); attachmentsRef.current = []; follow.current = true; setAwayFromBottom(false);
    await run(async () => {
      try {
        await bridge!.command('prompt', { message, images: attached.filter(item => item.kind === 'image').map(item => item.content), files: attached.filter(item => item.kind === 'file').map(item => item.id) });
      } catch (e) {
        setDraft(value => value ? `${message}\n${value}` : message);
        setAttachments(value => { const restored = [...attached, ...value]; attachmentsRef.current = restored; return restored; });
        throw e;
      }
    });
  };
  const editMessage = (message: Message) => {
    if (draft.trim() || attachmentsRef.current.length) {
      setError(t('输入框已有草稿，请先发送或清空', 'Send or clear the current draft first'));
      return;
    }
    const images: ComposerAttachment[] = messageBlocks(message).filter(block => block.type === 'image')
      .map((content, index) => ({ kind: 'image', name: `${t('图片', 'Image')} ${index + 1}`, content }));
    if (images.length > 5) {
      setError(t('这条消息包含超过 5 张图片，无法放回输入框', 'This message has more than 5 images'));
      return;
    }
    setError('');
    setDraft(messageText(message));
    attachmentsRef.current = images;
    setAttachments(images);
    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
  };
  const changePreviewZoom = (next: number, anchor?: { x: number; y: number }) => {
    const zoom = Math.max(.5, Math.min(5, next));
    if (anchor && previewViewport.current) {
      const rect = previewViewport.current.getBoundingClientRect();
      const x = anchor.x - rect.left - rect.width / 2;
      const y = anchor.y - rect.top - rect.height / 2;
      setPreviewPan(pan => ({
        x: x - (x - pan.x) * zoom / previewZoom,
        y: y - (y - pan.y) * zoom / previewZoom,
      }));
    }
    setPreviewZoom(zoom);
  };
  const setPreference = async (patch: any) => run(async () => { const p = await bridge!.preferences(patch); setData(d => ({ ...d, preferences: p })); });
  const saveMcp = async () => run(async () => {
    if (!mcpEdit) return;
    const parsed = JSON.parse(mcpEdit.args || '[]'); const secrets = JSON.parse(mcpEdit.secrets || '{}');
    await bridge!.saveMcp(mcpEdit.name, { ...mcpEdit.config, args: parsed }, secrets);
    setMcpEdit(null); setSettings(await bridge!.settings());
  });
  const workspaceGroups = new Map<string, { path: string; sessions: typeof data.sessions }>();
  for (const path of data.preferences.workspaces) {
    const key = workspaceKey(path);
    if (!workspaceGroups.has(key)) workspaceGroups.set(key, { path, sessions: [] });
  }
  const sessionWorkspaceKey = (session: typeof data.sessions[number]) => workspaceKey(session.workspacePath ?? session.cwd);
  const archived = new Set(data.preferences.archivedSessionIds ?? []);
  const visibleSessions = data.sessions.filter(session => !archived.has(session.id));
  const archivedSessions = data.sessions.filter(session => archived.has(session.id));
  const independentSessions = visibleSessions.filter(session => session.independent ?? !workspaceGroups.has(sessionWorkspaceKey(session)));
  for (const session of visibleSessions) if (!independentSessions.includes(session)) workspaceGroups.get(sessionWorkspaceKey(session))?.sessions.push(session);
  const showContext = (event: React.MouseEvent, type: 'session' | 'workspace', id: string) => {
    event.preventDefault();
    setContextMenu({ type, id, x: Math.min(event.clientX, window.innerWidth - 206), y: Math.min(event.clientY, window.innerHeight - 190) });
  };
  const beginRename = (type: 'session' | 'workspace', id: string) => {
    const session = data.sessions.find(s => s.id === id);
    setRenameTarget({ type, id });
    setName(type === 'session' ? sessionTitle(session, '') : workspaceTitle(id));
    setRenaming(true);
    setContextMenu(null);
  };
  const updateArchive = async (id: string, restore: boolean) => {
    const next = restore ? [...archived].filter(value => value !== id) : [...archived, id];
    const preferences = await bridge!.preferences({ archivedSessionIds: next });
    setData(previous => ({ ...previous, preferences }));
    setContextMenu(null);
  };
  const saveRename = async () => {
    if (!renameTarget || !name.trim()) return;
    if (renameTarget.type === 'workspace') {
      const names = { ...data.preferences.workspaceNames, [workspaceKey(renameTarget.id)]: name.trim() };
      const preferences = await bridge!.preferences({ workspaceNames: names });
      setData(previous => ({ ...previous, preferences }));
    } else {
      if (data.state?.sessionId !== renameTarget.id) {
        const result = await bridge!.switchSession(renameTarget.id);
        setData(result);
      }
      await bridge!.command('set_session_name', { name: name.trim() });
      await refresh();
    }
    setRenaming(false);
    setRenameTarget(null);
  };
  const renderSession = (s: Session) => <div key={s.id} className={`session-row ${s.id === data.state?.sessionId ? 'selected' : ''}`} onContextMenu={e => showContext(e, 'session', s.id)}>
    <button aria-current={s.id === data.state?.sessionId ? 'page' : undefined} disabled={busy || loading} onClick={() => void applySnapshot(() => bridge!.switchSession(s.id))}><span>{sessionTitle(s, t('新会话', 'New session'))}</span></button>
    <IconButton title={t('更多操作', 'More actions')} aria-haspopup="menu" disabled={busy || loading} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setContextMenu({ type: 'session', id: s.id, x: Math.min(rect.right, window.innerWidth - 206), y: Math.min(rect.bottom, window.innerHeight - 190) }); }}><MoreHorizontal size={15}/></IconButton>
  </div>;
  const toggleWorkspace = (key: string) => setCollapsedWorkspaces(previous => { const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const independentExpanded = !collapsedWorkspaces.has('__independent__');
  const createInWorkspace = async (path: string, sessions: typeof data.sessions) => {
    setCollapsedWorkspaces(previous => { const next = new Set(previous); next.delete(workspaceKey(path)); return next; });
    await applySnapshot(async () => {
      if (!connected || workspaceKey(path) !== workspaceKey(data.preferences.workspace ?? '')) {
        if (data.preferences.workspaces.includes(path)) await bridge!.workspace(path);
        else await bridge!.switchSession(sessions[0].id);
      }
      await bridge!.command('new_session');
      return bridge!.snapshot();
    });
  };
  const toggleSidebar = () => compactSidebar ? setCompactSidebarOpen(open => !open) : setSidebar(open => !open);
  const menus: WindowMenu[] = [
    { id: 'file', label: t('文件', 'File'), items: [
      { label: t('新建独立会话', 'New independent session'), disabled: !bridge || busy || loading, action: () => void applySnapshot(() => bridge!.newIndependentSession()) },
      { label: t('打开项目…', 'Open project...'), disabled: !bridge || busy || loading, action: () => void applySnapshot(() => bridge!.chooseWorkspace()) },
      { label: t('打开会话文件夹', 'Open session folder'), disabled: !bridge || !data.preferences.workspace || loading, action: () => void run(() => bridge!.openSessionFolder()) },
    ] },
    { id: 'edit', label: t('编辑', 'Edit'), items: [
      { label: t('重命名会话', 'Rename session'), disabled: !connected || busy || !data.state?.sessionId, action: () => beginRename('session', data.state!.sessionId!) },
      { label: t('停止生成', 'Stop response'), disabled: !busy, action: () => void command('abort') },
    ] },
    { id: 'view', label: t('视图', 'View'), items: [
      { label: sidebarVisible ? t('隐藏侧栏', 'Hide sidebar') : t('显示侧栏', 'Show sidebar'), action: toggleSidebar },
      { label: t('会话统计', 'Session statistics'), disabled: !connected, action: () => void run(async () => setDetails(JSON.stringify(await bridge!.command('get_session_stats'), null, 2))) },
      { label: t('重启运行时', 'Restart runtime'), disabled: !data.preferences.workspace || busy || loading, action: () => void applySnapshot(() => bridge!.restart()) },
    ] },
    { id: 'help', label: t('帮助', 'Help'), items: [
      { label: t('设置', 'Settings'), disabled: !bridge, action: () => void openSettings() },
      { label: t('导出脱敏诊断', 'Export redacted diagnostics'), disabled: !bridge, action: () => void run(() => bridge!.diagnostics()) },
    ] },
  ];
  const imageAction = (action: ImageMenuAction) => {
    if (!imageMenu || !bridge) return;
    const target = imageMenu;
    setImageMenu(null);
    void run(async () => {
      if (action === 'add') {
        const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(target.src);
        if (!match) throw new Error(t('不支持的图片', 'Unsupported image'));
        addAttachments([await bridge.importClipboardImage(match[2], match[1], target.name)]);
        document.querySelector<HTMLTextAreaElement>('.composer > textarea')?.focus();
      } else await bridge.imageAction(action, target.src, target.name);
    });
  };
  return <div className={`app ${sidebarVisible ? '' : 'sidebar-hidden'} ${compactSidebar ? 'sidebar-compact' : ''}`} onContextMenu={e => {
    const element = e.target as HTMLElement;
    const image = element.closest<HTMLImageElement>('img') ?? element.closest('.attachment-preview-image')?.querySelector('img');
    if (!image || !image.closest('.attachment-open, .attachment-preview-image, .messages')) return;
    const src = image.getAttribute('src') ?? '';
    if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(src)) return;
    e.preventDefault(); e.stopPropagation();
    setContextMenu(null);
    const rect = image.getBoundingClientRect();
    setImageMenu({ src, name: image.alt || t('图片', 'Image'), transcript: Boolean(image.closest('.messages')),
      anchor: image.closest<HTMLButtonElement>('button') ?? image,
      x: e.clientX || rect.left + rect.width / 2, y: e.clientY || rect.top + rect.height / 2 });
  }}>
    <AppTooltip/>
    <WindowBar language={data.preferences.language} sidebarVisible={sidebarVisible} toggleSidebar={toggleSidebar} menus={menus} sessionTitle={activeTitle}/>
    <NoticeToast notice={notice} language={data.preferences.language} onDismiss={() => setNotice(null)}
      onDetails={() => { setNotice(null); setTab('mcp'); void openSettings(); }}/>
    {imageMenu && <ImageContextMenu target={imageMenu} language={data.preferences.language}
      canAdd={Boolean(bridge) && attachments.length < 10 && attachments.filter(item => item.kind === 'image').length < 5}
      onAction={imageAction} onClose={() => setImageMenu(null)}/>}
    {contextMenu && <div className="sidebar-context" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={e => e.stopPropagation()}>
      <button role="menuitem" onClick={() => beginRename(contextMenu.type, contextMenu.id)} disabled={busy || loading}><Pencil size={15}/>{t('重命名', 'Rename')}</button>
      {contextMenu.type === 'workspace' ? <button role="menuitem" onClick={() => { const path = contextMenu.id; setContextMenu(null); void run(() => bridge!.openWorkspaceFolder(path)); }}><FolderOpen size={15}/>{t('在资源管理器中打开', 'Open in Explorer')}</button> : <>
        <button role="menuitem" onClick={() => void updateArchive(contextMenu.id, archived.has(contextMenu.id))}><Archive size={15}/>{archived.has(contextMenu.id) ? t('恢复会话', 'Restore session') : t('归档会话', 'Archive session')}</button>
        <div className="context-separator"/>
        <button role="menuitem" disabled><Copy size={15}/>{t('复制', 'Copy')}</button>
        <button role="menuitem" disabled><GitBranch size={15}/>{t('分支', 'Branch')}</button>
      </>}
    </div>}
    {error && (settingsOpen || mcpEdit || requests.length > 0) && <div className="modal-error" role="alert"><AlertCircle size={16}/><span>{error}</span><IconButton title="Dismiss" onClick={() => setError('')}><X size={16}/></IconButton></div>}
    {compactSidebar && <button type="button" className="sidebar-backdrop" aria-label={t('关闭侧栏', 'Close sidebar')} aria-hidden={!compactSidebarOpen} inert={!compactSidebarOpen} onClick={() => setCompactSidebarOpen(false)}/>}
    <aside className="sidebar" inert={!sidebarVisible}>
      <div className="sidebar-identity"><img src="./StepCode.svg" width="26" height="26" alt=""/><span className="sidebar-wordmark"><img className="wordmark-light" src="./wordmark-light.png" alt="Desktop for Step Code"/><img className="wordmark-dark" src="./wordmark-dark.png" alt="Desktop for Step Code"/></span></div>
      <button className="new-chat" disabled={!bridge || busy || loading} onClick={() => void applySnapshot(() => bridge!.newIndependentSession())}><Plus size={17}/>{t('新建会话', 'New session')}</button>
      <nav className="workspace-tree" aria-label={t('工作区与会话', 'Workspaces and sessions')}>
        <section className="workspace-group independent-group" aria-label={t('独立会话', 'Independent sessions')}>
          <div className="workspace-heading"><button className="workspace-toggle" aria-label={t('独立会话', 'Independent sessions')} aria-expanded={independentExpanded} onClick={() => toggleWorkspace('__independent__')}><MessageSquare size={15}/><span>{t('独立会话', 'Independent sessions')}</span><small>{independentSessions.length}</small></button></div>
          <div className="workspace-disclosure" aria-hidden={!independentExpanded} inert={!independentExpanded}>
            <div className="workspace-sessions">{independentSessions.map(renderSession)}</div>
          </div>
        </section>
        <div className="section-label">{t('项目', 'Projects')}<IconButton title={t('添加工作区', 'Add workspace')} disabled={!bridge || busy || loading} onClick={() => void applySnapshot(() => bridge!.chooseWorkspace())}><Plus size={15}/></IconButton></div>
        {[...workspaceGroups].map(([key, group]) => {
          const expanded = !collapsedWorkspaces.has(key);
          return <section className="workspace-group" key={key} aria-label={group.path}>
            <div className={`workspace-heading ${key === workspaceKey(data.preferences.workspace ?? '') ? 'current' : ''}`} onContextMenu={e => showContext(e, 'workspace', group.path)}>
              <button className="workspace-toggle" aria-label={workspaceTitle(group.path)} aria-expanded={expanded} onClick={() => toggleWorkspace(key)}>{expanded ? <FolderOpen size={15}/> : <Folder size={15}/>}<span>{workspaceTitle(group.path)}</span></button>
              <IconButton title={t(`在 ${basename(group.path)} 新建会话`, `New session in ${basename(group.path)}`)} disabled={!bridge || busy || loading} onClick={() => void createInWorkspace(group.path, group.sessions)}><Plus size={15}/></IconButton>
              <IconButton title={t('更多操作', 'More actions')} aria-haspopup="menu" onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setContextMenu({ type: 'workspace', id: group.path, x: Math.min(rect.right, window.innerWidth - 206), y: Math.min(rect.bottom, window.innerHeight - 190) }); }}><MoreHorizontal size={15}/></IconButton>
            </div>
            <div className="workspace-disclosure" aria-hidden={!expanded} inert={!expanded}>
              <div className="workspace-sessions">{group.sessions.map(renderSession)}{!group.sessions.length && <span className="workspace-empty">{t('暂无会话', 'No sessions yet')}</span>}</div>
            </div>
          </section>;
        })}
        {archivedSessions.length > 0 && <section className="workspace-group archived-group"><div className="section-label">{t('已归档', 'Archived')}</div><div className="workspace-sessions">{archivedSessions.map(renderSession)}</div></section>}
        {!workspaceGroups.size && <button disabled={!bridge || loading} onClick={() => void applySnapshot(() => bridge!.chooseWorkspace())}><FolderOpen size={15}/>{t('打开项目', 'Open project')}</button>}
      </nav>
      <div className="sidebar-bottom"><button onClick={() => void openSettings()} disabled={!bridge}><SettingsIcon size={17}/>{t('设置', 'Settings')}<span>0.1.0</span></button><div className="connection"><i className={connected ? 'online' : ''}/>{connected ? t('Step Code 已连接', 'Step Code connected') : loading ? t('连接中', 'Connecting') : t('未连接', 'Disconnected')}</div></div>
    </aside>
    <main>
      {error && <div className="error-banner" role="alert"><AlertCircle size={16}/><span>{error}</span><IconButton title={t('关闭', 'Dismiss')} onClick={() => setError('')}><X size={14}/></IconButton></div>}
      {!bridge && <div className="error-banner">{t('请从 Electron 桌面窗口打开此应用。', 'Open this application in the Electron desktop window.')}</div>}
      <div className="conversation-shell">
        <div className="conversation" id="conversation-scroll" ref={scroll} onScroll={() => { if (scroll.current) { const distance = scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight; follow.current = distance < 100; setAwayFromBottom(distance > 120); } }}>
          {!data.messages.length ? <div className="empty-state"><div className="empty-symbol"><img src="./StepCode.svg" width="48" height="48" alt=""/></div><h1>{t('让想法阶跃星辰', 'Let ideas reach the stars')}</h1><p>{data.independent ? t('独立会话', 'Independent session') : data.preferences.workspace ? basename(data.preferences.workspace) : t('选择一个本地项目', 'Choose a local project')}</p><div className="empty-actions"><button disabled={!bridge || loading} onClick={() => void applySnapshot(() => bridge!.chooseWorkspace())}><FolderOpen size={16}/>{t('打开项目', 'Open project')}</button><button disabled={!bridge} onClick={() => void openSettings()}><SettingsIcon size={16}/>{t('账户设置', 'Account settings')}</button></div><span className="community-note">Desktop for Step Code · {t('独立社区项目', 'Independent community project')}</span></div> : <div className="messages"><ConversationMessages messages={data.messages} language={data.preferences.language} busy={busy} canEdit={connected && !busy && !loading} openImage={openImage} edit={editMessage} onError={setError}/>{busy && <div className="working"><span className="working-dot"/>{t('正在执行', 'Working')}</div>}<div ref={bottom}/></div>}
        </div>
        <ConversationMarkers scrollRef={scroll} turns={turns} language={data.preferences.language}/>
      </div>
      <div className="composer-wrap">
        {awayFromBottom && <IconButton title={t('回到底部', 'Scroll to bottom')} className="jump-to-bottom" onClick={() => { follow.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}><ArrowDown size={17}/></IconButton>}
        {draft.startsWith('/') && commands.filter(c => c.name.startsWith(draft.slice(1))).length > 0 && <div className="command-menu">{commands.filter(c => c.name.startsWith(draft.slice(1))).slice(0, 6).map(c => <button key={c.name} onClick={() => setDraft(`/${c.name} `)}><code>/{c.name}</code><span>{c.description}</span></button>)}</div>}
        <div className={`composer ${draggingFiles ? 'composer-file-drop' : ''}`}
          onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth.current++; setDraggingFiles(true); } }}
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
          onDragLeave={e => { e.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDraggingFiles(false); }}
          onDrop={e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); dragDepth.current = 0; setDraggingFiles(false); if (connected && !loading) void importFiles(Array.from(e.dataTransfer.files)); }}>
          {attachments.length > 0 && <div className="attachments" aria-label={t('待发送附件', 'Pending attachments')}>{attachments.map((item, i) => <div className={`attachment-card ${item.kind}`} key={item.kind === 'file' ? item.id : `${item.name}-${i}`}>
            {item.kind === 'image' ? <button type="button" className="attachment-open" aria-label={t(`预览 ${item.name}`, `Preview ${item.name}`)} onClick={e => openImage(`data:${item.content.mimeType};base64,${item.content.data}`, item.name, e.currentTarget)}><img src={`data:${item.content.mimeType};base64,${item.content.data}`} alt={item.name}/></button> : <div className="attachment-file"><FileText size={27}/><span>{item.name}</span><small>{t('本地文件引用', 'Local file reference')}</small></div>}
            <IconButton title={t('移除附件', 'Remove attachment')} tooltip={false} className="attachment-remove" onClick={() => { const next = attachmentsRef.current.filter((_, n) => n !== i); attachmentsRef.current = next; setAttachments(next); }}><X size={13}/></IconButton>
          </div>)}</div>}
          <textarea aria-label={t('消息', 'Message')} placeholder={connected ? t('你想做什么？', 'What would you like to work on?') : t('打开项目以开始', 'Open a project to begin')} value={draft} disabled={!connected || loading} onChange={e => setDraft(e.target.value)} onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void importFiles(files); } }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/>
          <div className="composer-tools">
            <IconButton title={t('添加附件', 'Add attachments')} disabled={!connected || attachments.length >= 10} onClick={() => void run(async () => addAttachments(await bridge!.chooseAttachments()))}><Plus size={17}/></IconButton>
            <PermissionPicker preset={data.permissionPreset} language={data.preferences.language} disabled={!connected || busy || loading} supported={commands.some(c => c.name === 'permissions' && c.source === 'extension')} onSelect={preset => command('set_permission_preset', { preset })}/>
            <div className="spacer"/>
            {busy && <IconButton title={t('停止', 'Stop')} className="stop-button" onClick={() => void command('abort')}><Square size={15}/></IconButton>}
            <ContextRing usage={data.stats?.contextUsage} language={data.preferences.language}/>
            <ModelEffortPicker model={data.state?.model} models={data.models} level={data.state?.thinkingLevel} levels={levels} language={data.preferences.language} disabled={!connected || busy || loading} onModel={m => command('set_model', { provider: m.provider, modelId: m.id })} onEffort={level => command('set_thinking_level', { level })}/>
            <IconButton title={busy ? t('加入队列', 'Queue message') : t('发送', 'Send')} className="send-button" disabled={!connected || (!draft.trim() && !attachments.length) || loading} onClick={() => void send()}><ArrowUp size={18}/></IconButton>
          </div>
        </div><PerformanceBar run={runMetrics} stats={data.stats} connected={connected} language={data.preferences.language} now={clock}/>
      </div>
      <ConversationScrollThumb scrollRef={scroll} language={data.preferences.language}
        sessionId={data.state?.sessionId} messageCount={data.messages.length}/>
    </main>
    {rightPanel && !details && <button type="button" className="right-panel-backdrop" aria-label={t('关闭右侧面板', 'Close right panel')} onClick={() => setRightPanel(null)}/>}
    {details ? <aside className="details-panel"><header><FileCode2 size={16}/>{t('详情', 'Details')}<IconButton title={t('关闭', 'Close')} onClick={() => setDetails('')}><X size={17}/></IconButton></header><pre>{details}</pre></aside> : rightPanel && <aside className="conversation-nav-panel" aria-label={rightPanel === 'turns' ? t('会话导航', 'Conversation navigation') : t('摘要', 'Summary')}>
      <header><h2>{rightPanel === 'turns' ? t('会话导航', 'Conversation navigation') : t('摘要', 'Summary')}</h2><IconButton title={t('关闭侧栏', 'Close panel')} onClick={() => setRightPanel(null)}><X size={16}/></IconButton></header>
      {rightPanel === 'turns' ? <nav aria-label={t('会话轮次', 'Conversation turns')}>
        {turns.map((turn, number) => <button key={turn.index} onClick={() => { scrollToTurn(scroll.current, turn.index); if (window.innerWidth <= 900) setRightPanel(null); }}><span>{number + 1}</span><span>{turn.preview}</span></button>)}
        {!turns.length && <p className="panel-empty">{t('暂无会话轮次', 'No turns yet')}</p>}
      </nav> : <p className="panel-empty">{t('暂无摘要', 'No summary yet')}</p>}
    </aside>}
    <nav className="right-tool-rail" aria-label={t('右侧工具', 'Right tools')}>
      <IconButton title={t('摘要', 'Summary')} data-tooltip-side="left" aria-pressed={!details && rightPanel === 'summary'} onClick={() => { setDetails(''); setRightPanel(value => value === 'summary' ? null : 'summary'); }}><Layers3 size={18}/></IconButton>
      <IconButton title={t('会话导航', 'Conversation navigation')} data-tooltip-side="left" aria-pressed={!details && rightPanel === 'turns'} onClick={() => { setDetails(''); setRightPanel(value => value === 'turns' ? null : 'turns'); }}><ListTree size={18}/></IconButton>
    </nav>
    {preview && <div className="attachment-preview-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closePreview(); }}>
      <div className="attachment-preview" ref={previewPanel} role="dialog" aria-modal="true" aria-label={t(`预览 ${preview.name}`, `Preview ${preview.name}`)}>
        <div className="attachment-preview-toolbar"><span>{preview.name}</span><IconButton title={t('缩小', 'Zoom out')} tooltip={false} disabled={previewZoom <= .5} onClick={() => changePreviewZoom(previewZoom - .25)}><ZoomOut size={17}/></IconButton><span>{Math.round(previewZoom * 100)}%</span><IconButton title={t('放大', 'Zoom in')} tooltip={false} disabled={previewZoom >= 5} onClick={() => changePreviewZoom(previewZoom + .25)}><ZoomIn size={17}/></IconButton><IconButton title={t('关闭预览', 'Close preview')} tooltip={false} onClick={closePreview}><X size={19}/></IconButton></div>
        <div className={`attachment-preview-image ${previewDragging ? 'dragging' : ''}`} ref={previewViewport}
          onPointerDown={e => {
            if (e.button !== 0 || previewClosing.current) return;
            previewDrag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, panX: previewPan.x, panY: previewPan.y };
            e.currentTarget.setPointerCapture(e.pointerId);
            setPreviewDragging(true);
            e.preventDefault();
          }}
          onPointerMove={e => {
            const drag = previewDrag.current;
            if (!drag || drag.pointerId !== e.pointerId) return;
            setPreviewPan({ x: drag.panX + e.clientX - drag.startX, y: drag.panY + e.clientY - drag.startY });
          }}
          onPointerUp={e => {
            if (previewDrag.current?.pointerId !== e.pointerId) return;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            previewDrag.current = null;
            setPreviewDragging(false);
          }}
          onPointerCancel={() => { previewDrag.current = null; setPreviewDragging(false); }}
          onWheel={e => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
            changePreviewZoom(previewZoom * factor, { x: e.clientX, y: e.clientY });
          }}>
          <img draggable={false} src={preview.src} alt={preview.name} style={{ transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${previewZoom})` }}/>
        </div>
      </div>
    </div>}
    {settingsOpen && <div className="modal-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-label={t('设置', 'Settings')}><header><h2>{t('设置', 'Settings')}</h2><IconButton title="Close" onClick={() => { setSettingsOpen(false); setKey(''); }}><X size={19}/></IconButton></header><div className="settings-layout"><nav>{[['account', Cpu, t('账户', 'Account')], ['mcp', Plug, 'MCP'], ['skills', BookOpen, t('资源', 'Resources')], ['general', SunMoon, t('通用', 'General')]].map(([id, Icon, title]: any) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}><Icon size={17}/>{title}</button>)}</nav><div className="settings-content">
      {settings && tab === 'mcp' && Object.keys(mcpFailures).length > 0 && <section className="mcp-failures" aria-label={t('本次窗口的 MCP 警告', 'MCP warnings in this window')}>
        <h3>{t('本次窗口的连接警告', 'Connection warnings')}</h3>
        {Object.entries(mcpFailures).map(([name, failure]) => <div className="resource-row" key={name}>
          <TriangleAlert size={17}/><div><strong>{name}</strong><small>{failure.message}</small>{failure.count > 1 && <small>{t(`出现 ${failure.count} 次`, `Occurred ${failure.count} times`)}</small>}</div>
        </div>)}
      </section>}
      {!settings ? <p>{t('加载中…', 'Loading…')}</p> : tab === 'account' ? <><h3>{t('Step 账户', 'Step account')}</h3><p className="muted">{settings.account.loggedIn ? `${settings.account.profile} · ${settings.account.validity}` : t('尚未登录', 'Not signed in')}</p><label>{t('登录方式', 'Sign-in method')}<select value={loginProfile} disabled={loggingIn} onChange={e => setLoginProfile(e.target.value)}>{settings.profiles.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>{settings.profiles.find(p => p.id === loginProfile)?.credentialSource === 'apiKey' && <label>API key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)}/></label>}<div className="button-row"><button className="primary" disabled={loggingIn || busy} onClick={() => void run(async () => { setLoggingIn(true); try { await bridge!.login(loginProfile, key); setKey(''); setSettings(await bridge!.settings()); if (data.preferences.workspace) await applySnapshot(() => bridge!.restart()); } finally { setLoggingIn(false); } })}><ExternalLink size={15}/>{loggingIn ? t('等待授权…', 'Waiting for sign-in…') : t('登录', 'Sign in')}</button>{loggingIn && <button onClick={() => void run(() => bridge!.cancelLogin())}>{t('取消', 'Cancel')}</button>}{settings.account.loggedIn && <button disabled={busy} onClick={() => void run(async () => { await bridge!.logout(); setSettings(await bridge!.settings()); await refresh(); })}><LogOut size={15}/>{t('退出登录', 'Sign out')}</button>}</div></> : tab === 'mcp' ? <><div className="section-heading"><h3>MCP servers</h3><IconButton title="Add MCP" onClick={() => setMcpEdit({ name: '', config: { command: '', args: [], enabled: true }, args: '[]', secrets: '{}' })}><Plus size={18}/></IconButton></div>{Object.entries(settings.mcp).map(([n, c]) => <div className="resource-row" key={n}><Plug size={18}/><div><strong>{n}</strong><small>{c.url || c.command}</small><small>{c.enabled ? t('已启用，重启后生效', 'Enabled; applies after restart') : t('已停用', 'Disabled')}</small></div><IconButton title="Edit" onClick={() => setMcpEdit({ name: n, original: n, config: c, args: JSON.stringify(c.args ?? []), secrets: '{}' })}><Pencil size={14}/></IconButton><IconButton title="Remove" onClick={() => { if (confirm(t(`移除 ${n}？`, `Remove ${n}?`))) void run(async () => { await bridge!.saveMcp(n, null); setSettings(await bridge!.settings()); }); }}><Trash2 size={14}/></IconButton></div>)}{!Object.keys(settings.mcp).length && <p className="muted">{t('尚未配置服务器', 'No servers configured')}</p>}<button disabled={!connected || busy} onClick={() => void applySnapshot(() => bridge!.restart())}><RotateCcw size={15}/>{t('重启并应用', 'Restart to apply')}</button></> : tab === 'skills' ? <><h3>{t('Skills 与命令', 'Skills and commands')}</h3>{settings.skills.map(s => <div className="resource-row" key={`${s.source}/${s.name}`}><BookOpen size={17}/><div><strong>{s.name}</strong><small>{s.description}</small><small>{s.source}</small></div></div>)}{commands.map(c => <div className="resource-row" key={c.name}><Terminal size={17}/><div><strong>/{c.name}</strong><small>{c.description}</small><small>{c.source}</small></div></div>)}{!settings.skills.length && !commands.length && <p className="muted">{t('没有已发现的资源', 'No resources discovered')}</p>}</> : <><h3>{t('外观与语言', 'Appearance and language')}</h3><label>{t('主题', 'Theme')}<select value={data.preferences.theme} onChange={e => void setPreference({ theme: e.target.value })}><option value="system">{t('跟随系统', 'System')}</option><option value="light">{t('浅色', 'Light')}</option><option value="dark">{t('深色', 'Dark')}</option></select></label><label>{t('语言', 'Language')}<select value={data.preferences.language} onChange={e => void setPreference({ language: e.target.value })}><option value="zh">简体中文</option><option value="en">English</option></select></label><h3>{t('关于', 'About')}</h3><p>Desktop for Step Code 0.1.0</p><p className="muted">{t('社区预览版', 'Community preview')}</p><button onClick={() => void run(() => bridge!.diagnostics())}><Download size={15}/>{t('导出脱敏诊断', 'Export diagnostics')}</button></>}
    </div></div></section></div>}
    {mcpEdit && <div className="modal-backdrop higher"><section className="small-dialog" role="dialog" aria-modal="true" aria-label="MCP"><header><h2>MCP server</h2><IconButton title="Close" onClick={() => setMcpEdit(null)}><X size={18}/></IconButton></header><label>{t('名称', 'Name')}<input value={mcpEdit.name} disabled={Boolean(mcpEdit.original)} onChange={e => setMcpEdit({ ...mcpEdit, name: e.target.value })}/></label><label>{t('传输', 'Transport')}<select value={mcpEdit.config.url !== undefined ? 'http' : 'stdio'} onChange={e => setMcpEdit({ ...mcpEdit, config: e.target.value === 'http' ? { url: '', enabled: true } : { command: '', args: [], enabled: true } })}><option value="stdio">stdio</option><option value="http">HTTP</option></select></label>{mcpEdit.config.url !== undefined ? <label>URL<input value={mcpEdit.config.url} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, url: e.target.value } })}/></label> : <><label>{t('可执行文件', 'Executable')}<input value={mcpEdit.config.command ?? ''} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, command: e.target.value } })}/></label><label>{t('参数（JSON 数组）', 'Arguments (JSON array)')}<textarea value={mcpEdit.args} onChange={e => setMcpEdit({ ...mcpEdit, args: e.target.value })}/></label></>}<label>{t('新增或替换环境变量（JSON）', 'Add or replace environment variables (JSON)')}<textarea value={mcpEdit.secrets} onChange={e => setMcpEdit({ ...mcpEdit, secrets: e.target.value })}/></label><label className="checkbox"><input type="checkbox" checked={mcpEdit.config.enabled !== false} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, enabled: e.target.checked } })}/>{t('启用', 'Enabled')}</label><button className="primary" onClick={() => void saveMcp()}>{t('保存', 'Save')}</button></section></div>}
    {(requests[0] || renaming) && <div className="modal-backdrop higher"><section className="small-dialog" role="dialog" aria-modal="true" aria-label={requests[0]?.title ?? 'Rename'}><h2>{requests[0]?.title ?? (renameTarget?.type === 'workspace' ? t('重命名项目', 'Rename project') : t('重命名会话', 'Rename session'))}</h2>{requests[0]?.message && <p>{requests[0].message}</p>}{renaming ? <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void run(saveRename); }}/> : requests[0].method === 'select' ? requests[0].options?.map(o => <button className="option" key={o} onClick={() => void respond({ value: o })}>{o}</button>) : requests[0].method !== 'confirm' ? <textarea autoFocus placeholder={requests[0].placeholder} value={answer} onChange={e => setAnswer(e.target.value)}/> : null}<div className="button-row"><button onClick={() => renaming ? (setRenaming(false), setRenameTarget(null)) : void respond({ cancelled: true })}>{t('取消', 'Cancel')}</button>{(renaming || requests[0]?.method !== 'select') && <button className="primary" disabled={renaming && (!name.trim() || busy || loading)} onClick={() => { if (renaming) void run(saveRename); else void respond(requests[0].method === 'confirm' ? { confirmed: true } : { value: answer }); }}>{t('确认', 'Confirm')}</button>}</div></section></div>}
  </div>;
}
class RenderBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <><WindowBar language="zh" sidebarVisible={false} toggleSidebar={() => {}} menus={[]}/><div className="empty-state" role="alert"><h1>界面暂时无法显示 / Display error</h1><p>重新加载界面不会重新发送任务。 / Reloading does not resend your task.</p><button onClick={() => location.reload()}>重新加载 / Reload</button></div></>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<RenderBoundary><App/></RenderBoundary>);
