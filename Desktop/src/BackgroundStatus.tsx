import { Image } from 'lucide-react';
import type { CustomBackgroundState } from './custom-background';
import { resolveThemeBackground, type ThemePack } from './theme-packs';
import './background-status.css';

export function BackgroundStatus({ state, pack, language }: {
  state?: CustomBackgroundState; pack?: ThemePack; language: 'zh' | 'en';
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const compatible = resolveThemeBackground(pack, 'image-v1').overridden;
  const status = !state?.available ? t('正在读取背景设置', 'Loading background settings')
    : state?.issue ? t('图片不可用', 'Image unavailable')
    : !state?.image ? t('未选择图片', 'No image selected')
    : !state.options.enabled ? t('跟随主题 · 图片已保留', 'Theme background · Image retained')
    : !compatible ? t('当前主题保留原背景 · 图片已保留', 'Original theme background · Image retained')
    : t('正在使用个人图片', 'Personal image active');
  return <section className="background-status" aria-label={t('自定义背景', 'Custom background')}>
    <div className="background-status-label"><Image size={18} aria-hidden="true"/><div>
      <h3>{t('自定义背景', 'Custom background')}</h3><p role="status">{status}</p>
    </div></div>
  </section>;
}
