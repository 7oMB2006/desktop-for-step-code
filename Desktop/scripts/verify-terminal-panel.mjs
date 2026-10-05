import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-terminal-panel-'));
const workspace = join(profile, '中文项目');
await mkdir(workspace);
await writeFile(join(workspace, 'README.md'), '# Isolated terminal acceptance\n');
await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'terminal-acceptance', private: true }));
await writeFile(join(profile, 'waiting-child.cjs'), 'setInterval(() => {}, 1000);\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspace, workspaces: [workspace] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  DESKTOP_TERMINAL_SECRET: 'not-for-shell', SSH_PRIVATE_KEY: 'isolated-private-key',
  GITHUB_PAT: 'isolated-pat', DOCKER_AUTH_CONFIG: 'isolated-docker-auth',
  CUSTOM_UNCLASSIFIED_VALUE: 'isolated-unclassified' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 60000 });
const errors = [];
let appClosed = false;
let independentPid;
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, clipboard }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1706, 1066);
    globalThis.terminalCopies = [];
    clipboard.writeText = async text => { globalThis.terminalCopies.push(text); };
    clipboard.readText = async () => "Write-Output 'PASTE_OK'\r";
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  const workspaceAlias = `${workspace.toUpperCase().replace(/\\/g, '/')}/.`;
  await page.evaluate(cwd => window.desktop.workspace(cwd), workspaceAlias);
  await page.reload();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  const runtimeId = snapshot.runtimeId;
  assert.ok(runtimeId);
  const list = () => page.evaluate(id => window.desktop.terminalList(id), runtimeId);
  const panel = page.locator('#terminal-panel');
  const rail = page.locator('.right-tool-rail').getByRole('button', { name: '终端', exact: true });
  await rail.click();
  await page.waitForFunction(() => document.querySelector('.terminal-footer')?.textContent.includes('运行中'), { timeout: 30000 });
  let terminals = await list();
  assert.equal(terminals.length, 1);
  const id = terminals[0].id;
  const write = data => page.evaluate(({ id, data }) => window.desktop.terminalWrite(id, data), { id, data });
  const output = async () => (await list()).find(terminal => terminal.id === id)?.chunks.map(chunk => chunk.data).join('') ?? '';
  async function waitOutput(text) {
    const start = Date.now();
    while (!(await output()).includes(text)) {
      if (Date.now() - start > 15000) throw new Error(`Terminal output missing: ${text}\n${await output()}`);
      await page.waitForTimeout(100);
    }
  }
  await waitOutput('PS ');
  await write("Write-Output ('SHELL_' + 'PID=' + $PID)\r");
  await waitOutput('SHELL_PID=');
  const shellPid = Number((await output()).match(/SHELL_PID=(\d+)/)[1]);
  await write("Write-Output ('REAL_' + 'PTY_OK'); Write-Output ('中文' + '正常'); Get-ChildItem\r");
  await waitOutput('REAL_PTY_OK');
  await waitOutput('中文正常');
  await write("if (@('DESKTOP_TERMINAL_SECRET','SSH_PRIVATE_KEY','GITHUB_PAT','DOCKER_AUTH_CONFIG','CUSTOM_UNCLASSIFIED_VALUE').Where({ Test-Path ('Env:' + $_) }).Count) { Write-Output 'LEAK' } else { Write-Output ('ENV_' + 'CLEAN') }\r");
  await waitOutput('ENV_CLEAN');
  const environmentOutput = await output();
  assert.ok(!['isolated-private-key', 'isolated-pat', 'isolated-docker-auth', 'isolated-unclassified'].some(value => environmentOutput.includes(value)));
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await assert.rejects(page.evaluate(() => window.desktop.terminalWrite('unknown', 'test')), /Unknown terminal/);
  await assert.rejects(page.evaluate(id => window.desktop.terminalResize(id, 10000, 0), id), /dimensions/);
  await assert.rejects(page.evaluate(id => window.desktop.terminalWrite(id, 'x'.repeat(65537)), id), /input/);
  await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.type("Write-Output ('KEYBOARD_' + 'OK')");
  await page.keyboard.press('Enter');
  await waitOutput('KEYBOARD_OK');
  await panel.getByRole('button', { name: '粘贴到终端', exact: true }).click();
  await waitOutput('PASTE_OK');
  await write("Start-Sleep -Seconds 60\r");
  await page.waitForTimeout(200);
  await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(400);
  await write("Write-Output ('INTERRUPT_' + 'OK')\r");
  await waitOutput('INTERRUPT_OK');
  await write("Clear-Host; Get-ChildItem; Write-Output ('终端' + '已就绪')\r");
  await waitOutput('终端已就绪');
  await page.waitForTimeout(150);
  const normalCols = (await list())[0].cols;
  await page.mouse.move(800, 25);
  await page.screenshot({ path: 'test-results/terminal-panel-light.png' });
  const ease = await panel.evaluate(element => getComputedStyle(element).transitionTimingFunction);
  assert.ok(ease.includes('cubic-bezier(0.22, 1, 0.36, 1)'));
  const beforeWidth = (await panel.boundingBox()).width;
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  const expansion = await panel.evaluate(async element => {
    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 350) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      frames.push(element.getBoundingClientRect().width);
    }
    return frames;
  });
  assert.equal(await page.locator('main').evaluate(element => element.inert), true);
  const rect = await panel.boundingBox();
  const sidebar = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.app')).getPropertyValue('--sidebar-track')));
  assert.ok(Math.abs(rect.x - sidebar) < 1);
  assert.ok(expansion.some(width => width > beforeWidth + 1 && width < rect.width - 1));
  assert.ok((await list())[0].cols > normalCols, 'fullscreen resizes the real PTY columns');
  await write("Clear-Host; Get-ChildItem; Write-Output ('全屏' + '已就绪')\r");
  await waitOutput('全屏已就绪');
  await page.mouse.move(800, 25);
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/terminal-panel-expanded.png' });
  const screen = page.locator('.terminal-view:not([hidden]) .xterm-screen');
  const screenBox = await screen.boundingBox();
  await page.mouse.move(screenBox.x + 5, screenBox.y + 25);
  await page.mouse.down();
  await page.mouse.move(screenBox.x + 700, screenBox.y + 200, { steps: 8 });
  await page.mouse.up();
  await panel.getByRole('button', { name: '复制所选文本', exact: true }).click();
  await page.waitForTimeout(100);
  assert.ok(await app.evaluate(() => globalThis.terminalCopies.some(text => text.length > 0)), 'copy uses the typed clipboard bridge');
  await screen.click({ position: { x: 100, y: 8 } });
  await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.press('Escape');
  assert.equal(await panel.evaluate(element => element.classList.contains('is-expanded')), true, 'shell Escape must not close or restore the panel');
  await panel.getByRole('button', { name: '还原侧栏', exact: true }).click();
  await page.waitForTimeout(350);
  await panel.getByRole('button', { name: '新建终端', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 2);
  for (let attempt = 0; !(await list()).some(terminal => terminal.title === 'PowerShell 2' && terminal.status === 'running'); attempt++) {
    if (attempt > 100) throw new Error('Second terminal did not start');
    await page.waitForTimeout(100);
  }
  terminals = await list();
  assert.equal(terminals.length, 2);
  const secondId = terminals.find(terminal => terminal.id !== id).id;
  const secondOutput = async () => (await list()).find(terminal => terminal.id === secondId)?.chunks.map(chunk => chunk.data).join('') ?? '';
  const escape = text => text.replaceAll("'", "''");
  const node = executablePath ? join(dirname(executablePath), 'resources/runtime/node/node.exe') : resolve('runtime/node/node.exe');
  const childCommand = `$child = Start-Process -FilePath '${escape(node)}' -ArgumentList '${escape(join(profile, 'waiting-child.cjs'))}' -PassThru -WindowStyle Hidden; Write-Output ('CHILD_' + 'PID=' + $child.Id)\r`;
  await page.evaluate(({ id, data }) => window.desktop.terminalWrite(id, data), { id: secondId, data: childCommand });
  for (let attempt = 0; !(await secondOutput()).match(/CHILD_PID=(\d+)/); attempt++) {
    if (attempt > 100) throw new Error('Child process did not start');
    await page.waitForTimeout(100);
  }
  const childPid = Number((await secondOutput()).match(/CHILD_PID=(\d+)/)[1]);
  await panel.getByRole('tab', { name: 'PowerShell 1', exact: true }).click();
  await rail.click();
  await write("Start-Sleep -Milliseconds 200; Write-Output ('HIDDEN_' + 'OK')\r");
  await waitOutput('HIDDEN_OK');
  await write("1..3500 | ForEach-Object { 'abcdefghijklmnopqrstuvwxyz0123456789' * 3 }; Write-Output ('BACKPRESSURE_' + 'OK')\r");
  await waitOutput('BACKPRESSURE_OK');
  await rail.click();
  assert.equal(await page.locator('.terminal-tab').count(), 2);
  await panel.getByRole('button', { name: '清空终端', exact: true }).click();
  await write("Clear-Host; Get-ChildItem; Write-Output ('终端' + '已就绪')\r");
  await page.waitForTimeout(250);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/terminal-panel-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 760));
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bounds = await panel.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.width <= 580);
  await page.screenshot({ path: 'test-results/terminal-panel-narrow.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await panel.evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.reload();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  await rail.click();
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 2);
  assert.ok((await output()).includes('BACKPRESSURE_OK'));
  const independent = await page.evaluate(() => window.desktop.newIndependentSession());
  await page.reload();
  await rail.click();
  await page.waitForFunction(() => document.querySelector('.terminal-footer')?.textContent.includes('运行中'));
  assert.equal(await page.locator('.terminal-tab').count(), 1, 'independent directory gets its own terminal');
  const independentTerminals = await page.evaluate(id => window.desktop.terminalList(id), independent.runtimeId);
  assert.equal(independentTerminals.length, 1);
  assert.notEqual(independentTerminals[0].cwd, terminals[0].cwd);
  await page.evaluate(id => window.desktop.terminalWrite(id, "Write-Output ('INDEPENDENT_' + 'PID=' + $PID)\r"), independentTerminals[0].id);
  for (let attempt = 0; attempt < 100; attempt++) {
    const snapshots = await page.evaluate(id => window.desktop.terminalList(id), independent.runtimeId);
    const match = snapshots[0].chunks.map(chunk => chunk.data).join('').match(/INDEPENDENT_PID=(\d+)/);
    if (match) { independentPid = Number(match[1]); break; }
    await page.waitForTimeout(100);
  }
  assert.ok(independentPid);
  await assert.rejects(page.evaluate(cwd => window.desktop.workspace(cwd), profile), /Unknown workspace/);
  await page.evaluate(cwd => window.desktop.workspace(cwd), workspaceAlias);
  await page.reload(); await rail.click();
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 2);
  await panel.getByRole('button', { name: '结束 PowerShell 2', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 1);
  for (let attempt = 0; attempt < 30; attempt++) {
    const alive = await app.evaluate(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }, childPid);
    if (!alive) break;
    await page.waitForTimeout(100);
  }
  assert.equal(await app.evaluate(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }, childPid), false,
    'explicit close must terminate the shell child process');
  await page.evaluate(id => window.desktop.terminalWrite(id, 'exit 3\r'), id);
  await page.waitForFunction(() => document.querySelector('.terminal-footer')?.textContent.includes('已退出'));
  assert.equal((await list())[0].exitCode, 3);
  assert.equal(await app.evaluate(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }, shellPid), false);
  await panel.getByRole('button', { name: '结束 PowerShell 1', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 0);
  await rail.click();
  const closing = await panel.evaluate(async element => {
    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 320) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      frames.push(Number(getComputedStyle(element).opacity));
    }
    return frames;
  });
  // Reduced motion was enabled above; normal-motion closure is covered below.
  assert.ok(closing.every(opacity => opacity === 0));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await rail.click(); await page.waitForTimeout(350);
  await rail.click();
  const motion = await panel.evaluate(async element => {
    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 320) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      frames.push(Number(getComputedStyle(element).opacity));
    }
    return frames;
  });
  assert.ok(motion.some(opacity => opacity > 0 && opacity < 1), 'terminal close must animate');
  await rail.click(); await page.waitForTimeout(350);
  assert.equal((await list()).length, 0, 'closing the last terminal must not recreate it automatically');
  assert.deepEqual(errors, []);
  const closed = app.waitForEvent('close', { timeout: 30000 });
  await page.evaluate(() => window.desktop.windowControl('close')).catch(() => {});
  await closed;
  appClosed = true;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let attempt = 0; alive(independentPid) && attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(alive(independentPid), false, 'application exit must end the background independent terminal');
  console.log(JSON.stringify({ result: 'PASS', realPowerShell: true, profile, screenshots: 'test-results/terminal-panel-*.png' }));
} finally { if (!appClosed) await app.close(); }
