# GP-06 CAD localization and locale-neutral value ADR

- Status: `IMPLEMENTED_INTERNAL / LOCALE_QUALIFICATION_HOLD`
- Date: `2026-08-24`
- Owner: `scope/precision-cad`
- Shared i18n effect: none; only Precision-local catalogs and an adapter are
  changed.

## Decision

Canonical documents, commands, plans, receipts and errors store stable machine
codes and locale-neutral values. Translated prose is display data only and has
no execution, verification, approval or release authority.

The first local catalog supports `ko`, `en`, `ja`, `zh`, `es` and `ar` with
complete key and placeholder parity. English is the fixed fallback. Every
resolved message reports requested locale, actual resolved locale, fallback,
missing-key and translation-review status so an unreviewed locale cannot be
presented as qualified.

## Implemented boundary

The typed machine-code surface covers invalid input, permission, lock conflict,
stale revision, migration readiness, exact preflight, feature registry, runtime
identity, verification, release HOLD, unsupported feature, unavailable exact
kernel, artifact version and receipt validity.

Public validation rejects unknown codes, extra or missing parameters, non-finite
numbers, oversized/control/markup text, accessors, hostile proxies and non-plain
objects. Accepted messages are detached before rendering. Catalog validation is
nonthrowing and reports missing, unused and placeholder-mismatched keys.

Canonical quantities retain numeric values and units (`mm`, `deg`, `kg`, `s`).
Locale rules apply only during display. RFC3339 instants retain their source
value and declare an IANA timezone for display. Invalid calendar fields,
offsets, timezone names, number options and non-finite values fail closed.

The Shape Generator adapter consumes the existing shared locale normalizer
without modifying it, preserves `kr`/`cn` aliases and exposes Arabic RTL
direction metadata.

## Verification status

Focused verification passed 18 GP-06 tests. Combined GP-06/GP-07/XCAF contract
verification passed 33 tests, and repository typecheck passed on 2026-08-24.
The tests cover six-locale key/placeholder parity, fallback metadata, hostile
objects, detached values, display-only number/unit/time formatting, route aliases
and Arabic direction.

## Remaining HOLD boundary

Catalog parity is not translation qualification. Only English and Korean are
currently marked reviewed. Japanese, Chinese, Spanish and Arabic remain
explicitly unverified. Commercial locale claims still require:

- discipline terminology review by native technical reviewers;
- Arabic RTL interaction and logical-layout screenshots;
- drawing, PDF, title-block, BOM/BOQ, schedule and export snapshots;
- Unicode shaping, text overflow, decimal/unit policy and font embedding checks;
- font and terminology corpus provenance plus commercial-use rights;
- accessibility, keyboard and assistive-technology review;
- shared/global routing changes requested through `INTEGRATION_ACTIONS.md`.

## Clean-room and rights rule

Catalog sentences are short, independently authored UI messages. No manual,
standard, competitor UI, glossary, translation memory, copyrighted terminology
table or example export is copied. External terminology may be used only after
its facts, required wording, license and reviewer provenance are recorded; an
unverified translation remains marked unverified even when its keys are complete.
