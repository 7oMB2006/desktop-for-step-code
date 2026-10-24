import { normalizedWorkspaceKey } from './workspace-key';
import { UsageOverviewPanel } from './UsageOverviewPanel';
import { BarChart3, Plug } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ArrowDown, Plus, Folder, FolderOpen, MessageSquare, CircleHelp, Settings as SettingsIcon, PanelLeft, X, Search, ChevronDown, ChevronRight, Terminal, Copy, Check, RotateCcw, Trash2, Pencil, Cpu, AlertCircle, TriangleAlert, ShieldAlert, Info, Download, ArrowRightLeft, BookOpen, LogOut, SunMoon, ExternalLink, FileCode2, Archive, GitBranch, MoreHorizontal, ListTree, Layers3, FileText, ZoomIn, ZoomOut, Pin, PinOff, ScanLine, FileDiff, Globe, Bot } from 'lucide-react';
import { McpIcon } from './McpIcon';
import type { Snapshot, Settings, Message, Content, UIRequest, McpServer, Session, ComposerAttachment, RuntimeSummary } from './contracts';
import { fullAccessRiskPresentation } from './full-access-risk';
import { pendingPlanReview, planReview } from './plan-review';
import { conversationEntries } from './conversation-presentation';
import { planExecutionResponses } from './plan-execution';
import { PlanExecution } from './PlanExecution';
import { PlanReview } from './PlanReview';
import { ClipboardCheck, SlidersHorizontal } from 'lucide-react';
import { QuestionReview } from './QuestionReview';
import { QuestionContext } from './QuestionTool';
import { questionnaire, type QuestionDraft } from './questionnaire';
import 'katex/dist/katex.min.css';
import './style.css';
import './layout.css';
import { applyMessageEvent, applyToolResult } from './message-events';
import { MessageRevision } from './message-revision';
import { SessionReadingCache, captureReadingPosition, restoreReadingPosition, type ReadingPosition, type SessionReading } from './session-reading';
import './session-navigation.css';
import { WindowBar, type WindowMenu } from './WindowBar';
import { NoticeToast, type NoticeToastItem } from './NoticeToast';
import { PerformanceBar } from './PerformanceBar';
import { WorkingIndicator } from './WorkingIndicator';
import { ModelEffortPicker } from './ModelEffortPicker';
import { PermissionPicker } from './PermissionPicker';
import { LaunchStatus } from './LaunchStatus';
import { TurnStatusTrigger } from './TurnStatusTrigger';
import { goalCompletionResponse } from './launch-state';
import { isUserMessage } from './user-message';
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
import { ComposerMenu } from './ComposerMenu';
import { CommandCatalog } from './CommandReference';
import { CommandContextUsage } from './ContextCommandIcon';
import { ComposerInput } from './ComposerInput';
import { clmNotice } from './clm-notice';
import { desktopCommand, desktopCommands } from './composer-commands';
import { composerAction } from './composer-action';
import { SelectionToolbar } from './SelectionToolbar';
import { QuotePreview } from './QuotePreview';
import { QuoteAnnotations } from './QuoteAnnotations';
import { MAX_QUOTES, MAX_QUOTE_LENGTH, MAX_PROMPT_LENGTH, MAX_ANNOTATION_LENGTH, quotePrompt, restoreQuotes, sameQuoteSelection, type ChatQuote } from './chat-quotes';
import { playCompletionSound, prepareCompletionSound } from './completion-sound';
import { sessionReference } from './session-reference';
import { moveSession, orderSessions, reconcileSessionOrder } from './sidebar-order';
import { filterSessions } from './session-search';
import './session-search.css';
import { useSidebarReorder } from './use-sidebar-reorder';
import { useSidebarMotion } from './use-sidebar-motion';
import { ProjectRemoval } from './ProjectRemoval';
import { SessionMoveDialog } from './SessionMoveDialog';
import { ContextPanel } from './ContextPanel';
import { LiveTurnChanges } from './LiveTurnChanges';
import { QueuePreview } from './QueuePreview';
import { ComposerContextBar } from './ComposerContextBar';
import { ReviewPanel } from './ReviewPanel';
import { SummaryBoard } from './SummaryBoard';
import { AccountSettings, ProviderIcon, StepPlatformIcon } from './AccountSettings';
import { ProviderSettings } from './ProviderSettings';
import { CapabilitySettings } from './CapabilitySettings';
import { capabilityCommand, type CapabilityTarget } from './capability-command';
import { SessionImportSettings } from './SessionImportSettings';
import { NewSession } from './NewSession';
import { AppUpdates, useAppUpdates } from './AppUpdates';
import { AppearanceSettings } from './AppearanceSettings';
import { InterfaceSettings } from './InterfaceSettings';
import { normalizeInterfaceSettings } from './interface-presets';
import { applyAppearance } from './appearance';
import { applyTheme } from './theme';
import { ThemeSettings } from './ThemeSettings';
import { TerminalPanel } from './TerminalPanel';
import { normalizePanelPreferences, type TerminalDock } from './panel-preferences';
import { BrowserPanel } from './BrowserPanel';
import { FilePreviewPanel } from './FilePreviewPanel';
import { FileOpeningContext } from './FileOpening';
import { RightPanelHandle } from './RightPanelHandle';
import type { RightPanelWidth } from './RightPanelWidthControl';
import type { FilePreviewData, FileTarget } from './contracts';
import { SubagentPanel } from './SubagentPanel';
import type { SubagentTask, SubagentTaskKey } from './conversation-presentation';
import { findSubagentTask } from './conversation-presentation';
import { currentTurnWorkflows, workflowsFromMessages, workflowIsActive } from './workflow-state';
import { WorkflowTrigger } from './WorkflowView';
import './appearance.css';
import './theme.css';
import './settings-dialog.css';
import { AccountAllowancePanel } from './AccountAllowancePanel';
import { CronManager } from './CronManager';
import { SidebarTaskActions } from './ScheduledTasks';
import { EstimateRules } from './EstimateRules';
import { QuitConfirmation } from './QuitConfirmation';
import type { QuitReviewState } from './quit-confirmation';

const bridge = window.desktop;
// Seed the placeholder with the main-process-resolved theme so the first React
// write matches the bootstrap instead of flipping to a system guess before the
// real snapshot arrives.
const initial: Snapshot = { preferences: { theme: window.desktopTheme?.preference ?? window.desktopTheme?.resolved ?? 'system', accentColor: window.desktopTheme?.accentColor, language: 'zh', workspaces: [] }, status: 'disconnected', messages: [], models: [], sessions: [] };
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;
const workspaceKey = (path: string) => normalizedWorkspaceKey(path, window.desktop?.platform ?? 'win32');
const sessionTitle = (session: Pick<Session, 'name' | 'firstMessage'> | undefined, fallback: string) => session?.name || session?.firstMessage || fallback;
const mcpFailureName = (message: string) => /^MCP server '([^']+)' could not start:/u.exec(message)?.[1];
function IconButton({ title, tooltip = true, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string; tooltip?: boolean }) { return <button type="button" className="icon-button" data-tooltip={tooltip ? title : undefined} aria-label={title} {...props}>{children}</button>; }
function App() {
  const appUpdate = useAppUpdates(bridge);
  const updateAvailable = appUpdate?.updateAvailable === true;
  const [data, setData] = useState(initial);
  const [quitReview, setQuitReview] = useState<QuitReviewState>({ revision: -1 });
  const acceptQuitReview = (next: QuitReviewState | undefined) => {
    if (next) setQuitReview(previous => next.revision >= previous.revision ? next : previous);
  };
  const interfaceSettings = useMemo(() => normalizeInterfaceSettings(data.preferences.interfaceSettings), [data.preferences.interfaceSettings]);
  const [interfaceRevision, setInterfaceRevision] = useState(0);
  useEffect(() => { applyAppearance(data.preferences.appearance); }, [data.preferences.appearance]);
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
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const [focusedQuoteId, setFocusedQuoteId] = useState<string | null>(null);
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
  useEffect(() => { window.dispatchEvent(new Event('desktop-shell-ready')); }, []);
  const [navigationTarget, setNavigationTarget] = useState<{ session: Session; reading?: SessionReading } | null>(null);
  const [navigationSlow, setNavigationSlow] = useState(false);
  const navigationSequence = useRef(0);
  const navigationPending = useRef<{ sequence: number; session: Session; reading?: SessionReading } | null>(null);
  const readingCache = useRef(new SessionReadingCache());
  const previewPosition = useRef<ReadingPosition | undefined>(undefined);
  const readingRestore = useRef<{ runtimeId?: string; position: ReadingPosition; expectedTop?: number } | undefined>(undefined);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const collapsedWorkspaces = new Set(data.preferences.collapsedWorkspaces ?? []);
  const workspaceDisclosureSave = useRef<Promise<void>>(Promise.resolve());
  const [sidebar, setSidebar] = useState(true);
  const [sessionQuery, setSessionQuery] = useState('');
  const searchingSessions = Boolean(sessionQuery.trim());
  const filteredSessions = useMemo(() => filterSessions(data.sessions, data.preferences, sessionQuery, bridge?.platform),
    [data.sessions, data.preferences, sessionQuery]);
  const [compactSidebar, setCompactSidebar] = useState(() => window.innerWidth <= 760);
  const [compactSidebarOpen, setCompactSidebarOpen] = useState(false);
  const compactSidebarRef = useRef(compactSidebar);
  const [settings, setSettings] = useState<Settings | null>(null);
  // The renderer cannot read the Windows dark mode itself: prefers-color-scheme
  // stays light in this packaged renderer, so the main process owns it and
  // pushes changes here.
  const [systemDark, setSystemDark] = useState(() => window.desktopTheme?.systemDark ?? false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [tab, setTab] = useState('account');
  const [capabilityTarget, setCapabilityTarget] = useState<CapabilityTarget>();
  const [capabilityRevision, setCapabilityRevision] = useState(0);
  const [details, setDetails] = useState('');
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const firstSend = useRef(false);
  const [queuePreviewOpen, setQueuePreviewOpen] = useState(false);
  const [liveChangesOpen, setLiveChangesOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState<'auto' | 'turns' | 'summary' | 'context' | 'review' | 'terminal' | 'browser' | 'file' | 'subagent' | null>('auto');
  const [contextView, setContextView] = useState<'status' | 'context' | 'clm'>('context');
  const [statusRevision, setStatusRevision] = useState(0);
  const [expandedRightPanel, setExpandedRightPanel] = useState<'context' | 'review' | 'terminal' | 'browser' | 'file' | 'subagent' | null>(null);
  const [previewFile, setPreviewFile] = useState<FilePreviewData>();
  const [browserWidth, setBrowserWidth] = useState<'standard' | 'wide'>('standard');
  const [terminalWidth, setTerminalWidth] = useState<'standard' | 'wide'>('standard');
  const [bottomTerminalOpen, setBottomTerminalOpen] = useState(false);
  const terminalBottomHost = useRef<HTMLDivElement>(null);
  const terminalRightHost = useRef<HTMLDivElement>(null);
  const panelPreferences = normalizePanelPreferences(data.preferences);
  const terminalDock = panelPreferences.terminalDock;
  const [handleBlocked, setHandleBlocked] = useState(false);
  const openingSequence = useRef(0);
  const openFile = useCallback(async (target?: FileTarget, destination?: string, toggle = true) => {
    if (!bridge) throw new Error('Desktop unavailable');
    const sequence = ++openingSequence.current;
    const before = rightPanel === 'browser' ? await bridge.browserList() : undefined;
    const result = await bridge.fileOpen(target, destination);
    if (sequence !== openingSequence.current || !result || result.destination === 'external') return;
    setDetails('');
    if (result.destination === 'preview') {
      const same = previewFile && workspaceKey(previewFile.path) === workspaceKey(result.file.path);
      if (toggle && target && same && rightPanel === 'file' && !details) { setRightPanel(null); return; }
      setPreviewFile(result.file); setRightPanel('file');
    } else {
      const same = before?.activeId === result.browser.activeId;
      setRightPanel(toggle && same && rightPanel === 'browser' && !details ? null : 'browser');
    }
  }, [rightPanel, details, previewFile]);
  const openWeb = useCallback(async (address: string) => {
    if (!bridge) throw new Error('Desktop unavailable');
    const sequence = ++openingSequence.current;
    const before = await bridge.browserList();
    if (rightPanel === 'browser' && !details && before.tabs.find(tab => tab.id === before.activeId)?.url === address) {
      setRightPanel(null); return;
    }
    await bridge.browserOpenLink(address);
    if (sequence !== openingSequence.current) return;
    setDetails(''); setRightPanel('browser');
  }, [rightPanel, details]);
  const [selectedSubagent, setSelectedSubagent] = useState<SubagentTaskKey | null>(null);
  const [subagentView, setSubagentView] = useState<'overview' | 'agent'>('agent');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [selectedWorkflowAgent, setSelectedWorkflowAgent] = useState<string | null>(null);
  const workflows = useMemo(() => workflowsFromMessages(data.messages, busy), [data.messages, busy]);
  const turnWorkflows = useMemo(() => currentTurnWorkflows(data.messages, busy), [data.messages, busy]);
  const runningWorkflow = busy ? [...turnWorkflows].reverse().find(flow => workflowIsActive(flow.status)) : undefined;
  const latestWorkflow = runningWorkflow ?? workflows.at(-1);
  const currentTurnWorkflow = runningWorkflow ?? turnWorkflows.at(-1);
  const currentGoal = data.launch?.goal?.status === 'complete' ? undefined : data.launch?.goal;
  const completedGoalResponse = useMemo(() => goalCompletionResponse(data.messages, data.launch?.goal), [data.messages, data.launch?.goal]);
  const hasTaskStatus = Boolean(currentGoal || data.launch?.plan && !data.launch.planArmed || data.launch?.ultracode || currentTurnWorkflow);
  const [taskStatusOpen, setTaskStatusOpen] = useState(false);
  useEffect(() => { setTaskStatusOpen(false); }, [data.runtimeId]);
  const turnUltracode = Boolean(busy && (data.launch?.ultracodeTurn || currentGoal?.status === 'active' && currentGoal.ultracode));
  const openWorkflow = useCallback((id: string) => {
    const same = rightPanel === 'subagent' && !details && subagentView === 'overview' && selectedWorkflow === id;
    if (selectedWorkflow !== id) setSelectedWorkflowAgent(null);
    setSelectedWorkflow(id); setSubagentView('overview'); setDetails(''); setRightPanel(same ? null : 'subagent');
  }, [rightPanel, details, subagentView, selectedWorkflow]);
  const [repositoryRequest, setRepositoryRequest] = useState<{ runtimeId?: string; sequence: number }>();
  // The panel reads from live messages, so a subagent that finishes while it stays open keeps
  // updating instead of freezing on the status captured when the row was clicked.
  const openSubagentTask = useMemo(() => findSubagentTask(data.messages, selectedSubagent), [data.messages, selectedSubagent]);
  const openSubagent = useCallback((task: SubagentTask) => {
    const alreadyOpen = rightPanel === 'subagent' && !details && subagentView === 'agent' && !selectedWorkflowAgent
      && selectedSubagent?.toolCallId === task.toolCallId && selectedSubagent?.taskIndex === task.taskIndex
      && selectedSubagent?.agent === task.agent && selectedSubagent.task === task.task;
    setSelectedSubagent({ agent: task.agent, task: task.task, toolCallId: task.toolCallId, taskIndex: task.taskIndex });
    setSubagentView('agent'); setSelectedWorkflowAgent(null);
    setDetails('');
    setRightPanel(alreadyOpen ? null : 'subagent');
  }, [rightPanel, details, selectedSubagent, subagentView, selectedWorkflowAgent]);
  const [summarySpace, setSummarySpace] = useState(false);
  const appLayout = useRef<HTMLDivElement>(null);
  const rightRail = useRef<HTMLElement>(null);
  const [requests, setRequests] = useState<UIRequest[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(true);
  const questionDrafts = useRef(new Map<string, QuestionDraft>());
  const [resubmittingPlan, setResubmittingPlan] = useState(false);
  const resubmitPlanLock = useRef(false);
  const [answer, setAnswer] = useState('');
  const [levels, setLevels] = useState<string[]>([]);
  const [commands, setCommands] = useState<{ name: string; description?: string; source?: string }[]>(desktopCommands([]));
  const [renaming, setRenaming] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ type: 'session' | 'workspace'; id: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ type: 'session' | 'workspace'; id: string; x: number; y: number } | null>(null);
  const [removeProject, setRemoveProject] = useState<string | null>(null);
  const [sessionMove, setSessionMove] = useState<{ session: Session; destination?: string } | null>(null);
  const [unavailableWorkspace, setUnavailableWorkspace] = useState<string | null>(null);
  const sidebarTree = useSidebarMotion(JSON.stringify([data.preferences.workspaces, data.preferences.pinnedWorkspaces,
    data.preferences.sessionOrder, data.preferences.sessionSort, data.preferences.archivedSessionIds,
    sessionQuery, data.sessions.map(session => [session.id, session.cwd, session.modified])]));
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
  const sessionDrag = useSidebarReorder(!searchingSessions && !loading && !sessionMove && (compactSidebar ? compactSidebarOpen : sidebar), manualOrder,
    (id, target, after, kind) => kind === 'session' ? reorderSession(id, target, after) : reorderWorkspace(id, target, after),
    (id, destination) => {
      const session = data.sessions.find(session => session.id === id);
      if (session?.path) { setContextMenu(null); setSessionMove({ session, destination }); }
    });
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
  const composerBySession = useRef(new Map<string, { draft: string; quotes: ChatQuote[]; attachments: ComposerAttachment[]; follow: boolean; top: number; anchor?: ReadingPosition['anchor'] }>());
  const errorsBySession = useRef(new Map<string, string>());
  const view = useRef({ runtimeId: data.runtimeId, sessionId: data.state?.sessionId, draftId: data.draftId, draft, quotes, attachments });
  view.current = { runtimeId: data.runtimeId, sessionId: data.state?.sessionId, draftId: data.draftId, draft, quotes, attachments };
  useLayoutEffect(() => { quoteScopeRef.current = quoteScope; }, [quoteScope]);
  const followLayout = useCallback(() => {
    const viewport = scroll.current;
    if (viewport && navigationPending.current) {
      const pending = navigationPending.current;
      if (pending.reading && previewPosition.current) restoreReadingPosition(viewport, pending.reading.messages, previewPosition.current);
      return;
    }
    if (viewport && readingRestore.current?.runtimeId === viewId.current && readingRestore.current) {
      restoreReadingPosition(viewport, latestData.current.messages, readingRestore.current.position);
      readingRestore.current.expectedTop = viewport.scrollTop;
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode && transcript.current?.contains(selection.anchorNode)) return;
    if (follow.current && viewport) viewport.scrollTop = viewport.scrollHeight;
  }, []);
  useEffect(() => {
    setNavigationSlow(false);
    if (!navigationTarget) return;
    const timer = setTimeout(() => setNavigationSlow(true), 180);
    return () => clearTimeout(timer);
  }, [navigationTarget?.session.id]);
  useLayoutEffect(followLayout, [navigationTarget, followLayout]);
  const sidebarVisible = compactSidebar ? compactSidebarOpen : sidebar;
  const bottomTerminalExpanded = terminalDock === 'bottom' && bottomTerminalOpen && expandedRightPanel === 'terminal'
    && !usageOpen && !scheduledOpen && !details;
  const visibleRightPanel = usageOpen || scheduledOpen || bottomTerminalExpanded ? null : rightPanel === 'auto' ? (summarySpace ? 'summary' : null) : rightPanel;
  const inspectionOpen = visibleRightPanel === 'summary' || visibleRightPanel === 'context';
  const summaryOverlay = inspectionOpen && !summarySpace;
  const inspectorExpanded = bottomTerminalExpanded || expandedRightPanel === visibleRightPanel && !details &&
    (visibleRightPanel === 'context' || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || visibleRightPanel === 'file' || visibleRightPanel === 'subagent');
  const terminalOpen = !usageOpen && !scheduledOpen && (terminalDock === 'bottom'
    ? bottomTerminalOpen && (!inspectorExpanded || bottomTerminalExpanded)
    : visibleRightPanel === 'terminal' && !details);
  useEffect(() => {
    if (bottomTerminalExpanded) return;
    if (!usageOpen && expandedRightPanel && (expandedRightPanel !== visibleRightPanel || details)) setExpandedRightPanel(null);
  }, [expandedRightPanel, visibleRightPanel, details, usageOpen, bottomTerminalExpanded]);
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
      const elements = [...app.querySelectorAll<HTMLElement>('.conversation-shell, .composer-wrap, .main-content > .conversation-scroll-track')];
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
  const closeTerminal = useCallback(() => {
    if (terminalDock === 'right') { closeRightPanel(); return; }
    setBottomTerminalOpen(false);
    setExpandedRightPanel(value => value === 'terminal' ? null : value);
    rightRail.current?.querySelector<HTMLButtonElement>('[aria-controls="terminal-panel"]')?.focus();
  }, [terminalDock, closeRightPanel]);
  useEffect(() => {
    if ((!visibleRightPanel && !terminalOpen) || details || settingsOpen || preview || requests.length || renaming) return;
    const escape = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('.xterm')) return;
      if (event.key === 'Escape' && !event.defaultPrevented) {
        const inTerminal = event.target instanceof Element && event.target.closest('#terminal-panel');
        if (terminalDock === 'bottom' && terminalOpen && (inTerminal || !visibleRightPanel)) {
          event.preventDefault();
          if (bottomTerminalExpanded) {
            setExpandedRightPanel(null);
            document.querySelector<HTMLButtonElement>('#terminal-panel .right-panel-header button[aria-pressed]')?.focus();
          } else closeTerminal();
          return;
        }
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
  }, [visibleRightPanel, details, settingsOpen, preview, requests.length, renaming, closeRightPanel, inspectorExpanded,
    terminalDock, terminalOpen, bottomTerminalExpanded, closeTerminal]);
  const zh = data.preferences.language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const connected = data.status === 'connected' || data.status === 'ready';
  const anyBusy = data.runtimes?.some(runtime => runtime.status === 'running' || runtime.status === 'waiting') ?? busy;
  const composerBusy = busy || Boolean(data.state?.isCompacting);
  const action = composerAction(composerBusy, draft, attachments.length + quotes.length);
  const current = data.sessions.find(s => s.id === data.state?.sessionId);
  const queuedMessages = useMemo(() => data.pendingMessages?.filter(item => !item.sending) ?? [], [data.pendingMessages]);
  const hasPendingReceipt = data.pendingMessages?.some(item => item.sending);
  const activeTitle = sessionTitle(navigationTarget?.session ?? current ?? (data.state?.sessionName ? { name: data.state.sessionName, firstMessage: '' } : undefined), t('新会话', 'New session'));
  const turns = useMemo(() => conversationTurns(data.messages, data.preferences.language), [data.messages, data.preferences.language]);
  const workspaceTitle = (path: string) => data.preferences.workspaceNames?.[workspaceKey(path)] || basename(path);
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => { try { setError(''); return await action(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } };
  const rememberView = () => {
    const previous = view.current;
    if (previous.sessionId) composerBySession.current.set(previous.sessionId, {
      draft: previous.draft, quotes: previous.quotes, attachments: previous.attachments,
      ...captureReadingPosition(scroll.current, latestData.current.messages, follow.current),
    });
    const session = latestData.current.sessions.find(session => session.id === previous.sessionId);
    if (session) readingCache.current.set(session, latestData.current.messages, latestData.current.modelChanges);
  };
  const installSnapshot = (value: Snapshot) => {
    acceptQuitReview(value.quitReview);
    if (!messageRevision.current.acceptSnapshot(value)) return false;
    const previous = view.current;
    if (previous.runtimeId !== value.runtimeId || navigationPending.current) {
      if (!navigationPending.current) rememberView();
      const saved = value.state?.sessionId ? composerBySession.current.get(value.state.sessionId) : undefined;
      setDraft(saved?.draft ?? ''); setQuotes(saved?.quotes ?? []);
      setAttachments(saved?.attachments ?? []); attachmentsRef.current = saved?.attachments ?? [];
      setArrivingUser(null); setError(value.state?.sessionId ? errorsBySession.current.get(value.state.sessionId) ?? '' : ''); setNotice(value => value?.icon ? value : null); setDetails('');
      if (value.state?.sessionId) errorsBySession.current.delete(value.state.sessionId);
      stoppingRef.current = false; setStopping(false);
      follow.current = saved?.follow ?? true;
      setAwayFromBottom(!follow.current);
      readingRestore.current = saved && !saved.follow ? { runtimeId: value.runtimeId, position: saved } : undefined;
    }
    viewId.current = value.runtimeId;
    setUnavailableWorkspace(value.workspaceIssue ?? null);
    readingCache.current.retain(value.sessions);
    setData(value); setBusy(Boolean(value.state?.isStreaming));
    setRequests(value.requests ?? []);
    setRunMetrics(value.state?.sessionId ? metricsBySession.current.get(value.state.sessionId) ?? null : null);
    return true;
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
    setSelectedWorkflow(null); setSelectedWorkflowAgent(null); setSubagentView('agent');
    if (switching.current) return;
    switching.current = true; setLoading(true);
    let succeeded = false;
    await run(async () => { const result = await action(); if (result) installSnapshot(result); succeeded = true; });
    switching.current = false; setLoading(false);
    // Include events that arrived between the navigation snapshot and its paint.
    if (succeeded) void run(refresh);
  };
  const navigateSession = async (session: Session, cronRuntimeId?: string) => {
    setUsageOpen(false);
    if (!cronRuntimeId) setScheduledOpen(false);
    if (!bridge || switching.current && !navigationPending.current) return false;
    if (!cronRuntimeId && !navigationPending.current && session.id === view.current.sessionId) return true;
    if (!navigationPending.current) rememberView();
    const sequence = ++navigationSequence.current;
    const reading = readingCache.current.get(session);
    navigationPending.current = { sequence, session, reading };
    previewPosition.current = composerBySession.current.get(session.id) ?? { follow: true, top: 0 };
    readingRestore.current = undefined;
    switching.current = true; setLoading(true);
    setNavigationTarget({ session, reading }); setError(''); setRequests([]);
    setSelectedSubagent(null); setSelectedWorkflow(null); setSelectedWorkflowAgent(null); setSubagentView('agent'); setRightPanel(null); setContextMenu(null);
    setQueuePreviewOpen(false); setLiveChangesOpen(false);
    let failed = false;
    try {
      const result = cronRuntimeId ? await bridge.cronOpenHost(cronRuntimeId) : await bridge.navigateSession(session.id);
      if (navigationPending.current?.sequence !== sequence) return false;
      if (!result) throw new Error(t('会话切换已取消', 'Session navigation was cancelled'));
      const saved = composerBySession.current.get(session.id);
      if (saved && reading && previewPosition.current) composerBySession.current.set(session.id, { ...saved, ...previewPosition.current });
      if (result.state?.sessionId !== session.id || !installSnapshot(result)) {
        const latest = await bridge.snapshot();
        if (navigationPending.current?.sequence !== sequence) return false;
        if (latest.state?.sessionId !== session.id || !installSnapshot(latest)) throw new Error(t('会话状态已变化，请重试', 'Conversation state changed; try again'));
      }
      if (cronRuntimeId) setScheduledOpen(false);
    } catch (error) {
      if (navigationPending.current?.sequence !== sequence) return false;
      failed = true;
      // Reconcile with the main-process identity, including a commit preceding this click.
      try {
        const value = await bridge.snapshot();
        if (navigationPending.current?.sequence !== sequence) return false;
        installSnapshot(value);
        const saved = value.state?.sessionId ? composerBySession.current.get(value.state.sessionId) : undefined;
        readingRestore.current = saved ? { runtimeId: value.runtimeId, position: saved } : undefined;
      } catch { /* Keep the last confirmed view if the snapshot also failed. */ }
      setError(String(error instanceof Error ? error.message : error));
    } finally {
      if (navigationPending.current?.sequence === sequence) {
        navigationPending.current = null; previewPosition.current = undefined;
        setNavigationTarget(null); switching.current = false; setLoading(false);
        if (!failed) void run(refresh);
      }
    }
    return !failed;
  };
  const rawCommand = async (type: string, args?: Record<string, unknown>) => {
    if (navigationPending.current) throw new Error(t('请等待会话打开', 'Wait for the conversation to open'));
    const id = viewId.current;
    const result = await bridge!.command(type, args, id);
    if (type === 'new_session') installSnapshot(result);
    else if (!['prompt', 'abort', 'extension_ui_response'].includes(type) && id === viewId.current) await refresh();
    return result;
  };
  const command = async (type: string, args?: Record<string, unknown>) => run(() => rawCommand(type, args));
  useEffect(() => {
    void run(refresh).finally(() => setLoading(false));
    if (!bridge) return;
    prepareCompletionSound();
    const unsubscribe = bridge.onEvent(event => {
      if (event.type === 'desktop_quit_review') { acceptQuitReview(event.state); return; }
      if (event.type === 'desktop_workspace_unavailable') { setUnavailableWorkspace(event.path); return; }
      if (event.type === 'desktop_task_completed') {
        playCompletionSound({ runtimeId: event.runtimeId, sessionId: event.sessionId });
        return;
      }
      if (event.type === 'desktop_runtime_replaced') {
        const previousId = viewId.current;
        if (switching.current || !event.sessionId || previousId !== event.previousRuntimeId
          || view.current.sessionId !== event.sessionId) return;
        void run(async () => {
          const value = await bridge.snapshot();
          if (!switching.current && viewId.current === previousId && view.current.sessionId === event.sessionId
            && value.runtimeId === event.runtimeId && value.state?.sessionId === event.sessionId) installSnapshot(value);
        });
        return;
      }
      if (event.type === 'desktop_sessions_changed') { void run(refresh); return; }
      if (event.sessionId && ['desktop_model_selection', 'desktop_history', 'message_start', 'message_update', 'message_end', 'tool_execution_update', 'tool_execution_end'].includes(event.type)) {
        readingCache.current.delete(event.sessionId);
      }
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
        if (!switching.current && (!event.runtimeId || event.runtimeId === viewId.current)) {
          if (event.type === 'agent_start') setClock(receivedAt);
          setRunMetrics(id ? metricsBySession.current.get(id) ?? null : null);
        }
      }
      if (event.type === 'extension_ui_request' && event.method === 'set_editor_text') {
        if (!switching.current && (!event.runtimeId || event.runtimeId === viewId.current)) {
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
      if (['extension_ui_request', 'desktop_ui_expired', 'desktop_model_selection', 'desktop_queue', 'desktop_history', 'message_start', 'message_update', 'message_end', 'tool_execution_update', 'tool_execution_end'].includes(event.type)
        && !messageRevision.current.acceptEvent(event)) return;
      if (event.type === 'agent_end' || event.type === 'tool_execution_end'
        && ['enter_plan_mode', 'exit_plan_mode'].includes(event.toolName)) setStatusRevision(value => value + 1);
      if (event.type === 'desktop_model_selection') setData(d => ({ ...d, modelSelection: event.modelSelection, modelChanges: event.modelChanges, state: event.state ?? d.state }));
      if (event.type === 'desktop_queue') setData(d => ({ ...d, pendingMessages: event.pendingMessages }));
      if (event.type === 'desktop_stats') setData(d => ({ ...d, stats: event.stats }));
      if (event.desktopEstimate) setData(d => ({ ...d, estimate: event.desktopEstimate }));
      if (event.type === 'desktop_history') setData(d => ({ ...d, messages: event.messages }));
      if (event.type === 'desktop_ui_expired') {
        questionDrafts.current.delete(event.id);
        setRequests(previous => previous.filter(request => request.id !== event.id));
      }
      if (event.type === 'agent_start') setBusy(true);
      if (['live_context', 'auto_clm_end', 'agent_end', 'desktop_history'].includes(event.type)) setStatusRevision(value => value + 1);
      if (['compaction_start', 'compaction_end', 'auto_compaction_start', 'auto_clm_start', 'auto_compaction_end', 'auto_clm_end'].includes(event.type))
        setData(d => ({ ...d, state: d.state ? { ...d.state, isCompacting: event.type.endsWith('_start') } : d.state }));
      if (event.type === 'agent_end') { setBusy(false); stoppingRef.current = false; setStopping(false); void run(refresh); }
      if (event.type === 'desktop_exit') { setBusy(false); stoppingRef.current = false; setStopping(false); setRunMetrics(null); setNotice(null); setData(d => ({ ...d, status: 'disconnected', stats: undefined, permissionPreset: undefined })); setRequests([]); }
      if (event.type === 'desktop_permission') setData(d => ({ ...d, permissionPreset: event.preset }));
      if (event.type === 'desktop_launch') setData(d => ({ ...d, launch: event.launch }));
      if (event.type === 'desktop_status') {
        if (event.status === 'connecting') notifiedMcp.current.clear();
        setData(d => ({ ...d, status: event.status }));
      }
      if (event.type === 'desktop_error') setError(event.message);
      if (event.type === 'desktop_system_theme') setSystemDark(Boolean(event.dark));
      if (['message_start', 'message_end'].includes(event.type) && event.message && isUserMessage(event.message)) setArrivingUser(event.message);
      if (['message_start', 'message_update', 'message_end', 'agent_end', 'desktop_exit'].includes(event.type)) setData(d => ({ ...d, messages: applyMessageEvent(d.messages, event) }));
      if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
        setData(d => ({ ...d, messages: applyToolResult(d.messages, event) }));
      }
      if (event.type === 'extension_ui_request') {
        if (['select', 'input', 'editor', 'confirm'].includes(event.method)) setRequests(r => [...r.filter(v => v.id !== event.id), event as UIRequest]);
        if (event.method === 'notify' && event.message) {
          if (event.notifyType === 'info' && /^Permission mode: (Ask|Approve for Me|Full Access)$/.test(event.message)) return;
          if (event.notifyType === 'info' && /^(?:Goal commands:|Goal set:|Goal (?:resumed|updated|cleared)\.|Goal paused[.;]|Goal token budget:|Plan mode (?:enabled|disabled)\.|Ultra(?:code|loop) (?:is on for the session\.|session mode))/.test(event.message)) return;
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
              setNotice({ id: ++nextNoticeId.current, message: clmNotice(event.message, latestData.current.preferences.language), type: event.notifyType, mcpServer });
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
    if (!connected || !data.runtimeId) {
      setLevels(data.state?.model?.thinkingLevels ?? []);
      setCommands(desktopCommands([]).filter(command => command.name === 'status' || data.draftId && command.source === 'desktop'));
      return;
    }
    const id = data.runtimeId;
    void run(async () => {
      const [effort, available] = await Promise.all([bridge!.command('get_available_thinking_levels', undefined, id), bridge!.command('get_commands', undefined, id)]);
      if (viewId.current === id) { setLevels((data.modelSelection?.model ?? data.state?.model)?.thinkingServiceDefault ? [] : effort.levels); setCommands(desktopCommands(available.commands)); }
    });
  }, [connected, data.runtimeId, data.draftId, data.state?.model?.id, data.state?.model?.provider, data.state?.model?.thinkingLevels, data.state?.model?.thinkingServiceDefault, data.modelSelection?.model]);
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
    applyTheme(data.preferences.theme, systemDark, data.preferences.accentColor);
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
  }, [data.preferences.theme, data.preferences.accentColor, systemDark, zh]);
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
    if (quitReview.request) return;
    if (!settingsOpen && !mcpEdit && !(requests.length && approvalOpen && !questionnaire(requests[0]) && !planReview(requests[0]) && requests[0]?.title !== 'Desktop Plan refinements' && !permissionApprovalPresentation(requests[0], data.messages, data.preferences.language, data.runtimeId)) && !renaming) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
    const controls = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])];
    const risk = fullAccessRiskPresentation(requests[0], data.preferences.language);
    const plan = planReview(requests[0]);
    (plan ? dialog?.querySelector<HTMLElement>('button') : risk ? controls().at(-1) : controls()[0])?.focus();
    const handler = (e: KeyboardEvent) => {
      if (risk && e.key === 'Escape') {
        e.preventDefault();
        const request = requests[0];
        void run(async () => {
          await bridge!.command('extension_ui_response', { id: request.id, cancelled: true }, request.runtimeId ?? viewId.current);
          setRequests(previous => previous.filter(item => item.id !== request.id));
        });
        return;
      }
      if (e.key !== 'Tab') return;
      const items = controls(); if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [settingsOpen, Boolean(mcpEdit), requests[0]?.id, approvalOpen, renaming, quitReview.request?.id]);
  const respond = async (value: Record<string, unknown>) => {
    if (navigationPending.current) return;
    const r = requests[0]; if (!r) return;
    await run(async () => { await bridge!.command('extension_ui_response', { id: r.id, ...value }, r.runtimeId ?? viewId.current); setRequests(q => q.filter(v => v.id !== r.id)); });
  };
  const loginProfileRevision = useRef(0);
  const settingsRequestRevision = useRef(0);
  const chooseLoginProfile = (profile: string) => {
    loginProfileRevision.current++;
    setLoginProfile(profile);
  };
  const finishSettingsClose = useCallback(() => {
    setSettingsOpen(false);
    setSettingsClosing(false);
    setKey('');
  }, []);
  const closeSettings = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finishSettingsClose();
    else setSettingsClosing(true);
  };
  const openUsage = () => {
    finishSettingsClose();
    setScheduledOpen(false);
    setUsageOpen(true);
    setCompactSidebarOpen(false);
  };
  const openScheduled = () => {
    if (!bridge) return;
    setUsageOpen(false); setDetails(''); setExpandedRightPanel(null);
    setScheduledOpen(true); setCompactSidebarOpen(false);
  };
  useEffect(() => {
    if (!settingsClosing) return;
    // Keep dismissal reliable if an animation is cancelled or motion preferences change.
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduce = () => { if (motion.matches) finishSettingsClose(); };
    const timer = window.setTimeout(finishSettingsClose, 260);
    const containKeyboard = (event: KeyboardEvent) => {
      if ((event.target as Element)?.closest?.('.quit-confirmation')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('keydown', containKeyboard, true);
    motion.addEventListener('change', reduce);
    return () => { window.clearTimeout(timer); motion.removeEventListener('change', reduce); document.removeEventListener('keydown', containKeyboard, true); };
  }, [settingsClosing, finishSettingsClose]);
  const openSettings = async () => {
    const request = ++settingsRequestRevision.current;
    const selection = loginProfileRevision.current;
    setSettingsClosing(false); setSettingsOpen(true); await run(async () => {
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
    if (!composerBusy || !connected || stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    const id = viewId.current;
    await run(async () => {
      try { await bridge!.command('abort', undefined, id); }
      catch (error) { if (viewId.current === id) { stoppingRef.current = false; setStopping(false); throw error; } }
    });
  };
  const send = async () => {
    const capability = capabilityCommand(draft, attachments.length, quotes.length);
    if (!navigationPending.current && !loading && capability) {
      setDraft(''); setCapabilityTarget(capability); setTab(capability.page); void openSettings();
      return;
    }
    const local = desktopCommand(draft, attachments.length, quotes.length);
    if (!navigationPending.current && !loading && local) {
      if (local.name === 'compact') {
        if (!connected || !data.runtimeId || composerBusy || data.state?.isCompacting || firstSend.current) {
          setError(t('请等待当前任务结束，并在已有会话中压缩上下文', 'Wait for the current task to finish and compact an existing conversation'));
          return;
        }
        const message = draft;
        const owner = viewId.current;
        setLoading(true);
        try {
          await run(async () => {
            await rawCommand('compact', { customInstructions: local.args || undefined });
            if (viewId.current === owner) setDraft(value => value === message ? '' : value);
          });
        } finally { setLoading(false); }
        return;
      }
      setDraft('');
      if (local.name === 'usage') {
        if (local.args === 'account') { setTab('account'); await openSettings(); }
        else openUsage();
      } else if (local.name === 'cron') openScheduled();
      else { setDetails(''); setContextView(local.name === 'clm' ? 'clm' : 'status'); setRightPanel('context'); }
      return;
    }
    if (navigationPending.current || (!draft.trim() && !attachments.length && !quotes.length) || !connected || loading || firstSend.current) return;
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
    const restoreInput = (error?: unknown) => {
      if (quoteScopeRef.current !== deliveryScope) {
        if (sessionId) {
          const saved = composerBySession.current.get(sessionId);
          if (error !== undefined) errorsBySession.current.set(sessionId, String(error instanceof Error ? error.message : error));
          composerBySession.current.set(sessionId, {
            draft: saved?.draft ? `${message}\n${saved.draft}` : message,
            quotes: restoreQuotes(sentQuotes, saved?.quotes ?? []),
            attachments: [...attached, ...saved?.attachments ?? []],
            follow: saved?.follow ?? true, top: saved?.top ?? 0,
          });
        }
        return false;
      }
      setDraft(value => value ? `${message}\n${value}` : message);
      setQuotes(value => restoreQuotes(sentQuotes, value));
      setAttachments(value => { const restored = [...attached, ...value]; attachmentsRef.current = restored; return restored; });
      return true;
    };
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
            switching.current = false;
            if (data.permissionPreset === 'full-access') {
              const permission = await bridge!.command('set_permission_preset', { preset: 'full-access' }, id);
              if (permission?.cancelled) { restoreInput(); return; }
              await refresh();
            }
          } finally {
            firstSend.current = false; switching.current = false; setLoading(false);
          }
        }
        const submission = bridge!.command('prompt', { message: prompt, images: attached.filter(item => item.kind === 'image').map(item => item.content), files: attached.filter(item => item.kind === 'file').map(item => item.id) }, id);
        if (composerBusy) queueSend.current = submission;
        try { await submission; } finally { if (queueSend.current === submission) queueSend.current = null; }
      } catch (e) {
        if (restoreInput(e)) throw e;
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
  const setPreference = async (patch: any) => run(async () => {
    const p = await bridge!.preferences(patch);
    setData(d => ({ ...d, preferences: p }));
    if (patch.interfaceSettings !== undefined) setInterfaceRevision(value => value + 1);
  });
  const changeTerminalDock = (next: TerminalDock) => void run(async () => {
    const preferences = await bridge!.preferences({ terminalDock: next });
    setData(value => ({ ...value, preferences }));
    setExpandedRightPanel(null);
    setBottomTerminalOpen(next === 'bottom');
    setRightPanel(value => next === 'right' ? 'terminal' : value === 'terminal' ? null : value);
  });
  const saveMcp = async () => run(async () => {
    if (!mcpEdit) return;
    const parsed = JSON.parse(mcpEdit.args || '[]'); const secrets = JSON.parse(mcpEdit.secrets || '{}');
    await bridge!.saveMcp(mcpEdit.name, { ...mcpEdit.config, args: parsed }, secrets);
    setMcpEdit(null); setSettings(await bridge!.settings()); setCapabilityRevision(value => value + 1);
  });
  const workspaceGroups = new Map<string, { path: string; sessions: typeof data.sessions }>();
  for (const path of data.preferences.workspaces) {
    const key = workspaceKey(path);
    if (!workspaceGroups.has(key)) workspaceGroups.set(key, { path, sessions: [] });
  }
  const sessionWorkspaceKey = (session: typeof data.sessions[number]) => workspaceKey(session.workspacePath ?? session.cwd);
  const archived = new Set(data.preferences.archivedSessionIds ?? []);
  const visibleSessions = orderSessions(filteredSessions, data.preferences);
  const archivedSessions = data.sessions.filter(session => archived.has(session.id));
  const independentSessions = visibleSessions.filter(session => session.independent ?? !workspaceGroups.has(sessionWorkspaceKey(session)));
  for (const session of visibleSessions) if (!independentSessions.includes(session)) workspaceGroups.get(sessionWorkspaceKey(session))?.sessions.push(session);
  const showContext = (event: React.MouseEvent, type: 'session' | 'workspace', id: string) => {
    event.preventDefault();
    setContextMenu({ type, id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 206)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 230)) });
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
      data-reorder-locked={!s.path || ['running', 'waiting'].includes(activity)}
      className={`session-row ${!scheduledOpen && s.id === (navigationTarget?.session.id ?? data.state?.sessionId) ? 'selected' : ''} ${sessionDrag?.id === s.id ? 'session-dragging' : ''} ${sessionDrag?.target === s.id ? sessionDrag.after ? 'drop-after' : 'drop-before' : ''}`}
      onContextMenu={e => showContext(e, 'session', s.id)}>
      <button aria-current={!scheduledOpen && s.id === (navigationTarget?.session.id ?? data.state?.sessionId) ? 'page' : undefined}
        disabled={!bridge || loading && !navigationTarget} onClick={() => void navigateSession(s)}
        aria-keyshortcuts={!searchingSessions && manualOrder && group !== '__archived__' ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
        onKeyDown={e => {
          if (searchingSessions || !manualOrder || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || group === '__archived__') return;
          e.preventDefault();
          const siblings = group === '__independent__' ? independentSessions : workspaceGroups.get(group)?.sessions ?? [];
          const index = siblings.findIndex(session => session.id === s.id);
          const target = siblings[index + (e.key === 'ArrowUp' ? -1 : 1)];
          if (target) reorderSession(s.id, target.id, e.key === 'ArrowDown');
        }}>
        <i className={`session-activity ${activity}`} role={activity === 'idle' ? undefined : 'img'} aria-hidden={activity === 'idle' ? true : undefined} aria-label={activity === 'idle' ? undefined : label}/>
        <span title={searchingSessions ? `${sessionTitle(s, t('新会话', 'New session'))}\n${s.firstMessage}\n${s.cwd}` : undefined}>
          {sessionTitle(s, t('新会话', 'New session'))}
          {searchingSessions && s.name && s.firstMessage && <small className="session-search-preview">{s.firstMessage}</small>}
        </span>
        {navigationSlow && navigationTarget?.session.id === s.id && <span className="session-navigation-spinner" role="status" aria-label={t('正在打开会话', 'Opening conversation')}/>}
      </button>
      <IconButton title={t('更多操作', 'More actions')} aria-haspopup="menu" disabled={loading} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setContextMenu({ type: 'session', id: s.id, x: Math.min(rect.right, window.innerWidth - 206), y: Math.min(rect.bottom, window.innerHeight - 190) }); }}><MoreHorizontal size={15}/></IconButton>
    </div>;
  };
  const setWorkspaceExpanded = (key: string, expanded?: boolean) => {
    // Serialize clicks so rapid toggles cannot overwrite another group's saved state.
    const pending = workspaceDisclosureSave.current.then(async () => {
      const next = new Set(latestData.current.preferences.collapsedWorkspaces ?? []);
      const open = expanded ?? next.has(key);
      if (open) next.delete(key); else next.add(key);
      const saved = await bridge!.preferences({ collapsedWorkspaces: [...next] });
      latestData.current = { ...latestData.current, preferences: { ...latestData.current.preferences, collapsedWorkspaces: saved.collapsedWorkspaces } };
      setData(previous => ({ ...previous, preferences: { ...previous.preferences, collapsedWorkspaces: saved.collapsedWorkspaces } }));
    });
    workspaceDisclosureSave.current = pending.catch(() => {});
    return pending;
  };
  const toggleWorkspace = (key: string) => { void run(() => setWorkspaceExpanded(key)); };
  const independentExpanded = searchingSessions || !collapsedWorkspaces.has('__independent__');
  const createInWorkspace = async (path: string, _sessions: typeof data.sessions) => {
    setUsageOpen(false);
    setScheduledOpen(false);
    await run(() => setWorkspaceExpanded(workspaceKey(path), true));
    await applySnapshot(() => bridge!.beginSession(path));
  };
  const newSession = () => { setUsageOpen(false); setScheduledOpen(false); return applySnapshot(() => bridge!.beginSession(data.independent ? undefined : current?.workspacePath ?? data.preferences.workspace)); };
  const openProject = () => { setUsageOpen(false); setScheduledOpen(false); return applySnapshot(() => bridge!.chooseSessionProject()); };
  const repairProject = async (path: string) => {
    if (loading) return;
    setLoading(true);
    try {
      await run(async () => {
        const value = await bridge!.relocateWorkspace(path);
        if (!value) return;
        installSnapshot(value); setUnavailableWorkspace(null); setError('');
      });
    } finally { setLoading(false); }
  };
  const confirmRemoveProject = (path: string) => { setError(''); setRemoveProject(path); };
  const toggleSidebar = () => compactSidebar ? setCompactSidebarOpen(open => !open) : setSidebar(open => !open);
  const renderWorkspace = ([key, group]: [string, { path: string; sessions: Session[] }]) => {
    if (searchingSessions && !group.sessions.length) return null;
    const expanded = searchingSessions || !collapsedWorkspaces.has(key);
    return <section className={`workspace-group ${sessionDrag?.id === key ? 'session-dragging' : ''} ${sessionDrag?.target === key ? sessionDrag.after ? 'drop-after' : 'drop-before' : ''} ${sessionDrag?.workspaceTarget === group.path ? 'session-drop-target' : ''}`} key={key} aria-label={group.path}
      data-session-workspace={group.path}
      data-reorder-id={key} data-reorder-kind="workspace" data-reorder-group={pinnedWorkspaces.has(key) ? '__pinned__' : '__projects__'} data-reorder-title={workspaceTitle(group.path)}>
      <div className={`workspace-heading ${key === workspaceKey(data.preferences.workspace ?? '') ? 'current' : ''}`} onContextMenu={e => showContext(e, 'workspace', group.path)}>
        <button className="workspace-toggle" aria-label={workspaceTitle(group.path)} aria-expanded={expanded} aria-disabled={searchingSessions || undefined} onClick={() => { if (!searchingSessions) toggleWorkspace(key); }}
          aria-keyshortcuts={searchingSessions ? undefined : 'Alt+ArrowUp Alt+ArrowDown'} onKeyDown={e => {
            if (searchingSessions || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
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
      { label: t('新建独立会话', 'New independent session'), disabled: !bridge || loading, action: () => { setScheduledOpen(false); void applySnapshot(() => bridge!.beginSession()); } },
      { label: t('打开项目…', 'Open project...'), disabled: !bridge || loading, action: () => void openProject() },
      { label: t('打开会话文件夹', 'Open session folder'), disabled: !bridge || !data.runtimeId || loading, action: () => void run(() => bridge!.openSessionFolder()) },
      { label: t('退出应用', 'Quit application'), disabled: !bridge, action: () => void run(() => bridge!.windowControl('quit')) },
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
        document.querySelector<HTMLElement>('.composer > .composer-input')?.focus();
      } else await bridge.imageAction(action, target.src, target.name);
    });
  };
  const permissionApproval = !renaming ? permissionApprovalPresentation(requests[0], data.messages, data.preferences.language, data.runtimeId) : undefined;
  const accessRisk = !renaming ? fullAccessRiskPresentation(requests[0], data.preferences.language) : undefined;
  const reviewPlan = !renaming ? planReview(requests[0]) : undefined;
  const reviewQuestion = !renaming ? questionnaire(requests[0]) : undefined;
  const openQuestion = (callId: string) => {
    if (questionnaire(requests[0])?.callId === callId && !navigationPending.current) setApprovalOpen(true);
  };
  const respondQuestion = async (value: { value: string } | { cancelled: true }) => {
    const request = requests[0], owner = data.runtimeId;
    if (!request || !questionnaire(request) || !owner || navigationPending.current
      || viewId.current !== owner) throw new Error('Question is no longer active');
    await bridge!.command('extension_ui_response', { id: request.id, ...value }, owner);
    setRequests(previous => previous.filter(item => item.id !== request.id));
  };
  const canResubmitPlan = pendingPlanReview(data.messages, Boolean(data.launch?.plan));
  const resubmitPlan = async () => {
    if (resubmitPlanLock.current || busy || requests.length || !canResubmitPlan) return;
    resubmitPlanLock.current = true; setResubmittingPlan(true);
    try {
      await command('prompt', { message: t('请重新调用 exit_plan_mode 提交当前计划供我批阅。重新读取当前计划文件；在我批准前不要实施，也不要把这条请求视为批准。', 'Call exit_plan_mode again to submit the current proposal for review. Re-read the current plan file. Do not implement before my approval; this request is not approval.') });
    } finally { resubmitPlanLock.current = false; setResubmittingPlan(false); }
  };
  const planFeedback = !renaming && requests[0]?.method === 'input' && requests[0].title === 'Desktop Plan refinements';
  const taskStatusControls = <>
    <LaunchStatus key={`task-${data.runtimeId}`} placement="pulse" align={busy ? 'start' : 'end'}
      expanded={taskStatusOpen} onExpandedChange={setTaskStatusOpen}
      state={{ plan: Boolean(data.launch?.plan && !data.launch.planArmed), ultracode: Boolean(data.launch?.ultracode), goalArmed: false, goal: currentGoal }}
      turnUltracode={turnUltracode && !currentTurnWorkflow} language={data.preferences.language} disabled={!connected || loading}
      onMode={(mode, enabled) => rawCommand('set_launch_mode', { mode, enabled })}
      onAction={(action, value) => rawCommand('goal_action', { action, value })}
      onDisableStanding={() => rawCommand('disable_standing_ultracode')}/>
    {currentTurnWorkflow && <WorkflowTrigger flow={currentTurnWorkflow} language={data.preferences.language} onOpen={openWorkflow} settled={!busy}/>}
    {reviewQuestion && <TurnStatusTrigger className="launch-status-trigger launch-status-pulse question-review-trigger permission-trigger permission-review"
      icon={<CircleHelp size={14}/>} label={t('回答问题', 'Answer questions')} detail={<small className="question-beta">Beta</small>}
      aria-label={t('回答问题', 'Answer questions')} aria-haspopup="dialog" aria-expanded={approvalOpen}
      onClick={() => setApprovalOpen(v => !v)}/>}
  </>;
  const lastConversationEntry = conversationEntries(data.messages).at(-1);
  const activePlanExecution = busy && lastConversationEntry?.type === 'response'
    ? planExecutionResponses(data.messages, busy).get(lastConversationEntry.index) : undefined;
  const completedStatus = completedGoalResponse === undefined ? undefined : { responseIndex: completedGoalResponse,
    content: <LaunchStatus key={`completed-${data.launch?.goal?.id}`} placement="pulse" align="end"
      state={{ plan: false, ultracode: false, goalArmed: false, goal: data.launch?.goal }}
      language={data.preferences.language} disabled={!connected || loading}
      onMode={(mode, enabled) => rawCommand('set_launch_mode', { mode, enabled })}
      onAction={(action, value) => rawCommand('goal_action', { action, value })}/> };
  return <CommandContextUsage.Provider value={{ usage: navigationTarget ? undefined : data.stats?.contextUsage, language: data.preferences.language }}><CommandCatalog.Provider value={commands}><FileOpeningContext.Provider value={{ openFile, openWeb, onError: setError }}><div ref={appLayout} className={`app ${bridge?.platform === 'darwin' ? 'platform-macos' : ''} ${sidebarVisible ? '' : 'sidebar-hidden'} ${compactSidebar ? 'sidebar-compact' : ''} ${inspectionOpen && !details ? 'summary-open' : ''} ${summaryOverlay ? 'summary-overlay' : ''} ${inspectorExpanded ? 'inspector-expanded' : ''} ${terminalDock === 'bottom' && terminalOpen && !bottomTerminalExpanded ? 'has-bottom-terminal' : ''}`} onContextMenu={e => {
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
    {quitReview.request && <QuitConfirmation key={quitReview.request.id}
      reasons={quitReview.request.reasons} language={data.preferences.language}
      stopping={quitReview.request.phase === 'stopping'}
      onCancel={() => bridge!.quitRespond(quitReview.request!.id, false)}
      onConfirm={() => bridge!.quitRespond(quitReview.request!.id, true)}/>}
    <WindowBar language={data.preferences.language} sidebarVisible={sidebarVisible} toggleSidebar={toggleSidebar} menus={menus} sessionTitle={activeTitle} onMenuOpenChange={setWindowMenuOpen} inert={settingsOpen || Boolean(removeProject)}/>
    {sessionMove && <SessionMoveDialog session={sessionMove.session} preferences={data.preferences} platform={bridge?.platform}
      initialDestination={sessionMove.destination} onCancel={() => setSessionMove(null)}
      onConfirm={async destination => {
        if (!bridge || switching.current) throw new Error(t('请等待会话切换完成', 'Wait for session navigation to finish'));
        switching.current = true; setLoading(true);
        try {
          const activeMove = latestData.current.state?.sessionId === sessionMove.session.id && !latestData.current.draftId;
          const value = await bridge.moveSessionToProject(sessionMove.session.id, destination);
          readingCache.current.delete(sessionMove.session.id);
          installSnapshot(value); setSessionMove(null);
          if (activeMove) { setDetails(''); setRightPanel(null); setSelectedSubagent(null); setSelectedWorkflow(null); setSelectedWorkflowAgent(null); }
          setNotice({ id: ++nextNoticeId.current, message: t('会话已移至目标项目', 'Conversation moved to the destination project'), type: 'info' });
          const id = sessionMove.session.id;
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`.session-row[data-reorder-id="${CSS.escape(id)}"] > button`)?.focus());
        } finally { switching.current = false; setLoading(false); }
      }}/>}
    {removeProject && <ProjectRemoval title={workspaceTitle(removeProject)} path={removeProject} language={data.preferences.language}
      onCancel={() => setRemoveProject(null)} onConfirm={async () => {
        const result = await run(() => bridge!.removeWorkspace(removeProject));
        if (!result) return false;
        installSnapshot(result); setUnavailableWorkspace(null); setError(''); return true;
      }}/>}
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
        <button role="menuitem" disabled={!bridge || loading} onClick={() => { const path = contextMenu.id; setContextMenu(null); void repairProject(path); }}><FolderOpen size={15}/>{t('重新定位目录…', 'Locate folder...')}</button>
        <div className="context-separator"/>
        <button role="menuitem" className="project-remove-menu" disabled={!bridge || loading} onClick={() => { confirmRemoveProject(contextMenu.id); setContextMenu(null); }}><Trash2 size={15}/>{t('移除项目…', 'Remove project...')}</button>
      </> : <>
        <button role="menuitem" disabled={!bridge || loading || !data.sessions.some(session => session.id === contextMenu.id && session.path
          && !archived.has(session.id) && data.preferences.workspaces.some(path => workspaceKey(path) !== workspaceKey(session.cwd))) ||
          data.runtimes?.some(runtime => runtime.sessionId === contextMenu.id && ['running', 'waiting'].includes(runtime.status))}
          onClick={() => {
            const session = data.sessions.find(session => session.id === contextMenu.id);
            setContextMenu(null); if (session) setSessionMove({ session });
          }}><ArrowRightLeft size={15}/>{t('移至项目…', 'Move to project...')}</button>
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
    {error && (settingsOpen || removeProject || mcpEdit || requests.length > 0) && <div className="modal-error" role="alert"><AlertCircle size={16}/><span>{error}</span><IconButton title="Dismiss" onClick={() => setError('')}><X size={16}/></IconButton></div>}
    {compactSidebar && <button type="button" className="sidebar-backdrop" aria-label={t('关闭侧栏', 'Close sidebar')} aria-hidden={!compactSidebarOpen} inert={!compactSidebarOpen} onClick={() => setCompactSidebarOpen(false)}/>}
    <aside className="sidebar" inert={settingsOpen || Boolean(removeProject) || !sidebarVisible}>
      <button className="sidebar-identity usage-entry" aria-label={t('用量统计', 'Usage overview')} data-tooltip={t('用量统计', 'Usage overview')}
          aria-pressed={usageOpen} onClick={() => { if (usageOpen) setUsageOpen(false); else openUsage(); }}><img src="./StepCode.svg" width="26" height="26" alt=""/><span className="sidebar-wordmark"><img className="wordmark-light" src="./wordmark-light.png" alt="Desktop for Step Code"/><img className="wordmark-dark" src="./wordmark-dark.png" alt="Desktop for Step Code"/></span></button>
      <SidebarTaskActions selected={scheduledOpen} language={data.preferences.language} disabled={!bridge || loading} onNewSession={() => { if (bridge && !loading) void newSession(); }}
        onSearchChange={setSessionQuery}
        onScheduledTasks={() => { if (scheduledOpen) setScheduledOpen(false); else openScheduled(); }}
        onPlugins={() => {
          setCapabilityTarget({ page: 'plugins', tab: 'discover' }); setTab('plugins'); setCompactSidebarOpen(false); void openSettings();
        }}/>
      <nav ref={sidebarTree} className={`workspace-tree ${sessionDrag ? 'is-reordering' : ''}`} aria-label={t('工作区与会话', 'Workspaces and sessions')}
        onScroll={event => { event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 0); }}>
        {searchingSessions && <div className="session-search-status" role="status">{t(`找到 ${visibleSessions.length} 个会话`, `${visibleSessions.length} sessions found`)}</div>}
        {searchingSessions && !visibleSessions.length && <p className="list-empty">{t('没有匹配的会话', 'No matching sessions')}</p>}
        {(!searchingSessions || independentSessions.length > 0) && <section className="workspace-group independent-group" aria-label={t('独立会话', 'Independent sessions')}>
          <div className="workspace-heading"><button className="workspace-toggle" aria-label={t('独立会话', 'Independent sessions')} aria-expanded={independentExpanded} aria-disabled={searchingSessions || undefined} onClick={() => { if (!searchingSessions) toggleWorkspace('__independent__'); }}><MessageSquare size={15}/><span>{t('独立会话', 'Independent sessions')}</span><small>{independentSessions.length}</small></button></div>
          <div className="workspace-disclosure" aria-hidden={!independentExpanded} inert={!independentExpanded}>
            <div className="workspace-sessions">{independentSessions.map(s => renderSession(s, '__independent__'))}</div>
          </div>
        </section>}
        {[...pinnedWorkspaces].some(key => workspaceGroups.has(key) && (!searchingSessions || workspaceGroups.get(key)!.sessions.length > 0)) && <div className="pinned-projects">
          <div className="section-label">{t('置顶', 'Pinned')}</div>
          {[...pinnedWorkspaces].flatMap(key => workspaceGroups.has(key) ? [[key, workspaceGroups.get(key)!] as [string, { path: string; sessions: Session[] }]] : []).map(renderWorkspace)}
        </div>}
        {(!searchingSessions || [...workspaceGroups].some(([key, group]) => !pinnedWorkspaces.has(key) && group.sessions.length > 0)) && <div className="section-label">{t('项目', 'Projects')}<IconButton title={t('添加工作区', 'Add workspace')} disabled={!bridge || loading} onClick={() => void openProject()}><Plus size={15}/></IconButton></div>}
        {[...workspaceGroups].filter(([key]) => !pinnedWorkspaces.has(key)).map(renderWorkspace)}
        {!searchingSessions && !workspaceGroups.size && <button disabled={!bridge || loading} onClick={() => void openProject()}><FolderOpen size={15}/>{t('打开项目', 'Open project')}</button>}
      </nav>
      <div className="sidebar-bottom"><button onClick={() => { if (updateAvailable) setTab('updates'); void openSettings(); }} disabled={!bridge}><SettingsIcon size={17}/>{t('设置', 'Settings')}<span className={updateAvailable ? 'update-indicator' : undefined}>{updateAvailable ? <><i/>{t('有更新', 'Update')}</> : appUpdate?.currentVersion ? `v${appUpdate.currentVersion}` : ''}</span></button><div className="connection"><i className={connected ? 'online' : ''}/>{connected ? t('Step Code 已连接', 'Step Code connected') : loading ? t('连接中', 'Connecting') : t('未连接', 'Disconnected')}</div></div>
    </aside>
    {sessionDrag && <div className="session-drag-preview" aria-hidden="true" style={{ left: sessionDrag.x + 12, top: sessionDrag.y + 10 }}>{sessionDrag.title}</div>}
    {scheduledOpen && bridge && <main inert={settingsOpen || Boolean(removeProject)}>
      {!!requests.length && <div className="approval-notice"><TriangleAlert size={16}/><span>{t('当前会话有待确认的操作', 'The current session is awaiting approval')}</span>
        <button onClick={() => { setScheduledOpen(false); setApprovalOpen(true); }}>{t('查看', 'Review')}</button></div>}
      <CronManager bridge={bridge} onOpenHost={async (session, runtimeId) => {
        if (!await navigateSession(session, runtimeId)) throw new Error('Cron host changed; refresh before opening');
      }}/></main>}
    <main hidden={scheduledOpen} inert={scheduledOpen || settingsOpen || Boolean(removeProject)}
      onPointerDownCapture={() => { readingRestore.current = undefined; }}
      onWheelCapture={() => { readingRestore.current = undefined; }}
      onKeyDownCapture={() => { readingRestore.current = undefined; }}>
      {(error || unavailableWorkspace) && !settingsOpen && !removeProject && !mcpEdit && !requests.length && <div className="app-error-banner" role="alert">
        <AlertCircle size={16}/><span>{unavailableWorkspace
          ? t(`项目目录不可用，可能已改名或移动：${unavailableWorkspace}`, `Project directory unavailable; it may have been renamed or moved: ${unavailableWorkspace}`) : error}</span>
        {unavailableWorkspace && data.preferences.workspaces.some(path => workspaceKey(path) === workspaceKey(unavailableWorkspace)) && <>
          <button disabled={loading} onClick={() => void repairProject(unavailableWorkspace)}><FolderOpen size={14}/>{t('重新定位', 'Locate folder')}</button>
          <button disabled={loading} onClick={() => confirmRemoveProject(unavailableWorkspace)}>{t('移除项目', 'Remove project')}</button>
        </>}
        <IconButton title={t('关闭', 'Dismiss')} onClick={() => { setError(''); setUnavailableWorkspace(null); }}><X size={14}/></IconButton>
      </div>}
      {usageOpen && <UsageOverviewPanel language={data.preferences.language} onBack={() => setUsageOpen(false)}/>}
      <div className="main-content" style={usageOpen ? { display: 'none' } : undefined} inert={inspectorExpanded || usageOpen}>
      <NoticeToast notice={notice} language={data.preferences.language} onDismiss={() => setNotice(null)}
        onDetails={() => { setNotice(null); setTab('mcp'); void openSettings(); }}/>
      {!!requests.length && !approvalOpen && !reviewPlan && !planFeedback && !reviewQuestion && <div className="approval-notice"><TriangleAlert size={16}/><span>{t('此会话有待确认的操作', 'This session is awaiting approval')}</span><button onClick={() => setApprovalOpen(true)}>{t('查看', 'Review')}</button></div>}
      {!bridge && <div className="error-banner">{t('请从 Electron 桌面窗口打开此应用。', 'Open this application in the Electron desktop window.')}</div>}
      <div className="conversation-shell">
        <div className="conversation" id="conversation-scroll" ref={scroll}
          aria-busy={Boolean(navigationTarget)}
          onWheel={() => { readingRestore.current = undefined; }}
          onPointerDown={() => { readingRestore.current = undefined; }}
          onKeyDown={() => { readingRestore.current = undefined; }}
          onScroll={() => {
            if (!scroll.current) return;
            const distance = scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight;
            const pending = navigationPending.current;
            if (pending) {
              if (pending.reading) previewPosition.current = captureReadingPosition(scroll.current, pending.reading.messages, distance < 100);
              return;
            }
            if (readingRestore.current?.expectedTop !== undefined &&
              Math.abs(scroll.current.scrollTop - readingRestore.current.expectedTop) > 2) readingRestore.current = undefined;
            if (!readingRestore.current) { follow.current = distance < 100; setAwayFromBottom(distance > 120); }
          }}>
          {navigationTarget ? navigationTarget.reading ? <div className="messages session-reading-preview" ref={transcript} inert>
            <ConversationMessages key={`session-${navigationTarget.session.id}`} messages={navigationTarget.reading.messages} modelChanges={navigationTarget.reading.modelChanges}
              language={data.preferences.language} busy={false} canEdit={false} interfaceSettings={interfaceSettings} interfaceRevision={interfaceRevision}
              openImage={openImage} edit={editMessage} branch={branchMessage} onError={setError}
              onLayoutChange={followLayout} arrivingUser={null} onOpenSubagent={openSubagent}/>
          </div> : <div className="session-reading-placeholder" aria-hidden="true"><span/><span/><span/></div>
          : !data.messages.length && !hasPendingReceipt ? <NewSession language={data.preferences.language}
            workspace={data.independent ? undefined : data.preferences.workspace} workspaces={data.preferences.workspaces}
            title={workspaceTitle} disabled={!bridge || loading} composing={!!draft || !!attachments.length || !!quotes.length}
            onSelect={path => void applySnapshot(() => bridge!.beginSession(path))}
            onOpenProject={() => void openProject()} onSettings={() => void openSettings()} onOpenChange={setProjectPickerOpen}/> : <div className="messages" ref={transcript}>
            <QuestionContext.Provider value={{ pending: requests.flatMap(request => { const q = questionnaire(request); return q ? [q] : []; }), open: openQuestion }}>
              <ConversationMessages key={`session-${data.state?.sessionId ?? data.runtimeId}`} runtimeId={data.runtimeId} messages={data.messages} modelChanges={data.modelChanges} awaitingToolCalls={requests.flatMap(request => { const p = permissionApprovalPresentation(request, data.messages, data.preferences.language, data.runtimeId); return p ? [p.callId] : []; })} language={data.preferences.language} busy={busy} canEdit={connected && !busy && !loading} openImage={openImage} edit={editMessage} branch={branchMessage} onError={setError} onLayoutChange={followLayout} arrivingUser={arrivingUser} onOpenSubagent={openSubagent} onOpenWorkflow={openWorkflow}
                interfaceSettings={interfaceSettings} interfaceRevision={interfaceRevision} settledStatus={!busy && hasTaskStatus ? taskStatusControls : undefined} completedStatus={completedStatus}/>
            </QuestionContext.Provider>
            {(busy || data.state?.isCompacting) && <div className="working">
              <WorkingIndicator language={data.preferences.language} mode={requests.length || reviewPlan || planFeedback ? 'waiting' : data.state?.isCompacting ? 'compacting' : runMetrics?.phase ?? 'executing'}
                elapsedMs={runMetrics && runMetrics.finishedAt === undefined ? clock - runMetrics.startedAt : undefined}>
                {reviewPlan || planFeedback ? <button className="plan-review-trigger" onClick={() => setApprovalOpen(v => !v)}>{t('等待批阅', 'Awaiting plan review')}</button> : <span className="working-label">{reviewQuestion ? t('等待回答', 'Awaiting answers') : requests.length ? t('等待你的确认', 'Awaiting your decision') : data.state?.isCompacting ? t('正在整理上下文', 'Organizing context') : runMetrics?.phase === 'responding' ? t('等待响应', 'Awaiting response') : runMetrics?.phase === 'thinking' ? t('正在思考', 'Thinking') : t('正在阶跃', 'Working')}</span>}
              </WorkingIndicator>
              {taskStatusControls}
              {activePlanExecution && <PlanExecution key={lastConversationEntry?.type === 'response' ? lastConversationEntry.index : undefined}
                plan={activePlanExecution.plan} state="running" language={data.preferences.language}/>}
            </div>}
            <PendingUserMessages messages={data.pendingMessages ?? []} connected={connected} busy={busy}
              onRecover={() => bridge!.command('queue_recover', undefined, data.runtimeId)}
              language={data.preferences.language} openImage={openImage} onError={setError} onLayoutChange={followLayout}/>
          </div>}
        </div>
        {!navigationTarget && <ConversationMarkers scrollRef={scroll} turns={turns} language={data.preferences.language}/>}
      </div>
      <div className={`composer-wrap${navigationTarget ? ' session-navigation-pending' : ''}`} inert={Boolean(navigationTarget)}>
        <div className="composer-underlay" inert={Boolean(permissionApproval && approvalOpen)}>
        {!navigationTarget && <ComposerContextBar queued={queuedMessages.length > 0}>
        <QuotePreview quotes={quotes} language={data.preferences.language}
          onHighlight={setFocusedQuoteId}
          annotate={(id, annotation) => setQuotes(value => value.map(quote => quote.id === id ? { ...quote, annotation } : quote))}
          clear={() => setQuotes([])}
          remove={id => setQuotes(value => value.filter(quote => quote.id !== id))}
          reveal={quote => {
            readingRestore.current = undefined;
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
        {awayFromBottom && <IconButton title={t('回到底部', 'Scroll to bottom')} className="jump-to-bottom" onClick={() => { readingRestore.current = undefined; follow.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}><ArrowDown size={17}/></IconButton>}
        </ComposerContextBar>}
        <ComposerMenu key={data.state?.sessionId ?? data.draftId ?? ''} draft={draft} setDraft={setDraft} commands={commands} language={data.preferences.language}
          scope={data.state?.sessionId ?? data.draftId ?? ''} disabled={!connected || loading || Boolean(navigationTarget)}
          referencesOpen={referencesOpen} setReferencesOpen={setReferencesOpen} messages={data.messages}
          canAddFiles={attachments.length < 10}
          permissionsSupported={Boolean(data.draftId) || commands.some(c => c.name === 'permissions' && c.source === 'extension')}
          onFiles={async () => {
            const scope = view.current.sessionId ?? view.current.draftId;
            try { const added = await bridge!.chooseAttachments(); addAttachments(added, scope); return added.length > 0 && scope === (view.current.sessionId ?? view.current.draftId); }
            catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
          }}
          onQuote={index => {
            const message = data.messages[index]; const text = messageText(message);
            if (quotes.some(quote => quote.messageIndex === index && quote.text === text)) return true;
            if (quotes.length >= MAX_QUOTES || text.length > MAX_QUOTE_LENGTH || text.length + draft.length + quotes.reduce((sum, quote) => sum + quote.markdown.length, 0) > MAX_PROMPT_LENGTH - 1000) {
              setError(t('引用过多或内容过长，请选取较短的片段', 'Too many quotes or too much content; select a shorter excerpt')); return false;
            }
            setQuotes(value => [...value, { id: crypto.randomUUID(), messageIndex: index, role: message.role === 'user' ? 'user' : 'assistant', text, markdown: text, startOffset: 0, endOffset: text.length }]); return true;
          }}
          onAction={action => {
            if (action === 'mcp') { setTab('mcp'); void openSettings(); }
            else requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(action === 'model' ? '.model-effort-trigger' : '.permission-trigger')?.click());
          }}>
        <div className={`composer ${draggingFiles ? 'composer-file-drop' : ''}`}
          onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth.current++; setDraggingFiles(true); } }}
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
          onDragLeave={e => { e.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDraggingFiles(false); }}
          onDrop={e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); dragDepth.current = 0; setDraggingFiles(false); if (connected && !loading) void importFiles(Array.from(e.dataTransfer.files)); }}>
          {attachments.length > 0 && <div className="attachments" aria-label={t('待发送附件', 'Pending attachments')}>{attachments.map((item, i) => <div className={`attachment-card ${item.kind}`} key={item.kind === 'file' ? item.id : `${item.name}-${i}`}>
            {item.kind === 'image' ? <button type="button" className="attachment-open" aria-label={t(`预览 ${item.name}`, `Preview ${item.name}`)} onClick={e => openImage(`data:${item.content.mimeType};base64,${item.content.data}`, item.name, e.currentTarget)}><img src={`data:${item.content.mimeType};base64,${item.content.data}`} alt={item.name}/></button> : <div className="attachment-file"><FileText size={27}/><span>{item.name}</span><small>{t('本地文件引用', 'Local file reference')}</small></div>}
            <IconButton title={t('移除附件', 'Remove attachment')} tooltip={false} className="attachment-remove" onClick={() => { const next = attachmentsRef.current.filter((_, n) => n !== i); attachmentsRef.current = next; setAttachments(next); }}><X size={13}/></IconButton>
          </div>)}</div>}
          <ComposerInput key={data.runtimeId ?? data.draftId ?? 'empty'} label={t('消息', 'Message')} language={data.preferences.language} placeholder={connected ? t('你想做什么？', 'What would you like to work on?') : t('打开项目以开始', 'Open a project to begin')} value={navigationTarget ? composerBySession.current.get(navigationTarget.session.id)?.draft ?? '' : draft} disabled={!connected || loading} onChange={setDraft} onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); e.stopPropagation(); void importFiles(files); } }} onKeyDown={e => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.repeat) return;
            e.preventDefault();
            if (!draft.trim() && !attachments.length && !quotes.length && !loading && connected && !stopping) {
              void shortcutSteer();
            } else void send();
          }}/>
          <div className="composer-tools">
            <IconButton title={t('添加附件', 'Add attachments')} aria-expanded={referencesOpen} disabled={!connected || loading} onClick={() => setReferencesOpen(value => !value)}><Plus size={17}/></IconButton>
            <PermissionPicker preset={data.permissionPreset} language={data.preferences.language} disabled={!connected || loading} supported={Boolean(data.draftId) || commands.some(c => c.name === 'permissions' && c.source === 'extension')} onSelect={preset => command('set_permission_preset', { preset })}
              launch={data.launch} busy={busy} launchSupported={{
                plan: Boolean(data.draftId) || commands.some(c => c.name === 'plan' && c.source === 'extension'),
                goal: Boolean(data.draftId) || commands.some(c => c.name === 'goal' && c.source === 'extension'),
                ultracode: Boolean(data.draftId) || commands.some(c => c.name === 'ultraloop' && c.source === 'extension'),
              }} onLaunch={(mode, enabled) => command('set_launch_mode', { mode, enabled })}
              onReview={requests.length && !approvalOpen && !renaming && !reviewPlan && !planFeedback && !reviewQuestion ? () => setApprovalOpen(true) : undefined}/>
            {(reviewPlan || planFeedback) && <button className="permission-trigger permission-review plan-review-trigger" aria-expanded={approvalOpen} onClick={() => setApprovalOpen(v => !v)}><ClipboardCheck size={16}/><span>{t('批阅计划', 'Review plan')}</span></button>}
            {!requests.length && canResubmitPlan && <button className="permission-trigger permission-review plan-review-trigger" disabled={!connected || loading || busy || resubmittingPlan} onClick={() => void resubmitPlan()}><ClipboardCheck size={16}/><span>{t('重新批阅计划', 'Review plan again')}</span></button>}
            <LaunchStatus key={data.runtimeId ?? data.draftId}
              state={{ plan: Boolean(data.launch?.planArmed), ultracode: Boolean(data.launch?.ultracodeArmed), goalArmed: Boolean(data.launch?.goalArmed) }}
              language={data.preferences.language} disabled={!connected || loading}
              onMode={(mode, enabled) => rawCommand('set_launch_mode', { mode, enabled })}
              onAction={(action, value) => rawCommand('goal_action', { action, value })}/>
            <div className="spacer"/>
            <ContextRing usage={data.stats?.contextUsage} language={data.preferences.language}/>
            <ModelEffortPicker model={data.modelSelection?.model ?? data.state?.model} models={data.models} level={data.modelSelection?.thinkingLevel ?? data.state?.thinkingLevel} levels={levels} pending={Boolean(data.modelSelection)} language={data.preferences.language} disabled={!connected || loading} onModel={m => command('set_model', { provider: m.provider, modelId: m.id })} onEffort={level => command('set_thinking_level', { level })} onConfigure={() => { setTab('providers'); void openSettings(); }}/>
            <IconButton title={action.mode === 'stop' ? stopping ? t('正在停止此轮', 'Stopping response') : t('停止此轮', 'Stop response') : composerBusy ? t('加入队列', 'Queue message') : t('发送', 'Send')}
              className="composer-action-button" data-action={action.mode}
              disabled={!connected || loading || (action.mode === 'stop' ? stopping : !action.hasContent)}
              onClick={() => void (action.mode === 'stop' ? stop() : send())}><ComposerActionIcon stop={action.mode === 'stop'}/></IconButton>
          </div>
        </div></ComposerMenu>{interfaceSettings.performanceVisible && <PerformanceBar run={runMetrics} stats={data.stats} connected={connected} language={data.preferences.language} now={clock}/>}
        </div>
        <PermissionApproval key={data.runtimeId ?? 'empty'} requestId={requests[0]?.id} presentation={permissionApproval} open={Boolean(permissionApproval && approvalOpen && !navigationTarget)}
          language={data.preferences.language} onLater={() => setApprovalOpen(false)} onRespond={respond}/>
        <PlanReview key={`plan-${data.runtimeId ?? 'empty'}`} plan={reviewPlan} feedback={Boolean(planFeedback)} requestId={requests[0]?.id}
          open={Boolean((reviewPlan || planFeedback) && approvalOpen && !navigationTarget)} zh={data.preferences.language === 'zh'} onLater={() => setApprovalOpen(false)} onRespond={respond}/>
        <QuestionReview key={`question-${data.runtimeId ?? 'empty'}`} question={reviewQuestion} requestId={reviewQuestion ? requests[0]?.id : undefined}
          open={Boolean(reviewQuestion && approvalOpen && !navigationTarget)} zh={data.preferences.language === 'zh'}
          drafts={questionDrafts.current} onLater={() => setApprovalOpen(false)} onRespond={respondQuestion}/>
      </div>
      <ConversationScrollThumb scrollRef={scroll} language={data.preferences.language}
        sessionId={data.state?.sessionId} messageCount={data.messages.length}/>
      <div ref={terminalBottomHost} className="terminal-bottom-slot"/>
      </div>
    </main>
    <QuoteAnnotations root={transcript} scope={quoteScope} language={data.preferences.language}
      remove={id => setQuotes(value => value.filter(item => item.id !== id))}
      focusedId={focusedQuoteId}
      quotes={settingsOpen || preview || requests.length || scheduledOpen || usageOpen ? [] : quotes}
      annotate={(id, annotation) => setQuotes(value => value.map(item => item.id === id ? { ...item, annotation } : item))}/>
    <SelectionToolbar root={transcript} scope={quoteScope} language={data.preferences.language}
      enabled={!scheduledOpen && !usageOpen && connected && !loading && !settingsOpen && !preview && !requests.length && !renaming}
      onError={setError} onQuote={quote => {
        const existing = quotes.find(item => sameQuoteSelection(item, quote));
        if (existing) {
          if (quote.annotation) {
            const annotation = [existing.annotation, quote.annotation].filter(Boolean).join('\n');
            if (annotation.length > MAX_ANNOTATION_LENGTH) {
              setError(t('这段引用的批注过长，请在引用预览中编辑', 'This annotation is too long; edit it in the quote preview'));
              return false;
            }
            setQuotes(value => value.map(item => item.id === existing.id ? { ...item, annotation } : item));
          }
          return true;
        }
        if (quotes.length >= MAX_QUOTES) { setError(t('最多添加 8 段引用', 'Maximum 8 quotes')); return false; }
        follow.current = false;
        setQuotes(value => [...value, quote]); return true;
      }}/>
    {details && !usageOpen && <aside className="details-panel"><header><FileCode2 size={16}/>{t('详情', 'Details')}<IconButton title={t('关闭', 'Close')} onClick={() => setDetails('')}><X size={17}/></IconButton></header><pre>{details}</pre></aside>}
    <ConversationNavigationPanel open={visibleRightPanel === 'turns' && !details} replaced={inspectionOpen || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || visibleRightPanel === 'file' || visibleRightPanel === 'subagent' || Boolean(details)}
      overlay={!summarySpace} turns={turns} language={data.preferences.language} onClose={closeRightPanel}
      onSelect={index => { scrollToTurn(scroll.current, index); if (window.innerWidth <= 900) closeRightPanel(); }}/>
    <ReviewPanel open={visibleRightPanel === 'review' && !details} replaced={inspectionOpen || visibleRightPanel === 'turns' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || visibleRightPanel === 'file' || visibleRightPanel === 'subagent' || Boolean(details)}
      repositoryRequest={repositoryRequest?.runtimeId === data.runtimeId ? repositoryRequest?.sequence : undefined}
      onRepositoryRequestHandled={sequence => setRepositoryRequest(value =>
        value && value.runtimeId === data.runtimeId && value.sequence === sequence ? undefined : value)}
      expanded={inspectorExpanded && visibleRightPanel === 'review'}
      layout={panelPreferences.diffLayout} onLayoutChange={diffLayout => void setPreference({ diffLayout })}
      onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'review')}
      overlay={!summarySpace} runtimeId={data.runtimeId} messages={data.messages} busy={busy} language={data.preferences.language}
      onClose={closeRightPanel} onError={setError}/>
    <div ref={terminalRightHost} className="terminal-right-slot"/>
    <TerminalPanel open={terminalOpen} replaced={terminalDock === 'right' && (inspectionOpen || visibleRightPanel === 'turns' || visibleRightPanel === 'review' || visibleRightPanel === 'browser' || visibleRightPanel === 'file' || visibleRightPanel === 'subagent' || Boolean(details))}
      dock={terminalDock} onDockChange={changeTerminalDock} height={panelPreferences.terminalHeight}
      onHeightChange={terminalHeight => void setPreference({ terminalHeight })}
      bottomHost={terminalBottomHost} rightHost={terminalRightHost} onResizeActive={setHandleBlocked}
      width={terminalWidth} onWidthChange={setTerminalWidth}
      expanded={bottomTerminalExpanded || inspectorExpanded && visibleRightPanel === 'terminal'}
      onToggleExpanded={() => setExpandedRightPanel(expandedRightPanel === 'terminal' ? null : 'terminal')}
      overlay={!summarySpace} runtimeId={data.runtimeId} cwd={data.preferences.workspace} language={data.preferences.language}
      onClose={closeTerminal} onError={setError}/>
    <BrowserPanel open={visibleRightPanel === 'browser' && !details}
      width={browserWidth} onWidthChange={setBrowserWidth}
      replaced={inspectionOpen || visibleRightPanel === 'turns' || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'file' || visibleRightPanel === 'subagent' || Boolean(details)}
      expanded={inspectorExpanded && visibleRightPanel === 'browser'} onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'browser')}
      blocked={Boolean(quitReview.request) || handleBlocked || projectPickerOpen || queuePreviewOpen || liveChangesOpen || windowMenuOpen || settingsOpen || Boolean(removeProject) || Boolean(sessionMove) || Boolean(preview) || renaming || Boolean(contextMenu) || Boolean(imageMenu) || (approvalOpen && requests.length > 0) || (compactSidebar && compactSidebarOpen)}
      overlay={!summarySpace} language={data.preferences.language} onClose={closeRightPanel}/>
    <FilePreviewPanel file={previewFile} open={visibleRightPanel === 'file' && !details}
      replaced={Boolean(details) || (visibleRightPanel !== null && visibleRightPanel !== 'file')}
      overlay={!summarySpace} expanded={inspectorExpanded && visibleRightPanel === 'file'} language={data.preferences.language}
      width={data.preferences.filePreviewWidth === 'wide' ? 'wide' : 'standard'}
      onWidthChange={value => void setPreference({ filePreviewWidth: value })}
      onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'file')} onClose={closeRightPanel} onError={setError}/>
    {!details && visibleRightPanel && ['file', 'browser', 'terminal', 'context', 'review', 'subagent'].includes(visibleRightPanel) && <RightPanelHandle key={visibleRightPanel}
      panel={visibleRightPanel} language={data.preferences.language} onClose={closeRightPanel} onBlocked={setHandleBlocked}
      standard={visibleRightPanel === 'browser' ? 620 : visibleRightPanel === 'file' ? 540 : visibleRightPanel === 'terminal' ? 500 : 344}
      wide={['file', 'browser', 'terminal'].includes(visibleRightPanel)}
      value={inspectorExpanded ? 'fullscreen' : visibleRightPanel === 'browser' ? browserWidth : visibleRightPanel === 'terminal' ? terminalWidth : visibleRightPanel === 'file' && data.preferences.filePreviewWidth === 'wide' ? 'wide' : 'standard'}
      onChange={(value: RightPanelWidth) => {
        if (value !== 'fullscreen') {
          if (visibleRightPanel === 'browser') setBrowserWidth(value);
          if (visibleRightPanel === 'terminal') setTerminalWidth(value);
          if (visibleRightPanel === 'file') void setPreference({ filePreviewWidth: value });
        }
        setExpandedRightPanel(value === 'fullscreen' ? visibleRightPanel as 'context' | 'review' | 'terminal' | 'browser' | 'file' | 'subagent' : null);
      }}/>}
    <SubagentPanel open={visibleRightPanel === 'subagent' && !details}
      replaced={inspectionOpen || visibleRightPanel === 'turns' || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || visibleRightPanel === 'file' || Boolean(details)}
      expanded={inspectorExpanded && visibleRightPanel === 'subagent'} onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'subagent')}
      overlay={!summarySpace} task={openSubagentTask} language={data.preferences.language}
      workflows={workflows} workflowId={selectedWorkflow} view={subagentView} agentId={selectedWorkflowAgent}
      onView={view => { if (view === 'overview' && !selectedWorkflow && latestWorkflow) setSelectedWorkflow(latestWorkflow.toolCallId); setSubagentView(view); }}
      onWorkflow={id => { setSelectedWorkflow(id); setSelectedWorkflowAgent(null); }}
      onAgent={id => { setSelectedWorkflowAgent(id); setSubagentView('agent'); }}
      openImage={openImage} onClose={closeRightPanel} onError={setError}/>
    <div className={`summary-track ${inspectionOpen && summarySpace && !details ? 'is-docked' : ''} ${visibleRightPanel === 'turns' || visibleRightPanel === 'review' || visibleRightPanel === 'terminal' || visibleRightPanel === 'browser' || visibleRightPanel === 'file' || visibleRightPanel === 'subagent' || details ? 'is-replaced' : ''}`}>
      {visibleRightPanel === 'summary' && !details && <div className="summary-region">
        <aside className="summary-board" aria-label={t('摘要', 'Summary')} id="summary-board">
          <SummaryBoard key={`${data.runtimeId ?? 'empty'}:${data.state?.sessionId ?? ''}`} runtimeId={data.runtimeId} sessionId={data.state?.sessionId}
            messages={data.messages} busy={busy} onOpenSubagent={openSubagent} onOpenWorkflow={openWorkflow} onClose={closeRightPanel}
            language={data.preferences.language} onOpenChanges={() => { setRepositoryRequest(value => ({ runtimeId: data.runtimeId, sequence: (value?.sequence ?? 0) + 1 })); setDetails(''); setRightPanel('review'); }}/>
        </aside>
      </div>}
      {visibleRightPanel === 'context' && !details && <div className={`summary-region context-region right-inspector-surface${inspectorExpanded ? ' is-expanded' : ''}`}>
        <ContextPanel key={data.state?.sessionId ?? data.runtimeId ?? 'empty'} messages={data.messages} stats={data.stats} state={data.state} estimate={data.estimate}
          snapshot={{ ...data, requests }} runtimeRevision={statusRevision} view={contextView} onView={setContextView}
          title={activeTitle} language={data.preferences.language} busy={busy} connected={connected} onClose={closeRightPanel}
          expanded={inspectorExpanded} onToggleExpanded={() => setExpandedRightPanel(inspectorExpanded ? null : 'context')}
          onRefresh={async () => { if (bridge) await applySnapshot(() => bridge.snapshot()); }} onError={setError}/>
      </div>}
    </div>
    <nav hidden={scheduledOpen || usageOpen} ref={rightRail} className="right-tool-rail" style={usageOpen ? { display: 'none' } : undefined} aria-label={t('右侧工具', 'Right tools')} inert={usageOpen || Boolean(navigationTarget) || Boolean(removeProject)}
      onClickCapture={() => { if (bottomTerminalExpanded) setExpandedRightPanel(null); }}>
      <IconButton title={t('摘要', 'Summary')} data-tooltip-side="left" aria-controls="summary-board" aria-pressed={!details && visibleRightPanel === 'summary'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'summary' ? null : 'summary'); }}><Layers3 size={18}/></IconButton>
      <IconButton title={t('上下文', 'Context')} data-tooltip-side="left" aria-controls="context-panel" aria-pressed={!details && visibleRightPanel === 'context'} onClick={() => {
        const close = !details && visibleRightPanel === 'context' && contextView === 'context';
        setDetails(''); setContextView('context'); setRightPanel(close ? null : 'context');
      }}><ScanLine size={18}/></IconButton>
      <IconButton title={t('变更', 'Changes')} data-tooltip-side="left" aria-controls="review-panel" aria-pressed={!details && visibleRightPanel === 'review'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'review' ? null : 'review'); }}><FileDiff size={18} strokeWidth={1.5}/></IconButton>
      <IconButton title={t('终端', 'Terminal')} data-tooltip-side="left" aria-controls="terminal-panel" aria-pressed={terminalOpen}
        onClick={() => {
          setDetails('');
          if (terminalDock === 'bottom') {
            setBottomTerminalOpen(value => !value);
            setExpandedRightPanel(null);
          } else setRightPanel(!details && visibleRightPanel === 'terminal' ? null : 'terminal');
        }}><Terminal size={18}/></IconButton>
      <IconButton title={t('浏览器', 'Browser')} data-tooltip-side="left" aria-controls="browser-panel" aria-pressed={!details && visibleRightPanel === 'browser'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'browser' ? null : 'browser'); }}><Globe size={18}/></IconButton>
      <IconButton title={t('文件预览', 'File preview')} data-tooltip-side="left" aria-controls="file-panel" aria-pressed={!details && visibleRightPanel === 'file'} onClick={() => { setDetails(''); setRightPanel(!details && visibleRightPanel === 'file' ? null : 'file'); }}><FileText size={18}/></IconButton>
        <IconButton title={t('子代理', 'Subagents')} data-workflow-running={Boolean(runningWorkflow) || undefined} data-tooltip-side="left" aria-controls="subagent-panel" aria-pressed={!details && visibleRightPanel === 'subagent'} disabled={!selectedSubagent && !latestWorkflow} onClick={() => {
          if (!details && visibleRightPanel === 'subagent') { setRightPanel(null); return; }
          if (latestWorkflow) { setSelectedWorkflow(latestWorkflow.toolCallId); setSubagentView('overview'); setSelectedWorkflowAgent(null); }
          setDetails(''); setRightPanel('subagent');
        }}><Bot size={18}/></IconButton>
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
            if (!(window.desktop?.platform === 'darwin' ? e.metaKey : e.ctrlKey)) return;
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
            changePreviewZoom(previewZoom * factor, { x: e.clientX, y: e.clientY });
          }}>
          <img draggable={false} src={preview.src} alt={preview.name} style={{ transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${previewZoom})` }}/>
        </div>
      </div>
    </div>}
    {settingsOpen && <div className={`modal-backdrop settings-backdrop${settingsClosing ? ' is-closing' : ''}`} onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'settings-backdrop-exit') finishSettingsClose(); }}><section className="settings-dialog" inert={settingsClosing} role="dialog" aria-modal="true" aria-label={t('设置', 'Settings')}><header><h2>{t('设置', 'Settings')}</h2><IconButton title="Close" onClick={closeSettings}><X size={19}/></IconButton></header><div className="settings-layout"><nav aria-label={t('设置分类', 'Settings categories')}>{[['account', StepPlatformIcon, t('账户', 'Account')], ['providers', ProviderIcon, t('供应商', 'Providers')], ['plugins', Plug, t('插件', 'Plugins')], ['mcp', McpIcon, 'MCP'], ['skills', BookOpen, 'Skills'], ['general', SunMoon, t('通用', 'General')], ['interface', SlidersHorizontal, t('界面复杂度', 'Interface complexity')], ['appearance', Pencil, t('外观', 'Appearance')], ['updates', Download, t('版本更新', 'Updates')], ...(bridge?.platform === 'win32' ? [['import', ArrowRightLeft, t('会话迁移', 'Session migration')]] : []), ['archived', Archive, t('已归档', 'Archived')]].map(([id, Icon, title]: any) => <button key={id} aria-label={title} aria-current={tab === id ? 'page' : undefined} className={`${tab === id ? 'selected' : ''}${id === (bridge?.platform === 'win32' ? 'import' : 'archived') ? ' settings-group-start' : ''}`} onClick={() => { setCapabilityTarget(undefined); setTab(id); }}><Icon size={17}/>{title}</button>)}</nav><div key={tab} className="settings-content">
      {tab === 'interface' ? <InterfaceSettings value={interfaceSettings} language={data.preferences.language} onChange={interfaceSettings => setPreference({ interfaceSettings })}/> : tab === 'appearance' ? <><ThemeSettings preferences={data.preferences} systemDark={systemDark} language={data.preferences.language} onChange={patch => void setPreference(patch)}/><AppearanceSettings value={data.preferences.appearance} language={data.preferences.language} onChange={appearance => void setPreference({ appearance })}/></> : tab === 'archived' ? <ArchivedSessions sessions={archivedSessions} preferences={data.preferences}
        runtimes={data.runtimes ?? []} activeId={data.state?.sessionId}
        onOpen={id => { closeSettings(); const session = data.sessions.find(session => session.id === id); if (session) void navigateSession(session); }}
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
      {tab === 'import' && bridge?.platform === 'win32' ? <SessionImportSettings bridge={bridge} language={data.preferences.language}
        onOpen={async id => { const session = (await bridge.sessions()).find(item => item.id === id); if (!session) throw new Error('Imported session is unavailable'); finishSettingsClose(); await navigateSession(session); }}/>
      : tab === 'updates' ? <><h3>{t('版本更新', 'Updates')}</h3><AppUpdates bridge={bridge} state={appUpdate} preferences={data.preferences} onPreferences={setPreference}/></> : tab === 'general' ? <><h3>{t('语言', 'Language')}</h3><label>{t('语言', 'Language')}<select value={data.preferences.language} onChange={e => void setPreference({ language: e.target.value })}><option value="zh">简体中文</option><option value="en">English</option></select></label><h3>{t('诊断', 'Diagnostics')}</h3><button onClick={() => void run(() => bridge!.diagnostics())}><Download size={15}/>{t('导出脱敏诊断', 'Export diagnostics')}</button></> : !settings ? <p>{t('加载中…', 'Loading…')}</p> : tab === 'providers' ? <ProviderSettings language={data.preferences.language} providers={settings.providers ?? []} pending={data.providerSettingsPending}
        onDiscover={(provider, key) => bridge!.discoverProviderModels(provider, key)}
        onTest={(provider, modelId, key) => bridge!.testProvider(provider, modelId, key)}
        onCancelTest={() => bridge!.cancelProviderTest()}
        onCopyDiagnostic={text => bridge!.copyText(text)}
        activeModel={data.state?.model}
        onSave={async (provider, key) => { installSnapshot(await bridge!.saveProvider(provider, key)); const next = await bridge!.settings(); setSettings(next); return next.providers ?? []; }}
        onDelete={async id => { installSnapshot(await bridge!.deleteProvider(id)); const next = await bridge!.settings(); setSettings(next); return next.providers ?? []; }}/>
      : tab === 'account' ? <><AccountSettings settings={settings} profile={loginProfile} onProfile={chooseLoginProfile} apiKey={key} onKey={setKey} loggingIn={loggingIn} busy={anyBusy} language={data.preferences.language} onLogin={() => void run(async () => { setLoggingIn(true); try { await bridge!.login(loginProfile, key); setKey(''); setSettings(await bridge!.settings()); await applySnapshot(() => bridge!.snapshot()); } finally { setLoggingIn(false); } })} onCancel={() => void run(() => bridge!.cancelLogin())} onLogout={() => void run(async () => { await bridge!.logout(); setSettings(await bridge!.settings()); await applySnapshot(() => bridge!.snapshot()); })}
        allowance={<><AccountAllowancePanel bridge={bridge!} account={settings.account} language={data.preferences.language} active={!settingsClosing}/>
          <EstimateRules key={`${settings.account.profile}:${settings.account.userId ?? ''}`} bridge={bridge!} account={settings.account}
            language={data.preferences.language} disabled={loggingIn || anyBusy} onChanged={async () => { await applySnapshot(() => bridge!.snapshot()); }}/></>}/>
          <button onClick={openUsage}><BarChart3 size={15}/>{t('用量统计', 'Usage overview')}</button></>
      : (tab === 'plugins' || tab === 'mcp' || tab === 'skills') ? <CapabilitySettings
        key={`${tab}:${capabilityRevision}`} page={tab} bridge={bridge!} language={data.preferences.language}
        busy={anyBusy || busy} runtimeId={data.runtimeId} settings={settings} target={capabilityTarget?.page === tab ? capabilityTarget : undefined} commands={commands}
        onEditMcp={name => {
          const config = name ? settings.mcp[name] : undefined;
          setMcpEdit({ name: name ?? '', original: name, config: config ?? { command: '', args: [], enabled: true },
            args: JSON.stringify(config?.args ?? []), secrets: '{}' });
        }}
        onChanged={async () => { setSettings(await bridge!.settings()); }}
        onRestart={async () => {
          const next = await bridge!.restart();
          setSelectedSubagent(null); setSelectedWorkflow(null); setSelectedWorkflowAgent(null); setSubagentView('agent');
          installSnapshot(next);
        }}/> : null}
      </>}
    </div></div></section></div>}
    {mcpEdit && <div className="modal-backdrop higher"><section className="small-dialog" role="dialog" aria-modal="true" aria-label="MCP"><header><h2>MCP server</h2><IconButton title="Close" onClick={() => setMcpEdit(null)}><X size={18}/></IconButton></header><label>{t('名称', 'Name')}<input value={mcpEdit.name} disabled={Boolean(mcpEdit.original)} onChange={e => setMcpEdit({ ...mcpEdit, name: e.target.value })}/></label><label>{t('传输', 'Transport')}<select value={mcpEdit.config.url !== undefined ? 'http' : 'stdio'} onChange={e => setMcpEdit({ ...mcpEdit, config: e.target.value === 'http' ? { url: '', enabled: true } : { command: '', args: [], enabled: true } })}><option value="stdio">stdio</option><option value="http">HTTP</option></select></label>{mcpEdit.config.url !== undefined ? <label>URL<input value={mcpEdit.config.url} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, url: e.target.value } })}/></label> : <><label>{t('可执行文件', 'Executable')}<input value={mcpEdit.config.command ?? ''} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, command: e.target.value } })}/></label><label>{t('参数（JSON 数组）', 'Arguments (JSON array)')}<textarea value={mcpEdit.args} onChange={e => setMcpEdit({ ...mcpEdit, args: e.target.value })}/></label></>}<label>{t('新增或替换环境变量（JSON）', 'Add or replace environment variables (JSON)')}<textarea value={mcpEdit.secrets} onChange={e => setMcpEdit({ ...mcpEdit, secrets: e.target.value })}/></label><label className="checkbox"><input type="checkbox" checked={mcpEdit.config.enabled !== false} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, enabled: e.target.checked } })}/>{t('启用', 'Enabled')}</label><button className="primary" onClick={() => void saveMcp()}>{t('保存', 'Save')}</button></section></div>}
    {((requests[0] && approvalOpen && !permissionApproval && !reviewPlan && !planFeedback && !reviewQuestion) || renaming) && <div className="modal-backdrop higher"><section className="small-dialog" role="dialog" aria-modal="true" aria-label={accessRisk?.title ?? requests[0]?.title ?? 'Rename'}><h2>{accessRisk?.title ?? requests[0]?.title ?? (renameTarget?.type === 'workspace' ? t('重命名项目', 'Rename project') : t('重命名会话', 'Rename session'))}</h2>{accessRisk ? <p className="full-access-risk-message"><ShieldAlert size={20}/>{accessRisk.message}</p> : requests[0]?.message && <p className={requests[0].messageStyle === 'preformatted' || requests[0].message.includes('\n') ? 'request-message' : undefined}>{requests[0].messageStyle === 'preformatted' ? requests[0].message : requests[0].message.split('\n').filter(line => !/^Call: \S+$/.test(line)).join('\n')}</p>}{renaming ? <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void run(saveRename); }}/> : requests[0].method === 'select' ? requests[0].options?.map((o, index) => <button className="option" key={o} onClick={() => void respond({ value: o })}>{accessRisk?.labels[index] ?? o}</button>) : requests[0].method !== 'confirm' ? <textarea autoFocus placeholder={requests[0].placeholder} value={answer} onChange={e => setAnswer(e.target.value)}/> : null}<div className="button-row">{!renaming && !accessRisk && <button onClick={() => setApprovalOpen(false)}>{t('稍后处理', 'Review later')}</button>}{!accessRisk && <button onClick={() => renaming ? (setRenaming(false), setRenameTarget(null)) : void respond({ cancelled: true })}>{t('取消', 'Cancel')}</button>}{(renaming || requests[0]?.method !== 'select') && <button className="primary" disabled={renaming && (!name.trim() || busy || loading)} onClick={() => { if (renaming) void run(saveRename); else void respond(requests[0].method === 'confirm' ? { confirmed: true } : { value: answer }); }}>{t('确认', 'Confirm')}</button>}</div></section></div>}
  </div></FileOpeningContext.Provider></CommandCatalog.Provider></CommandContextUsage.Provider>;
}
class RenderBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { window.dispatchEvent(new Event('desktop-shell-ready')); }
  render() {
    if (this.state.failed) return <><WindowBar language="zh" sidebarVisible={false} toggleSidebar={() => {}} menus={[]}/><div className="empty-state" role="alert"><h1>界面暂时无法显示 / Display error</h1><p>重新加载界面不会重新发送任务。 / Reloading does not resend your task.</p><button onClick={() => location.reload()}>重新加载 / Reload</button></div></>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<RenderBoundary><App/></RenderBoundary>);
