import type { DesktopBridge, Message, Model, RuntimeEvent, Snapshot } from '../../src/contracts';
import type { ComposerCommand } from '../../src/composer-commands';
import type { ProjectInstructionsStatus } from '../../src/project-instructions';
import { changeFavoriteModel } from '../../src/model-favorites';
import { applyTheme, themes } from '../../src/theme';
import { emptyLaunch } from '../../src/launch-state';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const zh = language === 'zh';
const theme = themes.find(item => item.id === params.get('theme'))?.id ?? 'wine';
let mode: ProjectInstructionsStatus['mode'] = params.get('mode') === 'create' ? 'create'
  : params.get('mode') === 'unavailable' ? 'unavailable'
  : params.get('mode') === 'choose-project' ? 'choose-project' : 'review';
const workspace = 'D:\\Projects\\StepCode';
const runtimeId = 'rules-preview-runtime';
const sessionId = 'rules-preview-session';
const models: Model[] = [
  { provider: 'step', id: 'step-5-preview', name: 'step-5-preview', reasoning: true,
    input: ['text', 'image'], contextWindow: 128000, maxTokens: 16384 },
  { provider: 'step', id: 'step-4', name: 'step-4', input: ['text'], contextWindow: 128000 },
];
const commands: ComposerCommand[] = [
  ...['init', 'permissions', 'plan', 'goal', 'ultraloop', 'todos', 'usage', 'cron', 'workflows']
    .map(name => ({ name, source: 'extension' })),
  { name: 'connect', source: 'extension', description: 'Mirror this terminal session to Lark; /connect off disconnects' },
  { name: 'skill:bilibili-video-research', source: 'skill',
    description: 'Research a public Bilibili video or b23.tv link using the configured video tools.' },
  { name: 'skill:hermes-engineering-evidence', source: 'skill',
    description: '在 Hermes 工程委托中整理实际变更、命令结果和未完成事项，供外部验收。' },
];
let snapshot: Snapshot = {
  preferences: { theme, language, workspaces: [workspace], workspace,
    workspaceNames: { 'd:/projects/stepcode': 'StepCode' }, autoCheckUpdates: false },
  status: 'connected', runtimeId, permissionPreset: 'full-access', launch: emptyLaunch(),
  state: { sessionId, sessionName: zh ? '项目 AI 工作规范' : 'Project AI working rules', isStreaming: false,
    model: models[0], thinkingLevel: 'medium' },
  models, sessions: [{ id: sessionId, path: 'preview.jsonl', cwd: workspace,
    name: zh ? '项目 AI 工作规范' : 'Project AI working rules',
    firstMessage: zh ? '先了解一下这个项目。' : 'Take a look at this project first.',
    modified: '2026-11-06T08:00:00Z', messageCount: 2 }],
  messages: [
    { role: 'user', entryId: 'preview-question', timestamp: Date.parse('2026-11-06T08:00:00Z'),
      content: zh ? '先了解一下这个项目。' : 'Take a look at this project first.' },
    { role: 'assistant', entryId: 'preview-answer', timestamp: Date.parse('2026-11-06T08:00:17Z'),
      content: zh ? '这是一个使用 **pnpm** 的桌面项目，源码在 `Desktop/` 中。'
        : 'This desktop project uses **pnpm**. Its source is in `Desktop/`.' },
  ],
  stats: { toolCalls: 3, assistantMessages: 1,
    tokens: { input: 1540, output: 1100, cacheRead: 36960, cacheWrite: 0, total: 39600 },
    contextUsage: { tokens: 38500, contextWindow: 128000, percent: 30.08 } },
};
const clone = () => structuredClone(snapshot);
if (mode === 'choose-project') snapshot = {
  ...snapshot, preferences: { theme, language, workspaces: [], autoCheckUpdates: false },
  status: 'ready', runtimeId: undefined, draftId: 'rules-preview-draft', state: undefined,
  messages: [], sessions: [], stats: undefined,
};
const listeners = new Set<(event: RuntimeEvent) => void>();
const emit = (event: RuntimeEvent) => {
  for (const listener of listeners) listener(structuredClone({ runtimeId: snapshot.runtimeId, sessionId: snapshot.state?.sessionId, ...event }));
};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const edit = (text: string) => {
  emit({ type: 'extension_ui_request', method: 'set_editor_text', text });
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLElement & { setSelectionRange: (start: number, end: number) => void }>('.composer-input');
    input?.focus();
    input?.setSelectionRange(text.length, text.length);
  });
};
const message = (role: string, content: string): Message => ({ role, content, timestamp: Date.now(), entryId: crypto.randomUUID() });
const command: DesktopBridge['command'] = async (type, args) => {
  if (type === 'get_available_thinking_levels') return { levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] };
  if (type === 'get_commands') {
    return { commands: structuredClone(commands) };
  }
  if (type === 'set_permission_preset') {
    if (!['ask', 'approve-for-me', 'full-access'].includes(String(args?.preset))) throw new Error('Invalid preview permission');
    snapshot.permissionPreset = args!.preset as Snapshot['permissionPreset'];
    return {};
  }
  if (type === 'set_model') {
    const model = models.find(item => item.provider === args?.provider && item.id === args?.modelId);
    if (!model) throw new Error('Unknown preview model');
    snapshot.state = { ...snapshot.state!, model };
    return {};
  }
  if (type === 'set_thinking_level') {
    snapshot.state = { ...snapshot.state!, thinkingLevel: String(args?.level) };
    return {};
  }
  if (type === 'set_launch_mode') {
    const key = args?.mode === 'plan' ? 'planArmed' : args?.mode === 'goal' ? 'goalArmed' : 'ultracodeArmed';
    snapshot.launch = { ...snapshot.launch!, [key]: Boolean(args?.enabled) };
    return {};
  }
  if (type === 'prompt') {
    if (String(args?.message).trim() !== '/init') throw new Error(zh ? '此示例仅提供 /init 的模拟结果。' : 'Only /init has a sample response in this preview.');
    if (mode === 'unavailable') throw new Error(zh ? '无法读取 AGENTS.md，未创建或覆盖任何文件。' : 'Could not read AGENTS.md. No files were created or overwritten.');
    if (mode === 'choose-project') throw new Error(zh ? '请先选择项目文件夹。' : 'Choose a project folder first.');
    const creating = mode === 'create';
    const user = message('user', '/init');
    snapshot.messages.push(user);
    snapshot.state = { ...snapshot.state!, isStreaming: true };
    emit({ type: 'agent_start' });
    emit({ type: 'message_end', message: user });
    await pause(450);
    const answer = message('assistant', creating
      ? zh ? '已创建 `AGENTS.md`，包含项目边界、修改约定和已核对的 `pnpm` 验证命令。\n\n本次只创建了 AI 工作规范，没有修改其他文件。'
        : 'Created `AGENTS.md` with the project boundaries, editing rules and verified `pnpm` checks.\n\nNo other files were changed.'
      : zh ? '检查完成，有 **1 项更新建议**。\n\n现有规范使用 `npm test`，而项目的 `package.json` 声明了 `pnpm`。建议仅将测试命令替换为 `pnpm test`，保留其余人工约定。\n\n**本轮未修改任何文件。** 确认后，再按你的要求应用这项修改。'
        : 'Check complete: **one suggested update**.\n\nThe rules say `npm test`, but `package.json` specifies `pnpm`. Replace only the test command with `pnpm test` and retain the human-authored rules.\n\n**No files were changed.** Apply this suggestion only after your explicit confirmation.');
    answer.desktopTiming = { run: { startedAt: user.timestamp!, endedAt: answer.timestamp! }, thinking: {} };
    snapshot.messages.push(answer);
    snapshot.state = { ...snapshot.state!, isStreaming: false };
    if (creating) mode = 'review';
    emit({ type: 'message_end', message: answer });
    emit({ type: 'agent_end' });
    return {};
  }
  throw new Error(`Unsupported preview command: ${type}`);
};

// Only the data/IPC boundary is simulated. main.tsx owns every application component and style.
const bridge: Partial<DesktopBridge> = {
  platform: 'win32',
  snapshot: async () => clone(),
  projectInstructions: async () => {
    await pause(120);
    if (mode === 'unavailable') throw new Error('Preview read failure');
    return { mode };
  },
  command,
  preferences: async patch => {
    const { modelFavorite, ...preferences } = patch;
    snapshot.preferences = { ...snapshot.preferences, ...preferences,
      ...(modelFavorite ? { favoriteModels: changeFavoriteModel(snapshot.preferences.favoriteModels ?? [], modelFavorite) } : {}) };
    return structuredClone(snapshot.preferences);
  },
  onEvent: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  systemTheme: async () => ({ systemDark: false }),
  windowControl: async () => ({ focused: true, maximized: false, fullscreen: false }),
  updateState: async () => ({ status: 'idle', currentVersion: '0.6.0', channel: 'preview' }),
  onUpdateEvent: () => () => {},
  browserList: async () => ({ revision: 0, tabs: [] }),
  browserLayout: async () => {},
  onBrowserEvent: () => () => {},
  terminalList: async () => [],
  onTerminalEvent: () => () => {},
  repositoryDiff: async () => ({ state: 'not-git', bases: [], files: [], added: 0, removed: 0, truncated: false }),
  summary: async () => ({ sessionId, tasks: [], mcp: [], skillCount: 2 }),
  artifactFiles: async (_runtimeId, paths) => paths.filter(path => /(?:^|[\\/])AGENTS\.md$/i.test(path))
    .map(path => ({ path, exists: true, canOpen: true, kind: 'document', size: 248 })),
  fileOpen: async target => target && 'path' in target && /(?:^|[\\/])AGENTS\.md$/i.test(target.path)
    ? { destination: 'preview', file: { id: 'rules-preview-file', path: target.path, name: 'AGENTS.md', mode: 'markdown',
      text: zh ? '# AI 工作规范\n\n- 桌面客户端位于 `Desktop/`。\n- 使用 `pnpm` 管理依赖。\n- 修改前阅读已有代码，保留人工约定。'
        : '# AI working rules\n\n- The desktop client lives in `Desktop/`.\n- Use `pnpm` for dependencies.\n- Read the existing code and retain human-authored rules.',
      size: 248 } } : null,
  fileOpenOptions: async () => ({ choices: [{ id: 'preview', label: zh ? '内置预览' : 'Preview' }], selected: 'preview' }),
  sessions: async () => structuredClone(snapshot.sessions),
  navigateSession: async id => id === sessionId ? clone() : null,
  createDraftSession: async () => { throw new Error(zh ? '请先选择项目文件夹。' : 'Choose a project folder first.'); },
  chooseAttachments: async () => [],
  copyText: text => navigator.clipboard.writeText(text),
};
window.desktop = bridge as DesktopBridge;
applyTheme(theme, false);
window.addEventListener('desktop-shell-ready', () => { setTimeout(() => edit('/in'), 160); }, { once: true });
await import('../../src/main');
