import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { BvrBridge } from '../electron/bvr-bridge.ts';
import { SessionRuntimes } from '../electron/session-runtimes.ts';
import { isolatedEnvironment } from '../electron/runtime.ts';

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--bvr', '--output'].includes(key) && !options[key] && isAbsolute(value ?? ''),
    'Run with tsx; use --bvr <BVR checkout> --output <new absolute directory>');
  options[key] = value;
}
assert.ok(options['--bvr'] && options['--output']);
const output = resolve(options['--output']), bvr = resolve(options['--bvr']);
await mkdir(output, { recursive: false });
const profile = join(output, 'profile');
await mkdir(join(profile, 'sessions'), { recursive: true });
await writeFile(join(profile, 'config.toml'), '[telemetry]\nenabled = false\n');
const installed = join(profile, 'plugins', 'bilibili-video-research');
await cp(join(bvr, 'plugins', 'bilibili-video-research'), installed, { recursive: true });
await promisify(execFile)(process.execPath, [join(installed, 'server', 'configure.mjs'),
  '--profile', profile, '--runtime', bvr], { timeout: 15000 });
const video = join(output, 'offline.mp4');
const require = createRequire(join(bvr, 'package.json'));
await promisify(execFile)(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
  '-i', 'color=c=red:s=64x64:d=0.2', '-c:v', 'libx264', video], { timeout: 15000 });
let modelCalls = 0, modelError, hostCalls = 0, confirmations = 0;
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'step-5-preview', context_window: 32768, max_output_tokens: 2048,
        input_modalities: ['text', 'image'], reasoning_effort_support_list: ['off'] }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({
      id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'step-5-preview',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    if (modelCalls++ === 0) {
      const tool = body.tools?.find(item => item.function.name === 'bilibili-video-research__bvr__analyze_video');
      assert.ok(tool, 'Real runtime must discover the installed BVR MCP');
      res.write(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-bvr-call',
        type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({
          video_path: video, question: 'Describe visible color', media_detail: 'low',
        }) } }] }));
      res.end(`${frame({}, 'tool_calls')}data: [DONE]\n\n`);
    } else {
      assert.match(JSON.stringify(body.messages), /offline host research result/);
      res.end(`${frame({ role: 'assistant', content: 'Native BVR integration verified.' })}${frame({}, 'stop')}data: [DONE]\n\n`);
    }
  } catch (error) { modelError = error; res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const config = join(profile, 'fixture-models.json');
await writeFile(config, JSON.stringify({ defaultProvider: 'step', defaultModel: 'step-5-preview',
  providers: { step: { baseUrl, api: 'openai-completions', apiKey: 'offline-model-fixture',
    models: [{ id: 'step-5-preview', name: 'Local fixture', input: ['text', 'image'], contextWindow: 32768, maxTokens: 2048 }] } } }));
const events = [];
const pool = new SessionRuntimes(event => {
  events.push(event);
  if (event.type === 'extension_ui_request' && event.method === 'confirm') {
    const source = pool.workers.get(event.runtimeId);
    if (event.title?.includes('BVR')) {
      confirmations++;
      assert.match(event.message, /Step Plan/);
      assert.doesNotMatch(event.message, /offline-host-private/);
    }
    queueMicrotask(() => pool.respondToRequest(source, { id: event.id, confirmed: true }));
  }
}, undefined, { dispose: source => bridge.detach(source) });
const bridge = new BvrBridge(profile, pool, () => ({
  step: { type: 'oauth', access: 'offline-host-private', profile: 'step_plan', expires: Number.MAX_SAFE_INTEGER },
}), () => false, () => 'en', async (url, init) => {
  hostCalls++;
  assert.equal(String(url), 'https://api.stepfun.com/step_plan/v1/chat/completions');
  assert.equal(JSON.parse(init.body).model, 'step-5-preview');
  return Response.json({ choices: [{ message: { content: 'offline host research result' } }] });
});
try {
  await bridge.start();
  const env = { ...isolatedEnvironment(profile), HOME: profile, USERPROFILE: profile,
    STEPCODE_CONFIG_PATH: config, STEP_API_KEY: 'offline-model-fixture', STEP_BASE_URL: baseUrl };
  const source = await pool.open(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'),
    resolve('runtime/step/dist/bundle/step.js'), output, env);
  assert.equal(source.state.model.provider, 'step');
  await source.rpc.request('prompt', { message: 'Use BVR to inspect the local fixture video.' });
  const deadline = Date.now() + 45000;
  while (!events.some(event => event.type === 'agent_end') && Date.now() < deadline)
    await new Promise(done => setTimeout(done, 50));
  if (modelError) throw modelError;
  const history = await source.rpc.request('get_messages');
  assert.match(JSON.stringify(history), /Native BVR integration verified/);
  assert.equal(hostCalls, 1);
  assert.equal(confirmations, 1);
  assert.doesNotMatch(JSON.stringify([events, history]), /offline-host-private/);
  const report = { realStepRuntime: true, realBvrMcpChild: true, nativeSessionConfirmation: true,
    realProviderRequests: false, hostFixtureRequests: hostCalls, modelFixtureRequests: modelCalls,
    checks: ['native plugin MCP discovery', 'real launcher parent PID binding', 'live get_state during tool execution',
      'native session-scoped confirmation', 'Plan-routed video request', 'credential-free transcript'] };
  await writeFile(join(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await pool.stopAll();
  await bridge.stop();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
