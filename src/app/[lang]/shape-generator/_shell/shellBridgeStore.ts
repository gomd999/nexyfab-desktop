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

  // Writers
  setMode: (s: Partial<Pick<ShellBridgeState, 'isSketchMode' | 'assemblyOpen' | 'editMode'>>) => void;
  setUnits: (u: ShellUnitSystem) => void;
  setView: (label: string) => void;
  setStats: (s: Partial<Pick<ShellBridgeState, 'featureCount' | 'mass' | 'volume' | 'triangleCount' | 'selectedLabel'>>) => void;
  setFps: (n: number) => void;
  setCloud: (s: Partial<Pick<ShellBridgeState, 'cloudStatus' | 'cloudSavedAt' | 'autosaveSavedAt'>>) => void;
  setSketchSolver: (s: Partial<Pick<ShellBridgeState, 'sketchSolverOk' | 'sketchDof' | 'sketchEntities' | 'sketchConstraints' | 'sketchDimensions' | 'sketchSolveMs'>>) => void;
  setSelection: (s: Partial<Pick<ShellBridgeState, 'selectionKind' | 'selectionLabel' | 'selectionCount'>>) => void;
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

  setMode: (s) => set(s),
  setUnits: (u) => set({ unitSystem: u }),
  setView: (label) => set({ viewLabel: label }),
  setStats: (s) => set(s),
  setFps: (n) => set({ fps: n }),
  setCloud: (s) => set(s),
  setSketchSolver: (s) => set(s),
  setSelection: (s) => set(s),
}));
