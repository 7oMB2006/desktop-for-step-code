import { lstat, open, readdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectInstructionsStatus } from '../src/project-instructions';
import { isProjectInstructionsCommand, projectInstructionsPrompt } from '../src/project-instructions';

export const MAX_RULE_BYTES = 128 * 1024;

export async function projectInstructionsMessage(cwd: string, message: string, attachments = 0): Promise<string> {
  if (!isProjectInstructionsCommand(message, attachments)) return message;
  const { mode, fileName } = await inspectProjectInstructions(cwd);
  if (mode !== 'create' && mode !== 'review') throw new Error('Project rules are unavailable');
  return projectInstructionsPrompt(mode, fileName);
}

export async function inspectProjectInstructions(cwd: string): Promise<ProjectInstructionsStatus & { fileName: string }> {
  const names = (await readdir(cwd)).filter(name => /^agents\.md$/i.test(name));
  if (names.length > 1) throw new Error('Multiple AGENTS.md files differ only by case; resolve them before continuing');
  if (!names.length) return { mode: 'create', fileName: 'AGENTS.md' };
  const fileName = names[0];
  const path = join(cwd, fileName);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('AGENTS.md must be a regular project file, not a link or directory');
  if (info.size > MAX_RULE_BYTES) throw new Error('AGENTS.md is too large for this check');
  const file = await open(path, 'r');
  try {
    const current = await file.stat();
    if (!current.isFile() || current.size > MAX_RULE_BYTES) throw new Error('AGENTS.md changed while being checked');
    await file.read(Buffer.alloc(1), 0, 1, 0);
  } finally { await file.close(); }
  return { mode: 'review', fileName };
}

export async function createProjectInstructions(cwd: string, content: unknown) {
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > MAX_RULE_BYTES)
    throw new Error('Project rules must contain 1 to 131072 UTF-8 bytes');
  const canonical = await realpath(cwd);
  if ((await inspectProjectInstructions(canonical)).mode !== 'create')
    throw new Error('AGENTS.md already exists; run /init again to check it instead');
  // Exclusive creation is the final guard if another writer wins after detection.
  await writeFile(join(canonical, 'AGENTS.md'), content, { encoding: 'utf8', flag: 'wx' });
  return { created: true, fileName: 'AGENTS.md' };
}
