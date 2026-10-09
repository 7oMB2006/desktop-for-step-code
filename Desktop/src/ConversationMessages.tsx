import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, Dispatch, SetStateAction } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { Bot, Check, ChevronRight, Copy, FilePenLine, FileText, FolderSearch, GitBranch, Globe, MessagesSquare, MessageSquare, Pencil, Search, Send, Terminal, Undo2, Wrench } from 'lucide-react';
import type { Content, Message, PendingMessage } from './contracts';
import { messageRemarkPlugins, messageRehypePlugins } from './markdown-math';
import { backgroundSubagentStates, conversationEntries, messageBlocks, messageText, responsePresentation, toolPresentation, toolSubject, subagentTasks } from './conversation-presentation';
import type { BackgroundSubagentStates, ResponseItem, SubagentTask } from './conversation-presentation';
import { rehypeStreamReveal, updateReveal, REVEAL_DURATION, type RevealState } from './stream-reveal';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { SubagentStatusIcon } from './SubagentStatusIcon';
import { ElapsedLabel } from './ElapsedLabel';
import { quotePresentation } from './chat-quotes';
import { ScrollThumb } from './ConversationScrollThumb';
import { TurnChanges } from './TurnChanges';
import { turnChanges } from './turn-changes';
import { MessageLink } from './MessageLink';
import { ArtifactContext, FileReference, TurnArtifacts } from './TurnArtifacts';
import { localReference, turnOutputPaths } from './turn-artifacts';

type Props = {
  runtimeId?: string;
  messages: Message[]; language: 'zh' | 'en'; busy: boolean; canEdit: boolean;
  openImage: (src: string, name: string, anchor: HTMLElement) => void;
  edit: (message: Message, text: string) => Promise<void>; onError: (message: string) => void;
  branch: (message: Message) => void;
  onLayoutChange?: () => void;
  onOpenSubagent: (task: SubagentTask) => void;
  arrivingUser?: Message | null;
};
type BodyProps = Pick<Props, 'openImage' | 'language' | 'onError' | 'onLayoutChange'>;
type EditState = { entryId: string; text: string; submitting: boolean };

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
export function Text({ text, streaming = false, ...props }: { text: string; streaming?: boolean } & BodyProps) {
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
  return <MarkdownText text={text} language={props.language} openImage={props.openImage} onError={props.onError} plugins={plugins}/>;
}
// Layout-only parent updates must not parse the entire saved Markdown history.
const MarkdownText = memo(function MarkdownText({ text, language, openImage, onError, plugins }: {
  text: string; plugins: ComponentProps<typeof Markdown>['rehypePlugins'];
} & Pick<BodyProps, 'language' | 'openImage' | 'onError'>) {
  return <Markdown skipHtml urlTransform={url => localReference(url) ? url : defaultUrlTransform(url)} remarkPlugins={messageRemarkPlugins} rehypePlugins={plugins}
    components={{
      code: ({ children, className }) => <Code className={className} language={language} onError={onError}>{children}</Code>,
      a: ({ children, href }) => localReference(href) ? <FileReference href={href!}>{children}</FileReference> : <MessageLink href={href} language={language}>{children}</MessageLink>,
      img: ({ src, alt }) => src?.startsWith('data:image/')
        ? <PreviewImage src={src} alt={alt ?? 'Image'} language={language} openImage={openImage}/> : <span>{alt}</span>,
    }}>{text}</Markdown>;
});
function Body({ blocks, ...props }: { blocks: Content[] } & BodyProps) {
  return <div className="message-body">{blocks.map((block, index) =>
    block.type === 'text' ? <UserText key={index} text={block.text ?? ''} {...props}/>
      : block.type === 'image' ? <Image key={index} block={block} {...props}/> : null)}</div>;
}
function UserText({ text, ...props }: { text: string } & BodyProps) {
  const presentation = useMemo(() => quotePresentation(text), [text]);
  if (!presentation) return <Text text={text} {...props}/>;
  const zh = props.language === 'zh';
  return <div className="sent-quote-message">
    <div className="sent-quotes">{presentation.quotes.map(quote =>
      <blockquote className="sent-quote" key={quote.id}>
        <div className="sent-quote-source">{quote.role === 'assistant'
          ? (zh ? '助手' : 'Assistant') : (zh ? '用户' : 'User')}</div>
        <div className="sent-quote-content"><Text text={quote.markdown} {...props}/></div>
      </blockquote>)}</div>
    {presentation.draft && <div className="sent-quote-reply"><Text text={presentation.draft} {...props}/></div>}
  </div>;
}
export function PendingUserMessages({ messages, connected, busy, onRecover, ...props }: {
  messages: PendingMessage[]; connected: boolean; busy: boolean; onRecover: () => Promise<void>;
} & BodyProps) {
  const zh = props.language === 'zh';
  const [recovering, setRecovering] = useState(false);
  const recover = async () => {
    if (recovering) return;
    setRecovering(true);
    try { await onRecover(); }
    catch (error) { props.onError(String(error instanceof Error ? error.message : error)); }
    finally { setRecovering(false); }
  };
  const awaiting = messages.filter(message => message.sending);
  if (!awaiting.length) return null;
  const status = !connected ? (zh ? '未确认接收 · 会话已断开' : 'Unconfirmed · Session disconnected')
    : busy ? (zh ? '已发送 · 待接收' : 'Sent · Awaiting agent')
      : (zh ? '未接收 · 等待继续' : 'Not received · Awaiting continuation');
  return <div className="pending-user-messages" aria-label={zh ? '已发送的待接收消息' : 'Sent messages awaiting delivery'}>
    {awaiting.map(message => <article className="message user pending-user" key={message.id} data-pending-id={message.id}>
      <div className="message-body"><UserText text={message.message} {...props}/></div>
      <footer className={`pending-user-status${connected && busy ? '' : ' is-paused'}`}>
        <span className="working-dot" aria-hidden="true"/><span>{status}</span>
        {message.attachmentCount > 0 && <span>{message.attachmentCount} {zh ? '个附件' : 'attachments'}</span>}
        {connected && !busy && message === awaiting[0] && <button type="button" className="icon-button" disabled={recovering}
          aria-label={zh ? '恢复为待发送' : 'Restore queued drafts'} data-tooltip={zh ? '恢复为待发送' : 'Restore queued drafts'}
          onClick={() => void recover()}><Undo2 size={14}/></button>}
      </footer>
    </article>)}
  </div>;
}
function Timestamp({ value, language }: { value?: number; language: 'zh' | 'en' }) {
  if (!value || !Number.isFinite(value) || Number.isNaN(new Date(value).getTime())) return null;
  return <time className="message-time" dateTime={new Date(value).toISOString()}>
    {new Date(value).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
  </time>;
}
export function Tool({ item, active, ...props }: {
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
function SubagentTaskRow({ task, onOpen, language }: {
  task: SubagentTask; onOpen: (task: SubagentTask) => void; language: 'zh' | 'en';
}) {
  const zh = language === 'zh';
  const state = task.status === 'completed' ? 'done' : task.status === 'running' ? 'running' : task.status === 'queued' ? 'pending' : task.status === 'skipped' ? 'skipped' : task.status === 'aborted' ? 'stopped' : 'failed';
  const summary = task.task.replace(/\s+/gu, ' ').trim();
  const label = zh ? (state === 'pending' ? '待执行' : state === 'skipped' ? '已跳过' : state === 'running' ? '进行中' : state === 'done' ? '已完成' : task.status === 'aborted' ? '已终止' : '已失败')
    : (state === 'pending' ? 'Pending' : state === 'skipped' ? 'Skipped' : state === 'running' ? 'Running' : state === 'done' ? 'Completed' : task.status === 'aborted' ? 'Stopped' : 'Failed');
  return <button type="button" className="lane-row" data-tool-state={state} data-lane-agent={task.agent}
    aria-label={language === 'zh' ? `查看子代理记录: ${label}，${summary}` : `Open subagent record: ${label}, ${summary}`}
    onClick={() => onOpen(task)}>
    <Bot size={14}/>
    <SubagentStatusIcon state={state} language={language}/>
    <span className="lane-type">{task.agent || (zh ? '子代理' : 'Subagent')}</span>
    <span className="lane-summary-text">{summary.slice(0, 80) || (zh ? '无任务描述' : 'No task')}</span>
    <ChevronRight size={13} className="disclosure-chevron"/>
  </button>;
}

function SubagentLane({ item, active, onOpen, background, ...props }: {
  item: Extract<ResponseItem, { type: 'tool' }>; active: boolean;
  background: BackgroundSubagentStates;
  onOpen: (task: SubagentTask) => void;
} & BodyProps) {
  const tasks = useMemo(() => subagentTasks(item.call, item.result, background), [item.call, item.result, background]);
  // A failed dispatch carries no per-task records. Falling back to the planned list here would
  // show that error as lanes stuck on running and hide its output, so the plain failed view wins.
  if (!tasks.length || (item.result?.isError && !tasks.some(task => task.status !== 'running'))) {
    return <Tool item={item} active={active} {...props}/>;
  }
  return <div className="subagent-lanes" data-message-index={item.index}>
    {tasks.map((task, position) => <SubagentTaskRow key={`${item.key}:${position}`} task={task} onOpen={onOpen} language={props.language}/>)}
  </div>;
}

  function Response({ items, active, canBranch, branch, runtimeId, onOpenSubagent, background, ...props }: {
    items: { message: Message; index: number }[]; active: boolean;
    canBranch: boolean; branch: Props['branch'];
    runtimeId?: string;
    background: BackgroundSubagentStates;
    onOpenSubagent: (task: SubagentTask) => void;
  } & BodyProps) {
    const { content, text, lastTextIndex } = responsePresentation(items);
    const changes = useMemo(() => turnChanges(active ? [] : items), [items, active]);
    const outputPaths = useMemo(() => active ? [] : turnOutputPaths(items), [items, active]);
    const finalItem = [...content].reverse().find(item => item.type === 'text');
    const finalProse = finalItem?.type === 'text' ? finalItem.block.text ?? '' : '';
    const zh = props.language === 'zh';
    const stamp = [...items].reverse().find(item => item.message.timestamp)?.message.timestamp;
    return <ArtifactContext.Provider value={{ runtimeId, onError: props.onError }}><article className={`message assistant${active ? ' response-active' : ''}`} data-message-index={items[0].index}>
      <div className="response-content message-body">{content.map((item, position) =>
          item.type === 'tool'
            ? item.call?.name === 'subagent' || item.result?.toolName === 'subagent'
              ? <SubagentLane key={item.key} item={item} active={active} background={background} onOpen={onOpenSubagent} {...props}/>
              : <Tool key={item.key} item={item} active={active} {...props}/>
          : item.type === 'thinking' ? <ThinkingDisclosure key={item.key} index={item.index}
            elapsed={<ElapsedLabel timing={items.find(entry => entry.index === item.index)?.message.desktopTiming?.thinking[item.key.split(':')[1]]}
              active={active} language={props.language}/>}
            autoOpen={active && position > lastTextIndex} label={zh ? '思考' : 'Thinking'} onLayoutChange={props.onLayoutChange}>
            <Text text={item.block.thinking ?? ''} streaming={active && position > lastTextIndex} {...props}/>
          </ThinkingDisclosure>
            : item.type === 'image' ? <Image key={item.key} block={item.block} {...props}/>
              : <div className="response-text" key={item.key} data-message-index={item.index}><Text text={item.block.text ?? ''} streaming={active} {...props}/></div>
      )}</div>
      {!active && <TurnArtifacts text={finalProse} outputPaths={outputPaths} language={props.language}/>}
      {!active && <TurnChanges changes={changes} runtimeId={runtimeId} language={props.language} onError={props.onError}/>}
    {!active && content.length > 0 && <footer className="message-actions assistant-actions">
      <CopyButton text={text} {...props}/>
      <button type="button" className="icon-button branch-action" aria-label={zh ? '从这里分支' : 'Branch from here'}
        data-tooltip={zh ? '从这里分支' : 'Branch from here'}
        disabled={!canBranch || !items.at(-1)?.message.entryId}
        onClick={() => branch(items.at(-1)!.message)}><GitBranch size={15}/></button>
      <ElapsedLabel timing={[...items].reverse().find(item => item.message.desktopTiming)?.message.desktopTiming?.run}
        total language={props.language}/>
      <Timestamp value={stamp} language={props.language}/>
    </footer>}
  </article></ArtifactContext.Provider>;
}
function UserMessage({ message, index, arriving, editState, setEditState, ...props }: {
  message: Message; index: number; arriving: boolean;
  editState: EditState | null; setEditState: Dispatch<SetStateAction<EditState | null>>;
} & Props) {
  const article = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const pencil = useRef<HTMLButtonElement>(null);
  const editing = Boolean(editState && editState.entryId === message.entryId);
  const text = editing ? editState!.text : '';
  const submitting = editing && editState!.submitting;
  const zh = props.language === 'zh';
  const hasImages = messageBlocks(message).some(block => block.type === 'image');
  const cancel = () => { setEditState(null); requestAnimationFrame(() => pencil.current?.focus()); };
  const submit = async () => {
    if (submitting || !props.canEdit || (!text.trim() && !hasImages)) return;
    setEditState(state => state ? { ...state, submitting: true } : state);
    try {
      await props.edit(message, text);
      setEditState(state => state?.entryId === message.entryId ? null : state);
    }
    catch (error) { props.onError(String(error instanceof Error ? error.message : error)); }
    finally { setEditState(state => state && state.entryId === message.entryId ? { ...state, submitting: false } : state); }
  };
  useLayoutEffect(() => {
    if (!editing || !input.current) return;
    input.current.style.height = 'auto';
    input.current.style.height = `${Math.min(280, Math.max(72, input.current.scrollHeight))}px`;
    props.onLayoutChange?.();
  }, [editing, text]);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
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
    {editing ? <div className="user-message-editor">
      <div className="user-edit-input">
      <textarea ref={input} id={inputId} aria-label={zh ? '编辑消息' : 'Edit message'} value={text} disabled={submitting}
        onChange={event => { const value = event.target.value; setEditState(state => state ? { ...state, text: value } : state); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' && !submitting) { event.preventDefault(); cancel(); }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
        }}/>
      <ScrollThumb scrollRef={input} language={props.language} sessionId={message.entryId}
        messageCount={text.length} scrollId={inputId} label={zh ? '编辑消息滚动' : 'Scroll edited message'}
        className="quote-scroll-track user-edit-scroll-track" compact/>
      </div>
      {messageBlocks(message).filter(block => block.type === 'image').map((block, i) => <Image key={i} block={block} {...props}/>)}
      <div className="user-edit-actions">
        <button type="button" disabled={submitting} onClick={cancel}>{zh ? '取消' : 'Cancel'}</button>
        <button type="button" className="primary" disabled={submitting || !props.canEdit || (!text.trim() && !hasImages)}
          onClick={() => void submit()}><Send size={14}/>{zh ? '发送' : 'Send'}</button>
      </div>
    </div> : <>
    <Body blocks={messageBlocks(message)} {...props}/>
    <footer className={`message-actions user-actions${message.desktopSteered ? ' has-steered-marker' : ''}`}>
      <Timestamp value={message.timestamp} language={props.language}/>
      <CopyButton text={messageText(message)} {...props}/>
      <button ref={pencil} type="button" className="icon-button" aria-label={props.language === 'zh' ? '编辑并重做' : 'Edit and retry'}
        data-tooltip={props.language === 'zh' ? '编辑并重做' : 'Edit and retry'}
        disabled={!props.canEdit || !message.entryId || (!messageText(message) && !messageBlocks(message).some(block => block.type === 'image'))}
        onClick={() => setEditState({ entryId: message.entryId!, text: messageText(message), submitting: false })}><Pencil size={15}/></button>
      {message.desktopSteered && <em className="message-steered">{zh ? '已插队引导' : 'Steered'}</em>}
    </footer></>}
  </article>;
}
export function ConversationMessages(props: Props) {
  const [editState, setEditState] = useState<EditState | null>(null);
  const entries = useMemo(() => conversationEntries(props.messages), [props.messages]);
  const background = useMemo(() => backgroundSubagentStates(props.messages), [props.messages]);
  const latestUser = [...props.messages].reverse().find(message => message.role === 'user');
  return <>{entries.map((entry, index) => entry.type === 'user'
    ? <UserMessage key={entry.item.index} message={entry.item.message} index={entry.item.index}
      editState={editState} setEditState={setEditState}
      arriving={entry.item.message === props.arrivingUser} {...props} canEdit={props.canEdit && entry.item.message === latestUser}/>
    : <Response key={entry.index} items={entry.items} active={props.busy && index === entries.length - 1}
      canBranch={props.canEdit && index === entries.length - 1} background={background} {...props}/>)}</>;
}
