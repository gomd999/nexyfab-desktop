# Wave 2 Phase 1 — Status Brief

**Last updated:** 2026-05-28 · **State:** code shipped, awaiting user-side review checkpoint.

This is the single doc to read first when picking the project back up. It points at the artifacts; it does not re-explain them.

## Where we are

Phase 1 (Month 1) of [ADR-010](adr/010-wave-2-b-full-collab.md) is **code-complete**. Eight PRs are stacked on `main`, awaiting the three review signals required to enter Phase 2.

## The PR stack (8 PRs, all open)

Merge order is bottom-to-top. Each PR's base is the previous PR's head — squash-merging the stack from `main` upward.

| PR | Title | Lines | Tests |
|---|---|---|---|
| **#33** | ADR-010 + Phase 1 plan — B-Full + collab commit | — | n/a |
| **#34** | Phase 1 Week 1 deliverables — 4 docs via agent fan-out | 2,613 | n/a |
| **#35** | Phase 1 Week 2 — CRDT prototypes + transport + persistence + migration | ~5,400 | 161/161 |
| **#36** | Phase 1 Week 3 — 5 Phase 2 modeling feature specs | 4,828 | n/a |
| **#37** | Phase 1 Week 4 — ADR-011 + cloud doc API + migration | 6,276 | 80/80 |
| **#38** | CRDT browser smoke harness — sketch | 669 | 4/4 |
| **#39** | Feature-tree CRDT smoke (companion to #38) | 524 | 5/5 |
| **#40** | IndexedDB persistence smoke (third companion) | 481 | 4/4 |

**Total Phase 1: ~20,800 lines, 254 tests passing.** No production-prod paths modified — every new module is either a doc, a Phase-2 architecture artifact, or a dev-tool route under `/[lang]/collab-smoke-*` not linked from nav.

## The three review signals

[ADR-010 §"Phase 1 review checkpoint"](adr/010-wave-2-b-full-collab.md) defines the gate.

### Signal #1 — CRDT prototype browser smoke test

**Status:** harnesses + runbook ready. **Your action:** run the checklists.

```
npm run dev
# Then open in browser:
#   http://localhost:3000/ko/collab-smoke
#   http://localhost:3000/ko/collab-smoke-feature-tree
#   http://localhost:3000/ko/collab-smoke-persistence
# Follow the 4-step checklist in each, per:
#   docs/wave-2-phase-1-checkpoint-crdt-smoke.md
```

Pass criteria: all 12 checks (3 routes × 4 steps) end with the `CONVERGED` / `READY` badge.

### Signal #2 — Advisor interview

**Status:** JD ready in PR #34 → `docs/wave-2-cad-advisor-jd.md`. **Your action:** post in this order until one bite:

1. LinkedIn (CAD circles)
2. 원티드 (시니어 CAD 엔지니어)
3. KSME (대한기계학회) 회원게시판

Target: one 30–60 minute conversation with a SolidWorks / Fusion / Onshape practitioner who can validate the Phase 2 modeling-feature priorities (sheet metal, hole wizard, threads, ref geometry, configurations).

### Signal #3 — 20-fixture × 5-viewer STEP matrix

**Status:** runbook in PR #34 → `docs/wave-1-compat-matrix.md`. **Blocked on:** Wave 1 PR stack (#2–#9) admin-override merges.

**Your action:**
1. Admin-override merge the 9-PR Wave 1 stack in the order documented at [project_nexyfab_wave1_complete.md](../.. memory)
2. Provision Railway `nexyfab-occt-worker` service (Task #31)
3. Run the 20-fixture matrix; gate is ≥ 70% pass + denominator ≥ 85

## Decision matrix (Phase 2 entry)

After running all three signals:

| Signals | Outcome | Action |
|---|---|---|
| All Green | **Phase 2 entry** | Start Phase 2 Week 1: sheet metal Subset A + Configurations corruption fix (P0) |
| 1 Yellow | **Scope cut + Phase 2 entry** | Defer one Phase 2 track (per D5 master tracker in PR #37) |
| 2+ Yellow | **Contractor + Phase 2 entry** | Open the $60–130K contractor budget per ADR-010 §"Burn-out risk" |
| Any Red | **No Phase 2** | Pivot: extend Phase 1 to fix the failing signal, or revisit scope at ADR-010 level |

## What's autonomous-blocked vs user-blocked

| Item | Owner |
|---|---|
| All Phase 1 code | Done |
| All Phase 1 docs | Done |
| 3 review signals | **User** (browser test + advisor + Wave 1 merges) |
| Phase 2 entry decision | **User** (after signals come in) |
| Phase 2 Week 1 implementation | Blocked on user's Phase 2 entry decision |
| Configurations corruption defensive patch | Blocked on user — fix overlaps with Phase 2 architecture (ADR-011 routing); pre-empting it pollutes the review |
| Sheet metal Subset A (kFactorTable kill) | Blocked on user — Phase 2 Week 1 P0 per D4 audit; same reasoning |

## Memory pointers

- [project_nexyfab_wave2_decision.md](../.. memory) — ADR-010 binding scope
- [project_nexyfab_wave2_phase1_complete.md](../.. memory) — this snapshot in memory form
- [project_nexyfab_wave1_complete.md](../.. memory) — prior wave, gates signal #3
