import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { PluginConfigurationStore } from './plugin-configuration.mjs';
import { digest, optionalFile, plainFile, readReceipts, writePrivateData, PluginFileError } from './plugin-files.mjs';
import { verifyPackage } from './plugin-read-scope.mjs';
import { CAPABILITIES, parseHostDeclaration, parseIndependentCapabilities, parseLaunch, parseModelSelection, hash, id, keys } from '../../examples/plugins/host-client/protocol.mjs';

export { parseHostDeclaration } from '../../examples/plugins/host-client/protocol.mjs';
const fail = (code = 'stale') => { throw new PluginFileError(code); };
const freshRevision = () => createHash('sha256').update(randomUUID()).digest('hex');
export function parseHostModels(value, declared) {
  keys(value, CAPABILITIES, []);
  for (const [capability, model] of Object.entries(value))
    if (!declared.includes(capability) || typeof model !== 'string' || !model.trim()
      || model.length > 160 || /[\u0000-\u001f]/u.test(model)) fail('invalid-configuration');
  return { ...value };
}

function validAccount(account) {
  keys(account, ['id', 'channel', 'region']);
  if (!hash(account.id) || !['plan', 'api'].includes(account.channel) || !['cn', 'oversea'].includes(account.region))
    fail('invalid-configuration');
}
export function parseHostIndependent(value, declared, models) {
  let selected;
  try { selected = parseIndependentCapabilities(value, declared); }
  catch { fail('invalid-configuration'); }
  if (selected.some(id => Object.hasOwn(models, id))) fail('invalid-configuration');
  return selected;
}
export function usesHostBroker(binding) {
  return binding.mode === 'follow' || binding.mode === 'routed' && Boolean(binding.account);
}

// Main-only mode snapshots, shared by settings and the verified native launcher.
export class PluginHostBindingStore {
  queue = Promise.resolve();
  constructor(root) {
    this.root = root;
    this.configurations = new PluginConfigurationStore(root);
  }
  async identity(descriptor, scope) {
    if (descriptor.kind !== 'installed' || descriptor.provenance !== 'recorded' || !descriptor.instance) fail();
    const receipts = await readReceipts(this.root);
    const receipt = receipts.installations.find(item => item.instance === descriptor.instance
      && item.id === descriptor.id && item.folder === descriptor.name && item.state === 'installed'
      && item.fingerprint === descriptor.fingerprint);
    if (!receipt || resolve(descriptor.root) !== resolve(this.root, 'plugins', receipt.folder)) fail();
    await verifyPackage(descriptor, scope);
    const bytes = await plainFile(descriptor.root, 'dfsc.host.json', 65536);
    const manifest = JSON.parse((await plainFile(descriptor.root, 'step.plugin.json')).toString('utf8'));
    if (manifest.id !== receipt.id) fail();
    const declaration = parseHostDeclaration(JSON.parse(bytes.toString('utf8')), manifest);
    return { receipt, declaration, declarationHash: digest(bytes) };
  }
  async current(descriptor, scope) {
    const identity = await this.identity(descriptor, scope);
    const path = `desktop-plugins/host/bindings/${identity.receipt.instance}.json`;
    const pointer = await optionalFile(this.root, path);
    if (!pointer) return { ...identity, revision: 'unconfigured' };
    let binding, snapshot;
    try {
      binding = JSON.parse(pointer);
      keys(binding, ['version', 'revision', 'contentHash']);
      if (![1, 2, 3, 4].includes(binding.version) || !hash(binding.revision) || !hash(binding.contentHash)) fail();
      const bytes = await plainFile(this.root,
        `desktop-plugins/host/selections/${identity.receipt.instance}/${binding.revision}.json`);
      if (digest(bytes) !== binding.contentHash) fail();
      snapshot = JSON.parse(bytes);
      const fields = ['version', 'instance', 'pluginId', 'fingerprint', 'declarationHash',
        'consumer', 'revision', 'mode', 'configurationRevision', 'models'];
      const required = binding.version === 4 ? [...fields, 'independentCapabilities'] : fields;
      keys(snapshot, binding.version === 1 ? required : [...required, 'account'], required);
    } catch { fail(); }
    const { receipt, declaration, declarationHash } = identity;
    if (snapshot.version !== binding.version || snapshot.instance !== receipt.instance || snapshot.pluginId !== receipt.id
      || !hash(snapshot.fingerprint) || !hash(snapshot.declarationHash) || !id(snapshot.consumer)
      || snapshot.revision !== binding.revision
      || !(binding.version === 4 ? snapshot.mode === 'routed'
        : binding.version === 3 ? ['paused', 'independent'].includes(snapshot.mode)
        : binding.version === 2 ? snapshot.mode === 'follow' : ['follow', 'independent'].includes(snapshot.mode))) fail();
    const parseModels = snapshot.version === 1 ? parseModelSelection : parseHostModels;
    parseModels(snapshot.models, CAPABILITIES);
    if (snapshot.version === 2 || snapshot.account !== undefined) validAccount(snapshot.account);
    const direct = snapshot.mode === 'independent' || snapshot.mode === 'routed';
    if (direct ? !hash(snapshot.configurationRevision) : snapshot.configurationRevision !== null) fail();
    if (snapshot.mode === 'routed') {
      parseHostIndependent(snapshot.independentCapabilities, CAPABILITIES, snapshot.models);
      if (Boolean(snapshot.account) !== Boolean(Object.keys(snapshot.models).length)) fail();
    }
    if ((snapshot.mode === 'independent' || snapshot.mode === 'paused') && !snapshot.account
      && Object.keys(snapshot.models).length) fail();
    // A package update revokes the old selection, but must not prevent explicit reselection.
    if (snapshot.fingerprint !== receipt.fingerprint) return { ...identity, revision: 'unconfigured' };
    if (snapshot.declarationHash !== declarationHash || snapshot.consumer !== declaration.consumer.server) fail();
    parseModels(snapshot.models, declaration.capabilities);
    if (snapshot.mode === 'routed')
      parseHostIndependent(snapshot.independentCapabilities, declaration.independentCapabilities ?? [], snapshot.models);
    let configurationCurrent = snapshot.mode === 'follow' && snapshot.version === 2;
    if (direct) {
      try {
        const configuration = await this.configurations.context(descriptor, scope);
        configurationCurrent = configuration.schema.consumer.server === snapshot.consumer
          && configuration.committed && configuration.saved.revision === snapshot.configurationRevision;
      } catch { configurationCurrent = false; }
    }
    return { ...snapshot, ...identity, configurationCurrent };
  }
  select(descriptor, input) {
    const operation = this.queue.then(() => this.write(descriptor, input));
    this.queue = operation.catch(() => {});
    return operation;
  }
  async write(descriptor, input) {
    if (!input || Object.keys(input).some(key => !['revision', 'mode', 'configurationRevision', 'models', 'account', 'independentCapabilities'].includes(key))
      || !['follow', 'independent', 'paused', 'routed'].includes(input.mode)
      || input.mode !== 'routed' && input.independentCapabilities !== undefined) fail('invalid-configuration');
    const before = await this.current(descriptor);
    if (before.revision !== input.revision) fail('stale-configuration');
    let configurationRevision = null;
    let models = {}, account, independentCapabilities;
    if (input.mode === 'routed') {
      models = parseHostModels(input.models ?? {}, before.declaration.capabilities);
      independentCapabilities = parseHostIndependent(input.independentCapabilities, before.declaration.independentCapabilities ?? [], models);
      if (Object.keys(models).length) { validAccount(input.account); account = input.account; }
      else if (input.account !== undefined) fail('invalid-configuration');
    } else if (input.mode === 'follow') {
      if (input.configurationRevision !== undefined) fail('invalid-configuration');
      validAccount(input.account);
      account = input.account;
      models = parseHostModels(input.models ?? {}, before.declaration.capabilities);
    } else {
      if (input.models !== undefined || input.account !== undefined) fail('invalid-configuration');
      if (input.mode === 'paused' && (input.configurationRevision !== undefined || !('mode' in before))) fail('invalid-configuration');
      // Keep the previous official selection as a draft, without issuing a lease.
      if ('mode' in before && before.account) ({ account, models } = before);
    }
    if (input.mode === 'independent' || input.mode === 'routed') {
      const configuration = await this.configurations.context(descriptor);
      if (!configuration.committed || configuration.schema.consumer.server !== before.declaration.consumer.server
        || configuration.saved.revision !== input.configurationRevision) fail('invalid-configuration');
      configurationRevision = configuration.saved.revision;
    }
    const { receipt, declarationHash, declaration } = before;
    const revision = freshRevision();
    const version = input.mode === 'routed' ? 4 : input.mode === 'follow' ? 2 : input.mode === 'paused' || account ? 3 : 1;
    const snapshot = { version, instance: receipt.instance, pluginId: receipt.id, fingerprint: receipt.fingerprint,
      declarationHash, consumer: declaration.consumer.server, revision, mode: input.mode, configurationRevision, models,
      ...(account ? { account } : {}), ...(independentCapabilities ? { independentCapabilities } : {}) };
    const serialized = `${JSON.stringify(snapshot)}\n`;
    await writePrivateData(this.root, `desktop-plugins/host/selections/${receipt.instance}/${revision}.json`, snapshot);
    if ((await this.current(descriptor)).revision !== before.revision) fail('stale-configuration');
    // Only this pointer commits a mode. Unreferenced snapshots cannot become active after a crash.
    await writePrivateData(this.root, `desktop-plugins/host/bindings/${receipt.instance}.json`,
      { version, revision, contentHash: digest(serialized) });
    return this.current(descriptor);
  }
  async launch(descriptor, trusted) {
    const current = await this.current(descriptor);
    if (current.revision === 'unconfigured') fail('invalid-configuration');
    if (!current.configurationCurrent) fail('stale-configuration');
    const dataDirectory = join(this.root, 'desktop-plugins', 'data', current.instance);
    await writePrivateData(this.root, `desktop-plugins/data/${current.instance}/.dfsc-owner.json`,
      { version: 1, instance: current.instance });
    const rechecked = await this.current(descriptor);
    if (rechecked.revision !== current.revision || !rechecked.configurationCurrent) fail('stale-configuration');
    const broker = usesHostBroker(current);
    const context = { version: 'dfsc-launch-v1', mode: broker ? 'follow' : 'independent', pluginId: current.pluginId,
      consumer: current.consumer, instance: current.instance, fingerprint: current.fingerprint,
      declarationHash: current.declarationHash, revision: current.revision,
      configurationRevision: current.configurationRevision, launchId: randomUUID(),
      runtimeId: trusted.runtimeId, sessionId: trusted.sessionId, accountRevision: trusted.accountRevision,
      capabilities: current.mode === 'routed'
        ? broker ? Object.keys(current.models) : current.independentCapabilities : current.declaration.capabilities,
      ...(current.independentCapabilities ? { independentCapabilities: current.independentCapabilities } : {}),
      models: broker
        ? Object.fromEntries(Object.entries(current.models).filter(([id]) => id === 'model.asr' || id === 'model.tts')) : {},
      dataDirectory,
      ...(broker ? { broker: trusted.broker } : {}) };
    return parseLaunch(context, { pluginId: current.pluginId, consumer: current.consumer });
  }
}
