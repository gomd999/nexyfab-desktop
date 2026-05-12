/**
 * Macro recorder & replayer (F4).
 *
 * Goal: let a user record a sequence of GUI actions (add feature, change
 * param, set material) and replay it on a different model — "apply this
 * fillet+chamfer recipe to all 50 brackets" workflow.
 *
 * Why a separate type system: CommandHistory uses closures for execute/undo,
 * which can't be serialised to JSON. MacroAction is a discriminated union of
 * pure data, safe to round-trip through localStorage / file export.
 *
 * Integration: caller opts into recording by calling `record()` after every
 * meaningful UI mutation (addFeature, setParam, etc). The replayer dispatches
 * actions through caller-provided callbacks so the macro file stays decoupled
 * from any specific store.
 */

import type { FeatureType } from '../features/types';

// ─── Action union ────────────────────────────────────────────────────────────

export type MacroAction =
  | { kind: 'add-feature'; featureType: FeatureType; params?: Record<string, number> }
  | { kind: 'remove-feature'; featureId: string }
  | { kind: 'update-feature-param'; featureId: string; key: string; value: number }
  | { kind: 'toggle-feature'; featureId: string }
  | { kind: 'set-shape'; shapeId: string }
  | { kind: 'set-param'; key: string; value: number }
  | { kind: 'set-material'; materialId: string }
  | { kind: 'set-color'; color: string };

export interface Macro {
  /** Schema version — bump on action-shape change so old macros can be migrated. */
  version: 1;
  name: string;
  /** ISO-8601 timestamp of recording. */
  recordedAt: string;
  actions: MacroAction[];
}

// ─── Recorder ────────────────────────────────────────────────────────────────

export class MacroRecorder {
  private actions: MacroAction[] = [];
  private recording = false;

  start(): void {
    this.actions = [];
    this.recording = true;
  }

  stop(name: string = 'Macro'): Macro {
    this.recording = false;
    return {
      version: 1,
      name,
      recordedAt: new Date().toISOString(),
      actions: this.actions.slice(),
    };
  }

  /** Push an action — no-op when not recording so call sites can fire freely. */
  record(action: MacroAction): void {
    if (!this.recording) return;
    this.actions.push(action);
  }

  isRecording(): boolean {
    return this.recording;
  }

  /** Live action count — useful for a "12 actions recorded" badge in the UI. */
  count(): number {
    return this.actions.length;
  }

  /** Discard the buffer without producing a macro. */
  cancel(): void {
    this.actions = [];
    this.recording = false;
  }
}

// ─── Replayer ────────────────────────────────────────────────────────────────

/**
 * Action dispatch callbacks. Each is optional — actions of unsupported kinds
 * are skipped with a warning. The replayer never assumes a specific store.
 */
export interface MacroDispatch {
  addFeature?: (type: FeatureType, params?: Record<string, number>) => void;
  removeFeature?: (id: string) => void;
  updateFeatureParam?: (id: string, key: string, value: number) => void;
  toggleFeature?: (id: string) => void;
  setShape?: (id: string) => void;
  setParam?: (key: string, value: number) => void;
  setMaterial?: (id: string) => void;
  setColor?: (color: string) => void;
}

export interface MacroReplayResult {
  total: number;
  applied: number;
  skipped: number;
  errors: Array<{ index: number; action: MacroAction; error: string }>;
}

/**
 * Walk through every action in `macro` and dispatch it. Errors are captured
 * per-action so a bad action doesn't abort the whole replay — partial
 * application matches the user's mental model ("apply what you can").
 */
export function replayMacro(
  macro: Macro,
  dispatch: MacroDispatch,
): MacroReplayResult {
  const result: MacroReplayResult = {
    total: macro.actions.length,
    applied: 0,
    skipped: 0,
    errors: [],
  };

  macro.actions.forEach((action, index) => {
    try {
      switch (action.kind) {
        case 'add-feature':
          if (!dispatch.addFeature) { result.skipped++; return; }
          dispatch.addFeature(action.featureType, action.params);
          break;
        case 'remove-feature':
          if (!dispatch.removeFeature) { result.skipped++; return; }
          dispatch.removeFeature(action.featureId);
          break;
        case 'update-feature-param':
          if (!dispatch.updateFeatureParam) { result.skipped++; return; }
          dispatch.updateFeatureParam(action.featureId, action.key, action.value);
          break;
        case 'toggle-feature':
          if (!dispatch.toggleFeature) { result.skipped++; return; }
          dispatch.toggleFeature(action.featureId);
          break;
        case 'set-shape':
          if (!dispatch.setShape) { result.skipped++; return; }
          dispatch.setShape(action.shapeId);
          break;
        case 'set-param':
          if (!dispatch.setParam) { result.skipped++; return; }
          dispatch.setParam(action.key, action.value);
          break;
        case 'set-material':
          if (!dispatch.setMaterial) { result.skipped++; return; }
          dispatch.setMaterial(action.materialId);
          break;
        case 'set-color':
          if (!dispatch.setColor) { result.skipped++; return; }
          dispatch.setColor(action.color);
          break;
        default:
          result.skipped++;
          return;
      }
      result.applied++;
    } catch (err) {
      result.errors.push({
        index,
        action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return result;
}

// ─── Module-level singleton — convenience for UI integration ─────────────────

export const globalMacroRecorder = new MacroRecorder();

// ─── File I/O helpers ────────────────────────────────────────────────────────

export function macroToJson(macro: Macro): string {
  return JSON.stringify(macro, null, 2);
}

export function macroFromJson(json: string): Macro {
  const parsed = JSON.parse(json) as Macro;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported macro version: ${parsed.version}`);
  }
  if (!Array.isArray(parsed.actions)) {
    throw new Error('Macro: actions must be an array');
  }
  return parsed;
}
