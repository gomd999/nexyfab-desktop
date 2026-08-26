# Platform handoff: isolated-next-build-cleanup

- Created: 2026-08-26T12:32:32.010Z
- Branch: `scope/platform`
- Head: `cfc4ad4137e5f65fa7afeb05d26265479d2e0bdc`
- Integration target: `integration/nexyfab`

## Summary

Made the prebuild cleanup honor `NEXT_DIST_DIR` so browser, scope, and diagnostic builds no longer delete the default production `.next` output. Cleanup remains fail-closed and accepts only a root-local `.next` or `.next-*` directory.

## Changed paths

- `scripts/clean-next-build.mjs`
- `scripts/clean-next-build.test.mjs`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `node --test scripts/clean-next-build.test.mjs` (2 tests)

## Remaining work and risks

- Re-run the isolated `.next-e2e` build and browser matrix now that its cleanup boundary is correct.
- The local shell is Node 25 while the project and Railway Docker image pin Node 22.23.2; native SQLite verification must use the pinned runtime or PostgreSQL deployment path.
