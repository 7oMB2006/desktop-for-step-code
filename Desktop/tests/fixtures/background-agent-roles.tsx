import type { BackgroundAgentLane } from '../../src/background-agents';
export { AgentRoleLabel, backgroundAgentPresentation as rolePresentation } from '../../src/BackgroundAgentPresentation';

export function roleSamples(): BackgroundAgentLane[] {
  const now = Date.now();
  const items = [
    { agent: 'explore', status: 'running', task: '梳理后台任务的归属与会话恢复链路。', activeTool: 'read_file',
      output: '### 已找到两处关键入口\n\n`session-runtimes.ts` 持有运行时归属；`background-work.ts` 决定宿主是否可以回收。\n\n### 正在核对\n\n切换会话后，后台任务是否仍由原运行时持有。历史记录不作为进程归属的依据。',
      usage: { input: 18240, output: 2460, cacheRead: 12000, cacheWrite: 0, turns: 4 } },
    { agent: 'review', status: 'completed', task: '独立审查停止任务与迟到响应的隔离边界。',
      output: '### 需要处理一处竞态\n\n停止请求返回前切换会话，旧请求可能更新新会话的错误提示。应当用原运行时身份校验响应。\n\n### 已确认的边界\n\n停止单个后台任务不影响主会话，也不影响其他任务。\n\n### 验证建议\n\n延迟停止响应，在切换会话后检查提示归属。',
      usage: { input: 12480, output: 1820, turns: 3 } },
    { agent: 'implement', status: 'completed', task: '为后台任务的异步响应补充身份校验。',
      output: '### 修改内容\n\n- `BackgroundAgentsView.tsx`：响应只更新原会话。\n- 保留手动刷新，不自动重试停止请求。\n\n### 实现说明\n\n沿用原有 IPC 和运行时归属判断，没有新增权限入口。\n\n### 验证交接\n\n实现已完成，验证结果由测试任务单独提供。',
      usage: { input: 21600, output: 3400, cacheRead: 18000, turns: 5 } },
    { agent: 'test', status: 'running', task: '验证切换会话、重复停止与迟到响应。', activeTool: 'run_command',
      output: '### 已执行\n\n会话切换后，旧任务的读取响应未进入新会话。\n\n### 正在验证\n\n重复停止请求是否被拦截，以及停止结果未确认时是否保留重试边界。\n\n### 尚未完成\n\n完整 Electron 验收仍在运行，还没有最终通过结论。',
      usage: { input: 8460, output: 1280, turns: 2 } },
    { agent: 'docs-helper', status: 'queued', task: '补充后台任务的使用说明与边界。', output: '', usage: {} },
  ] as const;
  return items.map((item, index) => ({
    id: `role_${item.agent.replace('-', '_')}`, mode: 'single', status: item.status === 'queued' ? 'running' : item.status,
    settling: false, startedAt: item.status === 'queued' ? undefined : now - (index + 1) * 32000,
    updatedAt: now, omittedSteps: 0, steps: [{ index: 0, agent: item.agent, task: item.task, status: item.status,
      model: item.status === 'queued' ? undefined : 'step-3.5-flash', usage: item.usage, output: item.output,
      activeTool: 'activeTool' in item ? item.activeTool : undefined, redacted: 0, outputTruncated: false }],
  }));
}
