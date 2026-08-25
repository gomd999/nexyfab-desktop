# Commercial Precision staging HOLD handoff — 2026-08-25

Status: `CORE_STAGING_HOLD_VERIFIED / PRIVATE_BETA_FALSE / GA_FALSE`

## Exact deployed release

- environment: isolated Railway `staging`;
- source/build/Git: `d0ae60b6102e90bc0fcef1fa50c425d4d768a989`;
- deployment: `1839657a-a2ac-4671-aea9-cea408a3811a`;
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
`docs/evidence/release/commercial-precision-staging-hold-20260825.json`, file
SHA-256 `8a520364b2ada1220bd8a6c3031f2f14db3ea491e1f9d87d8c8834822c74316d`.

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
`c65e0ef8d99faca3b80aa9f89dc2d4584b4ba9c3929e458d140dfdf99aac334a`.
Schema v3 requires the signed worker receipt, trusted-worker registry,
readiness, and release evidence to agree on both the native executable SHA-256
and canonical invocation SHA-256. A valid worker signature cannot substitute
adapter bytes or arguments. Source closure is carried by shared commit
`918cfa0f`, Precision commit `7e01ba14`, Platform commit `f2656283`, and exact
deployed integration HEAD `d0ae60b6`. Standalone packaging and Railway upload-
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
