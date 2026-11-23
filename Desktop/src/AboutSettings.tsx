import { useEffect, useState, type ComponentProps } from 'react';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { AppUpdates } from './AppUpdates';
import type { AppBuildInfo } from './contracts';
import './about-settings.css';

const desktopSite = 'https://calm-falcon-0dc2.page.stepcloud.com/';
const desktopRepo = 'https://github.com/7oMB2006/desktop-for-step-code';
const upstreamRepo = 'https://github.com/stepfun-ai/Step-Code';
const assets = import.meta.env.BASE_URL;

export function AboutSettings(props: ComponentProps<typeof AppUpdates>) {
  const { bridge, preferences, state } = props;
  const t = (zh: string, en: string) => preferences.language === 'zh' ? zh : en;
  const [build, setBuild] = useState<AppBuildInfo | null>();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    let active = true;
    const pending = bridge?.appBuildInfo?.();
    if (pending) void pending.then(value => { if (active) setBuild(value); })
      .catch(() => { if (active) setBuild(null); });
    else setBuild(null);
    return () => { active = false; };
  }, [bridge]);
  const commit = build?.runtime?.commit;
  useEffect(() => { setCopyState('idle'); }, [commit]);
  const copyCommit = async () => {
    if (!bridge || !commit) return;
    try { await bridge.copyText(commit); setCopyState('copied'); }
    catch { setCopyState('failed'); }
  };
  const CopyIcon = copyState === 'copied' ? Check : Copy;
  const copyLabel = copyState === 'copied' ? t('已复制构建提交', 'Build commit copied') : t('复制构建提交', 'Copy build commit');
  const desktopVersion = build?.desktopVersion ?? state?.currentVersion;
  const platform = build?.platform === 'win32' ? 'Windows' : build?.platform === 'darwin' ? 'macOS' : build?.platform === 'linux' ? 'Linux' : undefined;
  const unavailable = build === undefined ? '…' : t('未识别', 'Unknown');
  return <div className="about-settings">
    <header className="about-identity">
      <h3 className="about-lockup" aria-label="Desktop for Step Code">
        <a className="about-site" href={desktopSite} target="_blank" rel="noreferrer"
          aria-label={t('Desktop for Step Code 官网', 'Desktop for Step Code website')} title={t('打开官网', 'Open website')}>
          <img className="about-mark" src={`${assets}StepCode.svg`} alt="" width="36" height="36"/>
          <img className="about-wordmark wordmark-light" src={`${assets}wordmark-light.png`} width="1000" height="151" alt="Desktop for Step Code"/>
          <img className="about-wordmark wordmark-dark" src={`${assets}wordmark-dark.png`} width="1000" height="151" alt="Desktop for Step Code"/>
        </a>
      </h3>
      <p>{t('基于 Step Code 的第三方社区桌面客户端', 'A third-party community desktop client for Step Code')}</p>
      <div className="about-links">
        <a href={desktopRepo} target="_blank" rel="noreferrer"><span className="about-github-mark" aria-hidden="true"/>{t('Desktop 项目', 'Desktop project')}<ArrowUpRight aria-hidden="true" size={12}/></a>
        <a href={upstreamRepo} target="_blank" rel="noreferrer"><span className="about-github-mark" aria-hidden="true"/>{t('Step Code 上游', 'Step Code upstream')}<ArrowUpRight aria-hidden="true" size={12}/></a>
      </div>
    </header>
    <dl className="about-versions" data-settings-anchor="build-info">
      <div><dt>{t('Desktop 版本', 'Desktop version')}</dt><dd>
        <code className="about-version">{desktopVersion ? `v${desktopVersion}` : unavailable}</code>
        {platform && <small>{platform} {build?.arch === 'arm64' && platform === 'macOS' ? 'Apple Silicon' : build?.arch}</small>}
      </dd></div>
      <div><dt>{t('内置 Step Code', 'Bundled Step Code')}</dt><dd>
        <span className="about-baseline">
          {build?.runtime?.baseline ? <><code className="about-version">{build.runtime.baseline}</code>{t('基线', 'baseline')}</>
            : <span>{build === undefined ? unavailable : t('基线未知', 'Unknown baseline')}</span>}
        </span>
        {commit && <button type="button" className="about-commit" onClick={() => void copyCommit()} title={copyLabel} aria-label={copyLabel}>
          <code>{commit.slice(0, 7)}</code><CopyIcon size={13}/>
        </button>}
        <small role="status" className={copyState === 'failed' ? undefined : 'about-sr-only'}>
          {copyState === 'copied' ? t('已复制', 'Copied') : copyState === 'failed' ? t('复制失败', 'Copy failed') : ''}
        </small>
      </dd></div>
    </dl>
    <div className="about-updates">
      <h3 data-settings-anchor="app-updates">{t('版本更新', 'Updates')}</h3>
      <AppUpdates {...props}/>
    </div>
  </div>;
}
