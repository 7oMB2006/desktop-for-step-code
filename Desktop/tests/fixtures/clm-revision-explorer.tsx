import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronRight, FileText, History, LockKeyhole, RotateCcw, ShieldCheck } from 'lucide-react';
import { WorkingContextIcon } from '../../src/ContextCommandIcon';
import { MatrixPulse } from '../../src/WorkingIndicator';
import { DisclosureChevron } from '../../src/DisclosureChevron';
import { useAnimatedDisclosure } from '../../src/useAnimatedDisclosure';
import './clm-revision-explorer.css';

export type ClmScenario = 'ready' | 'empty' | 'unknown' | 'failure' | 'history';
type View = 'overview' | 'content' | 'diff';
type Block = { id: string; role: string; title: string; protected: boolean; text: string };
type Revision = { id: number; time: string; source: string; before: number; after: number; previous: Block[]; blocks: Block[]; guidance?: string };
const format = (value: number) => value.toLocaleString('en-US');
const roleLabel = (role: string) => role === 'user' ? '你的消息' : role === 'assistant' ? '助手记录' : '工具调用与返回';
function ContentSelect({ blocks, active, onChange }: { blocks: Block[]; active: Block; onChange: (id: string) => void }) {
  const prepare = (element: HTMLSelectElement) => {
    const available = Math.max(40, window.innerHeight - element.getBoundingClientRect().bottom - 12);
    element.style.setProperty('--clm-picker-height', `${available}px`);
  };
  return <label htmlFor="revision-block">选择内容<span className="revision-select">
    <select id="revision-block" value={active.id} onChange={event => onChange(event.target.value)}
      onFocus={event => prepare(event.currentTarget)} onPointerDown={event => prepare(event.currentTarget)}
      onKeyDown={event => prepare(event.currentTarget)}>
      {blocks.map(block => <option value={block.id} key={block.id}>{block.title}</option>)}
    </select><DisclosureChevron />
  </span></label>;
}
function PreviewDisclosure({ className, label, meta, icon, children }: {
  className: string; label: string; meta?: ReactNode; icon?: ReactNode; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const { details, body } = useAnimatedDisclosure(expanded);
  return <details ref={details} className={`${className} revision-disclosure`} data-expanded={expanded}>
    <summary aria-expanded={expanded} onClick={event => { event.preventDefault(); setExpanded(!expanded); }}>
      {icon}<span className="revision-disclosure-label">{label}</span><span className="revision-disclosure-chevron"><DisclosureChevron /></span>
      {meta && <span className="revision-disclosure-meta">{meta}</span>}
    </summary>
    <div ref={body} className="revision-disclosure-body" inert={!expanded} aria-hidden={!expanded}>{children}</div>
  </details>;
}
const initial: Block[] = [
  { id: 'ctx_001', role: 'user', title: '套餐查询与账户隔离', protected: true, text: '接入套餐查询。Plan 与 API 凭据必须隔离；失败不得切换计费方式。保留设置与会话。' },
  { id: 'ctx_008', role: 'assistant', title: '账户服务调查', protected: false, text: '已读取账户服务文件并逐项检查。余额查询入口在 account-service.ts，登录入口在 auth.ts。接着又检查了状态更新函数，发现切换身份与查询响应之间没有进行一致性检查。再次追踪两个调用点，确认需要按生效账户校验响应。' },
  { id: 'ctx_012', role: 'assistant', title: '旧缓存路径的失败原因', protected: false, text: '尝试复用上一账户的缓存，切换后发现余额有短暂残留。重新调用后现象仍存在。检查请求发起时间与响应顺序，旧请求比新请求更晚返回，覆盖了新账户。不能只在请求发起时检查身份，还要在响应返回时检查。' },
  { id: 'ctx_015', role: 'tool group', title: '测试调用与返回', protected: true, text: 'run_command → pnpm test:account\n结果：账户切换、取消登录、过期响应测试通过。\n工具调用与返回作为完整组保留。' },
  { id: 'ctx_024', role: 'assistant', title: '验证范围与未完成事项', protected: false, text: '再次核对已经完成的测试，覆盖账户切换、取消登录、过期响应。还需要补查询超时与认证失效用例。这里没有做真实套餐额度或 API 余额扣费验收，不应该把接口测试通过等同于计费验收。' },
  { id: 'ctx_028', role: 'user', title: '追加要求', protected: true, text: '先完成前端预览，不调用真实账户，也不要打包和发布。' },
];
const revisions: Revision[] = [];
let previous = initial;
const edits = [
  { id: 4, time: '14:08', before: 65400, after: 58360, block: 'ctx_008', text: 'account-service.ts 负责余额查询，auth.ts 负责登录。切换身份与响应缺少一致性检查，需要按生效账户校验返回值。' },
  { id: 5, time: '14:16', before: 58360, after: 51200, block: 'ctx_012', text: '复用缓存方案失败：旧请求晚返回并覆盖新账户。发起与返回阶段均需校验身份，不可跨账户复用余额缓存。' },
  { id: 6, time: '14:25', before: 51200, after: 46900, block: 'ctx_024', text: '已测账户切换、取消登录、过期响应。待补查询超时和认证失效。不包含真实计费验收。' },
  { id: 7, time: '14:32', before: 46900, after: 42600, block: 'ctx_008', text: '余额查询绑定生效账户；登录与查询入口分别为 auth.ts、account-service.ts。过期身份的响应必须丢弃。' },
];
for (const edit of edits) {
  const blocks = previous.map(block => block.id === edit.block ? { ...block, text: edit.text } : block);
  revisions.push({ ...edit, source: edit.id === 5 ? '手动整理' : '自动整理', previous, blocks });
  previous = blocks;
}

const longHistory = [...revisions];
for (let id = 8; id <= 27; id++) {
  const last = longHistory[longHistory.length - 1];
  const blockId = ['ctx_008', 'ctx_012', 'ctx_024'][id % 3];
  const blocks = last.blocks.map(block => block.id === blockId ? {
    ...block, text: `第 ${id} 次整理示例：${initial.find(item => item.id === blockId)!.text.slice(0, 42)}。保留本阶段结论，移除重复调查过程。`,
  } : block);
  longHistory.push({ id, time: `${15 + Math.floor((id - 8) / 6)}:${String((id - 8) % 6 * 10).padStart(2, '0')}`,
    source: id % 4 === 0 ? '手动整理' : '自动整理', before: last.after + 3200, after: last.after + 800, previous: last.blocks, blocks });
}

export function ClmRevisionExplorer({ scenario, resetKey, onUsageChange, onRecover }: {
  scenario: ClmScenario; resetKey: number; onUsageChange: (tokens: number | null) => void; onRecover: () => void;
}) {
  const [snapshots, setSnapshots] = useState(revisions);
  const [selectedId, setSelectedId] = useState(7);
  const [view, setView] = useState<View>('overview');
  const [blockId, setBlockId] = useState('ctx_008');
  const [enabled, setEnabled] = useState(true);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');
  const [intent, setIntent] = useState(false);
  const { details: formDetails, body: formBody } = useAnimatedDisclosure(intent);
  const [guidance, setGuidance] = useState('');
  const failNext = useRef(scenario === 'failure');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const organize = useRef<HTMLButtonElement>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const pageSize = 5;
  const current = snapshots[snapshots.length - 1];
  const selected = snapshots.find(item => item.id === selectedId) ?? current;
  const historical = selected.id !== current.id;
  const unavailable = scenario === 'unknown' || scenario === 'empty';
  const busy = stage > 0;
  const changes = selected.blocks.filter(block => block.text !== selected.previous.find(old => old.id === block.id)?.text);
  const active = selected.blocks.find(block => block.id === blockId) ?? selected.blocks[0];
  const original = selected.previous.find(block => block.id === active.id)!;
  const status = busy ? ['检查上下文', '整理工作副本', '验证修订'][stage - 1] : error ? '整理未完成' : notice || (enabled ? 'CLM 已启用' : 'CLM 已关闭');
  useEffect(() => {
    const seed = scenario === 'history' ? longHistory : revisions;
    setSnapshots(seed); setSelectedId(seed[seed.length - 1].id); setHistoryPage(Math.max(0, seed.length - pageSize)); setBlockId('ctx_008'); setView('overview');
    setStage(0); setEnabled(true); setError(false); setNotice(''); setIntent(false); setGuidance('');
    failNext.current = scenario === 'failure';
  }, [scenario, resetKey]);
  useEffect(() => {
    onUsageChange(unavailable || !enabled ? null : current.after);
  }, [current.after, unavailable, enabled, onUsageChange]);
  useEffect(() => {
    if (!stage) return;
    const timer = window.setTimeout(() => {
      if (stage < 3) { setStage(stage + 1); return; }
      setStage(0);
      if (failNext.current) { failNext.current = false; setError(true); return; }
      if (current.id >= 8) { setNotice('没有可接受的新修改'); return; }
      const blocks = current.blocks.map(block => block.id === 'ctx_012' ? { ...block, text: '失败原因：旧响应覆盖新账户。请求与响应均校验身份，禁用跨账户缓存。' } : block.id === 'ctx_024' ? { ...block, text: '待补超时与认证失效测试；真实计费未验收。已通过切换、取消和过期响应测试。' } : block);
      const next = { id: 8, source: '手动整理', time: '刚刚', before: current.after, after: 38420, previous: current.blocks, blocks, guidance: guidance.trim() };
      setSnapshots(items => [...items, next]); setSelectedId(id => id === current.id ? next.id : id); setNotice('新修订已接受');
    }, 800);
    return () => window.clearTimeout(timer);
  }, [stage, current, guidance]);
  useEffect(() => { if (intent) textarea.current?.focus(); }, [intent]);
  const chooseRevision = (item: Revision) => {
    setIntent(false);
    setSelectedId(item.id);
    setBlockId(item.blocks.find(block => block.text !== item.previous.find(old => old.id === block.id)?.text)?.id ?? item.blocks[0].id);
  };
  const showCurrent = () => {
    setHistoryPage(Math.max(0, snapshots.length - pageSize));
    chooseRevision(current);
  };
  const start = () => {
    if (!enabled || historical || unavailable || busy) return;
    setStage(1); setNotice(''); setError(false); setIntent(false);
  };
  const closeIntent = () => { setIntent(false); organize.current?.focus(); };
  return <section className={`revision-explorer ${busy ? 'is-organizing' : ''}`} aria-label="CLM 修订浏览">
    <header className="revision-heading"><WorkingContextIcon size={25} /><div><h1 id="clm-revision-title" tabIndex={-1}>工作上下文</h1><span>上下文版本与修改记录</span></div>
      <label className="revision-enable"><span>启用 CLM</span><button role="switch" aria-label="启用 CLM" aria-checked={enabled} disabled={busy || scenario === 'unknown'} className="clm-switch" onClick={() => { setEnabled(!enabled); setNotice(''); setIntent(false); setError(false); }}><i /></button></label>
    </header>
    <div className={`revision-live-state ${error ? 'is-error' : ''}`} role="status">
      {busy ? <MatrixPulse mode="compacting" /> : <span className={`clm-state-dot ${enabled ? '' : 'is-off'}`} />}
      <span>{unavailable ? scenario === 'empty' ? '尚无工作上下文' : '状态暂不可用' : status}</span>
      {!unavailable && <small data-testid="current-revision">{enabled ? '当前生效' : '最近版本'} · r{current.id}</small>}
    </div>
    {!enabled && <p className="revision-warning">本会话不再使用 CLM 工作上下文。历史修订仅供查看；重新启用后才能手动整理。</p>}
    <PreviewDisclosure className="revision-policy" label="自动整理策略" icon={<ShieldCheck size={14} />} meta={enabled ? '按需触发' : '未启用'}><p>启用 CLM 后，上下文达到运行时阈值且存在可整理内容时，才尝试自动整理。不是每轮执行，也不是定时任务。整理可能产生额外模型请求。</p><small>此处为策略展示，不是独立开关。</small></PreviewDisclosure>
    {unavailable ? <div className="clm-unavailable"><History size={28} /><strong>{scenario === 'empty' ? '还没有修订记录' : '无法读取修订状态'}</strong><p>{scenario === 'empty' ? '工作上下文产生修订后，记录会出现在这里。' : '未取得当前状态，不推断版本或上下文占用。'}</p>{scenario === 'unknown' && <button onClick={onRecover}><RotateCcw size={14} />重新获取</button>}</div> : <>
      <div className="revision-section-title"><h2>上下文版本</h2><small>当前分支 · {snapshots.length} 条示例</small></div>
      {snapshots.length > pageSize && <div className="revision-history-navigation">
        <button aria-label="查看更早修订" title="更早修订" disabled={historyPage === 0} onClick={() => setHistoryPage(page => Math.max(0, page - pageSize))}><ArrowLeft size={14}/></button>
        <span>r{snapshots[historyPage].id}–r{snapshots[Math.min(historyPage + pageSize, snapshots.length) - 1].id} / {snapshots.length} 版</span>
        <button aria-label="查看更新修订" title="更新修订" disabled={historyPage + pageSize >= snapshots.length} onClick={() => setHistoryPage(page => Math.min(snapshots.length - pageSize, page + pageSize))}><ArrowRight size={14}/></button>
        <button onClick={showCurrent}>当前 r{current.id}</button>
      </div>}
      <div className="revision-timeline" role="group" aria-label="选择修订">
        {snapshots.slice(historyPage, historyPage + pageSize).map(item => <button key={item.id} aria-pressed={selected.id === item.id} aria-label={`查看修订 r${item.id}`} onClick={() => chooseRevision(item)}>
          <span className="revision-node"><i /></span><strong>r{item.id}</strong><small>{item.id === current.id ? '当前' : item.time}</small>
        </button>)}
      </div>
      <div className={`revision-selection ${historical ? 'is-history' : ''}`}><div><History size={14} /><span>r{selected.id}</span><small>{historical ? '历史只读' : enabled ? '当前生效版本' : '最近保存版本'}</small></div>
        {historical ? <button onClick={showCurrent}>回到当前<ArrowRight size={12} /></button> : <small>{selected.time} · {selected.source}</small>}
      </div>
      <div className="revision-views" role="group" aria-label="修订视图">{([['overview', '概览'], ['content', '工作内容'], ['diff', '修改对比']] as const).map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}{id === 'diff' && <small>{changes.length}</small>}</button>)}</div>
      {view === 'overview' ? <div className="revision-overview" key={selected.id}>
        <div className="revision-token-label"><span>整理前 → 整理后 · 估算 token</span><Check size={13} /><small>修改已接受</small></div>
        <div className="revision-token-flow"><span>{format(selected.before)}</span><ArrowRight size={17} /><strong>{format(selected.after)}</strong><small>tokens</small><em><ArrowDown size={12} />{((1 - selected.after / selected.before) * 100).toFixed(1)}%</em></div>
        <div className="revision-comparison" aria-hidden="true"><i /><i style={{ transform: `scaleX(${selected.after / selected.before})` }} /></div>
        <div className="revision-section-title"><h2>本次修改的内容</h2><small>{changes.length} 项</small></div>
        <div className="revision-change-list">{changes.map(block => <button key={block.id} data-testid={`block-${block.id}`} title={`${block.id} · ${block.role}`} onClick={() => { setBlockId(block.id); setView('diff'); }}><FileText size={15} /><div><strong>{block.title}</strong><small>{roleLabel(block.role)} · 已更新</small><p>{block.text}</p></div><ChevronRight size={14} /></button>)}</div>
        <PreviewDisclosure className="revision-preserved" label="未修改的内容" meta={`${selected.blocks.length - changes.length} 项`}>
          <div className="revision-change-list">{selected.blocks.filter(block => !changes.includes(block)).map(block => <button key={block.id} title={`${block.id} · ${block.role}`} onClick={() => { setBlockId(block.id); setView('content'); }}>
            {block.protected ? <LockKeyhole size={14} /> : <FileText size={14} />}<div><strong>{block.title}</strong><small>{block.protected ? '受保护 · 原样保留' : '本次未修改'}</small></div><ChevronRight size={14} />
          </button>)}</div>
        </PreviewDisclosure>
        {selected.guidance && <p className="revision-guidance">保留重点：{selected.guidance}</p>}
      </div> : <div className="revision-document">
        <ContentSelect blocks={selected.blocks} active={active} onChange={setBlockId} />
        <div className="revision-block-heading" title={`${active.id} · ${active.role}`}><span>{roleLabel(active.role)}</span>{active.protected && <small><LockKeyhole size={11} />受保护</small>}</div>
        <h3>{active.title}</h3>
        {view === 'content' ? <div className="revision-text"><p>{active.text}</p></div> : active.text === original.text ? <div className="revision-text"><span className="revision-unchanged"><Check size={13} />本次修订未修改</span><p>{active.text}</p></div> : <>
          <div className="revision-diff-before"><header><span>−</span>修改前<small>r{selected.id - 1}</small></header><p>{original.text}</p></div>
          <div className="revision-diff-after"><header><span>+</span>修改后<small>r{selected.id}</small></header><p>{active.text}</p></div>
        </>}
      </div>}
      <PreviewDisclosure className="revision-history" label="原始会话独立保留" icon={<ShieldCheck size={14} />}><div className="revision-raw"><strong>原始记录 · 只读节选</strong><p>{initial[0].text}</p><p>{initial[1].text}</p><small>查看修订不会替换当前会话，也不会回滚执行过的工具。</small></div></PreviewDisclosure>
      {error && <div className="clm-error" role="alert"><strong>修改未被接受</strong><p>本次模拟整理失败，当前仍为 r{current.id}，未产生新修订。</p><button disabled={!enabled || historical} onClick={start}><RotateCcw size={13} />重试整理</button></div>}
    </>}
    <footer className="revision-action-area">
      {historical && !unavailable ? <p className="revision-readonly"><LockKeyhole size={13} />正在查看历史修订，整理操作仅用于当前版本。</p> : null}
      <div className="clm-actions"><button ref={organize} className="clm-organize" disabled={!enabled || historical || unavailable || busy} aria-expanded={intent} onClick={() => setIntent(!intent)}><WorkingContextIcon size={15} />整理上下文<span className={`revision-disclosure-chevron ${intent ? 'is-expanded' : ''}`}><DisclosureChevron /></span></button>
        {busy ? <button onClick={() => { setStage(0); setNotice('已取消，未产生新修订'); }}>取消整理</button> : <small>{unavailable ? '暂无可用版本' : `当前 r${current.id}`}</small>}</div>
      <details ref={formDetails} className="revision-form-disclosure"><summary hidden>整理上下文选项</summary><div ref={formBody} inert={!intent} aria-hidden={!intent}>
      <form className="clm-intent" onSubmit={event => { event.preventDefault(); start(); }} onKeyDown={event => { if (event.key === 'Escape') closeIntent(); }}>
        <label htmlFor="clm-guidance">保留重点 <small>可选</small></label><textarea ref={textarea} id="clm-guidance" maxLength={600} value={guidance} onChange={event => setGuidance(event.target.value)} placeholder="例如：账户隔离约束、失败原因、待补测试" />
        <p>仅模拟修订，不调用模型。</p><div><button type="button" onClick={closeIntent}>取消</button><button type="submit" className="clm-confirm">开始整理<ArrowRight size={14} /></button></div>
      </form></div></details>
    </footer>
  </section>;
}
