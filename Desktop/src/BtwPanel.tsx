import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CircleAlert, Square, Trash2, X } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import { appendBtwQuote, applyBtwEvent, btwPrompt, MAX_BTW_PROMPT_LENGTH, trimBtwHistory, type BtwEvent, type BtwExchange } from './btw';
import type { ChatQuote } from './chat-quotes';
import { QuotePreview } from './QuotePreview';
import { MessageActions, Text } from './ConversationMessages';
import { ElapsedLabel } from './ElapsedLabel';
import { WorkingIndicator } from './WorkingIndicator';
import { ComposerInput } from './ComposerInput';
import { ComposerActionIcon } from './ComposerActionIcon';
import { ComposerContextBar } from './ComposerContextBar';
import { composerInput } from './composer-input';
import { RightPanelExpandButton } from './RightPanelExpandButton';
import { RightPanelWidthControl, type RightPanelWidth } from './RightPanelWidthControl';
import './btw-panel.css';

export interface BtwOpenRequest { id: number; question: string; quote?: ChatQuote }
export function BtwPanel({ runtimeId, sessionId, language, disabled, modelName, request, bridge,
  open, replaced, overlay, expanded, width, onClose, onToggleExpanded, onWidthChange, openImage, onRevealQuote }: {
  runtimeId?: string; sessionId?: string; language: 'zh' | 'en'; disabled: boolean; modelName?: string;
  request?: BtwOpenRequest; bridge?: Pick<DesktopBridge, 'btwAsk' | 'btwCancel' | 'btwClear' | 'onEvent' | 'copyText'>;
  open: boolean; replaced: boolean; overlay: boolean; expanded: boolean; width: 'standard' | 'wide';
  onClose: () => void; onToggleExpanded: () => void; onWidthChange: (value: RightPanelWidth) => void;
  openImage: (src: string, name: string, anchor: HTMLElement) => void;
  onRevealQuote?: (quote: ChatQuote) => boolean;
}) {
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const panel = useRef<HTMLElement>(null);
  const composeArea = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const focusInput = () => composer.current && composerInput(composer.current)?.focus({ preventScroll: true });
  const scroll = useRef<HTMLDivElement>(null);
  const scopeId = useRef(crypto.randomUUID()).current;
  const active = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const follow = useRef(true);
  const focusAfterClear = useRef(false);
  const handledRequest = useRef<number | undefined>(undefined);
  const [present, setPresent] = useState(open);
  const wasOpen = useRef(open);
  const [items, setItems] = useState<BtwExchange[]>([]);
  const [draft, setDraft] = useState('');
  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const running = items.some(item => item.state === 'running');
  const displayedModel = running ? items.at(-1)?.model?.name ?? modelName : modelName;
  const owner = { runtimeId: runtimeId!, sessionId: sessionId!, scopeId };
  const available = Boolean(bridge && runtimeId && sessionId);
  if (open && !present) setPresent(true);
  const cancel = async () => {
    const requestId = active.current;
    if (!requestId || !bridge || !available) return;
    setActing(true);
    try { await bridge.btwCancel({ ...owner, requestId }); }
    catch { if (mounted.current) setError(t('停止尚未确认，请重试。', 'Stop not confirmed. Please retry.')); }
    finally { if (mounted.current) setActing(false); }
  };
  const ask = async (question: string) => {
    if (!question.trim() || active.current || disabled || !available || !bridge) return;
    const prompt = btwPrompt(question, quotes, language);
    if (prompt.length > MAX_BTW_PROMPT_LENGTH) {
      setError(t('旁问与引用合计不能超过 8000 字符，请缩短问题或移除部分引用。',
        'Question and quotes exceed 8,000 characters. Shorten the question or remove a quote.'));
      return;
    }
    const sentQuotes = quotes;
    const requestId = crypto.randomUUID();
    active.current = requestId;
    follow.current = true;
    setError(''); setDraft(''); setQuotes([]);
    setItems(value => trimBtwHistory([...value, { requestId, question: question.trim(), quotes: sentQuotes,
      promptLength: prompt.length, answer: '', state: 'running' as const, startedAt: Date.now() }]));
    try { await bridge.btwAsk({ ...owner, requestId, question: prompt }); }
    catch {
      if (!mounted.current) return;
      // The host confirms cancellation, or retains ownership when the transport is ambiguous.
      setError(t('旁问未能启动。请停止后重试；仍失败时重新连接会话。', 'Could not start. Stop and retry, or reconnect the conversation.'));
      try { await bridge.btwCancel({ ...owner, requestId }); }
      catch { return; }
      if (!mounted.current) return;
      if (active.current === requestId) active.current = undefined;
      setItems(value => value.map(item => item.requestId === requestId && item.state === 'running' ? { ...item, state: 'error', endedAt: Date.now() } : item));
    }
  };
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = bridge?.onEvent(raw => {
      if (raw.type !== 'desktop_btw' || raw.runtimeId !== runtimeId || raw.sessionId !== sessionId || raw.scopeId !== scopeId) return;
      const event = raw as BtwEvent;
      if (active.current !== event.requestId) return;
      if (['done', 'error', 'cancelled'].includes(event.kind)) active.current = undefined;
      setItems(value => trimBtwHistory(value.map(item => applyBtwEvent(item, event))));
    });
    return () => {
      mounted.current = false; unsubscribe?.();
      if (!bridge || !available) return;
      // Exact scope ownership prevents an old panel cleanup from clearing a newly opened one.
      const requestId = active.current;
      void (async () => {
        if (requestId) await bridge.btwCancel({ ...owner, requestId });
        await bridge.btwClear(owner);
      })().catch(() => {});
    };
  }, [bridge, runtimeId, sessionId, scopeId]);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
    return () => clearTimeout(timer);
  }, [open, present]);
  useEffect(() => { if (open) focusInput(); }, [open]);
  useLayoutEffect(() => {
    const area = composeArea.current;
    const mainWrap = panel.current?.closest('.app')?.querySelector<HTMLElement>('main .composer-wrap');
    const mainField = mainWrap?.querySelector<HTMLElement>('.composer');
    if (!area || !mainWrap || !mainField || !open || expanded || replaced) return;
    // Reserve the real main footer, including wrapped or hidden performance metrics.
    const align = () => {
      const bottom = mainWrap.getBoundingClientRect().bottom - mainField.getBoundingClientRect().bottom;
      area.style.setProperty('--btw-composer-bottom', `${Math.max(4, bottom)}px`);
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(mainWrap); observer.observe(mainField);
    return () => { observer.disconnect(); area.style.removeProperty('--btw-composer-bottom'); };
  }, [open, expanded, replaced, present]);
  useLayoutEffect(() => {
    if (!focusAfterClear.current) return;
    if (!open) focusAfterClear.current = false;
    else if (!acting && !disabled) {
      focusAfterClear.current = false;
      focusInput();
    }
  }, [items, acting, disabled, open]);
  useEffect(() => {
    if ((!open && wasOpen.current || disabled) && active.current) void cancel();
    wasOpen.current = open;
  }, [open, disabled]);
  useEffect(() => {
    if (!open || !request || request.id === handledRequest.current || disabled || !available) return;
    handledRequest.current = request.id;
    focusInput();
    if (request.quote) {
      const next = appendBtwQuote(quotes, request.quote, draft, language);
      if (next.error) setError(next.error === 'count'
        ? t('最多添加 8 段引用。', 'Maximum 8 quotes.')
        : t('旁问与引用合计不能超过 8000 字符，请选择较短的片段。', 'Question and quotes exceed 8,000 characters. Select a shorter excerpt.'));
      else { setQuotes(next.quotes); setError(''); }
    } else if (request.question) {
      if (active.current) setDraft(request.question);
      else void ask(request.question);
    }
  }, [request, disabled, available, open]);
  useLayoutEffect(() => {
    if (open && follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [items, open]);
  const clear = async () => {
    if (!bridge || !available || active.current) return;
    setActing(true);
    try { await bridge.btwClear(owner); if (mounted.current) { focusAfterClear.current = true; setItems([]); setQuotes([]); setError(''); } }
    catch { if (mounted.current) setError(t('清空失败，请重试。', 'Could not clear. Please retry.')); }
    finally { if (mounted.current) setActing(false); }
  };
  const revealQuote = (quote: ChatQuote) => {
    if (!onRevealQuote?.(quote)) setError(t('当前上下文中找不到这段原文，引用内容仍保留。', 'Source is not in the current context. The quoted text is still available.'));
  };
  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    event.stopPropagation(); event.preventDefault();
    if (expanded) {
      onToggleExpanded();
      panel.current?.querySelector<HTMLButtonElement>('.right-panel-header button[aria-pressed]')?.focus();
    } else onClose();
  };
  return <div className={`btw-track${open ? ' is-open' : ''}${width === 'wide' ? ' is-wide' : ''}${overlay ? ' is-overlay' : ''}${replaced ? ' is-replaced' : ''}`}>
    <aside ref={panel} id="btw-panel" aria-label={t('旁问', 'Side question')} aria-hidden={!open} inert={!open}
      className={`btw-panel right-inspector-surface${expanded ? ' is-expanded' : ''}${open ? '' : ' is-closing'}`}
      style={{ visibility: present && !replaced ? undefined : 'hidden' }}
      onKeyDown={handleEscape}>
      <header className="right-panel-header"><h2>{t('旁问', 'Side question')}</h2>
        <button type="button" className="icon-button" aria-label={t('清空旁问', 'Clear side questions')}
          data-tooltip={t('清空旁问', 'Clear side questions')} disabled={(!items.length && !quotes.length) || running || acting}
          onClick={() => void clear()}><Trash2 size={15}/></button>
        <RightPanelWidthControl panel="btw" language={language} value={expanded ? 'fullscreen' : width} onChange={onWidthChange}/>
        <RightPanelExpandButton expanded={expanded} language={language} onToggle={onToggleExpanded}/>
        <button type="button" className="icon-button" aria-label={t('关闭旁问', 'Close side question')}
          data-tooltip={t('关闭旁问', 'Close side question')} onClick={onClose}><X size={17}/></button>
      </header>
      <div className="btw-session"><span className="btw-model" title={displayedModel}>{displayedModel}</span>
        <span>{running ? t('正在回答', 'Answering') : t('临时旁问', 'Temporary side questions')}</span></div>
      <div ref={scroll} className="btw-history" role="log" aria-label={t('临时旁问记录', 'Temporary side questions')}
        onScroll={event => { const el = event.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 36; }}>
        {!items.length && <p className="btw-empty">{t('就当前任务问个问题', 'Ask about the current task')}</p>}
        {items.map(item => <article key={item.requestId} className="btw-exchange" data-state={item.state}>
          {!!item.quotes?.length && <div className="btw-sent-quotes">{item.quotes.map((quote, index) =>
            <blockquote key={quote.id}>
              <button type="button" className="btw-quote-source" onClick={() => revealQuote(quote)}
                aria-label={t(`查看引用 ${index + 1} 的原文`, `Show source of quote ${index + 1}`)}
                data-tooltip={t('查看原文', 'Show source')}>{t(`引用 ${index + 1}`, `Quote ${index + 1}`)}
                <span> · {quote.role === 'assistant' ? t('助手', 'Assistant') : t('用户', 'User')}</span></button>
              <p>{quote.text}</p>
            </blockquote>)}</div>}
          <div className="btw-request message user"><div className="message-body"><p className="btw-question">{item.question}</p></div></div>
          <div className={`btw-response message assistant${item.state === 'running' ? ' response-active' : ''}`}>
            {item.answer && <div className="response-content message-body"><div className="btw-answer response-text">
              <Text text={item.answer} language={language} streaming={item.state === 'running'} openImage={openImage} onError={setError}/>
            </div></div>}
            {item.state === 'running' ? <div className="btw-outcome working" role="status">
              <WorkingIndicator mode="responding" language={language}>{t('正在回答', 'Answering')}</WorkingIndicator>
              <ElapsedLabel timing={item.startedAt === undefined ? undefined : { startedAt: item.startedAt }} active language={language}/>
            </div> : <>
              {(item.state !== 'done' || item.truncated) && <div className="btw-outcome" role="status">
                {item.state === 'cancelled' ? <Square size={12}/> : <CircleAlert size={14}/>}
                <span>{item.state === 'error' ? t('回答失败，请重试', 'Answer failed. Please retry')
                  : item.state === 'cancelled' ? t('已停止', 'Stopped')
                  : t('已达到回答长度上限', 'Response length limit reached')}</span>
              </div>}
              <div className="btw-response-footer">
                {item.answer && <MessageActions text={item.answer} language={language} onError={setError}
                  copyLabel={t('复制旁问回答', 'Copy side answer')} timestamp={item.endedAt}
                  timing={item.startedAt === undefined ? undefined : { startedAt: item.startedAt, endedAt: item.endedAt }}/>}
                {item.usage && <span className="btw-tokens"
                  data-tooltip={t('输入（含缓存）／输出 Token；暂未计入本地用量总览', 'Input (including cache) / output Tokens; not yet included in local usage totals')}>
                  ↑ {(item.usage.input + item.usage.cacheRead + item.usage.cacheWrite).toLocaleString()} · ↓ {item.usage.output.toLocaleString()}
                </span>}
              </div>
            </>}
          </div>
        </article>)}
      </div>
      <div ref={composeArea} className="btw-compose">
        {error && <p className="btw-error" role="alert">{error}</p>}
        {present && <ComposerContextBar queued={false}>
        <QuotePreview quotes={quotes} language={language} active={open && !replaced}
          clear={() => setQuotes([])} remove={id => {
            setQuotes(value => value.filter(quote => quote.id !== id)); focusInput();
          }}
          annotate={(id, annotation) => setQuotes(value => value.map(quote => quote.id === id ? { ...quote, annotation } : quote))}
          reveal={revealQuote}/>
        </ComposerContextBar>}
        {present && <div ref={composer} className="composer btw-input-row">
          <ComposerInput label={t('旁问内容', 'Side question text')} language={language} value={draft}
            placeholder={t('问个问题…', 'Ask a question…')} disabled={disabled || acting}
            onChange={setDraft} onPaste={() => {}}
            onKeyDown={event => {
              if (event.key === 'Escape') { handleEscape(event); return; }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !event.repeat) {
                event.preventDefault(); if (!running && !acting) void ask(draft);
              }
            }}/>
          <div className="composer-tools"><div className="spacer"/><button type="button" className="icon-button composer-action-button"
            data-action={running ? 'stop' : 'send'} aria-label={running ? t('停止旁问', 'Stop side question') : t('发送旁问', 'Send side question')}
            data-tooltip={running ? t('停止旁问', 'Stop side question') : t('发送旁问', 'Send side question')}
            disabled={disabled || acting || (!running && !draft.trim())}
            onClick={() => void (running ? cancel() : ask(draft))}><ComposerActionIcon stop={running}/></button></div>
        </div>}
      </div>
    </aside>
  </div>;
}
