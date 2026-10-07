import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpRight, Copy, File, FileText, FolderOpen, Globe, Image, MoreHorizontal, Music, Presentation, Table2, Video, X } from 'lucide-react';
import { artifactKind, localReference, turnArtifacts } from './turn-artifacts';
import type { ArtifactKind } from './turn-artifacts';
import type { ArtifactFile } from './contracts';
import './turn-artifacts.css';
import { FileOpeningContext, FileOpenButton } from './FileOpening';

export const ArtifactContext = createContext<{ runtimeId?: string; onError: (message: string) => void }>({ onError: () => {} });
const icons = { website: Globe, image: Image, document: FileText, spreadsheet: Table2, presentation: Presentation, audio: Music, video: Video, file: File };
const kinds = { website: ['网页', 'Website'], image: ['图片', 'Image'], document: ['文档', 'Document'], spreadsheet: ['表格', 'Spreadsheet'], presentation: ['演示文稿', 'Presentation'], audio: ['音频', 'Audio'], video: ['视频', 'Video'], file: ['文件', 'File'] };
export function ArtifactIcon({ kind, size = 16 }: { kind: ArtifactKind; size?: number }) { const Icon = icons[kind]; return <Icon size={size} aria-hidden="true"/>; }
export function FileReference({ href, children }: { href: string; children: ReactNode }) {
  const { runtimeId, onError } = useContext(ArtifactContext);
  const { openFile } = useContext(FileOpeningContext);
  const path = localReference(href)!;
  return <a className="message-link file-reference" href={href} onClick={event => {
    event.preventDefault();
    if (!runtimeId) { onError('此会话暂不可打开文件'); return; }
    void openFile({ runtimeId, path }).catch(error => onError(String(error.message ?? error)));
  }}><span className="message-link-site"><ArtifactIcon kind={artifactKind(path)} size={14}/></span><span className="message-link-label">{children}</span></a>;
}
export function TurnArtifacts({ text, outputPaths = [], language }: { text: string; outputPaths?: string[]; language: 'zh' | 'en' }) {
  const { runtimeId, onError } = useContext(ArtifactContext);
  const { openFile } = useContext(FileOpeningContext);
  const [checked, setChecked] = useState<{ key: string; runtimeId: string; files: ArtifactFile[] }>();
  const [busy, setBusy] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const zh = language === 'zh';
  const candidates = turnArtifacts(text, outputPaths);
  const key = JSON.stringify(candidates.map(item => item.path));
  const files = checked?.key === key && checked.runtimeId === runtimeId ? checked.files : [];
  const artifacts = candidates.map((item, index) => ({ ...item, file: files[index] }))
    .filter(item => !item.inferred || item.file?.exists);
  useEffect(() => {
    if (expanded) { setPresent(true); return; }
    const timer = setTimeout(() => setPresent(false), 200);
    return () => clearTimeout(timer);
  }, [expanded]);
  useEffect(() => { setExpanded(false); setSelected(undefined); setShowAll(false); }, [key]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded]);
  useEffect(() => {
    setChecked(undefined);
    if (!runtimeId || !candidates.length) return;
    let live = true;
    void window.desktop?.artifactFiles(runtimeId, candidates.map(item => item.path)).then(value => {
      if (live) setChecked({ key, runtimeId, files: value });
    }).catch(() => {});
    return () => { live = false; };
  }, [runtimeId, key]);
  const action = async (path: string, type: 'open' | 'reveal' | 'copy') => {
    if (!runtimeId || busy) return;
    setBusy(path);
    try {
      if (type === 'open') await openFile({ runtimeId, path });
      else await window.desktop?.artifactAction(runtimeId, path, type);
    }
    catch (error) { onError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(undefined); }
  };
  if (!artifacts.length) return null;
  const currentIndex = artifacts.findIndex(item => item.path === selected);
  const current = artifacts[currentIndex];
  const currentFile = current?.file;
  return <div className="turn-artifacts" aria-label={zh ? '本轮产物' : 'Turn outputs'}>
    <div className="artifact-strip"><span className="artifact-strip-label">{zh ? '交付' : 'Outputs'}</span>
    <div className="artifact-entries">{(showAll ? artifacts : artifacts.slice(0, 3)).map(artifact => {
    const file = artifact.file;
    return <div className={`artifact-row${expanded && selected === artifact.path ? ' is-selected' : ''}`} key={artifact.path}>
      <button type="button" className="artifact-main" title={artifact.label} disabled={!file?.canOpen || Boolean(busy)} onClick={() => void action(artifact.path, 'open')}>
        <ArtifactIcon kind={artifact.kind} size={14}/>
        <span>{artifact.label}</span><ArrowUpRight size={12}/>
      </button>
      <button className="artifact-details-trigger" aria-label={`${zh ? '产物详情' : 'Output details'}: ${artifact.label}`} data-tooltip={zh ? '产物详情' : 'Output details'} aria-expanded={expanded && selected === artifact.path}
        onClick={() => { setSelected(artifact.path); setExpanded(!(expanded && selected === artifact.path)); }}><MoreHorizontal size={14}/></button>
    </div>;
  })}{artifacts.length > 3 && <button className="artifact-more" onClick={() => setShowAll(!showAll)}>{showAll ? (zh ? '收起' : 'Less') : (zh ? `另 ${artifacts.length - 3} 项` : `${artifacts.length - 3} more`)}</button>}</div>
    <span className="artifact-count">{artifacts.length} {zh ? '个文件' : 'files'}</span></div>
    {present && current && <div className={`artifact-detail-shell${expanded ? ' is-open' : ''}`} inert={!expanded} aria-hidden={!expanded}>
      <div className="artifact-detail-clip"><div className="artifact-detail">
        <div className="artifact-detail-heading"><ArtifactIcon kind={current.kind}/><strong>{current.label}</strong><span>{kinds[current.kind][zh ? 0 : 1]}</span>
          <button className="icon-button" aria-label={zh ? '收起产物详情' : 'Close output details'} onClick={() => setExpanded(false)}><X size={14}/></button></div>
        <div className="artifact-detail-path">{current.path}{currentFile && !currentFile.exists && <span>{zh ? ' · 文件已不存在' : ' · File no longer exists'}</span>}</div>
        <div className="artifact-options">
          {runtimeId && <FileOpenButton target={{ runtimeId, path: current.path }} kind={current.kind} language={language} onError={onError}
            disabled={!currentFile?.exists || Boolean(busy)}/>}
          <button disabled={!currentFile?.exists || Boolean(busy)} onClick={() => void action(current.path, 'reveal')}><FolderOpen size={14}/>{zh ? '显示位置' : 'Show in folder'}</button>
          <button disabled={!currentFile || Boolean(busy)} onClick={() => void action(current.path, 'copy')}><Copy size={14}/>{zh ? '复制路径' : 'Copy path'}</button>
        </div>
      </div></div>
    </div>}
  </div>;
}
