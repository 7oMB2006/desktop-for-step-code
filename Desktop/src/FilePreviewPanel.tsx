import { lazy, Suspense, useContext, useEffect, useMemo, useState } from 'react';
import { Code2, Copy, FileText, FolderOpen, Image as ImageIcon, ImageOff, RefreshCw, Scan, Table2, WrapText, X } from 'lucide-react';
import Markdown from 'react-markdown';
import hljs from 'highlight.js/lib/common';
import { messageRemarkPlugins, messageRehypePlugins } from './markdown-math';
import { MessageLink } from './MessageLink';
import { FileOpeningContext, FileOpenButton } from './FileOpening';
import { RightPanelExpandButton } from './RightPanelExpandButton';
import { RightPanelWidthControl, type RightPanelWidth } from './RightPanelWidthControl';
import { FilePreviewTable } from './FilePreviewTable';
import type { FilePreviewData } from './contracts';
import './file-preview-panel.css';

const FilePreviewPdf = lazy(() => import('./FilePreviewPdf'));

export function FilePreviewPanel({ file, open, replaced, overlay, expanded, language, width, onWidthChange, onClose, onToggleExpanded, onError }: {
  file?: FilePreviewData; open: boolean; replaced: boolean; overlay: boolean; expanded: boolean; language: 'zh' | 'en';
  width: 'standard' | 'wide'; onWidthChange: (value: 'standard' | 'wide') => void;
  onClose: () => void; onToggleExpanded: () => void; onError: (error: string) => void;
}) {
  const [present, setPresent] = useState(open);
  const [source, setSource] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [busy, setBusy] = useState(false);
  const { openFile } = useContext(FileOpeningContext);
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  if (open && !present) setPresent(true);
  useEffect(() => { setSource(false); setActualSize(false); }, [file?.id]);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
    return () => clearTimeout(timer);
  }, [open, present]);
  const showSource = file?.mode === 'text' || (source && file?.text !== undefined);
  const sourceText = file?.text;
  const sourceLanguage = file?.language;
  const highlighted = useMemo(() => showSource && sourceText !== undefined && sourceLanguage && hljs.getLanguage(sourceLanguage)
    ? hljs.highlight(sourceText, { language: sourceLanguage }).value : undefined, [showSource, sourceText, sourceLanguage]);
  const lineCount = useMemo(() => sourceText?.split('\n').length, [sourceText]);
  const showImage = file?.mode === 'image' && !showSource;
  const showTable = file?.mode === 'table' && !showSource;
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try { await operation(); } catch (error) { onError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const label = (cn: string, en: string) => ({ 'aria-label': t(cn, en), 'data-tooltip': t(cn, en) });
  const chooseWidth = (value: RightPanelWidth) => {
    if (value !== 'fullscreen') onWidthChange(value);
    if ((value === 'fullscreen') !== expanded) onToggleExpanded();
  };
  const refresh = file && <button className="icon-button" {...label('刷新文件', 'Refresh file')} disabled={busy}
    onClick={() => void run(() => openFile({ grantId: file.id }, 'preview', false))}><RefreshCw size={15}/></button>;
  const ModeIcon = file?.mode === 'image' ? ImageIcon : file?.mode === 'table' ? Table2 : FileText;
  return <div className={`file-preview-track${open ? ' is-open' : ''}${!open && present ? ' is-closing' : ''}${width === 'wide' ? ' is-wide' : ''}${overlay ? ' is-overlay' : ''}${replaced ? ' is-replaced' : ''}`}>
    <aside id="file-panel" className={`file-preview-panel right-inspector-surface${expanded ? ' is-expanded' : ''}${open ? '' : ' is-closing'}`}
      style={{ visibility: present && !replaced ? undefined : 'hidden' }} aria-label={t('文件预览', 'File preview')} aria-hidden={!open} inert={!open}>
      <header className="right-panel-header"><h2>{t('文件预览', 'File preview')}</h2>
        <button className="icon-button" {...label('打开文件', 'Open file')} disabled={busy} onClick={() => void run(() => openFile())}><FolderOpen size={16}/></button>
        <RightPanelWidthControl panel="file" language={language} value={expanded ? 'fullscreen' : width} onChange={chooseWidth} onError={onError}/>
        <RightPanelExpandButton expanded={expanded} language={language} onToggle={onToggleExpanded}/>
        <button className="icon-button" {...label('关闭文件预览', 'Close file preview')} onClick={onClose}><X size={16}/></button>
      </header>
      {file ? <>
        <div className="file-preview-identity"><ModeIcon size={17}/><div><strong title={file.name}>{file.name}</strong><span title={file.path}>{file.path}</span></div>
          <FileOpenButton target={{ grantId: file.id }} language={language} onError={onError}/></div>
        {file.mode === 'pdf' ? (present && !replaced && <Suspense fallback={<div className="file-preview-document-state" role="status">{t('正在读取 PDF…', 'Loading PDF\u2026')}</div>}>
          <FilePreviewPdf key={file.id} bytes={file.bytes} language={language} refresh={refresh}/>
        </Suspense>) : <>
        <div className="file-preview-toolbar">
          {(file.mode === 'markdown' || file.mode === 'table' || (file.mode === 'image' && sourceText !== undefined)) && <div className="file-preview-modes" role="group" aria-label={t('显示方式', 'View mode')}>
            <button className="icon-button" {...(file.mode === 'image' ? label('图像预览', 'Image preview')
              : file.mode === 'table' ? label('表格预览', 'Table preview') : label('排版预览', 'Rendered preview'))} aria-pressed={!showSource} onClick={() => setSource(false)}>
              <ModeIcon size={15}/>
            </button>
            <button className="icon-button" {...label('查看源码', 'View source')} aria-pressed={showSource} onClick={() => setSource(true)}><Code2 size={15}/></button>
          </div>}
          {showSource && <button className="icon-button" {...label('自动换行', 'Wrap lines')} aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={15}/></button>}
          {showImage && <button className="icon-button" {...label('原始尺寸', 'Actual size')} aria-pressed={actualSize} onClick={() => setActualSize(!actualSize)}><Scan size={15}/></button>}
          <span className="file-preview-type">{file.mode === 'table' || showImage ? file.format : file.language ?? 'text'}</span>
          {sourceText !== undefined && (file.mode !== 'image' || showSource) && <button className="icon-button" {...label('复制文件内容', 'Copy file content')} disabled={busy} onClick={() => void run(() => window.desktop!.copyText(sourceText))}><Copy size={15}/></button>}
          {refresh}
        </div>
        <div className={`file-preview-scroll${showImage ? ' is-image' : ''}${showTable ? ' is-table' : ''}`} key={`${file.id}:${showSource}:${showImage && actualSize}`} tabIndex={showTable ? undefined : 0}>
          {file.mode === 'image' && showImage
            ? <PreviewImage src={file.image} name={file.name} actualSize={actualSize} error={t('无法显示此图像', 'Could not display this image')}/>
            : file.mode === 'table' && showTable
            ? <FilePreviewTable text={file.text} format={file.format} language={language}/>
            : file.mode === 'markdown' && !showSource
            ? <div className="file-preview-markdown message-body"><Markdown skipHtml remarkPlugins={messageRemarkPlugins} rehypePlugins={messageRehypePlugins}
              components={{
                a: ({ href, children }) => /^https?:\/\//i.test(href ?? '') ? <MessageLink href={href} language={language}>{children}</MessageLink> : <span>{children}</span>,
                img: ({ alt }) => <span>{alt}</span>,
              }}>{file.text}</Markdown></div>
            : <pre className={`file-preview-source${wrap ? ' is-wrapped' : ''}`}><code
                {...(highlighted ? { dangerouslySetInnerHTML: { __html: highlighted } } : { children: sourceText })}/></pre>}
        </div>
        </>}
        <footer className="file-preview-footer"><span>{(file.size / 1024).toFixed(1)} KB{lineCount !== undefined && !showImage && !showTable ? ` · ${lineCount} ${t('行', 'lines')}` : ''}</span><span>{t('只读', 'Read only')}</span></footer>
      </> : <div className="file-preview-empty"><FileText size={32} strokeWidth={1.2}/>
        <button disabled={busy} onClick={() => void run(() => openFile())}><FolderOpen size={16}/>{t('打开文件', 'Open file')}</button></div>}
    </aside>
  </div>;
}

function PreviewImage({ src, name, actualSize, error }: { src: string; name: string; actualSize: boolean; error: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return <div className={`file-preview-image${actualSize && !failed ? ' is-actual' : ''}`}>
    {failed ? <div className="file-preview-image-error" role="status"><ImageOff size={23}/>{error}</div>
      : <img src={src} alt={name} draggable={false} onError={() => setFailed(true)}/>}
  </div>;
}
