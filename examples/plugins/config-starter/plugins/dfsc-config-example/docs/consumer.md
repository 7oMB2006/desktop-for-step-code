# json-file-v1

DFSC saves settings in its private profile and writes a revision-bound binding.
The bundled reader derives the profile from the installed package location.
It never reads the user's personal Step Code profile or falls back to BVR.
Each revision has an immutable snapshot. The binding commits its content hash,
package fingerprint, schema hash and installation instance together.
An interrupted save cannot authorize a partially written snapshot.

`initialize` fixes the process to its first committed revision. Before each tool
call the reader checks the receipt, binding, package and snapshot again, including
post-read checks. Changed settings, schema, package or a revoked installation fail
closed and require an explicit restart. The reader never silently adopts a new
revision in an existing process.

The sentinel in `step.plugin.json` prevents upstream Step account injection.
The reader also clears inherited credential-related variables before use.
This is not a sandbox: native code running as the same operating-system user
can access that user's files. Only install code you trust.

Secret fields use explicit keep, replace and delete operations. The renderer
receives secret presence, not saved secret values. The native consumer is
allowed to read the secrets intended for it from the private configuration.

Do not put secrets into manifests, examples, URLs, errors or tool output.
Use an independent connection for every separately configured service.
Source changes, schema migrations and recovery of unconfirmed old installations
are not automatic. Keep stable field IDs; do not change a secret into a text field
and expect its old value to become visible.

[Back to the guide](../README.md)
