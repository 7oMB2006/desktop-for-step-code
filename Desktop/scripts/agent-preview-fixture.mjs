import { copyFile, mkdir, readdir, realpath, stat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function prepareAgentPreviewFixture(profile) {
  const runtimeSource = await realpath(resolve('runtime'));
  const runtime = join(profile, 'runtime');
  const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';
  await mkdir(runtime);
  await symlink(await realpath(resolve('build')), join(profile, 'build'), directoryLink);
  // A source checkout may point at an installed package. Override the extension only in the fixture.
  for (const entry of await readdir(runtimeSource, { withFileTypes: true })) {
    const source = join(runtimeSource, entry.name);
    const target = join(runtime, entry.name);
    if (['desktop-sessions.mjs', 'windows-runtime-job.ps1'].includes(entry.name))
      await copyFile(resolve('electron', entry.name), target);
    else {
      const type = entry.isSymbolicLink() ? await stat(source) : entry;
      if (type.isDirectory()) await symlink(await realpath(source), target, directoryLink);
      else if (type.isFile()) await copyFile(source, target);
    }
  }
}
