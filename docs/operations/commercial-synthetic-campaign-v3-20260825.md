# Commercial synthetic campaign v3

Status: `RAW_SYNTHETIC_EXECUTION_VERIFIED / COMMERCIAL_CERTIFICATION_FALSE`

## Closed evidence gap

The historical synthetic campaign receipt stored only per-domain totals. The
first derived receipt contract improved file binding, but still accepted a raw
results file whose records contained little more than
`requiredGatesPassed: true`. That allowed 1,500 repeated booleans to look like
1,500 measured executions.

Schema `nexyfab.commercial-synthetic-campaign-receipt.v3` now requires:

- source cases whose template, parameters, artifact identity, and artifact
  summary exactly match the bound commercial-validation corpus;
- exactly ordered `requirements`, `geometry`, `semantic_objects`, and
  `relationships` observations for every run;
- an explicit PASS and non-empty measured reason for every required axis;
- the exact 3-campaign by 5-repeat matrix for every selected case, with no
  gaps, duplicate slots, or non-consecutive indices;
- false-verification, false-clear, and destructive-merge flags to remain false;
- source bindings for the runner, validator, receipt builder, candidate
  builder, domain template registry, and assembly evaluator;
- canonical receipt hashing and release identity/freshness binding;
- an explicit boundary that synthetic regression cannot certify commercial
  accuracy, replace independent holdout review, or replace native-CAD review.

Boolean-only results, corpus transplants, missing axes, failed/not-run axes,
source changes, executor changes, stale evidence, and release transplants fail
closed.

## Current local campaign

`scripts/run-commercial-synthetic-campaign.mjs` executed the checked commercial
synthetic corpus through the real deterministic template rebuild evaluator:

- 5 domains;
- 20 cases per domain, 100 total;
- 3 campaigns and 5 repeats per case;
- 1,500 raw runs;
- 6,000 raw required-axis observations;
- 6,000 PASS and 0 non-PASS observations.

The immutable raw bundles are:

- `docs/evidence/cad-independent/local/commercial-synthetic-campaign-20260825/source-cases.json`;
- `docs/evidence/cad-independent/local/commercial-synthetic-campaign-20260825/campaign-runs.json`.

The results bundle also records the local Node/platform/architecture execution
identity. The release receipt binds the evaluator sources by byte count and
SHA-256, so editing any bound implementation invalidates the receipt.

## Honest claim boundary

This campaign verifies deterministic rebuilding and four internal regression
axes over rights-safe synthetic templates. It does not call an external AI
model, inspect independent holdout ground truth, execute a production-class
native CAD adapter, establish STEP/XCAF/GD&T interoperability, or produce
expert/manufacturing evidence.

The checked receipt is therefore useful for closing the raw synthetic
regression evidence gap only. It cannot by itself authorize Private Beta or
GA, and the production release gate must still require an exact same-release
receipt plus every independent/external qualification receipt.

The checked local receipt is
`docs/evidence/release/commercial-synthetic-campaign-receipt-260810.json`.
It binds source/raw-evidence commit
`4731d3bc669bed442132e56b3afd28496014c02b`, local observation identity
`local-synthetic-campaign-20260825`, receipt SHA-256
`8b0b0f0f84332d752fe64329d562f2fa7d2769b9762b1a9e91504babd1feea4a`,
and executor identity
`86510a680a4f337a018c0df7e16051f28df993c1a43d0a09cffd41437704df01`.
The local verifier returns eligible only for that exact local identity. A
production release has a different deployment identity and must recollect the
receipt for its own exact release.
