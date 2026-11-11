import { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, Save } from 'lucide-react';
import type { SpeechBridge, SpeechConfig, SpeechSettings as Settings } from './speech';
import { DisclosureChevron } from './DisclosureChevron';
import './speech.css';

export function SpeechSettings({ bridge, language }: { bridge: SpeechBridge; language: string }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [value, setValue] = useState<Settings>();
  const [key, setKey] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    void bridge.speechSettings().then(next => { if (alive.current) setValue(next); }, () => {
      if (alive.current) setError('load');
    });
    return () => { alive.current = false; };
  }, [bridge]);
  const patch = (change: Partial<SpeechConfig>) => {
    setValue(previous => previous ? { ...previous, ...change } : previous);
    setSaved(false); setError('');
  };
  const reload = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setSaved(false);
    try {
      const next = await bridge.speechSettings();
      if (alive.current) { setValue(next); setKey(undefined); }
    } catch { if (alive.current) setError('load'); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  const save = async () => {
    if (!value || saving.current) return;
    saving.current = true; setBusy(true); setSaved(false); setError('');
    try {
      const next = await bridge.saveSpeech({ source: value.source, endpoint: value.endpoint, model: value.model, language: value.language }, value.revision, key);
      if (alive.current) { setValue(next); setKey(undefined); setSaved(true); }
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error && failure.message.includes('speech:conflict') ? 'conflict' : 'save');
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  return <section className="speech-settings" aria-labelledby="speech-settings-title">
    <h3 id="speech-settings-title">{t('语音听写', 'Voice dictation')}</h3>
    {!value ? <><p className="muted" role="status">{error ? t('无法读取听写设置。', 'Could not load dictation settings.') : t('加载中…', 'Loading…')}</p>
      {error && <button disabled={busy} onClick={() => void reload()}><RotateCcw size={15}/>{t('重试', 'Retry')}</button>}</> : <>
      <fieldset disabled={busy}>
        <label>{t('识别服务', 'Speech service')}<span className="appearance-select"><select aria-label={t('识别服务', 'Speech service')} value={value.source} onChange={event => {
          const source = event.target.value as SpeechConfig['source'];
          patch({ source, model: source === 'follow' ? 'stepaudio-2.5-asr' : '', endpoint: '' });
          setKey('');
        }}>
          <option value="follow">{t('跟随 DFSC 账户', 'Use DFSC account')}</option>
          <option value="custom">{t('独立 ASR 服务', 'Independent ASR service')}</option>
          <option value="local">{t('本地 ASR 适配器', 'Local ASR adapter')}</option>
        </select><DisclosureChevron/></span></label>
        {value.source === 'follow' ? <p className="muted" role="status">{value.followAvailable
          ? t(`当前渠道：${value.followChannel === 'plan' ? 'Step Plan' : 'API'}，${value.followRegion === 'global' ? '海外' : '国内'}。音频发送至阶跃，可能消耗账户额度；失败不会切换计费渠道。`,
            `Current route: ${value.followChannel === 'plan' ? 'Step Plan' : 'API'}, ${value.followRegion === 'global' ? 'overseas' : 'China'}. Audio is sent to Step and may consume account quota. No billing fallback.`)
          : t('当前没有可用的已应用阶跃登录账户。请检查登录状态，或选择独立服务。', 'No applied Step login is available. Check your account or choose an independent service.')}</p> : <>
          <label>{t('完整转写接口地址', 'Full transcription endpoint')}<input type="url" autoComplete="off" spellCheck={false}
            value={value.endpoint} placeholder={value.source === 'local' ? 'http://127.0.0.1:8080/v1/audio/transcriptions' : 'https://example.com/v1/audio/transcriptions'}
            onChange={event => { patch({ endpoint: event.target.value }); setKey(''); }}/></label>
          <label>{t('模型', 'Model')}<input value={value.model} autoComplete="off" spellCheck={false} onChange={event => patch({ model: event.target.value })}/></label>
        </>}
        {value.source === 'follow' && <label>{t('识别模型', 'Recognition model')}<input value={value.model} readOnly/></label>}
        {value.source === 'custom' && <label>API Key<input type="password" autoComplete="new-password" value={key ?? ''}
          placeholder={value.hasKey && key === undefined ? t('已安全保存，留空保持不变', 'Saved securely; leave unchanged to keep') : ''}
          onChange={event => { setKey(event.target.value); setSaved(false); }}/></label>}
        <label>{t('识别语言', 'Recognition language')}<span className="appearance-select"><select aria-label={t('识别语言', 'Recognition language')} value={value.language} onChange={event => patch({ language: event.target.value })}>
          <option value="">{t('自动检测', 'Auto-detect')}</option><option value="zh">{t('中文', 'Chinese')}</option><option value="en">English</option>
        </select><DisclosureChevron/></span></label>
      </fieldset>
      {error && <p className="speech-error" role="alert">{error === 'conflict'
        ? t('设置已在其他窗口改变，当前输入尚未保存。', 'Settings changed in another window. Your current input has not been saved.')
        : t('保存失败，请检查接口地址、模型及凭据。', 'Could not save. Check the endpoint, model and credentials.')}</p>}
      <div className="speech-save"><button onClick={() => void save()} disabled={busy}><Save size={15}/>{busy ? t('保存中…', 'Saving…') : t('保存听写设置', 'Save dictation settings')}</button>
        {error && <button onClick={() => void reload()} disabled={busy}><RotateCcw size={15}/>{t('放弃修改并重新加载', 'Discard changes and reload')}</button>}
        {saved && <span role="status"><Check size={14}/>{t('已保存', 'Saved')}</span>}</div>
      <p className="muted">{t('连续听写会在录音期间分段上传音频，识别文字陆续写入草稿；短暂停顿或约 4 秒后产生一次请求。', 'Continuous dictation uploads audio during recording and appends recognized phrases to your draft, with a request after a short pause or about every 4 seconds.')}</p>
    </>}
  </section>;
}
