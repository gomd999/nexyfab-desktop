# Precision CAD deployment-source consumer boundary

## Status

`PRECISION_RUNTIME_EVIDENCE_INCLUDED / CLEAN_GIT_SOURCE_REQUIRED /
REPOSITORY_EXTERNAL_ENV_IMPORTS_REJECTED / DEPLOYMENT_NOT_RUN /
COMMERCIAL_PRECISION_HOLD`

## Bound platform source

- deployment-source implementation:
  `cd196e04c88922982f0c34318e6974533fbe4e2b`;
- Platform documentation handoff: `5263a8f7`;
- producer handoff:
  `workspaces/platform/HANDOFFS/20260825T224828+0900-railway-deployment-source-preflight-v1.md`;
- deployment/promotion performed in this closure: no.

## Precision consumer effect

The commercial Precision runtime receipt is a fixed packaged input to
`/api/health/release`. Before a new Railway upload, the verified deploy now
requires:

1. the upload directory is the clean Git root;
2. its full HEAD equals the target `NEXYFAB_BUILD_ID`;
3. `commercial-precision-runtime-evidence.json` is a tracked regular file,
   included by both Railway and Docker contexts, and schema v3;
4. every qualified seven-day operations binding is present, tracked, included,
   byte-bounded, and equal to its declared SHA-256;
5. no tracked JS/TS-family source has a static import/export/dynamic import,
   `require`, or `require.resolve` module edge to `.env*`.

This closes the observed staging failure where the Precision runtime evidence
was missing from the CLI source snapshot and the production Webpack failure
where drawing-to-3d modules referenced repository-external `.env` bytes.

## Evidence

- exact clean-source preflight: PASS;
- tracked files: 10,237;
- parsed JS/TS-family files: 8,034;
- forbidden `.env*` module edges: 0;
- packaged Precision runtime v3 receipt SHA-256:
  `7c145ed89e4600ca290a4582f94e7b2bcba5892a8f51a163846c56510a272a48`;
- focused source/deploy/package regression: 15/15 PASS;
- Platform quality: 65/65 Node and 75/75 Vitest PASS;
- architecture: 11 services / 5 stores / 69 API groups / 27 cron groups /
  6 domains / 4 packages, PASS.

## Non-promotion boundary

This is build-source integrity, not CAD product qualification. The checked-in
Precision runtime receipt remains `HOLD`; no production-class native adapter,
positive release-bound exact loop, independent STEP/XCAF/GD&T review, 20 blind
product challenges, 150 actual AI intents, expert signature, or three
manufactured pilot receipts were created. AI remains candidate authority only,
and manufacturing/commercial release authority remains disabled.
