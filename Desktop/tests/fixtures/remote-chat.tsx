import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, CheckCheck, ChevronDown, Code2, ImagePlus, MessageSquare, Moon, Pause, Play, RotateCcw, Send, Sun, Undo2 } from 'lucide-react';
import { AppMenu } from '../../src/AppMenu';
import { AppTooltip } from '../../src/AppTooltip';
import { remoteCard, remoteCardElements, type RemoteCardDocument, type RemoteFormElement } from '../../electron/remote-card.mjs';
import { RemoteChatPreview, scenes, sessionLabel, type ChatMessage, type Scene } from './remote-chat-model';
import '../../src/theme.css';
import './remote-chat.css';

const params = new URLSearchParams(location.search);
const feishuIcon = new URL('../../src/assets/feishu.svg', import.meta.url).href;
const startingScene = scenes.find(item => item.id === params.get('scene')) ?? scenes[0];
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';

function IconButton({ label, children, onClick, disabled, pressed }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean;
}) {
  return <button className="fc-icon" type="button" aria-label={label} data-tooltip={label}
    aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>;
}
function Select({ label, value, options, onChange }: {
  label: string; value: string; options: { id: string; name: string }[]; onChange: (id: string) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <><button ref={anchor} className="fc-select" aria-label={label} aria-haspopup="menu" aria-expanded={open}
    onClick={() => setOpen(value => !value)}>{options.find(option => option.id === value)?.name}<ChevronDown size={14}/></button>
    <AppMenu anchor={anchor} open={open} label={label} selected={value}
      items={options.map(item => ({ id: item.id, label: item.name }))} onSelect={onChange} onClose={close}/></>;
}
function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    img: ({ alt }) => <span>{alt || '图片'}</span>,
    a: ({ children }) => <span className="fc-link">{children}</span>,
  }}>{text}</ReactMarkdown>;
}
function Card({ document, message, decide }: {
  document: RemoteCardDocument; message: ChatMessage; decide: (option: string, form?: Record<string, unknown>) => void;
}) {
  const render = (element: RemoteFormElement, index: number): ReactNode => {
    if (element.tag === 'markdown') return <div className="fc-card-body" key={index}><Markdown text={element.content}/></div>;
    if (element.tag === 'form') {
      const submit = element.elements.find(item => item.tag === 'button' && item.form_action_type === 'submit');
      return <form className="fc-question-form" key={`${message.token}-${index}`} onSubmit={event => {
        event.preventDefault();
        if (submit?.tag === 'button') decide(submit.behaviors[0].value.option, Object.fromEntries(new FormData(event.currentTarget)));
      }}>{element.elements.map(render)}</form>;
    }
    if (element.tag === 'select_static') return <select key={index} name={element.name}
      aria-label={`问题 ${Number(element.name.slice(1)) + 1} 的答案`} required={element.required} defaultValue="">
      <option value="" disabled>选择答案</option>
      {element.options.map(option => <option key={option.value} value={option.value}>{option.text.content}</option>)}</select>;
    if (element.tag === 'input') return <textarea key={index} name={element.name} rows={3} maxLength={element.max_length}
      required={element.required} aria-label={`问题 ${Number(element.name.slice(1)) + 1} 的自行填写`} placeholder="自行填写答案"/>;
    if (element.tag === 'button') return <div className="fc-approval" key={index}>
      <button type={element.form_action_type === 'submit' ? 'submit' : 'button'} disabled={message.approval !== 'pending'}
        onClick={element.form_action_type === 'submit' ? undefined : () => decide(element.behaviors[0].value.option)}>
        {element.text.content.split(' / ').at(-1)}</button></div>;
    if (element.tag === 'div' && element.element_id === 'source') return <footer key={index}>{element.text.content}</footer>;
    if (element.tag === 'div') return <div className={element.element_id === 'progress' ? 'fc-tool-progress' : 'fc-card-body'}
      data-testid={element.element_id === 'progress' ? 'tool-progress' : undefined}
      title={element.element_id === 'progress' ? element.text.content : undefined}
      key={index}>{element.text.tag === 'lark_md' ? <Markdown text={element.text.content}/> : <p className="fc-literal">{element.text.content}</p>}</div>;
    if (element.tag === 'note') return <footer key={index} data-interrupted={message.card?.reply === 'interrupted'}>
      {element.elements.map((item, index) => <span key={index}>{item.content}</span>)}</footer>;
    return <div className="fc-approval" key={index}>{element.actions.map((action, index) =>
      <button key={index} disabled={message.approval !== 'pending'} onClick={() => decide(action.value.option)}>
        {message.approval === 'allowed' && index === 0 ? '已允许一次' : message.approval === 'denied' && index === 1
          ? '已拒绝' : action.text.content.split(' / ').at(-1)}</button>)}
      {message.approval === 'expired' && <span className="fc-expired">审批已失效</span>}</div>;
  };
  return <div className="fc-card" data-reply={message.card?.reply} data-approval={message.approval}
    data-status={message.card?.status} data-overview={Boolean(message.card?.overview)} data-testid="bot-card">
    {document.header && <header>{document.header.title.content}</header>}
    {remoteCardElements(document).map(render)}
  </div>;
}
function Message({ message, mode, decide, recall, connected }: {
  message: ChatMessage; mode: 'new' | 'old'; decide: (option: string, form?: Record<string, unknown>) => void; recall: () => void; connected: boolean;
}) {
  const actions = message.actions ?? [];
  const value = message.card && mode === 'old' && message.card.reply ? {
    title: `${message.card.reply === 'working' ? 'Working / 正在处理'
      : message.card.reply === 'completed' ? 'Completed / 已完成' : 'Interrupted / 已中断'} · ${message.card.title}`,
    text: message.card.text,
  } : message.card;
  return <article className={`fc-message fc-${message.role}`} data-message-id={message.id}>
    <div className="fc-avatar" aria-hidden="true">{message.role === 'bot'
      ? <img src="/StepCode.svg" alt=""/> : <span>我</span>}</div>
    <div className="fc-message-content">
      <div className="fc-sender">{message.role === 'bot' ? <>Desktop for Step Code <small>应用</small></> : <>
        <span>你</span>{message.recalled ? <span className="fc-recalled">已撤回</span>
          : <IconButton label="撤回这条模拟消息" disabled={!connected} onClick={recall}><Undo2 size={13}/></IconButton>}</>}</div>
      {value ? <Card document={remoteCard(value, actions)} message={message} decide={decide}/>
        : message.text ? <div className="fc-bubble">{message.text}</div> : null}
      {message.image && <figure className="fc-image" data-testid="simulated-image">
        <img src={`data:${message.image.mimeType};base64,${message.image.data}`}
          width="128" height="80" alt="模拟 PNG 单像素测试图"/>
        <figcaption>模拟图片 · 单像素 PNG{message.imageSession ? ` · ${sessionLabel(message.imageSession)}` : ''}</figcaption>
      </figure>}
      {message.reaction && (mode === 'new' || message.reaction === 'ok') && <div className="fc-reaction"
        role="status" aria-label={message.reaction === 'typing' ? '正在处理这条消息' : '验证码已匹配，等待本机确认'}
        data-tooltip={message.reaction === 'typing' ? '正在处理' : '验证码已匹配，仍需本机确认'}>
        {message.reaction === 'typing' ? <><span className="fc-typing"><i/><i/><i/></span><span>1</span></>
          : <><Check size={14}/><span>1</span></>}
      </div>}
      {message.reaction === 'typing' && mode === 'old' && <div className="fc-card fc-old-receipt">
        <header>Received / 已接收</header><div className="fc-card-body">Queued for this session / 已进入绑定会话的消息队列</div>
      </div>}
    </div>
  </article>;
}
function Preview({ onReset }: { onReset: () => void }) {
  const [controller, setController] = useState(() => new RemoteChatPreview(startingScene.id));
  const [state, setState] = useState(() => controller.snapshot());
  const [scene, setScene] = useState<Scene>(startingScene.id);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<'new' | 'old'>('new');
  const [speed, setSpeed] = useState('1');
  const [paused, setPaused] = useState(false);
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  const [draft, setDraft] = useState<string>(startingScene.prompt);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const editor = useRef<HTMLTextAreaElement>(null);
  const run = useCallback((operation: Promise<void>) => {
    void operation.catch(error => setError(error instanceof Error ? error.message : String(error)));
  }, []);
  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    run(controller.start());
    return () => { unsubscribe(); void controller.dispose(); };
  }, [controller, run]);
  useEffect(() => {
    if (paused || !state.ready || !state.jobs.length && !state.queue.length) return;
    const timer = setInterval(() => run(controller.advance(80 * Number(speed))), 80);
    return () => clearInterval(timer);
  }, [controller, paused, run, speed, state.ready, state.jobs.length, state.queue.length]);
  useEffect(() => {
    if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [state.messages]);
  const changeScene = (value: string) => {
    const option = scenes.find(item => item.id === value)!;
    setScene(option.id); setDraft(option.prompt); setPaused(false);
    const next = new RemoteChatPreview(option.id);
    setController(next); setState(next.snapshot()); setError(undefined); follow.current = true;
  };
  const send = () => {
    if (!state.ready || !draft.trim()) return;
    run(controller.send(draft)); setDraft(''); follow.current = true; setPaused(false);
    editor.current?.focus();
  };
  const play = () => {
    if (state.jobs.length || state.queue.length) setPaused(value => !value);
    else {
      run(controller.demo());
      follow.current = true; setPaused(false);
    }
  };
  const job = state.jobs.find(job => job.session === state.session);
  const running = state.jobs.length > 0;
  const status = !state.ready ? '正在准备' : state.awaitingConfirmation ? '等待本机确认'
    : !state.connected ? state.remoteStatus === 'idle' ? '已断开' : '待授权'
    : state.messages.some(item => item.approval === 'pending') ? '等待审批'
    : running ? paused ? '已暂停演示' : '正在回复' : '空闲';
  const active = [...state.messages].reverse().find(message => message.card);
  return <div className="fc-preview" data-mode={mode} data-ready={state.ready}
    data-session={state.session ?? ''} data-running={state.jobs.length} data-queued={state.queue.length}
    data-images-allowed={state.imagesAllowed} data-connected={state.connected}>
    <header className="fc-preview-bar">
      <div className="fc-preview-title"><img src={feishuIcon} alt="飞书" width="22" height="22"/>
        <strong>飞书消息模拟</strong><span className="fc-offline">本地模拟</span></div>
      <div className="fc-preview-actions">
        <div className="fc-segment" role="group" aria-label="消息版本">
          <button aria-pressed={mode === 'new'} onClick={() => setMode('new')}>新版</button>
          <button aria-pressed={mode === 'old'} onClick={() => setMode('old')}>旧版对照</button>
        </div>
        <IconButton label="重置演示" onClick={onReset}><RotateCcw size={16}/></IconButton>
        <IconButton label="切换主题" onClick={() => {
          document.documentElement.dataset.theme = dark ? 'light' : 'dark'; setDark(value => !value);
        }}>{dark ? <Sun size={17}/> : <Moon size={17}/>}</IconButton>
      </div>
    </header>
    {(error || state.error) && <p className="fc-preview-error" role="alert">{error || state.error}</p>}
    <div className="fc-workspace">
      <aside className="fc-conversations">
        <h2>消息</h2>
        <div className="fc-chat-selected"><img src="/StepCode.svg" alt="" width="36" height="36"/>
          <div><strong>Desktop for Step Code</strong><span>我们继续刚才的任务？</span></div></div>
        <div className="fc-conversation-meta"><MessageSquare size={14}/><span>应用消息</span></div>
        <div className="fc-profile"><div className="fc-avatar"><span>我</span></div><span>7oMB</span></div>
      </aside>
      <main className="fc-chat">
        <header className="fc-chat-header"><img src="/StepCode.svg" alt="" width="30" height="30"/>
          <div><h1>Desktop for Step Code <small>应用</small></h1><span>{sessionLabel(state.session, state.sessions)}</span></div>
          <span className="fc-connection"><i data-active={state.connected}/>{state.connected ? '已连接'
            : state.remoteStatus === 'idle' ? '已断开' : '待授权'}</span>
        </header>
        <div ref={transcript} className="fc-transcript" role="log" aria-label="模拟聊天记录" aria-live="off"
          onScroll={() => { const element = transcript.current!; follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 64; }}>
          <div className="fc-date">今天</div>
          {state.messages.map(message => <Message key={message.id} message={message} mode={mode}
            connected={state.connected} recall={() => run(controller.recall(message.id))}
            decide={(option, form) => run(controller.choose(message.id, option, form))}/>)}
        </div>
        <form className="fc-composer" onSubmit={event => { event.preventDefault(); send(); }}>
          <textarea ref={editor} aria-label="发送给飞书机器人的模拟消息" value={draft} maxLength={12000}
            placeholder="发送消息…" rows={2} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
            }}/>
          <div className="fc-composer-bottom"><span>{sessionLabel(state.session, state.sessions)}</span>
            <div className="fc-composer-actions">{scene === 'images' && <IconButton label="发送模拟图片"
              disabled={!state.ready || !state.connected} onClick={() => {
                run(controller.sendImageInput(draft || undefined)); setDraft(''); follow.current = true; setPaused(false);
              }}><ImagePlus size={17}/></IconButton>}
              <button className="fc-send" type="submit" disabled={!state.ready || !draft.trim()} aria-label="发送消息" data-tooltip="发送消息"><Send size={17}/></button>
            </div></div>
        </form>
      </main>
      <aside className="fc-controls">
        <section><h2>演示控制</h2>
          <div className="fc-control-field"><label>场景</label><Select label="选择演示场景" value={scene} options={[...scenes]} onChange={changeScene}/></div>
          <div className="fc-control-field"><label>速度</label><Select label="播放速度" value={speed}
            options={[{ id: '.5', name: '0.5×' }, { id: '1', name: '1×' }, { id: '2', name: '2×' }]} onChange={setSpeed}/></div>
          <div className="fc-playback">
            <button className="fc-play" disabled={!state.ready} onClick={play}>{running && !paused ? <Pause size={15}/> : <Play size={15}/>}
              {running || state.queue.length ? paused ? '继续' : '暂停' : '播放一轮'}</button>
            <IconButton label="立即完成当前回复" disabled={!job || job.scene === 'approval' && !job.approved}
              onClick={() => run(controller.finish())}><CheckCheck size={18}/></IconButton>
          </div>
          {state.awaitingConfirmation && <button className="fc-local-confirm" onClick={() => run(controller.confirm())}>模拟本机确认</button>}
          {scene === 'images' && <label className="fc-image-permission"><input type="checkbox"
            aria-label="允许模拟图片收发" checked={state.imagesAllowed} disabled={!state.connected}
            onChange={event => run(controller.setImagesAllowed(event.target.checked))}/><span>允许模拟图片收发</span></label>}
        </section>
        <section className="fc-run-state"><h2>当前状态</h2><div><i data-live={state.connected && running}/><strong>{status}</strong></div>
          <dl><dt>目标会话</dt><dd>{state.session ?? '未选择'}</dd><dt>排队消息</dt><dd>{state.queue.length}</dd><dt>真实网络</dt><dd>未连接</dd></dl>
        </section>
        <section className="fc-events"><h2>消息事件</h2>
          <ol>{state.events.length ? state.events.map((event, index) => <li key={index}><i/>{event}</li>) : <li>等待下一条消息</li>}</ol>
        </section>
        <section className="fc-payload"><details><summary><Code2 size={14}/>消息数据<ChevronDown size={14}/></summary>
          <pre>{JSON.stringify(active?.card ? remoteCard(active.card, active.actions) : {}, null, 2)}</pre></details></section>
      </aside>
    </div>
    <AppTooltip/>
  </div>;
}
function ResettablePreview() {
  const [key, setKey] = useState(0);
  return <Preview key={key} onReset={() => setKey(value => value + 1)}/>;
}
createRoot(document.getElementById('root')!).render(<ResettablePreview/>);
