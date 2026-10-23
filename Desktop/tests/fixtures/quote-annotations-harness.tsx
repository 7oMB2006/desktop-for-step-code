import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, MessageSquare } from 'lucide-react';
import { QuotePreview } from '../../src/QuotePreview';
import { QuoteAnnotations } from '../../src/QuoteAnnotations';
import { SelectionToolbar } from '../../src/SelectionToolbar';
import { quotePrompt, quotePresentation, MAX_QUOTES, type ChatQuote } from '../../src/chat-quotes';
import { applyTheme } from '../../src/theme';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './quote-annotations.css';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const zh = language === 'zh';
applyTheme(params.get('theme') === 'dark' ? 'dark' : 'light', false);
Object.assign(window, { desktop: { copyText: (text: string) => navigator.clipboard.writeText(text) } });
const storageKey = `quote-annotation-preview:${language}`;
function initialQuotes(): ChatQuote[] {
  try {
    const values: unknown = JSON.parse(params.get('draft') ?? sessionStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is ChatQuote => value && typeof value.id === 'string'
      && typeof value.text === 'string' && typeof value.markdown === 'string'
      && Number.isInteger(value.messageIndex) && Number.isInteger(value.startOffset)
      && Number.isInteger(value.endOffset) && (value.role === 'user' || value.role === 'assistant')
      && (value.annotation === undefined || typeof value.annotation === 'string')).slice(0, MAX_QUOTES);
  } catch { return []; }
}

function Demo() {
  const root = useRef<HTMLDivElement>(null);
  const [quotes, setQuotes] = useState<ChatQuote[]>(initialQuotes);
  const [focusedQuoteId, setFocusedQuoteId] = useState<string | null>(null);
  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(quotes));
    if (params.has('draft')) {
      params.delete('draft');
      history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
    }
  }, [quotes]);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState('');
  const paragraphs = zh ? [
    '会话迁移可以保留原始项目目录，将导入的会话归到对应项目。',
    '导入前展示目标目录与会话数量，用户确认后再开始。目录失效时保留会话，不自动创建空目录。',
    '预览只负责查看原始记录。选择会话和执行导入仍然是两个独立操作。',
  ] : [
    'Session migration can preserve the original project directory and group imported sessions under that project.',
    'Show the destination and session count before importing. Keep sessions whose directories are missing without creating empty folders.',
    'Preview only shows the original records. Selecting sessions and starting the import remain separate actions.',
  ];
  if (params.has('long')) paragraphs[1] = paragraphs[1].repeat(35);
  return <main className="annotation-demo">
    <header><MessageSquare size={18}/><h1>{zh ? '会话迁移' : 'Session migration'}</h1></header>
    <div className="conversation">
      <div ref={root}>
        <article className="message assistant" data-message-index="0">
          {params.has('grouped') && <div className="thinking">已完成思考</div>}
          <div className="message-body response-text" data-message-index={params.has('grouped') ? '1' : undefined}>
          {paragraphs.map(text => <p key={text}>{text}</p>)}
        </div></article>
        {sent.map((text, index) => {
          const parsed = quotePresentation(text);
          return <article className="message user" key={index}><div className="message-body">
            {parsed?.quotes.map((quote, i) => <blockquote className="sent-quote" key={i}>
              <div className="sent-quote-source">{zh ? `引用 ${i + 1}` : `Quote ${i + 1}`}</div>
              <div>{quote.text}</div>
              {quote.annotation && <div className="sent-quote-annotation"><span>{zh ? '批注' : 'Annotation'}</span><div>{quote.annotation}</div></div>}
            </blockquote>)}
            <p>{parsed?.draft ?? text}</p>
          </div></article>;
        })}
      </div>
    </div>
    <footer>
      {error && <p role="alert">{error}</p>}
      <div className="composer-context-bar"><QuotePreview quotes={quotes} language={language}
        onHighlight={setFocusedQuoteId}
        clear={() => setQuotes([])} remove={id => setQuotes(values => values.filter(item => item.id !== id))}
        annotate={(id, annotation) => setQuotes(values => values.map(item => item.id === id ? { ...item, annotation } : item))}
        reveal={() => root.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}/></div>
      <form className="composer" onSubmit={event => {
        event.preventDefault();
        if (!draft.trim() && !quotes.length) return;
        setSent(values => [...values, quotePrompt(draft, quotes, language)]);
        setDraft(''); setQuotes([]);
      }}>
        <textarea className="composer-input" aria-label={zh ? '消息' : 'Message'} value={draft}
          placeholder={zh ? '继续对话' : 'Continue the conversation'} onChange={event => setDraft(event.target.value)}/>
        <button type="submit" className="icon-button" disabled={!draft.trim() && !quotes.length} aria-label={zh ? '发送' : 'Send'}><ArrowUp size={17}/></button>
      </form>
    </footer>
    <QuoteAnnotations root={root} scope="demo" quotes={quotes} language={language}
      remove={id => setQuotes(values => values.filter(item => item.id !== id))}
      focusedId={focusedQuoteId}
      annotate={(id, annotation) => setQuotes(values => values.map(item => item.id === id ? { ...item, annotation } : item))}/>
    <SelectionToolbar root={root} scope="demo" enabled language={language} onError={setError} onQuote={quote => {
      if (quotes.length >= MAX_QUOTES) { setError(zh ? '最多添加 8 段引用' : 'Maximum 8 quotes'); return false; }
      setQuotes(values => [...values, quote]); return true;
    }}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Demo/>);
