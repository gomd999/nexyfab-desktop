# Backend + Frontend Platform handoff: cross-platform-supply-chain-evidence

- Created: `2026-08-26T16:49:19.1671793Z`
- Branch: `scope/platform`
- Head: `5c0ffd2b2e141263d8d5dc0149a6bdb84e9d42e7`
- Integration target: `integration/nexyfab`

## Summary

Made the commercial supply-chain manifest deterministic across Windows CRLF
and Linux LF worktrees. Every bound JSON artifact now uses the repository's
canonical text binding for byte counts and SHA-256 values, with a fixture
regression that generates under LF and checks the same evidence under CRLF.
Current dependency, secret, kernel, licensing, and supply-chain evidence was
regenerated against the source commit.

## Changed paths

- `docs/evidence/cad-independent/kernel-stack-identity.json`
- `docs/evidence/security/dependency-audit-260810.json`
- `docs/evidence/security/secret-scan-260810.json`
- `docs/evidence/security/supply-chain-manifest-260810.json`
- `scripts/build-supply-chain-evidence.mjs`
- `workspaces/platform/tools/build-supply-chain-evidence.test.mjs`

## Verification

- [x] `node --test workspaces/platform/tools/build-supply-chain-evidence.test.mjs scripts/canonical-text-binding.test.mjs` - 3/3 PASS.
- [x] `npm run security:matrix:check` - 627 routes / 862 handlers / zero gaps.
- [x] `npm run api:controls:check` - 84 routes / 86 handlers / zero issues.
- [x] `npm run security:dependencies:check` - zero vulnerabilities.
- [x] `npm run security:supply-chain:check` - CycloneDX 1.5 / 1,005 components / zero vulnerabilities.
- [x] `npm run licenses:check` - 687 production packages / zero issues.
- [x] `npm run kernel:identity:check` - current.
- [x] `npm run security:secrets:check` - 10,327 candidates / zero findings.
- [x] `npm run lint:ci` - PASS (221.2s).
- [x] `npm run typecheck` - PASS (31.0s).

## Remaining work and risks

- Source-bound automated evidence does not replace a live production rollback
  observation or signed human review of the six-locale commercial surface.
- Precision CAD manufacturing authority remains gated by external expert
  evidence; this platform evidence must not be interpreted as manufacturing
  approval.
