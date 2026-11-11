// Desktop adapter for the upstream MVP's user-scope management operations.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, readdir, rename, rm, cp, writeFile, open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { dataOnlyThemeFingerprint, installationReceipt, object, optionalFile, packageFingerprint, plainFile, readReceipts, scanInstalled,
  sourceIdentity, writePrivateData, writePrivateJson, writeReceipts } from './plugin-files.mjs';
import { applyPluginUpdate, inspectPluginUpdate, updateBinding } from './plugin-update.mjs';
import { parseConfigurationSchema, PluginConfigurationStore } from './plugin-configuration.mjs';
import { capabilityFailureCode, capabilityFailureDetails, marketplaceFailureCode } from './capability-failure.mjs';

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, target) => {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
export class CapabilityError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function text(value, max, optional = false) {
  if (typeof value !== 'string' || value.length > max || /[\0]/u.test(value) || (!optional && !value.trim()))
    throw new CapabilityError('invalid-input');
  return value.trim();
}
function name(value) {
  if (!NAME.test(value)) throw new CapabilityError('invalid-input');
  return value;
}
function skillName(value) {
  const result = text(value, 64);
  if (!SKILL_NAME.test(result)) throw new CapabilityError('invalid-input');
  return result;
}
function boolean(value) {
  if (typeof value !== 'boolean') throw new CapabilityError('invalid-input');
  return value;
}
// Errors and declarations may contain credentials; only bounded presentation text leaves this process.
export function capabilityText(value, max = 2048) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
    .replace(/https?:\/\/[^\s"'<>]+/giu, raw => {
      try { const url = new URL(raw); return `${url.origin}${url.pathname}${url.search ? '?[redacted]' : ''}`; }
      catch { return '[redacted URL]'; }
    }).replace(/((?:api[-_]?key|access[-_]?token|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/giu, '$1[redacted]')
    .slice(0, max);
}
const warnings = list => (list ?? []).slice(0, 100).map(item => capabilityText(item));
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
export function pluginRepository(value) {
  const raw = typeof value === 'string' ? value : record(value) ? value.url : undefined;
  if (typeof raw !== 'string' || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw.replace(/^git\+/u, ''));
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port
      || url.username || url.password || url.search || url.hash
      || !/^\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/?$/iu.test(url.pathname)) return undefined;
    return `${url.origin}${url.pathname.replace(/\/$/u, '').replace(/\.git$/u, '')}`;
  } catch { return undefined; }
}

export function createCapabilitySettings(upstream, options) {
  const root = resolve(options.root);
  const agentDir = join(root, 'agent');
  const pluginsDir = join(root, 'plugins');
  const marketplacesDir = join(root, 'marketplaces');
  const settingsManager = () => upstream.createStepSettingsManager(root, agentDir, { configDirName: '.stepcode' });
  const packageManager = async (writable = false) => {
    let settings;
    if (writable) settings = settingsManager();
    else {
      const documents = { global: await readConfig(join(root, 'config.toml')),
        project: await readConfig(join(root, '.stepcode', 'config.toml')) };
      // Keep upstream migrations and scope merging, without creating files or locks.
      settings = upstream.SettingsManager.fromStorage({ withLock(scope, read) {
        const { mcp_servers: ignored, ...value } = documents[scope];
        if (read(JSON.stringify(value)) !== undefined) throw new CapabilityError('read-only');
      } });
    }
    return { settings, packages: new upstream.DefaultPackageManager({
      cwd: root, agentDir, configDirName: '.stepcode', settingsManager: settings,
    }) };
  };
  // All environment-based discovery must already be scoped before the runtime module is imported.
  if (resolve(process.env.HOME ?? '') !== root || resolve(process.env.STEPCODE_STORAGE_ROOT_DIR ?? '') !== root
    || resolve(process.env.STEP_CODING_AGENT_DIR ?? '') !== agentDir)
    throw new CapabilityError('profile-isolation');

  async function plainPath(path, container = root) {
    const target = resolve(path);
    if (!inside(container, target)) throw new CapabilityError('invalid-path');
    const rel = relative(resolve(container), target);
    let current = resolve(container);
    if ((await lstat(current)).isSymbolicLink()) throw new CapabilityError('invalid-path');
    for (const part of rel.split(sep)) {
      current = join(current, part);
      try {
        // lstat can classify a Windows junction as a plain directory; the
        // parent directory entry classifies the same reparse point reliably.
        const linked = (await readdir(dirname(current), { withFileTypes: true }))
          .some(entry => entry.name === part && entry.isSymbolicLink());
        if ((await lstat(current)).isSymbolicLink() || linked) throw new CapabilityError('invalid-path');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
  }
  async function readConfig(path) {
    await plainPath(path);
    try { return upstream.readStepConfig(path); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  async function assertNoPendingUpdate() {
    if (await optionalFile(root, 'desktop-plugins/update-transaction.json', 65536))
      throw new CapabilityError('update-recovery-required');
  }
  async function initialize() {
    await assertNoPendingUpdate();
    await plainPath(marketplacesDir);
    const builtin = await upstream.ensureBuiltinMarketplace({ marketplacesDir });
    return { warnings: warnings(builtin.warnings) };
  }
  async function boundedFile(path, container, limit) {
    const file = await open(await plainPath(path, container), 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > limit) return undefined;
      const bytes = Buffer.alloc(limit + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      return bytesRead <= limit ? bytes.subarray(0, bytesRead) : undefined;
    } finally { await file.close(); }
  }
  async function pluginPresentation(directory, iconBudget) {
    let manifest;
    try {
      await plainPath(directory);
      const bytes = await boundedFile(join(directory, 'step.plugin.json'), directory, 512 * 1024);
      if (bytes) manifest = JSON.parse(bytes.toString('utf8'));
    } catch { return {}; }
    const fingerprint = record(manifest) ? hash(JSON.stringify(manifest)) : undefined;
    const metadata = { fingerprint, repository: pluginRepository(manifest?.repository),
      id: typeof manifest?.id === 'string' ? capabilityText(manifest.id, 128) : undefined,
      displayName: typeof manifest?.name === 'string' ? capabilityText(manifest.name, 128) : undefined,
      version: typeof manifest?.version === 'string' ? capabilityText(manifest.version, 64) : undefined };
    // DFSC-only display metadata: never fetch URLs or expose local image paths.
    try {
      if (typeof manifest?.icon !== 'string' || manifest.icon.length > 256
        || !/\.png$/iu.test(manifest.icon) || /[:\0]/u.test(manifest.icon) || isAbsolute(manifest.icon)
        || !inside(directory, resolve(directory, manifest.icon)) || iconBudget.remaining <= 0) return metadata;
      const bytes = await boundedFile(resolve(directory, manifest.icon), directory, Math.min(128 * 1024, iconBudget.remaining));
      if (!bytes || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
        || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return metadata;
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width > 512 || height > 512) return metadata;
      iconBudget.remaining -= bytes.length;
      return { ...metadata, icon: { kind: 'png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } };
    } catch { return metadata; }
  }
  async function installed() {
    await plainPath(pluginsDir);
    const list = await upstream.listInstalledStepPlugins({ userDir: pluginsDir });
    for (const plugin of list.plugins) {
      await plainPath(plugin.rootPath, pluginsDir);
      await plainPath(join(plugin.rootPath, 'step.plugin.json'), pluginsDir);
    }
    return list;
  }
  async function sources() {
    await plainPath(marketplacesDir);
    const entries = await upstream.listMarketplaceSources(marketplacesDir);
    const records = await sourceRecords();
    return Promise.all(entries.map(async source => {
      const stamp = await sourceStamp(source);
      const record = records.sources.find(item => item.name === source.name && item.stamp === stamp);
      return { ...source, desktopIdentity: record?.generation ?? stamp };
    }));
  }
  async function sourceStamp(source) {
    await plainPath(source.path, marketplacesDir);
    const info = await lstat(source.path);
    return hash(JSON.stringify([source.kind, source.origin ?? null, resolve(source.path), info.dev, info.ino, info.birthtimeMs]));
  }
  async function sourceRecords() {
    const bytes = await optionalFile(root, 'desktop-plugins/sources.json', 256 * 1024);
    if (!bytes) return { version: 1, sources: [] };
    const value = JSON.parse(bytes.toString('utf8'));
    if (!object(value) || value.version !== 1 || !Array.isArray(value.sources) || value.sources.length > 128
      || value.sources.some(item => !object(item) || !NAME.test(item.name) || !/^[a-f0-9]{64}$/u.test(item.stamp)
        || !/^[a-f0-9-]{36}$/u.test(item.generation))
      || new Set(value.sources.map(item => item.name)).size !== value.sources.length) throw new CapabilityError('storage');
    return value;
  }
  async function rememberSource(source) {
    const records = await sourceRecords();
    records.sources = records.sources.filter(item => item.name !== source.name);
    if (records.sources.length >= 128) throw new CapabilityError('too-large');
    records.sources.push({ name: source.name, stamp: await sourceStamp(source), generation: randomUUID() });
    await writePrivateJson(root, 'sources.json', records);
  }
  async function rawMarketNames(source) {
    const manifests = ['.step-plugin/marketplace.json', '.claude-plugin/marketplace.json'];
    const names = [];
    const read = async (prefix = '') => {
      for (const file of manifests) {
        const bytes = await optionalFile(source.path, `${prefix}${file}`, 512 * 1024);
        if (!bytes) continue;
        const manifest = JSON.parse(bytes.toString('utf8'));
        if (!Array.isArray(manifest?.plugins) || manifest.plugins.length > 1000) throw new CapabilityError('too-large');
        names.push(...manifest.plugins.filter(item => typeof item?.name === 'string').map(item => item.name.trim()));
        return true;
      }
      return false;
    };
    if (!await read()) {
      const children = await readdir(source.path, { withFileTypes: true });
      if (children.length > 1000) throw new CapabilityError('too-large');
      for (const child of children) if (child.isDirectory()) await read(`${child.name}/`);
    }
    return names;
  }
  async function marketEntries(markets) {
    if (markets.length > 128) throw new CapabilityError('too-large');
    const results = await Promise.all(markets.map(async source => {
      await plainPath(source.path, marketplacesDir);
      const value = await upstream.listMarketplacePlugins([source.path]);
      let rawNames = [], invalid = false;
      try { rawNames = await rawMarketNames(source); } catch { invalid = true; }
      return { source, ...value, rawNames, invalid };
    }));
    const entries = results.flatMap(value => value.entries.map(entry => ({ ...entry, desktopSource: value.source })));
    if (entries.length > 1000) throw new CapabilityError('too-large');
    const conflicts = new Set(entries.filter(entry => entries.filter(other => other.name === entry.name).length > 1).map(entry => entry.name));
    for (const result of results) for (const entry of result.entries)
      if (result.invalid || result.rawNames.filter(value => value === entry.name).length > 1) conflicts.add(entry.name);
    return { entries, conflicts, warnings: results.flatMap(value => value.warnings) };
  }
  async function packageDescriptor(directory, fields) {
    try {
      await plainPath(directory);
      return { root: directory, fingerprint: await packageFingerprint(directory), ...fields };
    } catch { return undefined; }
  }
  async function userSkills(writable = false) {
    await plainPath(join(agentDir, 'settings.json'));
    await plainPath(join(agentDir, 'skills'));
    const { settings, packages } = await packageManager(writable);
    const resolved = await packages.resolve(async () => 'skip');
    const skills = [];
    for (const resource of resolved.skills) {
      if (resource.metadata.scope !== 'user' || !inside(root, resource.path)) continue;
      await plainPath(resource.path);
      let metadata = {};
      try { metadata = upstream.parseFrontmatter(await readFile(resource.path, 'utf8')).frontmatter; } catch {}
      const owned = [join(agentDir, 'skills'), join(root, '.stepcode', 'skills')]
        .find(dir => inside(dir, resource.path));
      skills.push({ resource, settings, owned, id: hash(resource.path),
        name: capabilityText(typeof metadata.name === 'string' ? metadata.name : basename(dirname(resource.path)), 128),
        description: capabilityText(metadata.description, 1024),
        location: relative(root, resource.path), source: 'user',
        enabled: resource.enabled, toggleable: resource.metadata.origin === 'top-level',
        deletable: Boolean(owned) && resource.metadata.origin === 'top-level' });
    }
    return skills;
  }
  async function pluginSkillEntries(plugins) {
    const discovered = await upstream.discoverStepPluginResourcePaths({ userDir: pluginsDir });
    const skills = [];
    for (const path of discovered.skillPaths) {
      await plainPath(path, pluginsDir);
      const owner = plugins.find(plugin => inside(plugin.rootPath, path) || resolve(plugin.rootPath) === resolve(path));
      for (const skill of upstream.loadSkillsFromDir({ dir: path, source: 'plugin' }).skills) {
        await plainPath(skill.filePath, pluginsDir);
        skills.push({ id: hash(skill.filePath), name: capabilityText(skill.name, 128),
          description: capabilityText(skill.description, 1024), location: relative(root, skill.filePath),
          source: 'plugin', pluginName: capabilityText(owner?.name, 128),
          enabled: true, toggleable: false, deletable: false });
      }
    }
    return { skills, warnings: discovered.warnings };
  }
  async function mcpEntries(plugins) {
    const configured = (await readConfig(join(root, 'config.toml'))).mcp_servers ?? {};
    const result = [];
    const userNames = new Set();
    for (const [key, value] of Object.entries(configured)) {
      if (!record(value) || (!value.command && !value.url)) continue;
      userNames.add(key);
      result.push({ name: capabilityText(key, 160), source: 'user',
        transport: value.url ? 'http' : 'stdio', enabled: value.enabled !== false,
        configurable: true });
    }
    for (const plugin of plugins) {
      await plainPath(plugin.rootPath, pluginsDir);
      const read = await upstream.readStepPluginManifest(plugin.rootPath);
      let declarations = read.manifest?.mcpServers;
      if (typeof declarations === 'string') {
        const declarationPath = await plainPath(resolve(plugin.rootPath, declarations), plugin.rootPath);
        try {
          const parsed = JSON.parse(await readFile(declarationPath, 'utf8'));
          declarations = record(parsed?.mcpServers) ? parsed.mcpServers : parsed;
        } catch { continue; }
      }
      if (!record(declarations)) continue;
      for (const [key, value] of Object.entries(declarations)) {
        const qualified = `${plugin.id}__${key}`;
        if (!record(value) || (!value.command && !value.url)) continue;
        if (userNames.has(qualified)) {
          Object.assign(result.find(server => server.name === qualified), {
            pluginId: capabilityText(plugin.id, 128), pluginName: capabilityText(plugin.name, 128),
          });
          continue;
        }
        result.push({ name: capabilityText(qualified, 160), source: 'plugin',
          pluginId: capabilityText(plugin.id, 128), pluginName: capabilityText(plugin.name, 128),
          transport: value.url ? 'http' : 'stdio',
          enabled: value.enabled !== false && configured[qualified]?.enabled !== false,
          configurable: value.enabled !== false });
      }
    }
    return result;
  }
  async function catalog() {
    let recovery;
    try {
      const pending = await inspectPluginUpdate(root);
      if (pending) recovery = { required: true, pluginId: pending.id };
    } catch { recovery = { required: true }; }
    await plainPath(marketplacesDir);
    let receiptWarning = false;
    const [list, markets, skills, raw, receipts] = await Promise.all([
      installed(), sources(), userSkills(), scanInstalled(root), readReceipts(root).catch(() => {
        receiptWarning = true; return { version: 1, installations: [] };
      }),
    ]);
    const available = await marketEntries(markets);
    const duplicateIds = new Set(raw.filter(item => raw.filter(other => other.id === item.id).length > 1).map(item => item.id));
    const pluginSkills = await pluginSkillEntries(list.plugins);
    const iconBudget = { remaining: 2 * 1024 * 1024 };
    const builtinFingerprints = new Map();
    const availablePlugins = [];
    for (const entry of available.entries) {
      const presentation = await pluginPresentation(entry.sourcePath, iconBudget);
      const builtinEntry = markets.some(source => source.kind === 'builtin' && inside(source.path, entry.sourcePath));
      if (builtinEntry && presentation.fingerprint) builtinFingerprints.set(entry.name, presentation.fingerprint);
      const receipt = receipts.installations.find(item => item.state === 'installed' && item.folder === entry.name
        && item.source === sourceIdentity(entry.desktopSource) && raw.some(plugin => plugin.folder === item.folder && plugin.id === item.id));
      const blocked = available.conflicts.has(entry.name) || duplicateIds.has(presentation.id)
        || raw.some(item => item.id === presentation.id || item.folder === entry.name) && !receipt;
      availablePlugins.push({ name: entry.name, marketplace: entry.marketplace,
        description: capabilityText(entry.description, 2048), installed: Boolean(receipt), blocked,
        id: presentation.id, displayName: presentation.displayName, version: presentation.version,
        installedId: receipt?.id,
        packageDescriptor: await packageDescriptor(entry.sourcePath, { kind: 'available', id: presentation.id,
          source: sourceIdentity(entry.desktopSource), marketplace: entry.marketplace, name: entry.name,
          provenance: blocked ? 'conflict' : 'recorded' }),
        repository: presentation.repository ?? (builtinEntry && entry.name === 'playwright' ? 'https://github.com/microsoft/playwright-mcp' : undefined),
        icon: presentation.icon ?? (builtinEntry ? { kind: 'step' } : undefined) });
    }
    const plugins = [];
    for (const plugin of list.plugins) {
      const presentation = await pluginPresentation(plugin.rootPath, iconBudget);
      const builtinCopy = presentation.fingerprint
        && builtinFingerprints.get(basename(plugin.rootPath)) === presentation.fingerprint;
      const receipt = receipts.installations.find(item => item.folder === basename(plugin.rootPath) && item.id === plugin.id);
      const descriptor = await packageDescriptor(plugin.rootPath, { kind: 'installed', id: plugin.id, name: basename(plugin.rootPath) });
      const recoveryBlocked = recovery?.required && (!recovery.pluginId || recovery.pluginId === plugin.id);
      const provenance = duplicateIds.has(plugin.id) ? 'conflict' : recoveryBlocked ? 'unknown'
        : receipt?.state === 'installed' && descriptor?.fingerprint === receipt.fingerprint ? 'recorded' : 'unknown';
      // A byte-identical market copy is display evidence, not an installation receipt.
      const matchingMarkets = descriptor ? [...new Set(availablePlugins.filter(entry =>
        entry.id === plugin.id && entry.packageDescriptor?.fingerprint === descriptor.fingerprint)
        .map(entry => entry.marketplace))].sort() : [];
      plugins.push({
        id: plugin.id, name: capabilityText(plugin.name, 128), version: capabilityText(plugin.version, 64) || undefined,
        description: capabilityText(plugin.description, 2048), mcpServers: plugin.mcpServers.map(item => capabilityText(item, 160)),
        warnings: warnings(plugin.warnings), icon: presentation.icon ?? (builtinCopy ? { kind: 'step' } : undefined),
        repository: presentation.repository ?? (builtinCopy && plugin.id === 'playwright' ? 'https://github.com/microsoft/playwright-mcp' : undefined),
        marketplace: provenance === 'recorded' ? receipt.marketplace : undefined,
        installationSource: { status: provenance === 'unknown' && matchingMarkets.length ? 'matched' : provenance,
          marketplaces: provenance === 'recorded' ? [receipt.marketplace] : matchingMarkets },
        packageDescriptor: descriptor ? { ...descriptor, provenance, instance: provenance === 'recorded' ? receipt.instance : undefined,
          source: provenance === 'recorded' ? receipt.source : undefined,
          marketplace: provenance === 'recorded' ? receipt.marketplace : undefined } : undefined,
      });
    }
    for (const entry of availablePlugins) if (entry.installedId
      && !plugins.some(plugin => plugin.id === entry.installedId && plugin.packageDescriptor?.provenance === 'recorded')) {
      entry.installed = false; entry.installedId = undefined; entry.blocked = true;
    }
    return {
      ...(recovery ? { recovery } : {}),
      plugins, available: availablePlugins,
      marketplaces: markets.map(source => ({ name: source.name, kind: source.kind,
        origin: source.origin ? capabilityText(source.origin) : null })),
      mcp: await mcpEntries(list.plugins),
      skills: [...skills.map(({ resource, settings, owned, ...skill }) => skill), ...pluginSkills.skills]
        .sort((a, b) => a.name.localeCompare(b.name)),
      warnings: warnings([
        ...(recovery ? ['Incomplete plugin update; explicit recovery is required. Configuration is unavailable for affected installations.'] : []),
        ...list.warnings, ...available.warnings, ...pluginSkills.warnings,
        ...[...available.conflicts].map(id => `Duplicate marketplace package: ${id}`),
        ...[...duplicateIds].map(id => `Conflicting installed plugin ID: ${id}`),
        ...(receiptWarning ? ['Installation records unavailable; sources remain unconfirmed.'] : []),
        ...receipts.installations.filter(item => item.state !== 'installed').map(() => 'Incomplete plugin operation; configuration binding is unavailable.')]),
    };
  }
  async function flush(settings) {
    await settings.flush();
    if (settings.drainErrors().length) throw new CapabilityError('storage');
  }
  async function skillById(id) {
    const skill = (await userSkills(true)).find(item => item.id === id);
    if (!skill) throw new CapabilityError('not-found');
    return skill;
  }
  async function applySkillPattern(skill, enabled, remove = false) {
    const base = skill.resource.metadata.baseDir ?? agentDir;
    const pattern = relative(base, skill.resource.path);
    const settings = skill.settings;
    const current = settings.getGlobalSettings().skills ?? [];
    const patterns = current.filter(item => (/^[!+-]/u.test(item) ? item.slice(1) : item) !== pattern);
    settings.setSkillPaths(remove ? patterns : [...patterns, `${enabled ? '+' : '-'}${pattern}`]);
    await flush(settings);
  }
  async function sourceOutcome(result) {
    if (!result.source) throw new CapabilityError(marketplaceFailureCode(result.warnings));
    return { warnings: warnings(result.warnings) };
  }
  async function refreshSource(source, signal) {
    await plainPath(source.path, marketplacesDir);
    if (source.kind === 'git' && options.refreshMarketplace) {
      await options.refreshMarketplace(source.path, signal);
      return { source, warnings: [] };
    }
    const result = await upstream.updateMarketplaceSource({ name: source.name, marketplacesDir, signal });
    await sourceOutcome(result);
    return result;
  }
  async function mutate(input, signal) {
    if (!record(input)) throw new CapabilityError('invalid-input');
    await assertNoPendingUpdate();
    switch (input.action) {
      case 'plugin-check-updates': {
        const notes = [], failures = [];
        for (const source of await sources()) {
          if (source.kind !== 'git') continue;
          signal?.throwIfAborted();
          try {
            const result = await refreshSource(source, signal);
            notes.push(...warnings(result.warnings));
          } catch (error) {
            if (signal?.aborted) throw error;
            failures.push({ code: capabilityFailureCode(error), details: capabilityFailureDetails(error) });
          }
        }
        return { warnings: notes, ...(failures.length ? { failures } : {}) };
      }
      case 'plugin-update': {
        const id = text(input.id, 128), requested = name(text(input.name, 80)), market = name(text(input.marketplace, 80));
        const receipts = await readReceipts(root);
        const previous = receipts.installations.find(item => item.folder === requested && item.id === id && item.state === 'installed');
        if (!previous || previous.fingerprint !== input.expectedOldFingerprint || previous.source !== input.expectedSource
          || previous.instance !== input.expectedInstance || previous.marketplace !== market) throw new CapabilityError('stale');
        const raw = await scanInstalled(root);
        if (raw.filter(item => item.id === id).length !== 1 || raw.find(item => item.id === id)?.folder !== requested)
          throw new CapabilityError('plugin-conflict');
        const target = await plainPath(join(pluginsDir, requested), pluginsDir);
        if (await packageFingerprint(target) !== previous.fingerprint) throw new CapabilityError('stale');
        const available = await marketEntries(await sources());
        const entry = available.entries.find(item => item.name === requested && item.marketplace === market);
        if (!entry || sourceIdentity(entry.desktopSource) !== previous.source) throw new CapabilityError('stale');
        if (available.conflicts.has(requested)) throw new CapabilityError('plugin-conflict');
        await plainPath(entry.sourcePath, marketplacesDir);
        await rejectLinks(entry.sourcePath);
        const stagingRoot = await plainPath(join(root, 'desktop-plugins'));
        const transaction = randomUUID(), transactionRoot = join(stagingRoot, `update-${transaction}`);
        await mkdir(transactionRoot);
        let finalized = false;
        try {
          const result = await upstream.installMarketplacePlugin(entry, transactionRoot, { provision: false });
          const snapshot = join(transactionRoot, requested);
          const checked = await upstream.readStepPluginManifest(snapshot);
          const old = await upstream.readStepPluginManifest(target);
          if (!checked.manifest || checked.errors.length || !old.manifest || checked.manifest.id !== id
            || checked.manifest.version !== input.expectedVersion || old.manifest.version !== input.expectedOldVersion)
            throw new CapabilityError('stale');
          const fingerprint = await packageFingerprint(snapshot);
          const source = (await sources()).find(item => item.name === entry.desktopSource.name);
          if (!source || sourceIdentity(source) !== previous.source || fingerprint !== input.expectedFingerprint
            || fingerprint === previous.fingerprint) throw new CapabilityError('stale');
          const schema = await optionalFile(target, 'dfsc.settings.json', 65536);
          const nextSchema = await optionalFile(snapshot, 'dfsc.settings.json', 65536);
          const binding = await updateBinding(root, previous);
          const services = async (directory, manifest) => {
            let servers = manifest.mcpServers;
            if (typeof servers === 'string') {
              const parsed = JSON.parse((await plainFile(directory, servers, 256 * 1024)).toString('utf8'));
              servers = parsed.mcpServers ?? parsed;
            }
            return Object.entries(servers ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, server]) =>
              [key, server.url ? 'http' : 'stdio', server.enabled !== false,
                server.env?.STEPFUN_API_KEY === 'DFSC_INDEPENDENT_PLUGIN']);
          };
          const oldServices = await services(target, old.manifest), nextServices = await services(snapshot, checked.manifest);
          let addedConsumer;
          if ((schema?.toString('base64') ?? null) !== (nextSchema?.toString('base64') ?? null)) {
            if (schema || !nextSchema || binding !== null) throw new CapabilityError('configuration-schema-changed');
            try { addedConsumer = parseConfigurationSchema(JSON.parse(nextSchema.toString('utf8'))).consumer.server; }
            catch { throw new CapabilityError('configuration-schema-changed'); }
            const before = oldServices.find(([key]) => key === addedConsumer);
            const after = nextServices.find(([key]) => key === addedConsumer);
            if (!before || before[1] !== 'stdio' || !after || after[1] !== 'stdio' || !after[3])
              throw new CapabilityError('configuration-schema-changed');
          }
          // First-time configuration may strengthen only its existing stdio consumer's isolation.
          const compatibleServices = oldServices.map(([key, transport, enabled, isolated]) =>
            [key, transport, enabled, isolated || key === addedConsumer]);
          if (JSON.stringify(compatibleServices) !== JSON.stringify(nextServices))
            throw new CapabilityError('update-capabilities-changed');
          if (binding && !binding.revoked) await new PluginConfigurationStore(root).context({
            kind: 'installed', provenance: 'recorded', instance: previous.instance, id, name: requested,
            root: target, fingerprint: previous.fingerprint,
          });
          signal?.throwIfAborted();
          await rename(snapshot, join(transactionRoot, 'candidate'));
          const notes = await applyPluginUpdate(root, { transaction, previous,
            next: { ...previous, fingerprint }, binding }, { preserveRuntime: input.preserveRuntime === true });
          finalized = true;
          return { warnings: [...warnings(result.warnings), ...notes] };
        } finally {
          // A retained journal owns its rollback files; never erase recovery evidence.
          if (!finalized && !await optionalFile(root, 'desktop-plugins/update-transaction.json', 65536)) {
            await plainPath(transactionRoot);
            await rm(transactionRoot, { recursive: true, force: true, maxRetries: 3 });
          }
        }
      }
      case 'plugin-install': {
        const requested = name(text(input.name, 80));
        const market = name(text(input.marketplace, 80));
        await plainPath(marketplacesDir); await plainPath(pluginsDir);
        const available = await marketEntries(await sources());
        const entry = available.entries.find(item => item.name === requested && item.marketplace === market);
        if (!entry) throw new CapabilityError('not-found');
        if (available.conflicts.has(requested)) throw new CapabilityError('plugin-conflict');
        await plainPath(entry.sourcePath, marketplacesDir);
        await rejectLinks(entry.sourcePath);
        const stagingRoot = await plainPath(join(root, 'desktop-plugins'));
        await mkdir(stagingRoot, { recursive: true });
        await plainPath(stagingRoot);
        const staging = await mkdtemp(join(stagingRoot, 'install-'));
        try {
          // Native discovery cannot see the incomplete copy. Identity and fingerprint
          // are checked on this same frozen installation before its atomic publication.
          const result = await upstream.installMarketplacePlugin(entry, staging, { provision: false });
          const snapshot = join(staging, requested);
          await rejectLinks(snapshot);
          const checked = await upstream.readStepPluginManifest(snapshot);
          if (!checked.manifest || checked.errors.length) throw new CapabilityError('invalid-input');
          const fingerprint = await packageFingerprint(snapshot);
          if (input.preserveRuntime === true && (!input.expectedFingerprint || !input.expectedSource
            || await dataOnlyThemeFingerprint(snapshot, checked.manifest.id) !== input.expectedFingerprint))
            throw new CapabilityError('stale');
          const currentSource = (await sources()).find(source => source.name === entry.desktopSource.name);
          if (!currentSource || sourceIdentity(currentSource) !== sourceIdentity(entry.desktopSource)
            || input.expectedFingerprint && input.expectedFingerprint !== fingerprint
            || input.expectedSource && input.expectedSource !== sourceIdentity(currentSource))
            throw new CapabilityError('stale');
          const raw = await scanInstalled(root);
          if (raw.some(plugin => plugin.id === checked.manifest.id || plugin.folder === requested))
            throw new CapabilityError('already-exists');
          try { await lstat(join(pluginsDir, requested)); throw new CapabilityError('already-exists'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          const receipts = await readReceipts(root);
          const receipt = installationReceipt(entry, entry.desktopSource, checked.manifest, fingerprint);
          receipt.marketplace = entry.marketplace;
          receipts.installations = receipts.installations.filter(item => item.folder !== requested);
          receipts.installations.push(receipt);
          await writeReceipts(root, receipts);
          await mkdir(pluginsDir, { recursive: true });
          await plainPath(pluginsDir);
          await rename(snapshot, join(pluginsDir, requested));
          if (await packageFingerprint(join(pluginsDir, requested)) !== receipt.fingerprint)
            throw new CapabilityError('stale');
          receipt.state = 'installed';
          await writeReceipts(root, receipts);
          return { warnings: warnings(result.warnings) };
        } finally {
          if (!inside(stagingRoot, staging) || dirname(staging) !== stagingRoot) throw new CapabilityError('invalid-path');
          await rm(staging, { recursive: true, force: true, maxRetries: 3 });
        }
      }
      case 'plugin-remove': {
        const id = text(input.id, 128);
        const targets = (await scanInstalled(root)).filter(item => item.id === id);
        if (targets.length > 1) throw new CapabilityError('plugin-conflict');
        const plugin = (await installed()).plugins.find(item => item.id === id);
        if (!plugin) throw new CapabilityError('not-found');
        await plainPath(plugin.rootPath, pluginsDir);
        const folder = basename(plugin.rootPath);
        if (targets.length && targets[0].folder !== folder) throw new CapabilityError('stale');
        if (input.expectedFingerprint && await packageFingerprint(plugin.rootPath) !== input.expectedFingerprint)
          throw new CapabilityError('stale');
        const receipts = await readReceipts(root);
        // Bind revocation to the unique on-disk installation, not every receipt with this runtime ID.
        const receipt = receipts.installations.find(item => item.folder === folder);
        if (receipt && receipt.id !== id) throw new CapabilityError('stale');
        const recheckTheme = async () => {
          if (input.preserveRuntime === true && (typeof input.expectedFingerprint !== 'string'
            || await dataOnlyThemeFingerprint(plugin.rootPath, id) !== input.expectedFingerprint))
            throw new CapabilityError('stale');
        };
        if (receipt) {
          const path = `desktop-plugins/bindings/${receipt.folder}.json`;
          const bytes = await optionalFile(root, path, 65536);
          if (bytes) {
            const binding = JSON.parse(bytes.toString('utf8'));
            if (!object(binding) || binding.version !== 1 || !binding.revoked
              && (binding.instance !== receipt.instance || binding.id !== receipt.id))
              throw new CapabilityError('stale-configuration');
          }
          if (JSON.stringify(await readReceipts(root)) !== JSON.stringify(receipts)) throw new CapabilityError('stale');
          await recheckTheme();
          receipt.state = 'removing';
          await writeReceipts(root, receipts);
          await writePrivateData(root, path, { version: 1, instance: receipt.instance, id: receipt.id, revoked: true });
        }
        // Keep the removing receipt and revocation if native deletion fails.
        await recheckTheme();
        await upstream.uninstallPlugin(pluginsDir, folder);
        receipts.installations = receipts.installations.filter(item => item !== receipt);
        await writeReceipts(root, receipts);
        break;
      }
      case 'marketplace-add': {
        const source = text(input.source, 4096);
        await plainPath(marketplacesDir);
        // Reject URL credentials rather than allowing Git output to echo them.
        if (/^[a-z]+:\/\//iu.test(source) && !source.startsWith('file:')) {
          let url;
          try { url = new URL(source); } catch { throw new CapabilityError('invalid-input'); }
          if (url.username || url.password || url.search || url.hash) throw new CapabilityError('invalid-input');
        }
        if (isAbsolute(source) || source.startsWith('.') || source.startsWith('file:')) {
          const { fileURLToPath } = await import('node:url');
          const path = source.startsWith('file:') ? fileURLToPath(source) : resolve(source);
          // rejectLinks walks children; the source root itself must also be
          // classified before anything under it is read.
          await plainPath(path, dirname(path));
          await rejectLinks(path);
        }
        const result = await upstream.addMarketplaceSource({ source, marketplacesDir, signal });
        if (result.source) {
          const added = (await upstream.listMarketplaceSources(marketplacesDir)).find(item => item.name === result.source.name);
          if (!added) throw new CapabilityError('marketplace-failed');
          await rememberSource(added);
        }
        return sourceOutcome(result);
      }
      case 'marketplace-update':
      case 'marketplace-remove': {
        const sourceName = name(text(input.name, 80));
        const source = (await sources()).find(item => item.name === sourceName);
        if (!source || source.kind === 'builtin') throw new CapabilityError('read-only');
        await plainPath(source.path, marketplacesDir);
        const result = input.action === 'marketplace-update'
          ? await refreshSource(source, signal)
          : await upstream.removeMarketplaceSource({ name: sourceName, marketplacesDir });
        if (result.source && input.action === 'marketplace-remove') {
          const records = await sourceRecords();
          records.sources = records.sources.filter(item => item.name !== sourceName);
          await writePrivateJson(root, 'sources.json', records);
        }
        return sourceOutcome(result);
      }
      case 'plugin-toggle':
      case 'mcp-toggle': {
        const enabled = boolean(input.enabled);
        const plugins = (await installed()).plugins;
        const servers = await mcpEntries(plugins);
        const id = input.action === 'plugin-toggle' ? text(input.id, 128) : undefined;
        const raw = await scanInstalled(root);
        if (raw.some(item => raw.filter(other => other.id === item.id).length > 1
          && (id === item.id || input.name?.startsWith(`${item.id}__`)))) throw new CapabilityError('plugin-conflict');
        if (id && !plugins.some(plugin => plugin.id === id)) throw new CapabilityError('not-found');
        const selected = id ? servers.filter(server => server.pluginId === id)
          : servers.filter(server => server.name === text(input.name, 160));
        if (!selected.length) throw new CapabilityError('not-found');
        if (selected.some(server => !server.configurable)) throw new CapabilityError('read-only');
        // Commit every server override in one upstream read-modify-write operation.
        upstream.updateGlobalMcpConfig(process.env, configured => {
          const next = { ...configured };
          for (const { name } of selected) {
            const { enabled: ignored, ...rest } = next[name] ?? {};
            if (enabled && Object.keys(rest).length === 0) delete next[name];
            else next[name] = enabled ? rest : { ...rest, enabled: false };
          }
          return next;
        });
        break;
      }
      case 'skill-create': {
        const value = skillName(input.name);
        const description = text(input.description, 1024).replace(/\s+/gu, ' ');
        const instructions = text(input.instructions, 128 * 1024, true);
        const directory = await plainPath(join(agentDir, 'skills', value));
        await mkdir(dirname(directory), { recursive: true });
        try { await mkdir(directory); } catch (error) {
          if (error.code === 'EEXIST') throw new CapabilityError('already-exists'); throw error;
        }
        await writeFile(join(directory, 'SKILL.md'),
          `---\nname: ${value}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}\n`, { flag: 'wx', encoding: 'utf8' });
        break;
      }
      case 'skill-toggle': {
        const skill = await skillById(text(input.id, 64));
        if (!skill.toggleable) throw new CapabilityError('read-only');
        await applySkillPattern(skill, boolean(input.enabled));
        break;
      }
      case 'skill-remove': {
        const skill = await skillById(text(input.id, 64));
        if (!skill.deletable || !skill.owned) throw new CapabilityError('read-only');
        const target = basename(skill.resource.path) === 'SKILL.md' ? dirname(skill.resource.path) : skill.resource.path;
        await plainPath(target, skill.owned);
        await rm(target, { recursive: (await lstat(target)).isDirectory(), force: false });
        await applySkillPattern(skill, false, true);
        break;
      }
      default: throw new CapabilityError('invalid-input');
    }
    return { warnings: [] };
  }
  async function importSkill(source) {
    await assertNoPendingUpdate();
    const path = await realpath(source);
    await rejectLinks(path);
    const file = join(path, 'SKILL.md');
    if ((await lstat(file)).size > 128 * 1024) throw new CapabilityError('invalid-input');
    const metadata = upstream.parseFrontmatter(await readFile(file, 'utf8')).frontmatter;
    const value = skillName(metadata.name ?? basename(path));
    const target = await plainPath(join(agentDir, 'skills', value));
    try { await lstat(target); throw new CapabilityError('already-exists'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dirname(target), { recursive: true });
    await cp(path, target, { recursive: true, force: false, errorOnExist: true });
    return { warnings: [] };
  }
  return { catalog, initialize, mutate, importSkill };
}

async function rejectLinks(root, budget = { files: 0, bytes: 0 }) {
  const info = await lstat(root);
  if (info.isSymbolicLink()) throw new CapabilityError('invalid-path');
  if (++budget.files > 10000 || (budget.bytes += info.isFile() ? info.size : 0) > 128 * 1024 * 1024)
    throw new CapabilityError('too-large');
  if (info.isDirectory()) for (const entry of await readdir(root, { withFileTypes: true })) {
    // lstat can classify a Windows junction as a plain directory, so the
    // directory entry itself decides before descending.
    if (entry.isSymbolicLink()) throw new CapabilityError('invalid-path');
    await rejectLinks(join(root, entry.name), budget);
  }
}
