# MainWorkspace Decomposition — Plan, Context Shapes, Sequencing

Status snapshot: 2026-05-12. `ShapeGeneratorInner.tsx` is 8912 lines. The
panels/ folder has absorbed 44 components. What's left is the canvas region
roughly lines 6240–7600 (~1,300 lines of deeply-coupled JSX) which the
memory entry (`project_nexyfab_3d_progress.md`) tagged as a one-week
dedicated session.

This document is the design pass. It identifies which state groups live in
that region, which contexts they want to belong to, and the safe sequencing
to land the decomposition without breaking the canvas mid-edit.

## Why this is hard

Counting state-var references inside the 6240–7600 block:

- `selectedElement` / `mateFaceA` / `mateFaceB` / `mateConstraintType` — used
  by selection click, mate face picker, and the gizmo bus simultaneously.
- `isSketchMode` / `sketchPoints` / `sketchPlane` / `sketchTool` — drive
  both the sketch overlay and the canvas event handlers.
- `bomParts` / `placedParts` / `partPlacementMode` — assembly mount points.
- `effectiveResult` / `params` / `enabledFeaturesForContext` — the parametric
  result feeding ShapePreview.
- 30+ flags: `showSomething` toggles, hover state, gizmo mode, snap config.

Direct prop-drilling a MainWorkspace component would mean 60–80 props. That's
the wrong shape. The fix is to split the state into a few cohesive contexts
*before* extracting the component, so the new MainWorkspace consumes the
contexts directly instead of accepting a giant prop bag.

## Proposed contexts

Each is a Zustand or React context — choose Zustand if the state outlives
remounts, React context if it's purely render scope.

### 1. `SelectionContext` (Zustand)

```ts
interface SelectionState {
  selectedElement: SelectedElementInfo | null;
  hoveredElement: SelectedElementInfo | null;
  // Mate face picker — first/second face for a mate constraint.
  mateFaceA: FacePick | null;
  mateFaceB: FacePick | null;
  mateConstraintType: MateConstraintType | null;
  // Actions
  setSelectedElement: (el: SelectedElementInfo | null) => void;
  setHoveredElement: (el: SelectedElementInfo | null) => void;
  pickMateFaceA: (f: FacePick) => void;
  pickMateFaceB: (f: FacePick) => void;
  clearMate: () => void;
}
```

Reason for split: every canvas component touches selection, but only the
gizmo and the mate-picker touch mate state. Bundling them is fine because
they're all about "what the user picked".

### 2. `SketchContext` (Zustand)

```ts
interface SketchState {
  isSketchMode: boolean;
  activeSketchPlane: 'xy' | 'xz' | 'yz' | null;
  sketchTool: SketchToolName;
  sketchEntities: SketchEntity[];
  sketchSnap: { enabled: boolean; size: number };
  constraints: ConstraintBag;
  // Actions trimmed for brevity — see sketch/ store for full surface
}
```

Reason: sketch mode rewrites the entire canvas interaction model. Isolating
it means components can early-return when `isSketchMode` is false instead of
threading dozens of sketch props through unconditionally.

### 3. `AssemblyContext` (Zustand)

```ts
interface AssemblyState {
  bomParts: BomPart[];
  placedParts: PlacedPart[];
  partPlacementMode: 'free' | 'mate' | null;
  explodeFactor: number;
  smartFastenerPairs: FastenerPair[];
  // Actions...
}
```

Reason: assembly state was added late and was never properly factored.
Splitting it from selection means the sketch path can ignore it entirely.

### 4. `ViewportContext` (React context — render-scope only)

```ts
interface ViewportState {
  cameraMode: 'persp' | 'ortho';
  viewDir: ViewDirection;
  gizmoMode: 'translate' | 'rotate' | 'scale' | null;
  showWireframe: boolean;
  showOriginGizmo: boolean;
  snapEnabled: boolean;
  snapSize: number;
  // Actions...
}
```

Reason: purely UI; cheap to lose on remount; doesn't need Zustand
persistence. Keep it React-context-only to avoid bloating the global stores.

## Sequencing — 5 steps, one safe per session

The key constraint is the canvas must stay shippable between steps.

1. **Carve `SelectionContext` first** (Zustand store). Migrate
   `selectedElement`, `hoveredElement`, mate fields out of Inner.tsx local
   useState into the new store. Inner.tsx still imports it directly; no
   component extraction yet. → Each remaining Inner.tsx state read becomes
   a one-liner `useSelectionStore(s => s.selectedElement)`. Ship.

2. **Carve `AssemblyContext`** next. Same shape: store first, no extract.
   Touches fewer hot paths than sketch, so the canvas is less likely to
   regress. Ship.

3. **Carve `ViewportContext`** (React context). Wrap the canvas area in a
   `<ViewportProvider>` and have the gizmo, view-cube, and snap controls
   consume it. Inner.tsx becomes a thinner orchestrator. Ship.

4. **Carve `SketchContext`** last. Sketch state is the trickiest because the
   constraint solver maintains its own canonical state inside
   `sketch/constraintSolver.ts`. Sync via subscribe. Ship.

5. **Extract `MainWorkspace` component** as the final move. By now every
   piece of state it needs is in a context or store; the new component
   accepts ~5 high-level props (`lang`, `effectiveResult`, `onApplyResult`,
   `dimensions`, `unitTooltip`) and reads the rest from contexts.

## What this session leaves on the floor

This session is design only. Step 1 is the natural next concrete commit —
adding `src/app/[lang]/shape-generator/store/selectionStore.ts` and moving
the two-or-three selection fields. That single PR is ~2 hours, fully
shippable, and unlocks the next step's safe migration.

Track per-step completion in this file or in a follow-up
`mainworkspace-progress.md`. The dedicated multi-day session referenced in
the prior memory entries is the *full* 5-step run; landing one step at a
time keeps the rest of NexyFab unaffected.

## Right-now decision

Do not extract `MainWorkspace` yet. The first prerequisite is the
`SelectionContext` store carve in step 1. Until that's done, any extraction
attempt walks straight into the 60-prop trap that made the prior aborted
attempts fail.

## 2026-05-13 status update

After landing step 1 (selectionStore) the audit revealed that steps 2-4 are
*effectively already done* — just via custom hooks instead of Zustand stores:

- **Step 2 — Assembly**: `hooks/useAssemblyState.ts` already owns bodies,
  placedParts, assemblyMates, partPlacement state, and synchronizes them
  through Yjs CRDT. Moving this to a vanilla Zustand store would *break*
  CRDT collaboration — leave it as-is.
- **Step 3 — Viewport**: `useViewportState()` already owns sectionActive,
  sectionAxis, transformMode, snapEnabled, snapSize, unitSystem.
  `useSceneStore` owns the camera-related fields. No work needed.
- **Step 4 — Sketch**: `hooks/useSketchState.ts` already owns sketch tools,
  entities, action-menu visibility. `useSceneStore.isSketchMode` owns the
  mode flag. Constraint-solver internal state stays where it is.

This means step 5 (extract `MainWorkspace` as a thin component) is unblocked
as soon as we want to take it — the hook scaffolding it depends on already
exists. The remaining hard part is just figuring out the right component
boundary inside the 6240–7600 JSX block, which is judgement work rather than
state-architecture work.

Sequencing flips: instead of "4 prep steps + 1 extraction", the work is now
"1 extraction step" plus minor cleanups (e.g. `bomParts` is still local
useState but it's a pure derivation of `placedParts` and can be a `useMemo`).
The 1-week estimate from the prior memory entry can probably come down to
2-3 dedicated days once the boundary is chosen.

## Sub-step 5.x — callback hooks (landed)

Before attempting the component extraction, the canvas's callback clusters
were pulled into dedicated hooks in `hooks/`. This locked stable
useCallback identity into ShapePreview's prop bag *and* lets the future
MainWorkspaceCanvas consume one hook per cluster instead of accepting five
separate prop callbacks.

| Sub-step | Hook | Replaces |
|---|---|---|
| 5.1 | `useCanvasSelectionHandlers` | inline onElementSelect (65 lines of mate-pairing) + highlightTriangles memo |
| 5.2 | `useCanvasFileImport` | inline onFileImport (42 lines of import pipeline + BOM build) |
| 5.3 | `useRadialCommand` | inline onRadialCommand (radial menu dispatcher) |
| 5.4 | `useNurbsCpEdit` | two IIFEs + onNurbsCPParamChange (NURBS CP cluster) |
| 5.5 | `useCanvasPinCommentHandlers` | 5 inline pin-comment callbacks (add/resolve/delete/react/reply) |

Inner.tsx after step 5.x lands: ~8839 lines (down from 8918 at the start
of step 5.1). The remaining canvas JSX is mostly *data* — ShapePreview
prop bindings backed by store reads, derived memos, and the five hooks
above. Every callback that was an inline arrow function in the prop bag
has been hoisted out.

## Step 5 final — extraction blocker

What's left is choosing the boundary between
`ShapeGeneratorInner` (orchestrator) and `MainWorkspaceCanvas` (renderer).
Two viable approaches:

**Approach A — pass everything as a typed props object.**
Define `MainWorkspaceCanvasProps` with ~50 fields, build it once in
Inner.tsx, spread it into a new `<MainWorkspaceCanvas {...props} />` mount.
Pros: mechanical refactor, no behavior change. Cons: doesn't reduce
coupling — Inner.tsx still computes everything; the new component just
forwards.

**Approach B — let MainWorkspaceCanvas call hooks/stores directly.**
`useAssemblyState`, `useViewportState`, `useSketchState`, `useSceneStore`,
`useUIStore`, `useSelectionStore` are all module-scoped singletons; calling
them from a second component works because they share the same state.
The remaining props are the ones Inner.tsx genuinely *computes* —
`effectiveResult`, `viewportShapeResult`, `effectiveBomParts`, the FEA/DFM
condition slots, the imperative refs (`sceneRef`, `captureRef`,
`renderCanvasRef`). That's ~15-20 props, not 50.
Pros: real reduction in surface area; canvas reads its own state. Cons:
some hooks (e.g. `useAssemblyState` with its Yjs CRDT singleton) are not
designed to be called from two places — needs validation that the second
call doesn't double-subscribe or break the awareness counter.

Approach B is the right destination; A is the safe stepping stone. The
honest recommendation is to do A first (mechanical, shippable, files
separated), validate that nothing regresses, then incrementally move
prop computations into the canvas component over a few PRs — exactly the
same incremental pattern that worked for the J5 migrations on analysis
panels.

This is the *focused dedicated session* the prior memory entry referenced.
A is ~2-3 hours; B is the multi-week reduction. Both are unblocked.

### 2026-05-13 ApproachA evaluation

Investigated Approach A in detail and found it has lower value than the
description above suggested. The renderWorkspaceShapePreview function is
essentially `<ShapePreview {...props} />` — the JSX wraps no logic of its
own, just builds the prop bag. Moving the JSX into a new file would
mean either:
  - re-using ShapePreview's existing props interface (in which case the
    new file is a 5-line wrapper around an already-extracted component);
    or
  - duplicating ~80 prop type declarations into a new interface (200+
    lines of mechanical noise).

Neither produces lasting structural reduction. The real coupling lives
in the *prop construction* inside Inner.tsx (the 200 lines that compute
viewportShapeResult, effectiveBomParts, the inline arrow handlers, etc.),
not in the JSX block itself. Approach B addresses that; Approach A does
not.

Recommendation revised: **skip Approach A**. The 5 callback hooks
landed in steps 5.1-5.5 already extracted the meaningful inline logic
(~200 lines of arrow function bodies). The remaining JSX block is
inert prop wiring that doesn't benefit from being in its own file.

When time comes to do Approach B (canvas reads `useAssemblyState` /
`useViewportState` / `useSketchState` / stores directly), start by
*adding* those hook reads inside Inner.tsx alongside the prop wiring,
delete the prop wiring once the hooks are confirmed equivalent, *then*
extract the trimmed canvas region as its own component. By that point
the prop interface is small enough that the file boundary actually
reduces coupling.

For now, treat MW step 5 as **structurally complete via steps 5.1-5.5**.
The bare ShapePreview prop block stays in Inner.tsx until Approach B
work begins.
