# Release-gate-hardened Precision staging evidence

Timestamp: `2026-08-25T07:20:00Z`

Status: `CORE_STAGING_VERIFIED / POSITIVE_NATIVE_RUNTIME_NOT_RUN /
PRIVATE_BETA_FALSE / GA_FALSE`

## Bound release observation

- application source/build/Git:
  `3797ad6d75f02ad750e746199eb8c041e5d52d9f`;
- Railway environment/service: isolated `staging` / `nexyfab.com`;
- deployment: `d4718236-06ca-4b56-81c8-5c271b2e8976`;
- image:
  `sha256:bd1364d1121916016d91a19919486d39a053a9ce38db008a05c197f9a20ce2bf`;
- runtime state: `SUCCESS`, 2/2 instances `RUNNING`;
- schema migration: `2026082502`;
- staging receipt self-hash:
  `59485c350d6aeaa45881ef7e06032836bec330ce2be49c46331fcac9ca03731e`.

All 11 exact-core and negative-boundary checks passed. They cover exact live
and deployment identity, PostgreSQL/Redis readiness, commercial mode disabled,
migration integrity, packaged commercial Precision v3 `HOLD`, forged worker
claim rejection, forged artifact-lease rejection, and fail-closed callback
configuration.

The commercialization gate independently verifies the immutable receipt and
no longer reports `core_staging_hold_not_verified`. The receipt is a
prerequisite, never promotion authority.

## Exact authority boundary

The AI-to-Precision durable source path remains connected: revision-bound AI
candidate input can enter immutable Precision v2 input and the v3 receipt
contract. AI output cannot author exact PASS, authoritative workspace CAS,
manufacturing approval, or release approval.

This observation contains no positive production-class native execution. The
checked-in packaged runtime receipt remains `HOLD`, and no registered native
adapter, separate Ed25519/HMAC authorities, same-release positive canary,
multi-instance recovery campaign, independent STEP/native-CAD/XCAF/GD&T
review, expert signoff, or manufacturing pilots were supplied.

Production was not deployed, restarted, reconfigured, or written.
