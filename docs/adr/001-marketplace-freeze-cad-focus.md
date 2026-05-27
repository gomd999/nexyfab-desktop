# 001 — Freeze NexyFab marketplace development for 17 weeks to ship a professional-grade 3D CAD core

**Status:** accepted
**Date:** 2026-05-27
**Author:** gomd999
**Risk tier:** P0 (strategic — affects all subsequent work allocation)

## Context

NexyFab today is two products bundled under one site:
1. A 3D modeler / parametric CAD with 650 catalog features
2. A manufacturing marketplace (RFQ, supplier matching, escrow, payments)

The marketplace side is **~95% feature-complete** (Phase 7: only the
supplier trust-score work remains). The CAD side is **~40% to
standalone-CAD-competitor parity** (Onshape/Fusion/Solidworks) per the
2026-05-26 audit (see prior conversation + `docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md`).

The strategic choice presented:

- **(a) Full parity push** — 12 Waves, 24-36 months. Solo: unrealistic.
- **(b) Vertical CAD MVP** — 6-9 months, niche but defensible.
- **(c) AI-first wedge** — 12-18 months.
- **(d) Trojan-horse** — marketplace first, expand into CAD design.

The user chose to **prioritize the CAD core itself** because:

- The marketplace is already sellable; further marketplace work has
  diminishing returns until there is more customer volume to learn from.
- The 3D modeler is the **harder, longer-lead-time piece** — it needs
  external engineer validation, real STEP/IGES roundtrip evidence, and
  perf at scale before it can be sold at a professional level.
- Solo split attention between marketplace bugs and CAD depth produces
  **both half-done**; focus produces depth in at least one.

## Decision

For 17 calendar weeks (2026-05-28 → 2026-09-24) we **freeze marketplace
development** and direct 100 % of engineering time to Wave 1 (CAD
foundation) of the 12-Wave commercial roadmap, at a depth defined as
"professional engineer can use this without 50 obvious frustrations".

At the end of W17, a 10-year-SW-experience external engineer performs a
30-minute free-play session. Sign-off = no critical regression. The
sign-off is the Wave 1 exit gate; only after passing it do we decide
whether to enter Wave 2 (kernel maturity), pivot to a vertical, or
return to marketplace work.

## Consequences

### Positive

- **Single optimization target** — every decision in the window resolves
  by "does this advance Wave 1?".
- **Deep work possible** — no context-switching tax on the 9964-line
  monolith refactor (W6-8) or the server-side OCCT introduction (W9-12).
- **External validation gate** — W17 sign-off is the first time someone
  outside the project assesses the work; passing it earns confidence to
  charge for the CAD product.

### Negative

- **Marketplace revenue runway = 0 for 17 weeks.** Existing customers
  can still use the live site; no new feature drives acquisition.
- **NEXT_IMPROVEMENTS P1/P3 + Phase 7-5 (supplier trust) deferred.** The
  3-item P1 + 8-item P2/P3 list does not progress until 2026-09-25+.
- **Marketplace bugs accumulate.** Anything below P0 (security / data /
  payment) is recorded but not fixed.

### Neutral

- The Wave 0 infrastructure (PR #1, 5-layer error prevention, commit
  policy, husky/commitlint, geometry invariants, ADR template) was
  already done as preparation. It now serves Wave 1.

## Alternatives considered

- **(d) Trojan-horse / continue marketplace** — rejected because the
  next $1 of marketplace work has worse ROI than the next $1 of CAD
  depth at our current stage. The marketplace already works for the
  users who come to it; the bottleneck is acquisition, which the CAD
  product solves more than another marketplace feature does.
- **(b) Vertical CAD MVP** — held in reserve. If W17 sign-off fails, we
  may pivot to "CAD for precision-machining job shops" (RFQ marketplace
  as the moat) rather than continue chasing Onshape parity.
- **(c) AI-first wedge** — rejected because the AI work (Track C of the
  3D roadmap) is gated on the 2026-06-19 cost-copilot:tighter A/B
  decision, and we don't want to bet 17 weeks on a verdict we have not
  yet read.

## Rollout

- [x] Memory entry `project_nexyfab_cad_focus_wave1.md` saved with the
  full 17-week breakdown.
- [x] Branch `wave-1/w1-step-route-a` created from
  `wip/session-snapshot` (after Wave 0 PR #1 merges, rebased onto main).
- [ ] **W1 Day 1 (2026-05-28)** — merge Wave 0 PR #1, then start Wave 1
  W1-2 work on the new branch.
- [ ] **W3 (2026-06-12)** — start external engineer outreach (LinkedIn /
  Fiverr / Upwork / personal network). Target 10-year-SW user.
- [ ] **W17 (2026-09-24)** — free-play sign-off session.
- [ ] **2026-09-25** — review meeting (with self): pass → Wave 2; fail
  → pivot decision.

## Reversal

This is a **time-boxed** decision; it auto-expires on 2026-09-24
regardless of CAD progress. The only mid-window reversal trigger is:

- A P0 marketplace incident (security breach, data loss, payment
  failure). In that case the freeze is paused only for the duration of
  the incident response; resumed after the postmortem.

There is no "undo" beyond letting the window close.

## References

- Memory: `project_nexyfab_cad_focus_wave1.md`
- Roadmap: `docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md`
- Prior audit conversation: 2026-05-26 session (12-Wave plan, gap
  analysis at 40 % to parity)
- Wave 0 PR: github.com/gomd999/nexyfab-desktop/pull/1
