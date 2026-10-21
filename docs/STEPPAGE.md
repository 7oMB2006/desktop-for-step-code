# StepPage And MCP Compatibility

## Scope

Desktop uses its own Step Code configuration and credentials under Electron
`userData`. It can launch an existing StepPage JavaScript bundle using its
packaged Node executable, without a shell wrapper or a system Node installation.
Windows preparation is an explicit action under Settings > Resources > Built-in
plugins > StepPage. MCP settings link to this entry; installation is not part of
the raw transport editor and never runs silently at startup. The pinned upstream
Shell installer still does not support Windows; Desktop downloads its single-file
artifact directly and launches it with packaged Node.

New installations use `userData/step-runtime/steppage/bin/steppage-mcp.mjs`.
The managed server receives a dedicated HOME/USERPROFILE at
`userData/step-runtime/steppage/home`, keeping its `.steppage` login/config
separate from the personal CLI profile. Existing custom transport/environment
declarations are not adopted or overwritten. Installation does not copy an
existing personal StepPage login.

The download uses the official installer artifact URL, HTTPS without redirects
or cookies, a 35-second deadline, a 4 MiB cap and a pinned SHA-256. The currently
qualified artifact is version 1.0.0 with the fingerprint recorded below. If the
mutable official `latest` URL changes, Desktop fails closed until its fingerprint
is reviewed and updated; it never trusts a hash obtained from that same download.
This is a Desktop pin, not an upstream publisher signature.

Only matching bytes receive syntax and version checks, with isolated environment
and bounded child-process time/output. A temporary sibling file is atomically
renamed after validation, then configuration is updated inside the upstream
settings lock. Failures expose fixed categories rather than raw subprocess output.
Retry reuses a verified installed file; preparation is single-flight and requires
all tasks idle. Directory junctions/symlinks inside the managed installation path
are rejected. No system PATH, shell wrapper or global Node is installed.

Preparation preserves explicit disable, custom fields and unrelated MCP servers.
A custom StepPage transport is left unchanged and reported as a configuration
conflict. Disabled-only built-in overrides can receive the managed transport
without being enabled. The action does not restart running sessions. Users
restart each affected session explicitly; new workers read the applied settings.

Presence in plugin metadata is not installation, configuration is not a live
connection, and a successful tool catalog is not authentication or publishing
acceptance. The runtime reports connecting, connected, failed and disabled
separately. A missing bundle leaves StepPage failed but keeps Step usable.

## Configuration Compatibility

- The effective built-in server identity is `steppage__steppage`. A lone legacy
  `steppage` configuration moves to that identity, suppressing duplicate plugin
  discovery while preserving its complete declaration.
- Migration runs in the upstream locked read-modify-write operation. It uses
  parsed TOML, including quoted keys and inline tables, rather than text matching
  or the renderer's secret-free settings projection.
- Custom commands, arguments, working directories, environment/header secrets,
  tool filters, timeout settings and explicit disable survive migration.
- A managed launch must have an absolute Desktop `runtime/node/node[.exe]`
  command and exactly one argument naming the known bundle. A matching Node
  path alone does not establish ownership. The exact Desktop-owned
  `step-runtime/steppage/bin/steppage-mcp.mjs` shape also permits relocation,
  including its generated home paths. Customized bundle arguments and
  other user executables are not repaired.
- Existing managed launches can update their Node and bundle paths when the
  bundle is available, without writing `enabled: true`.
- An existing qualified declaration takes precedence over an obsolete managed
  alias. An explicit disable on that managed alias is retained conservatively
  when the alias is removed. Secrets from the removed alias are not merged into
  a different qualified configuration.
- Two distinct user-owned aliases are preserved, not silently deleted, merged
  or disabled. They remain separate explicit configurations requiring user
  reconciliation, not automatic duplicate cleanup.
- Without a bundle, Desktop does not create a new enabled override or repair an
  existing transport to a nonexistent file. Legacy disable migration still
  takes effect. A later valid bundle can be picked up on restart.

Settings expose secret field names only. Raw secrets remain in the isolated
runtime configuration and are never included in the acceptance report.

## Verification (2026-10-20)

The Windows runtime matches the current v0.1.5 pin and latest-main patch hashes.
No upstream source changes are needed for this compatibility layer.

Local typecheck and production build passed. The serialized unit/protocol suite
passed 570 tests with thirteen existing platform skips. The two new real-runtime
tests cover:

- Legacy disable migration, built-in discovery and restart.
- A disabled third-party plugin declaration suppressing its server spawn.
- Enabling one qualified StepPage server with no legacy duplicate.
- Disabled-state preservation after installation-path relocation.
- An invalid bundle reporting failed, then recovering after the file is repaired.
- An empty Windows profile remaining usable without StepPage, then discovering
  a manually supplied valid bundle after restart.

The Electron registration suite passed eight groups across eleven launches:
fresh registration, restart idempotency, custom transport preservation, missing
bundle, quoted-key disable, stale managed-path disable, inline TOML/secrets and
qualified-config precedence. CI inventory/runner checks passed fifteen cases.

The optional local real-bundle check was also run:

```powershell
cd 'D:\Desktop Runtime Builds\desktop-upstream-v015\Desktop'
node scripts/verify-steppage-bundle.mjs '<downloaded-official-bundle.mjs>'
```

The artifact was obtained from the bundle URL used by the official installer:
`https://dl.stepfun.com/steppage-mcp/p/latest/steppage-mcp.mjs`.
It reported version `1.0.0`, size 1,015,426 bytes and SHA-256
`353070e06e144ce700159b1835f36cea2674911c85334ddbb8503c69d9f87e7e`.
This fingerprint records the tested download; it is not an upstream signature.
The check verified JavaScript syntax, version, one connected service with
thirteen tools, disabled after relocation/restart with zero tools, and re-enabled
after restart with thirteen tools. Its report is
`Desktop/test-results/steppage-bundle-check.json` (ignored local evidence).

The check does not download anything itself. It uses isolated home/config paths,
does not submit model prompts or MCP tool calls, and removes its temporary
profile afterward. The official bundle is not vendored or shipped by this change.
No installer, shortcut update, cloud CI, real login or online publishing was
performed in this phase.

## Windows Preparation Verification (2026-10-21)

`node scripts/verify-steppage-prepare.mjs` explicitly downloads the pinned
official artifact into a fresh disposable Desktop profile through the real
Settings button. It verified file readiness, a single connected server with
thirteen tools, disabled preparation/restart with zero tools, and disable
preservation after application relaunch. HOME and USERPROFILE point to the
Desktop-only directory. The test sends no model prompt or MCP tool call.
The report and screenshots are under `Desktop/test-results/steppage-preparation-*`.
Network acceptance is local-only, not an automatic CI download.

Typecheck/build and the full serialized suite passed (577 passed, thirteen
platform skips). Additional unit coverage
checks rejection without execution, retry, single-flight, custom configurations,
disabled-only overrides, isolated probe environments and linked storage.

Real credential authentication and publishing require separate authorized
acceptance. No part of the compatibility tests proves that a webpage can be
published, nor should a test silently create an online resource. Issue #112 is
not fully closed by installation/handshake acceptance alone. No cloud CI,
installer execution or upgrade lifecycle acceptance has been performed for this
preparation follow-up.

The unsigned local Windows x64 preview is
`D:\Desktop For Step Code\Desktop\release\steppage-prepare-20261021-preview`
(version 0.5.1, main `61908a9` plus the uncommitted StepPage snapshot).
The installer SHA-256 is
`b16a3a5c0bf9c8204e248c4d1d2626a321548fa1ba49e3a1af20daa6782bc95b`.
The packaged executable passed the same explicit-download/13-tool/disable/
relaunch acceptance, all eight registration groups across eleven launches, and
general Electron acceptance. Light/English and narrow-window screenshots were
also inspected. The resource audit matched 105 built files and 1,242 runtime
files; installer size and SHA-512 matched `latest.yml`. Evidence is under the
package's `acceptance` directory. The primary shortcut now targets this package;
the prior shortcut is backed up there. The real user app was not stopped and its
configuration/credentials were not modified by acceptance.

## Scheduled Cron Coexistence (2026-10-21)

Preparation checks for active tasks, queued messages, active Goals and session
mutations, but does not require terminating a host with scheduled Cron jobs.
Only preparation uses this non-stopping idle check. Account changes and actual
runtime replacement retain the existing Cron protection.

The StepPage restart button now propagates lifecycle rejection to its own safe
localized feedback instead of swallowing it in the shared snapshot helper.
Readiness polling no longer clears operation feedback. A protected Cron host can
remain alive while a new independent session loads the prepared plugin.

The new unsigned preview is
`D:\Desktop For Step Code\Desktop\release\steppage-cron-20261021-preview`
(version 0.5.1, the same main base plus the local StepPage changes).
Installer SHA-256:
`1f5b5a24b71d94dffd0a94f528583b80bcb4a2ef7e21a07865aea14a78f67a3a`.
Typecheck/build and 580 serialized tests passed (thirteen platform skips);
fifteen CI policy/runner checks also passed locally.

Both source and packaged Electron acceptance created a scheduled job in a
disposable profile before using the real preparation button. Preparation kept
the host/session and job unchanged, protected restart feedback survived polling,
and a new independent session connected with thirteen tools. Disable/relaunch
and general packaged Electron acceptance passed. The resource audit matched
105 built files and 1,242 runtime files; installer size and SHA-512 match
`latest.yml`. The primary desktop shortcut targets this preview with a backup
of its previous value. No real user instance was stopped. Real login,
publishing, installer execution and cloud CI remain outside this acceptance.

The same packaged executable also passed all eight registration groups across
eleven launches and eight Cron management acceptance cases.
