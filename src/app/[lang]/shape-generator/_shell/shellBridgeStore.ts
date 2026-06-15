// Bridge store — lets ShapeGeneratorInner publish runtime state that the new
// shell-v2 chrome (TitleBar mode chip + StatusBar) reads without lifting it
// out of Inner's local React state. Inner writes via useEffects watching its
// existing locals; ModelerShell reads via Zustand selectors.
//
// Keep this file focused on UI status only — domain state (features, scene,
// analyses) should remain in sceneStore / analysisStore / uiStore so they
// stay the single source of truth for CAD logic.

import { create } from 'zustand';

export type ShellEditMode = 'modeling' | 'sketch' | 'assembly';
export type ShellUnitSystem = 'mm' | 'inch';
export type ShellCloudStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface ShellFeatureItem {
  id: string;
  label: string;
  /** Feature type — extrude / cut / fillet / chamfer / shell / pattern / etc. */
  type: string;
  /** Suppressed or hidden — shown muted in the tree. */
  muted?: boolean;
  /** Optional meta column (e.g. "12 mm", "R 2.0"). */
  meta?: string;
  /** Numeric params keyed by name — drives the Inspector PARAMETERS section. */
  params?: Record<string, number>;
  /** Real edge selections attached to this feature (fillet/chamfer/shell) —
   *  drives the Inspector EDGES section. id = persistent topology id when
   *  available; meta = human hint (e.g. "L 12.0 mm"). */
  edges?: { id: string; meta?: string }[];
  /** Children for sketch profile / sub-features. */
  children?: ShellFeatureItem[];
}

export interface ShellAssemblyItem {
  id: string;
  label: string;
  /** Quantity instances. */
  count: number;
  /** Mass (g) if known. */
  massG?: number;
  /** External / library / referenced. */
  kind?: 'part' | 'subassembly' | 'reference';
}

export interface ShellMate {
  id: string;
  /** Mate type — coincident / concentric / distance / parallel / etc. */
  type: string;
  /** Display labels for the two mated parts (resolved from part ids). */
  partA: string;
  partB: string;
  /** Distance (mm) or angle (deg) when applicable. */
  value?: number;
  locked?: boolean;
}

export interface ShellSketchEntity {
  id: string;
  type: string;
  label: string;
  meta?: string;
  construction?: boolean;
  /** Ids of the entity's defining points — lets the sidebars match
   *  point-level constraints (coincident/fixed) back to their segment. */
  pointIds?: string[];
}

export interface ShellSketchConstraint {
  id: string;
  type: string;
  label?: string;
  /** Segment / point ids the constraint references. */
  entityIds?: string[];
  /** Solver verdict from the last (live or manual) solve. */
  satisfied?: boolean;
}

/** Mirrors constraintSolver's ConstraintStatus; null = empty sketch. */
export type ShellSketchStatus = 'ok' | 'under-defined' | 'over-defined' | 'inconsistent';

export interface ShellSketchDimension {
  id: string;
  name: string;
  /** Resolved numeric value — already evaluated from expression when present. */
  value: number;
  unit?: string;
  /** Optional raw expression (e.g. `2*D1 + 5`). When set, the sidebar shows
   *  it as the primary editable text and the resolved value as a subscript. */
  expression?: string;
  /** Per-dimension expression error surfaced by resolveDimensionTargetsWithErrors.
   *  Lets the UI mark cycle / unknown-id / non-finite cases with a tooltip
   *  rather than silently falling back to `value`. */
  expressionError?: { reason: 'syntax' | 'unknown-identifier' | 'cycle' | 'runtime' | 'non-finite'; detail?: string };
  /** Segment / point ids the dimension measures — lets the right pane
   *  show only the parameters attached to the current selection. */
  entityIds?: string[];
}

export interface ShellBridgeState {
  // Mode
  isSketchMode: boolean;
  assemblyOpen: boolean;
  editMode: ShellEditMode;

  // Units & view
  unitSystem: ShellUnitSystem;
  viewLabel: string;

  // Geometry stats
  featureCount: number;
  mass: number | null;
  volume: number | null;
  triangleCount: number;
  selectedLabel: string | null;

  // Perf
  fps: number;

  // Cloud / autosave
  cloudStatus: ShellCloudStatus;
  cloudSavedAt: number | null;
  autosaveSavedAt: number | null;

  // Sketch DOF info (only meaningful when isSketchMode)
  sketchSolverOk: boolean | null;
  sketchDof: number | null;
  sketchEntities: number;
  sketchConstraints: number;
  sketchDimensions: number;
  sketchSolveMs: number | null;
  /** Full solver status — drives the 3-state (under/full/over) chrome. */
  sketchStatus: ShellSketchStatus | null;
  /** Count of redundant constraints reported by the last solve. */
  sketchRedundantCount: number;

  // Current canvas selection — drives the floating "Fillet 1 · 12 edges" bubble.
  selectionKind: 'face' | 'edge' | 'vertex' | 'feature' | 'multi' | null;
  selectionLabel: string | null;
  selectionCount: number;

  // Feature tree snapshot — Inner publishes a flat list for the sidebar to
  // render. Heavy domain types stay in sceneStore; this is presentation only.
  featureItems: ShellFeatureItem[];
  selectedFeatureId: string | null;
  /** Tree row currently being hovered — Inner reads this to apply viewport
   *  outline / glow so users get instant feedback before clicking. */
  hoveredFeatureId: string | null;
  // Assembly browser snapshot — same pattern as featureItems but for
  // assembly mode (parts list with mate counts + mass).
  assemblyItems: ShellAssemblyItem[];
  selectedAssemblyId: string | null;
  /** Real mates (constraints between parts) — published from Inner's
   *  assemblyMates so the assembly sidebars show actual mates, not placeholders. */
  assemblyMates: ShellMate[];
  // Sketch snapshot — published from sketch store so SketchLeftPane shows
  // real entities/constraints/dimensions instead of placeholders.
  sketchEntityList: ShellSketchEntity[];
  sketchConstraintList: ShellSketchConstraint[];
  sketchDimensionList: ShellSketchDimension[];
  /** Entity currently selected in the sketch canvas (select tool) —
   *  drives the SketchRightPane "Active Selection" section. */
  sketchSelectedEntityId: string | null;

  /** Real DFM error/warning count from the last analysis run (worker auto-DFM).
   *  null = no analysis has completed yet — Inspector shows "run" instead of
   *  a fabricated count. */
  dfmWarningCount: number | null;

  // Writers
  setMode: (s: Partial<Pick<ShellBridgeState, 'isSketchMode' | 'assemblyOpen' | 'editMode'>>) => void;
  setUnits: (u: ShellUnitSystem) => void;
  setView: (label: string) => void;
  setStats: (s: Partial<Pick<ShellBridgeState, 'featureCount' | 'mass' | 'volume' | 'triangleCount' | 'selectedLabel'>>) => void;
  setFps: (n: number) => void;
  setCloud: (s: Partial<Pick<ShellBridgeState, 'cloudStatus' | 'cloudSavedAt' | 'autosaveSavedAt'>>) => void;
  setSketchSolver: (s: Partial<Pick<ShellBridgeState, 'sketchSolverOk' | 'sketchDof' | 'sketchEntities' | 'sketchConstraints' | 'sketchDimensions' | 'sketchSolveMs' | 'sketchStatus' | 'sketchRedundantCount'>>) => void;
  setSelection: (s: Partial<Pick<ShellBridgeState, 'selectionKind' | 'selectionLabel' | 'selectionCount'>>) => void;
  setFeatureItems: (items: ShellFeatureItem[], selectedId: string | null) => void;
  setHoveredFeatureId: (id: string | null) => void;
  setAssemblyItems: (items: ShellAssemblyItem[], selectedId: string | null) => void;
  setAssemblyMates: (mates: ShellMate[]) => void;
  setSketchSnapshot: (s: {
    entities: ShellSketchEntity[];
    constraints: ShellSketchConstraint[];
    dimensions: ShellSketchDimension[];
  }) => void;
  setSketchSelectedEntity: (id: string | null) => void;
  setDfmWarningCount: (n: number | null) => void;
}

export const useShellBridge = create<ShellBridgeState>((set) => ({
  isSketchMode: false,
  assemblyOpen: false,
  editMode: 'modeling',
  unitSystem: 'mm',
  viewLabel: 'Iso',
  featureCount: 0,
  mass: null,
  volume: null,
  triangleCount: 0,
  selectedLabel: null,
  fps: 60,
  cloudStatus: 'idle',
  cloudSavedAt: null,
  autosaveSavedAt: null,
  sketchSolverOk: null,
  sketchDof: null,
  sketchEntities: 0,
  sketchConstraints: 0,
  sketchDimensions: 0,
  sketchSolveMs: null,
  sketchStatus: null,
  sketchRedundantCount: 0,
  selectionKind: null,
  selectionLabel: null,
  selectionCount: 0,
  featureItems: [],
  selectedFeatureId: null,
  hoveredFeatureId: null,
  assemblyItems: [],
  selectedAssemblyId: null,
  assemblyMates: [],
  sketchEntityList: [],
  sketchConstraintList: [],
  sketchDimensionList: [],
  sketchSelectedEntityId: null,
  dfmWarningCount: null,

  setMode: (s) => set(s),
  setUnits: (u) => set({ unitSystem: u }),
  setView: (label) => set({ viewLabel: label }),
  setStats: (s) => set(s),
  setFps: (n) => set({ fps: n }),
  setCloud: (s) => set(s),
  setSketchSolver: (s) => set(s),
  setSelection: (s) => set(s),
  setFeatureItems: (items, selectedId) => set({ featureItems: items, selectedFeatureId: selectedId }),
  setHoveredFeatureId: (id) => set({ hoveredFeatureId: id }),
  setAssemblyItems: (items, selectedId) => set({ assemblyItems: items, selectedAssemblyId: selectedId }),
  setAssemblyMates: (mates) => set({ assemblyMates: mates }),
  setSketchSnapshot: (s) => set({
    sketchEntityList: s.entities,
    sketchConstraintList: s.constraints,
    sketchDimensionList: s.dimensions,
  }),
  setSketchSelectedEntity: (id) => set({ sketchSelectedEntityId: id }),
  setDfmWarningCount: (n) => set({ dfmWarningCount: n }),
}));
