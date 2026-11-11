# Theme Composition Contract

New authors: start with the [Chinese quick start](THEME_AUTHORING.zh-CN.md)
and the [installable v2 starter](../examples/plugins/theme-starter/README.md).

This source contract requires a DFSC host containing the composition support.
It does not make previously released clients understand new theme formats.
This phase provides a bounded theme/background framework, not the complete
personal image-import library or background-editing plugin.

## Ownership

The host owns security, input routing, resource limits, rendering implementations
and accessibility. A theme owns its visual composition: palette, UI skin,
decorations and default background. A background provider may replace only a
slot the theme explicitly opens.

These are composition rules, not permission grants. A package cannot register
JavaScript, CSS, HTML, a shader or an arbitrary renderer by naming it in JSON.
Theme and background support does not require an MCP server or a model call.

## Version 1 Compatibility

Existing `schemaVersion: 1` packs keep their `renderer: "stellar-v1"` and
`scene: "scene.json"` declarations and current appearance. They normalize to
the Stellar UI and Stellar background, with no replacement providers accepted.
Adding a new declaration to an old pack does not opt it into replacement.
The existing Stellar sample remains version 1.

Version 2 separates the two responsibilities. Common metadata remains `name`,
optional `author` and `cover`, `scheme`, and the eight palette colors.
`renderer` and `scene` no longer belong at the top level.

## Version 2 Example

```json
{
  "schemaVersion": 2,
  "name": "Quiet Photo",
  "author": "Theme Author",
  "scheme": "dark",
  "colors": {
    "bg": "#141414",
    "side": "#0d0d0d",
    "surface": "#1f1f1f",
    "ink": "#e8e8e8",
    "muted": "#a4a4a4",
    "border": "#303030",
    "code": "#101010",
    "accent": "#de4672"
  },
  "ui": { "renderer": "standard-v1" },
  "background": {
    "renderer": "image-v1",
    "source": "background.png",
    "accepts": ["image-v1"]
  }
}
```

Keep the existing `step.plugin.json` identity and marketplace structure.
The optional `$schema` field is editor metadata only; the host does not fetch it.
The authoring schema is [dfsc.theme.schema.json](plugin-schemas/dfsc.theme.schema.json).
Host validation remains authoritative for file contents, image decoding, scene
geometry and text contrast; JSON Schema alone does not establish compatibility.

## Supported Descriptors

| Field | Accepted values | Meaning |
| --- | --- | --- |
| `ui.renderer` | `standard-v1`, `stellar-v1` | Selects a host-owned UI adapter, not a package entry point. |
| `background.renderer` | `solid-v1` | Uses the theme base color; `source` must be omitted. |
| `background.renderer` | `stellar-v1` | Requires `source: "scene.json"` and validated Stellar geometry. |
| `background.renderer` | `image-v1` | Requires `background.png` or `background.jpg`. |
| `background.accepts` | omitted, `[]`, or `["image-v1"]` | Declares which replacement provider can occupy the workspace background slot. |

The Stellar UI supports only `scheme: "dark"`; the standard adapter supports
light and dark palettes. All eight colors use six-digit hex values. Both
primary and secondary text must pass the existing surface contrast checks.
The optional cover retains the existing bounded `cover.png` rules.

Static backgrounds are packaged PNG or JPEG assets, limited to 12 MiB.
The community marketplace has a stricter 8 MiB per-file and 32 MiB per-package
sync limit. A valid local theme is not automatically eligible for that market.
Both the source image and its native-decoded PNG must fit the host's 12 MiB limit;
passing the market's encoded-file limit does not prove native decoding will pass.
Each decoded edge is at most 8192 pixels and the image has at most 33,554,432
pixels. Header bounds are checked before native decoding; APNG is rejected.
WebP is excluded until host-native decoding is supported and verified.
The main process decodes and re-encodes the image as a
bounded, single-frame PNG before sending its controlled representation to the
renderer. The original file is not passed through as executable content.

Version 2 accepts only the documented top-level and descriptor fields.
Unknown renderers, unknown replacement types, duplicate accepted types,
unrecognized fields and inappropriate resource paths are rejected. Missing
`accepts` means closed, not "accept everything". The framework currently has
one workspace background slot, not a generic scene graph.

## Resolution Rules

1. Resolve and validate the selected theme before considering a replacement.
2. With no replacement requested, use that theme's default background.
3. A replacement takes effect only when its supported provider type is listed
   in the theme's `accepts`.
4. An incompatible request retains the default background. Keep the requested
   choice distinct from the effective choice so a future editor can preserve
   the user's image and parameters rather than silently discarding them.
5. Only one renderer owns the slot. Replacing a scene releases it; the old
   canvas must not continue running invisibly beneath an image.
6. Replacing the background does not select another theme or remove its skin,
   branding and other foreground decorations.

On a supported refresh, the host derives a resource revision from the normalized
composition and validated scene, image and cover data. Changed resources can
then replace an old render instance even when the package ID and version are
unchanged. This revision is not an author-set manifest field or a file watcher.

A declaration is an opt-in composition contract, not a guarantee that every
image is attractive or readable with every skin. Host reading surfaces and
theme-specific visual acceptance are still required. Do not use global element
opacity or blur that also affects text, controls, semantic colors or focus rings.

## Lifecycle and Input

Background implementations must stop work while hidden or covered according to
the host lifecycle, honor reduced motion and host motion settings, and release
listeners, animation callbacks and GPU resources when replaced or removed.
Motion must not catch up all hidden elapsed time after resuming.

The current background renderers are decorative. They do not take keyboard
focus, intercept clicks, consume chat input or replace approval controls.
Future interactive renderers need a separate reviewed contract for hit regions,
pointer/keyboard routing and lifecycle; an `interactive: true` declaration does
not grant those capabilities.

Resources stay inside the validated package boundary. The renderer receives
validated data or a controlled image representation, never an unrestricted
filesystem path. Remote resources and executable image/document formats are
not accepted as background sources.

## Evolution Without Forced Decomposition

Both composable and integrated themes are valid. An integrated theme can leave
`accepts` absent or empty and retain its complete scene/UI relationship.
Do not force a theme to expose a replaceable background merely to participate
in the marketplace.

New visual or interactive paradigms may use independent prototypes and then
introduce a reviewed, versioned host renderer with its own bounded data schema.
The shared contract standardizes ownership and connection points, not all
rendering internals. A new renderer name alone does not install an engine.
Unsupported required capabilities must fail closed rather than producing a
partially active theme.

When adapting an existing theme, explicitly verify both its original appearance
and supported replacement compositions. Treat image import, parameter editing,
video playback and HTML execution as separate scope decisions; none is implied
by accepting the version 2 manifest.
