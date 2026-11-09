import type { DesktopBridge, Message, Preferences, RuntimeEvent, Session, Snapshot, UIRequest } from '../../src/contracts';
import type { FulltextQuery } from '../../src/fulltext-search';
import { highlightCode } from '../../src/markdown-math';

const params = new URLSearchParams(location.search);
const turns = params.get('size') === 'short' ? 3 : 180;
const project = 'D:\\Projects\\Performance';
const model = { provider: 'fixture', id: 'fixture', name: 'Interaction fixture', contextWindow: 200000 };
const timestamp = 1794000000000;
const messages: Message[] = Array.from({ length: turns }, (_, turn): Message[] => [
  { role: 'user', entryId: `user-${turn}`, timestamp: timestamp + turn * 2000,
    content: `Question ${turn + 1}: inspect the rendering and preserve the reading position.` },
  { role: 'assistant', entryId: `assistant-${turn}`, timestamp: timestamp + turn * 2000 + 1000,
    content: `## Response ${turn + 1}\n\n${Array.from({ length: 4 }, (_, index) =>
      `Paragraph ${index + 1}. ${'A completed reply remains selectable and searchable while the panel changes width. '.repeat(4)}`).join('\n\n')}`
      + '\n\n- Keep the selected text.\n- Preserve the current reading anchor.\n'
      + '\n| Operation | Expected result |\n| --- | --- |\n| Resize | Responsive |\n| Navigate | Correct turn |\n'
      + `\n\`\`\`typescript\nexport function verify${turn}(value: number) {\n  return { ready: true, value: value + ${turn} };\n}\n\`\`\``,
    stopReason: 'stop' },
]).flat();
const sessionCount = params.get('sessions') === 'large' ? 1000 : 180;
const sessions: Session[] = Array.from({ length: sessionCount }, (_, index) => ({
  id: `session-${index}`, name: `Performance ${index + 1}`, firstMessage: `Question ${index + 1}`,
  path: `session-${index}.jsonl`, cwd: project, modified: new Date(timestamp - index * 1000).toISOString(),
  messageCount: messages.length,
}));
let snapshot: Snapshot = {
  preferences: { theme: params.get('theme') === 'dark' ? 'original-dark' : 'original-light',
    language: params.get('language') === 'zh' ? 'zh' : 'en',
    workspace: project, workspaces: [project, 'D:\\Projects\\Other'], sessionOrder: sessions.map(session => session.id) },
  status: 'connected', runtimeId: 'performance-runtime', permissionPreset: 'ask',
  state: { sessionId: 'session-0', sessionName: sessions[0].name, isStreaming: false, model },
  models: [model], sessions, messages,
};
const listeners = new Set<(event: RuntimeEvent) => void>();
const emit = (event: RuntimeEvent) => {
  for (const listener of listeners) listener({ runtimeId: snapshot.runtimeId, sessionId: snapshot.state?.sessionId, ...event });
};
let stream: ReturnType<typeof setInterval> | undefined;
let preferenceDelay = 0;
let rejectPreferences = false;
let preferenceWrites = 0;
let preferenceCompletions = 0;
let live: Message | undefined;
let streamUpdates = 0;
let readingDelay = 0;
let navigationDelay = 0;
let readingMessages = messages;
let copiedText = '';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clone = () => structuredClone(snapshot);
const open = async (id: string) => {
  await wait(navigationDelay);
  snapshot = { ...snapshot, state: { ...snapshot.state!, sessionId: id, sessionName: snapshot.sessions.find(session => session.id === id)?.name } };
  return clone();
};
const fixture = {
  referenceCode(text: string, className: string) { return highlightCode(text, className); },
  setNavigationDelays(reading: number, navigation: number) { readingDelay = reading; navigationDelay = navigation; },
  setReadingHistory(next: Message[]) { readingMessages = next; },
  updateSessions(next: Session[]) { snapshot = { ...snapshot, sessions: next }; emit({ type: 'desktop_sessions_changed' }); },
  setRuntimes(runtimes: NonNullable<Snapshot['runtimes']>, unreadSessionIds: string[] = []) {
    const sessions = snapshot.sessions.map(session => {
      const runtime = runtimes.find(runtime => runtime.sessionId === session.id);
      return runtime ? { ...session, name: runtime.name ?? session.name, firstMessage: runtime.firstMessage || session.firstMessage } : session;
    });
    snapshot = { ...snapshot, sessions, runtimes, unreadSessionIds };
    emit({ type: 'desktop_runtimes', runtimes, unreadSessionIds });
  },
  get copiedText() { return copiedText; },
  get sessions() { return structuredClone(snapshot.sessions); },
  setPreferenceDelay(value: number) { preferenceDelay = value; },
  rejectNextPreferences() { rejectPreferences = true; },
  get preferenceWrites() { return preferenceWrites; },
  get preferenceCompletions() { return preferenceCompletions; },
  get preferences() { return structuredClone(snapshot.preferences); },
  get streamUpdates() { return streamUpdates; },
  setHistory(next: Message[]) {
    snapshot = { ...snapshot, messages: next };
    emit({ type: 'desktop_history', messages: next });
  },
  setContextUsage(percent: number) {
    const stats = { toolCalls: 0, assistantMessages: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      contextUsage: { tokens: percent * 2000, contextWindow: 200000, percent } };
    snapshot = { ...snapshot, stats };
    emit({ type: 'desktop_stats', stats });
  },
  requestQuestions(request: UIRequest) {
    snapshot = { ...snapshot, requests: [...(snapshot.requests ?? []).filter(value => value.id !== request.id), request] };
    emit(request);
  },
  expireQuestion(id: string) {
    snapshot = { ...snapshot, requests: snapshot.requests?.filter(value => value.id !== id) };
    emit({ type: 'desktop_ui_expired', id });
  },
  startStream(options: { updates?: number; interval?: number } = {}) {
    if (stream) return;
    streamUpdates = 0;
    live = { role: 'assistant', entryId: 'live-assistant', timestamp: timestamp + turns * 2000 + 1000, content: '' };
    const user: Message = { role: 'user', entryId: 'live-user', timestamp: timestamp + turns * 2000, content: 'Continue checking the layout.' };
    snapshot = { ...snapshot, messages: [...messages, user, live], state: { ...snapshot.state!, isStreaming: true } };
    emit({ type: 'agent_start' });
    emit({ type: 'message_start', message: user });
    emit({ type: 'message_start', message: live });
    stream = setInterval(() => {
      live = { ...live!, content: `${live!.content}Streaming text keeps arriving while the reader opens and resizes the panel.\n\n` };
      snapshot.messages = [...messages, user, live];
      emit({ type: 'message_update', message: live });
      streamUpdates++;
      performance.mark('fixture-stream-update');
      if (options.updates && streamUpdates >= options.updates) fixture.stopStream();
    }, options.interval ?? 40);
  },
  stopStream() {
    clearInterval(stream); stream = undefined;
    if (!live) return;
    snapshot = { ...snapshot, state: { ...snapshot.state!, isStreaming: false } };
    emit({ type: 'message_end', message: live });
    emit({ type: 'agent_end' });
    live = undefined;
  },
};
declare global { interface Window { interactionFixture: typeof fixture } }
window.interactionFixture = fixture;
window.desktop = {
  platform: 'win32', snapshot: async () => clone(), navigateSession: open, switchSession: open,
  sessionReading: async (id: string) => { await wait(readingDelay); return { sessionId: id, version: 'fixture', messages: structuredClone(readingMessages) }; },
  searchSessions: async (query: FulltextQuery) => ({ id: query.id,
    hits: [{ sessionId: 'session-0', entryId: 'assistant-40', role: 'assistant', timestamp,
      snippet: 'A completed reply remains selectable and searchable while the panel changes width.' }],
    index: { state: 'ready', indexed: 1, total: 1, pending: 0, errors: 0 },
    limited: false, limit: 100, shortQuery: false, sessionOnly: false }),
  cancelSessionSearch: async () => {},
  preferences: async (patch: Partial<Preferences>) => {
    preferenceWrites++;
    await new Promise(resolve => setTimeout(resolve, preferenceDelay));
    preferenceCompletions++;
    if (rejectPreferences) { rejectPreferences = false; throw new Error('Fixture preference save failed'); }
    snapshot = { ...snapshot, preferences: { ...snapshot.preferences, ...patch } };
    return structuredClone(snapshot.preferences);
  },
  command: async (type: string) => type === 'get_available_thinking_levels' ? { levels: [] } : { commands: [] },
  onEvent: (callback: (event: RuntimeEvent) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  systemTheme: async () => ({ systemDark: false }),
  windowControl: async () => ({ focused: true, maximized: false, fullscreen: false }),
  updateState: async () => ({ status: 'idle', currentVersion: '0.6.0', channel: 'preview' }),
  onUpdateEvent: () => () => {},
  browserList: async () => ({ revision: 0, tabs: [] }), browserLayout: async () => {}, onBrowserEvent: () => () => {},
  terminalList: async () => [], onTerminalEvent: () => () => {},
  summary: async () => ({ sessionId: snapshot.state?.sessionId, tasks: [], mcp: [], skillCount: 0 }),
  settings: async () => ({ account: { loggedIn: false, validity: 'missing' }, profiles: [], mcp: {}, skills: [] }),
  repositoryDiff: async () => ({ state: 'not-git', bases: [], files: [], added: 0, removed: 0, truncated: false }),
  copyText: async (text: string) => { copiedText = text; },
} as unknown as DesktopBridge;
await import('../../src/main');
