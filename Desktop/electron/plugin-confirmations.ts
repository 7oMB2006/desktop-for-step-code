import { createHash } from 'node:crypto';
import { ConnectorJsonStore } from './external-connector-gateway';
import type { PluginConfirmation, PluginConfirmationAction, PluginConfirmationBinding, PluginConfirmationSource } from '../src/plugin-confirmations';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface PluginConfirmationRequest {
  source: PluginConfirmationSource;
  notice: PluginConfirmation;
  summary: string;
}
// This boundary is main-only: neither the model protocol nor plugin code can answer it.
export class PluginConfirmations {
  private store: ConnectorJsonStore;
  private active?: { agentId: string; invalidated: boolean };
  constructor(root: string, private options: {
    resolve(binding: PluginConfirmationBinding): Promise<PluginConfirmationSource>;
    confirm(request: PluginConfirmationRequest): Promise<{ confirmed: boolean; remember: boolean }>;
  }) { this.store = new ConnectorJsonStore(root, 'plugin-confirmations/acknowledgements.json'); }
  invalidate(agentId?: string) {
    if (this.active && (!agentId || this.active.agentId === agentId)) this.active.invalidated = true;
  }
  async run<T>(input: {
    binding?: PluginConfirmationBinding;
    agentId: string;
    authorization: string;
    action: PluginConfirmationAction;
    scope: unknown;
    summary: string;
    validate(): Promise<void>;
    execute(valid: () => boolean): Promise<T>;
  }): Promise<T> {
    if (!input.binding) { await input.validate(); return input.execute(() => true); }
    if (this.active) throw new Error('connector:confirmation-busy');
    const active = { agentId: input.agentId, invalidated: false };
    this.active = active;
    const valid = async () => {
      if (active.invalidated) throw new Error('connector:revoked');
      await input.validate();
      if (active.invalidated) throw new Error('connector:revoked');
    };
    try {
      await valid();
      const source = await this.options.resolve(input.binding);
      const notice = source.confirmations.find(item => item.action === input.action);
      const current = async () => {
        await valid();
        const next = await this.options.resolve(input.binding!);
        if (hash(next) !== hash(source)) throw new Error('connector:confirmation-stale');
        await valid();
      };
      if (notice) {
        const key = hash([source.binding, source.revision, notice, input.authorization, input.action, input.scope]);
        const stored = await this.store.load();
        if (stored !== undefined && (!stored || typeof stored !== 'object' || Array.isArray(stored)
          || (stored as any).version !== 1 || !Array.isArray((stored as any).keys)
          || (stored as any).keys.length > 256 || (stored as any).keys.some((key: unknown) =>
            typeof key !== 'string' || !/^[a-f0-9]{64}$/u.test(key)))) throw new Error('connector:storage');
        const keys: string[] = stored === undefined ? [] : (stored as { keys: string[] }).keys;
        if (notice.policy === 'always' || !keys.includes(key)) {
          const answer = await this.options.confirm({ source, notice, summary: input.summary });
          if (answer.confirmed !== true) throw new Error('connector:confirmation-cancelled');
          await current();
          if (notice.policy === 'remember' && answer.remember === true)
            await this.store.save({ version: 1, keys: [...keys.filter(item => item !== key), key].slice(-256) });
        }
      }
      await current();
      return await input.execute(() => !active.invalidated);
    } finally { this.active = undefined; }
  }
}
