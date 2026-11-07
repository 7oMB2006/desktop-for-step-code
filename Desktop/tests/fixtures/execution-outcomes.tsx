import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Languages, Moon, Sun } from 'lucide-react';
import { createPatch } from 'diff';
import { ConversationMessages } from '../../src/ConversationMessages';
import type { Message } from '../../src/contracts';
import { selectInterfacePreset } from '../../src/interface-presets';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './auto-resume.css';

const params = new URLSearchParams(location.search);
const execution = (status: string, exitCode: number | null = null, signal: string | null = null) => ({
  status, exitCode, signal, timedOut: status === 'timed_out', aborted: status === 'canceled', timeoutSeconds: .25,
});
function Preview() {
  const [theme, setTheme] = useState(params.get('theme') ?? 'light');
  const [language, setLanguage] = useState<'zh' | 'en'>(params.get('lang') === 'en' ? 'en' : 'zh');
  const [scenario, setScenario] = useState(params.get('state') ?? 'tools');
  const [preset, setPreset] = useState<'simple' | 'standard' | 'detailed'>(
    params.get('preset') === 'simple' ? 'simple' : params.get('preset') === 'detailed' ? 'detailed' : 'standard');
  const zh = language === 'zh';
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const command = (id: string, observed: unknown, isError = false): Message[] => [
    { role: 'assistant', content: [{ type: 'toolCall', name: 'run_command', id, arguments: { command: `check-${id}` } }] },
    { role: 'toolResult', toolName: 'run_command', toolCallId: id, content: `Example output: ${id}`, isError,
      details: { execution: observed } },
  ];
  const patch = createPatch('src/example.ts', 'export const ready = false;\n', 'export const ready = true;\n');
  const messages: Message[] = [
    { role: 'user', content: zh ? '修改配置，然后检查结果。' : 'Update the configuration, then check the result.', timestamp: 1794000000000 },
    ...(scenario === 'tools' ? [
      ...command('exit', execution('exited', 7)),
      ...command('timeout', execution('timed_out', 0, 'SIGTERM')),
      ...command('signal', execution('signaled', null, 'SIGKILL')),
      ...command('cancel', execution('canceled')),
      ...command('unknown', execution('unknown')),
      ...command('adapter', undefined, true),
      { role: 'assistant', content: [{ type: 'toolCall', name: 'edit_file', id: 'edit',
        arguments: { path: 'src/example.ts', then_run: 'check-cancel' } }] },
      { role: 'toolResult', toolName: 'edit_file', toolCallId: 'edit', isError: true, content: 'File changed. Check cancelled.',
        details: { changed: true, patch, thenRun: { command: 'check-cancel', execution: execution('canceled') } } },
      { role: 'assistant', content: zh ? '文件修改已保留，验证未完成。' : 'The file change is retained; verification is incomplete.', stopReason: 'stop' },
    ] as Message[] : [
      { role: 'assistant', content: [{ type: 'thinking', thinking: zh ? '检查当前任务。' : 'Checking the current task.' }],
        stopReason: 'stop', incomplete: 'no_visible_output' },
      { role: 'custom', customType: 'step-incomplete-turn-recovery', display: false, content: 'INTERNAL RECOVERY INPUT' },
      ...(scenario === 'recovered' ? [{ role: 'assistant', content: zh ? '已获得有效回复，继续原任务。' : 'A usable response was received. Continuing the original task.', stopReason: 'stop' }] : []),
    ] as Message[]),
  ];
  return <div className="recovery-preview">
    <header className="recovery-toolbar">
      <img src="/StepCode.svg" alt="Step Code" width="22" height="22"/>
      <select aria-label="Scenario" value={scenario} onChange={event => setScenario(event.target.value)}>
        <option value="tools">{zh ? '命令与修改结果' : 'Command and edit outcomes'}</option>
        <option value="recovering">{zh ? '空回复恢复中' : 'Recovering empty response'}</option>
        <option value="exhausted">{zh ? '恢复后仍无回复' : 'Recovery exhausted'}</option>
        <option value="recovered">{zh ? '恢复成功' : 'Recovery succeeded'}</option>
      </select>
      <select aria-label="Complexity" value={preset} onChange={event => setPreset(event.target.value as typeof preset)}>
        <option value="simple">{zh ? '简洁' : 'Simple'}</option>
        <option value="standard">{zh ? '标准' : 'Standard'}</option>
        <option value="detailed">{zh ? '详细' : 'Detailed'}</option>
      </select>
      <button type="button" className="icon-button" aria-label="Switch language" onClick={() => setLanguage(zh ? 'en' : 'zh')}><Languages size={16}/></button>
      <button type="button" className="icon-button" aria-label="Switch theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}
      </button>
    </header>
    <main className="recovery-transcript">
      <ConversationMessages messages={messages} busy={scenario === 'recovering'} language={language} canEdit={false}
        interfaceSettings={selectInterfacePreset(preset)} branch={() => {}} edit={async () => {}} openImage={() => {}}
        onOpenSubagent={() => {}} onError={console.error}/>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
