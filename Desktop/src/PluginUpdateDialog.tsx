import { useEffect, useRef } from 'react';
import { ArrowUpFromLine, Check, CircleAlert, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { capabilityErrorText } from './capability-errors';
import type { PluginUpdateOperation, PluginUpdatePreflight } from './plugin-update';

export interface PluginUpdatePanel {
  pluginId: string; name: string; preflight?: PluginUpdatePreflight;
  operation?: PluginUpdateOperation; running: boolean; error?: string;
}
export function pluginUpdateChangeText(code: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    'presentation': ['显示信息调整，保留配置', 'Presentation changes; settings retained'],
    'options-extended': ['枚举选项扩展，保留原选择', 'Options extended; existing selection retained'],
    'optional-added': ['新增可选设置，未设置的值仍留空', 'Optional setting added; missing values stay unset'],
    'configuration-added': ['首次提供配置，更新后需设置，不继承旧秘密或授权', 'First configuration added; configure after updating, without inheriting legacy secrets or authorization'],
    'input-required': ['新增必填设置，本轮暂不支持补填升级', 'Required setting added; fill-in upgrades are not supported yet'],
    'default-changed': ['默认值发生变化，需要单独确认旧用户行为', 'Default changed; existing behavior needs separate review'],
    'field-removed': ['删除或重命名字段，暂不支持自动迁移', 'Removed or renamed field; automatic migration is unsupported'],
    'type-changed': ['字段类型变化，暂不支持自动迁移', 'Field type changed; automatic migration is unsupported'],
    'constraint-changed': ['字段约束变化，暂不支持自动迁移', 'Field constraints changed; automatic migration is unsupported'],
    'option-removed': ['移除了原枚举选项，暂不支持自动迁移', 'An existing option was removed; migration is unsupported'],
    'secret-added': ['新增秘密字段，需要重新检查授权边界', 'A secret field was added; authorization review is required'],
    'consumer-changed': ['配置消费者变化，暂不支持迁移', 'Configuration consumer changed; migration is unsupported'],
    'consumer-unsupported': ['不是受支持的独立 stdio 配置消费者', 'Not a supported independent stdio consumer'],
    'host-migration-unsupported': ['宿主模式的配置迁移暂不支持', 'Host-mode configuration migration is not supported yet'],
    'schema-added-or-removed': ['新增或移除配置清单，暂不支持自动迁移', 'Configuration declaration added or removed; migration is unsupported'],
    'invalid-schema': ['配置声明无效或含未知字段', 'Invalid configuration declaration or unknown properties'],
    'services-changed': ['服务结构、默认开关或凭据边界变化', 'Service structure, defaults or credential boundary changed'],
    'session-busy': ['有会话仍有任务或受保护的运行状态，请处理后重新检查', 'A session has work or protected runtime state; resolve it and check again'],
    'runtime-unknown': ['无法确认会话状态，不会强行停止', 'Session state is unknown; it will not be forcibly stopped'],
    'runtime-changed': ['会话状态已变化，请重新检查', 'Session state changed; check again'],
    'runtime-history-unavailable': ['会话尚无可用的持久历史，不能安全重启。请先关闭未保存的空会话；若已有历史，请保留现场并检查', 'Saved session history is unavailable, so restart is blocked. Close unsaved empty sessions; preserve and review any existing history'],
    'release-unsupported': ['当前平台尚未提供可验证的自动释放', 'Verified automatic release is not available on this platform'],
  };
  return labels[code]?.[zh ? 0 : 1] ?? (zh ? '此变化暂不支持自动处理' : 'This change cannot be handled automatically');
}
export function PluginUpdateDialog({ panel, open, language, onClose, onApply, onCheck, onSession }: {
  panel?: PluginUpdatePanel; open: boolean; language: string; onClose(): void; onApply(): void; onCheck(): void;
  onSession?(sessionId: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const lastPanel = useRef(panel);
  if (panel) lastPanel.current = panel;
  const zh = language === 'zh', t = (cn: string, en: string) => zh ? cn : en;
  useEffect(() => {
    if (open && panel && !dialog.current?.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.current?.showModal();
    } else if (!open && dialog.current?.open) {
      dialog.current.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    }
  }, [open, Boolean(panel)]);
  panel = panel ?? lastPanel.current;
  if (!panel) return null;
  const { preflight, operation, running } = panel;
  const sessions = operation?.sessions ?? preflight?.sessions ?? [];
  const title = operation ? operation.installation === 'committed' ? t('新版已安装', 'New version installed')
    : operation.installation === 'unknown' ? t('更新结果待核对', 'Update outcome needs review')
      : t('尚未更新', 'Not updated')
    : preflight?.readiness === 'needs-release' ? t('需要释放会话占用', 'Sessions need to release this plugin')
      : t('需要重新检查', 'Check again before updating');
  const phase = operation?.phase;
  const stage = phase === 'releasing' ? t('正在释放占用', 'Releasing sessions')
    : phase === 'applying' ? t('正在应用更新', 'Applying update')
      : phase === 'restoring' ? t('正在恢复会话', 'Restoring sessions') : title;
  return <dialog ref={dialog} className="pc-dialog pc-update-dialog" aria-label={t('插件更新', 'Plugin update')}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{panel.name}</h2><button className="icon-button" aria-label={t('关闭更新详情', 'Close update details')}
      onClick={onClose}><X size={16}/></button></header>
    <div className="pc-update-dialog-status" role="status" aria-live="polite">
      {running ? <LoaderCircle size={17} className="pc-spin"/> : operation?.phase === 'done' ? <Check size={17}/> : <CircleAlert size={17}/>}
      <strong>{running ? stage : title}</strong><span>v{operation?.version ?? preflight?.version}</span>
    </div>
    {!operation && preflight?.readiness === 'needs-release' && <p>{t(
      '将暂停以下空闲会话，安装新版后恢复原会话。运行时临时状态会重置，已有配置和服务开关保持不变。',
      'These idle sessions will pause, then reopen after installation. Runtime-only state resets; saved settings and service switches are kept.')}</p>}
    {running && <p>{t('关闭此窗口不会取消操作。', 'Closing this window will not cancel the operation.')}</p>}
    {!!sessions.length && <ul className="pc-update-sessions">{sessions.map(item => <li key={item.runtimeId}>
      <span>{item.name}</span><small>{'restoration' in item ? item.restoration === 'restored' ? t('已恢复', 'Restored')
        : item.restoration === 'failed' ? t('未恢复', 'Not restored')
          : item.restoration === 'unknown' ? t('状态待核对', 'Needs review')
            : item.restoration === 'untouched' ? t('未中断', 'Not interrupted') : t('待恢复', 'Pending restoration')
        : item.status === 'idle' ? preflight?.readiness === 'needs-release' ? t('空闲，将重启', 'Idle; will restart') : t('空闲', 'Idle')
          : item.status === 'busy' ? t('需先处理任务', 'Work needs attention') : t('状态未知', 'Unknown')}</small>
      {!running && item.sessionId && onSession && <button className="icon-button"
        aria-label={t(`查看会话 ${item.name}`, `View session ${item.name}`)} onClick={() => onSession(item.sessionId!)}><ArrowUpFromLine size={14}/></button>}
    </li>)}</ul>}
    {!operation && preflight && <ul className="pc-update-reasons">{[...preflight.changes, ...preflight.blockers.map(code => ({ code }))].map((change, index) =>
      <li key={index}>{'field' in change && typeof change.field === 'string' && <code>{change.field}: </code>}{pluginUpdateChangeText(change.code, zh)}</li>)}</ul>}
    {operation?.error && <p role="alert">{capabilityErrorText(operation.error, zh)}</p>}
    {panel.error && <p role="alert">{panel.error}</p>}
    {operation?.installation === 'committed' && operation.sessions.some(item => item.restoration !== 'restored') &&
      <p>{t('新版已安装，但部分会话未恢复。请查看对应会话并重启，不要重复更新。', 'The new version is installed, but some sessions need recovery. Open those sessions and restart them; do not repeat the update.')}</p>}
    <footer><button autoFocus onClick={onClose}>{running || operation ? t('关闭', 'Close') : t('取消', 'Cancel')}</button>
      {!running && !operation && preflight?.readiness === 'needs-release' && <button className="primary" onClick={onApply}>
        <RotateCcw size={14}/>{t('重启相关会话并更新', 'Restart affected sessions and update')}</button>}
      {!running && (!operation && preflight?.readiness !== 'needs-release'
        || operation?.installation === 'unchanged') && <button onClick={onCheck}>
        <RotateCcw size={14}/>{t('重新检查', 'Check again')}</button>}
    </footer>
  </dialog>;
}
