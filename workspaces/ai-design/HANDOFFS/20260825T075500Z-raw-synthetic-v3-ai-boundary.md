# Raw synthetic v3 AI boundary handoff

Timestamp: `2026-08-25T07:55:00Z`

Status: `RAW_SYNTHETIC_EXECUTION_BOUND / AI_MODEL_NOT_CALLED /
INDEPENDENT_ACCURACY_HOLD`

The commercial synthetic campaign contract is now v3. It requires 20 cases in
each of mechanical, building, civil, landscape, and interior; three campaigns;
five repeats; and four ordered raw observations for every run. The current
rights-safe campaign records 1,500/1,500 passing runs and 6,000/6,000 passing
observations.

Bound identities:

- source/raw-evidence commit: `4731d3bc669bed442132e56b3afd28496014c02b`;
- receipt self-hash:
  `8b0b0f0f84332d752fe64329d562f2fa7d2769b9762b1a9e91504babd1feea4a`;
- executor identity:
  `86510a680a4f337a018c0df7e16051f28df993c1a43d0a09cffd41437704df01`;
- observation identity: `local-synthetic-campaign-20260825`.

This campaign runs the deterministic template-rebuild evaluator. It does not
invoke the AI generation subject, and the commercial corpus synthetic lane is
not independent holdout ground truth. The receipt therefore sets
`certifiesCommercialAccuracy=false` and cannot replace external model
evaluation, independent reviewers, native-CAD validation, or pilots.

AI Design remains `CONCEPT`/`DESIGN_CANDIDATE` authority. The evidence proves
that the campaign machinery now records real downstream observations and
fails closed against count-only fabrication; it does not promote any AI output
to exact CAD or manufacturing authority.
