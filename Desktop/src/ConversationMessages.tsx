import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import Markdown from 'react-markdown';
import { Check, ChevronRight, Copy, FilePenLine, FileText, FolderSearch, GitBranch, Globe, Pencil, Search, Terminal, Wrench } from 'lucide-react';
import type { Content, Message } from './contracts';
import { messageRemarkPlugins, messageRehypePlugins } from './markdown-math';
import { conversationEntries, messageBlocks, messageText, responsePresentation, toolPresentation, toolSubject } from './conversation-presentation';
import type { ResponseItem } from './conversation-presentation';

type Props = {
  messages: Message[]; language: 'zh' | 'en'; busy: boolean; canEdit: boolean;
  openImage: (src: string, name: string, anchor: HTMLElement) => void;
  edit: (message: Message) => void; onError: (message: string) => void;
};
type BodyProps = Pick<Props, 'openImage' | 'language' | 'onError'>;

function CopyButton({ text, getText, language, onError }: { text: string; getText?: () => string } & Pick<Props, 'language' | 'onError'>) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getText ? getText() : text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch (error) { onError(String(error instanceof Error ? error.message : error)); }
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
function Text({ text, ...props }: { text: string } & BodyProps) {
  return <Markdown skipHtml remarkPlugins={messageRemarkPlugins} rehypePlugins={messageRehypePlugins}
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
    search: Search, folder: FolderSearch, web: Globe, other: Wrench }[kind];
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
          : item.type === 'thinking' ? <details className="thinking" key={item.key} data-message-index={item.index} open={active && position > lastTextIndex}>
            <summary><ChevronRight size={13} className="disclosure-chevron"/>{zh ? '思考' : 'Thinking'}</summary>
            <Text text={item.block.thinking ?? ''} {...props}/>
          </details>
            : item.type === 'image' ? <Image key={item.key} block={item.block} {...props}/>
              : <div className="response-text" key={item.key} data-message-index={item.index}><Text text={item.block.text ?? ''} {...props}/></div>
      )}</div>
    {!active && content.length > 0 && <footer className="message-actions assistant-actions">
      <CopyButton text={text} {...props}/>
      <button type="button" className="icon-button branch-placeholder" aria-label={zh ? '分支（暂未开放）' : 'Branch (unavailable)'} disabled><GitBranch size={15}/></button>
      <Timestamp value={stamp} language={props.language}/>
    </footer>}
  </article>;
}
export function ConversationMessages(props: Props) {
  const entries = useMemo(() => conversationEntries(props.messages), [props.messages]);
  return <>{entries.map((entry, index) => entry.type === 'user'
    ? <article className="message user" data-message-index={entry.item.index} key={entry.item.index}>
      <Body blocks={messageBlocks(entry.item.message)} {...props}/>
      <footer className="message-actions user-actions">
        <Timestamp value={entry.item.message.timestamp} language={props.language}/>
        <CopyButton text={messageText(entry.item.message)} {...props}/>
        <button type="button" className="icon-button" aria-label={props.language === 'zh' ? '编辑' : 'Edit'}
          disabled={!props.canEdit || !messageText(entry.item.message)} onClick={() => props.edit(entry.item.message)}><Pencil size={15}/></button>
      </footer>
    </article>
    : <Response key={entry.index} items={entry.items} active={props.busy && index === entries.length - 1} {...props}/>)}</>;
}
