import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Languages, Moon, Sun } from 'lucide-react';
import { ConversationMessages } from '../../src/ConversationMessages';
import type { Message } from '../../src/contracts';
import { selectInterfacePreset } from '../../src/interface-presets';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './auto-resume.css';

const params = new URLSearchParams(location.search);
const prompt = 'The previous turn was interrupted by a transient model or transport error. Re-read the recent transcript and continue from where it stopped. Do not restart from scratch or repeat tool calls whose results are already present. If the work needs a decision from the user, stop and explain what is needed.';
const time = Date.parse('2026-10-24T10:19:00Z');
const notice: Message = { role: 'custom', customType: 'step-auto-resume', display: true, content: prompt,
  timestamp: time + 15000, details: { version: 1, kind: 'resume', source: 'autopilot' } };

function Preview() {
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light');
  const [language, setLanguage] = useState<'zh' | 'en'>(params.get('lang') === 'en' ? 'en' : 'zh');
  const [state, setState] = useState(params.get('state') ?? 'continued');
  const [preset, setPreset] = useState<'simple' | 'standard' | 'detailed'>(
    params.get('preset') === 'simple' ? 'simple' : params.get('preset') === 'detailed' ? 'detailed' : 'standard');
  const zh = language === 'zh';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
  }, [theme, zh]);
  const messages: Message[] = [
    { role: 'user', content: zh ? '检查手机连接，继续刚才的任务。' : 'Check the device connection and continue the task.', timestamp: time },
    { role: 'assistant', content: zh ? '我先检查设备的连接状态。' : 'I will check the device connection first.', timestamp: time + 1000 },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'check', name: 'run_command', arguments: { command: 'adb devices' } }], timestamp: time + 2000 },
    { role: 'toolResult', toolCallId: 'check', toolName: 'run_command', content: 'List of devices attached\nexample-device\toffline', timestamp: time + 3000 },
    { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Example transport error', timestamp: time + 10000 },
    state === 'user' ? { role: 'user', content: prompt, timestamp: time + 15000 }
      : state === 'hidden' ? { ...notice, display: false } : notice,
    { role: 'assistant', content: state === 'failed'
      ? zh ? '本次续跑仍未获得有效响应。' : 'No valid response was received on this attempt.'
      : state === 'stopped' ? zh ? '已停止继续执行。' : 'Continuation was stopped.'
      : zh ? '设备掉线了，我重新确认连接状态。\n\n此前的命令结果已保留，会从中断处继续，不重复执行已完成的步骤。'
        : 'The device is offline. I will check its connection again.\n\nPrevious command results are retained. I will continue from the interruption without repeating completed steps.',
      stopReason: state === 'failed' ? 'error' : state === 'stopped' ? 'aborted' : 'stop', timestamp: time + 23000,
      desktopTiming: { run: { startedAt: time + 15000, endedAt: time + 23000 }, thinking: {} } },
  ];
  return <div className="recovery-preview">
    <header className="recovery-toolbar">
      <img src="/StepCode.svg" alt="Step Code" width="22" height="22"/>
      <select aria-label={zh ? '场景' : 'Scenario'} value={state} onChange={event => setState(event.target.value)}>
        <option value="continued">{zh ? '正常续跑' : 'Continued'}</option>
        <option value="failed">{zh ? '再次中断' : 'Interrupted again'}</option>
        <option value="stopped">{zh ? '手动停止' : 'Stopped'}</option>
        <option value="user">{zh ? '用户发送同文' : 'User sends same text'}</option>
      </select>
      <select aria-label={zh ? '复杂度' : 'Complexity'} value={preset} onChange={event => setPreset(event.target.value as typeof preset)}>
        <option value="simple">{zh ? '简洁' : 'Simple'}</option>
        <option value="standard">{zh ? '标准' : 'Standard'}</option>
        <option value="detailed">{zh ? '详细' : 'Detailed'}</option>
      </select>
      <button className="icon-button" type="button" aria-label={zh ? '切换语言' : 'Switch language'}
        data-tooltip={zh ? '切换语言' : 'Switch language'} onClick={() => setLanguage(zh ? 'en' : 'zh')}><Languages size={16}/></button>
      <button className="icon-button" type="button" aria-label={zh ? '切换主题' : 'Switch theme'}
        data-tooltip={zh ? '切换主题' : 'Switch theme'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
        {theme === 'light' ? <Moon size={16}/> : <Sun size={16}/>}</button>
    </header>
    <main className="recovery-transcript">
      <ConversationMessages messages={messages} language={language} busy={false} canEdit={false}
        interfaceSettings={selectInterfacePreset(preset)} openImage={() => {}} edit={async () => {}}
        branch={() => {}} onError={console.error} onOpenSubagent={() => {}}/>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
