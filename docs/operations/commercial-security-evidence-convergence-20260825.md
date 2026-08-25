# Commercial security evidence convergence — 2026-08-25

Status: `CURRENT_SOURCE_EVIDENCE_PASS / PRODUCTION_RELEASE_IDENTITY_MISSING /
COMMERCIAL_SECURITY_HOLD`

## Closed local gaps

Release-baseline generation previously required the obsolete exact rule
`docs`, while Railway now uses `docs/**` plus a minimal runtime evidence
allowlist. The verifier now binds the complete ordered policy, rejects missing
or reordered rules, and rejects any additional `!docs` negation. This preserves
the small deployment context without allowing the required release receipts to
disappear again.

Secret evidence also had a circular dependency: the scan included derived
current receipts that embed the scan's own hash, so regenerating the security
receipt or release baseline immediately made the scan stale. The scanner now
excludes exactly these four derived mutable receipts:

- `commercial-release-baseline-current.json`;
- `commercial-security-evidence-receipt.json`;
- `commercialization-readiness-current.json`;
- `commercialization-readiness-full-product-current.json`.

The exclusion list and scope are written into the scan evidence and enforced
by the commercial security verifier. Nearby or similarly named files are not
excluded. Importing the scanner no longer performs a repository scan or
changes the importing test process's exit code.

Windows worktrees can materialize the same Git text as CRLF or LF. Counting raw
working-tree bytes made otherwise identical clean HEADs disagree by megabytes
and caused an immediate `SECRET_SCAN_EVIDENCE_STALE` after integration. The
scanner now canonicalizes decoded UTF-8 CRLF to LF before pattern matching and
coverage-byte accounting. The receipt declares
`textCanonicalization: utf8-crlf-to-lf`, and the commercial security verifier
fails closed if that policy is missing or changed. Binary sniffing still runs
on the original bytes and no path exclusion was broadened.

The same rule now binds every other text-derived security surface: route and
forwarded-route source hashes, CAD route and boundary source hashes, the
package-lock hash, stored JSON/Markdown evidence comparisons, and the five
source bindings embedded in the commercial security v2 receipt. The receipt
verifier recalculates all of those bindings from canonical text, so changing
only checkout line endings is stable while any semantic byte change still
fails closed. A dedicated CRLF replay test converts every bound source and
evidence document after receipt creation and verifies the unchanged receipt.

The dependency audit check also had an exit-code bug: it reported
`DEPENDENCY_AUDIT_EVIDENCE_STALE`, then replaced the failure with exit code 0
when the live vulnerability total was zero. Evidence freshness and audit
status are now combined, so either failure returns nonzero.

## Current machine evidence

- route matrix: 625 route files, 860 exported handlers, 0 unknown classes,
  0 routes with gaps;
- CAD API controls: 84 route files, 86 handlers, all checks true, 0 issues;
- secret scan: more than 10,000 Git candidates and 330 MB of text, binary files
  content-sniffed and skipped, 0 oversized files, 0 findings; exact counts live
  only in the machine receipt to avoid documentation self-reference;
- dependency audit: 0 info/low/moderate/high/critical vulnerabilities;
- focused canonicalization, dependency, security receipt, and commercialization
  contracts: 46/46 PASS;
- Railway release-baseline policy and deployment structure: 18/18 PASS.

The generated commercial security v2 receipt verifies current source
bindings, raw derivation, package-lock identity, declared route/CAD source
hashes, and freshness. Its only blockers are:

- `release_build_id_missing`;
- `release_deployment_id_missing`;
- `release_git_head_invalid`.

These are intentional because this unit did not deploy production. An isolated
staging deployment cannot be promoted into a production-target security
receipt. The receipt therefore remains `HOLD` and the commercialization gate
must continue reporting `commercial_security_receipt_missing` until a separately
approved exact production release exists.

## Reproduction

```text
npm run security:matrix:generate
node scripts/build-cad-api-control-evidence.mjs --write
npm run security:dependencies:generate
npm run security:secrets:generate
npm run evidence:security:v2
npm run security:matrix:check
npm run api:controls:check
npm run security:dependencies:check
npm run security:secrets:check
```

`evidence:security:v2` is expected to exit non-zero while the three production
release identity fields are absent. Treating that expected HOLD as PASS would
be a release-boundary violation.
