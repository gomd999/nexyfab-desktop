# Backend + Frontend Platform handoff: bootstrap-target-boundary

- Created: 2026-08-23T09:58:04.574Z
- Branch: `scope/platform`
- Head: `c64cd6ea215187f3754b5ef5518f7119e8b14057`
- Integration target: `integration/nexyfab`

## Summary

Declared `apps/` as the compatibility-first target for the backend and
frontend platform, and recorded the legacy roots in the Scope descriptor.

## Changed paths

- `apps/README.md`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/SCOPE.json`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`

## Remaining work and risks

- No runtime files moved; the legacy Next.js route tree remains authoritative.
- Migrate only one reversible slice per follow-up handoff.
