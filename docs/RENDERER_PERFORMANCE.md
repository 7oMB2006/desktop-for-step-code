# Long-Session Interaction Performance

## Accepted Performance Baseline (2026-11-09)

The owner reports that the new `selection-style-20261109-preview` package is
noticeably faster and accepts this round as the performance implementation to
adopt. Stop adding optimizations to this round; later performance work is a
separate, unscheduled follow-up. The implemented changes and Windows package/
owner-experience phase are complete in TODO.

The accepted baseline is the frozen `codex/long-session-interaction-performance`
source at `e419143` plus its recorded uncommitted changes, with fourteen
packaged checks passed. This acceptance does not itself commit, push, create
a PR, merge, publish a release or establish cloud/macOS/installer acceptance.
Those integration gates remain separate. The synthetic measurements and
remaining main-thread limits below are retained; the owner's observation is
not a universal latency guarantee or a timed production-history trace.

## Selection-Style Package Handoff (2026-11-09)

The selection inheritance optimization below is now in the isolated Windows
preview at
`D:\Desktop For Step Code\Desktop\release\selection-style-20261109-preview`.
It contains the frozen performance branch plus uncommitted changes, not latest
main, with the same v0.1.7 runtime pin. The measured renderer/Worker assets and
1,538 packaged build/resource files match their hashes. Fourteen packaged
acceptance checks pass, including complete heavy-history geometry, bundled
Worker behavior, scrolling, search, BTW and quotes. Native selection text and
colors remain identical to the preceding conversation rules in the actual
packaged renderer.

One final packaged Stellar sample records cold first/full-history DOM at
4061.3/4299.1 ms and execution readiness at 4930.5 ms. Resident full-DOM/readiness
is 3488.5/3904.6 ms. All 360 articles, 2,160 complete code blocks, sampled source
and actual 1,586,835-pixel scroll height are retained. This single sample is not
a matched performance estimate and does not supersede the three alternating
pairs below. Multi-second main-thread blocking remains. The owner has since
accepted the observed package experience as recorded above; no timed
owner-history trace is claimed.

The desktop shortcut is backed up, updated and read back. At handoff the owner
application still ran the preceding cold-loading package and was not restarted. No old
package is deleted. Exact hashes, launch receipts, signatures and remaining
acceptance boundaries are in `VERIFICATION.md` and the package handoff receipts.

## Native Selection Inheritance (2026-11-09)

This follow-up removes descendant-universal `::selection` selectors
from the transcript and composer. Native highlight inheritance supplies the
existing colors from their roots instead. Stellar still explicitly overrides
code, tables, alerts, warnings and errors; their descendants inherit those
overrides. There is no transcript truncation, virtualization, estimated height,
new cache or changed loading/readiness behavior.

`Desktop/scripts/verify-selection-inheritance.mjs` compares the actual layout
and Stellar selection styles with the previous descendant-universal rules.
Twenty-four comparisons cover light/dark/Stellar, 1000/390-pixel widths, nested
prose, links, lists, quotes, highlighted code, tables, semantic diagnostics,
user messages, editable rich text and textarea selection. Selected text, every
sampled descendant's computed foreground/background, and screenshot bytes are
identical. Screenshots are inspected separately.

Three serial alternating-order pairs use the preceding verified preview's frozen
source as baseline and the new production build as candidate. Each launch gets
a fresh isolated Desktop profile, Stellar motion and a 1440x900 viewport. The
heavy history is unchanged: 180 turns, 1,440 messages, 5,495,514 bytes, 360
articles, 2,160 complete code blocks and real scroll height 1,586,835 pixels.
Full-DOM timing now also requires every article, not just the last answer.
First/middle/last original code, draft input, wheel movement and normal fixture
shutdown are checked. Medians in milliseconds:

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Cold: first body DOM | 3339.2 | 2838.6 |
| Cold: full history DOM | 3511.4 | 2995.3 |
| Cold: execution readiness | 3966.0 | 3431.1 |
| Cold: cumulative script | 1339.5 | 1379.1 |
| Cold: cumulative style | 898.8 | 524.1 |
| Cold: cumulative layout | 626.1 | 581.1 |
| Cold: longest task | 2129 | 1652 |
| Cold: maximum renderer probe delay | 2254.2 | 1764.9 |
| Resident return: full history DOM | 2657.1 | 2449.2 |
| Resident return: execution readiness | 2955.4 | 2760.0 |
| Resident return: cumulative script | 1640.1 | 1720.3 |
| Resident return: cumulative style | 790.9 | 512.7 |
| Resident return: cumulative layout | 439.4 | 402.2 |
| Resident return: longest task | 2632 | 2420 |

Cold full-DOM detection improves about 14.7%, style duration about 41.7%, and
the longest task about 22.4%. These are local matched medians, not a universal
speedup or compositor-confirmed paint. Script cost did not improve; script,
style and layout counters overlap and must not be added as wall-clock phases.
The remaining multi-second mount/parse/layout blocking and the owner's real
5-10-second history remain open.

An isolated progressive-mount experiment was rejected. Six initial articles
followed by 12-article batches reduced probe latency but delayed full history
to 5450.5 ms cold / 4563.1 ms resident. Using 48-article batches still took
4150.9 / 3600.3 ms. These are single exploratory runs, not matched estimates;
neither variant is in the product source. A partial history or an early tail
must not count as full-history availability.

Evidence: `D:\Desktop Runtime Builds\selection-inheritance-20261109`
contains the frozen source, build/typecheck logs, six matched reports,
`matched-summary.json`, renderer asset hashes and regression receipts.
Rejected experiments remain separate under
`D:\Desktop Runtime Builds\history-batching-20261109`.
That source-only checkpoint left the cold-loading package/shortcut unchanged.
The later package handoff is recorded above. Commit, push, cloud CI, macOS
and owner-history acceptance remain separate.

## Scope

The first two local passes target right-inspector opening/resizing and sidebar
interaction in long conversations. The third pass reuses stable rendering blocks
within a streaming reply. The fourth pass reduces unrelated work during streamed
updates. The fifth keeps the measured-width protection active during live
tail-following and response completion. The sixth localizes drag cursor/selection
styles to the existing captured handle. The seventh reuses the syntax highlighter's
language registry across Markdown processors. The eighth isolates the session tree
from unrelated streamed updates and measures navigation phases separately.
The ninth reduces repeated runtime module compilation during cold session startup.
The tenth preserves transcript nodes through the reading-preview handoff. The
eleventh reproduces a tool-heavy opening stall, batches disclosure layout
notifications and avoids repeated unchanged output-candidate parsing.
The twelfth keeps all code source mounted but schedules syntax coloring near
the viewport, preserving selection, copying and existing highlight ranges.
The cold-loading follow-ups remove redundant whole-transcript style work,
prepare bounded historical Markdown in a renderer Worker and skip definite-negative
attachment inference without changing Markdown or artifact rules.
The next follow-up activates custom search/annotation highlight styles only
while their named ranges exist, avoiding idle whole-transcript highlight styling.
These changes do not upgrade the runtime
pin or infer a Windows/macOS cause from one machine's behavior. The existing Markdown parser,
URL policy, component mapping and rendering plugins remain authoritative.

## Cold-Loading Package Handoff (2026-11-09)

The cold-loading follow-ups are now included in the isolated Windows preview
at `D:\Desktop For Step Code\Desktop\release\cold-loading-20261109-preview`.
It uses the frozen performance branch and uncommitted changes, not latest
main; its runtime pin is unchanged. Fourteen packaged acceptance checks pass.
See `VERIFICATION.md` and the package's receipts for exact scope and hashes.

One packaged Stellar run of the same 180-turn corpus records cold first/last
body DOM detection at 3412.4/3606.9 ms and execution readiness at 3610.7 ms.
Resident last-body DOM detection/readiness is 2725.7/3054.5 ms. All 360
articles and 2,160 full code blocks remain mounted with identical sampled
source and the actual 1,586,835-pixel scroll height; trusted input and wheel
movement pass. This sample is not a median or a new baseline comparison.

The remaining pressure is in renderer-side full React/Markdown transforms,
DOM mounting and real style/layout. Cold cumulative script, style and layout
are 1291.7, 818.8 and 786.1 ms; these metrics are not mutually exclusive
wall-clock stages. Cold/resident longest tasks still reach 2113/2699 ms.
Worker parsing and viewport-prioritized syntax coloring cannot move DOM
mounting off the main thread. Body-DOM markers are not confirmed paint or
owner-history usability. First-open performance remains an open task.

## Idle Custom Highlight Styles (2026-11-09)

This pass starts from the preceding verified artifact/scroll-metrics candidate,
not untouched main or the delivered twelfth-pass package. Diagnostic Chromium
selector instrumentation finds that the five global `::highlight(...)` rules
are matched throughout the large transcript even without search or annotations.
Each rule records about 677,295 attempts and 203,514 matches in that diagnostic.
Selector instrumentation itself increases style time drastically; none of its
timings are included in the performance comparison.

Each named search/annotation style now requires a matching document-root
attribute. A shared registration helper synchronizes that attribute with
nonempty `CSS.highlights` ranges. Clearing the final range deactivates its style;
an unmatched search keeps its existing message-location/fallback UI without an
empty active highlight. Replacement cleanup cannot delete a newer registration.
The combined main/BTW annotation ranges and focus priority remain authoritative.
Existing colors, native selection, source text and token-range preservation are
unchanged. This targets inactive styling, not the cost of an actively highlighted
long transcript.

Three serial alternating-order runs per side use fresh isolated profiles,
Stellar motion, 1440 x 900, identical dependencies/runtime and the same
5,495,514-byte, 180-turn, 1,440-message history. Each run opens heavy A, short,
then resident heavy A. The runner does not overlap profiling, builds or tests.

| Median Phase | Previous Candidate | Scoped Highlights |
| --- | ---: | ---: |
| First heavy: first body detected in DOM | 4021.2 ms | 3265.2 ms |
| First heavy: last answer detected in DOM | 4228.1 ms | 3462.4 ms |
| First heavy: execution-wait indicator cleared | 4231.6 ms | 3708.0 ms |
| First heavy: cumulative renderer script | 1332.9 ms | 1291.1 ms |
| First heavy: cumulative style calculation | 1501.2 ms | 783.6 ms |
| First heavy: cumulative layout | 824.4 ms | 726.4 ms |
| First heavy: maximum renderer-probe delay | 3058.1 ms | 2255.9 ms |
| First heavy: longest main-thread task | 2799.0 ms | 2089.0 ms |
| Resident heavy: last answer detected in DOM | 3671.1 ms | 2818.8 ms |
| Resident heavy: execution-wait indicator cleared | 4082.6 ms | 3133.4 ms |

Cold last-answer DOM detection improves about 18%, with ranges
4167.7-6197.6/3243.7-3728.7 ms; all samples, including the slower baseline run,
are retained. Style calculation decreases about 48%. Resident readiness ranges
are 3985.1-4196.8/2924.3-3173.1 ms. Post-open wheel medians are essentially
unchanged at 91.1/89.2 ms for cold opens; these are not timing gates.
Every heavy sample retains 360 articles, 2,160 complete code blocks and the same
1,586,835-pixel actual scroll height. First-open/return descendant counts remain
103,007/103,054, sampled first/middle/last code source is identical, and trusted
draft input and wheel movement pass. No transcript is hidden or estimated.

**First-open usability remains unresolved.** Cold/resident longest-task medians
remain about 2.1/2.8 seconds. DOM detection and animation-frame observations are
not compositor-confirmed paint or acceptance on the owner's history. Full
React mounting and real style/layout work remain. No speed-up is claimed for
active highlights, macOS, cloud CI or the unchanged delivered package.

Root-`:has` removal, article layout/style containment and unregistering theme
color properties were exploratory probes without a clear benefit; none entered
the implementation in this pass. Two exploratory runs completed content checks but timed out
during orderly fixture shutdown. They are excluded, not reported as passes;
their isolated process trees were verified and stopped as necessary. All six
matched runs exited normally. No shutdown fix is claimed.

Evidence: `D:\Desktop Runtime Builds\cold-layout-20261109`, including raw
selector/CPU diagnostics, six successful matched receipts, ranges, screenshots
and source/build hashes. See `VERIFICATION.md` for correctness checks and the
unchanged package boundary.

## Repeated Artifact Parsing And Scroll Metrics (2026-11-09)

This pass starts from the verified Worker candidate, not untouched main or the
delivered twelfth-pass package. A diagnostic CPU trace attributes about 492 ms
to parsing saved reply Markdown again for output attachments. Sources that
definitely cannot contain a supported output or local preview now skip only
that second parse. Existing `artifactKind` and `localPreviewUrl` remain the
classifiers; supported extensions, encoded/escaped destinations, reference
links and normalized numeric/IPv6 loopback URLs still use the original parser.
Recorded tool output paths, platform case rules, limits and file-access policy
are unchanged. Replies containing potential artifacts or escape/entity syntax
do not get this fast path.

The scrollbar's ARIA percentage now uses the same captured metrics as its
thumb geometry, avoiding a separate layout read during React rendering.
Unchanged measurements retain their state identity. Initial measurement,
scroll tracking, dragging and keyboard controls remain synchronous. Scheduling
the initial measurement through animation frames was tested and rejected:
it mainly moved the forced layout elsewhere, without a clear cold-load gain.
The final implementation does not defer tracking or suppress layout.

Three serial alternating-order runs per side use fresh isolated synthetic
profiles, Stellar motion, 1440 x 900, identical dependencies/runtime and the
same 5,495,514-byte, 180-turn, 1,440-message history. Each run opens heavy A,
short, then resident heavy A. No profiling, builds or tests run concurrently.

| Median Phase | Worker Baseline | Candidate |
| --- | ---: | ---: |
| First heavy: first body detected in DOM | 4632.1 ms | 4015.1 ms |
| First heavy: last answer detected in DOM | 4855.7 ms | 4220.6 ms |
| First heavy: execution-wait indicator cleared | 4859.3 ms | 4223.8 ms |
| First heavy: cumulative renderer script | 1793.4 ms | 1283.1 ms |
| First heavy: cumulative layout | 823.8 ms | 856.5 ms |
| First heavy: cumulative style calculation | 1452.4 ms | 1569.0 ms |
| First heavy: maximum renderer-probe delay | 3563.1 ms | 2980.3 ms |
| Resident heavy: last answer detected in DOM | 4159.4 ms | 3762.8 ms |
| Resident heavy: execution-wait indicator cleared | 4533.2 ms | 4119.9 ms |

Cold last-answer DOM detection improves about 13%, with ranges
4594.9-5059.8/4195.5-4683.0 ms. Script decreases about 28%; style and layout
do not improve. Resident readiness ranges overlap substantially
(4260.5-4730.5/3753.2-4635.2 ms), and post-open wheel medians are essentially
unchanged at 111.6/109.8 ms. These are local observations, not timing gates.
Every heavy sample retains 360 articles, 2,160 full code blocks and the same
1,586,835-pixel actual scroll height. Both sides have 103,007 descendants on
first open and 103,054 on return as more code receives highlighting; sampled
first/middle/last code source is identical. Trusted draft input and wheel
movement pass. No transcript content is hidden, estimated or virtualized.

**First-open usability remains unresolved.** Roughly three seconds of
continuous main-thread blocking remain; body DOM detection is not
compositor-confirmed paint or acceptance on the owner's 5-10-second corpus.
Large React mounting, transforms and browser style/layout remain the main
follow-up. The unchanged twelfth-pass package contains none of these
cold-loading follow-ups.

Evidence: `D:\Desktop Runtime Builds\cold-render-20261109`, including six
successful matched receipts, raw samples/ranges and source/build hashes.
Diagnostic and exploratory samples are excluded from the medians. One rejected
scroll-scheduling exploratory run passed content checks but failed orderly
fixture shutdown after 60 seconds; its isolated process tree was explicitly
verified and stopped. This is not a passed run or a claimed shutdown fix.
See `VERIFICATION.md` for final regression checks and delivery boundaries.

## Background Markdown Preparation (2026-11-09)

This follow-up starts from the heavy-first cold-loading snapshot below, not
untouched main or the delivered twelfth-pass package. Eligible cold-history
Markdown is parsed in a renderer Worker alongside runtime startup. It uses the
same unified/remark-parse/GFM/math parser and retains complete source positions.
Exact-text trees enter the existing react-markdown pipeline through cloned
prepared input; math adaptation, references, URL policy, component mapping,
copying and streamed reveal still run normally. No row or original source is
hidden, paginated differently, approximated or virtualized.

Preparation covers only user/assistant text between 256 and 32,768 UTF-16 code
units per source, with at least 131,072 eligible units in total. It deduplicates
and caps work at 512 sources and 4,194,304 units; exceeding either cap uses the
original synchronous path. The prepared map belongs only to the current session.
Cached readings remain immediate without Worker startup. Superseded navigation
and unmount cancel work. Unsupported/blocked Workers, parser errors, malformed
replies and a five-second deadline fall back to the existing renderer; fallback
is bounded but can itself delay an exceptional cold navigation.

The parser's entity-decoding dependency has a DOM-only browser entry. A
Worker-only Vite resolver selects that same dependency's DOM-free entry.
Production, theme-preview and the four affected production-fixture builds share
this configuration. It does not substitute a new Markdown parser or expose Node
or filesystem access to the renderer.

Three serial alternating-order native source Electron runs per side start with
heavy A, then short, then resident heavy A. New isolated synthetic profiles use
the same 5,495,514-byte, 180-turn, 1,440-message history, dependencies, v0.1.7
runtime and 1440 x 900 viewport, with Stellar motion enabled:

| Median Phase | Cold-Loading Baseline | Worker Candidate |
| --- | ---: | ---: |
| First heavy: first message body detected in DOM | 3960.4 ms | 4264.7 ms |
| First heavy: last answer detected in DOM | 4161.2 ms | 4478.8 ms |
| First heavy: execution-wait indicator cleared | 4776.3 ms | 4482.0 ms |
| First heavy: early input acknowledgement wait | 4306.8 ms | 11.0 ms |
| First heavy: maximum renderer-probe delay | 4170.1 ms | 3319.8 ms |
| First heavy: cumulative renderer script | 2401.9 ms | 1646.3 ms |
| Resident heavy: execution-wait indicator cleared | 4170.4 ms | 4171.9 ms |

**This does not fix cold-body loading.** Body DOM detection is slightly slower,
resident loading is unchanged, and the renderer still has a roughly 3.3-second
continuous stall. The early input request is queued around 200 ms after clicking:
11 ms is its additional acknowledgement wait before mounting blocks the main
thread, not click-to-ready time or responsiveness throughout loading. DOM,
script and probe observations are not compositor-confirmed paint or acceptance
on the owner's real corpus. All samples retain 360 articles, 2,160 complete code
blocks, actual layout heights, draft text and trusted post-open wheel movement.
Complete React mounting, transforms and browser layout remain the next target.

Evidence: `D:\Desktop Runtime Builds\cold-mount-20261109`, including six
`matched-*.json` receipts, `matched-summary.json`, source manifests, screenshots,
`worker-verification.json` and `verification.json`. The real bundled Worker
passes parser-tree parity for entities, references, footnotes and math, normal
navigation, blocked-Worker fallback and rapid-switch cancellation. Typecheck,
build, 156 focused units and native/browser regression checks pass; see
`VERIFICATION.md`. No package, shortcut update, commit, push, owner-profile
access or deletion is included. Full-suite, cloud and macOS acceptance remain
separate; the performance TODO stays open.

## Heavy-First Cold Loading Follow-Up (2026-11-09)

Owner feedback on the twelfth-pass package still reports 5-10 seconds or more
before a real long conversation feels usable, despite improved warmed navigation.
Earlier "cold heavy" samples open a short conversation first: they establish
nonresident navigation, not the first conversation in a fresh app process.
This follow-up starts with heavy A, then short, then resident heavy A.
It uses new isolated profiles, the same 5,495,514-byte histories, v0.1.7 runtime,
dependencies and 1440 x 900 viewport. No owner history or preferences are read.
The repository's Stellar pack is copied into each synthetic profile.

Two narrow changes keep the complete transcript and its actual layout intact:

- An empty annotation overlay no longer measures the viewport, watches transcript
  mutations/resizes/scrolling or runs pointer hit tests. Nonempty annotations
  retain the existing range, marker and popover behavior.
- Stellar's composer signal colors use the same primary/gold values directly
  on the relevant pseudo-element. Changing an inherited `--stellar-signal` on
  `:root` used to invalidate styles across the entire saved transcript.
  Neither theme motion nor its status indicators are disabled.

Three serial alternating-order runs per side compare the twelfth-pass snapshot
and this follow-up, with Stellar motion enabled:

| Median Phase | Twelfth Pass | Follow-Up |
| --- | ---: | ---: |
| First heavy conversation: last answer detected in DOM | 4279.4 ms | 4144.1 ms |
| First heavy conversation: execution-wait indicator cleared | 6263.5 ms | 4700.6 ms |
| First heavy conversation: early input request to acknowledgement | 5796.7 ms | 4255.2 ms |
| First heavy conversation: cumulative style calculation | 2795.1 ms | 1365.7 ms |
| Resident heavy conversation: wait indicator cleared | 7289.0 ms | 4291.2 ms |
| Four post-load activity changes: cumulative style calculation | 4314.2 ms | 18.0 ms |

All heavy samples retain 360 articles, 2,160 complete code blocks, 103,007
initial descendant elements, the selected session's typed draft and trusted
post-open wheel movement. The runtime startup medians are 943.4/932.4 ms in
this empty synthetic workspace; history reading is around 0.1 second. This
does not establish startup timing for real projects with their own plugins.
The state sweep deliberately forces style/layout after each activity change;
its result is not a whole-app speed-up percentage.

**Cold loading remains unresolved.** First-body DOM detection changes only
4081.4 to 3946.5 ms, and input still waits several seconds. The large gain is
removing unnecessary restyling during navigation/handoff, not making complete
Markdown/React mounting or initial browser layout cheap. DOM and animation-frame
observations are not compositor-confirmed paint or real-account acceptance.
An original-theme exploratory run reproduces a roughly five-second wait too,
so Stellar is an additional cost, not the sole cause of the owner's report.

Evidence: `D:\Desktop Runtime Builds\cold-navigation-20261109`, including
`profile.mjs`, `run-matched.mjs`, six `matched-stellar-*.json` receipts and
`matched-summary.json`. The final source differs from the measured implementation
only by an explanatory CSS comment and test stabilization. There is no new
package or shortcut update for this follow-up; the delivered twelfth-pass package
does not contain it. Full unit-suite, cloud and macOS acceptance remain separate.

## Viewport-First Code Highlighting (2026-11-09)

The twelfth pass starts from the eleventh-pass source. Markdown still uses the
same parser, safe math processing and URL policy. Fenced code appears immediately
as complete selectable source inside the existing code/header/copy components.
Only syntax-token spans are deferred; no transcript row, source text or actual
height is hidden, approximated or virtualized. Inline code bypasses the scheduler.

One document-scoped IntersectionObserver admits blocks within 200 px of the
viewport. An animation-frame queue uses a 4 ms cooperative batch budget.
The same shared rehype-highlight transformer and language registry produce safe
React text/span nodes, without raw HTML or a new dependency. A single grammar
invocation is not preemptible and may exceed the batch budget. Unknown languages,
highlight opt-outs and the absence of automatic language detection retain their
existing semantics. A coloring failure leaves the full plain source readable.

Pointer dragging and native selections intersecting code postpone its token
insertion. The synchronous commit rebases existing CSS Highlight Range endpoints
by character offset, retaining the same Range objects used by search/annotations.
Changed sources and unmounts cancel obsolete jobs. Completed tokens stay mounted
when scrolling away; no eviction or unbounded content cache is added. Without
IntersectionObserver, coloring still starts after source mounting and yields
between blocks, but does not receive viewport prioritization.

Three serial alternating-order runs per side use fresh source Electron profiles,
the same dependencies and pinned v0.1.7 runtime at 1440 x 900, without CPU
throttling or model requests. Each heavy history remains 5,495,514 bytes,
180 turns, 1,440 messages, 540 tool calls/results and 2,160 complete code blocks.
The sequence remains short, heavy A, heavy B, short, resident heavy A.
Cold results pool six samples per side; resident results have three:

| Median Phase | Eleventh-Pass Baseline | Twelfth-Pass Candidate |
| --- | ---: | ---: |
| Cold: last answer detected in DOM | 6186.1 ms | 3948.8 ms |
| Cold: following animation-frame opportunity | 6816.0 ms | 4352.0 ms |
| Cold: cumulative renderer script | 3729.0 ms | 2492.2 ms |
| Cold: cumulative style recalculation | 2078.4 ms | 1061.5 ms |
| Cold: early input request until insertion acknowledged | 6057.1 ms | 3712.1 ms |
| Cold: initial descendant elements | 204480 | 103007 |
| Cold: initial syntax-token spans | 101520 | 47 |
| Resident: last answer detected in DOM | 5818.9 ms | 3456.4 ms |
| Resident: following animation-frame opportunity | 6456.4 ms | 3962.4 ms |
| Resident: cumulative renderer script | 3342.3 ms | 2368.8 ms |
| Resident: early input request until insertion acknowledged | 6538.8 ms | 3976.4 ms |

Both sides retain 360 articles and all code source, including sampled first,
middle and last blocks. Initially just one block is colored in cold samples and
two in resident samples, accounting for the token-only DOM reduction.
Cold DOM ranges are 5684.8-6850.2/3624.4-4262.6 ms; input waits range
5136.0-7247.0/3424.4-4102.0 ms. Resident DOM ranges are
5596.7-6345.3/3314.3-3627.7 ms. The three short-return control DOM medians are
443.2/293.0 ms; that fixture also contains code, so it is not a pure-prose control.
All samples retain the selected session's typed draft and verify real post-open
trusted-wheel movement. Cold post-open wheel medians are 88.6/91.2 ms, with one
candidate sample at 273.7 ms; no general scrolling improvement is claimed.

The frame metric remains a rendering opportunity, not compositor-confirmed
paint. Input acknowledgement is measured separately and does not grant execution
before authoritative runtime readiness. **The multi-second usability problem
remains open:** this local code-heavy corpus improves substantially, but still
waits several seconds. Complete-history Markdown/React mounting and browser
layout remain significant. Pure-prose histories, huge individual code blocks,
histories beyond the reading cache budget and the owner's actual corpus are not
established by these results. No Worker, new parser or row virtualization is used.

Evidence root: `D:\Desktop Runtime Builds\viewport-highlight-20261109`.
`prepare.mjs`, `profile.mjs`, `summarize.mjs`, `matched-summary.json`, six
`matched-{baseline,candidate}-{1,2,3}.json` receipts and source manifests retain
the corpus and measurements. Earlier exploratory results are excluded.
The combined twelfth-pass Windows package is
`D:\Desktop For Step Code\Desktop\release\performance-twelve-20261109-preview`.
Ten checks run against the packaged executable, including the heavy-history
profiler; that single packaged run is correctness evidence, not another matched
performance comparison. `VERIFICATION.md` records integrity, shortcut handoff
and the remaining real-account/release boundaries.

## Tool-Heavy Opening Stalls (2026-11-09)

The eleventh pass starts from the tenth-pass source. Unlike the earlier small
Markdown corpus, this experiment reproduces multi-second renderer stalls without
reading the owner's history. Each heavy JSONL history is 5,495,514 bytes, with
180 turns, 1,440 messages, 540 tool calls/results, saved thinking, applied patches
and 2,160 highlighted code blocks. Each answer remains below the existing
32,768-character large-text threshold. Both sides retain 360 articles, 204,480
descendant elements, actual message heights and identical Markdown content.

A diagnostic CPU profile attributes about 2.5 seconds to forced document
geometry/style work when reading-position restoration runs during mounting.
The original heavy opening writes the viewport's scroll position 1,085-1,086
times, as each tool/thinking disclosure reports its initial layout. The candidate
coalesces those notifications into one animation-frame callback. Parent
message/navigation layout effects and resize observers still restore immediately;
an immediate restoration cancels the pending callback. Explicit scroll intent,
return-to-bottom and unmount also cancel it. Callbacks read current session and
follow/anchor refs, not a captured previous target.

`TurnArtifacts` also memoizes Markdown-derived candidates by reply text, serialized
output paths and platform. A cloned snapshot's equivalent path array no longer
forces reparsing on handoff or unrelated shell updates. File availability,
runtime-specific actions and file checks remain separate and current. No module
cache, new parser, transcript virtualization, hiding, height estimates or runtime
pin/startup change is introduced.

Three serial alternating-order runs per side use isolated real source Electron
profiles and the same v0.1.7 runtime at 1440 x 900. Every run opens short, heavy A,
heavy B, short, then resident heavy A. No CPU throttling or model request is used.
Heavy cold results pool six samples per side; resident results have three:

| Median Phase | Tenth-Pass Baseline | Eleventh-Pass Candidate |
| --- | ---: | ---: |
| Cold: last answer detected in DOM | 6391.7 ms | 6280.8 ms |
| Cold: following animation-frame opportunity | 7735.0 ms | 6930.7 ms |
| Cold: cumulative renderer script | 4810.9 ms | 3715.9 ms |
| Cold: early input request until insertion acknowledged | 6857.6 ms | 5928.2 ms |
| Cold: viewport scroll-position writes | 1086 | 6 |
| Resident: last answer detected in DOM | 10117.3 ms | 5982.6 ms |
| Resident: following animation-frame opportunity | 11326.0 ms | 6659.0 ms |
| Resident: cumulative renderer script | 8641.7 ms | 3331.5 ms |
| Resident: early input request until insertion acknowledged | 11459.8 ms | 6747.7 ms |
| Resident: viewport scroll-position writes | 1086 | 6 |

The frame metric is a rendering opportunity, not a compositor-confirmed paint or
proof that the user could already act. The profiler queues a short CDP renderer
probe repeatedly and a trusted text insertion about 200 ms after clicking.
It verifies the selected session's draft survives, then separately sends a
trusted wheel after settling and verifies an actual scroll-position change.
Post-open wheel medians are 91.8/94.4 ms cold and 120.0/114.3 ms resident;
there is no post-open scrolling speed-up claim. The queued input still waits
multiple seconds. Resident DOM ranges are 6826.8-10355.3/5736.1-6127.7 ms; these
local medians are not an FPS, universal latency or operating-system comparison.

**The reported occasional five-second usability problem is not fixed.** This
pass establishes a representative synthetic reproduction and removes redundant
work. Initial complete-history Markdown/React mounting and browser style/layout
remain substantial; cold DOM detection improves little. Histories beyond the
reading cache's budget and the owner's actual corpus remain unverified.

Evidence root: `D:\Desktop Runtime Builds\transcript-usability-20261109`.
`profile.mjs`, `snapshot.mjs`, `summarize.mjs`, `matched-summary.json` and six
`matched-{baseline,candidate}-{1,2,3}.json` files retain the reproducible corpus,
individual timings and source manifests. Diagnostic CPU profiles and exploratory
runs are excluded from the matched results. See `VERIFICATION.md` for correctness
gates and package boundaries.

## Runtime Compile Cache (2026-11-08)

The ninth pass starts from the eighth-pass source. A diagnostic CPU profile of
the pinned native runtime attributes about 150.7 ms of self time to ESM source
compilation; a separate cache-hit profile records 23.2 ms. These instrumented
samples identify a target, not production timings. Git environment collection
and module initialization remain significant; Git state is not cached because
system prompts must continue reading current project facts.

Main now explicitly sets `NODE_COMPILE_CACHE` to its Desktop-owned
`step-runtime/compile-cache` directory. Generic isolated child environments
remove inherited cache destinations/portability overrides and retain
`NODE_DISABLE_COMPILE_CACHE=1` as an opt-out. A small Desktop-only extension
flushes bytecode once at native `session_start`, so the next worker can reuse it
before the previous process exits or Windows forcibly stops its process tree.
Staging copies this extension without modifying the upstream entry or pin.
The cache stores compiled modules, not session snapshots, permissions or
approval decisions. Node handles invalid/missing/unwritable cache data by
compiling normally. No readiness signal, timeout, worker ownership or sending
gate is bypassed, and no worker is speculatively started.

Three serial alternating-order source Electron pairs use isolated profiles,
the same dependency tree and pinned runtime, eight short local histories and
the existing navigation profiler. Each fresh profile starts with no cache.
The table reports medians, with ranges in parentheses, in milliseconds:

| Navigation phase | Eighth-pass baseline | Ninth-pass candidate |
| --- | ---: | ---: |
| First cold session, empty cache, n=3 | 1045.0 (1027.7-1062.7) | 1068.9 (1033.0-1104.0) |
| Later cold session, cache established, n=6 | 979.1 (911.5-1009.6) | 866.2 (815.2-907.0) |
| Process-ready portion of later cold sessions | 844.2 (774.5-864.6) | 725.0 (677.0-757.5) |
| Session restoration portion of later cold sessions | 50.2 (46.7-55.5) | 49.5 (44.3-52.0) |
| Resident return, n=3 | 28.3 (26.3-29.8) | 26.7 (26.2-30.0) |
| Rapid latest-target readiness, n=3 | 1040.0 (994.2-1066.8) | 921.0 (881.4-934.9) |

The later-cold readiness median decreases about 11.5%, or 112.9 ms. Cold history
reading remains independent of readiness: later-cold readable medians are
21.9/19.3 ms, and editable isolated draft medians are 9.0/8.2 ms. Editing a
navigation draft is still not permission to send a task. Resident returns do
not compile a new runtime and have no material improvement claim.

A separate direct-process comparison uses no inspector or diagnostic preload.
It runs three fresh profiles per side, then two forced-stop restarts per
profile. First-use readiness medians are 757.3/814.8 ms; cache-hit medians are
732.5/625.2 ms, with ranges 700.6-769.4/596.7-642.2 ms. This explicitly records
the first-use cost: caching is not a universal or first-install acceleration.
Each measured App cache is about 2.36 MiB. Package/runtime relocation or module
changes can produce misses; the experiment does not establish cross-version
reuse, whole-app launch acceleration or an operating-system comparison.

Evidence and runnable snapshot/measurement helpers are under
`D:\Desktop Runtime Builds\runtime-startup-performance-20261108`.
`summary.json` separates first use, established cache, resident and rapid
selection; `direct-runs.json`, `matched-runs.json`, CPU profiles and native
acceptance receipts preserve individual results. Snapshots share only
dependencies and unchanged upstream binaries via junctions; the candidate's
Desktop extension is copied into a private runtime overlay. No shared runtime
or upstream checkout is restaged. No package, owner-app restart, shortcut
change, cloud or native macOS acceptance is included.

## Sidebar Render Isolation (2026-11-08)

The eighth pass starts from the seventh-pass source, not untouched main.
Previously, an unrelated shell update rebuilt the session tree, regrouped its
sessions and rendered every title. Runtime summaries also recreated all matching
session objects even when their names had not changed. In separate diagnostic
runs, 60 streamed updates executed the title component 11,529 times with 180
sessions and 63,189 times with 1,000 sessions, despite zero sidebar DOM mutations.

`SidebarTree` now owns the original navigation markup and motion hook. Its
memoized tree receives only sidebar-relevant preferences, effective activity,
selection, disclosure and drag targets, not pointer coordinates or unrelated
shell state. Grouping uses keyed lookups rather than repeated independent-list
membership scans. Memoized rows retain the original `Session` object when names
have not changed. Effective activity maps retain identity across metadata-only
runtime changes, without hiding waiting, failure, interruption or unread state.
Stable action delegates invoke the latest committed shell handlers; row callbacks
do not retain obsolete session names, sibling order or navigation closures.

The candidate diagnostic executes 183/1,003 title components: one final
authoritative catalog refresh, not every text delta. Both implementations retain
all original row nodes and record zero sidebar mutations in the measured stream.
The diagnostic isolation gate permits at most one final refresh; it fails on the
baseline and passes on the candidate. These instrumented executions explain the
mechanism; their timings are not used for the comparison below.

Three serial, alternating-order production pairs use the identical final fixture,
installed dependencies and Edge `157.0.4341.42` at 1440 x 900. Each receives 60
paragraph updates at nominal 40 ms intervals over 180 completed turns. Order is
baseline/candidate, candidate/baseline, baseline/candidate. No diagnostic counter,
compiler or other acceptance from this task runs alongside the measured browser.
Unrelated shared-host activity is uncontrolled. Values are cumulative medians:

| Sidebar Sessions | Script Baseline / Candidate | Style Baseline / Candidate | Layout Baseline / Candidate |
| --- | ---: | ---: | ---: |
| 180 | 735.8 / 503.9 ms | 232.6 / 237.6 ms | 45.4 / 47.1 ms |
| 1,000 | 1572.4 / 522.3 ms | 260.3 / 307.2 ms | 43.5 / 44.6 ms |

Script ranges are 707.5-743.8 / 479.0-547.0 ms for 180 sessions and
1473.2-1625.7 / 518.7-566.1 ms for 1,000. Script medians are approximately
32% and 67% lower; this is not response latency or an app-wide speed-up.
At 1,000 sessions, sampled frames over 32 ms change from a median of 26
(range 18-32) to two in all three candidate runs. Layout is effectively unchanged;
style is slightly higher at 180 and about 18% higher at 1,000 sessions. A final
catalog refresh and long frames still remain. No fixed-FPS or Windows/macOS
comparison is established.

### Navigation Attribution

The same production fixture separately measures selected-row feedback, readable
history, editable navigation drafts and authoritative readiness with 1,000 rows
and short history. Its history and navigation bridges deliberately wait 35 and
220 ms. Cold selection/readable/ready medians are 32.0/116.2/356.3 ms before and
26.2/91.9/294.1 ms after. Rapid latest-selection/readable medians are
119.5/168.3 ms before and 77.7/124.1 ms after. These are frontend measurements
under synthetic delays, not evidence of a faster backend or real model.

The existing real Electron navigation profiler also runs against both source
builds, using eight short local histories, an isolated profile and the actual
v0.1.7 RPC without a model request. In the candidate's three cold samples, history
is readable in 15.5-37.3 ms but authoritative readiness takes 798.7-849.7 ms.
Its startup receipts attribute 674.6-720.8 ms to process readiness and
38.3-40.6 ms to session restoration. A resident return is readable in 12.1 ms
and ready in 22.6 ms. An editable isolated navigation draft is not permission to
send a task before authoritative handoff. The single native baseline/candidate
pair is attribution, not a repeatable startup speed-up claim; cold startup remains
a separate optimization target.

### Reproduction

From `Desktop/`, set `DESKTOP_BROWSER_CHANNEL=msedge` and
`DESKTOP_SIDEBAR_LABEL` separately in PowerShell, then run
`node scripts/profile-sidebar-interaction.mjs`. It builds the actual App fixture,
profiles both catalog sizes and closes its browser/server. Diagnostic mode is
`DESKTOP_SIDEBAR_DIAGNOSTIC=1`; add `DESKTOP_SIDEBAR_REQUIRE_ISOLATION=1` for
the render-count regression gate. Leave both unset for timing comparisons.
The fixture accepts `sessions=large` for 1,000 rows; no product virtualization,
estimated heights, hidden history or delayed text output is added.

`node scripts/verify-sidebar-interaction.mjs` checks runtime activity/unread
transitions and drag locks, retained row identity through renaming, current
copy-reference/navigation actions, fresh keyboard sibling order, rapid latest
selection, light/dark 1440/760/390 px, keyboard focus and reduced motion.
Existing native order/search/move/navigation checks remain separate.

Evidence root: `D:\Desktop Runtime Builds\sidebar-interaction-performance-20261108`.
`matched-summary.json`, six per-snapshot
`Desktop/test-results/sidebar-interaction/matched-*.json` receipts and
`shared-harness.json` preserve the timing inputs/results. Instrumented gate logs
are `isolation-gate-{baseline|candidate}.log`; the candidate also writes its
diagnostic receipt. Each native snapshot retains
`Desktop/test-results/session-navigation-performance-eighth-{baseline|candidate}.json`.
See `VERIFICATION.md` for acceptance boundaries.

## Shared Highlight Grammars (2026-11-08)

The seventh pass starts from the sixth-pass source, not untouched main.
Profiling separates complete-document block reading, prepared-tree cloning,
Markdown transforms, highlighting setup, highlighting and rendering. Each
`react-markdown` render creates a processor; its old highlighter setup registers
all common language grammars again, even when the document has no code.
Repeated code highlighting also loses the already-compiled grammar work.

The existing `rehype-highlight` transformer is now initialized lazily once per
renderer module and reused by message, Plan and file-preview processors.
Only grammar registration/compilation is shared: each code value still goes
through the original complete highlighter, with a new per-call token state.
No source/output cache, growing-block syntax guess, new parser, output throttle,
worker, virtualization or UI redesign is added. Full-source definitions,
footnotes, URL policies, math, code copy and progressive text reveal are unchanged.
The parser and React/DOM costs of one growing block still remain.

Three serial matched production pairs use identical final harnesses/dependencies,
Edge `157.0.4341.42`, 1440 x 900, 180-character source increments at nominal
40 ms intervals, and all six corpus scenarios below. Order is baseline/candidate,
candidate/baseline, baseline/candidate. No tracing or other compiler/acceptance
from this task runs alongside the profiles; unrelated shared-host activity is
uncontrolled. Values are cumulative script-time medians, not response latency,
FPS guarantees or CI thresholds:

| Content | Characters | Script Baseline / Candidate | p95 Update Baseline / Candidate |
| --- | ---: | ---: | ---: |
| Separate paragraphs | 5139 | 152.7 / 102.6 ms | 8.4 / 4.7 ms |
| Separate code blocks | 9948 | 167.1 / 98.4 ms | 4.5 / 2.6 ms |
| Formulas | 1107 | 73.9 / 57.7 ms | 13.0 / 10.2 ms |
| Mixed content | 16194 | 460.7 / 344.9 ms | 8.2 / 5.8 ms |
| Single growing paragraph | 8910 | 146.4 / 121.2 ms | 3.6 / 3.3 ms |
| Single growing code block | 10021 | 328.7 / 256.4 ms | 9.2 / 7.5 ms |

Script ranges are 327.7-331.5 / 254.0-256.9 ms for growing code,
143.4-149.8 / 120.7-121.4 ms for a single paragraph, and
452.9-474.0 / 344.2-345.8 ms for mixed content. These are approximately
22%, 17% and 25% lower medians respectively. Layout/style do not materially
improve. This does not establish another sidebar or OS-wide speed-up.

The separate Node pipeline diagnostic skips unchanged prepared blocks but does
not model React memoization, reveal expiry, layout or paint. In its fixed scenario
order, the first prose scenario pays the one-off setup (35.0 / 6.3 ms medians);
later scenarios reuse it. Mixed highlighter setup is 61.1 / 0.1 ms and code
highlighting itself is 81.8 / 23.7 ms. These explain the mechanism, not extra
browser savings to add to the table. Initialization is lazy, not moved into app
startup. The Node and production-browser timing totals are not interchangeable.

Twelve focused highlighter tests require transformer reuse and compare fresh
upstream output for partial/complete multi-line JS/Python, embedded HTML,
JSON/CSS, unknown/plain languages, nested fences and code/math. Alternating open
tokens and unrelated documents exercise per-call isolation. The reuse assertion
fails on the sixth-pass implementation and passes after the change.
The production verifier additionally checks immediate partial and final output
equivalence for all six scenarios, retained code/math DOM, native selection,
copy feedback, late definitions, footnotes, completion, light/dark 1440/760/390 px
and reduced motion.

Evidence root:
`D:\Desktop Runtime Builds\streaming-tail-performance-20261108`.
`matched-summary.json` records medians/ranges; each snapshot retains three
`matched-{baseline|candidate}-{1|2|3}.json` browser receipts under
`Desktop/test-results/streaming-markdown/`. Separate Node receipts are
`pipeline-matched-{baseline|candidate}-{1|2|3}.json` in the evidence root.
Run `node scripts/verify-streaming-markdown.mjs` with
`DESKTOP_BROWSER_CHANNEL=msedge` and `DESKTOP_STREAMING_LABEL` for the browser
check. For stage diagnostics, run
`DESKTOP_MARKDOWN_PROFILE_BLOCKS=1 node --import tsx scripts/profile-streaming-markdown.ts`
(set the environment variable separately in PowerShell); leave it unset for the
original full-document diagnostic. See `VERIFICATION.md` for final acceptance.
No package, cloud, macOS or real-account acceptance is implied.

## Panel Gesture Style Isolation (2026-11-08)

The sixth pass starts from the fifth-pass source. A diagnostic ablation leaves
the measured-width controller and pointer capture intact, but neutralizes the
app-root drag cursor and selection rules. Acquisition style time drops from
183 to 53 ms in that exploratory pair. This is diagnostic evidence, not the
matched production comparison below.

The product change keeps `cursor: ew-resize` and `user-select: none` on the
actual handle, instead of switching cursor/selection styles on `.app` at the
start and end of every drag. Existing pointer capture continues to target the
handle when the pointer moves over transcript/panel content. The drag attribute,
transition suppression, pointer lifecycle, input cancellations and preset snap
remain unchanged. There is no new pointer-blocking overlay or output throttle.
The handle focus outline also uses the actual `--primary` theme token instead
of an undefined `--accent` token.

Full acceptance also reproduces a 79 px paused-reading drift in the fifth-pass
baseline: native scrolling from a width animation can arrive before its
ResizeObserver, appear uncoordinated, and release widths with a newly shifted
anchor. While widths are protected, a changed viewport width is now reconciled
against the original gesture anchor before classifying that scroll. Stable-width
uncoordinated scrolling still releases protection; wheel/touch, keyboard,
selection, focus, native resize and explicit navigation retain their direct
cancellation paths. Viewport geometry is sampled before the anchor rect and the
current scroll position. Native scroll anchoring remains enabled.

Three new controller regressions cover viewport reads that apply anchoring,
scroll-before-resize delivery, and genuine input during pending resize delivery.
The first two fail before their respective fixes; all 21 controller cases pass
afterward. Diagnostic scroll accessors are optional in the App verifier via
`DESKTOP_INTERACTION_SCROLL_DIAGNOSTICS=1`. Adding extra geometry/scroll-position
reads can change native ordering, so final acceptance leaves this flag off.

Three serial matched production pairs use identical fixtures/dependencies,
Edge `157.0.4341.42`, 1440 x 900 and 180 completed turns. Order is
baseline/candidate, candidate/baseline, baseline/candidate. Tracing and injected
diagnostic CSS are disabled. This task schedules no other compiler or acceptance
alongside profiling; unrelated activity on the shared host is not controlled.
Values are medians, not CI limits:

| Phase | Style Baseline / Candidate | Layout Baseline / Candidate | Maximum Frame Baseline / Candidate |
| --- | ---: | ---: | ---: |
| Acquire | 110.3 / 70.1 ms | 4.0 / 4.5 ms | 174.9 / 104.1 ms |
| Move | 6.7 / 7.4 ms | 78.2 / 78.3 ms | 29.3 / 20.8 ms |
| Release and settle | 159.3 / 83.4 ms | 31.9 / 52.4 ms | 179.2 / 95.9 ms |

Acquisition style ranges are 103.7-138.9 / 57.8-82.0 ms; release ranges are
144.9-165.9 / 78.0-85.8 ms. Acquisition/release style medians decrease by about
36%/48%. Their maximum frame medians decrease by about 40%/46%. Phase frame
attribution uses sampled action boundaries and can include a crossing frame.
Release layout/script time does not improve: genuine final reflow remains,
and these observations do not establish a universal sub-100-ms interaction.

Another three serial matched pairs exercise all three streaming scenarios,
with exactly 60 additional paragraphs at nominal 40 ms intervals. During a
drag, style medians change from 529.5 to 377.0 ms (ranges 509.2-541.3 /
367.4-384.3 ms), maximum frame from 187.5 to 145.9 ms, and layout from 135.6
to 128.6 ms. Frames over 32 ms change from 6 to 4 and p95 from 20.8 to 20.9 ms.
No new non-drag speed-up is claimed from the modest variation in those runs.
Every profile checks 360 original mounted articles after an idle gesture, or
362 articles and all 60 paragraphs after streaming.

`scripts/verify-panel-gesture.mjs` uses the actual App production fixture.
It checks captured pointer targets, hover/cursor, no new native selection,
unchanged root styles and complete width cleanup across light/dark,
1440/760/390 px and reduced motion. It also checks real text selection after
release, retention of a pre-existing selection while dragging, click/keyboard
menus, visible keyboard focus, preset navigation, Escape, pointer cancellation
and native capture release. The existing native summary-resize verifier also
checks an actual Electron captured drag outside the handle.

Evidence root:
`D:\Desktop Runtime Builds\panel-gesture-isolation-20261108`.
`gesture-final-matched-summary.json` and `streaming-final-matched-summary.json`
contain the final-source medians/ranges; each snapshot retains its three
`final-matched-{baseline|candidate}-{1|2|3}.json` receipts under
`Desktop/test-results/panel-gesture/` and `streaming-interaction/`.
From an isolated snapshot's `Desktop/`, run `node scripts/profile-panel-gesture.mjs`
with `DESKTOP_BROWSER_CHANNEL=msedge` and a `DESKTOP_PANEL_GESTURE_LABEL`.
Leave `DESKTOP_PANEL_GESTURE_NEUTRALIZE_INHERITED` and
`DESKTOP_PANEL_GESTURE_TRACE` unset/`0` for ordinary production measurements.
The former is only a causal diagnostic; the latter enables an unminified
CPU/timeline trace, whose timings are not interchangeable with production.
Earlier CSS-only comparisons remain separate; their numbers are not substituted
for the final-source comparison above.
No package, macOS, cloud or real-account acceptance is implied.

## Streaming Drag Protection (2026-11-08)

The fifth pass starts from the fourth-pass source. Diagnostic scroll-write
stacks and layout-window events show that automatic tail following advances
`scrollTop` before the layout controller's ResizeObserver. Its independent
expected position then misclassifies that programmatic scroll as user input
and releases distant widths, typically at the first delta after acquisition.
The remaining gesture reflows the full history.

- Coordinate automatic tail corrections with the existing layout controller.
  Genuine uncoordinated scrolling, wheel/touch, keyboard input, selection,
  focus, native resizing and explicit navigation still release protection.
- Compare actual indexed article node membership, not every direct child
  mutation. Removing the non-article working indicator at completion does not
  invalidate historical widths; inserting, removing, reordering or replacing
  an indexed article still does, including before an armed transition locks.
- Retain the original gesture anchor at normal settlement. Measure the final
  anchor geometry before reading the current `scrollTop` for its correction:
  the geometry read can itself apply native scroll anchoring. User cancellation
  instead captures the current position. No native anchoring policy is disabled.

The live answer and nearby history remain normally responsive throughout.
There is no output throttle, transcript virtualization, estimated height,
discarded history or new snapshot/state-store architecture.

Three serial matched production pairs use identical harness/dependencies,
Edge `157.0.4341.42`, 1440 x 900, 180 initial turns and exactly 60 additional
paragraphs at nominal 40 ms intervals. Every run checks all 362 articles and
60 paragraphs. Order is baseline/candidate, candidate/baseline,
baseline/candidate; no compiler or other acceptance job runs concurrently.
The baseline is the fourth-pass implementation, not the original unoptimized
application. Values are medians, not CI thresholds:

| Scenario | Layout Baseline / Candidate | Style Baseline / Candidate | Script Baseline / Candidate |
| --- | ---: | ---: | ---: |
| Streaming only | 43.5 / 45.0 ms | 244.0 / 253.2 ms | 772.5 / 792.1 ms |
| Context inspector open | 40.9 / 44.1 ms | 254.2 / 288.9 ms | 782.9 / 851.6 ms |
| Streaming while dragging | 890.0 / 147.4 ms | 531.4 / 539.6 ms | 878.8 / 902.6 ms |

Drag layout ranges are 876.2-1029.9 / 131.9-178.7 ms, an approximately 83%
median reduction. Sampled frames over 32 ms change from 64 to 17; p95 frame
interval from 66.7 to 25.0 ms. Maximum frame medians are still 208.3/225.0 ms:
acquisition and final full reflow can still stall. Overall automated workload
duration changes from 7.85 to 4.54 seconds, but depends on timer/input scheduling
and is not a response-speed or constant-FPS promise. Style/script medians do not
improve. Non-drag medians are higher in these samples, with ranges and outliers
recorded in the receipts; no non-drag speed-up or causal regression attribution
is claimed from three runs. Historical turn queries remain 181 in every run.

In all three candidate profiles, protection persists until the drag is released;
all three baselines release it while still dragging. The actual-App verifier
also holds a gesture across multiple deltas and completion in both paused-history
and tail-follow modes, checks the current answer is never width-locked, checks
every paragraph, and requires all temporary widths to clear at settlement.
The paused article and offset remain unchanged; the tail distance remains at
most 2 px before and after settlement. Selection/copy/quotes, search and turn
navigation, cancellation, session replacement, current providers, light/dark,
narrow layouts and reduced motion remain separate correctness gates.

Evidence and isolated snapshots:
`D:\Desktop Runtime Builds\streaming-drag-performance-20261108`.
Each snapshot has `matched-{baseline|candidate}-{1|2|3}.json` under
`Desktop/test-results/streaming-interaction/`; `matched-summary.json` records
medians, ranges and protection lifetime. Run the same profiling command below
against the fourth-pass and candidate snapshots. Ordinary benchmarks leave
`DESKTOP_STREAM_INTERACTION_TRACE`, `DESKTOP_STREAM_INTERACTION_INVALIDATIONS`
and `DESKTOP_STREAM_INTERACTION_SCROLL_DIAGNOSTICS` unset or `0`. Tracing alone
now excludes heavyweight invalidation tracking; opt into that separately with
`DESKTOP_STREAM_INTERACTION_INVALIDATIONS=1`. Optional scroll diagnostics record programmatic write stacks.
Unminified diagnostic durations are not compared with these production results.

## Streaming Update Isolation (2026-11-08)

The fourth pass starts from the third-pass source snapshot. A production
actual-App trace identifies repeated historical style invalidation and
navigation-node queries, in addition to Markdown work:

- Replace `.app:has(.settings-backdrop)` with the existing React settings-open
  state expressed as a root data attribute. The old ancestor selector's
  invalidation sets revisit historical buttons/icons on prose insertion.
  The attribute stays present throughout the settings closing animation;
  window-bar layering and modal inertness are unchanged.
- Retain the user-turn projection when its indices, normalized previews and
  timestamps have not changed. Navigation observers keep their current nodes
  during assistant/tool deltas, but reset for another runtime/session/draft,
  including sessions with identical previews. This is a bounded projection
  cache, not a message store or a transcript cache.
- Memoize command-context usage and question-context values. Real usage,
  language and pending-request changes still propagate; question actions use
  the current requests and navigation guard. The App itself still updates.
  No broad sidebar/store extraction or new output throttle is introduced.

The profile uses the actual App fixture with 180 initial turns and exactly
60 additional paragraphs at nominal 40 ms intervals. All 362 articles and all
60 paragraphs are checked after completion. Three serial matched runs use
identical harness/dependencies, Edge `157.0.4341.42` and 1440 x 900. Order is
baseline/candidate, candidate/baseline, baseline/candidate; no compiler or native
verifier runs concurrently. Values below are medians, not CI thresholds:

| Scenario | Style Baseline / Candidate | Script Baseline / Candidate | Layout Baseline / Candidate |
| --- | ---: | ---: | ---: |
| Streaming only | 1466.4 / 248.2 ms | 1197.6 / 803.1 ms | 41.1 / 48.4 ms |
| Context inspector open | 1473.1 / 289.3 ms | 1217.4 / 869.7 ms | 42.7 / 46.1 ms |
| Streaming while dragging | 1850.4 / 575.5 ms | 1317.2 / 886.5 ms | 886.8 / 921.6 ms |

Historical turn-node queries change from **11,041 to 181** in every matched
scenario/run: initial turn insertion still acquires the nodes, subsequent
assistant updates do not. Streaming-only style ranges are 1443.5-1500.8 /
246.2-270.3 ms, and script ranges 1145.2-1225.2 / 756.0-873.1 ms. Sampled
frames over 32 ms have medians 62/1 without the inspector, 62/3 with it,
and 103/64 while dragging. This supports reduced redundant work, not a
constant-FPS or OS-wide claim.

Layout does **not** improve in this comparison. Streamed dragging remains
expensive: candidate layout ranges from 890.1 to 1132.1 ms and pointer
completion time varies substantially. Authoritative completion snapshots and
single growing Markdown blocks still have work to do. Diagnostic traces use
extra invalidation tracking and sometimes unminified output; their durations
are not compared with these minified, untraced measurements. Removing the
selector from an already loaded stylesheet was not a useful timing ablation;
the comparison uses fresh compiled snapshots.

The actual-App verifier additionally checks zero historical-node reacquisition
after streaming has started; a replacement session reacquires its own nodes and
still navigates correctly. Saved `/clm` icons receive changed context usage.
Question drawers reopen current requests, expire, and show replacement content.
Settings layering persists through closing and clears afterward in light/dark,
1440/760/390 and reduced-motion layouts. Existing selection/copy/quotes,
reading anchors, context JSON, drag cleanup and search/navigation gates remain.

Snapshots and evidence:
`D:\Desktop Runtime Builds\streaming-isolation-20261108`.
Each snapshot has `matched-final-{baseline|candidate}-{1|2|3}.json` under
`Desktop/test-results/streaming-interaction/`; `matched-final-summary.json`
at the evidence root records medians and ranges. Reproduce from `Desktop/`:

```powershell
$env:DESKTOP_BROWSER_CHANNEL = 'msedge'
$env:DESKTOP_STREAM_INTERACTION_LABEL = 'candidate'
node scripts/profile-streaming-interaction.mjs
```

For a comparison copy only the identical fixture and profiler into the prior
snapshot, not the fourth-pass product edits. Optional diagnostic tracing uses
`DESKTOP_STREAM_INTERACTION_TRACE=1`; a single scenario can be selected with
`DESKTOP_STREAM_INTERACTION_SCENARIO=stream-context`.

## Streaming Markdown Block Reuse (2026-11-08)

`markdown-blocks.ts` uses the existing remark parser, GFM and math extensions to
parse the complete current source. Top-level AST blocks retain identity when their
source and definition context are unchanged. React memoization then avoids
repeating their Markdown transforms, highlighting, formula rendering and DOM work.
This is incremental **rendering**, not an incremental Markdown parser and not
splitting source on blank lines.

Prepared block trees are cloned before the normal react-markdown transforms.
Positions and reveal batches are localized to the block's UTF-16 source offsets.
Append-only source updates can reuse blocks; non-append replacement and changed
link definitions invalidate the cache. Definitions include those nested in lists
and blockquotes, in complete-document traversal order; this context precedes each
block so a nested duplicate cannot override an earlier definition. Any footnote
reference/definition takes the
complete-document path so numbering, repeat references and the final footnote
section remain correct. The cache is local to one mounted text component, contains
only current blocks, and is retained at stream completion to avoid remounting.
Historical replies that were never streamed still take the original full path.
The existing 32,768-character paginated-plain-text boundary is unchanged.

The standard components and new-text-only fade remain in place. Completed code
blocks do not receive prose reveal batches. Stable component mappings preserve
code copy feedback, links and formula nodes across later deltas. There is no new
output throttle, typewriter buffer, truncation, estimated height or transcript
virtualization. A single still-growing paragraph/code block/list must still be
processed as a changing block; this optimization does not promise to eliminate
that cost.

`scripts/profile-streaming-markdown.ts` measures parser, remark, bridge, KaTeX,
highlight and reveal stages using fixed source prefixes. Its Node/static-render
observations identify candidate work, not browser responsiveness. The dedicated
production browser fixture mounts the real shared `Text` component, uses identical
180-character updates at 40 ms intervals, and separately samples paragraphs,
code blocks, formulas, mixed output, one growing paragraph and one growing code
block. Browser measurements must be serial against the accepted second-pass
snapshot and the candidate using the same dependencies, viewport and browser.

The verifier checks output against the original full renderer, including late
link definitions and footnotes, plus code copying, retained code/math/selection,
completion, reduced motion and light/dark 1440/760/390 screenshots. Empty `style`
attributes left by React after removing a reveal delay are normalized only in the
DOM equivalence comparison; actual styles and content are not ignored. Unit tests
compare complete and partial source prefixes, nested lists/quotes, tables,
setext headings, code fences, currency/math, commands, unsafe HTML/URLs,
definitions (including nested and duplicate definitions), cache invalidation and
nonmutation.

Evidence and isolated source snapshots live under
`D:\Desktop Runtime Builds\streaming-markdown-performance-20261108`. Run from
`Desktop/` with the project toolchain:

```powershell
$env:DESKTOP_BROWSER_CHANNEL = 'msedge'
$env:DESKTOP_STREAMING_LABEL = 'candidate'
node scripts/verify-streaming-markdown.mjs
```

For the baseline, copy only the fixture, corpus, CSS and verifier into the saved
snapshot and set `DESKTOP_STREAMING_BASELINE=1`; original rendering still has to
pass output/interaction gates, while lost code/math/copy-state identity is reported
instead of requiring the old implementation to have the new optimization.
No benchmark timing is a CI threshold or a frame-rate guarantee.

### Third-Pass Measurement

Windows Edge `157.0.4341.42`, 1440 x 900, identical dependencies and fixed
180-character prefixes every 40 ms. The baseline is the accepted second pass;
only the candidate includes block reuse. Final runs are serial, without a
compiler, native verifier or full test suite running concurrently.

| Streaming Source | Baseline Script | Candidate Script |
| --- | ---: | ---: |
| Paragraphs, 5,139 characters | 176.5 ms | 156.9 ms |
| Multiple code blocks, 9,948 characters | 535.8 ms | 169.8 ms |
| Formulas, 1,107 characters | 182.6 ms | 89.7 ms |
| Mixed, 16,194 characters | 2218.1 ms | 570.3 ms |
| One growing paragraph, 8,910 characters | 161.3 ms | 174.1 ms |
| One growing code block, 10,021 characters | 487.2 ms | 402.3 ms |

The mixed case records layout time of 409.8/36.7 ms and style time of
1008.2/126.9 ms. Its p95 synchronous update work changes from 43.1 to 10.2 ms;
sampled frames over 32 ms change from 58 to zero. These are single-run
observations, not stable FPS or universal speed-up claims.

The single-growing-paragraph control does **not** improve: its script time
increases by about 8% in this run. Conservative full-source parsing, tree cloning
and memoization have a cost when there is nothing stable to reuse. Its p95
synchronous update work is 4.4/4.8 ms. The one growing code block records a smaller
script reduction, about 17%, and p95 update work of 15.8/11.9 ms; it still requires
whole-block highlighting on each update. Neither result establishes repeatable
single-block speed-up. Growing source skips unnecessary AST signature comparisons,
but remaining work is not concealed by buffering output or weakening syntax.

The candidate retains code/math DOM nodes, the existing selection and code-copy
feedback across append and stream completion. The baseline loses code/math
identity and copy feedback on append; this is recorded rather than required of
the old renderer. Both versions pass full-render equivalence, late definitions,
footnotes, copying, completion, reduced motion and the visual matrix.

Receipts: `matched-final-baseline.json` and `matched-final-candidate.json` under
each snapshot's `Desktop/test-results/streaming-markdown/`. The candidate's
`streaming-regression.json` under `test-results/long-session-interaction/`
also passes the actual-app interaction gates. Timings in that regression run
are not a new matched comparison and do not imply another sidebar speed-up.

## Long-History Opening (2026-11-09)

The tenth pass starts from the ninth-pass package source, not untouched main.
The read-only preview and authoritative transcript now use the same provider
hierarchy and session key. Unchanged Markdown/highlight DOM and local disclosure
state survive handoff; changed authoritative content still replaces preview text.
Preview questions remain inert, with execution and runtime-owned actions gated.
Conversation timestamps share a locale/time-zone formatter instead of rebuilding
one per message. The zone is rechecked on conversation render; the invalid-date
guard and standalone message-action formatting remain intact.

Three serial, alternating-order real source Electron runs per side open the same
three isolated local histories: 3 turns, 180 turns, 180 turns, then return to the
short and first long session. There are six cold long samples and three resident
long samples per side. Both builds use identical dependencies, unchanged v0.1.7
runtime and complete prose/table/highlighted-code content at 1440 x 900.

| Click-To Phase, Median | Ninth Pass | Tenth Pass |
| --- | ---: | ---: |
| Cold long history first readable | 463.0 ms | 443.9 ms |
| Cold long history authoritative ready | 1167.1 ms | 811.0 ms |
| Cold long history settled, two extra frames | 1312.8 ms | 925.8 ms |
| Resident long history first readable | 380.2 ms | 370.9 ms |
| Resident long history authoritative ready | 798.2 ms | 466.5 ms |
| Resident long history settled | 927.5 ms | 564.9 ms |
| Cold long history cumulative script | 836.7 ms | 552.1 ms |
| Resident long history cumulative script | 680.0 ms | 408.0 ms |

All 15 baseline opens replace the first prose node at handoff; all 15 candidate
opens preserve it. Each long opening retains 360 articles and 180 highlighted
code blocks, with no transcript hiding or height estimates. Cold short readiness
is essentially unchanged: 933.9/932.7 ms.

This removes about 31% of cold long readiness and 42% of resident long readiness,
but only about 4%/2% of first-readable latency. Initial full-history Markdown
mounting remains costly; this is not a claim that sidebar opening is instant,
disk access is the bottleneck, or macOS/Windows are now equivalent. No additional
scroll-thumb, runtime-startup or history-cache change is made in this pass.
The owner specifically reports occasional waits over five seconds until real
history is readable, scrollable and operable. This synthetic corpus does not
reproduce that delay. Authoritative runtime readiness is not the same acceptance
criterion as usable transcript paint/input latency; the reported issue remains
open for a representative reproduction.

Receipts and source snapshots:
`D:\Desktop Runtime Builds\session-opening-performance-20261108`.
`matched-summary.json` pools six uninstrumented runs; `diagnostic.*` and
`exploratory.*` are separate attribution runs and excluded from the medians.
The native/browser correctness gates and package boundary are in `VERIFICATION.md`.

## First-Pass Measurement

Windows, installed Edge `157.0.4341.42`, 1440 x 900, 180 turns. Baseline
`e419143` and the candidate use the identical final fixture/verifier and shared
dependencies in separate directories. These are single-run CDP observations,
not CI timing thresholds or a promise of constant frame rate:

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Open context: script time | 264.2 ms | 36.1 ms |
| Drag inspector: script time | 432.8 ms | 28.1 ms |
| Drag inspector: layout time | 1454.8 ms | 862.7 ms |
| Drag inspector: turn geometry reads | 7200 | 360 |
| Hide sidebar: script time | 332.1 ms | 21.7 ms |
| Show sidebar: script time | 238.9 ms | 16.9 ms |
| Workspace disclosure DOM feedback, with 350 ms save | 482.8 ms | 9.7 ms |

The candidate's disclosure commits before the save resolves; the baseline
commits afterward. Drag layout and streamed-resize long tasks still remain.
Both the deterministic geometry count and causal save ordering are stronger
regression signals than machine-dependent frame intervals.

Receipts: `matched-baseline.json` in the isolated baseline and
`matched-candidate.json` plus visual matrices in the candidate, beneath
`D:\Desktop Runtime Builds\long-session-performance-20261107`.
See `VERIFICATION.md` for test results and acceptance boundaries.

## Second-Pass Measurement (2026-11-08)

The comparison below starts from the first pass, not from untouched main. Both
snapshots use the identical final production fixture/verifier, shared
dependencies, Edge `157.0.4341.42`, 1440 x 900 and 180 turns. Browser runs are
serial on this shared Windows host; timings are observations, not CI thresholds.

| Measurement | First Pass | Second Pass |
| --- | ---: | ---: |
| Drag inspector: layout time, including settlement | 758.0 ms | 117.2 ms |
| Drag inspector: style time | 282.2 ms | 290.2 ms |
| Drag inspector: script time | 23.8 ms | 28.5 ms |
| Drag inspector: sampled frames over 32 ms | 40 | 2 |
| Drag while reading old text: layout time | 609.1 ms | 127.1 ms |
| Drag during streaming: layout time | 584.1 ms | 160.5 ms |
| Navigation requested during width animation | Target missed | Target visible |

This is about an 85% reduction in cumulative drag **layout** time, not an 85%
reduction in all rendering work or a frame-rate guarantee. Style recalculation,
acquisition and final reflow still cost time: the second-pass drag recorded
174/150 ms long tasks and a 175 ms maximum sampled frame. Streaming still has
49 sampled frames over 32 ms and substantial style/script work. Sidebar
transitions through spare space do not acquire widths; no additional sidebar
speed-up is claimed from these traces.

The reading test ends at an actually different transcript width, 780 to 452 px.
Article 81 remains the anchor, with its offset changing from 16.625 to 16.875 px.
All 360 original articles remain mounted, retain their node identities and stay
visible; 357 distant articles are width-locked during the sampled drag, with
none locked after settlement. The old snapshot's new mid-animation navigation
check is recorded as a baseline failure, not silently counted as acceptance.

Receipts: `first-pass/Desktop/test-results/long-session-interaction/matched-first-pass.json`
and `candidate/Desktop/test-results/long-session-interaction/matched-layout-final.json`
under `D:\Desktop Runtime Builds\long-session-layout-20261108`.

## Measured-Width Layout Window

For histories with at least 80 rendered articles, a width gesture temporarily
keeps distant history at its existing measured width. Nearby articles (one
viewport of overscan on either side), the last two articles, live responses and
keyboard-focused articles keep normal responsive layout. An existing text
selection bypasses the optimization. No rows are removed, remounted, hidden or
given estimated heights.

Pointer dragging starts the window before the first width write. Automatic
panel/sidebar transitions arm it only when the transcript's width really changes,
not when an animation merely consumes unused margins. The reader's original
article/offset or tail-follow state is maintained while widths change. At
settlement all temporary widths are restored together before reading geometry;
the final full layout is real, and the reading anchor is corrected.

Uncoordinated scroll/input, selection, focus, native resize, changed article membership,
session replacement and disposal release the widths. Transition cancellation,
overlap and removed surfaces have bounded cleanup. Search, quote and directory
navigation wait for final width geometry; a newer navigation or user interaction
cancels an obsolete deferred request.

## Reproduction

`Desktop/tests/fixtures/long-session-interaction.html` mounts the actual app
entry with a deterministic typed-bridge fixture, not a parallel UI implementation.
It provides three or 180 user/assistant turns, 180 sidebar sessions, two projects,
paragraphs, a table and highlighted code in each answer. Query parameters are
`size=short|long`, `theme=dark` and optional `language=zh`.

From `Desktop/`, run:

```powershell
$env:DESKTOP_BROWSER_CHANNEL = 'msedge'
$env:DESKTOP_INTERACTION_LABEL = 'candidate'
node scripts/verify-long-session-interaction.mjs
```

Use installed project dependencies. Reports and screenshots are written under
`test-results/long-session-interaction/`. The script builds a production fixture,
starts an ephemeral preview, and closes its browser and server on success/failure.
On an untouched baseline, copy only this fixture and verifier into a separate
checkout and set `DESKTOP_INTERACTION_BASELINE=1`. This permits the old delayed
workspace feedback; it is not the candidate correctness gate.
For the first-pass-only snapshot, set `DESKTOP_INTERACTION_LAYOUT_BASELINE=1`.
It reports missing width locking and the old mid-animation navigation result;
it does not relax the candidate's gates.

Record script/style/layout durations, layout counts, long tasks, frame intervals
and historical-article geometry reads. Compare the same fixture, browser and
viewport serially. Shared-machine frame scheduling can vary substantially;
one trace is not a stable FPS claim or an operating-system diagnosis.

## Changes

- Reuse unchanged conversation entry objects and memoize completed responses and
  user messages. Keep action delegates current without changing every saved
  turn's callback identity. The file-opening context also carries stable actions.
- Locate the reading cursor using logarithmically bounded geometry reads rather
  than scanning every turn after each resize; coalesce resize/scroll work.
- Coalesce inspector pointer writes to animation frames and preserve release,
  cancellation, keyboard controls and the existing preset-width transition.
- Reuse the inspector time formatter and memoize historical context rows.
  Only the context inspector's closed, single-line preview rows use
  `content-visibility`; opening a row still renders its current JSON.
- Reflect workspace expansion immediately. Serialize absolute desired-state
  writes; an older save/failure cannot undo a newer click. Failed latest writes
  return to the last confirmed state through the existing error surface.

Transcript `content-visibility` with estimated heights was tested and rejected:
materializing history during smooth navigation could move the requested turn.
The final transcript keeps its complete DOM and real layout heights. The second
pass defers distant width reflow, not live text rendering; it is not transcript
virtualization.

## Correctness Gates

The browser verifier checks delayed-save ordering, rapid same/different-project
toggles and failed-save rollback; old-answer highlighting, copy and selection
quotes; reading away from the tail during inspector changes; real streaming
events while resizing; current expanded message JSON; drag cancellation and
cleanup; full-text preview/open/focus at a historical match; distant turn
navigation; light/dark layouts at 1440, 760 and 390 pixels; asset loading,
horizontal overflow, reduced motion and renderer errors.

Unit coverage checks entry identity reuse, authoritative updates, tool-result
append, session/branch replacement, hidden-message index shifts and bounded
navigation geometry reads. Twenty-one layout-controller tests cover measured widths,
visible/live/focused exclusions, previous inline-style restoration, anchored
reflow, tail following, selected text, short histories, overlapping/canceled
transitions, stale navigation, changed membership, native resize and disposal,
plus coordinated live scrolling, working-indicator removal, viewport/anchor
sampling order, native scrolling before resize observation, and final anchor
corrections with browser-like scroll clamping. Real input still cancels pending
width changes.
The production verifier also checks a different final reading width, original DOM
identity, rapid reversals, selection retention and distant navigation requested
during a real width animation. Existing Electron scroll and native resize
verifiers remain separate checks. Browser fixtures, local Electron and protocol
tests do not establish macOS, packaged, real-account or cloud acceptance.
