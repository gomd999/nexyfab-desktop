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
Raw evidence is committed at `4731d3bc`; the canonicalized receipt binds source
commit `6430d6a8f8b409c2c7d94d38ad02e0e2b77ff10d`, local observation identity
`local-synthetic-campaign-20260825`, receipt SHA-256
`632fd435b31c8f65cd07a1080bf3b02e79588b65a0e3523209043f036648da26`,
and executor identity
`b31882c8619eb3908838bde4ed087582600f234ea5307d8c3437da838f18ecd0`.
Every bound JSON/MJS file declares `utf8-crlf-to-lf` canonicalization, so the
same receipt verifies in LF and CRLF worktrees while semantic changes still
fail closed.
The local verifier returns eligible only for that exact local identity. A
production release has a different deployment identity and must recollect the
receipt for its own exact release.
