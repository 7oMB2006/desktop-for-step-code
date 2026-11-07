# DFSC Theme Marketplace (Local Preview)

This is a local-first marketplace fixture for the new DFSC theme host. Existing
released clients can install its files but cannot activate the theme. It is not
an upstream terminal theme, MCP service, or executable plugin.

## Try It

Use a DFSC build containing this change. In Plugins > Marketplaces, add the
absolute path of this `theme-marketplace` directory. In Discover, install
`stellar-cruise`, then select 星辰巡航 under Appearance > Theme packs.
Installation never changes the selected theme automatically.

The workspace shares one scene across welcome and conversations. Conversation
entry lowers its brightness, speed and parallax without remounting it. Host-owned
graphite materials with restrained pencil-like details cover the sidebar,
composer, inspectors and dialogs; code and
tool output retain dark reading surfaces. Switching to a built-in theme releases
the scene and removes the material scope.
The background can be frozen in Appearance and respects reduced-motion and document
visibility. Removing the active pack restores Original Dark. No audio
visualization is included.

## Format, Version 1

- `.step-plugin/marketplace.json`: existing marketplace catalog format.
- `step.plugin.json`: existing plugin identity, version, description and PNG icon.
- `dfsc.theme.json`: DFSC-only schema version, display name, renderer, palette and scene filename.
- `scene.json`: numeric point-cloud data for the host-owned `stellar-v1` renderer.

Only `stellar-v1` is implemented. This is **not** a generic HTML, shader or JS
extension API. Its host-owned graphite surfaces currently support only
`scheme: "dark"`; light packs are rejected until scheme-aware materials exist.
The host ignores executable entries and never evaluates data as
code. Theme packages have no Node, network, filesystem or IPC access. The main
process reads bounded JSON files from the Desktop-owned plugin directory,
rejects symlinks and invalid geometry, validates text contrast, and returns only
validated data through installed-theme read-only IPC requests.

Optional `author` (up to 80 characters) and `cover: "cover.png"` metadata supply
the Appearance listing. The PNG cover is limited to 512 KiB and 1920x1080;
missing or invalid covers do not disable a valid theme. Posters are fetched
separately from snapshots. Hover or keyboard focus previews the installed scene;
motion and brightness controls appear inline for the selected pack.

Palette fields: `bg`, `side`, `surface`, `ink`, `muted`, `border`, `code`, `accent`.
All use six-digit hex colors; text contrast is checked against the four surfaces.
At most eight valid packs are loaded from the first 128 sorted plugin folders.
Invalid or unsupported packs remain installed but do not appear in Appearance.
Installed plugin files are refreshed on app startup and marketplace mutations;
editing their files while the app is running is not a supported update flow.

## Artwork

The original Wallpaper point clouds and host renderer were adapted without
changing the existing Wallpaper or published Workshop files. Dragon references
come from the project-provided storyboard 03; duck data comes from the approved
rear-right storyboard artwork. The references include AI-assisted generation.
The icon is the approved wallpaper preview. No font files are distributed.
Artwork and brand permissions are not granted by the renderer's code license.
Public distribution remains a separate author decision.

The renderer uses Three.js, whose license is copied by the Desktop build.
`Desktop/scripts/import-stellar-art.mjs <original-Wallpaper-directory>` reproduces
the JSON conversion without evaluating the original artwork's JavaScript.
