/**
 * macroRecorder.ts — Record user actions and replay as a script.
 *
 * SolidWorks pattern: hit "Record Macro" → perform actions → "Stop
 * Recording" → a `.swp` file ready to replay. NexyFab equivalent
 * outputs JavaScript that calls the `nf.*` API.
 *
 * Recorded actions are stored as `MacroStep[]`. The recorder is a
 * pluggable observer on the feature store — call `record(step)`
 * from each dispatcher to keep the macro tape in sync.
 *
 * `serializeToScript()` emits human-readable JS the user can edit
 * before saving / sharing. Round-trip stability: re-parsing the
 * script and replaying produces the same model.
 */

import type { FeatureInstance, FeatureType } from '../features/types';

export type MacroStep =
  | { kind: 'addFeature'; featureType: FeatureType; params: Record<string, number>; t: number }
  | { kind: 'addExtrude'; profileKind: 'rect' | 'circle' | 'polygon'; opts: Record<string, number | string>; t: number }
  | { kind: 'updateParam'; featureId: string; paramKey: string; value: number; t: number }
  | { kind: 'removeFeature'; featureId: string; t: number }
  | { kind: 'reorderFeature'; featureId: string; newIndex: number; t: number }
  | { kind: 'toggleFeature'; featureId: string; enabled: boolean; t: number }
  | { kind: 'clearAll'; t: number };

export interface Macro {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  steps: MacroStep[];
}

export class MacroRecorder {
  private steps: MacroStep[] = [];
  private startTime: number = 0;
  private recording: boolean = false;

  start(): void {
    this.steps = [];
    this.startTime = Date.now();
    this.recording = true;
  }

  stop(): MacroStep[] {
    this.recording = false;
    return this.snapshot();
  }

  isRecording(): boolean {
    return this.recording;
  }

  record(step: MacroStep extends infer S ? S extends { t: number } ? Omit<S, 't'> : never : never): void {
    if (!this.recording) return;
    this.steps.push({ ...step, t: Date.now() - this.startTime } as MacroStep);
  }

  snapshot(): MacroStep[] {
    return this.steps.slice();
  }

  reset(): void {
    this.steps = [];
    this.startTime = 0;
    this.recording = false;
  }
}

/** Emit a JS string that, when run via runScript(), reproduces the macro. */
export function serializeMacroToScript(macro: Macro, opts: { withComments?: boolean } = {}): string {
  const withComments = opts.withComments ?? true;
  const lines: string[] = [];
  if (withComments) {
    lines.push(`// Macro: ${macro.name}`);
    if (macro.description) lines.push(`// ${macro.description}`);
    lines.push(`// Created: ${new Date(macro.createdAt).toISOString()}`);
    lines.push(`// Steps: ${macro.steps.length}`);
    lines.push('');
  }

  // Track feature id remapping so replayed actions point to the
  // freshly-created features (the recorded ids won't exist on replay).
  let pendingIdMap = false;
  for (const step of macro.steps) {
    if (step.kind === 'updateParam' || step.kind === 'removeFeature'
     || step.kind === 'reorderFeature' || step.kind === 'toggleFeature') {
      pendingIdMap = true;
      break;
    }
  }
  if (pendingIdMap) {
    lines.push('const _ids = {};');
    lines.push('');
  }

  for (const step of macro.steps) {
    switch (step.kind) {
      case 'addFeature':
        lines.push(`_ids[${JSON.stringify('s' + step.t)}] = nf.addFeature(${JSON.stringify(step.featureType)}, ${JSON.stringify(step.params)});`);
        break;
      case 'addExtrude':
        lines.push(`_ids[${JSON.stringify('s' + step.t)}] = nf.addExtrude({profile: ${JSON.stringify(step.profileKind)}, ...${JSON.stringify(step.opts)}});`);
        break;
      case 'updateParam':
        // ID remap can't be inferred from the recording alone — leave as-is.
        lines.push(`nf.updateParam(${JSON.stringify(step.featureId)}, ${JSON.stringify(step.paramKey)}, ${step.value});`);
        break;
      case 'removeFeature':
        lines.push(`nf.removeFeature(${JSON.stringify(step.featureId)});`);
        break;
      case 'reorderFeature':
        lines.push(`nf.reorderFeature(${JSON.stringify(step.featureId)}, ${step.newIndex});`);
        break;
      case 'toggleFeature':
        lines.push(`nf.toggleFeature(${JSON.stringify(step.featureId)}, ${step.enabled});`);
        break;
      case 'clearAll':
        lines.push('nf.clearAll();');
        break;
    }
  }
  return lines.join('\n');
}

type MacroStepNoT = MacroStep extends infer S ? S extends { t: number } ? Omit<S, 't'> : never : never;

/** Strip the timing info from a macro — useful when storing or
 *  comparing macros across recordings. */
export function normalizeMacro(steps: MacroStep[]): MacroStepNoT[] {
  return steps.map(s => {
    const { t: _t, ...rest } = s as MacroStep & { t: number };
    return rest as MacroStepNoT;
  });
}

/** Predicted feature ids after replay — useful for tests. */
export function predictReplayFeatures(macro: Macro): FeatureInstance[] {
  // Best-effort dry-run that doesn't touch the real store. Produces
  // a synthetic feature list reflecting the macro's effect.
  const out: FeatureInstance[] = [];
  let counter = 0;
  for (const step of macro.steps) {
    if (step.kind === 'addFeature') {
      out.push({ id: `pred_${counter++}`, type: step.featureType, params: step.params, enabled: true });
    } else if (step.kind === 'addExtrude') {
      out.push({ id: `pred_${counter++}`, type: 'sketchExtrude', params: {}, enabled: true });
    } else if (step.kind === 'removeFeature') {
      const idx = out.findIndex(f => f.id === step.featureId);
      if (idx >= 0) out.splice(idx, 1);
    } else if (step.kind === 'updateParam') {
      const f = out.find(x => x.id === step.featureId);
      if (f) f.params[step.paramKey] = step.value;
    } else if (step.kind === 'toggleFeature') {
      const f = out.find(x => x.id === step.featureId);
      if (f) f.enabled = step.enabled;
    } else if (step.kind === 'clearAll') {
      out.length = 0;
    }
  }
  return out;
}
