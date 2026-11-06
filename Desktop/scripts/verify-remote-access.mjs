import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { prepareSessionFixture } from './session-fixture.mjs';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const executablePath = process.env.DESKTOP_VERIFY_EXE;
const resources = executablePath ? (process.platform === 'darwin' ? resolve(dirname(executablePath), '../Resources') : join(dirname(executablePath), 'resources')) : resolve('.');
const runtime = join(resources, 'runtime');
const output = resolve('test-results/remote-access');
await mkdir(output, { recursive: true });
const adapter = createRequire(import.meta.url)(join(runtime, 'remote/lark-adapter.cjs'));
for (const name of ['Client', 'LarkRegistration', 'LarkApi', 'LarkInboundGate', 'WSClient', 'EventDispatcher'])
  assert.equal(typeof adapter[name], 'function', `Packaged adapter exports ${name}`);
assert.ok((await readFile(join(runtime, 'remote/FEISHU-SDK-LICENSE'), 'utf8')).length > 100);
const gate = new adapter.LarkInboundGate('bot');
const gateMessage = { sender: { sender_id: { open_id: 'human' } }, message: { chat_type: 'p2p', message_type: 'text',
  message_id: 'one', chat_id: 'chat', create_time: Date.now(), content: '{"text":"fixture"}' } };
assert.equal(gate.accept(gateMessage).action, 'accept');
assert.equal(gate.accept(gateMessage).action, 'ignore');
gate.close();
// Load the real staged helper without initiating any authorization or network.
const helper = spawn(join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'), [join(runtime, 'remote-channel.mjs')], { windowsHide: true, stdio: 'pipe' });
let stdout = '', stderr = '';
helper.stdout.on('data', chunk => { stdout += chunk; });
helper.stderr.on('data', chunk => { stderr += chunk; });
const helperClosed = new Promise((yes, no) => { helper.on('exit', code => code === 0 ? yes() : no(new Error(`Helper exit ${code}`))); helper.on('error', no); });
helper.stdin.write('{"id":"smoke","type":"unsupported"}\n');
const until = Date.now() + 10000;
while (!stdout.includes('"smoke"')) {
  if (Date.now() > until) { helper.kill(); throw new Error('Staged Remote helper did not respond'); }
  await new Promise(resolve => setTimeout(resolve, 20));
}
assert.deepEqual(JSON.parse(stdout.trim()), { type: 'response', id: 'smoke', success: false, error: 'Remote operation unavailable' });
helper.stdin.end(); await helperClosed; assert.equal(stderr, '');

const profile = await mkdtemp(join(tmpdir(), 'step-remote-'));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
const fixtureHelper = join(profile, 'remote-fixture.mjs');
const fixtureImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
await writeFile(fixtureHelper, `
import { createInterface } from 'node:readline';
let bindingId;
const write = value => process.stdout.write(JSON.stringify(value)+'\\n');
const event = (kind, fields={}) => write({type:'remote_channel',kind,bindingId,...fields});
createInterface({input:process.stdin}).on('line', line => {
  const value=JSON.parse(line);
  if(value.type==='fixture-event'){event(value.kind,value.fields);return;}
  if(value.type==='connect') {
    if(value.identity) event('connected',{botName:'Isolated Feishu',callbackUrl:'https://open.feishu.cn/page/launcher?clientID=fixture'});
    else event('authorization',{url:'https://open.feishu.cn/page/cli?user_code=fixture-only',expiresAt:Date.now()+300000});
  }
  if(value.type==='arm') event('candidate',{armId:value.armId,candidateId:'fixture-candidate'});
  if(value.type==='bind'||value.type==='bindSaved') bindingId=value.bindingId;
  if(value.type==='card') write({type:'remote_fixture_record',card:value});
  if(value.type==='reaction') write({type:'remote_fixture_reaction',reaction:value});
  if(value.type==='imageUploadSend') write({type:'remote_fixture_record',card:{key:'fixture-image-sent',nativeImage:true,sessionKey:value.sessionKey}});
  if(value.type==='unbind') bindingId=undefined;
  const data=value.type==='snapshot'?{identity:{botId:'fixture-bot',credentials:{appId:'fixture-app',appSecret:'REMOTE-PERSISTENCE-SECRET',brand:'feishu'}},
    peer:bindingId?{actor:'fixture-human',chat:'fixture-chat'}:undefined}
    :value.type==='imageOpen'?{transferId:'fixture-download',mimeType:'image/png',size:${fixtureImage.length}}
    :value.type==='imageChunk'?{data:${JSON.stringify(fixtureImage.toString('base64'))},end:true}
    :value.type==='imageUploadOpen'?{transferId:'fixture-upload'}
    :value.type==='imageUploadSend'?{messageId:'fixture-image-sent'}:undefined;
  write({type:'response',id:value.id,success:true,data});
});
`);
// A source-only launcher installs the network boundary before automatic recovery.
// A packaged launch keeps its normal entry point and the existing process-only injection.
const sourceEntry = join(profile, 'remote-entry.cjs');
await writeFile(sourceEntry, `
const cp=require('node:child_process'),original=cp.spawn;
const fixture=globalThis.remoteHarness={cards:[],reactions:[],opened:[],child:undefined,env:undefined};
require('electron').shell.openExternal=async url=>{fixture.opened.push(url);};
cp.spawn=(command,args,options)=>{
  if(!args?.[0]?.endsWith('remote-channel.mjs'))return original(command,args,options);
  fixture.env=options.env;
  const child=fixture.child=original(command,[${JSON.stringify(fixtureHelper)}],options);
  let buffer='';
  child.stdout.on('data',chunk=>{
    buffer+=chunk;
    for(;;){const end=buffer.indexOf('\\n');if(end<0)break;
      const value=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      if(value.type==='remote_fixture_record')fixture.cards.push(value.card);
      if(value.type==='remote_fixture_reaction')fixture.reactions.push(value.reaction);
    }
  });
  return child;
};
require(${JSON.stringify(resolve('dist/main.cjs'))});
`);
const received = [], failures = [], imageInputs = [];
let held;
const server = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const chunk of request) { raw += chunk; assert.ok(raw.length < 8 * 1024 * 1024); }
    const body = JSON.parse(raw);
    const text = message => typeof message.content === 'string' ? message.content : message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n');
    const task = text(body.messages.findLast(message => message.role === 'user'
      && !text(message).includes('This is runtime state, not an additional user message.')));
    if (task === 'REMOTE-IMAGE-INPUT') imageInputs.push(body.messages.findLast(message => message.role === 'user').content);
    received.push(task);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: 'remote-fixture', object: 'chat.completion.chunk',
      model: body.model, created: 1, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (task === 'REMOTE-HOLD') { held = response; return; }
    const done = id => body.messages.some(message => message.role === 'tool' && message.tool_call_id === id);
    const tool = (id, name, args) => {
      send({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
      response.end('data: [DONE]\n\n');
    };
    if (task === 'REMOTE-QUESTION') {
      if (!done('remote-question-call')) return tool('remote-question-call', 'clarify_user', { questions: [
        { id: 'scope', label: '范围', question: '采用哪种验证方式？', options: [
          { label: '单元测试', value: 'unit' }, { label: '界面验收', value: 'ui' },
        ], allow_freeform: true },
        { id: 'notes', label: '备注', question: '还有哪些要求？', allow_freeform: true },
      ] });
      const result = body.messages.find(message => message.role === 'tool' && message.tool_call_id === 'remote-question-call');
      assert.match(text(result), /answer: ui/);
      assert.match(text(result), /No packaging/);
    }
    if (task === 'REMOTE-PLAN' || task === 'REMOTE-PLAN-REFINE') {
      const context = body.messages.map(text).join('\n');
      if (!done(`${task}-write`)) {
        const path = /Write the proposal to (.*)\. Only this proposal/.exec(context)?.[1];
        assert.ok(path, 'The real runtime provides the active proposal path');
        return tool(`${task}-write`, 'write_file', { path, content: '# Remote proposal\n\nInspect the message mapping.\nRun regression tests before packaging.' });
      }
      if (!done(`${task}-submit`)) return tool(`${task}-submit`, 'exit_plan_mode', {});
      if (task === 'REMOTE-PLAN') assert.doesNotMatch(context, /\[Desktop Plan mode active\]/, 'Only explicit Plan approval exits planning');
      else { assert.match(context, /\[Desktop Plan mode active\]/); assert.match(context, /Add regression coverage/); }
    }
    const toolDone = body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'remote-call-12345678');
    if (task === 'REMOTE-APPROVAL' && !toolDone) send({ tool_calls: [{ index: 0, id: 'remote-call-12345678', type: 'function',
      function: { name: 'run_command', arguments: '{"command":"echo remote-approved"}' } }] }, 'tool_calls');
    else if (task === 'REMOTE-IMAGE-OUTPUT' && !body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'remote-image-12345678'))
      send({ tool_calls: [{ index: 0, id: 'remote-image-12345678', type: 'function',
        function: { name: 'desktop_send_image', arguments: '{"path":"remote-chart.png","caption":"Requested chart"}' } }] }, 'tool_calls');
    else send({ content: 'REMOTE-FIXTURE-ANSWER' }, 'stop');
    response.end('data: [DONE]\n\n');
  } catch (error) { failures.push(error.message); response.destroy(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const emptyWorkspace = join(profile, 'empty-project');
await mkdir(emptyWorkspace, { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'zh', workspaces: [emptyWorkspace] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-only',
  models: [{ id: 'fixture', name: 'Remote fixture', input: ['text', 'image'], contextWindow: 100000, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1', REMOTE_FIXTURE_SECRET: 'MUST-NOT-INHERIT' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  const launch = () => electron.launch({ ...(executablePath ? { executablePath } : { args: [sourceEntry] }), env, timeout: 60000 });
  app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1400, 950);
  });
  const owner = await prepareSessionFixture(page);
  await writeFile(join(owner.preferences.workspace, 'remote-chart.png'), fixtureImage);
  const coldId = 'remote-cold-history';
  const coldWorkspace = `${owner.preferences.workspace}/.`;
  const timestamp = new Date().toISOString();
  await mkdir(join(root, 'sessions'), { recursive: true });
  await writeFile(join(root, 'sessions', `${coldId}.jsonl`), [
    { type: 'session', version: 3, id: coldId, cwd: coldWorkspace, timestamp },
    { type: 'message', id: 'cold-user', parentId: null, timestamp,
      message: { role: 'user', content: [{ type: 'text', text: 'COLD-HISTORY-PRIVATE' }], timestamp: Date.now() } },
    { type: 'session_info', id: 'cold-name', parentId: 'cold-user', timestamp, name: 'Cold Remote' },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  // Inject a deterministic child only in the test process, never via a product env flag.
  if (executablePath) await app.evaluate(({ shell }, path) => {
    const cp = process.getBuiltinModule('node:child_process'), original = cp.spawn;
    const fixture = globalThis.remoteHarness = { cards: [], reactions: [], opened: [], child: undefined, env: undefined };
    shell.openExternal = async url => { fixture.opened.push(url); };
    cp.spawn = (command, args, options) => {
      if (!args?.[0]?.endsWith('remote-channel.mjs')) return original(command, args, options);
      fixture.env = options.env;
      const child = fixture.child = original(command, [path], options);
      let buffer = '';
      child.stdout.on('data', chunk => {
        buffer += chunk;
        for (;;) {
          const end = buffer.indexOf('\n'); if (end < 0) break;
          const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          if (value.type === 'remote_fixture_record') fixture.cards.push(value.card);
          if (value.type === 'remote_fixture_reaction') fixture.reactions.push(value.reaction);
        }
      });
      return child;
    };
  }, fixtureHelper);
  const inject = (kind, fields = {}) => app.evaluate((_, value) =>
    globalThis.remoteHarness.child.stdin.write(JSON.stringify({ type: 'fixture-event', ...value }) + '\n'), { kind, fields });
  const cards = () => app.evaluate(() => globalThis.remoteHarness.cards);
  const waitCard = async predicate => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      assert.deepEqual(failures, []);
      const found = (await cards()).findLast(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Expected Remote card not received');
  };
  const button = name => page.getByRole('button', { name, exact: true });
  const state = () => page.evaluate(() => window.desktop.remoteState());
  const waitState = async predicate => {
    const deadline = Date.now() + 30000;
    let current;
    while (Date.now() < deadline) {
      current = await state();
      if (predicate(current)) return current;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(`Remote state did not settle: ${JSON.stringify({ current, cards: (await cards()).slice(-4) })}`);
  };
  const waitRuntimeIdle = async runtimeId => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(() => window.desktop.snapshot());
      const worker = snapshot.runtimes.find(item => item.runtimeId === runtimeId);
      assert.ok(worker, 'The approval target must remain resident');
      if (!/running|waiting/.test(worker.status)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('The approval target did not become idle');
  };
  const screenshot = async name => {
    await page.locator('.remote-access-view,.remote-channel-detail,.remote-setup-stage').evaluateAll(elements =>
      Promise.all(elements.flatMap(element => element.getAnimations().map(animation => animation.finished.catch(() => {})))));
    await page.screenshot({ path: join(output, `${name}.png`) });
  };
  const checkFocus = async locator => {
    await page.locator('.remote-channel-detail,.remote-setup-stage').evaluateAll(elements =>
      Promise.all(elements.flatMap(element => element.getAnimations().map(animation => animation.finished.catch(() => {})))));
    await page.keyboard.press('Tab');
    await locator.scrollIntoViewIfNeeded();
    await locator.focus();
    const issues = await locator.evaluate(element => {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
      const gutter = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
      const issues = [];
      if (style.outlineStyle === 'none' || gutter < 4) issues.push('Missing shared focus indicator');
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const clip = getComputedStyle(ancestor), rect = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(clip.overflowX)
          && (bounds.left - gutter < rect.left - 1 || bounds.right + gutter > rect.right + 1)) issues.push(`Horizontal clip: ${ancestor.className}`);
        if (/(auto|scroll|hidden|clip)/.test(clip.overflowY)
          && (bounds.top - gutter < rect.top - 1 || bounds.bottom + gutter > rect.bottom + 1)) issues.push(`Vertical clip: ${ancestor.className}`);
      }
      return issues;
    });
    assert.deepEqual(issues, [], 'Production focus outline must be visible on all four sides');
  };
  const checkSteps = async () => {
    const geometry = await page.locator('.remote-setup-steps > button').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element), marker = element.firstElementChild.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
        center: marker.y + marker.height / 2, controlCenter: rect.y + rect.height / 2,
        hit: document.elementFromPoint(rect.right - 3, rect.y + rect.height / 2)?.closest('button') === element };
    }));
    assert.equal(geometry.length, 3);
    for (const rect of geometry) {
      assert.ok(Math.abs(rect.width - geometry[0].width) < 1 && Math.abs(rect.y - geometry[0].y) < 1);
      assert.equal(rect.paddingTop, rect.paddingBottom, 'Hit area has symmetric vertical padding');
      assert.ok(Math.abs(rect.center - rect.controlCenter) < 1, 'Step marker is vertically centered');
      assert.equal(rect.hit, true, 'The whole step column is the hit target');
    }
  };
  await page.locator('.composer > .composer-input').fill('Draft stays local');
  await button('远程访问').click();
  let panel = page.locator('.remote-live');
  await panel.getByRole('button', { name: /管理配置/ }).click();
  await button('连接飞书').click();
  await button('打开飞书授权').waitFor();
  assert.equal((await state()).status, 'pairing');
  assert.doesNotMatch(JSON.stringify(await state()), /user_code|isolated-only|MUST-NOT-INHERIT/);
  await button('打开飞书授权').click();
  assert.equal((await app.evaluate(() => globalThis.remoteHarness.opened)).length, 1);
  assert.equal((await app.evaluate(() => globalThis.remoteHarness.env)).REMOTE_FIXTURE_SECRET, undefined);
  await inject('connected', { botName: 'Isolated Feishu', callbackUrl: 'https://open.feishu.cn/page/launcher?clientID=fixture' });
  await waitState(current => current.status === 'connected');
  await button('继续').click();
  await button('生成验证码').click();
  await panel.locator('.remote-binding-code code').waitFor();
  await button('目标会话').click();
  const targetName = (await state()).sessions.find(session => session.runtimeId === owner.runtimeId).name;
  await page.getByRole('menuitemradio', { name: targetName, exact: true }).click();
  await panel.getByRole('checkbox', { name: coldWorkspace, exact: true }).check();
  await panel.getByRole('checkbox', { name: emptyWorkspace, exact: true }).check();
  await button('确认并绑定').click();
  await panel.locator('.remote-binding strong').waitFor();
  await waitState(current => current.saved);
  const savedConnection = await readFile(join(profile, 'remote/connection.dpapi'));
  assert.equal(savedConnection.includes(Buffer.from('REMOTE-PERSISTENCE-SECRET')), false);
  assert.doesNotMatch(JSON.stringify(await state()), /REMOTE-PERSISTENCE-SECRET|fixture-human|fixture-chat/);
  assert.equal((await state()).binding.runtimeId, owner.runtimeId);
  assert.deepEqual((await state()).authorized.workspaces, [owner.preferences.workspace, coldWorkspace, emptyWorkspace]);
  assert.equal((await state()).sessions.some(session => session.workspace === emptyWorkspace), false,
    'An empty known project can be authorized without creating a runtime');
  await button('继续').click();
  await button('发送验证卡片').click();
  const probe = await waitCard(card => card.key === 'probe');
  await inject('decision', { token: probe.actions.token, option: 'Verify / 验证' });
  await waitState(current => current.approvalReady);
  await checkSteps();
  await panel.locator('.remote-setup-steps button').first().hover();
  await checkFocus(panel.locator('.remote-setup-steps button').first());
  await screenshot('01-readiness-dark');
  await button('返回会话').click();
  assert.equal(await page.locator('.composer > .composer-input').innerText(), 'Draft stays local');
  const other = await page.evaluate(() => window.desktop.newIndependentSession());
  assert.notEqual(other.runtimeId, owner.runtimeId);
  await page.reload();
  await button('远程访问').waitFor();
  await page.locator('.composer > .composer-input').fill('Other draft stays local');
  await inject('input', { id: 'remote-one', text: 'REMOTE-ONE' });
  await inject('input', { id: 'remote-one', text: 'REMOTE-ONE' });
  const firstReply = await waitCard(card => card.reply === 'completed' && card.text.includes('REMOTE-FIXTURE-ANSWER'));
  assert.match(firstReply.title, /^s1 · /, 'Reply titles carry only the session source, not a completion heading');
  assert.equal(firstReply.actions, undefined);
  const firstReactions = await app.evaluate(() => globalThis.remoteHarness.reactions);
  assert.deepEqual(firstReactions.filter(value => value.messageId === 'remote-one').map(value => value.active), [true, true, true, false]);
  assert.deepEqual(firstReactions.filter(value => value.messageId === 'remote-one' && value.active).map(value => value.phase), ['queued', 'running', 'running']);
  assert.equal((await cards()).some(card => card.title.startsWith('Received')), false);
  assert.equal(received.filter(task => task === 'REMOTE-ONE').length, 1);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimeId, other.runtimeId);
  const beforeCommands = received.length;
  await inject('input', { id: 'help', text: '/help' });
  await waitCard(card => card.key !== 'welcome' && card.text.includes('/sessions [p1] [page]'));
  await inject('input', { id: 'list', text: '/session' });
  await waitCard(card => card.text.includes('Cold Remote'));
  assert.equal((await state()).sessions.find(session => session.sessionId === coldId).runtimeId, undefined,
    'Listing saved history must not start its runtime');
  assert.doesNotMatch(JSON.stringify(await cards()), /COLD-HISTORY-PRIVATE/);
  await inject('input', { id: 'empty-project-list', text: '/sessions p3' });
  await waitCard(card => card.text.includes('empty-project (0)') && card.text.includes('/new p3'));
  await inject('input', { id: 'cold-switch', text: `/session ${coldId}` });
  await waitState(current => current.binding?.sessionId === coldId);
  const cold = (await state()).binding;
  assert.equal(cold.sessionId, coldId, JSON.stringify({ binding: cold, sessions: (await state()).sessions }));
  assert.equal(cold.workspace, coldWorkspace, 'Cold preparation must retain the exact granted workspace identity');
  assert.notEqual(cold.runtimeId, owner.runtimeId);
  assert.equal(received.length, beforeCommands, 'Switching cold history must not send inference');
  await inject('input', { id: 'new', text: '/new' });
  await waitState(current => current.binding && current.binding.sessionId !== coldId);
  const remoteNew = (await state()).binding;
  assert.notEqual(remoteNew.sessionId, owner.state.sessionId);
  assert.equal(remoteNew.workspace, coldWorkspace);
  const local = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(local.runtimeId, other.runtimeId, 'Remote creation must not change local focus');
  assert.equal(local.runtimes.find(runtime => runtime.runtimeId === remoteNew.runtimeId).status, 'idle');
  assert.equal(await page.locator('.composer > .composer-input').innerText(), 'Other draft stays local');
  assert.equal(received.length, beforeCommands, 'Remote creation must not send inference');
  await inject('input', { id: 'new-message', text: 'REMOTE-NEW-SESSION' });
  await waitCard(card => card.sessionKey === remoteNew.sessionId && card.reply === 'completed');
  assert.equal(received.filter(task => task === 'REMOTE-NEW-SESSION').length, 1);
  await inject('input', { id: 'unauthorized-switch', text: `/session ${other.state.sessionId}` });
  await waitCard(card => card.title.startsWith('Not accepted'));
  assert.equal((await state()).binding.sessionId, remoteNew.sessionId);
  await inject('input', { id: 'after-failed-switch', text: 'MUST-NOT-MISROUTE' });
  await waitCard(card => card.text?.includes('Target unconfirmed'));
  assert.ok(!received.includes('MUST-NOT-MISROUTE'));
  await inject('input', { id: 'owner-switch', text: '/session s1' });
  await waitState(current => current.binding?.sessionId === owner.state.sessionId);
  const before = received.length;
  await inject('input', { id: 'slash', text: '/permissions full-access' });
  await waitCard(card => card.title.startsWith('Not accepted'));
  assert.equal(received.length, before);
  await inject('input', { id: 'approval', text: 'REMOTE-APPROVAL' });
  const approval = await waitCard(card => card.actions?.options.includes('Deny / 拒绝'));
  assert.match(approval.text, /echo remote-approved/, 'The card must show the actual tool command, not just the native summary');
  assert.ok(approval.text.length <= 5000, 'Actionable details must fit without clipping');
  await inject('decision', { token: approval.actions.token, option: 'Deny / 拒绝' });
  await inject('decision', { token: approval.actions.token, option: 'Allow once / 允许一次' });
  await waitRuntimeIdle(owner.runtimeId);
  await inject('input', { id: 'question-input', text: 'REMOTE-QUESTION' });
  const questionPermission = await waitCard(card => card.actions?.options.includes('Allow question / 允许提问'));
  assert.match(questionPermission.title, /Allow a question/);
  assert.doesNotMatch(questionPermission.text, /"questions"\s*:/, 'Question permission shows prose, not raw tool JSON');
  await inject('decision', { token: questionPermission.actions.token, option: 'Allow question / 允许提问' });
  const question = await waitCard(card => card.form?.length === 2);
  assert.match(question.title, /Answer questions/);
  assert.equal(question.sessionKey, owner.state.sessionId);
  await inject('decision', { token: question.actions.token, option: 'Submit answers / 提交答案',
    form: { q0: '1', c1: 'No packaging' } });
  await waitCard(card => card.reply === 'completed' && card.sessionKey === owner.state.sessionId
    && card.key !== firstReply.key && card.text.includes('REMOTE-FIXTURE-ANSWER'));
  await waitRuntimeIdle(owner.runtimeId);
  await page.evaluate(async runtimeId => {
    await window.desktop.command('set_permission_preset', { preset: 'approve-for-me' }, runtimeId);
    await window.desktop.command('set_launch_mode', { mode: 'plan', enabled: true }, runtimeId);
  }, owner.runtimeId);
  await inject('input', { id: 'plan-refine-input', text: 'REMOTE-PLAN-REFINE' });
  const planRefine = await waitCard(card => card.actions?.options.includes('Request refinements / 要求修改'));
  assert.match(planRefine.text, /Remote proposal/);
  await inject('decision', { token: planRefine.actions.token, option: 'Request refinements / 要求修改' });
  const feedback = await waitCard(card => card.title.startsWith('计划修改意见'));
  await inject('decision', { token: feedback.actions.token, option: 'Submit answers / 提交答案',
    form: { c0: 'Add regression coverage' } });
  await waitRuntimeIdle(owner.runtimeId);
  await inject('input', { id: 'plan-input', text: 'REMOTE-PLAN' });
  const plan = await waitCard(card => card.actions?.options.includes('Approve plan / 批准计划') && card.key !== planRefine.key);
  assert.match(plan.text, /Remote proposal/);
  await inject('decision', { token: plan.actions.token, option: 'Approve plan / 批准计划' });
  await waitRuntimeIdle(owner.runtimeId);
  await page.evaluate(runtimeId => window.desktop.command('set_permission_preset', { preset: 'ask' }, runtimeId), owner.runtimeId);
  assert.equal((await state()).imagesAllowed, false, 'Legacy and ordinary bindings have no image grant');
  await page.evaluate(() => window.desktop.remoteAction({ type: 'images', allowed: true }));
  assert.equal((await state()).imagesAllowed, true);
  const previousImageKeys = new Set((await cards()).map(card => card.key));
  await inject('input', { id: 'image-input', text: 'REMOTE-IMAGE-INPUT', images: ['img_fixture'] });
  await waitCard(card => card.reply === 'completed' && card.sessionKey === owner.state.sessionId
    && !previousImageKeys.has(card.key));
  assert.equal(imageInputs.length, 1, JSON.stringify({ received, cards: (await cards()).slice(-5) }));
  assert.ok(imageInputs[0].some(block => block.type === 'image_url' && block.image_url?.url?.startsWith('data:image/png;base64,')),
    'Remote image bytes must reach the actual runtime model input');
  await waitRuntimeIdle(owner.runtimeId);
  await inject('input', { id: 'image-output', text: 'REMOTE-IMAGE-OUTPUT' });
  const imageApproval = await waitCard(card => card.actions?.options.includes('Allow once / 允许一次') && card.text.includes('desktop_send_image'));
  assert.match(imageApproval.text, /remote-chart\.png/);
  await inject('decision', { token: imageApproval.actions.token, option: 'Allow once / 允许一次' });
  await waitCard(card => card.nativeImage && card.sessionKey === owner.state.sessionId);
  await waitCard(card => card.key === 'image-fixture-image-sent' && card.text === 'Requested chart');
  await waitRuntimeIdle(owner.runtimeId);
  const previousRuns = new Set((await cards()).map(card => card.key));
  await inject('input', { id: 'hold', text: 'REMOTE-HOLD' });
  const running = await waitCard(card => card.reply === 'working' && !previousRuns.has(card.key));
  assert.equal(running.actions, undefined, 'Working cards do not expose Stop buttons');
  const holdDeadline = Date.now() + 10000;
  while (!received.includes('REMOTE-HOLD')) {
    assert.ok(Date.now() < holdDeadline, 'The held model request must actually start before stopping');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await inject('input', { id: 'recall-queued', text: 'MUST-NOT-RUN-RECALLED' });
  await inject('input', { id: 'tasks-overview', text: '/tasks' });
  await waitCard(card => card.overview?.rows.some(row => row.queue === 1));
  await inject('recalled', { id: 'recall-queued' });
  await inject('input', { id: 'recall-status', text: '/status s1' });
  await waitCard(card => card.text?.includes('Queue: 0') && card.text.includes('Remote:'));
  assert.ok(!received.includes('MUST-NOT-RUN-RECALLED'));
  await inject('input', { id: 'switch-while-running', text: `/session ${remoteNew.sessionId}` });
  await waitState(current => current.binding?.sessionId === remoteNew.sessionId);
  await inject('input', { id: 'stop-original', text: '/stop s1' });
  await waitCard(card => card.key === running.key && card.reply === 'interrupted');
  assert.equal((await state()).binding.sessionId, remoteNew.sessionId,
    'An explicitly targeted slash stop must stop its original session without changing the selected session');
  if (!executablePath) {
    const beforeRestart = received.length;
    await closeDesktopFixture(app); app = undefined;
    app = await launch(); page = await app.firstWindow(); panel = page.locator('.remote-live');
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1400, 950);
    });
    await waitState(current => current.saved && current.status === 'connected' && current.binding?.sessionId === remoteNew.sessionId);
    assert.equal((await state()).imagesAllowed, true, 'The separate image opt-in survives encrypted restart recovery');
    assert.equal((await state()).approvalReady, false, 'Old callback readiness is not restored');
    assert.deepEqual((await state()).authorized.workspaces, [owner.preferences.workspace, coldWorkspace, emptyWorkspace],
      'A still-empty project must not invalidate restored authorization');
    assert.equal(received.length, beforeRestart, 'Restart must not replay interrupted or offline work');
    await inject('decision', { token: approval.actions.token, option: 'Allow once / 允许一次' });
    await inject('stop', { runId: running.key });
    await inject('input', { id: 'restored-old-handle', text: '/session s1' });
    await waitState(current => current.binding?.sessionId === owner.state.sessionId);
    await inject('input', { id: 'empty-project-new', text: '/new p3' });
    await waitState(current => current.binding?.workspace === emptyWorkspace);
    assert.equal(received.length, beforeRestart, 'Creating the first session in an empty project sends no inference');
    await inject('input', { id: 'restore-target', text: `/session ${remoteNew.sessionId}` });
    await waitState(current => current.binding?.sessionId === remoteNew.sessionId);
    await inject('input', { id: 'after-restart', text: 'REMOTE-AFTER-RESTART' });
    await waitCard(card => card.reply === 'completed' && card.sessionKey === remoteNew.sessionId);
    assert.equal(received.filter(task => task === 'REMOTE-AFTER-RESTART').length, 1);
    assert.equal(received.filter(task => task === 'REMOTE-HOLD').length, 1);
    assert.ok(!received.includes('MUST-NOT-RUN-RECALLED'));
  }
  const attached = (await state()).binding;
  await button('远程访问').click();
  await page.getByRole('tab', { name: '接入渠道', exact: true }).click();
  await panel.getByRole('button', { name: /管理配置/ }).click();
  await panel.locator('.remote-setup-steps button').nth(1).click();
  const imageGrant = panel.getByRole('checkbox', { name: '允许图片输入与明确交付的图片外发', exact: true });
  assert.equal(await imageGrant.isChecked(), true);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(320, 600);
  });
  for (const width of [1400, 420]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 850), width);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await checkFocus(imageGrant);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await screenshot(`05-image-grant-${theme}-${width}`);
    }
  }
  await page.getByRole('tab', { name: '已授权连接', exact: true }).click();
  const forwarding = panel.locator('.remote-forwarding');
  assert.ok(await forwarding.locator('.remote-authorized-row').count() > 0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkFocus(forwarding.getByRole('button', { name: '退出回传', exact: true }).first());
    assert.deepEqual(await forwarding.locator('.remote-authorized-row').evaluateAll(elements =>
      elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), []);
    await screenshot(`06-forwarding-${theme}-420`);
  }
  await button('返回会话').click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 950));
  await page.evaluate(sessionId => window.desktop.remoteAction({ type: 'detach', sessionId }), attached.sessionId);
  assert.equal((await state()).binding, undefined);
  assert.ok(!(await state()).sharing.some(session => session.sessionId === attached.sessionId));
  const detachedLocal = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(detachedLocal.runtimes.some(runtime => runtime.runtimeId === attached.runtimeId),
    'Exiting forwarding must not terminate the resident local session');
  await button('远程访问').click();
  await page.getByRole('tab', { name: '已授权连接', exact: true }).click();
  await button('解除绑定').click();
  await button('确认').click();
  await panel.getByRole('heading', { name: '暂无已授权连接' }).waitFor();
  assert.equal((await state()).binding, undefined);
  await page.getByRole('tab', { name: '运行状态', exact: true }).click();
  await button('断开连接').click(); await button('确认').click();
  assert.equal((await state()).status, 'idle');
  await assert.rejects(readFile(join(profile, 'remote/connection.dpapi')), { code: 'ENOENT' });
  await app.evaluate(async () => {
    const child = globalThis.remoteHarness.child;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Disconnect did not terminate the isolated helper')), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  });
  await assert.rejects(page.evaluate(() => window.desktop.remoteAction({ type: 'prompt', message: 'not allowed' })));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(320, 600); window.setSize(420, 850);
  });
  await page.getByRole('tab', { name: '接入渠道', exact: true }).click();
  await panel.getByRole('button', { name: /管理配置/ }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await checkSteps();
    await panel.locator('.remote-setup-steps button').first().hover({ force: true });
    await checkFocus(panel.locator('.remote-setup-steps button').first());
    await screenshot(`02-connection-narrow-${theme}`);
  }
  await button('连接飞书').click();
  await inject('connected', { botName: 'Isolated Feishu', callbackUrl: 'https://open.feishu.cn/page/launcher?clientID=fixture' });
  await button('继续').click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkFocus(button('目标会话'));
    await checkFocus(panel.locator('.remote-scope input:not(:disabled)').first());
    await checkFocus(panel.getByRole('checkbox', { name: '允许图片输入与明确交付的图片外发', exact: true }));
    await screenshot(`03-binding-focus-narrow-${theme}`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await panel.locator('.remote-setup-stage').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.evaluate(() => window.desktop.preferences({ language: 'en' }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 950));
  await page.reload();
  await button('Remote access').click();
  await panel.getByRole('button', { name: /Manage/ }).click();
  await page.getByRole('heading', { name: 'Remote access', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(420, 850));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSteps();
    await checkFocus(panel.locator('.remote-setup-steps button').first());
    await screenshot(`04-steps-english-narrow-${theme}`);
  }
  await page.evaluate(() => window.desktop.preferences({ language: 'zh' }));
  await page.evaluate(() => window.desktop.remoteAction({ type: 'disconnect' }));
  if (!executablePath) {
    await closeDesktopFixture(app); app = undefined;
    app = await launch(); page = await app.firstWindow();
    await button('远程访问').waitFor();
    assert.equal((await state()).status, 'idle');
    assert.equal(await app.evaluate(() => globalThis.remoteHarness.child === undefined), true, 'Explicit disconnect must not reconnect on restart');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(`Remote Beta acceptance passed: staged SDK/helper, scoped slash routing, cold/new sessions without inference, actual runtime image input, permission-tool native image delivery and caption, question permission followed by original structured answers, Plan refinements and explicit proposal approval, queued-only recall, tasks queue counts, detach retaining local work, original-task stop, approvals, dedup, encrypted grants, local draft/focus and light/dark narrow UI.${executablePath ? ' Restart injection is source-only.' : ' Actual quit/relaunch recovery and forget-on-disconnect passed.'}`);
} finally {
  held?.destroy();
  if (app) await closeDesktopFixture(app);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
