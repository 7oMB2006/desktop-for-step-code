import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isolatedEnvironment } from '../electron/runtime';
import { SessionRuntimes } from '../electron/session-runtimes';
import { CapabilityService } from '../electron/capability-service';
import type { RuntimeEvent } from '../src/contracts';

const runtime = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const fixture = resolve('tests/fixtures/mcp-credential-server.mjs');

for (const type of ['oauth', 'api_key'] as const) {
  test(`native MCP startup isolates ${type} accounts without sentinel declarations`, { timeout: 90000 }, async () => {
    const folder = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-mcp-credentials-')));
    const root = join(folder, 'profile'), plugin = join(root, 'plugins', 'credential-fixture');
    const events: RuntimeEvent[] = [];
    const pool = new SessionRuntimes(event => events.push(event));
    const capabilities = new CapabilityService({ root, runtime, node, environment: () => isolatedEnvironment(root) });
    let providerRequests = 0;
    const server = createServer((_request, response) => { providerRequests++; response.writeHead(503); response.end(); });
    try {
      await mkdir(plugin, { recursive: true });
      await mkdir(join(root, 'agent'), { recursive: true });
      const credential = type === 'oauth'
        ? { type, access: 'dfsc-account-fixture-private', refresh: 'fixture-refresh', expires: Number.MAX_SAFE_INTEGER, profile: 'step_plan' }
        : { type, key: 'dfsc-account-fixture-private', profile: 'platform_cn' };
      const auth = JSON.stringify({ step: credential });
      await writeFile(join(root, 'auth.json'), auth);
      await writeFile(join(root, 'plugins', '.stepcode-preinstalled'), '["steppage"]');
      const cases = [
        { name: 'raw', plugin: false, env: {}, step: false, stepfun: false },
        { name: 'bare', plugin: true, env: {}, step: false, stepfun: false },
        { name: 'wrong-name', plugin: true, env: { STEP_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' }, step: true, stepfun: false },
        { name: 'independent', plugin: true, env: { STEP_API_KEY: 'fixture-independent-step', STEPFUN_API_KEY: 'fixture-independent-stepfun' }, step: true, stepfun: true },
        { name: 'legacy', plugin: true, env: { STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' }, step: false, stepfun: true },
        { name: 'steppage__steppage', plugin: false, env: {}, step: false, stepfun: false },
      ];
      const declarations = cases.map(item => ({ ...item, declaration: {
        command: node, args: [fixture, join(folder, `${item.name}.json`)], env: item.env,
      } }));
      await writeFile(join(plugin, 'step.plugin.json'), JSON.stringify({
        id: 'credential-fixture', version: '1.0.0',
        mcpServers: Object.fromEntries(declarations.filter(item => item.plugin).map(item => [item.name, item.declaration])),
      }));
      const toml = declarations.filter(item => !item.plugin).map(item =>
        `[mcp_servers."${item.name}"]\ncommand = ${JSON.stringify(node)}\nargs = ${JSON.stringify(item.declaration.args)}\n`);
      await writeFile(join(root, 'config.toml'), `[telemetry]\nenabled = false\n\n${toml.join('\n')}`);
      await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const models = join(root, 'fixture-models.json');
      await writeFile(models, JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'local', providers: { fixture: {
        baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'local-fixture',
        models: [{ id: 'local', name: 'Local fixture', input: ['text'], contextWindow: 32768, maxTokens: 1024 }],
      } } }));
      const worker = await pool.open(node, join(runtime, 'step/dist/bundle/step.js'), folder, {
        ...isolatedEnvironment(root), HOME: root, USERPROFILE: root, STEPCODE_CONFIG_PATH: models,
        STEPCODE_DESKTOP_AUTH_PATH: join(root, 'auth.json'), STEPCODE_DESKTOP_AUTH_DATA: auth,
        DESKTOP_SESSION_TOKEN: 'fixture-collaboration-private',
      });
      const summary = await worker.rpc.request('get_desktop_summary');
      for (const item of cases) {
        const published = item.plugin ? `credential-fixture__${item.name}` : item.name;
        assert.ok(summary.mcp.some((entry: { name: string; status: string }) =>
          entry.name === published && entry.status === 'connected'), `${published} must complete a real MCP handshake`);
        const report = JSON.parse(await readFile(join(folder, `${item.name}.json`), 'utf8'));
        for (const child of [report.parent, report.descendant]) {
          assert.deepEqual(child, {
            accountPresent: false, desktopAuthPresent: false, collaborationPresent: false,
            stepPresent: item.step, stepfunPresent: item.stepfun,
            independentStep: item.name === 'independent', independentStepfun: item.name === 'independent',
            legacySentinel: item.name === 'legacy',
          }, `${published}: only explicitly configured credentials may reach either generation`);
        }
      }
      assert.equal(providerRequests, 0, 'Startup isolation must not call a model');
      assert.doesNotMatch(JSON.stringify([events, summary]), /dfsc-account-fixture-private|fixture-refresh|fixture-collaboration-private/);
      assert.equal(await readFile(join(root, 'auth.json'), 'utf8'), auth, 'Starting MCP must not rewrite the account');
      const required = join(root, 'plugins', 'requires-account');
      await mkdir(required);
      await writeFile(join(required, 'step.plugin.json'), JSON.stringify({
        id: 'requires-account', mcpServers: { probe: { command: 'fixture-never-run' } },
        provision: { command: 'fixture-never-run', requiresEnv: ['STEPFUN_API_KEY'] },
      }));
      const catalog = await capabilities.catalog();
      const diagnostic = catalog.plugins.find(item => item.id === 'requires-account');
      assert.ok(diagnostic, 'The real management worker must diagnose the installed plugin');
      assert.match(diagnostic.warnings.join(' '), /STEPFUN_API_KEY/);
      assert.doesNotMatch(diagnostic.warnings.join(' '), /\/login|dfsc-account-fixture-private/);
    } finally {
      await pool.stopAll();
      await capabilities.stop();
      server.closeAllConnections();
      if (server.listening) await new Promise<void>(done => server.close(() => done()));
      await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}
