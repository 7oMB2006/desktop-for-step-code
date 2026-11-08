import { rm, rmdir } from 'node:fs/promises';

export async function removeLinkEntry(path: string): Promise<void> {
  try {
    if (process.platform === 'win32') await rmdir(path);
    else await rm(path, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function removeArtifactFixture(root: string, links: string[]): Promise<void> {
  for (const path of links) await removeLinkEntry(path);
  await rm(root, { recursive: true, force: true });
}
