# Shell v3 Migration — Reality Survey (2026-05-27, W1 D1)

**Status:** survey snapshot · linked from [ADR-006](../adr/006-monolith-split-via-shell-v3-migration.md) addendum

The `_shell/MIGRATION.md` doc was last updated at Phase A.5 and uses
⬜/🟡/✅ status markers reflecting the doc author's intent. This file
captures what I actually found by reading the code on 2026-05-27 W1
D1 — the input to the revised per-Phase plan in W6.

## How I measured

For each pane component in `_shell/sidebars/`:
- Line count (size signal).
- `grep -c "TODO\|EmptyHint"` — count of stub markers.
- `grep -c "useShellBridge"` — count of integration points with the
  shared store Inner.tsx feeds.

Verdict tiers:
- 🟢 wired — bridge integrated, no/few TODO markers, real UI
- 🟡 partial — bridge present but multiple TODO sections
- 🔴 stub — no bridge use or many TODOs

## Per-pane snapshot

| Pane | Lines | TODO/Empty | Bridge | Verdict | Notes |
|---|---:|---:|---:|---|---|
| `ModelerLeftPane.tsx` | 133 | (Features wired, Bodies/Components empty stubs) | (verified earlier) | 🟡 partial | Features tab ✅ live; Bodies+Components empty stubs |
| `ModelerRightPane.tsx` | 397 | 6 | 7 | 🟡 partial | Substantial impl; 6 TODO sections remain |
| `SketchLeftPane.tsx` | 256 | 0 | 9 | 🟢 wired | Heavy bridge usage, no stubs |
| `SketchRightPane.tsx` | 124 | 8 | 6 | 🟡 partial | Bridge connected but most sections still stub |
| `AssemblyLeftPane.tsx` | 148 | 0 | 4 | 🟢 wired | Components/Mates/BOM tabs operational |
| `AssemblyRightPane.tsx` | 102 | 0 | 3 | 🟢 wired | MATES editor wired |
| `DrawingLeftPane.tsx` | 111 | 0 | 0 | 🔴 stub | No bridge integration; static layout only |
| `DrawingRightPane.tsx` | 182 | 5 | 0 | 🔴 stub | 5 TODO sections, no bridge |
| `RenderRightPane.tsx` | 231 | 7 | 0 | 🔴 stub | 7 TODO sections, no bridge |
| `CommentsPanel.tsx` | 237 | (separate component) | — | 🟢 wired | Wired through `ModelerRightPane` Comments tab |
| `AiChatPanel.tsx` | 422 | (separate component) | — | 🟢 wired | Wired through `ModelerRightPane` Nexy AI tab |
| `StandardPartsGrid.tsx` | 180 | — | — | 🟢 wired | Modeler Components fallback |

## Phase B-F status reality

| Phase | Doc legend | Actual code reality |
|---|---|---|
| **A — Shell chrome** | ✅ done | ✅ confirmed — ModelerShell wraps Inner with new TitleBar/Ribbon/StatusBar |
| **B — Modeler** | ⬜ pending | 🟡 **~60% done** — Features+AI+Comments wired; Bodies, Components, Inspector ANALYZE drawer, Material picker still need work |
| **C — Sketch** | ⬜ pending | 🟡 **~70% done** — left pane done; right pane (SketchRightPane) 8 TODOs |
| **D — Assembly** | ⬜ pending | 🟢 **~90% done** — Both panes wired with 0 TODO. Verify on actual usage |
| **E — Drawing** | ⬜ pending | 🔴 **~10% done** — both panes are static stubs with no bridge integration |
| **F — Render** | ⬜ pending | 🔴 **~15% done** — RenderRightPane is mostly TODO blocks |
| **G — Dead code removal** | ⬜ pending | ⬜ **0% done** — `body.sg-shell-v2` CSS hide pattern in place, but legacy LeftPanel.tsx (1655 lines) still rendered when shell-v2 is off |

## Real W6-8 scope (revised)

| Day | Task |
|---|---|
| W6 D1 (this survey) | ✅ done |
| W6 D2-3 | Promote shell-v2 from `?shell=v2` URL flag to **default ON** (env override for opt-out). Phase H baseline run on the 8 flows. |
| W6 D4-7 | Phase B finish — Bodies, Components, Inspector ANALYZE, Material picker. ~3-5 commits. |
| W7 D1-3 | Phase C finish — SketchRightPane 8 TODO sections. ~4 commits. |
| W7 D4-5 | Phase D verification — Assembly panes operational; run mate solver / interference / BOM smoke. 1 commit if regressions found, 0 commits if green. |
| W7 D6-7 + W8 D1-3 | **Phase E from near-zero** — Drawing panes are stubs. Bridge integration + SHEETS/VIEWS/LAYERS/GD&T/Title block. ~6-8 commits. (Biggest single work block.) |
| W8 D4-5 | **Phase F from near-zero** — RenderRightPane bridge + PBR sliders. ~3-4 commits. |
| W8 D6-7 | Phase G — Delete `LeftPanel.tsx` + `RightPanel.tsx` legacy paths. Bisect-safe deletion: hide first, delete after no Phase H regression for 24h. Final Inner.tsx target ≤ 5k lines (originally projected ≤ 2k but the per-mode page entries + cross-cutting state staying in Inner is unavoidable). |

## Confidence per phase

- **B/C** — 🟢 high. Bridge pattern proven by ModelerLeftPane Features. Remaining widgets are well-mapped in MIGRATION.md.
- **D** — 🟢 high. Already 0 TODO; verify rather than build.
- **E** — 🟡 medium. Drawing pane integration is from-scratch; Sheet/Layer state may not exist anywhere yet.
- **F** — 🟡 medium. PBR slider bridge is simpler than Drawing's state machine.
- **G** — 🔴 low. The legacy LeftPanel/RightPanel render paths are 1655 + (~similar?) lines; cross-cutting state hooks that only legacy reads may need extraction first.

## Open question for W6 D1+

The Phase H regression set in `MIGRATION.md` lists 8 flows. None have
a recorded "last pass" date. W6 D2 morning task: **run all 8 against
current main HEAD**. Record results in
`docs/postmortem/phase-h-baseline-2026-w6.md`.

If any flow already fails on main (pre-existing), Phase B/C/D/E/F
work must NOT make those flows newly fail beyond baseline. Don't try
to fix pre-existing failures inside W6-8 scope.

## References

- Doc: `src/app/[lang]/shape-generator/_shell/MIGRATION.md`
- Code: `src/app/[lang]/shape-generator/_shell/sidebars/` (all 17 pane components)
- Code: `src/app/[lang]/shape-generator/_shell/ModelerShell.tsx`
- ADR-006 + addendum
