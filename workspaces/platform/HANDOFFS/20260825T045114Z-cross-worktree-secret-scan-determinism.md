# Platform handoff: cross-worktree secret scan determinism

- Created: 2026-08-25T04:51:14.758Z
- Branch: `scope/platform`
- Head: `742db35a977d5504772ab743ace1fea07683c5a2`
- Integration target: `integration/nexyfab`

## Summary

Made secret-scan coverage deterministic across clean Windows worktrees by
canonicalizing UTF-8 CRLF to LF before text scanning and byte accounting. The
commercial security verifier now requires the exact declared canonicalization
policy, while binary sniffing and the exact derived-receipt exclusion boundary
remain unchanged.

## Changed paths

- `docs/operations/commercial-security-evidence-convergence-20260825.md`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260825T045114Z-cross-worktree-secret-scan-determinism.md`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `node --test scripts/scan-secrets.test.mjs scripts/build-commercial-security-evidence-receipt-v2.test.mjs scripts/commercialization-readiness-gate.test.mjs`
- [x] `npm run security:secrets:generate`
- [x] `npm run security:secrets:check`

## Remaining work and risks

- The production-target security receipt remains HOLD until exact production
  build, deployment, and Git identities exist under separate approval.
- The final integrated HEAD must regenerate the mutable release baseline; that
  baseline is excluded exactly from the secret scan to avoid a hash cycle.

