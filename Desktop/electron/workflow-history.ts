import { open, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { Message } from '../src/contracts';
import { projectWorkflow, preserveWorkflow } from '../src/workflow-state';

/** Read only the bounded, runtime-owned progress file; never follow result scriptPath. */
export async function hydrateWorkflowHistory(cwd: string, messages: Message[]): Promise<Message[]> {
  return Promise.all(messages.map(async message => {
    if (message.role !== 'toolResult' || message.toolName !== 'workflow' || !message.toolCallId) return message;
    const current = projectWorkflow(message.details, message.toolCallId);
    if (!current?.runId) return message;
    try {
      const root = await realpath(cwd);
      const file = await realpath(join(root, '.stepcode', 'workflows', 'runs', current.runId, 'progress.json'));
      const rel = relative(root, file);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../')) return message;
      const handle = await open(file, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 1024 * 1024) return message;
        const buffer = Buffer.alloc(1024 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 1024 * 1024) return message;
        const saved = projectWorkflow(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')), message.toolCallId);
        if (saved?.runId !== current.runId || (current.startedAt !== undefined && saved.startedAt !== current.startedAt)) return message;
        return preserveWorkflow({ ...message, desktopWorkflow: saved }, message);
      } finally { await handle.close(); }
    } catch { return preserveWorkflow(undefined, message); }
  }));
}
