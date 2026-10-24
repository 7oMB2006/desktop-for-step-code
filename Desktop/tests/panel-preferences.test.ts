import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePanelPreferences, panelPreferencePatch, terminalHeightBounds } from '../src/panel-preferences';

test('panel preferences preserve the existing layout by default and normalize saved values', () => {
  assert.deepEqual(normalizePanelPreferences({}), { terminalDock: 'right', terminalHeight: 280, diffLayout: 'unified' });
  assert.deepEqual(normalizePanelPreferences({ terminalDock: 'bottom', terminalHeight: 320.6, diffLayout: 'split' }),
    { terminalDock: 'bottom', terminalHeight: 321, diffLayout: 'split' });
  assert.equal(normalizePanelPreferences({ terminalHeight: NaN }).terminalHeight, 280);
  assert.equal(normalizePanelPreferences({ terminalHeight: 1200 }).terminalHeight, 600);
  assert.equal(normalizePanelPreferences({ terminalHeight: 50 }).terminalHeight, 140);
});

test('panel preference patches are allowlisted and reject invalid values before mutation', () => {
  assert.deepEqual(panelPreferencePatch({ terminalDock: 'bottom', terminalHeight: 300.4, diffLayout: 'split', other: true }),
    { terminalDock: 'bottom', terminalHeight: 300, diffLayout: 'split' });
  assert.deepEqual(panelPreferencePatch({}), {});
  for (const terminalDock of ['left', null, {}, 1]) assert.throws(() => panelPreferencePatch({ terminalDock }), /Invalid terminal dock/);
  for (const diffLayout of ['vertical', null, [], false]) assert.throws(() => panelPreferencePatch({ diffLayout }), /Invalid diff layout/);
  for (const terminalHeight of [null, '280', 139, 601, Infinity, NaN])
    assert.throws(() => panelPreferencePatch({ terminalHeight }), /Invalid terminal height/);
  const saved = { terminalDock: 'right' };
  assert.throws(() => Object.assign(saved, panelPreferencePatch({ terminalDock: 'bottom', diffLayout: 'bad' })));
  assert.equal(saved.terminalDock, 'right');
});

test('bottom terminal bounds reserve space for the composer and conversation on short windows', () => {
  assert.deepEqual(terminalHeightBounds(850, 150), { min: 140, max: 600 });
  assert.deepEqual(terminalHeightBounds(500, 170), { min: 140, max: 230 });
  assert.deepEqual(terminalHeightBounds(300, 160), { min: 80, max: 80 });
});
