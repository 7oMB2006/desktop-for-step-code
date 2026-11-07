import type { Message, UIRequest } from '../../src/contracts';
import { QUESTION_TITLE, type Questionnaire } from '../../src/questionnaire';

export const questions: Questionnaire = {
  version: 1, callId: 'stellar-question-call',
  questions: [
    { id: 'reading', label: '阅读', question: '会话里的星海，你更偏好哪一种表现？',
      reason: '这是一组离线交互样例，不会更改实际主题设置。', allowFreeform: true,
      options: [
        { label: '安静阅读', value: 'quiet', description: '减弱运动，优先保留文字的清晰度。' },
        { label: '保留巡航', value: 'cruise', description: '保留缓慢的背景运动。' },
      ] },
    { id: 'details', label: '细节', question: '还有什么需要特别注意的细节？', allowFreeform: true, options: [] },
  ],
};
export const planContent = '# 星辰巡航主题收尾\n\n## 目标\n保持星海特色，不打扰日常阅读。\n\n## 实施步骤\n1. 为动态背景增加静态兜底。\n2. 操作控件跟随用户强调色。\n3. 柔化阅读区底部背景。\n\n## 验收\n- 欢迎徽标保持 48 × 48。\n- 关闭动态后画面静止。\n- 窄窗口焦点边框完整可见。\n\n> 离线演示：批准不会执行命令或写入文件。';

export function approvalSamples(workspace: string, stress = false): {
  id: string; name: string; toolName: string; callId: string; messages: Message[]; request: UIRequest;
}[] {
  const longPath = `${workspace}\\WorkspaceSessionNavigationKeyboardAccessibilityContextRecoveryAndThemeConsistencyVerificationWithoutWordSeparators\\integration-acceptance-notes.json`;
  const sampleQuestions = stress ? {
    ...questions,
    questions: questions.questions.map(question => ({
      ...question,
      question: `${question.question} 请同时考虑多个会话并行、审批等待与长时间阅读时的信息辨识。`,
      reason: `需要核对的目标：${longPath}\n保留原有布局与操作语义。\n检查窄窗口中的完整内容与焦点。`,
      options: question.options.map(option => ({ ...option,
        description: `${option.description} 对照 ${longPath}，确认长路径、多行解释与选项字母不会互相挤压。`,
      })),
    })),
  } : questions;
  const samplePlan = stress ? `${planContent}\n\n## 长内容检查\n\n${Array.from({ length: 12 }, (_, i) => `${i + 1}. 检查第 ${i + 1} 项会话记录、审批状态和键盘焦点，保留原有操作顺序。`).join('\n')}\n\n| 检查项 | 路径 |\n| --- | --- |\n| 集成记录 | \`${longPath}\` |\n\n> 保留引用中的完整上下文。\n> 不因主题样式隐藏警告，也不压缩操作区域。` : planContent;
  const configs = [
    { id: 'sample-permission', name: '权限审批 · 离线样例', toolName: 'write_file', callId: 'stellar-permission-call',
      input: { path: stress ? longPath : 'theme/reading.json', content: stress
        ? JSON.stringify({ checks: Array.from({ length: 18 }, (_, i) => ({ id: i, path: longPath, preserveFocus: true })) }, null, 2)
        : '{\n  "reading": "quiet",\n  "fallback": true\n}\n' },
      request: { type: 'extension_ui_request', method: 'confirm', id: 'stellar-permission',
        title: 'Approve write_file [ion-call]',
        message: 'Call: stellar-permission-call\nwrite_file can modify the workspace or execute a command\n\nwrite_file path=theme/reading.json\n\nBatch calls may ask separately\nbefore approved tools begin running.' } as UIRequest },
    { id: 'sample-plan', name: 'Plan 批阅 · 离线样例', toolName: 'exit_plan_mode', callId: 'stellar-plan-call',
      input: { planFilePath: `${workspace}\\plan.md` },
      request: { type: 'extension_ui_request', method: 'select', id: 'stellar-plan',
        title: `Desktop Plan review\n${stress ? longPath : `${workspace}\\plan.md`}\n\n${samplePlan}`,
        options: ['Approve plan', 'Request refinements', 'Keep planning'] } as UIRequest },
    { id: 'sample-question', name: '提问 Beta · 离线样例', toolName: 'clarify_user', callId: questions.callId,
      input: { questions: sampleQuestions.questions },
      request: { type: 'extension_ui_request', method: 'input', id: 'stellar-question',
        title: QUESTION_TITLE + JSON.stringify(sampleQuestions) } as UIRequest },
  ];
  return configs.map(({ input, ...sample }) => ({
    ...sample,
    request: { ...sample.request, runtimeId: `preview-${sample.id}` },
    messages: [
      { role: 'user', content: '查看这一步的交互。这是离线演示，不执行命令、调用模型或操作文件。' },
      { role: 'assistant', content: [
        { type: 'text', text: '主题配置已准备好，先确认这一项。当前为离线样例，确认不会执行操作。' },
        { type: 'toolCall', id: sample.callId, name: sample.toolName, arguments: input },
      ] },
    ],
  }));
}
