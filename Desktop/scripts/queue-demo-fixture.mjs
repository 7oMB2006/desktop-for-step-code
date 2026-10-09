import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function queueFixture(profile, { duration = 40000 } = {}) {
  const workspace = join(profile, 'queue-demo-workspace');
  const root = join(profile, 'step-runtime');
  await mkdir(workspace, { recursive: true });
  await mkdir(join(root, 'sessions'), { recursive: true });
  await writeFile(join(workspace, 'demo.txt'), 'Queue preview\nversion=0\n');
  const requests = [];
  const streams = new Set();
  const timers = new Set();
  let version = 0;
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: 'queue-demo', object: 'chat.completion.chunk', model: 'queue-demo', created: 1,
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
  const finish = response => {
    if (!response.destroyed && !response.writableEnded) response.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  };
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const part of request) {
        body += part;
        if (body.length > 8 * 1024 * 1024) { response.writeHead(413).end(); return; }
      }
      const payload = JSON.parse(body);
      const userIndex = payload.messages.findLastIndex(message => {
        if (message.role !== 'user') return false;
        const content = typeof message.content === 'string' ? message.content : message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
        return !content.startsWith('<system-reminder>Ultracode and Ultraloop are names for the same multi-agent workflow capability.');
      });
      const user = payload.messages[userIndex];
      const text = typeof user.content === 'string' ? user.content : user.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      requests.push(text);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (!payload.messages.slice(userIndex + 1).some(message => message.role === 'tool')) {
        const tool = payload.tools?.find(item => ['edit', 'edit_file'].includes(item.function.name));
        if (tool) {
          const oldText = (await readFile(join(workspace, 'demo.txt'), 'utf8')).trimEnd();
          const newText = `Queue preview\nversion=${++version}\nmessage=${text.slice(0, 160).replace(/\r?\n/g, ' ')}`;
          const args = tool.function.parameters.properties?.search
            ? { path: join(workspace, 'demo.txt'), search: oldText, replace: newText }
            : { path: join(workspace, 'demo.txt'), edits: [{ oldText, newText }] };
          response.end(chunk({ role: 'assistant', content: '正在修改隔离目录里的 demo.txt。\n\n',
            tool_calls: [{ index: 0, id: `demo-edit-${version}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }] })
            + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
          return;
        }
      }
      streams.add(response);
      response.write(chunk({ role: 'assistant', content: `正在处理：${text.slice(0, 160)}\n\n` }));
      const steps = ['示例文件的改动已经记录。', '当前响应继续输出，任务还在运行。', '继续核对本轮消息和改动。', '这一轮已处理完成。'];
      let count = 0;
      const timer = setInterval(() => {
        response.write(chunk({ content: `${steps[Math.min(count, steps.length - 1)]}\n\n` }));
        if (++count >= steps.length) { clearInterval(timer); timers.delete(timer); finish(response); }
      }, duration / steps.length);
      timers.add(timer);
      response.on('close', () => { clearInterval(timer); timers.delete(timer); streams.delete(response); });
    } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'zh', workspaces: [workspace] }));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "queue-demo"\ndefaultModel = "queue-demo"\npermissionPreset = "bypass"\n[telemetry]\nenabled = false\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({
    providers: { 'queue-demo': { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-demo-only',
      models: [{ id: 'queue-demo', name: '本地队列示例', contextWindow: 32768, maxTokens: 2048 }] } },
  }));
  await writeFile(join(root, 'sessions', 'queue-demo.jsonl'), [
    { type: 'session', version: 3, id: 'queue-demo', cwd: workspace, timestamp: new Date().toISOString() },
    { type: 'message', id: 'demo-u1', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: '请检查这个示例目录。', timestamp: Date.now() } },
    { type: 'message', id: 'demo-a1', parentId: 'demo-u1', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: '示例目录里有一个 demo.txt。\n\n每一轮修改只发生在这个隔离目录，不会修改真实项目。\n\n这是本地模拟，不需要账户或 API，每轮约 40 秒。\n\n1. 发送“开始检查”，看到文件改动和慢速输出。\n2. 运行中输入“之后补充第一点”并按 Enter，观察待发送块出现、改动块向右移动。\n3. 再输入“补充第二点”并按 Enter，可以继续排队；悬停待发送块可编辑、撤回或查看全文。\n4. 输入框为空时再按 Enter，最早一条会插队，剩下的按顺序等待。继续按 Enter 也按从旧到新的顺序。单条旁的插队按钮可指定其他消息。插队在当前工具或模型响应结束后生效，不强行中断。\n5. 等队列处理完，观察队列块收起、改动块回中。也可以在运行时点击停止，队列会保留，等待你手动继续。\n\n可以重复发送任意文字，长文字、引用和附件也能试。每次打开示例都是新的隔离环境。' }], stopReason: 'stop', timestamp: Date.now(), provider: 'queue-demo', model: 'queue-demo', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
    { type: 'session_info', id: 'demo-name', parentId: 'demo-a1', name: '队列交互示例（本地模拟）', timestamp: new Date().toISOString() },
  ].map(item => JSON.stringify(item)).join('\n') + '\n');
  return {
    workspace, requests,
    finish: () => { for (const timer of timers) clearInterval(timer); timers.clear(); for (const response of streams) finish(response); },
    close: async () => { for (const timer of timers) clearInterval(timer); for (const response of streams) response.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
