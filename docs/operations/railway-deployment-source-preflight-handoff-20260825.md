# Railway exact deployment-source preflight integration handoff

## Decision

All future non-verify `deploy:railway:verified` uploads are fail-closed on the
exact local source before Railway receives a build context. A timestamp-only CLI
upload is no longer sufficient evidence of the deployed source.

Status:

`CLEAN_GIT_SOURCE_BOUND / FULL_HEAD_MATCH_REQUIRED /
RELEASE_HEALTH_SOURCE_BYTES_BOUND / EXTERNAL_ENV_MODULE_EDGES_0 /
FINAL_LOCAL_PREFLIGHT_PASS / DEPLOYMENT_NOT_RUN / COMMERCIAL_RELEASE_HOLD`

## Implementation and scope bindings

- implementation: `cd196e04c88922982f0c34318e6974533fbe4e2b`;
- Platform handoff commit: `5263a8f7`;
- Precision consumer handoff commit: `d2ff6e90`;
- AI downstream handoff commit: `2f97a247`;
- Platform handoff:
  `workspaces/platform/HANDOFFS/20260825T224828+0900-railway-deployment-source-preflight-v1.md`;
- Precision handoff:
  `workspaces/precision-cad/HANDOFFS/20260825T225551+0900-deployment-source-consumer-boundary.md`;
- AI handoff:
  `workspaces/ai-design/HANDOFFS/20260825T225806+0900-ai-downstream-deployment-source-boundary.md`.

## Failure diagnosis converted into a gate

The two inspected Railway failures were build-source failures:

- staging deployment `e933c3e3-f17c-4e81-bf7f-8cb647c30d7f` reached a
  successful Next/TypeScript build and then failed `postbuild` because
  `commercial-precision-runtime-evidence.json` was absent from the uploaded
  source;
- production deployment `5bb748ca-56fe-45bb-ae15-c2da3671b08a` failed Webpack
  because two drawing-to-3d modules had static module imports to
  repository-external `../../../../.env`.

Later deployments succeeded in both environments. Historical `REMOVED` rows
are superseded deployments, not failures. `/api/health/release` HTTP 503 HOLD is
also distinct from `/live` or `/ready` deployment health.

The new source preflight rejects:

1. a source directory that is not the Git toplevel;
2. full-HEAD mismatch with the expected target build ID;
3. any tracked or untracked worktree dirt;
4. missing, non-regular, or untracked Docker/Railway build inputs;
5. fixed or qualified dynamic release-health evidence that is invalid,
   over-limit, hash-drifted, untracked, or excluded from either build context;
6. static JS/TS import/export/dynamic-import/require/require.resolve module
   edges to `.env*` files.

Verified deployment metadata records
`build=<full Git HEAD> source=clean-git-v1` before the timestamp. `--verify-only`
still performs remote verification without claiming a new local upload.

## Verification

Final clean preflight on integration line `2f97a247`:

- status: PASS;
- tracked files: 10,240;
- parsed JS/TS-family files: 8,034;
- forbidden `.env*` module edges: 0;
- release-health packaged source files: 3/3 present, tracked, included,
  schema-valid, byte-bounded, and SHA-256 exact;
- i18n receipt SHA-256:
  `f0774e32ba82259442fff8ac54598300344524ba28eb415c306c3d8e50412cf7`;
- seven-day operations HOLD SHA-256:
  `48263b536a3d72a343c6fd40fbf7ba6d453d02655852062802521aa1eac6d699`;
- Precision runtime v3 HOLD SHA-256:
  `7c145ed89e4600ca290a4582f94e7b2bcba5892a8f51a163846c56510a272a48`.

Regression and workspace evidence:

- focused Node source/deploy/package tests: 15/15 PASS;
- related ESLint: PASS;
- Platform quality: 65/65 Node, 75/75 Vitest, architecture PASS;
- Platform workspace: ownership 0 violations, full source ESLint PASS,
  TypeScript PASS;
- Precision workspace: ownership 0 violations, TypeScript and architecture
  PASS;
- AI workspace: ownership 0 violations, TypeScript, common accuracy 62/62,
  candidate manifests 7/7 PASS.

## Safe next deployment sequence

1. Preserve the user-owned dirty integration evidence JSONs. Do not upload that
   worktree.
2. Use a clean exact checkout of the intended final HEAD.
3. Intentionally bind staging `NEXYFAB_BUILD_ID` and `RELEASE_GIT_HEAD` to that
   full HEAD while keeping staging-HOLD commercial flags disabled.
4. Run `npm run deploy:source:preflight -- --expected-build-id=<full-head>`.
5. Run the existing target-variable, workspace, architecture, and replicated
   build gates through `deploy:railway:verified --staging-hold`.
6. Verify the new Railway metadata, image digest, `/live`, `/ready`, exact build
   ID, and the expected `/api/health/release` HOLD result.
7. Do not promote production until the independent commercial gates pass.

This handoff does not authorize steps 3-7 and performed no Railway mutation.

## Remaining honest HOLD

Local deployment-source integrity does not supply protected provider/KMS backup
evidence, exact-release restore and rollback observations, separately held
worker/reviewer credentials, independent CAD/AI expert signatures, 150 actual
AI intents, 20 blind product challenges, or three manufactured pilots. AI
remains concept/candidate authority; Precision exact and manufacturing release
remain separately signed and fail-closed.
