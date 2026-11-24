import { cp, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';

const require = createRequire(import.meta.url);
const mcp = require.resolve('@playwright/mcp/package.json');
const fromMcp = createRequire(mcp);
const playwright = fromMcp.resolve('playwright/package.json');
const core = createRequire(playwright).resolve('playwright-core/package.json');
if (core !== fromMcp.resolve('playwright-core/package.json'))
  throw new Error('Playwright preview dependencies resolved different Playwright Core packages');

const dist = join(await realpath('.'), 'dist');
await mkdir(dist, { recursive: true });
if (await realpath(dist) !== dist) throw new Error('Playwright preview requires a local dist directory');
const target = join(dist, 'playwright-preview');
const existing = await lstat(target).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
if (existing && await realpath(target) !== target) throw new Error('Playwright preview output must not be a link');
await rm(target, { recursive: true, force: true });

// Stage the pinned MCP dependency closure, not the separate test Playwright or browser binaries.
for (const [name, manifest] of [['@playwright/mcp', mcp], ['playwright', playwright], ['playwright-core', core]]) {
  const root = dirname(manifest);
  await cp(root, join(target, 'node_modules', name), { recursive: true,
    filter: source => !relative(root, source).split(sep).includes('node_modules') });
}
await cp('electron/playwright-preview-helper.cjs', join(target, 'playwright-preview-helper.cjs'));
