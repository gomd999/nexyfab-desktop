# Current-source mechanical HOLD refresh handoff

## Status

`MECHANICAL_INTERNAL_REGRESSION_PASS /
ARTIFACT_REVISION_CONSISTENCY_PASS / EXTERNAL_7_GATES_PENDING /
PRIVATE_BETA_EVIDENCE_PENDING / COMMERCIAL_PRECISION_HOLD`

## Why the refresh was required

The deployment-source command added at
`cd196e04c88922982f0c34318e6974533fbe4e2b` changed `package.json`. The internal
mechanical receipt intentionally binds that file, so the previous receipt no
longer validated. The product-scope checker correctly added internal-regression
and revision-consistency blockers until the actual campaign was rerun.

No old PASS was transplanted and no timestamp-only receipt was created.

## Executed internal campaign

- direct CAD and closed-loop implementation suite: 17 files / 137 tests PASS;
- mechanical accuracy suite: 9 files / 49 tests PASS;
- intent intake qualification: 150 local cases validated; model call,
  geometry, verification, and commercial campaign remain NOT_RUN for all 150;
- representative exact runtime: 10 cases / 70 axes PASS; AI model and external
  commercial campaign remain NOT_RUN;
- assembly drawing handoff: 3 files / 11 tests PASS with local status PASS and
  release status HOLD;
- TypeScript: PASS.

The refreshed receipt records all eight internal checks true:
lossless design graph, 30-feature implementation coverage, three-cycle NFAB,
three-cycle STEP, mechanical accuracy, intent intake qualification,
representative intent runtime, assembly handoff readiness, and TypeScript.

## Evidence identity

- evidence commit:
  `2da7ba5940ef621058a76854c1602c6036305382`;
- internal verification:
  `docs/evidence/cad-independent/mechanical-core-internal-verification.json`;
- internal receipt SHA-256:
  `e4536c9671dfcbd046668b53052508953f3311496690ac580f4fd72e69bb92dd`;
- product scope:
  `docs/evidence/cad-independent/mechanical-product-scope-assessment.json`;
- assessment SHA-256:
  `5831bf3e2b3dc3989537692332c236bddca930addae71da54479b948b210965e`;
- `mechanical:scope:check`: current/PASS as a derivation check, decision
  `private_beta_evidence_pending`.

## Exact remaining blockers

1. `mechanical_core_30_feature_closed_loop_required`;
2. `ten_direct_design_packages_required_for_private_beta`;
3. `thirty_direct_design_packages_required`;
4. `mechanical_intent_campaign_150_required`;
5. `standard_step_conformance_required`;
6. `twenty_blind_product_challenges_required`;
7. `three_manufactured_pilot_receipts_required`.

The external commercial contract check remains fail-closed at 0/30 and C4
missing because the external feature and STEP receipt bundles are not present.
That is expected and must not be replaced by the local internal campaign.

## Non-promotion boundary

Internal deterministic regression proves implementation continuity only. It is
not an independent expert review, vendor/native CAD interoperability result,
actual model accuracy campaign, blind product challenge, or manufacturing
acceptance. Private Beta, self-service, manufacturing release, and GA remain
false. Staging and production were not changed.
