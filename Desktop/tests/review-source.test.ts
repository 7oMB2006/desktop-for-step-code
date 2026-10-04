import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lastCompletedResponse, redactDiffText, sensitiveDiffPath } from '../src/review-source';
import type { Message } from '../src/contracts';

const messages: Message[] = [
  { role: 'user', content: 'First', timestamp: 100 },
  { role: 'assistant', content: 'Done' },
  { role: 'user', content: 'Second', timestamp: 200 },
  { role: 'assistant', content: 'Working' },
];
test('last-turn review excludes the active response and preserves the exact preceding turn', () => {
  assert.equal(lastCompletedResponse(messages, true)?.items[0].message.content, 'Done');
  assert.equal(lastCompletedResponse(messages, true)?.number, 1);
  assert.equal(lastCompletedResponse(messages, true)?.timestamp, 100);
  assert.equal(lastCompletedResponse(messages, false)?.number, 2);
  assert.equal(lastCompletedResponse(messages, false)?.timestamp, 200);
  assert.equal(lastCompletedResponse(messages.slice(0, 2), true), undefined);
});
test('cloud credential assignments redact snake-case and camel-case names in added and removed lines', () => {
  const names = ['AWS_SECRET_ACCESS_KEY', 'awsSecretAccessKey', 'AWS_ACCESS_KEY_ID', 'awsAccessKeyId',
    'AWS_SESSION_TOKEN', 'awsSessionToken', 'AZURE_CLIENT_SECRET', 'azureClientSecret',
    'AZURE_STORAGE_ACCOUNT_KEY', 'azureStorageAccountKey', 'GOOGLE_API_KEY', 'googleApiKey'];
  for (const name of names) {
    for (const text of [`+${name}=fixture-cloud-value`, `-const ${name} = 'fixture-cloud-value';`,
      `"${name}": "fixture-cloud-value",`]) {
      const result = redactDiffText(text);
      assert.ok(!result.includes('fixture-cloud-value'), text);
      assert.ok(result.includes(name) && result.includes('[redacted]'));
    }
  }
  for (const text of ['const secretCount = 3;', 'const accessKeyLabel = "visible";', 'const key = "visible";',
    `const ${'a'.repeat(12000)} = "visible";`])
    assert.equal(redactDiffText(text), text);
});
test('a pending user turn does not discard the last completed response', () => {
  assert.equal(lastCompletedResponse(messages.slice(0, 3), true)?.number, 1);
  assert.equal(lastCompletedResponse([], false), undefined);
  assert.equal(lastCompletedResponse([{ role: 'user', content: 'Only question' }], false), undefined);
});
test('diff previews hide known credential files and recognizable inline values', () => {
  assert.equal(sensitiveDiffPath('config/.env.local'), true);
  assert.equal(sensitiveDiffPath('auth.json'), true);
  assert.equal(sensitiveDiffPath('src/auth.ts'), false);
  assert.equal(redactDiffText('const apiKey = "fixture-sensitive-value";'), 'const apiKey = "[redacted]";');
  assert.equal(redactDiffText('Bearer fixture-sensitive-value'), 'Bearer [redacted]');
  assert.equal(redactDiffText('const value = 1;'), 'const value = 1;');
});
