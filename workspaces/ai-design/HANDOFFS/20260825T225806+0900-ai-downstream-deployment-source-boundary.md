# AI downstream deployment-source boundary handoff

## Status

`AI_CANDIDATE_AUTHORITY_UNCHANGED / CLEAN_EXACT_HEAD_REQUIRED /
DOWNSTREAM_RELEASE_EVIDENCE_INCLUDED / DEPLOYMENT_NOT_RUN /
COMMERCIAL_ACCURACY_HOLD`

## Bound source

- Platform deployment-source implementation:
  `cd196e04c88922982f0c34318e6974533fbe4e2b`;
- Platform handoff commit: `5263a8f7`;
- Precision consumer handoff commit: `d2ff6e90`;
- Platform handoff:
  `workspaces/platform/HANDOFFS/20260825T224828+0900-railway-deployment-source-preflight-v1.md`;
- Precision handoff:
  `workspaces/precision-cad/HANDOFFS/20260825T225551+0900-deployment-source-consumer-boundary.md`.

## AI-to-Precision effect

The V9/V10 chat-first workspace still emits only revision-bound conceptual
candidates. When one becomes immutable input to the durable Precision path, a
future verified web/core deploy now fails before upload unless:

1. the complete source is a clean Git root at the exact target build ID;
2. the packaged Precision runtime HOLD receipt and any qualified operations
   bindings are tracked and included in Railway/Docker context;
3. all packaged bytes satisfy schema, byte-limit, and SHA-256 bindings;
4. the repository has no static JS/TS module edge to `.env*` outside the
   deployable source.

This prevents deployment tooling from separating the AI request surface from
the downstream release-health evidence that constrains its authority. Railway
deployment metadata will record both `build=<full HEAD>` and
`source=clean-git-v1`.

## Verification

- exact clean-source preflight: PASS;
- tracked files: 10,237;
- parsed JS/TS-family files: 8,034;
- forbidden `.env*` module edges: 0;
- three fixed packaged receipts: present, included, schema-valid, SHA-256 bound;
- focused deploy/source/package tests: 15/15 PASS;
- Platform quality: 65/65 Node and 75/75 Vitest PASS;
- architecture: PASS, 11 services / 5 stores / 69 API groups / 27 cron groups /
  6 domains / 4 packages.

## Honest authority and HOLD

This closure did not call a model, run the 150-intent campaign, collect an
independent holdout signature, deploy the new HEAD, execute a production native
CAD worker, or manufacture a pilot. AI remains `CONCEPT`/
`DESIGN_CANDIDATE` authority only. Exact CAD PASS belongs to separately signed
Precision evidence; manufacturing and commercial release remain disabled until
their external gates are genuinely satisfied.
