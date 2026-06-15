# 013 — Commit to own pro-CAD track (NexyFab Pro)

**Status:** accepted
**Date:** 2026-06-01
**Author:** gomd9 (founder)
**Risk tier:** P1

## Context

NexyFab today is a maker/SMB AI-CAD web tool (~6-phase commercial direct-edit shipped, 10-layer AI verify, image-to-intent, reverse engineering, quoting). 162 commits ahead of `main` on this branch; production deploy verified 2026-06-01 (deploy `71b8794b`).

The next strategic fork was:
1. Stay vertical (maker/SMB) — proven, finite ceiling.
2. Add Fusion/Onshape plugins — high leverage, validated market.
3. Build own pro-CAD competing with SolidWorks/Onshape — large prize, multi-year solo bet.

Founder picked (3) with parallel (1) revenue track. (2) deferred until own-CAD reaches Phase 2 (own-CAD becomes the marketing vehicle for plugins, not vice versa).

## Decision

We commit to building NexyFab Pro, a cloud-native AI-first parametric CAD competing with Onshape in 3-5 years (solo + AI-assisted dev, ~Onshape-MVP scope) and with SolidWorks in 5-10 years (post-funding, post-team). Plugin track (Fusion/Onshape add-ins) parked until after Phase 2.

Phased roadmap (see `docs/roadmap/OWN_PRO_CAD.md`):
- **Phase 1** (3-6 mo): Sketch solver integration (planegcs WASM) + solver-backed SketchEditor.
- **Phase 2** (6-9 mo): Feature-based part modeling (extrude/revolve/sweep/loft/fillet/shell/pattern + parametric history).
- **Phase 3** (6-9 mo): Assembly with mate solver + DoF + interference + motion study.
- **Phase 4** (4-6 mo): Drawing v2 (sheets/projections/dimensions/GD&T/BOM/revision/DXF-DWG-PDF).
- **Phase 5** (3-6 mo): File interop (STEP AP242 full, IGES, DXF/DWG, STL/3MF).
- **Phase 6** (parallel all phases): AI differentiators (sketch suggest, parametric assistant, NL revision, voice input).

NexyFab web (current maker/SMB track) continues as the revenue + AI training data source.

## Consequences

### Positive
- Long-term moat: AI-first cloud-native CAD that legacy desktop incumbents cannot retrofit.
- Plugin pivot (deferred) still viable as marketing channel once Phase 2 ships.
- Shared backend (AI pipeline, prompts, auth, billing, cost tracking) amortizes dev cost across web + pro tracks.
- Owns the geometry kernel layer end-to-end (OCCT + planegcs) — no per-seat royalty.

### Negative
- 2-3 years (solo + AI) before Phase 1-4 complete; revenue impact null in that window.
- Solo dev means single point of failure (illness, motivation, burnout). Funding + cofounder by Year 1-2 is a Plan B that becomes a requirement.
- Sketch solver math (Phase 1) is genuinely hard; planegcs is the leveraged path — without it, +6-12 months to MVP.
- Each unshipped Phase is a market window competitors (Plasticity, Shapr3D, etc.) widen against us.

### Neutral
- ADR-010 (Wave 2 B-Full + collab) remains the architectural anchor for the web track; this ADR layers above it.
- Phase 6 AI features will surface in NexyFab web first (faster iteration), then port into Pro.

## Alternatives considered

- **Stay vertical only.** Rejected: ceiling is finite ($5-15M ARR plausible), no defensible moat against incumbents adding AI sidebars.
- **Plugin pivot only (Fusion/Onshape).** Rejected: forever dependent on host platform's API + app store. Founder wants own product control.
- **Fork FreeCAD.** Rejected: inherits desktop UX paradigm, dilutes AI-first differentiation, license complexity (LGPL on core but GPL on app shell).
- **Commercial kernel (Parasolid / D-Cubed).** Deferred: $500K/yr + revenue share inappropriate pre-funding. Re-evaluate at Series A.
- **Build sketch solver from scratch.** Rejected: 6-12 months solo before any geometry works. Use planegcs (LGPL, FreeCAD-proven, npm-ready) as the leveraged path.

## Rollout

- [x] **2026-06-01** — ADR accepted, roadmap doc + 10 tracking tasks (#99-108) created.
- [x] **2026-06-01** — Phase 1.1 done: `@salusoft89/planegcs` installed, WASM smoke test passing, LGPL NOTICE shipped (commit 2b28cc9a, target 2026-06-08).
- [x] **2026-06-01** — Phase 1.2 done: solver facade with 9 constraint types + DoF readout (commit 23cc5238, target 2026-06-22).
- [x] **2026-06-01** — Phase 1.3 done: SolverSketchEditor with live solver + DoF UX (commit 3f749185, target 2026-07-15).
- [x] **2026-06-01** — Phase 1.4 done: SketchPlane 2D-in-3D mapping (commit 54d9eb8a, target 2026-08-15).
- [x] **2026-06-01** — **Phase 1 acceptance PASSED**: 4-bar linkage 5/5 tests (commit 854fcc08, target 2026-09-15). planegcs bet validated.
- [ ] **2026-12-15** — Decision review: Phase 1 actual vs plan; commit to Phase 2 timeline or revise.
- [ ] **2027-06-01** — Year-1 decision review: solo viable, or seek seed + cofounder?

## Reversal

Reversible until Phase 2 begins. After Phase 2 (extensive parametric history + feature pipeline locked to the solver shape), reverting means losing user files saved under the Pro path.

Reversal options:
- **Pre-Phase 2:** Drop planegcs, keep current lite sketch + web track only. Loss: ~3 months of work + ADR-013 reputation.
- **Post-Phase 2:** Effectively unrecoverable. Pivot becomes "sell what we have" rather than rebuild.

Decision review gates (2026-09-15 and 2026-12-15) are the cheap exit points.

## References

- Code: `src/app/[lang]/shape-generator/sketch/` (current lite editor — to be rewritten in P1.3)
- Roadmap: `docs/roadmap/OWN_PRO_CAD.md`
- Strategy: `docs/strategy/DESIGN_PARTNER_OUTREACH_KIT.md` (web track validation, runs in parallel)
- ADR-010: B-Full + collab (web architecture anchor)
- External: [@salusoft89/planegcs (npm)](https://www.npmjs.com/package/@salusoft89/planegcs), [FreeCAD planegcs source](https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Sketcher/App/planegcs)
- Tasks: #99-108
