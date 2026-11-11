export const windowsGroups = ['interface', 'sessions', 'runtime'];

// Preserve the serial CI inventory from main 45ff68e; each script runs in one group.
export const acceptanceGroups = {
  interface: [
    'verify-startup.mjs',
    'verify-first-run.mjs',
    'verify-app-updates.mjs',
    'verify-update-installer.mjs',
    'verify-native-update-download.mjs',
    'verify-appearance.mjs',
    'verify-interface-settings.mjs',
    'verify-compaction-settings.mjs',
    'verify-speech.mjs',
    'verify-interface-preferences.mjs',
    'verify-question-tool-layout.mjs',
    'verify-disclosure-summary.mjs',
    'verify-conversation-scroll.mjs',
    'verify-selection-inheritance.mjs',
    'verify-import-performance.mjs',
    'verify-task-progress.mjs',
    'verify-settings-dialog.mjs',
    'verify-capabilities.mjs',
    'verify-capability-diagnostics.mjs',
    'verify-plugin-center.mjs',
    'verify-plugin-host-settings-ui.mjs',
    'verify-plugin-host-settings-electron.mjs',
    'verify-plugin-host-authorization-electron.mjs',
    'verify-plugin-workspace.mjs',
    'verify-plugin-shell.mjs',
    'verify-plugin-surfaces-electron.mjs',
    'verify-plugin-input-mcp.mjs',
    'verify-desktop-tray.mjs',
    'verify-notifications.mjs',
    'verify-notice-toast.mjs',
    'verify-composer-menu.mjs',
    'verify-command-dispatch.mjs',
    'verify-mini-chat-preview.mjs',
    'verify-btw.mjs',
    'verify-workflow-catalog.mjs',
    'verify-composer-editing.mjs',
    'verify-terminal-panel.mjs',
    'verify-terminal-scopes.mjs',
    'verify-browser-panel.mjs',
    'verify-message-links.mjs',
    'verify-turn-artifacts.mjs',
    'verify-file-preview.mjs',
    'verify-sidebar-scrollbar.mjs',
    'verify-sidebar-order.mjs',
    'verify-session-search.mjs',
    'verify-fulltext-search.mjs',
    'verify-archived-sessions.mjs',
    'verify-auth-vault.mjs',
    'verify-account-settings.mjs',
    'verify-usage-account.mjs',
    'verify-usage-overview-real.mjs',
    'verify-usage-chart-preview.mjs',
    'verify-theme-cascade.mjs',
    'verify-account-allowance.mjs',
    'verify-account-balance.mjs',
    'verify-account-routing.mjs',
    'verify-theme-bootstrap.mjs',
    'verify-performance-matrix.mjs',
    'verify-auto-resume.mjs',
    'verify-execution-outcomes.mjs',
  ],
  sessions: [
    'verify-new-session.mjs',
    'verify-launch-modes.mjs',
    'verify-global-instructions.mjs',
    'verify-completion-review.mjs',
    'verify-plan-review.mjs',
    'verify-question-review.mjs',
    'verify-ultracode-restore.mjs',
    'verify-context-maintenance.mjs',
    'verify-clm-cancellation.mjs',
    'verify-hidden-messages.mjs',
    'verify-session-concurrency.mjs',
    'verify-session-navigation.mjs',
    'verify-mini-chat-electron.mjs',
    'verify-session-branching.mjs',
    'verify-message-order.mjs',
    'verify-send-queue.mjs',
    'verify-model-switch.mjs',
    'verify-cross-session.mjs',
    'verify-session-import.mjs',
    'verify-session-move.mjs',
    'verify-import-large-electron.mjs',
  ],
  runtime: [
    'verify-electron.mjs',
    'verify-cron-runtime.mjs',
    'verify-cron-management.mjs',
    'verify-cron-transcript-electron.mjs',
    'verify-quit-confirmation-electron.mjs',
    'verify-project-trust.mjs',
    'verify-project-instructions-electron.mjs',
    'verify-permission-approval.mjs',
    'verify-permission-tiers.mjs',
    'verify-conversation-timing.mjs',
    'verify-auto-resume-electron.mjs',
    'verify-performance-runtime.mjs',
    'verify-subagent-status.mjs',
    'verify-workflow.mjs',
    'verify-chain-runtime.mjs',
    'verify-windows-commands.mjs',
    'verify-then-run.mjs',
    'verify-workflow-runtime.mjs',
    'verify-summary-runtime.mjs',
    'verify-task-progress-electron.mjs',
    'verify-usage-worker.mjs',
    'verify-usage-overview-runtime.mjs',
    'verify-background-subagents.mjs',
    'verify-background-agent-controls.mjs',
    'verify-remote-access.mjs',
    'verify-background-agent-replies.mjs',
    'verify-background-history-liveness.mjs',
    'verify-btw-electron.mjs',
    'verify-custom-providers.mjs',
    'verify-crash-log.mjs',
    'verify-steppage-registration.mjs',
  ],
};

// Local-only checks are explicitly registered rather than silently skipped.
// A new verify-*.mjs must be explicitly assigned; never silently default to local-only.
export const localOnly = [
  // Menu state/copy preview; native creation/read-only enforcement also has runtime tests.
  'verify-project-instructions-preview.mjs',
  // Cross-repository/native fixtures require explicit isolated paths and/or a prepared BVR checkout.
  // Native plugin protocol and consumer coverage also run in plugin-skeleton-native.test.ts.
  'verify-bvr-electron.mjs',
  'verify-bvr-host.mjs',
  'verify-bvr-settings-electron.mjs',
  'verify-plugin-starter.mjs',
  'verify-plugin-center-package.mjs',
  'verify-plugin-center-manual.mjs',
  // Standalone manager harness writes compiled native fixtures to an explicit local D: evidence root.
  // Actual installed main/side/window routing runs in verify-plugin-surfaces-electron above.
  'verify-plugin-windows.mjs',
  // Design-only preview; the production PluginCenter fixture is self-contained and runs above.
  'verify-plugin-center-preview.mjs',
  // Local theme visual matrix; optional geometry comparison uses a captured baseline.
  'verify-theme-materials.mjs',
  'verify-stellar-chrome.mjs',
  'verify-stellar-records.mjs',
  'verify-stellar-decisions.mjs',
  'verify-stellar-navigation.mjs',
  'verify-stellar-controls.mjs',
  'verify-stellar-surfaces.mjs',
  'verify-stellar-settings.mjs',
  'verify-stellar-search.mjs',
  'verify-stellar-feedback.mjs',
  'verify-stellar-decision-stress.mjs',
  'verify-stellar-statuses.mjs',
  'verify-stellar-lettering.mjs',
  'verify-stellar-brand.mjs',
  'verify-stellar-emblem.mjs',
  'verify-theme-composition.mjs',
  'verify-theme-background-composition.mjs',
  'verify-theme-finishing.mjs',
  'verify-theme-idle.mjs',
  'verify-theme-navigation.mjs',
  'verify-theme-packs.mjs',
  'verify-theme-workspace.mjs',
  'verify-theme-composition-electron.mjs',
  // Personal-image editor/rendering matrices and isolated native import lifecycle.
  'verify-custom-background-settings.mjs',
  'verify-custom-background-rendering.mjs',
  'verify-custom-background-electron.mjs',
  // Requires an explicitly prepared isolated Electron build and runtime.
  'verify-theme-pack-electron.mjs',
  'verify-stellar-pencil.mjs',
  'verify-stellar-reading.mjs',
  // Comparative startup timings need a quiet machine; navigation correctness runs in CI above.
  'verify-session-navigation-performance.mjs',
  // Local renderer stress/visual matrices; comparisons require an identical browser and quiet host.
  // Native scroll, sidebar order/search, navigation and shared rendering checks remain in CI.
  'verify-long-session-interaction.mjs',
  'verify-panel-gesture.mjs',
  'verify-streaming-markdown.mjs',
  'verify-sidebar-interaction.mjs',
  'verify-viewport-highlight.mjs',
  // Real Electron coverage above complements these visual fixture matrices.
  'verify-cron-transcript.mjs',
  'verify-quit-confirmation.mjs',
  // Requires a separately obtained official bundle; deterministic protocol coverage is in unit tests.
  'verify-steppage-bundle.mjs',
  'verify-steppage-prepare.mjs',
  // Status RPC coverage runs in verify-summary-runtime; this is the visual fixture.
  'verify-session-status-view.mjs',
  // CLM visual fixtures; protocol tests and verify-command-dispatch cover the integration in CI.
  'verify-clm-panel.mjs',
  'verify-clm-preview.mjs',
  // Mock-data search preview; requires a local Vite server, not runtime integration acceptance.
  'verify-fulltext-search-preview.mjs',
  // Standalone visual fixture; production startup coverage is in verify-first-run.
  'verify-first-run-preview.mjs',
  // Isolated Remote UI only; this check starts its own Vite server and uses no real channels.
  'verify-remote-access-preview.mjs',
  'verify-remote-chat-preview.mjs',
  'verify-scheduled-tasks-preview.mjs',
  'verify-app-update-source.mjs',
  'verify-chat-quotes.mjs',
  // Requires the manually started quote-annotations Vite preview on port 5195.
  'verify-quote-annotations-fixture.mjs',
  'verify-composer-action.mjs',
  'verify-context-panel.mjs',
  'verify-inspector-expansion.mjs',
  'verify-message-feedback.mjs',
  'verify-model-effort.mjs',
  'verify-residue.mjs',
  'verify-review-panel.mjs',
  'verify-stream-motion.mjs',
  'verify-summary-board.mjs',
  'verify-summary-resize.mjs',
  'verify-turn-changes.mjs',
  'verify-turn-undo.mjs',
];

// Platform-specific checks are covered by their native workflow, not Windows.
export const platformOnly = { macos: ['verify-macos-package.mjs', 'verify-macos-updater.mjs'] };

// Every script is bounded, including assertion cleanup that never finishes.
export const defaultAcceptanceTimeout = 300_000;

// Keep explicit per-script limits independently adjustable.
export const acceptanceTimeouts = {
  'verify-cron-runtime.mjs': 300_000,
  'verify-cron-management.mjs': 300_000,
  'verify-project-trust.mjs': 300_000,
  'verify-question-review.mjs': 300_000,
  'verify-windows-commands.mjs': 300_000,
  'verify-then-run.mjs': 300_000,
  'verify-context-maintenance.mjs': 300_000,
  'verify-clm-cancellation.mjs': 300_000,
  'verify-model-switch.mjs': 300_000,
  'verify-theme-bootstrap.mjs': 300_000,
};

export function validateInventory(files, groups = acceptanceGroups, excluded = localOnly, platforms = platformOnly) {
  if (Object.keys(groups).sort().join() !== [...windowsGroups].sort().join()) {
    throw new Error('Expected exactly the three Windows acceptance groups');
  }
  const registered = new Set();
  for (const [group, scripts] of [...Object.entries(groups), ['local-only', excluded], ...Object.entries(platforms)]) {
    if (!Array.isArray(scripts) || (group !== 'local-only' && scripts.length === 0)) throw new Error(`Empty acceptance group: ${group}`);
    for (const script of scripts) {
      if (!/^verify-[a-z0-9-]+\.mjs$/.test(script)) throw new Error(`Invalid acceptance script: ${script}`);
      if (registered.has(script)) throw new Error(`Duplicate acceptance script: ${script}`);
      if (!files.includes(script)) throw new Error(`Missing acceptance script: ${script}`);
      registered.add(script);
    }
  }
  for (const file of files) {
    if (!registered.has(file)) throw new Error(`Unassigned acceptance script: ${file}`);
  }
}

// macOS uses the same feature inventory. Keep the native Windows shell probe
// explicitly excluded; native macOS terminal behavior is tested separately.
export const macosExclusions = {
  'verify-windows-commands.mjs': 'Requires Windows executable discovery, Git Bash and PowerShell.',
};
export const macosAcceptanceGroups = Object.fromEntries(Object.entries(acceptanceGroups)
  .map(([group, scripts]) => [group, scripts.filter(script => !(script in macosExclusions))]));
macosAcceptanceGroups.interface.push('verify-macos-updater.mjs');
macosAcceptanceGroups.sessions.push('verify-turn-undo.mjs');

export function macosGroupScripts(group) {
  // Exercise CPU/resource-sensitive RPC fixtures before the longer UI suites.
  // Both source and package still run the identical complete serial inventory.
  if (group === 'all') return ['runtime', 'interface', 'sessions'].flatMap(name => macosAcceptanceGroups[name]);
  if (!windowsGroups.includes(group)) throw new Error(`Unknown macOS acceptance group: ${group}`);
  return macosAcceptanceGroups[group];
}

export function validateMacosInventory(files) {
  validateInventory(files);
  for (const [script, reason] of Object.entries(macosExclusions)) {
    if (!Object.values(acceptanceGroups).flat().includes(script) || !reason.trim()) {
      throw new Error(`Invalid macOS exclusion: ${script}`);
    }
  }
  const included = macosGroupScripts('all');
  if (new Set(included).size !== included.length) throw new Error('Duplicate macOS acceptance script');
  for (const script of Object.values(acceptanceGroups).flat()) {
    if (!included.includes(script) && !(script in macosExclusions)) throw new Error(`Unassigned macOS acceptance script: ${script}`);
  }
}
