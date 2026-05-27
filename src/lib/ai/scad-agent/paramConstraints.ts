/**
 * paramConstraints.ts — Geometric feasibility validator for intent params.
 *
 * Sits AFTER `intentSchema.validateIntent` (which catches structural
 * errors) and BEFORE `intentToScad` (which produces OpenSCAD). The
 * gap that this fills: an intent can be schema-clean but physically
 * impossible — `box{20×20×20}` with a `hole{diameter=30}` punches a
 * hole bigger than the box.
 *
 * The rules below are deliberately conservative — we flag the user
 * confirm, not auto-reject — because some "impossible" combinations
 * are valid for special cases (a sheet metal cutout that extends
 * beyond the blank is still valid for a notch pattern). Each rule
 * carries a code so the chat UI can surface "wall thickness too
 * thin" with a one-click "make it 2mm" fix.
 *
 * Rule families:
 *   - intra-shape: shape's own params must satisfy invariants (cone
 *     base ≥ top, pipe outer > inner, etc.).
 *   - feature-vs-shape: feature params must respect the shape's
 *     bounding extent (hole diameter < min wall to wall).
 *   - feature-vs-feature: e.g. two holes in the same linear pattern
 *     shouldn't overlap.
 */

import type { IntentInput, IntentFeature } from '@/lib/openscad-render/intentToScad';

export type ConstraintSeverity = 'error' | 'warning';

export interface ConstraintViolation {
  severity: ConstraintSeverity;
  code: string;
  /** Dot-path to the offending param. */
  path: string;
  message: string;
  /** A user-facing one-line suggestion, e.g. "Set diameter ≤ 15mm". */
  suggestion?: string;
}

export interface ConstraintCheckResult {
  ok: boolean;
  violations: ConstraintViolation[];
}

function intraShape(intent: IntentInput, out: ConstraintViolation[]): void {
  const p = intent.params;
  switch (intent.shapeId) {
    case 'box': {
      for (const key of ['width_mm', 'height_mm', 'depth_mm']) {
        if (typeof p[key] === 'number' && p[key] <= 0) {
          out.push({
            severity: 'error', code: 'box-non-positive',
            path: `params.${key}`,
            message: `Box ${key} must be > 0 (got ${p[key]}).`,
            suggestion: `Set ${key} to a positive number, typically 5–500mm.`,
          });
        }
      }
      break;
    }
    case 'pipe': {
      const outer = p.outer_diameter_mm;
      const inner = p.inner_diameter_mm;
      if (typeof outer === 'number' && typeof inner === 'number' && inner >= outer) {
        out.push({
          severity: 'error', code: 'pipe-inner-ge-outer',
          path: 'params.inner_diameter_mm',
          message: `Pipe inner_diameter_mm (${inner}) must be smaller than outer_diameter_mm (${outer}).`,
          suggestion: `Set inner_diameter_mm < ${outer}.`,
        });
      }
      break;
    }
    case 'cone': {
      const base = p.base_diameter_mm;
      const top = p.top_diameter_mm;
      if (typeof base === 'number' && typeof top === 'number' && top > base) {
        out.push({
          severity: 'warning', code: 'cone-top-greater-than-base',
          path: 'params.top_diameter_mm',
          message: `Cone top_diameter_mm (${top}) is wider than base — this is an inverted cone.`,
          suggestion: `If you meant a regular cone, set top_diameter_mm ≤ ${base}.`,
        });
      }
      break;
    }
    case 'cylinder':
    case 'disk': {
      if (typeof p.diameter_mm === 'number' && p.diameter_mm <= 0) {
        out.push({
          severity: 'error', code: 'diameter-non-positive',
          path: 'params.diameter_mm',
          message: `${intent.shapeId} diameter_mm must be > 0 (got ${p.diameter_mm}).`,
        });
      }
      break;
    }
    case 'torus': {
      const major = p.major_diameter_mm;
      const minor = p.minor_diameter_mm;
      if (typeof major === 'number' && typeof minor === 'number' && minor >= major / 2) {
        out.push({
          severity: 'warning', code: 'torus-self-intersect',
          path: 'params.minor_diameter_mm',
          message: `Torus minor_diameter_mm (${minor}) is ≥ major / 2 — the tube would self-intersect.`,
          suggestion: `Set minor_diameter_mm < ${major / 2}.`,
        });
      }
      break;
    }
  }
}

/** Approximate the smallest extent of the shape's bounding box. Used
 *  to flag features whose size exceeds the available material. */
function minShapeExtent(intent: IntentInput): number {
  const p = intent.params;
  switch (intent.shapeId) {
    case 'box': {
      const w = p.width_mm, h = p.height_mm, d = p.depth_mm;
      const vals: number[] = [];
      if (typeof w === 'number') vals.push(w);
      if (typeof h === 'number') vals.push(h);
      if (typeof d === 'number') vals.push(d);
      return vals.length ? Math.min(...vals) : Infinity;
    }
    case 'cylinder':
    case 'disk':
      return typeof p.diameter_mm === 'number' ? p.diameter_mm : Infinity;
    case 'sphere':
      return typeof p.diameter_mm === 'number' ? p.diameter_mm : Infinity;
    case 'pipe':
      return typeof p.outer_diameter_mm === 'number' ? p.outer_diameter_mm : Infinity;
    default:
      return Infinity;
  }
}

function featureVsShape(
  intent: IntentInput,
  features: IntentFeature[],
  out: ConstraintViolation[],
): void {
  const minExtent = minShapeExtent(intent);
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const fp = f.params ?? {};
    switch (f.type) {
      case 'hole': {
        const d = fp.diameter_mm;
        if (typeof d === 'number' && d >= minExtent) {
          out.push({
            severity: 'error', code: 'hole-larger-than-shape',
            path: `features[${i}].params.diameter_mm`,
            message: `Hole diameter (${d}mm) ≥ smallest shape extent (${minExtent}mm). The hole would punch through the entire body.`,
            suggestion: `Set diameter_mm ≤ ${Math.floor(minExtent * 0.8)}.`,
          });
        }
        break;
      }
      case 'fillet':
      case 'chamfer': {
        const sizeKey = f.type === 'fillet' ? 'radius_mm' : 'size_mm';
        const size = fp[sizeKey];
        if (typeof size === 'number' && size >= minExtent / 2) {
          out.push({
            severity: 'warning', code: `${f.type}-too-large`,
            path: `features[${i}].params.${sizeKey}`,
            message: `${f.type} ${sizeKey} (${size}mm) is ≥ half the smallest shape extent (${minExtent}mm).`,
            suggestion: `Reduce ${sizeKey} below ${minExtent / 2}.`,
          });
        }
        break;
      }
      case 'shell': {
        const t = fp.thickness_mm;
        if (typeof t === 'number' && t >= minExtent / 2) {
          out.push({
            severity: 'error', code: 'shell-thickness-exceeds-half-extent',
            path: `features[${i}].params.thickness_mm`,
            message: `Shell thickness (${t}mm) ≥ half the smallest shape extent (${minExtent}mm) — no interior would remain.`,
            suggestion: `Set thickness_mm < ${minExtent / 2}.`,
          });
        }
        if (typeof t === 'number' && t > 0 && t < 0.5) {
          out.push({
            severity: 'warning', code: 'shell-thickness-thin',
            path: `features[${i}].params.thickness_mm`,
            message: `Shell thickness (${t}mm) is below the typical manufacturable minimum (0.5mm).`,
            suggestion: `Consider increasing to ≥ 0.5mm for printability.`,
          });
        }
        break;
      }
    }
  }
}

function featureVsFeature(features: IntentFeature[], out: ConstraintViolation[]): void {
  // Look for stacked patterns: two `linearPattern` with overlapping
  // spacing on the same feature would create duplicated geometry.
  const patterns = features
    .map((f, i) => ({ idx: i, f }))
    .filter(x => x.f.type === 'linearPattern' || x.f.type === 'circularPattern');
  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const a = patterns[i];
      const b = patterns[j];
      // Same type back-to-back is suspicious unless params differ.
      if (a.f.type === b.f.type && a.idx + 1 === b.idx) {
        const same = JSON.stringify(a.f.params ?? {}) === JSON.stringify(b.f.params ?? {});
        if (same) {
          out.push({
            severity: 'warning', code: 'duplicate-pattern',
            path: `features[${b.idx}]`,
            message: `Pattern at index ${b.idx} duplicates the one at index ${a.idx} (identical params). Remove one to avoid coincident geometry.`,
          });
        }
      }
    }
  }
}

/**
 * Run all constraint checks against the intent. Errors fail the gate;
 * warnings are surfaced but don't block downstream rendering — the
 * caller usually shows them as a "Confirm to continue" prompt.
 */
export function checkParameterConstraints(intent: IntentInput): ConstraintCheckResult {
  const violations: ConstraintViolation[] = [];
  intraShape(intent, violations);
  const features = intent.features ?? [];
  featureVsShape(intent, features, violations);
  featureVsFeature(features, violations);
  const hasError = violations.some(v => v.severity === 'error');
  return { ok: !hasError, violations };
}
