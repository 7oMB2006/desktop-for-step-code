export const windowsGroups = ['interface', 'sessions', 'runtime'];

// Preserve the serial CI inventory from main 45ff68e; each script runs in one group.
export const acceptanceGroups = {
  interface: [
    'verify-app-updates.mjs',
    'verify-appearance.mjs',
    'verify-settings-dialog.mjs',
    'verify-desktop-tray.mjs',
    'verify-composer-menu.mjs',
    'verify-terminal-panel.mjs',
    'verify-browser-panel.mjs',
    'verify-message-links.mjs',
    'verify-turn-artifacts.mjs',
    'verify-file-preview.mjs',
    'verify-sidebar-scrollbar.mjs',
    'verify-sidebar-order.mjs',
    'verify-archived-sessions.mjs',
    'verify-auth-vault.mjs',
    'verify-account-settings.mjs',
    'verify-theme-bootstrap.mjs',
  ],
  sessions: [
    'verify-new-session.mjs',
    'verify-launch-modes.mjs',
    'verify-plan-review.mjs',
    'verify-ultracode-restore.mjs',
    'verify-context-maintenance.mjs',
    'verify-clm-cancellation.mjs',
    'verify-hidden-messages.mjs',
    'verify-session-concurrency.mjs',
    'verify-session-navigation.mjs',
    'verify-session-branching.mjs',
    'verify-message-order.mjs',
    'verify-send-queue.mjs',
    'verify-model-switch.mjs',
    'verify-cross-session.mjs',
  ],
  runtime: [
    'verify-electron.mjs',
    'verify-permission-approval.mjs',
    'verify-permission-tiers.mjs',
    'verify-conversation-timing.mjs',
    'verify-subagent-status.mjs',
    'verify-workflow.mjs',
    'verify-chain-runtime.mjs',
    'verify-workflow-runtime.mjs',
    'verify-summary-runtime.mjs',
    'verify-background-subagents.mjs',
    'verify-custom-providers.mjs',
    'verify-crash-log.mjs',
    'verify-steppage-registration.mjs',
  ],
};

// These scripts already existed outside PR CI. This split neither adds nor removes coverage.
// A new verify-*.mjs must be explicitly assigned; never silently default to local-only.
export const localOnly = [
  'verify-app-update-source.mjs',
  'verify-chat-quotes.mjs',
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

// Retain the two existing per-step timeout limits; other scripts retain the job limit.
export const acceptanceTimeouts = {
  'verify-context-maintenance.mjs': 300_000,
  'verify-clm-cancellation.mjs': 300_000,
  'verify-model-switch.mjs': 300_000,
  'verify-theme-bootstrap.mjs': 300_000,
};

export function validateInventory(files, groups = acceptanceGroups, excluded = localOnly) {
  if (Object.keys(groups).sort().join() !== [...windowsGroups].sort().join()) {
    throw new Error('Expected exactly the three Windows acceptance groups');
  }
  const registered = new Set();
  for (const [group, scripts] of [...Object.entries(groups), ['local-only', excluded]]) {
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
