import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Globe, Play, Star } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PluginDocument, PluginPackage, PluginStarSnapshot } from './capabilities';

export interface PluginPresentation {
  author?: string;
  maintainer?: string;
  license?: string;
  readme?: string;
  changelog?: string;
  stars?: { count: number; checkedAt: string };
  tutorials?: { title: string; creator: string; source: string; url: string; kind: 'author' | 'community' }[];
  links?: { title: string; url: string }[];
}

export function pluginDocumentUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function PluginStars({ value, language }: { value?: PluginPresentation['stars'] | PluginStarSnapshot; language: string }) {
  if (value && 'status' in value && value.count === undefined) {
    const pending = value.status === 'unknown';
    const label = pending ? language === 'zh' ? '正在查询 GitHub 星标' : 'Checking GitHub stars'
      : value.status === 'limited' ? language === 'zh' ? 'GitHub 星标查询受限' : 'GitHub star lookup rate limited'
        : language === 'zh' ? 'GitHub 星标暂不可用' : 'GitHub stars unavailable';
    return <span className="pc-stars" data-status={value.status} aria-label={label} title={label} aria-busy={pending}>
      <Star size={13} aria-hidden="true"/><span>{pending ? '...' : '-'}</span>
    </span>;
  }
  if (!value || typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count < 0 || !value.checkedAt) return null;
  const label = language === 'zh' ? `GitHub Stars：${value.count}，查询于 ${value.checkedAt}`
    : `${value.count} GitHub stars, checked ${value.checkedAt}`;
  const stale = 'status' in value && value.status === 'stale';
  const fullLabel = `${label}${stale ? language === 'zh' ? '，旧快照' : ', previous snapshot' : ''}`;
  return <span className="pc-stars" data-stale={stale || undefined} aria-label={fullLabel} title={fullLabel}><Star size={13} aria-hidden="true"/>
    <span>{new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(value.count)}</span>
  </span>;
}

function DocumentImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? <span className="pc-document-image-alt">{alt || 'Image unavailable'}</span>
    : <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)}/>;
}

export function PluginMarkdown({ text, document: source, onNavigate }: {
  text: string; document?: PluginDocument; onNavigate?(path: string): void;
}) {
  return <div className="pc-document-markdown"><Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={url =>
    pluginDocumentUrl(url) ?? (source?.links[url] || source?.images[url] ? url : '')}
    components={{
      a: ({ href, children }) => {
        const url = pluginDocumentUrl(href);
        const local = href && source?.links[href];
        return local ? <button className="pc-document-local-link" type="button" onClick={() => onNavigate?.(local)}>{children}</button>
          : url ? <a href={url} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={12} aria-hidden="true"/></a>
          : <span>{children}</span>;
      },
      img: ({ src, alt }) => src && source?.images[src] && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u.test(source.images[src])
        ? <DocumentImage src={source.images[src]} alt={alt ?? ''}/>
        : alt ? <span className="pc-document-image-alt">{alt}</span> : null,
      table: ({ children }) => <div className="pc-document-table"><table>{children}</table></div>,
    }}>{text}</Markdown></div>;
}

export function PluginDocumentation({ presentation, description, version, language, reader, fileName }: {
  presentation?: Omit<PluginPresentation, 'stars'>; description?: string; version?: string; language: string; reader?: ReactNode; fileName?: string;
}) {
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const tutorials = (presentation?.tutorials ?? []).flatMap(item => {
    const url = pluginDocumentUrl(item.url);
    return url ? [{ ...item, url }] : [];
  });
  const links = (presentation?.links ?? []).flatMap(item => {
    const url = pluginDocumentUrl(item.url);
    return url ? [{ ...item, url, host: new URL(url).host }] : [];
  });
  return <div className="pc-documentation">
    {tutorials.length > 0 && <section className="pc-tutorials" aria-label={t('视频教程', 'Video tutorials')}>
      {tutorials.map(item => <a className="pc-tutorial" key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">
        <span className="pc-tutorial-play"><Play size={19} aria-hidden="true"/></span>
        <span className="pc-tutorial-copy"><span className="pc-tutorial-kind">{item.kind === 'author' ? t('作者演示', 'Author demo') : t('社区演示', 'Community demo')}</span>
          <strong>{item.title}</strong><span>{item.creator} · {item.source}</span></span>
        <span className="pc-tutorial-open">{t('观看视频', 'Watch video')}<ArrowUpRight size={15} aria-hidden="true"/></span>
      </a>)}
    </section>}
    {links.length > 0 && <nav className="pc-document-links" aria-label={t('相关链接', 'Related links')}>
      {links.map(item => <a className="pc-document-link" key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">
        <span className="pc-document-link-icon"><Globe size={19} aria-hidden="true"/></span>
        <span className="pc-document-link-copy"><strong>{item.title}</strong><span>{item.host}</span></span>
        <ArrowUpRight size={17} aria-hidden="true"/>
      </a>)}
    </nav>}
    <div className="pc-document-heading"><span><BookOpen size={14} aria-hidden="true"/>{t('使用说明', 'Guide')}</span>
      {(presentation?.readme || fileName) && <span>{version ? `v${version} · ` : ''}{fileName ?? 'README.md'}</span>}</div>
    {reader ?? (presentation?.readme ? <PluginMarkdown text={presentation.readme}/> : <p className="pc-body-copy">{description}</p>)}
    {(presentation?.author || presentation?.maintainer || presentation?.license) && <dl className="pc-document-credits">
      {presentation.author && <div><dt>{t('项目作者', 'Project author')}</dt><dd>{presentation.author}</dd></div>}
      {presentation.maintainer && <div><dt>{t('DFSC 适配维护', 'DFSC adaptation')}</dt><dd>{presentation.maintainer}</dd></div>}
      {presentation.license && <div><dt>{t('许可证', 'License')}</dt><dd>{presentation.license}</dd></div>}
    </dl>}
  </div>;
}

export function PluginDocumentReader({ bridge, pkg, kind, language }: {
  bridge: { pluginDocument(input: { ref: string; path: string }): Promise<PluginDocument> };
  pkg: PluginPackage; kind: 'readme' | 'changelog'; language: string;
}) {
  const [path, setPath] = useState(pkg.documentation[kind] ?? '');
  const [history, setHistory] = useState<string[]>([]);
  const [document, setDocument] = useState<PluginDocument>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  useEffect(() => {
    let valid = true;
    setDocument(undefined); setError(false);
    void bridge.pluginDocument({ ref: pkg.ref, path: path.split('#')[0] }).then(value => {
      if (valid) setDocument(value);
    }).catch(() => { if (valid) setError(true); });
    return () => { valid = false; };
  }, [bridge, pkg.ref, path, attempt]);
  useEffect(() => {
    if (!document || !container.current) return;
    const headings = container.current.querySelectorAll('h1,h2,h3,h4,h5,h6');
    const counts = new Map<string, number>();
    for (const heading of headings) {
      const slug = (heading.textContent ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/gu, '-');
      const count = counts.get(slug) ?? 0;
      heading.id = `${slug}${count ? `-${count}` : ''}`;
      counts.set(slug, count + 1);
    }
    const anchor = path.split('#')[1];
    if (anchor) [...headings].find(item => item.id === decodeURIComponent(anchor))?.scrollIntoView({ block: 'start' });
  }, [document, path]);
  return <div ref={container} className="pc-document-reader" aria-busy={!document && !error}>
    {history.length > 0 && <button type="button" onClick={() => {
      setPath(history.at(-1)!); setHistory(history.slice(0, -1));
    }}><ArrowLeft size={13}/>{t('返回上一页', 'Previous document')}</button>}
    {error ? <div className="cap-error" role="alert">{t('文档读取失败或插件已更新。可重试，或刷新插件目录。', 'The document is unavailable or the plugin changed. Retry or refresh the catalog.')}
      <button type="button" onClick={() => setAttempt(value => value + 1)}>{t('重试', 'Retry')}</button></div>
      : document ? <PluginMarkdown text={document.text} document={document} onNavigate={target => {
        setHistory(value => [...value.slice(-31), path]); setPath(target);
      }}/> : <p role="status">{t('正在读取文档', 'Reading document')}</p>}
  </div>;
}
