import { memo, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CommandCatalog, CommandReference, commandReference } from './CommandReference';
import type { ComponentProps, Dispatch, ReactNode, SetStateAction } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { ArrowRight, ArrowRightLeft, Bot, Brain, Check, Copy, FilePenLine, FileText, FolderSearch, GitBranch, Globe, MessagesSquare, MessageSquare, Pencil, Search, Send, Terminal, Undo2, Wrench } from 'lucide-react';
import type { Content, Message, ModelChange, PendingMessage } from './contracts';
import { messageRemarkPlugins, messageRehypePlugins } from './markdown-math';
import { backgroundSubagentStates, conversationEntries, messageBlocks, messageText, responsePresentation, toolPresentation, toolSubject, subagentTasks } from './conversation-presentation';
import type { BackgroundSubagentStates, ResponseItem, SubagentTask } from './conversation-presentation';
import { rehypeStreamReveal, updateReveal, REVEAL_DURATION, type RevealState } from './stream-reveal';
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

type Props = {
  interfaceSettings?: InterfacePreferences;
  interfaceRevision?: number;
  runtimeId?: string;
  awaitingToolCalls?: string[];
  modelChanges?: ModelChange[];
  messages: Message[]; language: 'zh' | 'en'; busy: boolean; canEdit: boolean;
  openImage: (src: string, name: string, anchor: HTMLElement) => void;
  edit: (message: Message, text: string) => Promise<void>; onError: (message: string) => void;
  branch: (message: Message) => void;
  onLayoutChange?: () => void;
  onOpenSubagent: (task: SubagentTask) => void;
  onOpenWorkflow?: (id: string) => void;
  arrivingUser?: Message | null;
  settledStatus?: ReactNode;
  completedStatus?: { responseIndex: number; content: ReactNode };
};
type BodyProps = Pick<Props, 'openImage' | 'language' | 'onError' | 'onLayoutChange' | 'awaitingToolCalls' | 'interfaceSettings'> & { disclosureReset?: string };
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
  const commands = useContext(CommandCatalog);
  const reference = commandReference(text, commands);
  const presentation = useMemo(() => quotePresentation(text), [text]);
  if (reference) return <p className="command-reference-text"><CommandReference {...reference}/>{text.slice(reference.length)}</p>;
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
export function Tool({ item, active, onExpandedChange, ...props }: {
  item: Extract<ResponseItem, { type: 'tool' }>; active: boolean;
  onExpandedChange?: (expanded: boolean) => void;
} & BodyProps) {
  const defaultExpanded = props.interfaceSettings?.toolsExpanded ?? false;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [visited, setVisited] = useState(defaultExpanded);
  const { details, body } = useAnimatedDisclosure(expanded, props.onLayoutChange);
  useLayoutEffect(() => {
    setExpanded(defaultExpanded);
    if (defaultExpanded) setVisited(true);
  }, [defaultExpanded, props.disclosureReset]);
  const zh = props.language === 'zh';
  const name = item.call?.name ?? item.result?.toolName ?? (zh ? '工具' : 'Tool');
  const subject = toolSubject(item.call);
  const presentation = toolPresentation(name, item.result, active, props.language, item.call?.arguments);
  const waiting = !item.result && Boolean(item.call?.id && props.awaitingToolCalls?.includes(item.call.id));
  if (name === 'clarify_user') return <QuestionTool item={item} waitingApproval={waiting} zh={zh}/>;
  const { kind, status } = presentation;
  const state = waiting ? 'waiting' : presentation.state;
  const label = waiting ? (zh ? `等待批准 · ${name}` : `Awaiting approval · ${name}`) : presentation.label;
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
    <div ref={body} className="process-tool-body" aria-hidden={!expanded} inert={!expanded}>{visited &&
    <div className="process-tool-content">
      <div className="process-tool-meta"><code>{name}</code>{subject && <span className="process-tool-subject">{subject}</span>}</div>
      {item.call && <details className="tool-input"><summary>{zh ? '输入' : 'Input'}</summary><pre>{JSON.stringify(item.call.arguments ?? {}, null, 2)}</pre></details>}
      {item.result ? <details className="tool-output" open><summary>{zh ? '结果' : 'Result'}</summary>
        {messageText(item.result) ? <pre>{messageText(item.result)}</pre>
          : !messageBlocks(item.result).some(block => block.type === 'image') && <p className="process-pending">{zh ? '无输出' : 'No output'}</p>}
        {messageBlocks(item.result).filter(block => block.type === 'image').map((block, index) => <Image key={index} block={block} {...props}/>)}
      </details> : null}
      <div className="process-tool-status">{state === 'done' && <Check size={12}/>}<span>{status}</span></div>
    </div>}</div>
  </details>;
}

function ToolGroup({ items, active, ...props }: { items: ToolItem[]; active: boolean } & BodyProps) {
  const defaultExpanded = props.interfaceSettings?.toolsExpanded ?? false;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const id = useId();
  useEffect(() => { setExpanded(defaultExpanded); }, [defaultExpanded, props.disclosureReset]);
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
function ProcessGroup({ group, children, ...props }: { group: ProcessGroupData; children: (onExpandedChange?: (expanded: boolean) => void) => ReactNode } & BodyProps) {
  const defaultExpanded = props.interfaceSettings?.toolsExpanded ?? false;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const id = useId();
  const single = group.items.length === 1;
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const open = single || expanded;
  useEffect(() => { setExpanded(defaultExpanded); }, [defaultExpanded, props.disclosureReset]);
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
    <span className="lane-chevron"><DisclosureChevron/></span>
    <span className="lane-summary-text">{summary.slice(0, 80) || (zh ? '无任务描述' : 'No task')}</span>
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

export function ModelChangeNote({ change, language }: { change: ModelChange; language: 'zh' | 'en' }) {
  return <div className="client-model-change" role="note" data-model-change-id={change.id}>
    <ArrowRightLeft size={14} aria-hidden="true"/>
    <span><strong>{language === 'zh' ? '模型已切换' : 'Model switched'}</strong>{language === 'zh' ? '：' : ':'}</span>
    <span className="change-models">
      <span title={`${change.from.provider}/${change.from.id}`}>{change.from.name}</span>
      <ArrowRight size={13} aria-label={language === 'zh' ? '切换为' : 'to'}/>
      <span title={`${change.to.provider}/${change.to.id}`}>{change.to.name}</span>
    </span>
  </div>;
}
function HistoricalAgents({ count, language, children, onLayoutChange }: {
  count: number; language: 'zh' | 'en'; children: ReactNode; onLayoutChange?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const { details, body } = useAnimatedDisclosure(expanded, onLayoutChange);
  return <details ref={details} className="process-tool historical-agents" data-expanded={expanded}>
    <summary aria-expanded={expanded} onClick={event => {
      event.preventDefault(); setVisited(true); setExpanded(!expanded);
    }}><Bot size={14}/><span>{language === 'zh' ? '代理过程' : 'Agent activity'}</span>
      <span className="thinking-chevron"><DisclosureChevron/></span>
      <span className="process-group-preview">{language === 'zh' ? `${count} 组调用` : `${count} calls`}</span>
    </summary>
    <div ref={body} className="process-tool-body" aria-hidden={!expanded} inert={!expanded}>{visited && children}</div>
  </details>;
}

  function Response({ items, active, historical, canBranch, branch, runtimeId, onOpenSubagent, onOpenWorkflow, background, modelChange, settledStatus, execution, ...props }: {
    items: { message: Message; index: number }[]; active: boolean;
    historical: boolean;
    canBranch: boolean; branch: Props['branch'];
    runtimeId?: string;
    modelChange?: ModelChange;
    settledStatus?: ReactNode;
    execution?: { plan: ApprovedPlan; state: PlanExecutionState };
    background: BackgroundSubagentStates;
    onOpenSubagent: (task: SubagentTask) => void;
    onOpenWorkflow?: (id: string) => void;
  } & BodyProps) {
    const { content, text } = responsePresentation(items);
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
    const actions = !active && content.length > 0 && <footer className="message-actions assistant-actions">
      <CopyButton text={text} {...props}/>
      <button type="button" className="icon-button branch-action" aria-label={zh ? '从这里分支' : 'Branch from here'}
        data-tooltip={zh ? '从这里分支' : 'Branch from here'}
        disabled={!canBranch || !items.at(-1)?.message.entryId}
        onClick={() => branch(items.at(-1)!.message)}><GitBranch size={15}/></button>
      <ElapsedLabel timing={[...items].reverse().find(item => item.message.desktopTiming)?.message.desktopTiming?.run}
        total language={props.language}/>
      <Timestamp value={stamp} language={props.language}/>
    </footer>;
    const renderItem = (item: ResponseItem, onExpandedChange?: (expanded: boolean) => void): ReactNode => item.type === 'tool'
            ? approvedPlan(item.result)
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
            elapsed={<ElapsedLabel timing={items.find(entry => entry.index === item.index)?.message.desktopTiming?.thinking[item.key.split(':')[1]]}
              active={item.key === liveThought} language={props.language}/>}
            autoOpen={Boolean(props.interfaceSettings?.thinkingExpanded && item.key === liveThought)}
            running={item.key === liveThought} preview={thinkingPreview(item.block.thinking ?? '', item.key === liveThought)}
            resetKey={props.disclosureReset} label={zh ? '思考' : 'Thinking'} onLayoutChange={props.onLayoutChange} onExpandedChange={onExpandedChange}>
            <Text text={item.block.thinking ?? ''} streaming={item.key === liveThought} {...props}/>
          </ThinkingDisclosure>
            : item.type === 'image' ? <Image key={item.key} block={item.block} {...props}/>
              : <div className="response-text" key={item.key} data-message-index={item.index}><Text text={item.block.text ?? ''} streaming={active} {...props}/></div>;
    return <ArtifactContext.Provider value={{ runtimeId, onError: props.onError }}><article className={`message assistant${active ? ' response-active' : ''}`} data-message-index={items[0].index}>
      {modelChange && <ModelChangeNote change={modelChange} language={props.language}/>}
      <div className="response-content message-body">{presentation.map(item =>
        historicalKeys.has(item.key) ? item.key === historicalAgents[0]?.key
          ? <HistoricalAgents key={`history:${item.key}`} count={historicalAgents.length} language={props.language} onLayoutChange={props.onLayoutChange}>
            {historicalAgents.map(member => renderItem(member))}
          </HistoricalAgents> : null
        : item.type === 'process-group' ? <ProcessGroup key={item.key} group={item} {...props}>{onExpandedChange => item.items.map(member => renderItem(member, onExpandedChange))}</ProcessGroup>
          : item.type === 'tool-group' ? <ToolGroup key={item.key} items={item.items} active={active} {...props}/>
            : renderItem(item))}</div>
      {!active && <TurnArtifacts text={finalProse} outputPaths={outputPaths} language={props.language}/>}
      {!active && <TurnChanges changes={changes} runtimeId={runtimeId} language={props.language} onError={props.onError}/>}
    {actions && (settledStatus || execution) ? <div className="assistant-footer-row working working-idle">{actions}
      {execution && <PlanExecution plan={execution.plan} state={execution.state} language={props.language}/>}
      {settledStatus}</div> : actions}
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
  const interfaceSettings = useMemo(() => normalizeInterfaceSettings(props.interfaceSettings), [props.interfaceSettings]);
  // Snapshot object identities change during streaming; only settings or an explicit apply reset disclosure.
  const disclosureReset = JSON.stringify([interfaceSettings, props.interfaceRevision ?? 0]);
  const [editState, setEditState] = useState<EditState | null>(null);
  const entries = useMemo(() => conversationEntries(props.messages), [props.messages]);
  const executions = useMemo(() => planExecutionResponses(props.messages, props.busy), [props.messages, props.busy]);
  const background = useMemo(() => backgroundSubagentStates(props.messages), [props.messages]);
  const latestUser = [...props.messages].reverse().find(isUserMessage);
  const lastEntry = entries.at(-1);
  const hasSettledFooter = !props.busy && lastEntry?.type === 'response' && responsePresentation(lastEntry.items).content.length > 0;
  let userTimestamp: number | undefined;
  return <>{entries.map((entry, index) => {
    if (entry.type === 'user') {
      userTimestamp = entry.item.message.timestamp;
      return <UserMessage key={entry.item.index} message={entry.item.message} index={entry.item.index}
      editState={editState} setEditState={setEditState}
      arriving={entry.item.message === props.arrivingUser} {...props}
      canEdit={props.canEdit && entry.item.message.role === 'user' && entry.item.message === latestUser}/>;
    }
    const modelChange = userTimestamp === undefined ? undefined : props.modelChanges?.find(change => change.userTimestamp === userTimestamp);
    const settledStatus = hasSettledFooter && index === entries.length - 1 ? props.settledStatus : undefined;
    const completedStatus = props.completedStatus?.responseIndex === entry.index ? props.completedStatus.content : undefined;
    return <Response key={entry.index} items={entry.items} active={props.busy && index === entries.length - 1}
      historical={index < entries.length - 1}
      modelChange={modelChange} canBranch={props.canEdit && index === entries.length - 1} background={background} {...props} interfaceSettings={interfaceSettings} disclosureReset={disclosureReset} execution={executions.get(entry.index)}
      settledStatus={completedStatus ? <>{completedStatus}{settledStatus}</> : settledStatus}/>;
  })}{props.settledStatus && !hasSettledFooter && <div className="working working-idle">{props.settledStatus}</div>}</>;
}
