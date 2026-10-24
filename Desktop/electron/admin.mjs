import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanDesktopUsage } from './usage-overview.mjs';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { reconcileStepPageServers, prepareStepPageServers } from './steppage-config.mjs';
import { readSessionHistory } from './session-history.mjs';

// Management lives in a separate process so Step globals never enter Electron.
const root = dirname(fileURLToPath(import.meta.url));
const desktopAuth = Boolean(process.env.STEPCODE_DESKTOP_AUTH_PATH);
const upstream = await import(pathToFileURL(join(root, 'step/dist/bundle/index.js')).href);
const authPath = process.env.STEPCODE_AUTH_PATH;
const sessions = process.env.STEP_CODING_AGENT_SESSION_DIR;
const agentDir = process.env.STEP_CODING_AGENT_DIR;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let login;
let stepModelCache;
const safeMcp = servers => Object.fromEntries(Object.entries(servers).map(([name, item]) => [name, {
  command: item.command, args: item.args, cwd: item.cwd, url: item.url, enabled: item.enabled !== false,
  configuredSecrets: [...Object.keys(item.env ?? {}), ...Object.keys(item.http_headers ?? {})],
}]));
async function dispatch(message) {
  switch (message.type) {
    case 'prepare_steppage':
    case 'reconcile_steppage': {
      if (!agentDir || !process.env.STEPCODE_STORAGE_ROOT_DIR || typeof message.bundlePath !== 'string')
        throw new Error('StepPage reconciliation requires an isolated profile');
      const reconcile = message.type === 'prepare_steppage' ? prepareStepPageServers : reconcileStepPageServers;
      if (message.type === 'prepare_steppage' && !existsSync(message.bundlePath)) throw new Error('Missing StepPage bundle');
      upstream.updateGlobalMcpConfig(process.env, servers => reconcile(servers, {
        nodePath: process.execPath, bundlePath: message.bundlePath,
        bundleExists: existsSync(message.bundlePath) && message.bundlePath !== message.rejectedBundlePath,
        rejectedBundlePath: message.rejectedBundlePath, homePath: message.homePath,
        desktopOnly: process.platform === 'darwin' && Boolean(message.homePath),
      }));
      return null;
    }
    case 'usage_overview': {
      if (!sessions || !agentDir) throw new Error('Desktop usage requires an isolated profile');
      return scanDesktopUsage(upstream, sessions, join(agentDir, 'desktop-usage-cache'));
    }
    case 'cron_saved': {
      if (!agentDir || typeof message.cwd !== 'string' || !message.cwd.trim()) throw new Error('Invalid Cron project');
      const trusted = new upstream.ProjectTrustStore(agentDir).get(message.cwd) === true;
      if (!trusted) return { trusted: false, jobs: [] };
      const warnings = [];
      const store = new upstream.CronFileStore(join(message.cwd, '.stepcode/cron/tasks.json'), { warn: value => warnings.push(value) });
      const jobs = store.load();
      if (warnings.length) throw new Error('Cron storage is unavailable');
      return { trusted: true, jobs };
    }
    case 'trust_project': {
      if (!agentDir || typeof message.cwd !== 'string' || !message.cwd.trim())
        throw new Error('Desktop project trust requires an isolated profile and folder');
      const store = new upstream.ProjectTrustStore(agentDir);
      store.set(message.cwd, true);
      return { saved: true };
    }
    case 'session_options': {
      upstream.syncStepLoginProfileEndpoint(authPath);
      const settings = upstream.createStepSettingsManager(message.cwd, agentDir);
      const runtime = await upstream.ModelRuntime.create({
        authPath, modelsPath: join(dirname(authPath), 'models.json'), allowModelNetwork: false,
      });
      const registry = new upstream.ModelRegistry(runtime);
      const config = upstream.createStepProviderConfig({ authPath });
      const modelConfig = await readFile(join(dirname(authPath), 'models.json'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      const refreshModels = config.refreshModels;
      config.refreshModels = async context => {
        const key = context.credential ? createHash('sha256')
          .update(JSON.stringify([config.baseUrl, context.credential, modelConfig])).digest('hex') : undefined;
        const models = await refreshModels(context);
        // Upstream returns an empty baseline on discovery failure. Keep only this
        // process's last successful catalog for the exact same endpoint/credential.
        if (key && models.length && context.allowNetwork) stepModelCache = { key, models };
        return models.length || !key || stepModelCache?.key !== key ? models : stepModelCache.models;
      };
      // Registration schedules an offline refresh. Serialize it with explicit
      // discovery so a late offline pass cannot abort or replace network results.
      const refresh = runtime.refresh.bind(runtime);
      let pendingRefresh = Promise.resolve();
      runtime.refresh = options => {
        const result = pendingRefresh.then(() => refresh(options));
        pendingRefresh = result.catch(() => {});
        return result;
      };
      registry.registerProvider(upstream.STEP_PROVIDER_ID, config);
      try {
        await runtime.refresh({ allowNetwork: true, signal: AbortSignal.timeout(5000) });
      } catch { /* Keep the provider's local catalog when discovery is unavailable. */ }
      // Project only the runtime model's declared levels; never guess xhigh/max support.
      const available = registry.getAvailable();
      // Custom-provider availability must not suppress the official offline fallback.
      const catalog = available.some(model => model.provider === upstream.STEP_PROVIDER_ID) ? available
        : [...available, ...registry.getAll().filter(model => model.provider === upstream.STEP_PROVIDER_ID)];
      const models = catalog.map(({ id, provider, name, reasoning, thinkingLevelMap, input, contextWindow, maxTokens }) => ({
        id, provider, name, reasoning, input, contextWindow, maxTokens,
        thinkingLevels: reasoning ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].filter(level =>
          thinkingLevelMap?.[level] !== null && (!['xhigh', 'max'].includes(level) || thinkingLevelMap?.[level] !== undefined)) : ['off'],
      }));
      const provider = settings.getDefaultProvider() ?? upstream.STEP_DEFAULT_PROVIDER;
      const id = settings.getDefaultModel() ?? upstream.STEP_DEFAULT_MODEL;
      const model = models.find(model => model.provider === provider && model.id === id) ?? models[0] ?? { id, provider, name: id };
      const requested = settings.getDefaultThinkingLevel() ?? 'medium';
      return {
        models,
        officialModel: model.provider === upstream.STEP_PROVIDER_ID,
        model, thinkingLevel: model.thinkingLevels?.includes(requested) ? requested : model.thinkingLevels?.[0],
        permissionPreset: settings.getStepPermissionPreset() ?? upstream.resolveInitialStepPermissionPreset({
          initialPreset: upstream.readGlobalStepConfig().permissionPreset,
        }),
      };
    }
    case 'sessions': {
      if (!sessions) throw new Error('Desktop sessions require an isolated profile');
      // A custom native root lists only its direct files. Imported copies live
      // in a separate child directory, not in the personal CLI session tree.
      const lists = await Promise.all([
        upstream.SessionManager.listAll(sessions),
        upstream.SessionManager.listAll(join(sessions, 'imported')),
      ]);
      return lists.flat().sort((a, b) => new Date(b.modified) - new Date(a.modified))
        .map(({ allMessagesText, ...s }) => s);
    }
    case 'session_history': return readSessionHistory(upstream, sessions, message.sessionPath, message.sessionId);
    case 'copy_session': {
      // Copy before starting an agent: restoring a cold original can append runtime metadata.
      const copy = upstream.SessionManager.forkFrom(message.sessionPath, message.cwd, sessions);
      const id = copy.getSessionId();
      // v0.1.5 appends lineage owned by the new copy; compare the copied source leaf.
      const sourceLeafId = copy.getBranch().findLast(entry => !(entry.type === 'custom'
        && entry.customType === 'step.usage_lineage' && entry.data?.sessionId === id))?.id ?? null;
      return { path: copy.getSessionFile(), id, leafId: copy.getLeafId(), sourceLeafId };
    }
    case 'settings': {
      const config = upstream.readGlobalStepConfig();
      const status = await upstream.getStepLoginStatus({ authPath });
      const credential = upstream.readStepLoginCredential(authPath);
      const userId = status.loggedIn && typeof credential?.uid === 'string' && status.account === credential.uid.trim()
        ? credential.uid.trim().slice(0, 256) : undefined;
      return {
        account: { loggedIn: status.loggedIn, validity: status.validity, profile: status.profile, ...(userId ? { userId } : {}) },
        profiles: upstream.resolveStepLoginProfiles().map(({ id, title, description, credentialSource }) => ({ id, title, description, credentialSource })),
        mcp: safeMcp(config.mcp_servers ?? {}),
        skills: upstream.loadSkills({ cwd: message.cwd, agentDir, skillPaths: [], includeDefaults: true, configDirName: '.stepcode' }).skills.map(({ name, description, source }) => ({ name, description, source })),
      };
    }
    case 'mcp': {
      upstream.updateGlobalMcpConfig(process.env, servers => {
        if (message.config === null) { const next = { ...servers }; delete next[message.name]; return next; }
        const previous = servers[message.name] ?? {};
        const next = { ...previous, ...message.config };
        if (message.config.url) { delete next.command; delete next.args; }
        else { delete next.url; }
        delete next.configuredSecrets;
        if (message.secrets && Object.keys(message.secrets).length) next.env = { ...previous.env, ...message.secrets };
        return { ...servers, [message.name]: next };
      }); return null;
    }
    case 'login': {
      if (login) throw new Error('Login already in progress');
      const profile = upstream.resolveStepLoginProfiles().find(p => p.id === message.profile);
      if (!profile) throw new Error('Unknown login profile');
      login = new AbortController();
      try {
        let apiKey = message.key;
        let uid;
        if (profile.credentialSource === 'browser') {
          const credential = await upstream.loginStepOAuth({
            signal: login.signal,
            onAuth: ({ url }) => send({ type: 'auth_url', url }),
            onDeviceCode: () => {}, onPrompt: async () => '', onSelect: async () => undefined,
          }, { apiBaseUrl: profile.baseUrl, authBaseUrl: profile.authBaseUrl, env: process.env });
          apiKey = credential.access; uid = credential.uid;
        }
        if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('API key is required');
        await upstream.writeStepLoginCredential({ authPath, profile: profile.id, apiKey, uid });
        stepModelCache = undefined;
        return desktopAuth ? upstream.readDesktopAuthData() : null;
      } finally { login = undefined; }
    }
    case 'refresh_allowance_credential': {
      const credential = message.credential;
      if (credential?.type !== 'oauth' || !['step_plan', 'step_plan_oversea'].includes(credential.profile ?? 'step_plan'))
        throw new Error('Unsupported allowance credential');
      const profile = upstream.resolveStepLoginProfiles().find(p => p.id === (credential.profile ?? 'step_plan'));
      if (!profile) throw new Error('Unknown allowance profile');
      const config = upstream.createStepProviderConfig({ authPath, apiBaseUrl: profile.baseUrl, authBaseUrl: profile.authBaseUrl });
      return { ...credential, ...await config.oauth.refreshToken(credential, AbortSignal.timeout(10000)) };
    }
    case 'cancel_login': login?.abort(); return null;
    case 'logout': stepModelCache = undefined; await upstream.logoutStepCredentials({ nativePath: authPath, legacyPath: process.env.STEPCODE_LEGACY_AUTH_PATH, env: process.env }); return desktopAuth ? upstream.readDesktopAuthData() : null;
    default: throw new Error('Unsupported management request');
  }
}
createInterface({ input: process.stdin }).on('line', async line => {
  let request;
  try { request = JSON.parse(line); const data = await dispatch(request); send({ id: request.id, type: 'response', success: true, data }); }
  catch { send({ id: request?.id, type: 'response', success: false, error: `Management operation failed: ${request?.type ?? 'invalid request'}` }); }
});
