# Desktop Command Inventory

Audited against the staged Windows runtime pin
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494` on 2026-10-23.
`get_commands` remains the authority for runtime extensions, skills and prompt
templates. Desktop adds its own Status, trust and compact entries and the two
core CLM commands absent from that reply.

## Presentation

The discovery menu, editable command markers and sent user messages share
`Desktop/src/command-presentation.ts`. Usage uses the bar-chart icon; Cron
uses the sidebar clock. CLM keeps the command glyph. Skills use the book icon
and prompt templates the sparkle, even when their names resemble built-ins.
Unknown discovered commands use the command glyph without a repeated slash
label. `todos` is the current upstream spelling; the old `todo` presentation
is retained only for runtimes that actually advertise it.

Commands can be marked after prose, whitespace or newlines, including multiple
occurrences. Code, links and paths remain ordinary source. Decorations do not
rewrite editable text, clipboard content or transport. An inline reference such
as `explain /clm` is not an instruction to execute CLM. Assistant prose and quoted
excerpts do not acquire command markers.

## Dispatch

| Entry | Current Desktop behavior | Validation or remaining boundary |
| --- | --- | --- |
| `/usage`, `/usage overview` | Open the existing local Usage overview | Electron fixture verifies no prompt submission |
| `/usage account` | Open Account settings, including existing allowance/balance UI | Electron fixture verifies the selected settings tab; no new balance API |
| `/cron` | Open the existing scheduled-task manager | Electron fixture verifies no prompt submission |
| `/cron list`, `/cron status`, `/cron delete <id>` | Retain upstream parameter handling | Real runtime read-only list tested; this audit does not create or delete live jobs |
| `/status` | Open the existing right-panel Status view | Existing dedicated Desktop mapping retained |
| Model, permissions and MCP actions | Open their existing Desktop controls | Existing discovery acceptance retained |
| `/compact [instructions]` | Call the `compact` RPC with `customInstructions` | Fixture covers success, failure retaining the draft, and busy rejection; actual model summarization is separate acceptance |
| `/todos` | Upstream task-list notification | Empty list tested against the real bundle; a right-panel shortcut remains future work |
| `/workflows` | Upstream saved-workflow and recent-run notification | Empty lists tested against the real bundle; not equated to the current agent inspector |
| `/clm`, `/clm-compact [instructions]` | Existing core working-context handlers | Status tested against the real bundle; existing CLM maintenance tests remain authoritative |
| `/plan` | Existing upstream plan-mode handler and Desktop approval flow | On/off state verified against the real bundle; no change to approvals |
| `/goal` | Existing upstream goal handler | Read-only empty status verified; starting/resuming goals is not part of this audit |
| `/ultracode`, `/ultraloop` | Existing upstream multi-agent handlers | Read-only status verified; the redundant alias is hidden when Ultracode is advertised |
| `/plugin` | Existing upstream plugin dialogs through the Desktop request UI | Real selection and cancellation tested; no plugin installed |
| `/feedback` | Existing upstream feedback flow, requiring a configured endpoint | Real category dialog cancelled against a loopback endpoint; no logs, conversation or feedback uploaded |
| `/init` | Upstream submits an initialization task through the normal agent path | Loopback model verifies the AGENTS.md instruction arrives and the turn ends; no real AGENTS.md generation claimed |
| `/trust` | Existing Desktop project-trust confirmation | Existing focused trust tests retained |
| Skills and prompt templates | Runtime-discovered entries, existing expansion/dispatch | Source icons preserved; arbitrary installed resources are not all validated |

Desktop interception requires a complete standalone recognized command with no
attachments or quoted messages. Usage arguments other than `overview` or
`account`, and parameterized Cron commands, are passed through unchanged.
In particular, upstream Usage refresh flags are not yet Desktop aliases.
Compact requires a connected, existing, idle session and is never queued as
ordinary prose while a task is running.

## Hidden Shell Commands

`exit`, `quit`, `theme`, `llama`, `clear` and `new` are not offered as Desktop
slash-menu entries. Application lifecycle, appearance and session navigation
use existing Desktop controls. Hiding an entry is not a claim that typing its
raw spelling has been blocked at the runtime.

## Checks

- `Desktop/tests/command-references.test.ts`: positions, multiple occurrences,
  exclusions, shared icons, provenance and Markdown preservation.
- `Desktop/tests/composer-commands.test.ts`: catalog projection, standalone
  matching, argument handling, attachments and quotes.
- `Desktop/tests/slash-runtime.test.ts`: real fixed-bundle read-only handlers,
  dialog cancellation and loopback `/init` delivery with isolated credentials.
- `Desktop/scripts/verify-composer-menu.mjs`: real Electron menu and transcript
  icons, inline editing, clipboard/transport and light/dark/narrow layouts.
- `Desktop/scripts/verify-command-dispatch.mjs`: real Electron UI with mocked IPC
  for local page dispatch and Compact success/failure/busy boundaries.

Fixture and loopback results do not establish real-account execution,
marketplace installation, feedback delivery or packaged acceptance.
