# Desktop for Step Code

## Register
Product: a community desktop client for Step Code on Windows x64 and macOS Apple Silicon.

## Audience and Outcome
Developers should install the application, sign in with their own account, open a local project, and complete and resume coding tasks without installing the desktop development toolchain.

## Boundaries
The pinned Step Code runtime owns agent execution, execution permissions and Cron scheduling. Desktop provides the workspace, authorized session wake-up and opt-in remote access while the app is online; it does not replace the runtime with an independent agent harness, scheduler or memory engine. Personal CLI profiles remain isolated.

## Design
OpenChamber is the primary interaction reference: compact workspace navigation, readable conversation, progressive tool details. Quiet, precise, approachable. No marketing screen, decorative dashboard, or invented agent capabilities. Keyboard accessibility, system light/dark themes, Chinese and English are required.

## Delivery
Local installer and reproducible source. Public release requires a separate publishing instruction. Report unverified authentication, model execution, and clean-machine acceptance honestly.
