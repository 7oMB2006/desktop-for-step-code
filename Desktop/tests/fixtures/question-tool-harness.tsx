import React from 'react';
import { createRoot } from 'react-dom/client';
import { QuestionContext, QuestionTool } from '../../src/QuestionTool';
import type { ResponseItem } from '../../src/conversation-presentation';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/appearance.css';

const params = new URLSearchParams(location.search);
const zh = params.get('lang') !== 'en';
document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
const questions = [{
  id: 'environment', label: 'Environment',
  question: zh ? '当前环境无法执行任何命令（run_command 找不到 Bash，且不会直接调用 PowerShell），因此 verify.ps1 无法实际运行。你希望如何处理这个执行环境问题？'
    : 'The current environment cannot execute commands because Bash is unavailable. How should we handle the environment and verify the PowerShell scripts?',
  allowFreeform: true, options: [],
}];
const item: Extract<ResponseItem, { type: 'tool' }> = {
  type: 'tool', index: 1, key: 'question-layout',
  call: { type: 'toolCall', id: 'question-layout', name: 'clarify_user', arguments: { questions } },
};
createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 24, maxWidth: 1000, margin: 'auto' }}>
    <QuestionTool item={{ ...item, result: {
      role: 'toolResult', toolCallId: 'question-layout', toolName: 'clarify_user',
      content: [{ type: 'text', text: 'Answered' }], isError: false,
      details: { questions, cancelled: false, answers: [{ label: 'Continue' }] },
    } }} waitingApproval={false} zh={zh}/>
    <QuestionContext.Provider value={{ pending: [{ version: 1, callId: 'question-layout', questions }], open: () => {
      document.documentElement.dataset.questionOpened = 'true';
    } }}>
      <QuestionTool item={item} waitingApproval={false} zh={zh}/>
    </QuestionContext.Provider>
  </main>,
);
