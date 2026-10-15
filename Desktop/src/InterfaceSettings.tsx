import { ArrowUp, Plus, RotateCcw, Settings2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ConversationMessages } from './ConversationMessages';
import { PerformanceBar } from './PerformanceBar';
import type { Message } from './contracts';
import type { RunMetrics } from './performance';
import { normalizeInterfaceSettings, selectInterfacePreset, type InterfacePreferences, type InterfaceOptions, type InterfacePreset } from './interface-presets';
import './interface-settings.css';

const previewRun: RunMetrics = {
  startedAt: 0, finishedAt: 12000, turns: 1, tools: 1, toolTimeMs: 1000, activeTools: {},
  usage: { input: 1312, output: 480, cacheRead: 6888, cacheWrite: 0 },
  usageReported: true, measuredOutputTokens: 480, measuredOutputMs: 10000,
};

export function InterfaceSettings({ language, value, onChange }: {
  language: 'zh' | 'en'; value?: InterfacePreferences; onChange: (value: InterfacePreferences) => void | Promise<void>;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const draft = normalizeInterfaceSettings(value);
  const [saving, setSaving] = useState(false);
  const update = async (next: InterfacePreferences) => {
    setSaving(true);
    try { await onChange(next); } finally { setSaving(false); }
  };
  const toggle = (key: keyof InterfaceOptions) => void update({ ...draft, preset: 'custom', [key]: !draft[key] });
  const presets: [InterfacePreset, string][] = [['simple', t('简洁', 'Simple')], ['standard', t('标准', 'Standard')], ['detailed', t('详细', 'Detailed')]];
  const options: [keyof InterfaceOptions, string][] = [
    ['thinkingExpanded', t('思考过程默认展开', 'Expand thinking by default')],
    ['toolsExpanded', t('工具详情默认展开', 'Expand tool details by default')],
    ['groupTools', t('合并连续工具记录', 'Group consecutive tool records')],
    ['performanceVisible', t('显示性能与用量统计', 'Show performance and usage')],
  ];
  const messages: Message[] = [
    { role: 'assistant', content: [
      { type: 'text', text: t('先检查项目结构和验证结果。', 'First, check the project structure and validation results.') },
      { type: 'thinking', thinking: t('先确认页面结构，再实现交互与状态。', 'Check the structure, then implement interactions and state.') },
      { type: 'toolCall', id: 'preview-read', name: 'read_file', arguments: { path: 'src/main.tsx' } },
      { type: 'toolCall', id: 'preview-command', name: 'run_command', arguments: { command: 'git status --short' } },
    ] },
    { role: 'toolResult', toolCallId: 'preview-read', toolName: 'read_file', content: 'export function App() { /* ... */ }' },
    { role: 'toolResult', toolCallId: 'preview-command', toolName: 'run_command', content: 'M src/main.tsx' },
    { role: 'assistant', content: [{ type: 'text', text: t('页面已准备好，可以开始体验。', 'The page is ready to try.') }] },
  ];
  return <section className="interface-settings" aria-label={t('界面复杂度', 'Interface complexity')}>
    <div className="interface-heading">
      <h3>{t('界面复杂度', 'Interface complexity')}</h3>
      <button type="button" className="icon-button" disabled={saving} aria-label={t('恢复标准预设', 'Reset interface preset')} data-tooltip={t('恢复标准预设', 'Reset interface preset')} onClick={() => void update(selectInterfacePreset('standard'))}><RotateCcw size={16}/></button>
    </div>
    <div className="interface-grid">
      <div className="interface-controls">
        <div className="interface-preset-row">
          <div className="interface-presets" role="group" aria-label={t('界面预设', 'Interface presets')}>
            {presets.map(([id, label]) => <button type="button" key={id} disabled={saving} aria-pressed={draft.preset === id} onClick={() => void update(selectInterfacePreset(id))}>{label}</button>)}
          </div>
          <span className={`interface-custom${draft.preset === 'custom' ? ' is-active' : ''}`}><Settings2 size={13}/>{t('自定义', 'Custom')}</span>
        </div>
        <div className="interface-options">
          {options.map(([key, label]) => <label className="interface-option" key={key}>
            <span>{label}</span>
            <input type="checkbox" role="switch" aria-label={label} checked={draft[key]} disabled={saving} onChange={() => toggle(key)}/>
            <span className="interface-switch" aria-hidden="true"/>
          </label>)}
        </div>
      </div>
      <div className="interface-preview" aria-label={t('界面模式预览', 'Interface mode preview')}>
        <span className="interface-preview-label">{t('预览', 'Preview')}</span>
        <ConversationMessages messages={messages} language={language} interfaceSettings={draft} busy={false} canEdit={false}
          openImage={() => {}} edit={async () => {}} branch={() => {}} onError={() => {}} onOpenSubagent={() => {}}/>
        <div className="interface-preview-composer">
          <span className="interface-preview-placeholder">{t('你想做什么？', 'What would you like to do?')}</span>
          <div className="interface-preview-controls"><Plus size={13}/><ShieldCheck size={12}/><span>{t('需审批', 'Ask')}</span><span className="interface-preview-model">Step · Medium</span><ArrowUp size={13}/></div>
        </div>
        <div className="interface-preview-stats-slot">
          <div className={`interface-preview-statistics${draft.performanceVisible ? ' is-visible' : ''}`} inert={!draft.performanceVisible} aria-hidden={!draft.performanceVisible}>
            <PerformanceBar run={previewRun} connected language={language} now={12000}/>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
