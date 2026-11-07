# DFSC Theme Packs: First Local Version

## Current-main integration (2026-11-07)

The host integration is isolated on `codex/stellar-theme-host`, based on main
`ff2f3b02f107824d87426f6d1940139921c7f223`. The original design-preview
worktree is unchanged. Current plugin-center navigation, MCP request guards,
model favorites, full-text search and background-agent behavior are retained.
Old preview-only model-picker and quote/queue keyboard changes are excluded.

Verified in the integration worktree:

- Frozen-lockfile dependency installation, TypeScript checking and the full
  production build pass. Build output retains existing large-chunk warnings.
- 46 focused theme, fixture, navigation and search tests pass. Marketplace
  installation/removal uses an isolated profile and the prepared v017 runtime
  via `DESKTOP_TEST_RUNTIME`, not personal Step Code data.
- Adjacent host regression tests: 92 passed, one native full-text-index test
  skipped. CI inventory/policy tests: 15 passed.
- Browser navigation acceptance passes, including draft and reading-position
  restoration.
- Status coverage passes across Stellar/original palettes, 40/120 percent
  brightness and 1440/390 widths. This run uses `--standalone`, with no claim of
  comparison against a historical baseline.
- Composition checks pass with decoded pixels: preserved wide composition,
  nonblank narrow scenes, sidebar recomposition, live motion, motion-off and
  reduced-motion stability. Desktop and narrow screenshots were inspected.
- Production main/preload/renderer Electron acceptance passes: install without
  activation, select, persist brightness/motion, restart with the theme on the
  first frame, then uninstall and return to Original Dark.
  The Electron executable and prepared runtime were reused read-only from an
  isolated v017 QA environment; this is not installer/package acceptance.

The native verifier uses `dist/main.cjs` and the built renderer, never a running
preview server. `DESKTOP_VERIFY_EXE` can select a prepared Electron executable;
`DESKTOP_TEST_APP_CWD` can point to a directory containing a prepared `runtime`.
Every run creates its own user-data directory under the evidence directory.

Outstanding release gates: current-head cloud CI, native macOS and packaged
installation acceptance, and explicit artwork redistribution terms for the
sample theme. No marketplace submission, automatic update, release or merge is
included. Historical checks below describe the earlier preview, not additional
current-main verification.

## Scope

DFSC-only declarative appearance plugins, distributed through the existing Step
marketplace adapter. No upstream runtime patch, executable plugin entry, remote
asset fetch, arbitrary CSS, shader, or JavaScript contribution is introduced.

The host owns the `stellar-v1` renderer, adapted from the existing Wallpaper
scene. The package supplies the original dragon and duck point clouds, its
palette, and metadata. The standalone Wallpaper and published Workshop artifacts
are unchanged. Other scene engines require a reviewed host implementation.

## Lifecycle

1. Install using the existing plugin marketplace workflow.
2. The main process validates installed theme data and registers valid palettes.
3. Appearance lists the new theme; installation does not activate it.
4. Selecting the theme saves its stable `plugin:<folder>` ID.
5. Installed, validated themes expose numeric scene data and optional PNG posters
   through the typed preload bridge, including for Appearance previews. No local
   path crosses the bridge.
6. The workspace mounts one lazily imported scene. Session navigation preserves
   the canvas; conversation mode uses 20fps, lower speed/parallax and 82% of the
   selected brightness. Welcome uses 30fps. Host-owned matte graphite materials scope
   sidebar, composer, panels and dialogs. Gold/cyan artwork stays unchanged;
   accent color is reserved for interactive and semantic cues. Reading panels,
   drawers, menus and code/tool surfaces remain opaque.
   Switching to a built-in releases the scene and clears the material scope.
7. Appearance separates theme packs from built-in palettes, with poster, author,
   version and active state. Hover/focus mounts a live preview; leaving releases
   it. Motion and brightness (40-120 percent) are persisted preferences.
   Motion can be frozen, respects reduced motion, and stops while the document
   is hidden. Opening Settings also suspends the underlying workspace and
   welcome emblem without destroying their scenes; the hovered/focused card
   preview remains independent. Resizing and preference changes are applied
   when the workspace resumes, without accumulating elapsed animation time.
   While loading and on WebGL failure, the workspace shows the
   validated cover with the selected brightness. Packs without a usable cover
   retain their solid palette. Successful context restoration resumes the scene.
8. Uninstalling or finding a missing/invalid active pack at startup restores
   Original Dark and clears the accent override.

The authoritative main-process palette and installed-theme metadata reach the
preload before first paint. This avoids a default-palette flash on relaunch.

Invalid packs are excluded from Appearance, but remain visible as installed
plugins. A dedicated per-theme diagnostic UI is not included in this first
version. Automatic installed-plugin updates are also outside this change.

## Verification (2026-11-03)

- TypeScript typecheck passed.
- Renderer production build and main/preload esbuild compilation passed.
- 28 focused tests passed: theme and cover validation, brightness bounds, existing palette behavior, marketplace
  commands and resource ownership, and real runtime-backed add/install/remove
  through `CapabilityService`.
- Browser tests passed at 1440x960 and 390x844: nonblank colored canvas,
  animation, motion-off, reduced-motion and no horizontal overflow. Workspace
  checks cover retained canvas identity across session navigation, simulated
  send/stop, panel views, persisted brightness, and cleanup on built-in selection.
  The isolated fixture separately tests component unmount/disposal.
- The welcome emblem adapts the Release060 closing logo's SVG sampling,
  coherent particle motion and two-pass glow. It is host-owned, welcome-only,
  and falls back to the original SVG if WebGL fails. Browser checks cover
  colored pixels, animation, motion-off, reduced motion, context loss/recovery,
  built-in theme restoration and the project search field's focus clearance.
- Isolated Electron acceptance passed: actual marketplace install, activation
  through Appearance, loaded poster, persisted motion and brightness preferences, relaunch with plugin palette
  on first paint, and uninstall fallback.

The runtime was reused read-only from the existing D: staged v0.1.6 overlay.
Electron acceptance used an isolated D: profile and an offline fixture provider;
no personal profile, account, or model request was used. This does not establish
installer, macOS, real-model, public marketplace, or release readiness.

### Local finishing checks (2026-11-04)

- Host-owned action colors and focus indicators follow the selected accent;
  the scene and decorative materials retain their gold/cyan identity.
- Reading-surface masks affect only the background. The built-in composer's
  opaque fade is disabled only for stellar materials. The emblem remains 48x48.
- The real workspace fixture includes independent permission, Plan and question
  sessions. Native drawers support later/reopen, deny/approve, Plan refinements,
  and multi-page answers. Responses modify only in-memory fixture history.
- 38 focused tests cover palettes, packs, approval parsers and sample protocols.
  Browser finishing checks cover context loss/restoration, failed scene loading,
  accent changes, drawer completion and unclipped textarea focus at 1440, 760
  and 390 pixel widths. These are offline checks, not real-model acceptance.
- Settings idle checks observe zero additional background/emblem draw calls
  while the card preview animates. Closing Settings retains the original
  canvases and WebGL context. Covered resize, motion-off, reduced-motion,
  context loss/restoration and conversation resume also pass. This measures
  rendering activity, not GPU power consumption or native Electron performance.
- Navigation materials now cover the turn list, file, browser, terminal and
  subagent panel shells as well as Summary, Context and Changes. Their shared
  headers retain the gold/cyan palette; content and semantic status colors are
  unchanged. Sidebar/rail selection uses accent outlines, and keyboard focus
  stays inside clipped controls without changing their size.
- Local navigation checks exercise five available fixture panels, expanded
  Summary tasks, custom accents, keyboard focus, reduced motion, narrow layouts
  and restoration of Original Light. Native browser/terminal execution and
  subagent workflows are not exercised by this browser fixture.
- Compact workspace composition keeps both dragon silhouettes inside the tool
  rail and reserves the composer area. It accounts for the actual docked sidebar,
  and updates on sidebar resize without replacing the canvas. The new composition
  blends in between 1050 and 900 pixels; wide scenes and theme-card previews keep
  their existing artwork. The emblem's 48x48 footprint remains unchanged.
- 42 focused tests pass, including four composition geometry cases. Browser
  composition checks compare the 1440x960 render pixel-for-pixel with the original,
  verify both dragon point clouds remain in frame at 390, 760 and 900 pixels,
  and exercise sidebar toggling, motion-off, live motion and reduced motion.
  Welcome/chat screenshots additionally cover the short 900x620 window.

## Matte Materials (2026-11-05)

- Replaced cyan gradients and luminous outlines on the composer, user bubbles,
  inspectors, approval drawers, menus and settings with neutral graphite planes.
  The package palette also supplies neutral nested surfaces, text and borders.
  Header/body/footer separation uses luminance, not colored glass or new geometry.
  Scene artwork, the 48x48 emblem and custom accent behavior are preserved.
- `verify-theme-materials.mjs` is a local-only, self-hosted Vite/Chrome check.
  It captures 15 cases, checks opaque neutral reading fills, main/secondary text
  contrast, narrow-window bounds, textarea focus, accent and reduced motion.
  The optional before/after run verified unchanged measured geometry.
- Typecheck, renderer production build, 19 focused tests (theme, packs, samples,
  marketplace and composition) and browser material/navigation/finishing/
  composition/emblem checks passed. Evidence is under
  `D:/Desktop For Step Code/output/playwright/stellar-materials`.
  This is local offline-fixture acceptance, not new native Electron or
  real-account acceptance. No package was published.

## Navigation Chart (2026-11-05)

- The host-owned `stellar-chrome.css` extends the matte material with a coherent
  project/session chart, diamond anchors, subdued metal rules, asymmetric frame
  corners, and distinct writing/command planes. Review drawers, question choices,
  code headers and inspectors share these details; scene geometry is unchanged.
- Existing session indicators retain their meanings. The composer edge responds
  to authoritative busy/waiting/navigation state, not an estimated percentage.
  Theme motion off, Settings pause and reduced-motion disable its animation.
- Short task lists (1-8 items) have keyboard-accessible route anchors. Each opens
  and focuses the corresponding real task, including collapsed completed items.
  Larger lists retain the original readable list and completion bar. Route
  points carry actual task states; they never infer dependencies or success.
  Deferred reveal does not steal focus if the user has resumed another action.
- `verify-stellar-chrome.mjs` checks task navigation, semantic states, send/stop,
  waiting/idle transitions, static/reduced motion, narrow windows, original
  control dimensions and restoration of both built-in themes. It also captures
  the workspace with scenery hidden, so the chrome can be reviewed separately.
  These are offline app-fixture checks, not native/account acceptance.
- Acceptance passed: typecheck, renderer build, 45 focused theme/summary tests,
  chrome/material/navigation/finishing/composition browser checks. The production
  renderer retains the existing bootstrap, module-directive and chunk-size
  warnings. Evidence: `D:/Desktop For Step Code/output/playwright/stellar-chart`.
  Only the current renderer output and visual evidence were generated; no
  installer, commit or publication was made.

## Reading Surfaces (2026-11-05)

- Host-owned `stellar-records.css` extends the navigation chart into process
  disclosures and inspector contents. Expanded tool groups share a fine spine;
  singleton compact groups avoid duplicate framing. Tool inputs/results keep
  their real content, native hit targets, cubic disclosures and inert states.
- Context uses a ruled usage ledger, numbered message records and a 40-tick
  capacity scale. Partial ticks, unknown values and the native warning colors
  remain authoritative; no extra usage or progress is invented.
- Diff views retain semantic red/green fills in both unified and split layouts,
  including changes inside conversation tables. File paths, source surfaces and
  Markdown sections share the quieter metal/paper treatment.
- The offline file chooser now returns one in-memory Markdown document. Source,
  wrap, refresh and copy exercise the real FilePreviewPanel. Unknown paths,
  grants and external destinations are rejected; this is not host file access.
- Acceptance passed: typecheck, renderer build, 43 focused tests (one additional
  POSIX-only case skipped on Windows), records/chrome/material/navigation browser
  checks. Coverage includes normal/compact processes, failure/unknown/waiting,
  capacity warnings, copied JSON/source, 390/760px layouts, focus clipping,
  reduced motion and built-in-theme restoration. Scene geometry is unchanged.
  Evidence: `D:/Desktop For Step Code/output/playwright/stellar-records`.
  Existing production build warnings remain; no native/account acceptance,
  installer, commit or publication is implied.

## Decisions and Sources (2026-11-05)

- Host-owned `stellar-decisions.css` gives permission targets, plan documents
  and question choices distinct reading hierarchies within the existing drawers.
  Risk colors remain semantic; numbered plan entries do not imply task status.
  Original controls and attachment dimensions are preserved.
- References, annotations, queued messages and attachments share opaque matte
  surfaces, fine source rules and restrained selection accents. Popovers remain
  anchored to their triggers, with cubic motion and reduced-motion support.
  Escape closes only the open source layer and returns focus to its trigger,
  without also dismissing the workspace inspector. This interaction fix also
  applies to the built-in themes.
- The `?view=queue` sample exercises versioned edits, removal and simulated
  delivery against an in-memory queue. Its attachment chooser returns only the
  offline Markdown sample. No model calls, host file access or real sends occur.
- Acceptance passed: typecheck, renderer production build, 41 focused tests,
  decisions and existing finishing browser checks. Coverage includes source
  anchoring, Escape/focus restoration, question drafts, queue mutations,
  390/760px layouts, reduced motion and built-in-theme restoration. Evidence:
  `D:/Desktop For Step Code/output/playwright/stellar-decisions`.
  Existing build warnings remain. These are local offline checks, not native
  Electron/account acceptance; no installer, commit or publication was made.

## Reading Navigation and Agent Records (2026-11-05)

- Host-owned `stellar-navigation.css` extends the existing material to the
  conversation directory, edge ruler and agent inspectors. Directory numbers
  sit on a fine reading axis; the current turn uses the theme accent. Ruler
  targets remain 20x18px and inspector widths are unchanged.
- The directory tracks the first reading position against actual message
  offsets, including resized content. It adds `aria-current=location` without
  moving keyboard focus or changing the user's scroll position. Ruler previews
  show the original turn timestamp when supplied, never a fabricated time.
- Agent overviews distinguish phase headings, task rows and state indicators.
  Detail surfaces separate the task, read-only limitations and returned output.
  Phase grouping does not claim dependency or execution order; no graph edges,
  progress percentages or execution controls were invented.
- `?view=navigation` contains eight dated offline turns; `?view=agents` includes
  a legacy agent transcript and workflow records covering completed, cached,
  failed, aborted and unknown outcomes. These are in-memory sample histories,
  not model executions or filesystem operations.
- Local acceptance passed: typecheck, renderer production build, 43 focused
  tests, `verify-stellar-navigation.mjs` and the existing decisions verifier.
  Browser coverage includes scroll/click
  synchronization, original timestamps, state-specific details, keyboard focus,
  390/760px layouts, reduced motion and restoration of both built-in themes.
  Evidence: `D:/Desktop For Step Code/output/playwright/stellar-navigation`.
  Existing bootstrap/module-directive/chunk-size build warnings remain.
  This does not establish native Electron or real-account acceptance. No
  installer, commit or publication was made.

## Model Controls and Discovery (2026-11-05)

- Host-owned `stellar-controls.css` unifies model information, effort controls,
  parameter records and the `/` / `@` discovery surfaces. Matte reading planes
  replace nested framing; selected rows use a fine position rule. Original effort
  colors, drag thresholds and animation timings are unchanged.
- Desktop geometry stays at 370x258 for the model popover, 82x228 for the fader
  and 78x38 for its thumb. Discovery rows remain 34px tall. On narrow windows,
  the popover shifts only as needed to stay inside the viewport.
- Model selection retains the authoritative checkmark while a requested change
  shows a busy indicator. Duplicate model requests are gated. List arrows and
  Home/End move focus without choosing a model; Escape returns to the trigger
  without also closing the inspector. Model-list focus outlines remain inside
  clipped rows in both built-in themes.
- Command discovery uses stable name/keyword/description columns, with compact
  narrow-window layouts. Reference rows retain source identity. Empty results
  clear the composer's stale `aria-activedescendant`.
- `?view=controls` opens a browser-only catalog with three/seven-level, service
  default and unknown-capability models plus command/template/skill examples.
  Model changes are deliberately delayed offline simulations, not requests to
  a provider. Catalog values are sample data, not claims about actual models.
- `verify-stellar-controls.mjs` checks original geometry, keyboard and pointer
  effort changes, frame-by-frame fill/thumb alignment, pending/failure selection,
  menu completion, empty/disabled rows, reference insertion, 390/760px bounds,
  reduced motion and built-in themes. Evidence:
  `D:/Desktop For Step Code/output/playwright/stellar-controls`.
- Verified locally: TypeScript checking, 25 focused unit tests, controls and
  decisions browser acceptance, and the renderer build passed. The controls run
  sampled 89 fader frames with zero fill/thumb drift and no browser errors.
  Existing bootstrap/module-directive/chunk-size build warnings remain. These
  checks do not establish native Electron or real-account acceptance; no
  installer, commit or publication was made.

## Stellar Greeting Lettering (2026-11-05)

- The welcome greeting adapts the settled text sampling, coherent light waves
  and second halo pass from `Release060/src/chapters/closing.ts`. This is
  host-rendered particle lettering, not a new font or a screenshot asset.
  Ordinary interface and conversation typography remain unchanged.
- The optional `NewSession.renderGreeting` presentation hook preserves greeting
  selection, typing, cursor and accessible heading text. Original 25px/22px
  sizes, single-line layout, spacing and the 48x48 emblem remain intact.
- A small supersampled surface maintains Chinese counters at desktop UI sizes.
  It animates at up to 24fps, freezes with reduced motion or the theme's motion
  toggle, pauses behind settings or while hidden, and disposes on conversation
  entry. Real text remains available until rendering succeeds and after context
  loss; restoration rebuilds the particles without shifting controls.
- Local verification passed: TypeScript checking, nine greeting/theme tests,
  the existing emblem browser regression, the new lettering browser verifier,
  and the renderer build. Browser coverage includes live/nonblank pixels,
  static/hidden/covered states, context recovery, built-in theme isolation and
  Chinese/English at 1440/760/390px widths. Existing build warnings remain.
  This is not native Electron or real-account acceptance; nothing was published.
- Evidence: `D:/Desktop For Step Code/output/playwright/stellar-lettering`.
  Open the welcome fixture without a `view` parameter to see the lettering.

## Sidebar Stellar Lockup (2026-11-05)

- The Stellar-only sidebar lockup samples the existing `StepCode.svg` and
  `wordmark-dark.png` in their actual layout. The five-block mark becomes a
  dense colored star field; the small English wordmark retains a continuous
  reading core with fine moving highlights. Source assets are not replaced.
- The original 219x42 button, 26x26 mark, 150px wordmark width and usage-overview
  action remain unchanged. Hover and keyboard focus emphasize the light inside
  the strokes without scaling the lockup or covering its focus outline.
- This persistent sidebar surface uses a small 2D canvas at up to 20fps, not an
  additional WebGL context. Hidden sidebar/document and covering settings,
  scheduled-task or usage views stop drawing. Reduced motion and the theme
  motion toggle produce a static rendering. Original images remain the fallback.
- TypeScript, nine focused theme/greeting tests, renderer build and the local
  browser verifier passed. The verifier checks colored/nonblank pixels, motion,
  focus, usage-entry activation, hidden/covered states, 760/390px sidebars,
  built-in theme isolation, initialization failure and synthetic context
  loss/recovery. Synthetic context events do not establish driver-fault recovery.
  Existing build warnings remain; native Electron acceptance and publication
  were not performed.
- Evidence: `D:/Desktop For Step Code/output/playwright/stellar-brand`.

## Quiet Pencil Rules (2026-11-05)

- Retain the original quiet sidebar rule; no additional stars, sweep effects or
  divider animation. Brand and greeting artwork remain unchanged.
- Remove the summary task outline and duplicate repository top rule. Preserve
  current/expanded backgrounds, status icons and keyboard focus outlines.
- Soften the expanded tool spine and metadata rule; remove the redundant status
  and output bottom rules without changing border widths, spacing or hit areas.
- `verify-stellar-pencil.mjs` passed at 1440, 760 and 390px. Before/after geometry
  matched, built-in light/dark styles matched, keyboard focus remained visible,
  and no page errors occurred. Existing records regression, TypeScript, nine
  focused theme/greeting tests and renderer build also passed.
- Evidence: `D:/Desktop For Step Code/output/playwright/stellar-pencil`.
  This is local browser-fixture acceptance, not native Electron or publication.
  Existing renderer build warnings remain.
- The new verifier is registered as local-only. Full acceptance-inventory
  validation remains blocked by eight pre-existing unregistered theme scripts
  (starting with `verify-stellar-emblem.mjs`); this round does not claim CI readiness.

## Inset Section Rules (2026-11-06)

- Summary header and repository/agent/MCP/skill divisions now use inset 1px
  warm-gray rules instead of edge-to-edge borders or short metallic accents.
  The material matches the brand rule, with 32% opacity for opaque panels.
- Permission, plan and question heading underlines use the same material,
  aligned with content gutters (20px desktop, 12px narrow). Hazard colors on
  the drawer edge, icon and explanation remain unchanged.
- Original brand rule and process-record rules are untouched. No extra stars,
  glow, texture or animation; no layout, hit-area or interaction changes.
- Extended `verify-stellar-pencil.mjs` passed geometry and built-in theme
  comparisons, desktop/narrow drawer captures and focus checks. Decisions
  regression, TypeScript and renderer build passed; existing build warnings
  remain. Evidence: `D:/Desktop For Step Code/output/playwright/stellar-section-rules`.
  Browser fixtures only; no native Electron acceptance or publication.

## Prose Reading (2026-11-06)

- Response prose uses margin-aligned quotes, matte code surfaces without hard
  outlines, and horizontal table rules instead of vertical cell grids.
  Existing fonts, sizes and line heights remain unchanged. These selectors
  exclude tool records, diff tables, file inspectors and approval documents.
- The response-ending experiment was withdrawn at the owner's request.
  Footer styles and sample metadata additions were removed: actions retain
  native hover/focus visibility and metadata stays in its original position,
  leaving the right side to settled status and existing controls.
- `verify-stellar-reading.mjs` checks desktop/760/390px, code and reply copying,
  focus, long-code scrolling, absent metadata, streaming and built-in theme
  isolation. It owns its server; `--capture-before` captures an optional baseline.
- Browser verification, records regression, TypeScript, six focused theme tests
  and renderer build passed. Existing build warnings remain. Evidence:
  `D:/Desktop For Step Code/output/playwright/stellar-reading`.
  No native Electron acceptance, installation or publication was performed.

## Attachment and Menu Surfaces (2026-11-06)

- File attachments use a quieter warm-gray frame, a lighter document-icon
  stroke and stronger filename contrast. Existing captions, truncation,
  116x104 footprints and hover/focus-only removal controls remain unchanged.
  Image thumbnails retain their original rendering and preview behavior.
- AppMenu, window menus and sidebar/image context menus use opaque matte
  surfaces, compact shadows and fine borders. Selected radio rows retain
  the theme accent; keyboard focus uses a fully inset outline. Destructive
  text keeps its semantic danger color. Anchors, padding, hit targets,
  keyboard behavior and disclosure timing are unchanged.
- `verify-stellar-surfaces.mjs` owns an ephemeral server and checks
  1440/760/390px layouts, attachment removal/preview, image-menu keyboard
  navigation, AppMenu navigation, focus clipping and destructive text.
  Optional `--capture-before` supports geometry and built-in theme comparisons;
  thumbnail checks compare decoded pixels from settled screenshots.
- Before/after comparison, decisions regression, TypeScript, six focused
  theme tests and renderer build passed locally. Existing build warnings
  remain. Evidence: `D:/Desktop For Step Code/output/playwright/stellar-surfaces`.
  No native Electron acceptance, installation or publication was performed.

## Settings and Small Dialogs (2026-11-06)

- `stellar-settings.css` applies graphite surfaces and warm-gray rules to
  settings navigation, typography fields, interface presets and small dialogs.
  Typography group headings use the existing metal tone; labels stay subdued
  while field values remain prominent. Theme thumbnails and switch state colors
  are untouched.
- Native dimensions, spacing, fonts, field focus outlines and motion remain
  intact. Rename validation, cancel behavior and project-removal danger colors
  are unchanged. No account, provider or filesystem actions are performed.
- `verify-stellar-settings.mjs` checks 1440/390px layouts in Stellar and both
  original themes, complete focus extents, switch toggles, empty-name validation,
  cancellation, danger text and normal/reduced-motion settings disclosure.
  Optional `--capture-before` records geometry and built-in styling for comparison.
- Before/after browser comparison, decisions regression, TypeScript, six focused
  theme tests and renderer build passed. Existing build warnings remain.
  Evidence: `D:/Desktop For Step Code/output/playwright/stellar-settings`.
  Browser fixtures only; no native Electron acceptance or publication.

## Search and Dense File Lists (2026-11-06)

- Stellar search highlights literal matches in session titles, first-prompt
  previews and project labels without changing filtering or saved order.
  NFKC, case and Windows separator normalization match the existing search;
  highlight ranges map back to intact original graphemes. Text is rendered
  through React, never injected as HTML. Original themes remain unhighlighted.
- Search uses the existing anchored disclosure and full composite focus ring.
  File paths use quieter text, with restrained hover/focus emphasis. Native
  filename tooltips were added to review rows and file-preview headings.
  Wrapping, ellipsis, row heights, font sizes and diff semantic colors stay intact.
- `verify-stellar-search.mjs` compares original geometry, result IDs, built-in
  styles and diff colors against a `--capture-before` baseline. It checks
  empty search, Escape/focus restoration, draft/session preservation, narrow
  search and long filenames. Dense repository rows and long file metadata
  are injected only into the offline test bridge, never read from disk.
- Records verification waits for finite ancestor disclosure animations before
  testing settled focus bounds; the outline/clipping assertions remain intact.
- Evidence: `D:/Desktop For Step Code/output/playwright/stellar-search`.
  These checks are browser-fixture coverage, not native Electron acceptance
  or publication.

## Reproduce

The public browser fixture at `/tests/fixtures/theme-pack.html` mounts the real
Desktop app with a browser-only offline bridge. It includes project/session
navigation, welcome, conversation Markdown and tool records, simulated send/stop,
Summary/Context/Changes panels and Appearance. `?view=chat` opens the sample
conversation directly. Preferences are saved in a fixture-specific localStorage
key; no model, account, filesystem or Electron access is used. Unsupported native
actions report that they are unavailable in the offline fixture.
The sidebar also exposes three approval samples; direct entries use
`?view=permission`, `?view=plan`, and `?view=question`. Refreshing resets their
in-memory responses. None of these samples authorizes or performs host actions.
The `?view=queue` entry opens the reference/queue sample with three pending
messages; refreshing resets its edits and simulated deliveries.
Use `?view=navigation` for long-conversation reading and `?view=agents` for
read-only collaboration records. Both are also available in the fixture sidebar.
Use `?view=controls` for model switching, effort controls and command discovery.

The isolated renderer fixture is still available with `?isolated=1`; lifecycle
test controls require `?isolated=1&lifecycle=1`. Full-workspace acceptance:

```powershell
node scripts/verify-theme-workspace.mjs 'D:/Desktop For Step Code/output/stellar-theme'
node scripts/verify-stellar-emblem.mjs 'D:/Desktop For Step Code/output/stellar-theme'
node scripts/verify-theme-finishing.mjs 'D:/Desktop For Step Code/output/stellar-theme'
```

The local-only idle, navigation and composition verifiers each own an ephemeral Vite server
and close it after the run; neither depends on or stops the user's preview server:

```powershell
node scripts/verify-theme-idle.mjs 'D:/Desktop For Step Code/output/stellar-theme'
node scripts/verify-theme-navigation.mjs 'D:/Desktop For Step Code/output/stellar-theme'
node scripts/verify-theme-composition.mjs 'D:/Desktop For Step Code/output/stellar-theme'
node scripts/verify-theme-materials.mjs 'D:/Desktop For Step Code/output/playwright/stellar-materials'
node scripts/verify-stellar-chrome.mjs 'D:/Desktop For Step Code/output/playwright/stellar-chart/chrome'
node scripts/verify-stellar-records.mjs 'D:/Desktop For Step Code/output/playwright/stellar-records'
node scripts/verify-stellar-decisions.mjs 'D:/Desktop For Step Code/output/playwright/stellar-decisions'
node scripts/verify-stellar-navigation.mjs 'D:/Desktop For Step Code/output/playwright/stellar-navigation'
node scripts/verify-stellar-controls.mjs 'D:/Desktop For Step Code/output/playwright/stellar-controls'
node scripts/verify-stellar-lettering.mjs 'D:/Desktop For Step Code/output/playwright/stellar-lettering'
node scripts/verify-stellar-brand.mjs 'D:/Desktop For Step Code/output/playwright/stellar-brand'
node scripts/verify-stellar-pencil.mjs 'D:/Desktop For Step Code/output/playwright/stellar-pencil'
node scripts/verify-stellar-reading.mjs 'D:/Desktop For Step Code/output/playwright/stellar-reading'
node scripts/verify-stellar-surfaces.mjs 'D:/Desktop For Step Code/output/playwright/stellar-surfaces'
node scripts/verify-stellar-settings.mjs 'D:/Desktop For Step Code/output/playwright/stellar-settings'
node scripts/verify-stellar-search.mjs 'D:/Desktop For Step Code/output/playwright/stellar-search'
node scripts/verify-stellar-feedback.mjs 'D:/Desktop For Step Code/output/playwright/stellar-feedback'
```

For pencil-rule geometry comparison, run its verifier with `--capture-before`
before editing, then without that flag after editing in the same evidence
directory. Without a baseline it checks the current styles and interactions.

The search verifier also covers normal empty search/file surfaces, empty review
at desktop and narrow widths, and prose selection inheritance. Stellar prose
uses a warm-gray selection; code and alert selections retain the native dark
selection. Links retain their original focus outline and preview behavior.
Run with `--capture-before` before changing styles, then without it against the
same evidence directory to compare geometry and original-theme styles.

The feedback verifier uses the same before/after workflow. It exercises real
copy success/reset/failure and pending file-open controls at desktop/narrow
widths across Stellar and the original light/dark themes, with an offline bridge.
Copy timing and hover-only action visibility are unchanged; only neutral
disabled controls receive the opaque muted-ink treatment.

Stellar modal scrims dim the background scene while retaining native blur,
geometry and open/close animation. Inline approval drawers do not gain a
blocking scrim. The settings verifier includes settings and rename backdrops
in its original-theme and geometry comparisons.

The surfaces verifier covers image-viewer chrome and real terminal tabs with
offline ANSI sample output. Image transforms, terminal output and palette are
not themed by these rules. Live switches to the original themes also verify
that the Stellar scene and theme-material/motion attributes are removed.

Decision stress previews append `&stress=decisions` to the `permission`, `plan`
or `question` fixture view. They use long unbroken path segments, dense approval
parameters, long plans and multi-line question descriptions without real tools.
Run `node scripts/verify-stellar-decision-stress.mjs <evidence-directory>`
with `--capture-before` before editing and without it afterward. It compares
original themes and drawer/action geometry at 1440/390px, checks Stellar content
overflow and verifies that deferred freeform answers survive reopening.

The `chat&stress=statuses` fixture query shows stable offline running, waiting,
failed and completed-unread sessions alongside the selected idle session.
Selection remains a row treatment; the idle node stays hollow.
`verify-stellar-statuses.mjs <evidence-directory>` supports `--capture-before`
and compares status styles and geometry at 40/120 percent scene brightness,
desktop/narrow widths and the original themes. No actual jobs are started.

The navigation verifier includes a continuous desktop journey without reload:
leave a multi-line draft midway through a long conversation, open/close settings,
switch to another session with its own draft, then return. It checks reading
position, per-session draft isolation and that the composer can regain focus.
This is offline renderer acceptance, not native Electron or real-model acceptance.

For a material revision, run the latter with `--capture-before` before editing
and `--compare-before` after editing, using the same evidence directory.
Ordinary acceptance does not require a baseline file.

Run from `Desktop/`, after installing dependencies and staging a compatible
runtime for the marketplace integration tests:

```powershell
corepack pnpm typecheck
node --import tsx --test tests/theme-packs.test.ts tests/theme.test.ts tests/theme-marketplace.test.ts tests/capabilities.test.ts tests/capability-command.test.ts tests/capability-usage.test.ts
corepack pnpm exec vite --config vite.theme-preview.config.mjs
```

Preview route: `/tests/fixtures/theme-pack.html` on local port 4197.
This preview uses the real NewSession, ThemeSettings, palette logic, and scene
renderer; its surrounding navigation is a fixture, not a running agent.

```powershell
node scripts/verify-theme-packs.mjs 'D:/Desktop For Step Code/output/stellar-theme'
```

Electron acceptance additionally needs current main/preload bundles in that
evidence directory's `electron/` folder and `DESKTOP_VERIFY_EXE` pointing to
an installed Electron executable. It uses the local Vite server and a fresh
isolated profile, not the running user's application.

Package layout and local installation instructions: `theme-marketplace/README.md`.
