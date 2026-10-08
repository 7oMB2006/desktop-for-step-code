import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Download, RefreshCw, TriangleAlert } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { DisclosureChevron } from './DisclosureChevron';
import type { AppUpdateState, DesktopBridge, Preferences } from './contracts';
import './app-updates.css';

export function useAppUpdates(bridge: DesktopBridge | undefined) {
  const [state, setState] = useState<AppUpdateState>();
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let received = false;
    const unsubscribe = bridge.onUpdateEvent(next => { received = true; setState(next); });
    void bridge.updateState().then(next => { if (active && !received) setState(next); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  return state;
}

export function AppUpdates({ bridge, state, preferences, onPreferences }: {
  bridge: DesktopBridge | undefined; state: AppUpdateState | undefined; preferences: Preferences;
  onPreferences: (patch: Partial<Preferences>) => Promise<void>;
}) {
  const zh = preferences.language === 'zh';
  const t = (a: string, b: string) => zh ? a : b;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setActionError('');
    try { await action(); }
    catch { if (active.current) setActionError(t('操作未完成，请重试。', 'The action could not be completed. Please retry.')); }
    finally { if (active.current) setBusy(false); }
  };
  const checking = state?.status === 'checking';
  const release = state?.release;
  const available = state?.updateAvailable === true;
  const errors = {
    network: t('暂时连不上 GitHub，请检查网络后重试。', 'Cannot reach GitHub. Check your connection and try again.'),
    'rate-limit': t('GitHub 暂时限制了更新请求，请稍后重试。', 'GitHub has temporarily limited update requests. Try again later.'),
    'invalid-response': t('GitHub 返回的发布信息无法识别。', 'The release information from GitHub could not be read.'),
    'unsupported-version': t('当前版本号无法比较，请打开发布页核对。', 'This version cannot be compared. Check the releases page.'),
    'feed-unavailable': t('正式版更新清单尚未发布，请查看发布页。', 'The stable update manifest is not published yet. Check the releases page.'),
  };
  const status = checking ? t('正在检查更新…', 'Checking for updates…')
    : state?.status === 'error' ? errors[state.error ?? 'network']
    : available ? t(`发现新版本 ${release!.version}`, `Version ${release!.version} is available`)
    : state?.status === 'current' ? state.source === 'release-feed' ? t('近期发布中未发现更高版本', 'No newer version in recent releases') : t('当前没有更高版本', 'No newer version is available')
    : state?.status === 'no-release' ? state.source === 'release-feed' ? t('近期发布中暂无可识别版本', 'No recognized versions in recent releases') : t('此通道暂无发布版本', 'No releases in this channel yet')
    : t('尚未检查更新', 'Updates have not been checked');
  const time = (value: number) => new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
  const Icon = checking ? RefreshCw : state?.status === 'error' ? TriangleAlert : state?.status === 'current' ? Check : ArrowUpRight;
  return <section className="app-updates" aria-label={t('应用更新', 'App updates')}>
    <div className="update-version"><div><strong>Desktop for Step Code</strong><span>{state ? `v${state.currentVersion}` : '…'} · Windows x64</span></div><span className="update-edition">{t('社区预览版', 'Community preview')}</span></div>
    <div className={`update-status${available ? ' available' : state?.status === 'error' ? ' failed' : ''}`} role="status" aria-live="polite">
      <Icon size={17} className={checking ? 'update-spinning' : undefined}/><div><strong>{status}</strong>
        <small>{checking ? 'GitHub Releases' : state?.checkedAt ? t(`检查于 ${time(state.checkedAt)}`, `Checked ${time(state.checkedAt)}`) : 'GitHub Releases'}</small>
        {state?.status === 'error' && state.retryAt && <small>{t(`可重试时间 ${time(state.retryAt)}`, `Retry after ${time(state.retryAt)}`)}</small>}
      </div>
    </div>
    {release && <div className="update-release">
      <div className="update-release-heading"><strong>{release.name || `v${release.version}`}</strong><span>{release.prerelease === undefined ? t('GitHub 发布', 'GitHub release') : release.prerelease ? t('预览版', 'Preview') : t('正式版', 'Stable')}</span></div>
      {release.publishedAt && <small>{t('发布于 ', 'Published ')}{time(Date.parse(release.publishedAt))}</small>}
      {available && !release.installer && <p className="update-package-missing">{state.source === 'release-feed' ? t('请在发布页核对 Windows x64 安装包。', 'Check the releases page for a Windows x64 installer.') : t('此版本暂未提供 Windows x64 安装包。', 'This release has no Windows x64 installer yet.')}</p>}
      {release.notes && <details className="update-notes"><summary>{t('版本说明', 'Release notes')}<DisclosureChevron/></summary><div><ReactMarkdown skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{release.notes}</ReactMarkdown></div></details>}
    </div>}
    <div className="update-actions">
      <button disabled={!bridge || busy || checking} onClick={() => void run(() => bridge!.checkUpdates())}><RefreshCw size={15}/>{t('检查更新', 'Check for updates')}</button>
      {available && release?.installer && <button className="primary" disabled={busy} onClick={() => void run(() => bridge!.openUpdate('download'))}><Download size={15}/>{t('下载安装包', 'Download installer')}</button>}
      <button disabled={!bridge || busy} onClick={() => void run(() => bridge!.openUpdate('release'))}><ArrowUpRight size={15}/>{t('发布页', 'Releases')}</button>
    </div>
    {available && release?.installer && <p className="update-download-detail">{(release.installer.size / 1024 ** 2).toFixed(1)} MB · {t('由系统浏览器下载，安装前请结束运行中的任务。', 'Downloads in your system browser. Finish running tasks before installing.')}</p>}
    {actionError && <p className="update-action-error" role="alert">{actionError}</p>}
    <div className="update-preferences">
      <label className="checkbox"><input type="checkbox" checked={preferences.autoCheckUpdates !== false} disabled={busy} onChange={event => {
        const autoCheckUpdates = event.target.checked;
        void run(async () => { await onPreferences({ autoCheckUpdates }); if (autoCheckUpdates) await bridge!.checkUpdates(); });
      }}/>{t('自动检查更新', 'Automatically check for updates')}</label>
      <label className="update-channel-field">{t('更新通道', 'Update channel')}
        <select aria-label={t('更新通道', 'Update channel')} value={preferences.updateChannel ?? 'preview'}
          disabled={!bridge || busy || checking} onChange={event => {
            const updateChannel = event.target.value as 'stable' | 'preview';
            void run(async () => { await onPreferences({ updateChannel }); await bridge!.checkUpdates(); });
          }}>
          <option value="preview">{t('正式版与预览版', 'Stable and preview')}</option>
          <option value="stable">{t('仅正式版', 'Stable only')}</option>
        </select>
      </label>
    </div>
  </section>;
}
