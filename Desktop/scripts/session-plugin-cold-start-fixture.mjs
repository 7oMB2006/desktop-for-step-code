import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PluginConfigurationStore } from '../electron/plugin-configuration.mjs';
import { PluginHostBindingStore } from '../electron/plugin-host-contract.mjs';
import { digest, installationReceipt, packageFingerprint, writePrivateData, writeReceipts } from '../electron/plugin-files.mjs';
import { queueFixture } from './queue-demo-fixture.mjs';

export const COLD_START_PAYLOAD_FILES = 3920;
export const COLD_START_PLUGIN_IDS = { sdk: 'dfsc-host-example', large: 'startup-dependency-tools' };
export const COLD_START_DESKTOP_TITLES = { sdk: 'Startup SDK tools', large: 'Startup dependency tools' };
const marketplaceName = 'startup-synthetic-market';
const sdkSource = resolve('../examples/plugins/sdk-host-starter/plugins/dfsc-host-example');

async function presentation(directory, title) {
  const pages = ['start', 'connections', 'reference'].map(id =>
    ({ id, title: id, document: `docs/${id}.md` }));
  await mkdir(join(directory, 'docs'), { recursive: true });
  await writeFile(join(directory, 'dfsc.plugin.json'), JSON.stringify({ schemaVersion: 1,
    desktop: { title, surface: 'main-view', symbol: 'bot', defaultPage: 'start', pages } }));
  await Promise.all(pages.map(page => writeFile(join(directory, page.document), `# ${title}\n\n${page.id}\n`)));
}

export async function treeInventory(directory) {
  let files = 0, bytes = 0;
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, child.name);
    if (child.isDirectory()) {
      const nested = await treeInventory(path);
      files += nested.files; bytes += nested.bytes;
    } else {
      files++;
      bytes += (await lstat(path)).size;
    }
  }
  return { files, bytes };
}

export async function createColdStartPluginFixture(profile, node, { payloadFiles = COLD_START_PAYLOAD_FILES } = {}) {
  const model = await queueFixture(profile, { duration: 300, textOnly: true });
  try {
    const root = join(profile, 'step-runtime'), ids = COLD_START_PLUGIN_IDS;
    const sdk = join(root, 'plugins', ids.sdk), large = join(root, 'plugins', ids.large);
    const sdkLaunchLog = join(profile, 'sdk-launches.jsonl'), largeLaunchLog = join(profile, 'unrelated-launches.jsonl');
    await cp(sdkSource, sdk, { recursive: true });
    const sdkManifest = JSON.parse(await readFile(join(sdk, 'step.plugin.json'), 'utf8'));
    sdkManifest.mcpServers.example = { command: node, args: ['startup-fixture.mjs'],
      env: { STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' } };
    await writeFile(join(sdk, 'step.plugin.json'), JSON.stringify(sdkManifest));
    await writeFile(join(sdk, 'startup-fixture.mjs'), [
      "import { appendFile } from 'node:fs/promises';",
      `await appendFile(${JSON.stringify(sdkLaunchLog)}, JSON.stringify({ pid: process.pid }) + '\\n');`,
      "await import('./dist/server.mjs');",
    ].join('\n'));
    await writeFile(join(sdk, 'dfsc.settings.json'), JSON.stringify({
      schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'example' },
      groups: [{ id: 'connection', title: 'Fixture connection',
        fields: [{ id: 'key', label: 'API Key', type: 'secret', required: true }] }],
    }));
    await presentation(sdk, COLD_START_DESKTOP_TITLES.sdk);
    await mkdir(large, { recursive: true });
    const largeManifest = { id: ids.large, name: COLD_START_DESKTOP_TITLES.large, version: '0.1.0',
      skills: [], commands: [], agents: [],
      mcpServers: { tools: { command: node, args: ['unused-server.mjs'] } } };
    await writeFile(join(large, 'step.plugin.json'), JSON.stringify(largeManifest));
    await writeFile(join(large, 'unused-server.mjs'), [
      "import { appendFile } from 'node:fs/promises';",
      `await appendFile(${JSON.stringify(largeLaunchLog)}, JSON.stringify({ pid: process.pid }) + '\\n');`,
      'process.exit(29);',
    ].join('\n'));
    await presentation(large, COLD_START_DESKTOP_TITLES.large);
    // Reproduce a legacy many-file executable package, not the theme-only fast path.
    for (let start = 0; start < payloadFiles; start += 49) {
      const dependency = join(large, 'node_modules', `synthetic-${String(start / 49).padStart(3, '0')}`);
      await mkdir(dependency, { recursive: true });
      await Promise.all(Array.from({ length: Math.min(49, payloadFiles - start) }, (_, offset) =>
        offset === 0
          ? writeFile(join(dependency, 'package.json'), JSON.stringify({
            name: `synthetic-${start}`, version: '0.0.0', description: 'x'.repeat(8100) }))
          : writeFile(join(dependency, `unused-${String(offset).padStart(2, '0')}.mjs`), `// ${'x'.repeat(8188)}\n`)));
    }
    const market = join(root, 'marketplaces', marketplaceName), candidate = join(market, 'plugins', ids.large);
    await mkdir(join(market, '.step-plugin'), { recursive: true });
    await cp(large, candidate, { recursive: true });
    await writeFile(join(market, '.step-plugin', 'marketplace.json'), JSON.stringify({
      name: marketplaceName, plugins: [{ name: ids.large, source: `./plugins/${ids.large}` }],
    }));
    const info = await lstat(market);
    const stamp = digest(JSON.stringify(['local', null, resolve(market), info.dev, info.ino, info.birthtimeMs]));
    const generation = randomUUID();
    await writePrivateData(root, 'desktop-plugins/sources.json',
      { version: 1, sources: [{ name: marketplaceName, stamp, generation }] });
    const installations = [];
    for (const [id, directory, manifest] of [[ids.sdk, sdk, sdkManifest], [ids.large, large, largeManifest]]) {
      const receipt = installationReceipt({ name: id }, {
        name: marketplaceName, kind: 'local', path: market, desktopIdentity: generation,
      }, manifest, await packageFingerprint(directory));
      receipt.state = 'installed';
      installations.push(receipt);
    }
    await writeReceipts(root, { version: 1, installations });
    const receipt = installations.find(item => item.id === ids.sdk);
    const descriptor = { root: sdk, kind: 'installed', provenance: 'recorded', ref: 'cold-start-fixture',
      name: receipt.folder, id: receipt.id, instance: receipt.instance, fingerprint: receipt.fingerprint };
    // Persist the real stores before launch. Never drain the app's catalog queue to configure a measured run.
    const configuration = await new PluginConfigurationStore(root).save(descriptor, {
      revision: 'unconfigured', values: {},
      secrets: { key: { action: 'replace', value: 'synthetic-cold-start-key' } },
    });
    const selection = await new PluginHostBindingStore(root).select(descriptor, {
      revision: 'unconfigured', mode: 'independent', configurationRevision: configuration.revision,
    });
    if (!selection.configurationCurrent) throw new Error('Synthetic host binding was not persisted');
    await writeFile(join(root, 'config.toml'), (await readFile(join(root, 'config.toml'), 'utf8'))
      + `\n[mcp_servers."${ids.large}__tools"]\nenabled = false\n`);
    await writeFile(join(root, 'plugins', '.stepcode-preinstalled'), '["steppage"]');
    await writeFile(join(profile, 'preferences.json'), JSON.stringify({
      language: 'zh', theme: 'light', workspace: model.workspace, workspaces: [model.workspace],
    }));
    return { root, model, sdkLaunchLog, largeLaunchLog, historicalSessionId: 'queue-demo',
      descriptor, configurationRevision: configuration.revision,
      inventory: { installed: await treeInventory(large), marketplace: await treeInventory(candidate),
        payloadFilesPerCopy: payloadFiles, copies: 2, executablePlugin: true, desktopPagesPerPlugin: 3,
        dependencyDirectory: 'node_modules', sdkMode: 'independent', unrelatedServiceEnabled: false } };
  } catch (error) {
    await model.close();
    throw error;
  }
}
