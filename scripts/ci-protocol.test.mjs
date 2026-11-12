import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { protocolFiles, protocolTimeout, runProtocol } from './ci-protocol.mjs';

const directory = fileURLToPath(new URL('../Desktop/test-results/protocol-runner-unit/', import.meta.url));

test('protocol inventory covers every test file without Desktop dependencies', () => {
  const entries = readdirSync(new URL('../Desktop/tests/', import.meta.url));
  const files = protocolFiles(entries);
  assert.deepEqual(files, entries.filter(file => file.endsWith('.test.ts')).sort());
  assert.ok(files.length > 100);
  for (const value of [[], ['a.test.ts', 'a.test.ts'], ['../a.test.ts']])
    assert.throws(() => protocolFiles(value));
});

test('protocol files run serially with independent TAP, isolation and bounded cleanup', async () => {
  const files = ['a.test.ts', 'b.test.ts'];
  const calls = [], snapshots = [];
  let active = 0;
  const report = await runProtocol({ files, directory, log() {},
    record(value) { snapshots.push(structuredClone(value)); },
    async execute(script, options) {
      assert.equal(++active, 1);
      assert.ok(script.endsWith('cli.mjs'));
      assert.equal(options.timeout, protocolTimeout);
      assert.equal(snapshots.at(-1).active.file, files[calls.length]);
      assert.ok(options.args.includes('--test-concurrency=1'));
      assert.ok(options.args.includes('--test-reporter=spec'));
      assert.ok(options.args.includes('--test-reporter=tap'));
      assert.ok(options.args.some(arg => arg.endsWith(`${options.logName}.tap`)));
      assert.ok(!options.args.some(arg => /force-exit|isolation=none/.test(arg)));
      calls.push(options.logName);
      await new Promise(resolve => setImmediate(resolve));
      active--;
    },
  });
  assert.deepEqual(calls, files);
  assert.equal(report.complete, true);
  assert.equal(report.active, null);
  assert.ok(snapshots.slice(0, -1).every(value => !value.complete));
  assert.deepEqual(report.results.map(row => row.status), ['success', 'success']);
});

test('protocol failure records the file and stops without a completion receipt or later file', async () => {
  let calls = 0, last;
  await assert.rejects(runProtocol({ files: ['a.test.ts', 'b.test.ts'], directory, log() {},
    record(value) { last = structuredClone(value); },
    async execute() { calls++; throw new Error('cleanup-unconfirmed'); },
  }), /Protocol a.test.ts failed/);
  assert.equal(calls, 1);
  assert.equal(last.complete, false);
  assert.equal(last.active, null);
  assert.equal(last.results[0].reason, 'cleanup-unconfirmed');
});

test('protocol cancellation never starts a later file or grants completion', async () => {
  for (const before of [true, false]) {
    const controller = new AbortController();
    if (before) controller.abort();
    let calls = 0, last;
    await assert.rejects(runProtocol({ files: ['a.test.ts', 'b.test.ts'], directory, log() {},
      signal: controller.signal, record(value) { last = structuredClone(value); },
      async execute() { calls++; controller.abort(); },
    }), /abort/i);
    assert.equal(calls, before ? 0 : 1);
    assert.equal(last.complete, false);
  }
});
