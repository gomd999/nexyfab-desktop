# NexyFab Pro — Full SW/Fusion Parity Feature Spec

**Purpose:** The "what does done look like" canonical checklist. Every feature a pro engineer expects from SolidWorks or Fusion 360, with NexyFab Pro target state.

**Companion to:** [SW_FUSION_PARITY_PLAN.md](./SW_FUSION_PARITY_PLAN.md) (10-year strategic plan), [OWN_PRO_CAD.md](../roadmap/OWN_PRO_CAD.md) (current phased build).

**Reading guide — status legend:**
- ✅ — shipped in NexyFab Pro (IR or UI; see status column)
- 🔧 — partial; IR done, UI pending (or vice versa)
- ⏳ — planned, on roadmap
- ⚪ — deferred (post-parity / Year 5+)
- ❌ — explicitly out of scope (e.g., legacy desktop integrations)

**SW/F columns:** ✓ = yes, ~ = limited/add-on, — = no.

**Coverage tally at bottom of each section.**

---

## 1 — Sketching (2D)

The foundation. Engineers spend 30-40% of modeling time in sketch mode.

### 1.1 Sketch entities
| Feature | SW | F | NexyFab Pro target | Status |
|---|---|---|---|---|
| Point | ✓ | ✓ | ✅ via SketchSolver | IR done |
| Line (2-point) | ✓ | ✓ | ✅ | shipped |
| Construction line (centerline) | ✓ | ✓ | ⏳ | planned (toggle on existing line) |
| Polyline (multi-segment) | ✓ | ✓ | ⏳ | planned |
| Circle (center + radius) | ✓ | ✓ | ✅ | shipped |
| Circle (3-point, tangent-tangent-radius) | ✓ | ✓ | ⏳ | planned |
| Arc (center + start + end) | ✓ | ✓ | 🔧 | IR done, UI pending |
| Arc (3-point, tangent) | ✓ | ✓ | ⏳ | planned |
| Ellipse (full + partial) | ✓ | ✓ | ⏳ | planned |
| Rectangle (corner + corner) | ✓ | ✓ | ✅ | shipped |
| Rectangle (center) | ✓ | ✓ | ⏳ | planned |
| Polygon (n-sided regular) | ✓ | ✓ | ⏳ | planned |
| Slot (straight + arc + 3-point) | ✓ | ✓ | ⏳ | planned |
| Spline (B-spline through points) | ✓ | ✓ | ⏳ | planned (needs planegcs B-spline support — currently WIP upstream) |
| Spline (Bézier control points) | ✓ | ~ | ⏳ | planned |
| Conic (parabola, hyperbola) | ✓ | — | ⚪ | deferred |
| Text (sketch text on path) | ✓ | ✓ | ⏳ | planned (font outline → sketch) |
| Image trace (import + manual outline) | ~ | ✓ | 🔧 | image-to-intent partial — needs vector trace tool |

### 1.2 Sketch constraints (geometric)
| Constraint | SW | F | NexyFab Pro target | Status |
|---|---|---|---|---|
| Coincident (point/point) | ✓ | ✓ | ✅ | shipped |
| Coincident (point on line/curve) | ✓ | ✓ | ⏳ | planned (planegcs supports `point_on_line_*`) |
| Horizontal | ✓ | ✓ | ✅ | shipped |
| Vertical | ✓ | ✓ | ✅ | shipped |
| Parallel | ✓ | ✓ | ✅ | shipped |
| Perpendicular | ✓ | ✓ | ✅ | shipped |
| Tangent (line/circle, circle/circle) | ✓ | ✓ | ✅ | shipped |
| Tangent (curve/curve generic) | ✓ | ✓ | ⏳ | planned |
| Equal length / radius | ✓ | ✓ | ⏳ | planned |
| Concentric | ✓ | ✓ | ⏳ | planned |
| Midpoint | ✓ | ✓ | ⏳ | planned |
| Symmetric (about line) | ✓ | ✓ | ⏳ | planned |
| Fix (pin coordinates) | ✓ | ✓ | ✅ via `addPoint({fixed:true})` | shipped |
| Smooth (G1/G2 continuity at spline endpoints) | ✓ | ✓ | ⚪ | deferred |

### 1.3 Sketch dimensions
| Dimension | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Linear distance (point-point) | ✓ | ✓ | ✅ | shipped |
| Distance (point-line, line-line) | ✓ | ✓ | ⏳ | planned (planegcs p2l_distance exists, restricted to driving mode) |
| Aligned distance (along sketch line) | ✓ | ✓ | ⏳ | planned |
| Angular (line-line) | ✓ | ✓ | 🔧 | IR done; UI pending |
| Radius | ✓ | ✓ | ✅ via `addRadius` | shipped |
| Diameter | ✓ | ✓ | ⏳ | planned (planegcs has, restricted to driving) |
| Arc length | ✓ | ✓ | ⚪ | deferred (planegcs warns on non-driving) |
| Ordinate (baseline-based chain) | ✓ | ✓ | ⏳ | planned |
| Driving vs driven (reference) | ✓ | ✓ | ⏳ | planned (toggle in UI) |
| Equation-driven (expressions like `2*L`) | ✓ | ✓ | ⏳ | planned |
| Linked dimension (shared variable across sketches) | ✓ | ✓ | ⏳ | planned (Phase 2.7 configurations) |

### 1.4 Sketch tools
| Tool | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Trim (entity to next intersection) | ✓ | ✓ | ⏳ | planned |
| Extend (entity to next intersection) | ✓ | ✓ | ⏳ | planned |
| Offset (curve at distance) | ✓ | ✓ | ⏳ | planned |
| Fillet (sketch corner) | ✓ | ✓ | ⏳ | planned |
| Chamfer (sketch corner) | ✓ | ✓ | ⏳ | planned |
| Mirror (about line) | ✓ | ✓ | ⏳ | planned |
| Pattern (linear, circular within sketch) | ✓ | ✓ | ⏳ | planned (Phase 2.4 pattern IR covers 3D — extend to 2D) |
| Convert entities (project edge into sketch) | ✓ | ✓ | ⏳ | planned (needs Phase 2.5 reference geom UI) |
| Intersection curve (face × sketch plane) | ✓ | ✓ | ⚪ | deferred |
| Sketch on face (start sketch on selected face) | ✓ | ✓ | 🔧 | Phase 1.4 SketchPlane IR done; UI = next |
| Sketch picture (background image for tracing) | ✓ | ✓ | ⏳ | planned |
| Snap (grid, point, midpoint, tangent, perpendicular) | ✓ | ✓ | ⏳ | planned |
| Auto-constrain on draw | ✓ | ✓ | ⏳ | planned (existing infra in `autoConstraintInference.ts`) |
| Solve status indicator (under/fully/over-constrained) | ✓ | ✓ | ✅ via DoF panel | shipped |

**Coverage:** ~10/52 shipped, ~3 partial, ~33 planned, ~6 deferred. **~25% surface; 75% by year 2.**

---

## 2 — Part Modeling (3D Solid)

The bread and butter. ~50% of engineer time post-sketch.

### 2.1 Profile-based features
| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Extrude (boss/cut, blind/through/up-to-surface) | ✓ | ✓ | 🔧 | IR done (Phase 2.1, blind only). UI shipped. Up-to-surface ⏳ |
| Extrude with draft | ✓ | ✓ | ✅ via Phase 2.1 draftDegrees | shipped (IR + UI) |
| Extrude with thin feature (shell during extrude) | ✓ | ✓ | ⏳ | planned |
| Extrude both directions (two-sided/midplane) | ✓ | ✓ | ✅ | shipped (IR) |
| Revolve (axis sketch, angular range) | ✓ | ✓ | 🔧 | Phase 2.2 IR done; UI pending |
| Revolve with thin | ✓ | ✓ | ⏳ | planned |
| Sweep (single profile + path) | ✓ | ✓ | 🔧 | Phase 2.2 IR done; UI pending |
| Sweep with twist | ✓ | ✓ | ⏳ | planned |
| Sweep with guide rails | ✓ | ✓ | ⏳ | planned |
| Loft (2+ profiles) | ✓ | ✓ | 🔧 | Phase 2.2 IR done (same-count constraint); UI pending |
| Loft with guide curves | ✓ | ✓ | ⏳ | planned |
| Loft with centerline | ✓ | ✓ | ⏳ | planned |
| Boundary surface/solid (n-sided patch) | ✓ | ✓ | ⚪ | deferred |
| Rib (thin web between faces) | ✓ | ✓ | ⏳ | planned |
| Wrap (sketch onto face) | ✓ | ✓ | ⚪ | deferred |
| Dome (parametric bulge) | ✓ | ~ | ⚪ | deferred |

### 2.2 Modify features
| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Fillet (constant radius) | ✓ | ✓ | 🔧 | existing infra in `src/app/[lang]/shape-generator/features/` |
| Fillet (variable radius) | ✓ | ✓ | ⏳ | planned |
| Fillet (asymmetric) | ✓ | ✓ | ⏳ | planned |
| Fillet (face-face, full round) | ✓ | ✓ | ⏳ | planned |
| Fillet (setback at corner) | ✓ | ✓ | ⚪ | deferred |
| Chamfer (distance, distance-distance, distance-angle) | ✓ | ✓ | 🔧 | partial |
| Shell (uniform wall thickness) | ✓ | ✓ | ⏳ | planned |
| Shell (multi-thickness) | ✓ | ✓ | ⏳ | planned |
| Draft (per-face angle) | ✓ | ✓ | ⏳ | planned |
| Hole wizard (drilled, counterbore, countersink, threaded) | ✓ | ✓ | ⏳ | planned (ISO/ANSI hole tables) |
| Thread (cosmetic) | ✓ | ✓ | ⏳ | planned |
| Thread (geometric, modeled helix) | ✓ | ✓ | ⏳ | planned |
| Split (body by plane / face / sketch) | ✓ | ✓ | ⏳ | planned |
| Combine (boolean add/subtract/intersect on bodies) | ✓ | ✓ | 🔧 | existing infra (CSG panel) |
| Move/copy (translate/rotate body) | ✓ | ✓ | ⏳ | planned |
| Scale (uniform / non-uniform) | ✓ | ✓ | ⏳ | planned |
| Delete face (with optional patch) | ✓ | ✓ | ⏳ | planned |
| Replace face (with surface) | ✓ | ~ | ⚪ | deferred |
| Move face (parametric edit) | ✓ | ✓ | ⏳ | planned |
| Indent (deform body around another) | ✓ | ~ | ⚪ | deferred |
| Flex (bend / twist / taper / stretch) | ✓ | ~ | ⚪ | deferred |
| Deform (push/pull surface) | ✓ | ~ | ⚪ | deferred |

### 2.3 Reference geometry
| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Reference plane (offset, angle, through 3 pts, normal to curve, mid plane) | ✓ | ✓ | 🔧 | Phase 1.4 + 2.5 IR done (SketchPlane + Datum) |
| Reference axis (line, 2 points, intersecting planes, cylindrical) | ✓ | ✓ | 🔧 | Phase 2.5 IR done; UI pending |
| Reference point (vertex, midpoint, centroid, on curve, projection) | ✓ | ✓ | 🔧 | Phase 2.5 IR done; UI pending |
| Coordinate system (custom origin + 3 axes) | ✓ | ✓ | ⏳ | planned |
| Reference curve (project, intersection, equation-driven, split line) | ✓ | ✓ | ⏳ | planned |
| Center of mass | ✓ | ✓ | ⏳ | planned |
| Bounding box | ✓ | ✓ | ⏳ | planned |

### 2.4 Pattern + Mirror
| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Linear pattern (1D, 2D grid) | ✓ | ✓ | ✅ via Phase 2.4 IR | shipped (IR) |
| Circular pattern | ✓ | ✓ | ✅ | shipped (IR) |
| Mirror (about plane, body, face) | ✓ | ✓ | ⏳ | planned (existing infra in `features/mirror.ts`) |
| Pattern driven by curve | ✓ | ✓ | ⏳ | planned |
| Pattern driven by sketch (table) | ✓ | ✓ | ⏳ | planned |
| Pattern driven by table | ✓ | ~ | ⏳ | planned |
| Variable pattern (per-instance overrides) | ✓ | ~ | ⚪ | deferred |
| Skip-instance (mask out specific copies) | ✓ | ✓ | ⏳ | planned |
| Fill pattern (within face boundary) | ✓ | ✓ | ⏳ | planned |

### 2.5 Features tree / history
| Capability | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Feature tree panel | ✓ | ✓ | 🔧 | existing scad-agent FeatureTree UI |
| Reorder features (drag up/down) | ✓ | ✓ | ✅ via Phase 2.6.3 `move_node` IR | shipped (IR) |
| Suppress/unsuppress feature | ✓ | ✓ | ✅ via `set_suppressed` IR | shipped (IR) |
| Edit feature (modify params, re-solve downstream) | ✓ | ✓ | ✅ via incremental replay (Phase 2.6.2) | shipped (IR) |
| Roll back to point in tree | ✓ | ✓ | ⏳ | planned |
| Parent/child relationship display | ✓ | ✓ | ⏳ | planned (downstream tracking in IR) |
| Equation manager (variables across features) | ✓ | ✓ | ⏳ | planned |
| What's wrong dialog (broken/missing references) | ✓ | ✓ | ⏳ | planned |
| Rebuild / force-rebuild | ✓ | ✓ | ✅ via `replayTree` | shipped |

### 2.6 Configurations (parametric variants)
| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Multiple configurations per part | ✓ | ~ | 🔧 | existing ConfigStore + ConfigurationsManagerPanel |
| Design table (Excel-driven variants) | ✓ | ✓ | ⏳ | planned (ConfigurationTable UI exists) |
| Suppress features per config | ✓ | ~ | ⏳ | planned |
| Override dimensions per config | ✓ | ~ | ⏳ | planned |
| Display state (color/visibility) | ✓ | ~ | ⏳ | planned |

**Coverage Part section:** ~5 shipped + ~10 partial + ~50 planned + ~10 deferred = **~15% surface today; ~70% by year 3-4.**

---

## 3 — Surface Modeling

Year 3-4 territory. Required for consumer products, automotive trim, ergonomic shells.

| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Extruded surface | ✓ | ✓ | ⏳ | year 3 |
| Revolved surface | ✓ | ✓ | ⏳ | year 3 |
| Swept surface | ✓ | ✓ | ⏳ | year 3 |
| Lofted surface | ✓ | ✓ | ⏳ | year 3 |
| Boundary surface (n-sided patch with G2 continuity) | ✓ | ✓ | ⏳ | year 3-4 |
| Filled surface (close hole between curves) | ✓ | ✓ | ⏳ | year 3-4 |
| Knit surfaces (join into closed body) | ✓ | ✓ | ⏳ | year 3-4 |
| Surface fillet (between two surfaces) | ✓ | ✓ | ⏳ | year 3-4 |
| Surface trim (one surface by another) | ✓ | ✓ | ⏳ | year 3-4 |
| Surface extend (extend boundary) | ✓ | ✓ | ⏳ | year 3-4 |
| Surface offset | ✓ | ✓ | ⏳ | year 3-4 |
| Ruled surface | ✓ | ✓ | ⏳ | year 4 |
| Coons patch / NURBS sculpting | ✓ | ✓ | ⚪ | year 5+ |
| Class-A surface tools (Alias-grade) | ~ | — | ❌ | out of scope — separate industry |
| T-spline / freeform sculpting (Fusion Form) | — | ✓ | ⚪ | year 5+ |
| Surface analysis (curvature, zebra, draft) | ✓ | ✓ | ⏳ | year 4 |

**Coverage:** 0/16 today. **Target: 60% by year 4.**

---

## 4 — Sheet Metal

Year 3-4. Required for any shop doing brackets/enclosures.

| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Base flange (from sketch) | ✓ | ✓ | ⏳ | year 3 |
| Edge flange (on existing body edge) | ✓ | ✓ | ⏳ | year 3 |
| Miter flange (around corners) | ✓ | ✓ | ⏳ | year 3 |
| Hem (open/closed/teardrop/rolled) | ✓ | ✓ | ⏳ | year 3 |
| Jog (offset with bend) | ✓ | ✓ | ⏳ | year 3 |
| Tab + slot | ✓ | ✓ | ⏳ | year 3 |
| Sheet metal corner relief (rectangular/circular/tear) | ✓ | ✓ | ⏳ | year 3 |
| Bend table (gauge/k-factor lookup) | ✓ | ✓ | ⏳ | year 3 |
| Unfold/fold (visualize flat pattern) | ✓ | ✓ | ⏳ | year 3 |
| Flat pattern (export DXF for laser/punch) | ✓ | ✓ | ⏳ | year 3 |
| Lofted bend | ✓ | ~ | ⏳ | year 4 |
| Swept flange | ✓ | ~ | ⏳ | year 4 |
| Cross break (sheet stiffening) | ✓ | — | ⚪ | year 5+ |
| Vent (HVAC opening pattern) | ✓ | — | ⚪ | year 5+ |
| Forming tool (custom punches) | ✓ | ~ | ⚪ | year 5+ |
| Convert solid to sheet metal | ✓ | ✓ | ⏳ | year 4 |

**Coverage:** 0/16 today. **Target: 70% by year 4.**

---

## 5 — Weldments

Year 4-5. Structural-member modeling (frames, scaffolds, brackets).

| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Structural member (profile sketch swept along path) | ✓ | ~ | ⏳ | year 4 |
| Standard profile library (ISO/ANSI tube, angle, channel, beam) | ✓ | ~ | ⏳ | year 4 |
| Trim/extend (one member to another) | ✓ | ~ | ⏳ | year 4 |
| End cap | ✓ | ~ | ⏳ | year 4 |
| Gusset | ✓ | — | ⏳ | year 4 |
| Fillet bead (weld symbol + visual bead) | ✓ | ~ | ⏳ | year 4 |
| Cut list (BOM of members with lengths) | ✓ | ~ | ⏳ | year 4 |

**Coverage:** 0/7 today. **Target: 60% by year 5.**

---

## 6 — Mold / Tooling (parting line, core-cavity)

Year 5+. Required for plastic injection mold design.

| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Draft analysis | ✓ | ✓ | ⚪ | year 5 |
| Undercut detection | ✓ | ✓ | ⚪ | year 5 |
| Parting line | ✓ | ~ | ⚪ | year 5+ |
| Parting surface | ✓ | ~ | ⚪ | year 5+ |
| Shut-off surface | ✓ | ~ | ⚪ | year 6+ |
| Core/cavity split | ✓ | ~ | ⚪ | year 6+ |
| Mold base (tool body template) | ✓ | — | ⚪ | year 6+ |
| Cooling channel | ~ | — | ⚪ | year 7+ |

**Coverage:** 0/8. **Target: 50% by year 7.**

---

## 7 — Assembly

Year 2-3 primary build. Required for any product with > 1 part.

### 7.1 Parts management
| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Insert component (from part file / library) | ✓ | ✓ | 🔧 | AssemblyState IR + PartInstance |
| Sub-assembly (nest within assembly) | ✓ | ✓ | ✅ via Phase 3.5 IR | shipped (IR) |
| Component instance (multiple copies of same part) | ✓ | ✓ | ✅ | shipped (IR) |
| Component pattern (linear / circular / sketch) | ✓ | ✓ | ⏳ | year 3 |
| Component mirror | ✓ | ✓ | ⏳ | year 3 |
| Fix / float (lock world position) | ✓ | ✓ | ✅ via `setPartFixed` | shipped (IR) |
| Hide / show | ✓ | ✓ | ⏳ | UI year 2 |
| Suppress component | ✓ | ✓ | ⏳ | UI year 2 |
| Component visibility per configuration | ✓ | ~ | ⏳ | year 3 |
| Lightweight mode (large assembly performance) | ✓ | ~ | ⏳ | year 4 |

### 7.2 Mates / joints
| Mate type | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Coincident (face/face, edge/edge, point/point) | ✓ | ✓ | ✅ Phase 3.1 + 3.2 | shipped (IR + solver) |
| Concentric (axis/axis, axis/edge) | ✓ | ✓ | ✅ | shipped |
| Distance | ✓ | ✓ | ✅ | shipped |
| Angle | ✓ | ✓ | ✅ | shipped |
| Parallel | ✓ | ✓ | ✅ | shipped |
| Perpendicular | ✓ | ✓ | ✅ | shipped |
| Tangent | ✓ | ✓ | 🔧 | IR done; analytical solver pending |
| Symmetric | ✓ | ~ | ⏳ | year 2 |
| Width (centered between faces) | ✓ | ~ | ⏳ | year 2 |
| Path mate (along curve) | ✓ | ~ | ⏳ | year 3 |
| Linear coupler (gear, rack-pinion) | ✓ | ~ | ⏳ | year 3 |
| Hinge mate (combined coincident + concentric) | ✓ | ~ | ⏳ | year 3 |
| Slot mate | ✓ | ~ | ⏳ | year 3 |
| Cam follower | ✓ | — | ⚪ | year 4+ |
| Limit mate (range of motion) | ✓ | ✓ | ⏳ | year 3 |

### 7.3 Assembly tools
| Tool | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Move component (with collision detect) | ✓ | ✓ | ⏳ | year 2 |
| Rotate component | ✓ | ✓ | ⏳ | year 2 |
| Mate reference (auto-mate to placeholder) | ✓ | ~ | ⏳ | year 3 |
| Interference detection | ✓ | ✓ | ✅ via Phase 3.4 AABB | shipped (IR) |
| Interference (exact OCCT BRepAlgo) | ✓ | ✓ | ⏳ | year 3 |
| Clearance verification | ✓ | ✓ | ⏳ | year 3 |
| Mass properties (assembly total) | ✓ | ✓ | ⏳ | year 2 |
| Center of mass | ✓ | ✓ | ⏳ | year 2 |
| Section view (assembly cut by plane) | ✓ | ✓ | ⏳ | year 2 |
| Exploded view (animated separation) | ✓ | ✓ | ⏳ | year 3 |
| Exploded animation playback | ✓ | ✓ | ⏳ | year 3 |
| Smart fasteners (auto-insert hardware) | ✓ | ~ | ⏳ | year 4 |
| Toolbox (standard parts catalog) | ✓ | ~ | ⏳ | year 4 |
| Component contact / physics (free dragging with collisions) | ✓ | ✓ | ⚪ | year 5+ |

### 7.4 Motion + simulation
| Capability | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Motion study (single mate driven) | ✓ | ✓ | ✅ via Phase 3.6 | shipped (IR) |
| Multi-param motion study | ✓ | ✓ | ⏳ | year 3 |
| Time-based animation (key frames) | ✓ | ✓ | ⏳ | year 3 |
| Motion analysis (forces, accel, gravity) | ✓ | ✓ | ⚪ | year 5+ (separate engine) |
| Spring / damper / contact forces | ✓ | ~ | ⚪ | year 5+ |
| Trace path of point through motion | ✓ | ✓ | ⏳ | year 3 |
| Export motion to video | ✓ | ✓ | ⏳ | year 3 |

**Coverage Assembly:** ~10 shipped (IR) + ~5 partial + ~25 planned + ~5 deferred. **~25% IR; need UI build year 2-3.**

---

## 8 — Drawing (2D Documentation Output)

Year 2-3. Without this nothing ships to a machinist.

### 8.1 Sheet + views
| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Sheet template (A0..A4 / ANSI A..E / custom) | ✓ | ✓ | ✅ via Phase 4.1 IR | shipped (IR) |
| Multi-sheet document | ✓ | ✓ | 🔧 | IR done; UI year 2 |
| Title block (editable) | ✓ | ✓ | ⏳ | year 2 |
| Standard 3-view auto-layout | ✓ | ✓ | ✅ via `standardThreeViewSheet` | shipped (IR) |
| Custom view from named direction | ✓ | ✓ | ⏳ | year 2 |
| Auxiliary view (project off edge) | ✓ | ✓ | 🔧 | IR done; UI year 2 |
| Section view (full / half / offset / aligned) | ✓ | ✓ | 🔧 | IR done (full only); UI year 2 |
| Detail view (zoom inset) | ✓ | ✓ | 🔧 | IR done; UI year 2 |
| Broken view (long part with break) | ✓ | ✓ | ⏳ | year 3 |
| Crop view | ✓ | ✓ | ⏳ | year 3 |
| Empty view (drawing-only sketch) | ✓ | ✓ | ⏳ | year 3 |
| Exploded view from assembly | ✓ | ✓ | ⏳ | year 3 |
| Alternate position view | ✓ | ~ | ⚪ | year 4+ |
| Tangent edge display (visible/hidden/no) | ✓ | ✓ | ⏳ | year 2 |
| Hidden line display | ✓ | ✓ | ⏳ | year 2 (needs OCCT HLR) |

### 8.2 Dimensions + annotations
| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Linear / aligned dimension | ✓ | ✓ | ✅ Phase 4.2 IR | shipped (IR) |
| Radial / diametric dimension | ✓ | ✓ | ✅ | shipped (IR) |
| Angular dimension | ✓ | ✓ | ✅ | shipped (IR) |
| Baseline / chain / ordinate | ✓ | ✓ | ⏳ | year 2 |
| Auto-dimension (per view, from sketch) | ✓ | ✓ | ⏳ | year 2 |
| Tolerance (bilateral / unilateral / limit / fit) | ✓ | ✓ | ✅ Phase 4.2 IR | shipped (IR) |
| GD&T (ASME Y14.5 — 14 symbols) | ✓ | ✓ | 🔧 | Phase 4.2 IR has 7 of 14; rest year 2 |
| Datum feature symbol | ✓ | ✓ | ⏳ | year 2 |
| Feature control frame | ✓ | ✓ | ⏳ | year 2 |
| Surface finish symbol | ✓ | ✓ | ⏳ | year 2 |
| Weld symbol (AWS / ISO) | ✓ | ✓ | ⏳ | year 3 (along with weldments) |
| Centerline / center mark | ✓ | ✓ | ⏳ | year 2 |
| Note (free text, leader) | ✓ | ✓ | ⏳ | year 2 |
| Hole callout (auto from hole feature) | ✓ | ✓ | ⏳ | year 2 |
| Hole table | ✓ | ✓ | ⏳ | year 3 |
| Revision cloud | ✓ | ✓ | ⏳ | year 3 |
| Revision table | ✓ | ✓ | ⏳ | year 3 |

### 8.3 BOM + tables
| Feature | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Auto-BOM from assembly | ✓ | ✓ | ✅ Phase 4.3 IR | shipped (IR) |
| BOM (indented vs flat) | ✓ | ✓ | ⏳ | year 2 |
| BOM custom columns (material/cost/vendor) | ✓ | ✓ | ✅ | shipped (IR; metadataLookup) |
| Bubble balloon (auto-number on view) | ✓ | ✓ | ⏳ | year 2 |
| Auto-balloon (place on all components) | ✓ | ✓ | ⏳ | year 2 |
| Cut list table (sheet metal / weldments) | ✓ | ✓ | ⏳ | year 3 |
| General table (custom) | ✓ | ✓ | ⏳ | year 3 |

### 8.4 Export
| Format | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| PDF | ✓ | ✓ | ⏳ | year 2 (server-side via pdf-lib or headless) |
| DXF | ✓ | ✓ | ✅ Phase 4.4 IR + 5.3 read | shipped (IR) |
| DWG | ✓ | ✓ | ⏳ | year 3 (LibreDWG or Teigha) |
| SVG | ~ | ✓ | ⏳ | year 2 |
| Print (paper) | ✓ | ✓ | ⏳ | year 2 (PDF + browser print) |

**Coverage Drawing:** ~7 shipped (IR) + ~6 partial + ~30 planned. **~20% IR done; full UI year 2-3.**

---

## 9 — Manufacturing / CAM

Year 5+ for native. Year 2 for partner-integration handoff.

### 9.1 CAM operations
| Operation | SW (with SW CAM) | Fusion CAM | NexyFab Pro | Status |
|---|---|---|---|---|
| 2.5-axis profile / pocket | ✓ | ✓ | ⚪ | year 5+ native; year 2 partner integration |
| Drilling cycles (peck, breakthrough) | ✓ | ✓ | ⚪ | year 5+ |
| Engraving | ✓ | ✓ | ⚪ | year 5+ |
| Face mill | ✓ | ✓ | ⚪ | year 5+ |
| Adaptive clearing | ~ | ✓ | ⚪ | year 6+ |
| 3-axis contour | ✓ | ✓ | ⚪ | year 5+ |
| 3+2 (positioned 5-axis) | ~ | ✓ | ⚪ | year 6+ |
| Full 5-axis simultaneous | ~ | ✓ | ❌ | out of scope or year 10+ |
| Turning (lathe) | ✓ | ✓ | ⚪ | year 5+ |
| Mill-turn (combined) | ~ | ✓ | ⚪ | year 6+ |
| Wire EDM | ~ | ~ | ❌ | out of scope |
| Probe (CMM) | ~ | ~ | ❌ | out of scope |
| Additive (FDM/SLA toolpath) | — | ✓ | ⏳ | year 4 (3D-printing user overlap) |
| Setup sheet generation | ✓ | ✓ | ⏳ | year 5+ |
| Post-processor library | ✓ | ✓ | ⏳ | year 5+ (community + paid partners) |
| G-code export | ✓ | ✓ | ⏳ | year 5+ |
| Toolpath simulation | ✓ | ✓ | ⏳ | year 5+ |
| Material removal verification | ✓ | ✓ | ⚪ | year 6+ |
| Tool library | ✓ | ✓ | ⏳ | year 5+ |
| Cost estimate (per-feature pricing) | ~ | ~ | 🔧 | existing Phase B quoting; can extend to per-toolpath year 5 |

**Coverage:** 0/19 today. **Realistic native target: 30% by year 7 via partner+build. Without partnerships, 50% by year 10.**

---

## 10 — Simulation (FEA / CFD / Thermal)

Year 5+ native; year 3 partner integration.

### 10.1 FEA (structural)
| Capability | SW Simulation | Fusion FEA | NexyFab Pro | Status |
|---|---|---|---|---|
| Linear static stress | ✓ | ✓ | ⚪ | year 5+ native; year 3 Ansys/CalculiX integration |
| Modal (natural frequency) | ✓ | ✓ | ⚪ | year 5+ |
| Buckling | ✓ | ~ | ⚪ | year 6+ |
| Thermal (steady-state) | ✓ | ✓ | ⚪ | year 6+ |
| Thermal (transient) | ✓ | ~ | ⚪ | year 7+ |
| Nonlinear (contact / large deflection) | ✓ | ~ | ⚪ | year 8+ |
| Fatigue | ✓ | ~ | ⚪ | year 7+ |
| Drop test | ✓ | — | ⚪ | year 8+ |
| Pressure vessel | ✓ | — | ❌ | out of scope |
| Auto-meshing (tetra / hex) | ✓ | ✓ | ⚪ | year 5+ |
| Mesh refinement / adaptive | ✓ | ✓ | ⚪ | year 6+ |
| Result visualization (stress contour, deformation, factor of safety) | ✓ | ✓ | ⚪ | year 5+ |
| Report generation | ✓ | ✓ | ⚪ | year 5+ |

### 10.2 CFD (flow)
| Capability | SW Flow Sim | Fusion Flow | NexyFab Pro | Status |
|---|---|---|---|---|
| External flow (around body) | ✓ | ~ | ❌ | out of scope or year 10+ |
| Internal flow (through cavity) | ✓ | ~ | ❌ | out of scope or year 10+ |
| Heat transfer with flow | ✓ | ~ | ❌ | out of scope |

**Coverage:** 0/16. **Realistic: 30% by year 8 (FEA only).**

---

## 11 — Rendering / Visualization

Year 2-3.

| Feature | SW Visualize | Fusion Render | NexyFab Pro | Status |
|---|---|---|---|---|
| Real-time PBR preview in viewport | ✓ | ✓ | ⏳ | year 2 (Three.js already capable) |
| HDRI environment lighting | ✓ | ✓ | ⏳ | year 2 |
| Material library (200+ presets) | ✓ | ✓ | ⏳ | year 3 |
| Custom material editor | ✓ | ✓ | ⏳ | year 3 |
| Camera positioning + bookmarks | ✓ | ✓ | ⏳ | year 2 |
| Path-traced final render (CPU/GPU) | ✓ | ✓ | ⏳ | year 4 (cloud-rendered) |
| Turntable animation | ✓ | ✓ | ⏳ | year 3 |
| Decals + stickers | ✓ | ✓ | ⏳ | year 3 |
| Exploded view render | ✓ | ✓ | ⏳ | year 3 |

**Coverage:** 0/9. **Target: 50% by year 3.**

---

## 12 — File Interop

Critical for adoption. Year 1-3.

### 12.1 Native formats
| Format | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Own native format | .sldprt / .sldasm / .slddrw | .f3d | NexyFab JSON (FeatureTree + AssemblyState + Drawings) | ⏳ year 1 schema lock |

### 12.2 Neutral exchange
| Format | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| STEP AP203 (geometry only) | ✓ R/W | ✓ R/W | 🔧 | partial existing in `brep-bridge` |
| STEP AP214 (mechanical) | ✓ R/W | ✓ R/W | ⏳ | year 2 |
| STEP AP242 (with PMI) | ✓ R/W | ~ R | ⏳ | year 3 |
| IGES | ✓ R/W | ✓ R/W | ⏳ | year 3 |
| Parasolid (.x_t / .x_b) | ✓ R/W | ~ R | ⏳ | year 4 (requires kernel decision) |
| ACIS (.sat / .sab) | ✓ R/W | ~ R | ⏳ | year 4 |
| JT (Siemens lightweight) | ✓ R/W | ~ R | ⚪ | year 5+ |
| 3D PDF | ✓ E | ~ E | ⏳ | year 3 |

### 12.3 Mesh formats
| Format | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| STL (ASCII + binary) | ✓ R/W | ✓ R/W | ✅ Phase 5.4 ASCII W + existing R | shipped (W IR); binary year 2 |
| 3MF | ✓ R/W | ✓ R/W | ⏳ | year 2 |
| OBJ | ✓ R/W | ✓ R/W | ⏳ | year 2 |
| PLY | ✓ R/W | ~ R | ⏳ | year 3 |
| glTF / GLB | ~ E | ✓ E | ⏳ | year 2 (Three.js native) |

### 12.4 Drawing formats
| Format | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| DXF | ✓ R/W | ✓ R/W | ✅ Phase 4.4 W + Phase 5.3 R | shipped (IR both) |
| DWG | ✓ R/W | ✓ R/W | ⏳ | year 3 (LibreDWG or Teigha) |
| PDF | ✓ E | ✓ E | ⏳ | year 2 |

### 12.5 Proprietary readers
| Format | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| SolidWorks (.sldprt, .sldasm) | ✓ own | ~ R | ⏳ year 5+ (STEP bridge only until then) |
| Fusion (.f3d) | — | ✓ own | ⏳ year 5+ (STEP bridge only) |
| Inventor (.ipt) | ~ R | ~ R | ⚪ year 5+ |
| Creo (.prt) | ~ R | ~ R | ⚪ year 5+ |
| CATIA (.CATPart) | ~ R | ~ R | ⚪ year 6+ |
| NX (.prt) | ~ R | ~ R | ⚪ year 6+ |

**Coverage:** ~3 shipped + ~2 partial + ~15 planned + ~6 deferred. **~10% today; 70% by year 5.**

---

## 13 — PDM / Version Control / Collaboration

Year 2-4. Critical for team workflows.

| Feature | SW PDM | Fusion (cloud) | NexyFab Pro | Status |
|---|---|---|---|---|
| Check-in / check-out | ✓ | ~ (cloud lock) | ⏳ | year 3 |
| Version history (per file) | ✓ | ✓ | 🔧 | existing CRDT/history infra |
| Branch / merge (CAD-aware diff) | — | ~ | ⏳ | year 4 (NexyFab differentiator) |
| Where-used (find references to a part) | ✓ | ~ | ⏳ | year 3 |
| Approval workflow | ✓ | ~ | ⏳ | year 4 |
| Release / lifecycle states | ✓ | ~ | ⏳ | year 4 |
| File lock (prevent concurrent edit) | ✓ | ~ | ⏳ | year 2 |
| Multi-user editing (CRDT real-time) | — | — | ✅ existing CollabDoc | shipped — **differentiator** |
| Live presence cursors | — | — | ✅ existing | shipped — **differentiator** |
| Comments + threads on geometry | ~ | ✓ | ⏳ | year 3 |
| Cloud project workspace | ~ | ✓ | ⏳ | year 2 |
| Permissions (read/edit/admin per user) | ✓ | ✓ | ⏳ | year 2 |

**Coverage:** 2 shipped (collab) + 1 partial + ~9 planned. **~20% today; 70% by year 4.**

---

## 14 — Plugin / API / Extensibility

Year 2 to start; ongoing forever.

| Capability | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| C++/COM SDK (desktop only) | ✓ | — | ❌ | not applicable (cloud) |
| Python API (Fusion-style) | — | ✓ | ⏳ | year 2 |
| JavaScript / TypeScript SDK (cloud-native) | — | ~ | ⏳ | year 2 (NexyFab differentiator) |
| REST API for CAD operations | ~ | ✓ | ⏳ | year 2 |
| Webhook events (on save, on publish) | ~ | ✓ | ⏳ | year 3 |
| Plugin marketplace (curated) | ✓ | ✓ | ⏳ | year 3 |
| Macro recording (record + replay user actions) | ✓ | ✓ | ⏳ | year 3 |
| Custom feature definition | ✓ | ✓ | ⏳ | year 4 |
| LLM tool-calling integration (Phase 6 AI) | — | ~ | ✅ via scad-agent | shipped |

**Coverage:** 1 shipped + ~7 planned + 1 N/A. **~10% today.**

---

## 15 — AI Features (our differentiator)

Year 0-ongoing. **This is what wins us users vs SW.**

| Feature | SW Copilot | Fusion AI | NexyFab Pro | Status |
|---|---|---|---|---|
| NL → sketch suggestions | ~ (beta) | ~ | ✅ shipped via Phase 6 sketchAssistant | shipped |
| NL → feature tree edit | — | ~ | ✅ shipped via featureTreeAssistant | shipped |
| LLM provider chain (DeepSeek/OpenAI/Anthropic/local) | — | — | ✅ existing | shipped — differentiator |
| Image → sketch / part | — | ~ | ✅ existing image-to-intent | shipped |
| Hand-drawn sketch trace | — | ~ | 🔧 existing partial | partial |
| Reverse engineering (mesh → parametric) | — | ~ | ✅ existing reverse_engineer_mesh | shipped |
| AI verify chain (geometry validity) | — | — | ✅ existing 10-layer | shipped — differentiator |
| DFM inline warnings (real-time) | — | ~ | ✅ existing | shipped |
| Cost estimate from CAD | ~ | ✓ | ✅ existing Phase B | shipped |
| Auto-dimension suggestion | — | ~ | ⏳ | year 2 |
| Constraint inference from sketch | ~ | ~ | 🔧 existing `autoConstraintInference` | partial |
| NL revision history ("undo the rib") | — | — | ✅ via featureTreeAssistant | shipped (IR) |
| Voice input → CAD command | — | — | ⏳ | year 2 |
| AI assembly suggest (likely mate from geometry) | — | — | ⏳ | year 3 |
| Generative design (topology optimization) | ✓ | ✓ | ⚪ | year 5+ |
| Latticing / lightweighting | ~ | ✓ | ⚪ | year 5+ |

**Coverage:** ~10 shipped + ~3 partial + ~3 planned + ~2 deferred. **~75% today — already AHEAD of competitors here.**

---

## 16 — UX / Performance / Platform

| Capability | SW | F | NexyFab Pro | Status |
|---|---|---|---|---|
| Desktop app (Win/Mac/Linux) | ✓ Win only | ✓ Win/Mac | 🔧 existing Tauri wrapper | partial |
| Web app | — | ✓ | ✅ Next.js production | shipped — differentiator |
| Mobile viewer (iOS/Android) | ~ | ✓ | ⏳ | year 3 |
| Touch / iPad sketch | — | ✓ | ⏳ | year 3 |
| Offline mode | ✓ | ~ | ⏳ | year 3 (Tauri local store) |
| Auto-save | ✓ | ✓ | ✅ existing AutoSaveIndicator | shipped |
| Crash recovery | ✓ | ✓ | ⏳ | year 2 |
| Undo / redo (per-feature granular) | ✓ | ✓ | ✅ Phase 2.6 UndoStack | shipped (IR) |
| Multi-window | ✓ | ✓ | ⏳ | year 3 |
| Customizable UI (panels, shortcuts) | ✓ | ✓ | ⏳ | year 3 |
| Theme (light / dark / custom) | ~ | ✓ | ⏳ | year 2 |
| Multi-monitor support | ✓ | ✓ | ⏳ | year 3 |
| Keyboard shortcut customization | ✓ | ✓ | ⏳ | year 3 |
| Performance: 1000-part assembly < 2s open | ✓ | ✓ | ⏳ | year 3 |
| Performance: 10K-part assembly | ✓ | ~ | ⏳ | year 5+ |

**Coverage:** 3 shipped + 1 partial + ~11 planned. **~30% today; 70% by year 3.**

---

## 17 — Enterprise / Admin / Security

Year 2-3.

| Capability | SW (corp) | F (Team) | NexyFab Pro | Status |
|---|---|---|---|---|
| SSO (SAML / OIDC) | ✓ | ✓ | 🔧 existing auth-server | partial |
| RBAC (role-based access) | ✓ | ✓ | 🔧 existing perms infra | partial |
| Audit log (every action) | ✓ | ✓ | 🔧 existing ai-history + admin-audit | partial |
| SOC 2 Type I | ✓ | ✓ | ⏳ | year 1-2 |
| SOC 2 Type II | ✓ | ✓ | ⏳ | year 2-3 |
| GDPR compliance | ✓ | ✓ | 🔧 existing privacy/PII scrub | partial |
| HIPAA (medical device) | ~ | ~ | ⚪ | year 3 |
| ITAR / EAR (defense) | ✓ | ~ | ⏳ | year 3 |
| On-premise / VPC deployment | ✓ | ~ | ⏳ | year 2-3 |
| Per-seat licensing model | ✓ | ✓ | 🔧 existing Stripe + Pro plans | partial |
| Floating / concurrent licensing | ✓ | ~ | ⏳ | year 3 |
| Usage analytics (per user/team) | ✓ | ✓ | 🔧 existing nf_api_usage | partial |
| Backup / point-in-time restore | ✓ | ✓ | ⏳ | year 2 |

**Coverage:** ~5 partial + ~8 planned. **~30% today; 80% by year 3 (SOC2 path).**

---

## Coverage Summary

| Area | Today % | Year-3 target | Year-5 target | Year-10 (full parity) |
|---|---|---|---|---|
| 1. Sketching | 25% | 80% | 95% | 100% |
| 2. Part modeling | 15% | 70% | 90% | 100% |
| 3. Surface | 0% | 30% | 70% | 95% |
| 4. Sheet metal | 0% | 30% | 70% | 100% |
| 5. Weldments | 0% | 0% | 60% | 95% |
| 6. Mold | 0% | 0% | 30% | 80% |
| 7. Assembly | 25% IR | 70% | 90% | 100% |
| 8. Drawing | 20% IR | 70% | 90% | 100% |
| 9. CAM | 0% | partner | 30% | 70% |
| 10. FEA | 0% | partner | 30% | 70% |
| 11. Rendering | 0% | 50% | 80% | 95% |
| 12. File interop | 10% | 60% | 80% | 90% |
| 13. PDM / Collab | 20% | 70% | 90% | 100% |
| 14. Plugin / API | 10% | 50% | 80% | 95% |
| 15. AI features | **75%** | **95%** | **100% + new categories** | (lead grows) |
| 16. UX / Perf | 30% | 70% | 90% | 100% |
| 17. Enterprise | 30% | 80% | 95% | 100% |
| **Weighted** | **~18%** | **~55%** | **~78%** | **~95%** |

**The 95% at year 10 is intentional — true 100% parity on every legacy feature is wasteful. The strategic call is to be 110% on AI + cloud + manufacturing-integration and 80% on legacy long-tail.**

---

## Build Order (next 12 months — concrete)

Given the spec above, the **next 12-month sequence** that maximizes value:

1. **Q3 2026** — Sketch UI completion (trim/extend/offset/mirror/fillet/chamfer/snap + auto-constraint) → fully shipped Section 1 ⓻
2. **Q3 2026** — Part UI for Phase 2.1-2.4 IRs (Extrude/Revolve/Sweep/Loft/Pattern/Fillet/Shell/Pattern) → 70% of Section 2 ⓼
3. **Q4 2026** — Sketch on face + Reference geometry UI → unlocks proper part workflows ⓽
4. **Q4 2026** — Assembly UI v1 (insert + mate + interference) → shipping Section 7 to ~60% ⓾
5. **Q1 2027** — Drawing UI v1 (sheet + standard views + dimension + GD&T basic + PDF + DXF) → Section 8 to ~50% ⓫
6. **Q1 2027** — File interop: STEP AP214 R/W (real-world fidelity test pass rate ≥ 90%) ⓬
7. **Q2 2027** — Configurations + Design table UI → Section 2.6 to 80% ⓭
8. **Q2 2027** — First 5 design partners onboarded, 50 paying customers, $30K MRR — **seed-ready milestone** ⓮

---

## How to use this doc

- **Quarterly:** check off the "Status" column. Update each cell honestly. Don't mark ✅ until production-shipped + smoke-tested.
- **Annually:** revisit the coverage summary. If a year's target slips, decide between push (more $/team) or trim (accept lower parity).
- **Before any feature commit:** find the row, mark it 🔧 → ✅ on merge. This doc is the canonical "what's done."
- **Before any pitch / fundraise:** screenshot the coverage table. Investors want to see the % progressing quarter-over-quarter.

---

## What's deliberately NOT here (and why)

- **Pixel-perfect SW menu replication** — copying their UI is anti-differentiation. We design for AI-first.
- **Backward-compat with SW .sldprt round-trip** — too costly, IP risk. STEP bridge is the standard.
- **PDM Vault clone** — git-style branching is our differentiator, not Vault feature-clone.
- **Drawing standards beyond ASME + ISO** — JIS / DIN / GOST handled via custom templates, not native.

---

## Pointers

- 10-year strategic plan: [SW_FUSION_PARITY_PLAN.md](./SW_FUSION_PARITY_PLAN.md)
- Current build roadmap: [OWN_PRO_CAD.md](../roadmap/OWN_PRO_CAD.md)
- Architecture commit: [ADR-013](../adr/013-own-pro-cad-track.md)
- Webpack/Emscripten lesson: [feedback_webpack_emscripten_wasm.md](../../C:/Users/gomd9/.claude/projects/C--Users-gomd9/memory/feedback_webpack_emscripten_wasm.md)
- Design partner kit: [DESIGN_PARTNER_OUTREACH_KIT.md](./DESIGN_PARTNER_OUTREACH_KIT.md), [_EXECUTION.md](./DESIGN_PARTNER_OUTREACH_EXECUTION.md)
