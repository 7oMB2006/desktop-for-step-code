# Issue #5: Windows acceptance

Status: partial candidate-install and migration acceptance complete; real-runtime gates remain open.

Use a disposable Windows VM with a fresh guest user. The host's existing
desktop app is running and has user data; do not install or uninstall against
the host profile. Do not create a separate host Windows test user for this
acceptance pass.

This is an on-demand test VM, not a permanent development environment. Start
with 2 virtual CPUs, 4 GiB RAM and a dynamically allocated 64 GiB guest disk;
64 GiB is the guest-visible limit, not immediate host usage. Keep at most one
clean-install snapshot, monitor the host drive's free space throughout, and
stop before the host runs low. On the 2026-09-26 preflight D: had 46.4 GiB
free, so do not start an unattended OS install. Copy out only redacted
evidence, then remove the disposable VM through its manager after checking
the saved results. Do not change or disable WSL to make the VM work.

This directory contains the durable checklist; put screenshots and redacted logs in
`Desktop/test-results/issue-5-acceptance/` (ignored by Git). Do not copy a personal
Step profile into the test environment or record credential values, cookies, raw environments,
or the contents of `auth.dpapi` / `auth.json`.

## Test inputs

- Candidate installer: `Desktop/release/issue-5-uninstall/Desktop for Step Code Setup 0.1.0.exe`
- Candidate SHA-256: `B770881EB924ACA523F1F75E62CDE258F56DB7D90BABF9C7D907A25958BAD706`
- Baseline installer for upgrade/migration: record its exact path, version and hash
  before running. Do not substitute an arbitrary earlier build or assume that a
  same-version reinstall exercises the upgrade path.
- Record Windows edition/build, user, install mode, chosen install directory and
  installer/uninstaller executable paths. Never record a real account identifier
  alongside credential-file contents.

## Installer and credentials

1. Snapshot the guest's install directory, uninstall registry entry, relevant
   process executable paths, and `%APPDATA%\Desktop for Step Code`. Confirm that
   the target is this app only; record the absence or presence of existing data.
2. Install the candidate. Sign in with a dedicated test Step account. Confirm
   `step-runtime/auth.dpapi` exists and that `auth.json` and `legacy-auth.json`
   do not persist. Inspect metadata only (presence, length, timestamp); do not
   print or archive credential bytes. Restart and confirm the account is usable.
3. After restoring the clean guest snapshot, install the recorded baseline,
   create a test session and an independent workspace, then upgrade to the candidate.
   Confirm the test account still works, `auth.dpapi` exists, and any legacy
   plaintext credential file is gone. Record whether the prior build actually
   had a nonempty legacy credential; an empty `auth.json` does not prove migration.
4. Sign out, then sign in again before the uninstall test. Record credential-file
   presence immediately before invoking the registered uninstaller. On normal
   uninstall, confirm all three desktop credential files are absent, while the
   test session and independent workspace remain intact.
5. Check the chosen install directory, not only the default path. If an empty
   `%LOCALAPPDATA%\Programs\Desktop for Step Code` remains, capture its directory
   entries, attributes, timestamps, process paths and the uninstaller exit state.
   Diagnose this separately from credential removal. Do not manually delete it
   before recording the evidence.

## Real runtime

With the candidate installed in the guest, verify browser authorization or Step
Platform login as applicable, one actual model response, and a real file-edit
permission/approval flow in a disposable workspace. Record model, result and
errors with secrets redacted. Fixture-based RPC checks do not satisfy this gate.

## Result record

| Gate | Result | Evidence (redacted path) | Notes |
| --- | --- | --- | --- |
| Clean install and relaunch | Pass | `Desktop/test-results/issue-5-acceptance/` | Candidate installed and relaunched in the disposable Windows 11 VM; app started and Step Code showed connected. |
| Encrypted credential, no plaintext residue | Pass | `Desktop/test-results/issue-5-acceptance/` | After login, `step-runtime/auth.dpapi` was present at about 1 KiB; `auth.json` and `legacy-auth.json` were absent. Credential contents were not read. |
| Baseline to candidate upgrade and migration | Pass | `Desktop/test-results/issue-5-acceptance/` | Old build produced a nonempty `auth.json` (about 1 KiB); candidate installation produced `auth.dpapi`, removed `auth.json`, and preserved login across restart. Both builds report 0.1.0, so this is build-to-build migration evidence, not a formal version upgrade. |
| Normal uninstall removes credentials | Pass | `Desktop/test-results/issue-5-acceptance/` | After normal uninstall, `auth.dpapi`, `auth.json`, and `legacy-auth.json` were absent from the retained user-data tree. |
| Sessions and workspace survive uninstall | Partial | `Desktop/test-results/issue-5-acceptance/` | `sessions` remained after uninstall. An independent workspace was not created, so workspace survival is not fully proven. |
| Empty installation directory residue | Observed; non-blocking | `Desktop/test-results/issue-5-acceptance/` | The user confirmed that normal uninstall left an empty `%LOCALAPPDATA%\Programs\Desktop for Step Code` directory. Its cause was not established with an uninstaller exit-state and complete directory-entry capture. No further cleanup change is planned: an empty directory is harmless residue, not a credential-removal failure. |
| Real account and model/tool acceptance | Partial | `Desktop/test-results/issue-5-acceptance/` | A real small Step account logged in and remained `step_plan · valid` after app restart. No model request or file-edit approval flow was run because the account had no Step Plan quota. |

Keep Issue #5 open until the relevant gates have evidence. This VM run is
separate from the wider release-qualification checklist in `docs/VERIFICATION.md`.
