import test from 'node:test';
import assert from 'node:assert/strict';
import { currentPlatform, platformPathKey } from '../src/platform-path';

test('shared Windows workspace keys preserve case-insensitive slash normalization', () => {
  assert.equal(platformPathKey('C:\\Project\\', 'win32'), platformPathKey('c:/project', 'win32'));
});

test('shared Linux workspace keys keep differently-cased names and backslashes distinct', () => {
  assert.notEqual(platformPathKey('/Project', 'linux'), platformPathKey('/project', 'linux'));
  assert.notEqual(platformPathKey('/project\\file', 'linux'), platformPathKey('/project/file', 'linux'));
  assert.equal(platformPathKey('/project/', 'linux'), platformPathKey('/project', 'linux'));
});

test('unknown renderer platforms do not merge distinct paths', () => {
  assert.notEqual(platformPathKey('/Project', 'unknown'), platformPathKey('/project', 'unknown'));
});

test('platform defaults use Node only outside the renderer', () => {
  assert.equal(currentPlatform(), process.platform);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop: { platform: 'win32' } } });
    assert.equal(currentPlatform(), 'win32');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    assert.equal(currentPlatform(), 'unknown', 'a renderer without a bridge never guesses from a Node global');
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
