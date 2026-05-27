# NNN — <Decision title in imperative voice>

**Status:** proposed | accepted | superseded by [NNN](./NNN-...md) | deprecated
**Date:** YYYY-MM-DD
**Author:** <name>
**Risk tier:** P0 | P1 | P2 (see `docs/process/risk-policy.md`)

## Context

What problem are we solving? What forces are at play (constraints,
deadlines, stakeholders, prior decisions)? **Why now** — not later, not
earlier. Keep this section short: a paragraph, maybe two.

If a prior ADR is relevant, link it: `[ADR-NNN](./NNN-...md)`.

## Decision

What we will do, in plain language. One paragraph at most. Use active
voice and present tense.

> Example: "We will use Parasolid (paid license) as the B-rep kernel for
> Wave 4+ instead of continuing on replicad/OpenCascade. The JS-WASM
> kernel cannot meet Wave 4's accuracy targets on real STEP files."

## Consequences

List concrete, verifiable outcomes. Both directions.

### Positive

- <e.g. "Boolean ops on legacy SW assemblies now succeed at the rate
  customers expect.">
- <e.g. "STEP roundtrip RMSE drops from 0.05mm to 0.001mm.">

### Negative

- <e.g. "Annual license cost $200K added to runway burn.">
- <e.g. "Wave 2-3 work on replicad-specific paths becomes throwaway.">

### Neutral

- <Things that change but aren't strictly good or bad.>

## Alternatives considered

- **<Alternative 1>** — why rejected.
- **<Alternative 2>** — why rejected.

Don't list every option you brainstormed; just the ones that came close
enough to be worth defending against.

## Rollout

Concrete steps and their order. If this is a Wave-scale change, link the
relevant Wave's section in the roadmap.

- [ ] Step 1 — <when, who>
- [ ] Step 2 — <when, who>
- [ ] Decision review — <date>: did the consequences match prediction?

## Reversal

What does it take to undo this decision if it turns out wrong? If the
answer is "we can't" — say so explicitly. That's a useful signal.

> Example: "Reversal cost: ~3 months to rewire feature pipeline back to
> replicad + loss of any customer files saved under the Parasolid path."

## References

- Code: `src/...`
- Docs: `docs/...`
- External: <links>
- Prior conversation / PR: <link>
