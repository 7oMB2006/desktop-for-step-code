import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { Paperclip, Goal, Lightbulb, ListTodo, Network, Plug, BookOpen, Terminal, Cpu, Shield, Minimize2, FileText, MessageSquare, Sparkles } from 'lucide-react';
import type { Message } from './contracts';
import { messageText } from './conversation-presentation';
import './composer-menu.css';

export interface ComposerCommand { name: string; description?: string; source?: string }
const labels: Record<string, [string, string]> = {
  goal: ['目标', 'Goal'], plan: ['计划模式', 'Plan mode'], todo: ['推进清单', 'Tasks'],
  ultracode: ['多代理编排', 'Ultracode'], ultraloop: ['多代理编排', 'Ultraloop'],
  compact: ['压缩上下文', 'Compact context'], init: ['项目指引', 'Project instructions'],
  cron: ['定时任务', 'Scheduled tasks'], plugin: ['插件', 'Plugins'], mcp: ['MCP', 'MCP'],
};
const icons: Record<string, typeof Terminal> = { goal: Goal, plan: Lightbulb, todo: ListTodo, ultracode: Network, ultraloop: Network, compact: Minimize2, init: FileText, mcp: Plug, plugin: Plug };
const terminalOnly = new Set(['exit', 'quit', 'theme', 'llama', 'clear', 'new']);
const descriptions: Record<string, string> = {
  goal: '查看或设置持续推进的目标', plan: '进入或退出计划模式', todo: '查看与管理任务',
  ultracode: '开启、关闭或查看多代理编排', ultraloop: '开启、关闭或查看多代理编排',
  compact: '压缩当前对话，可补充保留重点', init: '创建或更新项目 AGENTS.md',
  cron: '查看与管理定时任务', plugin: '查看与管理 Step Code 插件',
};

export function commandRows(commands: ComposerCommand[], zh: boolean) {
  const groupOrder = (source?: string) => source === 'skill' ? 2 : source === 'prompt' ? 1 : 0;
  return commands.filter(c => !terminalOnly.has(c.name) && !c.name.startsWith('_') && !(c.name === 'ultraloop' && commands.some(other => other.name === 'ultracode')))
    .sort((a, b) => groupOrder(a.source) - groupOrder(b.source)).map(c => ({
    id: `command:${c.name}`, title: labels[c.name]?.[zh ? 0 : 1] ?? `/${c.name}`,
    detail: zh ? descriptions[c.name] ?? c.description ?? '' : c.description ?? '', keyword: `/${c.name}`, Icon: icons[c.name] ?? (c.source === 'skill' ? BookOpen : c.source === 'prompt' ? Sparkles : Terminal),
    group: c.source === 'skill' ? (zh ? '技能' : 'Skills') : c.source === 'prompt' ? (zh ? '提示模板' : 'Prompts') : (zh ? '指令' : 'Commands'),
    command: c.name,
  }));
}

interface Props {
  children: ReactNode; draft: string; setDraft: (draft: string) => void; commands: ComposerCommand[];
  language: 'zh' | 'en'; scope: string; disabled: boolean; referencesOpen: boolean; setReferencesOpen: (open: boolean) => void;
  messages: Message[]; onFiles: () => Promise<boolean>; onQuote: (index: number) => boolean;
  onAction: (action: 'model' | 'permissions' | 'mcp') => void;
}
export function ComposerMenu(props: Props) {
  const { draft, setDraft, language, commands, referencesOpen, setReferencesOpen } = props;
  const root = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<{ mode: '/' | '@'; start: number; end: number; query: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const zh = language === 'zh';
  const input = () => root.current?.querySelector<HTMLTextAreaElement>('textarea');
  const close = () => { setDismissed(true); setReferencesOpen(false); };
  const readToken = () => {
    const textarea = input();
    if (!textarea) return;
    const end = textarea.selectionStart;
    const before = textarea.value.slice(0, end);
    const match = /(^|\s)([@/])([^\s@/]*)$/u.exec(before);
    // Slash commands are only valid at the start of the prompt.
    setToken(match && (match[2] === '@' || before.slice(0, match.index).trim() === '')
      ? { mode: match[2] as '/' | '@', start: end - match[3].length - 1, end, query: match[3] } : null);
  };
  useEffect(() => { readToken(); setDismissed(false); setSelected(0); }, [draft]);
  useEffect(() => { setToken(null); setDismissed(true); setReferencesOpen(false); }, [props.scope, props.disabled]);
  useEffect(() => { if (referencesOpen) { setDismissed(false); setSelected(0); } }, [referencesOpen]);
  const mode = referencesOpen ? '@' : token?.mode;
  const query = referencesOpen ? '' : token?.query.toLowerCase() ?? '';
  type Row = { id: string; title: string; detail: string; keyword?: string; Icon: typeof Terminal; group: string; activate: () => void };
  const consumeToken = (text = '') => {
    const next = !referencesOpen && token ? draft.slice(0, token.start) + text + draft.slice(token.end) : draft + text;
    setDraft(next); close();
    requestAnimationFrame(() => { const textarea = input(); textarea?.focus(); const caret = !referencesOpen && token ? token.start + text.length : next.length; textarea?.setSelectionRange(caret, caret); });
  };
  const actions: Row[] = [
    { id: 'model', title: zh ? '模型' : 'Model', detail: zh ? '选择模型与思考档位' : 'Model and reasoning effort', Icon: Cpu, group: zh ? '操作' : 'Actions', activate: () => { consumeToken(); props.onAction('model'); } },
    { id: 'permissions', title: zh ? '访问权限' : 'Permissions', detail: zh ? '调整此会话的权限' : 'Session permissions', Icon: Shield, group: zh ? '操作' : 'Actions', activate: () => { consumeToken(); props.onAction('permissions'); } },
    { id: 'mcp', title: 'MCP', detail: zh ? '查看与管理服务器' : 'Manage servers', Icon: Plug, group: zh ? '操作' : 'Actions', activate: () => { consumeToken(); props.onAction('mcp'); } },
  ];
  const rows: Row[] = mode === '/' ? [
    ...actions,
    ...commandRows(commands, zh).filter(c => !['mcp', 'model', 'permissions'].includes(c.command)).map(c => ({ ...c, activate: () => consumeToken(`/${c.command} `) })),
  ] : [
    { id: 'files', title: zh ? '文件和图片' : 'Files and images', detail: zh ? '添加本地附件' : 'Add local attachments', Icon: Paperclip, group: zh ? '添加' : 'Add', activate: () => {
      close(); const current = draft;
      void props.onFiles().then(added => { if (added && input()?.value === current) consumeToken(); });
    } },
    ...props.messages.map((message, index) => ({ message, index })).filter(({ message }) => message.display !== false && ['user', 'assistant'].includes(message.role) && messageText(message).trim()).slice(-12).reverse().map(({ message, index }) => ({
      id: `quote:${index}`, title: messageText(message).replace(/\s+/g, ' ').slice(0, 100), detail: message.role === 'user' ? (zh ? '你的消息' : 'Your message') : (zh ? '助手回复' : 'Assistant reply'),
      Icon: MessageSquare, group: zh ? '当前对话' : 'This conversation', activate: () => { if (props.onQuote(index)) consumeToken(); },
    })),
  ];
  const filtered = rows.filter(row => !query || `${row.title} ${row.keyword ?? row.id} ${row.detail}`.toLowerCase().includes(query));
  const active = Math.min(selected, Math.max(0, filtered.length - 1));
  const open = !props.disabled && !dismissed && Boolean(mode);
  useEffect(() => {
    const textarea = input(); if (!textarea) return;
    textarea.setAttribute('aria-autocomplete', 'list');
    textarea.setAttribute('aria-expanded', String(open));
    if (open) { textarea.setAttribute('aria-controls', 'composer-discovery'); if (filtered.length) textarea.setAttribute('aria-activedescendant', `composer-option-${active}`); else textarea.removeAttribute('aria-activedescendant'); }
    else { textarea.removeAttribute('aria-controls'); textarea.removeAttribute('aria-activedescendant'); }
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, query, open]);
  const keyboard = (e: KeyboardEvent) => {
    if (!open || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); input()?.focus(); }
    else if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setSelected((active + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % Math.max(1, filtered.length)); }
    else if ((e.key === 'Enter' && !e.shiftKey && !e.repeat) || e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation(); filtered[active]?.activate();
    }
  };
  return <div className={`composer-menu-anchor${open ? ' has-composer-menu' : ''}`} ref={root} onKeyDownCapture={keyboard}
    onSelectCapture={e => { if (e.target instanceof HTMLTextAreaElement) readToken(); }}
    onClickCapture={e => { if (e.target instanceof HTMLTextAreaElement) { readToken(); setDismissed(false); } }}>
    {open && <div className="composer-discovery" id="composer-discovery" role="listbox" aria-label={mode === '/' ? (zh ? '操作与指令' : 'Actions and commands') : (zh ? '附件与引用' : 'Attachments and references')}>
      <div className="composer-discovery-scroll">{filtered.length ? filtered.map((row, index) => <div key={row.id}>
        {(index === 0 || filtered[index - 1].group !== row.group) && <div className="composer-discovery-group">{row.group}</div>}
        <button type="button" id={`composer-option-${index}`} role="option" aria-selected={index === active} onMouseEnter={() => setSelected(index)} onMouseDown={e => e.preventDefault()} onClick={row.activate}>
          <row.Icon size={16}/><span className="composer-discovery-title">{row.title}</span>{row.keyword && <code>{row.keyword}</code>}<span className="composer-discovery-detail">{row.detail}</span>
        </button>
      </div>) : <div className="composer-discovery-empty">{zh ? '没有匹配的内容' : 'No matches'}</div>}</div>
    </div>}
    {props.children}
  </div>;
}
