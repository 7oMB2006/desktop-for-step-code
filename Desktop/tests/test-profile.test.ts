import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { residueTestSafetyIssues } from '../scripts/residue-test-safety.mjs';

const helperUrl = new URL('../scripts/test-profile.mjs', import.meta.url).href;

function fixture(run: (parent: string) => void) {
  const parent = mkdtempSync(join(tmpdir(), 'desktop-profile-unit-'));
  try { run(parent); }
  finally { rmSync(parent, { recursive: true, force: true }); }
}

function runChild(parent: string, { keep = false, ending = '', beforeImport = '', status = 0 } = {}) {
  const script = [
    beforeImport,
    `const { mkdtemp, removeTestProfile } = await import(${JSON.stringify(helperUrl)});`,
    `const profile = await mkdtemp(${JSON.stringify(join(parent, 'profile-'))});`,
    'console.log(JSON.stringify({ profile }));',
    ending,
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
    env: { ...process.env, DESKTOP_KEEP_TEST_PROFILES: keep ? '1' : '0' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, status, result.stderr);
  const profiles = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line).profile as string);
  return { profile: profiles[0], profiles, stderr: result.stderr };
}

test('normal exit removes only the exact registered profile', () => fixture(parent => {
  const unrelated = join(parent, 'profile-existing.txt');
  writeFileSync(unrelated, 'preserve unrelated data');
  const { profile } = runChild(parent);
  assert.throws(() => statSync(profile), { code: 'ENOENT' });
  assert.equal(readFileSync(unrelated, 'utf8'), 'preserve unrelated data');
}));

test('explicit cleanup removes the profile before runner exit', () => fixture(parent => {
  const { profile } = runChild(parent, { ending: [
    'await removeTestProfile(profile);',
    "const { existsSync } = await import('node:fs');",
    'if (existsSync(profile)) process.exit(3);',
  ].join('\n') });
  assert.throws(() => statSync(profile), { code: 'ENOENT' });
}));

test('runner exit removes scratch without deleting sibling verification evidence', () => fixture(parent => {
  const report = join(parent, 'evidence', 'verification.json');
  const { profile } = runChild(parent, { ending: [
    "const fs = await import('node:fs/promises');",
    `await fs.mkdir(${JSON.stringify(join(parent, 'evidence'))});`,
    `await fs.writeFile(${JSON.stringify(report)}, JSON.stringify({ scratch: profile, passed: true }));`,
    "await fs.writeFile(profile + '/main.cjs', 'disposable fixture harness');",
    "await fs.mkdir(profile + '/userData');",
  ].join('\n') });
  assert.throws(() => statSync(profile), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')), { scratch: profile, passed: true });
}));

test('retention applies to explicit cleanup and reports each exact path once', () => fixture(parent => {
  const { profile, stderr } = runChild(parent, {
    keep: true, ending: 'await removeTestProfile(profile); await removeTestProfile(profile);',
  });
  assert.equal(statSync(profile).isDirectory(), true);
  assert.equal(stderr.split(`Retained test profile: ${realpathSync(profile)}\n`).length - 1, 1);
}));

test('unregistered paths are refused without touching their contents', () => fixture(parent => {
  const unrelated = join(parent, 'existing.txt');
  writeFileSync(unrelated, 'preserve');
  runChild(parent, { ending: [
    "const assert = (await import('node:assert/strict')).default;",
    `await assert.rejects(removeTestProfile(${JSON.stringify(unrelated)}), /Unregistered test profile/);`,
  ].join('\n') });
  assert.equal(readFileSync(unrelated, 'utf8'), 'preserve');
}));

for (const ending of ['process.exit(1);', "throw new Error('fixture failure');"]) {
  test(`failure cleanup: ${ending}`, () => fixture(parent => {
    const { profile } = runChild(parent, { ending, status: 1 });
    assert.throws(() => statSync(profile), { code: 'ENOENT' });
  }));
}

for (const keep of [false, true]) {
  test(`profiles added during beforeExit honor retention=${keep}`, () => fixture(parent => {
    const { profiles, stderr } = runChild(parent, { keep, ending: [
      "process.once('beforeExit', async () => {",
      `const late = await mkdtemp(${JSON.stringify(join(parent, 'late-'))});`,
      'console.log(JSON.stringify({ profile: late }));',
      '});',
    ].join('\n') });
    assert.equal(profiles.length, 2);
    for (const profile of profiles) {
      if (keep) {
        assert.equal(statSync(profile).isDirectory(), true);
        assert.equal(stderr.split(`Retained test profile: ${realpathSync(profile)}\n`).length - 1, 1);
      } else assert.throws(() => statSync(profile), { code: 'ENOENT' });
    }
  }));
}

test('cleanup failure reports the exact path, fails and does not loop forever', () => fixture(parent => {
  const { profile, stderr } = runChild(parent, { status: 1, beforeImport: [
    "const fs = (await import('node:fs/promises')).default;",
    "const { syncBuiltinESMExports } = await import('node:module');",
    "fs.rm = async () => { throw new Error('synthetic locked profile'); };",
    'syncBuiltinESMExports();',
  ].join('\n') });
  assert.equal(statSync(profile).isDirectory(), true);
  assert.ok(stderr.includes(`Failed to remove test profile ${realpathSync(profile)}: synthetic locked profile\n`));
}));

test('aliased parents preserve requested paths but report each canonical path exactly once', () => fixture(parent => {
  const physical = join(parent, 'physical');
  const alias = join(parent, 'alias');
  mkdirSync(physical);
  symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const retained = runChild(alias, {
    keep: true, ending: 'await removeTestProfile(profile); await removeTestProfile(profile);',
  });
  assert.equal(retained.profile.startsWith(join(alias, 'profile-')), true);
  const canonical = realpathSync(retained.profile);
  assert.notEqual(retained.profile, canonical);
  assert.equal(retained.stderr, `Retained test profile: ${canonical}\n`);
  const failed = runChild(alias, { status: 1, beforeImport: [
    "const fs = (await import('node:fs/promises')).default;",
    "const { syncBuiltinESMExports } = await import('node:module');",
    "fs.rm = async () => { throw new Error('synthetic locked profile'); };",
    'syncBuiltinESMExports();',
  ].join('\n') });
  assert.equal(failed.profile.startsWith(join(alias, 'profile-')), true);
  assert.equal(failed.stderr, `Failed to remove test profile ${realpathSync(failed.profile)}: synthetic locked profile\n`);
  const cleaned = runChild(alias);
  assert.throws(() => statSync(cleaned.profile), { code: 'ENOENT' });
  assert.equal(statSync(retained.profile).isDirectory(), true);
  assert.equal(statSync(failed.profile).isDirectory(), true);
}));

test('cleanup does not follow a junction or symlink out of its registered profile', () => fixture(parent => {
  const external = join(parent, 'outside');
  runChild(parent, { ending: [
    "const fs = await import('node:fs/promises');",
    `await fs.mkdir(${JSON.stringify(external)});`,
    `await fs.writeFile(${JSON.stringify(join(external, 'keep.txt'))}, 'preserve');`,
    `await fs.symlink(${JSON.stringify(external)}, profile + '/link', process.platform === 'win32' ? 'junction' : 'dir');`,
  ].join('\n') });
  assert.equal(readFileSync(join(external, 'keep.txt'), 'utf8'), 'preserve');
}));

test('canonical paths remain registered when created under a symlinked parent', () => fixture(parent => {
  runChild(parent, { ending: [
    "const fs = await import('node:fs/promises');",
    `const alias = ${JSON.stringify(join(parent, 'alias'))};`,
    "await fs.symlink(profile, alias, process.platform === 'win32' ? 'junction' : 'dir');",
    "const nested = await mkdtemp(alias + '/child-');",
    "if (!nested.startsWith(alias)) throw new Error('mkdtemp must preserve the requested prefix');",
    'await removeTestProfile(await fs.realpath(nested));',
  ].join('\n') });
}));

test('acceptance scripts use the shared creator and do not bypass registered root cleanup', () => {
  const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
  for (const name of readdirSync(scripts).filter(name => name.endsWith('.mjs'))) {
    if (['test-profile.mjs', 'package-macos.mjs'].includes(name)) continue;
    const source = readFileSync(join(scripts, name), 'utf8');
    const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imported = new Map<string, string>();
    const roots = new Set<string>();
    const removalArguments: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            const original = binding.propertyName?.text ?? binding.name.text;
            imported.set(binding.name.text, `${node.moduleSpecifier.text}:${original}`);
            assert.ok(!['node:fs/promises:mkdtemp', 'node:fs:mkdtemp', 'node:fs:mkdtempSync'].includes(imported.get(binding.name.text)!),
              `${name} must use test-profile.mjs`);
          }
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && /\bmkdtemp\(/.test(node.initializer.getText(tree))) roots.add(node.name.text);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && ['node:fs/promises:rm', 'node:fs:rmSync'].includes(imported.get(node.expression.text) ?? '')
        && node.arguments[0] && ts.isIdentifier(node.arguments[0])) removalArguments.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const argument of removalArguments) assert.ok(!roots.has(argument), `${name} bypasses retention for ${argument}`);
  }
});

test('packaged queue demo includes its shared lifecycle helper', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.extraResources.some((entry: { from: string; to: string }) =>
    entry.from === 'scripts/test-profile.mjs' && entry.to === 'queue-demo/test-profile.mjs'));
});

test('residue safety fails closed on existing, unknown or redirected user state', () => {
  const issues = residueTestSafetyIssues({
    disposableAccountAcknowledged: false,
    protectedPaths: [{ label: 'userData', path: 'C:\\userData', exists: true }],
    uninstallEntries: null, appRunning: null, runtimeOverrides: ['STEPCODE_AUTH_PATH'],
  });
  assert.equal(issues.length, 5);
  assert.match(issues[0], /disposable Windows account/);
  assert.match(issues[1], /userData already exists/);
  assert.match(issues[2], /could not verify.*registry/);
  assert.match(issues[3], /could not verify.*running/);
  assert.match(issues[4], /STEPCODE_AUTH_PATH/);
  assert.deepEqual(residueTestSafetyIssues({
    disposableAccountAcknowledged: true, protectedPaths: [], uninstallEntries: 0, appRunning: false,
  }), []);
});

for (const command of ['verify', 'upgrade']) {
  test(`residue ${command} refuses to run without disposable-account acknowledgement`, () => {
    const script = fileURLToPath(new URL('../scripts/verify-residue.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, command], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /refusing destructive residue test/);
  });
}
