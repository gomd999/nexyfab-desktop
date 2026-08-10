# NexyFab Pro → SolidWorks / Fusion 360 Parity Plan

**Status:** strategic — multi-year. Updates Q-quarterly.
**Anchor:** [ADR-013 own pro-CAD](../adr/013-own-pro-cad-track.md), [OWN_PRO_CAD roadmap](../roadmap/OWN_PRO_CAD.md)
**Author:** gomd9 (solo founder, AI-assisted)
**Drafted:** 2026-06-02

This document answers: **"What does it actually take to make NexyFab Pro reach SolidWorks or Fusion 360 level?"**

Honest, numeric, multi-year plan. If you only have time for one section, read the [TL;DR](#tldr) and [Brutal Reality](#brutal-reality-baseline).

---

## TL;DR

- **10 years, $20–50M total, 15-50 person team at peak** to reach SW/Fusion functional parity on the **mechanical-design subset** (≈70% of their feature surface). Ecosystem (CAM/FEA/library) is +5 years, +$50M beyond that.
- **Solo founder + AI-assist** can credibly reach ~year-3-equivalent feature depth (~Onshape MVP) in **~3 years**. Beyond that requires a team.
- **First inflection (year ~2):** Funding decision — either raise $5-10M Series A or pivot to plugin/niche.
- **The realistic differentiator** is NOT feature parity but **AI-first cloud-native architecture + verified geometry chain + manufacturing pipeline integration**. We will never out-feature SW; we have to out-architect them on the things they cannot retrofit.
- **Highest-leverage shortcuts:** licensing Parasolid + D-Cubed (year 2-3, ~$1M/yr saves 5+ years of kernel R&D); acquiring or fork-licensing a CAM/FEA partner (year 5+).

---

## Brutal Reality Baseline

| Metric | SolidWorks | Fusion 360 | NexyFab Pro (now) |
|---|---|---|---|
| Years in development | 30 | 15 | 0.5 |
| Engineering team | 600+ | 300+ | 1 (solo + AI) |
| Cumulative R&D spend | $1B+ | $500M+ | <$10K |
| Customer base | 6M seats | 5M users | 0 paying |
| Geometry kernel | Parasolid (Siemens, $500K+/yr lic) | ShapeManager (Autodesk-owned, mature) | OCCT (open) + planegcs |
| Sketch solver | D-Cubed DCM | D-Cubed DCM | planegcs (FreeCAD's, LGPL) |
| Add-in ecosystem | 1000+ plugins | 200+ | 0 |
| 3rd-party libraries (McMaster etc.) | extensive | growing | 0 |
| CAM | Built-in (SW CAM, MasterCAM partnership) | Native Fusion CAM | None |
| FEA | SW Simulation (basic) + Abaqus integration | Native Fusion FEA | None |
| Cloud-native | retrofit (3DEXPERIENCE) | yes (born cloud) | yes (born cloud) ⭐ |
| AI-first | retrofit (Copilot, recent) | retrofit (Forge GenAI) | yes (born AI) ⭐ |

**Conclusion:** Feature-parity race is unwinnable in <10 years solo. The only winning move is to make the **architecture differences (cloud + AI-first)** so valuable that ecosystem/feature gaps become acceptable to a meaningful market segment.

---

## The 5 Pillars

To reach SW/Fusion parity we need ALL 5. Missing any one = "interesting but not viable".

### Pillar 1 — Geometry kernel quality (the ground truth)

What it means: when you boolean-union two complex parts, the result is geometrically valid (manifold, no self-intersection, no degenerate edges, no floating-point holes). This is what 90% of "SolidWorks vs FreeCAD" arguments come down to.

| Year | Action | Cost | Owner |
|---|---|---|---|
| 0-1 | OCCT integration (current). Get to Onshape-MVP quality. | $0 | Solo |
| 2 | Burn-in: 1000 real-world STEP files, fix every failure | $0 | Solo + 1 contractor |
| 3 | Decide: license Parasolid ($500K-2M/yr) or stay on OCCT | $0 or $500K | Founder |
| 4-5 | If Parasolid: migration + kernel-agnostic IR layer (Phase 2.6 already prepped this!) | $1M | 2-3 eng |
| 6-10 | Maintain on commercial kernel; deep boolean / blend / surface fix work | $500K/yr ongoing | 3-5 eng |

**Risk:** If we stay on OCCT, we hit a permanent ceiling. Real-world manifolds < SW. Some pro engineers will reject the tool the first time a boolean fails.

### Pillar 2 — Sketch + Feature depth (the daily-driver UX)

What it means: a competent engineer can model anything they'd model in SW within ~2x the keystrokes. Sketch constraints, fillet variants, surface modeling, sheet metal, weldments, configurations.

Current state: Phase 1 sketch done (planegcs). Phase 2 IR done (extrude/revolve/sweep/loft/pattern). Production UI: 1 route demo (extrude only).

| Year | Action | Cost |
|---|---|---|
| 0-1 | Phase 2.A UI for all 7 sub-features (extrude+revolve+sweep+loft+pattern+shell+history) | $0 |
| 1-2 | Phase 3 assembly UI (mates UI, motion study, interference) | $0 |
| 2-3 | Surface modeling (NURBS sweep/loft/blend/class-A) — needs OCCT or kernel ext | $200K (contractor) |
| 3-4 | Sheet metal (bends/flanges/flat patterns) | 1 eng full-year |
| 4-5 | Weldments (structural members, cut lists) | 1 eng full-year |
| 5-6 | Configurations + design tables (already started in Phase 2.7) | 1 eng 6 mo |
| 6-8 | Top-down assembly + multi-body | 2 eng |

**Risk:** Each sub-feature has 100s of edge cases. SW's depth comes from 30 years of customer bug reports. We won't have that — must compensate with telemetry + design-partner feedback.

### Pillar 3 — Drawing + Manufacturing handoff

What it means: a machinist opens our DWG/PDF and can quote/produce without follow-up questions.

Current state: Phase 4 IR done (sheet/projection/dimension/GD&T/BOM/DXF). Production UI: zero.

| Year | Action | Cost |
|---|---|---|
| 1 | Phase 4 UI: drawing view auto-generation from 3D | $0 |
| 1-2 | Real OCCT HLR (hidden-line removal) integration | 1 eng 4 mo |
| 2 | Sheet template editor + company branding | 1 eng 3 mo |
| 2-3 | GD&T inference from FeatureTree + DFM rules | $200K (1 eng + LLM cost) |
| 3 | DWG full read/write (LibreDWG integration or Teigha license $50K/yr) | 1 eng 6 mo |
| 4-5 | Section views, detail views, exploded assemblies | 1 eng full-year |

**Risk:** DWG fidelity is famously hard. We may end up shipping DXF + PDF only for the first 5 years and let users export DWG via desktop tools.

### Pillar 4 — Ecosystem (libraries, integrations, training)

The dirty secret: people pay for SW because of the **ecosystem**, not the core software.

| Layer | SW/Fusion has | What we'd need |
|---|---|---|
| Component libraries (McMaster, Misumi, ISO fasteners) | Built-in or 1-click | Build over years OR API integrations |
| CAM | Native | Partner integration (DataCAD, EstlCAM, etc.) at first; native gap is 5-10 yr |
| FEA | Native + Abaqus | Same — partner integration first |
| Plugin SDK | C++/COM (SW), Python/JS (Fusion) | Need to publish + maintain SDK + grow plugin authors |
| Training material | 1000s of YouTube videos, Coursera, paid courses | Years of community building |
| Certification | CSWA/CSWP/CSWE program | Partner with a code school or build from scratch |

**Realistic:** Years 4-8 we partner; years 8+ we own selected layers. The plugin SDK should ship year 2 to start growing community.

### Pillar 5 — Trust + Enterprise readiness

Pro engineers won't bet a 2-year project on a tool they don't trust. SW has 30 years of "we won't lose your files". We need to fast-track this.

| Year | Action |
|---|---|
| 1 | SOC 2 Type I (already on Cloudflare/Railway — partial coverage exists) |
| 2 | SOC 2 Type II |
| 2 | On-prem / VPC deployment option for enterprise |
| 3 | ITAR / EAR compliance for US defense supplier customers |
| 3-4 | First 10 production-grade enterprise reference customers |
| 4-5 | Per-tenant Parasolid license model (if Parasolid path chosen) |

---

## 10-Year Phased Plan

### Year 0-1 (2026-2027) — Solo + AI, Onshape-MVP equivalent

**Current → Q3 2027.** Bootstrap from where we are now to a credible "Onshape circa 2014" feature set.

- Phase 1 ✅ done (sketch solver)
- Phase 2 IR done; **UI integration for all 7 sub-features**
- Phase 3 IR mostly done; **assembly UI + mate solver upgrades (Newton-Lagrange)**
- Phase 4 IR done; **drawing UI v1**
- 5 design partners → 50 paying makers/shops
- **Target: $30K MRR by Q4 2027**
- Funding: bootstrapped or accelerator ($150-500K)

**Decision gate Q4 2027:** if MRR ≥ $30K and partner NPS ≥ 7, raise seed. If not, evaluate plugin pivot.

### Year 2-3 (2027-2028) — Seed funded, 3-5 person team

**Q1 2028 — Q4 2028.** Raise $2-5M seed; hire 2-3 senior CAD engineers + 1 designer.

- **Surface modeling** (NURBS basics, class-A enough for consumer products)
- **Sheet metal** (most-requested by shop partners)
- **Drawing UI v2** with real HLR + GD&T inference
- **First 500 paying customers**
- **Plugin SDK v1** + 5 reference plugins (component libraries)
- Cloud-native multi-user editing (CRDT — already prepped in Wave 2 Phase 2)
- **Target: $200K MRR by Q4 2028**

**Decision gate Q4 2028:** if MRR ≥ $200K, raise Series A. Decide kernel: stay on OCCT vs license Parasolid.

### Year 4-5 (2029-2030) — Series A, 15 person team

**Q1 2029 — Q4 2030.** Raise $10-20M; hire 10-12 more eng + go-to-market team.

- **If Parasolid chosen:** migration year. Painful but necessary for credibility.
- **Weldments + configurations + top-down assembly**
- **CAM partner integration** (1-2 partners) for milling/turning quotes
- **First enterprise contracts** ($100K+ ACV)
- **3000 paying customers, $2M MRR**
- **20 reference plugins** in the marketplace
- **SOC 2 Type II + ITAR**

**Decision gate Q4 2030:** SW displacement is the ONLY play that justifies Series B. If we're "second-tier alternative", consider sale to PTC/Onshape/Autodesk instead.

### Year 6-8 (2031-2033) — Series B, 35 person team

**Q1 2031 — Q4 2033.** Raise $30-50M; full enterprise sales team + native CAM/FEA build.

- **Native CAM** (mill 3-axis + turning; 5-axis later) — or acquire CAM company ($5-20M)
- **Native FEA** (linear static, modal, basic thermal) — partner with Ansys/MSC initially
- **10000 customers, $20M MRR**
- **100 reference plugins in marketplace**
- **First 5 Fortune 1000 displacement wins**

### Year 9-10 (2034-2035) — Series C or profitable, 50+ team

- **Full SolidWorks-equivalent mechanical design**
- **50000+ customers, $100M+ ARR**
- **CAM/FEA fully native; PDM enterprise-grade**
- **Decision: IPO, sell to Cadence/PTC, or stay private profitable**

---

## Funding Tree (when + how much + dilution targets)

| Round | When | Amount | Pre-money | Dilution | Use of funds |
|---|---|---|---|---|---|
| Bootstrap | now | $0 | n/a | 0% | solo + AI |
| Accelerator (optional) | Q3 2027 | $150-500K | $2-5M | 5-10% | Demo Day prep |
| **Seed** | **Q1 2028** | **$2-5M** | **$8-15M** | **20-25%** | **3-5 person team, Phase 2.A-2.D UI** |
| **Series A** | **Q4 2029** | **$10-20M** | **$40-80M** | **15-20%** | **15 person team, kernel decision, plugin SDK** |
| **Series B** | **Q4 2031** | **$30-50M** | **$200-400M** | **15-20%** | **35 person team, CAM/FEA native** |
| **Series C** | **2034** | **$50-100M** | **$500M-1B** | **10-15%** | **enterprise sales engine** |

**Founder ownership trajectory:** 100% → 80% (seed) → 65% (A) → 52% (B) → 45% (C). End at IPO/sale ~30-45% depending on path.

---

## What Could Kill This Plan

Reread quarterly. Update as risks materialize.

1. **Solo burnout before seed** (statistically most likely failure). Mitigation: cofounder by Q2 2027 regardless of progress.
2. **Onshape/PTC drops to free** for makers. Removes our beachhead segment. Mitigation: AI differentiation deep enough that "free Onshape" is still inferior.
3. **SolidWorks ships AI-first cloud-native faster than expected** (already started Copilot). Mitigation: NexyFab's AI integration must always be 1-2 years ahead.
4. **Parasolid licensing terms change** — Siemens raises fees or restricts. Mitigation: kernel-agnostic IR (Phase 2.6 already done) lets us swap.
5. **Funding climate freeze** (2031 hypothetical AI-tools correction). Mitigation: $30K MRR by Q4 2027 makes us bootstrappable.
6. **Geometric correctness bug eats a customer's project** — reputation loss compounding. Mitigation: 10-layer AI verify chain (already shipped) + telemetry on every boolean failure.
7. **Acquisition pull at Series B** ($100-500M offer from PTC/Autodesk). Founder decision: take or hold?

---

## Cheaper Alternative Paths (read before committing)

If the 10-year, $20-50M, 50-person path looks like too much, these are the realistic alternatives:

### Alt A — "Onshape MVP forever" (year-3 stop)
Stop building features at year 3. NexyFab Pro = AI-first cloud CAD for makers + SMB. $5-15M ARR ceiling. Acquired at year 5 for $30-100M. **Highest probability of founder good outcome.**

### Alt B — Plugin pivot (year 2 redirect)
At Q4 2028 decision gate, pivot to Fusion/Onshape add-in. AI sidebar that does NL→CAD inside their tool. Skip the kernel war. $5-30M ARR potential; partnership exit with Autodesk.

### Alt C — Vertical specialization
Pick one industry (jewelry CAD, dental, custom prosthetics) and own it deeply. Smaller TAM but achievable in 3-5 years with the IR foundation we have.

### Alt D — Acquisition exit by year 4
Build to $5-10M ARR + 1000 paying users with the current architecture, then sell to PTC/Autodesk/Bentley for $30-150M. Founder takes ~$15-100M post-tax. Lower drama than the 10-year grind.

**The Plan above (full SW parity) is option E. Choose deliberately — A-D are all valid endings.**

---

## Quarterly Re-evaluation Checklist

Every quarter, answer YES/NO:

```
[ ] Is MRR on track for the funding-stage milestone above?
[ ] Did partner NPS stay ≥ 7 this quarter?
[ ] Did any of the 7 "could kill" risks materialize?
[ ] Did a competitor ship something that erodes the differentiator?
[ ] Is the founder/team mental health > "barely OK"?
[ ] Did the kernel decision (OCCT vs Parasolid) get any closer to forced?
```

If ≥ 2 NOs, schedule a strategy review. Don't ride the train past a station that signaled stop.

---

## Pointers

- Code roadmap with concrete IR items: [OWN_PRO_CAD.md](../roadmap/OWN_PRO_CAD.md)
- Architecture commit: [ADR-013](../adr/013-own-pro-cad-track.md)
- Design partner kit (Year 0-1 acquisition): [DESIGN_PARTNER_OUTREACH_KIT.md](./DESIGN_PARTNER_OUTREACH_KIT.md), [_EXECUTION.md](./DESIGN_PARTNER_OUTREACH_EXECUTION.md)
- Webpack/Emscripten lesson learned (Year 0 deploy pain): private local planning memory (not a repository artifact)
- Project memory entry: private local planning memory (not a repository artifact)
