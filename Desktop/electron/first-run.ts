import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Outcome = 'pending' | 'completed' | 'skipped' | 'existing';
interface Record { version: 1; outcome: Outcome }

async function exists(path: string) {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export class FirstRun {
  private record?: Record;
  private readonly file: string;

  constructor(private readonly root: string) { this.file = join(root, 'first-run.json'); }

  get required() { return this.record?.outcome === 'pending'; }

  async initialize() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (value?.version !== 1 || !['pending', 'completed', 'skipped', 'existing'].includes(value.outcome))
        throw new Error('Invalid first-run record');
      this.record = value;
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Optional onboarding metadata must never lock an existing user out.
        // Preserve unreadable/future records and do not reclassify the profile as new.
        this.record = { version: 1, outcome: 'existing' };
        return;
      }
    }
    const runtime = join(this.root, 'step-runtime');
    const existing = (await Promise.all([
      join(this.root, 'preferences.json'),
      ...['config.toml', 'auth.json', 'auth.dpapi', 'legacy-auth.json', 'models.json'].map(name => join(runtime, name)),
    ].map(exists))).some(Boolean);
    let history = false;
    try { history = (await readdir(join(runtime, 'sessions'))).length > 0; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await this.save({ version: 1, outcome: existing || history ? 'existing' : 'pending' });
  }

  async finish(outcome: 'completed' | 'skipped') {
    if (!['completed', 'skipped'].includes(outcome)) throw new Error('Invalid first-run outcome');
    if (!this.record) throw new Error('First-run state is not ready');
    if (!this.required) return;
    await this.save({ version: 1, outcome });
  }

  private async save(record: Record) {
    await mkdir(this.root, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(record), { flag: 'wx' });
      await rename(temporary, this.file);
      this.record = record;
    } finally { await unlink(temporary).catch(() => {}); }
  }
}
