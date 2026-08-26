# Commercial Precision staging HOLD handoff — 2026-08-25

Status: `CORE_STAGING_HOLD_VERIFIED / PRIVATE_BETA_FALSE / GA_FALSE`

## Exact deployed release

- environment: isolated Railway `staging`;
- source/build/Git: `3797ad6d75f02ad750e746199eb8c041e5d52d9f`;
- deployment: `d4718236-06ca-4b56-81c8-5c271b2e8976`;
- image digest:
  `sha256:bd1364d1121916016d91a19919486d39a053a9ce38db008a05c197f9a20ce2bf`;
- replicas: 2 configured, 2 running, 0 crashed;
- commercial mode: `0`;
- release channel: `staging-hold`;
- migration: `2026082502`, source/database SHA-256
  `69c830cb4fa11fb7637f325098d0c0b1a920caeba9802fbbe4a8658f00055f30`.

Production was not deployed, restarted, reconfigured, or written. Its
variables were read only by the redacting isolation auditor for in-memory
comparison with staging; no values were persisted or printed.

## Verified evidence

The repeatable collector command is:

```text
npm run commercial:precision:staging-hold-evidence -- \
  --base-url=<isolated-staging-origin> \
  --expected-build-id=<40-char-git-head> \
  --expected-deployment-id=<railway-deployment-id> \
  --expected-git-head=<40-char-git-head> \
  --write --out=<repository-json-path>
```

It refuses a production/non-HTTPS origin and persists only selected non-secret
fields, HTTP status codes, and response-body SHA-256 bindings. The checked-in
receipt is
`docs/evidence/release/commercial-precision-staging-hold-20260825.json`.
The collector-output raw-byte SHA-256 at collection time was
`da737dc2e97d23d54b6afff48adadf1fd32117140f4221cfe363bf9fe9dbcb16`;
the cross-worktree authority is the canonical self-hash
`59485c350d6aeaa45881ef7e06032836bec330ce2be49c46331fcac9ca03731e`.
The verifier independently rechecks that self-hash, freshness, isolated
staging origin, exact 11-check set, response bindings, release identity, and
the non-promoting HOLD boundary.

All 11 checks passed:

- exact liveness build identity;
- PostgreSQL readiness and required Redis readiness;
- commercial boundary held disabled;
- exact build/deployment/Git release identity and HTTP 503 `HOLD`;
- migration `2026082502` PASS;
- packaged precision runtime receipt is schema v3 and explicit `HOLD`, not
  `NOT_RUN`;
- forged worker claim is HTTP 403 `FORBIDDEN`;
- forged artifact lease is HTTP 403 `LEASE_CAPABILITY_INVALID`;
- unconfigured callback is HTTP 503 `CALLBACK_NOT_CONFIGURED`.

The packaged precision runtime receipt SHA-256 is
`bd12ecba3301f192b2e070acf553001ed2595c4b4bfcff1530ab759430da66a6`.
Schema v3 requires the signed worker receipt, trusted-worker registry,
readiness, and release evidence to agree on both the native executable SHA-256
and canonical invocation SHA-256. A valid worker signature cannot substitute
adapter bytes or arguments. Source closure is carried by shared commit
`918cfa0f`, Precision commit `7e01ba14`, Platform hardening commit `99387e27`,
and exact deployed integration HEAD `3797ad6d`. Standalone packaging and Railway upload-
context regressions remain closed by commits `34b167fc` and `7c732639`.

## Honest release boundary

This is a verified core staging HOLD, not a commercial worker or CAD-engine
qualification. Private Beta and GA remain false because the following evidence
does not exist yet:

- reviewed, checksum-pinned production-class native CAD adapter;
- separately keyed isolated worker and positive same-release canary;
- native execution, exactly-three-output, Ed25519 receipt, callback, durable
  persistence, and workspace CAS runtime evidence;
- positive real-worker multi-instance, expired-lease, crash,
  `VERIFIED_UNKNOWN`, and credential-rotation recovery campaign;
- independent STEP/native-CAD/XCAF/GD&T review and expert sign-off;
- three real manufacturing pilots and same-release operations evidence.

AI Design remains concept/candidate authority only. Precision CAD may promote
only a signed and verified exact result after these runtime gates pass. Neither
manufacturing approval nor automatic ordering is enabled by this handoff.
