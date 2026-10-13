const { access, readFile } = require('node:fs/promises');
const { constants } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { Arch } = require('builder-util');

function assertRuntimeTarget(manifest, platform, arch, hostPlatform = process.platform, hostArch = process.arch) {
  if (!['win32', 'linux'].includes(platform) || arch !== Arch.x64
    || platform !== hostPlatform || hostArch !== 'x64') {
    throw new Error('Package natively on Windows x64 or Linux x64; cross-platform runtime packaging is unsupported');
  }
  if (manifest.platform !== platform || manifest.arch !== 'x64'
    || manifest.nodeExecutable !== (platform === 'win32' ? 'node.exe' : 'node')) {
    throw new Error('Staged runtime does not match the package target; run stage:runtime on this build host');
  }
}

module.exports = async function verifyPackageRuntime(context) {
  const runtime = join(context.packager.info.appDir, 'runtime');
  const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
  assertRuntimeTarget(manifest, context.electronPlatformName, context.arch);
  const node = join(runtime, 'node', manifest.nodeExecutable);
  await access(node, context.electronPlatformName === 'win32' ? constants.F_OK : constants.X_OK);
  if (createHash('sha256').update(await readFile(node)).digest('hex') !== manifest.nodeSha256) {
    throw new Error('Staged Node does not match the runtime manifest; restage before packaging');
  }
  await access(join(runtime, 'step/dist/bundle/step.js'));
};
module.exports.assertRuntimeTarget = assertRuntimeTarget;
