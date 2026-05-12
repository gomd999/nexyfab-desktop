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
