import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Digests are from Automattic/node-canvas's official v3.2.3 Release assets.
export const canvasPrebuilds = Object.freeze({
  'win32-x64': Object.freeze({
    filename: 'canvas-v3.2.3-napi-v7-win32-x64.tar.gz',
    sha256: 'ba953cc8c38303ab94cc83461c7561506a5a3af37d6c678de4a47914d2d0bb48',
  }),
  'darwin-arm64': Object.freeze({
    filename: 'canvas-v3.2.3-napi-v7-darwin-arm64.tar.gz',
    sha256: '38c296c9d81c05598db849fb8103543d6649fec7246c35197d9be8199c75116f',
  }),
});

export function canvasPrebuild(platform = process.platform, arch = process.arch) {
  const asset = canvasPrebuilds[`${platform}-${arch}`];
  if (!asset) throw new Error(`Unsupported canvas CI platform: ${platform}/${arch}`);
  return {
    ...asset,
    url: `https://github.com/Automattic/node-canvas/releases/download/v3.2.3/${asset.filename}`,
  };
}

export function downloadReleaseAsset(url, destination, execute = execFileSync) {
  execute('curl', [
    '--fail', '--location', '--silent', '--show-error',
    '--proto', '=https', '--proto-redir', '=https',
    '--connect-timeout', '15', '--max-time', '120',
    '--retry', '2', '--retry-delay', '2', '--retry-max-time', '240',
    '--retry-all-errors', '--output', destination, url,
  ], { timeout: 360000, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
}

export function verifyPrebuild(file, sha256) {
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== sha256) throw new Error(`SHA-256 mismatch for ${file}`);
}

export function preparePrebuild(directory, asset, download = downloadReleaseAsset) {
  const destination = join(resolve(directory), asset.filename);
  if (existsSync(destination)) {
    verifyPrebuild(destination, asset.sha256);
    return destination;
  }
  mkdirSync(resolve(directory), { recursive: true });
  const pending = `${destination}.${process.pid}.download`;
  try {
    download(asset.url, pending);
    verifyPrebuild(pending, asset.sha256);
    renameSync(pending, destination);
    return destination;
  } finally {
    rmSync(pending, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || !process.argv[2]) {
    throw new Error('Expected a canvas local-prebuild directory');
  }
  const asset = canvasPrebuild();
  console.log(`Preparing official canvas prebuild: ${asset.url}`);
  const destination = preparePrebuild(process.argv[2], asset);
  console.log(`Verified ${destination} (sha256:${asset.sha256})`);
}
