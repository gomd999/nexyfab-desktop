/**
 * scadParamSliders — auto-extract adjustable dimensions from an NL-generated
 * intent so the OpenSCAD panel can expose sliders (CADAM-style), and changing
 * a dimension re-emits the .scad locally via scadFromIntent — NO new AI call.
 *
 * Our pipeline already carries the adjustable values as STRUCTURED params in
 * the intent JSON (unlike CADAM, which must parse them out of generated SCAD),
 * so extraction is just walking intent.params / features / parts.
 *
 * Pure + headless-testable.
 */
import type { StoredIntent, IntentInput, AssemblyPartInput } from './intentToScad';

export interface ScadSlider {
  /** Stable id (also the React key). */
  id: string;
  /** Human label, e.g. "width" or "leg2 · diameter". */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Path into the intent to write the new value back. */
  path: (string | number)[];
}

/** Param keys that are integer counts, not millimetre dimensions. */
const INTEGER_KEYS = new Set([
  'teeth', 'boltCount', 'sides', 'turns', 'bladeCount', 'portCount', 'pinRows',
  'pinCols', 'units', 'count', 'segments', 'holeCount',
]);

/** Keys to skip — not meaningfully slider-adjustable. */
const SKIP_KEYS = new Set(['facets']);

function roundNice(v: number): number {
  if (v >= 100) return Math.round(v / 5) * 5;
  if (v >= 10) return Math.round(v);
  if (v >= 1) return Math.round(v * 2) / 2;
  return Math.round(v * 10) / 10;
}

/** Heuristic slider range for a value, given whether it's an integer count. */
function rangeFor(key: string, value: number): { min: number; max: number; step: number } {
  if (INTEGER_KEYS.has(key)) {
    return { min: Math.max(1, Math.floor(value * 0.25)), max: Math.max(value + 2, Math.ceil(value * 3)), step: 1 };
  }
  if (value <= 0) return { min: 0, max: 10, step: 0.5 };
  const min = Math.max(0.1, roundNice(value * 0.2));
  const max = Math.max(roundNice(value * 2.5), min + 1);
  const step = value >= 20 ? 1 : value >= 5 ? 0.5 : 0.1;
  return { min, max, step };
}

function paramsToSliders(
  params: Record<string, number> | undefined,
  basePath: (string | number)[],
  labelPrefix: string,
  idPrefix: string,
  out: ScadSlider[],
): void {
  if (!params) return;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (SKIP_KEYS.has(key)) continue;
    const r = rangeFor(key, value);
    out.push({
      id: `${idPrefix}${key}`,
      label: labelPrefix ? `${labelPrefix} · ${key}` : key,
      value,
      min: r.min,
      max: r.max,
      step: r.step,
      path: [...basePath, key],
    });
  }
}

/** Walk a single (catalog/sketch) intent: top-level params + each feature's params. */
function singleIntentSliders(intent: IntentInput, idPrefix: string, labelPrefix: string, out: ScadSlider[]): void {
  paramsToSliders(intent.params, ['params'], labelPrefix, `${idPrefix}p_`, out);
  if (Array.isArray(intent.features)) {
    intent.features.forEach((f, i) => {
      paramsToSliders(
        f.params as Record<string, number> | undefined,
        ['features', i, 'params'],
        labelPrefix ? `${labelPrefix} · ${f.type}` : f.type,
        `${idPrefix}f${i}_`,
        out,
      );
    });
  }
}

/** Extract every adjustable dimension as a slider descriptor. */
export function extractScadSliders(intent: StoredIntent | null | undefined): ScadSlider[] {
  if (!intent || typeof intent !== 'object') return [];
  const out: ScadSlider[] = [];
  if ('kind' in intent && intent.kind === 'assembly') {
    (intent.parts as AssemblyPartInput[]).forEach((part, i) => {
      const name = part.name || `part${i + 1}`;
      // basePath roots at the part, then singleIntentSliders adds params/features.
      paramsToSliders(part.params, ['parts', i, 'params'], name, `a${i}_p_`, out);
      if (Array.isArray(part.features)) {
        part.features.forEach((f, j) => {
          paramsToSliders(
            f.params as Record<string, number> | undefined,
            ['parts', i, 'features', j, 'params'],
            `${name} · ${f.type}`,
            `a${i}_f${j}_`,
            out,
          );
        });
      }
    });
    return out;
  }
  singleIntentSliders(intent as IntentInput, '', '', out);
  return out;
}

/** Return a deep-cloned intent with the value at `path` replaced — so the
 *  caller can re-run scadFromIntent on the new intent immutably. */
export function applyScadSlider(intent: StoredIntent, path: (string | number)[], value: number): StoredIntent {
  const clone: StoredIntent = JSON.parse(JSON.stringify(intent));
  let node: unknown = clone;
  for (let i = 0; i < path.length - 1; i++) {
    if (node == null || typeof node !== 'object') return clone;
    node = (node as Record<string | number, unknown>)[path[i]!];
  }
  if (node && typeof node === 'object') {
    (node as Record<string | number, unknown>)[path[path.length - 1]!] = value;
  }
  return clone;
}
