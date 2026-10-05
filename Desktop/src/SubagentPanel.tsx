import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';
import type { Message } from './contracts';
import type { SubagentTask } from './conversation-presentation';
import { responsePresentation } from './conversation-presentation';
import { Tool, Text } from './ConversationMessages';
import { redactSubagentMessages } from './subagent-redact';
import { RightPanelExpandButton } from './RightPanelExpandButton';
import './subagent-panel.css';

function SubagentTranscript({ task, ...props }: { task: SubagentTask } & Pick<Parameters<typeof Text>[0], 'language' | 'openImage' | 'onError'>) {
  // A child call's arguments and result text are new surfaces here, so credentials, cookies and
  // raw child environment values are filtered before the shared Tool renderer sees them.
  const redacted = useMemo(() => redactSubagentMessages(task.messages), [task.messages]);
  // The dispatched task is shown in the head, so the subagent's own copy of it is skipped here.
  const nested = responsePresentation(redacted.messages
    .map((message: Message, index: number) => ({ message, index }))
    .filter(entry => entry.message.role !== 'user'));
  return <>
    {redacted.redacted > 0 && <p className="subagent-note">{props.language === 'zh'
      ? `已隐去 ${redacted.redacted} 行疑似凭据内容。`
      : `${redacted.redacted} line(s) that looked like credentials were hidden.`}</p>}
    {nested.content.map(item => item.type === 'tool'
      ? <Tool key={item.key} item={item} active={false} {...props}/>
      : item.type === 'image' ? null
        : <div className="lane-text" key={item.key}><Text text={item.block.text ?? ''} {...props}/></div>)}
  </>;
}

function SubagentContent({ task, ...props }: { task: SubagentTask } & Pick<Parameters<typeof Text>[0], 'language' | 'openImage' | 'onError'>) {
  const zh = props.language === 'zh';
  const state = task.status === 'completed' ? 'done' : task.status === 'running' ? 'running' : 'failed';
  const status = { running: zh ? '进行中' : 'In progress', done: zh ? '完成' : 'Done', failed: zh ? '失败' : 'Failed' }[state];
  // Activity only arrives with the final result; a running subagent has none yet.
  const hasTranscript = task.messages.some(message => message.role !== 'user');
  return <div className="subagent-body">
    <div className="subagent-head">
      <span className="lane-type">{task.agent || (zh ? '子代理' : 'Subagent')}</span>
      <span className="subagent-status" data-lane-state={task.status}>{state === 'done' && <Check size={12}/>}{status}</span>
      {task.model && <span className="subagent-meta">{task.model}{task.turns ? ` · ${zh ? '轮次' : 'turns'} ${task.turns}` : ''}</span>}
    </div>
    <p className="subagent-task">{task.task || (zh ? '无任务描述' : 'No task description')}</p>
    <p className="subagent-note">{zh
      ? '只读记录。子代理由主会话分发任务后独立执行，此处无法与它对话，也无法追加指令。'
      : 'Read-only record. The subagent runs on its own after the dispatch; you cannot talk to it or send follow-ups here.'}</p>
    <div className="subagent-transcript">
      {hasTranscript ? <SubagentTranscript task={task} {...props}/>
        : state === 'running' ? <p className="panel-empty">{zh
          ? '运行中。过程数据要等这个子代理跑完才随结果一起到达。'
          : 'Running. Its activity arrives with the result once it finishes.'}</p>
          : <p className="panel-empty">{zh ? '无过程记录。' : 'No activity recorded.'}</p>}
    </div>
  </div>;
}

export function SubagentPanel({ open, replaced, overlay, expanded, task, ...props }: {
  open: boolean; replaced: boolean; overlay: boolean; expanded: boolean; task: SubagentTask | null;
  language: 'zh' | 'en'; onClose: () => void; onToggleExpanded: () => void;
  openImage: (src: string, name: string, anchor: HTMLElement) => void; onError: (message: string) => void;
}) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  useLayoutEffect(() => {
    if (!open && matchMedia('(prefers-reduced-motion: reduce)').matches) setPresent(false);
  }, [open]);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), 260);
    return () => clearTimeout(timer);
  }, [open, present]);
  if (!present || !task) return null;
  const zh = props.language === 'zh';
  return <div className={`subagent-track${open ? ' is-open' : ''}${overlay ? ' is-overlay' : ''}${replaced ? ' is-replaced' : ''}`}>
    <aside className={`subagent-panel right-inspector-surface${expanded ? ' is-expanded' : ''}${open ? '' : ' is-closing'}`} id="subagent-panel"
      aria-label={zh ? '子代理记录' : 'Subagent record'} aria-hidden={!open} inert={!open}>
      <header className="right-panel-header">
        <ChevronRight size={15}/>
        <h2>{zh ? '子代理记录' : 'Subagent record'}</h2>
        <RightPanelExpandButton expanded={expanded} onToggle={props.onToggleExpanded} language={props.language}/>
        <button type="button" className="icon-button" aria-label={zh ? '关闭面板' : 'Close panel'} onClick={props.onClose}><X size={16}/></button>
      </header>
      <SubagentContent key={`${task.agent}:${task.task}`} task={task} {...props}/>    </aside>
  </div>;
}
