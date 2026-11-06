import { resolve } from 'node:path';
import { createProjectInstructions } from './project-instructions';
import { projectInstructionsInput, projectInstructionsTask } from '../src/project-instructions';
export { projectInstructionsInput, projectInstructionsSnippetCandidate } from '../src/project-instructions';

const createTool = 'desktop_create_project_instructions';
const readTools = new Set(['read_file', 'list_directory', 'find_files', 'search_files', 'read', 'ls', 'find', 'grep']);

// Bundled as a Desktop-owned extension; the upstream pin and personal profile stay unchanged.
export default function registerProjectInstructions(pi: any) {
  if (process.env.STEPCODE_SUBAGENT_CHILD === '1') return;
  let active: { cwd: string; mode: 'create' | 'review'; tools: string[] } | undefined;
  const restore = () => {
    if (!active) return;
    const { tools } = active;
    active = undefined;
    pi.setActiveTools(tools);
  };
  pi.registerTool({
    name: createTool, label: '创建 AI 工作规范',
    description: 'Create AGENTS.md in the current project exclusively. Never updates or overwrites an existing file.',
    parameters: { type: 'object', properties: { content: { type: 'string', minLength: 1, maxLength: 131072 } },
      required: ['content'], additionalProperties: false },
    execute: async (_id: string, args: { content: string }, _signal: AbortSignal, _update: unknown, ctx: { cwd: string }) => {
      if (!active || active.mode !== 'create' || resolve(ctx.cwd) !== active.cwd)
        throw new Error('Creation is available only during the current /init creation task');
      const result = await createProjectInstructions(active.cwd, args.content);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  });
  pi.on('session_start', () => {
    restore();
    pi.setActiveTools(pi.getActiveTools().filter((name: string) => name !== createTool));
  });
  pi.on('agent_settled', restore);
  pi.on('session_shutdown', restore);
  pi.on('tool_call', (event: { toolName: string }) => {
    if (active && !readTools.has(event.toolName) && !(active.mode === 'create' && event.toolName === createTool))
      return { block: true, reason: 'This /init task allows project reads only, plus exclusive AGENTS.md creation in create mode. Apply updates only in a separate, explicitly approved user task.' };
  });
  // Preflight failures happen before this hook, so they cannot leave tools restricted.
  pi.on('before_agent_start', (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => {
    const task = projectInstructionsTask(event.prompt);
    if (!task) return;
    active = { cwd: resolve(ctx.cwd), mode: task.mode, tools: pi.getActiveTools() };
    pi.setActiveTools([...active.tools.filter((name: string) => readTools.has(name)), ...(task.mode === 'create' ? [createTool] : [])]);
    return { systemPrompt: `${event.systemPrompt}\n\n${event.prompt}` };
  });
  pi.on('message_end', (event: { message: { role: string; content: any } }) => {
    const message = event.message;
    if (!active || message.role !== 'user') return;
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    if (!Array.isArray(blocks) || blocks.length !== 1 || blocks[0].type !== 'text' || !projectInstructionsInput(blocks[0].text)) return;
    // Native replacement updates agent state and JSONL before search indexes the input.
    return { message: { ...message, content: [{ type: 'text', text: '/init' }] } };
  });
}
