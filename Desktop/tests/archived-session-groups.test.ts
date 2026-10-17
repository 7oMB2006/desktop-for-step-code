import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArchivedSessions } from '../src/ArchivedSessions';
import { normalizedWorkspaceKey } from '../src/workspace-key';

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`archived project grouping and names use ${platform} identity`, () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop: { platform } } });
    try {
      const roots = ['/Work/Foo', '/Work/foo', '/Work/a\\b', '/Work/a/b'];
      const sessions = roots.map((cwd, index) => ({ id: String(index), path: '', cwd, name: `Archived ${index}`,
        firstMessage: '', modified: '2026-10-17T00:00:00Z', messageCount: 1 }));
      const workspaceNames = Object.fromEntries(roots.map((root, index) => [normalizedWorkspaceKey(root, platform), `Project ${index}`]));
      const html = renderToStaticMarkup(React.createElement(ArchivedSessions, { sessions,
        preferences: { language: 'en', theme: 'light', workspaces: roots, workspaceNames }, runtimes: [],
        onOpen: () => {}, onRestore: async () => {}, onDelete: async () => {} }));
      assert.equal((html.match(/class="archive-project"/g) ?? []).length, platform === 'win32' ? 2 : 4);
      for (const name of Object.values(workspaceNames)) assert.ok(html.includes(name), name);
      for (const session of sessions) assert.ok(html.includes(session.name));
    } finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
}
