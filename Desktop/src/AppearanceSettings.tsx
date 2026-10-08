import { RotateCcw } from 'lucide-react';
import { useState, type SelectHTMLAttributes } from 'react';
import { DisclosureChevron } from './DisclosureChevron';
import { defaultAppearance, normalizeAppearance, type Appearance } from './appearance';

function AppearanceSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="appearance-select"><select {...props}/><DisclosureChevron/></span>;
}

function FontSizeInput({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const parsed = draft.trim() ? Number(draft) : NaN;
    const next = Number.isFinite(parsed) ? Math.round(Math.max(min, Math.min(max, parsed))) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return <input aria-label={label} type="number" min={min} max={max} step={1} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.stopPropagation(); setDraft(String(value)); } }}/>;
}

export function AppearanceSettings({ value, onChange, language }: { value?: Appearance; onChange: (value: Partial<Appearance>) => void; language: 'zh' | 'en' }) {
  const a = normalizeAppearance(value);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const update = (patch: Partial<Appearance>) => onChange(patch);
  const size = (key: 'uiSize' | 'bodySize' | 'codeSize', min: number, max: number, label: string) => <label className="appearance-row"><span>{label}</span><span className="appearance-number"><FontSizeInput key={`${key}-${a[key]}`} label={label} min={min} max={max} value={a[key]} onChange={value => update({ [key]: value })}/><small>px</small></span></label>;
  return <section className="appearance-settings" aria-label={t('文字与排版', 'Typography')}>
    <div className="appearance-heading"><h3>{t('外观', 'Appearance')}</h3><button className="icon-button" aria-label={t('恢复默认排版', 'Reset typography')} data-tooltip={t('恢复默认排版', 'Reset typography')} onClick={() => onChange({ ...defaultAppearance })}><RotateCcw size={16}/></button></div>
    <h4>{t('界面', 'Interface')}</h4>
    <label className="appearance-row"><span>{t('字体', 'Font')}</span><AppearanceSelect aria-label={t('界面字体', 'Interface font')} value={a.uiFont} onChange={e => update({ uiFont: e.target.value as Appearance['uiFont'] })}><option value="system">{t('系统默认', 'System')}</option><option value="yahei">{t('微软雅黑', 'Microsoft YaHei')}</option></AppearanceSelect></label>
    {size('uiSize', 12, 18, t('界面字号', 'Interface size'))}
    <h4>{t('会话正文', 'Conversation')}</h4>
    <label className="appearance-row"><span>{t('字体', 'Font')}</span><AppearanceSelect aria-label={t('正文字体', 'Conversation font')} value={a.bodyFont} onChange={e => update({ bodyFont: e.target.value as Appearance['bodyFont'] })}><option value="system">{t('系统默认', 'System')}</option><option value="yahei">{t('微软雅黑', 'Microsoft YaHei')}</option><option value="serif">{t('衬线 · 宋体', 'Serif')}</option></AppearanceSelect></label>
    {size('bodySize', 12, 22, t('正文字号', 'Conversation size'))}
    <label className="appearance-row"><span>{t('行间距', 'Line spacing')}</span><AppearanceSelect aria-label={t('正文行间距', 'Conversation line spacing')} value={a.lineHeight} onChange={e => update({ lineHeight: Number(e.target.value) })}><option value={1.5}>{t('紧凑', 'Compact')}</option><option value={1.75}>{t('标准', 'Standard')}</option><option value={2}>{t('宽松', 'Relaxed')}</option></AppearanceSelect></label>
    <h4>{t('代码与差异', 'Code and diffs')}</h4>
    <label className="appearance-row"><span>{t('等宽字体', 'Monospace font')}</span><AppearanceSelect aria-label={t('代码字体', 'Code font')} value={a.codeFont} onChange={e => update({ codeFont: e.target.value as Appearance['codeFont'] })}><option value="mono">Cascadia Code</option><option value="consolas">Consolas</option></AppearanceSelect></label>
    {size('codeSize', 11, 20, t('代码字号', 'Code size'))}
    <div className="appearance-preview" aria-label={t('排版预览', 'Typography preview')}><div className="appearance-preview-label">{t('预览', 'Preview')}</div><div className="message-body"><h3>{t('让想法阶跃星辰', 'Let ideas reach the stars')}</h3><p>{t('从一个想法开始，写下问题，一起找到下一步。清晰的文字，让长时间阅读也更从容。', 'Start with an idea, ask a question, and find the next step together.')}</p><p>Readable text, clear structure, room to think.</p><pre><code>{'const nextStep = await agent.run(task);\nconsole.log(nextStep);'}</code></pre></div></div>
  </section>;
}
