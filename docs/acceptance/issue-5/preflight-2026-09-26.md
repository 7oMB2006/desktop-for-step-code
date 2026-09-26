# Issue #5 acceptance preflight: 2026-09-26

Result: real install/upgrade/uninstall acceptance not started. This host is not
a disposable, clean Windows environment.

| Check | Observation |
| --- | --- |
| Candidate installer | `Desktop/release/issue-5-uninstall/Desktop for Step Code Setup 0.1.0.exe` |
| Candidate SHA-256 | `B770881EB924ACA523F1F75E62CDE258F56DB7D90BABF9C7D907A25958BAD706` |
| Default installation directory | Absent at preflight |
| Matching uninstall registry entry | None found in the inspected HKCU/HKLM uninstall keys |
| Existing desktop user data | Present under `%APPDATA%\Desktop for Step Code`, including `step-runtime` and `workspaces` |
| Existing credential-file metadata | `step-runtime/auth.json` present, length 2 bytes; contents not read |
| Windows Sandbox | `WindowsSandbox.exe` absent; optional-feature query requires elevation |
| Local VM tools | No `Get-VM`, VirtualBox, VMware, Docker or QEMU command found |
| Application process | No matching process found by the preflight process query |

Do not infer that the empty installation-directory issue is fixed from its
absence before an uninstall. Do not infer real account migration from a
2-byte `auth.json`.

Next: for an initial per-user acceptance pass, create a dedicated local
standard Windows test user through Windows Settings and sign in once. The
current Codex process is not elevated; existing Codex-managed sandbox users
are not test accounts. Use the candidate and an identified baseline installer
there. A second fresh test user or a VM snapshot is needed to independently
test a clean candidate install and a baseline-to-candidate upgrade. The clean
Windows machine release gate remains open. The development account's user
data and installation state were not changed during this preflight.

## Decision update

The dedicated host-user route was declined after this preflight. The accepted
direction is an on-demand disposable Windows VM; the user does not want to
maintain a permanent second Windows environment. D: had 46.4 GiB free at the
latest check. The VM has not been installed or created. The main acceptance
checklist now reflects the VM-only route.
