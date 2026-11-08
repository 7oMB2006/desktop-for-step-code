import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preparePrebuild } from './ci-canvas-prebuild.mjs';

const assetIds = Object.freeze({
  'win32-x64': '583070895',
  'darwin-arm64': '583161027',
});

export function electronPrebuild(version, checksums, platform = process.platform, arch = process.arch) {
  if (version !== '44.4.5') throw new Error(`Review official Electron assets for version ${version}`);
  const id = assetIds[`${platform}-${arch}`];
  if (!id) throw new Error(`Unsupported Electron CI platform: ${platform}/${arch}`);
  const filename = `electron-v${version}-${platform}-${arch}.zip`;
  const sha256 = checksums?.[filename];
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`Missing published Electron checksum for ${filename}`);
  }
  return {
    filename, sha256,
    url: `https://github.com/electron/electron/releases/download/v${version}/${filename}`,
    apiUrl: `https://api.github.com/repos/electron/electron/releases/assets/${id}`,
  };
}

export async function prepareElectronCache(cacheRoot) {
  const desktopRequire = createRequire(new URL('../Desktop/package.json', import.meta.url));
  const packageUrl = pathToFileURL(desktopRequire.resolve('electron/package.json'));
  const { version } = JSON.parse(readFileSync(packageUrl, 'utf8'));
  const checksums = JSON.parse(readFileSync(new URL('./checksums.json', packageUrl), 'utf8'));
  const asset = electronPrebuild(version, checksums);
  const electronRequire = createRequire(packageUrl);
  const { Cache } = await import(new URL('./Cache.js', pathToFileURL(electronRequire.resolve('@electron/get'))));
  const destination = new Cache(cacheRoot).getCachePath(asset.url, asset.filename);
  console.log(`Preparing official Electron prebuild: ${asset.url}`);
  const result = preparePrebuild(dirname(destination), asset);
  console.log(`Verified ${result} (sha256:${asset.sha256})`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || !process.argv[2]) {
    throw new Error('Expected an Electron cache directory');
  }
  await prepareElectronCache(process.argv[2]);
}
