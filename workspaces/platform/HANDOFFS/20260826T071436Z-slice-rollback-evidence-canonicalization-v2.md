# Slice rollback evidence canonicalization v2

- Recorded at: `2026-08-26T07:14:36Z`
- Scope: `platform`
- Integration target: `integration/nexyfab`
- Status: `SOURCE_COMPLETE / INTEGRATION_SHARED_PATHS_PENDING /
  ROLLBACK_EXECUTION_NOT_RUN`

## Delivered scope-owned source

- `scripts/platform/verify-slice-rollback-evidence.mjs`
  - requires `nexyfab.slice-rollback-execution.v2`
  - exports the exact `utf8-crlf-to-lf` binding contract
  - hashes canonical UTF-8 text so LF and CRLF worktrees agree
  - rejects missing or broadened canonicalization declarations
- `scripts/platform/verify-slice-rollback-evidence.test.mjs`
  - proves LF/CRLF digest equivalence
  - proves absent and `raw` policies fail closed
  - retains digest-drift and complete rollback/restore checks

## Integration-owned companion changes

Apply these exact semantic updates on `integration/nexyfab` in the same intake:

- Upgrade `docs/evidence/platform-runtime/slice-rollback-execution.json` to
  `nexyfab.slice-rollback-execution.v2`.
- Add `stagingEvidenceCanonicalization: utf8-crlf-to-lf`.
- Document the v2 binding in
  `docs/evidence/platform-runtime/SLICE_ROLLBACK.md`.

The shared files were intentionally restored to their branch baseline before
the Platform commit because `workspace:check -- platform` correctly classifies
them as integration-owned.

## Verification

- `node --test scripts/platform/verify-slice-rollback-evidence.test.mjs`:
  `5/5 PASS`.
- `npm run platform:slices:rollback:check`:
  `READY_NOT_EXECUTED`, zero issues, seven targets.
- A full Platform workspace check must pass before integration handoff.

## Authority boundary

This change only makes the evidence binding portable across checkout line
endings. It does not execute a Railway rollback, restore a service, deploy a
build, or grant commercial release authority.
