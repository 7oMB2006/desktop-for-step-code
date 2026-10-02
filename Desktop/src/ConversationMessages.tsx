import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import Markdown from 'react-markdown';
import { Check, ChevronRight, Copy, FilePenLine, FileText, FolderSearch, GitBranch, Globe, MessagesSquare, MessageSquare, Pencil, Search, Send, Terminal, Wrench } from 'lucide-react';
import type { Content, Message } from './contracts';
import { messageRemarkPlugins, messageRehypePlugins } from './markdown-math';
import { conversationEntries, messageBlocks, messageText, responsePresentation, toolPresentation, toolSubject } from './conversation-presentation';
import type { ResponseItem } from './conversation-presentation';
import { rehypeStreamReveal, updateReveal, REVEAL_DURATION, type RevealState } from './stream-reveal';
import { ThinkingDisclosure } from './ThinkingDisclosure';

type Props = {
  messages: Message[]; language: 'zh' | 'en'; busy: boolean; canEdit: boolean;
  openImage: (src: string, name: string, anchor: HTMLElement) => void;
  edit: (message: Message) => void; onError: (message: string) => void;
  onLayoutChange?: () => void;
  arrivingUser?: Message | null;
};
type BodyProps = Pick<Props, 'openImage' | 'language' | 'onError' | 'onLayoutChange'>;

function CopyButton({ text, getText, language, onError }: { text: string; getText?: () => string } & Pick<Props, 'language' | 'onError'>) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      if (!window.desktop) throw new Error('Desktop clipboard unavailable');
      await window.desktop.copyText(getText ? getText() : text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      clearTimeout(timer.current);
      setCopied(false);
      onError(String(error instanceof Error ? error.message : error));
    }
  };
  return <button type="button" className="icon-button" aria-label={language === 'zh' ? '复制' : 'Copy'}
    disabled={!text} onClick={() => void copy()}>{copied ? <Check size={15}/> : <Copy size={15}/>}</button>;
}

function Image({ block, openImage, language }: { block: Content } & Omit<BodyProps, 'onError'>) {
  if (!block.data || !block.mimeType) return null;
  return <PreviewImage src={`data:${block.mimeType};base64,${block.data}`} alt={language === 'zh' ? '图片' : 'Image'}
    openImage={openImage} language={language}/>;
}
function PreviewImage({ src, alt, openImage, language }: {
  src: string; alt: string;
} & Omit<BodyProps, 'onError'>) {
  return <img src={src} alt={alt} className="attachment previewable-image" role="button" tabIndex={0}
    aria-label={`${language === 'zh' ? '预览' : 'Preview'} ${alt}`}
    onClick={event => openImage(src, alt, event.currentTarget)}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); openImage(src, alt, event.currentTarget);
    } }}/>;
}
function Code({ children, className, language, onError }: Omit<ComponentProps<'code'>, 'onError'> & Pick<Props, 'language' | 'onError'>) {
  const code = useRef<HTMLElement>(null);
  if (!className) return <code>{children}</code>;
  return <span className="code-block"><span className="code-header">
    {className.replace('hljs language-', '').replace('language-', '')}
    <CopyButton text={String(children)} getText={() => code.current?.textContent ?? ''} language={language} onError={onError}/>
  </span><code ref={code} className={className}>{children}</code></span>;
}
function Text({ text, streaming = false, ...props }: { text: string; streaming?: boolean } & BodyProps) {
  const [reveal, setReveal] = useState<RevealState>({ text: '', active: false, nextId: 0, batches: [] });
  if (text !== reveal.text || streaming !== reveal.active) {
    setReveal(updateReveal(reveal, text, streaming, performance.now()));
  }
  useEffect(() => {
    if (!reveal.batches.length) return;
    const timer = setTimeout(() => setReveal(previous => updateReveal(previous, previous.text, previous.active, performance.now())), REVEAL_DURATION);
    return () => clearTimeout(timer);
  }, [reveal.batches]);
  const plugins = useMemo<ComponentProps<typeof Markdown>['rehypePlugins']>(() => reveal.batches.length
    ? [...messageRehypePlugins!, [rehypeStreamReveal, { batches: reveal.batches }]]
    : messageRehypePlugins, [reveal.batches]);
  return <Markdown skipHtml remarkPlugins={messageRemarkPlugins} rehypePlugins={plugins}
    components={{
      code: ({ children, className }) => <Code className={className} language={props.language} onError={props.onError}>{children}</Code>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
      img: ({ src, alt }) => src?.startsWith('data:image/')
        ? <PreviewImage src={src} alt={alt ?? 'Image'} {...props}/> : <span>{alt}</span>,
    }}>{text}</Markdown>;
}
function Body({ blocks, ...props }: { blocks: Content[] } & BodyProps) {
  return <div className="message-body">{blocks.map((block, index) =>
    block.type === 'text' ? <Text key={index} text={block.text ?? ''} {...props}/>
      : block.type === 'image' ? <Image key={index} block={block} {...props}/> : null)}</div>;
}
function Timestamp({ value, language }: { value?: number; language: 'zh' | 'en' }) {
  if (!value || !Number.isFinite(value) || Number.isNaN(new Date(value).getTime())) return null;
  return <time className="message-time" dateTime={new Date(value).toISOString()}>
    {new Date(value).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
  </time>;
}
function Tool({ item, active, ...props }: {
  item: Extract<ResponseItem, { type: 'tool' }>; active: boolean;
} & BodyProps) {
  const zh = props.language === 'zh';
  const name = item.call?.name ?? item.result?.toolName ?? (zh ? '工具' : 'Tool');
  const subject = toolSubject(item.call);
  const { state, kind, label, status } = toolPresentation(name, item.result, active, props.language);
  const Icon = { command: Terminal, read: FileText, write: FilePenLine, edit: FilePenLine,
    search: Search, folder: FolderSearch, web: Globe, sessions: MessagesSquare, 'session-read': MessageSquare, 'session-send': Send, other: Wrench }[kind];
  return <details className={`process-tool ${state}`} data-message-index={item.index} data-tool-state={state}>
    <summary><Icon size={14}/>
      <span className="process-tool-label">{label}<span className="tool-summary-shimmer" data-label={label} aria-hidden="true"/></span>
      <ChevronRight size={13} className="disclosure-chevron"/>
    </summary>
    <div className="process-tool-content">
      <div className="process-tool-meta"><code>{name}</code>{subject && <span className="process-tool-subject">{subject}</span>}</div>
      {item.call && <details className="tool-input"><summary>{zh ? '输入' : 'Input'}</summary><pre>{JSON.stringify(item.call.arguments ?? {}, null, 2)}</pre></details>}
      {item.result ? <details className="tool-output" open><summary>{zh ? '结果' : 'Result'}</summary>
        {messageText(item.result) ? <pre>{messageText(item.result)}</pre>
          : !messageBlocks(item.result).some(block => block.type === 'image') && <p className="process-pending">{zh ? '无输出' : 'No output'}</p>}
        {messageBlocks(item.result).filter(block => block.type === 'image').map((block, index) => <Image key={index} block={block} {...props}/>)}
      </details> : null}
      <div className="process-tool-status">{state === 'done' && <Check size={12}/>}<span>{status}</span></div>
    </div>
  </details>;
}
function Response({ items, active, ...props }: {
  items: { message: Message; index: number }[]; active: boolean;
} & BodyProps) {
  const { content, text, lastTextIndex } = responsePresentation(items);
  const zh = props.language === 'zh';
  const stamp = [...items].reverse().find(item => item.message.timestamp)?.message.timestamp;
  return <article className={`message assistant${active ? ' response-active' : ''}`} data-message-index={items[0].index}>
    <div className="response-content message-body">{content.map((item, position) =>
        item.type === 'tool' ? <Tool key={item.key} item={item} active={active} {...props}/>
          : item.type === 'thinking' ? <ThinkingDisclosure key={item.key} index={item.index}
            autoOpen={active && position > lastTextIndex} label={zh ? '思考' : 'Thinking'} onLayoutChange={props.onLayoutChange}>
            <Text text={item.block.thinking ?? ''} streaming={active && position > lastTextIndex} {...props}/>
          </ThinkingDisclosure>
            : item.type === 'image' ? <Image key={item.key} block={item.block} {...props}/>
              : <div className="response-text" key={item.key} data-message-index={item.index}><Text text={item.block.text ?? ''} streaming={active} {...props}/></div>
      )}</div>
    {!active && content.length > 0 && <footer className="message-actions assistant-actions">
      <CopyButton text={text} {...props}/>
      <button type="button" className="icon-button branch-placeholder" aria-label={zh ? '分支（暂未开放）' : 'Branch (unavailable)'} disabled><GitBranch size={15}/></button>
      <Timestamp value={stamp} language={props.language}/>
    </footer>}
  </article>;
}
function UserMessage({ message, index, arriving, ...props }: {
  message: Message; index: number; arriving: boolean;
} & Props) {
  const article = useRef<HTMLElement>(null);
  const played = useRef(false);
  useLayoutEffect(() => {
    if (!arriving || played.current) return;
    played.current = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = article.current!.animate(
      [{ opacity: .45, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 160, easing: 'cubic-bezier(.215, .61, .355, 1)' },
    );
    return () => animation.cancel();
  }, [arriving]);
  return <article ref={article} className="message user" data-message-index={index}>
    <Body blocks={messageBlocks(message)} {...props}/>
    <footer className="message-actions user-actions">
      <Timestamp value={message.timestamp} language={props.language}/>
      <CopyButton text={messageText(message)} {...props}/>
      <button type="button" className="icon-button" aria-label={props.language === 'zh' ? '编辑' : 'Edit'}
        disabled={!props.canEdit || !messageText(message)} onClick={() => props.edit(message)}><Pencil size={15}/></button>
    </footer>
  </article>;
}
export function ConversationMessages(props: Props) {
  const entries = useMemo(() => conversationEntries(props.messages), [props.messages]);
  return <>{entries.map((entry, index) => entry.type === 'user'
    ? <UserMessage key={entry.item.index} message={entry.item.message} index={entry.item.index}
      arriving={entry.item.message === props.arrivingUser} {...props}/>
    : <Response key={entry.index} items={entry.items} active={props.busy && index === entries.length - 1} {...props}/>)}</>;
}
