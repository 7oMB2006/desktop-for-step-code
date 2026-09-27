# Issue #5: Windows Acceptance

Status: Closed after the credential fix. This is a summary of the disposable Windows 11 VM candidate-build pass, not complete public-release qualification.

## Candidate

- Version: `0.1.0`
- SHA-256: `B770881EB924ACA523F1F75E62CDE258F56DB7D90BABF9C7D907A25958BAD706`
- Historical local installer; this record is not a download location.
- Redacted evidence: `Desktop/test-results/issue-5-acceptance/`

## Results

- Clean install and relaunch: passed; the app started and Step Code showed connected.
- Credential protection: passed; `auth.dpapi` was present and plaintext credential files were absent. A nonempty legacy credential migrated between two builds both labeled `0.1.0`; this is build-to-build migration evidence, not a formal version upgrade.
- Normal uninstall: passed; all three desktop credential files were absent afterward, and the test session remained.
- Independent workspace retention: not verified; no independent workspace was created in the VM.
- Installation-directory residue: an empty `%LOCALAPPDATA%\Programs\Desktop for Step Code` directory remained. This is harmless and no additional cleanup is planned.
- Real model task in the VM: not run because the test account had no Step Plan quota. The account remained `step_plan · valid` after restart. A separate real-account coding task is recorded in `docs/VERIFICATION.md`.

Issue #5 is closed. Broader release qualification remains separate; see
`docs/VERIFICATION.md`.
