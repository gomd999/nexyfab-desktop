# Error Prevention Plan — Index

**Status:** active · **Adopted:** 2026-05-26 (Wave 0)

NexyFab uses a 5-layer error prevention strategy. This index links to each
layer's runbook. The 0-week setup created the wiring; Wave 1+ uses it.

## Layers

| Layer | What it catches | Runbook |
|---|---|---|
| **1 — Plan gates** | Wrong-direction work, missing rollback plan | [risk-policy.md](./risk-policy.md), [`docs/adr/`](../adr/) |
| **1.5 — Commit gates** | Mega-commits, missing tier, ad-hoc formats | [commit-policy.md](./commit-policy.md), commitlint, pre-commit size gate, PR template, GH Action title lint |
| **2 — Code gates** | Type drift, unused vars, `any` regressions | tsconfig (strict + noImplicitOverride), eslint (no-explicit-any: error), `.husky/pre-commit` |
| **3 — Verification gates** | Logic bugs before commit | vitest (timeouts enforced), property-based (`src/lib/geometry/*.property.test.ts`), visual regression (`e2e/visual-regression-3d.spec.ts`), CI workflows |
| **4 — Deploy gates** | Bad code reaching real users | [staging-setup-runbook.md](./staging-setup-runbook.md), [canary-deploy.md](./canary-deploy.md), branch protection on `main` |
| **5 — Production gates** | What slipped through | [sentry-alert-rules.md](./sentry-alert-rules.md), geometry invariants in `src/lib/geometry/invariants.ts` |

## Self-review

Everything above is automated or codified — but the highest-leverage
single gate is the **24-hour self-review delay** on PRs. See
[self-review-policy.md](./self-review-policy.md).

## What still requires manual work

Some gates can't be automated and require explicit user action. They're
tracked as open Wave 0 follow-ups:

- [ ] BREP_QA_CHECKLIST 9 items + smoke-test-3d 5 scenarios — manual
      browser walk-through after every B-rep diff lands on staging.
- [ ] Quarterly rollback drill on staging — see `canary-deploy.md`.
- [ ] Sentry alert rules — set up via Sentry UI per
      `sentry-alert-rules.md` once staging Sentry project exists.
- [ ] Staging environment creation — `staging-setup-runbook.md`
      D1/D2/D3 decisions, then commands.

## How to use this index

When adding a new failure mode the project hits:

1. Identify which layer should have caught it.
2. If no layer covers it, add a new runbook or extend an existing one.
3. Cross-link from this index.
4. Write a postmortem in `docs/postmortem/` so the next person sees
   the pattern.

## Quarterly review

Each quarter, review this index:

- Did any layer fail catastrophically? Add scenario to it.
- Did any layer fire too often (noise)? Tune.
- Are the runbooks still accurate? Update before they rot.
