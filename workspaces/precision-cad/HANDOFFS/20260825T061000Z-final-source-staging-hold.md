# Precision CAD handoff: exact final-source staging HOLD

- Created: `2026-08-25T06:10:00Z`
- Branch: `scope/precision-cad`
- Head before this documentation unit: `d4a6d4f0`
- Deployed application source: `32ff05ba3f1e7addc5cf6da95d6e94ff9b437fe7`
- Integration target: `integration/nexyfab`
- Commercial release state: `HOLD`

## Summary

The final application source was deployed to isolated Railway staging without
changing Production. Deployment `c1e03352-5f95-47eb-a031-80847b22391c` is
`SUCCESS`, both replicas are `RUNNING`, `/api/health/ready` passes, and the live
build identity exactly matches the deployed source.

The redacted exact-release collector passed all 11 core, persistence,
migration, packaged-evidence, and hostile-path checks. This proves the current
Precision boundary is integrated and fails closed in staging; it does not claim
that a production-class native CAD worker completed a positive closed loop.

## Changed paths

- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260825T061000Z-final-source-staging-hold.md`

## Verification

- [x] Railway staging deployment `SUCCESS`, 2/2 replicas `RUNNING`.
- [x] Exact live build ID equals `32ff05ba3f1e7addc5cf6da95d6e94ff9b437fe7`.
- [x] Final staging collector: 11/11 PASS.
- [x] Packaged Precision runtime evidence remains an explicit `HOLD`.
- [x] Forged worker claim, forged lease, and callback paths fail closed.
- [x] `npm run typecheck`.
- [x] `npm run platform:architecture:check`.
- [x] `npm run workspace:check -- precision-cad` after this documentation unit.

## Remaining work and risks

- register and deploy the checksum-pinned production-class native adapter;
- provision separately held Ed25519 and evidence-HMAC authorities;
- run the same-release positive closed loop and multi-instance recovery campaign;
- obtain independent STEP/XCAF/GD&T and expert review;
- complete manufacturing pilots and attach their immutable evidence.

Private Beta and GA remain false. This handoff authorizes neither manufacturing
nor Production deployment.
