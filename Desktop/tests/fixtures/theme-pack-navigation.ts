import type { Message } from '../../src/contracts';

// Fixed offline records: timestamps and outcomes are examples, never live activity.
const startedAt = new Date('2026-11-05T09:00:00+08:00').getTime();
export function themeNavigationMessages(): Message[] {
  const chapters = [
    ['先梳理工作区的视觉层级。', '工作区层级', '正文保持安静，场景留在两侧。侧栏负责定位，摘要负责当前任务，不让同一条信息重复占据多个区域。'],
    ['会话目录需要能跟随当前阅读位置。', '阅读位置', '用正文实际滚动位置定位当前轮次。点击目录跳到原文，手动向上阅读时不能被新消息拉回底部。'],
    ['引用和批注保留来源，不要合成普通文本。', '来源与批注', '引用保留原始片段，批注单独排版。关闭预览后返回触发按钮，不顺带关闭其他面板。'],
    ['检查计划、权限与提问这三类抽屉。', '决策区域', '计划是文档，权限是一次操作的确认，提问是选项与补充回答。共用材质，但保留各自的信息结构。'],
    ['把多代理的任务和结果分开看。', '协作记录', '先看任务与真实状态，再进入结果。缺少过程记录时说明缺失，不能用假日志填满空间。'],
    ['失败和未返回状态也需要验证。', '异常记录', '失败需要保留原因；没有最终回执就显示未知。缓存结果和新执行结果同样不能混为一谈。'],
    ['检查窄窗口、键盘与静态模式。', '交互边界', '触发区域保持原尺寸。键盘焦点必须完整可见，减少动态效果时不影响导航与状态阅读。'],
    ['最后回看这一轮的改动。', '离线验收', '这是多轮离线样例，没有运行模型或执行文件操作。可以来回跳转目录，也可以继续输入本地模拟消息。'],
  ];
  return chapters.flatMap(([prompt, heading, body], index): Message[] => [
    { role: 'user', entryId: `nav-user-${index}`, timestamp: startedAt + index * 300000, content: prompt },
    { role: 'assistant', entryId: `nav-answer-${index}`, timestamp: startedAt + index * 300000 + 30000,
      content: `### ${heading}\n\n${body}\n\n#### 核对范围\n\n- 保留真实的数据和状态。\n- 保留现有的尺寸和操作入口。\n- 检查主题切换后的表现。\n\n> 本轮为离线阅读样例。\n\n${body}`, stopReason: 'stop' },
  ]);
}

export function themeAgentMessages(): Message[] {
  return [
    { role: 'user', entryId: 'agents-user', timestamp: startedAt,
      content: '查看主题检查的协作记录。这是离线样例，包含完成、缓存、失败、中断和缺少最终回执的情况。' },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'sample-legacy-agent', name: 'subagent',
      arguments: { agent: 'explore', task: '检查导航组件的现有结构' } }] },
    { role: 'toolResult', toolCallId: 'sample-legacy-agent', toolName: 'subagent', content: '离线检查记录',
      details: { results: [{ agent: 'explore', task: '检查导航组件的现有结构', status: 'completed',
        model: 'offline', usage: { turns: 2 }, messages: [
          { role: 'assistant', content: '### 导航检查\n\n目录和正文刻度都来自真实用户轮次。\n\n- 复用已有的滚动定位。\n- 缺失时间不补造。\n- 键盘入口与鼠标入口保持一致。\n\n```ts\nscrollToTurn(scroll.current, turn.index);\n```\n\n> 离线样例，不是一次真实代理执行。' },
        ] }] } },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'sample-incomplete-flow', name: 'workflow', arguments: { name: '未返回最终回执 · 离线样例' } }] },
    { role: 'toolResult', toolCallId: 'sample-incomplete-flow', toolName: 'workflow', content: '',
      details: { schemaVersion: 1, runId: 'wf_stellar_incomplete', name: '未返回最终回执 · 离线样例',
        status: 'running', totalAgents: 1, agents: [{ id: 'unreturned', label: '记录核对', task: '核对未返回的代理记录',
          status: 'running', phase: '核对' }] } },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'sample-review-flow', name: 'workflow', arguments: { name: '主题协作检查 · 离线样例' } }] },
    { role: 'toolResult', toolCallId: 'sample-review-flow', toolName: 'workflow', content: '离线样例：保留部分失败结果。',
      details: { schemaVersion: 1, runId: 'wf_stellar_review', name: '主题协作检查 · 离线样例',
        status: 'partial_failed', totalAgents: 5, completedAgents: 3,
        startedAt, finishedAt: startedAt + 126000, spentTokens: 8460,
        cacheHits: 1, summary: { failed: 1 }, agents: [
          { id: 'layout', label: '布局核对', task: '检查目录、正文与侧栏之间的阅读层级', phase: '界面检查', status: 'completed',
            startedAt, finishedAt: startedAt + 32000, usageTokens: 2100 },
          { id: 'reference', label: '来源校对', task: '核对引用与批注的来源、焦点和关闭行为', phase: '界面检查', status: 'completed',
            startedAt, finishedAt: startedAt + 48000, usageTokens: 2360 },
          { id: 'palette', label: '材质对照', task: '复用上一次已保存的主题材质检查结果', phase: '界面检查', status: 'cached' },
          { id: 'narrow', label: '窄窗口验收', task: '检查 390px 窗口中的输入焦点与面板边界', phase: '回归验收', status: 'failed',
            startedAt: startedAt + 50000, finishedAt: startedAt + 98000, usageTokens: 4000,
            error: { code: 'FIXTURE_FOCUS_CLIPPED', message: '离线失败样例：输入框右侧焦点被裁切，需要复核。', retryable: false } },
          { id: 'handoff', label: '交付检查', task: '等待失败项处理后再进行交付核对', phase: '回归验收', status: 'aborted' },
        ] } },
    { role: 'assistant', content: '### 协作记录已整理\n\n可以从右侧摘要进入各条代理记录，或打开子代理面板查看阶段分组。\n\n这组离线样例特意保留了失败与未知状态。**没有执行模型调用，也没有修改本机文件。**', stopReason: 'stop' },
  ];
}
