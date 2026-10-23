import { useEffect, useId, useRef, useState } from 'react';
import { Download, FolderOpen, X } from 'lucide-react';
import type { ImportSelection } from './session-import';
import './quit-confirmation.css';

export function ImportConfirmation({ selections, language, onCancel, onConfirm }: {
  selections: ImportSelection[]; language: string;
  onCancel(): void; onConfirm(addProjects: boolean): Promise<void>;
}) {
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const title = useId();
  const [addProjects, setAddProjects] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const directories = new Map<string, number>();
  for (const selection of selections)
    directories.set(selection.cwd, (directories.get(selection.cwd) ?? 0) + 1);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="quit-confirmation import-confirmation"
    aria-labelledby={title} aria-busy={pending}
    onCancel={event => { event.preventDefault(); if (!locked.current) onCancel(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const controls = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault(); controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault(); controls[0]?.focus();
      }
    }}>
    <header><h2 id={title}>{t('确认导入会话', 'Confirm session import')}</h2>
      <button type="button" className="icon-button" aria-label={t('关闭确认', 'Close confirmation')} disabled={pending}
        onClick={onCancel}><X size={18}/></button></header>
    <p>{t(`将导入 ${selections.length} 个会话，目标目录如下：`,
      `Import ${selections.length} sessions into these directories:`)}</p>
    <ul className="import-confirmation-directories" tabIndex={0}>
      {[...directories].map(([directory, count]) => <li key={directory}>
        <FolderOpen size={15} aria-hidden="true"/><span>{directory}</span>
        <small>{t(`${count} 个会话`, `${count} sessions`)}</small>
      </li>)}
    </ul>
    <label className="import-checkbox"><input type="checkbox" checked={addProjects} disabled={pending}
      onChange={event => setAddProjects(event.target.checked)}/>
      {t('将缺失的目录添加为左栏项目', 'Add missing directories as sidebar projects')}</label>
    <p className="muted">{addProjects
      ? t('仅为已保存的会话添加项目，不会创建文件夹或切换当前会话。', 'Projects are added only for saved sessions. No folders are created and the current session stays open.')
      : t('不新增项目；已有项目仍正常归组，其余会话显示在独立会话中。', 'No projects are added. Existing projects still group matching sessions; others remain independent.')}</p>
    {error && <p className="import-error" role="alert">{t('未能完成操作，请重试；已保存的副本不会重复导入。', 'Could not finish. Retry; saved copies will not be duplicated.')}</p>}
    <footer>
      <button type="button" ref={cancel} disabled={pending} onClick={onCancel}>{t('返回选择', 'Back to selection')}</button>
      <button type="button" className="quit-confirm" disabled={pending} onClick={async () => {
        if (locked.current) return;
        locked.current = true; setPending(true); setError(false);
        try { await onConfirm(addProjects); }
        catch { locked.current = false; setPending(false); setError(true); }
      }}><Download size={15}/>{pending ? t('正在开始…', 'Starting…') : t('确认导入', 'Confirm import')}</button>
    </footer>
  </dialog>;
}
