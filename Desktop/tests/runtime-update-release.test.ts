import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { RpcProcess } from '../electron/runtime';

test('Windows job contains orphaned descendants from launch and verifies complete release', {
  skip: process.platform !== 'win32', timeout: 30000,
}, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-update-job-')));
  const rpc = new RpcProcess(() => {}, undefined, true);
  let descendant: number | undefined;
  try {
    const directory = join(root, 'step/dist/bundle');
    await mkdir(directory, { recursive: true });
    await copyFile(resolve('electron/windows-runtime-job.ps1'), join(root, 'windows-runtime-job.ps1'));
    const ready = join(root, 'descendant.json');
    const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid})); setInterval(()=>{},1000);`;
    const intermediate = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{detached:true,stdio:'ignore'}).unref();`;
    const entry = join(directory, 'worker.mjs');
    await writeFile(entry, `
      import { spawn } from 'node:child_process';
      import { readFile } from 'node:fs/promises';
      import { createInterface } from 'node:readline';
      spawn(process.execPath, ['-e', ${JSON.stringify(intermediate)}], { detached: true, stdio: 'ignore' }).unref();
      createInterface({ input: process.stdin }).on('line', async line => {
        const request = JSON.parse(line);
        let data;
        for (let i = 0; i < 100; i++) {
          try { data = JSON.parse(await readFile(${JSON.stringify(ready)}, 'utf8')); break; } catch {}
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        process.stdout.write(JSON.stringify({ type: 'response', id: request.id, success: true, data: { ...data, runtimePid: process.pid } }) + '\\n');
      });`);
    rpc.start(process.execPath, entry, root, process.env);
    const result = await rpc.request('ready', {}, 20000);
    assert.equal(rpc.pid, result.runtimePid, 'Public PID belongs to Step Node, not its supervisor');
    descendant = result.pid;
    assert.ok(descendant);
    process.kill(descendant!, 0);
    await rpc.stopForUpdate();
    assert.equal(rpc.pid, undefined);
    assert.throws(() => process.kill(descendant!, 0), /ESRCH/);
    assert.equal(JSON.parse(await readFile(ready, 'utf8')).pid, descendant);
  } finally {
    await rpc.stop();
    if (descendant) { try { process.kill(descendant); } catch {} }
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('Windows startup cancellation leaves no runtime outside the atomic job assignment', {
  skip: process.platform !== 'win32', timeout: 30000,
}, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-update-job-start-')));
  const directory = join(root, 'step/dist/bundle');
  await mkdir(directory, { recursive: true });
  await copyFile(resolve('electron/windows-runtime-job.ps1'), join(root, 'windows-runtime-job.ps1'));
  try {
    for (const delay of [0, 100, 400, 900, 1400]) {
      const marker = join(root, `started-${delay}.json`);
      const entry = join(directory, `worker-${delay}.mjs`);
      await writeFile(entry, `import { writeFileSync } from 'node:fs';
        writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid }));
        setInterval(() => {}, 1000);`);
      const rpc = new RpcProcess(() => {}, undefined, true);
      try {
        rpc.start(process.execPath, entry, root, process.env);
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        await rpc.stop();
        const bytes = await readFile(marker, 'utf8').catch(error => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (bytes) assert.throws(() => process.kill(JSON.parse(bytes).pid, 0), /ESRCH/);
        assert.equal(rpc.pid, undefined);
      } finally { await rpc.stop(); }
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
