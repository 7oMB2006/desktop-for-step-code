import { useEffect, useState } from 'react';
import { Check, Save, Stethoscope, LoaderCircle } from 'lucide-react';
import type { DesktopBridge, NetworkConfig, NetworkProbe } from './contracts';
import './network-settings.css';

export function NetworkSettings({ bridge, language, busy }: { bridge: DesktopBridge; language: string; busy: boolean }) {
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  const [config, setConfig] = useState<NetworkConfig>();
  const [saved, setSaved] = useState<NetworkConfig>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [target, setTarget] = useState('https://api.openai.com/v1/models');
  const [result, setResult] = useState<NetworkProbe>();
  useEffect(() => {
    let live = true;
    void bridge.networkSettings().then(value => { if (live) { setConfig(value); setSaved(value); } },
      () => { if (live) setError(t('无法读取网络设置。', 'Could not load network settings.')); });
    return () => { live = false; };
  }, [bridge]);
  const dirty = config?.mode !== saved?.mode || config?.proxyUrl !== saved?.proxyUrl;
  const change = (value: NetworkConfig) => { setConfig(value); setNotice(''); setError(''); setResult(undefined); };
  const save = async () => {
    if (!config) return;
    setWorking(true); setError(''); setNotice(''); setResult(undefined);
    try {
      const next = await bridge.saveNetwork(config);
      setConfig(next); setSaved(next); setNotice(t('已保存并生效', 'Saved and active'));
    } catch { setError(t('保存失败。请检查代理地址，并先结束运行中的任务和连接测试。', 'Could not save. Check the proxy address and finish running tasks and connection tests.')); }
    finally { setWorking(false); }
  };
  const probe = async () => {
    setWorking(true); setError(''); setResult(undefined); setNotice('');
    try { setResult(await bridge.testNetwork(target)); }
    catch { setError(t('检测地址无效，请使用不含凭据、查询参数或片段的 HTTP(S) 地址。', 'Use an HTTP(S) test address without credentials, query parameters or a fragment.')); }
    finally { setWorking(false); }
  };
  const route = result?.route === 'proxy' ? t('代理', 'Proxy') : result?.route === 'direct' ? t('直连', 'Direct') : t('未知', 'Unknown');
  return <section className="network-settings" aria-labelledby="network-settings-title">
    <h3 id="network-settings-title" data-settings-anchor="network">{t('网络', 'Network')}</h3>
    {!config ? <p role="status">{error || t('加载中…', 'Loading…')}</p> : <>
      <fieldset disabled={working || busy}>
        <label>{t('代理模式', 'Proxy mode')}<select aria-label={t('代理模式', 'Proxy mode')} value={config.mode} onChange={event => change({ mode: event.target.value as NetworkConfig['mode'], proxyUrl: config.proxyUrl })}>
          <option value="system">{t('跟随系统代理', 'Use system proxy')}</option>
          <option value="direct">{t('直连', 'Direct connection')}</option>
          <option value="manual">{t('手动代理', 'Manual proxy')}</option>
        </select></label>
        {config.mode === 'manual' && <label>{t('代理地址', 'Proxy address')}<input type="url" value={config.proxyUrl} placeholder="http://127.0.0.1:7897" spellCheck={false} autoComplete="off"
          onChange={event => change({ ...config, proxyUrl: event.target.value })}/></label>}
      </fieldset>
      <div className="network-actions"><button type="button" disabled={working || busy || !dirty} onClick={() => void save()}><Save size={15}/>{t('保存网络设置', 'Save network settings')}</button>
        {notice && <span role="status"><Check size={14}/>{notice}</span>}
        {!notice && saved && <span>{saved.mode === 'system' ? t('当前：系统代理规则', 'Active: system proxy rules') : saved.mode === 'direct' ? t('当前：直连', 'Active: direct connection') : t('当前：手动代理', 'Active: manual proxy')}</span>}
      </div>
      <div className="network-probe">
        <label>{t('网络检测地址', 'Network test address')}<input type="url" value={target} spellCheck={false} disabled={working} onChange={event => { setTarget(event.target.value); setResult(undefined); }}/></label>
        <button type="button" disabled={working || dirty || !target.trim()} onClick={() => void probe()}>{working ? <LoaderCircle size={15} className="is-spinning"/> : <Stethoscope size={15}/>}
          {t('检测网络', 'Test network')}</button>
      </div>
      {result && <p className={result.outcome === 'reachable' ? 'network-result' : 'network-error'} role="status">
        {result.outcome === 'reachable' ? `${t('目标可达', 'Endpoint reachable')} · HTTP ${result.status}` : result.outcome === 'timeout' ? t('检测超时（15 秒）', 'Timed out (15 seconds)') : t('连接失败，请检查代理、网络或证书', 'Connection failed; check the proxy, network or certificate')}
        {` · ${route} · ${result.elapsedMs} ms`}
      </p>}
      {error && <p className="network-error" role="alert">{error}</p>}
    </>}
  </section>;
}
