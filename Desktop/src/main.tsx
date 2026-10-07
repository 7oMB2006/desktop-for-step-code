import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ArrowDown, Plus, Folder, FolderOpen, MessageSquare, Settings as SettingsIcon, PanelLeft, X, Search, ChevronDown, ChevronRight, Terminal, Copy, Check, RotateCcw, Trash2, Pencil, Cpu, AlertCircle, TriangleAlert, Info, Download, Plug, BookOpen, LogOut, SunMoon, ExternalLink, FileCode2, Archive, GitBranch, MoreHorizontal, ListTree, Layers3, FileText, ZoomIn, ZoomOut, Pin, PinOff, ScanLine, FileDiff, Globe, Bot } from 'lucide-react';
import type { Snapshot, Settings, Message, Content, UIRequest, McpServer, Session, ComposerAttachment, RuntimeSummary } from './contracts';
import 'katex/dist/katex.min.css';
import './style.css';
import './layout.css';
import { applyMessageEvent, applyToolResult } from './message-events';
import { MessageRevision } from './message-revision';
import { WindowBar, type WindowMenu } from './WindowBar';
import { NoticeToast, type NoticeToastItem } from './NoticeToast';
import { PerformanceBar } from './PerformanceBar';
import { ModelEffortPicker } from './ModelEffortPicker';
import { PermissionPicker } from './PermissionPicker';
import { PermissionApproval } from './PermissionApproval';
import { permissionApprovalPresentation } from './approval-presentation';
import { ContextRing } from './ContextRing';
import { ImageContextMenu, type ImageMenuTarget, type ImageMenuAction } from './ImageContextMenu';
import { AppTooltip } from './AppTooltip';
import { ConversationMarkers, ConversationNavigationPanel, conversationTurns, scrollToTurn } from './ConversationNavigation';
import { ArchivedSessions } from './ArchivedSessions';
import { ConversationScrollThumb } from './ConversationScrollThumb';
import { updateRunMetrics, type RunMetrics } from './performance';
import { ConversationMessages, PendingUserMessages } from './ConversationMessages';
import { messageBlocks, messageText } from './conversation-presentation';
import { ComposerActionIcon } from './ComposerActionIcon';
import { composerAction } from './composer-action';
import { SelectionToolbar } from './SelectionToolbar';
import { QuotePreview } from './QuotePreview';
import { MAX_QUOTES, MAX_PROMPT_LENGTH, quotePrompt, restoreQuotes, type ChatQuote } from './chat-quotes';
import { playCompletionSound } from './completion-sound';
import { sessionReference } from './session-reference';
import { moveSession, orderSessions, reconcileSessionOrder } from './sidebar-order';
import { useSidebarReorder } from './use-sidebar-reorder';
import { ContextPanel } from './ContextPanel';
import { LiveTurnChanges } from './LiveTurnChanges';
import { QueuePreview } from './QueuePreview';
import { ComposerContextBar } from './ComposerContextBar';
import { ReviewPanel } from './ReviewPanel';
import { SummaryBoard } from './SummaryBoard';
import { AccountSettings, ProviderIcon, ProviderSettings, StepPlatformIcon } from './AccountSettings';
import { NewSession } from './NewSession';
import { TerminalPanel } from './TerminalPanel';
import { BrowserPanel } from './BrowserPanel';
import { SubagentPanel } from './SubagentPanel';
import type { SubagentTask, SubagentTaskKey } from './conversation-presentation';
import { findSubagentTask } from './conversation-presentation';

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
  const messageRevision = useRef(new MessageRevision());
  const latestData = useRef(data);
  latestData.current = data;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<NoticeToastItem | null>(null);
  const [mcpFailures, setMcpFailures] = useState<Record<string, { message: string; count: number }>>({});
  const notifiedMcp = useRef(new Set<string>());
  const sessionActivity = useRef(new Map<string, RuntimeSummary['status']>());
  const nextNoticeId = useRef(0);
  const [draft, setDraft] = useState('');
  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const quoteScope = `${data.preferences.workspace ?? ''}:${data.state?.sessionId ?? ''}`;
  const quoteScopeRef = useRef(quoteScope);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const queueSend = useRef<Promise<{ queued?: boolean; id?: string; version?: number }> | null>(null);
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
  const [arrivingUser, setArrivingUser] = useState<Message | null>(null);
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);
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
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const firstSend = useRef(false);
  const [queuePreviewOpen, setQueuePreviewOpen] = useState(false);
  const [liveChangesOpen, setLiveChangesOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState<'auto' | 'turns' | 'summary' | 'context' | 'review' | 'terminal' | 'browser' | 'subagent' | null>('auto');
  const [expandedRightPanel, setExpandedRightPanel] = useState<'context' | 'review' | 'terminal' | 'browser' | 'subagent' | null>(null);
  const [selectedSubagent, setSelectedSubagent] = useState<SubagentTaskKey | null>(null);
  const [repositoryRequest, setRepositoryRequest] = useState<{ runtimeId?: string; sequence: number }>();
  // The panel reads from live messages, so a subagent that finishes while it stays open keeps
  // updating instead of freezing on the status captured when the row was clicked.
  const openSubagentTask = useMemo(() => findSubagentTask(data.messages, selectedSubagent), [data.messages, selectedSubagent]);
  const openSubagent = useCallback((task: SubagentTask) => {
    const alreadyOpen = rightPanel === 'subagent' && !details
      && selectedSubagent?.toolCallId === task.toolCallId && selectedSubagent?.taskIndex === task.taskIndex
      && selectedSubagent?.agent === task.agent && selectedSubagent.task === task.task;
    setSelectedSubagent({ agent: task.agent, task: task.task, toolCallId: task.toolCallId, taskIndex: task.taskIndex });
    setDetails('');
    setRightPanel(alreadyOpen ? null : 'subagent');
  }, [rightPanel, details, selectedSubagent]);
  const [summarySpace, setSummarySpace] = useState(false);
  const appLayout = useRef<HTMLDivElement>(null);
  const rightRail = useRef<HTMLElement>(null);
  const [requests, setRequests] = useState<UIRequest[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(true);
  const [answer, setAnswer] = useState('');
  const [levels, setLevels] = useState<string[]>([]);
  const [commands, setCommands] = useState<{ name: string; description?: string; source?: string }[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ type: 'session' | 'workspace'; id: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ type: 'session' | 'workspace'; id: string; x: number; y: number } | null>(null);
  const manualOrder = data.preferences.sessionSort !== 'updated';
  const reorderSession = (id: string, target: string, after: boolean) => {
    const order = reconcileSessionOrder(data.preferences.sessionOrder ?? [], data.sessions);
    void setPreference({ sessionOrder: moveSession(order, id, target, after) });
  };
  const reorderWorkspace = (id: string, target: string, after: boolean) => {
    const pinned = data.preferences.pinnedWorkspaces ?? [];
    if (pinned.includes(id)) void setPreference({ pinnedWorkspaces: moveSession(pinned, id, target, after) });
    else {
      const paths = data.preferences.workspaces;
      const keys = moveSession(paths.map(workspaceKey), id, target, after);
      void setPreference({ workspaces: keys.map(key => paths.find(path => workspaceKey(path) === key)!) });
    }
  };
  const sessionDrag = useSidebarReorder(!loading && (compactSidebar ? compactSidebarOpen : sidebar), manualOrder,
    (id, target, after, kind) => kind === 'session' ? reorderSession(id, target, after) : reorderWorkspace(id, target, after));
  const [name, setName] = useState('');
  const [loginProfile, setLoginProfile] = useState('step_plan');
  const [key, setKey] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [mcpEdit, setMcpEdit] = useState<{ name: string; original?: string; config: McpServer; args: string; secrets: string } | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const viewId = useRef<string | undefined>(undefined);
  const switching = useRef(false);
  const metricsBySession = useRef(new Map<string, RunMetrics | null>());
  const composerBySession = useRef(new Map<string, { draft: string; quotes: ChatQuote[]; attachments: ComposerAttachment[]; follow: boolean; top: number }>());
  const errorsBySession = useRef(new Map<string, string>());
  const view = useRef({ runtimeId: data.runtimeId, sessionId: data.state?.sessionId, draftId: data.draftId, draft, quotes, attachments });
  view.current = { runtimeId: data.runtimeId, sessionId: data.state?.sessionId, draftId: data.draftId, draft, quotes, attachments };
  useLayoutEffect(() => { quoteScopeRef.current = quoteScope; }, [quoteScope]);
  const followLayout = useCallback(() => {
    const viewport = scroll.current;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode && transcript.current?.contains(selection.anchorNode)) return;
    if (follow.current && viewport) viewport.scrollTop = viewport.scrollHeight;
  }, []);
  const sidebarVisible = compactSidebar ? compactSidebarOpen : sidebar;
  const visibleRightPanel = rightPanel === 'auto' ? (summarySpace ? 'summary' : null) : rightPanel;
  const inspectionOpen = visibleRightPanel === 'summary' || visibleRightPanel === 'context';
  const summaryOverlay = inspectionOpen && !summarySpace;
  const inspectorExpanded = expandedRightPanel === visibleRightPanel && !details &&
    (visibleRightPanel === 'context' || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || visibleRightPanel === 'subagent');
  useEffect(() => {
    if (expandedRightPanel && (expandedRightPanel !== visibleRightPanel || details)) setExpandedRightPanel(null);
  }, [expandedRightPanel, visibleRightPanel, details]);
  useLayoutEffect(() => {
    const app = appLayout.current;
    if (!app) return;
    const measure = () => {
      const sidebarTrack = parseFloat(getComputedStyle(app).getPropertyValue('--sidebar-track')) || 0;
      // Leave a readable conversation column beside the board and its open gutter.
      setSummarySpace(app.clientWidth - sidebarTrack - 44 >= 1120);
    };
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let motions: Animation[] = [];
    const resize = () => {
      const elements = [...app.querySelectorAll<HTMLElement>('.conversation-shell, .composer-wrap, main > .conversation-scroll-track')];
      const centers = elements.map(element => {
        const rect = element.getBoundingClientRect();
        return rect.x + rect.width / 2;
      });
      motions.forEach(animation => animation.cancel());
      motions = [];
      // Native resizing already changes the viewport. Rewrap once, then animate
      // only the reading column's displacement instead of its layout width.
      app.dataset.nativeResize = '';
      flushSync(measure);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const offsets = elements.map((element, index) => {
          const rect = element.getBoundingClientRect();
          return centers[index] - rect.x - rect.width / 2;
        });
        motions = elements.flatMap((element, index) => Math.abs(offsets[index]) < .5 ? [] : [
          element.animate([{ transform: `translateX(${offsets[index]}px)` }, { transform: 'translateX(0px)' }],
            { duration: 320, easing: 'cubic-bezier(.25, .46, .45, .94)' }),
        ]);
      }
      clearTimeout(quiet);
      quiet = setTimeout(() => { delete app.dataset.nativeResize; }, 180);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(app);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      clearTimeout(quiet);
      motions.forEach(animation => animation.cancel());
      delete app.dataset.nativeResize;
    };
  }, [sidebarVisible, compactSidebar]);
  const closeRightPanel = useCallback(() => {
    setExpandedRightPanel(null);
    setRightPanel(null);
    rightRail.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, []);
  useEffect(() => {
    if (!visibleRightPanel || details || settingsOpen || preview || requests.length || renaming) return;
    const escape = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('.xterm')) return;
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (inspectorExpanded) {
          event.preventDefault();
          setExpandedRightPanel(null);
          document.getElementById(`${visibleRightPanel}-panel`)
            ?.querySelector<HTMLButtonElement>('.right-panel-header button[aria-pressed]')?.focus();
        } else closeRightPanel();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [visibleRightPanel, details, settingsOpen, preview, requests.length, renaming, closeRightPanel, inspectorExpanded]);
  const zh = data.preferences.language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const connected = data.status === 'connected' || data.status === 'ready';
  const anyBusy = data.runtimes?.some(runtime => runtime.status === 'running' || runtime.status === 'waiting') ?? busy;
  const action = composerAction(busy, draft, attachments.length + quotes.length);
  const current = data.sessions.find(s => s.id === data.state?.sessionId);
  const queuedMessages = useMemo(() => data.pendingMessages?.filter(item => !item.sending) ?? [], [data.pendingMessages]);
  const hasPendingReceipt = data.pendingMessages?.some(item => item.sending);
  const activeTitle = sessionTitle(current ?? (data.state?.sessionName ? { name: data.state.sessionName, firstMessage: '' } : undefined), t('新会话', 'New session'));
  const turns = useMemo(() => conversationTurns(data.messages, data.preferences.language), [data.messages, data.preferences.language]);
  const workspaceTitle = (path: string) => data.preferences.workspaceNames?.[workspaceKey(path)] || basename(path);
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => { try { setError(''); return await action(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } };
  const installSnapshot = (value: Snapshot) => {
    if (!messageRevision.current.acceptSnapshot(value)) return;
    const previous = view.current;
    if (previous.runtimeId !== value.runtimeId) {
      if (previous.sessionId) composerBySession.current.set(previous.sessionId, {
        draft: previous.draft, quotes: previous.quotes, attachments: previous.attachments,
        follow: follow.current, top: scroll.current?.scrollTop ?? 0,
      });
      const saved = value.state?.sessionId ? composerBySession.current.get(value.state.sessionId) : undefined;
      setDraft(saved?.draft ?? ''); setQuotes(saved?.quotes ?? []);
      setAttachments(saved?.attachments ?? []); attachmentsRef.current = saved?.attachments ?? [];
      setArrivingUser(null); setError(value.state?.sessionId ? errorsBySession.current.get(value.state.sessionId) ?? '' : ''); setNotice(value => value?.icon ? value : null); setDetails('');
      if (value.state?.sessionId) errorsBySession.current.delete(value.state.sessionId);
      stoppingRef.current = false; setStopping(false);
      follow.current = saved?.follow ?? true;
      setAwayFromBottom(!follow.current);
      if (saved && !saved.follow) requestAnimationFrame(() => { if (viewId.current === value.runtimeId && scroll.current) scroll.current.scrollTop = saved.top; });
    }
    viewId.current = value.runtimeId;
    setData(value); setBusy(Boolean(value.state?.isStreaming));
    setRequests(value.requests ?? []);
    setRunMetrics(value.state?.sessionId ? metricsBySession.current.get(value.state.sessionId) ?? null : null);
  };
  const refresh = async () => {
    if (!bridge) return;
    const id = viewId.current;
    const value = await bridge.snapshot();
    if (!switching.current && id === viewId.current && (!id || value.runtimeId === id)) installSnapshot(value);
  };
  const applySnapshot = async (action: () => Promise<Snapshot | null>) => {
    // A subagent record belongs to the session that spawned it; switching must not leave it open.
    setSelectedSubagent(null);
    if (switching.current) return;
    switching.current = true; setLoading(true);
    let succeeded = false;
    await run(async () => { const result = await action(); if (result) installSnapshot(result); succeeded = true; });
    switching.current = false; setLoading(false);
    // Include events that arrived between the navigation snapshot and its paint.
    if (succeeded) void run(refresh);
  };
  const command = async (type: string, args?: Record<string, unknown>) => run(async () => {
    const id = viewId.current;
    const result = await bridge!.command(type, args, id);
    if (type === 'new_session') installSnapshot(result);
    else if (!['prompt', 'abort', 'extension_ui_response'].includes(type) && id === viewId.current) await refresh();
    return result;
  });
  useEffect(() => {
    void run(refresh).finally(() => setLoading(false));
    if (!bridge) return;
    const unsubscribe = bridge.onEvent(event => {
      if (event.type === 'desktop_task_completed') { playCompletionSound(); return; }
      if (event.type === 'desktop_sessions_changed') { void run(refresh); return; }
      if (event.type === 'desktop_runtimes') {
        const runtimes: RuntimeSummary[] = event.runtimes;
        for (const runtime of runtimes) sessionActivity.current.set(runtime.sessionId, runtime.status);
        setData(previous => ({ ...previous, runtimes, unreadSessionIds: event.unreadSessionIds ?? [], sessions: previous.sessions.map(session => {
          const runtime = runtimes.find(runtime => runtime.sessionId === session.id);
          return runtime ? { ...session, firstMessage: runtime.firstMessage || session.firstMessage, name: runtime.name ?? session.name } : session;
        }) }));
        return;
      }
      if (['agent_start', 'turn_start', 'tool_execution_start', 'tool_execution_end', 'message_update', 'message_end', 'agent_end'].includes(event.type)) {
        const receivedAt = performance.now();
        const id = event.sessionId ?? view.current.sessionId;
        if (id) metricsBySession.current.set(id, updateRunMetrics(metricsBySession.current.get(id) ?? null, event, receivedAt));
        if (!event.runtimeId || event.runtimeId === viewId.current) {
          if (event.type === 'agent_start') setClock(receivedAt);
          setRunMetrics(id ? metricsBySession.current.get(id) ?? null : null);
        }
      }
      if (event.type === 'extension_ui_request' && event.method === 'set_editor_text') {
        if (!event.runtimeId || event.runtimeId === viewId.current) {
          view.current = { ...view.current, draft: event.text };
          setDraft(event.text);
        } else if (event.sessionId) {
          const saved = composerBySession.current.get(event.sessionId);
          composerBySession.current.set(event.sessionId, {
            draft: event.text, quotes: saved?.quotes ?? [], attachments: saved?.attachments ?? [],
            follow: saved?.follow ?? true, top: saved?.top ?? 0,
          });
        }
        return;
      }
      if (event.runtimeId && (event.runtimeId !== viewId.current || switching.current)) return;
      if (['desktop_queue', 'desktop_history', 'message_start', 'message_update', 'message_end', 'tool_execution_update', 'tool_execution_end'].includes(event.type)
        && !messageRevision.current.acceptEvent(event)) return;
      if (event.type === 'desktop_queue') setData(d => ({ ...d, pendingMessages: event.pendingMessages }));
      if (event.type === 'desktop_history') setData(d => ({ ...d, messages: event.messages }));
      if (event.type === 'desktop_ui_expired') setRequests(previous => previous.filter(request => request.id !== event.id));
      if (event.type === 'agent_start') setBusy(true);
      if (event.type === 'agent_end') { setBusy(false); stoppingRef.current = false; setStopping(false); void run(refresh); }
      if (event.type === 'desktop_exit') { setBusy(false); stoppingRef.current = false; setStopping(false); setRunMetrics(null); setNotice(null); setData(d => ({ ...d, status: 'disconnected', stats: undefined, permissionPreset: undefined })); setRequests([]); }
      if (event.type === 'desktop_permission') setData(d => ({ ...d, permissionPreset: event.preset }));
      if (event.type === 'desktop_status') {
        if (event.status === 'connecting') notifiedMcp.current.clear();
        setData(d => ({ ...d, status: event.status }));
      }
      if (event.type === 'desktop_error') setError(event.message);
      if (event.type === 'desktop_system_theme') setSystemDark(Boolean(event.dark));
      if (['message_start', 'message_end'].includes(event.type) && event.message?.role === 'user') setArrivingUser(event.message);
      if (['message_start', 'message_update', 'message_end', 'agent_end', 'desktop_exit'].includes(event.type)) setData(d => ({ ...d, messages: applyMessageEvent(d.messages, event) }));
      if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
        setData(d => ({ ...d, messages: applyToolResult(d.messages, event) }));
      }
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
    if (!connected || !data.runtimeId) { setLevels(data.state?.model?.thinkingLevels ?? []); setCommands([]); return; }
    const id = data.runtimeId;
    void run(async () => {
      const [effort, available] = await Promise.all([bridge!.command('get_available_thinking_levels', undefined, id), bridge!.command('get_commands', undefined, id)]);
      if (viewId.current === id) { setLevels(effort.levels); setCommands(available.commands.filter((c: { name: string }) => c.name !== '_desktop_retry')); }
    });
  }, [connected, data.runtimeId, data.state?.model?.id]);
  useLayoutEffect(followLayout, [data.messages, data.pendingMessages, busy, followLayout]);
  useLayoutEffect(() => {
    const viewport = scroll.current;
    const content = transcript.current;
    if (!viewport || !content) return;
    // ResizeObserver runs before paint, including disclosure and Markdown reflows.
    const observer = new ResizeObserver(followLayout);
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [data.messages.length > 0, followLayout]);
  useEffect(() => {
    const input = document.querySelector<HTMLTextAreaElement>('.composer > textarea');
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
  }, [draft]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const openImage = useCallback((src: string, name: string, anchor: HTMLElement) => {
    previewTrigger.current = anchor;
    previewAnchorRect.current = (anchor.querySelector('img') ?? anchor).getBoundingClientRect();
    previewClosing.current = false;
    previewDrag.current = null;
    setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }); setPreviewDragging(false);
    setPreview({ src, name });
  }, []);
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
  useEffect(() => { setAnswer(requests[0]?.prefill ?? ''); setApprovalOpen(true); }, [requests[0]?.id, data.runtimeId]);
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
    if (!settingsOpen && !mcpEdit && !(requests.length && approvalOpen) && !renaming) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
    const controls = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])];
    controls()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = controls(); if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [settingsOpen, Boolean(mcpEdit), requests[0]?.id, approvalOpen, renaming, tab]);
  const respond = async (value: Record<string, unknown>) => {
    const r = requests[0]; if (!r) return;
    await run(async () => { await bridge!.command('extension_ui_response', { id: r.id, ...value }, r.runtimeId ?? viewId.current); setRequests(q => q.filter(v => v.id !== r.id)); });
  };
  const loginProfileRevision = useRef(0);
  const settingsRequestRevision = useRef(0);
  const chooseLoginProfile = (profile: string) => {
    loginProfileRevision.current++;
    setLoginProfile(profile);
  };
  const openSettings = async () => {
    const request = ++settingsRequestRevision.current;
    const selection = loginProfileRevision.current;
    setSettingsOpen(true); await run(async () => {
    const next = await bridge!.settings();
    if (request !== settingsRequestRevision.current) return;
    setSettings(next);
    if (selection === loginProfileRevision.current && next.account.profile && next.profiles.some(profile => profile.id === next.account.profile)) setLoginProfile(next.account.profile);
  }); };
  const addAttachments = (added: ComposerAttachment[], id = view.current.sessionId ?? view.current.draftId) => {
    const background = id && id !== (view.current.sessionId ?? view.current.draftId);
    if (background && !latestData.current.sessions.some(session => session.id === id)) return;
    const saved = background ? composerBySession.current.get(id) : undefined;
    const previous = background ? saved?.attachments ?? [] : attachmentsRef.current;
    const next = [...previous, ...added];
    if (next.length > 10 || next.filter(item => item.kind === 'image').length > 5) throw new Error(t('最多添加 10 个附件，其中图片最多 5 张', 'Maximum 10 attachments, including 5 images'));
    if (background) composerBySession.current.set(id, {
      draft: saved?.draft ?? '', quotes: saved?.quotes ?? [], attachments: next,
      follow: saved?.follow ?? true, top: saved?.top ?? 0,
    });
    else { attachmentsRef.current = next; setAttachments(next); }
  };
  const importFiles = async (files: File[]) => run(async () => {
    const id = view.current.sessionId ?? view.current.draftId;
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
    addAttachments(added, id);
  });
  const stop = async () => {
    if (!busy || !connected || stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    const id = viewId.current;
    await run(async () => {
      try { await bridge!.command('abort', undefined, id); }
      catch (error) { if (viewId.current === id) { stoppingRef.current = false; setStopping(false); throw error; } }
    });
  };
  const send = async () => {
    if ((!draft.trim() && !attachments.length && !quotes.length) || !connected || loading || firstSend.current) return;
    const message = draft; const attached = attachments; const sentQuotes = quotes; const scope = quoteScope;
    let id = viewId.current;
    let sessionId = data.state?.sessionId;
    let deliveryScope = scope;
    if (sessionId) errorsBySession.current.delete(sessionId);
    const prompt = quotePrompt(message, sentQuotes, data.preferences.language);
    if (prompt.length > MAX_PROMPT_LENGTH) {
      setError(t('消息与引用合计过长，请减少引用或分次发送', 'Message and quotes are too long; remove quotes or send in smaller parts'));
      return;
    }
    setDraft(''); setQuotes([]); setAttachments([]); attachmentsRef.current = []; follow.current = true; setAwayFromBottom(false);
    await run(async () => {
      try {
        if (data.draftId) {
          firstSend.current = true; switching.current = true; setLoading(true);
          try {
            const created = await bridge!.createDraftSession(data.draftId);
            installSnapshot(created);
            id = created.runtimeId;
            sessionId = created.state?.sessionId;
            deliveryScope = `${created.preferences.workspace ?? ''}:${sessionId ?? ''}`;
            quoteScopeRef.current = deliveryScope;
          } finally {
            firstSend.current = false; switching.current = false; setLoading(false);
          }
        }
        const submission = bridge!.command('prompt', { message: prompt, images: attached.filter(item => item.kind === 'image').map(item => item.content), files: attached.filter(item => item.kind === 'file').map(item => item.id) }, id);
        if (busy) queueSend.current = submission;
        try { await submission; } finally { if (queueSend.current === submission) queueSend.current = null; }
      } catch (e) {
        if (quoteScopeRef.current !== deliveryScope) {
          if (sessionId) {
            const saved = composerBySession.current.get(sessionId);
            errorsBySession.current.set(sessionId, String(e instanceof Error ? e.message : e));
            composerBySession.current.set(sessionId, {
              draft: saved?.draft ? `${message}\n${saved.draft}` : message,
              quotes: restoreQuotes(sentQuotes, saved?.quotes ?? []),
              attachments: [...attached, ...saved?.attachments ?? []],
              follow: saved?.follow ?? true, top: saved?.top ?? 0,
            });
          }
          return;
        }
        setDraft(value => value ? `${message}\n${value}` : message);
        setQuotes(value => restoreQuotes(sentQuotes, value));
        setAttachments(value => { const restored = [...attached, ...value]; attachmentsRef.current = restored; return restored; });
        throw e;
      }
    });
  };
  const queueAction = async (type: 'queue_edit' | 'queue_remove' | 'queue_steer', item: import('./contracts').PendingMessage, message?: string) => {
    if (!bridge || !viewId.current || loading) return;
    try { await bridge.command(type, { id: item.id, version: item.version, ...(message === undefined ? {} : { message }) }, viewId.current); }
    catch (error) { setError(String(error instanceof Error ? error.message : error)); throw error; }
  };
  const shortcutSteer = async () => {
    const runtimeId = viewId.current;
    try {
      const pendingSend = queueSend.current;
      if (pendingSend) await pendingSend;
      if (!runtimeId || runtimeId !== viewId.current || view.current.draft.trim() || view.current.attachments.length || view.current.quotes.length) return;
      await bridge!.command('queue_steer_first', undefined, runtimeId);
    } catch (error) { if (runtimeId === viewId.current) setError(String(error instanceof Error ? error.message : error)); }
  };
  const branchMessage = async (message: Message) => {
    if (!bridge || !message.entryId || !viewId.current || !connected || busy || loading) return;
    const id = viewId.current;
    await createBranch(() => bridge.branchSession('clone', message.entryId!, id));
  };
  const createBranch = async (action: () => Promise<Snapshot | null>) => {
    await applySnapshot(async () => {
      const result = await action();
      if (result) setNotice({ id: ++nextNoticeId.current, message: t('已创建分支会话', 'Branch session created'), type: 'info', icon: 'branch' });
      return result;
    });
  };
  const editMessage = async (message: Message, text: string) => {
    if (!bridge || !message.entryId || !viewId.current || !connected || busy || loading) throw new Error(t('会话暂时无法编辑', 'This conversation cannot be edited right now'));
    const id = viewId.current;
    setError('');
    await bridge.retryMessage(message.entryId, text, id);
    if (viewId.current === id) await refresh();
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
  const visibleSessions = orderSessions(data.sessions.filter(session => !archived.has(session.id)), data.preferences);
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
  const updateArchive = async (id: string, restore: boolean, transitionFrom?: number) => {
    setContextMenu(null);
    await run(async () => {
      const ids = latestData.current.preferences.archivedSessionIds ?? [];
      const next = restore ? ids.filter(value => value !== id) : [...new Set([...ids, id])];
      const preferences = await bridge!.preferences({ archivedSessionIds: next });
      latestData.current = { ...latestData.current, preferences };
      setData(previous => ({ ...previous, preferences }));
      const noticeId = ++nextNoticeId.current;
      setNotice({
        id: noticeId, message: restore ? t('会话已恢复', 'Session restored') : t('已归档会话', 'Session archived'),
        type: restore ? 'success' : 'info', icon: restore ? 'restored' : 'archive', transitionFrom,
        actions: restore ? undefined : [
          { label: t('查看', 'View'), onClick: () => { setNotice(null); setTab('archived'); return openSettings(); } },
          { label: t('撤销', 'Undo'), primary: true, onClick: () => updateArchive(id, true, noticeId) },
        ],
      });
    });
  };
  const deleteArchived = async (ids: string[]) => {
    await run(async () => {
      if (!await bridge!.deleteArchivedSessions(ids)) return;
      for (const id of ids) {
        composerBySession.current.delete(id);
        errorsBySession.current.delete(id);
        metricsBySession.current.delete(id);
        sessionActivity.current.delete(id);
      }
      await refresh();
    });
  };
  const saveRename = async () => {
    if (!renameTarget || !name.trim()) return;
    if (renameTarget.type === 'workspace') {
      const names = { ...data.preferences.workspaceNames, [workspaceKey(renameTarget.id)]: name.trim() };
      const preferences = await bridge!.preferences({ workspaceNames: names });
      setData(previous => ({ ...previous, preferences }));
    } else {
      if (data.state?.sessionId !== renameTarget.id) {
        await applySnapshot(() => bridge!.switchSession(renameTarget.id));
      }
      await bridge!.command('set_session_name', { name: name.trim() }, viewId.current);
      await refresh();
    }
    setRenaming(false);
    setRenameTarget(null);
  };
  const pinnedWorkspaces = new Set(data.preferences.pinnedWorkspaces ?? []);
  const renderSession = (s: Session, group: string) => {
    const status = data.runtimes?.find(runtime => runtime.sessionId === s.id)?.status ?? sessionActivity.current.get(s.id) ?? 'idle';
    const activity = status === 'idle' || status === 'completed' ? data.unreadSessionIds?.includes(s.id) ? 'completed' : 'idle' : status;
    const label = activity === 'waiting' ? t('等待确认', 'Awaiting approval') : activity === 'failed' || activity === 'interrupted' ? t('任务已终止', 'Task interrupted') : activity === 'completed' ? t('有未读回复', 'Unread reply') : t('正在运行', 'Running');
    return <div key={s.id} data-reorder-id={s.id} data-reorder-kind="session" data-reorder-group={group} data-reorder-title={sessionTitle(s, t('新会话', 'New session'))}
      className={`session-row ${s.id === data.state?.sessionId ? 'selected' : ''} ${sessionDrag?.id === s.id ? 'session-dragging' : ''} ${sessionDrag?.target === s.id ? sessionDrag.after ? 'drop-after' : 'drop-before' : ''}`}
      onContextMenu={e => showContext(e, 'session', s.id)}>
      <button aria-current={s.id === data.state?.sessionId ? 'page' : undefined} disabled={loading} onClick={() => void applySnapshot(() => bridge!.switchSession(s.id))}
        aria-keyshortcuts={manualOrder && group !== '__archived__' ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
        onKeyDown={e => {
          if (!manualOrder || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || group === '__archived__') return;
          e.preventDefault();
          const siblings = group === '__independent__' ? independentSessions : workspaceGroups.get(group)?.sessions ?? [];
          const index = siblings.findIndex(session => session.id === s.id);
          const target = siblings[index + (e.key === 'ArrowUp' ? -1 : 1)];
          if (target) reorderSession(s.id, target.id, e.key === 'ArrowDown');
        }}>
        <i className={`session-activity ${activity}`} role={activity === 'idle' ? undefined : 'img'} aria-hidden={activity === 'idle' ? true : undefined} aria-label={activity === 'idle' ? undefined : label}/>
        <span>{sessionTitle(s, t('新会话', 'New session'))}</span>
      </button>
      <IconButton title={t('更多操作', 'More actions')} aria-haspopup="menu" disabled={loading} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setContextMenu({ type: 'session', id: s.id, x: Math.min(rect.right, window.innerWidth - 206), y: Math.min(rect.bottom, window.innerHeight - 190) }); }}><MoreHorizontal size={15}/></IconButton>
    </div>;
  };
  const toggleWorkspace = (key: string) => setCollapsedWorkspaces(previous => { const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const independentExpanded = !collapsedWorkspaces.has('__independent__');
  const createInWorkspace = async (path: string, _sessions: typeof data.sessions) => {
    setCollapsedWorkspaces(previous => { const next = new Set(previous); next.delete(workspaceKey(path)); return next; });
    await applySnapshot(() => bridge!.beginSession(path));
  };
  const newSession = () => applySnapshot(() => bridge!.beginSession(data.independent ? undefined : current?.workspacePath ?? data.preferences.workspace));
  const openProject = () => applySnapshot(() => bridge!.chooseSessionProject());
  const toggleSidebar = () => compactSidebar ? setCompactSidebarOpen(open => !open) : setSidebar(open => !open);
  const renderWorkspace = ([key, group]: [string, { path: string; sessions: Session[] }]) => {
    const expanded = !collapsedWorkspaces.has(key);
    return <section className={`workspace-group ${sessionDrag?.id === key ? 'session-dragging' : ''} ${sessionDrag?.target === key ? sessionDrag.after ? 'drop-after' : 'drop-before' : ''}`} key={key} aria-label={group.path}
      data-reorder-id={key} data-reorder-kind="workspace" data-reorder-group={pinnedWorkspaces.has(key) ? '__pinned__' : '__projects__'} data-reorder-title={workspaceTitle(group.path)}>
      <div className={`workspace-heading ${key === workspaceKey(data.preferences.workspace ?? '') ? 'current' : ''}`} onContextMenu={e => showContext(e, 'workspace', group.path)}>
        <button className="workspace-toggle" aria-label={workspaceTitle(group.path)} aria-expanded={expanded} onClick={() => toggleWorkspace(key)}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onKeyDown={e => {
            if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            const siblings = pinnedWorkspaces.has(key) ? [...pinnedWorkspaces] : [...workspaceGroups.keys()].filter(key => !pinnedWorkspaces.has(key));
            const target = siblings[siblings.indexOf(key) + (e.key === 'ArrowUp' ? -1 : 1)];
            if (target) reorderWorkspace(key, target, e.key === 'ArrowDown');
          }}>{expanded ? <FolderOpen size={15}/> : <Folder size={15}/>}<span>{workspaceTitle(group.path)}</span></button>
        <IconButton title={t(`在 ${basename(group.path)} 新建会话`, `New session in ${basename(group.path)}`)} disabled={!bridge || loading} onClick={() => void createInWorkspace(group.path, group.sessions)}><Plus size={15}/></IconButton>
        <IconButton title={t('更多操作', 'More actions')} aria-haspopup="menu" onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setContextMenu({ type: 'workspace', id: group.path, x: Math.min(rect.right, window.innerWidth - 206), y: Math.min(rect.bottom, window.innerHeight - 190) }); }}><MoreHorizontal size={15}/></IconButton>
      </div>
      <div className="workspace-disclosure" aria-hidden={!expanded} inert={!expanded}>
        <div className="workspace-sessions">{group.sessions.map(s => renderSession(s, key))}{!group.sessions.length && <span className="workspace-empty">{t('暂无会话', 'No sessions yet')}</span>}</div>
      </div>
    </section>;
  };
  const menus: WindowMenu[] = [
    { id: 'file', label: t('文件', 'File'), items: [
      { label: t('新建独立会话', 'New independent session'), disabled: !bridge || loading, action: () => void applySnapshot(() => bridge!.beginSession()) },
      { label: t('打开项目…', 'Open project...'), disabled: !bridge || loading, action: () => void openProject() },
      { label: t('打开会话文件夹', 'Open session folder'), disabled: !bridge || !data.runtimeId || loading, action: () => void run(() => bridge!.openSessionFolder()) },
    ] },
    { id: 'edit', label: t('编辑', 'Edit'), items: [
      { label: t('重命名会话', 'Rename session'), disabled: !connected || busy || !data.state?.sessionId, action: () => beginRename('session', data.state!.sessionId!) },
      { label: t('停止生成', 'Stop response'), disabled: !busy || stopping, action: () => void stop() },
    ] },
    { id: 'view', label: t('视图', 'View'), items: [
      { label: sidebarVisible ? t('隐藏侧栏', 'Hide sidebar') : t('显示侧栏', 'Show sidebar'), action: toggleSidebar },
      { label: t('会话统计', 'Session statistics'), disabled: !data.runtimeId, action: () => void run(async () => setDetails(JSON.stringify(await bridge!.command('get_session_stats', undefined, viewId.current), null, 2))) },
      { label: t('重启运行时', 'Restart runtime'), disabled: !data.runtimeId || busy || loading, action: () => void applySnapshot(() => bridge!.restart()) },
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
  const permissionApproval = !renaming ? permissionApprovalPresentation(requests[0], data.messages, data.preferences.language, data.runtimeId) : undefined;
  return <div ref={appLayout} className={`app ${sidebarVisible ? '' : 'sidebar-hidden'} ${compactSidebar ? 'sidebar-compact' : ''} ${inspectionOpen && !details ? 'summary-open' : ''} ${summaryOverlay ? 'summary-overlay' : ''} ${inspectorExpanded ? 'inspector-expanded' : ''}`} onContextMenu={e => {
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
    <WindowBar language={data.preferences.language} sidebarVisible={sidebarVisible} toggleSidebar={toggleSidebar} menus={menus} sessionTitle={activeTitle} onMenuOpenChange={setWindowMenuOpen}/>
    {imageMenu && <ImageContextMenu target={imageMenu} language={data.preferences.language}
      canAdd={Boolean(bridge) && attachments.length < 10 && attachments.filter(item => item.kind === 'image').length < 5}
      onAction={imageAction} onClose={() => setImageMenu(null)}/>}
    {contextMenu && <div className="sidebar-context" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={e => e.stopPropagation()}>
      <button role="menuitem" onClick={() => beginRename(contextMenu.type, contextMenu.id)} disabled={busy || loading}><Pencil size={15}/>{t('重命名', 'Rename')}</button>
      {contextMenu.type === 'workspace' ? <>
        <button role="menuitem" onClick={() => {
          const key = workspaceKey(contextMenu.id);
          const next = pinnedWorkspaces.has(key) ? [...pinnedWorkspaces].filter(path => path !== key) : [...pinnedWorkspaces, key];
          setContextMenu(null); void setPreference({ pinnedWorkspaces: next });
        }}>{pinnedWorkspaces.has(workspaceKey(contextMenu.id)) ? <PinOff size={15}/> : <Pin size={15}/>}
          {pinnedWorkspaces.has(workspaceKey(contextMenu.id)) ? t('取消置顶', 'Unpin project') : t('置顶项目', 'Pin project')}</button>
        <button role="menuitem" onClick={() => { const path = contextMenu.id; setContextMenu(null); void run(() => bridge!.openWorkspaceFolder(path)); }}><FolderOpen size={15}/>{t('在资源管理器中打开', 'Open in Explorer')}</button>
      </> : <>
        <button role="menuitem" onClick={() => void updateArchive(contextMenu.id, archived.has(contextMenu.id))}><Archive size={15}/>{archived.has(contextMenu.id) ? t('恢复会话', 'Restore session') : t('归档会话', 'Archive session')}</button>
        <div className="context-separator"/>
        <button role="menuitem" disabled={!bridge} onClick={() => {
          const id = contextMenu.id;
          setContextMenu(null);
          void run(async () => {
            await bridge!.copyText(sessionReference(id));
            setNotice({ id: ++nextNoticeId.current, message: t('已复制会话引用', 'Session reference copied'), type: 'info', icon: 'copy' });
          });
        }}><Copy size={15}/>{t('复制会话引用', 'Copy session reference')}</button>
        <button role="menuitem" disabled={!bridge || loading || !data.sessions.some(session => session.id === contextMenu.id && session.path && session.messageCount > 0) ||
          data.runtimes?.some(runtime => runtime.sessionId === contextMenu.id && ['running', 'waiting'].includes(runtime.status))}
          onClick={() => { const id = contextMenu.id; setContextMenu(null); void createBranch(() => bridge!.cloneSession(id)); }}>
          <GitBranch size={15}/>{t('分支', 'Branch')}
        </button>
      </>}
    </div>}
    {error && (settingsOpen || mcpEdit || requests.length > 0) && <div className="modal-error" role="alert"><AlertCircle size={16}/><span>{error}</span><IconButton title="Dismiss" onClick={() => setError('')}><X size={16}/></IconButton></div>}
    {compactSidebar && <button type="button" className="sidebar-backdrop" aria-label={t('关闭侧栏', 'Close sidebar')} aria-hidden={!compactSidebarOpen} inert={!compactSidebarOpen} onClick={() => setCompactSidebarOpen(false)}/>}
    <aside className="sidebar" inert={!sidebarVisible}>
      <div className="sidebar-identity"><img src="./StepCode.svg" width="26" height="26" alt=""/><span className="sidebar-wordmark"><img className="wordmark-light" src="./wordmark-light.png" alt="Desktop for Step Code"/><img className="wordmark-dark" src="./wordmark-dark.png" alt="Desktop for Step Code"/></span></div>
      <button className="new-chat" disabled={!bridge || loading} onClick={() => void newSession()}><Plus size={17}/>{t('新建会话', 'New session')}</button>
      <nav className={`workspace-tree ${sessionDrag ? 'is-reordering' : ''}`} aria-label={t('工作区与会话', 'Workspaces and sessions')}>
        <section className="workspace-group independent-group" aria-label={t('独立会话', 'Independent sessions')}>
          <div className="workspace-heading"><button className="workspace-toggle" aria-label={t('独立会话', 'Independent sessions')} aria-expanded={independentExpanded} onClick={() => toggleWorkspace('__independent__')}><MessageSquare size={15}/><span>{t('独立会话', 'Independent sessions')}</span><small>{independentSessions.length}</small></button></div>
          <div className="workspace-disclosure" aria-hidden={!independentExpanded} inert={!independentExpanded}>
            <div className="workspace-sessions">{independentSessions.map(s => renderSession(s, '__independent__'))}</div>
          </div>
        </section>
        {pinnedWorkspaces.size > 0 && <div className="pinned-projects">
          <div className="section-label">{t('置顶', 'Pinned')}</div>
          {[...pinnedWorkspaces].flatMap(key => workspaceGroups.has(key) ? [[key, workspaceGroups.get(key)!] as [string, { path: string; sessions: Session[] }]] : []).map(renderWorkspace)}
        </div>}
        <div className="section-label">{t('项目', 'Projects')}<IconButton title={t('添加工作区', 'Add workspace')} disabled={!bridge || loading} onClick={() => void openProject()}><Plus size={15}/></IconButton></div>
        {[...workspaceGroups].filter(([key]) => !pinnedWorkspaces.has(key)).map(renderWorkspace)}
        {!workspaceGroups.size && <button disabled={!bridge || loading} onClick={() => void openProject()}><FolderOpen size={15}/>{t('打开项目', 'Open project')}</button>}
      </nav>
      <div className="sidebar-bottom"><button onClick={() => void openSettings()} disabled={!bridge}><SettingsIcon size={17}/>{t('设置', 'Settings')}<span>0.1.0</span></button><div className="connection"><i className={connected ? 'online' : ''}/>{connected ? t('Step Code 已连接', 'Step Code connected') : loading ? t('连接中', 'Connecting') : t('未连接', 'Disconnected')}</div></div>
    </aside>
    {sessionDrag && <div className="session-drag-preview" aria-hidden="true" style={{ left: sessionDrag.x + 12, top: sessionDrag.y + 10 }}>{sessionDrag.title}</div>}
    <main inert={inspectorExpanded}>
      <NoticeToast notice={notice} language={data.preferences.language} onDismiss={() => setNotice(null)}
        onDetails={() => { setNotice(null); setTab('mcp'); void openSettings(); }}/>
      {!!requests.length && !approvalOpen && <div className="approval-notice"><TriangleAlert size={16}/><span>{t('此会话有待确认的操作', 'This session is awaiting approval')}</span><button onClick={() => setApprovalOpen(true)}>{t('查看', 'Review')}</button></div>}
      {error && <div className="error-banner" role="alert"><AlertCircle size={16}/><span>{error}</span><IconButton title={t('关闭', 'Dismiss')} onClick={() => setError('')}><X size={14}/></IconButton></div>}
      {!bridge && <div className="error-banner">{t('请从 Electron 桌面窗口打开此应用。', 'Open this application in the Electron desktop window.')}</div>}
      <div className="conversation-shell">
        <div className="conversation" id="conversation-scroll" ref={scroll} onScroll={() => { if (scroll.current) { const distance = scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight; follow.current = distance < 100; setAwayFromBottom(distance > 120); } }}>
          {!data.messages.length && !hasPendingReceipt ? <NewSession language={data.preferences.language}
            workspace={data.independent ? undefined : data.preferences.workspace} workspaces={data.preferences.workspaces}
            title={workspaceTitle} disabled={!bridge || loading} composing={!!draft || !!attachments.length || !!quotes.length}
            onSelect={path => void applySnapshot(() => bridge!.beginSession(path))}
            onOpenProject={() => void openProject()} onSettings={() => void openSettings()} onOpenChange={setProjectPickerOpen}/> : <div className="messages" ref={transcript}>
            <ConversationMessages key={data.runtimeId} runtimeId={data.runtimeId} messages={data.messages} language={data.preferences.language} busy={busy} canEdit={connected && !busy && !loading} openImage={openImage} edit={editMessage} branch={branchMessage} onError={setError} onLayoutChange={followLayout} arrivingUser={arrivingUser} onOpenSubagent={openSubagent}/>
            {busy && <div className="working"><span className="working-dot"/>{t('正在执行', 'Working')}</div>}
            <PendingUserMessages messages={data.pendingMessages ?? []} connected={connected} busy={busy}
              onRecover={() => bridge!.command('queue_recover', undefined, data.runtimeId)}
              language={data.preferences.language} openImage={openImage} onError={setError} onLayoutChange={followLayout}/>
          </div>}
        </div>
        <ConversationMarkers scrollRef={scroll} turns={turns} language={data.preferences.language}/>
      </div>
      <div className="composer-wrap">
        {draft.startsWith('/') && commands.filter(c => c.name.startsWith(draft.slice(1))).length > 0 && <div className="command-menu">{commands.filter(c => c.name.startsWith(draft.slice(1))).slice(0, 6).map(c => <button key={c.name} onClick={() => setDraft(`/${c.name} `)}><code>/{c.name}</code><span>{c.description}</span></button>)}</div>}
        <ComposerContextBar queued={queuedMessages.length > 0}>
        <QuotePreview quotes={quotes} language={data.preferences.language}
          clear={() => setQuotes([])}
          remove={id => setQuotes(value => value.filter(quote => quote.id !== id))}
          reveal={quote => {
            const source = transcript.current?.querySelector<HTMLElement>(`[data-message-index="${quote.messageIndex}"]`);
            if (source) {
              follow.current = false; setAwayFromBottom(true);
              source.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
            }
          }}/>
        <QueuePreview key={`queue-${data.runtimeId}`} messages={queuedMessages} language={data.preferences.language}
          onOpenChange={setQueuePreviewOpen}
          connected={connected} disabled={loading || stopping || settingsOpen || Boolean(preview) || requests.length > 0} onAction={queueAction}/>
        <LiveTurnChanges key={`changes-${data.runtimeId}`} messages={data.messages} busy={busy} language={data.preferences.language}
          docked={queuedMessages.length > 0} onOpenChange={setLiveChangesOpen}/>
        {awayFromBottom && <IconButton title={t('回到底部', 'Scroll to bottom')} className="jump-to-bottom" onClick={() => { follow.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}><ArrowDown size={17}/></IconButton>}
        </ComposerContextBar>
        <div className={`composer ${draggingFiles ? 'composer-file-drop' : ''}`}
          onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth.current++; setDraggingFiles(true); } }}
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
          onDragLeave={e => { e.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDraggingFiles(false); }}
          onDrop={e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); dragDepth.current = 0; setDraggingFiles(false); if (connected && !loading) void importFiles(Array.from(e.dataTransfer.files)); }}>
          {attachments.length > 0 && <div className="attachments" aria-label={t('待发送附件', 'Pending attachments')}>{attachments.map((item, i) => <div className={`attachment-card ${item.kind}`} key={item.kind === 'file' ? item.id : `${item.name}-${i}`}>
            {item.kind === 'image' ? <button type="button" className="attachment-open" aria-label={t(`预览 ${item.name}`, `Preview ${item.name}`)} onClick={e => openImage(`data:${item.content.mimeType};base64,${item.content.data}`, item.name, e.currentTarget)}><img src={`data:${item.content.mimeType};base64,${item.content.data}`} alt={item.name}/></button> : <div className="attachment-file"><FileText size={27}/><span>{item.name}</span><small>{t('本地文件引用', 'Local file reference')}</small></div>}
            <IconButton title={t('移除附件', 'Remove attachment')} tooltip={false} className="attachment-remove" onClick={() => { const next = attachmentsRef.current.filter((_, n) => n !== i); attachmentsRef.current = next; setAttachments(next); }}><X size={13}/></IconButton>
          </div>)}</div>}
          <textarea aria-label={t('消息', 'Message')} placeholder={connected ? t('你想做什么？', 'What would you like to work on?') : t('打开项目以开始', 'Open a project to begin')} value={draft} disabled={!connected || loading} onChange={e => setDraft(e.target.value)} onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void importFiles(files); } }} onKeyDown={e => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.repeat) return;
            e.preventDefault();
            if (!draft.trim() && !attachments.length && !quotes.length && !loading && connected && !stopping) {
              void shortcutSteer();
            } else void send();
          }}/>
          <div className="composer-tools">
            <IconButton title={t('添加附件', 'Add attachments')} disabled={!connected || loading || attachments.length >= 10} onClick={() => {
              const scope = view.current.sessionId ?? view.current.draftId;
              void run(async () => addAttachments(await bridge!.chooseAttachments(), scope));
            }}><Plus size={17}/></IconButton>
            <PermissionPicker preset={data.permissionPreset} language={data.preferences.language} disabled={!connected || loading} supported={Boolean(data.draftId) || commands.some(c => c.name === 'permissions' && c.source === 'extension')} onSelect={preset => command('set_permission_preset', { preset })}/>
            <div className="spacer"/>
            <ContextRing usage={data.stats?.contextUsage} language={data.preferences.language}/>
            <ModelEffortPicker model={data.state?.model} models={data.models} level={data.state?.thinkingLevel} levels={levels} language={data.preferences.language} disabled={!connected || busy || loading} onModel={m => command('set_model', { provider: m.provider, modelId: m.id })} onEffort={level => command('set_thinking_level', { level })}/>
            <IconButton title={action.mode === 'stop' ? stopping ? t('正在停止此轮', 'Stopping response') : t('停止此轮', 'Stop response') : busy ? t('加入队列', 'Queue message') : t('发送', 'Send')}
              className="composer-action-button" data-action={action.mode}
              disabled={!connected || loading || (action.mode === 'stop' ? stopping : !action.hasContent)}
              onClick={() => void (action.mode === 'stop' ? stop() : send())}><ComposerActionIcon stop={action.mode === 'stop'}/></IconButton>
          </div>
        </div><PerformanceBar run={runMetrics} stats={data.stats} connected={connected} language={data.preferences.language} now={clock}/>
      </div>
      <ConversationScrollThumb scrollRef={scroll} language={data.preferences.language}
        sessionId={data.state?.sessionId} messageCount={data.messages.length}/>
    </main>
    <SelectionToolbar root={transcript} scope={quoteScope} language={data.preferences.language}
      enabled={connected && !loading && !settingsOpen && !preview && !requests.length && !renaming}
      onError={setError} onQuote={quote => {
        if (quotes.some(item => item.messageIndex === quote.messageIndex && item.text === quote.text)) return true;
        if (quotes.length >= MAX_QUOTES) { setError(t('最多添加 8 段引用', 'Maximum 8 quotes')); return false; }
        follow.current = false;
        setQuotes(value => [...value, quote]); return true;
      }}/>
    {details && <aside className="details-panel"><header><FileCode2 size={16}/>{t('详情', 'Details')}<IconButton title={t('关闭', 'Close')} onClick={() => setDetails('')}><X size={17}/></IconButton></header><pre>{details}</pre></aside>}
    <ConversationNavigationPanel open={visibleRightPanel === 'turns' && !details} replaced={inspectionOpen || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || visibleRightPanel === 'subagent' || Boolean(details)}
      overlay={!summarySpace} turns={turns} language={data.preferences.language} onClose={closeRightPanel}
      onSelect={index => { scrollToTurn(scroll.current, index); if (window.innerWidth <= 900) closeRightPanel(); }}/>
    <ReviewPanel open={visibleRightPanel === 'review' && !details} replaced={inspectionOpen || visibleRightPanel === 'turns' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || visibleRightPanel === 'subagent' || Boolean(details)}
      repositoryRequest={repositoryRequest?.runtimeId === data.runtimeId ? repositoryRequest?.sequence : undefined}
      onRepositoryRequestHandled={sequence => setRepositoryRequest(value =>
        value && value.runtimeId === data.runtimeId && value.sequence === sequence ? undefined : value)}
      expanded={inspectorExpanded && visibleRightPanel === 'review'}
      onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'review')}
      overlay={!summarySpace} runtimeId={data.runtimeId} messages={data.messages} busy={busy} language={data.preferences.language}
      onClose={closeRightPanel} onError={setError}/>
    <TerminalPanel open={visibleRightPanel === 'terminal' && !details} replaced={inspectionOpen || visibleRightPanel === 'turns' || visibleRightPanel === 'review' || visibleRightPanel === 'browser' || visibleRightPanel === 'subagent' || Boolean(details)}
      expanded={inspectorExpanded && visibleRightPanel === 'terminal'} onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'terminal')}
      overlay={!summarySpace} runtimeId={data.runtimeId} cwd={data.preferences.workspace} language={data.preferences.language}
      onClose={closeRightPanel} onError={setError}/>
    <BrowserPanel open={visibleRightPanel === 'browser' && !details}
      replaced={inspectionOpen || visibleRightPanel === 'turns' || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'subagent' || Boolean(details)}
      expanded={inspectorExpanded && visibleRightPanel === 'browser'} onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'browser')}
      blocked={projectPickerOpen || queuePreviewOpen || liveChangesOpen || windowMenuOpen || settingsOpen || Boolean(preview) || renaming || Boolean(contextMenu) || Boolean(imageMenu) || (approvalOpen && requests.length > 0) || (compactSidebar && compactSidebarOpen)}
      overlay={!summarySpace} language={data.preferences.language} onClose={closeRightPanel}/>
    <SubagentPanel open={visibleRightPanel === 'subagent' && !details}
      replaced={inspectionOpen || visibleRightPanel === 'turns' || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || Boolean(details)}
      expanded={inspectorExpanded && visibleRightPanel === 'subagent'} onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'subagent')}
      overlay={!summarySpace} task={openSubagentTask} language={data.preferences.language}
      openImage={openImage} onClose={closeRightPanel} onError={setError}/>
    <div className={`summary-track ${inspectionOpen && summarySpace && !details ? 'is-docked' : ''} ${visibleRightPanel === 'turns' || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || visibleRightPanel === 'subagent' || details ? 'is-replaced' : ''}`}>
      {visibleRightPanel === 'summary' && !details && <div className="summary-region">
        <aside className="summary-board" aria-label={t('摘要', 'Summary')} id="summary-board">
          <header><h2>{t('摘要', 'Summary')}</h2><IconButton title={t('关闭侧栏', 'Close panel')} onClick={closeRightPanel}><X size={16}/></IconButton></header>
          <div className="summary-content"><SummaryBoard key={`${data.runtimeId ?? 'empty'}:${data.state?.sessionId ?? ''}`} runtimeId={data.runtimeId} sessionId={data.state?.sessionId}
            language={data.preferences.language} onOpenChanges={() => { setRepositoryRequest(value => ({ runtimeId: data.runtimeId, sequence: (value?.sequence ?? 0) + 1 })); setDetails(''); setRightPanel('review'); }}/></div>
        </aside>
      </div>}
      {visibleRightPanel === 'context' && !details && <div className={`summary-region context-region right-inspector-surface${inspectorExpanded ? ' is-expanded' : ''}`}>
        <ContextPanel key={data.state?.sessionId ?? data.runtimeId ?? 'empty'} messages={data.messages} stats={data.stats} state={data.state}
          title={activeTitle} language={data.preferences.language} busy={busy} connected={connected} onClose={closeRightPanel}
          expanded={inspectorExpanded} onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'context')}
          onRefresh={async () => { if (bridge) await applySnapshot(() => bridge.snapshot()); }} onError={setError}/>
      </div>}
    </div>
    <nav ref={rightRail} className="right-tool-rail" aria-label={t('右侧工具', 'Right tools')}>
      <IconButton title={t('摘要', 'Summary')} data-tooltip-side="left" aria-controls="summary-board" aria-pressed={!details && visibleRightPanel === 'summary'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'summary' ? null : 'summary'); }}><Layers3 size={18}/></IconButton>
      <IconButton title={t('上下文', 'Context')} data-tooltip-side="left" aria-controls="context-panel" aria-pressed={!details && visibleRightPanel === 'context'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'context' ? null : 'context'); }}><ScanLine size={18}/></IconButton>
      <IconButton title={t('变更', 'Changes')} data-tooltip-side="left" aria-controls="review-panel" aria-pressed={!details && visibleRightPanel === 'review'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'review' ? null : 'review'); }}><FileDiff size={18} strokeWidth={1.5}/></IconButton>
      <IconButton title={t('终端', 'Terminal')} data-tooltip-side="left" aria-controls="terminal-panel" aria-pressed={!details && visibleRightPanel === 'terminal'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'terminal' ? null : 'terminal'); }}><Terminal size={18}/></IconButton>
      <IconButton title={t('浏览器', 'Browser')} data-tooltip-side="left" aria-controls="browser-panel" aria-pressed={!details && visibleRightPanel === 'browser'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'browser' ? null : 'browser'); }}><Globe size={18}/></IconButton>
        <IconButton title={t('子代理', 'Subagents')} data-tooltip-side="left" aria-controls="subagent-panel" aria-pressed={!details && visibleRightPanel === 'subagent'} disabled={!selectedSubagent} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'subagent' ? null : 'subagent'); }}><Bot size={18}/></IconButton>
      <IconButton title={t('会话导航', 'Conversation navigation')} data-tooltip-side="left" aria-controls="conversation-navigation-panel" aria-pressed={!details && visibleRightPanel === 'turns'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'turns' ? null : 'turns'); }}><ListTree size={18}/></IconButton>
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
    {settingsOpen && <div className="modal-backdrop"><section className={`settings-dialog${tab === 'archived' ? ' archive-settings-dialog' : ''}`} role="dialog" aria-modal="true" aria-label={t('设置', 'Settings')}><header><h2>{t('设置', 'Settings')}</h2><IconButton title="Close" onClick={() => { setSettingsOpen(false); setKey(''); }}><X size={19}/></IconButton></header><div className="settings-layout"><nav>{[['account', StepPlatformIcon, t('账户', 'Account')], ['providers', ProviderIcon, t('供应商', 'Providers')], ['mcp', Plug, 'MCP'], ['skills', BookOpen, t('资源', 'Resources')], ['general', SunMoon, t('通用', 'General')], ['archived', Archive, t('已归档', 'Archived')]].map(([id, Icon, title]: any) => <button key={id} aria-label={title} className={`${tab === id ? 'selected' : ''}${id === 'archived' ? ' archive-tab' : ''}`} onClick={() => setTab(id)}><Icon size={17}/>{title}</button>)}</nav><div className="settings-content">
      {tab === 'archived' ? <ArchivedSessions sessions={archivedSessions} preferences={data.preferences}
        runtimes={data.runtimes ?? []} activeId={data.state?.sessionId}
        onOpen={id => { setSettingsOpen(false); void applySnapshot(() => bridge!.switchSession(id)); }}
        onRestore={id => run(() => updateArchive(id, true)).then(() => {})} onDelete={deleteArchived}/> : <>
      {settings && tab === 'mcp' && Object.keys(mcpFailures).length > 0 && <section className="mcp-failures" aria-label={t('本次窗口的 MCP 警告', 'MCP warnings in this window')}>
        <h3>{t('本次窗口的连接警告', 'Connection warnings')}</h3>
        {Object.entries(mcpFailures).map(([name, failure]) => <div className="resource-row" key={name}>
          <TriangleAlert size={17}/><div><strong>{name}</strong><small>{failure.message}</small>{failure.count > 1 && <small>{t(`出现 ${failure.count} 次`, `Occurred ${failure.count} times`)}</small>}</div>
        </div>)}
      </section>}
      {settings && tab === 'general' && <>
        <h3>{t('左栏', 'Sidebar')}</h3>
        <label>{t('会话排序', 'Session order')}
          <select aria-label={t('会话排序', 'Session order')} value={data.preferences.sessionSort ?? 'manual'} onChange={e => void setPreference({ sessionSort: e.target.value })}>
            <option value="manual">{t('固定顺序', 'Manual order')}</option>
            <option value="updated">{t('最新在前', 'Recently updated first')}</option>
          </select>
        </label>
      </>}
      {!settings ? <p>{t('加载中…', 'Loading…')}</p> : tab === 'providers' ? <ProviderSettings language={data.preferences.language}/> : tab === 'account' ? <AccountSettings settings={settings} profile={loginProfile} onProfile={chooseLoginProfile} apiKey={key} onKey={setKey} loggingIn={loggingIn} busy={anyBusy} language={data.preferences.language} onLogin={() => void run(async () => { setLoggingIn(true); try { await bridge!.login(loginProfile, key); setKey(''); setSettings(await bridge!.settings()); if (data.preferences.workspace) await applySnapshot(() => bridge!.restart()); } finally { setLoggingIn(false); } })} onCancel={() => void run(() => bridge!.cancelLogin())} onLogout={() => void run(async () => { await bridge!.logout(); setSettings(await bridge!.settings()); await applySnapshot(() => bridge!.snapshot()); })}/> : tab === 'mcp' ? <><div className="section-heading"><h3>MCP servers</h3><IconButton title="Add MCP" onClick={() => setMcpEdit({ name: '', config: { command: '', args: [], enabled: true }, args: '[]', secrets: '{}' })}><Plus size={18}/></IconButton></div>{Object.entries(settings.mcp).map(([n, c]) => <div className="resource-row" key={n}><Plug size={18}/><div><strong>{n}</strong><small>{c.url || c.command}</small><small>{c.enabled ? t('已启用，重启后生效', 'Enabled; applies after restart') : t('已停用', 'Disabled')}</small></div><IconButton title="Edit" onClick={() => setMcpEdit({ name: n, original: n, config: c, args: JSON.stringify(c.args ?? []), secrets: '{}' })}><Pencil size={14}/></IconButton><IconButton title="Remove" onClick={() => { if (confirm(t(`移除 ${n}？`, `Remove ${n}?`))) void run(async () => { await bridge!.saveMcp(n, null); setSettings(await bridge!.settings()); }); }}><Trash2 size={14}/></IconButton></div>)}{!Object.keys(settings.mcp).length && <p className="muted">{t('尚未配置服务器', 'No servers configured')}</p>}<button disabled={!connected || busy} onClick={() => void applySnapshot(() => bridge!.restart())}><RotateCcw size={15}/>{t('重启并应用', 'Restart to apply')}</button></> : tab === 'skills' ? <><h3>{t('Skills 与命令', 'Skills and commands')}</h3>{settings.skills.map(s => <div className="resource-row" key={`${s.source}/${s.name}`}><BookOpen size={17}/><div><strong>{s.name}</strong><small>{s.description}</small><small>{s.source}</small></div></div>)}{commands.map(c => <div className="resource-row" key={c.name}><Terminal size={17}/><div><strong>/{c.name}</strong><small>{c.description}</small><small>{c.source}</small></div></div>)}{!settings.skills.length && !commands.length && <p className="muted">{t('没有已发现的资源', 'No resources discovered')}</p>}</> : <><h3>{t('外观与语言', 'Appearance and language')}</h3><label>{t('主题', 'Theme')}<select value={data.preferences.theme} onChange={e => void setPreference({ theme: e.target.value })}><option value="system">{t('跟随系统', 'System')}</option><option value="light">{t('浅色', 'Light')}</option><option value="dark">{t('深色', 'Dark')}</option></select></label><label>{t('语言', 'Language')}<select value={data.preferences.language} onChange={e => void setPreference({ language: e.target.value })}><option value="zh">简体中文</option><option value="en">English</option></select></label><h3>{t('关于', 'About')}</h3><p>Desktop for Step Code 0.1.0</p><p className="muted">{t('社区预览版', 'Community preview')}</p><button onClick={() => void run(() => bridge!.diagnostics())}><Download size={15}/>{t('导出脱敏诊断', 'Export diagnostics')}</button></>}
      </>}
    </div></div></section></div>}
    {mcpEdit && <div className="modal-backdrop higher"><section className="small-dialog" role="dialog" aria-modal="true" aria-label="MCP"><header><h2>MCP server</h2><IconButton title="Close" onClick={() => setMcpEdit(null)}><X size={18}/></IconButton></header><label>{t('名称', 'Name')}<input value={mcpEdit.name} disabled={Boolean(mcpEdit.original)} onChange={e => setMcpEdit({ ...mcpEdit, name: e.target.value })}/></label><label>{t('传输', 'Transport')}<select value={mcpEdit.config.url !== undefined ? 'http' : 'stdio'} onChange={e => setMcpEdit({ ...mcpEdit, config: e.target.value === 'http' ? { url: '', enabled: true } : { command: '', args: [], enabled: true } })}><option value="stdio">stdio</option><option value="http">HTTP</option></select></label>{mcpEdit.config.url !== undefined ? <label>URL<input value={mcpEdit.config.url} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, url: e.target.value } })}/></label> : <><label>{t('可执行文件', 'Executable')}<input value={mcpEdit.config.command ?? ''} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, command: e.target.value } })}/></label><label>{t('参数（JSON 数组）', 'Arguments (JSON array)')}<textarea value={mcpEdit.args} onChange={e => setMcpEdit({ ...mcpEdit, args: e.target.value })}/></label></>}<label>{t('新增或替换环境变量（JSON）', 'Add or replace environment variables (JSON)')}<textarea value={mcpEdit.secrets} onChange={e => setMcpEdit({ ...mcpEdit, secrets: e.target.value })}/></label><label className="checkbox"><input type="checkbox" checked={mcpEdit.config.enabled !== false} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, enabled: e.target.checked } })}/>{t('启用', 'Enabled')}</label><button className="primary" onClick={() => void saveMcp()}>{t('保存', 'Save')}</button></section></div>}
    {permissionApproval && approvalOpen && <PermissionApproval key={requests[0].id} presentation={permissionApproval} language={data.preferences.language} onLater={() => setApprovalOpen(false)} onRespond={respond}/>}
    {((requests[0] && approvalOpen && !permissionApproval) || renaming) && <div className="modal-backdrop higher"><section className="small-dialog" role="dialog" aria-modal="true" aria-label={requests[0]?.title ?? 'Rename'}><h2>{requests[0]?.title ?? (renameTarget?.type === 'workspace' ? t('重命名项目', 'Rename project') : t('重命名会话', 'Rename session'))}</h2>{requests[0]?.message && <p className={requests[0].messageStyle === 'preformatted' || requests[0].message.includes('\n') ? 'request-message' : undefined}>{requests[0].messageStyle === 'preformatted' ? requests[0].message : requests[0].message.split('\n').filter(line => !/^Call: \S+$/.test(line)).join('\n')}</p>}{renaming ? <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void run(saveRename); }}/> : requests[0].method === 'select' ? requests[0].options?.map(o => <button className="option" key={o} onClick={() => void respond({ value: o })}>{o}</button>) : requests[0].method !== 'confirm' ? <textarea autoFocus placeholder={requests[0].placeholder} value={answer} onChange={e => setAnswer(e.target.value)}/> : null}<div className="button-row">{!renaming && <button onClick={() => setApprovalOpen(false)}>{t('稍后处理', 'Review later')}</button>}<button onClick={() => renaming ? (setRenaming(false), setRenameTarget(null)) : void respond({ cancelled: true })}>{t('取消', 'Cancel')}</button>{(renaming || requests[0]?.method !== 'select') && <button className="primary" disabled={renaming && (!name.trim() || busy || loading)} onClick={() => { if (renaming) void run(saveRename); else void respond(requests[0].method === 'confirm' ? { confirmed: true } : { value: answer }); }}>{t('确认', 'Confirm')}</button>}</div></section></div>}
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
