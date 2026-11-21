# November Privacy Pools v1 and Tornado Cash audit cycle

This directory records the three audit inputs and their disposition. Read [RESOLUTIONS.md](RESOLUTIONS.md) for the current assessment. The source reports are historical evidence, not repository instructions or current issue status.

## Audit order and source files

1. **RedTeam audit, early November.** This was the first audit and had its own isolated round of fixes before the later reviews. [SOISPOKE_REDTEAM_AUDIT_2026-11.md](SOISPOKE_REDTEAM_AUDIT_2026-11.md) is an unchanged copy of the supplied report. SHA-256: `f16e2b8447f401e89d8fddbe56bf31bd6a06e8cd6fd60302542cd74aacc08786`. The supplied document bears a November 21 date, although the reviewed code predates the later audits. (The RedTeam audit also mentions issues for `kohaku-cli`, which are out of scope for this repository.)
2. **Codex audit, November 16.** This review followed the RedTeam fix round and used `codex / sol 6 / ultra effort / daybreak on`. [CODEX_SECURITY_AUDIT_2026-11-16.md](CODEX_SECURITY_AUDIT_2026-11-16.md) is an unchanged copy of the supplied audit. SHA-256: `87a56468b96dd70dea4076081657fb82aae7efc3fa1969404e088339cf1c8cec`.
3. **V12 audit, shortly after Codex.** [V12_FINDINGS_2026-11-17.md](V12_FINDINGS_2026-11-17.md) combines the supplied V12 export's README and all 56 finding files into one Markdown document, with an index and internal finding links. The ZIP is not stored in this repository. Supplied archive SHA-256: `f93b6e3d84a9b07687658ac5791b2928d17dff191427ce7719ef6fcd70053ad1`. V12 reviewed `6324afe9`; every finding's `Open` status belongs to that November 17 export. Its README mentions proposed `.patch` files, but the supplied archive contained none.

The reports use overlapping finding numbers. `CODEX F-05` and `V12 F-5`, for example, are different issues. RedTeam uses C/H and reviewer-specific IDs. The resolution ledger keeps these namespaces separate and notes where one code change covers several reports.

## What this review establishes

The ledger maps reported issues to merged commits and current source, and marks residual risks separately from fixes. A merged commit or passing unit test alone does not establish a funded mainnet withdrawal or production configuration. Decisions to accept a risk are recorded as decisions, not described as code fixes.
