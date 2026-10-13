import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { prepareSessionFixture } from './session-fixture.mjs';

assert.equal(process.platform, 'win32', 'This acceptance requires real Windows');
const scratch = await mkdtemp(join(tmpdir(), 'desktop-windows-commands-'));
const system = process.env.SystemRoot ?? 'C:\\Windows';
const source = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], join(process.env.LOCALAPPDATA ?? '', 'Programs')]
  .filter(Boolean).map(root => join(root, 'Git'));
let git;
for (const candidate of source) {
  try { await readFile(join(candidate, 'bin', 'bash.exe')); git = candidate; break; } catch {}
}
assert.ok(git, 'Install Git for Windows before running this acceptance');
// Copy real native Bash and its DLLs, not a mocked shell or a link back to the default install.
const portable = join(scratch, 'Developer Tools', 'Portable Git');
for (const dir of ['bin', 'cmd', 'usr/bin', 'mingw64/bin', 'etc']) await mkdir(join(portable, dir), { recursive: true });
for (const file of ['bin/bash.exe', 'cmd/git.exe', 'mingw64/bin/git.exe', 'usr/bin/bash.exe', 'usr/bin/sed.exe', 'usr/bin/sleep.exe', 'usr/bin/uname.exe', 'usr/bin/cygpath.exe'])
  await copyFile(join(git, file), join(portable, file));
for (const file of await readdir(join(git, 'usr/bin')))
  if (file.endsWith('.dll')) await copyFile(join(git, 'usr/bin', file), join(portable, 'usr/bin', file));
const text = content => typeof content === 'string' ? content
  : content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const waitFor = async (read, predicate, label) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.fail(`Timed out: ${label}`);
};
const report = [];
for (const mode of ['default', 'path-install', 'explicit', 'missing-explicit', 'no-native']) {
  console.log(`[windows-commands] ${mode}: starting`);
  const profile = join(scratch, mode);
  const root = join(profile, 'step-runtime');
  const workspace = join(profile, 'Workspace with spaces');
  await mkdir(join(root, 'agent'), { recursive: true });
  await mkdir(workspace, { recursive: true });
  const marker = join(workspace, 'probe.txt');
  await writeFile(marker, 'NATIVE_WORKSPACE_OK\n');
  const errors = [];
  const received = [];
  const invalid = mode === 'missing-explicit' || mode === 'no-native';
  const foreground = "printf 'SHELL=%s\\n' \"$BASH\"; cygpath -m /usr/bin/bash.exe; uname -s; sed -n '1p' probe.txt; printf 'STDERR_OK\\n' >&2";
  const server = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; assert.ok(raw.length < 8 * 1024 * 1024); }
      const body = JSON.parse(raw);
      const start = body.messages.findLastIndex(message => message.role === 'user' && text(message.content) === 'WINDOWS_COMMAND_PROBE');
      assert.ok(start >= 0);
      const tools = body.messages.slice(start + 1).filter(message => message.role === 'tool');
      received.push(tools.map(message => text(message.content)));
      let call;
      if (tools.length === 0) call = { name: 'run_command', arguments: { command: foreground, cwd: workspace } };
      else if (!invalid && tools.length === 1)
        call = { name: 'run_command', arguments: { command: 'printf \'EXPECTED_FAILURE\\n\' >&2; exit 7', cwd: workspace } };
      else if (!invalid && tools.length === 2)
        call = { name: 'run_command', arguments: {
          command: "printf 'BACKGROUND_STARTED\\n'; printf 'BACKGROUND_STDERR\\n' >&2; for ((attempt = 0; attempt < 100; attempt++)); do if [ -f release-background ]; then printf 'BACKGROUND_DONE\\n'; exit 0; fi; sleep 0.1; done; exit 9",
          cwd: workspace, run_in_background: true,
        } };
      else if (!invalid && tools.length === 3) {
        const logPath = /^Log: (.+)$/m.exec(text(tools[2].content))?.[1];
        assert.ok(logPath && isAbsolute(logPath), 'Actor receives the actual background log path');
        const initial = await waitFor(() => readFile(logPath, 'utf8').catch(() => ''),
          value => value.includes('BACKGROUND_STARTED'), 'background command starts while actor continues');
        assert.ok(!initial.includes('BACKGROUND_DONE'), 'Background tool returns before its process finishes');
        await writeFile(join(workspace, 'release-background'), 'release\n');
        await waitFor(() => readFile(logPath, 'utf8').catch(() => ''), value => value.includes('BACKGROUND_DONE'), 'background output flushed');
        call = { name: 'read_file', arguments: { path: logPath } };
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = call ? { tool_calls: [{ index: 0, id: `probe-${tools.length}`, type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] }
        : { content: 'WINDOWS_COMMAND_PROBE_COMPLETE' };
      res.end(`data: ${JSON.stringify({ id: 'windows-probe', object: 'chat.completion.chunk', model: body.model,
        choices: [{ index: 0, delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { errors.push(error.message); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'zh', workspace, workspaces: [workspace] }));
  const shellSetting = mode === 'explicit' || mode === 'missing-explicit'
    ? `shellPath = ${JSON.stringify(join(portable, mode === 'explicit' ? 'bin/bash.exe' : 'missing/bash.exe'))}\n` : '';
  await writeFile(join(root, 'config.toml'), `${shellSetting}defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n`);
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-fixture',
    models: [{ id: 'fixture', name: 'Windows command fixture', contextWindow: 32768, maxTokens: 2048 }],
  } } }));
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1', TMP: profile, TEMP: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode !== 'default') {
    // Windows regenerates ProgramFiles for inherited architecture environments.
    for (const key of ['PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432', 'ProgramW6432', 'CommonProgramW6432'])
      delete env[key];
    env.ProgramFiles = join(profile, 'empty-program-files');
    env['ProgramFiles(x86)'] = join(profile, 'empty-program-files-x86');
    env.LOCALAPPDATA = join(profile, 'empty-local');
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.PATH = [join(system, 'System32'), system, ...(mode === 'path-install' ? [join(portable, 'cmd')] : [])].join(';');
  }
  let app;
  try {
    app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
      ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
    if (mode !== 'default') {
      const actual = await app.evaluate(() => ({
        programFiles: process.env.ProgramFiles, path: process.env.PATH, local: process.env.LOCALAPPDATA,
      }));
      assert.equal(actual.programFiles, env.ProgramFiles);
      assert.equal(actual.path, env.PATH);
      assert.equal(actual.local, env.LOCALAPPDATA);
    }
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive();
    });
    await prepareSessionFixture(page);
    const snap = await page.evaluate(() => window.desktop.snapshot());
    await page.evaluate(runtimeId => window.desktop.command('prompt', { message: 'WINDOWS_COMMAND_PROBE' }, runtimeId), snap.runtimeId);
    const approved = new Set();
    const final = await waitFor(async () => {
      assert.deepEqual(errors, [], 'Local model fixture must not fail silently');
      const current = await page.evaluate(() => window.desktop.snapshot());
      for (const request of current.requests ?? []) {
        if (approved.has(request.id)) continue;
        assert.equal(request.method, 'confirm', 'Only tool confirmation expected in this isolated probe');
        await page.getByRole('button', { name: '批准本次操作', exact: true }).click();
        approved.add(request.id);
      }
      return current;
    },
      value => !value.state.isStreaming && value.messages.some(message =>
        message.role === 'assistant' && text(message.content).includes('WINDOWS_COMMAND_PROBE_COMPLETE')), `${mode} completion`);
    assert.deepEqual(errors, []);
    const results = final.messages.filter(message => message.role === 'toolResult');
    assert.equal(results.length, invalid ? 1 : 4);
    if (invalid) {
      assert.equal(results[0].isError, true);
      assert.match(text(results[0].content), mode === 'missing-explicit' ? /Custom shell path not found/ : /No native Bash shell found/);
      assert.ok(!text(results[0].content).includes('NATIVE_WORKSPACE_OK'), 'Unavailable native shell never silently falls back');
    } else {
      assert.ok(!results[0].isError);
      assert.match(text(results[0].content), /MINGW|MSYS/);
      assert.match(text(results[0].content), /NATIVE_WORKSPACE_OK/);
      assert.match(text(results[0].content), /STDERR_OK/);
      if (mode !== 'default') assert.match(text(results[0].content), /Developer Tools\/Portable Git/);
      assert.equal(results[1].isError, true);
      assert.match(text(results[1].content), /code 7/);
      assert.match(text(results[1].content), /EXPECTED_FAILURE/);
      const details = results[2].details;
      assert.equal(details.background, true);
      assert.ok(details.pid > 0 && isAbsolute(details.logPath));
      const location = relative(await realpath(profile), await realpath(details.logPath));
      assert.ok(location && !location.startsWith('..') && !isAbsolute(location), 'Background log belongs to the isolated profile');
      assert.match(text(results[2].content), /MSYS_NO_PATHCONV=1 taskkill \/F \/T \/PID/);
      for (const marker of ['BACKGROUND_STARTED', 'BACKGROUND_STDERR', 'BACKGROUND_DONE'])
        assert.ok(text(results[3].content).includes(marker), `read_file and actor receive ${marker}`);
      assert.ok(received.at(-1).at(-1).includes('BACKGROUND_DONE'), 'Background log reaches the model through real RPC');
    }
    report.push({ mode, passed: true, toolResults: results.length });
    console.log(`[windows-commands] ${mode}: passed`);
  } finally {
    if (app) {
      await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); }).catch(() => {});
      await app.close();
    }
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
}
await mkdir('test-results', { recursive: true });
await writeFile('test-results/windows-commands.json', JSON.stringify({ scratch, report }, null, 2));
console.log('Windows command acceptance passed: native discovery, non-default Git PATH, explicit shell, missing-path rejection, foreground failure and background log readback. Local deterministic model only.');
