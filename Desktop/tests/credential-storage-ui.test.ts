import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { build } from 'esbuild';
import { credentialStorageText, loginStorageReady, type CredentialStorageState } from '../src/credential-storage';
import type { Settings } from '../src/contracts';

// Render the real account component; only its stylesheet is irrelevant to DOM
// policy checks. Keep React external so the renderer and component share it.
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/AccountSettings.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
  loader: { '.css': 'empty' }, write: false });
const module = { exports: {} as { AccountSettings: typeof import('../src/AccountSettings').AccountSettings } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { AccountSettings } = module.exports;
const settings: Settings = { account: { loggedIn: false, validity: 'unknown' },
  profiles: [{ id: 'step_plan', title: 'Step Plan', description: '', credentialSource: 'browser' },
    { id: 'platform_cn', title: 'API Key', description: '', credentialSource: 'apiKey' }], mcp: {}, skills: [] };

function account(platform: string, state: CredentialStorageState, language = 'en', extra: Partial<Parameters<typeof AccountSettings>[0]> = {}) {
  return parseHTML(renderToStaticMarkup(createElement(AccountSettings, { settings, platform, storageState: state, language,
    profile: 'step_plan', apiKey: '', loggingIn: false, busy: false,
    onProfile() {}, onKey() {}, onLogin() {}, onCancel() {}, onLogout() {}, onCheckStorage() {}, ...extra }))).document;
}

test('Linux sign-in stays disabled until the explicit storage check reports ready', () => {
  for (const state of ['unchecked', 'checking', 'unavailable', 'ready'] as const) {
    const document = account('linux', state);
    assert.equal(document.querySelector('.primary')!.hasAttribute('disabled'), state !== 'ready');
    assert.equal(loginStorageReady('linux', state), state === 'ready');
    assert.equal(document.querySelector('.credential-storage button')!.hasAttribute('disabled'), state === 'checking');
  }
});

test('Chinese and English account guidance reports missing storage without starting a check during rendering', () => {
  for (const language of ['zh', 'en']) {
    let checks = 0, logins = 0;
    const document = account('linux', 'unavailable', language, { onCheckStorage() { checks++; }, onLogin() { logins++; } });
    const text = credentialStorageText(language);
    assert.equal(document.querySelector('[role="status"]')!.textContent, text.unavailable);
    assert.equal(document.querySelector('.credential-storage strong')!.textContent, text.title);
    assert.equal(document.querySelector('.credential-storage button')!.textContent, text.retry);
    assert.match(document.querySelector('.credential-storage-guidance')!.textContent!, /GNOME Keyring.*KWallet/);
    assert.equal(checks, 0); assert.equal(logins, 0);
  }
  assert.doesNotMatch(account('linux', 'unavailable', 'zh').querySelector('[role="status"]')!.textContent!, /Secure credential storage/);
});

test('pending system-keyring prompt is visible and cannot be repeatedly checked or used for login', () => {
  for (const language of ['zh', 'en']) {
    const document = account('linux', 'checking', language);
    assert.equal(document.querySelector('[role="status"]')!.textContent, credentialStorageText(language).checking);
    assert.equal(document.querySelector('[role="status"]')!.getAttribute('aria-live'), 'polite');
    assert.ok(document.querySelector('.credential-storage button')!.hasAttribute('disabled'));
    assert.ok(document.querySelector('.primary')!.hasAttribute('disabled'));
  }
});

test('ready storage preserves existing busy, OAuth-in-progress and API-key requirements', () => {
  for (const extra of [{ busy: true }, { loggingIn: true }, { profile: 'platform_cn', apiKey: '' }]) {
    assert.ok(account('linux', 'ready', 'en', extra).querySelector('.primary')!.hasAttribute('disabled'));
  }
  assert.equal(account('linux', 'ready', 'en', { profile: 'platform_cn', apiKey: 'fixture-only-key' })
    .querySelector('.primary')!.hasAttribute('disabled'), false);
  assert.equal(account('linux', 'ready').querySelector('[role="status"]')!.textContent, credentialStorageText('en').ready);
});

test('Windows account presentation and login availability do not require a Linux readiness check', () => {
  for (const state of ['unchecked', 'checking', 'unavailable', 'ready'] as const) {
    const document = account('win32', state);
    assert.equal(document.querySelector('.credential-storage'), null);
    assert.equal(document.querySelector('.primary')!.hasAttribute('disabled'), false);
    assert.equal(loginStorageReady('win32', state), true);
  }
});
