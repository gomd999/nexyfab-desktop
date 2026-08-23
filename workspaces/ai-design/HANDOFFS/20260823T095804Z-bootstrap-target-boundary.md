# AI Design handoff: bootstrap-target-boundary

- Created: 2026-08-23T09:58:04.552Z
- Branch: `scope/ai-design`
- Head: `c64cd6ea215187f3754b5ef5518f7119e8b14057`
- Integration target: `integration/nexyfab`

## Summary

Created the `capabilities/ai-design` target boundary and documented the legacy
AI roots and shared contract dependencies without moving runtime code.

## Changed paths

- `capabilities/ai-design/README.md`
- `capabilities/ai-design/capability.json`
- `workspaces/ai-design/CURRENT.md`
- `workspaces/ai-design/SCOPE.json`

## Verification

- [x] `npm run typecheck` (identical TypeScript source validated from the platform worktree)
- [x] `npm run test:accuracy:common` (11 Vitest files / 60 tests, 7 Node tests)

## Remaining work and risks

- No runtime files moved; the legacy AI implementation remains authoritative.
- Migrate one compatibility-exported AI Design slice at a time.
