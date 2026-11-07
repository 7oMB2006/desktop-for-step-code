import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { StellarTaskRoute } from '../src/StellarTaskRoute';
import type { SummaryTask } from '../src/contracts';

const tasks: SummaryTask[] = ['completed', 'in_progress', 'pending', 'failed'].map((status, i) => ({
  id: String(i), subject: `Task <${i}>`, description: '', status: status as SummaryTask['status'],
}));
const render = (items: SummaryTask[], language: 'zh' | 'en' = 'en') =>
  renderToStaticMarkup(createElement(StellarTaskRoute, { tasks: items, language, onReveal: () => {} }));

test('route anchors preserve task states and escaped names without guessing completion', () => {
  const html = render(tasks);
  const { document } = parseHTML(html);
  const anchors = [...document.querySelectorAll('button')];
  assert.equal(anchors.length, 4);
  assert.deepEqual(anchors.map(a => a.getAttribute('data-status')), tasks.map(t => t.status));
  assert.deepEqual(anchors.map(a => a.getAttribute('aria-label')), [
    'Locate task: Task <0> · Completed', 'Locate task: Task <1> · In progress',
    'Locate task: Task <2> · Pending', 'Locate task: Task <3> · Failed',
  ]);
  assert.equal(document.querySelectorAll('button[data-status=completed]').length, 1);
  assert.equal(document.querySelectorAll('button svg[aria-hidden=true]').length, 6);
  assert.ok(!html.includes('Task <0>'));
});

test('empty and large plans do not invent a route or shrink its hit targets', () => {
  assert.equal(render([]), '');
  assert.equal(render(Array.from({ length: 9 }, (_, i) => ({ ...tasks[0], id: String(i) }))), '');
  const { document } = parseHTML(render([tasks[0]], 'zh'));
  assert.match(document.querySelector('button')!.getAttribute('aria-label')!, /定位任务.*已完成/);
  assert.match(document.querySelector('button')!.getAttribute('style')!, /50%/);
});
