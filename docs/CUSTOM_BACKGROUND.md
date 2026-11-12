# Custom Background

The optional `custom-background` marketplace package opens a fixed, host-owned
local-image editor. It is not an executable frontend extension. Installing or
removing the package still follows the existing plugin runtime policy; editing
an image or its parameters does not restart a conversation runtime or apply
pending provider settings.

## Theme Compatibility

- Built-in color themes accept personal images.
- A theme package must explicitly accept `image-v1` in its
  [composition contract](THEME_COMPOSITION.md).
- Integrated version-1 themes, including the existing Stellar Cruise package,
  retain their own background. The personal image and adjustments remain saved.
- An accepted replacement unmounts the theme's original scene. Restoring the
  theme background mounts it again; the two renderers never run together.
- Accent color, typography and the selected UI skin remain theme-owned.
- Built-in themes and `standard-v1` support host-owned backing materials while
  a decoded personal image is active. The `stellar-v1` skin retains its own
  materials, even when its background slot accepts personal images.

## First-Version Scope

PNG and JPEG are imported with the native file picker, bounded and decoded in
Electron, then re-encoded as PNG. The existing image limits apply: 12 MiB,
8,192 pixels per edge and 33,554,432 pixels total. Animated PNG, SVG, HTML,
remote URLs and video are not supported.

The editor supports fill/fit, horizontal and vertical position, 100-200% zoom,
40-120% brightness, 0-24 px background blur and 0-12 px mouse parallax.
Standard UI materials additionally support independent conversation, composer,
left-sidebar and right-panel transparency (0-100%) and 0-24 px backing-plane blur.
These controls never fade or blur foreground text, controls or focus indicators.
Code, menus and approval dialogs retain their reading surfaces; embedded web
pages and file content are not forced transparent. Terminal backgrounds support
transparency and return to the theme's solid background when it is disabled.

Conversation material covers the complete main workspace and summary track,
including composer gutters and the status footer. Composer and summary controls
adjust an additional tint: 100% removes that tint, not the reading plane beneath
it. Nested controls do not blur that plane twice. Disabling, removing or losing
the image, uninstalling the plugin or switching to an incompatible theme removes
the personal material overrides. Arbitrary images and transparency settings are
not guaranteed to retain sufficient contrast.

Reduced motion, hidden documents, paused workspaces and touch input do not
drive parallax. Animation stops when settled and releases its listeners when
the image is replaced, removed or fails.

Disabling an image restores the theme without deleting the file. Resetting
adjustments preserves the selected image and enabled state. Deleting requires
confirmation and removes the current host-owned image after the metadata
commit.

## Storage And Capability

The host stores a normalized image and atomic metadata pointer under
`userData/custom-background/`, separate from upstream runtime settings and
plugin package files. The renderer receives a revision, dimensions and options,
not the source path or arbitrary filesystem access. Image bytes are available
only through the bounded current-revision read.

Images are written and synced to an exclusively created temporary file before
atomic publication. Reimporting safely replaces incomplete regular-file
candidates left by older interrupted writes; links, directories and changed
entries remain rejected. A repaired image already referenced by committed
metadata survives a later metadata-write failure. Unrelated abandoned files
are not swept or followed.

The adapter requires a unique, recorded installation with a current complete
package fingerprint and exact `dfsc.appearance.json` marker. Its manifest must
have empty execution capabilities. A plugin ID or marketplace category alone
does not grant the editor capability.

Every mutation validates the opaque reference and installation instance before
storage and rechecks them before publishing. A native picker does not hold the
management gate while waiting for a user; uninstalling or reinstalling during
selection invalidates the pending import.

Passive state reads return the last published host snapshot and do not acquire
the management gate. Startup, plugin lifecycle operations and explicit catalog
refresh reconcile installation ownership; every write independently reproves
it. Polling state therefore cannot interrupt an import after the picker closes.

Uninstalling keeps personal media and adjustments but disables activation.
Reinstalling never silently reactivates that image. A missing, corrupt or
unwritable background falls back to the theme and cannot block application
startup. Shutdown waits for an admitted background operation before stopping
the management service.

## Verification

Focused tests cover schema/storage, capability derivation, reference freshness,
MiniChat read-only boundaries and provider/runtime isolation. The two browser
verifiers use the production editor and renderer. The native verifier requires
an explicitly prepared isolated build and a dedicated test profile:

```powershell
node scripts/verify-custom-background-electron.mjs <absolute-build> <absolute-evidence>
```

These checks do not replace real model acceptance, installer verification or
cross-platform release validation.
