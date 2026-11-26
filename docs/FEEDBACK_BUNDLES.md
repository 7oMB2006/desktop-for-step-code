# Reading a Desktop feedback bundle

Help > Export current conversation feedback bundle saves a local `.json.gz` file. It does not upload it or choose a recipient. The user decides whether to share it with Desktop maintainers, Step Code maintainers, or another relevant provider.

Decompress the file as gzip to read the `dfsc-local-feedback-v3` JSON. With Node.js:

```sh
node -e "process.stdout.write(require('node:zlib').gunzipSync(require('node:fs').readFileSync(process.argv[1])))" feedback.json.gz
```

- Read `actual` and `expected` first. Use `context` to check the Desktop version, Step Code baseline and commit, platform, and architecture before reproducing.
- `summary` counts recorded failures in the selected scope, before the event limit. `omittedEvents` counts older events dropped from the timeline. A tool listed under `toolsWithOnlyFinalResult` has one terminal result and no additional recorded outcomes; a tool under `toolsWithNoResult` has no terminal result. Neither implies what happened inside the tool.
- `reportedAt` is the time entered by the user. `events[].at` is the time carried by the recorded message or tool trace. These may differ; neither is the bundle creation time (`at`). Do not use manual time to infer a request match.
- Read `events` in recorded order. Tool events with the same `call` belong to one invocation within this bundle; the number is local to the report, not a request ID. A terminal trace and its matching saved tool result represent one result, not two failures. Intermediate tool output is not scanned to infer errors.
- For a model failure, check `statusCode`, `statusSource`, and `outcome`. `error_text` means the HTTP code was extracted from the error string instead of confirmed by request telemetry. `transportAttempts` is the count reported by the runtime, not a per-attempt timeline. A verified `requestId` can help the provider find the attempt, but does not guarantee log availability. A null ID means no ID was verified for that event or it could not be included.
- For a reply that completed but looks wrong, read the user's expected result and any opted-in excerpts, then try a minimal reproduction. No recorded failure is not evidence that the product worked correctly.

`summary.optionalText` distinguishes text excluded by choice, not recorded, included, or omitted at the redaction limit. Optional excerpts and error detail may also be truncated. Ask for the smallest additional evidence needed; do not ask for a full session or raw credentials as a default.
