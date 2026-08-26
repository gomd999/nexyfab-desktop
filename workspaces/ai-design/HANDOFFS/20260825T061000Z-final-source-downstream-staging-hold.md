# AI Design handoff: exact downstream final-source staging HOLD

- Created: `2026-08-25T06:10:00Z`
- Branch: `scope/ai-design`
- Head before this documentation unit: `d4a6d4f0`
- Deployed application source: `32ff05ba3f1e7addc5cf6da95d6e94ff9b437fe7`
- Integration target: `integration/nexyfab`
- Commercial release state: `HOLD`

## Summary

The final application source was deployed to isolated Railway staging without
changing Production. Deployment `c1e03352-5f95-47eb-a031-80847b22391c` is
`SUCCESS`, both replicas are `RUNNING`, and its live build identity exactly
matches the deployed source. The exact-release collector passed all 11 core,
persistence, migration, packaged-evidence, and hostile-path checks.

This closes downstream connectivity evidence for AI Design, not AI authority.
AI output remains revision-bound `CONCEPT` or `DESIGN_CANDIDATE` input to the
Precision boundary and cannot author exact CAD PASS, workspace persistence,
manufacturing approval, or commercial release.

## Changed paths

- `workspaces/ai-design/CURRENT.md`
- `workspaces/ai-design/HANDOFFS/20260825T061000Z-final-source-downstream-staging-hold.md`

## Verification

- [x] Railway staging deployment `SUCCESS`, 2/2 replicas `RUNNING`.
- [x] Exact live build ID equals `32ff05ba3f1e7addc5cf6da95d6e94ff9b437fe7`.
- [x] Final staging collector: 11/11 PASS.
- [x] Forged worker claim, forged lease, and callback paths fail closed.
- [x] `npm run typecheck`.
- [x] `npm run test:accuracy:common`.
- [x] `npm run workspace:check -- ai-design` after this documentation unit.

## Remaining work and risks

- deploy the registered production-class native worker and separately held keys;
- run a same-release positive exact closed loop and recovery campaign;
- obtain independent CAD and expert review;
- complete manufacturing pilots and attach immutable evidence.

Private Beta and GA remain false. This handoff authorizes neither manufacturing
nor Production deployment.
