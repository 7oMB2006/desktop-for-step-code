import { Sparkles } from 'lucide-react';

export function StepPlatformIcon({ size = 17 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="9" y="2" width="6" height="6"/><rect x="17" y="2" width="6" height="6"/><rect x="9" y="10" width="6" height="6"/><rect x="1" y="18" width="6" height="6"/><rect x="9" y="18" width="6" height="6"/></svg>;
}

export function ProviderBrand({ provider }: { provider?: string }) {
  const step = provider === 'step' || provider === 'stepfun';
  return <span className="model-effort-provider-brand" data-provider-brand={step ? 'step' : 'custom'} title={step ? 'StepFun' : 'Custom provider'} aria-hidden="true">
    {step ? <StepPlatformIcon size={36}/> : <Sparkles size={36} strokeWidth={1.5} fill="currentColor"/>}
  </span>;
}
