import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createUpdateManifest, parseUpdateManifest, UPDATE_REPOSITORY } from '../electron/app-updates.ts';

const output = process.argv[2];
if (!output) throw new Error('Usage: tsx scripts/generate-update-feed.mjs <output.json>');
// Only the publishing workflow uses its repository token; clients never call this API.
const pages = JSON.parse(execFileSync('gh', [
  'api', '--paginate', '--slurp', `repos/${UPDATE_REPOSITORY}/releases?per_page=100`,
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new Error('Invalid release catalog');
const manifest = createUpdateManifest(pages.flat());
parseUpdateManifest(manifest, 'preview');
parseUpdateManifest(manifest, 'stable');
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ stable: manifest.channels.stable?.version ?? null, preview: manifest.channels.preview?.version ?? null }));
