import { join } from 'node:path';
import { RpcProcess } from './runtime';
import type { CapabilityCatalog, CapabilityMutation, CapabilityResult } from '../src/capabilities';

export async function assertPluginUnused(id: string, workers: Iterable<{
  rpc: { request(type: string): Promise<unknown> };
}>) {
  try {
    for (const worker of workers) {
      const summary = await worker.rpc.request('get_desktop_summary') as { mcp?: { name: string; status: string }[] };
      if (!Array.isArray(summary?.mcp) || summary.mcp.some(server =>
        server.name.startsWith(`${id}__`) && server.status !== 'disabled'))
        throw new Error('capability:resource-in-use');
    }
  } catch {
    // A missing observation cannot establish that Windows has released a directory.
    throw new Error('capability:resource-in-use');
  }
}

export class CapabilityService {
  private workers = new Set<RpcProcess>();
  constructor(private options: {
    root: string; runtime: string; node: string; environment(): NodeJS.ProcessEnv;
  }) {}
  private async request(type: string, args: Record<string, unknown> = {}) {
    const { root, runtime, node } = this.options;
    const worker = new RpcProcess(() => {});
    this.workers.add(worker);
    try {
      // A dedicated, short-lived management worker keeps upstream HOME discovery
      // inside Desktop without changing the environment of any live agent.
      worker.start(node, join(runtime, 'capability-admin.mjs'), root, {
        ...this.options.environment(), HOME: root, USERPROFILE: root,
      });
      return await worker.request(type, args, type === 'catalog' ? 30000 : 150000);
    } finally { await worker.stop(); this.workers.delete(worker); }
  }
  catalog(): Promise<CapabilityCatalog> { return this.request('catalog'); }
  mutate(input: CapabilityMutation): Promise<CapabilityResult> {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || JSON.stringify(input).length > 150000) throw new Error('capability:invalid-input');
    return this.request('mutate', { input });
  }
  importSkill(path: string): Promise<CapabilityResult> { return this.request('import', { path }); }
  async stop() { await Promise.all([...this.workers].map(worker => worker.stop())); }
}
