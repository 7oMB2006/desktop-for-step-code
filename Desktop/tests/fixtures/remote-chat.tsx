import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, CheckCheck, ChevronDown, Code2, MessageSquare, Moon, Pause, Play, RotateCcw, Send, Sun } from 'lucide-react';
import { AppMenu } from '../../src/AppMenu';
import { AppTooltip } from '../../src/AppTooltip';
import { remoteCard, type RemoteCardButton, type RemoteCardDocument } from '../../electron/remote-card.mjs';
import { chatReducer, initialChat, scenes, sessionLabel, type ChatMessage, type Scene } from './remote-chat-model';
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
  document: RemoteCardDocument; message: ChatMessage; decide: (allow: boolean) => void;
}) {
  return <div className="fc-card" data-reply={message.card?.reply} data-testid="bot-card">
    {document.header && <header>{document.header.title.content}</header>}
    {document.elements.map((element, index) => element.tag === 'div'
      ? <div className="fc-card-body" key={index}>{element.text.tag === 'lark_md'
        ? <Markdown text={element.text.content}/> : <p className="fc-literal">{element.text.content}</p>}</div>
      : element.tag === 'note' ? <footer key={index} data-interrupted={message.card?.reply === 'interrupted'}>
        {element.elements.map((item, index) => <span key={index}>{item.content}</span>)}</footer>
        : <div className="fc-approval" key={index}>{element.actions.map((action, index) =>
          <button key={index} disabled={message.approval !== 'pending'} onClick={() => decide(index === 0)}>
            {message.approval === 'allowed' && index === 0 ? '已允许一次' : message.approval === 'denied' && index === 1
              ? '已拒绝' : action.text.content}</button>)}</div>)}
  </div>;
}
function Message({ message, mode, decide }: {
  message: ChatMessage; mode: 'new' | 'old'; decide: (allow: boolean) => void;
}) {
  const actions: RemoteCardButton[] = message.approval ? ['允许一次', '拒绝'].map(option =>
    ({ tag: 'button', text: { tag: 'plain_text', content: option }, value: { token: `demo-${message.id}`, option } })) : [];
  const value = message.card && mode === 'old' && message.card.reply ? {
    title: `${message.card.reply === 'working' ? 'Working / 正在处理'
      : message.card.reply === 'completed' ? 'Completed / 已完成' : 'Interrupted / 已中断'} · ${message.card.title}`,
    text: message.card.text,
  } : message.card;
  return <article className={`fc-message fc-${message.role}`} data-message-id={message.id}>
    <div className="fc-avatar" aria-hidden="true">{message.role === 'bot'
      ? <img src="/StepCode.svg" alt=""/> : <span>我</span>}</div>
    <div className="fc-message-content">
      <div className="fc-sender">{message.role === 'bot' ? <>Desktop for Step Code <small>应用</small></> : '你'}</div>
      {value ? <Card document={remoteCard(value, actions)} message={message} decide={decide}/>
        : <div className="fc-bubble">{message.text}</div>}
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
  const [state, dispatch] = useReducer(chatReducer, startingScene.id, initialChat);
  const [scene, setScene] = useState<Scene>(startingScene.id);
  const [mode, setMode] = useState<'new' | 'old'>('new');
  const [speed, setSpeed] = useState('1');
  const [paused, setPaused] = useState(false);
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  const [draft, setDraft] = useState<string>(startingScene.prompt);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (paused || !state.job && !state.queue.length) return;
    const timer = setInterval(() => dispatch({ type: 'tick', ms: 80 * Number(speed) }), 80);
    return () => clearInterval(timer);
  }, [paused, speed, Boolean(state.job), state.queue.length]);
  useEffect(() => {
    if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [state.messages]);
  const changeScene = (value: string) => {
    const option = scenes.find(item => item.id === value)!;
    setScene(option.id); setDraft(option.prompt); setPaused(false);
    dispatch({ type: 'reset', scene: option.id }); follow.current = true;
  };
  const send = () => {
    if (!draft.trim()) return;
    dispatch({ type: 'send', text: draft, scene }); setDraft(''); follow.current = true; setPaused(false);
    editor.current?.focus();
  };
  const play = () => {
    if (state.job || state.queue.length) setPaused(value => !value);
    else {
      dispatch({ type: 'send', text: scenes.find(item => item.id === scene)!.prompt, scene });
      follow.current = true; setPaused(false);
    }
  };
  const status = state.awaitingConfirmation ? '等待本机确认' : state.messages.some(item => item.approval === 'pending')
    ? '等待审批' : state.job ? paused ? '已暂停演示' : '正在回复' : '空闲';
  const active = [...state.messages].reverse().find(message => message.card);
  return <div className="fc-preview" data-mode={mode}>
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
          <div><h1>Desktop for Step Code <small>应用</small></h1><span>{sessionLabel(state.session)}</span></div>
          <span className="fc-connection"><i data-active={state.connected}/>{state.connected ? '已连接' : '待授权'}</span>
        </header>
        <div ref={transcript} className="fc-transcript" role="log" aria-label="模拟聊天记录" aria-live="off"
          onScroll={() => { const element = transcript.current!; follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 64; }}>
          <div className="fc-date">今天</div>
          {state.messages.map(message => <Message key={message.id} message={message} mode={mode}
            decide={allow => dispatch({ type: 'decision', id: message.id, allow })}/>)}
        </div>
        <form className="fc-composer" onSubmit={event => { event.preventDefault(); send(); }}>
          <textarea ref={editor} aria-label="发送给飞书机器人的模拟消息" value={draft} maxLength={12000}
            placeholder="发送消息…" rows={2} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
            }}/>
          <div className="fc-composer-bottom"><span>{sessionLabel(state.session)}</span>
            <button className="fc-send" type="submit" disabled={!draft.trim()} aria-label="发送消息" data-tooltip="发送消息"><Send size={17}/></button></div>
        </form>
      </main>
      <aside className="fc-controls">
        <section><h2>演示控制</h2>
          <div className="fc-control-field"><label>场景</label><Select label="选择演示场景" value={scene} options={[...scenes]} onChange={changeScene}/></div>
          <div className="fc-control-field"><label>速度</label><Select label="播放速度" value={speed}
            options={[{ id: '.5', name: '0.5×' }, { id: '1', name: '1×' }, { id: '2', name: '2×' }]} onChange={setSpeed}/></div>
          <div className="fc-playback">
            <button className="fc-play" onClick={play}>{state.job && !paused ? <Pause size={15}/> : <Play size={15}/>}
              {state.job ? paused ? '继续' : '暂停' : '播放一轮'}</button>
            <IconButton label="立即完成当前回复" disabled={!state.job || state.job.scene === 'approval' && !state.job.approved}
              onClick={() => dispatch({ type: 'finish' })}><CheckCheck size={18}/></IconButton>
          </div>
          {state.awaitingConfirmation && <button className="fc-local-confirm" onClick={() => dispatch({ type: 'confirm' })}>模拟本机确认</button>}
        </section>
        <section className="fc-run-state"><h2>当前状态</h2><div><i data-live={Boolean(state.job)}/><strong>{status}</strong></div>
          <dl><dt>目标会话</dt><dd>{state.session}</dd><dt>排队消息</dt><dd>{state.queue.length}</dd><dt>真实网络</dt><dd>未连接</dd></dl>
        </section>
        <section className="fc-events"><h2>消息事件</h2>
          <ol>{state.events.length ? state.events.map((event, index) => <li key={index}><i/>{event}</li>) : <li>等待下一条消息</li>}</ol>
        </section>
        <section className="fc-payload"><details><summary><Code2 size={14}/>消息数据<ChevronDown size={14}/></summary>
          <pre>{JSON.stringify(active?.card ? remoteCard(active.card) : {}, null, 2)}</pre></details></section>
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
