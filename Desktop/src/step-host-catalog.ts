import type { Capability } from '../../examples/plugins/host-client/protocol.mjs';

export type StepHostRoute = { channel: 'plan' | 'api'; region: 'cn' | 'oversea' };
export type StepHostUnavailable = 'channel-unconfirmed' | 'region-unconfirmed' | 'model-not-adapted' | 'model-not-selected';

export const STEP_ASR_MODEL = 'stepaudio-2.5-asr';
export const STEP_TTS_MODEL = 'stepaudio-2.5-tts';
export const STEP_VISUAL_MODELS: readonly string[] = ['step-5-preview', 'step-3.7-flash'];

// Adapter allowlist, not a promise of individual account entitlement.
export const stepTtsModels: ReadonlyArray<{ id: string; apiOnly?: true; chinaOnly?: true }> = [
  { id: STEP_TTS_MODEL },
  { id: 'stepaudio-3-tts', apiOnly: true },
  { id: 'step-tts-2', apiOnly: true, chinaOnly: true },
  { id: 'step-tts-mini', apiOnly: true, chinaOnly: true },
];

export function stepTtsUnavailable(route: StepHostRoute | undefined, model: string): StepHostUnavailable | undefined {
  const entry = stepTtsModels.find(item => item.id === model);
  if (!entry) return 'model-not-adapted';
  if (entry.apiOnly && route?.channel !== 'api') return 'channel-unconfirmed';
  if (entry.chinaOnly && route?.region !== 'cn') return 'region-unconfirmed';
}

export function stepHostModels(id: Capability): readonly string[] {
  switch (id) {
    case 'model.asr': return [STEP_ASR_MODEL];
    case 'model.tts': return stepTtsModels.map(entry => entry.id);
    default: return STEP_VISUAL_MODELS;
  }
}

export function stepHostUnavailable(id: Capability, route: StepHostRoute,
  model: string | undefined): StepHostUnavailable | undefined {
  if (!model) return 'model-not-selected';
  if (!stepHostModels(id).includes(model)) return 'model-not-adapted';
  if (id === 'model.tts') return stepTtsUnavailable(route, model);
  if (model === 'step-3.7-flash' && route.channel === 'api' && route.region === 'oversea')
    return 'region-unconfirmed';
}
