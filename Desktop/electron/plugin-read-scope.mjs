import { resolve } from 'node:path';
import { packageFingerprint, PluginFileError } from './plugin-files.mjs';

const scopes = new WeakMap();
const identity = descriptor => JSON.stringify([resolve(descriptor.root), descriptor.fingerprint,
  descriptor.kind, descriptor.provenance, descriptor.id, descriptor.name, descriptor.instance,
  descriptor.source, descriptor.marketplace]);

export async function verifyPackage(descriptor, scope) {
  if (scope !== undefined) {
    if (scopes.get(scope) !== identity(descriptor)) throw new PluginFileError('stale');
    return;
  }
  if (await packageFingerprint(descriptor.root) !== descriptor.fingerprint) throw new PluginFileError('stale');
}

// A proof belongs to one awaited read, never to a renderer reference or a later operation.
export async function withVerifiedPackage(descriptor, action) {
  const key = identity(descriptor), scope = Object.freeze({});
  await verifyPackage(descriptor);
  scopes.set(scope, key);
  try {
    try { return await action(scope); }
    finally {
      if (identity(descriptor) !== key) throw new PluginFileError('stale');
      await verifyPackage(descriptor);
    }
  } finally { scopes.delete(scope); }
}
