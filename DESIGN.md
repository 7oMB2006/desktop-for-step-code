# Design System

The home screen and global new-session action always start an independent session. Each gets a unique working folder in Electron userData `workspaces/independent/`; this folder is not a project entry. Directory-level new-session controls start project sessions. Restoring history preserves its category. The File menu opens the active session folder; the composer does not duplicate this action.

Sidebar navigation follows Codex-style grouping: independent sessions appear in their own collapsible section, followed by remembered project directories with indented history rows and per-directory new-session actions. A session's history cannot create a project entry by itself. Session dates and message counts live in tooltips. Session names use the explicit name, then the first user message, in both the sidebar and title bar. Project context menus open the directory in Explorer and rename its displayed label without moving the folder. Session context menus rename and archive sessions; archived sessions remain available for restore. Copy and branch actions are reserved placeholders.

Windows chrome: a 46px application-owned titlebar follows the active theme. A sidebar toggle and File, Edit, View and Help menus occupy the left side; the active session title occupies the flexible drag region, capped at 300px and truncating sooner on narrow windows to leave drag space while retaining the full title in a tooltip. Runtime restart and session statistics remain available from the View menu instead of occupying a separate conversation header. The three 46px window control buttons are excluded from dragging. Window close preserves running-task confirmation. Layout content and modal overlays begin below the titlebar. The transcript fades softly into the composer; a square scroll-to-bottom control appears while the reader is away from the latest message.

The right edge has a permanent narrow tool rail, with Summary above Conversation navigation and tooltips to the left. The conversation keeps native scrolling but hides Chromium's track, replacing its visible thumb with a trackless full-height drag handle. A separate, fixed-pitch user-turn ruler follows the reading position and fades distant turns. Marks preview the turn on hover/focus and scroll to it on click. A navigation panel lists those turns; a summary panel reserves the same space but has no invented summary data yet. Wide windows allocate layout width for an open panel, while narrow windows overlay it. The existing tool details panel uses that slot instead of stacking another panel.

Developers use this tool through long work sessions under changing ambient light. Follow the system theme, with explicit light/dark overrides.

Use neutral white and charcoal surfaces, a restrained rose primary for active commands, and green/amber/red status colors. System sans-serif, monospace for code, zero letter spacing, 13-15px controls and body text. Sidebar and conversation dimensions follow the layout refinement below. Collapse navigation on narrow windows. Controls use Lucide icons, labels and tooltips. No nested cards or decorative gradients.

Reference: https://github.com/openchamber/openchamber (MIT), README chat screenshot and workspace organization. No OpenChamber branding or runtime copied.

Layout refinement: sidebar 244px (224px compact, 260px wide), matched 62px navigation/header rhythm. Workspace and session groups form a continuous navigation stack. Transcript and composer share a 920px outer column with identical 32px gutters (1000px/36px on wide windows). User messages are right-aligned and content-sized; assistant output uses the reading column. Composer starts compact and grows to 180px with text. Runtime connection status appears only in the sidebar. Asset redesign is intentionally deferred.
## Composer Attachments

The composer accepts file selection, pasted images and file drops. PNG/JPEG/WebP images are inline model inputs; other regular files are explicit local path references for runtime tools, not natively parsed document inputs. The limit is ten attachments including five images, with 10 MiB per image and 50 MiB per other file. File paths remain behind opaque IDs in the main process.

Composer thumbnails and transcript images share an anchored image preview: cubic expansion from the thumbnail and return on close, drag panning, cursor-centered Ctrl+wheel zoom, keyboard focus return and reduced-motion support. Obvious preview controls and hover-only removal buttons have no tooltip. Image context menus follow the client language: Copy/Save As in the preview and composer; Add to chat/Copy image/Open in Explorer/Download a copy in the transcript. Explorer uses a reusable desktop-owned image cache; explicit save actions use a native save dialog.

# Product Icon

The canonical product icon is `Desktop/public/StepCode.svg`, copied unchanged from the user's StepCode.svg artwork. Use it for all product identity surfaces. `Desktop/scripts/icons.mjs` generates the Windows ICO from this asset during build/dev. Do not replace it with a terminal glyph or the default Electron icon. The sidebar begins with navigation, without a duplicate brand header.
