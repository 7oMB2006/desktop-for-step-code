const observationKey = '__desktopGoalClearObservation';

export async function observeGoalClear(app, page) {
  await app.evaluate(({ ipcMain }, key) => {
    const handlers = ipcMain._invokeHandlers;
    const original = handlers.get('desktop');
    if (typeof original !== 'function') throw new Error('Desktop IPC handler unavailable');
    const rows = [];
    const wrapper = async (...args) => {
      const clear = args[1] === 'command' && args[2] === 'goal_action' && args[3]?.action === 'clear';
      const row = clear ? { outcome: 'pending' } : undefined;
      if (row && rows.length < 8) rows.push(row);
      try {
        const value = await original(...args);
        if (row) row.outcome = 'resolved';
        return value;
      } catch (error) {
        if (row) {
          row.outcome = 'rejected';
          const message = String(error?.message ?? error);
          row.reason = /Session operation in progress/.test(message) ? 'operation'
            : /Workspace is changing|Wait for this session to stop/.test(message) ? 'transition'
            : /Goal change was not confirmed/.test(message) ? 'unconfirmed'
            : /No goal is set/.test(message) ? 'missing-goal'
            : /does not support/.test(message) ? 'unsupported' : 'other';
        }
        throw error;
      }
    };
    handlers.set('desktop', wrapper);
    globalThis[key] = { rows, restore: () => {
      if (handlers.get('desktop') === wrapper) handlers.set('desktop', original);
      delete globalThis[key];
    } };
  }, observationKey);
  await page.evaluate(key => {
    const rows = [];
    const listener = event => {
      const button = event.target.closest?.('button');
      if (!button || !button.closest('.launch-status-panel, .assistant-footer-row')) return;
      const label = button.getAttribute('aria-label');
      const target = label === 'Clear goal' || label === '清除目标' ? 'clear'
        : label === 'Edit goal' || label === '编辑目标' ? 'edit'
        : label === 'Close' || label === '关闭' ? 'close'
        : button.matches('.launch-status-trigger') ? 'trigger' : 'other';
      if (rows.length < 12) rows.push({ type: event.type, target });
    };
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, listener, true);
    globalThis[key] = { rows, restore: () => {
      for (const type of ['pointerdown', 'pointerup', 'click']) document.removeEventListener(type, listener, true);
      delete globalThis[key];
    } };
  }, observationKey);
}

async function bounded(read, timeout) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read).catch(() => ({ unavailable: true })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), timeout); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function launchFailureDiagnostics(app, page, timeout = 1000) {
  const [ipc, ui, runtime] = await Promise.all([
    bounded(() => app.evaluate((_electron, key) => globalThis[key]?.rows ?? [], observationKey), timeout),
    bounded(() => page.evaluate(key => {
      const button = document.querySelector('button[aria-label="Clear goal"], button[aria-label="清除目标"]');
      const reveal = button?.closest('.launch-inline-reveal');
      const rect = button?.getBoundingClientRect();
      return {
        clicks: globalThis[key]?.rows ?? [],
        clearPresent: !!button, clearDisabled: button?.disabled,
        revealOpen: reveal?.dataset.open, revealInert: reveal?.inert,
        clearBounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
        actionError: !!document.querySelector('.launch-action-error'),
        navigationBusy: document.querySelector('.conversation')?.getAttribute('aria-busy'),
        working: !!document.querySelector('.working'),
        statuses: [...document.querySelectorAll('.launch-status-pulse')].slice(-8).map(node => ({
          goalState: node.getAttribute('data-goal-state'), expanded: node.getAttribute('aria-expanded'), disabled: node.disabled,
        })),
      };
    }, observationKey), timeout),
    bounded(() => page.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      return {
        runtimeId: snapshot.runtimeId, sessionId: snapshot.state?.sessionId,
        isStreaming: snapshot.state?.isStreaming, status: snapshot.status,
        goalId: snapshot.launch?.goal?.id, goalStatus: snapshot.launch?.goal?.status,
        plan: snapshot.launch?.plan, goalArmed: snapshot.launch?.goalArmed,
        ultracode: snapshot.launch?.ultracode, ultracodeArmed: snapshot.launch?.ultracodeArmed,
        pendingRequests: snapshot.requests?.length,
      };
    }), timeout),
  ]);
  return { ipc, ui, runtime };
}

export async function restoreGoalClearObservation(app, page, timeout = 1000) {
  await Promise.all([
    bounded(() => app.evaluate((_electron, key) => globalThis[key]?.restore(), observationKey), timeout),
    bounded(() => page.evaluate(key => globalThis[key]?.restore(), observationKey), timeout),
  ]);
}
