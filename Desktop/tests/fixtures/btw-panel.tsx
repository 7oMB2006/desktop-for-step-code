import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageCircleQuestion, Moon, Plus, Sun } from 'lucide-react';
import { BtwPanel, type BtwOpenRequest } from '../../src/BtwPanel';
import { ConversationMessages } from '../../src/ConversationMessages';
import { SelectionToolbar } from '../../src/SelectionToolbar';
import { QuotePreview } from '../../src/QuotePreview';
import { QuoteAnnotations, quoteSourceRange } from '../../src/QuoteAnnotations';
import type { ChatQuote } from '../../src/chat-quotes';
import { ComposerInput } from '../../src/ComposerInput';
import { ComposerActionIcon } from '../../src/ComposerActionIcon';
import { ComposerContextBar } from '../../src/ComposerContextBar';
import { LiveTurnChanges } from '../../src/LiveTurnChanges';
import { PerformanceBar } from '../../src/PerformanceBar';
import { AppTooltip } from '../../src/AppTooltip';
import { RightPanelHandle } from '../../src/RightPanelHandle';
import type { RightPanelWidth } from '../../src/RightPanelWidthControl';
import type { BtwEvent, BtwInput } from '../../src/btw';
import type { DesktopBridge, Message, RuntimeEvent } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import '../../src/appearance.css';
import './btw-panel.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const listeners = new Set<(event: RuntimeEvent) => void>();
const active = new Map<string, ReturnType<typeof setInterval>>();
const calls: unknown[] = [];
const emit = (input: BtwInput, value: Partial<BtwEvent>) => {
  for (const listener of listeners) listener({ ...input, type: 'desktop_btw', ...value });
};
window.btwFixture = { calls, emit, active };
declare global { interface Window { btwFixture: { calls: unknown[]; emit: typeof emit; active: typeof active } } }

function Preview() {
  const header = useRef<HTMLElement>(null);
  const app = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(params.get('open') === '1');
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState<'standard' | 'wide'>('standard');
  const [overlay, setOverlay] = useState(innerWidth - 44 < 1120);
  const [session, setSession] = useState('preview-a');
  const [scenario, setScenario] = useState(params.get('state') || 'normal');
  const [performanceVisible, setPerformanceVisible] = useState(params.get('performance') !== '0');
  const [draft, setDraft] = useState('');
  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const [error, setError] = useState('');
  const [request, setRequest] = useState<BtwOpenRequest | undefined>(params.get('demo') === '1'
    ? { id: 1, question: language === 'zh' ? '为什么旁问不会打断正在运行的任务？' : 'Why does a side question leave the main task running?' } : undefined);
  const sequence = useRef(params.get('demo') === '1' ? 1 : 0);
  const scenarioRef = useRef(scenario); scenarioRef.current = scenario;
  const messages: Message[] = [
    { role: 'user', entryId: 'preview-user', content: language === 'zh' ? '检查当前项目的发布流程。' : 'Review the project release process.' },
    { role: 'assistant', entryId: 'preview-assistant', content: [{ type: 'text', text: language === 'zh'
      ? '正在核对**测试和构建配置**，随后会检查安装与升级。\n\n主任务正在运行。\n\n```ts\nconst release = "preview";\n```'
      : 'Checking **tests and build configuration** before reviewing installation and upgrades.\n\nMain task running.\n\n```ts\nconst release = "preview";\n```' }] },
  ];
  const liveMessages: Message[] = [...messages,
    { role: 'assistant', content: [{ type: 'toolCall', id: 'preview-edit', name: 'edit_file', arguments: { path: 'release.ts' } }] },
    { role: 'toolResult', toolCallId: 'preview-edit', toolName: 'edit_file', content: 'Updated release check.',
      details: { patch: '--- release.ts\n+++ release.ts\n@@ -1 +1,2 @@\n-check();\n+await check();\n+await build();\n' } },
  ];
  const reveal = (quote: ChatQuote) => {
    const range = transcript.current && quoteSourceRange(transcript.current, quote);
    if (!range) return false;
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    return true;
  };
  useLayoutEffect(() => {
    const measure = () => {
      app.current?.style.setProperty('--window-bar-height', `${header.current?.getBoundingClientRect().bottom ?? 0}px`);
      setOverlay(innerWidth - 44 < 1120);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (header.current) observer.observe(header.current);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const close = () => { setOpen(false); setExpanded(false); trigger.current?.focus(); };
  const chooseWidth = (value: RightPanelWidth) => {
    if (value !== 'fullscreen') setWidth(value);
    setExpanded(value === 'fullscreen');
  };
  const sendDraft = () => {
    if (!draft.startsWith('/btw')) return;
    setRequest({ id: ++sequence.current, question: draft.slice(4).trim() }); setOpen(true); setDraft('');
  };
  const bridge = useMemo(() => ({
    onEvent: (callback: (event: RuntimeEvent) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    btwAsk: async (input: BtwInput) => {
      calls.push({ type: 'ask', input });
      emit(input, { kind: 'start', model: { id: 'step-3.5', provider: 'step_plan', name: 'Step 3.5 Flash' } });
      const answer = scenarioRef.current === 'rich'
        ? ['### Context snapshot', '', 'A side answer can include code, tables and long values.', '',
          '```typescript', `const requestId = '${'x'.repeat(240)}';`, '```', '',
          '| Request | Runtime | Session | Context | Account | Model | State | Tokens |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |',
          '| independent-request | runtime-current | session-current | read-only-snapshot | applied-account | applied-model | complete | 12,480 |',
          '', `Trace: ${'snapshot-'.repeat(40)}`].join('\n')
        : language === 'zh'
        ? '这里有两个不同的生命周期。\n\n**主任务**继续执行，旁问只是读取当时的上下文快照，单独回答你的问题。\n\n- 不调用工具\n- 不把回答写回主会话\n- 使用当前会话已生效的模型与账户\n\n下一步仍然由主任务决定。'
        : 'There are two independent lifecycles.\n\nThe **main task** continues. A side question reads a context snapshot and answers separately.\n\n- No tools\n- No writes to the main conversation\n- Same applied model and account\n\nThe main task still owns its next step.';
      const chunks = answer.match(/[\s\S]{1,12}/g)!;
      let index = 0;
      const timer = setInterval(() => {
        if (scenarioRef.current === 'error' || scenarioRef.current === 'unsupported-tools') {
          clearInterval(timer); active.delete(input.requestId);
          emit(input, { kind: 'error', ...(scenarioRef.current === 'unsupported-tools' ? { reason: 'tools_unavailable' } : {}) }); return;
        }
        if (index < chunks.length) emit(input, { kind: 'delta', text: chunks[index++] });
        else {
          clearInterval(timer); active.delete(input.requestId);
          emit(input, { kind: 'done', text: answer, usage: { input: 12480, output: 196, cacheRead: 0, cacheWrite: 0 },
            truncated: scenarioRef.current === 'truncated' });
        }
      }, scenarioRef.current === 'slow' ? 180 : scenarioRef.current === 'rich' ? 1 : 35);
      active.set(input.requestId, timer);
    },
    btwCancel: async (input: Omit<BtwInput, 'question'>) => {
      calls.push({ type: 'cancel', input });
      clearInterval(active.get(input.requestId)); active.delete(input.requestId);
      for (const listener of listeners) listener({ ...input, type: 'desktop_btw', kind: 'cancelled' });
    },
    btwClear: async (input: unknown) => { calls.push({ type: 'clear', input }); },
    copyText: async (text: string) => { calls.push({ type: 'copy', text }); },
  }), []);
  // Shared Markdown code-copy controls use the same narrow clipboard bridge.
  window.desktop = bridge as unknown as DesktopBridge;
  return <div className="btw-preview">
    <header ref={header}><img src="/StepCode.svg" alt="" width={25} height={25}/><strong>Step Code</strong>
      <small>{language === 'zh' ? '旁问预览 · 模拟数据' : 'Side question preview · Mock data'}</small>
      <select aria-label="Scenario" value={scenario} onChange={event => setScenario(event.target.value)}>
        {['normal', 'slow', 'error', 'unsupported-tools', 'truncated', 'rich'].map(value => <option key={value}>{value}</option>)}</select>
      <button onClick={() => { setRequest(undefined); setQuotes([]); close(); setSession(value => value === 'preview-a' ? 'preview-b' : 'preview-a'); }}>Switch session</button>
      <button aria-pressed={performanceVisible} onClick={() => setPerformanceVisible(value => !value)}>
        {language === 'zh' ? '性能信息' : 'Performance'}</button>
      <button aria-label="Theme" onClick={() => {
        document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      }}>{document.documentElement.dataset.theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}</button>
    </header>
    <div ref={app} className={`app sidebar-hidden btw-preview-app${expanded ? ' inspector-expanded' : ''}`}>
    <main inert={expanded}><div className="btw-preview-conversation conversation"><div ref={transcript} className="messages">
      <ConversationMessages messages={messages} language={language} busy canEdit={false} openImage={() => {}} edit={async () => {}}
        onError={setError} branch={() => {}} onOpenSubagent={() => {}}/>
    </div></div>
    {error && <p role="alert">{error}</p>}
    <div className="composer-wrap"><ComposerContextBar queued={false}>
    <QuotePreview quotes={quotes} language={language} remove={id => setQuotes(value => value.filter(quote => quote.id !== id))}
      clear={() => setQuotes([])} reveal={reveal}
      annotate={(id, annotation) => setQuotes(value => value.map(quote => quote.id === id ? { ...quote, annotation } : quote))}/>
    <LiveTurnChanges messages={liveMessages} busy language={language}/>
    </ComposerContextBar><div className="composer">
      <ComposerInput label={language === 'zh' ? '消息' : 'Message'} language={language} value={draft} onChange={setDraft} disabled={false} onPaste={() => {}}
        placeholder="/btw ..." onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            sendDraft();
          }
        }}/>
      <div className="composer-tools"><button className="icon-button" aria-label="Attach"><Plus size={17}/></button>
        <span className="spacer"/><span className="btw-preview-label">Step 3.5 Flash</span>
        <button type="button" className="icon-button composer-action-button" data-action="send"
          aria-label={language === 'zh' ? '发送' : 'Send'} disabled={!draft.trim()} onClick={sendDraft}><ComposerActionIcon stop={false}/></button></div>
    </div>{performanceVisible && <PerformanceBar run={null} connected language={language} now={Date.now()}/>}</div></main>
    <BtwPanel key={session} runtimeId="preview-runtime" sessionId={session} language={language} disabled={false}
      modelName="Step 3.5 Flash" bridge={bridge} request={request} open={open} replaced={false}
      overlay={overlay} expanded={expanded} width={width} onWidthChange={chooseWidth}
      onClose={close} onToggleExpanded={() => setExpanded(value => !value)} openImage={() => {}} onRevealQuote={reveal}/>
    <SelectionToolbar root={transcript} scope={session} language={language} enabled={!expanded} onError={setError}
      onQuote={quote => { setQuotes(value => [...value, quote]); return true; }}
      onBtw={quote => { setRequest({ id: ++sequence.current, question: '', quote }); setOpen(true); return true; }}/>
    <QuoteAnnotations root={transcript} quotes={quotes} language={language} scope={session}
      annotate={(id, annotation) => setQuotes(value => value.map(quote => quote.id === id ? { ...quote, annotation } : quote))}
      remove={id => setQuotes(value => value.filter(quote => quote.id !== id))}/>
    {open && <RightPanelHandle panel="btw" language={language} value={expanded ? 'fullscreen' : width}
      standard={440} wide onChange={chooseWidth} onClose={close} onBlocked={() => {}}/>}
    <nav className="right-tool-rail" aria-label={language === 'zh' ? '右侧工具' : 'Right tools'}>
      <button ref={trigger} className="icon-button" aria-label={language === 'zh' ? '旁问' : 'Side question'}
        data-tooltip={language === 'zh' ? '旁问' : 'Side question'} data-tooltip-side="left"
        aria-pressed={open} aria-controls="btw-panel" onClick={() => open ? close() : setOpen(true)}><MessageCircleQuestion size={18}/></button>
    </nav></div><AppTooltip/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
