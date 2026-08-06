# Phase B human ground-truth review runbook

## Scope

The first batch contains 30 cases: five priority cases from each of the six product families. Blank forms are evidence-bound templates only and grant no approval.

## Review sequence

1. Copy one file from `phase-b-review-forms` into a separate `phase-b-review-submissions` directory without changing `immutableTarget`.
2. A provenance reviewer records the commercial-license decision with a real reviewer ID, note and ISO-8601 timestamp.
3. A holdout reviewer confirms the source was not used in prompts, tuning, repair fixtures or demonstrations.
4. A domain reviewer evaluates every required assertion and records evidence-based notes.
5. The domain reviewer signs the exact artifact-set hash and required assertion set.
6. A different independent reviewer checks the same target without authoring assertion reviews and signs it.
7. Run `npm run evidence:phase-b-submissions-validate`.
8. Import only `ready_for_import` submissions through the existing ground-truth approval validator.

## Prohibited shortcuts

- Do not use generated geometry as the sole ground truth for its own evaluation.
- Do not infer license approval from a downloaded filename or website name.
- Do not let one person occupy both signoff roles.
- Do not edit source hash, artifact-set hash, required assertions or evidence blocks.
- Do not treat `changes_requested`, `rejected`, blank or incomplete forms as approved.
- Do not convert automatic extraction passes into reviewer decisions.

## Current state

- Forms: 30
- Submitted: 0
- Pending: 30
- Ready for import: 0
- Approved ground truth: 0/88
- Additional independent corpus required: 32 cases
