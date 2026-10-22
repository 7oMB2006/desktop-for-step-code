import { posix, win32 } from 'node:path';

export const STEPPAGE_SERVER = 'steppage__steppage';
export const LEGACY_STEPPAGE_SERVER = 'steppage';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathKey = (value, platform) => platform === 'win32'
  ? win32.normalize(value).toLowerCase() : posix.normalize(value);

export function desktopManaged(server, bundlePath, platform) {
  if (!record(server) || typeof server.command !== 'string' || server.url) return false;
  const path = platform === 'win32' ? win32 : posix;
  if (!path.isAbsolute(server.command) || !/[\\/]runtime[\\/]node[\\/]node(?:\.exe)?$/i.test(server.command)) return false;
  if (!Array.isArray(server.args) || server.args.length !== 1 || typeof server.args[0] !== 'string') return false;
  const bundle = server.args[0];
  return pathKey(bundle, platform) === pathKey(bundlePath, platform)
    || path.isAbsolute(bundle) && /(?:[\\/]\.steppage-mcp|[\\/]step-runtime[\\/]steppage)[\\/]bin[\\/]steppage-mcp\.mjs$/i.test(bundle);
}

/** Runs inside the upstream settings lock, with the full config (never its UI projection). */
export function reconcileStepPageServers(servers, { nodePath, bundlePath, bundleExists, homePath, rejectedBundlePath, platform = process.platform }) {
  const next = { ...servers };
  // A failed Desktop fingerprint must not leave its executable declaration enabled.
  if (rejectedBundlePath) for (const name of [LEGACY_STEPPAGE_SERVER, STEPPAGE_SERVER]) {
    const server = next[name];
    if (desktopManaged(server, rejectedBundlePath, platform)
      && pathKey(server.args[0], platform) === pathKey(rejectedBundlePath, platform))
      next[name] = { ...server, enabled: false };
  }
  const legacy = next[LEGACY_STEPPAGE_SERVER];
  const hasCanonical = Object.hasOwn(next, STEPPAGE_SERVER);
  if (!hasCanonical && record(legacy)) {
    // Moving the entire declaration retains secrets, filters, timeouts and explicit disable.
    next[STEPPAGE_SERVER] = legacy;
    delete next[LEGACY_STEPPAGE_SERVER];
  } else if (hasCanonical && desktopManaged(legacy, bundlePath, platform)) {
    // An explicit qualified declaration wins over the obsolete Desktop-generated alias.
    // An old explicit disable remains conservative even if another version added the new name.
    if (servers[LEGACY_STEPPAGE_SERVER]?.enabled === false && record(next[STEPPAGE_SERVER]))
      next[STEPPAGE_SERVER] = { ...next[STEPPAGE_SERVER], enabled: false };
    delete next[LEGACY_STEPPAGE_SERVER];
  }
  const server = next[STEPPAGE_SERVER];
  if (!Object.hasOwn(next, STEPPAGE_SERVER) && bundleExists) {
    next[STEPPAGE_SERVER] = { command: nodePath, args: [bundlePath], enabled: true };
  } else if (bundleExists && desktopManaged(server, bundlePath, platform)) {
    next[STEPPAGE_SERVER] = { ...server, command: nodePath, args: [bundlePath] };
  }
  if (homePath && bundleExists && desktopManaged(next[STEPPAGE_SERVER], bundlePath, platform)) {
    const path = platform === 'win32' ? win32 : posix;
    const oldBundle = server?.args?.[0];
    const oldHome = typeof oldBundle === 'string' && /[\\/]step-runtime[\\/]steppage[\\/]bin[\\/]steppage-mcp\.mjs$/i.test(oldBundle)
      ? path.join(path.dirname(path.dirname(oldBundle)), 'home') : undefined;
    const env = { ...next[STEPPAGE_SERVER].env };
    for (const key of ['HOME', 'USERPROFILE'])
      if (!env[key] || oldHome && pathKey(env[key], platform) === pathKey(oldHome, platform)) env[key] = homePath;
    next[STEPPAGE_SERVER] = { ...next[STEPPAGE_SERVER],
      env };
  }
  return next;
}

export function prepareStepPageServers(servers, options) {
  const migrated = reconcileStepPageServers(servers, { ...options, bundleExists: false });
  const server = migrated[STEPPAGE_SERVER];
  // Disabled-only built-in overrides have no transport and can safely receive one.
  if (server && !desktopManaged(server, options.bundlePath, options.platform ?? process.platform)
    && Object.keys(server).some(key => key !== 'enabled'))
    throw new Error('StepPage has a custom configuration; it was not changed');
  const next = server && Object.keys(server).every(key => key === 'enabled')
    ? { ...migrated, [STEPPAGE_SERVER]: { ...server, command: options.nodePath, args: [options.bundlePath] } }
    : migrated;
  return reconcileStepPageServers(next, { ...options, bundleExists: true });
}
