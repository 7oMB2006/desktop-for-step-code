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
- UI material, accent color, typography and panel opacity remain theme-owned.
  Background blur is not a glass-material or UI-opacity control.

## First-Version Scope

PNG and JPEG are imported with the native file picker, bounded and decoded in
Electron, then re-encoded as PNG. The existing image limits apply: 12 MiB,
8,192 pixels per edge and 33,554,432 pixels total. Animated PNG, SVG, HTML,
remote URLs and video are not supported.

The editor supports fill/fit, horizontal and vertical position, 100-200% zoom,
40-120% brightness, 0-24 px background blur and 0-12 px mouse parallax.
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
