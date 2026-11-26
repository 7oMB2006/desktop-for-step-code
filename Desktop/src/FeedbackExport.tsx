import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, MoreHorizontal } from 'lucide-react';
import { AppMenu } from './AppMenu';
import type { DesktopBridge, FeedbackOptions } from './contracts';
import './feedback-export.css';

export function FeedbackExport({ bridge, runtimeId, sessionId, sessionTitle, zh }: {
  bridge: DesktopBridge; runtimeId: string; sessionId: string; sessionTitle: string; zh: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<FeedbackOptions>({ expected: '', actual: '', conversation: false, tools: false });
  const [preview, setPreview] = useState<{ token: string; content: string }>();
  const [incidentTime, setIncidentTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = zh ? '导出反馈包' : 'Export feedback bundle';
  const more = zh ? '更多会话操作' : 'More conversation actions';
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  function close() {
    dialog.current?.close();
    setOpen(false); setPreview(undefined); setError(''); setIncidentTime('');
    setOptions({ expected: '', actual: '', conversation: false, tools: false });
    anchor.current?.focus();
  }
  async function submit() {
    setBusy(true); setError('');
    try {
      if (!preview) setPreview(await bridge.previewFeedback(runtimeId, sessionId, {
        ...options, errorAt: incidentTime ? new Date(incidentTime).toISOString() : undefined,
      }));
      else if (await bridge.saveFeedback(runtimeId, sessionId, preview.token)) close();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <>
    <button className="icon-button feedback-trigger" ref={anchor} aria-label={more} aria-haspopup="menu"
      aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={18}/></button>
    <AppMenu anchor={anchor} open={menu} label={more} items={[{ id: 'export', label: title, icon: <Download size={16}/> }]}
      onClose={closeMenu} onSelect={() => setOpen(true)}/>
    {open && createPortal(<dialog className="feedback-dialog" ref={dialog} aria-labelledby="feedback-title"
      onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
      <h2 id="feedback-title">{title}</h2>
      <p>{zh ? '当前会话 · ' : 'Conversation · '}{sessionTitle}</p>
      {preview ? <>
        <p>{zh ? '另存为的 gzip 文件解压后即为以下 JSON。请核对截断、排除项及敏感内容。' : 'The saved gzip file contains the exact JSON below. Review truncation, exclusions and sensitive content.'}</p>
        <pre tabIndex={0}>{preview.content}</pre>
      </> : <>
        <label>{zh ? '预期行为' : 'Expected behavior'}<textarea disabled={busy} maxLength={1000} value={options.expected}
          onChange={e => setOptions({ ...options, expected: e.target.value })}/></label>
        <label>{zh ? '实际行为' : 'Actual behavior'}<textarea disabled={busy} maxLength={1000} value={options.actual}
          onChange={e => setOptions({ ...options, actual: e.target.value })}/></label>
        <label>{zh ? '出错时间（本地时间，可选，默认取最近一次错误）' : 'Incident time (local, defaults to the latest error)'}
          <input type="datetime-local" disabled={busy} value={incidentTime} onChange={e => setIncidentTime(e.target.value)}/></label>
        <fieldset disabled={busy}><legend>{zh ? '材料范围' : 'Evidence scope'}</legend>
          <button type="button" aria-pressed={!options.conversation && !options.tools}
            onClick={() => setOptions({ ...options, conversation: false, tools: false })}>{zh ? '仅导出诊断' : 'Diagnostics only'}</button>
          <label><input type="checkbox" checked={options.conversation} onChange={e => setOptions({ ...options, conversation: e.target.checked })}/>
            {zh ? '包含相关会话片段' : 'Include related conversation excerpts'}</label>
          <label><input type="checkbox" checked={options.tools} onChange={e => setOptions({ ...options, tools: e.target.checked })}/>
            {zh ? '包含失败工具输出片段' : 'Include failed tool output excerpts'}</label>
        </fieldset>
        <p>{zh ? '片段限最近一次出错的那一轮；没有错误记录时取当前轮。反馈包只保存在本机。脱敏后的片段仍可能含敏感内容，请在保存前核对。' : 'Excerpts cover the latest failed turn, or the current turn if no failure was recorded. Saved locally. Redacted excerpts may still contain sensitive information. Review before saving.'}</p>
      </>}
      {error && <p role="alert">{error}</p>}
      <footer><button disabled={busy} onClick={close}>{zh ? '取消' : 'Cancel'}</button>
        {preview && <button disabled={busy} onClick={() => setPreview(undefined)}>{zh ? '返回编辑' : 'Edit'}</button>}
        <button disabled={busy} onClick={() => void submit()}>{preview ? (zh ? '另存为…' : 'Save as…') : (zh ? '预览' : 'Preview')}</button></footer>
    </dialog>, document.body)}
  </>;
}
