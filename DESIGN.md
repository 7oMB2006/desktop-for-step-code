# Design System

The home screen and global new-session action always start an independent session. Each gets a unique working folder in Electron userData `workspaces/independent/`; this folder is not a project entry. Directory-level new-session controls start project sessions. Restoring history preserves its category. The composer provides access to the working folder.

Sidebar navigation follows Codex-style grouping: independent sessions appear in their own collapsible section, followed by remembered project directories with indented history rows and per-directory new-session actions. A session's history cannot create a project entry by itself. Session dates and message counts live in tooltips.

Windows chrome: a 36px application-owned titlebar follows the active theme. Identity and empty titlebar space are native drag regions; the three 46px window control buttons are excluded from dragging. Window close preserves running-task confirmation. Layout content and modal overlays begin below the titlebar.

Developers use this tool through long work sessions under changing ambient light. Follow the system theme, with explicit light/dark overrides.

Use neutral white and charcoal surfaces, a restrained rose primary for active commands, and green/amber/red status colors. System sans-serif, monospace for code, zero letter spacing, 13-15px controls and body text. Sidebar 256px, conversation maximum width 880px, optional details 340px. Collapse navigation on narrow windows. Controls use Lucide icons, labels and tooltips. No nested cards or decorative gradients.

Reference: https://github.com/openchamber/openchamber (MIT), README chat screenshot and workspace organization. No OpenChamber branding or runtime copied.

Layout refinement: sidebar 244px (224px compact, 260px wide), matched 62px navigation/header rhythm. Workspace and session groups form a continuous navigation stack. Transcript and composer share a 920px outer column with identical 32px gutters (1000px/36px on wide windows). User messages are right-aligned and content-sized; assistant output uses the reading column. Composer starts compact and grows to 180px with text. Runtime connection status appears only in the sidebar. Asset redesign is intentionally deferred.
# Product Icon

The canonical product icon is `Desktop/public/StepCode.svg`, copied unchanged from the user's StepCode.svg artwork. Use it for all product identity surfaces. `Desktop/scripts/icons.mjs` generates the Windows ICO from this asset during build/dev. Do not replace it with a terminal glyph or the default Electron icon. The sidebar begins with navigation, without a duplicate brand header.
