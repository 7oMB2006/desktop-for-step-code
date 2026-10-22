import { useEffect, useState } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertCircle, Plug, RotateCcw } from 'lucide-react';
import type { DesktopBridge, McpServer, StepPagePreparation } from './contracts';
import { stepPageOperationError } from './steppage-errors';
import './steppage-settings.css';

export function StepPageSettings({ bridge, language, config, busy, onPrepared, onRestart }: {
  bridge: Pick<DesktopBridge, 'stepPageState' | 'prepareStepPage'>; language: string;
  config?: McpServer; busy: boolean; onPrepared(): Promise<void>; onRestart(): Promise<void>;
}) {
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const [state, setState] = useState<StepPagePreparation>();
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [pending, setPending] = useState(false);
  const [restartPending, setRestartPending] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => bridge.stepPageState().then(value => { if (active) { setState(value); setReadError(''); } })
      .catch(() => { if (active) setReadError(t('无法读取准备状态', 'Could not read preparation status')); });
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [bridge, language]);
  const errors: Record<NonNullable<StepPagePreparation['error']>, string> = {
    download: t('下载失败，请检查网络后重试。', 'Download failed. Check your connection and retry.'),
    integrity: t('文件校验不符，未执行下载内容。请重试或等待客户端更新。', 'Integrity check failed. The download was not executed. Retry or update Desktop.'),
    validation: t('启动检查未通过，未应用新文件。', 'Startup validation failed. The new file was not applied.'),
    storage: t('无法写入插件目录，请检查空间与目录权限后重试。', 'Could not write the plugin directory. Check disk space and permissions.'),
    configuration: t('启动配置未应用。已有自定义配置将保留，请在 MCP 中检查。', 'Launch configuration was not applied. Existing custom settings are preserved; check MCP.'),
  };
  const working = pending || state?.status === 'preparing';
  const ready = state?.status === 'ready';
  const prepare = async () => {
    setPending(true); setError('');
    try { setState(await bridge.prepareStepPage()); await onPrepared(); }
    catch (error) { setError(stepPageOperationError(error, 'prepare', language)); }
    finally { setPending(false); }
  };
  return <section className="steppage-settings" aria-label="StepPage">
    <div className="steppage-heading"><Plug size={19}/><div><h3>StepPage</h3><span>{t('阶跃网页发布插件', 'Step webpage publishing plugin')}</span></div>
      <span className="steppage-state" role="status">{working ? t('准备中', 'Preparing') : ready ? t('文件就绪', 'Files ready') : state?.status === 'failed' ? t('准备失败', 'Preparation failed') : state ? t('尚未准备', 'Not prepared') : t('读取中', 'Loading')}</span></div>
    <p>{t('从阶跃官方源下载并校验，在 Desktop 独立目录安装。使用包内 Node，无需另外安装环境。', 'Download and verify from the official Step CDN into Desktop storage. Uses embedded Node; no extra runtime is required.')}</p>
    <div className="steppage-actions">
      <button type="button" disabled={!state || working || busy || restartPending} onClick={() => void prepare()}>
        {state?.status === 'failed' ? <RefreshCw size={15}/> : ready ? <CheckCircle2 size={15}/> : <Download size={15}/>}
        {working ? t('正在准备…', 'Preparing…') : state?.status === 'failed' ? t('重试准备', 'Retry setup') : ready ? t('检查并应用', 'Check and apply') : t('安装并准备', 'Install and prepare')}
      </button>
      {ready && <button type="button" disabled={busy || working || restartPending} onClick={async () => {
        setRestartPending(true); setError('');
        try { await onRestart(); } catch (error) { setError(stepPageOperationError(error, 'restart', language)); }
        finally { setRestartPending(false); }
      }}><RotateCcw size={15}/>{t('重启当前会话', 'Restart current session')}</button>}
      {state?.version && <span className="steppage-version">v{state.version}</span>}
    </div>
    {(error || readError || state?.error) && <p className="steppage-error" role="alert"><AlertCircle size={15}/>{error || readError || errors[state!.error!]}</p>}
    {config?.enabled === false && <p>{t('此插件已停用。准备操作不会自动启用。', 'This plugin is disabled. Setup will not enable it.')}</p>}
    {ready && <p>{t('文件就绪不代表已连接或登录。重启需要使用它的会话后，在 MCP 状态中确认连接；网页发布仍需单独登录与授权。', 'Files ready does not mean connected or signed in. Restart each session that needs it and check MCP status. Publishing still requires separate sign-in and authorization.')}</p>}
    {busy && <p>{t('请先结束运行中的任务，再准备或应用插件。', 'Finish active tasks before preparing or applying the plugin.')}</p>}
  </section>;
}
