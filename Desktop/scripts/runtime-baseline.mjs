import { readFile } from 'node:fs/promises';

const baselines = new Map([
  ['v017', new URL('../../patches/v017/manifest.json', import.meta.url)],
  ['v018', new URL('../../patches/v018/manifest.json', import.meta.url)],
]);

export const defaultRuntimeBaseline = 'v018';

export async function readRuntimeBaseline(name = process.env.DESKTOP_RUNTIME_BASELINE ?? defaultRuntimeBaseline) {
  const file = baselines.get(name);
  if (!file) throw new Error(`Unknown Desktop runtime baseline: ${name}`);
  return { name, manifest: JSON.parse(await readFile(file, 'utf8')) };
}
