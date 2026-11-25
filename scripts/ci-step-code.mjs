import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultRuntimeBaseline, readRuntimeBaseline } from '../Desktop/scripts/runtime-baseline.mjs';

const upstream = 'Step-Code';
const { name, manifest } = await readRuntimeBaseline(defaultRuntimeBaseline);
const operation = process.argv[2] ?? 'all';
if (!['fetch', 'patch', 'all'].includes(operation)) throw new Error('Expected fetch, patch or all');
const git = (...args) => execFileSync('git', ['-C', upstream, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
});
if (operation !== 'patch') {
  if (lstatSync(upstream, { throwIfNoEntry: false })) throw new Error('CI requires a new Step-Code checkout');
  execFileSync('git', ['init', upstream], { stdio: 'inherit' });
  git('config', 'core.autocrlf', 'false');
  git('remote', 'add', 'origin', 'https://github.com/stepfun-ai/Step-Code.git');
  git('fetch', '--depth', '1', '--no-tags', 'origin', manifest.commit);
  git('checkout', '--detach', 'FETCH_HEAD');
}
if (git('rev-parse', 'HEAD').trim() !== manifest.commit) throw new Error('Unexpected Step Code revision');
if (operation !== 'fetch') {
  execFileSync(process.execPath, [
    fileURLToPath(new URL('./apply-step-code-desktop-patch.mjs', import.meta.url)),
    upstream, fileURLToPath(new URL(`../patches/${name}/step-code-desktop.patch`, import.meta.url)),
  ], { stdio: 'inherit' });
  execFileSync('git', ['-C', upstream, 'diff', '--check'], { stdio: 'inherit' });
}
