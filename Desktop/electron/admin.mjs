import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Management lives in a separate process so Step globals never enter Electron.
const root = dirname(fileURLToPath(import.meta.url));
const desktopAuth = Boolean(process.env.STEPCODE_DESKTOP_AUTH_PATH);
const upstream = await import(pathToFileURL(join(root, 'step/dist/bundle/index.js')).href);
const authPath = process.env.STEPCODE_AUTH_PATH;
const sessions = process.env.STEP_CODING_AGENT_SESSION_DIR;
const agentDir = process.env.STEP_CODING_AGENT_DIR;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let login;
const safeMcp = servers => Object.fromEntries(Object.entries(servers).map(([name, item]) => [name, {
  command: item.command, args: item.args, cwd: item.cwd, url: item.url, enabled: item.enabled !== false,
  configuredSecrets: [...Object.keys(item.env ?? {}), ...Object.keys(item.http_headers ?? {})],
}]));
async function dispatch(message) {
  switch (message.type) {
    case 'sessions': return (await upstream.SessionManager.listAll(sessions)).map(({ allMessagesText, ...s }) => s);
    case 'settings': {
      const config = upstream.readGlobalStepConfig();
      return {
        account: await upstream.getStepLoginStatus({ authPath }),
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
        return desktopAuth ? upstream.readDesktopAuthData() : null;
      } finally { login = undefined; }
    }
    case 'cancel_login': login?.abort(); return null;
    case 'logout': await upstream.logoutStepCredentials({ nativePath: authPath, legacyPath: process.env.STEPCODE_LEGACY_AUTH_PATH, env: process.env }); return desktopAuth ? upstream.readDesktopAuthData() : null;
    default: throw new Error('Unsupported management request');
  }
}
createInterface({ input: process.stdin }).on('line', async line => {
  let request;
  try { request = JSON.parse(line); const data = await dispatch(request); send({ id: request.id, type: 'response', success: true, data }); }
  catch { send({ id: request?.id, type: 'response', success: false, error: `Management operation failed: ${request?.type ?? 'invalid request'}` }); }
});
