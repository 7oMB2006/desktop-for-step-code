import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { FolderOpen, Moon, Plus, RotateCcw, Settings, Sun, X } from 'lucide-react';
import { MiniChatFrame, type MiniChatSession } from '../../src/MiniChatFrame';
import { WindowBar } from '../../src/WindowBar';
import { ConversationMessages } from '../../src/ConversationMessages';
import { ConversationDisclosureMemory, type ConversationDisclosureState } from '../../src/ConversationDisclosureState';
import { captureReadingPosition, restoreReadingPosition, type ReadingPosition } from '../../src/session-reading';
import { followAfterScroll, scrollKeyIntent, type ScrollIntent } from '../../src/conversation-scroll';
import { ScrollToBottomButton } from '../../src/ScrollToBottomButton';
import { ComposerInput } from '../../src/ComposerInput';
import { ComposerActionIcon } from '../../src/ComposerActionIcon';
import { ComposerContextBar } from '../../src/ComposerContextBar';
import { ComposerMenu } from '../../src/ComposerMenu';
import { PermissionPicker } from '../../src/PermissionPicker';
import { ModelEffortPicker } from '../../src/ModelEffortPicker';
import { ContextRing } from '../../src/ContextRing';
import { WorkingIndicator } from '../../src/WorkingIndicator';
import { QuotePreview } from '../../src/QuotePreview';
import { SelectionToolbar } from '../../src/SelectionToolbar';
import { QuoteAnnotations, quoteSourceRange } from '../../src/QuoteAnnotations';
import { AppTooltip } from '../../src/AppTooltip';
import { quotePrompt, sameQuoteSelection, MAX_QUOTES, type ChatQuote } from '../../src/chat-quotes';
import { messageText } from '../../src/conversation-presentation';
import { applyTheme } from '../../src/theme';
import type { DesktopBridge, Message, Model, PermissionPreset } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import '../../src/appearance.css';
import './mini-chat.css';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const zh = language === 'zh';
const t = (cn: string, en: string) => zh ? cn : en;
const model: Model = { id: 'step-5-preview', name: 'step-5-preview', provider: 'step_plan', contextWindow: 256000 };
const levels = ['low', 'medium', 'high', 'xhigh', 'max'];
const catalog: MiniChatSession[] = [
  { id: 'plugins', title: t('插件市场发布检查', 'Plugin marketplace checklist'), project: 'Desktop For Step Code', branch: 'main' },
  { id: 'search', title: t('搜索命中定位', 'Locate search results'), project: 'Desktop For Step Code', branch: 'search' },
  { id: 'draft', title: t('新会话', 'New conversation'), project: 'Desktop For Step Code', branch: 'main' },
];
const now = Date.now() - 90_000;
const initialMessages = (id: string): Message[] => id === 'draft' ? [] : id === 'search' ? [
  { role: 'user', entryId: 'search-user', timestamp: now, content: t('搜索结果点进去后，能直接定位到对应的那一行吗？', 'Can a search result take me directly to the matching line?') },
  { role: 'assistant', entryId: 'search-answer', timestamp: now + 15_000, stopReason: 'stop',
    desktopTiming: { run: { startedAt: now, endedAt: now + 15_000 }, thinking: {} }, content: [{ type: 'text', text: t(
    '可以。定位时要区分 **会话、消息、文字片段**，不能只滚动到整段回复的顶部。\n\n```ts\nconst target = findMessage(entryId);\nrevealTextPage(target, query);\nscrollToMatch(target, query);\n```\n\n如果消息已经因为压缩不在当前上下文里，就保留明确的回退提示，不去猜一个相似位置。',
    'Yes. Locate the **conversation, message and text range**, rather than just the top of an answer.\n\n```ts\nconst target = findMessage(entryId);\nrevealTextPage(target, query);\nscrollToMatch(target, query);\n```\n\nIf compaction removed the message, keep an explicit fallback instead of guessing another location.') }] },
] : [
  { role: 'user', entryId: 'plugin-user', timestamp: now, content: t('帮我整理一份插件市场的发布检查清单。', 'Prepare a release checklist for the plugin marketplace.') },
  { role: 'assistant', entryId: 'plugin-think', timestamp: now + 1_000, content: [
    { type: 'thinking', thinking: t('先核对权限声明、安装来源和失败状态，再整理需要人工确认的内容。', 'Check permissions, package provenance and failure states before listing manual checks.') },
    { type: 'toolCall', id: 'read-checklist', name: 'read_file', arguments: { path: 'docs/PLUGIN_AUTHORING.md' } },
  ] },
  { role: 'toolResult', toolCallId: 'read-checklist', toolName: 'read_file', timestamp: now + 2_000,
    content: t('作者需声明权限、配置项、入口与安装来源。社区插件运行可能产生模型费用。', 'Authors declare permissions, configuration, entry points and provenance. Community plugins can incur model usage.') },
  { role: 'assistant', entryId: 'plugin-answer', timestamp: now + 28_000, stopReason: 'stop',
    desktopTiming: { run: { startedAt: now, endedAt: now + 28_000 }, thinking: {} }, content: [{ type: 'text', text: t(
    '发布前建议分成两组核对。\n\n### 已整理\n\n- **安装来源**：区分市场条目和本地安装包。\n- **权限声明**：保留工具与配置的实际边界。\n- **费用影响**：说明插件可能发起模型请求。\n\n### 还需人工确认\n\n取消安装、断网重试，以及已有配置覆盖时的提示。\n\n最后把确认结果放进 `docs/release-checklist.md`，和本次候选版本一起留档。',
    'Split the release checks into two groups.\n\n### Prepared\n\n- **Package provenance**: distinguish catalog entries from local installs.\n- **Permissions**: state actual tool and configuration boundaries.\n- **Usage costs**: disclose model requests initiated by plugins.\n\n### Manual checks\n\nCancel an installation, retry offline, and review existing-configuration warnings.\n\nKeep the results in `docs/release-checklist.md` with this release candidate.') }] },
];
type PreviewQuote = ChatQuote & { wholeMessage?: true };
type Conversation = { messages: Message[]; draft: string; quotes: PreviewQuote[]; busy: boolean; level: string; preset: PermissionPreset };
type ConversationPatch = Partial<Conversation> | ((current: Conversation) => Partial<Conversation>);
const initialConversation = (id: string): Conversation => {
  const messages = initialMessages(id);
  if (params.get('stress') === 'reading' && messages.length) {
    messages.push({ role: 'assistant', entryId: `${id}-reading`, timestamp: now + 29_000,
      content: Array.from({ length: 28 }, (_, index) => ({
        type: 'text', text: `### ${t('检查记录', 'Check record')} ${index + 1}\n\n${t(
          '保留每一项检查的来源、实际结果以及待确认的边界。切换窗口时，阅读位置与工具展开状态不应丢失。',
          'Keep the source, observed result and open questions for each check. Reading position and expanded tools should survive window handoff.')}`,
      })) });
  }
  return { messages, draft: '', quotes: [], busy: false, level: 'high', preset: 'ask' };
};
type ReadingState = { position?: ReadingPosition; disclosures: ConversationDisclosureState };
const newReadingState = (): ReadingState => ({ disclosures: new Map() });

// This isolated fixture has no runtime, profile, filesystem or model access.
window.desktop = {
  platform: params.get('platform') === 'mac' ? 'darwin' : 'win32',
  windowControl: async () => ({ maximized: false, fullscreen: false, focused: true }),
  onEvent: () => () => {},
  copyText: (text: string) => navigator.clipboard.writeText(text),
} as unknown as DesktopBridge;

function ChatSurface({ conversation, reading, scope, update, onSend, onStop }: {
  conversation: Conversation; reading: ReadingState; scope: string; update: (value: ConversationPatch) => void;
  onSend: () => void; onStop: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(reading.position?.follow ?? true);
  const scrollIntent = useRef<ScrollIntent | undefined>(follow.current ? undefined : 'backward');
  const restoring = useRef(true);
  const touchY = useRef<number | undefined>(undefined);
  const [awayFromBottom, setAwayFromBottom] = useState(!follow.current);
  const latest = useRef(conversation); latest.current = conversation;
  const [references, setReferences] = useState(false);
  const [error, setError] = useState('');
  const { messages, draft, quotes, busy, level, preset } = conversation;
  const focusEditor = () => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.composer-input')?.focus({ preventScroll: true }));
  const followLayout = useCallback(() => {
    const element = viewport.current;
    if (!element || restoring.current) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode && transcript.current?.contains(selection.anchorNode)) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 1) {
      follow.current = followAfterScroll(follow.current, 0, scrollIntent.current);
    }
    if (follow.current) element.scrollTop = element.scrollHeight;
    setAwayFromBottom(!follow.current && element.scrollHeight > element.clientHeight);
    reading.position = captureReadingPosition(element, latest.current.messages, follow.current);
  }, [reading]);
  const handleScrollIntent = (intent: ScrollIntent) => {
    const element = viewport.current;
    if (!element) return;
    scrollIntent.current = intent;
    if (intent === 'backward') follow.current = false;
    else if (element.scrollHeight - element.scrollTop - element.clientHeight <= 1) follow.current = true;
    setAwayFromBottom(!follow.current && element.scrollHeight > element.clientHeight);
    reading.position = captureReadingPosition(element, latest.current.messages, follow.current);
  };
  const returnToBottom = () => {
    const element = viewport.current;
    if (!element) return;
    follow.current = true;
    scrollIntent.current = 'tail';
    setAwayFromBottom(false);
    reading.position = captureReadingPosition(element, latest.current.messages, true);
    element.scrollTo({ top: element.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    focusEditor();
  };
  const submit = () => {
    if (busy || !draft.trim() && !quotes.length) return;
    follow.current = true;
    scrollIntent.current = 'tail';
    onSend();
  };
  useLayoutEffect(() => {
    const element = viewport.current!;
    if (reading.position) restoreReadingPosition(element, latest.current.messages, reading.position);
    else element.scrollTop = element.scrollHeight;
    restoring.current = false;
    const observer = new ResizeObserver(followLayout);
    observer.observe(element);
    if (transcript.current) observer.observe(transcript.current);
    return () => {
      reading.position = captureReadingPosition(element, latest.current.messages, follow.current);
      restoring.current = true;
      observer.disconnect();
    };
  }, [reading, followLayout]);
  useLayoutEffect(followLayout, [messages, busy, followLayout]);
  const reveal = (quote: PreviewQuote) => {
    const host = transcript.current;
    const range = host && !quote.wholeMessage ? quoteSourceRange(host, quote) : null;
    const source = quote.wholeMessage && host
      ? quote.entryId
        ? [...host.querySelectorAll<HTMLElement>('[data-message-entry-id]')].find(element => element.dataset.messageEntryId === quote.entryId)
        : host.querySelector<HTMLElement>(`[data-message-index="${quote.messageIndex}"]`)
      : range?.startContainer.parentElement;
    if (!source) {
      setError(t('找不到引用原文，当前会话内容可能已经变化。', 'The quote source is unavailable; the conversation may have changed.'));
      return false;
    }
    setError('');
    handleScrollIntent('backward');
    source.scrollIntoView({ block: quote.wholeMessage ? 'start' : 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    return true;
  };
  const addQuote = (quote: PreviewQuote) => {
    if (quotes.some(existing => sameQuoteSelection(existing, quote))) return true;
    if (quotes.length >= MAX_QUOTES) { setError(t('最多添加 8 段引用', 'Maximum 8 quotes')); return false; }
    update(current => ({ quotes: current.quotes.some(existing => sameQuoteSelection(existing, quote))
      || current.quotes.length >= MAX_QUOTES ? current.quotes : [...current.quotes, quote] }));
    focusEditor(); return true;
  };
  return <div className="mini-preview-chat" ref={root} data-surface={scope}>
    <div className="conversation" ref={viewport} onWheel={event => {
      if (!event.ctrlKey && !event.defaultPrevented && event.deltaY) handleScrollIntent(event.deltaY < 0 ? 'backward' : 'forward');
    }} onKeyDown={event => {
      if (event.defaultPrevented || (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
      const intent = scrollKeyIntent(event);
      if (intent) handleScrollIntent(intent);
    }} onTouchStart={event => { touchY.current = event.touches[0]?.clientY; }}
      onTouchMove={event => {
        const y = event.touches[0]?.clientY;
        if (y !== undefined && touchY.current !== undefined && Math.abs(y - touchY.current) > 2) {
          handleScrollIntent(y > touchY.current ? 'backward' : 'forward');
          touchY.current = y;
        }
      }} onTouchEnd={() => { touchY.current = undefined; }} onTouchCancel={() => { touchY.current = undefined; }}
      onScroll={() => {
      const el = viewport.current!;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      follow.current = followAfterScroll(follow.current, distance, scrollIntent.current);
      if (scrollIntent.current === 'tail' && distance <= 1) scrollIntent.current = undefined;
      setAwayFromBottom(!follow.current && el.scrollHeight > el.clientHeight);
      reading.position = captureReadingPosition(el, messages, follow.current);
    }}>
      {messages.length ? <div className="messages" ref={transcript}>
        <ConversationDisclosureMemory.Provider value={reading.disclosures}>
          <ConversationMessages messages={messages} language={language} busy={busy} canEdit={!busy}
          onLayoutChange={followLayout}
          openImage={() => {}} onError={setError} onOpenSubagent={() => {}}
          edit={async (_message, text) => {
            if (latest.current.draft.length || latest.current.quotes.length)
              throw new Error(t('请先发送或清空当前草稿和引用，再编辑重做。', 'Send or clear the current draft and references before editing a message.'));
            update({ draft: text }); focusEditor();
          }}
          branch={() => setError(t('此预览不创建真实分支', 'This preview does not create real branches'))}/>
        </ConversationDisclosureMemory.Provider>
        {busy && <div className="working"><WorkingIndicator language={language} mode="responding">
          <span>{t('正在回复', 'Responding')}</span></WorkingIndicator></div>}
      </div> : <div className="mini-preview-empty"><img src="/StepCode.svg" width="38" height="38" alt=""/>
        <h2>{t('新会话', 'New conversation')}</h2><span><FolderOpen size={13}/>Desktop For Step Code</span></div>}
    </div>
    {error && <div className="mini-preview-error" role="alert"><span>{error}</span>
      <button type="button" className="icon-button" aria-label={t('关闭提示', 'Dismiss notice')} onClick={() => setError('')}><X size={14}/></button></div>}
    <div className="composer-wrap">
      <ComposerContextBar queued={false}>
        <QuotePreview quotes={quotes} language={language} remove={id => update(current => ({ quotes: current.quotes.filter(item => item.id !== id) }))}
          clear={() => update({ quotes: [] })} reveal={reveal}
          annotate={(id, annotation) => update(current => ({ quotes: current.quotes.map(item => item.id === id ? { ...item, annotation } : item) }))}/>
        {awayFromBottom && <ScrollToBottomButton language={language} onClick={returnToBottom}/>}
      </ComposerContextBar>
      <ComposerMenu draft={draft} setDraft={value => update({ draft: value })} commands={[]} language={language}
        scope={scope} disabled={false} referencesOpen={references} setReferencesOpen={setReferences}
        messages={messages} canAddFiles={false} permissionsSupported
        onFiles={async () => false}
        onQuote={index => { const text = messageText(messages[index]); return addQuote({ id: crypto.randomUUID(), messageIndex: index,
          entryId: messages[index].entryId, role: messages[index].role === 'user' ? 'user' : 'assistant',
          text, markdown: text, startOffset: 0, endOffset: text.length, wholeMessage: true }); }}
        onAction={action => root.current?.querySelector<HTMLButtonElement>(action === 'model' ? '.model-effort-trigger' : '.permission-trigger')?.click()}>
        <div className="composer">
          <ComposerInput language={language} label={t('消息', 'Message')} placeholder={t('你想做什么？', 'What would you like to work on?')}
            value={draft} disabled={false} onChange={value => update({ draft: value })} onPaste={() => {}}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault(); if (!busy) submit();
              }
            }}/>
          <div className="composer-tools">
            <button type="button" className="icon-button" aria-label={t('添加引用', 'Add reference')} data-tooltip={t('添加引用', 'Add reference')}
              aria-expanded={references} onClick={() => setReferences(value => !value)}><Plus size={17}/></button>
            <PermissionPicker preset={preset} language={language} disabled={busy} supported
              onSelect={async value => update({ preset: value })}/>
            <div className="spacer"/>
            <ContextRing usage={messages.length ? { tokens: 46080, contextWindow: 256000, percent: 18 } : undefined} language={language}/>
            <ModelEffortPicker model={model} models={[model]} level={level} levels={levels} language={language} disabled={busy}
              onModel={async () => {}} onEffort={async value => update({ level: value })}/>
            <button type="button" className="icon-button composer-action-button" data-action={busy ? 'stop' : 'send'}
              aria-label={busy ? t('停止此轮', 'Stop response') : t('发送', 'Send')} disabled={!busy && !draft.trim() && !quotes.length}
              onClick={() => { busy ? onStop() : submit(); }}><ComposerActionIcon stop={busy}/></button>
          </div>
        </div>
      </ComposerMenu>
    </div>
    <SelectionToolbar root={transcript} scope={scope} language={language} enabled={Boolean(messages.length)}
      onError={setError} onQuote={addQuote} focusComposer={focusEditor}/>
    <QuoteAnnotations root={transcript} scope={scope} language={language} quotes={quotes}
      remove={id => update(current => ({ quotes: current.quotes.filter(item => item.id !== id) }))}
      annotate={(id, annotation) => update(current => ({ quotes: current.quotes.map(item => item.id === id ? { ...item, annotation } : item) }))}/>
  </div>;
}

function Preview() {
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [open, setOpen] = useState(params.get('open') === '1');
  const [pinned, setPinned] = useState(true);
  const [sidebar, setSidebar] = useState(true);
  const [mainSession, setMainSession] = useState('plugins');
  const [miniSession, setMiniSession] = useState('plugins');
  const [mainHandoff, setMainHandoff] = useState(0);
  const [miniHandoff, setMiniHandoff] = useState(0);
  const reading = useRef({ main: new Map<string, ReadingState>(), mini: new Map<string, ReadingState>() });
  const resumeMini = useRef(params.get('open') === '1');
  const readingFor = (scope: 'main' | 'mini', id: string) => {
    let saved = reading.current[scope].get(id);
    if (!saved) { saved = newReadingState(); reading.current[scope].set(id, saved); }
    return saved;
  };
  const [records, setRecords] = useState<Record<string, Conversation>>(() =>
    Object.fromEntries(catalog.map(session => [session.id, initialConversation(session.id)])));
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const floating = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const releaseStream = useRef(false);
  const recordRef = useRef(records); recordRef.current = records;
  const update = useCallback((id: string, patch: ConversationPatch) =>
    setRecords(value => ({ ...value, [id]: { ...value[id], ...(typeof patch === 'function' ? patch(value[id]) : patch) } })), []);
  useEffect(() => applyTheme(dark ? 'original-dark' : 'original-light', dark), [dark]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearInterval(timer); }, []);
  useEffect(() => {
    const release = () => { releaseStream.current = true; };
    window.addEventListener('mini-preview-release', release);
    return () => window.removeEventListener('mini-preview-release', release);
  }, []);
  const focus = (surface: 'main' | 'mini') => requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(`[data-surface="${surface}"] .composer-input`)?.focus());
  const handoffReading = (from: 'main' | 'mini', to: 'main' | 'mini', id: string) => {
    const saved = readingFor(from, id);
    const element = document.querySelector<HTMLElement>(`[data-surface="${from}"] .conversation`);
    const position = captureReadingPosition(element, recordRef.current[id].messages, saved.position?.follow ?? true);
    reading.current[to].set(id, { position, disclosures: new Map(saved.disclosures) });
  };
  const close = () => { setOpen(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('.window-bar [aria-label="MiniChat"]')?.focus()); };
  const openMini = () => {
    if (!open && !resumeMini.current) {
      handoffReading('main', 'mini', mainSession);
      setMiniSession(mainSession); setMiniHandoff(value => value + 1);
    }
    resumeMini.current = true;
    setOpen(true); focus('mini');
  };
  const returnToMain = () => {
    handoffReading('mini', 'main', miniSession);
    setMainSession(miniSession); setMainHandoff(value => value + 1);
    resumeMini.current = false; setOpen(false); focus('main');
  };
  const stop = (id: string) => { clearInterval(timers.current.get(id)); timers.current.delete(id); update(id, { busy: false }); };
  const send = (id: string) => {
    const record = recordRef.current[id];
    if (record.busy || !record.draft.trim() && !record.quotes.length) return;
    releaseStream.current = false;
    const answerId = crypto.randomUUID();
    const sent: Message = { role: 'user', entryId: crypto.randomUUID(), timestamp: Date.now(), content: quotePrompt(record.draft, record.quotes, language) };
    const messages: Message[] = [...record.messages, sent, { role: 'assistant', entryId: answerId, timestamp: Date.now(), content: [{ type: 'text', text: '' }] }];
    update(id, { messages, busy: true, draft: '', quotes: [] });
    const answer = t('可以，我会先补齐这部分检查。\n\n1. 核对配置来源与权限边界。\n2. 保留失败、取消与重试的独立状态。\n3. 把验证结果记录到发布清单。\n\n```ts\nawait verifyPermissions();\nawait verifyCancellation();\n```\n\n完成后再确认当前候选是否满足发布条件。',
      'I will add these checks first.\n\n1. Verify configuration sources and permission boundaries.\n2. Keep failure, cancellation and retry states distinct.\n3. Record the evidence in the release checklist.\n\n```ts\nawait verifyPermissions();\nawait verifyCancellation();\n```\n\nThen review whether the current candidate is ready to release.');
    let end = 0;
    const timer = setInterval(() => {
      const limit = params.get('stream') === 'manual' && !releaseStream.current ? answer.length - 1 : answer.length;
      if (end === limit) return;
      end = Math.min(limit, end + 6);
      setRecords(value => ({ ...value, [id]: { ...value[id], busy: end < answer.length,
        messages: value[id].messages.map(message => message.entryId === answerId
          ? { ...message, content: [{ type: 'text', text: answer.slice(0, end) }] } : message) } }));
      if (end === answer.length) { clearInterval(timer); timers.current.delete(id); }
    }, 32);
    timers.current.set(id, timer);
  };
  useEffect(() => {
    if (!open) return;
    const constrain = () => {
      const box = floating.current?.getBoundingClientRect();
      if (!box) return;
      const height = Math.min(Math.max(box.height, 360), Math.max(0, innerHeight - 92));
      setPosition({ x: Math.max(8, Math.min(box.left, innerWidth - box.width - 8)),
        y: Math.max(80, Math.min(box.top, innerHeight - height - 12)) });
    };
    window.addEventListener('resize', constrain);
    return () => window.removeEventListener('resize', constrain);
  }, [open]);
  const dragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const box = floating.current!.getBoundingClientRect();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const box = floating.current!.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(innerWidth - box.width - 8, current.left + event.clientX - current.x)),
      y: Math.max(80, Math.min(innerHeight - box.height - 8, current.top + event.clientY - current.y)) });
  };
  return <div className="mini-preview">
    <div className="mini-preview-toolbar"><span>{t('MiniChat · 前端预览 · 示例数据', 'MiniChat · Frontend preview · Mock data')}</span>
      <button type="button" className="icon-button" aria-label={t('重置预览', 'Reset preview')} data-tooltip={t('重置预览', 'Reset preview')}
        onClick={() => { for (const id of timers.current.keys()) stop(id);
          reading.current = { main: new Map(), mini: new Map() };
          setMainHandoff(value => value + 1); setMiniHandoff(value => value + 1);
          setRecords(Object.fromEntries(catalog.map(session => [session.id, initialConversation(session.id)]))); setPosition(undefined); }}>
        <RotateCcw size={14}/></button>
      <button type="button" className="icon-button" aria-label={t('切换主题', 'Toggle theme')} data-tooltip={t('切换主题', 'Toggle theme')}
        onClick={() => setDark(value => !value)}>{dark ? <Sun size={15}/> : <Moon size={15}/>}</button>
    </div>
    <WindowBar language={language} sidebarVisible={sidebar} toggleSidebar={() => setSidebar(value => !value)} menus={[
      { id: 'file', label: t('文件', 'File'), items: [{ label: t('新会话', 'New conversation'), action: () => setMainSession('draft') }] },
      { id: 'edit', label: t('编辑', 'Edit'), items: [{ label: t('复制', 'Copy'), action: () => void navigator.clipboard.writeText(window.getSelection()?.toString() ?? '') }] },
      { id: 'view', label: t('视图', 'View'), items: [{ label: 'MiniChat', action: openMini }] },
      { id: 'help', label: t('帮助', 'Help'), items: [{ label: t('文档', 'Documentation'), disabled: true, action: () => {} }] },
    ]} sessionTitle={catalog.find(session => session.id === mainSession)!.title} miniChat={{ open, onOpen: openMini }}/>
    <div className={`mini-preview-workspace${sidebar ? '' : ' no-sidebar'}`}>
      <aside className="mini-preview-sidebar" hidden={!sidebar}>
        <div className="sidebar-identity"><img src="/StepCode.svg" width="26" height="26" alt=""/>
          <span className="sidebar-wordmark"><img className="wordmark-light" src="/wordmark-light.png" alt="Desktop for Step Code"/>
            <img className="wordmark-dark" src="/wordmark-dark.png" alt="Desktop for Step Code"/></span></div>
        <button type="button" className="new-chat" onClick={() => setMainSession('draft')}><Plus size={16}/>{t('新建会话', 'New conversation')}</button>
        <div className="section-label"><span>{t('项目', 'Projects')}</span></div>
        <div className="mini-preview-project"><FolderOpen size={15}/>Desktop For Step Code</div>
        <div className="session-list">{catalog.map(session => <div className={`session-row${mainSession === session.id ? ' selected' : ''}`} key={session.id}>
          <button type="button" onClick={() => setMainSession(session.id)}><span>{session.title}</span></button></div>)}</div>
        <div className="mini-preview-sidebar-footer"><Settings size={16}/><span>v0.6.0</span></div>
      </aside>
      <main className="mini-preview-main">
        <ChatSurface key={`${mainSession}:${mainHandoff}`} scope="main" conversation={records[mainSession]} reading={readingFor('main', mainSession)}
          update={patch => update(mainSession, patch)} onSend={() => send(mainSession)} onStop={() => stop(mainSession)}/>
      </main>
    </div>
    {open && <div className="mini-preview-floating" ref={floating} data-pinned={pinned}
      style={position ? { left: position.x, '--mini-preview-top': `${position.y}px`, right: 'auto' } as CSSProperties : undefined}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <MiniChatFrame language={language} session={catalog.find(session => session.id === miniSession)!} sessions={catalog}
        pinned={pinned} onPinned={setPinned} onSession={id => { setMiniSession(id); focus('mini'); }}
        onClose={close} onReturn={returnToMain} onDragStart={dragStart}>
        <ChatSurface key={`${miniSession}:${miniHandoff}`} scope="mini" conversation={records[miniSession]} reading={readingFor('mini', miniSession)}
          update={patch => update(miniSession, patch)} onSend={() => send(miniSession)} onStop={() => stop(miniSession)}/>
      </MiniChatFrame>
    </div>}
    <AppTooltip/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
