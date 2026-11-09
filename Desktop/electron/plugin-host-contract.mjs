import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { PluginConfigurationStore } from './plugin-configuration.mjs';
import { digest, optionalFile, packageFingerprint, plainFile, readReceipts, writePrivateData, PluginFileError } from './plugin-files.mjs';
import { parseHostDeclaration, parseLaunch, parseModelSelection, hash, keys } from '../../examples/plugins/host-client/protocol.mjs';

export { parseHostDeclaration } from '../../examples/plugins/host-client/protocol.mjs';
const fail = (code = 'stale') => { throw new PluginFileError(code); };
const freshRevision = () => createHash('sha256').update(randomUUID()).digest('hex');

// Candidate-only: the production launcher does not issue this context yet.
export class PluginHostBindingStore {
  queue = Promise.resolve();
  constructor(root) {
    this.root = root;
    this.configurations = new PluginConfigurationStore(root);
  }
  async identity(descriptor) {
    if (descriptor.kind !== 'installed' || descriptor.provenance !== 'recorded' || !descriptor.instance) fail();
    const receipts = await readReceipts(this.root);
    const receipt = receipts.installations.find(item => item.instance === descriptor.instance
      && item.id === descriptor.id && item.folder === descriptor.name && item.state === 'installed'
      && item.fingerprint === descriptor.fingerprint);
    if (!receipt || resolve(descriptor.root) !== resolve(this.root, 'plugins', receipt.folder)
      || await packageFingerprint(descriptor.root) !== receipt.fingerprint) fail();
    const bytes = await plainFile(descriptor.root, 'dfsc.host.json', 65536);
    const manifest = JSON.parse((await plainFile(descriptor.root, 'step.plugin.json')).toString('utf8'));
    if (manifest.id !== receipt.id) fail();
    const declaration = parseHostDeclaration(JSON.parse(bytes.toString('utf8')), manifest);
    return { receipt, declaration, declarationHash: digest(bytes) };
  }
  async current(descriptor) {
    const identity = await this.identity(descriptor);
    const path = `desktop-plugins/host/bindings/${identity.receipt.instance}.json`;
    const pointer = await optionalFile(this.root, path);
    if (!pointer) return { ...identity, revision: 'unconfigured' };
    let binding, snapshot;
    try {
      binding = JSON.parse(pointer);
      keys(binding, ['version', 'revision', 'contentHash']);
      if (binding.version !== 1 || !hash(binding.revision) || !hash(binding.contentHash)) fail();
      const bytes = await plainFile(this.root,
        `desktop-plugins/host/selections/${identity.receipt.instance}/${binding.revision}.json`);
      if (digest(bytes) !== binding.contentHash) fail();
      snapshot = JSON.parse(bytes);
      keys(snapshot, ['version', 'instance', 'pluginId', 'fingerprint', 'declarationHash',
        'consumer', 'revision', 'mode', 'configurationRevision', 'models']);
    } catch { fail(); }
    const { receipt, declaration, declarationHash } = identity;
    if (snapshot.version !== 1 || snapshot.instance !== receipt.instance || snapshot.pluginId !== receipt.id
      || snapshot.fingerprint !== receipt.fingerprint || snapshot.declarationHash !== declarationHash
      || snapshot.consumer !== declaration.consumer.server || snapshot.revision !== binding.revision
      || !['follow', 'independent'].includes(snapshot.mode)) fail();
    parseModelSelection(snapshot.models, declaration.capabilities);
    if (snapshot.mode === 'follow' && snapshot.configurationRevision !== null) fail();
    if (snapshot.mode === 'independent' && (!hash(snapshot.configurationRevision)
      || Object.keys(snapshot.models).length)) fail();
    let configurationCurrent = snapshot.mode === 'follow';
    if (snapshot.mode === 'independent') {
      try {
        const configuration = await this.configurations.context(descriptor);
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
    if (!input || Object.keys(input).some(key => !['revision', 'mode', 'configurationRevision', 'models'].includes(key))
      || !['follow', 'independent'].includes(input.mode)) fail('invalid-configuration');
    const before = await this.current(descriptor);
    if (before.revision !== input.revision) fail('stale-configuration');
    let configurationRevision = null;
    let models = {};
    if (input.mode === 'independent') {
      if (input.models !== undefined) fail('invalid-configuration');
      const configuration = await this.configurations.context(descriptor);
      if (!configuration.committed || configuration.schema.consumer.server !== before.declaration.consumer.server
        || configuration.saved.revision !== input.configurationRevision) fail('invalid-configuration');
      configurationRevision = configuration.saved.revision;
    } else {
      if (input.configurationRevision !== undefined) fail('invalid-configuration');
      models = parseModelSelection(input.models ?? {}, before.declaration.capabilities);
    }
    const { receipt, declarationHash, declaration } = before;
    const revision = freshRevision();
    const snapshot = { version: 1, instance: receipt.instance, pluginId: receipt.id, fingerprint: receipt.fingerprint,
      declarationHash, consumer: declaration.consumer.server, revision, mode: input.mode, configurationRevision, models };
    const serialized = `${JSON.stringify(snapshot)}\n`;
    await writePrivateData(this.root, `desktop-plugins/host/selections/${receipt.instance}/${revision}.json`, snapshot);
    if ((await this.current(descriptor)).revision !== before.revision) fail('stale-configuration');
    // Only this pointer commits a mode. Unreferenced snapshots cannot become active after a crash.
    await writePrivateData(this.root, `desktop-plugins/host/bindings/${receipt.instance}.json`,
      { version: 1, revision, contentHash: digest(serialized) });
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
    const context = { version: 'dfsc-launch-v1', mode: current.mode, pluginId: current.pluginId,
      consumer: current.consumer, instance: current.instance, fingerprint: current.fingerprint,
      declarationHash: current.declarationHash, revision: current.revision,
      configurationRevision: current.configurationRevision, launchId: randomUUID(),
      runtimeId: trusted.runtimeId, sessionId: trusted.sessionId, accountRevision: trusted.accountRevision,
      capabilities: current.declaration.capabilities, models: current.models, dataDirectory,
      ...(current.mode === 'follow' ? { broker: trusted.broker } : {}) };
    return parseLaunch(context, { pluginId: current.pluginId, consumer: current.consumer });
  }
}
