import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, cp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function buildRemoteAdapter(upstream, runtime) {
  const directory = join(upstream, 'packages/lark-adapter');
  const manifest = JSON.parse(await readFile(new URL('../../patches/v016/manifest.json', import.meta.url), 'utf8'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
  if (commit !== manifest.commit) throw new Error('Remote adapter must use the pinned upstream');
  const changed = execFileSync('git', ['diff', 'HEAD', '--', 'packages/lark-adapter'], { cwd: upstream, encoding: 'utf8' });
  if (changed.trim()) throw new Error('Remote adapter sources must be unmodified');
  const require = createRequire(join(directory, 'package.json'));
  const sdkEntry = require.resolve('@larksuiteoapi/node-sdk');
  let sdkDirectory = dirname(sdkEntry), sdk;
  while (sdkDirectory !== dirname(sdkDirectory)) {
    try {
      const candidate = JSON.parse(await readFile(join(sdkDirectory, 'package.json'), 'utf8'));
      if (candidate.name === '@larksuiteoapi/node-sdk') { sdk = candidate; break; }
    } catch {}
    sdkDirectory = dirname(sdkDirectory);
  }
  if (sdk?.version !== '1.76.0') throw new Error('Unexpected Feishu SDK version');
  await mkdir(join(runtime, 'remote'), { recursive: true });
  const result = await build({ absWorkingDir: upstream, metafile: true, stdin: { contents: `export {LarkRegistration,LarkApi,LarkInboundGate,larkCallbackSetupUrl,LARK_OPEN_HOSTS} from ${JSON.stringify(join(directory, 'src/index.ts'))};
export {Client,WSClient,EventDispatcher,LoggerLevel} from ${JSON.stringify(sdkEntry)};`, resolveDir: directory, sourcefile: 'remote-adapter.ts' },
    bundle: true, platform: 'node', target: 'node24', format: 'cjs', legalComments: 'eof',
    outfile: join(runtime, 'remote/lark-adapter.cjs') });
  await cp(join(sdkDirectory, 'LICENSE'), join(runtime, 'remote/FEISHU-SDK-LICENSE'));
  const packages = new Map(), visited = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input.startsWith('<')) continue;
    let current = dirname(resolve(upstream, input));
    while (current !== dirname(current) && !visited.has(current)) {
      visited.add(current);
      try {
        const metadata = JSON.parse(await readFile(join(current, 'package.json'), 'utf8'));
        if (metadata.name) {
          const files = (await readdir(current)).filter(name => /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(name));
          const licenses = await Promise.all(files.map(name => readFile(join(current, name), 'utf8').catch(() => '')));
          packages.set(`${metadata.name}@${metadata.version}`, `${metadata.name}@${metadata.version}\nDeclared license: ${metadata.license ?? 'see source notices'}\n${licenses.filter(Boolean).join('\n\n')}`);
          break;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      current = dirname(current);
    }
  }
  await writeFile(join(runtime, 'remote/THIRD_PARTY_NOTICES.txt'), [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n\n--------------------\n\n'));
  await writeFile(join(runtime, 'remote/NOTICE.txt'), `Desktop Remote uses the pinned Step Code lark-adapter (${commit}) and @larksuiteoapi/node-sdk ${sdk.version}.\nSee ../LICENSE, ../THIRD_PARTY_NOTICES.md, THIRD_PARTY_NOTICES.txt and FEISHU-SDK-LICENSE. Original bundled legal comments are retained.\n`);
  await build({ entryPoints: [fileURLToPath(new URL('../electron/remote-markdown.mjs', import.meta.url))],
    bundle: true, platform: 'node', target: 'node24', format: 'esm', legalComments: 'eof',
    outfile: join(runtime, 'remote-markdown.mjs') });
  for (const name of ['remote-channel.mjs', 'remote-channel-core.mjs', 'remote-media-channel.mjs', 'remote-card.mjs', 'remote-form.mjs'])
    await cp(new URL(`../electron/${name}`, import.meta.url), join(runtime, name));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildRemoteAdapter(resolve(process.argv[2]), resolve(process.argv[3] ?? 'runtime'));
