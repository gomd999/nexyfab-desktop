# Shell v3 Sidebar Migration — Mount-Point Inventory

**Purpose**: every distinctive feature in the existing `LeftPanel.tsx` / `RightPanel.tsx` /
viewport-modal stack has an explicit new home in the v3 sidebars. If a feature
is missing from this table, work stops until it is mapped.

**Status legend**: ✅ done · 🟡 in-progress · ⬜ pending · 🚫 deprecated

---

## Left-side widgets

| Current widget | Current location | New location (shell v3) | Status | Notes |
|---|---|---|---|---|
| FeatureTree | LeftPanel top section | `ModelerLeftPane` → `Features` tab | ⬜ Phase B | Direct port via `Tree` |
| Bodies list | LeftPanel | `ModelerLeftPane` → `Bodies` tab | ⬜ Phase B | New tab |
| Components list (assembly) | AssemblyBrowser (floats) | `AssemblyLeftPane` → `Components` tab | ⬜ Phase D | Modal → docked panel |
| Mates list | AssemblyBrowser | `AssemblyLeftPane` → `Mates` tab | ⬜ Phase D | |
| BOM table | AssemblyBrowser | `AssemblyLeftPane` → `BOM` tab + Right pane | ⬜ Phase D | Two surfaces — quick view (left) + full table (right) |
| SketchHistoryPanel | LeftPanel (sketch mode) | `SketchLeftPane` → bottom history accordion | ⬜ Phase C | |
| UserPartsPanel | LeftPanel modal | `ModelerLeftPane` → `Components` tab (Part Library link) | ⬜ Phase B | Modal stays for full grid |
| Sketch entities/constraints/dimensions | Inner sketch state | `SketchLeftPane` 3 sections | ⬜ Phase C | Read from sketch store |
| Sheet list | DrawingFrame `sheetIds` | `DrawingLeftPane` → SHEETS section | ⬜ Phase E | Already partial |
| Views on sheet | DrawingFrame static | `DrawingLeftPane` → VIEWS section | ⬜ Phase E | Per-sheet layout |
| Layers list | (none) | `DrawingLeftPane` → LAYERS section | ⬜ Phase E | New |
| Material library grid | `MaterialLibraryPane` (RenderFrame) | unchanged | ✅ done | Stays in Render mode |

## Right-side widgets

| Current widget | Current location | New location (shell v3) | Status | Notes |
|---|---|---|---|---|
| Inspector (PropertyManager) | floating in viewport | `ModelerRightPane` → `Inspector` tab | ⬜ Phase B | Mockup uses GEOMETRY/EDGES/APPEARANCE/PARAMETERS sections |
| AI Assistant | RightPanel `ai` tab | `ModelerRightPane` → `Nexy AI` tab | ⬜ Phase B | Direct port |
| Comments / collab | RightPanel `collab` tab | `ModelerRightPane` → `Comments` tab | ⬜ Phase B | |
| DFM panel | RightPanel `dfm` tab | Inspector → ANALYZE → drawer | ⬜ Phase B | Bottom drawer holds full panel |
| FEA panel | RightPanel `fea` tab | Inspector → ANALYZE → drawer | ⬜ Phase B | |
| Cost estimator | RightPanel `cost` tab | Inspector → ANALYZE → drawer | ⬜ Phase B | |
| Mass props | floating BL readout | unchanged (viewport overlay) | ✅ done | Mockup also puts it there |
| Material picker | floating modal | Inspector → APPEARANCE → Material chip popover | ⬜ Phase B | |
| Material properties panel | RenderFrame right (existing) | `RenderRightPane` (re-skin) | ⬜ Phase F | |
| Render PBR sliders | RenderFrame right (existing) | `RenderRightPane` (re-skin) | ⬜ Phase F | |
| Sketch property manager | floating | `SketchRightPane` (ACTIVE SELECTION / CONSTRAINTS / PARAMETERS / SOLVER) | ⬜ Phase C | |
| Assembly mates editor | AssemblyBrowser right | `AssemblyRightPane` MATES section | ⬜ Phase D | |
| View properties (drawing) | `DrawingPropsPane` | `DrawingRightPane` (re-skin) | ⬜ Phase E | |
| GD&T tools | `DrawingPropsPane` | `DrawingRightPane` GD&T section | ⬜ Phase E | |
| Title block fields | `DrawingPropsPane` | `DrawingRightPane` TITLE BLOCK section | ⬜ Phase E | |

## Bottom drawer (new surface)

| Widget | Trigger | Status | Notes |
|---|---|---|---|
| DFM full panel | Inspector → ANALYZE → "DFM check" row | ⬜ Phase B | |
| FEA full panel | Inspector → ANALYZE → "FEA — static" row | ⬜ Phase B | |
| Cost estimator | Inspector → ANALYZE → "Cost" row | ⬜ Phase B | |
| Design variants | Inspector → ANALYZE → "Variants" row OR F4 | ⬜ Phase B | |

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
| Project access read-only chip | TitleBar (new) | ⬜ Phase B | Added |
| FPS counter | Viewport TR readout | ✅ unchanged |
| Snap indicators | StatusBar right | ✅ unchanged |
| Selection summary | StatusBar right | ✅ unchanged |

---

## Regression test surface (Phase H)

The following 8 user flows MUST still work after Phase F. Failing any one
blocks the commit.

1. **Autosave recovery**: kill the tab during edit → reload → banner appears → restore → scene intact.
2. **Pro freemium gate (2nd project)**: create project 1 → save → start new design → gate modal appears (not silent).
3. **CRDT multi-cursor**: open same project in 2 tabs → drag cursor → other tab shows ghost cursor.
4. **Demo mode**: from landing CTA → enter demo → make a part → click sign-up → demo session migrates.
5. **Cloud save conflict**: edit in tab A → edit in tab B → tab A receives 409 → reload banner appears.
6. **Photoreal 1-use**: free user clicks "Final Render" → gate modal → upgrade flow.
7. **Project thumbnail**: save project → dashboard shows real-render thumbnail (not placeholder).
8. **Collab presence avatars**: 3 users open same project → 3 avatars in titlebar → leave → drop to 2.

---

_Last updated: Phase A.5_
