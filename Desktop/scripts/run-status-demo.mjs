import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSessionFixture } from './session-fixture.mjs';

const executablePath = process.argv[2];
if (!executablePath) throw new Error('A packaged executable is required');
const profile = await mkdtemp(join(tmpdir(), 'step-status-demo-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'zh', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].hide(); });
  const snapshot = await prepareSessionFixture(page);
  await app.evaluate(({ ipcMain, BrowserWindow }, snapshot) => {
    const tasks = [
      { agent: 'review', task: '检查结果：模拟执行失败。', status: 'failed', messages: [] },
      { agent: 'explore', task: '整理材料：模拟执行被中断。', status: 'aborted', messages: [] },
      { agent: 'general', task: '汇总结论：模拟正常完成。', status: 'completed', messages: [] },
    ];
    const user = { role: 'user', content: '查看状态示例', timestamp: Date.now() };
    const assistant = { role: 'assistant', timestamp: Date.now(), content: [
      { type: 'text', text: '这是独立的本地状态示例。悬停红叉、黄三角或绿勾查看二级说明，也可以点击任务查看右侧记录。发送任意一句话可重放三种结束动画；推进清单也会同步演示。' },
      { type: 'toolCall', id: 'status-demo', name: 'subagent', arguments: { tasks: tasks.map(({ agent, task }) => ({ agent, task })) } },
    ] };
    const result = () => ({ role: 'toolResult', toolCallId: 'status-demo', toolName: 'subagent', content: '', details: { results: structuredClone(tasks) } });
    const sessionId = snapshot.state.sessionId;
    const model = { ...snapshot, draftId: undefined, messages: [user, assistant, result()],
      state: { ...snapshot.state, isStreaming: false, sessionName: '状态动画示例（本地模拟）', messageCount: 3 } };
    model.sessions = model.sessions.map(session => session.id === sessionId ? { ...session, name: model.state.sessionName } : session);
    let running = false;
    const timers = new Set();
    const emit = event => BrowserWindow.getAllWindows()[0]?.webContents.send('runtime-event', event);
    const update = () => {
      model.messages[2] = result();
      emit({ type: 'tool_execution_update', toolCallId: 'status-demo', toolName: 'subagent', partialResult: model.messages[2] });
    };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return model;
      if (method === 'sessions') return model.sessions;
      if (method === 'summary') return { sessionId, mcp: [], skillCount: 0, tasks: [
        { id: '1', subject: '核验结果', description: '明确失败，保留红叉。', status: running ? 'in_progress' : 'failed' },
        { id: '2', subject: '汇总结论', description: '正常完成，显示绿勾。', status: running ? 'in_progress' : 'completed' },
      ] };
      if (method === 'preferences') { Object.assign(model.preferences, args[0]); return model.preferences; }
      if (method === 'systemTheme') return { systemDark: true };
      if (method === 'command') {
        if (args[0] === 'get_available_thinking_levels') return { levels: ['off', 'low', 'medium', 'high'] };
        if (args[0] === 'get_commands') return { commands: [] };
        if (args[0] === 'prompt' && !running) {
          running = true; model.state.isStreaming = true;
          tasks.forEach(task => { task.status = 'running'; });
          emit({ type: 'agent_start' }); update();
          ['failed', 'aborted', 'completed'].forEach((status, index) => {
            const timer = setTimeout(() => {
              timers.delete(timer); tasks[index].status = status; update();
              if (index === 2) { running = false; model.state.isStreaming = false; emit({ type: 'agent_end', messages: model.messages }); }
            }, 3500 + index * 1500);
            timers.add(timer);
          });
        }
        if (args[0] === 'abort') {
          timers.forEach(clearTimeout); timers.clear();
          tasks.forEach(task => { if (task.status === 'running') task.status = 'aborted'; });
          running = false; model.state.isStreaming = false; update(); emit({ type: 'agent_end', messages: model.messages });
        }
        return {};
      }
      if (method === 'windowControl') {
        const win = BrowserWindow.getAllWindows()[0];
        if (args[0] === 'close' || args[0] === 'quit') win.destroy();
        if (args[0] === 'minimize') win.minimize();
        if (args[0] === 'toggleMaximize') win.isMaximized() ? win.unmaximize() : win.maximize();
        return { maximized: win.isMaximized() };
      }
      return {};
    });
  }, snapshot);
  await page.reload();
  await page.locator('.lane-row').first().waitFor();
  if (process.env.DESKTOP_STATUS_DEMO_CHECK === '1') {
    const input = page.locator('.composer textarea');
    await input.fill('重放状态动画'); await input.press('Enter');
    await page.locator('.lane-row .subagent-status-icon[data-state="running"]').first().waitFor();
    await page.locator('.lane-row .subagent-status-icon[data-state="stopped"]').waitFor();
    await page.locator('.lane-row .subagent-status-icon[data-state="done"]').waitFor();
    await page.locator('.lane-row .subagent-status-icon[data-state="failed"]').hover();
    await page.locator('.status-tooltip[aria-hidden="false"]').getByText('已失败', { exact: true }).waitFor();
    console.log('Packaged status demo passed: isolated session, replay and tooltip.');
    await app.close();
  } else {
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1180, 820); win.show(); win.focus(); });
    await new Promise(resolve => app.on('close', resolve));
  }
} catch (error) { await app.close(); throw error; }
