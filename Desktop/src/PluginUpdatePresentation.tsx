import { ArrowRight, ArrowUpFromLine, Check, CircleAlert, LoaderCircle, RotateCcw } from 'lucide-react';

export interface PluginUpdateState {
  phase: 'available' | 'downloading' | 'verifying' | 'applying' | 'updated' | 'failed' | 'current' | 'unavailable';
  version: string;
  summary?: string;
  progress?: number;
  error?: string;
  restartRequired?: boolean;
}

// Both native operations and the visual fixture use the same compact presentation.
export interface PluginUpdatesPresentation {
  items: Record<string, PluginUpdateState>;
  checking: boolean;
  onCheck(): Promise<void>;
  onUpdate(id: string): Promise<boolean>;
}

export function pluginUpdatePending(state?: PluginUpdateState) {
  return Boolean(state && ['downloading', 'verifying', 'applying'].includes(state.phase));
}

export function PluginUpdateBadge({ state, language }: { state?: PluginUpdateState; language: string }) {
  if (!state || state.phase === 'current' || state.phase === 'unavailable') return null;
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const updated = state.phase === 'updated';
  const working = pluginUpdatePending(state), failed = state.phase === 'failed';
  const label = state.phase === 'downloading' ? state.progress === undefined ? t('获取中', 'Downloading') : `${Math.round(state.progress)}%`
    : state.phase === 'verifying' ? t('校验中', 'Verifying')
      : state.phase === 'applying' ? t('应用中', 'Applying')
        : failed ? t('更新失败', 'Update failed')
          : updated ? state.restartRequired ? t('待重启', 'Restart pending') : t('最新', 'Latest')
            : `v${state.version}`;
  return <span className={`pc-update-badge${updated ? ' is-current' : ''}`} data-phase={state.phase}
    role="status" aria-live="polite" title={failed ? state.error : undefined}>
    {working ? <LoaderCircle size={11} className="pc-spin"/> : failed ? <CircleAlert size={11}/>
      : updated ? <Check size={11}/> : <ArrowRight size={11}/>}
    {label}
  </span>;
}

export function PluginUpdateAction({ state, name, language, disabled = false, onUpdate, onRestart }: {
  state?: PluginUpdateState; name: string; language: string;
  disabled?: boolean; onUpdate(): void; onRestart?(): void;
}) {
  if (!state || state.phase === 'current' || state.phase === 'unavailable'
    || state.phase === 'updated' && (!state.restartRequired || !onRestart)) return null;
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const working = pluginUpdatePending(state), failed = state.phase === 'failed', updated = state.phase === 'updated';
  const label = updated ? t(`重启会话以应用 ${name} 更新`, `Restart session to apply ${name} update`)
    : failed ? t(`重试更新 ${name}`, `Retry updating ${name}`)
      : t(`更新 ${name} 至 v${state.version}`, `Update ${name} to v${state.version}`);
  const caption = working ? t('更新中', 'Updating') : updated ? t('重启', 'Restart')
    : failed ? t('重试', 'Retry') : t('更新', 'Update');
  return <span className="pc-update-action" data-phase={state.phase}>
    <button className="pc-update-trigger" type="button" disabled={disabled || working}
      aria-label={label} title={failed ? `${label} · ${state.error ?? ''}` : label}
      onClick={updated ? onRestart : onUpdate}>
      {caption}
    </button>
    {working && <span className="pc-update-progress" role="progressbar" aria-label={t(`${name} 更新进度`, `${name} update progress`)}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress} data-indeterminate={state.progress === undefined}>
      <span style={state.progress === undefined ? undefined : { transform: `scaleX(${Math.min(100, Math.max(0, state.progress)) / 100})` }}/>
    </span>}
  </span>;
}

export function PluginUpdateRow({ state, name, currentVersion, language, disabled = false, onUpdate, onRestart }: {
  state?: PluginUpdateState; name: string; currentVersion?: string; language: string;
  disabled?: boolean; onUpdate(): void; onRestart?(): void;
}) {
  if (!state || state.phase === 'current') return null;
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const working = pluginUpdatePending(state);
  const failed = state.phase === 'failed', updated = state.phase === 'updated', unavailable = state.phase === 'unavailable';
  const title = state.phase === 'downloading' ? t('正在获取更新', 'Downloading update')
    : state.phase === 'verifying' ? t('正在校验资源', 'Verifying files')
      : state.phase === 'applying' ? t('正在应用更新', 'Applying update')
        : failed ? t('更新未完成', 'Update failed')
          : updated ? t('已更新', 'Updated')
            : unavailable ? t('暂不能检查更新', 'Update check unavailable')
              : t('有新版本', 'Update available');
  const note = failed ? state.error
    : updated ? state.restartRequired ? t('重启会话后生效', 'Restart session to apply') : t('新会话将使用此版本', 'New sessions use this version')
      : unavailable ? state.error
        : working ? t('原有配置与服务开关保持不变', 'Configuration and service switches are kept')
          : state.summary;
  return <div className="pc-update-row" data-phase={state.phase}>
    <div className="pc-update-copy" role={failed ? 'alert' : 'status'} aria-live="polite">
      <span className="pc-update-title">
        {working ? <LoaderCircle size={13} className="pc-spin"/> : failed || unavailable ? <CircleAlert size={13}/>
          : updated ? <Check size={13}/> : <ArrowUpFromLine size={13}/>}
        <strong>{title}</strong>
        {!updated && !unavailable && <span className="pc-update-versions">{currentVersion ? `v${currentVersion}` : ''}
          <ArrowRight size={12}/>{`v${state.version}`}</span>}
      </span>
      {note && <span className="pc-update-note">{note}</span>}
    </div>
    {!updated && !unavailable && <button className="pc-update-button" type="button" disabled={disabled || working}
      aria-label={failed ? t(`重试更新 ${name}`, `Retry updating ${name}`) : t(`更新 ${name} 至 v${state.version}`, `Update ${name} to v${state.version}`)}
      onClick={onUpdate}>
      {working ? <LoaderCircle size={13} className="pc-spin"/> : failed ? <RotateCcw size={13}/> : <ArrowUpFromLine size={13}/>}
      {working ? t('更新中', 'Updating') : failed ? t('重试', 'Retry') : t('更新', 'Update')}
    </button>}
    {updated && state.restartRequired && onRestart && <button className="pc-update-button" type="button" disabled={disabled}
      aria-label={t(`重启会话以应用 ${name} 更新`, `Restart session to apply ${name} update`)} onClick={onRestart}>
      <RotateCcw size={13}/>{t('重启会话', 'Restart session')}
    </button>}
    {working && <span className="pc-update-progress" role="progressbar" aria-label={t(`${name} 更新进度`, `${name} update progress`)}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress} data-indeterminate={state.progress === undefined}>
      <span style={state.progress === undefined ? undefined : { transform: `scaleX(${Math.min(100, Math.max(0, state.progress)) / 100})` }}/>
    </span>}
  </div>;
}
