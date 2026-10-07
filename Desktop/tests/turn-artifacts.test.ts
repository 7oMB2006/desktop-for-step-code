import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localReference, turnArtifacts, turnOutputPaths } from '../src/turn-artifacts';
import { artifactFile } from '../electron/artifact-files';

test('artifact links parse through Markdown, deduplicate and exclude source and web links', () => {
  const outputs = turnArtifacts('[页面](</D:/项目/index.html>)\n\n[再打开](</D:/项目/index.html>)\n\n[源码](D:/项目/app.ts)\n\n[网站](https://example.com/)\n\n[报告][report]\n\n[report]: ./报告.pdf\n\n```md\n[伪引用](./hidden.pdf)\n```');
  assert.equal(outputs.length, 2);
  assert.equal(outputs[0].path, 'D:/项目/index.html');
  assert.equal(outputs[1].kind, 'document');
  assert.equal(localReference('file:///D:/demo/index.html'), 'D:/demo/index.html');
  assert.equal(localReference('D:/demo/app.ts:12'), 'D:/demo/app.ts');
  assert.equal(localReference('javascript:alert(1)'), undefined);
});
test('file access stays inside the session and refuses executable opening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artifact-test-'));
  await writeFile(join(root, 'index.html'), '<h1>Example</h1>');
  await writeFile(join(root, 'run.cmd'), 'echo test');
  await mkdir(join(root, 'directory'));
  assert.equal((await artifactFile(root, './index.html')).canOpen, true);
  assert.equal((await artifactFile(root, './run.cmd')).canOpen, false);
  assert.equal((await artifactFile(root, './missing.pdf')).exists, false);
  if (process.platform === 'win32') {
    const bashPath = join(root, 'index.html').replace(/\\/g, '/').replace(/^([a-z]):\//i, '/$1/');
    const native = await artifactFile(root, './index.html');
    assert.deepEqual(await artifactFile(root, bashPath), native);
    const outside = root.replace(/\\/g, '/').replace(/^([a-z]):\//i, '/$1/') + '/../outside.html';
    await assert.rejects(artifactFile(root, outside), /outside this session workspace/);
  }
  await assert.rejects(artifactFile(root, '../outside.html'));
  await assert.rejects(artifactFile(root, './directory'));
});

test('inline output filenames resolve against successful writes without requiring patches or links', () => {
  const paths = turnOutputPaths([
    { index: 0, message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'write', name: 'write', arguments: { path: 'output/index.html' } },
      { type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'reference.pdf' } },
      { type: 'toolCall', id: 'failed', name: 'write', arguments: { path: 'failed.pdf' } },
      { type: 'toolCall', id: 'source', name: 'edit', arguments: { path: 'app.ts' } },
    ] } },
    { index: 1, message: { role: 'toolResult', toolCallId: 'write', content: 'Done' } },
    { index: 2, message: { role: 'toolResult', toolCallId: 'read', content: 'Read' } },
    { index: 3, message: { role: 'toolResult', toolCallId: 'failed', isError: true, content: 'Failed' } },
    { index: 4, message: { role: 'toolResult', toolCallId: 'source', content: 'Done' } },
    { index: 5, message: { role: 'toolResult', toolCallId: 'unknown', content: 'Done' } },
  ]);
  assert.deepEqual(paths, ['output/index.html']);
  assert.deepEqual(turnArtifacts('| File | Notes |\n| --- | --- |\n| `index.html` | Animation |\n\n`README.md`\n\n```text\nhidden.pdf\n```\n\n`curl https://example.com/report.pdf`', paths).map(item => item.path), ['output/index.html', 'README.md']);
  assert.equal(turnArtifacts('All done.', paths)[0].inferred, true);
});

test('ambiguous basenames are not guessed and explicit links retain their label', () => {
  const paths = ['a/index.html', 'b/index.html'];
  assert.deepEqual(turnArtifacts('`index.html`', paths).map(item => item.path), paths);
  const outputs = turnArtifacts('[Animation](./index.html)\n\n`index.html`', ['index.html']);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].label, 'Animation');
  assert.equal(outputs[0].inferred, undefined);
});
