import { app, BrowserWindow, net, session } from 'electron';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeUpdateDriver } from '../../electron/native-update-driver';
import { InstallerFailure } from '../../electron/update-installer';
import type { AppRelease } from '../../src/contracts';

// Transport substitution exists only in this isolated acceptance entry point.
// Real electron-updater metadata parsing, streaming, cancellation and hashing run.
const payload = Buffer.alloc(2 * 1024 ** 2, 7);
const digest = createHash('sha512').update(payload).digest('base64');
if (!process.env.DESKTOP_TEST_USER_DATA) throw new Error('An isolated fixture profile is required');
app.setPath('userData', process.env.DESKTOP_TEST_USER_DATA);
let mode = 'complete';
let requests = 0;
const server = createServer((request, response) => {
  if (request.url === '/probe') {
    response.writeHead(200, { 'Content-Length': 8 });
    response.end('probe-ok'); return;
  }
  requests++;
  if (request.url?.split('?')[0].endsWith('latest.yml')) {
    const metadata = `version: ${mode === 'metadata' ? '0.6.0' : '0.5.0'}\nfiles:\n  - url: Desktop.for.Step.Code.Setup.0.5.0.exe\n    sha512: ${digest}\n    size: ${payload.length}\n`;
    response.writeHead(200, { 'Content-Length': Buffer.byteLength(metadata), 'Content-Type': 'text/yaml' });
    response.end(metadata);
  } else {
    response.writeHead(200, { 'Content-Length': payload.length, 'Content-Type': 'application/octet-stream' });
    const bytes = mode === 'corrupt' ? Buffer.alloc(payload.length, 8) : payload;
    let offset = 0;
    const timer = setInterval(() => {
      if (offset >= bytes.length) { clearInterval(timer); response.end(); return; }
      response.write(bytes.subarray(offset, offset + 32 * 1024)); offset += 32 * 1024;
    }, 20);
    response.on('close', () => clearInterval(timer));
  }
});
Object.defineProperty(app, 'isPackaged', { value: true });
app.getVersion = () => '0.4.0';
app.whenReady().then(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
  const request = net.request.bind(net);
  const transport = session.fromPartition('update-fixture-transport');
  net.request = ((options: any) => options.url ? request(options) : request({
    url: `http://127.0.0.1:${address.port}${options.path}`, method: options.method, headers: options.headers,
    redirect: options.redirect, session: transport,
  })) as typeof net.request;
  const root = await mkdtemp(join(tmpdir(), 'step-native-update-'));
  const resources = join(root, 'resources');
  await mkdir(resources);
  await writeFile(join(resources, 'app-update.yml'), 'updaterCacheDirName: fixture-updater\n', 'utf8');
  Object.defineProperty(process, 'resourcesPath', { value: resources });
  const release: AppRelease = { version: '0.5.0', tag: 'v0.5.0', name: 'Fixture', notes: '',
    url: 'https://github.com/7oMB2006/desktop-for-step-code/releases/tag/v0.5.0',
    installer: { name: 'Desktop.for.Step.Code.Setup.0.5.0.exe', size: payload.length, inApp: true,
      url: 'https://github.com/7oMB2006/desktop-for-step-code/releases/download/v0.5.0/Desktop.for.Step.Code.Setup.0.5.0.exe' } };
  (globalThis as any).updateDownloadFixture = {
    probe: async () => {
      const url = `http://127.0.0.1:${address.port}/probe`;
      return Promise.all([session.defaultSession, session.fromPartition('electron-updater', { cache: false })]
        .map(async network => (await network.fetch(url)).text()));
    },
    run: async (nextMode: string) => {
      mode = nextMode; requests = 0;
      const driver = new NativeUpdateDriver(join(root, nextMode));
      const abort = new AbortController();
      const timer = nextMode === 'cancel' ? setTimeout(() => abort.abort(), 150) : undefined;
      let progress = 0;
      try {
        await driver.download(release, abort.signal, () => { progress++; });
        if (!abort.signal.aborted) await driver.verify();
        return { outcome: abort.signal.aborted ? 'cancelled' : 'verified', requests, progress };
      } catch (error: any) {
        return { outcome: abort.signal.aborted ? 'cancelled' : error instanceof InstallerFailure ? error.kind : error.code ?? 'error', requests, progress, diagnostic: error.message };
      } finally { clearTimeout(timer); }
    },
  };
  const window = new BrowserWindow({ width: 500, height: 300, show: false, focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await window.loadURL('about:blank');
});
app.on('will-quit', () => server.close());
