import test from 'node:test';
import assert from 'node:assert/strict';
import { appShortcut, shortcutLabel } from '../src/app-shortcuts';

const base = { key: 'b', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
  repeat: false, isComposing: false, keyCode: 66, defaultPrevented: false };
test('application shortcuts use exact Windows and macOS modifiers', () => {
  for (const [key, action] of [['b', 'sidebar'], ['N', 'new-session'], ['o', 'open-project'], [',', 'settings'], ['j', 'terminal']]) {
    assert.equal(appShortcut({ ...base, key }, 'win32'), action);
    assert.equal(appShortcut({ ...base, key, ctrlKey: false, metaKey: true }, 'darwin'), action);
  }
  assert.equal(appShortcut({ ...base, key: 'f', shiftKey: true }), 'search');
  assert.equal(appShortcut({ ...base, key: 'f' }), undefined);
  for (const patch of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { altKey: true },
    { defaultPrevented: true }, { shiftKey: true }, { metaKey: true }, { ctrlKey: false }])
    assert.equal(appShortcut({ ...base, ...patch }, 'win32'), undefined);
  assert.equal(appShortcut(base, 'darwin'), undefined);
  assert.equal(shortcutLabel('search', 'win32'), 'Ctrl+Shift+F');
  assert.equal(shortcutLabel('sidebar', 'darwin'), 'Cmd+B');
});
