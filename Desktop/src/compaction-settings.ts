export interface CompactionConfiguration {
  triggerRatio: number;
  tokenLimit: number | null;
  modelTriggerRatios: Record<string, number>;
}

export interface CompactionSettings extends CompactionConfiguration {
  revision: string;
  policy: 'v2' | 'legacy';
  enabled: boolean;
  invalidConfiguration: boolean;
}

export interface CompactionSettingsUpdate {
  revision: string;
  configuration: CompactionConfiguration;
  useRatioPolicy?: boolean;
}

export const defaultCompactionConfiguration = (): CompactionConfiguration => ({
  triggerRatio: .9, tokenLimit: null, modelTriggerRatios: {},
});

export function validCompactionRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= .5 && value <= .95;
}

export function validCompactionModelKey(value: string) {
  return value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
    && value.indexOf('/') > 0 && !value.endsWith('/');
}

export function validateCompactionUpdate(input: unknown): CompactionSettingsUpdate {
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(input) || typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(input.revision)
    || Object.keys(input).some(key => !['revision', 'configuration', 'useRatioPolicy'].includes(key))
    || (input.useRatioPolicy !== undefined && typeof input.useRatioPolicy !== 'boolean'))
    throw new Error('compaction:invalid');
  const value = input.configuration;
  if (!object(value) || Object.keys(value).some(key => !['triggerRatio', 'tokenLimit', 'modelTriggerRatios'].includes(key))
    || !validCompactionRatio(value.triggerRatio)
    || (value.tokenLimit !== null && !(typeof value.tokenLimit === 'number' && Number.isSafeInteger(value.tokenLimit) && value.tokenLimit > 0))
    || !object(value.modelTriggerRatios) || Object.keys(value.modelTriggerRatios).length > 200)
    throw new Error('compaction:invalid');
  const ratios = Object.entries(value.modelTriggerRatios);
  if (ratios.some(([key, ratio]) => !validCompactionModelKey(key) || !validCompactionRatio(ratio)))
    throw new Error('compaction:invalid');
  return { revision: input.revision as string,
    configuration: { triggerRatio: value.triggerRatio, tokenLimit: value.tokenLimit as number | null,
      modelTriggerRatios: Object.fromEntries(ratios) as Record<string, number> },
    ...(input.useRatioPolicy === undefined ? {} : { useRatioPolicy: input.useRatioPolicy }) };
}

export const compactionModelKey = (model: { provider: string; id: string }) => `${model.provider}/${model.id}`;
