# ADR-016 — Kernel of record + the engine-selection policy (F1)

**Status:** accepted · **Date:** 2026-06-04 · **Builds on:** [ADR-014](014-occt-kernel-promotion.md) · **Roadmap:** commercial-parity F1

## Context

The commercial-parity roadmap's F1 ("B-rep as the default truth source") flagged a
real ambiguity: the codebase has **two parallel OCCT stacks** and no single
documented kernel of record.

1. **replicad (in-process, UI-wired).** `features/occtEngine.ts` drives the
   per-feature `engine` enum and the global `occtGlobalMode` toggle. ~18 features
   (`boolean`, `fillet`, `chamfer`, `hole`, `shell`, `revolve`, patterns, …) each
   open-coded the *same* decision — `(engine === 1 || isOcctGlobalMode()) &&
   isOcctReady()` — to choose B-rep vs the three-bvh-csg mesh fallback. No single
   home for "when do we run the kernel?".
2. **`src/lib/occt` K1–K7 bridge (server-side).** A worker-backed OCCT client
   with stable topological naming, variable/asymmetric fillet, draft, exact STEP
   (ADR-014). Currently unconsumed by the UI.

## Decision

**replicad (in-process OCCT) is the kernel of record for interactive modelling.**
The mesh path (three-bvh-csg) is an explicit *fast-preview / WASM-unavailable
fallback*, not a co-equal truth source. `src/lib/occt` K1–K7 is retained as the
**server-side companion** for the superpowers replicad can't do in-browser
(persistent naming across rebuilds, variable fillet, draft, exact interop) —
exposed later via an API route (it runs in Node on Railway, no browser WASM dep).

The engine decision is centralised in **one policy module**,
`features/engineSelection.ts`, replacing the ~18 open-coded checks:

- `wantsOcctEngine(engine)` — pure intent (per-feature enum or global toggle);
  features pass it to their mesh fallback as the silent-downgrade guard flag.
- `shouldUseOcctEngine(engine)` — intent **AND** kernel loaded **AND** not
  mid-drag.

### Perf guard (the enabler for a future default-ON)

`shouldUseOcctEngine` consults an interaction phase: during a slider **drag** it
keeps the fast mesh preview even when B-rep is wanted, and upgrades to the exact
kernel on **commit**. The phase defaults to `'commit'`, so the centralisation is
**behaviour-preserving** until the UI opts in via `setInteractionPhase('drag')`.

## Why the default is NOT being flipped ON in this change

Roadmap F1 step 2 ("flip `occtGlobalMode` default ON") is deliberately **not**
done here. Turning it on requires `ensureOcctReady()` (browser WASM init) to
succeed and changes behaviour across every feature — neither is verifiable in the
headless test suite (OCCT-gated tests are skipped). Flipping a global we cannot
verify end-to-end is exactly the risk this program avoids. The pieces that make a
*later, verified* flip a one-liner are landed instead: the single policy, the
perf-guard scaffold, and the documented kernel of record.

## Acceptance (this change)

- One module owns the engine decision; no feature open-codes
  `engine === 1 || isOcctGlobalMode()` anymore (codemod across 15 files).
- Behaviour identical at `phase='commit'` — full feature + pipeline suite green
  (1983 tests, 0 regressions).
- Perf-guard policy unit-tested (drag never selects "more OCCT" than commit).

## Consequences / follow-ups

- UI wiring of `setInteractionPhase('drag'|'commit')` to the slider
  drag/release events (cheap, unblocks a safe default-ON).
- Verified WASM-init probe in a headless harness → then flip the default (F1
  step 2) with confidence.
- F3 persistent naming will lean on the `src/lib/occt` companion via an API route.
