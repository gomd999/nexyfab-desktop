# Platform handoff: cross-worktree security binding convergence

- Created: 2026-08-25T05:02:29Z
- Branch: `scope/platform`
- Parent head: `1fbe33112f6b37ca061890cdc41580df6958d6c8`
- Integration target: `integration/nexyfab`

## Summary

Extended the existing UTF-8 CRLF-to-LF policy from secret scanning to every
text-derived commercial security binding. Route, CAD, dependency, and receipt
evidence now remains deterministic across Windows worktrees without weakening
path containment, source integrity, or semantic-change detection.

Also fixed dependency audit check mode so stale evidence cannot print a failure
and then exit successfully merely because the live vulnerability count is zero.

## Changed surfaces

- shared canonical text hashing and comparison helper plus unit contracts;
- route security source/dependency hashes and JSON/Markdown stale checks;
- CAD API source/tree hashes and JSON stale check;
- package-lock dependency hash and stale exit-code preservation;
- all five commercial security v2 receipt source bindings;
- security and commercialization fixtures requiring the declared policy;
- regenerated route, CAD, dependency, secret-scan, and security receipt evidence.

## Verification

- [x] 46/46 focused Node contracts pass, including a complete CRLF replay of
  every receipt-bound evidence and source document.
- [x] route security check: 625 route files, 860 handlers, 0 gaps.
- [x] CAD API control check: 84 route files, 86 handlers, 0 issues.
- [x] dependency audit check: 0 vulnerabilities.
- [x] secret scan check: more than 10,000 candidates, 0 oversized text files,
  0 findings.
- [x] commercial security v2 derives `HOLD` only for absent production build,
  deployment, and Git identities.

## Remaining work and risks

- Merge to integration and rerun all four check-mode generators there; this is
  the definitive cross-worktree checkout proof.
- Regenerate the mutable release baseline only after the final integration HEAD
  is clean.
- Production remains unchanged and must not be inferred from isolated staging
  success. Exact production release identity and authorized production evidence
  are still required for a PASS receipt.
