import React, { useEffect, useState } from 'react';
import { Check, Copy, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import { MAX_GLOBAL_INSTRUCTIONS_LENGTH, type GlobalInstructions } from './global-instructions';
import './global-instructions.css';

export function useGlobalInstructionsEditor(bridge: DesktopBridge | undefined, active: boolean) {
  const [value, setValue] = useState<GlobalInstructions>();
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed'>();
  const [error, setError] = useState<'load' | 'save' | 'conflict'>();
  useEffect(() => { setCopyStatus(undefined); }, [value?.path]);
  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timer = setTimeout(() => setCopyStatus(undefined), 1500);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  useEffect(() => {
    if (!bridge || !active || value) return;
    let live = true;
    setLoading(true);
    setError(undefined);
    void bridge.globalInstructions().then(next => {
      if (live) { setValue(next); setDraft(next.content); setLoading(false); }
    }, () => { if (live) { setError('load'); setLoading(false); } });
    return () => { live = false; };
  }, [bridge, active, Boolean(value)]);

  const reload = async () => {
    if (!bridge) return;
    setLoading(true); setError(undefined); setSaved(false);
    try {
      const next = await bridge.globalInstructions();
      setValue(next); setDraft(next.content);
    } catch { setError('load'); }
    finally { setLoading(false); }
  };
  const change = (content: string) => { setDraft(content); setSaved(false); };
  const save = async () => {
    if (!bridge || !value) return;
    setBusy(true); setSaved(false); setError(undefined);
    try {
      const next = await bridge.saveGlobalInstructions(draft, value.revision);
      setValue(next); setDraft(next.content); setSaved(true);
    } catch (error) {
      setError(String(error).includes('GLOBAL_INSTRUCTIONS_CONFLICT') ? 'conflict' : 'save');
    } finally { setBusy(false); }
  };
  const dirty = Boolean(value && draft !== value.content);
  const tooLong = draft.length > MAX_GLOBAL_INSTRUCTIONS_LENGTH;
  const discard = () => { if (value) change(value.content); setError(undefined); };
  const copyPath = async () => {
    if (!bridge || !value) return;
    try { await bridge.copyText(value.path); setCopyStatus('copied'); }
    catch { setCopyStatus('failed'); }
  };
  return { value, draft, loading, busy, saved, copyStatus, error, dirty, tooLong, reload, change, save, discard, copyPath };
}

export function GlobalInstructionsSettings({ editor, language }: { editor: ReturnType<typeof useGlobalInstructionsEditor>; language: string }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const { value, draft, loading, busy, saved, copyStatus, error, dirty, tooLong, reload, change, save, discard, copyPath } = editor;
  return <section className="global-instructions" aria-labelledby="global-instructions-title">
    <div className="section-heading"><h3 id="global-instructions-title">{t('全局指令', 'Global instructions')}</h3>
      <button type="button" className="icon-button" disabled={busy || loading}
        aria-label={t('重新加载已保存指令', 'Reload saved instructions')} data-tooltip={t('重新加载已保存指令', 'Reload saved instructions')}
        onClick={() => void reload()}><RotateCcw size={16}/></button>
    </div>
    <dl className="instructions-scope">
      <div><dt>{t('范围', 'Scope')}</dt><dd>{t('所有项目与独立会话', 'All projects and independent sessions')}</dd></div>
      <div><dt>{t('生效', 'Applies')}</dt><dd>{t('保存后，新建会话或手动重启会话运行时生效；已启动的会话不会自动更新', 'After saving, start a new conversation or manually restart its runtime. Already-started conversations do not update automatically.')}</dd></div>
      {value && <div><dt>{t('文件', 'File')}</dt><dd>
        <div className="instructions-path"><code>{value.path}</code>
          <button type="button" className="icon-button" aria-label={t('复制指令文件路径', 'Copy instructions file path')}
            data-tooltip={t('复制指令文件路径', 'Copy instructions file path')} onClick={() => void copyPath()}>
            {copyStatus === 'copied' ? <Check size={14}/> : <Copy size={14}/>}
          </button>
        </div>
        {copyStatus === 'failed' && <span className="instructions-error" role="alert">{t('路径复制失败，请重试。', 'Could not copy the path. Try again.')}</span>}
      </dd></div>}
    </dl>
    {!value ? <p className="muted" role="status">{loading ? t('加载中…', 'Loading…') : t('无法读取全局指令。', 'Could not load global instructions.')}</p> : <>
      <label className="instructions-editor">{t('自定义指令', 'Custom instructions')}
        <textarea aria-label={t('全局指令内容', 'Global instructions content')} aria-describedby="instructions-count"
          aria-invalid={tooLong || undefined} spellCheck={false} disabled={busy || loading} value={draft}
          onChange={event => change(event.target.value)}/>
      </label>
      <div className={`instructions-meta${tooLong ? ' invalid' : ''}`}>
        <span role="status">{tooLong ? t('内容超出长度限制', 'Content exceeds the length limit') : dirty ? t('未保存', 'Unsaved changes') : saved ? <><Check size={14}/>{t('已保存到文件', 'Saved to file')}</> : value.revision === 'missing' ? t('尚未创建指令文件', 'Instructions file not created yet') : t('已读取本地文件', 'Loaded from local file')}</span>
        <span id="instructions-count">{draft.length.toLocaleString()} / {MAX_GLOBAL_INSTRUCTIONS_LENGTH.toLocaleString()}</span>
      </div>
      <div className="instructions-actions">
        <button type="button" className="primary" disabled={busy || loading || !dirty || tooLong} onClick={() => void save()}>
          <Save size={15}/>{busy ? t('保存中…', 'Saving…') : t('保存指令', 'Save instructions')}</button>
        <button type="button" className="icon-button" disabled={busy || loading || !dirty} aria-label={t('还原更改', 'Discard changes')}
          data-tooltip={t('还原更改', 'Discard changes')} onClick={discard}><Undo2 size={16}/></button>
        <button type="button" className="icon-button" disabled={busy || loading || !draft} aria-label={t('清空编辑内容', 'Clear editor')}
          data-tooltip={t('清空编辑内容', 'Clear editor')} onClick={() => change('')}><Trash2 size={16}/></button>
      </div>
    </>}
    {error && <p className="instructions-error" role="alert">{error === 'conflict'
      ? t('本地指令已被其他操作修改。你的编辑仍保留；重新加载会替换当前编辑。', 'Local instructions changed elsewhere. Your edits are preserved; reloading replaces the editor.')
      : error === 'load' ? t('读取失败。请检查本地指令文件后重新加载。', 'Loading failed. Check the local instructions file and reload.')
      : t('保存失败，编辑内容仍保留。请检查本地配置文件是否可写。', 'Saving failed. Your edits are preserved. Check that the local configuration file is writable.')}</p>}
  </section>;
}
