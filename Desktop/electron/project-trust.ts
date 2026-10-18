import { realpath, stat } from 'node:fs/promises';
import { normalizedWorkspaceKey } from '../src/workspace-key';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';

export function isProjectTrustInput(data: Record<string, unknown>): boolean {
  if (typeof data.message !== 'string' || !/^\s*\/trust(?:\s|$)/.test(data.message)) return false;
  if (data.message.trim() !== '/trust' || data.images !== undefined && (!Array.isArray(data.images) || data.images.length)
    || data.files !== undefined && (!Array.isArray(data.files) || data.files.length)) {
    throw new Error('Use /trust by itself, without arguments or attachments');
  }
  return true;
}

// Save through the native trust store, never by letting a model edit trust.json.
// Like upstream /trust, this affects future launches, not the current host.
export async function trustProject(pool: SessionRuntimes, worker: SessionRuntime,
  save: (cwd: string) => Promise<unknown>, language: 'zh' | 'en') {
  const transport = worker.rpc;
  const cwd = worker.cwd;
  const assertCurrent = () => {
    if (pool.require(worker.id) !== worker || worker.rpc !== transport || worker.cwd !== cwd)
      throw new Error('Session changed while awaiting project trust');
    if (worker.operations || worker.stopping) throw new Error('Session operation in progress');
  };
  assertCurrent();
  if (worker.mutating) throw new Error('Session operation in progress');
  worker.mutating = true;
  try {
    await pool.assertIdle(worker);
    const canonical = await realpath(cwd);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Project folder is unavailable');
    assertCurrent();
    const zh = language === 'zh';
    const approved = await pool.confirm(worker, zh ? '信任此项目？' : 'Trust this project?',
      zh ? `目录：${canonical}\n\n信任会允许加载此项目的设置、技能、提示词与扩展，可能安装项目依赖并执行扩展代码；也允许持久定时任务。项目文件可能包含提示词注入，请仅信任已核实的项目。\n\n决定保存在 Desktop 独立配置中，并按上游规则对该目录及子目录生效。仅在之后重启或新开运行时时加载，不会自动重启当前或其他已打开会话。完全访问权限不等于项目信任。`
        : `Folder: ${canonical}\n\nTrust permits project settings, skills, prompts and extensions, including dependency installation and extension code execution, as well as durable scheduled tasks. Project files may contain prompt injection. Only trust projects you have verified.\n\nThe decision is saved in the Desktop profile and applies to this folder and its descendants under upstream rules. It takes effect on later runtime launches, without restarting this or other open sessions. Full Access is separate from project trust.`,
      undefined, { cwd: canonical });
    if (!approved) return { cancelled: true };
    assertCurrent();
    await pool.assertIdle(worker);
    if (normalizedWorkspaceKey(await realpath(cwd), process.platform) !== normalizedWorkspaceKey(canonical, process.platform)
      || !(await stat(canonical)).isDirectory()) throw new Error('Project folder changed while awaiting approval');
    assertCurrent();
    await save(canonical);
    return { saved: true };
  } finally {
    worker.mutating = false;
    pool.publish();
  }
}
