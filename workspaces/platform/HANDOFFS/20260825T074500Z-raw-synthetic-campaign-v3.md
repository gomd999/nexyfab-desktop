# Raw synthetic campaign v3 handoff

Timestamp: `2026-08-25T07:45:00Z`

Status: `RAW_RUNS_BOUND / 1500_OF_1500_PASS /
SYNTHETIC_ONLY / COMMERCIAL_RELEASE_HOLD`

## Gap closed

The prior derived synthetic receipt could bind a file containing 1,500 bare
PASS booleans without proving that 1,500 validator observations occurred. The
v3 contract now rejects that shortcut and requires every run to carry an exact
ordered observation for:

- requirements;
- geometry identity;
- semantic object identity;
- relationship/alignment integrity.

Every axis must be PASS with a measured reason. Missing, extra, reordered,
failed, or `not_run` axes fail closed. Corpus template/parameter/artifact
transplants, incomplete or non-consecutive campaign slots, source changes,
executor changes, stale evidence, and release transplants also fail closed.

## Machine evidence

- code contract commit: `55b9f4df`;
- raw source/evidence commit:
  `4731d3bc669bed442132e56b3afd28496014c02b`;
- cases: 100, exactly 20 for each of mechanical, building, civil, landscape,
  and interior;
- campaign shape: 3 campaigns by 5 repeats;
- runs: 1,500/1,500 PASS;
- required-axis observations: 6,000/6,000 PASS;
- executor sources bound: 6;
- executor identity:
  `86510a680a4f337a018c0df7e16051f28df993c1a43d0a09cffd41437704df01`;
- receipt self-hash:
  `8b0b0f0f84332d752fe64329d562f2fa7d2769b9762b1a9e91504babd1feea4a`.

The checked receipt uses local observation identity
`local-synthetic-campaign-20260825`. Its independent verifier returns true for
that exact identity and returns false after source, corpus, raw run, executor,
freshness, or release mutation.

## Authority boundary

This is rights-safe deterministic synthetic regression. It does not include an
external AI-model call, independent holdout truth, a production-class native
CAD engine, native STEP/XCAF/GD&T review, expert approval, or manufacturing
pilots. It cannot certify commercial accuracy and cannot satisfy a production
release whose deployment identity differs.

The next exact production/staging release campaign must run the same v3 runner
and build a fresh receipt bound to its selected build, deployment, and Git
identity. Private Beta and GA remain HOLD until the independent and production
runtime gates also pass.
