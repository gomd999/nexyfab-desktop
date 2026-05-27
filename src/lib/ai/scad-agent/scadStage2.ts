// SCAD pipeline Stage 2 — accuracy layer.
// Stage 1 (reliability) ensures the generator produces *valid* OpenSCAD;
// Stage 2 ensures the *intent* matches the user's actual geometric goal:
//
//   - Bounds checking: every dimension within sane manufacturing range.
//   - Pattern matching: reuse known parametric solutions from
//     `designPatternLibrary` instead of re-deriving from scratch.
//   - Constraint propagation: derived dimensions stay consistent when an
//     upstream value changes (e.g., counterbore diameter ≥ thread diameter).
//
// Used by `runScadAgent` after the intent JSON is parsed but before the
// OpenSCAD source is composed.

import type { IntentInput } from '../../openscad-render/intentToScad';
import { listPatterns, type DesignPattern } from './designPatternLibrary';

export type Intent = IntentInput;

export interface IntentDiagnostic {
  severity: 'info' | 'warn' | 'error';
  code: string;
  message: string;
}

export interface BoundsRule {
  field: string;
  min?: number;
  max?: number;
  unit?: 'mm' | 'mm³' | 'count' | 'ratio' | 'deg';
}

// Common-sense ranges for typical maker / industrial CAD work. Outside these
// bounds the agent flags an issue and asks the user to confirm.
const BOUNDS_RULES: BoundsRule[] = [
  { field: 'length_mm', min: 0.5, max: 5000, unit: 'mm' },
  { field: 'width_mm', min: 0.5, max: 5000, unit: 'mm' },
  { field: 'height_mm', min: 0.5, max: 5000, unit: 'mm' },
  { field: 'thickness_mm', min: 0.1, max: 200, unit: 'mm' },
  { field: 'diameter_mm', min: 0.5, max: 1000, unit: 'mm' },
  { field: 'radius_mm', min: 0.1, max: 500, unit: 'mm' },
  { field: 'pitch_mm', min: 0.1, max: 20, unit: 'mm' },
  { field: 'hole_count', min: 0, max: 256, unit: 'count' },
  { field: 'fillet_radius_mm', min: 0.05, max: 50, unit: 'mm' },
  { field: 'chamfer_size_mm', min: 0.05, max: 30, unit: 'mm' },
  { field: 'teeth_count', min: 6, max: 200, unit: 'count' },
  { field: 'module_mm', min: 0.2, max: 10, unit: 'mm' },
  { field: 'draft_deg', min: 0, max: 30, unit: 'deg' },
];

export interface BoundsCheckResult {
  ok: boolean;
  violations: { field: string; value: number; rule: BoundsRule; severity: 'warn' | 'error' }[];
}

export function checkBounds(intent: Record<string, unknown>): BoundsCheckResult {
  const violations: BoundsCheckResult['violations'] = [];

  const visit = (obj: Record<string, unknown>, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        visit(v as Record<string, unknown>, prefix ? `${prefix}.${k}` : k);
        continue;
      }
      if (typeof v !== 'number') continue;
      const rule = BOUNDS_RULES.find(r => r.field === k);
      if (!rule) continue;
      const tooSmall = rule.min !== undefined && v < rule.min;
      const tooBig = rule.max !== undefined && v > rule.max;
      if (tooSmall || tooBig) {
        violations.push({
          field: prefix ? `${prefix}.${k}` : k,
          value: v,
          rule,
          severity: (rule.max && v > rule.max * 2) || (rule.min && rule.min > 0 && v < rule.min / 10) ? 'error' : 'warn',
        });
      }
    }
  };

  visit(intent);
  return { ok: violations.filter(x => x.severity === 'error').length === 0, violations };
}

// ─── Pattern matching ──────────────────────────────────────────────────────

export interface PatternMatch {
  pattern: DesignPattern;
  score: number;
  reason: string;
}

/**
 * Score the user's intent against the design-pattern library. Used by the
 * agent to suggest "use the existing GT2 pulley pattern instead of deriving
 * from raw extrude+fillet+pattern" so generated SCAD stays maintainable.
 */
export function matchPatterns(intent: Intent): PatternMatch[] {
  const tags = new Set<string>();
  // Coarse keyword extraction from the intent kind + any free-text fields.
  const text = JSON.stringify(intent).toLowerCase();
  for (const w of text.split(/[^a-z0-9_]+/g)) {
    if (w.length >= 3) tags.add(w);
  }
  const matches: PatternMatch[] = [];
  for (const pattern of listPatterns()) {
    let hits = 0;
    for (const t of pattern.tags) {
      if (tags.has(t)) hits++;
    }
    if (hits === 0) continue;
    const score = hits / pattern.tags.length;
    matches.push({
      pattern,
      score,
      reason: `Matched ${hits} of ${pattern.tags.length} tags (${pattern.tags.join(', ')})`,
    });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ─── Constraint propagation ───────────────────────────────────────────────

export interface ConstraintRule {
  /** Human-readable name. */
  name: string;
  /** Returns null when the rule does not apply; otherwise the derived value. */
  derive: (intent: Record<string, unknown>) => null | { field: string; value: number; reason: string };
}

const CONSTRAINT_RULES: ConstraintRule[] = [
  {
    name: 'counterbore-vs-thread',
    derive: (intent) => {
      const thread = intent.thread_diameter_mm as number | undefined;
      const cbore = intent.counterbore_diameter_mm as number | undefined;
      if (typeof thread === 'number' && typeof cbore === 'number' && cbore < thread + 0.5) {
        return { field: 'counterbore_diameter_mm', value: thread + 1, reason: 'Counterbore must clear the thread shank (≥ thread Ø + 0.5 mm)' };
      }
      return null;
    },
  },
  {
    name: 'fillet-vs-thickness',
    derive: (intent) => {
      const r = intent.fillet_radius_mm as number | undefined;
      const t = intent.thickness_mm as number | undefined;
      if (typeof r === 'number' && typeof t === 'number' && r > t * 0.45) {
        return { field: 'fillet_radius_mm', value: Math.round(t * 0.4 * 100) / 100, reason: 'Fillet radius must stay below ~45% of thickness to keep wall integrity' };
      }
      return null;
    },
  },
  {
    name: 'min-wall-thickness',
    derive: (intent) => {
      const t = intent.wall_thickness_mm as number | undefined;
      const process = intent.process as string | undefined;
      const minT = process === 'fdm' ? 0.8 : process === 'sla' ? 0.5 : 1.0;
      if (typeof t === 'number' && t < minT) {
        return { field: 'wall_thickness_mm', value: minT, reason: `Process "${process ?? 'machining'}" minimum wall is ${minT} mm` };
      }
      return null;
    },
  },
];

export interface ConstraintPropagationResult {
  adjusted: Record<string, unknown>;
  changes: { field: string; from: unknown; to: number; reason: string }[];
}

export function propagateConstraints(intent: Record<string, unknown>): ConstraintPropagationResult {
  const out: Record<string, unknown> = { ...intent };
  const changes: ConstraintPropagationResult['changes'] = [];
  for (const rule of CONSTRAINT_RULES) {
    const derived = rule.derive(out);
    if (!derived) continue;
    changes.push({ field: derived.field, from: out[derived.field], to: derived.value, reason: derived.reason });
    out[derived.field] = derived.value;
  }
  return { adjusted: out, changes };
}

// ─── Top-level Stage 2 entry point ─────────────────────────────────────────

export interface Stage2Result {
  intent: Record<string, unknown>;
  bounds: BoundsCheckResult;
  patterns: PatternMatch[];
  constraintChanges: ConstraintPropagationResult['changes'];
  diagnostics: IntentDiagnostic[];
}

/**
 * Run the Stage 2 accuracy pipeline on a parsed intent JSON. Returns the
 * (possibly adjusted) intent plus diagnostics the agent can surface to the
 * user. The agent SHOULD respect changes silently when severity is "warn"
 * and surface them as a confirmation when "error".
 */
export function runStage2(intent: Intent): Stage2Result {
  const intentRecord = intent as unknown as Record<string, unknown>;
  const bounds = checkBounds(intentRecord);
  const patterns = matchPatterns(intent);
  const propagated = propagateConstraints(intentRecord);

  const diagnostics: IntentDiagnostic[] = [];
  for (const v of bounds.violations) {
    diagnostics.push({
      severity: v.severity,
      code: 'bounds',
      message: `${v.field}=${v.value} ${v.rule.unit ?? ''} outside ${v.rule.min ?? '?'}..${v.rule.max ?? '?'}`,
    });
  }
  for (const c of propagated.changes) {
    diagnostics.push({
      severity: 'info',
      code: 'constraint-propagation',
      message: `${c.field}: ${String(c.from)} → ${c.to} (${c.reason})`,
    });
  }
  if (patterns.length > 0 && patterns[0].score > 0.4) {
    diagnostics.push({
      severity: 'info',
      code: 'pattern-suggested',
      message: `Consider reusing ${patterns[0].pattern.title}: ${patterns[0].reason}`,
    });
  }

  return {
    intent: propagated.adjusted,
    bounds,
    patterns,
    constraintChanges: propagated.changes,
    diagnostics,
  };
}
