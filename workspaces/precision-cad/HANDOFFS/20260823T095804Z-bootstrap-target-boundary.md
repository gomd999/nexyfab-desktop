# Precision CAD handoff: bootstrap-target-boundary

- Created: 2026-08-23T09:58:04.550Z
- Branch: `scope/precision-cad`
- Head: `c64cd6ea215187f3754b5ef5518f7119e8b14057`
- Integration target: `integration/nexyfab`

## Summary

Created the `capabilities/precision-cad` target boundary and documented the
legacy CAD roots and shared contract dependencies without moving runtime code.

## Changed paths

- `capabilities/precision-cad/README.md`
- `capabilities/precision-cad/capability.json`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/SCOPE.json`

## Verification

- [x] `npm run typecheck` (identical TypeScript source validated from the platform worktree)
- [ ] `npm run mechanical:contracts:check` (pre-existing external evidence is stale)
- [ ] `npm run mechanical:scope:check` (pre-existing private-beta evidence is pending)

## Remaining work and risks

- The two mechanical checks are release evidence gates, not regressions caused
  by this metadata-only change; keep them fail-closed for release decisions.
- No runtime files moved; migrate one compatibility-exported CAD slice at a time.
