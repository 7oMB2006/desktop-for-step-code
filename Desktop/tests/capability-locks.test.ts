import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityNeedsIdle } from '../src/capability-locks';
import type { CapabilityCatalog } from '../src/capabilities';

function catalog(theme = true): CapabilityCatalog {
  return {
    plugins: [{ id: 'theme', name: 'Theme', mcpServers: [], warnings: [],
      package: { ref: 'old', provenance: 'recorded', dataOnlyTheme: theme, documentation: {}, tutorials: [], links: [], warnings: [] },
      update: { status: 'available', ref: 'new', version: '1.1.0' } }],
    available: [{ name: 'theme', marketplace: 'fixture', installed: false,
      package: { ref: 'new', provenance: 'recorded', dataOnlyTheme: theme, documentation: {}, tutorials: [], links: [], warnings: [] } }],
    marketplaces: [], mcp: [], skills: [], warnings: [],
  };
}

test('discovery affordances remain available during a live session without claiming executable plugins are safe', () => {
  for (const action of ['marketplace-add', 'marketplace-remove', 'marketplace-update', 'plugin-check-updates'])
    assert.equal(capabilityNeedsIdle({ action } as any), false);
  for (const input of [
    { action: 'plugin-install', name: 'theme', marketplace: 'fixture', ref: 'new' },
    { action: 'plugin-remove', id: 'theme' },
    { action: 'plugin-update', id: 'theme', ref: 'old', candidate: 'new' },
  ] as const) {
    assert.equal(capabilityNeedsIdle(input, catalog()), false);
    assert.equal(capabilityNeedsIdle(input, catalog(false)), true);
    assert.equal(capabilityNeedsIdle(input), true);
  }
});

test('theme affordances require matching issued references and both sides of an update', () => {
  assert.equal(capabilityNeedsIdle({ action: 'plugin-install', name: 'theme', marketplace: 'other', ref: 'new' }, catalog()), true);
  assert.equal(capabilityNeedsIdle({ action: 'plugin-install', name: 'theme', marketplace: 'fixture' }, catalog()), true);
  const value = catalog();
  value.available[0].package!.dataOnlyTheme = false;
  assert.equal(capabilityNeedsIdle({ action: 'plugin-update', id: 'theme', ref: 'old', candidate: 'new' }, value), true);
  assert.equal(capabilityNeedsIdle({ action: 'plugin-update', id: 'theme', ref: 'forged', candidate: 'new' }, catalog()), true);
  assert.equal(capabilityNeedsIdle({ action: 'plugin-toggle', id: 'theme', enabled: true }, catalog()), true);
  assert.equal(capabilityNeedsIdle({ action: 'mcp-toggle', name: 'theme__tools', enabled: true }, catalog()), true);
});
