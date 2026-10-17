import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { FileDestination } from '../src/contracts';

const macApplications = new Map<string, string>();
const cache = new Map<string, Promise<FileDestination[]>>();
export function associationRequest(script: string, request: object, timeout = 15000): Promise<unknown> {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'])
    for (const key of Object.keys(process.env)) if (key.toLowerCase() === name.toLowerCase()) env[key] = process.env[key];
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((done, fail) => {
    const child = spawn(process.platform === 'darwin' ? script : executable, process.platform === 'darwin' ? [] : ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let size = 0;
    const timer = setTimeout(() => { child.kill(); fail(new Error('File association operation timed out')); }, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > 512 * 1024) { child.kill(); fail(new Error('File association response exceeded limits')); return; }
      output += chunk;
    });
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); fail(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { fail(new Error('Could not use the selected application')); return; }
      try { done(JSON.parse(output)); } catch { fail(new Error('Invalid file association response')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
export async function fileApplications(script: string, extension: string, path?: string): Promise<FileDestination[]> {
  if (process.platform === 'darwin') {
    if (!path) return [];
    const result = await associationRequest(script, { action: 'list', path }).catch(() => []);
    if (!Array.isArray(result)) return [];
    return result.filter(item => typeof item?.id === 'string' && item.id.startsWith('/') && item.id.endsWith('.app') && item.id.length < 4096 && typeof item.label === 'string')
      .slice(0, 24).map(item => {
        const id = `app:${createHash('sha256').update(item.id).digest('hex')}`;
        macApplications.set(id, item.id);
        return { id, label: item.label.slice(0, 100), icon: typeof item.icon === 'string' && item.icon.startsWith('data:image/png;base64,') && item.icon.length < 32000 ? item.icon : undefined };
      });
  }
  if (process.platform !== 'win32') return [];
  let pending = cache.get(extension);
  if (!pending) {
    pending = associationRequest(script, { action: 'list', extension }).then(value => {
      if (!Array.isArray(value)) return [];
      return value.filter(item => typeof item?.id === 'string' && item.id.length < 4096 && typeof item.label === 'string')
        .slice(0, 24).map(item => ({ id: `app:${item.id}`, label: item.label.slice(0, 100),
          icon: typeof item.icon === 'string' && item.icon.startsWith('data:image/png;base64,') && item.icon.length < 32000 ? item.icon : undefined }));
    }).catch(() => { cache.delete(extension); return []; });
    cache.set(extension, pending);
  }
  return pending;
}

export function macApplicationPath(id: string) {
  const path = macApplications.get(id);
  if (!path) throw new Error('Unknown associated application');
  return path;
}
