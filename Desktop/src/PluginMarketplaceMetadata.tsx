import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, CircleAlert, CircleHelp, Download, Monitor, PackageCheck, PackagePlus, UserRound, X } from 'lucide-react';
import type { PluginPackage } from './capabilities';
import { DisclosureChevron } from './DisclosureChevron';
import { pluginDocumentUrl } from './PluginDocumentation';
import { pluginVersionStatus } from './plugin-market-metadata';

function versionLabel(pkg: PluginPackage | undefined, currentVersion: string | undefined, language: string) {
  const status = pluginVersionStatus(pkg?.requirements?.dfsc, currentVersion);
  const zh = language === 'zh';
  return { status, label: {
    undeclared: zh ? '版本要求未声明' : 'Version requirement not declared',
    invalid: zh ? '版本要求无效' : 'Invalid version requirement',
    unknown: zh ? '当前版本未确认' : 'Current version unconfirmed',
    matches: zh ? '版本符合' : 'Version matches',
    mismatch: zh ? '版本不符' : 'Version mismatch',
  }[status] };
}

export function PluginAuthor({ pkg, language }: { pkg?: PluginPackage; language: string }) {
  const zh = language === 'zh';
  const author = pkg?.author || (zh ? '未声明' : 'Not declared');
  return <span className="pc-market-author" role="group" aria-label={zh ? `作者：${author}` : `Author: ${author}`}>
    <UserRound size={12} aria-hidden="true"/>
    <span>{author}</span>
  </span>;
}

export function PluginDownloads({ language }: { language: string }) {
  const zh = language === 'zh';
  return <span className="pc-downloads" aria-label={zh ? '下载量：暂无统计' : 'Downloads: no statistics'}
    title={zh ? '当前市场未提供下载统计' : 'This marketplace does not provide download statistics'}>
    <Download size={13} aria-hidden="true"/><span>{zh ? '暂无统计' : 'No statistics'}</span>
  </span>;
}

type RequirementProps = {
  pkg?: PluginPackage; currentVersion?: string; language: string; active?: boolean;
};

export function PluginVersionRequirement({ pkg, currentVersion, language }: RequirementProps) {
  const zh = language === 'zh';
  const version = versionLabel(pkg, currentVersion, language);
  const warning = version.status === 'mismatch' || version.status === 'invalid';
  const StatusIcon = warning ? CircleAlert : version.status === 'matches' ? Monitor : CircleHelp;
  const label = `DFSC ${pkg?.requirements?.dfsc ?? ''} · ${version.label} · ${zh
    ? '仅比较 DFSC 版本，不代表依赖或服务已就绪'
    : 'DFSC version comparison only; dependencies and services have not been checked'}`;
  return <span className="pc-requirement-chip pc-version-requirement" data-version-status={version.status}
    role="group" aria-label={label} data-tooltip={label}>
    <span className="pc-requirement-label"><StatusIcon size={13} aria-hidden="true"/><span>DFSC</span>
      {pkg?.requirements?.dfsc && <code>{pkg.requirements.dfsc}</code>}</span>
    {version.status !== 'matches' && <span className="pc-version-verdict">{version.label}</span>}
  </span>;
}

function PluginExternalRequirements({ pkg, language }: Pick<RequirementProps, 'pkg' | 'language'>) {
  const zh = language === 'zh';
  const external = pkg?.requirements?.external;
  if (external === undefined) return <p className="pc-requirement-empty">{zh ? '作者尚未声明，请核对使用说明。' : 'Not declared by the author. Check the guide.'}</p>;
  if (!external.length) return <p className="pc-requirement-empty">{zh ? '作者声明无需额外依赖。' : 'The author declares no extra requirements.'}</p>;
  return <ul className="pc-external-requirements">{external.map((item, index) => {
    const url = pluginDocumentUrl(item.url);
    return <li key={index}>
      <div><strong>{item.name}</strong><span className="pc-requirement-kind">
        {item.optional ? zh ? '可选' : 'Optional' : zh ? '必需' : 'Required'}</span>
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="icon-button"
          aria-label={zh ? `打开 ${item.name} 说明` : `Open ${item.name} instructions`}
          data-tooltip={zh ? `打开 ${item.name} 说明` : `Open ${item.name} instructions`}><ArrowUpRight size={14}/></a>}
      </div>
      {item.description && <p>{item.description}</p>}
    </li>;
  })}</ul>;
}

export function PluginExternalRequirementSummary({ pkg, language, active = true }: Pick<RequirementProps, 'pkg' | 'language' | 'active'>) {
  const zh = language === 'zh';
  const id = useId(), anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; origin: string }>();
  const external = pkg?.requirements?.external;
  const required = external?.filter(item => !item.optional).length ?? 0;
  const extra = external === undefined ? zh ? '额外依赖未声明' : 'Extra requirements not declared'
    : !external.length ? zh ? '无额外依赖' : 'No extra requirements'
      : required ? zh ? `${required < external.length ? '额外准备' : '需准备'} ${external.length} 项` : `${external.length} extra requirement${external.length === 1 ? '' : 's'}`
        : zh ? `可选 ${external.length} 项` : `${external.length} optional`;
  const Icon = external === undefined ? CircleHelp : external.length ? PackagePlus : PackageCheck;
  const declaration = `${zh ? '作者声明 · 未检测本机环境' : 'Author declarations · Local environment not checked'} · ${extra}`;
  const close = () => { setOpen(false); anchor.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => { setOpen(false); }, [pkg?.ref, external, language, active]);
  useLayoutEffect(() => {
    const element = panel.current, trigger = anchor.current;
    if (!open || !element || !trigger) return;
    element.showPopover();
    const place = () => {
      const rect = trigger.getBoundingClientRect(), box = element.getBoundingClientRect();
      const ceiling = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--window-bar-height')) || 46) + 8;
      const upwards = innerHeight - rect.bottom - 12 < box.height && rect.top - ceiling > innerHeight - rect.bottom;
      setPosition({
        left: Math.max(12, Math.min(rect.left, innerWidth - box.width - 12)),
        top: Math.max(ceiling, upwards ? rect.top - box.height - 6 : Math.min(rect.bottom + 6, innerHeight - box.height - 12)),
        origin: upwards ? 'bottom left' : 'top left',
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element); observer.observe(trigger);
    const dismiss = (event: Event) => { if (!(event.target instanceof Node) || !element.contains(event.target)) setOpen(false); };
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', place);
    const focus = requestAnimationFrame(() => element.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(focus); observer.disconnect();
      document.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', place);
    };
  }, [open]);
  return <>
    <button ref={anchor} type="button" className="pc-requirement-chip pc-extra-requirement"
      aria-label={declaration} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onClick={() => { if (open) close(); else { setPosition(undefined); setOpen(true); } }}>
      <Icon size={13} aria-hidden="true"/><span>{extra}</span><DisclosureChevron/>
    </button>
    {open && active && createPortal(<div ref={panel} id={id} popover="auto" className="pc-requirements-popover" role="dialog"
      tabIndex={-1} aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? undefined : 'hidden', transformOrigin: position?.origin }}
      onToggle={event => { if (event.newState === 'closed') setOpen(false); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
      onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
          && event.relatedTarget !== anchor.current) setOpen(false);
      }}>
      <header><strong id={`${id}-title`}>{zh ? '额外准备' : 'Extra requirements'}</strong>
        <button type="button" className="icon-button" aria-label={zh ? '关闭额外准备' : 'Close extra requirements'} onClick={close}><X size={14}/></button></header>
      <p id={`${id}-note`} className="pc-requirement-note">{zh ? '作者声明 · 未检测本机环境' : 'Author declarations · Local environment not checked'}</p>
      <PluginExternalRequirements pkg={pkg} language={language}/>
    </div>, document.body)}
  </>;
}

export function PluginCardRequirements({ pkg, currentVersion, language, active }: RequirementProps) {
  return <div className="pc-card-requirements">
    <PluginVersionRequirement pkg={pkg} currentVersion={currentVersion} language={language}/>
    <PluginExternalRequirementSummary pkg={pkg} language={language} active={active}/>
  </div>;
}

export function PluginRequirements({ pkg, currentVersion, language }: {
  pkg?: PluginPackage; currentVersion?: string; language: string;
}) {
  const zh = language === 'zh';
  return <section className="pc-install-requirements" aria-label={zh ? '安装要求' : 'Installation requirements'}>
    <header><h3>{zh ? '安装要求' : 'Installation requirements'}</h3>
      <span>{zh ? '作者声明 · 未检测本机环境' : 'Author declarations · Local environment not checked'}</span></header>
    <dl className="pc-requirement-facts">
      <div><dt>{zh ? 'DFSC 版本' : 'DFSC version'}</dt><dd className="pc-version-fact">
        <PluginVersionRequirement pkg={pkg} currentVersion={currentVersion} language={language}/>
        {currentVersion && <span className="pc-current-version">{zh ? '当前' : 'Current'} {currentVersion}</span>}
      </dd></div>
      <div><dt>{zh ? '额外准备' : 'Extra requirements'}</dt><dd>
        <PluginExternalRequirements pkg={pkg} language={language}/>
      </dd></div>
      {pkg?.maintainer && <div><dt>{zh ? '适配维护' : 'DFSC adaptation'}</dt><dd>{pkg.maintainer}</dd></div>}
      <div><dt>{zh ? '下载量' : 'Downloads'}</dt><dd><PluginDownloads language={language}/></dd></div>
    </dl>
  </section>;
}
