/**
 * intentSchema.ts — Strict schema validator for NL→JSON intent output.
 *
 * The LLM emits an `IntentInput` JSON describing the shape and features
 * the user asked for. Even well-prompted models occasionally drift —
 * mislabelled fields, extra keys, wrong value types — and a downstream
 * `intentToScad` call that swallows the bad shape silently produces a
 * STL the user never wanted.
 *
 * This module is the "gate" between the LLM and the deterministic
 * pipeline. It runs three checks:
 *
 *   1. **Shape**: top-level keys present + correct types. Unknown
 *      keys are reported but not fatal (forward compatibility).
 *   2. **Allow-list**: `shapeId` is one of the supported primitives /
 *      standard parts / BOSL2 shapes from `intentToScad`.
 *   3. **Domain**: param values are numbers (LLMs sometimes emit
 *      strings or scientific notation), no NaN / Infinity, positive
 *      where required.
 *
 * Error messages are structured (code + path + hint) so the agent
 * loop can decide whether to (a) retry with a corrective prompt,
 * (b) ask the user a clarifying question, or (c) abort with a
 * surfaceable error.
 *
 * No zod dependency — manual parser keeps the bundle lean and the
 * error format under our control.
 */

import type { IntentInput, IntentFeature } from '@/lib/openscad-render/intentToScad';

/** Identifiers we currently accept as `shapeId`. Mirror of the switch
 *  table in `intentToScad.ts` — keep in sync when new shapes land. */
const KNOWN_SHAPE_IDS = new Set<string>([
  // Primitives
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'pipe', 'disk',
  // Standard parts
  'hexNut', 'washer', 'iBeam', 'lBracket', 'flange', 'bolt',
  // BOSL2-backed
  'gear', 'threadedRod', 'roundedBox', 'screw',
  // Plain helix
  'springCoil',
]);

/** Feature types accepted under `features[]`. */
const KNOWN_FEATURE_TYPES = new Set<string>([
  'hole', 'fillet', 'chamfer', 'mirror',
  'linearPattern', 'circularPattern',
  'scale', 'shell',
]);

export type IntentIssueSeverity = 'error' | 'warning';

export interface IntentIssue {
  severity: IntentIssueSeverity;
  /** Stable machine-readable code: `shape-id-unknown`, `param-non-finite`, etc. */
  code: string;
  /** Dot-path to the offending field (`params.height_mm`, `features[2].type`). */
  path: string;
  /** Human-readable explanation. */
  message: string;
  /** Optional suggestion the agent can use in a retry prompt. */
  hint?: string;
}

export interface IntentValidationResult {
  /** True when no errors (warnings still allowed). */
  ok: boolean;
  /** All issues found, errors and warnings combined. */
  issues: IntentIssue[];
  /** The (possibly null) parsed intent. `null` when the input was not
   *  a JSON object or critical fields were missing. */
  parsed: IntentInput | null;
  /**
   * W4 (ADR-015) — true when the only thing wrong is an unknown shapeId. The
   * shape isn't a single whitelisted primitive, but it may still be buildable
   * as a boolean COMPOSITION of primitives — the tool layer routes the agent to
   * add_composite_intent instead of dead-ending on write_scad.
   */
  suggestComposite?: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pushIssue(
  issues: IntentIssue[],
  severity: IntentIssueSeverity,
  code: string,
  path: string,
  message: string,
  hint?: string,
): void {
  issues.push({ severity, code, path, message, hint });
}

function validateParams(
  params: unknown,
  issues: IntentIssue[],
  pathPrefix: string,
): Record<string, number> | null {
  if (!isPlainObject(params)) {
    pushIssue(issues, 'error', 'params-not-object', pathPrefix,
      `'${pathPrefix}' must be an object of {param: number}`,
      `Wrap parameters in an object, e.g. {"height_mm": 50, "width_mm": 30}.`);
    return null;
  }
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(params)) {
    const path = `${pathPrefix}.${k}`;
    // Accept numbers as-is; try to coerce numeric strings; reject otherwise.
    let v: number | null = null;
    if (typeof raw === 'number') {
      v = raw;
    } else if (typeof raw === 'string') {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        v = n;
        pushIssue(issues, 'warning', 'param-coerced-from-string', path,
          `'${path}' was a string ("${raw}"); coerced to ${n}.`,
          'Prefer raw numbers — strings are accepted but may indicate model drift.');
      }
    }
    if (v === null) {
      pushIssue(issues, 'error', 'param-not-numeric', path,
        `'${path}' is not numeric (got ${typeof raw}).`,
        'Each param value must be a finite number in millimetres or degrees.');
      continue;
    }
    if (!Number.isFinite(v)) {
      pushIssue(issues, 'error', 'param-non-finite', path,
        `'${path}' is non-finite (${v}).`,
        'Replace NaN / Infinity with a concrete numeric value.');
      continue;
    }
    out[k] = v;
  }
  return out;
}

function validateFeatures(
  features: unknown,
  issues: IntentIssue[],
): IntentFeature[] | undefined {
  if (features === undefined) return undefined;
  if (!Array.isArray(features)) {
    pushIssue(issues, 'error', 'features-not-array', 'features',
      `'features' must be an array.`);
    return undefined;
  }
  const out: IntentFeature[] = [];
  for (let i = 0; i < features.length; i++) {
    const path = `features[${i}]`;
    const f = features[i];
    if (!isPlainObject(f)) {
      pushIssue(issues, 'error', 'feature-not-object', path,
        `'${path}' must be an object.`);
      continue;
    }
    const type = f.type;
    if (typeof type !== 'string' || !type.trim()) {
      pushIssue(issues, 'error', 'feature-type-missing', `${path}.type`,
        `'${path}.type' must be a non-empty string.`);
      continue;
    }
    if (!KNOWN_FEATURE_TYPES.has(type)) {
      pushIssue(issues, 'warning', 'feature-type-unknown', `${path}.type`,
        `'${path}.type' = '${type}' is not in the known feature allow-list.`,
        `Known types: ${Array.from(KNOWN_FEATURE_TYPES).join(', ')}.`);
    }
    let params: Record<string, number> | undefined;
    if (f.params !== undefined) {
      const validated = validateParams(f.params, issues, `${path}.params`);
      if (validated) params = validated;
    }
    const enabled = typeof f.enabled === 'boolean' ? f.enabled : undefined;
    const feature: IntentFeature = { type };
    if (params !== undefined) feature.params = params;
    if (enabled !== undefined) feature.enabled = enabled;
    out.push(feature);
  }
  return out;
}

/**
 * Validate a candidate intent object. Returns the parsed result on
 * success (errors=empty) or null parsed value on critical schema
 * failures (missing shapeId, params not an object). Warnings do not
 * fail the validation.
 */
export function validateIntent(candidate: unknown): IntentValidationResult {
  const issues: IntentIssue[] = [];
  if (!isPlainObject(candidate)) {
    pushIssue(issues, 'error', 'not-object', '',
      'Top-level intent must be a JSON object.');
    return { ok: false, issues, parsed: null };
  }

  // Unknown top-level keys → warning (forward compat).
  const allowed = new Set(['shapeId', 'params', 'features', 'facets']);
  for (const k of Object.keys(candidate)) {
    if (!allowed.has(k)) {
      pushIssue(issues, 'warning', 'unknown-key', k,
        `Unknown top-level key '${k}' — ignored.`);
    }
  }

  const shapeId = candidate.shapeId;
  if (typeof shapeId !== 'string' || !shapeId.trim()) {
    pushIssue(issues, 'error', 'shape-id-missing', 'shapeId',
      `'shapeId' must be a non-empty string identifying the primitive or part.`);
    return { ok: false, issues, parsed: null };
  }
  if (!KNOWN_SHAPE_IDS.has(shapeId)) {
    pushIssue(issues, 'error', 'shape-id-unknown', 'shapeId',
      `'shapeId' = '${shapeId}' is not in the supported shape allow-list.`,
      `Not a single primitive — build it as a boolean composition of primitives via add_composite_intent, ` +
      `or pick from: ${Array.from(KNOWN_SHAPE_IDS).slice(0, 12).join(', ')}, …`);
    // W4 — unknown shape is the ONLY error → flag the composite fallback.
    return { ok: false, issues, parsed: null, suggestComposite: true };
  }

  const params = validateParams(candidate.params, issues, 'params');
  if (!params) return { ok: false, issues, parsed: null };

  const features = validateFeatures(candidate.features, issues);

  let facets: number | undefined;
  if (candidate.facets !== undefined) {
    if (typeof candidate.facets === 'number' && Number.isFinite(candidate.facets) && candidate.facets > 0) {
      facets = Math.round(candidate.facets);
    } else {
      pushIssue(issues, 'warning', 'facets-invalid', 'facets',
        `'facets' must be a positive number; got ${String(candidate.facets)}.`);
    }
  }

  const parsed: IntentInput = { shapeId, params };
  if (features !== undefined) parsed.features = features;
  if (facets !== undefined) parsed.facets = facets;

  const hasError = issues.some(i => i.severity === 'error');
  return { ok: !hasError, issues, parsed: hasError ? null : parsed };
}
