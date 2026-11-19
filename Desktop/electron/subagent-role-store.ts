import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { Model } from '../src/contracts';
import { isSubagentRole, parseSubagentRoleModel, subagentModelLevels, type SubagentRoleModels } from '../src/subagent-role-models';

export class SubagentRoleStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  async read(): Promise<SubagentRoleModels> {
    const raw = await readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return '{"version":1,"roles":{}}';
    });
    const record = JSON.parse(raw);
    if (record?.version !== 1 || !record.roles || typeof record.roles !== 'object' || Array.isArray(record.roles))
      throw new Error('Invalid subagent role settings');
    const result: SubagentRoleModels = {};
    for (const [role, entry] of Object.entries(record.roles)) {
      if (!isSubagentRole(role)) throw new Error('Invalid subagent role');
      result[role] = parseSubagentRoleModel(entry);
    }
    return result;
  }

  save(role: unknown, value: unknown, catalog: readonly Model[]): Promise<SubagentRoleModels> {
    const operation = this.writes.then(async () => {
      if (!isSubagentRole(role)) throw new Error('Unknown subagent role');
      const roles = await this.read();
      if (value === null) delete roles[role];
      else {
        const entry = parseSubagentRoleModel(value);
        const model = catalog.find(item => item.provider === entry.provider && item.id === entry.id);
        if (!model || !subagentModelLevels(model).includes(entry.effort)) throw new Error('Unavailable subagent model or thinking level');
        roles[role] = entry;
      }
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify({ version: 1, roles }), { flag: 'wx', mode: 0o600 });
        await rename(tmp, this.file);
      } finally {
        await unlink(tmp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      }
      return roles;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
}
