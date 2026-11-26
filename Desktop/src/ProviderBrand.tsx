import { Box, Sparkles } from 'lucide-react';
import type { Model } from './contracts';
import type { ProviderBrandId } from './provider-presets';
import stepfun from './assets/providers/stepfun-color.svg';
import deepseek from './assets/providers/deepseek-color.svg';
import kimi from './assets/providers/kimi-color.svg';
import zhipu from './assets/providers/zhipu-color.svg';
import bailian from './assets/providers/alibabacloud-color.svg';
import minimax from './assets/providers/minimax-color.svg';
import openai from './assets/providers/openai.svg';
import anthropic from './assets/providers/claude-color.svg';
import gemini from './assets/providers/gemini-color.svg';
import siliconflow from './assets/providers/siliconcloud-color.svg';
import ark from './assets/providers/volcengine-color.svg';

const marks: Record<ProviderBrandId, string> = {
  stepfun, deepseek, kimi, zhipu, bailian, minimax, openai, anthropic, gemini, siliconflow, ark,
};

function ProviderMarkImage({ brand, size, className }: { brand: ProviderBrandId; size: number; className?: string }) {
  return <img className={className} data-brand={brand} src={marks[brand]} width={size} height={size} alt="" draggable={false}/>;
}

export function ProviderPresetMark({ brand, size = 16 }: { brand?: ProviderBrandId; size?: number }) {
  return brand ? <ProviderMarkImage brand={brand} size={size} className="provider-preset-mark"/>
    : <Box size={size} aria-hidden="true"/>;
}

export function StepPlatformIcon({ size = 17 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="9" y="2" width="6" height="6"/><rect x="17" y="2" width="6" height="6"/><rect x="9" y="10" width="6" height="6"/><rect x="1" y="18" width="6" height="6"/><rect x="9" y="18" width="6" height="6"/></svg>;
}

function StepfunRoundMark({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M10 0a10 10 0 1 0 0 20 10 10 0 1 0 0-20ZM3.65 12.69h3.65v3.65H3.65zm4.52 0h3.65v3.65H8.17zm0-4.52h3.65v3.66H8.17zm0-4.51h3.65v3.65H8.17zm4.52-.01h3.65v3.66h-3.65z"/>
  </svg>;
}

export function ProviderBrand({ model, variant }: { model?: Model; variant: 'card' | 'row' }) {
  const step = model?.provider === 'step' || model?.provider === 'stepfun';
  const brand = step ? 'step' : model?.providerBrand ?? 'custom';
  const size = variant === 'card' ? 36 : 16;
  return <span className={`model-provider-mark ${variant === 'card' ? 'model-effort-provider-brand' : 'model-picker-provider-mark'}`}
    data-provider-brand={brand} aria-hidden="true">
    {brand === 'stepfun' ? <StepfunRoundMark size={size}/>
      : brand === 'step' ? <StepPlatformIcon size={size}/> : brand === 'custom' ? <Sparkles size={size} strokeWidth={1.5} fill="currentColor"/>
      : <span className="model-provider-silhouette" style={{ width: size, height: size, maskImage: `url(${JSON.stringify(marks[brand])})` }}/>}
  </span>;
}
