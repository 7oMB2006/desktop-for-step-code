import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const { waitForNewSessionButton, waitForSessionFixtureSnapshot, waitForSessionFixtureTools,
  submitColdSessionFixture, submitSessionFixture, restartIdleSessionFixture,
  relocateIdleWorkspaceFixture } =
  await import(new URL('../scripts/session-fixture.mjs', import.meta.url).href);

test('workflow planned relaunch and cleanup use orderly shutdown without removing the forced-crash case', async () => {
  const source = ts.createSourceFile('verify-workflow-runtime.mjs',
    await readFile(new URL('../scripts/verify-workflow-runtime.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let shutdowns = 0, forcedCrashes = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression))
        assert.notEqual(node.expression.getText(source), 'app.exit', 'normal closure must not bypass native cleanup');
      if (ts.isIdentifier(node.expression) && node.expression.text === 'closeDesktopFixtureAndWait') {
        assert.ok(ts.isAwaitExpression(node.parent));
        assert.equal(node.arguments[0].getText(source), 'app');
        shutdowns++;
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'terminateFixtureTree') {
        assert.equal(node.arguments[0].getText(source), 'app.process().pid');
        forcedCrashes++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(shutdowns, 2, 'planned relaunch and final cleanup must both await closure');
  assert.equal(forcedCrashes, 1, 'crash recovery must still kill the isolated fixture tree');
  const body = source.statements.find(ts.isTryStatement)!;
  const statements = body.tryBlock.statements;
  const shutdown = statements.findIndex(statement => statement.getText(source) === 'await closeDesktopFixtureAndWait(app);');
  assert.ok(shutdown >= 0);
  assert.equal(statements[shutdown + 1].getText(source), 'app = await launch();',
    'the next process can start only after orderly closure has completed');
});

test('idle restart readiness waits only for refused preflights and preserves the original worker', async () => {
  const order: string[] = [];
  let attempts = 0;
  const page = { evaluate: async (callback: () => unknown) => runInNewContext(`(${callback.toString()})()`, {
    window: { desktop: {
      restart: async () => {
        order.push('restart');
        if (++attempts < 3) throw new Error("Error invoking remote method 'desktop': Error: Session operation in progress");
        return { runtimeId: 'new', state: { isStreaming: false } };
      },
      snapshot: async () => { order.push('identity'); return { runtimeId: 'old' }; },
    } },
  }) };
  assert.deepEqual(await restartIdleSessionFixture(page, 'old'), { runtimeId: 'new', state: { isStreaming: false } });
  assert.deepEqual(order, ['restart', 'identity', 'restart', 'identity', 'restart']);
});

test('idle restart readiness never retries a different failure or a changed runtime', async () => {
  for (const changed of [false, true]) {
    let calls = 0;
    const failure = new Error(changed
      ? "Error invoking remote method 'desktop': Error: Session operation in progress"
      : 'RPC process failed to exit');
    const page = { evaluate: async () => {
      if (++calls === 1) throw failure;
      assert.equal(changed, true, 'unrelated failures must not even poll');
      return { runtimeId: 'unexpected' };
    } };
    await assert.rejects(restartIdleSessionFixture(page, 'old'),
      changed ? /A refused restart must retain the original runtime/ : error => error === failure);
    assert.equal(calls, changed ? 2 : 1);
  }
});

test('idle restart readiness retains the busy failure at its deadline', async () => {
  const failure = new Error("Error invoking remote method 'desktop': Error: Session operation in progress");
  let calls = 0;
  const page = { evaluate: async () => {
    if (++calls === 1) throw failure;
    return { runtimeId: 'old' };
  } };
  await assert.rejects(restartIdleSessionFixture(page, 'old', 0), error => error === failure);
  assert.equal(calls, 2);
});

test('idle relocation waits only for refused preflights before its directory dialog', async () => {
  const order: string[] = [];
  let attempts = 0, dialogs = 1;
  const page = { evaluate: async (callback: (path?: string) => unknown, path?: string) =>
    runInNewContext(`(${callback.toString()})(path)`, {
      path,
      window: { desktop: {
        relocateWorkspace: async (value: string) => {
          assert.equal(value, '/project');
          order.push('relocate');
          if (++attempts < 3) throw new Error("Error invoking remote method 'desktop': Error: Session operation in progress");
          dialogs++;
          return { runtimeId: 'replacement' };
        },
        snapshot: async () => { order.push('identity'); return { runtimeId: 'original' }; },
      } },
    }) };
  assert.deepEqual(await relocateIdleWorkspaceFixture(page, '/project', 'original', async () => dialogs),
    { runtimeId: 'replacement' });
  assert.deepEqual(order, ['relocate', 'identity', 'relocate', 'identity', 'relocate']);
  assert.equal(dialogs, 2, 'successful relocation opens exactly one additional dialog');
});

test('idle relocation never retries after a dialog, a different failure, or a changed runtime', async () => {
  for (const kind of ['dialog', 'different', 'identity']) {
    let calls = 0, dialogs = 0;
    const failure = new Error(kind === 'different' ? 'Failed to reconnect relocated session'
      : "Error invoking remote method 'desktop': Error: Session operation in progress");
    const page = { evaluate: async () => {
      if (++calls === 1) {
        if (kind === 'dialog') dialogs++;
        throw failure;
      }
      assert.equal(kind, 'identity', 'other failures must not even poll');
      return { runtimeId: 'unexpected' };
    } };
    await assert.rejects(relocateIdleWorkspaceFixture(page, '/project', 'original', async () => dialogs),
      kind === 'identity' ? /A refused relocation must retain the original runtime/ : error => error === failure);
    assert.equal(calls, kind === 'identity' ? 2 : 1);
  }
});

test('idle relocation preserves a cancelled dialog and retains the busy failure at its deadline', async () => {
  let calls = 0, dialogs = 0;
  const cancelled = { evaluate: async () => { calls++; dialogs++; return null; } };
  assert.equal(await relocateIdleWorkspaceFixture(cancelled, '/project', 'original', async () => dialogs), null);
  assert.equal(calls, 1, 'cancelling a dialog does not repeat the operation');
  const failure = new Error("Error invoking remote method 'desktop': Error: Session operation in progress");
  const busy = { evaluate: async () => {
    if (++calls === 2) throw failure;
    return { runtimeId: 'original' };
  } };
  await assert.rejects(relocateIdleWorkspaceFixture(busy, '/project', 'original', async () => dialogs, 0),
    error => error === failure);
  assert.equal(calls, 3);
});

test('idle relocation cannot start without a valid directory-dialog counter', async () => {
  for (const count of [undefined, -1, 0.5, NaN]) {
    const page = { evaluate: async () => { assert.fail('Invalid readiness cannot attempt relocation'); } };
    await assert.rejects(relocateIdleWorkspaceFixture(page, '/project', 'original', async () => count),
      /requires a valid directory-dialog counter/);
  }
});

test('sidebar relocation acceptance waits for backend readiness without removing its repair assertions', async () => {
  const text = await readFile(new URL('../scripts/verify-sidebar-order.mjs', import.meta.url), 'utf8');
  const source = ts.createSourceFile('verify-sidebar-order.mjs', text,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let waits = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'relocateIdleWorkspaceFixture') {
      waits++;
      assert.ok(ts.isAwaitExpression(node.parent));
      assert.equal(node.arguments[2].getText(source), 'beforeRelocation.runtimeId');
      assert.match(node.arguments[3].getText(source), /app\.evaluate\(\(\) => globalThis\.__sidebarRelocationDialogs\)/);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(waits, 1);
  assert.ok(text.includes("assert.equal(repaired.state.sessionId, 'sidebar-4'"));
  assert.ok(text.includes("assert.equal(repaired.preferences.workspace, relocated)"));
  assert.ok(text.includes("assert.equal(repaired.sessions.find(session => session.id === 'sidebar-4').cwd, relocated)"));
});

test('file preview acceptance waits for real browser state and retains native restart exit assertions', async () => {
  const text = await readFile(new URL('../scripts/verify-file-preview.mjs', import.meta.url), 'utf8');
  const source = ts.createSourceFile('verify-file-preview.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let restart = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForFunction') {
        const predicate = node.arguments[0];
        assert.ok(predicate && (ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)));
        assert.equal(predicate.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false, false);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'restartIdleSessionFixture') {
        restart++;
        assert.equal(node.arguments[1].getText(source), 'beforeRestart.runtimeId');
        assert.ok(ts.isAwaitExpression(node.parent));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(restart, 1);
  assert.ok(text.includes("'Session restart waits until the old RPC process is gone'"));
  assert.ok(text.includes("error.code === 'ESRCH'"));
});

for (const script of ['verify-first-run.mjs', 'verify-session-import.mjs']) {
  test(`${script} never polls an async predicate through browser Promise truthiness`, async () => {
    const source = ts.createSourceFile(script,
      await readFile(new URL(`../scripts/${script}`, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let snapshotPolls = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForFunction') {
          const predicate = node.arguments[0];
          assert.ok(predicate && (ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)),
            'browser polling must use an inspectable synchronous predicate');
          assert.equal(predicate.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false, false,
            'async IPC predicates belong in the awaited Node-side snapshot poller');
          assert.doesNotMatch(predicate.getText(source), /window\.desktop\.snapshot\(/,
            'a browser-side Promise cannot establish native readiness');
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === 'waitForSessionFixtureSnapshot') {
          snapshotPolls++;
          assert.ok(ts.isAwaitExpression(node.parent), 'snapshot polling must finish before persistence assertions');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(snapshotPolls >= 2, 'history and completion checks must both poll resolved IPC snapshots');
  });
}

test('new-session acceptance awaits IPC draft persistence instead of browser Promise truthiness', async () => {
  const source = ts.createSourceFile('verify-new-session.mjs',
    await readFile(new URL('../scripts/verify-new-session.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let draftPolls = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForFunction') {
        const predicate = node.arguments[0];
        assert.ok(predicate && (ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)));
        assert.equal(predicate.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false, false);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'waitForSessionFixtureSnapshot') {
        assert.ok(ts.isAwaitExpression(node.parent));
        assert.match(node.arguments[1].getText(source), /await page\.evaluate/);
        assert.match(node.arguments[1].getText(source), /composerRead/);
        draftPolls++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(draftPolls, 1);
});

test('new-session cleanup always awaits orderly shutdown and releases its loopback server', async () => {
  const source = ts.createSourceFile('verify-new-session.mjs',
    await readFile(new URL('../scripts/verify-new-session.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const body = source.statements.find(ts.isTryStatement)!;
  const cleanup = runInNewContext(`(async (writeFile, closeDesktopFixtureAndWait, fixture) =>
    ${body.finallyBlock!.getText(source)})`, {
    app: {}, nativeHeightLimit: undefined, pickerLayouts: [], errors: [], JSON,
  });
  for (const failureAt of ['none', 'evidence', 'shutdown']) {
    const order: string[] = [];
    const failure = new Error(failureAt);
    const run = cleanup(async () => {
      order.push('evidence');
      if (failureAt === 'evidence') throw failure;
    }, async () => {
      await new Promise(resolve => setImmediate(resolve));
      order.push('shutdown');
      if (failureAt === 'shutdown') throw failure;
    }, { close: async () => {
      await new Promise(resolve => setImmediate(resolve));
      order.push('server');
    } });
    if (failureAt === 'none') await run;
    else await assert.rejects(run, error => error === failure);
    assert.deepEqual(order, ['evidence', 'shutdown', 'server']);
  }
  assert.ok(source.statements.find(statement => statement.getStart(source) > body.end
    && statement.getText(source).includes('New session draft acceptance passed')));
});

test('first-run model fixture excludes unrelated MCP only after real fresh-profile detection', async () => {
  const text = await readFile(new URL('../scripts/verify-first-run.mjs', import.meta.url), 'utf8');
  const source = ts.createSourceFile('verify-first-run.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let profile: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'profile') profile = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(profile);
  assert.equal(profile.initializer!.getText(source),
    "async () => realpath(await mkdtemp(join(tmpdir(), 'desktop-first-run-native-')))",
    'a fresh profile must not preseed settings or onboarding completion metadata');
  const launch = text.indexOf('await launch(customRoot);');
  const intro = text.indexOf('await stopIntro();', launch);
  const disable = text.indexOf("await window.desktop.saveMcp('steppage__steppage'");
  const provider = text.indexOf("await page.locator('.first-run-service').filter({ hasText: '其他供应商' })", intro);
  assert.ok(launch >= 0 && intro > launch && disable > intro && provider > disable);
  assert.match(text.slice(intro, provider), /enabled: false/);
});

test('first-run MCP isolation supplies a valid disabled server on clean profiles without a local StepPage install', async () => {
  const source = ts.createSourceFile('verify-first-run.mjs',
    await readFile(new URL('../scripts/verify-first-run.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let configure: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.getText(source) === 'page.evaluate'
      && node.arguments[0]?.getText(source).includes("window.desktop.saveMcp('steppage__steppage'"))
      configure = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(configure);
  const profiles: Record<string, { command: string; args: string[] }>[] = [
    {}, { steppage__steppage: { command: '/local/steppage', args: ['serve'] } },
  ];
  for (const mcp of profiles) {
    let calls = 0;
    await runInNewContext(`(${configure.getText(source)})()`, {
      window: { desktop: {
        settings: async () => ({ mcp }),
        saveMcp: async (name: string, config: { command: string; args: string[]; enabled: boolean }) => {
          assert.equal(name, 'steppage__steppage');
          assert.equal(config.enabled, false);
          assert.equal(typeof config.command, 'string');
          assert.ok(config.command.length > 0);
          assert.ok(Array.isArray(config.args));
          assert.equal(config.command, mcp.steppage__steppage?.command ?? 'node');
          calls++;
        },
      } },
    });
    assert.equal(calls, 1);
  }
});

test('restored-session assertions wait for the selected history rather than the navigation response', async () => {
  const cases = [
    {
      script: 'verify-session-move.mjs', variable: 'restored',
      pending: { state: { sessionId: 'move-one' }, messages: [] },
      ready: { state: { sessionId: 'move-one' }, messages: [{ content: 'Keep this brainstorm' }] },
      context: {},
    },
    {
      script: 'verify-workflow-runtime.mjs', variable: 'afterCrash',
      pending: { state: { sessionId: 'original', isStreaming: false }, messages: [] },
      ready: { state: { sessionId: 'original', isStreaming: false },
        messages: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'WORKFLOW-CRASH' }] }] },
      context: { sessionId: 'original' },
    },
  ];
  for (const entry of cases) {
    const source = ts.createSourceFile(entry.script,
      await readFile(new URL(`../scripts/${entry.script}`, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let initializer: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === entry.variable)
        initializer = node.initializer;
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(initializer && ts.isAwaitExpression(initializer), entry.variable);
    const result = await runInNewContext(`(async () => ${initializer.getText(source)})()`, {
      ...entry.context,
      page: {},
      waitSnapshot: async (...args: unknown[]) => {
        const predicate = args.at(-1) as (snapshot: unknown) => boolean;
        assert.equal(predicate(entry.pending), false, `${entry.variable}: empty cold history cannot pass`);
        assert.equal(predicate({ ...entry.ready, state: { sessionId: 'unrelated' } }), false,
          `${entry.variable}: unrelated history cannot pass`);
        assert.equal(predicate(entry.ready), true);
        return entry.ready;
      },
    });
    assert.equal(result, entry.ready);
  }
});

test('update installer fixture awaits native startup before creating a separate harness window', async () => {
  const source = ts.createSourceFile('verify-update-installer.mjs',
    await readFile(new URL('../scripts/verify-update-installer.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const body = source.statements.find(ts.isTryStatement)!;
  const statements = body.tryBlock.statements;
  const harnessIndex = statements.findIndex(statement => statement.getText(source).includes("app.waitForEvent('window')"));
  assert.ok(harnessIndex > 0);
  const startup = statements.slice(0, harnessIndex).map(statement => statement.getText(source));
  assert.ok(startup.some(statement => statement.includes('await app.firstWindow()')));
  assert.ok(startup.some(statement => statement.includes('await mainPage.waitForFunction(')
    && statement.includes('.first-run-production')), 'the native renderer must finish loading first');
  assert.ok(startup.some(statement => statement.includes('await mainPage.evaluate(() => window.desktop.snapshot())')),
    'preload availability alone cannot establish completed main-process startup');
  const cleanup = runInNewContext(`(async (app, child, closeDesktopFixtureAndWait) => ${body.finallyBlock!.getText(source)})`,
    { assert, console: { error: () => {} } });
  const app = { windows: () => [] };
  let closed = false;
  await cleanup(app, { exitCode: 0 }, async (owner: unknown) => {
    assert.equal(owner, app);
    await new Promise(resolve => setImmediate(resolve));
    closed = true;
  });
  assert.equal(closed, true, 'assertion failures must still await bounded, orderly shutdown');
  for (const exitCode of [null, 1])
    await assert.rejects(cleanup(app, { exitCode }, async () => {}), /the updater fixture must exit successfully/);
  const failure = new Error('Fixture shutdown failed');
  await assert.rejects(cleanup(app, { exitCode: 0 }, async () => { throw failure; }), error => error === failure);
  const success = source.statements.find(statement => statement.getText(source).includes('Update UI acceptance passed:'))!;
  assert.ok(success.getStart(source) > body.end, 'acceptance cannot pass before Electron has actually closed');
});

test('capability restart readiness rejects the old connected worker and the connecting replacement', async () => {
  const source = ts.createSourceFile('verify-capabilities.mjs',
    await readFile(new URL('../scripts/verify-capabilities.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let initializer: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'restartSession')
      initializer = node.initializer?.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer);
  const snapshots = [
    { runtimeId: 'old', status: 'connected' },
    { runtimeId: 'old', status: 'connected' },
    { runtimeId: 'new', status: 'connecting' },
    { runtimeId: 'new', status: 'connected' },
  ];
  let reads = 0, clicks = 0, buttonChecks = 0;
  const page = {
    evaluate: async () => snapshots[reads++],
    locator: (selector: string) => {
      assert.equal(selector, '.cap-footer');
      return { getByRole: () => ({ click: async () => { clicks++; } }) };
    },
    waitForFunction: async (predicate: (footer: string) => boolean, footer: string) => {
      assert.equal(reads, 4, 'an enabled button cannot replace actual connected-worker readiness');
      assert.equal(footer, '.cap-footer');
      assert.equal(runInNewContext(`(${predicate.toString()})(footer)`, {
        footer,
        document: { querySelector: () => ({ disabled: false }) },
      }), true);
      buttonChecks++;
    },
  };
  const restart = runInNewContext(`(${initializer})`, { page, waitForSessionFixtureSnapshot });
  await restart();
  assert.equal(clicks, 1);
  assert.equal(reads, 4);
  assert.equal(buttonChecks, 1);
});

test('configured plugin acceptance awaits the real MCP connection and never masks a failed service', async () => {
  const source = ts.createSourceFile('verify-capabilities.mjs',
    await readFile(new URL('../scripts/verify-capabilities.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let predicate: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'waitForSessionFixtureSnapshot'
      && node.arguments[2]?.getText(source).includes('configured plugin MCP'))
      predicate = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(predicate);
  for (const status of [undefined, 'connecting', 'connected', 'failed']) {
    const check = runInNewContext(`(() => { let connected; return ${predicate.getText(source)}; })()`, {
      assert,
      page: { evaluate: async (_callback: unknown, runtimeId: string) => {
        assert.equal(runtimeId, 'new-worker');
        return { mcp: status ? [{ name: 'dfsc-config-example__notes', status }] : [] };
      } },
    }) as (snapshot: { runtimeId: string }) => Promise<boolean>;
    if (status === 'failed') await assert.rejects(check({ runtimeId: 'new-worker' }), /MCP must connect successfully/);
    else assert.equal(await check({ runtimeId: 'new-worker' }), status === 'connected');
  }
});

test('new-session readiness polls through missing and disabled buttons after reload', async () => {
  const buttons = [null, { disabled: true }, { disabled: false }];
  const results: boolean[] = [];
  const page = {
    waitForFunction: async (callback: (theme?: string) => boolean, theme?: string) => {
      for (const button of buttons) {
        results.push(runInNewContext(`(${callback.toString()})(theme)`, {
          theme,
          document: {
            querySelector: (selector: string) => {
              assert.equal(selector, '.new-chat');
              return button;
            },
          },
        }));
      }
    },
  };
  await waitForNewSessionButton(page);
  assert.deepEqual(results, [false, false, true]);
});

test('new-session readiness requires both an enabled button and the requested theme', async () => {
  const states = [
    { button: null, theme: 'light' },
    { button: { disabled: true }, theme: 'light' },
    { button: { disabled: false }, theme: 'dark' },
    { button: { disabled: false }, theme: 'light' },
  ];
  const results: boolean[] = [];
  const page = {
    waitForFunction: async (callback: (theme?: string) => boolean, theme?: string) => {
      assert.equal(theme, 'light');
      for (const state of states) {
        results.push(runInNewContext(`(${callback.toString()})(theme)`, {
          theme,
          document: {
            querySelector: () => state.button,
            documentElement: { dataset: { theme: state.theme } },
          },
        }));
      }
    },
  };
  await waitForNewSessionButton(page, 'light');
  assert.deepEqual(results, [false, false, false, true]);
});

test('fixture polling awaits each IPC snapshot until the response has settled', async () => {
  const pending = { messages: [], state: { isStreaming: false } };
  const streaming = { messages: ['response'], state: { isStreaming: true } };
  const settled = { messages: ['response'], state: { isStreaming: false } };
  const snapshots = [pending, streaming, settled];
  let reads = 0;
  const page = {
    evaluate: async (callback: () => unknown) => runInNewContext(`(${callback.toString()})()`, {
      window: { desktop: { snapshot: async () => snapshots[reads++] } },
    }),
  };
  const actual = await waitForSessionFixtureSnapshot(page,
    (snapshot: typeof settled) => snapshot.messages.length === 1 && !snapshot.state.isStreaming, 'a settled response');
  assert.equal(actual, settled);
  assert.equal(reads, 3, 'a Promise or a streaming response cannot satisfy the wait early');
});

test('fixture polling awaits a predicate that resolves false before retrying', async () => {
  let reads = 0;
  const page = { evaluate: async () => ++reads };
  assert.equal(await waitForSessionFixtureSnapshot(page, async (value: number) => value === 2, 'the second snapshot'), 2);
  assert.equal(reads, 2);
});

test('fixture polling fails within its deadline when no snapshot matches', async () => {
  let reads = 0;
  await assert.rejects(waitForSessionFixtureSnapshot({ evaluate: async () => ++reads },
    () => false, 'a missing model request', 0), /Timed out waiting for a missing model request/);
  assert.equal(reads, 1);
});

test('fixture polling preserves IPC failures', async () => {
  const failure = new Error('Snapshot IPC disconnected');
  await assert.rejects(waitForSessionFixtureSnapshot({ evaluate: async () => { throw failure; } },
    () => true, 'a connected session'), error => error === failure);
});

const startupRefusal = 'Message not sent. Retry when tools are ready, or reconnect this conversation if the connection failed.';
const coldDraft = { draftId: 'draft', messages: [] };
const coldReady = { runtimeId: 'worker', state: { sessionId: 'session', desktopStartup: {
  targetBound: true, modelReady: true, cleanupConfirmed: true, discovery: 'ready', tools: [],
} }, messages: [] };
const coldAccepted = { ...coldReady, messages: [{ role: 'user', content: 'fixture input' }] };
function coldSendPage(snapshots: unknown[], alert = startupRefusal) {
  let reads = 0, restoredChecks = 0;
  const page = {
    evaluate: async () => snapshots[reads++],
    locator: () => ({ evaluate: async () => 'fixture input' }),
    getByRole: () => ({ allTextContents: async () => [alert] }),
    waitForFunction: async (predicate: (text: string) => boolean, text: string) => {
      assert.equal(text, 'fixture input');
      assert.equal(runInNewContext(`(${predicate.toString()})(text)`, {
        text, document: { querySelector: (selector: string) =>
          selector === '.composer-action-button' ? { disabled: false } : { value: text } },
      }), true);
      restoredChecks++;
    },
  };
  return { page, reads: () => reads, restoredChecks: () => restoredChecks };
}

test('cold-send fixture never retries an accepted submission', async () => {
  for (const accepted of [
    coldAccepted,
    { ...coldReady, state: { ...coldReady.state, isStreaming: true } },
    { ...coldReady, state: { ...coldReady.state, desktopStartup: {
      ...coldReady.state.desktopStartup, firstPromptAcceptedAt: 123,
    } } },
  ]) {
    const fixture = coldSendPage([coldDraft, accepted]);
    let sends = 0;
    assert.equal(await submitColdSessionFixture(fixture.page, async () => { sends++; }), accepted);
    assert.equal(sends, 1);
    assert.equal(fixture.reads(), 2);
    assert.equal(fixture.restoredChecks(), 0);
  }
});

test('cold-send fixture retries an unpersisted startup refusal once after authoritative readiness', async () => {
  const waiting = { ...coldReady, state: { ...coldReady.state, desktopStartup: {
    ...coldReady.state.desktopStartup, discovery: 'discovering',
  } } };
  const fixture = coldSendPage([coldDraft, waiting, waiting, coldReady, coldAccepted]);
  let sends = 0;
  assert.equal(await submitColdSessionFixture(fixture.page, async () => {
    sends++;
    if (sends === 2) assert.equal(fixture.restoredChecks(), 1, 'the original input must be restored before retry');
  }), coldAccepted);
  assert.equal(sends, 2);
  assert.equal(fixture.reads(), 5);
});

test('a stale refusal alert cannot replay a later accepted cold send', async () => {
  const fixture = coldSendPage([coldDraft, coldDraft, coldAccepted]);
  let sends = 0;
  assert.equal(await submitColdSessionFixture(fixture.page, async () => { sends++; }), coldAccepted);
  assert.equal(sends, 1);
});

test('cold-send fixture cannot retry an unrelated error, changed runtime, failed tool or uncertain cleanup', async () => {
  for (const kind of ['unrelated', 'runtime', 'session', 'failed', 'cleanup']) {
    const changed = structuredClone(coldReady);
    if (kind === 'runtime') changed.runtimeId = 'different';
    if (kind === 'session') changed.state.sessionId = 'different';
    if (kind === 'failed') changed.state.desktopStartup.discovery = 'failed';
    if (kind === 'cleanup') changed.state.desktopStartup.cleanupConfirmed = false;
    const fixture = coldSendPage([coldDraft, coldReady, changed], kind === 'unrelated' ? 'Model unavailable' : startupRefusal);
    let sends = 0;
    await assert.rejects(submitColdSessionFixture(fixture.page, async () => { sends++; }, 0));
    assert.equal(sends, 1, kind);
    assert.equal(fixture.restoredChecks(), 0, kind);
  }
});

test('execution fixture readiness accepts disabled tools but waits for pending discovery', async () => {
  const waiting = { ...coldReady, state: { ...coldReady.state, desktopStartup: {
    ...coldReady.state.desktopStartup, discovery: 'discovering',
  } } };
  const ready = { ...coldReady, state: { ...coldReady.state, desktopStartup: {
    ...coldReady.state.desktopStartup, tools: [{ name: 'unrelated', status: 'disabled' }],
  } } };
  const fixture = coldSendPage([waiting, ready]);
  assert.equal(await waitForSessionFixtureTools(fixture.page, 'worker'), ready);
  assert.equal(fixture.reads(), 2);
});

test('execution fixture readiness fails closed for failed tools and cleanup or identity uncertainty', async () => {
  for (const snapshot of [
    { ...coldReady, runtimeId: 'other' },
    { ...coldReady, state: { ...coldReady.state, desktopStartup: {
      ...coldReady.state.desktopStartup, cleanupConfirmed: false,
    } } },
    { ...coldReady, state: { ...coldReady.state, desktopStartup: {
      ...coldReady.state.desktopStartup, tools: [{ name: 'required', status: 'failed' }],
    } } },
  ]) {
    await assert.rejects(waitForSessionFixtureTools(coldSendPage([snapshot]).page, 'worker', 0));
  }
});

test('existing-session sends await tools without replaying an execution failure', async () => {
  const fixture = coldSendPage([coldReady, coldReady]);
  const failure = new Error('Provider failed after acceptance');
  let sends = 0;
  await assert.rejects(submitSessionFixture(fixture.page, async () => {
    sends++;
    throw failure;
  }), error => error === failure);
  assert.equal(sends, 1);
  assert.equal(fixture.reads(), 2);
});

for (const script of ['verify-composer-menu.mjs', 'verify-command-dispatch.mjs']) {
  test(`${script} captures real settled readiness before replacing IPC with a presentation fixture`, async () => {
    const text = await readFile(new URL(`../scripts/${script}`, import.meta.url), 'utf8');
    const source = ts.createSourceFile(script, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let snapshot: ts.VariableDeclaration | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'snapshot') snapshot = node;
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(snapshot);
    assert.equal(snapshot.initializer!.getText(source), 'await waitForSessionFixtureTools(page, owner.runtimeId)');
    const replace = text.indexOf("ipcMain.removeHandler('desktop')");
    assert.ok(replace > snapshot.end, 'the real IPC must still own startup discovery while awaiting readiness');
    assert.ok(text.includes('[mcp_servers.steppage__steppage]\\nenabled = false'),
      'presentation-only tests cannot depend on a machine-installed StepPage service');
  });
}
