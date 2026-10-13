import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Run after the real-runtime history assertions: this changes the selected
// project, but never sends a model turn. The only mocked boundary is the native
// directory picker; grouping and all preference writes use the real renderer/IPC.
export async function verifyLinuxWorkspaceIdentity({ app, page, fixture, project, storage, profile }) {
  assert.equal(process.platform, 'linux');
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  const group = path => page.locator(`[data-reorder-kind="workspace"][aria-label=${JSON.stringify(path)}]`);
  const row = id => page.locator(`.session-row[data-reorder-id=${JSON.stringify(id)}]`);
  const waitPreferences = expected => page.waitForFunction(async expected => {
    const { preferences } = await window.desktop.snapshot();
    return Object.entries(expected).every(([key, value]) => JSON.stringify(preferences[key]) === JSON.stringify(value));
  }, expected);
  const rename = async (path, name) => {
    await group(path).locator('.workspace-heading').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename', exact: true });
    await dialog.locator('input').fill(name);
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal((await snapshot()).preferences.workspaceNames[path], name);
    assert.equal(await group(path).locator('.workspace-toggle').getAttribute('aria-label'), name);
  };
  const pin = async (path, pinned) => {
    await group(path).locator('.workspace-heading').click({ button: 'right' });
    await page.getByRole('menuitem', { name: pinned ? 'Pin project' : 'Unpin project', exact: true }).click();
    await page.waitForFunction(async ({ path, pinned }) => {
      const { preferences } = await window.desktop.snapshot();
      return (preferences.pinnedWorkspaces ?? []).includes(path) === pinned;
    }, { path, pinned });
    await page.locator('.pinned-projects').locator(`[aria-label=${JSON.stringify(path)}]`).waitFor({ state: pinned ? 'attached' : 'detached' });
  };

  // A single mixed-case project fails rename/pin too, even without a colliding
  // lowercase directory. Exercise that before adding the case-distinct pair.
  assert.equal(await group(project).count(), 1);
  assert.equal(await group(project).getAttribute('data-reorder-id'), project);
  await rename(project, 'Mixed-case Linux project');
  await pin(project, true);
  await pin(project, false);

  const paths = [join(fixture, 'Foo'), join(fixture, 'foo')];
  const ids = ['linux-workspace-upper', 'linux-workspace-lower'];
  const names = ['Uppercase project', 'Lowercase project'];
  await mkdir(join(storage, 'sessions'), { recursive: true });
  for (const [index, path] of paths.entries()) {
    await mkdir(path);
    const timestamp = new Date().toISOString();
    const records = [
      { type: 'session', version: 3, id: ids[index], cwd: path, timestamp },
      { type: 'message', id: `${ids[index]}-user`, parentId: null, timestamp,
        message: { role: 'user', content: [{ type: 'text', text: `Local workspace fixture ${index}` }], timestamp: Date.parse(timestamp) } },
    ];
    await writeFile(join(storage, 'sessions', `${ids[index]}.jsonl`), records.map(record => JSON.stringify(record)).join('\n') + '\n');
  }
  await app.evaluate(({ dialog }, paths) => {
    globalThis.linuxWorkspaceDirectoryPicker = dialog.showOpenDialog;
    let index = 0;
    dialog.showOpenDialog = async () => {
      if (index >= paths.length) throw new Error('Unexpected workspace directory picker');
      return { canceled: false, filePaths: [paths[index++]] };
    };
  }, paths);
  try {
    for (const path of paths) {
      await page.getByRole('button', { name: 'Add workspace', exact: true }).click();
      await group(path).waitFor();
      await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
    }
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = globalThis.linuxWorkspaceDirectoryPicker;
      delete globalThis.linuxWorkspaceDirectoryPicker;
    });
  }
  // Check the freshly selected draft before preference edits: preference IPC
  // returns persisted settings, while the current draft workspace is projected
  // by snapshot(). This assertion specifically covers case-distinct identity.
  assert.equal(await group(paths[1]).locator('.workspace-heading').evaluate(element => element.classList.contains('current')), true);
  assert.equal(await group(paths[0]).locator('.workspace-heading').evaluate(element => element.classList.contains('current')), false);
  for (const [index, path] of paths.entries()) {
    assert.equal(await group(path).count(), 1, 'Case-distinct workspaces must each render exactly once');
    assert.equal(await group(path).getAttribute('data-reorder-id'), path);
    await group(path).locator(`[data-reorder-id=${JSON.stringify(ids[index])}]`).waitFor();
    assert.equal(await group(path).locator(`[data-reorder-id=${JSON.stringify(ids[1 - index])}]`).count(), 0);
    await rename(path, names[index]);
  }
  await group(paths[0]).locator('.workspace-toggle').click();
  assert.equal(await group(paths[0]).locator('.workspace-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await group(paths[1]).locator('.workspace-toggle').getAttribute('aria-expanded'), 'true');
  await group(paths[0]).locator('.workspace-toggle').click();

  const beforeOrder = (await snapshot()).preferences.workspaces;
  const expectedOrder = beforeOrder.filter(path => path !== paths[1]);
  expectedOrder.splice(expectedOrder.indexOf(paths[0]), 0, paths[1]);
  await group(paths[1]).locator('.workspace-toggle').press('Alt+ArrowUp');
  await waitPreferences({ workspaces: expectedOrder });
  for (const path of paths) await pin(path, true);
  await waitPreferences({ pinnedWorkspaces: paths });
  await pin(paths[0], false);
  await waitPreferences({ pinnedWorkspaces: [paths[1]] });
  assert.equal(await group(paths[0]).count(), 1, 'Unpinning must not lose the other case-distinct project');

  for (const id of ids) {
    await row(id).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Archive session', exact: true }).click();
    await row(id).waitFor({ state: 'detached' });
  }
  await waitPreferences({ archivedSessionIds: ids });
  const saved = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'));
  assert.deepEqual(saved.pinnedWorkspaces, [paths[1]]);
  assert.equal(saved.workspaceNames[project], 'Mixed-case Linux project');
  for (const [index, path] of paths.entries()) assert.equal(saved.workspaceNames[path], names[index]);

  await page.reload();
  await group(paths[0]).waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  assert.equal(await group(paths[0]).locator('.workspace-toggle').getAttribute('aria-label'), names[0]);
  assert.equal(await group(paths[1]).getAttribute('data-reorder-group'), '__pinned__');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  const archive = page.locator('.archived-settings');
  await archive.waitFor();
  assert.equal(await archive.locator('.archive-project').count(), 2);
  assert.deepEqual((await archive.locator('.archive-project h4').allTextContents()).sort(), [...names].sort());
  const filter = archive.getByRole('combobox', { name: 'Filter archived projects', exact: true });
  assert.deepEqual((await filter.locator('option').evaluateAll(options => options.map(option => option.value))).sort(), ['', ...paths].sort());
  for (const [index, path] of paths.entries()) {
    await filter.selectOption(path);
    assert.deepEqual(await archive.locator('[data-archived-session-id]').evaluateAll(rows => rows.map(row => row.dataset.archivedSessionId)), [ids[index]]);
  }
  // Restoring one filtered group must not restore or rename its case sibling.
  await filter.selectOption(paths[0]);
  await archive.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await waitPreferences({ archivedSessionIds: [ids[1]] });
  await filter.selectOption(paths[1]);
  await archive.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await waitPreferences({ archivedSessionIds: [] });
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'detached' });
  for (const [index, path] of paths.entries()) {
    await group(path).locator(`[data-reorder-id=${JSON.stringify(ids[index])}]`).waitFor();
    assert.equal(await group(path).locator(`[data-reorder-id=${JSON.stringify(ids[1 - index])}]`).count(), 0);
  }
  console.log('[linux-acceptance] Mixed-case workspace rename/pin; case-distinct grouping, current state, collapse, reorder, archives/filter/restore and reload persistence passed');
}
