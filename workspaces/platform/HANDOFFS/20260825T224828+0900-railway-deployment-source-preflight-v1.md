# Railway exact deployment-source preflight v1 handoff

## Status

`CLEAN_GIT_SOURCE_BOUND / RELEASE_HEALTH_SOURCE_BYTES_BOUND /
EXTERNAL_ENV_MODULE_EDGES_0 / LOCAL_PREFLIGHT_PASS / DEPLOYMENT_NOT_RUN /
COMMERCIAL_RELEASE_HOLD`

## Source identity

- implementation commit:
  `cd196e04c88922982f0c34318e6974533fbe4e2b`;
- branch at implementation handoff: `scope/platform`;
- production and staging mutation: none in this closure;
- this receipt does not authorize a deploy or promotion.

## Observed failure classes closed

1. Railway staging deployment
   `e933c3e3-f17c-4e81-bf7f-8cb647c30d7f` completed Next compilation but
   failed in `postbuild` because
   `docs/evidence/release/commercial-precision-runtime-evidence.json` was not a
   regular file in the uploaded snapshot.
2. Railway production deployment
   `5bb748ca-56fe-45bb-ae15-c2da3671b08a` failed Webpack compilation because
   `scripts/drawing-to-3d/ai-json.mjs` and `extract.mjs` had static module edges
   to repository-external `../../../../.env`.

Both environments later had successful deployments, so these were build-source
integrity failures rather than persistent runtime-health failures. Historical
`REMOVED` deployments are superseded records, not failures.

## Implemented boundary

- `scripts/verify-deployment-source.mjs`
  - requires the upload directory to be the Git toplevel;
  - requires exact full-HEAD equality with `NEXYFAB_BUILD_ID`;
  - rejects all tracked and untracked worktree dirt;
  - requires tracked regular `package.json`, lockfile, Dockerfile, ignore files,
    and `railway.toml`;
  - evaluates `.railwayignore` and `.dockerignore` for every release-health
    source file;
  - parses all tracked JS/TS-family files with the TypeScript AST and rejects
    import/export/dynamic-import/require/require.resolve edges to `.env*`;
  - emits `nexyfab.deployment-source-preflight.v1` only on PASS.
- `scripts/package-release-health-evidence.mjs`
  - exposes `validateReleaseHealthEvidenceSource`;
  - validates fixed receipt schemas and byte limits;
  - for a qualified seven-day v3 receipt, validates every operations-evidence
    binding, unique path, byte bound, and SHA-256 before packaging or upload.
- `scripts/deploy-railway-verified.mjs`
  - runs the source preflight before all non-verify uploads;
  - leaves `--verify-only` as remote verification without a local upload;
  - writes `build=<40-char HEAD> source=clean-git-v1` into Railway deployment
    metadata.
- `scripts/platform/run-platform-quality.mjs` executes the deployment,
  packager, and source-preflight regression tests in CI's Platform quality gate.

## Verification

- focused Node regression: 15/15 PASS;
- related ESLint: PASS;
- Platform Node service/policy suite: 65/65 PASS;
- Platform Vitest container/worker/contract suite: 75/75 PASS;
- architecture: PASS, 11 services / 5 stores / 69 API groups / 27 cron groups /
  6 domains / 4 packages;
- actual clean source preflight:
  - tracked files: 10,237;
  - parsed JS/TS-family source files: 8,034;
  - forbidden external `.env` module imports: 0;
  - packaged fixed evidence:
    - i18n v2, SHA-256
      `f0774e32ba82259442fff8ac54598300344524ba28eb415c306c3d8e50412cf7`;
    - seven-day operations v1 HOLD, SHA-256
      `48263b536a3d72a343c6fd40fbf7ba6d453d02655852062802521aa1eac6d699`;
    - Precision runtime v3 HOLD, SHA-256
      `7c145ed89e4600ca290a4582f94e7b2bcba5892a8f51a163846c56510a272a48`.

The intentionally incorrect expected SHA test was rejected before scanning,
proving the full-build identity check is fail-closed.

## Honest remaining boundary

- `cd196e04` has not been deployed by this closure.
- The current integration worktree has user-owned evidence JSON modifications;
  verified deployment must not upload that dirty directory. Use a clean exact
  checkout after the target build variables are intentionally bound.
- `/api/health/release` may remain HTTP 503 `HOLD` while `/live` and `/ready`
  pass. That is an evidence gate, not a deployment crash.
- External runtime observation, actual rollback execution, protected
  provider/KMS backup proof, independent CAD review, blind product challenges,
  and manufactured pilots remain required. No local receipt may promote those
  claims.
