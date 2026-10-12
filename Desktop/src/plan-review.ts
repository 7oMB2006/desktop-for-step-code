import type { Message, UIRequest } from './contracts';

export function planReview(request?: UIRequest) {
  if (request?.method !== 'select' || !request.title?.startsWith('Desktop Plan review\n')) return;
  const [_, path, ...body] = request.title.split('\n');
  if (!path || request.options?.join('|') !== 'Approve plan|Request refinements|Keep planning') return;
  return { path, content: body.join('\n').replace(/^\n/, '') };
}

export function pendingPlanReview(messages: Message[], planning: boolean) {
  if (!planning) return false;
  const latest = [...messages].reverse().find(message => message.role === 'toolResult' && message.toolName === 'exit_plan_mode');
  return Boolean(latest && !latest.isError && typeof latest.details?.planFilePath === 'string'
    && typeof latest.details?.planContents === 'string' && latest.details.planContents.trim()
    && ['dismissed', 'feedback'].includes(String(latest.details.outcome)));
}
