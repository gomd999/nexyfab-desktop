# GP-09 Product qualification UI binding ADR

Date: 2026-08-24

Status: accepted for the fail-closed UI foundation; authoritative receipt
retrieval and commercial release remain `HOLD`.

## Decision

Product qualification is a distinct truth state. A domain check, generated
artifact, completed agent turn, generic `PASS`, or successful HTTP response is
not a `PRODUCT_QUALIFIED` result.

The Precision-owned boundary now has two layers:

- `domainProductQualificationView` is a server/runtime adapter. It snapshots
  hostile input, recomputes the canonical receipt evaluation, verifies the
  authority and deliverable manifest hashes, and binds the receipt to the
  current project revision ID, CAS sequence, and content hash.
- `DomainProductQualificationPanel` is a browser-safe display component. It
  accepts only the exact
  `nexyfab.precision-cad.product-qualification-view.v1` envelope. Missing data
  is `NOT_RUN`; malformed or partial data is `INVALID`; it never imports the
  Node-crypto receipt evaluator into the client module graph.

## Truth states

- `NOT_RUN`: an explicit receipt/evaluation has not been supplied.
- `HOLD`: the receipt is current but qualification, manifest, review, pilot, or
  attestation evidence is incomplete or mismatched.
- `STALE`: the project/revision/content/CAS binding or evidence source revision
  is no longer current.
- `INVALID`: the fixed input/envelope shape is malformed or unsafe.
- `PASS`: a recomputed evaluation is `PASS`, the eligible state is exactly
  `PRODUCT_QUALIFIED`, all current bindings agree, and there are no blockers.

Manifest hash or evaluation attestation mismatch is deliberately `HOLD`, not a
freshness claim. Only revision/evidence freshness failures become `STALE`.

## Spatial UI binding

The common spatial shell for building, civil, landscape, and interior now
renders the qualification panel with its current project/domain identity.
There is no authoritative receipt retrieval contract in this scope, so the
shipping binding supplies no result and displays `NOT_RUN`/`HOLD` wording. The
existing architecture/interior exact workflow and domain check API cannot
promote this panel.

The future result envelope must contain an exact schema, state, qualified
product state, release-eligibility decision, project/domain/revision identity,
CAS sequence, content/artifact/receipt hashes, and bounded stable blocker codes.
A generic object such as `{status:'PASS'}` or a legacy workflow result is
rejected.

## i18n and disclosure

The panel has Korean, English, Japanese, Chinese, Spanish, and Arabic copy and
uses logical direction for Arabic RTL. Hashes are shortened, identifiers are
bounded, and raw evaluator, exception, AI, or server strings are never rendered.
Canonical values and machine codes remain locale-neutral.

## Verification

- strict adapter tests cover a valid qualified receipt, forged evaluation,
  revision/CAS staleness, stale evidence, manifest/evaluation mismatch,
  explicit not-run, and hostile getter/proxy/cycle/oversize input;
- panel tests cover all six locales, Arabic RTL, exact qualified PASS, malformed
  envelopes, bounded hashes/codes, and false-release prevention;
- the spatial workspace regression proves its production binding begins at
  `NOT_RUN` and does not display `PRODUCT_QUALIFIED`;
- focused tests and the TypeScript workspace typecheck pass.

## Residual HOLD

- A tenant-scoped authoritative receipt store/read API and current canonical
  revision lookup are not available to this client binding.
- The existing product-qualification endpoint evaluates domain contracts and
  pipelines, not an immutable product receipt; its `PASS` must not be reused.
- External authority, exchange, independent review, campaign, and real pilot
  evidence remain required. Synthetic/self-authored fixtures do not qualify a
  commercial product.
- A product-qualified receipt is necessary but is not by itself a quote, RFQ,
  construction approval, purchase action, or commercial release decision.

## Copyright and provenance

The adapter, envelope, UI copy, and tests are original clean-room
implementations based on general validation, revision-control, safety, and
product-qualification concepts. No proprietary manual wording, layout, source
code, dataset, branded workflow, or reference drawing was copied.
