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

export interface ShellSketchEntity {
  id: string;
  type: string;
  label: string;
  meta?: string;
  construction?: boolean;
}

export interface ShellSketchConstraint {
  id: string;
  type: string;
  label?: string;
}

export interface ShellSketchDimension {
  id: string;
  name: string;
  value: number;
  unit?: string;
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

  // Current canvas selection — drives the floating "Fillet 1 · 12 edges" bubble.
  selectionKind: 'face' | 'edge' | 'vertex' | 'feature' | 'multi' | null;
  selectionLabel: string | null;
  selectionCount: number;

  // Feature tree snapshot — Inner publishes a flat list for the sidebar to
  // render. Heavy domain types stay in sceneStore; this is presentation only.
  featureItems: ShellFeatureItem[];
  selectedFeatureId: string | null;
  // Assembly browser snapshot — same pattern as featureItems but for
  // assembly mode (parts list with mate counts + mass).
  assemblyItems: ShellAssemblyItem[];
  selectedAssemblyId: string | null;
  // Sketch snapshot — published from sketch store so SketchLeftPane shows
  // real entities/constraints/dimensions instead of placeholders.
  sketchEntityList: ShellSketchEntity[];
  sketchConstraintList: ShellSketchConstraint[];
  sketchDimensionList: ShellSketchDimension[];

  // Writers
  setMode: (s: Partial<Pick<ShellBridgeState, 'isSketchMode' | 'assemblyOpen' | 'editMode'>>) => void;
  setUnits: (u: ShellUnitSystem) => void;
  setView: (label: string) => void;
  setStats: (s: Partial<Pick<ShellBridgeState, 'featureCount' | 'mass' | 'volume' | 'triangleCount' | 'selectedLabel'>>) => void;
  setFps: (n: number) => void;
  setCloud: (s: Partial<Pick<ShellBridgeState, 'cloudStatus' | 'cloudSavedAt' | 'autosaveSavedAt'>>) => void;
  setSketchSolver: (s: Partial<Pick<ShellBridgeState, 'sketchSolverOk' | 'sketchDof' | 'sketchEntities' | 'sketchConstraints' | 'sketchDimensions' | 'sketchSolveMs'>>) => void;
  setSelection: (s: Partial<Pick<ShellBridgeState, 'selectionKind' | 'selectionLabel' | 'selectionCount'>>) => void;
  setFeatureItems: (items: ShellFeatureItem[], selectedId: string | null) => void;
  setAssemblyItems: (items: ShellAssemblyItem[], selectedId: string | null) => void;
  setSketchSnapshot: (s: {
    entities: ShellSketchEntity[];
    constraints: ShellSketchConstraint[];
    dimensions: ShellSketchDimension[];
  }) => void;
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
  selectionKind: null,
  selectionLabel: null,
  selectionCount: 0,
  featureItems: [],
  selectedFeatureId: null,
  assemblyItems: [],
  selectedAssemblyId: null,
  sketchEntityList: [],
  sketchConstraintList: [],
  sketchDimensionList: [],

  setMode: (s) => set(s),
  setUnits: (u) => set({ unitSystem: u }),
  setView: (label) => set({ viewLabel: label }),
  setStats: (s) => set(s),
  setFps: (n) => set({ fps: n }),
  setCloud: (s) => set(s),
  setSketchSolver: (s) => set(s),
  setSelection: (s) => set(s),
  setFeatureItems: (items, selectedId) => set({ featureItems: items, selectedFeatureId: selectedId }),
  setAssemblyItems: (items, selectedId) => set({ assemblyItems: items, selectedAssemblyId: selectedId }),
  setSketchSnapshot: (s) => set({
    sketchEntityList: s.entities,
    sketchConstraintList: s.constraints,
    sketchDimensionList: s.dimensions,
  }),
}));
