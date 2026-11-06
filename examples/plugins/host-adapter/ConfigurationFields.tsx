import { useState } from 'react';
import { Eye, EyeOff, FolderOpen, Mic, Video } from 'lucide-react';
import { CapabilityDisclosure } from '../../../Desktop/src/CapabilitySettings';

export type ConnectionDraft = { endpoint: string; model: string; newKey: string; hasKey: boolean };
export type ConfigurationDraft = {
  runtimeDirectory: string;
  main: ConnectionDraft;
  asr: ConnectionDraft;
  preferCaptions: boolean;
};

// Render inside PluginCenter's configuration form; the host owns saving and IPC.
export function ConfigurationFields({ value, onChange, disabled, language, onChooseRuntime }: {
  value: ConfigurationDraft;
  onChange(value: ConfigurationDraft): void;
  disabled: boolean;
  language: 'zh' | 'en';
  onChooseRuntime(): void;
}) {
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const [revealed, setRevealed] = useState({ main: false, asr: false });
  const updateConnection = (kind: 'main' | 'asr', patch: Partial<ConnectionDraft>) =>
    onChange({ ...value, [kind]: { ...value[kind], ...patch } });
  return <fieldset className="pc-form-fields" disabled={disabled}>
    <section className="pc-form-section">
      <div className="pc-section-title"><h3>{t('模型连接', 'Model connections')}</h3></div>
      <div className="pc-api-services">
        {(['main', 'asr'] as const).map(kind => {
          const connection = value[kind], asr = kind === 'asr';
          const title = asr ? t('语音识别（ASR）', 'Speech recognition (ASR)') : t('主力模型', 'Main model');
          return <fieldset className="pc-api-service" key={kind}>
            <legend>{asr ? <Mic size={15}/> : <Video size={15}/>} {title}</legend>
            <div className="pc-api-fields">
              <div className="pc-field"><label>{asr ? t('ASR 接口地址', 'ASR API address') : t('接口地址', 'API address')}
                <input type="url" required value={connection.endpoint} spellCheck={false}
                  onChange={event => updateConnection(kind, { endpoint: event.target.value })}/></label></div>
              <div className="pc-field"><label>{asr ? 'ASR API Key' : 'API Key'}
                <span className="pc-secret">
                  <input type={revealed[kind] ? 'text' : 'password'} value={connection.newKey}
                    required={!connection.hasKey} autoComplete="new-password" spellCheck={false}
                    placeholder={connection.hasKey ? t('已配置', 'Configured') : t('输入 API Key', 'Enter API Key')}
                    onChange={event => updateConnection(kind, { newKey: event.target.value })}/>
                  <button type="button" className="icon-button" aria-pressed={revealed[kind]}
                    aria-label={revealed[kind] ? t(`隐藏 ${title} API Key`, `Hide ${title} API Key`)
                      : t(`显示 ${title} API Key`, `Show ${title} API Key`)}
                    onClick={() => setRevealed(previous => ({ ...previous, [kind]: !previous[kind] }))}>
                    {revealed[kind] ? <EyeOff size={16}/> : <Eye size={16}/>}
                  </button>
                </span></label>
                {connection.hasKey && <p className="pc-hint">{t('已配置，留空保留；输入新值替换。',
                  'Configured. Leave blank to keep, enter a new value to replace.')}</p>}
              </div>
              <div className="pc-field"><label>{asr ? t('语音识别模型', 'ASR model') : t('主力模型名称', 'Main model name')}
                <input required value={connection.model} spellCheck={false}
                  onChange={event => updateConnection(kind, { model: event.target.value })}/></label></div>
            </div>
          </fieldset>;
        })}
      </div>
    </section>
    <section className="pc-form-section">
      <div className="pc-section-title"><h3>{t('本机运行环境', 'Local runtime')}</h3></div>
      <div className="pc-field"><label>{t('运行目录', 'Runtime directory')}<span className="pc-path">
        <input value={value.runtimeDirectory} spellCheck={false}
          onChange={event => onChange({ ...value, runtimeDirectory: event.target.value })}/>
        <button type="button" className="icon-button" aria-label={t('选择运行目录', 'Choose runtime directory')}
          onClick={onChooseRuntime}><FolderOpen size={16}/></button>
      </span></label></div>
    </section>
    <CapabilityDisclosure className="pc-disclosure" label={t('高级设置', 'Advanced')}>
      <div className="pc-disclosure-content">
        <label className="pc-checkbox"><input type="checkbox" checked={value.preferCaptions}
          onChange={event => onChange({ ...value, preferCaptions: event.target.checked })}/>
          {t('优先使用已有字幕', 'Prefer available captions')}</label>
      </div>
    </CapabilityDisclosure>
  </fieldset>;
}
