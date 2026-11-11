import type { PluginConnection } from './capabilities';

export type PluginConnectionGuide = 'setup' | 'firstTask' | 'troubleshooting';
export type PreparationStepId = 'profile' | 'companion' | 'bridge' | 'roots';
export type PreparationResult = 'unchecked' | 'found' | 'missing' | 'invalid' | 'configured'
  | 'pairing' | 'unavailable' | 'mismatch' | 'verified' | 'authorized' | 'no-roots';
export interface PreparationStep {
  id: PreparationStepId;
  result: PreparationResult;
  tone: 'neutral' | 'verified' | 'attention';
  action: 'choose' | PluginConnectionGuide;
}

export function pluginConnectionPreparation(state?: PluginConnection): PreparationStep[] {
  const steps: PreparationStep[] = [
    { id: 'profile', result: 'unchecked', tone: 'neutral', action: 'choose' },
    { id: 'companion', result: 'unchecked', tone: 'neutral', action: 'setup' },
    { id: 'bridge', result: 'unchecked', tone: 'neutral', action: 'setup' },
    { id: 'roots', result: 'unchecked', tone: 'neutral', action: 'setup' },
  ];
  if (!state || state.status === 'unselected') return steps;
  if (state.status === 'profile-missing') {
    steps[0] = { ...steps[0], result: 'missing', tone: 'attention' };
    return steps;
  }
  steps[0] = { ...steps[0], result: 'found', tone: 'verified' };
  if (state.status === 'companion-missing') {
    steps[1] = { ...steps[1], result: 'missing', tone: 'attention' };
    return steps;
  }
  // This status can come from either configuration file; neither is certified.
  if (state.status === 'configuration-invalid') {
    steps[1] = { ...steps[1], result: 'invalid', tone: 'attention', action: 'troubleshooting' };
    return steps;
  }
  steps[1] = { ...steps[1], result: 'configured', tone: 'verified' };
  if (state.status !== 'ready') {
    const result = { 'pairing-required': 'pairing', 'connection-unavailable': 'unavailable',
      'identity-mismatch': 'mismatch' } as const;
    steps[2] = { ...steps[2], result: result[state.status], tone: 'attention',
      action: state.status === 'pairing-required' ? 'setup' : 'troubleshooting' };
    return steps;
  }
  steps[2] = { ...steps[2], result: 'verified', tone: 'verified' };
  steps[3] = { ...steps[3], result: state.roots.length ? 'authorized' : 'no-roots',
    tone: state.roots.length ? 'verified' : 'attention' };
  return steps;
}
