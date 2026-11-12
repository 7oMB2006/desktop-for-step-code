import { ArrowRight, Image, Settings } from 'lucide-react';
import type { CustomBackgroundState } from './custom-background';
import { resolveThemeBackground, type ThemePack } from './theme-packs';
import './background-status.css';

export function BackgroundStatus({ state, pack, language, onConfigure }: {
  state?: CustomBackgroundState; pack?: ThemePack; language: 'zh' | 'en'; onConfigure(): void;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const compatible = resolveThemeBackground(pack, 'image-v1').overridden;
  const installed = Boolean(state?.available);
  const status = !installed ? t('未安装', 'Not installed')
    : state?.issue ? t('图片不可用', 'Image unavailable')
    : !state?.image ? t('未选择图片', 'No image selected')
    : !state.options.enabled ? t('跟随主题 · 图片已保留', 'Theme background · Image retained')
    : !compatible ? t('当前主题保留原背景 · 图片已保留', 'Original theme background · Image retained')
    : t('正在使用个人图片', 'Personal image active');
  return <section className="background-status" aria-label={t('自定义背景', 'Custom background')}>
    <div className="background-status-label"><Image size={18} aria-hidden="true"/><div>
      <h3>{t('自定义背景', 'Custom background')}</h3><p role="status">{status}</p>
    </div></div>
    <button type="button" onClick={onConfigure}>
      {installed ? <Settings size={15}/> : <ArrowRight size={15}/>}
      {installed ? t('配置', 'Configure') : t('前往插件', 'Open plugin')}
    </button>
  </section>;
}
