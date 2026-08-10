# NexyFab Pro — Full Detailed Feature Spec (SolidWorks / Fusion 360 Parity)

**Purpose:** Comprehensive line-by-line implementation checklist. Every parameter, sub-option, UX detail, edge case, keyboard shortcut. This is the canonical engineering reference; the [high-level spec](./SW_FUSION_FEATURE_SPEC.md) is the executive summary.

**Reading guide:**
- Each section opens with **Why it matters** + **Hard parts**.
- Tables list features with: **SW** (✓ / ~ / —), **F** (Fusion), **NexyFab Pro target**, **Implementation notes** (kernel calls, algorithms, UI shape).
- Status legend: ✅ shipped · 🔧 partial · ⏳ planned · ⚪ deferred · ❌ out of scope.
- Sub-options that branch significantly get their own sub-tables.

**Total scope:** ~1200 atomic features across 17 areas. Implementation effort estimate: 50 person-years (conservative) to 100 person-years (with kernel + ecosystem).

---

# 1 · Sketching (2D)

**Why it matters:** every solid feature starts from a sketch. Engineers spend 30-40% of modeling time here. A bad sketch UX is a deal-breaker — SW's #1 strength.

**Hard parts:**
- Constraint solver numerical stability under user-dragged drift
- Auto-constraint inference without false positives (annoying when wrong)
- Snap detection at 60fps with 100+ entities
- Multi-profile sketch (multiple closed loops in one sketch)
- B-spline editing UX (control points vs interpolation points)

## 1.1 Sketch session lifecycle

| Capability | Detail | NexyFab target | Notes |
|---|---|---|---|
| Enter sketch | Click "Sketch" → pick plane/face → editor opens | ⏳ | Hot-key `S` |
| Exit sketch | Save+exit / cancel+exit / hide-only | ⏳ | `Esc` cancels with prompt if dirty |
| Edit existing sketch | Double-click in feature tree | ⏳ | re-opens with last view + tool state |
| Sketch in context (assembly) | Sketch on top-level assembly part, with reference geom from other parts | ⏳ year 3 | needs reference geometry propagation |
| Suppress sketch | Hide + skip downstream feature recompute | ✅ via Phase 2.6 `set_suppressed` | shipped (IR) |
| Sketch derived (copy from another sketch) | Linked: source changes propagate | ⏳ year 3 | |
| Block (encapsulated sketch sub-region, reusable) | Like a sketch component | ⚪ year 4 | |
| Multi-body sketch (multiple closed loops, each → separate body) | Engineer wants 2 holes from one sketch | ⏳ year 2 | |
| Sketch group (organize entities) | Folder-like | ⚪ deferred | |

## 1.2 Sketch entities (deep)

### 1.2.1 Point
| Variant | Detail | NexyFab target |
|---|---|---|
| Free point | Anywhere in sketch | ✅ via `SketchSolver.addPoint` |
| Intersection point | At intersection of two entities | ⏳ year 2 |
| Midpoint marker | Auto on every line at midpoint | ⏳ year 2 |
| Centerpoint | On circle/arc center (auto + selectable) | ⏳ year 2 |
| Fixed point (red color) | Pinned coords | ✅ `fixed: true` |
| Driven point (from formula) | Position from equation | ⏳ year 3 |

### 1.2.2 Line
| Variant | Sub-options | NexyFab target |
|---|---|---|
| 2-point line | Click-click | ✅ |
| Continuous line (polyline mode) | Hold to keep adding segments | ⏳ year 2 |
| Construction line | Same as line, dashed display, doesn't form profile | ⏳ year 2 (toggle on existing line) |
| Centerline | Construction line + symmetric snapping | ⏳ year 2 |
| Infinite line | For mirror/reference (rare) | ⚪ year 3 |
| Tangent line (from external point to curve) | Click point, click curve | ⏳ year 3 |
| Perpendicular line (drop from point) | Auto-perpendicular to chosen edge | ⏳ year 3 |

### 1.2.3 Circle / Arc
| Variant | Sub-options | NexyFab target |
|---|---|---|
| Circle by center + radius | Click + drag | ✅ |
| Circle by 3 points | Three click points | ⏳ year 2 |
| Circle tangent-tangent-radius | Pick two tangent entities, type radius | ⏳ year 2 |
| Circle by diameter (2 points) | endpoints | ⏳ year 2 |
| Arc by center + start + end | 3 clicks | 🔧 IR done; UI ⏳ |
| Arc by 3 points (start + end + on-arc) | 3 clicks | ⏳ year 2 |
| Tangent arc (continuation from line) | Auto in continuous-line mode | ⏳ year 3 |
| Conic arc | Parabola/hyperbola/ellipse arc | ⚪ year 4 |
| Slot — straight | 3 clicks (line+arc-cap+arc-cap) | ⏳ year 2 |
| Slot — center-line | Center axis + 2 end markers | ⏳ year 2 |
| Slot — 3-point arc | Curved slot | ⏳ year 3 |
| Slot — center-point arc | With center | ⏳ year 3 |

### 1.2.4 Rectangle / Polygon
| Variant | Detail | NexyFab target |
|---|---|---|
| Rectangle by 2 corners | Click-click diagonal | ✅ |
| Rectangle by center + corner | Center, then corner | ⏳ year 2 |
| 3-point rectangle (corner + side + height) | Allows rotation | ⏳ year 3 |
| 3-point center rectangle | Center, axis, height | ⏳ year 3 |
| Parallelogram | 3 corners | ⚪ year 4 |
| Regular polygon (n-sided) | Center + corner OR center + radius | ⏳ year 2 |
| Inscribed (vertex on circle) | Polygon mode option | ⏳ year 2 |
| Circumscribed (edge on circle) | Polygon mode option | ⏳ year 2 |

### 1.2.5 Spline / Bézier
| Variant | Detail | NexyFab target | Notes |
|---|---|---|---|
| B-spline through points | Click sequence, smooth fit | ⏳ year 3 | planegcs B-spline support WIP upstream |
| Bézier (control polygon edit) | 4-point cubic | ⏳ year 3 | |
| Add / remove fit point | Right-click on spline | ⏳ year 3 | |
| Add tangent vector at point | Drag handle | ⏳ year 3 | |
| Close spline | Auto join end to start | ⏳ year 3 | |
| Spline tension / handle weight | Slider | ⚪ year 4 | |
| Smooth (G2 continuity at endpoints) | Right-click → smooth | ⚪ year 4 | |
| Convert sketch line + arc → spline | Right-click → convert | ⚪ year 5 | |

### 1.2.6 Ellipse
| Variant | Detail | NexyFab target |
|---|---|---|
| Ellipse center + major + minor | 3 clicks | ⏳ year 3 |
| Elliptical arc | Ellipse + start/end angles | ⏳ year 4 |
| Conic (parabola/hyperbola fit) | 3 clicks + rho parameter | ⚪ year 4 |

### 1.2.7 Text
| Variant | Detail | NexyFab target |
|---|---|---|
| Sketch text (linear) | Single-line on horizontal axis | ⏳ year 3 |
| Text on path (follow curve) | Pick curve, text wraps | ⏳ year 4 |
| Font selection | System fonts + uploaded TTF | ⏳ year 3 |
| Bold / italic / underline | Per-text | ⏳ year 3 |
| Letter spacing / kerning | Slider | ⚪ year 4 |
| Convert text → sketch outline | For extrude/engrave | ⏳ year 3 (key for engraving) |

### 1.2.8 Other
| Entity | Detail | NexyFab target |
|---|---|---|
| Sketch picture (background image) | Import, position, scale, calibrate | ⏳ year 3 |
| Photo trace tool (auto-outline) | edge-detect → vector | 🔧 partial via image-to-intent |
| Center mark (on circle) | Cross marker | ⏳ year 2 (drawing-adjacent feature) |
| Hole symbol / centerline | Drawing-only | (covered in §8) |

## 1.3 Sketch constraints (geometric) — deep

| Constraint | DoF removed | Picks | NexyFab target | Implementation |
|---|---|---|---|---|
| Coincident (point-point) | 2 | 2 points | ✅ | `p2p_coincident` |
| Coincident (point on line) | 1 | point + line | ⏳ year 2 | `point_on_line_pl` |
| Coincident (point on curve generic) | 1 | point + arc/circle/spline | ⏳ year 2 | `point_on_arc`, `point_on_circle`, `point_on_bspline` |
| Horizontal (line) | 1 | 1 line | ✅ | `horizontal_l` |
| Horizontal (2 points) | 1 | 2 points | ⏳ year 2 | `horizontal_pp` |
| Vertical (line) | 1 | 1 line | ✅ | `vertical_l` |
| Vertical (2 points) | 1 | 2 points | ⏳ year 2 | `vertical_pp` |
| Parallel | 1 | 2 lines | ✅ | `parallel` |
| Perpendicular (line-line) | 1 | 2 lines | ✅ | `perpendicular_ll` |
| Perpendicular (4 points: 2 segments) | 1 | 4 points | ⏳ year 2 | `perpendicular_pppp` |
| Tangent (line-circle) | 1 | line + circle | ✅ | `tangent_lc` |
| Tangent (line-arc) | 1 | line + arc | ✅ | `tangent_la` |
| Tangent (circle-circle) | 1 | 2 circles | ✅ | `tangent_cc` |
| Tangent (circle-arc, arc-arc) | 1 | mixed | ⏳ year 2 | `tangent_ca`, `tangent_aa` |
| Tangent (spline-anything) | 1 | spline + other | ⏳ year 3 | `tangent_at_bspline_knot` |
| Equal length (lines) | 1 | 2 lines | ⏳ year 2 | `equal_length` |
| Equal radius (2 circles / arcs) | 1 | 2 | ⏳ year 2 | `equal_radius_cc`, `equal_radius_aa`, `equal_radius_ca` |
| Equal focus (ellipses / hyperbolas) | 1 | 2 | ⚪ year 4 | `equal_focus` |
| Concentric (circles / arcs) | 2 | 2 | ⏳ year 2 | implicit via `p2p_coincident` on centers |
| Midpoint (point at midpoint of line) | 2 | point + line | ⏳ year 2 | `midpoint_on_line_pppp` |
| Symmetric (2 points about line) | 2 | 2 points + line | ⏳ year 2 | `point_on_perp_bisector_pl` + dist |
| Fix point | 2 | 1 point | ✅ | `fixed: true` |
| Fix entity (line/circle locked in place) | depends | 1 | ⏳ year 2 | all underlying points fixed |
| Coincident chain (multiple at once) | n | n points | ⏳ year 2 | UX: select all, then constrain |
| Smooth (G2 spline continuity) | 1 | spline endpoint + curve | ⚪ year 4 | |

## 1.4 Sketch dimensions — deep

| Dimension | Picks | Sub-options | NexyFab target | Implementation |
|---|---|---|---|---|
| Linear distance (point-point) | 2 points | horizontal / vertical / aligned (along line through them) | ✅ aligned only | `p2p_distance` |
| Linear horizontal (project to X) | 2 points | | ⏳ year 2 | `coordinate_x` delta |
| Linear vertical (project to Y) | 2 points | | ⏳ year 2 | `coordinate_y` delta |
| Point-to-line distance | point + line | perpendicular distance | ⏳ year 2 (driving only) | `p2l_distance` |
| Line-to-line distance (parallel) | 2 parallel lines | | ⏳ year 2 | |
| Radius | 1 circle/arc | | ✅ | `circle_radius`, `arc_radius` |
| Diameter | 1 circle | display with ⌀ prefix | ⏳ year 2 (driving only) | `circle_diameter` |
| Angular (3 points) | 3 points | reflex angle option | ⏳ year 2 | `angle_via_three_points` |
| Angular (2 lines) | 2 lines | which interior angle (4 options) | 🔧 IR; UI ⏳ | `l2l_angle_ll` |
| Angular (1 line + axis) | 1 line + H or V axis | | ⏳ year 2 | |
| Arc length | 1 arc | | ⚪ deferred (planegcs warns) | `arc_length` |
| Ordinate (baseline + secondary) | baseline + each point | chain mode for multiple | ⏳ year 2 | UX-driven: series of `coord` dims |
| Chain / baseline (auto-arrange) | sequence | linear chain | ⏳ year 2 | |
| Symmetric dimension (overall + symmetric about line) | 2 points + sym line | | ⏳ year 3 | |
| Equation-driven dimension | Use variable name `=2*L` | | ⏳ year 3 | parser + variable manager |
| Linked dimension (variable across files) | Configurations | | ⏳ year 3 | (covered in §2.6) |
| Driving vs driven | Toggle per dimension | driven = solver evaluates, doesn't constrain | ⏳ year 2 | flag on Constraint IR |
| Tolerance display (per dim) | Bilateral/limit/ISO | only affects display | ⏳ year 3 | (drawing-side concern) |

## 1.5 Sketch tools — deep

### 1.5.1 Modification
| Tool | Picks | Sub-options | NexyFab target | Algorithm |
|---|---|---|---|---|
| Trim entity | click on segment to remove | trim to next intersection / trim to selection | ⏳ year 2 | find intersections, split entity, delete picked part |
| Trim (power trim, drag across) | mouse path crosses entities | erases each crossed | ⏳ year 3 | |
| Extend | click on entity | to next intersection / to selection | ⏳ year 2 | reverse of trim |
| Offset | pick entity + distance | direction, both-sides, chain selection | ⏳ year 2 | offset polylines + arcs |
| Offset (multi-entity chain) | pick contour | maintain connectivity | ⏳ year 3 | |
| Fillet (corner) | 2 entities meeting at point | radius, trim option | ⏳ year 2 | replace corner with tangent arc |
| Chamfer (corner) | 2 entities | distance-distance / distance-angle | ⏳ year 2 | replace corner with line |
| Mirror | entities + mirror line | keep original / move only | ⏳ year 2 | reflect coords |
| Linear pattern (1D) | entities + direction + spacing + count | x and y | ⏳ year 2 | array of copies |
| Linear pattern (2D grid) | + 2nd dir/spacing/count | | ⏳ year 2 | |
| Circular pattern | entities + center + total angle + count | full / partial | ⏳ year 2 | rotate copies |
| Path pattern (along curve) | entities + path + count | tangent rotation | ⏳ year 3 | |
| Move (entities) | offset / 2-point | copy option | ⏳ year 2 | |
| Rotate (entities) | center + angle | copy option | ⏳ year 2 | |
| Scale (entities) | factor + center | uniform / non-uniform | ⏳ year 3 | |
| Stretch (move endpoint, propagate) | drag endpoint | | ⏳ year 3 | |
| Split entity | pick + click point | divide at click | ⏳ year 2 | |
| Combine / join (connect 2 endpoints) | pick + pick | | ⏳ year 3 | |
| Convert to construction | toggle | per-entity | ⏳ year 2 | |
| Convert construction → real | toggle | | ⏳ year 2 | |
| Delete | selected entities | with constraint cleanup | ⏳ year 2 | cascade delete dangling constraints |
| Delete + replace (smart) | delete entity but keep connected | rebuild constraints to ghost | ⚪ year 4 | |

### 1.5.2 Reference / projection
| Tool | Detail | NexyFab target |
|---|---|---|
| Convert entities (project edge into sketch) | pick 3D edge, projects to sketch plane | ⏳ year 2 |
| Convert (linked, follows source) | project + link option | ⏳ year 2 |
| Intersection curve | sketch plane × selected face → curve | ⚪ year 3 |
| Project on surface | sketch curve → onto 3D surface | ⚪ year 3 |
| Use 3D sketch in 2D | reference 3D points/lines | ⚪ year 4 |

### 1.5.3 Snap / inference
| Snap target | Trigger | NexyFab target | Notes |
|---|---|---|---|
| Grid | grid divisions visible | ⏳ year 2 | toggle on/off |
| Endpoint | hover entity end | ⏳ year 2 | crosshair marker |
| Midpoint | hover entity middle | ⏳ year 2 | |
| Center (circle/arc) | hover center | ⏳ year 2 | |
| Quadrant (circle quarter points) | hover at 0/90/180/270 | ⏳ year 2 | |
| Tangent (when drawing line to curve) | dynamic detection | ⏳ year 3 | |
| Perpendicular | dynamic | ⏳ year 3 | |
| Parallel | dynamic | ⏳ year 3 | |
| Intersection | hover intersection | ⏳ year 2 | |
| On entity (anywhere along) | hover entity body | ⏳ year 2 | |
| Horizontal/vertical from existing point | dashed line trace | ⏳ year 3 | |
| Snap precision (settings) | tolerance px | ⏳ year 2 | |
| Disable snap (Alt-hold) | momentary off | ⏳ year 2 | |

### 1.5.4 Auto-constraint inference
| Behavior | Detail | NexyFab target |
|---|---|---|
| Infer horizontal/vertical at draw time | within snap tolerance | ⏳ year 2 (existing `autoConstraintInference.ts`) |
| Infer perpendicular when 90° | dynamic indicator | ⏳ year 2 |
| Infer tangent on curve approach | when line endpoint hits circle | ⏳ year 3 |
| Infer equal length when matching | within 5% | ⏳ year 3 |
| Infer concentric when stacking circles | center within snap | ⏳ year 3 |
| Suppress inference (Shift-hold) | momentary off | ⏳ year 2 |
| Inference confidence threshold (settings) | sensitivity slider | ⚪ year 3 |

## 1.6 Sketch status / diagnostics

| Indicator | Detail | NexyFab target |
|---|---|---|
| DoF readout | count of remaining DoF | ✅ via planegcs.dof |
| Constraint coloring | green=satisfied / red=conflict / yellow=redundant | ⏳ year 2 |
| "Fully constrained" badge | when DoF=0 | ✅ via DoF panel state |
| Over-constrained warning | with list of conflicting constraints | 🔧 via SolveResult.conflicting |
| Redundant constraint hint | suggest removing | 🔧 via SolveResult.redundant |
| Solve performance metric | ms per re-solve, surfaced when > 50ms | ⏳ year 3 |
| Sketch validity check | self-intersecting profile, open chain warnings | ⏳ year 2 |
| Constraint visualization (which constraint controls what) | hover constraint icon → highlight target entities | ⏳ year 2 |

## 1.7 Sketch keyboard shortcuts (SW conventions)

| Action | SW shortcut | NexyFab target |
|---|---|---|
| Line | `L` | ⏳ year 2 |
| Circle | `C` | ⏳ year 2 |
| Rectangle | `R` | ⏳ year 2 |
| Trim | `T` | ⏳ year 2 |
| Extend | (no default) | ⏳ year 3 |
| Mirror | `Ctrl+M` | ⏳ year 2 |
| Dimension | `D` | ⏳ year 2 |
| Escape tool | `Esc` | ⏳ year 2 |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` | ⏳ year 2 |
| Pan | middle-mouse drag | ⏳ year 2 |
| Zoom (wheel) | mouse wheel | ⏳ year 2 |
| Zoom-fit | `F` | ⏳ year 2 |

---

# 2 · Part Modeling (3D Solid)

**Why it matters:** ~50% of engineer time. The breadth here is where SW has 30 years of refinement.

**Hard parts:**
- Boolean failures on near-coincident or tiny-tolerance geometry
- Fillet at convex/concave/saddle junctions
- Variable-radius fillet with smooth taper
- Feature regeneration after a parent edit (parent-child propagation)
- Sketch-driven pattern with parent-feature suppress logic
- Up-to-surface / up-to-body termination conditions

## 2.1 Extrude — full parameter set

| Parameter | Options | NexyFab target | Notes |
|---|---|---|---|
| Direction 1 type | Blind / Through all / Up to next surface / Up to vertex / Up to surface (specific) / Mid plane / Offset from surface | 🔧 Blind ✅; rest ⏳ year 2 | Termination conditions critical for parametric flexibility |
| Direction 2 (asymmetric two-sided) | Independent type from Direction 1 | ⏳ year 2 | `two_sided` IR allows |
| Distance | Numeric, mm/in | ✅ | |
| Draft angle | -89° to +89° | ✅ via Phase 2.1 `draftDegrees` | |
| Draft outward (vs inward) | toggle | ⏳ year 2 | |
| Reverse direction | toggle | ⏳ year 2 | |
| Merge result (boolean with existing body) | toggle | ⏳ year 2 (default ON for boss) | |
| Body to operate on | pick existing body | ⏳ year 2 (multi-body) | |
| Thin feature (extrude as shell) | thickness, single/midplane/two-sided | ⏳ year 2 | offset profile inward/outward by thickness |
| Cap ends (thin feature) | toggle | ⏳ year 3 | |
| Extruded surface (no thickness, surface body) | toggle | ⏳ year 3 (Surface §3) | |
| Selected contours (multi-loop sketch, pick which to extrude) | UI: list of closed loops in sketch | ⏳ year 2 | `extractClosedLoops` already returns list |
| Feature scope (which existing bodies are affected) | multi-body | ⏳ year 3 | |
| Start condition | Sketch plane / Surface / Vertex / Offset | ⏳ year 3 | extrude doesn't have to start on sketch plane |
| End condition with offset | + offset from termination surface | ⏳ year 3 | |

## 2.2 Revolve — full parameter set

| Parameter | Options | NexyFab target |
|---|---|---|
| Axis | Sketch line / external axis / coordinate axis | 🔧 axis line only; rest ⏳ |
| Direction 1 type | Blind / Up to vertex / Up to surface / Mid plane | ⏳ year 2 |
| Angle 1 | 0..360° | ✅ |
| Direction 2 + Angle 2 | asymmetric | ⏳ year 2 |
| Thin feature | thickness, both sides | ⏳ year 2 |
| Merge result | toggle | ⏳ year 2 |
| Surface revolve | toggle | ⏳ year 3 |
| Selected contours | multi-loop | ⏳ year 2 |
| Skip first / last loop | exclude inner/outer | ⏳ year 3 |

## 2.3 Sweep — full parameter set

| Parameter | Options | NexyFab target |
|---|---|---|
| Profile | sketch | ✅ |
| Path | sketch / 3D sketch / edge / curve | 🔧 path IR; UI ⏳ |
| Orientation type | Follow path (normal to path) / Keep normal constant / Follow path with twist / Twist along path | ⏳ year 3 |
| Twist value | angle / # turns / per length | ⏳ year 3 |
| Guide curves (1-3) | curves that profile interpolates between | ⏳ year 3 |
| Merge tangent faces | smooth faces between segments | ⏳ year 3 |
| Show preview | live preview during edit | ⏳ year 2 |
| Path alignment (start, end, both) | which end profile sits at | ⏳ year 3 |
| Profile twist (additional rotation) | degrees | ⏳ year 3 |
| Thin sweep | thickness | ⏳ year 3 |
| Solid / surface | toggle | ⏳ year 3 |
| Helix sweep (axis + pitch + revolutions) | dedicated tool | ⏳ year 3 (springs, threads) |
| Helix variable pitch | table | ⚪ year 4 |

## 2.4 Loft — full parameter set

| Parameter | Options | NexyFab target |
|---|---|---|
| Profiles (2+ in order) | pick sequence | 🔧 IR done (same-count); UI ⏳ |
| Centerline (single 3D curve) | profiles oriented to centerline | ⏳ year 3 |
| Guide curves (1+) | profiles interpolate along | ⏳ year 3 |
| Start tangency (normal / direction vector / tangency to face) | continuity at first profile | ⏳ year 4 |
| End tangency | same options | ⏳ year 4 |
| Tangent length (sharpness of transition) | per-end | ⚪ year 4 |
| Merge tangent faces | toggle | ⏳ year 3 |
| Close loft (last profile connects to first) | toggle | ⏳ year 3 |
| Show preview | wireframe / shaded | ⏳ year 2 |
| Sketch tools (manually pair vertices) | UI to align profile points | ⏳ year 3 |
| Match faces (G1/G2 to adjacent face) | continuity matching | ⚪ year 5 |
| Loft from point (one end degenerates to point) | toggle | ⏳ year 4 |

## 2.5 Fillet — full parameter set + variants

| Variant | Options | NexyFab target |
|---|---|---|
| Constant radius | per-edge radius value | 🔧 partial in existing infra |
| Multiple edges (constant) | one radius, multi-select | ⏳ year 2 |
| Multiple radii (per-edge) | edit each | ⏳ year 2 |
| Variable radius | start radius, end radius, intermediate points | ⏳ year 2 |
| Asymmetric (different radius each face) | radius1 + radius2 | ⏳ year 3 |
| Conic (rho 0..1) | conic profile section | ⚪ year 4 |
| Full round (3 faces) | pick center face + 2 adjacent | ⏳ year 3 |
| Face fillet (2 faces, between them) | pick 2 faces | ⏳ year 3 |
| Setback (control corner blend where 3+ fillets meet) | setback distance per edge | ⚪ year 4 |
| Hold line (force fillet edge along selected curve) | pick curve | ⚪ year 4 |
| Continuous propagation (auto-extend to tangent edges) | toggle | ⏳ year 3 |
| Keep edge / Keep surface (tie-breaker) | toggle | ⏳ year 3 |
| Tangent edges (propagate to all tangent) | toggle | ⏳ year 2 |
| Multi-direction propagation | smart edge group | ⏳ year 3 |
| Preview (live update) | ✓ | ⏳ year 2 |
| Show callouts (radius labels in viewport) | toggle | ⏳ year 3 |

## 2.6 Chamfer — full parameter set

| Variant | Options | NexyFab target |
|---|---|---|
| Distance + distance (symmetric) | 1 value | 🔧 partial |
| Distance + distance (asymmetric) | 2 values | ⏳ year 2 |
| Distance + angle | dist on first face + angle | ⏳ year 2 |
| Vertex chamfer (3 distances at corner) | for cube corner | ⏳ year 3 |
| Equal distance toggle | shortcut to symmetric | ⏳ year 2 |
| Multiple edges | as fillet | ⏳ year 2 |
| Preserve features (chamfer doesn't eat smaller features) | toggle | ⏳ year 3 |

## 2.7 Hole Wizard — full parameter set

| Hole type | Sub-params | NexyFab target |
|---|---|---|
| Simple drilled | diameter, depth (blind/through), endpoint type (flat/conical) | ⏳ year 2 |
| Counterbore | drill + counterbore diameter + depth | ⏳ year 2 |
| Countersink | drill + countersink angle (82°/90°/100°/118°) + depth | ⏳ year 2 |
| Tap (threaded blind) | thread spec (M3..M48, UNC, UNF) + drill depth + thread depth | ⏳ year 3 |
| Pipe tap (NPT/BSPT) | thread + depth | ⚪ year 4 |
| Legacy (custom profile) | any sketch | ⏳ year 3 |
| Multiple holes (pattern on face) | n holes + spacing | ⏳ year 3 |
| Hole standard (ISO / ANSI / DIN / JIS / GB) | dropdown | ⏳ year 3 |
| Bottom angle (drill point) | 90° / 118° / 135° | ⏳ year 3 |
| Near-side / far-side options (e.g., counterbore on which side) | toggle | ⏳ year 3 |
| Hole callout text (for drawing) | format string per type | ⏳ year 3 (drawing-side) |

## 2.8 Pattern — full parameter set (sketch-driven, table-driven extensions)

(Phase 2.4 covers linear + circular IR. Below is the UX-layer detail.)

| Variant | Options | NexyFab target |
|---|---|---|
| Linear pattern 1D | features + direction + spacing + count + 2nd direction (opt) | ✅ IR; UI ⏳ |
| Linear pattern 2D grid | + 2nd direction | ✅ IR; UI ⏳ |
| Spacing mode | up-to-reference / fixed spacing / fill region | ⏳ year 3 |
| Circular pattern | features + axis + total angle + count | ✅ IR |
| Equal spacing | toggle | ⏳ year 2 |
| Mirror pattern | about plane / face | ⏳ year 2 |
| Curve-driven pattern | features + curve + count | ⏳ year 3 |
| Sketch-driven pattern (instances at sketch points) | features + sketch | ⏳ year 3 |
| Table-driven pattern (CSV-like positions) | features + table | ⚪ year 4 |
| Skip instances | click to disable specific copies | ⏳ year 3 |
| Geometry pattern (pattern as separate bodies) | toggle | ⚪ year 4 |
| Pattern of patterns | nested | ⚪ year 4 |
| Vary instances (each copy has tweaked params) | per-instance override table | ⚪ year 5 |

## 2.9 Shell — full parameter set

| Parameter | NexyFab target |
|---|---|
| Wall thickness | ⏳ year 2 |
| Faces to remove (open faces) | ⏳ year 2 |
| Shell outward (offset outside) | ⏳ year 2 |
| Multi-thickness (per-face) | ⏳ year 3 |
| Preserve features (don't shell-through small holes) | ⏳ year 3 |

## 2.10 Draft

| Variant | NexyFab target |
|---|---|
| Neutral plane draft (faces angle from a plane) | ⏳ year 2 |
| Parting line draft | ⏳ year 3 (mold-related) |
| Step draft (with stepped offset) | ⚪ year 4 |
| Draft analysis (color faces by angle) | ⏳ year 2 |

## 2.11 Rib

| Parameter | NexyFab target |
|---|---|
| Thickness | ⏳ year 3 |
| Side (both / left / right of sketch) | ⏳ year 3 |
| Direction (extrude until next surface) | ⏳ year 3 |
| Draft angle (mold-friendly) | ⏳ year 3 |
| Cap end style | ⏳ year 3 |

## 2.12 Body operations

| Operation | NexyFab target |
|---|---|
| Move/copy body (translate, rotate, axis-angle) | ⏳ year 3 |
| Scale body (uniform, non-uniform along XYZ) | ⏳ year 3 |
| Combine (boolean: add / subtract / common) | 🔧 existing CSG panel |
| Split (by plane / face / sketch surface) | ⏳ year 3 |
| Delete body (with optional surface patch) | ⏳ year 3 |
| Save body as new part file | ⏳ year 4 |
| Body color / appearance | ⏳ year 2 |
| Body name (rename in tree) | ⏳ year 2 |
| Hide / show body | ⏳ year 2 |
| Body transparency | ⏳ year 2 |

## 2.13 Reference geometry (deep)

| Element | Construction methods | NexyFab target |
|---|---|---|
| Plane — offset distance | from face/plane | 🔧 IR `offsetAlongNormal` |
| Plane — at angle | reference plane + edge + angle | ⏳ year 2 |
| Plane — through 3 points | 3 picks | 🔧 IR `fromThreePoints` |
| Plane — through line + point | 2 picks | ⏳ year 2 |
| Plane — through line + parallel to another | 2 picks | ⏳ year 2 |
| Plane — normal to curve at point | curve + point | ⏳ year 3 |
| Plane — tangent to surface at point | surface + point | ⏳ year 3 |
| Plane — mid-plane between 2 planes | 2 picks | ⏳ year 2 |
| Axis — single line | pick line | 🔧 IR `datumAxis` |
| Axis — 2 points | pick 2 vertices | ✅ `datumAxisThroughPoints` |
| Axis — intersection of 2 planes | pick 2 planes | ⏳ year 2 |
| Axis — cylindrical face axis (auto) | pick cylindrical face | ⏳ year 2 |
| Axis — through point, normal to face | 2 picks | ⏳ year 2 |
| Point — vertex | auto-detect | ⏳ year 2 |
| Point — center of arc/circle | auto | ⏳ year 2 |
| Point — on curve (parameter or distance) | curve + param | ⏳ year 3 |
| Point — center of face | face | ⏳ year 3 |
| Point — projection (on face/plane) | source + target | ⏳ year 3 |
| Coordinate system (origin + 3 axes) | construction | ⏳ year 3 |
| 3D Sketch (free 3D wireframe) | dedicated mode | ⚪ year 4 |

## 2.14 Mass properties + measure

| Tool | Detail | NexyFab target |
|---|---|---|
| Mass | from material density × volume | ⏳ year 2 |
| Volume | from B-rep | ⏳ year 2 (OCCT call) |
| Surface area | from B-rep | ⏳ year 2 |
| Center of mass | from B-rep | ⏳ year 2 |
| Moments of inertia (Ixx, Iyy, Izz, products) | from B-rep | ⏳ year 3 |
| Principal axes of inertia | derived | ⏳ year 3 |
| Bounding box | XYZ | ⏳ year 2 |
| Sectional properties (cut at plane) | ⏳ year 3 |
| Distance measure (any 2 elements) | point/edge/face/body | ⏳ year 2 |
| Angle measure | 2 lines / 2 faces | ⏳ year 2 |
| Radius measure | hover circular | ⏳ year 2 |
| Length (edge) | pick edge | ⏳ year 2 |
| Snap to point during measure | ⏳ year 2 |

## 2.15 Material assignment

| Capability | NexyFab target |
|---|---|
| Material library (1000+ standard: steels/aluminums/polymers/woods) | ⏳ year 3 |
| Per-body material override | ⏳ year 3 |
| Material properties: density, elastic modulus, Poisson, yield, ultimate, thermal expansion | ⏳ year 3 |
| Custom material (user-defined) | ⏳ year 3 |
| Material visual appearance link (auto-set color/texture per material) | ⏳ year 3 |
| Cost per kg/m³ (for quoting) | ⏳ year 2 (extends existing quoting) |

---

# 3 · Surface Modeling (deep)

**Why it matters:** Consumer products, automotive trim, ergonomic shells. Year 3-4 territory.

**Hard parts:** NURBS math, G1/G2/G3 continuity preservation, surface knit + close, class-A quality.

| Feature | Options | NexyFab target |
|---|---|---|
| Extruded surface | profile + direction + dist | ⏳ year 3 |
| Revolved surface | profile + axis + angle | ⏳ year 3 |
| Swept surface | profile + path + (guides) | ⏳ year 3 |
| Lofted surface | profiles + (guides) + (centerline) | ⏳ year 3 |
| Boundary surface | 1-4 boundary curves + tangency to each | ⏳ year 4 |
| Filled surface | 3+ boundary curves + (constraint surface) | ⏳ year 4 |
| Knit surfaces | pick surfaces → check seams → close → 1 surface body | ⏳ year 4 |
| Knit into solid | when fully enclosed | ⏳ year 4 |
| Untrim surface (restore underlying surface) | ⚪ year 5 |
| Offset surface | distance, both sides | ⏳ year 4 |
| Surface trim (cut by curve / surface / plane) | ⏳ year 4 |
| Mutual trim (2 surfaces cut each other) | ⏳ year 4 |
| Extend surface (linear, tangent, by curvature) | ⏳ year 4 |
| Ruled surface | edge + width + draft + tangent | ⏳ year 4 |
| Thicken surface → solid | ⏳ year 4 |
| Surface fillet | 2 surfaces + radius | ⏳ year 4 |
| Replace face | source face + replacement surface | ⚪ year 5 |
| Surface delete | with optional patch | ⏳ year 4 |
| Surface flatten (developable surfaces) | ⚪ year 5 |
| Surface analysis — curvature contour | color by Gaussian/mean | ⏳ year 4 |
| Surface analysis — zebra (visualize G1/G2) | parallel stripe reflection | ⏳ year 4 |
| Surface analysis — draft (color by angle to direction) | ⏳ year 3 (mold-friendly) |
| Surface analysis — undercut | ⏳ year 3 (mold) |
| Class-A surface tools | NURBS edit, isoparams, multi-patch | ❌ separate industry |
| T-spline / freeform sculpting (Fusion Form) | ⚪ year 5 (separate engine) |

---

# 4 · Sheet Metal (deep)

**Why it matters:** Most shop work (brackets, enclosures). Without flat-pattern export users go elsewhere.

**Hard parts:** K-factor table accuracy across material/gauge, fold/unfold without geometric drift, corner relief automation.

## 4.1 Body creation
| Feature | Options | NexyFab target |
|---|---|---|
| Base flange (sketch → flat sheet) | thickness, bend radius, k-factor | ⏳ year 3 |
| Base flange from edge of solid | solid edge → flange | ⏳ year 3 |
| Convert solid → sheet metal | pick faces + corners | ⏳ year 4 |

## 4.2 Add features
| Feature | Options | NexyFab target |
|---|---|---|
| Edge flange | edge + length + angle + reverse + (taper) | ⏳ year 3 |
| Miter flange | sketch (path) + position + reverse | ⏳ year 3 |
| Hem (single-leg fold-over) | open / closed / teardrop / rolled | ⏳ year 3 |
| Hem length + spread (gap) | per type | ⏳ year 3 |
| Jog (Z-bend with offset) | dist + 2 angles + sketch line | ⏳ year 3 |
| Tab (rectangular extension) | width + depth + bend radius | ⏳ year 3 |
| Lofted bend (2 closed-sketch profiles) | ⏳ year 4 |
| Swept flange (profile + path) | ⏳ year 4 |
| Cross break (X-pattern stiffening) | ⚪ year 5 |
| Vent (HVAC opening: ribs + boundary + hole) | ⚪ year 5 |
| Forming tool (custom punch insert) | pick library punch → place | ⚪ year 5 |
| Sheet metal corner (4-bend corner intersection) | open / overlap / under | ⏳ year 3 |
| Closed corner | 3 styles (butt / overlap / underlap) | ⏳ year 3 |
| Welded corner (with weld bead) | ⚪ year 4 |
| Break corner (fillet/chamfer in sheet metal context) | ⏳ year 3 |

## 4.3 Cut / Modify
| Feature | Options | NexyFab target |
|---|---|---|
| Sheet metal cut (extrude cut on flat) | through all (auto), shaped, normal-cut option | ⏳ year 3 |
| Normal cut (cut perpendicular to surface) | toggle | ⏳ year 3 |
| Mirror sheet metal | ⏳ year 3 |
| Linear / circular pattern (sheet metal) | ⏳ year 3 |
| Corner trim | break / smooth | ⏳ year 3 |
| Corner relief (rectangular / circular / tear) | size, type, condition | ⏳ year 3 |
| Bend relief (rectangular / obround / tear) | size, type | ⏳ year 3 |

## 4.4 Bend table / parameters
| Setting | Detail | NexyFab target |
|---|---|---|
| Material thickness | per part | ⏳ year 3 |
| Bend radius (default) | per part | ⏳ year 3 |
| K-factor (or table) | per material/gauge | ⏳ year 3 |
| Bend allowance | computed or table | ⏳ year 3 |
| Bend deduction | alt to allowance | ⏳ year 3 |
| Custom bend table (CSV import) | material × thickness × radius → BA/BD/K | ⏳ year 3 |

## 4.5 Flatten / unfold
| Capability | NexyFab target |
|---|---|
| Process bend (unfold one bend at a time) | ⏳ year 3 |
| Unfold all (flatten entire part) | ⏳ year 3 |
| Flat pattern view (separate display) | ⏳ year 3 |
| Flat pattern dimensions | with bend lines, fold direction arrows | ⏳ year 3 |
| Flat pattern DXF export | ⏳ year 3 |
| Bend annotation (UP/DOWN, angle, radius) | ⏳ year 3 |
| Bend table (drawing view) | ⏳ year 3 |

---

# 5 · Weldments (deep)

| Feature | Options | NexyFab target |
|---|---|---|
| Structural member (profile + 3D-sketch frame) | apply profile to each segment | ⏳ year 4 |
| Profile library (standard ISO/ANSI tube, angle, channel, beam, T-section) | dropdown | ⏳ year 4 |
| Custom profile (user sketch as profile) | import from sketch | ⏳ year 4 |
| Trim/extend (end-condition between members) | body trim / end miter / butt / coped | ⏳ year 4 |
| End cap | profile from member end | ⏳ year 4 |
| Gusset (triangular plate at joint) | thickness + offsets | ⏳ year 4 |
| Fillet bead (weld) | size + type (along edge) | ⏳ year 4 |
| Weld bead body (solid representation) | toggle visualization | ⏳ year 5 |
| Cut list (BOM of structural members) | quantity × length × profile | ⏳ year 4 |
| Cut list properties (custom fields per member) | length, angle1, angle2 | ⏳ year 4 |
| Weldment drawing template | cut list + weld symbols | ⏳ year 4 (drawing-side) |

---

# 6 · Mold / Tooling (deep)

| Feature | NexyFab target |
|---|---|
| Draft analysis (color faces by angle to pull direction) | ⏳ year 4 (also part-design tool) |
| Undercut detection | ⏳ year 4 |
| Parting line (auto + manual edit) | ⚪ year 5 |
| Shut-off surface (close holes/openings in mold) | ⚪ year 5 |
| Parting surface (separate core from cavity) | ⚪ year 5 |
| Tooling split (core + cavity bodies) | ⚪ year 6 |
| Side core / lifter | ⚪ year 6 |
| Ejector pin placement | ⚪ year 6 |
| Mold base library | ⚪ year 6 |
| Cooling channel design | ⚪ year 7 |
| Runner / gate design | ⚪ year 7 |
| Mold flow analysis | ❌ separate Moldflow tool |

---

# 7 · Assembly (deep)

## 7.1 Component management
| Feature | NexyFab target |
|---|---|
| Insert component (from part file) | ⏳ year 2 |
| Insert from cloud library | ⏳ year 3 |
| Insert standard part (toolbox: bolt, nut, washer, bearing) | ⏳ year 4 |
| Insert with mate reference (snap to pre-defined location) | ⏳ year 3 |
| Insert sub-assembly | ✅ via Phase 3.5 IR |
| Component pattern (linear/circular/sketch-driven of instances) | ⏳ year 3 |
| Component mirror | ⏳ year 3 (with optional new mirrored part file) |
| Move / rotate component | with snap/collision feedback | ⏳ year 2 |
| Replace component (swap part file, retain mates) | ⏳ year 4 |
| Component properties (instance name, description, hidden, fixed, lightweight) | ⏳ year 2 |
| Suppress / unsuppress component | ⏳ year 2 |
| Show / hide | ⏳ year 2 |
| Isolate component (hide all others) | ⏳ year 2 |
| Make component virtual (orphan from part file) | ⚪ year 4 |
| Component color override (per instance) | ⏳ year 3 |
| Component transparency override | ⏳ year 3 |
| Lightweight mode (load surface bodies only for large assemblies) | ⏳ year 4 |

## 7.2 Mates — exhaustive

### 7.2.1 Standard mates (Phase 3.1 IR covers 7)
| Mate | Picks | DoF removed | NexyFab target | Notes |
|---|---|---|---|---|
| Coincident (face/face) | 2 faces | 3 (1 trans + 2 rot) | ✅ IR + solver |
| Coincident (face/edge) | face + edge | 2 | ⏳ year 2 |
| Coincident (face/vertex) | 1 | face + vertex | ⏳ year 2 |
| Coincident (edge/edge) | 2 edges | 4 | ✅ IR; solver ⏳ |
| Coincident (point/point) | 2 vertices | 3 | ✅ IR + solver |
| Coincident (plane/plane) | 2 datum planes | 3 | ✅ IR + solver |
| Concentric (axis/axis) | 2 cyl faces | 4 | ✅ IR + solver |
| Concentric (axis/circular edge) | 1 + 1 | 4 | ✅ IR (refKind compat) |
| Distance (face/face) | + numeric | 1 | ✅ IR + solver |
| Distance (point/point) | + numeric | 1 | ✅ IR + solver |
| Distance (edge/edge) | + numeric | 1 | ⏳ year 2 |
| Angle (face/face) | + numeric | 1 | ✅ IR + solver |
| Angle (line/line) | + numeric | 1 | ✅ IR + solver |
| Angle (face/edge) | + numeric | 1 | ⏳ year 2 |
| Parallel (face/face) | 2 faces | 2 | ✅ IR + solver |
| Parallel (axis/axis) | 2 axes | 1 | ✅ IR + solver |
| Perpendicular | 2 lines / 2 faces / line + face | 1 | ✅ IR + solver |
| Tangent (face/face) | 1 | ⏳ year 3 | analytical solver needed |
| Tangent (edge/face) | 1 | ⏳ year 3 |
| Symmetric (about plane) | 2 entities + plane | 1 | ⏳ year 2 |

### 7.2.2 Advanced mates
| Mate | Detail | NexyFab target |
|---|---|---|
| Profile center (centered between faces, like slot center) | ⏳ year 3 |
| Width mate (object centered between 2 parallel faces) | ⏳ year 3 |
| Path mate (point on curve, distance optional) | ⏳ year 3 |
| Linear / linear coupler (motion coupling) | ⏳ year 4 |
| Limit (mate with min/max range) | ⏳ year 3 |
| Distance limit | min/max distance | ⏳ year 3 |
| Angle limit | min/max angle | ⏳ year 3 |
| Linkage mate (4-bar / slider-crank presets) | ⚪ year 5 |
| Slot mate (component slides in slot) | ⏳ year 4 |
| Cam follower (planar) | ⚪ year 4 |
| Hinge mate (combined coincident + concentric + limit) | ⏳ year 3 |
| Universal joint | ⚪ year 5 |
| Gear (with ratio) | ⚪ year 4 |
| Rack and pinion | ⚪ year 4 |
| Screw mate (rotation → translation) | ⚪ year 4 |
| Bearing mate (rotation only, with constraint) | ⚪ year 4 |
| Belt / chain (linked rotations) | ⚪ year 5 |

### 7.2.3 Mate options
| Setting | NexyFab target |
|---|---|
| Mate alignment flip (which side coincident) | ⏳ year 2 |
| Mate visibility (show in viewport) | ⏳ year 3 |
| Mate name (rename in tree) | ⏳ year 2 |
| Mate suppression | ✅ via `suppressed: true` |
| Mate locked (don't suggest as constraint to violate) | ⚪ year 4 |
| Mate priority / order (re-order in tree) | ⏳ year 3 |

## 7.3 Assembly tools

| Tool | Detail | NexyFab target |
|---|---|---|
| Mate diagnosis (which mate is over-constraining?) | UI panel | ⏳ year 3 |
| Mate replacement (swap one mate type with another) | ⏳ year 4 |
| Suppress all mates (rapid hand-place mode) | ⏳ year 3 |
| Smart mate (drag part toward target, suggests mate) | drag-and-drop | ⏳ year 3 |
| Interference detection (all pairs) | ✅ Phase 3.4 AABB; OCCT exact ⏳ year 3 |
| Clearance check (specified min distance between bodies) | ⏳ year 3 |
| Show interferences as red volumes | ⏳ year 3 |
| Mass properties of full assembly | ⏳ year 3 |
| Center of mass display (3D viewport) | ⏳ year 3 |
| Bounding box (full assembly) | ⏳ year 2 |
| Section view (cut by plane) | ⏳ year 2 |
| Multi-plane section (cut by 2-3 planes) | ⏳ year 3 |
| Exploded view (animated separation) | ⏳ year 3 |
| Exploded view (multiple steps, sequence) | ⏳ year 3 |
| Exploded view animation export (video/GIF) | ⏳ year 3 |
| Magnify (zoom + isolate sub-region) | ⏳ year 3 |
| Component selection by criteria (material, mass range, name pattern) | ⏳ year 3 |
| Assembly XML / JSON export | ⏳ year 2 |

## 7.4 Motion studies

| Capability | NexyFab target |
|---|---|
| Animation by mate parameter (timeline) | ✅ Phase 3.6 single-param; multi-param ⏳ |
| Time-based keyframes | ⏳ year 3 |
| Motor (constant velocity / variable) | ⚪ year 4 |
| Spring (linear / torsional) | ⚪ year 4 |
| Gravity | ⚪ year 4 |
| Linear / contact force (between bodies) | ⚪ year 5 |
| Damping (linear / friction) | ⚪ year 5 |
| Motion analysis (rigid-body solver: position/velocity/acceleration over time) | ⚪ year 5 |
| Forces / moments at joints | ⚪ year 5 |
| Trace path of point | ⏳ year 3 |
| Plot results (graph generator) | ⚪ year 5 |
| Save animation (MP4, GIF, sequence) | ⏳ year 3 |

---

# 8 · Drawing (2D Output) — deep

## 8.1 Sheet management
| Feature | NexyFab target |
|---|---|
| Sheet size (A0-A4, Letter, Legal, Tabloid, ANSI A-E, custom) | ✅ Phase 4.1 IR |
| Multi-sheet drawing | 🔧 IR; UI ⏳ year 2 |
| Sheet templates (custom title block, border) | ⏳ year 2 |
| Title block fields (linked to part properties: name, rev, date, author, scale) | ⏳ year 2 |
| Title block editor (user designs custom block) | ⏳ year 3 |
| Sheet format library (company templates) | ⏳ year 3 |
| Sheet properties (scale, units, projection: 1st/3rd angle, drawing standard: ISO/ANSI/JIS) | ⏳ year 2 |
| Sheet zone labels (A1, B2, ...) | ⏳ year 3 |
| Sheet revision triangle markers | ⏳ year 3 |

## 8.2 View types (full list)
| View type | Detail | NexyFab target |
|---|---|---|
| Standard 3-view (Front, Top, Right + optional Iso) | with projection convention | ✅ via `standardThreeViewSheet` |
| Custom orientation (named view from 3D) | ⏳ year 2 |
| Auxiliary view (project off any edge perpendicular) | 🔧 IR; UI ⏳ |
| Section view — full | cutting plane spans full | 🔧 IR; UI ⏳ |
| Section view — half | cutting from one side | ⏳ year 2 |
| Section view — offset (zigzag cutting plane) | ⏳ year 3 |
| Section view — aligned (rotate cut plane to be flat) | ⏳ year 3 |
| Section view — broken-out (local section in existing view) | ⏳ year 3 |
| Section view — successive cuts | ⏳ year 4 |
| Detail view (zoom inset with circle marker) | 🔧 IR; UI ⏳ |
| Detail view scale (independent from parent) | ⏳ year 2 |
| Broken view (long thin part with break) | break style (straight/zigzag/spline) | ⏳ year 3 |
| Crop view (mask portion of view) | ⏳ year 3 |
| Alternate position view (component in 2nd config overlaid) | ⚪ year 4 |
| Empty view (placeholder, sketch-only) | ⏳ year 3 |
| Exploded view from assembly | ⏳ year 3 |
| 3D view (perspective/iso, for reference) | ⏳ year 2 |
| Predefined view (linked to part config) | ⏳ year 3 |

## 8.3 View properties
| Setting | NexyFab target |
|---|---|
| Scale (1:1 / 1:2 / 1:5 / custom / fit to sheet) | ⏳ year 2 |
| Display style (wireframe / hidden / shaded / shaded with edges) | ⏳ year 2 |
| Tangent edges display (visible / hidden / phantom / none) | ⏳ year 2 |
| Hidden lines display (show / hide) | ⏳ year 2 |
| Cosmetic threads display (toggle) | ⏳ year 3 |
| Origin display (toggle per view) | ⏳ year 2 |
| Annotation display (linked dims show automatically) | ⏳ year 2 |
| View label (auto: A, B, C, ...) | ⏳ year 2 |
| Section/auxiliary arrow size + position | ⏳ year 3 |
| Layer (organize on layers, layer visibility) | ⏳ year 3 |

## 8.4 Dimensions (deep)
(Phase 4.2 IR covers 5 base types; below extends with all SW variants)

| Dimension | NexyFab target |
|---|---|
| Smart dimension (auto-pick type based on selection) | ⏳ year 2 |
| Horizontal | ⏳ year 2 |
| Vertical | ⏳ year 2 |
| Aligned (along entities) | ✅ IR |
| Linear (point-point or projection) | ✅ IR |
| Angular | ✅ IR |
| Diameter (with ⌀ prefix) | ✅ IR |
| Radius (with R prefix) | ✅ IR |
| Arc length (with ⌒ prefix) | ⏳ year 3 |
| Chord length | ⏳ year 3 |
| Baseline (chain from origin) | ⏳ year 2 |
| Chain (each dim from prior) | ⏳ year 2 |
| Ordinate (single baseline, multiple offsets) | ⏳ year 2 |
| Hole callout (auto from hole feature: diameter + depth + thread) | ⏳ year 2 |
| Path length | ⏳ year 4 |
| Auto-dimension (place all required dims automatically) | ⚪ year 4 |
| Foreshortened (when dim line shorter than actual) | ⏳ year 3 |
| Reference dimension (no constraint, just measure) | ⏳ year 2 (driven flag) |

### Dimension styling (per-dim or document-wide)
| Setting | NexyFab target |
|---|---|
| Arrow style (closed / open / dot / tick / open angle / oblique) | ⏳ year 2 |
| Arrow size | ⏳ year 2 |
| Text height | ⏳ year 2 |
| Text font | ⏳ year 2 |
| Text position (above / centered / outer) | ⏳ year 2 |
| Decimal places | ⏳ year 2 |
| Units (mm / cm / m / in / ft) | ⏳ year 2 |
| Dual dimensions (e.g., mm + in side-by-side) | ⏳ year 3 |
| Tolerance display (none / bilateral / unilateral / limit / fit) | ✅ IR |
| Tolerance value | ✅ IR |
| Tolerance text height (relative to nominal) | ⏳ year 3 |
| Prefix (custom string before value) | ✅ IR `prefix` |
| Suffix (custom string after) | ✅ IR `suffix` |
| Bold / italic / strikethrough | ⏳ year 3 |
| Color override | ⏳ year 3 |

## 8.5 GD&T (full ASME Y14.5 + ISO GPS)

| Symbol | Category | NexyFab target |
|---|---|---|
| Straightness | form | ✅ IR |
| Flatness | form | ✅ IR |
| Circularity | form | ✅ IR |
| Cylindricity | form | ✅ IR |
| Profile of a line | profile | ⏳ year 2 |
| Profile of a surface | profile | ⏳ year 2 |
| Perpendicularity | orientation | ⏳ year 2 |
| Angularity | orientation | ⏳ year 2 |
| Parallelism | orientation | ⏳ year 2 |
| Position (true position) | location | ✅ IR (with datums) |
| Concentricity | location | ✅ IR |
| Symmetry | location | ⏳ year 3 (deprecated in 2018 Y14.5) |
| Circular runout | runout | ✅ IR |
| Total runout | runout | ⏳ year 2 |
| Material condition modifiers (M, L, S) | ✅ IR |
| Projected tolerance zone (P) | ⏳ year 3 |
| Free state (F) | ⏳ year 4 |
| Statistical tolerance (ST) | ⚪ year 4 |
| Tangent plane (T) | ⚪ year 4 |
| Datum feature symbol | with letter label | ⏳ year 2 |
| Datum target (point / line / area) | ⏳ year 3 |
| Multiple datum reference frame | ⏳ year 2 (datums array) |
| Composite tolerance (2 lines of FCF) | ⏳ year 3 |
| Profile zone (unilateral / bilateral / equal-disposition) | ⏳ year 3 |

## 8.6 Annotations
| Annotation | NexyFab target |
|---|---|
| Note (free text) | ⏳ year 2 |
| Note with leader (arrow to feature) | ⏳ year 2 |
| Multi-line note | ⏳ year 2 |
| Note with auto-balloon | ⏳ year 2 |
| Note text formatting (bold/italic/font) | ⏳ year 2 |
| Note linked to property (auto: "Material: $material") | ⏳ year 3 |
| Centerline | ⏳ year 2 |
| Centerline pattern (auto on circular features) | ⏳ year 2 |
| Center mark (cross at circle centers) | ⏳ year 2 |
| Hole center mark (auto on holes) | ⏳ year 2 |
| Bend line / fold direction (sheet metal) | ⏳ year 3 |
| Surface finish symbol (Ra/Rz, machining indicator) | ⏳ year 2 |
| Weld symbol (AWS/ISO 2553) | ⏳ year 3 |
| Caterpillar (visual weld bead in 2D) | ⏳ year 4 |
| Reference (REF) marker on dim | ⏳ year 2 |
| Cosmetic thread | ⏳ year 3 |
| Cosmetic surface texture | ⏳ year 4 |
| Revision cloud | ⏳ year 3 |
| Revision triangle (with number) | ⏳ year 3 |
| Datum target symbol | ⏳ year 3 |
| Stamp (controlled by document property) | ⏳ year 4 |
| Watermark | ⏳ year 3 |

## 8.7 Tables
| Table type | NexyFab target |
|---|---|
| BOM (parts list) | ✅ Phase 4.3 IR |
| Indented BOM (sub-assembly hierarchy) | ⏳ year 2 |
| Parts-only BOM (flat) | ⏳ year 2 |
| Cut list (weldment members) | ⏳ year 4 |
| Hole table (auto-balloon all holes with size/qty) | ⏳ year 3 |
| Hole chart (XY positions, sizes, depths) | ⏳ year 3 |
| Revision table | ⏳ year 3 |
| Design table (configuration list) | ⏳ year 3 |
| General table (user-defined columns + rows) | ⏳ year 3 |
| Property table (component metadata grid) | ⏳ year 3 |
| Weld table (weld symbols summary) | ⏳ year 4 |
| Bend table (sheet metal bend list) | ⏳ year 3 |

### BOM column types
| Column | NexyFab target |
|---|---|
| Item number | ✅ |
| Quantity | ✅ |
| Part number (or template id) | ✅ |
| Description | ✅ |
| Material | ✅ |
| Mass | ✅ |
| Vendor part number | ✅ |
| Custom property (any) | ⏳ year 2 |
| Equation (e.g., qty × unit cost) | ⏳ year 3 |
| Hidden column (compute but don't display) | ⏳ year 3 |

## 8.8 Balloons + leaders
| Feature | NexyFab target |
|---|---|
| Balloon (single, manual placement) | ⏳ year 2 |
| Auto-balloon (place on all components in view) | ⏳ year 2 |
| Balloon style (circular / hex / triangle / split) | ⏳ year 3 |
| Balloon number (auto from BOM index) | ⏳ year 2 |
| Stacked balloons (multiple instances of same part) | ⏳ year 3 |
| Magnetic line (auto-align balloons) | ⏳ year 3 |
| Leader (arrow line from annotation to feature) | ⏳ year 2 |
| Leader bend (S-curve, jog) | ⏳ year 2 |
| Leader arrow style (per use) | ⏳ year 3 |

## 8.9 Export
| Format | Settings | NexyFab target |
|---|---|---|
| PDF | per sheet / all sheets / scale / color | ⏳ year 2 |
| PDF/A (archival) | ⚪ year 3 |
| DXF | layer mapping / version (R12 / R2018) | ✅ Phase 4.4 R12 IR |
| DWG | binary format | ⏳ year 3 (LibreDWG/Teigha) |
| SVG | per sheet | ⏳ year 2 |
| PNG / JPEG (raster snapshot) | resolution | ⏳ year 2 |
| EDrawings (SW proprietary) | ❌ legacy |
| 3D PDF (with embedded 3D for viewer) | ⚪ year 4 |
| Plot to printer (paper sheet) | ⏳ year 2 (via PDF) |
| Plot to plotter (large format with line weight maps) | ⏳ year 3 |

---

# 9 · CAM (deep)

**Note:** Native CAM is year 5+. Partner integration year 2-3.

## 9.1 Milling (2.5/3/3+2/5-axis)
| Operation | Sub-options | NexyFab target |
|---|---|---|
| Face mill | tool + WCS + boundary + step-over + step-down | ⚪ year 5 |
| 2D contour (profile) | direction + offset (inside/outside) + roughing/finishing passes + leads (linear/arc) | ⚪ year 5 |
| 2D pocket | with islands + ramping + helical entry | ⚪ year 5 |
| 2D adaptive (HSM-style trochoidal) | step-over % + max engagement | ⚪ year 6 |
| 2D engrave | depth + offset + V-tool option | ⚪ year 5 |
| Drilling — basic | depth + retract | ⚪ year 5 |
| Drilling — peck | peck increment + dwell | ⚪ year 5 |
| Drilling — breakthrough | breakthrough distance | ⚪ year 5 |
| Drilling — counterbore | counterbore depth | ⚪ year 5 |
| Drilling — tap | tapping speed + feed sync | ⚪ year 6 |
| Drilling — boring | boring depth + finishing pass | ⚪ year 5 |
| Drilling — chip break | chip-break pause | ⚪ year 5 |
| 3D contour (constant Z / waterline) | tolerance + step-down | ⚪ year 6 |
| 3D parallel (back-and-forth across surface) | line spacing + angle | ⚪ year 6 |
| 3D pencil (concave fillets cleanup) | tool + max angle | ⚪ year 6 |
| 3D scallop (constant step across surface) | step + tool | ⚪ year 7 |
| 3D radial (spiraling) | center + step | ⚪ year 7 |
| 3D spiral | helical from edge | ⚪ year 7 |
| 3D morph (between 2 boundary curves) | step | ⚪ year 7 |
| 3D adaptive (HSM 3D) | step + engagement | ⚪ year 7 |
| 3+2 setup (positioned 5-axis) | tool axis fixed via 2-rotary positioning + 3-axis cycles | ⚪ year 7 |
| Full 5-axis simultaneous (swarf, flow, multi-axis adaptive) | ❌ year 10+ or never |
| Probing (touch on/off, mid-machine) | ⚪ year 8 |

## 9.2 Turning (lathe)
| Operation | NexyFab target |
|---|---|
| Face turn | ⚪ year 6 |
| Profile turn (OD/ID) | ⚪ year 6 |
| Groove (OD/ID/face) | ⚪ year 6 |
| Threading (single-point, multi-pass) | ⚪ year 6 |
| Cut-off (parting) | ⚪ year 6 |
| Drilling on axis | ⚪ year 6 |
| Live tooling (mill on lathe) | ⚪ year 8 |

## 9.3 Other CAM modes
| Mode | NexyFab target |
|---|---|
| Wire EDM | ❌ separate industry |
| Plasma / Laser / Waterjet 2D | ⏳ year 5 (extends DXF flat-pattern flow) |
| Additive (FFF/SLA toolpath, build orientation, supports, infill) | ⏳ year 5 |
| Hybrid (additive + subtractive) | ❌ year 10+ |

## 9.4 CAM ancillaries
| Capability | NexyFab target |
|---|---|
| Tool library (HSS/carbide/coated; geometry: diameter, length, flutes) | ⚪ year 5 |
| Custom tool (user-define) | ⚪ year 5 |
| Tool holder modeling (collision check) | ⚪ year 6 |
| Stock setup (rectangular block / cylinder / from file / from body) | ⚪ year 5 |
| Stock simulation (material removal) | ⚪ year 6 |
| Toolpath simulation (collision, gouge, rapid clearance) | ⚪ year 6 |
| Toolpath verify (compare cut stock to target body) | ⚪ year 7 |
| Setup sheet (NC operations summary PDF) | ⚪ year 6 |
| G-code post-processor (per machine controller) | ⚪ year 5 |
| Post-processor editor (custom controller) | ⚪ year 7 |
| Multi-setup workflow (re-fixture, multiple WCS) | ⚪ year 7 |
| Machining time estimate | ⚪ year 6 |
| Tool list (export to operator) | ⚪ year 6 |
| Feed/speed calculator (from tool + material) | ⚪ year 6 |

---

# 10 · Simulation (FEA / CFD / Thermal) — deep

## 10.1 FEA pre-processing
| Capability | NexyFab target |
|---|---|
| Geometry simplification (defeaturing for mesh) | ⚪ year 5 |
| Mid-surface extraction (thin solid → shell) | ⚪ year 6 |
| Beam idealization (slender solid → beam) | ⚪ year 6 |
| Connection definition (bonded / contact / spring / weld / bolt) | ⚪ year 5 |
| Component contact (penalty / Lagrange) | ⚪ year 6 |
| Material assignment per body | ⏳ year 3 (CAD-side, reused) |
| Custom material (nonlinear: stress-strain curve) | ⚪ year 7 |
| Auto-mesh (tetra) | ⚪ year 5 |
| Auto-mesh (hex / dominant) | ⚪ year 7 |
| Mixed mesh (shell + solid + beam) | ⚪ year 7 |
| Mesh refinement (per-face / per-edge size) | ⚪ year 6 |
| Adaptive mesh (auto-refine high-error regions) | ⚪ year 7 |
| Mesh quality report (skew, aspect ratio, Jacobian) | ⚪ year 6 |

## 10.2 FEA load + boundary conditions
| Condition | NexyFab target |
|---|---|
| Fixed support (zero displacement) | ⚪ year 5 |
| Pin support (no rotation) | ⚪ year 5 |
| Symmetry boundary | ⚪ year 5 |
| Cyclic symmetry (gears, fans) | ⚪ year 6 |
| Force (concentrated, distributed, per-face) | ⚪ year 5 |
| Moment | ⚪ year 5 |
| Pressure (per-face) | ⚪ year 5 |
| Gravity / acceleration | ⚪ year 5 |
| Centrifugal | ⚪ year 5 |
| Temperature (constant or imported from thermal) | ⚪ year 6 |
| Convection (heat transfer coefficient + ambient) | ⚪ year 6 |
| Heat flux (per face) | ⚪ year 6 |
| Bolt preload | ⚪ year 6 |
| Bearing load (with radial + axial components) | ⚪ year 7 |

## 10.3 FEA analysis types
| Type | NexyFab target |
|---|---|
| Linear static | ⚪ year 5 |
| Modal (natural frequency) | ⚪ year 6 |
| Buckling (eigenvalue) | ⚪ year 6 |
| Linear thermal steady-state | ⚪ year 6 |
| Linear thermal transient | ⚪ year 7 |
| Coupled thermal-structural | ⚪ year 7 |
| Nonlinear static (contact, large deflection, material plasticity) | ⚪ year 8 |
| Dynamic explicit (impact, drop test) | ⚪ year 9 |
| Dynamic implicit (vibration, shock) | ⚪ year 8 |
| Harmonic response | ⚪ year 8 |
| Fatigue (S-N curve / strain-life) | ⚪ year 7 |
| Frequency response | ⚪ year 8 |
| Random vibration | ⚪ year 9 |

## 10.4 FEA post-processing
| Capability | NexyFab target |
|---|---|
| Stress contour (von Mises / max principal / min principal / shear) | ⚪ year 5 |
| Strain contour | ⚪ year 5 |
| Displacement (magnitude / per-axis) | ⚪ year 5 |
| Reaction force at constraints | ⚪ year 6 |
| Factor of safety (von Mises / Mohr-Coulomb / Tresca) | ⚪ year 6 |
| Deformed shape (animated, scaled) | ⚪ year 5 |
| Section cut through results | ⚪ year 6 |
| Iso-surface (equal-stress surface) | ⚪ year 7 |
| Vector plot (stress direction) | ⚪ year 7 |
| Probe (click point → stress value) | ⚪ year 5 |
| Path plot (stress along curve) | ⚪ year 7 |
| Report generation (HTML / PDF with images + tables) | ⚪ year 6 |

## 10.5 CFD (deferred to partners or year 10+)
| Capability | NexyFab target |
|---|---|
| External flow | ❌ year 10+ via partner |
| Internal flow | ❌ year 10+ via partner |
| Conjugate heat transfer | ❌ year 10+ via partner |

---

# 11 · Rendering / Visualization — deep

## 11.1 Materials + appearance
| Capability | NexyFab target |
|---|---|
| Material library (steel/al/plastic/wood/glass/rubber — 200+ presets) | ⏳ year 3 |
| Per-face material override | ⏳ year 3 |
| PBR material editor (albedo / metallic / roughness / normal / AO maps) | ⏳ year 3 |
| Texture mapping (planar / cylindrical / spherical / UV) | ⏳ year 3 |
| Decal (image on surface, positioned) | ⏳ year 3 |
| Procedural textures (noise, brick, marble) | ⚪ year 4 |
| Layered material (paint over base) | ⚪ year 4 |
| Transparency (refraction index, glass thickness) | ⏳ year 4 |
| Emissive material (self-illuminated) | ⏳ year 4 |
| Sub-surface scattering (skin, wax) | ⚪ year 5 |

## 11.2 Lighting
| Capability | NexyFab target |
|---|---|
| Default scene (3-point soft lighting) | ⏳ year 2 |
| HDRI environment (image-based lighting) | ⏳ year 3 |
| HDRI library (50+ environments) | ⏳ year 3 |
| Sun + sky (time of day, location, weather) | ⚪ year 4 |
| Point light | ⏳ year 3 |
| Spot light | ⏳ year 3 |
| Directional light (parallel) | ⏳ year 3 |
| Area light | ⏳ year 4 |
| Light intensity / color / shadow | ⏳ year 3 |

## 11.3 Camera + scene
| Capability | NexyFab target |
|---|---|
| Camera bookmarks (named views) | ⏳ year 2 |
| Camera focal length (telephoto/wide) | ⏳ year 3 |
| Depth of field (focus distance, aperture) | ⏳ year 4 |
| Orthographic vs perspective toggle | ⏳ year 2 |
| Backdrop (color / gradient / image) | ⏳ year 3 |
| Ground plane (with shadow catcher) | ⏳ year 3 |

## 11.4 Rendering
| Mode | NexyFab target |
|---|---|
| Real-time PBR preview (Three.js viewport) | ⏳ year 2 |
| Path-traced render (single image, cloud GPU) | ⏳ year 4 |
| Iso-render (constant lighting from upper-front) | ⏳ year 3 |
| Turntable animation (auto-rotate, export video) | ⏳ year 3 |
| Walkthrough animation (camera path) | ⚪ year 4 |
| Render queue (batch multiple cameras) | ⏳ year 4 |
| Output resolution (presets: 1080p, 4K, 8K, custom) | ⏳ year 3 |
| Anti-aliasing (samples per pixel) | ⏳ year 4 |
| Denoising (AI denoiser for path-traced output) | ⚪ year 4 |
| Alpha channel (transparent background) | ⏳ year 3 |

---

# 12 · File Interop — deep

## 12.1 Native format
| Capability | NexyFab target |
|---|---|
| NexyFab .nfp (part) — JSON FeatureTree + sketches + metadata | ⏳ year 1 schema lock |
| NexyFab .nfa (assembly) — AssemblyState + part refs | ⏳ year 1 schema lock |
| NexyFab .nfd (drawing) — Sheet array + view defs | ⏳ year 2 |
| Version-tolerant (forward + backward compat across releases) | ⏳ year 2 schema versioning |
| Compression (gzip for in-storage) | ⏳ year 2 |

## 12.2 STEP (neutral exchange)
| Capability | NexyFab target |
|---|---|
| STEP AP203 read | 🔧 partial via brep-bridge |
| STEP AP203 write | ⏳ year 2 |
| STEP AP214 read (mechanical assembly) | ⏳ year 2 |
| STEP AP214 write (with assembly hierarchy) | ⏳ year 2 |
| STEP AP242 read (with PMI: dims, tolerances) | ⏳ year 3 |
| STEP AP242 write (with PMI) | ⏳ year 4 |
| STEP healing (auto-fix bad faces on import) | ⏳ year 3 |
| STEP units handling (mm/inch/m) | ⏳ year 2 |
| STEP assembly explode (sub-assemblies → instances) | ⏳ year 3 |
| STEP attribute preservation (material, name, color) | ⏳ year 3 |

## 12.3 IGES
| Capability | NexyFab target |
|---|---|
| IGES read (surfaces + curves) | ⏳ year 3 |
| IGES write | ⏳ year 3 |
| IGES type 144 trimmed surface support | ⏳ year 4 |

## 12.4 Parasolid + ACIS
| Capability | NexyFab target |
|---|---|
| Parasolid .x_t / .x_b read | ⏳ year 4 (requires Parasolid lic OR translator) |
| Parasolid write | ⏳ year 4 |
| ACIS .sat / .sab read | ⏳ year 4 |
| ACIS write | ⏳ year 5 |

## 12.5 Mesh formats
| Format | Read | Write | NexyFab target |
|---|---|---|---|
| STL ASCII | ⏳ year 2 | ✅ Phase 5.4 | binary write ⏳ year 2 |
| STL binary | ⏳ year 2 | ⏳ year 2 | |
| 3MF | ⏳ year 2 | ⏳ year 2 | with material/color metadata |
| OBJ (+ MTL) | ⏳ year 2 | ⏳ year 2 | |
| PLY (binary + ASCII) | ⏳ year 3 | ⏳ year 3 | |
| glTF / GLB | ⏳ year 2 | ⏳ year 2 | for AR/VR viewers |
| FBX | ⚪ year 3 | ⚪ year 3 | animation hard |
| AMF (additive manufacturing) | ⚪ year 4 | ⚪ year 4 | |

## 12.6 Drawing formats
| Format | Read | Write | NexyFab target |
|---|---|---|---|
| DXF R12 (ASCII) | ✅ Phase 5.3 | ✅ Phase 4.4 | |
| DXF R2007/2010/2013/2018 | ⏳ year 3 | ⏳ year 3 | |
| DWG binary | ⏳ year 3 | ⏳ year 3 | LibreDWG (free) or Teigha (paid) |
| PDF (vector / raster) | — | ⏳ year 2 | server-side via pdf-lib |
| SVG | ⏳ year 3 | ⏳ year 2 | |
| EPS / AI | ⚪ year 4 | ⚪ year 4 | |

## 12.7 Proprietary readers (STEP bridge first)
| Format | NexyFab target |
|---|---|
| SolidWorks .sldprt | ⏳ year 5+ direct; STEP bridge until then |
| SolidWorks .sldasm | ⏳ year 5+ direct |
| SolidWorks .slddrw | ⏳ year 6+ |
| Fusion .f3d | ⏳ year 5+ |
| Inventor .ipt / .iam | ⚪ year 6+ |
| Creo (Pro/E) .prt / .asm | ⚪ year 6+ |
| CATIA .CATPart / .CATProduct | ⚪ year 7+ |
| NX .prt | ⚪ year 7+ |
| Solid Edge .par / .asm | ⚪ year 7+ |
| Rhino .3dm | ⚪ year 5+ |
| Onshape (API export) | ⏳ year 3 (API integration) |

## 12.8 Misc / specialty
| Format | NexyFab target |
|---|---|
| JT (Siemens lightweight) | ⚪ year 5+ |
| HOOPS / 3D-XML | ⚪ year 5+ |
| Collada .dae | ⚪ year 4 |
| KMZ (Google Earth) | ❌ niche |
| VRML | ❌ legacy |

---

# 13 · PDM / Version Control / Collaboration (deep)

## 13.1 Vault / project workspace
| Capability | NexyFab target |
|---|---|
| Project workspace (folder of related files) | ⏳ year 2 |
| Cloud storage (S3-compatible) | ✅ existing R2 |
| Local checkout (download for offline edit) | ⏳ year 4 |
| Check-in / check-out (lock + release) | ⏳ year 3 |
| Force-check-in (admin override) | ⏳ year 3 |
| File reference tracking (where-used) | ⏳ year 3 |
| Broken link warning (referenced file missing) | ⏳ year 3 |
| Project archive (export entire project as ZIP) | ⏳ year 3 |

## 13.2 Version history
| Capability | NexyFab target |
|---|---|
| Auto-version on save | ⏳ year 2 |
| Manual version (with comment) | ⏳ year 2 |
| Version diff (parameter changes between versions) | ⏳ year 4 (CAD-aware diff is novel) |
| Version rollback (restore old version) | ⏳ year 3 |
| Compare versions visually (overlay 2 geometries, color delta) | ⏳ year 4 |
| Tag version (release v1.0) | ⏳ year 3 |
| Branch (create alternate edit path) | ⏳ year 4 (git-like, NexyFab differentiator) |
| Merge branches | ⏳ year 5 (CAD-merge is hard, AI-assisted) |
| Conflict resolution UI | ⏳ year 5 |

## 13.3 Approval workflow
| Capability | NexyFab target |
|---|---|
| Submit for review | ⏳ year 4 |
| Approver assignment | ⏳ year 4 |
| Comments on geometry (3D pins) | ⏳ year 3 |
| Approval status (draft / in-review / approved / rejected) | ⏳ year 4 |
| Email/Slack notification on state change | ⏳ year 3 |
| Sign-off (with digital signature) | ⚪ year 5 |
| Lifecycle states (concept / design / prototype / production / archived) | ⏳ year 4 |
| Release / un-release | ⏳ year 4 |
| Engineering Change Order (ECO) tracking | ⚪ year 5 |
| Effectivity dates (revision X valid from date) | ⚪ year 5 |

## 13.4 Multi-user editing (our differentiator)
| Capability | NexyFab target |
|---|---|
| Real-time multi-user editing (CRDT) | ✅ existing CollabDoc |
| Live cursor presence (see other users) | ✅ existing |
| User color identity | ✅ existing |
| Edit lock per feature (avoid conflict during heavy edit) | ⏳ year 3 |
| Comment + mention (@user) | ⏳ year 3 |
| Inline chat (per-document) | ⚪ year 4 |
| Voice + video call (within editor) | ⚪ year 5 (NexyRemote integration) |
| Screen share | ⚪ year 5 |

## 13.5 Permissions / sharing
| Capability | NexyFab target |
|---|---|
| Per-file permissions (read / edit / admin) | ⏳ year 2 |
| Per-folder inheritance | ⏳ year 3 |
| Public link share (read-only) | ⏳ year 3 |
| Embed code (iframe-able viewer) | ⏳ year 3 |
| External collaborator (limited account) | ⏳ year 3 |

---

# 14 · Plugin / API / Extensibility (deep)

## 14.1 SDK
| Capability | NexyFab target |
|---|---|
| JavaScript / TypeScript SDK | ⏳ year 2 |
| Python SDK (via WebAssembly bridge or REST) | ⏳ year 2 |
| C# SDK (for .NET users) | ⚪ year 4 |
| API key management (generate, revoke, rotate) | ⏳ year 2 |
| Rate limiting per key | ⏳ year 2 |
| Sandbox environment (dev API) | ⏳ year 3 |

## 14.2 REST API endpoints (canonical list)
| Endpoint family | NexyFab target |
|---|---|
| `POST /api/parts` create part | ⏳ year 2 |
| `GET /api/parts/:id` read part metadata | ⏳ year 2 |
| `GET /api/parts/:id/featuretree` read FeatureTree IR | ⏳ year 2 |
| `POST /api/parts/:id/feature` add feature (extrude/revolve/etc) | ⏳ year 2 |
| `PATCH /api/parts/:id/feature/:fid` edit feature param | ⏳ year 2 |
| `DELETE /api/parts/:id/feature/:fid` remove feature | ⏳ year 2 |
| `POST /api/parts/:id/sketch` create sketch | ⏳ year 2 |
| `POST /api/parts/:id/solve` re-solve sketch / re-evaluate tree | ⏳ year 2 |
| `POST /api/parts/:id/export` get STL/STEP/DXF/etc | ⏳ year 2 |
| `POST /api/parts/:id/render` get PNG render | ✅ partial via /api/extrude-render |
| Webhooks (on save, on publish, on approval) | ⏳ year 3 |
| OAuth 2.0 / OIDC | ⏳ year 2 (existing auth-server) |

## 14.3 Plugin marketplace
| Capability | NexyFab target |
|---|---|
| Plugin discovery page | ⏳ year 3 |
| Plugin install / uninstall | ⏳ year 3 |
| Plugin permissions (limited API surface) | ⏳ year 3 |
| Plugin review / curation | ⏳ year 4 |
| Revenue share (paid plugins) | ⏳ year 4 |
| Featured plugins | ⏳ year 4 |

## 14.4 Macro / automation
| Capability | NexyFab target |
|---|---|
| Macro recording (record user actions → script) | ⏳ year 3 |
| Macro playback | ⏳ year 3 |
| Macro editor (JS/TS) | ⏳ year 3 |
| Trigger on event (file save, geometry change) | ⏳ year 4 |
| Scheduled batch (run macro on schedule) | ⏳ year 4 |
| Custom toolbar buttons | ⏳ year 3 |
| Custom shortcuts | ⏳ year 3 |

## 14.5 LLM / AI tool-calling
| Capability | NexyFab target |
|---|---|
| Function-calling spec for sketch operations | ✅ existing scad-agent |
| Function-calling spec for feature tree operations | ✅ existing |
| Vision (LLM sees viewport, suggests next step) | ⏳ year 3 |
| Multi-turn conversation memory | ⏳ year 3 |
| RAG over user's project corpus | ⚪ year 4 |

---

# 15 · AI Features (our deepest differentiator)

(Phase 6 already covers stubs. Below extends for full SW/Fusion-beating set.)

## 15.1 Natural language → CAD
| Capability | NexyFab target |
|---|---|
| NL → sketch entity (line, circle, rect) | ✅ existing sketchAssistant |
| NL → sketch constraint (horizontal, perpendicular) | ✅ |
| NL → dimension (with value) | ✅ |
| NL → feature operation (extrude, fillet) | ✅ featureTreeAssistant |
| NL → assembly mate ("concentric this bolt to that hole") | ⏳ year 3 |
| NL → drawing annotation ("add a dimension between these edges") | ⏳ year 3 |
| Multi-step NL ("design a bracket 50mm wide with 4 mounting holes") | ⏳ year 3 |
| Conversation memory across turns | ⏳ year 3 |
| Suggestion confidence display | ✅ existing Suggestion type |
| User confirmation before destructive ops | ⏳ year 2 |

## 15.2 Image / sketch input
| Capability | NexyFab target |
|---|---|
| Photo → CAD part candidate (image-to-intent) | ✅ existing |
| Hand-drawn sketch trace → vector sketch | 🔧 existing partial |
| Whiteboard sketch on iPad → 3D model | ⏳ year 4 |
| Reference image background in sketch (with auto-scale) | ⏳ year 3 |
| Reverse engineering — mesh STL → parametric feature tree | ✅ existing reverse_engineer_mesh |
| Reverse engineering — point cloud (LiDAR scan) → parametric | ⚪ year 5 |

## 15.3 Design assistance
| Capability | NexyFab target |
|---|---|
| Inline DFM warnings (wall thickness, draft, sharp corners) | ✅ existing |
| Cost estimate (per-feature + material + machining time) | ✅ existing Phase B |
| Auto-dimension placement on drawing | ⚪ year 4 |
| Auto-constraint inference in sketch | 🔧 existing autoConstraintInference |
| Suggest next feature (LLM looks at current state) | ⏳ year 3 |
| Generative design (topology optimization for given loads) | ⚪ year 5 |
| Lightweighting (auto-remove material while keeping strength) | ⚪ year 5 |
| Lattice generation (infill structure for 3D printing) | ⚪ year 5 |
| Auto-fillet (suggest where, with smart radii) | ⏳ year 4 |
| Auto-draft (suggest draft for moldability) | ⚪ year 5 |

## 15.4 Multi-modal
| Capability | NexyFab target |
|---|---|
| Voice input (Whisper → command) | ⏳ year 2 |
| Voice output (TTS feedback "Sketch closed") | ⚪ year 4 |
| Gesture (iPad pinch/rotate during sketch) | ⏳ year 3 |
| AR mode (project model into camera view) | ⚪ year 5 |
| Stylus pressure sensitivity (Apple Pencil → sketch line weight) | ⚪ year 4 |

## 15.5 AI quality / safety
| Capability | NexyFab target |
|---|---|
| 10-layer geometry verify chain | ✅ existing |
| Provenance log (which AI made which decision) | ⏳ year 3 |
| Rollback AI action (one-click revert) | ⏳ year 2 |
| AI cost tracking (per-user, per-feature) | ✅ existing aiMeter |
| Cost budget per user (auto-suspend when exceeded) | ✅ existing userBudget |
| AI confidence calibration (when LLM unsure, ask user) | ⏳ year 3 |
| Hallucination detection (LLM suggestion validated geometrically) | ⏳ year 3 |
| Pluggable provider chain (DeepSeek/OpenAI/Anthropic/local) | ✅ existing |

---

# 16 · UX / Performance / Platform (deep)

## 16.1 Platforms
| Platform | NexyFab target |
|---|---|
| Web (Chrome/Firefox/Safari/Edge) | ✅ existing |
| Tauri desktop (Win/Mac/Linux wrapper) | 🔧 existing |
| iPad (touch-first sketch + view) | ⏳ year 3 |
| Android tablet | ⚪ year 4 |
| Mobile phone (viewer-only) | ⏳ year 3 |
| AR headset (Vision Pro / Quest 3) viewer | ⚪ year 5 |
| Offline mode (Tauri local store) | ⏳ year 4 |

## 16.2 Performance
| Target | NexyFab target |
|---|---|
| Sketch solve < 50ms (100 entities) | ✅ already met (planegcs) |
| Feature regenerate < 500ms (single edit) | ✅ via incremental replay |
| Open 100-part assembly < 2s | ⏳ year 3 |
| Open 1000-part assembly < 5s | ⏳ year 4 (lightweight mode) |
| Open 10000-part assembly < 30s | ⚪ year 5+ |
| Drawing regeneration < 1s per sheet | ⏳ year 3 |
| Viewport 60fps with 1M triangles | ⏳ year 3 (BVH already partial) |
| Memory: 500-part assembly < 2GB RAM | ⏳ year 3 |

## 16.3 UI / customization
| Capability | NexyFab target |
|---|---|
| Customizable toolbar (drag tools in/out) | ⏳ year 3 |
| Customizable shortcuts (per user) | ⏳ year 3 |
| Workspace layouts (save/load panel arrangement) | ⏳ year 3 |
| Dark mode | ⏳ year 2 |
| High-contrast / accessibility mode | ⏳ year 3 |
| Color blind palette | ⏳ year 3 |
| Multi-monitor (drag panels to second screen) | ⏳ year 3 |
| Tabbed documents (multiple parts open) | ⏳ year 3 |
| Split-screen (compare 2 parts) | ⏳ year 4 |
| Touch-friendly UI (large buttons mode) | ⏳ year 3 |
| Quick action menu (`Q` for context menu) | ⏳ year 3 |
| Command palette (`Ctrl+P` for any action) | ⏳ year 2 (existing CommandPalette) |
| Persistent undo across session (resume from yesterday) | ⏳ year 4 |

## 16.4 Localization (existing 6-lang baseline)
| Language | NexyFab target |
|---|---|
| English | ✅ |
| Korean | ✅ |
| Japanese | ✅ |
| Chinese (Simplified) | ✅ |
| Spanish | ✅ |
| Arabic (RTL) | ✅ |
| German | ⏳ year 3 |
| French | ⏳ year 3 |
| Portuguese (Brazil) | ⏳ year 3 |
| Italian | ⏳ year 4 |
| Russian | ⚪ year 4 |
| Vietnamese | ⚪ year 4 |
| Thai | ⚪ year 5 |
| Polish | ⚪ year 5 |

---

# 17 · Enterprise / Admin / Security (deep)

## 17.1 Authentication
| Capability | NexyFab target |
|---|---|
| Email + password | ✅ existing auth-server |
| Google SSO | 🔧 existing partial |
| Microsoft SSO (Azure AD) | ⏳ year 2 |
| Okta SAML | ⏳ year 3 |
| Generic SAML | ⏳ year 3 |
| OIDC (any provider) | ⏳ year 2 |
| API key auth | ⏳ year 2 |
| OAuth 2.0 grants (auth code, client creds, device code) | ⏳ year 3 |
| MFA (TOTP, WebAuthn) | ⏳ year 2 |
| Hardware token (FIDO2 / YubiKey) | ⏳ year 3 |
| Passkey | ⏳ year 3 |
| Session timeout configuration | ⏳ year 2 |
| Password policy (length, complexity, rotation) | ⏳ year 2 |
| Login alerts (new device email) | ⏳ year 2 |

## 17.2 Authorization (RBAC)
| Capability | NexyFab target |
|---|---|
| Roles (admin, designer, viewer, approver, billing) | 🔧 existing perms infra |
| Custom roles | ⏳ year 3 |
| Per-resource ACL (file/folder/project) | ⏳ year 3 |
| Team / group | ⏳ year 2 |
| Hierarchical team | ⏳ year 3 |
| Time-limited access (guest, contractor) | ⏳ year 3 |
| IP allowlist (per tenant) | ⏳ year 3 |

## 17.3 Audit
| Capability | NexyFab target |
|---|---|
| Audit log per action (user, time, IP, before/after) | 🔧 existing audit |
| Audit log search + filter | ⏳ year 2 |
| Audit log export (CSV, SIEM-compat) | ⏳ year 3 |
| Audit log retention policy | ⏳ year 3 |
| Tamper-proof log (signed entries) | ⚪ year 4 |

## 17.4 Compliance
| Framework | NexyFab target |
|---|---|
| SOC 2 Type I | ⏳ year 1-2 |
| SOC 2 Type II | ⏳ year 2-3 |
| ISO 27001 | ⏳ year 3 |
| ISO 27018 (PII in cloud) | ⏳ year 3 |
| GDPR (EU) | 🔧 existing privacy/PII scrub |
| CCPA (California) | ⏳ year 2 |
| HIPAA (medical) | ⏳ year 3 |
| FedRAMP Moderate | ⚪ year 5 |
| ITAR / EAR (US defense) | ⏳ year 3 |
| Schrems II / data residency | ⏳ year 3 |

## 17.5 Deployment options
| Option | NexyFab target |
|---|---|
| SaaS multi-tenant (current) | ✅ |
| SaaS single-tenant (isolated infra per customer) | ⏳ year 3 |
| Private cloud (customer's AWS/GCP/Azure) | ⏳ year 3 |
| On-premise (self-hosted on customer hardware) | ⏳ year 3 (Tauri + local DB) |
| Air-gapped (no internet) | ⚪ year 4 |

## 17.6 Backup + DR
| Capability | NexyFab target |
|---|---|
| Daily backup to R2 | 🔧 existing db-backup cron |
| Point-in-time restore (granular minute-level) | ⏳ year 2 |
| Customer-initiated backup (download project ZIP) | ⏳ year 2 |
| Geographic replication | ⏳ year 3 |
| RTO < 4 hours, RPO < 1 hour | ⏳ year 3 |
| Disaster recovery test (annual) | ⏳ year 2 |

## 17.7 Licensing models
| Model | NexyFab target |
|---|---|
| Per-seat subscription (Pro $25-50/mo, Enterprise $200/mo) | 🔧 existing Stripe |
| Floating / concurrent licenses (N seats shared by M users) | ⏳ year 3 |
| Token-based (consumption: AI calls, render jobs) | ⏳ year 3 |
| Site license (unlimited users at org) | ⏳ year 3 |
| Edu / student free | ⏳ year 2 |
| Open source / academic | ⏳ year 3 |
| Trial period (14/30/60 days) | ⏳ year 2 |

## 17.8 Admin console
| Capability | NexyFab target |
|---|---|
| User management (invite, deactivate, role) | ⏳ year 2 (existing admin partial) |
| Team management | ⏳ year 2 |
| Usage dashboard (per-user, per-feature, per-AI-cost) | 🔧 existing nf_api_usage |
| License usage report | ⏳ year 3 |
| Cost forecast | ⏳ year 3 |
| Bulk user import (CSV, SCIM) | ⏳ year 3 |
| SCIM auto-provisioning | ⏳ year 3 |
| Custom branding (logo, color, domain CNAME) | ⏳ year 3 (white-label) |

---

# Implementation effort summary

| Section | Atomic features | Effort (eng-yr) | Solo+AI feasible by |
|---|---|---|---|
| 1. Sketching | ~85 | 3 | Year 2 |
| 2. Part modeling | ~110 | 5 | Year 3 |
| 3. Surface | ~25 | 3 | Year 4 |
| 4. Sheet metal | ~30 | 2 | Year 4 |
| 5. Weldments | ~12 | 1 | Year 5 |
| 6. Mold | ~10 | 2 | Year 6 |
| 7. Assembly | ~75 | 4 | Year 3 |
| 8. Drawing | ~100 | 4 | Year 3 |
| 9. CAM | ~55 | 8 | Year 8 (partner) |
| 10. FEA/CFD | ~45 | 6 | Year 8 (partner) |
| 11. Rendering | ~25 | 2 | Year 4 |
| 12. File interop | ~60 | 4 | Year 5 |
| 13. PDM / Collab | ~30 | 3 | Year 4 |
| 14. Plugin / API | ~35 | 3 | Year 4 |
| 15. AI features | ~35 | 2 | Year 2-3 (already ahead) |
| 16. UX / Platform | ~50 | 3 | Year 3 |
| 17. Enterprise | ~55 | 4 | Year 4 |
| **Total** | **~1200** | **~60** | **10 yr to full parity** |

**60 person-years = 1 solo founder × 10 yr × (AI multiplier 2-3x) = ~30-60 calendar-year solo effort,** OR **6 person × 10 yr team**, OR **20 person × 3 yr accelerated team.**

This matches the [strategic plan](./SW_FUSION_PARITY_PLAN.md): year 10 + $20-50M + 15-50 person team peak.

---

# How to use this document

1. **Every commit** — find the row(s) you touched; mark 🔧 → ✅.
2. **Quarterly** — count ✅ per section; update [coverage summary in high-level spec](./SW_FUSION_FEATURE_SPEC.md#coverage-summary).
3. **Before fundraising** — screenshot the "% shipped" per section; investors want quarter-over-quarter progress.
4. **Before adding a feature** — search this doc; if not listed, decide: extend this doc OR defer / out-of-scope.
5. **When stuck on UX decision** — read the "SW has it / Fusion has it" columns; if both = ✓, copy their UX. If neither, design ours from scratch (rare).

**Conflicts with high-level spec resolution rule:** this detailed doc is authoritative. Update the high-level spec to match when they diverge.

---

# References

- High-level spec (executive summary): [SW_FUSION_FEATURE_SPEC.md](./SW_FUSION_FEATURE_SPEC.md)
- 10-year strategic plan: [SW_FUSION_PARITY_PLAN.md](./SW_FUSION_PARITY_PLAN.md)
- Current build roadmap (where we are now): [OWN_PRO_CAD.md](../roadmap/OWN_PRO_CAD.md)
- Architecture commit: [ADR-013](../adr/013-own-pro-cad-track.md)
- Design partner kit (Y0-1 GTM): [DESIGN_PARTNER_OUTREACH_KIT.md](./DESIGN_PARTNER_OUTREACH_KIT.md)
- Webpack/Emscripten lesson (deploy pain documented): private local planning memory (not a repository artifact)
