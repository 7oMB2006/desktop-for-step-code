import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_GLOBAL_INSTRUCTIONS_LENGTH, type GlobalInstructions } from '../src/global-instructions';

// Match the runtime's global-context discovery order, including existing manual files.
const CONTEXT_FILES = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'];
export class GlobalInstructionsStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly agentDir: string) {}

  private async load() {
    try {
      const directory = await lstat(this.agentDir);
      if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('GLOBAL_INSTRUCTIONS_UNAVAILABLE');
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const name of CONTEXT_FILES) {
      const path = join(this.agentDir, name);
      let info;
      try { info = await lstat(path); }
      catch (error: any) { if (error.code === 'ENOENT') continue; throw error; }
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('GLOBAL_INSTRUCTIONS_UNAVAILABLE');
      if (info.size > MAX_GLOBAL_INSTRUCTIONS_LENGTH * 4 + 3) throw new Error('GLOBAL_INSTRUCTIONS_TOO_LARGE');
      const bytes = await readFile(path);
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const revision = createHash('sha256').update(name).update('\0').update(bytes).digest('hex');
      return { path, content, revision };
    }
    return { path: join(this.agentDir, 'AGENTS.md'), content: '', revision: 'missing' };
  }

  async read(): Promise<GlobalInstructions> {
    await this.writes.catch(() => {});
    const { content, revision } = await this.load();
    return { content, revision };
  }

  save(content: unknown, revision: unknown): Promise<GlobalInstructions> {
    if (typeof content !== 'string' || content.includes('\0') || typeof revision !== 'string' || revision.length > 100)
      return Promise.reject(new Error('GLOBAL_INSTRUCTIONS_INVALID'));
    if (content.length > MAX_GLOBAL_INSTRUCTIONS_LENGTH)
      return Promise.reject(new Error('GLOBAL_INSTRUCTIONS_TOO_LARGE'));
    const write = this.writes.catch(() => {}).then(async () => {
      const current = await this.load();
      if (current.revision !== revision) throw new Error('GLOBAL_INSTRUCTIONS_CONFLICT');
      if (current.content === content) return { content, revision: current.revision };
      await mkdir(this.agentDir, { recursive: true });
      const temporary = join(this.agentDir, `.instructions-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporary, current.path);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      }
      const saved = await this.load();
      return { content: saved.content, revision: saved.revision };
    });
    this.writes = write;
    return write;
  }
}
