import { randomUUID } from 'node:crypto';
import { realpath, stat, open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { artifactFile } from './artifact-files';
import { imageMime } from './attachment-utils';
import { sensitiveDiffPath } from '../src/review-source';
import type { FilePreviewContent, FileTarget } from '../src/contracts';

const textTypes = new Map(Object.entries({
  '.md': 'markdown', '.markdown': 'markdown', '.txt': 'text', '.json': 'json', '.jsonl': 'json',
  '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
  '.css': 'css', '.scss': 'scss', '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cs': 'csharp', '.xml': 'xml',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini', '.ini': 'ini', '.sql': 'sql',
  '.sh': 'bash', '.ps1': 'powershell', '.log': 'text',
}));
const additionalTextTypes = new Map(Object.entries({
  '.mjs': 'javascript', '.cjs': 'javascript', '.mts': 'typescript', '.cts': 'typescript',
  '.jsonc': 'json', '.diff': 'diff', '.patch': 'diff',
}));
const imageTypes = new Map(Object.entries({
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
}));
const browserTypes = new Set(['.html', '.htm']);
const tableTypes = new Map<string, 'CSV' | 'TSV'>([['.csv', 'CSV'], ['.tsv', 'TSV']]);
export const inlineFileExtensions = [...browserTypes, '.pdf', ...tableTypes.keys(), ...imageTypes.keys(), ...textTypes.keys(), ...additionalTextTypes.keys()]
  .map(ext => ext.slice(1));
const externalTypes = new Set(['.html', '.htm', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.pdf', ...tableTypes.keys(), '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.wav', '.mp3', '.ogg', '.flac',
  '.mp4', '.webm', '.mov', ...[...textTypes.keys()].filter(ext => !['.sh', '.ps1', '.js', '.py'].includes(ext))]);
export function fileMode(path: string): FilePreviewContent['mode'] | 'browser' | 'external' {
  const ext = extname(path).toLowerCase();
  if (browserTypes.has(ext)) return 'browser';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (tableTypes.has(ext)) return 'table';
  if (ext === '.pdf') return 'pdf';
  if (imageTypes.has(ext)) return 'image';
  return textTypes.has(ext) || additionalTextTypes.has(ext) ? 'text' : 'external';
}
export function canOpenExternally(path: string) { return externalTypes.has(extname(path).toLowerCase()); }
function decodePreviewText(bytes: Buffer) {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('This encoding is not supported by the text preview'); }
  if (text.includes('\0')) throw new Error('Binary files are not available for text preview');
  return text;
}

export async function readPreview(path: string): Promise<FilePreviewContent> {
  if (sensitiveDiffPath(path)) throw new Error('Sensitive files are not available for inline preview');
  const mode = fileMode(path);
  if (mode === 'browser' || mode === 'external') throw new Error('This file type has no inline preview');
  const ext = extname(path).toLowerCase();
  const raster = mode === 'image' && ext !== '.svg';
  const limitMiB = mode === 'pdf' ? 25 : raster ? 10 : 1;
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limitMiB * 1024 * 1024) {
      const kind = mode === 'pdf' ? 'PDF' : raster ? 'Image' : 'Text, table and SVG';
      throw new Error(`${kind} preview is limited to ${limitMiB} MiB`);
    }
    const buffer = Buffer.alloc(info.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count !== info.size) throw new Error('File changed; refresh the preview');
    const bytes = buffer.subarray(0, count);
    const identity = { path, name: basename(path), size: count };
    if (mode === 'pdf') {
      if (!bytes.subarray(0, 1024).includes('%PDF-')) throw new Error('File contents do not match the PDF format');
      return { ...identity, mode, bytes: new Uint8Array(bytes) };
    }
    if (mode === 'image') {
      const mime = imageTypes.get(ext)!;
      // SVG bytes go only to an image element; never load them as a document.
      if (raster) {
        const gif = ['GIF87a', 'GIF89a'].includes(bytes.toString('latin1', 0, 6));
        if ((gif ? 'image/gif' : imageMime(bytes)) !== mime) throw new Error('File contents do not match the image format');
      }
      const image = `data:${mime};base64,${bytes.toString('base64')}`;
      if (ext === '.svg') return { ...identity, mode, image, format: 'SVG', text: decodePreviewText(bytes), language: 'xml' };
      return { ...identity, mode, image, format: mime.slice('image/'.length).toUpperCase() };
    }
    if (mode === 'table') return { ...identity, mode, format: tableTypes.get(ext)!, text: decodePreviewText(bytes) };
    return { ...identity, mode, text: decodePreviewText(bytes), language: textTypes.get(ext) ?? additionalTextTypes.get(ext) };
  } finally { await handle.close(); }
}

export class FilePreviews {
  private grants = new Map<string, { path: string; cwd?: string; reference?: string }>();
  constructor(private workspace: (runtimeId: string) => string) {}
  async grant(path: string, scope?: { cwd: string; reference: string }) {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isFile()) throw new Error('Not a regular file');
    const existing = [...this.grants].find(([, value]) => value.path === canonical && value.cwd === scope?.cwd);
    if (existing) return { id: existing[0], path: canonical };
    if (this.grants.size >= 64) throw new Error('File preview limit reached; restart the app to open more files');
    const id = randomUUID();
    this.grants.set(id, { path: canonical, ...scope });
    return { id, path: canonical };
  }
  async resolve(target: FileTarget) {
    if (!target || typeof target !== 'object') throw new Error('Invalid file target');
    if ('grantId' in target) {
      const grant = typeof target.grantId === 'string' && this.grants.get(target.grantId);
      if (!grant) throw new Error('Unknown file permission');
      if (grant.cwd && grant.reference) {
        const file = await artifactFile(grant.cwd, grant.reference);
        if (!file.exists || file.path !== grant.path) throw new Error('File changed or is no longer available');
      } else if (await realpath(grant.path) !== grant.path) throw new Error('Selected file target changed');
      if (!(await stat(grant.path)).isFile()) throw new Error('Not a regular file');
      return { id: target.grantId, path: grant.path };
    }
    if (typeof target.runtimeId !== 'string' || typeof target.path !== 'string') throw new Error('Invalid file target');
    const cwd = this.workspace(target.runtimeId);
    const file = await artifactFile(cwd, target.path);
    if (!file.exists) throw new Error('File no longer exists');
    return this.grant(file.path, { cwd, reference: target.path });
  }
}
