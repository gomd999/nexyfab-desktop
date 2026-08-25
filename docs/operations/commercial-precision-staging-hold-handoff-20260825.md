# Commercial Precision staging HOLD handoff — 2026-08-25

Status: `CORE_STAGING_HOLD_VERIFIED / PRIVATE_BETA_FALSE / GA_FALSE`

## Exact deployed release

- environment: isolated Railway `staging`;
- source/build/Git: `7c73263973836bd036f93ef51ae920257ad7c175`;
- deployment: `356947fe-2b45-453a-aba2-eeb57c33b91e`;
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
SHA-256 `aeba45ad70195a1f2cd323a3778a1a2a1ad0eee7452acd4ae3b9e83a96c70c12`.

All 11 checks passed:

- exact liveness build identity;
- PostgreSQL readiness and required Redis readiness;
- commercial boundary held disabled;
- exact build/deployment/Git release identity and HTTP 503 `HOLD`;
- migration `2026082502` PASS;
- packaged precision runtime receipt is explicit `HOLD`, not `NOT_RUN`;
- forged worker claim is HTTP 403 `FORBIDDEN`;
- forged artifact lease is HTTP 403 `LEASE_CAPABILITY_INVALID`;
- unconfigured callback is HTTP 503 `CALLBACK_NOT_CONFIGURED`.

The packaged precision runtime receipt SHA-256 is
`1c77d674b11cbdb4f94376865d20334e0ea1ad7be89685ecb73eaa0491037677`.
Standalone packaging and Railway upload-context regressions are closed by
commits `34b167fc` and `7c732639`.

## Honest release boundary

This is a verified core staging HOLD, not a commercial worker or CAD-engine
qualification. Private Beta and GA remain false because the following evidence
does not exist yet:

- reviewed, checksum-pinned production-class native CAD adapter;
- separately keyed isolated worker and positive same-release canary;
- native execution, exactly-three-output, Ed25519 receipt, callback, durable
  persistence, and workspace CAS runtime evidence;
- multi-instance, expired-lease, crash, `VERIFIED_UNKNOWN`, and credential
  rotation recovery campaign;
- independent STEP/native-CAD/XCAF/GD&T review and expert sign-off;
- three real manufacturing pilots and same-release operations evidence.

AI Design remains concept/candidate authority only. Precision CAD may promote
only a signed and verified exact result after these runtime gates pass. Neither
manufacturing approval nor automatic ordering is enabled by this handoff.
