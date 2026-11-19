import type { Capability } from '../../examples/plugins/host-client/protocol.mjs';

export type StepHostRoute = { channel: 'plan' | 'api'; region: 'cn' | 'oversea' };
export type StepHostUnavailable = 'channel-unconfirmed' | 'region-unconfirmed' | 'model-not-adapted' | 'session-model-unsupported';

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

export function stepHostUnavailable(id: Capability, route: StepHostRoute,
  model: string, videoSupported: boolean): StepHostUnavailable | undefined {
  switch (id) {
    case 'model.text': return;
    case 'model.image': return STEP_VISUAL_MODELS.includes(model) ? undefined : 'session-model-unsupported';
    case 'model.video': return videoSupported ? undefined : 'session-model-unsupported';
    case 'model.asr': return model === STEP_ASR_MODEL ? undefined : 'model-not-adapted';
    case 'model.tts': return stepTtsUnavailable(route, model);
  }
}
