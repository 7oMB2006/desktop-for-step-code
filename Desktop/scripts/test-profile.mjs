import { rmSync } from 'node:fs';
import { mkdtemp as createDirectory, realpath, rm } from 'node:fs/promises';

const profiles = new Set();
const aliases = new Map();
const keepProfiles = process.env.DESKTOP_KEEP_TEST_PROFILES === '1';
const reportedProfiles = new Set();
const removalOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };

export async function mkdtemp(prefix, options) {
  const created = await createDirectory(prefix, options);
  profiles.add(created);
  const profile = await realpath(created);
  profiles.delete(created);
  profiles.add(profile);
  aliases.set(created, profile);
  return created;
}

function reportRetainedPaths() {
  for (const profile of profiles) {
    if (reportedProfiles.has(profile)) continue;
    process.stderr.write(`Retained test profile: ${profile}\n`);
    reportedProfiles.add(profile);
  }
}

export async function removeTestProfile(profile) {
  const registered = aliases.get(profile) ?? profile;
  if (!profiles.has(registered)) throw new Error(`Unregistered test profile: ${profile}`);
  if (keepProfiles) {
    reportRetainedPaths();
    return;
  }
  await rm(registered, removalOptions);
  profiles.delete(registered);
  for (const [alias, target] of aliases) if (target === registered) aliases.delete(alias);
}

function reportFailure(profile, error) {
  process.stderr.write(`Failed to remove test profile ${profile}: ${error.message}\n`);
  process.exitCode = process.exitCode || 1;
}

let cleanupRunning = false;
process.on('beforeExit', async () => {
  if (keepProfiles) {
    reportRetainedPaths();
    return;
  }
  if (cleanupRunning || profiles.size === 0) return;
  cleanupRunning = true;
  const pending = [...profiles];
  for (const profile of pending) {
    try {
      await removeTestProfile(profile);
    } catch (error) {
      reportFailure(profile, error);
      profiles.delete(profile);
    }
  }
  cleanupRunning = false;
});

process.once('exit', () => {
  if (keepProfiles) {
    reportRetainedPaths();
    return;
  }
  for (const profile of profiles) {
    try {
      rmSync(profile, removalOptions);
    } catch (error) {
      if (error.code !== 'ENOENT') reportFailure(profile, error);
    }
  }
});
