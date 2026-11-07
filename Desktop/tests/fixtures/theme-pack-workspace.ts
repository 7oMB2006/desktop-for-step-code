import type { DesktopBridge, Message, Model, Preferences, Session, Snapshot } from '../../src/contracts';
import type { ThemePack } from '../../src/theme-packs';
import { applyTheme, normalizeTheme, registerPluginThemes, resolveTheme } from '../../src/theme';
import { createPatch } from 'diff';
import { approvalSamples, planContent, questions } from './theme-pack-approvals';
import { serializeAnswers, type QuestionAnswer } from '../../src/questionnaire';
import { openThemePreviewFile, themePreviewFile } from './theme-pack-files';
import { themeQueueSamples, updateThemeQueue } from './theme-pack-queue';
import { themeNavigationMessages, themeAgentMessages } from './theme-pack-navigation';
import { themeControlModels, themeControlCommands, selectThemeControlModel } from './theme-pack-controls';

const manifest = await fetch(new URL('../../../theme-marketplace/plugins/stellar-cruise/dfsc.theme.json', import.meta.url)).then(r => r.json());
const pack: ThemePack = {
  id: 'plugin:stellar-cruise', name: manifest.name, author: manifest.author, version: '0.1.0',
  renderer: 'stellar-v1', hasCover: true,
  palette: { ...manifest.colors, id: 'plugin:stellar-cruise', group: 'plugin', scheme: manifest.scheme,
    name: [manifest.name, manifest.name], title: [manifest.name, manifest.name], mood: ['', ''] },
};
registerPluginThemes([pack]);
const project = 'D:\\Preview\\Stellar';
const website = 'D:\\Preview\\Release';
const samples = approvalSamples(project, new URLSearchParams(location.search).get('stress') === 'decisions');
const approvals = new Map(samples.map(sample => [sample.id, sample.request]));
const model: Model = { provider: 'fixture', id: 'offline', name: 'Step · 离线样例',
  reasoning: true, contextWindow: 256000, thinkingLevels: ['low', 'medium', 'high'] };
const controlModels = themeControlModels();
const modelSelections = new Map<string, { model: Model; thinkingLevel?: string }>();
const savedKey = 'dfsc-stellar-preview-preferences-v1';
const beforePalette = '{\n  "background": "#121212",\n  "accent": "#b8b8b8"\n}\n';
const afterPalette = '{\n  "background": "#080d12",\n  "accent": "#74d9d0"\n}\n';
let saved: Partial<Preferences> = {};
try {
  const value = JSON.parse(localStorage.getItem(savedKey) || '{}');
  if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
} catch { /* Preview storage is optional. */ }
const preferences: Preferences = {
  theme: saved.theme ? normalizeTheme(saved.theme) : pack.id, language: 'zh',
  themeMotion: saved.themeMotion !== false,
  themeBrightness: Number.isInteger(saved.themeBrightness) && saved.themeBrightness! >= 40 && saved.themeBrightness! <= 120 ? saved.themeBrightness : 90,
  accentColor: saved.accentColor,
  workspaces: [project, website], workspace: project,
  workspaceNames: { 'd:/preview/stellar': '星辰巡航', 'd:/preview/release': '发布页' },
};
let serial = 0;
const sessions: Session[] = [
  ['theme-preview', '主题包 · 会话预览', project],
  ['components', '组件与样式校对', project],
  ['release', '发布页视觉整理', website],
  ['sample-queue', '引用与排队 · 离线样例', project],
  ['sample-navigation', '长对话导航 · 离线样例', project],
  ['sample-agents', '多代理记录 · 离线样例', project],
  ['sample-controls', '模型与指令 · 离线样例', project],
  ...samples.map(sample => [sample.id, sample.name, project]),
].map(([id, name, cwd]) => ({ id, name, cwd, path: `${id}.jsonl`, firstMessage: name,
  modified: new Date().toISOString(), messageCount: 6 }));
const transcript = (title: string): Message[] => [
  { role: 'user', entryId: 'user-1', content: `检查一下${title}，保持正文和工具结果清楚可读。` },
  { role: 'assistant', entryId: 'assistant-1', content: [
    { type: 'thinking', thinking: '先检查场景的生命周期，再检查主题切换有没有重复创建渲染器。切换会话应该复用场景，而不是重新加载素材。' },
    { type: 'text', text: '我先查看主题配置，再核对侧栏、消息和输入区。' },
    { type: 'toolCall', id: 'read-theme', name: 'read', arguments: { path: 'theme/palette.json' } },
  ] },
  { role: 'toolResult', entryId: 'tool-1', toolCallId: 'read-theme', toolName: 'read', content: [
    { type: 'text', text: beforePalette },
  ] },
  { role: 'assistant', entryId: 'edit-call', content: [
    { type: 'toolCall', id: 'edit-theme', name: 'edit_file', arguments: { path: 'theme/palette.json',
      oldText: beforePalette, newText: afterPalette } },
  ] },
  { role: 'toolResult', entryId: 'edit-result', toolCallId: 'edit-theme', toolName: 'edit_file',
    content: 'Updated (offline sample)', details: { patch: createPatch('theme/palette.json', beforePalette, afterPalette) } },
  { role: 'assistant', entryId: 'assistant-2', content: [
    { type: 'text', text: '### 保持同一片星海\n\n场景由工作区持有，切换会话时只更新**运动参数**，不重新创建渲染器。\n\n| 检查项 | 预期 |\n| --- | --- |\n| 会话切换 | 复用现有场景 |\n| 后台窗口 | 暂停渲染 |\n| 更换主题 | 释放场景资源 |\n\n```ts\nconst speed = reading ? 12 : 45;\nscene.configure({ ...settings, speed });\n```\n\n> 离线样例，工具结果与回复均为模拟数据。\n\n下一步补上切换与恢复的回归测试，再检查资源释放。' },
  ], usage: { input: 2380, output: 486, cacheRead: 1600, cacheWrite: 0 }, stopReason: 'stop' },
];
const histories = new Map(sessions.map(session => [session.id, transcript(session.name!)]));
for (const sample of samples) histories.set(sample.id, sample.messages);
histories.set('sample-navigation', themeNavigationMessages());
histories.set('sample-agents', themeAgentMessages());
const running = new Map<string, ReturnType<typeof setTimeout>>();
const queues = new Map([['sample-queue', themeQueueSamples()]]);
let snapshot: Snapshot = { preferences, status: 'ready', draftId: 'welcome', messages: [], models: [model],
  sessions, themePacks: [pack], permissionPreset: 'ask', modelSelection: { model, thinkingLevel: 'medium' } };
const clone = () => structuredClone(snapshot);
const listeners = new Set<(event: any) => void>();
const emit = (event: Record<string, unknown>, id = snapshot.state?.sessionId) =>
  listeners.forEach(listener => listener({ ...event, runtimeId: id ? `preview-${id}` : undefined, sessionId: id }));
function syncRuntimes() {
  snapshot.runtimes = sessions.map(session => ({ runtimeId: `preview-${session.id}`, sessionId: session.id,
    cwd: session.cwd, name: session.name, status: approvals.has(session.id) ? 'waiting' : running.has(session.id) ? 'running' : 'completed' }));
  // Stable offline state samples; no jobs or commands are started.
  if (new URLSearchParams(location.search).get('stress') === 'statuses') {
    const states = ['running', 'waiting', 'failed', 'completed'] as const;
    const sampleRuntimes = snapshot.runtimes.filter(runtime => runtime.sessionId !== snapshot.state?.sessionId)
      .slice(0, states.length);
    sampleRuntimes.forEach((runtime, index) => { runtime.status = states[index]; });
    snapshot.unreadSessionIds = sampleRuntimes.filter(runtime => runtime.status === 'completed').map(runtime => runtime.sessionId);
  }
  emit({ type: 'desktop_runtimes', runtimes: structuredClone(snapshot.runtimes) });
}
async function open(id: string) {
  const session = sessions.find(item => item.id === id);
  if (!session) throw new Error('样例会话不存在');
  const models = id === 'sample-controls' ? controlModels : [model];
  const selection = modelSelections.get(id) ?? { model: models[0], thinkingLevel: 'medium' };
  snapshot = { ...snapshot, draftId: undefined, runtimeId: `preview-${id}`, status: 'connected',
    models,
    preferences: { ...snapshot.preferences, workspace: session.cwd }, modelSelection: undefined,
    state: { sessionId: id, sessionName: session.name, ...selection, isStreaming: running.has(id) || approvals.has(id) },
    requests: approvals.has(id) ? [approvals.get(id)!] : [],
    pendingMessages: structuredClone(queues.get(id) ?? []),
    messages: histories.get(id) ?? [], stats: { toolCalls: 1, assistantMessages: 2,
      tokens: { input: 2380, output: 486, cacheRead: 1600, cacheWrite: 0, total: 4466 },
      contextUsage: { tokens: 4466, contextWindow: 256000, percent: 1.74 } } };
  syncRuntimes();
  return clone();
}
async function welcome(workspace?: string) {
  snapshot = { ...snapshot, draftId: `draft-${++serial}`, runtimeId: undefined, state: undefined, stats: undefined,
    preferences: { ...snapshot.preferences, workspace }, messages: [], requests: [], pendingMessages: [], status: 'ready',
    modelSelection: { model, thinkingLevel: 'medium' } };
  return clone();
}
async function create() {
  const id = `local-${++serial}`;
  sessions.unshift({ id, path: `${id}.jsonl`, name: '新的离线会话', firstMessage: '',
    cwd: snapshot.preferences.workspace ?? project, modified: new Date().toISOString(), messageCount: 0 });
  histories.set(id, []);
  return open(id);
}
function finish(id: string, aborted = false) {
  clearTimeout(running.get(id)); running.delete(id);
  const messages = histories.get(id)!;
  if (!aborted) messages.push({ role: 'assistant', entryId: `reply-${++serial}`,
    content: '收到。这是一条本地模拟回复，未调用模型，也没有执行文件操作。\n\n你可以继续查看思考档位、侧栏和右栏在星辰主题下的表现。', stopReason: 'stop' });
  if (snapshot.state?.sessionId === id) {
    snapshot.messages = messages; snapshot.state.isStreaming = false;
  }
  syncRuntimes();
  emit({ type: 'desktop_history', messages: structuredClone(messages) }, id);
  emit({ type: 'agent_end' }, id);
}
const bridge: Partial<DesktopBridge> = {
  platform: 'win32', snapshot: async () => clone(), navigateSession: open, switchSession: open,
  sessions: async () => structuredClone(sessions),
  sessionReading: async id => ({ sessionId: id, messages: structuredClone(histories.get(id) ?? []) }),
  beginSession: welcome, newIndependentSession: () => welcome(), createDraftSession: create,
  chooseSessionProject: () => welcome(project), chooseWorkspace: () => welcome(project), workspace: welcome,
  themeScene: async id => {
    if (id !== pack.id) throw new Error('Theme unavailable');
    return fetch(new URL('../../../theme-marketplace/plugins/stellar-cruise/scene.json', import.meta.url)).then(r => r.json());
  },
  themePoster: async id => id === pack.id ? new URL('../../../theme-marketplace/plugins/stellar-cruise/cover.png', import.meta.url).href : undefined,
  preferences: async patch => {
    snapshot.preferences = { ...snapshot.preferences, ...patch };
    const { theme, themeMotion, themeBrightness, accentColor } = snapshot.preferences;
    try { localStorage.setItem(savedKey, JSON.stringify({ theme, themeMotion, themeBrightness, accentColor })); } catch { /* Optional. */ }
    return structuredClone(snapshot.preferences);
  },
  command: async (type, args, runtimeId) => {
    if (type === 'get_available_thinking_levels') return { levels: (snapshot.modelSelection?.model ?? snapshot.state?.model ?? model).thinkingLevels ?? [] };
    if (type === 'get_commands') return { commands: snapshot.state?.sessionId === 'sample-controls'
      ? themeControlCommands() : [{ name: 'permissions', description: '权限', source: 'extension' }] };
    if (type === 'set_thinking_level') {
      const selected = snapshot.modelSelection?.model ?? snapshot.state?.model ?? model;
      if (!selected.thinkingLevels?.includes(String(args?.level))) throw new Error('离线样例档位不存在');
      if (snapshot.state) {
        snapshot.state.thinkingLevel = String(args?.level);
        if (snapshot.state.sessionId) modelSelections.set(snapshot.state.sessionId, { model: selected, thinkingLevel: String(args?.level) });
      }
      if (snapshot.modelSelection) snapshot.modelSelection.thinkingLevel = String(args?.level);
      return {};
    }
    if (type === 'set_model') {
      const selection = selectThemeControlModel(snapshot.models, args);
      const id = snapshot.state?.sessionId;
      await new Promise(resolve => setTimeout(resolve, 650));
      if (id) modelSelections.set(id, selection);
      if (snapshot.state?.sessionId === id && snapshot.state) Object.assign(snapshot.state, selection);
      else if (!id && snapshot.modelSelection) snapshot.modelSelection = selection;
      return {};
    }
    if (type === 'set_permission_preset') { snapshot.permissionPreset = args?.preset as Snapshot['permissionPreset']; return {}; }
    if (type === 'new_session') return welcome(snapshot.preferences.workspace);
    const id = runtimeId?.replace(/^preview-/, '') ?? snapshot.state?.sessionId;
    if (['queue_edit', 'queue_remove', 'queue_steer', 'queue_steer_first'].includes(type) && id) {
      const result = updateThemeQueue(queues.get(id) ?? [], type, args);
      queues.set(id, result.messages);
      if (snapshot.state?.sessionId === id) snapshot.pendingMessages = result.messages;
      emit({ type: 'desktop_queue', pendingMessages: structuredClone(result.messages) }, id);
      if (result.delivered) {
        const messages = histories.get(id)!;
        messages.push({ role: 'user', content: result.delivered.message, entryId: `queue-${++serial}` },
          { role: 'assistant', content: '已模拟投递这条消息；未调用模型或执行文件操作。', stopReason: 'stop' });
        if (snapshot.state?.sessionId === id) snapshot.messages = messages;
        emit({ type: 'desktop_history', messages: structuredClone(messages) }, id);
      }
      return {};
    }
    if (type === 'extension_ui_response' && id) {
      const request = approvals.get(id), sample = samples.find(sample => sample.id === id);
      if (!request || !sample || request.id !== args?.id || request.runtimeId !== runtimeId)
        throw new Error('离线请求已失效');
      if (request.method === 'select' && args.value === 'Request refinements') {
        const feedback = { ...request, id: `stellar-plan-feedback-${++serial}`, method: 'input',
          title: 'Desktop Plan refinements', options: undefined };
        approvals.set(id, feedback);
        if (snapshot.state?.sessionId === id) snapshot.requests = [feedback];
        emit(feedback, id);
        return {};
      }
      let answers: QuestionAnswer[] = [];
      if (!args.cancelled) {
        if (id === 'sample-question') {
          answers = JSON.parse(String(args.value));
          serializeAnswers(questions, answers);
        } else if (request.method === 'confirm' && args.confirmed !== true) throw new Error('请选择批准或取消');
        else if (request.method === 'select' && !request.options?.includes(String(args.value))) throw new Error('请选择有效操作');
        else if (request.method === 'input' && !String(args.value ?? '').trim()) throw new Error('请填写修改意见');
      }
      approvals.delete(id);
      const messages = histories.get(id)!;
      messages.push({ role: 'toolResult', toolName: sample.toolName, toolCallId: sample.callId,
        content: args.cancelled ? '离线样例已取消。' : '离线样例已记录确认；未执行任何文件或命令操作。',
        details: id === 'sample-question' ? { questions: questions.questions, cancelled: Boolean(args.cancelled),
          answers: answers.map((answer, i) => ({ label: answer.wasCustom ? answer.value
            : questions.questions[i].options.find(option => option.value === answer.value)?.label ?? answer.value })) }
          : id === 'sample-plan' ? { planFilePath: `${project}\\plan.md`, planContents: planContent,
            outcome: args.cancelled ? 'dismissed' : request.method === 'input' ? 'feedback'
              : args.value === 'Keep planning' ? 'dismissed' : 'approved',
            feedback: request.method === 'input' && !args.cancelled ? String(args.value) : undefined } : undefined });
      messages.push({ role: 'assistant', content: args.cancelled ? '已取消这次离线样例。' : '已记录你的选择。这只是离线交互样例，没有执行操作。', stopReason: 'stop' });
      if (snapshot.state?.sessionId === id) {
        snapshot.messages = messages; snapshot.requests = []; snapshot.state.isStreaming = false;
      }
      syncRuntimes();
      emit({ type: 'desktop_history', messages: structuredClone(messages) }, id);
      emit({ type: 'agent_end' }, id);
      return {};
    }
    if (type === 'abort' && id) {
      const request = approvals.get(id);
      if (request) {
        await bridge.command!('extension_ui_response', { id: request.id, cancelled: true }, request.runtimeId);
        emit({ type: 'desktop_ui_expired', id: request.id }, id);
      } else finish(id, true);
      return {};
    }
    if (type === 'prompt' && id) {
      if (running.has(id)) throw new Error('请等待这条离线回复完成');
      const messages = histories.get(id)!;
      messages.push({ role: 'user', entryId: `user-${++serial}`, content: String(args?.message ?? '') });
      if (snapshot.state?.sessionId === id) { snapshot.messages = messages; snapshot.state.isStreaming = true; }
      running.set(id, setTimeout(() => finish(id), 2400));
      syncRuntimes();
      emit({ type: 'desktop_history', messages: structuredClone(messages) }, id);
      emit({ type: 'agent_start' }, id);
      return {};
    }
    throw new Error('离线样例不会执行此命令');
  },
  onEvent: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  systemTheme: async () => ({ systemDark: true }),
  windowControl: async () => ({ focused: true, maximized: false, fullscreen: false }),
  updateState: async () => ({ status: 'idle', currentVersion: '0.6.0', channel: 'preview' }),
  onUpdateEvent: () => () => {},
  browserList: async () => ({ revision: 0, tabs: [] }), browserLayout: async () => {}, onBrowserEvent: () => () => {},
  terminalList: async () => [], onTerminalEvent: () => () => {},
  settings: async () => ({ account: { loggedIn: false, validity: 'unknown' }, profiles: [], providers: [], mcp: {}, skills: [] }),
  copyText: async text => navigator.clipboard.writeText(text),
  fileOpen: async (target, destination) => openThemePreviewFile(target, destination),
  chooseAttachments: async () => [{ kind: 'file', id: themePreviewFile.id,
    name: '离线样例-stellar-notes.md', size: themePreviewFile.size }],
  fileOpenOptions: async target => {
    openThemePreviewFile(target);
    return { choices: [{ id: 'preview', label: '内置预览' }], selected: 'preview' };
  },
  summary: async () => ({ sessionId: snapshot.state?.sessionId ?? '', tasks: [
    { id: '1', subject: '核对欢迎页与会话主题', description: '离线样例', status: 'completed' },
    { id: '2', subject: '检查窄窗口与键盘焦点', description: '离线样例', status: 'in_progress' },
    { id: '3', subject: '梳理思考与工具记录', description: '离线样例：核对展开层次、结果与状态。', status: 'pending' },
    { id: '4', subject: '校对上下文刻度与用量', description: '离线样例：检查容量警告、未知值与消息筛选。', status: 'pending' },
    { id: '5', subject: '检查 Diff 与文件阅读', description: '离线样例：检查对比色、源码换行与复制。', status: 'pending' },
    { id: '6', subject: '验证主题切换与资源释放', description: '离线样例：确认原版主题恢复及场景清理。', status: 'pending' },
  ], mcp: [], skillCount: 0 }),
  repositoryDiff: async () => ({ state: 'ready', root: project, branch: 'preview/stellar', base: 'HEAD',
    bases: ['HEAD'], revision: 'offline', files: [
      { path: 'theme/palette.json', status: 'M', added: 2, removed: 2, binary: false },
    ], added: 2, removed: 2, truncated: false }),
  repositoryFileDiff: async (_runtimeId, _base, path) => ({ path, added: 2, removed: 2, rows: [
    { kind: 'context', text: '{', oldLine: 1, newLine: 1 },
    { kind: 'remove', text: '  "background": "#121212",', oldLine: 2 },
    { kind: 'add', text: '  "background": "#080d12",', newLine: 2 },
    { kind: 'remove', text: '  "accent": "#b8b8b8"', oldLine: 3 },
    { kind: 'add', text: '  "accent": "#74d9d0"', newLine: 3 },
    { kind: 'context', text: '}', oldLine: 4, newLine: 4 },
  ] }),
  cronList: async () => ({ tasks: [], hosts: [], issues: [] }),
  clm: async () => ({ sessionId: snapshot.state?.sessionId ?? '', leafId: null, enabled: true,
    total: 0, revisions: [], tokens: 4466 }),
  rightPanelWidthMenu: async selected => selected === 'standard' ? 'wide' : 'standard',
};
// No Electron or host access: unsupported native actions fail explicitly.
window.desktop = new Proxy(bridge, {
  get(target, key) {
    if (key in target) return Reflect.get(target, key);
    return async () => { throw new Error('离线样例不执行系统、账户或文件操作'); };
  },
}) as DesktopBridge;
applyTheme(preferences.theme, true, preferences.accentColor);
window.desktopTheme = {
  themePacks: [pack], preference: preferences.theme, resolved: resolveTheme(preferences.theme, true).scheme,
  themeMotion: preferences.themeMotion, themeBrightness: preferences.themeBrightness,
  accentColor: preferences.accentColor, systemDark: true,
  firstFrame: () => ({ theme: document.documentElement.dataset.theme,
    palette: document.documentElement.dataset.palette, readyState: document.readyState }),
};
syncRuntimes();
const view = new URLSearchParams(location.search).get('view');
if (view === 'chat') await open('theme-preview');
else if (view === 'queue') await open('sample-queue');
else if (view === 'navigation' || view === 'agents') await open(`sample-${view}`);
else if (view === 'controls') await open('sample-controls');
else if (view && ['permission', 'plan', 'question'].includes(view)) await open(`sample-${view}`);
await import('../../src/main');
