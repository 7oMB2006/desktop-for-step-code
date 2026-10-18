import test from 'node:test';
import assert from 'node:assert/strict';
import { statusBuild, statusDetails } from '../electron/session-status';
import { sessionSummary } from '../electron/session-summary';

test('Status details whitelist runtime fields and preserve unknown vs false or empty', () => {
  const result = statusDetails({ trusted: false, agents: [], collaboration: 'Default',
    version: '0.1.0', versionSource: 'fallback', provider: 'step', model: 'step-3.5-flash',
    endpoint: 'https://user:password@example.com/v1?api_key=secret#token', access: 'hidden', content: 'hidden' })!;
  assert.equal(result.trusted, false);
  assert.deepEqual(result.agents, []);
  assert.equal(result.endpoint, 'https://example.com/v1');
  assert.equal(result.versionSource, 'fallback');
  assert.equal(result.collaboration, 'Default');
  assert.equal(JSON.stringify(result).includes('hidden'), false);
  assert.equal(JSON.stringify(result).includes('password'), false);
  assert.equal(statusDetails({})?.trusted, undefined);
  assert.equal(statusDetails({})?.agents, undefined);
  assert.equal(statusDetails(null), undefined);
  assert.equal(statusDetails({ trusted: 'true', collaboration: 'future', versionSource: 'future' })?.trusted, undefined);
});

test('Status details reject executable endpoints, bound paths and redact credential-like values', () => {
  for (const endpoint of ['file:///secret', 'javascript:alert(1)', 'https://example.com/api_key/secret', 'invalid'])
    assert.ok(!statusDetails({ endpoint })?.endpoint || statusDetails({ endpoint })?.endpoint === '[redacted]');
  const result = statusDetails({ agents: ['D:/AGENTS.md', 'D:/AGENTS.md', null, { content: 'hidden' }],
    version: '\u001b[31msecret=hello', endpoint: 'https://example.com/sk-1234567890/v1' })!;
  assert.deepEqual(result.agents, ['D:/AGENTS.md']);
  assert.equal(result.version, '[redacted]');
  assert.ok(!result.endpoint?.includes('1234567890'));
  const bounded = statusDetails({ agents: Array.from({ length: 200 }, (_, i) => `${i}/${'x'.repeat(5000)}`) })!;
  assert.equal(bounded.agents?.length, 128);
  assert.equal(bounded.agentsTruncated, true);
  assert.ok(bounded.agents!.every(path => path.length <= 4096));
});

test('Runtime identity only accepts a real pin and Node version, never invents a release label', () => {
  const commit = 'b5dbed938d9ae589397cf522dcf2ff89ecf4c494';
  assert.deepEqual(statusBuild({ commit, node: 'v24.16.0', key: 'hidden' }), { commit, node: 'v24.16.0' });
  assert.deepEqual(statusBuild({ commit: 'v0.1.5', node: 'secret' }), { commit: undefined, node: undefined });
  const result = sessionSummary({ sessionId: 'a', status: { trusted: true, agents: ['AGENTS.md'], access: 'hidden' } }, 'a');
  assert.equal(result.status?.trusted, true);
  assert.equal(JSON.stringify(result).includes('hidden'), false);
});
