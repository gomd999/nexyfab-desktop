# Shell v3 Sidebar Migration — Mount-Point Inventory

**Purpose**: every distinctive feature in the existing `LeftPanel.tsx` / `RightPanel.tsx` /
viewport-modal stack has an explicit new home in the v3 sidebars. If a feature
is missing from this table, work stops until it is mapped.

**Status legend**: ✅ done · 🟡 partial / mockup data · ⬜ pending · 🚫 deprecated

**Wiring pattern**: see [ADR-008](../../../docs/adr/008-shell-v3-migration-patterns.md)
for the four patterns (Bridge / Direct read / Event-only / Local + event)
each row uses.

---

## Left-side widgets

| Current widget | Current location | New location (shell v3) | Status | Pattern | Notes |
|---|---|---|---|---|---|
| FeatureTree | LeftPanel top section | `ModelerLeftPane` → `Features` tab | ✅ Phase B | Bridge | `featureItems` published from Inner |
| Bodies list | LeftPanel | `ModelerLeftPane` → `Bodies` tab | ✅ Phase B | Bridge | commit 8265b64 — color swatch + visibility toggle |
| Components list (assembly) | AssemblyBrowser (floats) | `AssemblyLeftPane` → `Components` tab | ✅ Phase D | Bridge | `assemblyItems` published; falls back to DEFAULT_TREE placeholder when empty |
| Mates list (assembly) | AssemblyBrowser | `AssemblyLeftPane` → `Mates` tab | 🟡 Phase D | — | Still rendering MATE_PLACEHOLDERS hardcoded strings; Wave 2 polish |
| BOM table | AssemblyBrowser | `AssemblyLeftPane` → `BOM` tab + Right pane | ✅ Phase D | Bridge | Two surfaces — quick (left) + full (right) both read `assemblyItems` |
| SketchHistoryPanel | LeftPanel (sketch mode) | `SketchLeftPane` → bottom history accordion | ✅ Phase C | Bridge | wired via `sketchSnapshot` (pre-W6) |
| UserPartsPanel | LeftPanel modal | `ModelerLeftPane` → `Components` tab inline + Manage modal | ✅ Phase B | Direct read | commit 2d8ced8 — `UserPartsSection` reads `localStorage` + `storage` event |
| Sketch entities/constraints/dimensions | Inner sketch state | `SketchLeftPane` 3 sections | ✅ Phase C | Bridge | `sketchEntityList` / `sketchConstraintList` / `sketchDimensionList` |
| Sheet list | DrawingFrame `sheetIds` | `DrawingLeftPane` → SHEETS section | ✅ Phase E | Props | Direct prop drilling from DrawingFrame |
| Views on sheet | DrawingFrame static | `DrawingLeftPane` → VIEWS section | ✅ Phase E | Static | Per-sheet layout via `viewsForLayout()` |
| Layers list | (none) | `DrawingLeftPane` → LAYERS section | 🟡 Phase E | Static | 5 hardcoded layers (Visible/Hidden/Center/Dim/Construction); real layer mgmt = Wave 2 |
| Material library grid | `MaterialLibraryPane` (RenderFrame) | unchanged | ✅ done | — | Stays in Render mode |

## Right-side widgets

| Current widget | Current location | New location (shell v3) | Status | Pattern | Notes |
|---|---|---|---|---|---|
| Inspector (PropertyManager) | floating in viewport | `ModelerRightPane` → `Inspector` tab | ✅ Phase B | Bridge | GEOMETRY/EDGES/APPEARANCE/PARAMETERS/ANALYZE sections live; PARAMETERS dispatches `nexyfab:update-feature-param` |
| AI Assistant | RightPanel `ai` tab | `ModelerRightPane` → `Nexy AI` tab | ✅ Phase B | — | `AiChatPanel` 422 lines pre-W6 |
| Comments / collab | RightPanel `collab` tab | `ModelerRightPane` → `Comments` tab | ✅ Phase B | — | `CommentsPanel` 237 lines pre-W6 |
| DFM panel | RightPanel `dfm` tab | Inspector → ANALYZE → drawer | ✅ Phase B | Event-only | `nexyfab:analyze-open` { drawer: 'dfm' } |
| FEA panel | RightPanel `fea` tab | Inspector → ANALYZE → drawer | ✅ Phase B | Event-only | { drawer: 'fea' } |
| Cost estimator | RightPanel `cost` tab | Inspector → ANALYZE → drawer | ✅ Phase B | Event-only | { drawer: 'cost' } |
| Mass props | floating BL readout | unchanged (viewport overlay) | ✅ done | — | |
| Material picker | floating modal | Inspector → APPEARANCE → Material chip popover | ✅ Phase B | Bridge | commit fe791f4 — `materialId` published; MATERIAL_PRESETS grid |
| Material properties panel | RenderFrame right (existing) | `RenderRightPane` (re-skin) | ✅ Phase F | Props | re-skinned pre-W6 |
| Render PBR sliders | RenderFrame right (existing) | `RenderRightPane` (re-skin) | ✅ Phase F | Local + event | commit 08d1140 — 7 knobs use `nexyfab:set-render` for future renderer wiring |
| Sketch property manager | floating | `SketchRightPane` (ACTIVE SELECTION / CONSTRAINTS / PARAMETERS / SOLVER) | ✅ Phase C | Local + event + Bridge | commit 276daf3 — 8 knobs `nexyfab:set-sketch`; SOLVER readouts bridge-read |
| Assembly mates editor | AssemblyBrowser right | `AssemblyRightPane` MATES section | ✅ Phase D | Bridge | commit 9c78022 — `assemblyMatesList` published; 10 mate types |
| View properties (drawing) | `DrawingPropsPane` | `DrawingRightPane` (re-skin) | ✅ Phase E | Local + event | commit 050d0ad — projection/scale/style/tangent |
| GD&T tools | `DrawingPropsPane` | `DrawingRightPane` GD&T section | 🟡 Phase E | — | FCF boxes still mockup data; real gdtStore = Wave 2/3 |
| Title block fields | `DrawingPropsPane` | `DrawingRightPane` TITLE BLOCK section | ✅ Phase E | Local + event | commit 050d0ad — controlled inputs |

## Bottom drawer

| Widget | Trigger | Status | Pattern | Notes |
|---|---|---|---|---|
| DFM full panel | Inspector ANALYZE row | ✅ Phase B | Event-only | wired pre-W6 |
| FEA full panel | Inspector ANALYZE row | ✅ Phase B | Event-only | wired pre-W6 |
| Cost estimator | Inspector ANALYZE row | ✅ Phase B | Event-only | wired pre-W6 |
| Design variants | Inspector ANALYZE row OR F4 | ✅ Phase B | Event-only | wired pre-W6 |
| Motion study | Inspector ANALYZE Motion row | ✅ Phase B | Event-only | `MotionStudyPanel` |
| Versions | drawer Versions tab | ✅ Phase B | Event-only | `VersionTreePanel` |

## Modals / floats (unchanged)

| Widget | Location | Status |
|---|---|---|
| ConfigurationTable | Modal (F5) | ✅ unchanged |
| CommandPalette | Modal (⌘K) | ✅ unchanged |
| ViewCube | Viewport overlay | ✅ unchanged |
| Display mode toolbar | Viewport top | ✅ unchanged |
| Section view controls | Viewport top | ✅ unchanged |
| Autosave recovery banner | Viewport center | ✅ unchanged |
| Freemium gate prompt | Modal | ✅ unchanged |
| Toast notifications | Top-right | ✅ unchanged |

## Status bar / title bar (unchanged surfaces — content may grow)

| Widget | Location | Status |
|---|---|---|
| Autosave indicator | StatusBar left | ✅ unchanged |
| Collab presence avatars | TitleBar right | ✅ unchanged |
| Cloud sync status | StatusBar left | ✅ unchanged |
| Project access read-only chip | TitleBar (new) | ⬜ Phase G or polish | Mockup'd but not wired |
| FPS counter | Viewport TR readout | ✅ unchanged |
| Snap indicators | StatusBar right | ✅ unchanged |
| Selection summary | StatusBar right | ✅ unchanged |

---

## Regression test surface (Phase H)

The following 8 user flows MUST still work after Phase G. Run all 8 against
current `main` BEFORE any Phase G dead-code deletion to establish baseline;
re-run after every Phase G commit. See
[Phase G runbook](../../../../docs/process/phase-g-runbook.md).

1. **Autosave recovery**: kill the tab during edit → reload → banner appears → restore → scene intact.
2. **Pro freemium gate (2nd project)**: create project 1 → save → start new design → gate modal appears (not silent).
3. **CRDT multi-cursor**: open same project in 2 tabs → drag cursor → other tab shows ghost cursor (requires `NEXT_PUBLIC_NEXYFAB_CRDT=1`).
4. **Demo mode**: from landing CTA → enter demo → make a part → click sign-up → demo session migrates.
5. **Cloud save conflict**: edit in tab A → edit in tab B → tab A receives 409 → reload banner appears.
6. **Photoreal 1-use**: free user clicks "Final Render" → gate modal → upgrade flow.
7. **Project thumbnail**: save project → dashboard shows real-render thumbnail (not placeholder).
8. **Collab presence avatars**: 3 users open same project → 3 avatars in titlebar → leave → drop to 2.

---

_Last updated: 2026-05-27 (Phase F closure)_
