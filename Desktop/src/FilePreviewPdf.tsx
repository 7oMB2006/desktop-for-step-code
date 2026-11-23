import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, FileText, Scan } from 'lucide-react';
import { AnnotationMode, getDocument, PasswordException, PDFWorker, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url&no-inline';
import fonts from 'virtual:pdf-preview-fonts';

const decoderUrl = () => new URL(import.meta.env.DEV
  ? '/node_modules/pdfjs-dist/wasm/'
  : './pdf-preview-decoder/', document.baseURI).href;

class PreviewFontData {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const files = Object.hasOwn(fonts, kind) ? fonts[kind] : undefined;
    if (!files || !Object.hasOwn(files, filename)) throw new Error('PDF resource is not bundled');
    return Uint8Array.from(atob(files[filename]), byte => byte.charCodeAt(0));
  }
}

export default function FilePreviewPdf({ bytes, language, refresh }: {
  bytes: Uint8Array; language: 'zh' | 'en'; refresh: ReactNode;
}) {
  const [opened, setOpened] = useState<{ bytes: Uint8Array; document?: PDFDocumentProxy; error?: 'password' | 'invalid' }>();
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState<string>();
  const [actual, setActual] = useState(false);
  const [width, setWidth] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const document = opened?.bytes === bytes ? opened.document : undefined;
  const error = opened?.bytes === bytes ? opened.error : undefined;
  const total = document?.numPages ?? 0;
  const current = Math.min(page, total || page);
  const zh = language === 'zh';
  const label = (cn: string, en: string) => ({ 'aria-label': zh ? cn : en, 'data-tooltip': zh ? cn : en });

  useEffect(() => {
    let disposed = false;
    let worker: Worker | undefined;
    let pdfWorker: PDFWorker | undefined;
    let task: ReturnType<typeof getDocument> | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(loadDeadline);
      const terminate = () => {
        clearTimeout(closeDeadline);
        pdfWorker?.destroy();
        worker?.terminate();
        pdfWorker = undefined;
        worker = undefined;
      };
      // A stalled worker cannot acknowledge PDF.js's graceful shutdown request.
      const closeDeadline = setTimeout(terminate, 1000);
      if (task) void task.destroy().catch(() => {}).finally(terminate);
      else terminate();
    };
    const fail = (reason: unknown) => {
      if (disposed) return;
      setOpened({ bytes, error: reason instanceof PasswordException ? 'password' : 'invalid' });
      dispose();
    };
    const loadDeadline = setTimeout(() => fail(new Error('PDF load timed out')), 30_000);
    try {
      worker = new Worker(workerUrl, { type: 'module' });
      worker.addEventListener('error', fail);
      pdfWorker = PDFWorker.create({ port: worker });
      task = getDocument({
        data: bytes.slice(), worker: pdfWorker, BinaryDataFactory: PreviewFontData, useWorkerFetch: false,
        wasmUrl: decoderUrl(), useWasm: false, enableXfa: false, disableWorkerRendering: true,
        maxImageSize: 32_000_000, canvasMaxAreaInBytes: 64 * 1024 * 1024,
      });
      void task.promise.then(doc => {
        clearTimeout(loadDeadline);
        if (!disposed) setOpened({ bytes, document: doc });
      }, fail);
    } catch (reason) { fail(reason); }
    return dispose;
  }, [bytes]);

  useEffect(() => {
    const element = scroll.current!;
    let pending: ReturnType<typeof setTimeout>;
    const measure = () => setWidth(Math.max(0, element.clientWidth - 32));
    const observer = new ResizeObserver(() => {
      clearTimeout(pending);
      pending = setTimeout(measure, 80);
    });
    measure();
    observer.observe(element);
    return () => { observer.disconnect(); clearTimeout(pending); };
  }, []);

  const goTo = (value: number) => {
    if (!total || !Number.isInteger(value)) return;
    setPage(Math.max(1, Math.min(value, total)));
    scroll.current?.scrollTo(0, 0);
  };
  const finishEditing = () => {
    if (pageInput?.trim() && /^\d+$/.test(pageInput)) goTo(Number(pageInput));
    setPageInput(undefined);
  };

  return <>
    <div className="file-preview-toolbar">
      <div className="file-preview-pagination">
        <button className="icon-button" {...label('上一页', 'Previous page')} disabled={!total || current <= 1} onClick={() => goTo(current - 1)}><ChevronLeft size={15}/></button>
        <input className="file-preview-page-input" type="text" inputMode="numeric" aria-label={zh ? '页码' : 'Page number'}
          value={total ? pageInput ?? current : ''} disabled={!total} onChange={event => setPageInput(event.target.value)}
          onBlur={finishEditing} onKeyDown={event => {
            if (event.key === 'Enter') finishEditing();
            if (event.key === 'Escape') setPageInput(undefined);
          }}/>
        <span aria-label={zh ? `共 ${total} 页` : `${total} pages`}>/ {total || '\u2014'}</span>
        <button className="icon-button" {...label('下一页', 'Next page')} disabled={!total || current >= total} onClick={() => goTo(current + 1)}><ChevronRight size={15}/></button>
      </div>
      <button className="icon-button" {...label('原始尺寸', 'Actual size')} aria-pressed={actual} disabled={!total} onClick={() => {
        setActual(value => !value);
        scroll.current?.scrollTo(0, 0);
      }}><Scan size={15}/></button>
      <span className="file-preview-type">PDF</span>
      {refresh}
    </div>
    <div className="file-preview-scroll" ref={scroll} tabIndex={0} aria-busy={!error && !document}>
      {document ? <PdfPage key={current} document={document} page={current} width={width} actual={actual} language={language}/>
        : <div className="file-preview-document-state" role="status"><FileText size={23}/>
          {error === 'password' ? (zh ? '此 PDF 需要密码，请用系统应用打开' : 'This PDF requires a password. Open it in a system app.')
            : error ? (zh ? '无法读取此 PDF' : 'Could not read this PDF') : (zh ? '正在读取 PDF…' : 'Loading PDF\u2026')}
        </div>}
    </div>
  </>;
}

function PdfPage({ document, page, width, actual, language }: {
  document: PDFDocumentProxy; page: number; width: number; actual: boolean; language: 'zh' | 'en';
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const zh = language === 'zh';
  useEffect(() => {
    if (!width) return;
    let canceled = false;
    let task: RenderTask | undefined;
    const render = async () => {
      const pdfPage = await document.getPage(page);
      if (canceled || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(actual ? 96 / 72 : Math.min(width / base.width, 2), 16_384 / Math.max(base.width, base.height));
      const viewport = pdfPage.getViewport({ scale });
      const dpr = Math.min(devicePixelRatio, 2, 8192 / Math.max(viewport.width, viewport.height),
        Math.sqrt(10_000_000 / (viewport.width * viewport.height)));
      const node = canvas.current;
      node.width = Math.max(1, Math.floor(viewport.width * dpr));
      node.height = Math.max(1, Math.floor(viewport.height * dpr));
      node.style.width = `${viewport.width}px`;
      node.style.height = `${viewport.height}px`;
      task = pdfPage.render({ canvas: node, viewport, transform: [dpr, 0, 0, dpr, 0, 0], annotationMode: AnnotationMode.DISABLE });
      await task.promise;
      if (!canceled) setStatus('ready');
    };
    void render().catch(() => { if (!canceled) setStatus('error'); });
    return () => { canceled = true; task?.cancel(); };
  }, [document, page, width, actual]);

  return <div className={`file-preview-pdf-page${actual ? ' is-actual' : ''}`}>
    {status !== 'ready' && <div className="file-preview-document-state" role="status">
      {status === 'error' ? (zh ? '无法显示此页面' : 'Could not display this page') : (zh ? '正在渲染页面…' : 'Rendering page\u2026')}
    </div>}
    <canvas ref={canvas} hidden={status !== 'ready'} data-ready={status === 'ready' || undefined} role="img"
      aria-label={zh ? `第 ${page} 页` : `Page ${page}`}/>
  </div>;
}
