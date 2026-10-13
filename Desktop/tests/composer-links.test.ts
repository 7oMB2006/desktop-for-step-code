import test from 'node:test';
import assert from 'node:assert/strict';
import { composerLinks } from '../src/composer-links';

test('composer links use Markdown semantics without changing the original draft', () => {
  const draft = '看看 https://example.com/guide 和 [阶跃平台](https://platform.stepfun.com/)。';
  assert.deepEqual(composerLinks(draft), [
    { href: 'https://example.com/guide', label: 'example.com/guide' },
    { href: 'https://platform.stepfun.com/', label: '阶跃平台' },
  ]);
  assert.equal(draft, '看看 https://example.com/guide 和 [阶跃平台](https://platform.stepfun.com/)。');
});
test('code samples, images, mail, unsafe schemes, credentials and incomplete addresses are not references', () => {
  const draft = '`https://example.com/code`\n\n```text\nhttps://example.com/fenced\n```\n\n'
    + '![image](https://example.com/image.png) [mail](mailto:test@example.com) [local](file:///C:/a.md) '
    + '[unsafe](javascript:alert(1)) [secret](https://user:password@example.com/) https://';
  assert.deepEqual(composerLinks(draft), []);
});
test('reference links resolve definitions and repeated addresses remain one reference', () => {
  assert.deepEqual(composerLinks('[**文档**][docs] https://example.com/\n\n[docs]: https://example.com/'), [
    { href: 'https://example.com/', label: '文档' },
  ]);
  assert.deepEqual(composerLinks('普通文字 mail@example.com /clm'), []);
});
test('composer reference work is bounded without rewriting the sendable draft', () => {
  assert.equal(composerLinks('x'.repeat(64001) + ' https://example.com/').length, 0);
  assert.equal(composerLinks(Array.from({ length: 50 }, (_, index) => `https://example.com/${index}`).join(' ')).length, 32);
});
