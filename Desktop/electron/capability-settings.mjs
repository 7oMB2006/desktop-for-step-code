// Desktop adapter for the upstream MVP's user-scope management operations.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, readdir, rm, cp, writeFile, open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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

export function createCapabilitySettings(upstream, options) {
  const root = resolve(options.root);
  const agentDir = join(root, 'agent');
  const pluginsDir = join(root, 'plugins');
  const marketplacesDir = join(root, 'marketplaces');
  const settingsManager = () => upstream.createStepSettingsManager(root, agentDir, { configDirName: '.stepcode' });
  const packageManager = () => {
    const settings = settingsManager();
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
      try { if ((await lstat(current)).isSymbolicLink()) throw new CapabilityError('invalid-path'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
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
    // DFSC-only display metadata: never fetch URLs or expose local image paths.
    try {
      if (typeof manifest?.icon !== 'string' || manifest.icon.length > 256
        || !/\.png$/iu.test(manifest.icon) || /[:\0]/u.test(manifest.icon) || isAbsolute(manifest.icon)
        || !inside(directory, resolve(directory, manifest.icon)) || iconBudget.remaining <= 0) return { fingerprint };
      const bytes = await boundedFile(resolve(directory, manifest.icon), directory, Math.min(128 * 1024, iconBudget.remaining));
      if (!bytes || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
        || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return { fingerprint };
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width > 512 || height > 512) return { fingerprint };
      iconBudget.remaining -= bytes.length;
      return { fingerprint, icon: { kind: 'png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } };
    } catch { return { fingerprint }; }
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
    return upstream.listMarketplaceSources(marketplacesDir);
  }
  async function userSkills() {
    await plainPath(join(agentDir, 'settings.json'));
    await plainPath(join(agentDir, 'skills'));
    const { settings, packages } = packageManager();
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
    await plainPath(join(root, 'config.toml'));
    const configured = upstream.readGlobalStepConfig(process.env).mcp_servers ?? {};
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
        if (userNames.has(qualified) || !record(value) || (!value.command && !value.url)) continue;
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
    await plainPath(marketplacesDir);
    const builtin = await upstream.ensureBuiltinMarketplace({ marketplacesDir });
    const [list, available, markets, skills] = await Promise.all([
      installed(), upstream.listMarketplacePlugins([marketplacesDir]), sources(), userSkills(),
    ]);
    const pluginSkills = await pluginSkillEntries(list.plugins);
    const installedFolders = new Set(list.plugins.flatMap(plugin => [plugin.id, basename(plugin.rootPath)]));
    const iconBudget = { remaining: 2 * 1024 * 1024 };
    const builtinFingerprints = new Map();
    const availablePlugins = [];
    for (const entry of available.entries) {
      const presentation = await pluginPresentation(entry.sourcePath, iconBudget);
      const builtinEntry = markets.some(source => source.kind === 'builtin' && inside(source.path, entry.sourcePath));
      if (builtinEntry && presentation.fingerprint) builtinFingerprints.set(entry.name, presentation.fingerprint);
      availablePlugins.push({ name: entry.name, marketplace: entry.marketplace,
        description: capabilityText(entry.description, 2048), installed: installedFolders.has(entry.name),
        icon: presentation.icon ?? (builtinEntry ? { kind: 'step' } : undefined) });
    }
    const plugins = [];
    for (const plugin of list.plugins) {
      const presentation = await pluginPresentation(plugin.rootPath, iconBudget);
      const builtinCopy = presentation.fingerprint
        && builtinFingerprints.get(basename(plugin.rootPath)) === presentation.fingerprint;
      plugins.push({
        id: plugin.id, name: capabilityText(plugin.name, 128), version: capabilityText(plugin.version, 64) || undefined,
        description: capabilityText(plugin.description, 2048), mcpServers: plugin.mcpServers.map(item => capabilityText(item, 160)),
        warnings: warnings(plugin.warnings), icon: presentation.icon ?? (builtinCopy ? { kind: 'step' } : undefined),
      });
    }
    return {
      plugins, available: availablePlugins,
      marketplaces: markets.map(source => ({ name: source.name, kind: source.kind,
        origin: source.origin ? capabilityText(source.origin) : null })),
      mcp: await mcpEntries(list.plugins),
      skills: [...skills.map(({ resource, settings, owned, ...skill }) => skill), ...pluginSkills.skills]
        .sort((a, b) => a.name.localeCompare(b.name)),
      warnings: warnings([...builtin.warnings, ...list.warnings, ...available.warnings, ...pluginSkills.warnings]),
    };
  }
  async function flush(settings) {
    await settings.flush();
    if (settings.drainErrors().length) throw new CapabilityError('storage');
  }
  async function skillById(id) {
    const skill = (await userSkills()).find(item => item.id === id);
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
    if (!result.source) throw new CapabilityError('marketplace-failed');
    return { warnings: warnings(result.warnings) };
  }
  async function mutate(input, signal) {
    if (!record(input)) throw new CapabilityError('invalid-input');
    switch (input.action) {
      case 'plugin-install': {
        const requested = name(text(input.name, 80));
        const market = name(text(input.marketplace, 80));
        await plainPath(marketplacesDir); await plainPath(pluginsDir);
        await upstream.ensureBuiltinMarketplace({ marketplacesDir });
        const available = await upstream.listMarketplacePlugins([marketplacesDir]);
        const entry = available.entries.find(item => item.name === requested && item.marketplace === market);
        if (!entry) throw new CapabilityError('not-found');
        await plainPath(entry.sourcePath, marketplacesDir);
        await rejectLinks(entry.sourcePath);
        if ((await installed()).plugins.some(plugin => plugin.id === requested || basename(plugin.rootPath) === requested))
          throw new CapabilityError('already-exists');
        const result = await upstream.installMarketplacePlugin(entry, pluginsDir, { provision: false });
        return { warnings: warnings(result.warnings) };
      }
      case 'plugin-remove': {
        const id = text(input.id, 128);
        const plugin = (await installed()).plugins.find(item => item.id === id);
        if (!plugin) throw new CapabilityError('not-found');
        await plainPath(plugin.rootPath, pluginsDir);
        await upstream.uninstallPlugin(pluginsDir, basename(plugin.rootPath));
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
          await rejectLinks(path);
        }
        return sourceOutcome(await upstream.addMarketplaceSource({ source, marketplacesDir, signal }));
      }
      case 'marketplace-update':
      case 'marketplace-remove': {
        const sourceName = name(text(input.name, 80));
        const source = (await sources()).find(item => item.name === sourceName);
        if (!source || source.kind === 'builtin') throw new CapabilityError('read-only');
        await plainPath(source.path, marketplacesDir);
        return sourceOutcome(input.action === 'marketplace-update'
          ? await upstream.updateMarketplaceSource({ name: sourceName, marketplacesDir })
          : await upstream.removeMarketplaceSource({ name: sourceName, marketplacesDir }));
      }
      case 'mcp-toggle': {
        const enabled = boolean(input.enabled);
        const serverName = text(input.name, 160);
        const servers = await mcpEntries((await installed()).plugins);
        const server = servers.find(item => item.name === serverName);
        if (!server) throw new CapabilityError('not-found');
        if (!server.configurable) throw new CapabilityError('read-only');
        upstream.updateGlobalMcpConfig(process.env, configured => {
          const previous = configured[serverName] ?? {};
          const { enabled: ignored, ...rest } = previous;
          if (enabled && Object.keys(rest).length === 0) {
            const next = { ...configured }; delete next[serverName]; return next;
          }
          return { ...configured, [serverName]: enabled ? rest : { ...rest, enabled: false } };
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
  return { catalog, mutate, importSkill };
}

async function rejectLinks(root, budget = { files: 0, bytes: 0 }) {
  const info = await lstat(root);
  if (info.isSymbolicLink()) throw new CapabilityError('invalid-path');
  if (++budget.files > 10000 || (budget.bytes += info.isFile() ? info.size : 0) > 128 * 1024 * 1024)
    throw new CapabilityError('too-large');
  if (info.isDirectory()) for (const entry of await readdir(root)) await rejectLinks(join(root, entry), budget);
}
