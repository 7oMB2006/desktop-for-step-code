# DFSC Configuration Example

This is a host-maintained authoring example, not an independent community submission.
It formats text locally using the settings declared in `dfsc.settings.json`.
It needs Node.js on PATH. Installing the resource does not install Node.js.

## Use

1. Add this directory's local marketplace to the DFSC plugin center.
2. Install the example and open its configuration gear.
3. Change the prefix, uppercase option and maximum characters, then save.
4. Enable its MCP service and explicitly restart the relevant idle session.
5. Ask the agent to call `format_note` with supplied text.

The tool prepends the prefix, optionally uppercases the text and applies the
character limit. Saving a new revision requires a service restart; an old
process refuses new calls instead of silently using stale configuration.
The tool makes no network or model request itself. Asking an agent to call it
can still invoke the agent's selected model.

## Authoring

The manifest, presentation, settings, reader and server are ordinary package
files. DFSC does not load a third-party React bundle or execute presentation
metadata. See [the consumer contract](docs/consumer.md).

No repository, tutorial video or Star count is invented for this example.
