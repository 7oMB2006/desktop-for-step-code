# Design System

Visible upstream `custom/step-cron` messages use an inline scheduled-task source
disclosure, not ordinary assistant prose or a user bubble. Its clock icon and
source label use the theme accent; instruction preview and recorded message time
remain muted. All complexity presets retain it as a process-group boundary.
The shared DisclosureChevron stays anchored through cubic height/opacity motion,
with inert collapsed details and a reduced-motion fallback. Missed one-shot
notices are labeled separately and preserve their original batched text.
Show only supplied metadata: ordinary fire messages do not include planned fire
time, so do not infer one from the current task or cron expression. This is a
trigger source, not a success outcome or a new scheduler.
Each visible native Cron notice starts an independent response turn, never a
synthetic user bubble. The preceding response retains its own footer, timing,
artifacts and completed Plan/Goal ownership, including while Cron is running.
Cron does not inherit a preceding user's model-change note or current workflow.

Scheduled-task creation defaults to durable storage, independently of recurrence.
The storage radio group names both durable and temporary choices, preserving the
choice when changing hosts. An untrusted host blocks durable submission with
explicit `/trust` and manual-restart guidance, never a silent temporary fallback.
Temporary creation and task details disclose loss on host exit/application update.

Scheduled-task recovery is an inline disclosure anchored to its detail-page action,
with cubic height/opacity transitions and a reduced-motion fallback. It uses the
shared AppMenu and DisclosureChevron for existing same-project conversations.
The review shows the current account, model, Ask policy and full project-wide task
prompts before activation. Association and recovery are marked Beta; an association
is not exclusive upstream ownership, and offline records never appear as running.

Session Status shares the existing Context inspector as a two-tab surface,
without adding another right-rail button. Context is the first and default tab;
the Context rail button always returns to Context. Status follows it and opens
only through explicit tab selection or `/status`. A standalone `/status` opens Status
locally, including during a running task or before a draft has a worker.
It never submits a prompt, consumes launch options, creates a session or queries
account services. Runtime model/thinking values remain separate from next-turn
selections. Account method, region and numeric identity come from a local
allowlisted projection of the applied Desktop credentials; custom providers do
not inherit the official account identity. Disconnected values are explicitly
last-known. The existing inspector sizing, dismissal and cubic motion apply.
The primary Status view also shows runtime activity, actual Plan mode, separately
reported Desktop/native queues and project trust. Unknown or failed diagnostics
are not treated as false. A default-collapsed Details section shows the runtime
version and its source, source commit, embedded Node version, sanitized HTTP(S)
endpoint and loaded instruction paths without their contents. A source-default
version is labeled as such rather than inferred from the pinned release.
Diagnostics reuse the read-only summary RPC only while Status is mounted;
late results from another session are ignored. Refresh retries failed reads.
Details use an inert collapsed body, cubic disclosure and reduced-motion fallback.

Active working labels and total elapsed time share one continuous purple/pink/coral/gold text gradient with slow flow and subtle cubic brightness breathing. Elapsed time is slightly quieter and retains tabular digits. Light theme preserves the exact brand palette without black mixing, outlines or shadows. Pale brand fills on white do not meet 4.5:1 text contrast; this preview prioritizes the requested palette fidelity and must not be represented as contrast-compliant. Reduced motion keeps a static gradient and forced-color mode restores system text colors. This treatment is limited to the working line and its Plan-review action, not prose, task footer controls or performance metrics.

Pending model responses use a five-pixel cross whose center lights before its four arms fade outward. Context compression uses a downward matrix sequence (row-major cells 1235, 4568, 789, then 2) with cubic interpolation. Both remain in the same fixed footprint and crossfade with the other modes; reduced-motion retains a static shape. Response waiting follows request/turn start until output arrives; compression follows the runtime's compacting flag. User approval waiting still takes precedence.

The centered performance strip below the composer contains only duration, estimated output TPS, input/output tokens and cache-hit rate, in that order. The first three use Timer, Zap and Database icons with keyboard-accessible application tooltips; cache-hit rate retains its label. Unknown measurements are not displayed as zero. TPS weights completed responses by their locally observed first-to-last nonempty output-delta duration (text, thinking and tool-call arguments); responses without reported output tokens, sufficiently long streams, or successful completion are excluded. It is a received-stream estimate, not server-side decode telemetry or whole-task throughput. No TPS is guessed from character counts, and model request latency, tool execution and approval waits are not part of its denominator.

The transcript's working indicator uses the five-pixel Step Code silhouette on a 3 by 3 grid. Execution and prose use clockwise pixel flow with an anchored center; thinking uses a slower perimeter-only orbit. Actual stream events select thinking versus execution, while an authoritative approval or Plan review takes precedence and shows a brand-gradient pause made from the six pixels in the two outer grid columns, breathing gently on a 3.2-second cubic cycle without moving. The three layers crossfade with cubic easing in one fixed icon box; reduced-motion disables flow, breathing and transitions. Total run elapsed time sits beside the existing working label without adding a new status row. Completion removes this active indicator and preserves the existing task-state footer controls. Composer bottom spacing is reduced without changing its editable area or tool-button hit targets.

While a task runs, its launch-state entry remains beside the working pulse. When idle, the retained entry shares the final response's footer row: copy, branch, elapsed time and timestamp stay hover/focus-revealed on the left, while task state stays visible on the right. Idle details unfold downward along that right edge, extending leftward within the transcript width; active details retain their pulse anchor. Expanded Goal details survive the transition from pulse to footer. A turn without a renderable response retains a standalone fallback so Goal management remains accessible.

Plan, Goal and Ultracode footer entries share one persistent trigger component with consistent height, spacing, disclosure chevron and semantic outcome colors. Their visibility does not depend on hovering the response. Each entry retains its own existing detail surface and history ownership; shared presentation does not merge task lifecycles.

Ultracode workflows also retain a right-aligned current-turn summary after the parent task ends. It displays the reported outcome and opens the matching Orchestration inspector; clicking again closes it. An unfinished snapshot after turn end is explicitly unknown, not completed or still running. The summary never arms a new send and disappears on the next unrelated user turn. Goal and workflow entries can coexist without duplicating the workflow's progress control.

Completed Goal state is historical, not a current pulse mode. Its footer anchor is derived from the active history branch's user boundary at first completion and remains there across later prompts and completed-state edits. Exact saved entry identity is preferred; an unambiguous timestamp handles in-flight inputs before identity enrichment. Missing or ambiguous ownership never attaches a completed Goal to the newest response. Only an active Goal can supply Goal-scoped Ultracode status for the current task.

The permission menu groups optional task launch controls above three upstream permission tiers: Ask, Approve for Me and Full Access. These are tool-approval policies, not thinking levels or task modes. Plan and Goal are mutually exclusive user selections; Ultracode is independent. There is no Normal mode or default task chip. Draft choices do not create a worker or history until submission. A compact icon-only control immediately to the right of permissions shows pending launch choices only; submission consumes them. Active Goal, Plan and single-task Ultracode appear beside the working pulse instead. Goal details unfold downward inline from that anchor, with matching cubic height/opacity entrance and exit rather than covering preceding conversation. Paused and completed Goals retain a quiet entry without a running dot. Plan pauses an existing active goal without deleting it, and returning from Plan does not implicitly resume it. Selected Ultracode applies to one task, or to the whole Goal when combined with Goal, without enabling native session-standing authorization. Explicit native standing commands remain separately identified. Goal controls and counters mirror the upstream active-branch snapshots, without a renderer scheduler or invented completion evaluator.

Full Access uses the native risk acknowledgment with localized presentation and unchanged upstream response values. Cancel is initially focused and Escape cancels. Session-only and remembered grants remain distinct; explicit tool deny/confirm rules still apply. A draft selecting Full Access first adopts its worker so the acknowledgment is visible before the first model request; cancellation restores the composed input without sending it. Unanswered risk requests expire after at most two minutes. Worker reconstruction and branching never replay a Full Access command or inherit a transport-local grant; the new native worker restores only its own authoritative permission state. Retired read-only, bypass and autopilot settings resolve to Ask rather than silently gaining authority. Cross-session delivery retains its separate exact-target/text approval in every tier.

Settings use one centered, fixed-size secondary window: 1060 by 740 pixels, bounded by the application viewport. All categories, including providers and archived sessions, share this shell instead of resizing it. The full application, including its titlebar and window controls, sits behind a softly blurred backdrop with a low-opacity black tint that never becomes a white veil in dark mode. The form surface stays opaque for readability. The titlebar is inert until settings finish closing. Navigation and content scroll independently. Narrow windows retain icon navigation and bounded content. The selected category has a restrained rose tint, content changes fade without moving the frame, and matching entrance/exit effects preserve the blocking layer until dismissal ends. Reduced motion bypasses dismissal animation. Switching categories keeps navigation focus and resets the content scroll position.

Artifact and web-reference entry points also close the right panel when it already shows that target. External application actions and explicit file refresh remain commands. Hiding a panel preserves its reading state, browser tabs and terminal processes. Local HTML reactivation selects its existing browser tab without reloading it; the browser refresh command remains available.

Resizable inspectors share a subtle single-line grip centered on their left boundary, with a larger invisible pointer target and no tooltip. Drag geometry follows the pointer and release snaps to existing presets; a long drag may cross multiple presets. Closing requires dragging at least 100px beyond standard width. Browser, file and terminal use standard/wide/fullscreen; context, changes and subagent use standard/fullscreen. Conversation navigation is excluded. Click opens an anchored in-app size menu; keyboard left/right expands/contracts. The browser yields its native surface while the menu is open. Reduced-motion preferences disable the settling transition.

The thinking fader animates one inherited position and resistance value for both
the thumb center and gradient fill edge. Their geometry uses the same inner
travel distance, including borders and well insets; neither element runs an
independent positional transition. Thumb deformation follows that same resistance.
Discrete stops, release-only drag submission, wheel and keyboard selection remain
unchanged. Reduced motion disables the shared transition at its source.

The composer model/effort picker remains enabled while a task runs. Choices made during execution are scoped to that worker and shown as the next-task selection; the secondary view displays a quiet "Applies next turn" state. They apply before the next fresh task, including Desktop FIFO dispatch, while steering retains the active configuration. A confirmed switch is a noninteractive client timeline note before the new response, with a 14px ArrowRightLeft icon, rose bold italic label, muted regular monospace old model, gray arrow and ink semibold monospace new model. It has no card, disclosure or tool identity. Observations persist separately from Step history and never become model context.

Session selection uses a latest-target queue in the main process. Preparing cold history does not activate it or clear unread state; only the newest prepared target may commit. The sidebar and title identify the pending target immediately, while an uncached target shows neutral transcript placeholders. Recently viewed histories may appear from a bounded, disposable, inert reading cache during reconnection. That cache never restores runtime controls or approval requests. The composer and session tools stay unavailable until an authoritative identity is installed. Loading indication appears only after a short delay; confirmed content uses a brief cubic fade and respects reduced motion. Reading position uses a persisted message anchor plus relative offset, with scroll-top fallback and user-scroll override. Background task output invalidates cached history rather than presenting cached runtime state as live.

The delayed sidebar loading ring stays fixed at 12px and cannot inherit title-span flex growth. Closing the browser preserves the shared cubic layout-reservation transition so the conversation returns smoothly. Native webpage content hides immediately because its opaque surface cannot follow the shell fade; switching to another panel still releases the outgoing reservation immediately.

The home screen and all user-facing new-session controls open a proposed session, not a runtime or sidebar entry. Global New inherits the viewed session's registered project; independent history stays independent. Project-level New selects that project. The central searchable project picker offers remembered projects, a native directory chooser for a new project and an independent-session option. Choosing a directory remembers the project without creating a conversation; canceling the chooser leaves the proposal unchanged. Leaving the proposal for an existing conversation discards it without creating history or an independent folder. The first nonempty send creates the worker and then submits the captured message once; failed delivery restores the input. Independent folders under Electron userData `workspaces/independent/` are allocated only at that point and are not project entries. Model and permission selection before sending live in the proposal, using safe model metadata from the Desktop-owned management process. The headline types from left to right with a solid block cursor; its full-width placeholder prevents layout movement, and reduced motion displays the entire text immediately. Restoring history preserves its category. The File menu opens the active session folder; the composer does not duplicate this action.

Session navigation remains available during execution. Viewing a different session does not stop or replace a running worker. Seven-pixel sidebar status dots sit in the empty gutter beneath each group icon, outside the session selection background. Titles use the original nine-pixel padding, without a second empty status slot inside the row. Running uses the transcript's rose pulse; blue means a successful background reply is unread, not merely that history completed. Opening the session clears its unread dot, and completion in the currently viewed session is already read. Unread flags belong to session IDs and survive worker recycling within the app lifetime; they are not inferred from restored history or persisted across app relaunch. Interruption/failure or approval waiting uses static yellow with distinct accessible labels. The dots have no hover tooltip. Reduced-motion disables the pulse. Successful foreground or background task completion plays the supplied camera-dial WAV once; manual stop, failure, crash and history restoration are silent. Resident-session navigation returns the main process's live worker cache immediately and refreshes full history, models, statistics and the catalog after the initial paint. Cold sessions still need worker startup. The composer, stop action, permissions and model controls belong to the viewed session; drafts, quotes, attachments and reading position survive navigation and idle-worker recycling. Background approval never opens over another conversation. A foreground approval can be deferred with Review later and reopened from an inline notice without cancelling it. Shared account/MCP changes remain guarded across all running sessions, and quitting confirms stopping every background task. Same-directory concurrent sends proceed directly without a generic confirmation.

Session workers append shared-workspace collaboration guidance through the runtime's existing system-prompt option. This preserves product and project instructions and does not alter visible user prompts. Agents are instructed to inspect Git state, re-read before narrow edits, preserve others' changes, stage only their task's paths or hunks, and ask about specific ambiguous overlaps rather than treating concurrent activity as a blocker. This is behavioral guidance, not file locking, an ownership registry, worktree isolation or automatic shared access to other conversations. Existing tool permission approvals remain unchanged.

Desktop-owned extensions expose explicit peer-session tools through a main-process loopback broker. Listing covers resident sessions in this Desktop profile, not cold history; reads return recent user/assistant prose only, never reasoning, tool payloads or images. Reads neither navigate nor clear unread status. Peer text is reference, not an instruction or authorization from the user. Sending one message always requires a source-session confirmation displaying the exact target, folder and text, even in bypass mode; read-only sources cannot send. Background confirmations stay with their source conversation and can be deferred. Accepted messages queue behind an active turn or start an idle peer; there is no cross-session interrupt, stop, broadcast or automatic reply loop. Delivery acknowledgement is not task completion. Tokens are per worker, revoked at disposal and never exposed through the renderer bridge.

Session context menus provide Copy session reference through the existing main-process clipboard bridge. The stable `stepcode-desktop://sessions/<sessionId>` reference contains no filesystem path or broker credentials. Copying does not navigate, clear unread status or require an idle agent. Peer-session tools accept either this reference or the raw session ID; the list tool returns both. This preview does not register a Windows URL handler or make the reference clickable navigation, and a reference does not grant access to another Desktop profile or revive recycled history.

Sidebar navigation follows Codex-style grouping: independent sessions appear in their own collapsible section, followed by remembered project directories with indented history rows and per-directory new-session actions. A session's history cannot create a project entry by itself. Session dates and message counts live in tooltips. Session names use the explicit name, then the first user message, in both the sidebar and title bar. Project context menus open the directory in Explorer and rename its displayed label without moving the folder. Session context menus rename, archive, copy references and branch sessions. Sidebar Branch copies the selected saved, idle session's complete persisted history through the upstream SessionManager API before loading it in a new worker, so restoring a cold source cannot append metadata to the original. It does not open/read-mark the source. The new session inherits effective permissions, keeps the same workspace, uses a unique branch name and leaves drafts and other active tasks intact. Empty, running and approval-waiting targets cannot be branched. This does not create a Git branch or isolate project files.

Independent sessions always remain the first sidebar section, followed by pinned projects and ordinary projects. Archived sessions live only in Settings > Archived, grouped by project with an independent-session group, search and project filtering. Opening an archived title does not restore it; Unarchive returns it to its saved sidebar group and manual order. Single-session and all-archive permanent deletion execute directly without a secondary confirmation. The current session, active tasks and non-archived IDs are protected; deletion unlinks validated Desktop-profile JSONL history only, never project files. Project context menus pin/unpin whole projects; the pinned heading has no add-project button. Projects always have a persisted fixed order, and reopening a project cannot promote it. Sessions default to persisted manual order; General offers manual or recently updated first without discarding the saved manual order. New sessions enter at the top of their own group without reordering older rows. Primary-button long press drags sessions within their group and projects within their pinned/ordinary section, with a compact label preview, insertion line and edge scrolling. Drag completion never activates the row. Escape cancels; Alt+Up/Down provides keyboard reordering. Switching sessions or receiving output does not disturb manual positions.

Session-operation notices occupy the second row below the window bar and center within the main conversation view, not the whole window. Content-sized neutral bubbles enter with cubic easing and follow sidebar/right-panel layout changes. Archive includes View and Undo; Undo restores the session and replaces the same bubble with normal text and a small green check, removing its actions and smoothly reducing its width without repeating the entrance. Success expires after three seconds, with hover/focus pausing. Copy and branch use the same surface. MCP warnings use an amber icon, retain the original diagnostic and provide View MCP; full diagnostic history stays in Settings. Reduced-motion skips the entrance, resize and content fade.

Windows chrome: a 46px application-owned titlebar follows the active theme. A sidebar toggle and File, Edit, View and Help menus occupy the left side; the active session title occupies the flexible drag region, capped at 300px and truncating sooner on narrow windows to leave drag space while retaining the full title in a tooltip. Runtime restart and session statistics remain available from the View menu instead of occupying a separate conversation header. The three 46px window control buttons are excluded from dragging. Window close preserves running-task confirmation. Layout content and modal overlays begin below the titlebar. The transcript fades softly into the composer; a square scroll-to-bottom control appears while the reader is away from the latest message.

The right edge has a permanent narrow tool rail, with Summary above Conversation navigation and tooltips to the left. The conversation keeps native scrolling but hides Chromium's track, replacing its visible thumb with a trackless full-height drag handle. A separate, fixed-pitch user-turn ruler follows the reading position and fades distant turns. Marks preview the turn on hover/focus and scroll to it on click. A navigation panel lists those turns with the original user-message timestamp always visible below each preview, aligned right, using local month/day and 24-hour time. Missing or invalid timestamps are omitted, not replaced by the current clock. A summary panel reserves the same space but has no invented summary data yet. Wide windows allocate layout width for an open panel, while narrow windows overlay it. The existing tool details panel uses that slot instead of stacking another panel.

Developers use this tool through long work sessions under changing ambient light. Appearance settings group six palettes into Classic / Light and Shadow (天光初霁, 素笺留白, 星河未眠) and Color / Between Mountains and Seas (沧海夜航, 绛夜微醺, 翠林听雨). Plain color labels remain beneath each name. The user-approved concept swatches guide the cool morning light, neutral paper, cold gray night, ocean blue, muted wine and forest green palettes. System follows the OS between Light and Dark; explicit palettes ignore OS changes. Small interface previews show each palette's sidebar, canvas and interaction color. Typography remains independent below the palette controls.

The original neutral white and charcoal palettes remain available as two compact swatches to the left of System. They use the same persistence, first-frame bootstrap and independent accent controls without adding cards to the six named palettes.

Accent selection is independent of palette selection and persists across restarts and palette changes. Preset swatches and an inline, downward-expanding color picker accept an opaque HEX color. The picker previews the application while editing; Apply saves, while Cancel, Escape or leaving Appearance restores the saved color. Reset restores the active palette's accent, not the typography. Stored colors retain the user's original HEX; displayed accent text is tone-adjusted to at least 4.5:1 against the palette's three main surfaces, with contrasting foregrounds on solid accent buttons. Transcript links, generic website icons and link-preview open actions share that accent, including visited links; website favicons and external page contents remain unchanged. Success, warning, error, diff and the existing working-line brand gradient remain separate semantic roles. This does not claim contrast compliance for every pre-existing UI element.

The main process resolves palette and accent before the preload/bootstrap paints, and the renderer, terminal and themed tray consume the same palette. Preference validation rejects arbitrary CSS values. Paper references the supplied [StepFun page](https://calm-willow-a44c.page.stepcloud.com/) and [OpenChamber](https://github.com/btriapitsyn/openchamber)'s warm light theme; colored families reference [Oh-DSH's skin tokens](https://github.com/hust-open-atom-club/oh-dsh/blob/main/plugins/skins/src/skins.ts). Transparent tint blends use sRGB to preserve hue in the current Chromium renderer.

Use neutral white and charcoal surfaces, a restrained rose primary for active commands, and green/amber/red status colors. System sans-serif, monospace for code, zero letter spacing, 13-15px controls and body text. Sidebar and conversation dimensions follow the layout refinement below. Collapse navigation on narrow windows. Controls use Lucide icons, labels and tooltips. No nested cards or decorative gradients.

Disclosure indicators use the custom SVG in `Desktop/src/DisclosureChevron.tsx`: a fixed 14px canvas, 1.5px rounded stroke and theme-inherited color. Use this asset for new expand/dropdown controls rather than text glyphs or solid triangles. Direction changes should rotate the same geometry, not substitute another icon. Native selects can retain their native menu while replacing the closed control's indicator.

The diff inspector's source and base pickers use Electron native radio menus, with the custom disclosure SVG on their triggers. Keep Branch selectable outside Git; explain the unavailable comparison inside the panel rather than disabling the option or forcing Last turn.

Context, Changes and Conversation navigation share the `right-panel-header` visual primitive: 52px height, 20px left/12px right padding, 13px semibold title and 26px close/action buttons. Navigation follows Context's 344px full-height neutral inspector surface and divided, unframed rows; code diffs retain their wider reading surface. Wide layouts consume the existing right gutter before reserving space. Narrow inspectors are nonmodal, leaving visible transcript and composer controls interactive. Navigation retains cubic enter/exit, its right-rail anchor, trackless scrolling and original per-turn timestamps. Summary retains its separate hanging-board treatment.

Inspection-oriented right panels share a header expand/restore control. Context and Changes expand leftward across the main view while retaining the window bar, sidebar and right rail; this is not native window fullscreen. Both directions use 260ms cubic width transitions, disabled during native window resizing and under reduced motion. Expansion preserves the mounted content, filters, disclosures and reading position where the resized scroll range permits. Context uses a centered, bounded reading surface and two-column statistics when space permits. Covered conversation controls are inert. Escape first restores the inspector and returns focus to its expand control; closing or switching tools clears expansion. Future inspection tools should reuse this convention. Conversation navigation deliberately has no expand control, and its row backgrounds and pointer targets span the full panel width with padding inside each row. Summary remains outside this convention.

Reference: https://github.com/openchamber/openchamber (MIT), README chat screenshot and workspace organization. No OpenChamber branding or runtime copied.

Layout refinement: sidebar 244px (224px compact, 260px wide), matched 62px navigation/header rhythm. Workspace and session groups form a continuous navigation stack. Transcript and composer share a 920px outer column with identical 32px gutters (1000px/36px on wide windows). User messages are right-aligned and content-sized; assistant output uses the reading column. Composer starts compact and grows to 180px with text. Runtime connection status appears only in the sidebar. Asset redesign is intentionally deferred.
## Conversation Presentation

User and assistant messages do not show role headings. User message copy/edit controls and the timestamp appear below the bubble on hover or keyboard focus, reserving their layout space. Edit restores a copy of the message and its images into an empty composer for sending as a new message; it does not rewrite, rewind or fork runtime history. Existing drafts are not overwritten.

Responses group consecutive assistant and tool messages until the next user message for a shared footer, not for hiding prose. All assistant narration remains visible in source order during execution and after completion; no last-message heuristic extracts a final answer. Tool summaries describe the action in the client language instead of exposing raw tool names and commands. Known built-ins and aliases have localized action labels; unknown tools retain their names without invented descriptions. Running summaries have an oblique label and a left-to-right shimmer; only a tool's final result stops that animation and smoothly restores upright text. Failed summaries are upright and red; missing results are explicitly distinguished from success. Reduced-motion disables shimmer and transition effects. Raw names, targets, inputs, outputs and completion status stay in the individual expanded details, with results matched by tool-call ID rather than completion order. Thinking and tool disclosure defaults follow Interface Complexity settings, including while streaming; later prose, completion and interruption do not override a manual disclosure choice. Narration and tool summaries remain visible, with consecutive ordinary summaries optionally combined into an expandable group. The footer has Copy and Branch from here, enabled only for the latest saved assistant reply while its session is idle, with the actual message timestamp shown on hover/focus. Copy includes all response prose, excluding thinking and tool payloads. No per-response model policy or invented duration is implemented.

## Mathematical Notation

Conversation text and thinking blocks render `$...$` inline math and `$$...$$` display math using remark-math and KaTeX. Same-line double-dollar expressions also use display layout. KaTeX CSS and fonts ship locally for offline use. Display formulas center within the reading column; oversized formulas start at the left and scroll horizontally without expanding the conversation width. Inline code and fenced code remain source, including fences labeled `math`.

Unclosed streaming display formulas remain source until their closing fence arrives. Invalid formulas retain readable source without breaking surrounding Markdown. Single-dollar price pairs such as `$20 and $30` remain text; ambiguous dollar signs can be escaped as `\$`. Formula inputs and macro expansion are bounded, and trusted HTML, external image and link commands are disabled. This is mathematical notation rendering, not full LaTeX document compilation.

## Composer Attachments

### Pending Sends

During a running turn, sending queues an editable Desktop-owned draft. New composer content continues queueing; Enter with an empty composer and no quotes or attachments steers the oldest undelivered draft. The main process selects that item atomically, rather than depending on a possibly stale renderer list. Per-item controls can explicitly steer a different draft. Shift+Enter, IME confirmation and held Enter do not steer. Steering is upstream boundary delivery, not forced interruption.

The 30px queue trigger shares the existing composer context row with quotes, live changes and return-to-bottom. A 200ms hover or click reveals an upward anchored list. Long messages open a scrollable full view and inline editor in that same surface. Edit preserves quote and attachment payloads without replacing the composer draft. Enter/exit, internal view changes and live-diff relocation use cubic motion with reduced-motion support. Closing the last queue item returns the diff to its centered position; remaining items retain the shifted layout.

Queues are worker-scoped and held in memory in the main process, not in the model history until delivery. Completion drains FIFO; failures or stopping pause undelivered drafts. Renderer reload and conversation switching retain queues, but application exit does not persist them.

Steering immediately moves the selected draft out of the queue chip into a right-aligned transcript receipt below the ongoing response and its working indicator. The receipt preserves the normal user-message/quote presentation and adds a small pulsing "Sent / Awaiting agent" status. RPC acknowledgement alone does not remove it: the matching upstream user-message event replaces it with authoritative history, after which subsequent agent output follows that user message. Receipts survive renderer reload and session switching without inventing model history. Stopping or disconnecting displays a static waiting/unconfirmed status rather than claiming delivery. While the queue docks the live-diff trigger at the right, its popover right-aligns with that trigger and opens leftward into the main view; the centered mode remains centered. Open popovers follow the trigger through its cubic relocation.

The composer accepts file selection, pasted images and file drops. PNG/JPEG/WebP images are inline model inputs; other regular files are explicit local path references for runtime tools, not natively parsed document inputs. The limit is ten attachments including five images, with 10 MiB per image and 50 MiB per other file. File paths remain behind opaque IDs in the main process.

Composer thumbnails and transcript images share an anchored image preview: cubic expansion from the thumbnail and return on close, drag panning, cursor-centered Ctrl+wheel zoom, keyboard focus return and reduced-motion support. Obvious preview controls and hover-only removal buttons have no tooltip. Image context menus follow the client language: Copy/Save As in the preview and composer; Add to chat/Copy image/Open in Explorer/Download a copy in the transcript. Explorer uses a reusable desktop-owned image cache under userData `cache/image-previews/`, with one replaceable file per image format, separate from configuration and runtime data. The cache is rebuildable, not a permanent image archive; explicit save actions use a native save dialog.

## Window Lifecycle

Closing the main window hides it to the Windows tray without stopping Agent tasks, queued messages, terminal processes or browser tabs. The tray uses the product icon and supplies Open and Quit in the selected language. Clicking it or launching another instance restores the existing window. File > Quit application and tray Quit perform the existing confirmed shutdown and wait for runtime/terminal cleanup; cancellation keeps the application available. A failed tray creation falls back to the explicit shutdown path instead of hiding an unreachable window. Windows session end does not request interactive task confirmation.

The tray's right-click menu is an application-rendered, transparent utility window, not a Windows native context menu. It reuses AppMenu styling and theme variables with cubic enter/exit, reduced-motion support, keyboard navigation and Escape/blur dismissal. Placement uses Electron's device-independent screen work area to remain within the selected monitor. It never appears in the taskbar. A sandboxed, sender-validated dedicated preload exposes only menu state and Open/Quit/Dismiss, not the main Desktop bridge.

Explicit Quit opens an application-themed modal when scheduled tasks, running
tasks, active Goals or session transitions need review. It names each reason
before explaining the consequence. Cron alone is not called a running task.
Temporary jobs are lost on exit; durable records remain without promising
automatic resumption. Unknown Cron state is disclosed rather than counted as
zero, and shared durable records are counted once per project and job identity.
Cancel quit is the default focus; explicit Quit never offers hide-to-tray.
The main process owns a versioned confirmation request, rechecks reasons before
acceptance and retains it across renderer reloads. The modal contains keyboard
focus, blocks embedded browser views and respects reduced motion. Ordinary
window close still hides to tray; Windows session end does not await a decision.
Only a crashed renderer falls back to a native warning, using the same reasons
and cancel-first decision so an unavailable UI cannot trap explicit Quit.

## Embedded Terminal

The right rail provides a user-operated Windows terminal using xterm.js and a real PowerShell PTY. It is separate from Agent shell tools, messages, approvals and credentials. Terminal output is not sent to the model. The shell runs with ordinary current-user filesystem permissions, without PowerShell profiles, persisted personal command history or history predictions. Its inherited environment uses an explicit case-insensitive allowlist of system paths, user directories, locale and terminal settings; unrecognized variables, including credential forms, are not inherited. This is environment isolation, not a filesystem sandbox or a restriction on credentials the user explicitly supplies to the shell.

Terminal tabs belong to their initial working directory. Conversations in the same project share those tabs; independent conversations have distinct directories. Changing the shell's directory does not reassign a tab. Collapsing the panel or switching conversations leaves commands running. Explicit tab close and application exit terminate the terminal process tree and wait for host exit confirmation. Failed termination retains the tab and ownership for a retry rather than reporting successful closure; application exit is blocked with an error when terminals cannot be stopped. Exited tabs keep their output until closed; closing the last tab does not create another automatically. Tabs and processes do not persist across application restarts.

The terminal uses the shared right-panel header, main-view fullscreen/restore, cubic enter/exit transitions and a trackless scrollbar. Clipboard actions cross the preload bridge. Ctrl+C copies a selection, otherwise interrupts the shell; Ctrl+Shift+C/V and Ctrl+V use explicit clipboard actions. Escape inside terminal input is reserved for the shell. Terminal-generated clipboard writes and hyperlink activation are disabled.

## Embedded Browser

The right rail includes a user-operated browser, separate from Agent tools. A sandboxed WebContentsView owns each tab; no Desktop preload, Node access or IPC bridge is injected into web pages. Tabs share an isolated persistent `desktop-browser` partition, never the application's default session or runtime credentials. Cookies and website storage persist in this Desktop profile; tabs themselves are app-lifetime only. Changing conversations and collapsing the panel retain tabs, while explicit tab close and application shutdown close their WebContents.

The browser uses the shared right-panel header, cubic transitions, bounded narrow-window overlay and main-view fullscreen/restore. Native page bounds follow the animated viewport, and the page is hidden while renderer settings, approvals, image previews, context menus, titlebar menus or the narrow sidebar are in front. Its own toolbar supplies URL entry, back/forward, reload/stop, native popup links as new tabs, explicit system-browser opening and zoom. Twelve tabs are allowed globally. HTTP, HTTPS and the internal blank tab are supported; local files, executable URL schemes and URL credentials are rejected. Local development previews use a localhost HTTP server. Downloads use the native save dialog; camera, microphone and other requested website permissions are denied. Website appearance is not rewritten to match the Desktop theme.

This is not a full browser replacement or an Agent browser integration. No Playwright dependency, MCP registration, remote debugging endpoint or model access is added. Attaching Agent tools to these same tabs is a separate future feature.

Browser and Terminal offer Standard, Wide and Fullscreen widths through native header menus. Standard retains the existing width; Wide uses approximately 60% of the available main view while leaving at least 480 pixels for the conversation when docked. Narrow overlays converge Standard and Wide rather than squeezing the conversation further. Fullscreen/restore retains the previous non-fullscreen width. Their selection survives panel and conversation switches within the renderer lifetime, but is not persisted across relaunch/reload. Width changes use the existing cubic animation, with the native page following the measured viewport. The compact trigger includes its layout icon, label and shared DisclosureChevron in one hit area. Chinese uses an 84-pixel trigger; English retains 126 pixels for its longer labels. An Electron native menu opens above the WebContentsView without hiding or reloading the page.

## File Preview and Opening

Web references open in the built-in browser by default; their hover preview retains an explicit external-browser action. Artifact references and delivery cards share the same opening path. HTML opens as an isolated local browser preview; Markdown opens rendered and can switch to source, while supported text/code files open read-only with syntax highlighting, wrapping, copy and refresh controls.

File Preview is an independent right-rail tool with an empty state and a native Windows file chooser. It offers Standard, Wide and Fullscreen through an application-styled anchored menu. The last Standard/Wide preference survives relaunch; fullscreen restores that underlying preference. Narrow overlays retain a bounded width. Its width, fullscreen/restore and enter/exit use the existing cubic right-panel transitions. Opening a file does not attach its contents to the conversation or give the model access to it. Renderer requests carry a workspace-scoped reference or opaque file permission, never unrestricted filesystem reads.

The split opening control uses the shared DisclosureChevron and an application-rendered anchored menu, not a Windows popup. Choices include the internal destination, system default application, recommended Windows applications registered for the extension, and the native other-application picker. Selecting a destination opens once; the main half displays the selected application's icon/name and opens it again when clicked. Successful explicit choices are stored by file extension in Desktop preferences and restored across panels, conversations and relaunch. Labels and icons are read from current associations rather than persisted images; an unavailable application falls back to the internal destination. The other-application picker remains a one-time command because Windows does not return the chosen handler identity. No system file association is changed. Executables and shell/script execution types remain excluded from external opening.

Both application menus have matching light/dark surfaces, trackless scrolling, bounded anchor placement, cubic entrance/exit, keyboard navigation, Escape/outside-click dismissal and reduced-motion behavior.

Local HTML uses an ephemeral, credential-free browser partition and a loopback server with unpredictable page URLs. Only the selected HTML and its bounded, declared same-directory asset graph are served, including CSS and literal module dependencies. Root-relative declared assets are rewritten into the page's capability URL; source files are unchanged. Sensitive paths, arbitrary neighboring files, downloads, external network requests, permissions and Node/IPC access are blocked. This is a constrained offline artifact preview, not a general local web server: pages depending on remote APIs/CDNs should be explicitly opened in a system application instead.

## Interface Complexity

Interface complexity is a dedicated Settings category, separate from typography.
Simple, Standard and Detailed are presentation presets, not permission or model
capability tiers. Simple folds consecutive thinking and ordinary tools into
one process row between prose segments and hides the performance strip.
Its live row shows the current tool or latest thinking preview; its settled
row summarizes the actual tools, with all original records available inside.
Standard folds thinking and groups adjacent ordinary tools while keeping
the performance strip visible. Detailed keeps individual tool rows and opens
thinking only while that block is receiving output, folding it when a tool,
prose or turn completion follows. All presets fold tool details. Each option is
independently customizable, with manual changes retaining the Custom label.
The default for missing preferences is Standard. Settings are stored in the
Desktop profile, not browser localStorage or the personal Step Code profile.

Main conversations and saved-reading previews use the same presentation.
Manual disclosure choices survive subsequent streaming/snapshot updates.
Choosing any preset (including the active one), resetting or changing a custom
option reapplies the current defaults to already mounted historical records.
Only disclosure state is reset; prose and runtime state are not remounted.
Ordinary tool groups never cross thinking boundaries; compact process groups
can contain both thinking and tools. Neither crosses prose, image or turn
boundaries. Approval, error, missing-result,
Subagent, Workflow, Plan, structured questions and peer-delivery records remain separate. Group
summaries count actual operations without model-generated narration or inferred
validation success. Partial tool output remains pending until the final event.
Expanding a group retains its trigger and uses cubic motion with a reduced-motion
fallback. Dedicated right-panel inspectors retain their existing detailed view.
Single-line thinking previews use the latest nonempty paragraph's first line
while live and the first paragraph's first line when settled. Markdown emphasis
markers are omitted only from previews. Automatic completion folding never
prevents readers from manually reopening a settled thought.
Thinking and tool rows share the same live/settled label component and shimmer.
Thinking uses a 14-pixel Brain icon before its label, preserves elapsed time,
and places the existing designed disclosure SVG after its preview. Running
labels animate independently, so a live process group never reanimates its
already-settled children. Reduced motion disables both shimmer and disclosure
transitions.

# Product Icon

The canonical product icon is `Desktop/public/StepCode.svg`, copied unchanged from the user's StepCode.svg artwork. Use it for all product identity surfaces. `Desktop/scripts/icons.mjs` generates the Windows ICO from this asset during build/dev. Do not replace it with a terminal glyph or the default Electron icon. The sidebar begins with navigation, without a duplicate brand header.
