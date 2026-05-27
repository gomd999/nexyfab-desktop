# Risk Tier Policy

**Status:** active · **Adopted:** 2026-05-26 (Wave 0)

Every commit gets a risk tier. The tier drives **how much process applies**
to the change. Without tiers, every change pays the same overhead; that
means tiny changes are slow and big changes are under-gated.

## The three tiers

| Tier | What it means | Examples |
|---|---|---|
| **P0** | Touches money, geometry correctness, security, or data integrity. Wrong = customer-visible failure or silent corruption. | Payment flow change · B-rep boolean implementation · Auth middleware · DB migration · Server Action signing · STEP roundtrip · Sentry forwarding · cryptography |
| **P1** | Affects shipped UX or shared infra but recoverable without data loss. Wrong = degraded experience, rollback restores. | UI flow change · API contract change · CI workflow change · feature flag rollout · perf optimization · new dependency · linting rule change |
| **P2** | Local, easily reverted, no shared state effect. Wrong = at worst a 5-min revert. | Doc-only · test-only · code style / refactor with no behavior change · tooling config that affects only local dev · changelog |

## The commit message rule

Every commit subject line starts with the tier in brackets:

```
[P0] feat(cad): B-rep boolean for non-convex polygons
[P1] refactor(ui): split ShapeGeneratorInner into 3 route chunks
[P2] docs(process): risk-policy quick reference
```

If you can't decide between two tiers, **pick the higher one**. Over-gating
a P2 costs nothing; under-gating a P0 costs hours of incident response.

## What each tier requires

### P0

- ADR required (`docs/adr/NNN-*.md`) — created **before** the code change.
- Test coverage: unit + integration + (where applicable) property-based fuzz.
- 24h self-review delay applies, no exception.
- Feature flag or reversal plan **documented in the PR description**.
- Staging smoke run before prod promote.
- Canary 1h observation on prod after deploy.

### P1

- No ADR required unless the change introduces a new architectural pattern.
- Test coverage: unit + at least one integration check.
- 24h self-review delay applies.
- Reversal plan stated in PR description (one sentence).
- Staging smoke encouraged; canary observation 30min on prod.

### P2

- No ADR.
- Test coverage: enough to prevent regression (often just "the change
  doesn't break existing tests").
- 24h delay **may be waived** for pure doc / code style / dev tooling.
- Direct promote to prod after CI green; no staging required.

## How to label

Self-assess against the table. The decision should take 5 seconds. If it
takes more, you might be combining tiers in one PR — split it.

## What this is NOT

- It is **not** a substitute for thinking. A P2 doc change about an
  unsafe API can still ship a bug if the doc encourages bad use.
- It is **not** a status report to anyone else. It's a personal forcing
  function: writing `[P0]` reminds you the gate exists.
- It is **not** load-bearing in CI yet. CI runs all gates regardless of
  tier. Tiers govern **how you handle the PR**, not what runs.

## When the tier changes mid-development

If a PR started P2 and grew into P0 (the refactor turned out to touch
crypto), **stop, label `[P0]`, and add the missing gates**: ADR, tests,
delay. Don't retro-justify with `[P2]` to skip the work — that's how
incidents start.

## Quarterly review

Each quarter, look at the past quarter's commits:

- Are P0s actually P0s? (Were any mislabeled?)
- Did P0s correlate with incidents? (Bad: missed gating. Good: caught
  early by the policy.)
- Should the tier table change?

Record findings in `docs/postmortem/risk-review-YYYY-Q.md`.
