import { createContext, memo, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CommandCatalog, CommandReference } from './CommandReference';
import { remarkCommandReferences } from './command-references';
import type { ComposerCommand } from './composer-commands';
import type { ComponentProps, Dispatch, ReactNode, SetStateAction } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { ArrowLeft, ArrowRight, ArrowRightLeft, Bot, Brain, Check, CircleAlert, Copy, FilePenLine, FileText, FolderSearch, GitBranch, Globe, MessagesSquare, MessageSquare, Pencil, Search, Send, Terminal, Undo2, Wrench } from 'lucide-react';
import type { Content, Message, ModelChange, PendingMessage } from './contracts';
import { messageRemarkPlugins, messageContentRehypePlugins } from './markdown-math';
import { pendingCodeClassName, useViewportCodeHighlight } from './useViewportCodeHighlight';
import type { Element } from 'hast';
import { redactSensitiveText } from './subagent-redact';
import { backgroundSubagentStates, createConversationEntriesReader, messageBlocks, messageText, projectBackgroundSubagentStates, responsePresentation, toolPresentation, toolSubject, subagentTasks } from './conversation-presentation';
import { CompletionReviewNote } from './CompletionReviewNote';
import type { BackgroundLaneActivity } from './conversation-presentation';
import type { BackgroundSubagentStates, ResponseItem, SubagentDisplayTask } from './conversation-presentation';
import { rehypeStreamReveal, updateReveal, REVEAL_DURATION, type RevealState } from './stream-reveal';
import { blockRevealBatches, createMarkdownBlockReader, remarkPreparedBlock, sameRevealBatches } from './markdown-blocks';
import type { MarkdownBlock } from './markdown-blocks';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { ProcessRowLabel } from './ProcessRowLabel';
import { DisclosureChevron } from './DisclosureChevron';
import { SubagentStatusIcon } from './SubagentStatusIcon';
import { WorkflowBlock } from './WorkflowView';
import { workflowsFromMessages } from './workflow-state';
import { ElapsedLabel } from './ElapsedLabel';
import { quotePresentation } from './chat-quotes';
import { ScrollThumb } from './ConversationScrollThumb';
import { TurnChanges } from './TurnChanges';
import { turnChanges } from './turn-changes';
import { MessageLink } from './MessageLink';
import { ArtifactContext, FileReference, TurnArtifacts } from './TurnArtifacts';
import { localReference, turnOutputPaths } from './turn-artifacts';
import { isUserMessage } from './user-message';
import { approvedPlan, planExecutionResponses } from './plan-execution';
import type { ApprovedPlan, PlanExecutionState } from './plan-execution';
import { PlanExecution } from './PlanExecution';
import { normalizeInterfaceSettings, type InterfacePreferences } from './interface-presets';
import { groupConsecutiveTools, toolGroupLabel, type ToolItem } from './tool-groups';
import { groupProcesses, liveThinkingKey, processGroupSummary, thinkingPreview, type ProcessGroup as ProcessGroupData } from './process-groups';
import './tool-groups.css';
import { QuestionTool } from './QuestionTool';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import { CronMessage } from './CronMessage';
import { cronMessage } from './cron-message';
import { AutoResumeMessage } from './AutoResumeMessage';
import { searchTextMatch, type SearchTextTarget } from './fulltext-search';
import './auto-resume-message.css';
import { incompleteResponse } from './incomplete-response';
import type { PreparedMarkdown } from './markdown-parser';
import { useConversationDisclosure } from './ConversationDisclosureState';

type Props = {
  preparedMarkdown?: PreparedMarkdown;
  interfaceSettings?: InterfacePreferences;
  interfaceRevision?: number;
  runtimeId?: string;
  awaitingToolCalls?: string[];
  modelChanges?: ModelChange[];
  messages: Message[]; language: 'zh' | 'en'; busy: boolean; canEdit: boolean;
  backgroundActivity?: BackgroundLaneActivity;
  openImage: (src: string, name: string, anchor: HTMLElement) => void;
  edit: (message: Message, text: string) => Promise<void>; onError: (message: string) => void;
  branch: (message: Message) => void;
  onLayoutChange?: () => void;
  onOpenSubagent: (task: SubagentDisplayTask) => void;
  onOpenWorkflow?: (id: string) => void;
  arrivingUser?: Message | null;
  settledStatus?: ReactNode;
  completedStatus?: { responseIndex: number; content: ReactNode };
  searchTarget?: SearchTextTarget;
};
type BodyProps = Pick<Props, 'openImage' | 'language' | 'onError' | 'onLayoutChange' | 'awaitingToolCalls' | 'interfaceSettings' | 'searchTarget'> & { disclosureReset?: string };
type EditState = { entryId: string; text: string; submitting: boolean };
const MessageTimeFormat = createContext<Intl.DateTimeFormat | undefined>(undefined);
const MarkdownPreparation = createContext<PreparedMarkdown | undefined>(undefined);

function useMessageTimeFormat(language: Props['language']) {
  const shared = useContext(MessageTimeFormat);
  const timeZone = shared ? undefined : new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useMemo(() => shared ?? new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-GB',
    { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }), [shared, language, timeZone]);
}

function CopyButton({ text, getText, language, onError, label }: { text: string; getText?: () => string; label?: string } & Pick<Props, 'language' | 'onError'>) {
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
  return <button type="button" className="icon-button copy-button" data-copied={copied} aria-label={label ?? (language === 'zh' ? '复制' : 'Copy')}
    data-tooltip={label ?? (language === 'zh' ? '复制' : 'Copy')}
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
  return <img src={src} alt={alt} loading="lazy" decoding="async" className="attachment previewable-image" role="button" tabIndex={0}
    aria-label={`${language === 'zh' ? '预览' : 'Preview'} ${alt}`}
    onClick={event => openImage(src, alt, event.currentTarget)}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); openImage(src, alt, event.currentTarget);
    } }}/>;
}
function Code({ children, className, node, language, onError }: Omit<ComponentProps<'code'>, 'onError' | 'className'> &
  Pick<Props, 'language' | 'onError'> & { node?: Element; className: string }) {
  const code = useRef<HTMLElement>(null);
  const text = node?.children.every(child => child.type === 'text') ? node.children.map(child => child.value).join('') : undefined;
  const highlighted = useViewportCodeHighlight(code, text, className);
  return <span className="code-block"><span className="code-header">
    {className.replace('hljs language-', '').replace('language-', '')}
    <CopyButton text={String(children)} getText={() => code.current?.textContent ?? ''} language={language} onError={onError}/>
  </span><code ref={code} className={highlighted?.className ?? pendingCodeClassName(className)}
    data-code-highlight={highlighted ? 'ready' : 'pending'}>{highlighted ? highlighted.children : children}</code></span>;
}
export function Text({ text, ...props }: { text: string; streaming?: boolean; commands?: ComposerCommand[] } & BodyProps) {
  return text.length > 32_768 ? <LargeText text={text} {...props}/> : <RevealedText text={text} {...props}/>;
}
function LargeText({ text, language, onError, searchTarget }: { text: string } & Pick<BodyProps, 'language' | 'onError' | 'searchTarget'>) {
  const size = 16_384;
  const match = useMemo(() => searchTarget ? searchTextMatch(text, searchTarget.text) : null, [text, searchTarget?.text]);
  const request = searchTarget ? JSON.stringify([searchTarget.entryId, searchTarget.text, searchTarget.requestId]) : undefined;
  const [position, setPosition] = useState<{ request?: string; page: number }>({ page: 0 });
  // Reveal a search page once; snapshots must not undo subsequent manual paging.
  if (position.request !== request) setPosition({ request, page: match ? Math.floor(match.index / size) : position.page });
  const pages = Math.ceil(text.length / size);
  const current = Math.min(position.page, pages - 1);
  const zh = language === 'zh';
  const boundary = (offset: number) => offset > 0 && /[\uDC00-\uDFFF]/u.test(text[offset] ?? '') ? offset - 1 : offset;
  const start = boundary(current * size);
  const end = boundary((current + 1) * size);
  const matchEnd = match && match.index >= start && match.index < end ? match.index + match[0].length : end;
  return <div className="large-message-text" data-page={current + 1}>
    <div className="large-message-controls">
      <button className="icon-button" type="button" aria-label={zh ? '上一段' : 'Previous section'}
        data-tooltip={zh ? '上一段' : 'Previous section'}
        disabled={current === 0} onClick={() => setPosition({ request, page: current - 1 })}><ArrowLeft size={14}/></button>
      <span>{current + 1} / {pages}</span>
      <button className="icon-button" type="button" aria-label={zh ? '下一段' : 'Next section'}
        data-tooltip={zh ? '下一段' : 'Next section'}
        disabled={current === pages - 1} onClick={() => setPosition({ request, page: current + 1 })}><ArrowRight size={14}/></button>
      <CopyButton text={text} language={language} onError={onError}/>
    </div>
    <pre>{text.slice(start, Math.max(end, matchEnd))}</pre>
  </div>;
}
function RevealedText({ text, streaming = false, commands, ...props }: { text: string; streaming?: boolean; commands?: ComposerCommand[] } & BodyProps) {
  const [reveal, setReveal] = useState<RevealState>({ text: '', active: false, nextId: 0, batches: [] });
  const [segmented, setSegmented] = useState(streaming);
  if (streaming && !segmented) setSegmented(true);
  if (text !== reveal.text || streaming !== reveal.active) {
    setReveal(updateReveal(reveal, text, streaming, performance.now()));
  }
  useEffect(() => {
    if (!reveal.batches.length) return;
    const timer = setTimeout(() => setReveal(previous => updateReveal(previous, previous.text, previous.active, performance.now())), REVEAL_DURATION);
    return () => clearTimeout(timer);
  }, [reveal.batches]);
  const plugins = useMemo<ComponentProps<typeof Markdown>['rehypePlugins']>(() => reveal.batches.length
    ? [...messageContentRehypePlugins!, [rehypeStreamReveal, { batches: reveal.batches }]]
    : messageContentRehypePlugins, [reveal.batches]);
  const readBlocks = useMemo(createMarkdownBlockReader, []);
  const blocks = useMemo(() => segmented ? readBlocks(text) : undefined, [segmented, text, readBlocks]);
  if (blocks) return <>{blocks.map(block => <MarkdownBlockText key={block.key} block={block}
    batches={blockRevealBatches(block, reveal.batches)} language={props.language}
    openImage={props.openImage} onError={props.onError} commands={commands}/>)}</>;
  return <MarkdownText text={text} language={props.language} openImage={props.openImage} onError={props.onError} plugins={plugins} commands={commands}/>;
}
type BlockTextProps = { block: MarkdownBlock; batches: RevealState['batches']; commands?: ComposerCommand[] }
  & Pick<BodyProps, 'language' | 'openImage' | 'onError'>;
const MarkdownBlockText = memo(function MarkdownBlockText({ block, batches, ...props }: BlockTextProps) {
  const prepared = useMemo(() => [remarkPreparedBlock, block.tree] as [typeof remarkPreparedBlock, typeof block.tree], [block]);
  const plugins = useMemo<ComponentProps<typeof Markdown>['rehypePlugins']>(() => batches.length
    ? [...messageContentRehypePlugins!, [rehypeStreamReveal, { batches }]] : messageContentRehypePlugins, [batches]);
  return <MarkdownText text={block.text} prepared={prepared} plugins={plugins} {...props}/>;
}, (left, right) => left.block === right.block && left.commands === right.commands && left.language === right.language
  && left.openImage === right.openImage && left.onError === right.onError && sameRevealBatches(left.batches, right.batches));
// Layout-only parent updates must not parse the entire saved Markdown history.
const MarkdownText = memo(function MarkdownText({ text, language, openImage, onError, plugins, commands, prepared }: {
  text: string; plugins: ComponentProps<typeof Markdown>['rehypePlugins']; commands?: ComposerCommand[];
  prepared?: [typeof remarkPreparedBlock, MarkdownBlock['tree']];
} & Pick<BodyProps, 'language' | 'openImage' | 'onError'>) {
  const trees = useContext(MarkdownPreparation);
  const tree = trees?.get(text);
  const source = useMemo<typeof prepared>(() => prepared ?? (tree ? [remarkPreparedBlock, tree] : undefined), [prepared, tree]);
  const remarkPlugins = useMemo<ComponentProps<typeof Markdown>['remarkPlugins']>(() => [
    ...(source ? [source] : []), ...messageRemarkPlugins!,
    ...(commands ? [[remarkCommandReferences, commands] as [typeof remarkCommandReferences, ComposerCommand[]]] : []),
  ], [commands, source]);
  const components = useMemo<ComponentProps<typeof Markdown>['components']>(() => ({
    span: ({ node, children, ...props }) => typeof node?.properties['data-command'] === 'string'
      ? <CommandReference name={node.properties['data-command']} source={String(node.properties['data-command-source'] ?? '')}/>
      : <span {...props}>{children}</span>,
    code: ({ children, className, node }) => className
      ? <Code node={node} className={className} language={language} onError={onError}>{children}</Code> : <code>{children}</code>,
    a: ({ children, href }) => localReference(href) ? <FileReference href={href!}>{children}</FileReference> : <MessageLink href={href} language={language}>{children}</MessageLink>,
    img: ({ src, alt }) => src?.startsWith('data:image/')
      ? <PreviewImage src={src} alt={alt ?? 'Image'} language={language} openImage={openImage}/> : <span>{alt}</span>,
  }), [language, onError, openImage]);
  return <Markdown skipHtml urlTransform={url => localReference(url) ? url : defaultUrlTransform(url)} remarkPlugins={remarkPlugins} rehypePlugins={plugins}
    components={components}>{text}</Markdown>;
});
function Body({ blocks, ...props }: { blocks: Content[] } & BodyProps) {
  return <div className="message-body">{blocks.map((block, index) =>
    block.type === 'text' ? <UserText key={index} text={block.text ?? ''} {...props}/>
      : block.type === 'image' ? <Image key={index} block={block} {...props}/> : null)}</div>;
}
function UserText({ text, ...props }: { text: string } & BodyProps) {
  const commands = useContext(CommandCatalog);
  const presentation = useMemo(() => quotePresentation(text), [text]);
  if (!presentation) return <Text text={text} {...props} commands={commands}/>;
  const zh = props.language === 'zh';
  return <div className="sent-quote-message">
    <div className="sent-quotes">{presentation.quotes.map(quote =>
      <blockquote className="sent-quote" key={quote.id}>
        <div className="sent-quote-source">{quote.role === 'assistant'
          ? (zh ? '助手' : 'Assistant') : (zh ? '用户' : 'User')}</div>
        <div className="sent-quote-content"><Text text={quote.markdown} {...props}/></div>
        {quote.annotation && <div className="sent-quote-annotation"><span>{zh ? '批注' : 'Annotation'}</span><div>{quote.annotation}</div></div>}
      </blockquote>)}</div>
    {presentation.draft && <div className="sent-quote-reply"><Text text={presentation.draft} {...props} commands={commands}/></div>}
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
  const formatter = useMessageTimeFormat(language);
  const date = new Date(value ?? NaN);
  if (!value || !Number.isFinite(value) || Number.isNaN(date.getTime())) return null;
  return <time className="message-time" dateTime={date.toISOString()}>
    {formatter.format(date)}
  </time>;
}
export function Tool({ item, active, onExpandedChange, ...props }: {
  item: Extract<ResponseItem, { type: 'tool' }>; active: boolean;
  onExpandedChange?: (expanded: boolean) => void;
} & BodyProps) {
  const defaultExpanded = props.interfaceSettings?.toolsExpanded ?? false;
  const identity = item.call?.id ?? item.result?.toolCallId;
  const stateKey = identity ? `tool:${identity}` : undefined;
  const [expanded, setExpanded] = useConversationDisclosure(stateKey, defaultExpanded, props.disclosureReset);
  const [visited, setVisited] = useState(expanded);
  const { details, body } = useAnimatedDisclosure(expanded, props.onLayoutChange);
  useLayoutEffect(() => {
    if (expanded) setVisited(true);
  }, [expanded]);
  const zh = props.language === 'zh';
  const name = item.call?.name ?? item.result?.toolName ?? (zh ? '工具' : 'Tool');
  const subject = toolSubject(item.call);
  const presentation = toolPresentation(name, item.result, active, props.language, item.call?.arguments);
  const waiting = !item.result && Boolean(item.call?.id && props.awaitingToolCalls?.includes(item.call.id));
  const historical = item.call?.historical || item.result?.desktopImported;
  if (name === 'clarify_user' && !historical) return <QuestionTool item={item} waitingApproval={waiting} zh={zh}/>;
  const { kind, status } = presentation;
  const historicalStatus = !item.result || item.result.details?.importedStatus !== 'completed' && !item.result.isError
    ? (zh ? '结果未知' : 'Outcome unknown') : item.result.isError ? (zh ? '失败' : 'Failed') : (zh ? '完成' : 'Completed');
  const state = historical ? item.result?.isError ? 'failed' : item.result?.details?.importedStatus === 'completed' ? 'done' : 'missing' : waiting ? 'waiting' : presentation.state;
  const label = historical ? `${zh ? '历史工具' : 'Historical tool'} · ${name} · ${historicalStatus}`
    : waiting ? (zh ? `等待批准 · ${name}` : `Awaiting approval · ${name}`) : presentation.label;
  const Icon = { command: Terminal, read: FileText, write: FilePenLine, edit: FilePenLine,
    search: Search, folder: FolderSearch, web: Globe, sessions: MessagesSquare, 'session-read': MessageSquare, 'session-send': Send, other: Wrench }[kind];
  return <details ref={details} className={`process-tool ${state}`} data-message-index={item.index} data-tool-state={state} data-expanded={expanded}>
    <summary aria-expanded={expanded} onClick={event => {
      event.preventDefault(); setVisited(true); setExpanded(!expanded); onExpandedChange?.(!expanded);
    }}><Icon size={14}/>
      <ProcessRowLabel label={label} running={state === 'running'}/>
      <span className="thinking-chevron"><DisclosureChevron/></span>
      {props.interfaceSettings?.compactProcess && !expanded && subject && <span className="process-group-preview">{subject}</span>}
    </summary>
    <div ref={body} className="process-tool-body" aria-hidden={!expanded} inert={!expanded}>{(visited || expanded) &&
    <div className="process-tool-content">
      <div className="process-tool-meta"><code>{name}</code>{subject && <span className="process-tool-subject">{subject}</span>}</div>
      {item.call && <ToolDetails className="tool-input" stateKey={stateKey && `${stateKey}:input`} label={zh ? '输入' : 'Input'}>
        <ToolText text={JSON.stringify(item.call.arguments ?? {}, null, 2)} {...props}/></ToolDetails>}
      {item.result ? <ToolDetails className="tool-output" stateKey={stateKey && `${stateKey}:output`} label={zh ? '结果' : 'Result'} defaultExpanded>
        {messageText(item.result) ? <ToolText text={messageText(item.result)} {...props}/>
          : !messageBlocks(item.result).some(block => block.type === 'image') && <p className="process-pending">{zh ? '无输出' : 'No output'}</p>}
        {messageBlocks(item.result).filter(block => block.type === 'image').map((block, index) => <Image key={index} block={block} {...props}/>)}
      </ToolDetails> : null}
      <div className="process-tool-status">{state === 'done' && <Check size={12}/>}<span>{historical ? historicalStatus : status}</span></div>
    </div>}</div>
  </details>;
}

function ToolDetails({ className, stateKey, label, defaultExpanded = false, children }: {
  className: string; stateKey?: string; label: string; defaultExpanded?: boolean; children: ReactNode;
}) {
  const [expanded, setExpanded] = useConversationDisclosure(stateKey, defaultExpanded);
  return <details className={className} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{label}</summary>{children}
  </details>;
}

export function MessageActions({ text, language, onError, timing, timestamp, copyLabel, children }: {
  text: string; language: 'zh' | 'en'; onError: Props['onError'];
  timing?: ComponentProps<typeof ElapsedLabel>['timing']; timestamp?: number; copyLabel?: string; children?: ReactNode;
}) {
  return <footer className="message-actions assistant-actions">
    <CopyButton text={text} language={language} onError={onError} label={copyLabel}/>
    {children}
    <ElapsedLabel timing={timing} total language={language}/>
    <Timestamp value={timestamp} language={language}/>
  </footer>;
}

export function UserMessageActions({ text, language, onError, timestamp, copyLabel, steered, children }: {
  text: string; language: 'zh' | 'en'; onError: Props['onError']; timestamp?: number;
  copyLabel?: string; steered?: boolean; children?: ReactNode;
}) {
  return <footer className={`message-actions user-actions${steered ? ' has-steered-marker' : ''}`}>
    <Timestamp value={timestamp} language={language}/>
    <CopyButton text={text} language={language} onError={onError} label={copyLabel}/>
    {children}
  </footer>;
}

function ToolText({ text, ...props }: { text: string } & Pick<BodyProps, 'language' | 'onError'>) {
  return text.length > 32_768 ? <LargeText text={text} {...props}/> : <pre>{text}</pre>;
}

function ToolGroup({ items, active, stateKey, ...props }: { items: ToolItem[]; active: boolean; stateKey?: string } & BodyProps) {
  const defaultExpanded = props.interfaceSettings?.toolsExpanded ?? false;
  const [expanded, setExpanded] = useConversationDisclosure(stateKey, defaultExpanded, props.disclosureReset);
  const id = useId();
  useLayoutEffect(() => { props.onLayoutChange?.(); }, [expanded]);
  const running = items.some(item => !item.result || item.result.desktopToolPending);
  const label = toolGroupLabel(items, props.language);
  return <section className={`process-tool-group${running ? ' running' : ''}`} data-message-index={items[0].index}>
    <button type="button" className="tool-group-trigger" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      {running ? <Wrench size={14}/> : <Check size={14}/>}
      <ProcessRowLabel label={label} running={running}/>
      <span className="tool-group-chevron"><DisclosureChevron/></span>
    </button>
    <div id={id} className={`tool-group-disclosure${expanded ? ' is-expanded' : ''}`} aria-hidden={!expanded} inert={!expanded}
      onTransitionEnd={event => { if (event.target === event.currentTarget) props.onLayoutChange?.(); }}>
      <div>{items.map(item => <Tool key={item.key} item={item} active={active} {...props}/>)}</div>
    </div>
  </section>;
}
function ProcessGroup({ group, stateKey, children, ...props }: { group: ProcessGroupData; stateKey?: string; children: (onExpandedChange?: (expanded: boolean) => void) => ReactNode } & BodyProps) {
  const defaultExpanded = props.interfaceSettings?.toolsExpanded ?? false;
  const [expanded, setExpanded] = useConversationDisclosure(stateKey, defaultExpanded, props.disclosureReset);
  const id = useId();
  const single = group.items.length === 1;
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const open = single || expanded;
  useLayoutEffect(() => { props.onLayoutChange?.(); }, [expanded]);
  useLayoutEffect(() => {
    if (single && document.activeElement === trigger.current)
      body.current?.querySelector<HTMLElement>('.thinking > summary, .process-tool > summary')?.focus({ preventScroll: true });
  }, [single]);
  const { label, detail } = processGroupSummary(group, props.language);
  const runningTool = group.items.some(item => item.type === 'tool' && (!item.result || item.result.desktopToolPending));
  return <section className={`process-tool-group compact-process${group.running ? ' running' : ''}`} data-message-index={group.index} data-single={single}>
    <button ref={trigger} hidden={single && !focused} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      type="button" className="tool-group-trigger" aria-expanded={open} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      {group.running ? runningTool ? <Wrench size={14}/> : <Brain size={14}/> : <Check size={14}/>}
      <ProcessRowLabel label={label} running={group.running}/>
      <span className="tool-group-chevron"><DisclosureChevron/></span>
      {!open && detail && <span className="process-group-preview">{detail}</span>}
    </button>
    <div id={id} className={`tool-group-disclosure${open ? ' is-expanded' : ''}`} aria-hidden={!open} inert={!open}
      onTransitionEnd={event => { if (event.target === event.currentTarget) props.onLayoutChange?.(); }}>
      <div ref={body}>{children(single ? setExpanded : undefined)}</div>
    </div>
  </section>;
}
function SubagentTaskRow({ task, onOpen, language }: {
  task: SubagentDisplayTask; onOpen: (task: SubagentDisplayTask) => void; language: 'zh' | 'en';
}) {
  const zh = language === 'zh';
  const state = task.status === 'completed' ? 'done' : task.status === 'running' ? 'running' : task.status === 'queued' ? 'pending' : task.status === 'skipped' ? 'skipped' : task.status === 'aborted' ? 'stopped' : task.status === 'unknown' ? 'unknown' : 'failed';
  const summary = redactSensitiveText(task.task).replace(/\s+/gu, ' ').trim();
  const agent = redactSensitiveText(task.agent);
  const label = zh ? (state === 'pending' ? '待执行' : state === 'skipped' ? '已跳过' : state === 'running' ? '进行中' : state === 'done' ? '已完成' : state === 'unknown' ? '结果未知' : task.status === 'aborted' ? '已终止' : '已失败')
    : (state === 'pending' ? 'Pending' : state === 'skipped' ? 'Skipped' : state === 'running' ? 'Running' : state === 'done' ? 'Completed' : state === 'unknown' ? 'Outcome unknown' : task.status === 'aborted' ? 'Stopped' : 'Failed');
  return <button type="button" className="lane-row" data-tool-state={state} data-lane-agent={task.agent}
    aria-label={language === 'zh' ? `查看子代理记录: ${label}，${summary}` : `Open subagent record: ${label}, ${summary}`}
    onClick={() => onOpen(task)}>
    <Bot size={14}/>
    <SubagentStatusIcon state={state} language={language}/>
    <span className="lane-type">{agent || (zh ? '子代理' : 'Subagent')}</span>
    <span className="lane-chevron"><DisclosureChevron/></span>
    <span className="lane-summary-text">{summary.slice(0, 80) || (zh ? '无任务描述' : 'No task')}</span>
  </button>;
}

function SubagentLane({ item, active, onOpen, background, ...props }: {
  item: Extract<ResponseItem, { type: 'tool' }>; active: boolean;
  background: BackgroundSubagentStates;
  onOpen: (task: SubagentDisplayTask) => void;
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

export function ModelChangeNote({ change, language }: { change: ModelChange; language: 'zh' | 'en' }) {
  return <div className="client-event-note client-model-change" role="note" data-model-change-id={change.id}>
    <ArrowRightLeft size={14} aria-hidden="true"/>
    <span><strong>{language === 'zh' ? '模型已切换' : 'Model switched'}</strong>{language === 'zh' ? '：' : ':'}</span>
    <span className="change-models">
      <span title={`${change.from.provider}/${change.from.id}`}>{change.from.name}</span>
      <ArrowRight size={13} aria-label={language === 'zh' ? '切换为' : 'to'}/>
      <span title={`${change.to.provider}/${change.to.id}`}>{change.to.name}</span>
    </span>
  </div>;
}
function HistoricalAgents({ count, stateKey, language, children, onLayoutChange }: {
  count: number; stateKey?: string; language: 'zh' | 'en'; children: ReactNode; onLayoutChange?: () => void;
}) {
  const [expanded, setExpanded] = useConversationDisclosure(stateKey, false);
  const [visited, setVisited] = useState(expanded);
  const { details, body } = useAnimatedDisclosure(expanded, onLayoutChange);
  return <details ref={details} className="process-tool historical-agents" data-expanded={expanded}>
    <summary aria-expanded={expanded} onClick={event => {
      event.preventDefault(); setVisited(true); setExpanded(!expanded);
    }}><Bot size={14}/><span>{language === 'zh' ? '代理过程' : 'Agent activity'}</span>
      <span className="thinking-chevron"><DisclosureChevron/></span>
      <span className="process-group-preview">{language === 'zh' ? `${count} 组调用` : `${count} calls`}</span>
    </summary>
    <div ref={body} className="process-tool-body" aria-hidden={!expanded} inert={!expanded}>{(visited || expanded) && children}</div>
  </details>;
}

  const Response = memo(function Response({ items, active, historical, canBranch, branch, runtimeId, onOpenSubagent, onOpenWorkflow, background, modelChange, settledStatus, execution, searchTarget, ...props }: {
    items: { message: Message; index: number }[]; active: boolean;
    historical: boolean;
    canBranch: boolean; branch: Props['branch'];
    runtimeId?: string;
    modelChange?: ModelChange;
    settledStatus?: ReactNode;
    execution?: { plan: ApprovedPlan; state: PlanExecutionState };
    searchTarget?: SearchTextTarget;
    background: BackgroundSubagentStates;
    onOpenSubagent: (task: SubagentDisplayTask) => void;
    onOpenWorkflow?: (id: string) => void;
  } & BodyProps) {
    const { content, text } = responsePresentation(items);
    const incomplete = incompleteResponse(items.map(item => item.message), active, props.language);
    const liveThought = liveThinkingKey(content, active);
    const presentation = props.interfaceSettings?.compactProcess ? groupProcesses(content, active, props.awaitingToolCalls)
      : props.interfaceSettings?.groupTools ? groupConsecutiveTools(content, active, props.awaitingToolCalls) : content;
    const historicalAgents = historical ? content.filter(item => {
      if (item.type !== 'tool') return false;
      const name = item.call?.name ?? item.result?.toolName;
      if (name === 'workflow') return true;
      return name === 'subagent' && !subagentTasks(item.call, item.result, background).some(task =>
        task.backgroundAgentId && background.has(task.backgroundAgentId)
        && (task.status === 'running' || task.status === 'queued'));
    }) : [];
    const historicalKeys = new Set(historicalAgents.map(item => item.key));
    const changes = useMemo(() => turnChanges(active ? [] : items, window.desktop?.platform ?? 'win32'), [items, active]);
    const outputPaths = useMemo(() => active ? [] : turnOutputPaths(items, window.desktop?.platform ?? 'win32'), [items, active]);
    const finalItem = [...content].reverse().find(item => item.type === 'text');
    const finalProse = finalItem?.type === 'text' ? finalItem.block.text ?? '' : '';
    const zh = props.language === 'zh';
    const stamp = [...items].reverse().find(item => item.message.timestamp)?.message.timestamp;
    const disclosureKey = (item: ResponseItem) => {
      const entryId = items.find(entry => entry.index === item.index)?.message.entryId;
      const identity = item.type === 'tool' ? item.call?.id ?? item.result?.toolCallId : undefined;
      return identity ? `tool:${identity}` : entryId ? `${entryId}:${item.key.slice(item.key.indexOf(':') + 1)}` : undefined;
    };
    const groupDisclosureKey = (kind: string, first: ResponseItem) => {
      const key = disclosureKey(first);
      return key ? `${kind}:${key}` : undefined;
    };
    const actions = !active && content.length > 0 && <MessageActions text={text} language={props.language} onError={props.onError}
      timing={[...items].reverse().find(item => item.message.desktopTiming)?.message.desktopTiming?.run} timestamp={stamp}>
      <button type="button" className="icon-button branch-action" aria-label={zh ? '从这里分支' : 'Branch from here'}
        data-tooltip={zh ? '从这里分支' : 'Branch from here'}
        disabled={!canBranch || !items.at(-1)?.message.entryId}
        onClick={() => branch(items.at(-1)!.message)}><GitBranch size={15}/></button>
    </MessageActions>;
    const renderItem = (item: ResponseItem, onExpandedChange?: (expanded: boolean) => void): ReactNode => item.type === 'auto-resume'
      ? <AutoResumeMessage key={item.key} index={item.index} language={props.language}/>
      : item.type === 'completion-review'
      ? <CompletionReviewNote key={item.key} index={item.index} result={item.result} language={props.language}/>
      : item.type === 'cron'
      ? <CronMessage key={item.key} notice={item.notice} index={item.index} language={props.language} onLayoutChange={props.onLayoutChange}/>
      : item.type === 'tool'
            ? item.call?.historical || item.result?.desktopImported
              ? <Tool key={item.key} item={item} active={false} {...props}/>
              : approvedPlan(item.result)
              ? <PlanExecution key={item.key} plan={approvedPlan(item.result)!} state={execution?.state ?? 'interrupted'} note language={props.language}/>
              : item.call?.name === 'subagent' || item.result?.toolName === 'subagent'
              ? <SubagentLane key={item.key} item={item} active={active} background={background} onOpen={onOpenSubagent} {...props}/>
              : (item.call?.name === 'workflow' || item.result?.toolName === 'workflow') && onOpenWorkflow
                ? (() => {
                  const flow = workflowsFromMessages([
                    ...(item.call ? [{ role: 'assistant', content: [item.call] }] : []),
                    ...(item.result ? [item.result] : []),
                  ], active)[0];
                  return flow ? <WorkflowBlock key={item.key} flow={flow} language={props.language} onOpen={onOpenWorkflow}/>
                    : <Tool key={item.key} item={item} active={active} {...props}/>;
                })()
                : <Tool key={item.key} item={item} active={active} onExpandedChange={onExpandedChange} {...props}/>
          : item.type === 'thinking' ? <ThinkingDisclosure key={item.key} index={item.index}
            stateKey={disclosureKey(item)}
            elapsed={<ElapsedLabel timing={items.find(entry => entry.index === item.index)?.message.desktopTiming?.thinking[item.key.split(':')[1]]}
              active={item.key === liveThought} language={props.language}/>}
            autoOpen={Boolean(props.interfaceSettings?.thinkingExpanded && item.key === liveThought)}
            running={item.key === liveThought} preview={thinkingPreview(item.block.thinking ?? '', item.key === liveThought)}
            resetKey={props.disclosureReset} label={zh ? '思考' : 'Thinking'} onLayoutChange={props.onLayoutChange} onExpandedChange={onExpandedChange}>
            <Text text={item.block.thinking ?? ''} streaming={item.key === liveThought} {...props}/>
          </ThinkingDisclosure>
            : item.type === 'image' ? <Image key={item.key} block={item.block} {...props}/>
              : <div className="response-text" key={item.key} data-message-index={item.index} data-message-entry-id={items.find(entry => entry.index === item.index)?.message.entryId}><Text text={item.block.text ?? ''} streaming={active} {...props}
                searchTarget={searchTarget?.entryId && items.some(entry => entry.index === item.index && entry.message.entryId === searchTarget.entryId) ? searchTarget : undefined}/></div>;
    return <ArtifactContext.Provider value={{ runtimeId, onError: props.onError }}><article className={`message assistant${active ? ' response-active' : ''}`} data-message-index={items[0].index}>
      {modelChange && <ModelChangeNote change={modelChange} language={props.language}/>}
      <div className="response-content message-body">{presentation.map(item =>
        historicalKeys.has(item.key) ? item.key === historicalAgents[0]?.key
          ? <HistoricalAgents key={`history:${item.key}`} stateKey={groupDisclosureKey('history', historicalAgents[0])} count={historicalAgents.length} language={props.language} onLayoutChange={props.onLayoutChange}>
            {historicalAgents.map(member => renderItem(member))}
          </HistoricalAgents> : null
        : item.type === 'process-group' ? <ProcessGroup key={item.key} group={item} stateKey={groupDisclosureKey('process', item.items[0])} {...props}>{onExpandedChange => item.items.map(member => renderItem(member, onExpandedChange))}</ProcessGroup>
          : item.type === 'tool-group' ? <ToolGroup key={item.key} items={item.items} active={active} stateKey={groupDisclosureKey('tools', item.items[0])} {...props}/>
            : renderItem(item))}</div>
      {incomplete && <div className={`client-event-note incomplete-response${active ? '' : ' is-failed'}`} role="status">
        <CircleAlert size={14} aria-hidden="true"/><span>{incomplete}</span>
      </div>}
      {!active && <TurnArtifacts text={finalProse} outputPaths={outputPaths} language={props.language}/>}
      {!active && <TurnChanges changes={changes} runtimeId={runtimeId} language={props.language} onError={props.onError}/>}
    {actions && (settledStatus || execution) ? <div className="assistant-footer-row working working-idle">{actions}
      {execution && <PlanExecution plan={execution.plan} state={execution.state} language={props.language}/>}
      {settledStatus}</div> : actions}
  </article></ArtifactContext.Provider>;
});
const UserMessage = memo(function UserMessage({ message, index, arriving, editState, setEditState, searchTarget, ...props }: {
  message: Message; index: number; arriving: boolean;
  editState: EditState | null; setEditState: Dispatch<SetStateAction<EditState | null>>;
} & BodyProps & Pick<Props, 'canEdit' | 'edit'>) {
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
  return <article ref={article} className="message user" data-message-index={index} data-message-entry-id={message.entryId}>
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
    <Body blocks={messageBlocks(message)} {...props} searchTarget={searchTarget?.entryId === message.entryId ? searchTarget : undefined}/>
    <UserMessageActions text={messageText(message)} language={props.language} onError={props.onError}
      timestamp={message.timestamp} steered={message.desktopSteered}>
      <button ref={pencil} type="button" className="icon-button" aria-label={props.language === 'zh' ? '编辑并重做' : 'Edit and retry'}
        data-tooltip={props.language === 'zh' ? '编辑并重做' : 'Edit and retry'}
        disabled={!props.canEdit || !message.entryId || (!messageText(message) && !messageBlocks(message).some(block => block.type === 'image'))}
        onClick={() => setEditState({ entryId: message.entryId!, text: messageText(message), submitting: false })}><Pencil size={15}/></button>
      {message.desktopSteered && <em className="message-steered">{zh ? '已插队引导' : 'Steered'}</em>}
    </UserMessageActions></>}
  </article>;
});
export function ConversationMessages(props: Props) {
  const timeFormat = useMessageTimeFormat(props.language);
  const interfaceSettings = useMemo(() => normalizeInterfaceSettings(props.interfaceSettings), [props.interfaceSettings]);
  // Snapshot object identities change during streaming; only settings or an explicit apply reset disclosure.
  const disclosureReset = JSON.stringify([interfaceSettings, props.interfaceRevision ?? 0]);
  const [editState, setEditState] = useState<EditState | null>(null);
  const readEntries = useMemo(createConversationEntriesReader, []);
  const entries = useMemo(() => readEntries(props.messages), [props.messages, readEntries]);
  const executions = useMemo(() => planExecutionResponses(props.messages, props.busy), [props.messages, props.busy]);
  const background = useMemo(() => projectBackgroundSubagentStates(backgroundSubagentStates(props.messages), props.backgroundActivity), [props.messages, props.backgroundActivity]);
  const emptyBackground = useMemo<BackgroundSubagentStates>(() => new Map(), []);
  // Shell state changes must not invalidate every saved turn's event handlers.
  const handlers = useRef(props);
  useLayoutEffect(() => { handlers.current = props; });
  const callbacks = useMemo(() => ({
    edit: (message: Message, text: string) => handlers.current.edit(message, text),
    branch: (message: Message) => handlers.current.branch(message),
    onOpenSubagent: (task: SubagentDisplayTask) => handlers.current.onOpenSubagent(task),
    onOpenWorkflow: (id: string) => handlers.current.onOpenWorkflow?.(id),
  }), []);
  const body: BodyProps = { language: props.language, openImage: props.openImage, onError: props.onError,
    onLayoutChange: props.onLayoutChange, interfaceSettings, disclosureReset,
    awaitingToolCalls: props.awaitingToolCalls?.length ? props.awaitingToolCalls : undefined };
  const latestUser = [...props.messages].reverse().find(isUserMessage);
  const lastEntry = entries.at(-1);
  const hasSettledFooter = !props.busy && lastEntry?.type === 'response' && responsePresentation(lastEntry.items).content.length > 0;
  let userTimestamp: number | undefined;
  return <MarkdownPreparation.Provider value={props.preparedMarkdown}><MessageTimeFormat.Provider value={timeFormat}>{entries.map((entry, index) => {
    if (entry.type === 'user') {
      userTimestamp = entry.item.message.timestamp;
      return <UserMessage key={entry.item.index} message={entry.item.message} index={entry.item.index}
      editState={editState?.entryId === entry.item.message.entryId ? editState : null} setEditState={setEditState}
      arriving={entry.item.message === props.arrivingUser} {...body} edit={callbacks.edit}
      searchTarget={props.searchTarget?.entryId === entry.item.message.entryId ? props.searchTarget : undefined}
      canEdit={props.canEdit && entry.item.message.role === 'user' && entry.item.message === latestUser}/>;
    }
    if (cronMessage(entry.items[0].message)) userTimestamp = undefined;
    const modelChange = userTimestamp === undefined ? undefined : props.modelChanges?.find(change => change.userTimestamp === userTimestamp);
    const settledStatus = hasSettledFooter && index === entries.length - 1 ? props.settledStatus : undefined;
    const completedStatus = props.completedStatus?.responseIndex === entry.index ? props.completedStatus.content : undefined;
    return <Response key={entry.index} items={entry.items} active={props.busy && index === entries.length - 1}
      historical={index < entries.length - 1}
      modelChange={modelChange} canBranch={props.canEdit && index === entries.length - 1}
      background={background.size ? background : emptyBackground} {...body} runtimeId={props.runtimeId} branch={callbacks.branch}
      onOpenSubagent={callbacks.onOpenSubagent} onOpenWorkflow={props.onOpenWorkflow ? callbacks.onOpenWorkflow : undefined}
      searchTarget={props.searchTarget?.entryId && entry.items.some(item => item.message.entryId === props.searchTarget!.entryId) ? props.searchTarget : undefined}
      execution={executions.get(entry.index)}
      settledStatus={completedStatus ? <>{completedStatus}{settledStatus}</> : settledStatus}/>;
  })}{props.settledStatus && !hasSettledFooter && <div className="working working-idle">{props.settledStatus}</div>}</MessageTimeFormat.Provider></MarkdownPreparation.Provider>;
}
