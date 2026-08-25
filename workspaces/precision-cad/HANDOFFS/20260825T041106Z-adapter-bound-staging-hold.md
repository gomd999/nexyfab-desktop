# Precision CAD handoff: adapter-bound staging HOLD

- Created: 2026-08-25T04:11:06.808Z
- Branch: `scope/precision-cad`
- Head: `d0ae60b6102e90bc0fcef1fa50c425d4d768a989`
- Integration target: `integration/nexyfab`

## Summary

The exact source that requires native executable and canonical invocation
SHA-256 trust fields is now running in isolated staging. The packaged runtime
receipt is schema v3 and explicitly HOLD; 11/11 core boundary probes passed.
This is deployment proof of the fail-closed core, not a positive native CAD run.

## Changed paths

- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260825T041106Z-adapter-bound-staging-hold.md`

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] exact deployment `1839657a-a2ac-4671-aea9-cea408a3811a` is `SUCCESS`
- [x] live build identity matches `d0ae60b6102e90bc0fcef1fa50c425d4d768a989`
- [x] PostgreSQL and required Redis readiness pass
- [x] packaged runtime evidence v3 is `HOLD`
- [x] forged worker claim and artifact lease are rejected
- [x] unconfigured callback fails closed

## Remaining work and risks

- A reviewed digest-pinned adapter image and separately controlled worker key
  must be supplied before a positive staging canary can be run.
- Real-worker recovery observations, independent STEP/native-CAD/XCAF/GD&T
  review, expert signatures, and manufacturing pilots are still absent.
