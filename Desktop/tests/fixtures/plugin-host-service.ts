import type { TestContext } from 'node:test';
import { cp, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PluginHostBroker } from '../../electron/plugin-host-broker';
import { StepPluginHostProvider } from '../../electron/plugin-host-step';
import { PluginHostBindingStore } from '../../electron/plugin-host-contract.mjs';
import { installationReceipt, packageFingerprint, writeReceipts } from '../../electron/plugin-files.mjs';
import type { SessionRuntime, SessionRuntimes } from '../../electron/session-runtimes';

export async function hostService(t: Pick<TestContext, 'after'>, options: {
  capabilities?: Array<'model.text' | 'model.video' | 'model.asr' | 'model.tts'>;
  profile?: string; configured?: boolean; settings?: boolean; request?: typeof fetch;
  packageDirectory?: string;
  command?: string;
  serverWrapper?: string;
  budgets?: { lease?: number; queue?: number; confirmation?: number; provider?: number };
} = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-host-service-')));
  let broker: PluginHostBroker | undefined;
  t.after(async () => {
    try { await broker?.close(); }
    finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
  const directory = join(root, 'plugins', 'example');
  await mkdir(directory, { recursive: true });
  if (options.packageDirectory) await cp(options.packageDirectory, directory, { recursive: true });
  const manifest = { id: 'dfsc-host-example', mcpServers: { example: { command: options.command ?? 'node',
    args: options.serverWrapper ? [options.serverWrapper, 'dist/server.mjs'] : ['dist/server.mjs'],
    ...(options.settings ? { env: { STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' } } : {}) } } };
  await writeFile(join(directory, 'step.plugin.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'dfsc.host.json'), JSON.stringify({ schemaVersion: 1, hostApiVersion: 1,
    consumer: { kind: 'mcp-stdio', server: 'example' }, capabilities: options.capabilities ?? ['model.text'] }));
  if (options.settings) await writeFile(join(directory, 'dfsc.settings.json'), JSON.stringify({
    schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'example' },
    groups: [{ id: 'connection', title: 'Connection', fields: [
      { id: 'key', label: 'Independent key', type: 'secret', required: true },
    ] }],
  }));
  const fingerprint = await packageFingerprint(directory);
  const receipt = installationReceipt({ name: 'example' }, { name: 'fixture', kind: 'local', path: root }, manifest, fingerprint);
  receipt.state = 'installed';
  await writeReceipts(root, { version: 1, installations: [receipt] });
  const descriptor = { root: directory, kind: 'installed', name: 'example', id: receipt.id,
    fingerprint, instance: receipt.instance, provenance: 'recorded', ref: 'fixture' };
  const state = { auth: { step: { type: 'oauth', access: 'fixture-main-private-key',
    profile: options.profile ?? 'step_plan', expires: Date.now() + 3600000 } } as Record<string, any>,
    changing: false, transportAllowed: true, approved: true, confirmations: [] as string[],
    confirm: undefined as ((signal?: AbortSignal) => Promise<boolean>) | undefined };
  const worker = { id: randomUUID(), status: 'connected', state: { sessionId: randomUUID(),
    model: { provider: 'step', id: 'step-5-preview', input: ['text', 'image'] } },
    rpc: { request: async () => worker.state } } as unknown as SessionRuntime;
  const pool = { workers: new Map([[worker.id, worker]]), activeId: worker.id,
    confirm: async (_worker: SessionRuntime, _title: string, message: string, signal?: AbortSignal) => {
      state.confirmations.push(message);
      return state.confirm ? state.confirm(signal) : state.approved;
    } } as unknown as SessionRuntimes;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new StepPluginHostProvider(pool, () => state.auth, () => state.changing, async (url, init) => {
    calls.push({ url: String(url), init });
    return options.request ? options.request(url, init) : Response.json({ choices: [{ message: { content: 'host result' } }] });
  });
  const store = new PluginHostBindingStore(root);
  if (options.configured !== false) await store.select(descriptor, { revision: 'unconfigured', mode: 'follow' });
  broker = new PluginHostBroker({ root, pool, provider, language: () => 'zh',
    validateConsumer: async () => state.transportAllowed, budgets: options.budgets });
  await broker.start();
  return { root, directory, descriptor, receipt, state, worker, pool, provider, store, broker, calls };
}
