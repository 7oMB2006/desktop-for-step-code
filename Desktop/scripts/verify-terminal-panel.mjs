import { sampleMotion } from './sample-motion.mjs';
import { settleLayout } from './settle-layout.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const mac = process.platform === 'darwin';
const shellName = mac ? 'zsh' : 'PowerShell';
const command = (windows, posix) => (mac ? posix : windows) + '\r';
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
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, clipboard }, mac) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1706, 1066);
    globalThis.terminalCopies = [];
    clipboard.writeText = async text => { globalThis.terminalCopies.push(text); };
    clipboard.readText = async () => mac ? "printf 'PASTE_%s\\n' OK\r" : "Write-Output 'PASTE_OK'\r";
  }, mac);
  await app.evaluate(({ Menu }) => {
    globalThis.rightPanelWidthMenuFixture = { choice: undefined, menus: [] };
    Menu.prototype.popup = function (options) {
      const fixture = globalThis.rightPanelWidthMenuFixture;
      fixture.menus.push(this.items.map(item => ({ label: item.label, checked: item.checked, type: item.type })));
      this.items.find(item => item.label === fixture.choice)?.click();
      options.callback?.();
    };
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  const workspaceAlias = `${mac ? workspace : workspace.toUpperCase().replace(/\\/g, '/')}/.`;
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
  const handle = page.getByRole('button', { name: '调整右栏宽度', exact: true });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(350);
  assert.equal(await panel.locator('.right-panel-width-control').getAttribute('data-width'), 'wide');
  await handle.click();
  const handleMenu = page.getByRole('menu', { name: '右栏宽度', exact: true });
  await handleMenu.getByRole('menuitemradio', { name: '全屏', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await panel.locator('.right-panel-width-control').getAttribute('data-width'), 'fullscreen');
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);
  assert.equal(await panel.locator('.right-panel-width-control').getAttribute('data-width'), 'wide');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);
  assert.equal(await panel.locator('.right-panel-width-control').getAttribute('data-width'), 'standard');
  assert.equal((await list())[0].id, id, 'grip width changes preserve the existing PTY');
  const write = data => page.evaluate(({ id, data }) => window.desktop.terminalWrite(id, data), { id, data });
  const output = async () => (await list()).find(terminal => terminal.id === id)?.chunks.map(chunk => chunk.data).join('') ?? '';
  async function waitOutput(text, since = 0) {
    const start = Date.now();
    while (!(await output()).slice(since).includes(text)) {
      if (Date.now() - start > 15000) throw new Error(`Terminal output missing: ${text}\n${await output()}`);
      await page.waitForTimeout(100);
    }
  }
  if (mac) {
    await write("PROMPT='DFSC_PROMPT> '; printf 'READY_%s\\n' OK\r");
    await waitOutput('READY_OK');
  } else await waitOutput('PS ');
  await write(command("Write-Output ('SHELL_' + 'PID=' + $PID)", "printf 'SHELL_%s=%s\\n' PID $$"));
  await waitOutput('SHELL_PID=');
  const shellPid = Number((await output()).match(/SHELL_PID=(\d+)/)[1]);
  await write(command("Write-Output ('REAL_' + 'PTY_OK'); Write-Output ('中文' + '正常'); Get-ChildItem", "printf '%s\\n' 'REAL_'PTY_OK '中文'正常; ls"));
  await waitOutput('REAL_PTY_OK');
  await waitOutput('中文正常');
  await write(command("if (@('DESKTOP_TERMINAL_SECRET','SSH_PRIVATE_KEY','GITHUB_PAT','DOCKER_AUTH_CONFIG','CUSTOM_UNCLASSIFIED_VALUE').Where({ Test-Path ('Env:' + $_) }).Count) { Write-Output 'LEAK' } else { Write-Output ('ENV_' + 'CLEAN') }", "if env | /usr/bin/grep -Eq '^(DESKTOP_TERMINAL_SECRET|SSH_PRIVATE_KEY|GITHUB_PAT|DOCKER_AUTH_CONFIG|CUSTOM_UNCLASSIFIED_VALUE)='; then printf LEAK; else printf 'ENV_%s\\n' CLEAN; fi"));
  await waitOutput('ENV_CLEAN');
  const environmentOutput = await output();
  assert.ok(!['isolated-private-key', 'isolated-pat', 'isolated-docker-auth', 'isolated-unclassified'].some(value => environmentOutput.includes(value)));
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await assert.rejects(page.evaluate(() => window.desktop.terminalWrite('unknown', 'test')), /Unknown terminal/);
  await assert.rejects(page.evaluate(id => window.desktop.terminalResize(id, 10000, 0), id), /dimensions/);
  await assert.rejects(page.evaluate(id => window.desktop.terminalWrite(id, 'x'.repeat(65537)), id), /input/);
  await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.type(mac ? "printf 'KEYBOARD_%s\\n' OK" : "Write-Output ('KEYBOARD_' + 'OK')");
  await page.keyboard.press('Enter');
  await waitOutput('KEYBOARD_OK');
  await panel.getByRole('button', { name: '粘贴到终端', exact: true }).click();
  // zsh bracketed paste intentionally inserts text without executing its newline.
  if (mac) {
    await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.press('Enter');
  }
  await waitOutput('PASTE_OK');
  await write(command("Write-Output ('SLEEP_' + 'STARTED'); Start-Sleep -Seconds 60", "printf 'SLEEP_%s\\n' STARTED; sleep 60"));
  await waitOutput('SLEEP_STARTED');
  const sleepOutputEnd = (await output()).lastIndexOf('SLEEP_STARTED') + 'SLEEP_STARTED'.length;
  await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.press('Control+c');
  // ConPTY can flush queued input while handling Ctrl+C; wait for the new shell prompt.
  await waitOutput(mac ? 'DFSC_PROMPT> ' : 'PS ', sleepOutputEnd);
  await write(command("Write-Output ('INTERRUPT_' + 'OK')", "printf 'INTERRUPT_%s\\n' OK"));
  await waitOutput('INTERRUPT_OK');
  const composerBeforeDock = await page.locator('.composer-wrap').boundingBox();
  await panel.evaluate(element => { window.terminalDockElement = element.querySelector('.terminal-view'); });
  await write(command("Write-Output ('DOCK_' + 'START'); Start-Sleep -Milliseconds 700; Write-Output ('DOCK_' + 'END')", "printf 'DOCK_%s\\n' START; sleep 0.7; printf 'DOCK_%s\\n' END"));
  await waitOutput('DOCK_START');
  await panel.getByRole('button', { name: '停靠到底部', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#terminal-panel')?.classList.contains('is-bottom'));
  await page.waitForTimeout(350);
  await waitOutput('DOCK_END');
  assert.equal(await panel.evaluate(element => element.querySelector('.terminal-view') === window.terminalDockElement), true,
    'changing docks preserves the same xterm DOM, selection and controllers');
  const composerAfterDock = await page.locator('.composer-wrap').boundingBox();
  const bottomBounds = await panel.boundingBox();
  assert.ok(composerAfterDock.y < composerBeforeDock.y - 120, 'bottom docking pushes the composer upward');
  assert.ok(composerAfterDock.y + composerAfterDock.height <= bottomBounds.y + 1, 'bottom terminal never covers the composer');
  const reviewRail = page.locator('.right-tool-rail').getByRole('button', { name: '变更', exact: true });
  await reviewRail.click();
  await page.waitForTimeout(350);
  assert.equal(await panel.isVisible(), true, 'bottom terminal remains open alongside the right inspector');
  const rightBounds = await page.locator('#review-panel').boundingBox();
  const besideBounds = await panel.boundingBox();
  assert.ok(besideBounds.x + besideBounds.width <= rightBounds.x + 1, 'bottom terminal controls stay outside the docked inspector');
  await reviewRail.click();
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await panel.evaluate(element => Boolean(element.closest('[inert]'))), false, 'fullscreen terminal escapes the inert conversation');
  assert.equal(await page.locator('.main-content').evaluate(element => element.inert), true);
  await reviewRail.click();
  await page.waitForTimeout(350);
  assert.equal(await panel.evaluate(element => element.classList.contains('is-bottom')), true, 'opening a rail tool restores a fullscreen bottom terminal');
  assert.equal(await page.locator('#review-panel').isVisible(), true);
  await reviewRail.click();
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  await page.waitForTimeout(350);
  await panel.getByRole('button', { name: '还原侧栏', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await panel.evaluate(element => element.classList.contains('is-bottom')), true, 'fullscreen restores the bottom dock');
  const heightGrip = page.getByRole('separator', { name: '调整终端高度', exact: true });
  await heightGrip.focus();
  await heightGrip.press('ArrowUp');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.terminalHeight === 300);
  await page.waitForTimeout(300);
  assert.ok((await panel.boundingBox()).height >= 299, 'keyboard height adjustment resizes the bottom terminal');
  await page.reload();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  await rail.click();
  await page.waitForFunction(() => document.querySelector('#terminal-panel')?.classList.contains('is-bottom'));
  assert.equal((await list())[0].id, id, 'reloading with a saved dock restores the existing PTY');
  const dockPreferences = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(dockPreferences.preferences.terminalDock, 'bottom');
  assert.equal(dockPreferences.preferences.terminalHeight, 300);
  await panel.getByRole('button', { name: '停靠到右侧', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#terminal-panel')?.classList.contains('is-bottom'));
  await page.waitForTimeout(350);
  assert.equal((await list())[0].id, id);
  await assert.rejects(page.evaluate(() => window.desktop.preferences({ terminalDock: 'left' })), /Invalid terminal dock/);
  await assert.rejects(page.evaluate(() => window.desktop.preferences({ terminalHeight: -1 })), /Invalid terminal height/);
  await write(command("Clear-Host; Get-ChildItem; Write-Output ('终端' + '已就绪')", "clear; ls; printf '%s\\n' '终端'已就绪"));
  await waitOutput('终端已就绪');
  await page.waitForTimeout(150);
  const normalCols = (await list())[0].cols;
  await page.mouse.move(800, 25);
  await page.screenshot({ path: 'test-results/terminal-panel-light.png' });
  const ease = await panel.evaluate(element => getComputedStyle(element).transitionTimingFunction);
  assert.ok(ease.includes('cubic-bezier(0.22, 1, 0.36, 1)'));
  const widthControl = panel.getByRole('button', { name: '终端宽度', exact: true });
  const initialWidth = (await panel.boundingBox()).width;
  const sampleWidths = async (mode, action) => {
    await settleLayout(page.locator('.app'));
    const sample = await sampleMotion(page, {
      label: `terminal ${mode} width`,
      state: { selector: mode === 'wide' ? '.terminal-track.is-wide' : '#terminal-panel.is-expanded' },
      targets: [{ name: 'panel', selector: '#terminal-panel', properties: ['width'] },
        { name: 'track', selector: '.terminal-track' }],
      duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    }, action);
    await settleLayout(page.locator('.app'));
    await page.waitForFunction(async ({ runtimeId, normalCols }) =>
      (await window.desktop.terminalList(runtimeId))[0]?.cols > normalCols, { runtimeId, normalCols });
    return sample.frames.map(frame => frame.panel.width);
  };
  const chooseWidth = async value => {
    await app.evaluate((_, choice) => { globalThis.rightPanelWidthMenuFixture.choice = choice; },
      { standard: '标准', wide: '宽幅', fullscreen: '全屏' }[value]);
    await widthControl.click();
    await page.waitForFunction(() => document.querySelector('#terminal-panel .right-panel-width-control').getAttribute('aria-expanded') === 'false');
  };
  const wideFrames = await sampleWidths('wide', () => chooseWidth('wide'));
  assert.deepEqual(await app.evaluate(() => globalThis.rightPanelWidthMenuFixture.menus[0]), [
    { label: '标准', checked: true, type: 'radio' },
    { label: '宽幅', checked: false, type: 'radio' },
    { label: '全屏', checked: false, type: 'radio' },
  ]);
  const wideWidth = (await panel.boundingBox()).width;
  assert.ok(wideWidth > initialWidth + 30 && wideFrames.some(width => width > initialWidth + 1 && width < wideWidth - 1),
    'terminal wide mode animates and adds useful output space');
  assert.ok((await page.locator('main').boundingBox()).width >= 480, 'wide mode keeps a readable conversation column');
  assert.ok((await list())[0].cols > normalCols, 'wide mode increases the real PTY width');
  await chooseWidth('standard');
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await panel.boundingBox()).width - initialWidth) < 2, 'standard mode restores the normal width');
  await chooseWidth('fullscreen');
  assert.equal(await widthControl.getAttribute('data-width'), 'fullscreen');
  assert.equal(await page.locator('.main-content').evaluate(element => element.inert), true);
  await panel.getByRole('button', { name: '还原侧栏', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await widthControl.getAttribute('data-width'), 'standard', 'fullscreen menu restores the selected width mode');
  const beforeWidth = (await panel.boundingBox()).width;
  const expansion = await sampleWidths('fullscreen', () => panel.getByRole('button', { name: '全屏查看', exact: true }).click());
  assert.equal(await page.locator('.main-content').evaluate(element => element.inert), true);
  const rect = await panel.boundingBox();
  const sidebar = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.app')).getPropertyValue('--sidebar-track')));
  assert.ok(Math.abs(rect.x - sidebar) < 1);
  assert.ok(expansion.some(width => width > beforeWidth + 1 && width < rect.width - 1));
  assert.ok((await list())[0].cols > normalCols, 'fullscreen resizes the real PTY columns');
  await write(command("Clear-Host; Get-ChildItem; Write-Output ('全屏' + '已就绪')", "clear; ls; printf '%s\\n' '全屏'已就绪"));
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
  for (let attempt = 0; !(await list()).some(terminal => terminal.title === `${shellName} 2` && terminal.status === 'running'); attempt++) {
    if (attempt > 100) throw new Error('Second terminal did not start');
    await page.waitForTimeout(100);
  }
  terminals = await list();
  assert.equal(terminals.length, 2);
  const secondId = terminals.find(terminal => terminal.id !== id).id;
  const secondOutput = async () => (await list()).find(terminal => terminal.id === secondId)?.chunks.map(chunk => chunk.data).join('') ?? '';
  const escape = text => mac ? text.replaceAll("'", "'\\''") : text.replaceAll("'", "''");
  const node = executablePath ? join(dirname(executablePath), mac ? '../Resources/runtime/node/node' : 'resources/runtime/node/node.exe') : resolve('runtime/node', mac ? 'node' : 'node.exe');
  const childCommand = command(`$child = Start-Process -FilePath '${escape(node)}' -ArgumentList '${escape(join(profile, 'waiting-child.cjs'))}' -PassThru -WindowStyle Hidden; Write-Output ('CHILD_' + 'PID=' + $child.Id)`, `'${escape(node)}' '${escape(join(profile, 'waiting-child.cjs'))}' & printf 'CHILD_%s=%s\\n' PID $!`);
  await page.evaluate(({ id, data }) => window.desktop.terminalWrite(id, data), { id: secondId, data: childCommand });
  for (let attempt = 0; !(await secondOutput()).match(/CHILD_PID=(\d+)/); attempt++) {
    if (attempt > 100) throw new Error('Child process did not start');
    await page.waitForTimeout(100);
  }
  const childPid = Number((await secondOutput()).match(/CHILD_PID=(\d+)/)[1]);
  await panel.getByRole('tab', { name: `${shellName} 1`, exact: true }).click();
  await rail.click();
  await write(command("Start-Sleep -Milliseconds 200; Write-Output ('HIDDEN_' + 'OK')", "sleep 0.2; printf 'HIDDEN_%s\\n' OK"));
  await waitOutput('HIDDEN_OK');
  await write(command("1..3500 | ForEach-Object { 'abcdefghijklmnopqrstuvwxyz0123456789' * 3 }; Write-Output ('BACKPRESSURE_' + 'OK')", "for i in {1..3500}; do printf '%s%s%s\\n' abcdefghijklmnopqrstuvwxyz0123456789 abcdefghijklmnopqrstuvwxyz0123456789 abcdefghijklmnopqrstuvwxyz0123456789; done; printf 'BACKPRESSURE_%s\\n' OK"));
  await waitOutput('BACKPRESSURE_OK');
  await rail.click();
  assert.equal(await page.locator('.terminal-tab').count(), 2);
  await panel.getByRole('button', { name: '清空终端', exact: true }).click();
  await write(command("Clear-Host; Get-ChildItem; Write-Output ('终端' + '已就绪')", "clear; ls; printf '%s\\n' '终端'已就绪"));
  await page.waitForTimeout(250);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForFunction(() => {
    const root = document.documentElement;
    const viewport = document.querySelector('.terminal-view:not([hidden]) .xterm-scrollable-element');
    return viewport && !root.getAnimations().some(animation => animation.playState === 'running') &&
      getComputedStyle(viewport).backgroundColor === getComputedStyle(root).getPropertyValue('--bg').trim();
  }).catch(async error => {
    console.log(await page.evaluate(() => ({
      background: getComputedStyle(document.documentElement).getPropertyValue('--bg'),
      terminalBackground: document.querySelector('.terminal-view:not([hidden]) .xterm-scrollable-element')?.getAttribute('style'),
    })));
    throw error;
  });
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
  await page.evaluate(({ id, data }) => window.desktop.terminalWrite(id, data), { id: independentTerminals[0].id, data: command("Write-Output ('INDEPENDENT_' + 'PID=' + $PID)", "printf 'INDEPENDENT_%s=%s\\n' PID $$") });
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
  await panel.getByRole('button', { name: `结束 ${shellName} 2`, exact: true }).click();
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
  await panel.getByRole('button', { name: `结束 ${shellName} 1`, exact: true }).click();
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
  await settleLayout(page.locator('.app'));
  const closingMotion = await sampleMotion(page, {
    label: 'terminal normal close', state: { selector: '#terminal-panel.is-closing' },
    targets: [{ name: 'panel', selector: '#terminal-panel', properties: ['opacity'] },
      { name: 'track', selector: '.terminal-track' }],
    duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  }, () => rail.click());
  const motion = closingMotion.frames.map(frame => frame.panel.opacity);
  await settleLayout(page.locator('.app'));
  assert.ok(motion.some(opacity => opacity > 0 && opacity < 1), 'terminal close must animate');
  await rail.click(); await page.waitForTimeout(350);
  assert.equal((await list()).length, 0, 'closing the last terminal must not recreate it automatically');
  assert.deepEqual(errors, []);
  const closed = app.waitForEvent('close', { timeout: 30000 });
  await page.evaluate(() => window.desktop.windowControl('quit')).catch(() => {});
  await closed;
  appClosed = true;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let attempt = 0; alive(independentPid) && attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(alive(independentPid), false, 'application exit must end the background independent terminal');
  console.log(JSON.stringify({ result: 'PASS', shell: shellName, profile, screenshots: 'test-results/terminal-panel-*.png' }));
} finally { if (!appClosed) await app.close(); }
