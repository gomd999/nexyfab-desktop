# ADR-014 — OCCT kernel promotion (own pro-CAD geometry source of truth)

**Status:** accepted · **Date:** 2026-06-04 · **Builds on:** [ADR-013](013-own-pro-cad-track.md)

## Context

Today geometry has two sources of truth that have drifted apart:

- **SCAD-text path (primary):** every feature serialises to OpenSCAD; rendered
  to a mesh by the openscad worker. This is what users see. It cannot give
  exact B-rep, stable topology, real fillets/shells/drafts, or a real STEP
  round-trip.
- **Pure-TS geometry (interim):** `lib/cad/featureMesh` (extrude/revolve/sweep/
  loft → polyhedron) + `lib/drawing/projectView` (orthographic HLR) now give
  real drawings for prismatic + faceted-round parts. Good enough to ship
  drawings; **not** a kernel.
- **OCCT (scaffolded, inert):** `lib/occt/bridge.ts` defines `OcctBridge`;
  `wasmBridge.ts` is the real worker-backed client (init handshake + reqId RPC)
  and the worker boots `opencascade.wasm`. But the operations return **synthetic
  bboxes** — no real BREP is produced or consumed.

The deferred features (draft, variable/asymmetric fillet, precise 3D boolean,
exact STEP/IGES, exact HLR with true silhouettes/arcs) all require a real
kernel. OCCT is that kernel; the client + worker already exist.

## Decision

Promote **OCCT to the geometric source of truth**, incrementally, behind the
existing `OcctBridge` interface. The SCAD path is retained as a fast preview +
fallback during the transition (dual-path), not removed.

The translation from the feature tree to kernel operations is a **pure,
testable IR** (`featureTreeToOcctPlan` → an ordered `OcctCommand[]`) so the
hard execution (WASM) and the deterministic planning are decoupled: the plan is
unit-tested without the 65 MB wasm; the worker executes it.

## Phases + acceptance gates

| Phase | Deliverable | Gate |
|---|---|---|
| **K0** | Typed RPC client + worker boots (DONE: `wasmBridge`, real worker) | handshake `mode:ready` in a browser/headless probe |
| **K1a** | `featureTreeToOcctPlan` — feature tree → ordered `OcctCommand[]` (extrude/revolve/boolean/fillet/chamfer), dependency-resolved, unsupported kinds flagged. **Pure-TS, testable.** | plan matches expected command sequence for a known tree (this commit) |
| **K1b** | Plan executor — run a plan through `OcctBridge`, threading result handles; real BREP from the worker | a box−cylinder difference yields a real solid with a hole (volume < box) |
| **K2** | **Stable edge/face IDs** (topological naming) across rebuilds | re-fillet after an upstream param edit keeps the same edge selection |
| **K3** | Real fillet / chamfer / shell / draft (+ variable/asymmetric) via OCCT | fillet on a real edge changes volume + survives K2 rebuild |
| **K4** | Real STEP read/write via OCCT (replaces pure-TS axis-aligned) | round-trip a non-axis-aligned solid byte-stably |
| **K5** | Drawing HLR via OCCT `HLRBRep_Algo` (exact silhouettes/arcs; replaces facet projectView) | a cylinder front view = 2 silhouette lines + true circles, not facets |
| **K6** | OCCT tessellation → 3D viewer | viewer renders the kernel solid, not the SCAD mesh |

Critical path: K1a → K1b → **K2** (the hard CAD problem) → K3/K4/K5/K6.

## Consequences

- Dual-path means a feature is valid only if BOTH paths agree (a parity gate);
  divergence is a bug surfaced in CI.
- K2 (topological naming) is the genuine risk; without it, every downstream
  selection (fillet edges, mate refs, drawing dims) breaks on rebuild.
- WASM in CI: the plan layer (K1a) is wasm-free; K1b+ need a headless harness
  for the worker (separate infra task).

## Non-goals

Not removing the SCAD path; not a from-scratch kernel; not Parasolid/ACIS.
