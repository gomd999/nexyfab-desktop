# ADR-015 — Break the intent shape whitelist via verified composition

**Status:** accepted · **Date:** 2026-06-04 · **Builds on:** [ADR-013](013-own-pro-cad-track.md)

## Context

The AI/SCAD pipeline only accepts ~45 whitelisted `shapeId`s (box, cylinder,
sphere, cone, torus, pipe, disk, gear, iBeam, …). Anything outside the list is
rejected or forced to a near-match. This bounds reliability (the closed-loop
spec verifier can check a known shape) but also caps what the agent can build.

Two assets already exist that make loosening this safe:

- **Closed-loop spec verification** (`specVerification`): expected bbox / volume
  / surface-area from an intent, compared against the rendered mesh. This is
  the moat — a wrong build is caught, not shipped.
- **Eval harness** (`evalIntentAccuracy`): a curated golden set (NL → expected
  intent) with renderability + tolerance gates. This measures regressions when
  we change what intents are accepted.

## Decision

Allow shapes **outside** the primitive whitelist to be expressed as a
**composition of whitelisted primitives** combined with boolean ops
(`add` / `subtract` / `intersect`), each optionally translated. The composition:

- renders deterministically (each part via `intentToScad`, combined with
  `union`/`difference`/`intersection`),
- yields a **computable expected bbox** (union of the placed add-part bboxes),
  so the existing verifier still gates correctness,
- is **additive** — a new `compositeIntent` module; the primitive whitelist and
  `intentToScad` are untouched. The agent falls back to composition only when no
  single primitive fits.

The verifier remains the safety net: a composition that doesn't match its
expected bbox/volume is rejected exactly like a bad primitive build.

## Phases

| Phase | Deliverable | Gate |
|---|---|---|
| **W1** | `compositeIntent` — parts → combined SCAD + expected bbox (this commit, additive, pure) | a box−cylinder composite renders + its bbox = the box bbox |
| **W2** | Agent fallback: when a request has no primitive match, the agent proposes a composition; verifier gates it | golden NL "L-bracket" builds via 2-box union, passes spec |
| **W3** | Eval-suite expansion: add composite golden cases to `evalIntentAccuracy` | pass-rate gate holds with composites added |
| **W4** | Loosen the schema gate to accept `composite` intents end-to-end | non-whitelisted request ships only if verified |

## Consequences

- The agent can build arbitrary boolean assemblies of primitives without new
  per-shape whitelist entries.
- Risk is bounded by the verifier: unverifiable compositions are rejected, not
  shipped. W2+ touch the central intent schema / agent loop and must land
  behind the eval-suite gate.

## Non-goals

Not arbitrary freeform/NURBS (needs the OCCT kernel — [ADR-014](014-occt-kernel-promotion.md));
not removing the primitive whitelist (composition sits beside it).
