import { randomUUID } from 'node:crypto';
import { realpath, stat, open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { artifactFile } from './artifact-files';
import { sensitiveDiffPath } from '../src/review-source';
import type { FilePreviewData, FileTarget } from '../src/contracts';

const textTypes = new Map(Object.entries({
  '.md': 'markdown', '.markdown': 'markdown', '.txt': 'text', '.json': 'json', '.jsonl': 'json',
  '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
  '.css': 'css', '.scss': 'scss', '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cs': 'csharp', '.xml': 'xml', '.svg': 'xml',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini', '.ini': 'ini', '.sql': 'sql',
  '.sh': 'bash', '.ps1': 'powershell', '.csv': 'text', '.log': 'text',
}));
const externalTypes = new Set(['.html', '.htm', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.wav', '.mp3', '.ogg', '.flac',
  '.mp4', '.webm', '.mov', ...[...textTypes.keys()].filter(ext => !['.sh', '.ps1', '.js', '.py'].includes(ext))]);
export function fileMode(path: string): 'browser' | 'markdown' | 'text' | 'external' {
  const ext = extname(path).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'browser';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  return textTypes.has(ext) ? 'text' : 'external';
}
export function canOpenExternally(path: string) { return externalTypes.has(extname(path).toLowerCase()); }
export async function readPreview(path: string): Promise<Omit<FilePreviewData, 'id'>> {
  if (sensitiveDiffPath(path)) throw new Error('Sensitive files are not available for inline preview');
  const mode = fileMode(path);
  if (mode !== 'text' && mode !== 'markdown') throw new Error('This file type has no text preview');
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Text preview is limited to 1 MiB');
    const buffer = Buffer.alloc(Math.min(info.size + 1, 1024 * 1024 + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > info.size) throw new Error('File changed; refresh the preview');
    const bytes = buffer.subarray(0, bytesRead);
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    let text: string;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { throw new Error('This encoding is not supported by the text preview'); }
    if (text.includes('\0')) throw new Error('Binary files are not available for text preview');
    return { path, name: basename(path), size: bytesRead, mode, text, language: textTypes.get(extname(path).toLowerCase()) };
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
