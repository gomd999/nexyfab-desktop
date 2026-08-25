# Precision CAD handoff: staging HOLD exact core

- Created: 2026-08-25T02:45:06.838Z
- Branch: `scope/precision-cad`
- Head: `7c73263973836bd036f93ef51ae920257ad7c175`
- Integration target: `integration/nexyfab`

## Summary

The commercial Precision v3 core is running 2/2 instances in the isolated
Railway staging environment with commercial mode disabled. Exact build,
deployment, Git, PostgreSQL, Redis, migration `2026082502`, packaged runtime
HOLD, forged worker claim, forged artifact lease, and callback fail-closed
checks passed 11/11. Private Beta and GA remain false.

Evidence:
`docs/evidence/release/commercial-precision-staging-hold-20260825.json`.
Operations handoff:
`docs/operations/commercial-precision-staging-hold-handoff-20260825.md`.

## Changed paths

- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/INTEGRATION_ACTIONS.md`
- `workspaces/precision-cad/HANDOFFS/20260825T024506Z-staging-hold-exact-core.md`

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`

## Remaining work and risks

- No positive production-class native execution was observed.
- No worker registry, separately held signing key, recovery campaign,
  independent CAD review, expert signature, or manufacturing pilot exists.
- The next exact action is a reviewed checksum-pinned native adapter and
  separately managed worker identity/key, followed by the same-release positive
  canary, hostile substitution/replay campaign, and recovery campaign.
- Only the resulting runtime evidence v2 may be evaluated for limited
  mechanical Private Beta.
