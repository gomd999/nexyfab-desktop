/**
 * featureLauncher.ts — Turn a catalog click into a runnable feature.
 *
 * Registry modules are heterogeneous (each exports its own `evaluate` /
 * `compute` / `generate` / `size` …). The launcher resolves the module's
 * primary entry function by a fixed convention so the UI has a single
 * code path: `launchFeature(id)` → loads the chunk, finds the entry fn,
 * and returns a descriptor the panel can drive.
 *
 * It does NOT invent inputs — calling the entry fn is the panel's job
 * (per-feature forms come later). The launcher's contract is: "given an
 * id, give me the loaded module + the name of the function to call".
 */

import { loadModule, entryHintForId } from './moduleResolver';
import { FEATURE_REGISTRY } from './registry';
import { hasExample, exampleArgs } from './featureExamples';

/**
 * Entry-function name resolution order. The first export that exists and
 * is callable wins. Covers the evaluator / generator / sizer families
 * used across the catalog.
 */
export const ENTRY_FUNCTION_CANDIDATES = [
  'evaluate', 'evaluateFlatness', 'evaluateSurface', 'evaluateLine', 'evaluateAxis',
  'compute', 'generate', 'generatePath', 'size', 'build', 'calculate',
  'estimate', 'classify', 'select', 'analyze', 'optimize', 'solve',
  'layout', 'detect', 'predict', 'compensate', 'apply', 'roundCorners',
] as const;

export interface LaunchedFeature {
  id: string;
  name: string;
  entryHint: string;
  /** The loaded module's exports. */
  module: Record<string, unknown>;
  /** Names of all callable exports. */
  functionExports: string[];
  /** The resolved primary entry function name (null if none matched). */
  entryFunctionName: string | null;
  /** Whether a `summarize`-style result formatter is available. */
  hasSummarize: boolean;
  /** Whether a runnable demo example exists for this feature. */
  hasExample: boolean;
}

/** Resolve the primary entry function name from a loaded module. */
export function resolveEntryFunction(module: Record<string, unknown>): string | null {
  for (const candidate of ENTRY_FUNCTION_CANDIDATES) {
    if (typeof module[candidate] === 'function') return candidate;
  }
  // Fallback: first callable export that isn't a summarize/helper.
  const fns = callableExports(module);
  const nonSummary = fns.find(n => !/^summari[sz]e/i.test(n));
  return nonSummary ?? fns[0] ?? null;
}

function callableExports(module: Record<string, unknown>): string[] {
  return Object.keys(module).filter(k => typeof module[k] === 'function');
}

/**
 * Load a feature module by registry id and describe how to run it.
 * Throws (via loadModule) if no loader is registered for the id.
 */
export async function launchFeature(id: string): Promise<LaunchedFeature> {
  const entry = FEATURE_REGISTRY.find(e => e.id === id);
  const module = await loadModule(id);
  const functionExports = callableExports(module);
  const entryFunctionName = resolveEntryFunction(module);
  const hasSummarize = functionExports.some(n => /^summari[sz]e/i.test(n));

  return {
    id,
    name: entry?.name ?? id,
    entryHint: entryHintForId(id) ?? '',
    module,
    functionExports,
    entryFunctionName,
    hasSummarize,
    hasExample: hasExample(id),
  };
}

/**
 * Run a launched feature with its registered demo example and return the
 * summarized result (or raw result if no summarize export). Throws if the
 * feature has no example.
 */
export function runWithExample(launched: LaunchedFeature): unknown {
  if (!launched.hasExample) {
    throw new Error(`runWithExample: no example registered for "${launched.id}".`);
  }
  const result = runFeature(launched, ...exampleArgs(launched.id));
  return summarizeResult(launched, result);
}

/**
 * Invoke a launched feature's entry function with the given arguments.
 * Returns the raw result; the panel decides how to render / summarize.
 */
export function runFeature(launched: LaunchedFeature, ...args: unknown[]): unknown {
  if (!launched.entryFunctionName) {
    throw new Error(`runFeature: no entry function resolved for "${launched.id}".`);
  }
  const fn = launched.module[launched.entryFunctionName];
  if (typeof fn !== 'function') {
    throw new Error(`runFeature: entry "${launched.entryFunctionName}" is not callable for "${launched.id}".`);
  }
  return (fn as (...a: unknown[]) => unknown)(...args);
}

/** If the module exports a summarize fn, format a result with it. */
export function summarizeResult(launched: LaunchedFeature, result: unknown): unknown {
  const name = launched.functionExports.find(n => /^summari[sz]e$/i.test(n));
  if (!name) return result;
  const fn = launched.module[name];
  return typeof fn === 'function' ? (fn as (r: unknown) => unknown)(result) : result;
}
