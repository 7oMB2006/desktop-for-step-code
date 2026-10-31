import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWorkflowCatalog } from '../electron/workflow-catalog';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-workflows-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'project'), desktop = join(root, 'desktop');
  const saved = join(cwd, '.stepcode', 'workflows', 'saved');
  const runs = join(cwd, '.stepcode', 'workflows', 'runs');
  const global = join(desktop, 'workflows', 'saved');
  await Promise.all([saved, runs, global].map(path => mkdir(path, { recursive: true })));
  const run = async (id: string, patch: Record<string, unknown> = {}) => {
    await mkdir(join(runs, id), { recursive: true });
    const path = join(runs, id, 'progress.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, runId: id, name: 'release-check',
      status: 'completed', startedAt: 100, totalAgents: 3, completedAgents: 3, agents: [], ...patch }));
    return path;
  };
  return { root, cwd, desktop, saved, global, runs, run };
}

test('lists project and isolated Desktop definitions without reading or executing scripts', async t => {
  const f = await fixture(t);
  const script = 'throw new Error("must never execute"); // authorization: Bearer hidden';
  await writeFile(join(f.saved, 'release.js'), script);
  await writeFile(join(f.global, 'release.js'), script);
  await writeFile(join(f.global, 'shared.js'), script);
  await writeFile(join(f.saved, 'ignored.json'), '{}');
  const other = join(f.root, 'other');
  await mkdir(join(other, '.stepcode', 'workflows', 'saved'), { recursive: true });
  await writeFile(join(other, '.stepcode', 'workflows', 'saved', 'private.js'), script);
  const path = await f.run('wf_release');
  const before = await readFile(path, 'utf8');
  const result = await readWorkflowCatalog(f.cwd, f.desktop);
  assert.deepEqual(result.saved.map(({ name, scope }) => ({ name, scope })),
    [{ name: 'release', scope: 'project' }, { name: 'shared', scope: 'desktop' }]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.runs[0].status, 'completed');
  assert.equal(result.runs[0].completedAgents, 3);
  assert.equal(JSON.stringify(result).includes('hidden'), false);
  assert.equal(JSON.stringify(result).includes(f.root), false, 'No source paths in the renderer payload');
  assert.equal(await readFile(path, 'utf8'), before);
  assert.equal(await readFile(join(f.saved, 'release.js'), 'utf8'), script);
});

test('stale active records stay unconfirmed unless the exact live run identity matches', async t => {
  const f = await fixture(t);
  await f.run('wf_running', { status: 'running', completedAgents: 1 });
  await f.run('wf_stopping', { status: 'stopping', completedAgents: 1 });
  const stale = await readWorkflowCatalog(f.cwd, f.desktop);
  assert.ok(stale.runs.every(run => run.status === 'unknown' && run.recordedStatus));
  const wrong = await readWorkflowCatalog(f.cwd, f.desktop, [{ runId: 'wf_running', startedAt: 101 }]);
  assert.equal(wrong.runs.find(run => run.runId === 'wf_running')?.status, 'unknown');
  const live = await readWorkflowCatalog(f.cwd, f.desktop, [{ runId: 'wf_running', startedAt: 100 }]);
  assert.equal(live.runs.find(run => run.runId === 'wf_running')?.status, 'running');
  assert.equal(live.runs.find(run => run.runId === 'wf_stopping')?.status, 'unknown');
});

test('unknown schema, corrupt, oversized and missing progress retain unknown rows', async t => {
  const f = await fixture(t);
  await f.run('wf_future', { schemaVersion: 2 });
  await f.run('wf_mismatch', { runId: 'wf_other' });
  await writeFile(await f.run('wf_corrupt'), '{');
  await writeFile(await f.run('wf_large'), ' '.repeat(1024 * 1024 + 1));
  await mkdir(join(f.runs, 'wf_missing'));
  await mkdir(join(f.runs, 'not-a-run'));
  const result = await readWorkflowCatalog(f.cwd, f.desktop);
  assert.equal(result.runs.length, 5);
  assert.ok(result.runs.every(run => run.status === 'unknown'));
  assert.ok(result.issues.some(issue => issue.reason === 'unsupported'));
  assert.ok(result.issues.some(issue => issue.reason === 'invalid'));
});

test('projects with no workflow storage return empty without creating directories', async t => {
  const f = await fixture(t);
  await rm(join(f.cwd, '.stepcode'), { recursive: true });
  await rm(f.desktop, { recursive: true });
  assert.deepEqual(await readWorkflowCatalog(f.cwd, f.desktop), { saved: [], runs: [], issues: [] });
  await assert.rejects(readFile(join(f.cwd, '.stepcode', 'workflows', 'runs', 'progress.json')));
});

test('directory junctions cannot escape the project or Desktop storage roots', async t => {
  const f = await fixture(t);
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'private.js'), 'secret');
  await rm(f.saved, { recursive: true });
  await symlink(outside, f.saved, process.platform === 'win32' ? 'junction' : 'dir');
  await rm(f.global, { recursive: true });
  await symlink(outside, f.global, process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, join(f.runs, 'wf_escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await readWorkflowCatalog(f.cwd, f.desktop);
  assert.deepEqual(result.saved, []);
  assert.deepEqual(result.runs, []);
  assert.deepEqual(result.issues, [
    { section: 'project', reason: 'unavailable' }, { section: 'desktop', reason: 'unavailable' },
  ]);
});

test('a missing project is unavailable, not a successful empty catalog', async t => {
  const f = await fixture(t);
  await rm(f.cwd, { recursive: true });
  const result = await readWorkflowCatalog(f.cwd, f.desktop);
  assert.ok(result.issues.some(issue => issue.section === 'project' && issue.reason === 'unavailable'));
  assert.ok(result.issues.some(issue => issue.section === 'runs' && issue.reason === 'unavailable'));
});

test('bounds catalogs, selects newest run directories and redacts untrusted labels', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 105; i++) await writeFile(join(f.saved, `saved-${String(i).padStart(3, '0')}.js`), '');
  await writeFile(join(f.saved, 'api_key=private-key.js'), '');
  for (let i = 0; i < 24; i++) {
    const id = `wf_${i}`;
    await f.run(id, { name: 'authorization: Bearer private-key', totalAgents: 2, completedAgents: 3,
      script: 'secret script', error: 'secret error' });
    await utimes(join(f.runs, id), 1000 + i, 1000 + i);
  }
  const result = await readWorkflowCatalog(f.cwd, f.desktop);
  assert.equal(result.saved.length, 100);
  assert.equal(result.runs.length, 20);
  assert.equal(result.runs[0].runId, 'wf_23');
  assert.ok(result.runs.every(run => run.completedAgents === undefined));
  assert.equal(JSON.stringify(result).includes('private-key'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.ok(result.issues.some(issue => issue.section === 'runs' && issue.reason === 'limited'));
  assert.ok(result.issues.some(issue => issue.section === 'project' && issue.reason === 'limited'));
});

test('preserves every native terminal state and missing counts instead of inventing completion', async t => {
  const f = await fixture(t);
  const states = ['completed', 'partial_failed', 'failed', 'aborted', 'budget_exceeded'];
  for (const state of states) await f.run(`wf_${state}`, { status: state, totalAgents: undefined, completedAgents: undefined });
  const result = await readWorkflowCatalog(f.cwd, f.desktop);
  assert.deepEqual(result.runs.map(run => run.status).sort(), states.sort());
  assert.ok(result.runs.every(run => run.totalAgents === undefined && run.completedAgents === undefined));
});
