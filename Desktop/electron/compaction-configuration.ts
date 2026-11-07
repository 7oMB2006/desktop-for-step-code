import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { defaultCompactionConfiguration, validCompactionModelKey, validCompactionRatio,
  validateCompactionUpdate, type CompactionSettings } from '../src/compaction-settings';

interface UpstreamConfiguration {
  readGlobalStepConfig: (env: NodeJS.ProcessEnv) => Record<string, unknown>;
  updateGlobalStepConfig: (env: NodeJS.ProcessEnv, update: (document: Record<string, unknown>) => Record<string, unknown>) => unknown;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown) => createHash('sha256').update(JSON.stringify(value ?? {})).digest('hex');

function project(document: Record<string, unknown>): CompactionSettings {
  const raw = document.compaction ?? {};
  if (!record(raw)) throw new Error('compaction:unavailable');
  const value = defaultCompactionConfiguration();
  let invalidConfiguration = false;
  if (validCompactionRatio(raw.triggerRatio)) value.triggerRatio = raw.triggerRatio;
  else if (raw.triggerRatio !== undefined) invalidConfiguration = true;
  if (typeof raw.tokenLimit === 'number' && Number.isSafeInteger(raw.tokenLimit) && raw.tokenLimit > 0) value.tokenLimit = raw.tokenLimit;
  else if (raw.tokenLimit !== undefined) invalidConfiguration = true;
  if (raw.modelTriggerRatios !== undefined) {
    if (!record(raw.modelTriggerRatios)) invalidConfiguration = true;
    else {
      const entries = Object.entries(raw.modelTriggerRatios);
      if (entries.length > 200) throw new Error('compaction:unavailable');
      value.modelTriggerRatios = Object.fromEntries(entries.filter(([key, ratio]) => {
        const valid = validCompactionModelKey(key) && validCompactionRatio(ratio);
        if (!valid) invalidConfiguration = true;
        return valid;
      })) as Record<string, number>;
    }
  }
  return { ...value, revision: revision(raw), policy: raw.triggerPolicy === 'legacy' ? 'legacy' : 'v2',
    enabled: raw.enabled !== false, invalidConfiguration };
}

/** Only the Desktop-owned global document is exposed; project/credential data never leaves this adapter. */
export function createCompactionConfiguration(upstream: UpstreamConfiguration, root: string, env: NodeJS.ProcessEnv) {
  const checkProfile = () => {
    if (!root || !isAbsolute(root) || resolve(env.STEPCODE_STORAGE_ROOT_DIR ?? '') !== resolve(root)
      || resolve(env.STEP_CODING_AGENT_DIR ?? '') !== resolve(root, 'agent'))
      throw new Error('compaction:profile');
    for (const path of [root, join(root, 'config.toml')]) {
      try { if (lstatSync(path).isSymbolicLink()) throw new Error('compaction:profile'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  };
  const read = () => {
    checkProfile();
    return project(upstream.readGlobalStepConfig(env));
  };
  const save = (input: unknown) => {
    const update = validateCompactionUpdate(input);
    checkProfile();
    upstream.updateGlobalStepConfig(env, document => {
      const current = project(document);
      if (current.revision !== update.revision) throw new Error('compaction:conflict');
      if (current.policy === 'legacy' && !update.useRatioPolicy) throw new Error('compaction:legacy');
      const next = { ...(document.compaction as Record<string, unknown> | undefined) };
      // Delete only fields owned by this editor; CLM, permissions and unknown options survive.
      delete next.triggerRatio; delete next.tokenLimit; delete next.modelTriggerRatios;
      if (update.configuration.triggerRatio !== .9) next.triggerRatio = update.configuration.triggerRatio;
      if (update.configuration.tokenLimit !== null) next.tokenLimit = update.configuration.tokenLimit;
      if (Object.keys(update.configuration.modelTriggerRatios).length) next.modelTriggerRatios = update.configuration.modelTriggerRatios;
      if (update.useRatioPolicy) next.triggerPolicy = 'v2';
      return { ...document, compaction: next };
    });
    return read();
  };
  return { read, save };
}
