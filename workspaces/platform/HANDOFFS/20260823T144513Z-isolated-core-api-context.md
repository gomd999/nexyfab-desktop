# Backend + Frontend Platform handoff: isolated-core-api-context

- Created: 2026-08-23T14:45:13.607Z
- Branch: `scope/platform`
- Head: `851a7ac8ab7769f043f23a9b420e3cd0f1381d00`
- Integration target: `integration/nexyfab`

## Summary

Added a folder-local Docker build context for the `core-api` compatibility
boundary. The small runtime exposes build-bound live, ready, and release health
contracts without packaging the full Next.js repository.

## Changed paths

- `apps/core-api/.dockerignore`
- `apps/core-api/Dockerfile`
- `apps/core-api/package.json`
- `apps/core-api/service.json`
- `apps/core-api/src/health/runtime.mjs`
- `apps/core-api/src/server.mjs`
- `apps/core-api/test/server.test.mjs`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260823T144513Z-isolated-core-api-context.md`

## Verification

- [x] `node --test --test-isolation=none apps/core-api/test/*.test.mjs` (3 passed)
- [x] `npm run workspace:check -- platform`
- [x] `npm run lint:ci`
- [x] `npm run typecheck`

## Remaining work and risks

- `LEGACY_NEXT_ORIGIN` must be bound before readiness can pass.
- Release health remains HOLD and `deployEnabled` remains false.
- This slice owns the health boundary only; the legacy API routes remain authoritative.
