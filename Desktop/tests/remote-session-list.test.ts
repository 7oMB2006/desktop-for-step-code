import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteCommand } from '../electron/remote-commands';
import { remoteSessionRefLimit } from '../electron/remote-schema';
import { remoteWorkspaceLimit } from '../src/remote';
import { remoteSessionList, type RemoteListSession } from '../src/remote-session-list';

const projects = [{ ref: 'p1', name: 'Desktop' }, { ref: 'p2', name: 'Docs' }];
test('session listing groups children beneath their granted project without renumbering handles', () => {
  const sessions = [
    { ref: 's1', name: 'Remote', project: 'p1' },
    { ref: 's2', name: 'Reference', project: 'p2' },
    { ref: 's3', name: 'Release', project: 'p1' },
  ];
  const text = remoteSessionList(projects, sessions, 's2');
  assert.match(text, /p1 · Desktop \(2\)\n  ├─ s1 · Remote\n  └─ s3 · Release/);
  assert.match(text, /p2 · Docs \(1\)\n  └─ s2 · Reference ← 当前 \/ Current/);
  assert.match(text, /^会话 \/ Sessions · 3 · 1 \/ 1\n当前 \/ Current: s2 · Reference \(p2 · Docs\)/);
  assert.equal((text.match(/← 当前/g) ?? []).length, 1);
  assert.deepEqual([...text.matchAll(/(?:├─|└─) (s\d+) ·/g)].map(match => match[1]), ['s1', 's3', 's2']);
  assert.match(text, /\/sessions p1/);
  assert.match(text, /\/sessions p2/);
  assert.match(text, /\/session s1  切换会话/);
  assert.match(text, /\/sessions  刷新/);
  assert.deepEqual(sessions.map(session => session.ref), ['s1', 's2', 's3']);
});
test('project headers repeat across pages while every session appears once with a stable handle', () => {
  const sessions: RemoteListSession[] = Array.from({ length: 15 }, (_, index) =>
    ({ ref: `s${index + 1}`, name: `Session ${index + 1}`, project: index < 12 ? 'p1' : 'p2' }));
  const first = remoteSessionList(projects, sessions, 's11');
  const second = remoteSessionList(projects, sessions, 's11', 2);
  assert.match(first, /Sessions · 15 · 1 \/ 2/);
  assert.match(first, /p1 · Desktop \(12\)/);
  assert.doesNotMatch(first, /p2 · Docs/);
  assert.match(first, /\/sessions 2  下一页/);
  assert.match(first, /当前 \/ Current: s11 · Session 11 \(p1 · Desktop\)/);
  assert.doesNotMatch(first, /← 当前/);
  assert.match(second, /p1 · Desktop \(12\)\n  ├─ s11 · Session 11 ← 当前 \/ Current\n  └─ s12 · Session 12/);
  assert.match(second, /p2 · Docs \(3\)/);
  assert.match(second, /\/sessions 1  上一页/);
  assert.match(second, /\/session s11  切换会话/);
  assert.doesNotMatch(second, /\/session s1  /);
  const refs = (first + '\n' + second).matchAll(/(?:├─|└─) (s\d+) ·/g);
  assert.deepEqual([...refs].map(match => match[1]), sessions.map(session => session.ref));
});
test('only explicitly provided projects are listed, including same-named or nested-path projects', () => {
  const text = remoteSessionList([{ ref: 'p1', name: 'Same' }, { ref: 'p2', name: 'Same' }], [
    { ref: 's1', name: 'Parent', project: 'p1' }, { ref: 's2', name: 'Child', project: 'p2' },
    { ref: 's3', name: 'Unauthorized', project: 'p3' },
  ]);
  assert.match(text, /p1 · Same \(1\)/);
  assert.match(text, /p2 · Same \(1\)/);
  assert.doesNotMatch(text, /Unauthorized|p3|s3/);
});
test('empty and out-of-range pages stay explicit without phantom session rows', () => {
  const empty = remoteSessionList(projects, []);
  assert.match(empty, /p1 · Desktop \(0\)\n  暂无会话/);
  assert.match(empty, /\/new p1/);
  assert.match(empty, /当前 \/ Current: 未选择 \/ Not selected/);
  assert.doesNotMatch(empty, /└─|├─|\/session /);
  const missing = remoteSessionList([], []);
  assert.match(missing, /暂无授权项目/);
  assert.doesNotMatch(missing, /└─|├─|\/session |\/new /);
  const text = remoteSessionList(projects, [{ ref: 's1', name: 'Remote', project: 'p1' }], undefined, 3);
  assert.match(text, /此页没有会话/);
  assert.match(text, /\/sessions 1  上一页/);
  assert.doesNotMatch(text, /└─|├─|\/session /);
});
test('mixed empty projects remain discoverable on the first page only', () => {
  const sessions: RemoteListSession[] = Array.from({ length: 12 }, (_, index) =>
    ({ ref: `s${index + 1}`, name: `Session ${index + 1}`, project: 'p1' }));
  const first = remoteSessionList(projects, sessions);
  const second = remoteSessionList(projects, sessions, undefined, 2);
  assert.match(first, /p2 · Docs \(0\)\n  暂无会话 \/ No sessions\n  \/new p2 · \/sessions p2/);
  assert.equal((first.match(/暂无会话 \/ No sessions/g) ?? []).length, 1);
  assert.doesNotMatch(second, /p2 · Docs|暂无会话|\/new p2/);
  assert.match(second, /s11 · Session 11/);
});
test('project-filtered snapshots retain scope in pagination and refresh hints', () => {
  const sessions: RemoteListSession[] = Array.from({ length: 11 }, (_, index) =>
    ({ ref: `s${index + 4}`, name: `Docs ${index + 1}`, project: 'p2' }));
  const first = remoteSessionList([projects[1]], sessions, 's4', 1, 'p2');
  const second = remoteSessionList([projects[1]], sessions, 's4', 2, 'p2');
  assert.match(first, /^会话 \/ Sessions · 11 · 1 \/ 2 · p2/);
  assert.match(first, /\/sessions p2 2  下一页/);
  assert.match(first, /\/sessions p2  刷新/);
  assert.match(second, /^会话 \/ Sessions · 11 · 2 \/ 2 · p2/);
  assert.match(second, /当前 \/ Current: s4 · Docs 1 \(p2 · Docs\)/);
  assert.match(second, /\/session s14  切换会话/);
  assert.match(second, /\/sessions p2 1  上一页/);
  assert.match(second, /\/sessions p2  刷新/);
  assert.doesNotMatch(first + second, /p1 ·|\/sessions [12] |\/session s1  /);
});
test('the current target stays visible outside the filtered snapshot and on empty or invalid pages', () => {
  const sessions = [{ ref: 's9', name: 'Docs task', project: 'p2' }];
  const label = 's3 · Desktop task (p1 · Desktop)';
  const filtered = remoteSessionList([projects[1]], sessions, 's3', 1, 'p2', label);
  assert.match(filtered, /当前 \/ Current: s3 · Desktop task \(p1 · Desktop\)/);
  assert.doesNotMatch(filtered, /← 当前/);
  assert.match(filtered, /\/session s9  切换会话/);
  const outOfRange = remoteSessionList([projects[1]], sessions, 's3', 4, 'p2', label);
  assert.match(outOfRange, /当前 \/ Current: s3 · Desktop task/);
  assert.match(outOfRange, /此页没有会话/);
  assert.match(outOfRange, /\/sessions p2 1  上一页/);
  assert.match(outOfRange, /\/sessions p2  刷新/);
  assert.doesNotMatch(outOfRange, /└─|├─|\/session /);
  const empty = remoteSessionList([projects[1]], [], 's3', 1, 'p2', label);
  assert.match(empty, /当前 \/ Current: s3 · Desktop task/);
  assert.match(empty, /\/new p2/);
  assert.doesNotMatch(empty, /└─|├─|\/session /);
  const emptyPage = remoteSessionList([projects[1]], [], 's3', 2, 'p2', label);
  assert.match(emptyPage, /此页没有会话/);
  assert.doesNotMatch(emptyPage, /暂无会话|\/new p2|└─|├─|\/session /);
  assert.match(remoteSessionList([], [], 's99'), /当前 \/ Current: s99/);
});
test('switch hints use the first syntactically valid visible session handle', () => {
  const text = remoteSessionList([projects[0]], [
    { ref: 'not-a-handle', name: 'Legacy', project: 'p1' },
    { ref: 's7', name: 'Available', project: 'p1' },
  ]);
  assert.match(text, /\/session s7  切换会话/);
  assert.doesNotMatch(text, /\/session not-a-handle/);
  const invalid = remoteSessionList([projects[0]], [{ ref: 's0', name: 'Invalid', project: 'p1' }]);
  assert.doesNotMatch(invalid, /\/session /);
});
test('untrusted labels cannot insert project or session rows and remain bounded literal text', () => {
  const text = remoteSessionList([{ ref: 'p1', name: 'Name\np2 · injected' }], [
    { ref: 's1', name: '\u202eReply\r\ns3 · spoofed' + 'x'.repeat(200), project: 'p1' },
  ]);
  assert.match(text, /p1 · Name p2 · injected/);
  assert.doesNotMatch(text, /\n(?:p2|s3)|\u202e/);
  assert.equal(text.split('\n').filter(line => line.includes('└─')).length, 1);
  assert.ok(text.length < 300);
});
test('external current labels and handles cannot inject lines or executable command hints', () => {
  const text = remoteSessionList([{ ref: 'p1\n/stop', name: 'Unsafe\u2028project' }], [
    { ref: 's4\n/stop', name: 'Unsafe\u2066name', project: 'p1\n/stop' },
  ], 's9', 1, 'p2\n/stop', 's9 · Current\u202e\n/stop' + 'x'.repeat(200));
  assert.match(text, /当前 \/ Current: s9 · Current  \/stop/);
  assert.doesNotMatch(text, /\n\/stop|\u2028|\u202e|\u2066|\/session |\/new /);
  assert.match(text, /p1 \/stop · Unsafe project/);
  assert.match(text, /s4 \/stop · Unsafe name/);
  assert.match(text, /\/sessions  刷新/);
  assert.ok(text.split('\n').find(value => value.startsWith('当前 / Current:'))!.length <= '当前 / Current: '.length + 240);
});
test('generated command hints never carry trailing line separators from supplied handles', () => {
  const text = remoteSessionList([{ ref: 'p2\n', name: 'Docs' }], [
    { ref: 's7\n', name: 'Task', project: 'p2\n' },
  ], undefined, 1, 'P2\n');
  assert.match(text, /^会话 \/ Sessions · 1 · 1 \/ 1\n/);
  assert.match(text, /p2 · Docs \(1\)\n  └─ s7 · Task/);
  assert.match(text, /\/sessions  刷新/);
  assert.doesNotMatch(text, /\/session s7|\/sessions p2/);
});
test('all generated project, switch, pagination and refresh hints match the actual command grammar', () => {
  const sessions: RemoteListSession[] = Array.from({ length: 11 }, (_, index) =>
    ({ ref: `s${index + 1}`, name: `Task ${index + 1}`, project: 'p1' }));
  for (const text of [
    remoteSessionList(projects, sessions),
    remoteSessionList(projects, sessions, undefined, 2),
    remoteSessionList([projects[0]], sessions, undefined, 1, 'P1'),
    remoteSessionList([projects[0]], sessions, undefined, 2, 'p1'),
    remoteSessionList([projects[1]], [], undefined, 1, 'p2'),
  ]) {
    const hints = [...text.matchAll(/\/(?:sessions|session|new)\b(?: [a-z0-9]+)*/g)];
    assert.ok(hints.length > 0);
    for (const [hint] of hints) assert.notEqual(parseRemoteCommand(hint).type, 'invalid', hint);
  }
});
test('long project names retain their distinguishing path suffixes in headings and the current target', () => {
  const name = 'Project'.repeat(14);
  const left = `${name} (workspace/client)`, right = `${name} (workspace/server)`;
  const longProjects = [{ ref: 'p1', name: left }, { ref: 'p2', name: right }];
  const sessions = [{ ref: 's12', name: 'Current task', project: 'p2' }];
  const text = remoteSessionList(longProjects, sessions, 's12');
  assert.ok(text.includes(`p1 · ${left} (0)`));
  assert.ok(text.includes(`p2 · ${right} (1)`));
  assert.ok(text.includes(`当前 / Current: s12 · Current task (p2 · ${right})`));
  const currentLabel = `p2 · ${right} / s1234 · ${'Current task'.repeat(5)}`;
  const filtered = remoteSessionList([longProjects[0]], [], 's1234', 1, 'p1', currentLabel);
  assert.ok(filtered.includes(`当前 / Current: ${currentLabel}`));
  assert.doesNotMatch(filtered, /└─|├─|\/session /);
});
test('project, current and leaf labels have independent bounded sanitized lengths', () => {
  const text = remoteSessionList([{ ref: 'p1', name: 'P'.repeat(500) }], [
    { ref: 's1', name: 'S'.repeat(500), project: 'p1' },
  ], 's1', 1, undefined, 'C'.repeat(500));
  assert.ok(text.includes(`p1 · ${'P'.repeat(140)} (1)\n`));
  assert.ok(text.includes(`当前 / Current: ${'C'.repeat(240)}\n`));
  assert.ok(text.includes(`└─ s1 · ${'S'.repeat(70)} ← 当前 / Current\n`));
  assert.doesNotMatch(text, /P{141}|C{241}|S{71}/);
  const fallback = remoteSessionList([{ ref: 'p1', name: `Project (root/${'p'.repeat(80)})` }], [
    { ref: 's1', name: 'S'.repeat(500), project: 'p1' },
  ], 's1');
  assert.ok(fallback.includes(`当前 / Current: s1 · ${'S'.repeat(70)} (p1 · Project (root/${'p'.repeat(80)}))`));
});
test('maximum legal catalogs fit one card without losing current, rows or navigation', () => {
  const maxProjects = Array.from({ length: remoteWorkspaceLimit }, (_, index) =>
    ({ ref: `p${index + 1}`, name: 'P'.repeat(140) }));
  const sessions: RemoteListSession[] = Array.from({ length: remoteSessionRefLimit }, (_, index) =>
    ({ ref: `s${(index + remoteSessionRefLimit - 10) % remoteSessionRefLimit + 1}`, name: 'S'.repeat(70), project: 'p1' }));
  const current = `s${remoteSessionRefLimit}`;
  const label = `p1 · ${maxProjects[0].name} / ${current} · Current`.padEnd(240, 'C');
  const first = remoteSessionList(maxProjects, sessions, current, 1, undefined, label);
  assert.ok(first.length <= 5000, `first page has ${first.length} characters`);
  assert.ok(first.length > 4900);
  assert.equal(first.split('\n')[0], `会话 / Sessions · ${remoteSessionRefLimit} · 1 / ${Math.ceil(remoteSessionRefLimit / 10)}`);
  assert.equal(first.split('\n')[1], `当前 / Current: ${label}`);
  assert.deepEqual([...first.matchAll(/(?:├─|└─) (s\d+) · (S+)(?: ← 当前 \/ Current)?/g)]
    .map(match => [match[1], match[2]]), sessions.slice(0, 10).map(session => [session.ref, session.name]));
  assert.deepEqual([...first.matchAll(/^(p\d+) · .* \(\d+\)$/gm)].map(match => match[1]), maxProjects.map(project => project.ref));
  assert.equal((first.match(/暂无会话 \/ No sessions/g) ?? []).length, remoteWorkspaceLimit - 1);
  for (const project of maxProjects) {
    assert.ok(first.includes(`/sessions ${project.ref}\n`));
    if (project.ref !== 'p1') assert.ok(first.includes(`/new ${project.ref} · /sessions ${project.ref}`));
  }
  assert.ok(first.includes(`/session ${sessions[0].ref}  切换会话 / Switch session`));
  assert.match(first, /\/sessions 2  下一页 \/ Next page\n\/sessions  刷新 \/ Refresh$/);
  assert.match(first, /← 当前 \/ Current/);

  const second = remoteSessionList(maxProjects, sessions, current, 2, undefined, label);
  assert.ok(second.length <= 5000);
  assert.equal(second.split('\n')[1], `当前 / Current: ${label}`);
  assert.deepEqual([...second.matchAll(/(?:├─|└─) (s\d+) ·/g)].map(match => match[1]), sessions.slice(10, 20).map(session => session.ref));
  assert.ok(second.includes(`/session ${sessions[10].ref}  切换会话 / Switch session`));
  assert.match(second, /\/sessions 3  下一页 \/ Next page\n\/sessions 1  上一页 \/ Previous page\n\/sessions  刷新 \/ Refresh$/);
  assert.doesNotMatch(second, /暂无会话|\/new /);
});
test('budgeted project headings retain distinguishing path suffixes instead of their shared middle', () => {
  const suffixes = Array.from({ length: remoteWorkspaceLimit }, (_, index) =>
    ` · unique-${String(index + 1).padStart(2, '0')}/${'nested/'.repeat(12)}client`);
  const maxProjects = suffixes.map((suffix, index) =>
    ({ ref: `p${index + 1}`, name: 'Shared'.repeat(30).slice(0, 140 - suffix.length) + suffix }));
  const sessions = Array.from({ length: 11 }, (_, index) =>
    ({ ref: `s${index + 1}`, name: 'S'.repeat(70), project: 'p1' }));
  const label = `p20 · ${maxProjects.at(-1)!.name} / s10000 · Current`.padEnd(240, 'C');
  const text = remoteSessionList(maxProjects, sessions, 's10000', 1, undefined, label);
  assert.ok(text.length <= 5000, `first page has ${text.length} characters`);
  assert.equal(text.split('\n')[1], `当前 / Current: ${label}`);
  for (const [index, project] of maxProjects.entries()) {
    const heading = text.split('\n').find(line => line.startsWith(`${project.ref} · `))!;
    assert.ok(heading.includes('…'), heading);
    assert.ok(heading.endsWith(`${suffixes[index]} (${index ? 0 : sessions.length})`), heading);
  }
  assert.equal(new Set([...text.matchAll(/^p\d+ · (.*) \(\d+\)$/gm)].map(match => match[1])).size, remoteWorkspaceLimit);
});
test('maximum empty and filtered lists preserve full labels and scoped command hints when no budgeting is needed', () => {
  const maxProjects = Array.from({ length: remoteWorkspaceLimit }, (_, index) =>
    ({ ref: `p${index + 1}`, name: 'P'.repeat(140) }));
  const label = `s${remoteSessionRefLimit} · Current`.padEnd(240, 'C');
  const empty = remoteSessionList(maxProjects, [], `s${remoteSessionRefLimit}`, 1, undefined, label);
  assert.ok(empty.length <= 5000);
  assert.equal(empty.split('\n')[1], `当前 / Current: ${label}`);
  for (const project of maxProjects) assert.ok(empty.includes(`${project.ref} · ${project.name} (0)`));
  assert.doesNotMatch(empty, /…|└─|├─|\/session /);

  const project = maxProjects.at(-1)!;
  const sessions = Array.from({ length: 21 }, (_, index) =>
    ({ ref: `s${index + 1}`, name: 'S'.repeat(70), project: project.ref }));
  const filtered = remoteSessionList([project], sessions, `s${remoteSessionRefLimit}`, 2, project.ref, label);
  assert.ok(filtered.length <= 5000);
  assert.equal(filtered.split('\n')[1], `当前 / Current: ${label}`);
  assert.ok(filtered.includes(`${project.ref} · ${project.name} (21)`));
  assert.ok(filtered.includes('/session s11  切换会话 / Switch session'));
  assert.ok(filtered.endsWith(`/sessions ${project.ref} 3  下一页 / Next page\n/sessions ${project.ref} 1  上一页 / Previous page\n/sessions ${project.ref}  刷新 / Refresh`));
  assert.doesNotMatch(filtered, /…/);
});
