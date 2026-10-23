import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, ChevronDown, Command, Folder, FolderCheck, GitBranch, MessageSquare, Minimize2, Moon, Network, Plus, Shield, Sun, Workflow, X } from 'lucide-react';
import { CommandContextUsage, CompactContextIcon, OrganizeContextIcon, WorkingContextIcon } from '../../src/ContextCommandIcon';
import { commandPresentation } from '../../src/command-presentation';
import '../../src/style.css';
import '../../src/context-command-icon.css';
import './workflow-panel.css';

const runs = [
  { id: 'wf_a81c02', name: '项目发布检查', state: '已完成', count: '3 / 3', time: '今天 14:32', kind: 'done' },
  { id: 'wf_d402b1', name: '并行代码审查', state: '已停止', count: '2 / 3', time: '今天 11:08', kind: 'stopped' },
  { id: 'wf_f31e90', name: '依赖兼容检查', state: '失败', count: '0 / 2', time: '昨天 18:46', kind: 'failed' },
];
const AUTO_CLOSE_MS = 5000;
const iconProposals = [
  { name: 'compact', Before: Minimize2, Icon: CompactContextIcon, glyph: 'o · Compact', reason: 'Compact · 压缩当前对话上下文，可补充保留重点', change: true },
  { name: 'clm', Before: Command, Icon: WorkingContextIcon, glyph: 'l · CLM', reason: 'CLM · 查看工作上下文状态；支持 on、off、diff、reset', change: true },
  { name: 'clm-compact', Before: Command, Icon: OrganizeContextIcon, glyph: 'l · CLM', reason: 'CLM · 手动整理工作上下文，可补充保留重点', change: true },
  { name: 'workflows', Before: Network, Icon: Workflow, glyph: 'Workflow', reason: '工作流定义与运行记录', change: true },
  { name: 'ultracode', Before: Network, Icon: Network, glyph: 'Network', reason: '多个代理的连接与编排', change: false },
  { name: 'trust', Before: Shield, Icon: FolderCheck, glyph: 'FolderCheck', reason: '当前项目的信任确认', change: true },
  { name: 'permissions', Before: Shield, Icon: Shield, glyph: 'Shield', reason: '会话的访问权限与审批规则', change: false },
];

function IconAudit() {
  const [percent, setPercent] = useState(33);
  const [unknown, setUnknown] = useState(false);
  const contextLabel = unknown ? '上下文用量未知' : `上下文已用 ${percent}%`;
  const usage = { percent: unknown ? null : percent, tokens: unknown ? null : Math.round(256000 * percent / 100), contextWindow: 256000 };
  return <CommandContextUsage.Provider value={{ usage, language: 'zh' }}><section className="wf-icon-audit" aria-labelledby="icon-audit-title">
    <header><h1 id="icon-audit-title">指令图标</h1><span>候选方案</span><a href="workflow-panel.html">会话预览</a></header>
    <div className="wf-context-controls">
      <label htmlFor="preview-context-percent">模拟上下文 <output>{unknown ? '未知' : `${percent}%`}</output></label>
      <input id="preview-context-percent" type="range" min={0} max={100} value={percent} disabled={unknown} onChange={event => setPercent(Number(event.target.value))} />
      <label className="wf-context-unknown"><input type="checkbox" checked={unknown} onChange={event => setUnknown(event.target.checked)} />未知</label>
    </div>
    <h2>菜单尺寸</h2>
    <div className="wf-context-menu">
      {iconProposals.slice(0, 3).map(({ name, Icon, reason }) => <div key={name}>
        <Icon size={16} /><div><strong>{commandPresentation({ name }, true).title}</strong><small>{reason} · {contextLabel}</small></div><code>/{name}</code>
      </div>)}
    </div>
    <h2>图标对照</h2>
    <div className="wf-icon-columns"><span>指令</span><span>现有</span><span /><span>建议</span></div>
    {iconProposals.map(({ name, Before, Icon, glyph, reason, change }) => {
      const current = commandPresentation({ name }, true);
      return <div className="wf-icon-row" key={name}>
        <div className="wf-icon-command"><strong>{current.title}</strong><code>/{name}</code><small>{reason}</small></div>
        <div className="wf-icon-sample"><Before size={21} /><span>{name === 'compact' ? 'Minimize2' : name === 'clm' || name === 'clm-compact' ? 'Command' : name === 'trust' || name === 'permissions' ? 'Shield' : 'Network'}</span></div>
        <ArrowRight size={14} className="wf-icon-arrow" />
        <div className={`wf-icon-sample ${change ? 'is-proposed' : ''}`}><Icon size={21} /><span>{glyph}</span><small>{change ? '替换' : '保留'}</small></div>
      </div>;
    })}
    <h2>相关入口</h2>
    <div className="wf-icon-retained">
      {['usage', 'cron', 'todos'].map(name => {
        const item = commandPresentation({ name }, true);
        return <div key={name}><item.Icon size={18} /><span>{item.title}</span><code>/{name}</code></div>;
      })}
    </div>
    <h2>同义入口</h2>
    <div className="wf-icon-alias"><Network size={17} /><code>/ultracode · /ultraloop</code><span>同一编排能力</span></div>
    <div className="wf-icon-alias">{(() => { const { Icon } = commandPresentation({ name: 'todos' }, true); return <Icon size={17} />; })()}<code>/todos · /todo</code><span>旧运行时名称兼容</span></div>
  </section></CommandContextUsage.Provider>;
}

function Preview() {
  const iconView = new URLSearchParams(location.search).get('view') === 'icons';
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(new URLSearchParams(location.search).get('theme') === 'dark');
  const [scenario, setScenario] = useState('normal');
  const [remaining, setRemaining] = useState(AUTO_CLOSE_MS);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startY: number; offset: number } | null>(null);
  const suppressClick = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const paused = hovered || focused || expanded || dragging;
  const resetDrag = () => { drag.current = null; setDragging(false); setDragY(0); };
  const show = () => { resetDrag(); setRemaining(AUTO_CLOSE_MS); setExpanded(false); setHovered(false); setFocused(false); setOpen(true); };
  const close = () => {
    const ownsFocus = panel.current?.contains(document.activeElement);
    setOpen(false);
    setHovered(false);
    setFocused(false);
    resetDrag();
    if (ownsFocus) trigger.current?.focus();
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, offset: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.offset = Math.min(0, event.clientY - active.startY);
    if (Math.abs(event.clientY - active.startY) > 5) suppressClick.current = true;
    setDragY(active.offset);
  };
  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dismiss = !cancelled && Math.min(active.offset, event.clientY - active.startY) <= -48;
    resetDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (dismiss) close();
  };
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => { if (iconView) return; const timer = window.setTimeout(show, 350); return () => clearTimeout(timer); }, []);
  useEffect(() => {
    if (!open || paused) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - last;
      last = now;
      if (!document.hidden) setRemaining(value => Math.max(0, value - elapsed));
    }, 50);
    return () => clearInterval(timer);
  }, [open, paused]);
  useEffect(() => { if (open && remaining === 0) setOpen(false); }, [remaining, open]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && open) close(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  });
  const displayed = scenario === 'long' ? Array.from({ length: 12 }, (_, i) => ({ ...runs[i % 3], id: `wf_${i}a81c02` })) : runs;
  return <div className="wf-preview">
    <aside className="wf-sidebar">
      <button><Plus size={16} />新建会话</button>
      <p>工作区</p><div><Folder size={15} />Desktop For Step Code</div>
      <p>最近会话</p><div className="wf-selected"><MessageSquare size={15} />发布前检查</div>
      <div><MessageSquare size={15} />依赖更新与验证</div>
      <footer><img src="/StepCode.svg" alt="" />Step Code</footer>
    </aside>
    <main className="wf-main">
      <header className="wf-topbar">
        <span>{iconView ? '指令图标对照' : '发布前检查'}</span>
        <div className="wf-toolbar">
          <select aria-label="模拟数据" value={scenario} onChange={e => { setScenario(e.target.value); show(); }}>
            <option value="normal">模拟数据</option><option value="empty">空状态</option><option value="long">长列表</option>
          </select>
          <button ref={trigger} title="查看工作流" aria-label="查看工作流" aria-expanded={open} aria-controls="workflow-preview-panel" onClick={show}><Workflow size={17} /></button>
          <button title={dark ? '切换亮色' : '切换暗色'} aria-label="切换主题" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </header>
      <div className="wf-conversation">
        {iconView ? <IconAudit /> : <>
        <p className="wf-user">帮我检查一下这个项目是否可以发布。</p>
        <div className="wf-answer"><img src="/StepCode.svg" alt="Step Code" /><div>
          <p>构建和基础检查已完成。我会继续核对测试结果与依赖兼容性。</p>
          <div className="wf-process"><Check size={14} />已完成 3 项检查<ChevronDown size={13} /></div>
          <p>当前没有发现阻塞发布的问题，运行记录可以在工作流面板中查看。</p>
        </div></div>
        </>}
      </div>
      {!iconView && <div className="wf-input"><textarea aria-label="消息" placeholder="继续讨论…" /><div><span>Step · 标准</span><span>Plan</span></div></div>}
      <div className="wf-panel-anchor">
        <section ref={panel} id="workflow-preview-panel" aria-labelledby="wf-heading" aria-hidden={!open}
          inert={!open} className={`wf-panel ${open ? 'is-open' : ''} ${dragging ? 'is-dragging' : ''}`}
          style={open ? { transform: `translateY(${dragY}px)` } : undefined}
          onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
          <header><Workflow size={18} /><h2 id="wf-heading">工作流</h2><span className="wf-demo-label">模拟数据</span>
            <button className="icon-button" title="关闭" aria-label="关闭工作流面板" onClick={close}><X size={17} /></button>
          </header>
          <div className="wf-scroll">
            <div className="wf-section-title">已保存<span>{scenario === 'empty' ? 0 : 2}</span></div>
            {scenario === 'empty' ? <p className="wf-empty">当前项目没有保存的工作流。</p> : <div className="wf-saved">
              <div><GitBranch size={15} /><span>项目发布检查</span><code>release-check</code></div>
              <div><GitBranch size={15} /><span>并行代码审查</span><code>code-review</code></div>
            </div>}
            <div className="wf-section-title">近期运行<span>{scenario === 'empty' ? 0 : displayed.length}</span></div>
            {scenario === 'empty' ? <p className="wf-empty">当前项目还没有工作流运行记录。</p> : <>
              <div className="wf-column-head"><span>工作流</span><span>状态</span><span>代理</span></div>
              {displayed.map(run => <div className="wf-run" key={run.id}>
                <div><strong>{run.name}</strong><small>{run.id} · {run.time}</small></div>
                <span className={`wf-state ${run.kind}`}><i />{run.state}</span><span className="wf-count">{run.count}</span>
              </div>)}
            </>}
            <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
              <summary><ChevronDown size={13} />记录范围</summary>
              <p>当前项目中已保存的工作流与近期运行记录，不包含其他项目。</p>
            </details>
          </div>
          <footer><span>{paused ? '已暂停收起' : `${Math.ceil(remaining / 1000)} 秒后收起`}</span><span>工作流 · 当前项目</span></footer>
          <button className="wf-grab" aria-label="收起工作流面板" title="向上拖动或点击收起"
            onPointerDown={startDrag} onPointerMove={moveDrag}
            onPointerUp={event => finishDrag(event)}
            onPointerCancel={event => finishDrag(event, true)}
            onLostPointerCapture={event => finishDrag(event, true)}
            onClick={event => { if (event.detail === 0 || !suppressClick.current) close(); }}>
            <span />
          </button>
          <div className="wf-timer" style={{ transform: `scaleX(${remaining / AUTO_CLOSE_MS})` }} />
        </section>
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
